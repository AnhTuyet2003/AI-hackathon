import { mentorScenarios } from "./mentor-cases";
import { prepareIntake, finalizeMatch, localMatch } from "./intake-engine";
import { parseMedicalText } from "./medical-form";
import { underwriterRegistry } from "./underwriters";

export const seedCases = mentorScenarios.map((s) => {
  const extraction = {
    fileName: `${s.id}.txt`,
    mimeType: "text/plain",
    kind: "medical" as const,
    provider: "stub" as const,
    fields: { ...parseMedicalText(s.text), extractionConfidence: 0.82 },
    rawText: s.text,
    readable: true,
    source: "plain-text" as const,
    summary: "Synthetic mentor reference",
    warnings: [],
    documentSessionId: `seed-${s.id}`,
  };
  const c = prepareIntake(
    { ...s.application, documents: [extraction.fileName] },
    [extraction],
    `DEMO-${s.id}`,
  );
  return c.status === "POOL_QUEUE" ? c : finalizeMatch(c, localMatch(c));
});

export { underwriterRegistry };
