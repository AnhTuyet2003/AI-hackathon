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
const { extractDocuments } = await import("../lib/document-ingest.ts");
const { evaluateDocumentQuality, passesDocumentQualityScore } = await import("../lib/document-quality.ts");
const { extractEntities, formatComplexityReason, scoreComplexity } = await import("../lib/mock-ai.ts");
const { parseExtractions } = await import("../lib/reconcile.ts");
const { passesAutoAssignmentConfidence } = await import("../lib/pipeline.ts");

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

// Document-quality checks use actual content-bearing PDF streams. Filenames are intentionally
// varied so a matching name cannot make a different or unreadable document pass.
const claimTexts = [
  `SOCIALIST REPUBLIC OF VIETNAM RIVERSIDE GENERAL HOSPITAL MEDICAL RECORD AND INSURANCE CLAIM DOSSIER Medical record number CLM-2026-0001 Date of birth 14 February 1987 Insurance card / policy number POL-TEST-1001 Provider code HSP-048217 Clinical department General Surgery Room / service location Ward 3 - Room 312 Service date and time Arrival 18 August 2026, 21:40 Release 22 August 2026, 10:30 Chief complaint and symptoms Three days of worsening right lower abdominal pain, fever, nausea, and loss of appetite. Relevant medical history No previous abdominal surgery. No known drug allergies. Vital signs and physical findings Temperature 38.6 C; pulse 104 bpm; marked tenderness in the right lower abdomen with guarding. Investigations and results Abdominal ultrasound followed by contrast CT. Imaging showed an enlarged appendix with surrounding inflammation. Treatment and procedures performed Intravenous fluids, antibiotic therapy, pain control, surgical removal of the appendix. Course and outcome Pain and fever improved. Patient released with oral antibiotics. Discharge / follow-up instructions Return for reassessment if symptoms worsen. Recorded diagnosis Acute appendicitis with localized peritonitis (ICD-10-CM K35.30) Supporting documents attached Emergency assessment note; laboratory report; imaging report; operative report; itemized bill. Itemized financial summary Billed amount USD 6840.00 Eligible amount USD 5920.00 Patient responsibility USD 920.00`,
  `SOCIALIST REPUBLIC OF VIETNAM GREENFIELD FAMILY CLINIC MEDICAL RECORD AND INSURANCE CLAIM DOSSIER Medical record number CLM-2026-0002 Date of birth 03 November 1995 Insurance card / policy number POL-TEST-1002 Provider code CLN-993502 Clinical department Internal Medicine Room / service location Exam Room 05 Service date and time Visit date 24 August 2026, 09:15-11:05 Chief complaint and symptoms Sore throat, runny nose, dry cough, fatigue, and a temperature of 37.9 C for two days. Relevant medical history No known illnesses. No known drug allergies. Vital signs and physical findings Mild redness of the throat without tonsillar exudate. Clear lung sounds. Oxygen saturation 99% on room air. Investigations and results Vital signs, throat examination, rapid influenza test, and rapid streptococcal test. Rapid influenza A positive; rapid influenza B negative; rapid streptococcal test negative. Treatment and procedures performed Oral antiviral medication, fever and pain relief, hydration advice, and rest. Course and outcome The patient was clinically stable and planned to recover at home. Discharge / follow-up instructions Return for reassessment if symptoms worsen. Recorded diagnosis Influenza due to identified seasonal influenza virus (ICD-10-CM J10.1) Supporting documents attached Clinic consultation note; vital-sign record; rapid test results; prescription; itemized bill. Itemized financial summary Billed amount USD 185.00 Eligible amount USD 160.00 Patient responsibility USD 25.00`,
  `SOCIALIST REPUBLIC OF VIETNAM BRIGHT SMILE ORAL HEALTH CENTER MEDICAL RECORD AND INSURANCE CLAIM DOSSIER Medical record number CLM-2026-0003 Date of birth 27 June 1978 Insurance card / policy number POL-TEST-1003 Provider code DEN-071844 Clinical department Oral Health Room / service location Treatment Room 02 Service date and time Visit date 28 August 2026, 14:00-15:20 Chief complaint and symptoms Severe throbbing pain in the lower left back tooth for four days, sensitivity to hot and cold drinks, pain while chewing, and mild swelling near the jaw. Relevant medical history No recent injury. No known drug allergies. Physical findings Deep decay involving the lower left second molar; tooth tender to tapping; gum around it swollen. Investigations and results Oral examination, thermal sensitivity testing, percussion testing, and a periapical radiograph. Treatment and procedures performed Local anesthetic, root canal treatment, and temporary restoration. Course and outcome Pain decreased after treatment. Discharge / follow-up instructions Return for permanent restoration. Recorded diagnosis Irreversible pulpitis with symptomatic apical periodontitis (ICD-10-CM K04.0) Supporting documents attached Oral examination note; radiograph report; procedure note; itemized bill. Itemized financial summary Billed amount USD 920.00 Eligible amount USD 780.00 Patient responsibility USD 78.00`
];
const makePdf = (text) => Buffer.from(`%PDF-1.4\nstream\nBT\n(${text.replace(/([\\()])/g, "\\$1")}) Tj\nET\nendstream\n`);
const makeDocx = (text) => {
  const name = Buffer.from("word/document.xml");
  const content = Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6); header.writeUInt16LE(0, 8);
  header.writeUInt32LE(content.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, content]);
};
const claimFiles = claimTexts.map((text, index) => ({ name: `claim_record_${index + 1}_clm-2026-000${index + 1}.pdf`, mimeType: "application/pdf", dataBase64: makePdf(text).toString("base64") }));
const claimExtractions = await extractDocuments(claimFiles);
const claimCase = await runIntakePipeline(applicationFixtures[0].input, { extractions: [claimExtractions[0]] });
const claim3Quality = evaluateDocumentQuality([claimExtractions[2]]);
const sameDayDentalQuality = evaluateDocumentQuality([{ ...claimExtractions[2], fields: { ...claimExtractions[2].fields, procedureDate: undefined } }]);
const sameDayDentalComplexity = scoreComplexity(applicationFixtures[0].input, extractEntities(applicationFixtures[0].input), claimExtractions[2].fields);
const renamedExtractions = await extractDocuments(claimFiles.map((file, index) => ({ ...file, name: ["upload.pdf", "medical_record.pdf", "random-file-123.pdf"][index] })));
const unrelated = await extractDocuments([{ ...claimFiles[0], dataBase64: makePdf("This is an unrelated document with no patient, provider, diagnosis, clinical examination, or billing evidence.").toString("base64") }]);
const incompleteFile = { name: "incomplete.pdf", mimeType: "application/pdf", dataBase64: makePdf("Patient: Unknown. Diagnosis: cough.").toString("base64") };
const incomplete = await extractDocuments([incompleteFile]);
const unreadable = await extractDocuments([{ name: "unreadable.pdf", mimeType: "application/pdf", dataBase64: Buffer.from("%PDF-1.7 image-only-content").toString("base64") }]);
const symptomsOnly = await extractDocuments([{ name: "symptoms-only.pdf", mimeType: "application/pdf", dataBase64: makePdf("Same-day clinic visit. Patient reports fever, cough, sore throat, and fatigue for two days.").toString("base64") }]);
const missingIdentityProvider = await extractDocuments([{ name: "missing-fields.pdf", mimeType: "application/pdf", dataBase64: makePdf("Clinical examination: mild cough. Treatment: rest and fluids. Diagnosis: viral upper respiratory infection.").toString("base64") }]);
const partialProvider = await extractDocuments([{ name: "partial-provider.pdf", mimeType: "application/pdf", dataBase64: makePdf("Central Medical Facility Clinical department Internal Medicine Chief complaint and symptoms cough.").toString("base64") }]);
const contradictory = await extractDocuments([{ name: "contradictory.pdf", mimeType: "application/pdf", dataBase64: makePdf(claimTexts[0].replace("Release 22 August 2026, 10:30", "Release 17 August 2026, 10:30").replace("Patient responsibility USD 920.00", "Patient responsibility USD -920.00")).toString("base64") }]);
const incompleteCase = await runIntakePipeline(applicationFixtures[0].input, { extractions: incomplete });
const switchingSurgical = await extractDocuments([{ ...claimFiles[0], documentSessionId: "session-surgical", createdAt: "2026-09-08T00:00:00.000Z" }]);
const switchingIncomplete = await extractDocuments([{ ...incompleteFile, documentSessionId: "session-incomplete", createdAt: "2026-09-08T00:01:00.000Z" }]);
const afterSurgical = await runIntakePipeline(applicationFixtures[0].input, { extractions: switchingSurgical, documentSessionId: "session-surgical" });
const afterRemovalAndIncomplete = await runIntakePipeline(applicationFixtures[0].input, { extractions: switchingIncomplete, documentSessionId: "session-incomplete" });
const switchingCompleteAgain = await runIntakePipeline(applicationFixtures[0].input, { extractions: switchingSurgical, documentSessionId: "session-surgical" });
const sameFileAgain = await extractDocuments([{ ...claimFiles[0], name: "renamed-same-content.pdf", documentSessionId: "session-repeat" }]);
const plainTextClaim = await extractDocuments([{ name: "renamed.txt", mimeType: "text/plain", dataBase64: Buffer.from(claimTexts[1]).toString("base64") }]);
const docxClaim = await extractDocuments([{ name: "renamed.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", dataBase64: makeDocx(claimTexts[2]).toString("base64") }]);
const negativeClinicalFields = {
  medicalSummary: "Severe abdominal pain, nausea, and lower abdominal tenderness. Provider information is not available. Department is not available. Billing details are not available.",
  chiefComplaint: "Severe abdominal pain and nausea.",
  symptoms: "Severe abdominal pain and nausea.",
  physicalFindings: "Lower abdominal tenderness.",
  treatment: "Treatment information is not available.",
  facilityName: "Provider information is not available.",
  department: "Department is not available.",
  supportingDocuments: "Supporting documents and billing details are not available."
};
const negativeExtraction = [{ fileName: "incomplete-clinical.pdf", mimeType: "application/pdf", kind: "medical", provider: "gemini", fields: negativeClinicalFields, rawText: "Severe abdominal pain, nausea, lower abdominal tenderness.", readable: true, source: "gemini", summary: "Incomplete clinical evidence.", warnings: [] }];
const negativeQuality = evaluateDocumentQuality(negativeExtraction);
const negativeNer = extractEntities({ medicalHistory: "Severe abdominal pain and nausea.", disclosures: "" }, negativeClinicalFields);
const negativeCase = await runIntakePipeline(applicationFixtures[0].input, { extractions: negativeExtraction, documentSessionId: "negative-session" });
const claimChecks = [
  ["claim-1 quality passes", claimCase.documentQuality?.validationStatus === "PASSED"],
  ["claim-1 detects inpatient profile", claimCase.documentQuality?.detectedMedicalProfile === "Inpatient acute surgical claim"],
  ["claim-1 does not block assignment", claimCase.status !== "POOL_QUEUE"],
  ["complexity reason uses the current evaluation scores", claimCase.complexity?.reasonCode.includes(`Score ${claimCase.complexity.caseComplexityScore}/10`) && claimCase.complexity.reasonCode.includes(`application complexity ${claimCase.complexity.applicationComplexityScore}/10`) && claimCase.complexity.reasonCode.includes(`clinical complexity ${claimCase.complexity.clinicalComplexityScore}/10`)],
  ["complete surgical content creates high case complexity", claimCase.complexity?.clinicalComplexityScore >= 8 && claimCase.complexity?.score >= 8],
  ["claim-3 flags code review without blocking", claim3Quality.contradictions.some((item) => item.code === "ICD_CODE_REVIEW_REQUIRED") && claim3Quality.validationStatus === "PASSED"],
  ["renamed claim keeps profile and similar score", renamedExtractions[0].kind === claimExtractions[0].kind && Math.abs(evaluateDocumentQuality([renamedExtractions[0]]).score - evaluateDocumentQuality([claimExtractions[0]]).score) <= 0.5],
  ["matching filename cannot rescue different content", evaluateDocumentQuality(unrelated).validationStatus === "FAILED"],
  ["incomplete PDF fails to Pool Queue", evaluateDocumentQuality(incomplete).validationStatus === "FAILED" && evaluateDocumentQuality(incomplete).route === "POOL_QUEUE"],
  ["unreadable PDF fails to Pool Queue", evaluateDocumentQuality(unreadable).validationStatus === "FAILED" && evaluateDocumentQuality(unreadable).route === "POOL_QUEUE"],
  ["symptoms-only document fails", evaluateDocumentQuality(symptomsOnly).score < 8 && evaluateDocumentQuality(symptomsOnly).validationStatus === "FAILED"],
  ["missing identity/provider fails", evaluateDocumentQuality(missingIdentityProvider).validationStatus === "FAILED" && evaluateDocumentQuality(missingIdentityProvider).route === "POOL_QUEUE"],
  ["partial fields are not reported as missing", evaluateDocumentQuality(partialProvider).partialFields.includes("Provider and facility information") && !evaluateDocumentQuality(partialProvider).missingFields.includes("Provider and facility information")],
  ["contradictory dates and billing are explained and penalized", evaluateDocumentQuality(contradictory).contradictions.some((item) => item.code === "RELEASE_BEFORE_ADMISSION") && evaluateDocumentQuality(contradictory).contradictions.some((item) => item.code === "NEGATIVE_PATIENT_RESPONSIBILITY") && evaluateDocumentQuality(contradictory).score < 8],
  ["low-quality document blocks assignment", incompleteCase.status === "POOL_QUEUE" && incompleteCase.poolQueueReason !== null],
  ["plain text content is evaluated", evaluateDocumentQuality(plainTextClaim).detectedMedicalProfile === "Outpatient medical / infectious-disease claim"],
  ["DOCX content is evaluated", evaluateDocumentQuality(docxClaim).detectedMedicalProfile === "Outpatient dental claim"]
  , ["surgical content increases clinical complexity", scoreComplexity(applicationFixtures[0].input, extractEntities(applicationFixtures[0].input), claimExtractions[0].fields).clinicalComplexityScore >= 6]
  , ["same-day clinic remains less complex than surgery", scoreComplexity(applicationFixtures[0].input, extractEntities(applicationFixtures[0].input), claimExtractions[1].fields).clinicalComplexityScore < scoreComplexity(applicationFixtures[0].input, extractEntities(applicationFixtures[0].input), claimExtractions[0].fields).clinicalComplexityScore]
  , ["quality threshold is inclusive", passesDocumentQualityScore(8) && !passesDocumentQualityScore(7.9)]
  , ["confidence below threshold blocks auto-assignment", !passesAutoAssignmentConfidence(0.2, 0.9) && passesAutoAssignmentConfidence(0.9, 0.9)]
  , ["missing document evidence lowers complexity confidence", scoreComplexity(applicationFixtures[0].input, extractEntities(applicationFixtures[0].input), {}).complexityConfidence < 0.75]
  , ["missing kind never falls back to filename", parseExtractions([{ fileName: "claim_record_1.pdf", mimeType: "application/pdf", fields: {}, provider: "stub" }])[0]?.kind === "other"]
  , ["reason formatter cannot retain a stale score", formatComplexityReason(8, 5, 10, []).startsWith("Score 8/10") && !formatComplexityReason(8, 5, 10, []).includes("Score 3")]
  , ["same-day dental visit has no false procedure-date contradiction", sameDayDentalQuality.contradictions.every((item) => item.code !== "PROCEDURE_OUTSIDE_SERVICE_PERIOD")]
  , ["successful extraction has no extraction failure code", claim3Quality.extractedEvidence.length > 0 && claim3Quality.semanticMatchScore >= 0.5 && claim3Quality.evaluatorConfidence >= 0.75 && !claim3Quality.reasonCodes.includes("EXTRACTION_FAILURE")]
  , ["same-day dental case remains low or medium complexity", sameDayDentalComplexity.score <= 7 && sameDayDentalComplexity.band !== "high"]
  , ["displayed document score matches score calculation", Math.min(10, Math.max(0, (claim3Quality.baseScore ?? 0) + claim3Quality.scoreBreakdown.filter((item) => /penalt|cap|adjustment/i.test(item.dimension)).reduce((sum, item) => sum + item.points, 0))) === claim3Quality.score]
  , ["switching to incomplete document removes prior surgical profile", afterRemovalAndIncomplete.documentQuality?.detectedMedicalProfile !== "Inpatient acute surgical claim" && !afterRemovalAndIncomplete.documentQuality?.extractedEvidence.some((item) => /General Surgery|appendix|appendectomy/i.test(item))]
  , ["switching to incomplete document removes prior complexity evidence", !afterRemovalAndIncomplete.complexity?.complexityEvidence.some((item) => /surgery|hospital|operative|intravenous/i.test(item))]
  , ["switching back to complete document restores its own evaluation", switchingCompleteAgain.documentQuality?.detectedMedicalProfile === "Inpatient acute surgical claim" && switchingCompleteAgain.documentQuality?.validationStatus === "PASSED"]
  , ["same file content is reproducible across sessions", switchingSurgical[0].sourceFileHash === sameFileAgain[0].sourceFileHash && JSON.stringify(switchingSurgical[0].fields) === JSON.stringify(sameFileAgain[0].fields) && afterSurgical.documentQuality?.score === switchingCompleteAgain.documentQuality?.score]
  , ["successful incomplete extraction does not emit extraction failure", !negativeQuality.reasonCodes.includes("EXTRACTION_FAILURE") && negativeQuality.reasonCodes.includes("DOCUMENT_EVIDENCE_INSUFFICIENT") && negativeQuality.reasonCodes.includes("MISSING_REQUIRED_FIELDS")]
  , ["negative statements do not create profile evidence", negativeQuality.detectedMedicalProfile === "Unclassified medical claim" && !negativeQuality.matchedEvidence.some((item) => /clinic|facility|infectious/i.test(item))]
  , ["semantic match below 50 percent produces unknown profile", negativeQuality.semanticMatchScore < 0.5 && negativeQuality.detectedMedicalProfile === "Unclassified medical claim" && negativeQuality.reasonCodes.includes("SEMANTIC_MATCH_BELOW_THRESHOLD")]
  , ["unavailable billing and supporting documents are missing", negativeQuality.fieldEvaluations.find((item) => item.label === "Supporting documents and billing consistency")?.status === "MISSING"]
  , ["negative clinical document keeps the expected low score", negativeQuality.score === 2.5 && negativeQuality.validationStatus === "FAILED" && negativeQuality.route === "POOL_QUEUE"]
  , ["generic symptoms do not create high-confidence specialties", negativeNer.specialtiesRequired.length === 0 && (negativeNer.possibleSpecialties ?? []).length === 0 && negativeNer.confidence <= 0.5]
  , ["low-quality document produces low complexity confidence", (negativeCase.complexity?.complexityConfidence ?? 1) <= 0.5]
  , ["document-quality Pool Queue is not underwriting escalation", negativeCase.status === "POOL_QUEUE" && negativeCase.decisionPath === "POOL_QUEUE" && negativeCase.assigneeId === null]
];
const badClaimChecks = claimChecks.filter(([, ok]) => !ok).map(([name]) => name);
if (badClaimChecks.length) {
  failed += 1;
  rows.push(`FAIL  document-quality smoke checks: ${badClaimChecks.join(", ")}`);
} else {
  rows.push("ok    document-quality smoke checks");
}

console.log(rows.join("\n"));
console.log(`\n${applicationFixtures.length - failed}/${applicationFixtures.length} fixtures matched their expected outcome.`);
process.exit(failed ? 1 : 0);
