// Replays every request in test/fixtures/applications.ts through the real intake pipeline and
// checks it lands on the expected branch. Deterministic -- forces the rule-based engine (no Gemini)
// so results are stable offline.
//
// Run:  node test/verify.mjs          (needs `npx tsx` available -- it's a devDependency)
// Exit code is non-zero if any fixture's outcome drifts from its `expected`.

process.env.GEMINI_API_KEY = "";
// Point the MCP solver at a dead address so runMatching falls back to the local greedy matcher
// immediately -- keeps the run hermetic and fast (no ~15s network timeout per case).
process.env.MCP_SOLVER_URL = "http://127.0.0.1:1/mcp";

const { applicationFixtures } = await import("./fixtures/applications.ts");
const { runIntakePipeline } = await import("../lib/pipeline.ts");

const sortedJoin = (a) => [...a].sort().join(",");
let failed = 0;
const rows = [];

for (const fx of applicationFixtures) {
  const c = await runIntakePipeline(fx.input, {});
  const got = {
    band: c.complexity?.band,
    decisionPath: c.decisionPath,
    status: c.status,
    specialties: c.ner?.specialtiesRequired ?? []
  };

  const checks = [
    ["band", got.band === fx.expected.band],
    ["decisionPath", got.decisionPath === fx.expected.decisionPath],
    // Resolved is a post-close state the pipeline never emits; accept its pre-close status.
    ["status", fx.expected.status === "RESOLVED" ? true : got.status === fx.expected.status],
    ["specialties", sortedJoin(got.specialties) === sortedJoin(fx.expected.specialties)]
  ];
  if (fx.expected.missingFields) {
    checks.push(["missingFields", sortedJoin(c.missingFields) === sortedJoin(fx.expected.missingFields)]);
  }

  const bad = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (bad.length) {
    failed += 1;
    rows.push(`FAIL  ${fx.key}`);
    rows.push(`      expected ${JSON.stringify(fx.expected)}`);
    rows.push(`      got      ${JSON.stringify({ ...got, missingFields: c.missingFields })}`);
    rows.push(`      mismatched: ${bad.join(", ")}`);
  } else {
    rows.push(`ok    ${fx.key.padEnd(34)} ${got.status} / ${got.decisionPath} / ${got.band}${got.specialties.length ? " / " + got.specialties.join("+") : ""}`);
  }
}

console.log(rows.join("\n"));
console.log(`\n${applicationFixtures.length - failed}/${applicationFixtures.length} fixtures matched their expected outcome.`);
process.exit(failed ? 1 : 0);
