import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { careFixtures } from "./fixtures";
import { evaluate, validateDataset } from "./evaluate";
import {
  CARE_INSTRUCTIONS,
  PROMPT_VERSION,
  createGeminiClassifier,
  modelInput,
} from "./model";
import {
  CARE_POLICY_VERSION,
  validateCareSubmission,
  type CareSubmission,
} from "../../lib/care-routing";
import { applyReviewedLabels, parseReviewPack } from "../../lib/care-review";

class UsageError extends Error {}

async function main() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      ![
        "--mode",
        "--split",
        "--predictions",
        "--model",
        "--output",
        "--reviews",
      ].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new UsageError(
        "Options need a value: --mode, --split, --predictions, --model, --output, --reviews.",
      );
    options[key] = args[i + 1];
  }
  const mode = options["--mode"] ?? "validate";
  const split = options["--split"] ?? "development";
  if (!["validate", "export", "gemini", "predictions"].includes(mode))
    throw new UsageError(
      "Mode must be validate, export, gemini or predictions.",
    );
  if (!["development", "holdout"].includes(split))
    throw new UsageError("Split must be development or holdout.");
  let fixtures = careFixtures;
  let reviewSourceSha256: string | null = null;
  if (options["--reviews"]) {
    const raw = await readFile(resolve(options["--reviews"]), "utf8");
    try {
      fixtures = applyReviewedLabels(
        parseReviewPack(JSON.parse(raw), careFixtures),
        careFixtures,
        split as "development" | "holdout",
      );
    } catch (e) {
      throw new UsageError(`Review import failed: ${(e as Error).message}`);
    }
    reviewSourceSha256 = createHash("sha256").update(raw).digest("hex");
  }
  const validation = validateDataset(fixtures);
  const selected = fixtures.filter((f) => f.split === split);
  const directory = resolve(options["--output"] ?? "evaluation/results");
  const timestamp = new Date().toISOString();
  const metadata = {
    timestamp,
    mode,
    split,
    policyVersion: CARE_POLICY_VERSION,
    promptVersion: PROMPT_VERSION,
    datasetSha256: createHash("sha256")
      .update(JSON.stringify(fixtures))
      .digest("hex"),
    reviewSourceSha256,
    promptSha256: createHash("sha256").update(CARE_INSTRUCTIONS).digest("hex"),
    labelStatus: validateDataset(selected).labelStatus,
    productionReadiness: "not established",
  };
  let result: unknown;
  let model: string | null = null;
  let failures = false;
  if (mode === "export") {
    const folder = resolve(
      directory,
      `${timestamp.replace(/[:.]/g, "-")}-export-${split}`,
    );
    await mkdir(folder, { recursive: true });
    await writeFile(
      resolve(folder, "inputs.jsonl"),
      selected
        .map((f) =>
          JSON.stringify({
            id: f.id,
            input: modelInput(f.input),
            commonValidationFailures: validateCareSubmission(f.input),
          }),
        )
        .join("\n") + "\n",
    );
    await writeFile(
      resolve(folder, "reference-labels.json"),
      JSON.stringify(
        selected.map((f) => ({
          id: f.id,
          groupId: f.groupId,
          provenance: f.provenance,
          reviewStatus: f.reviewStatus,
          expected: f.expected,
          evidence: f.goldEvidence,
        })),
        null,
        2,
      ) + "\n",
    );
    const guide = selected
      .map(
        (f) =>
          `## ${f.id} ${f.scenario}\n\n${f.input.documents.map((d) => d.text).join("\n\n") || "No document supplied."}\n\nReference result: ${f.expected.category ?? "POOL_QUEUE"} (${f.expected.reason}).\n\nCommon validation failures: ${f.expected.missingFields.join(", ") || "none"}.\n\nReview status: ${f.reviewStatus}. Source: authored synthetic example.\n`,
      )
      .join("\n");
    await writeFile(
      resolve(folder, "cases-for-review.md"),
      `# ${split} treatment classification cases\n\nReview against care-routing-v1-draft. Confirm the current submitted event, every supported or uncertain category, exact evidence quotes and queue reason. Label status: ${metadata.labelStatus}.\n\n${guide}`,
    );
    result = {
      ...metadata,
      modelCalls: 0,
      modelAccuracy: null,
      exportDirectory: folder,
      cases: selected.length,
    };
    console.log(
      `Exported ${selected.length} cases to ${folder}. Model inputs and reference labels are separate files.`,
    );
  } else if (mode === "validate") {
    result = { ...validation, ...metadata };
    console.log(
      `Validated ${validation.fixtureCount} synthetic references (${validation.development} development, ${validation.holdout} holdout). No model was run.`,
    );
    console.log(`Selected ${split} labels: ${metadata.labelStatus}.`);
  } else {
    let classify: (input: CareSubmission) => Promise<unknown>;
    if (mode === "gemini") {
      // Environment files are loaded only for an explicitly requested live run.
      const { loadEnvConfig } = await import("@next/env");
      loadEnvConfig(process.cwd());
      if (!process.env.GEMINI_API_KEY)
        throw new UsageError(
          "GEMINI_API_KEY is required for --mode gemini. No model run occurred.",
        );
      model =
        options["--model"] ??
        process.env.CARE_EVAL_MODEL ??
        "gemini-3.1-flash-lite";
      classify = createGeminiClassifier(process.env.GEMINI_API_KEY, model);
    } else {
      if (!options["--predictions"])
        throw new UsageError(
          "--predictions must name a JSON object keyed by fixture ID.",
        );
      const predictions: unknown = JSON.parse(
        await readFile(resolve(options["--predictions"]), "utf8"),
      );
      if (
        !predictions ||
        typeof predictions !== "object" ||
        Array.isArray(predictions)
      )
        throw new UsageError(
          "Predictions must be an object keyed by fixture ID.",
        );
      const records = predictions as Record<string, unknown>;
      if (Object.keys(records).some((id) => !selected.some((f) => f.id === id)))
        throw new UsageError(
          "Predictions contain IDs outside the selected split.",
        );
      const missing = selected.filter(
        (f) => !validateCareSubmission(f.input).length && !(f.id in records),
      );
      if (missing.length)
        throw new UsageError(
          `Predictions are missing: ${missing.map((f) => f.id).join(", ")}`,
        );
      classify = async (input) => records[input.submissionId];
    }
    const evaluated = await evaluate(selected, classify, (done, total) =>
      console.log(`Evaluated ${done}/${total}`),
    );
    result = {
      ...metadata,
      model,
      providerCalls:
        mode === "gemini" ? evaluated.metrics.classificationAttempts : 0,
      ...evaluated,
    };
    failures = evaluated.metrics.modelFailures > 0;
    console.log(JSON.stringify(evaluated.metrics, null, 2));
  }
  await mkdir(directory, { recursive: true });
  const file = resolve(
    directory,
    `${timestamp.replace(/[:.]/g, "-")}-${mode}-${split}.json`,
  );
  await writeFile(file, JSON.stringify(result, null, 2) + "\n");
  console.log(`Report: ${file}`);
  // Classification errors remain measurements, not an invented release threshold.
  // Provider/output failures make the command unsuccessful even when fail-closed routing worked.
  if (failures) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // SDK error bodies can contain request content; avoid leaking them into logs.
  console.error(
    error instanceof UsageError
      ? error.message
      : "Evaluation could not finish. Check prediction JSON, output path and live-run configuration. No successful model evaluation is claimed.",
  );
  process.exitCode = 1;
});
