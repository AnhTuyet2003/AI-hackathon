// Generates the supporting-document fixtures used to test the Document Ingestion Engine on the
// Submit page. Run:  node test/make-documents.mjs
// Output: test/fixtures/documents/*.pdf and *.txt
//
// File names match the offline-stub keywords in lib/document-ingest.ts (doctor / medical /
// financial / id- / application) so uploads work even with no GEMINI_API_KEY. With a key set,
// Gemini reads the real content. Each doc lines up with a request in test/fixtures/applications.ts.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "documents");
mkdirSync(OUT_DIR, { recursive: true });

// --- Minimal single-page PDF writer (Helvetica, text only, correct xref) -------------------------
function makePdf(lines) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const body = "BT\n/F1 11 Tf\n50 780 Td\n14 TL\n" + lines.map((l) => `(${esc(l)}) Tj T*`).join("\n") + "\nET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const DOCS = {
  "application-form.pdf": [
    "NEW BUSINESS APPLICATION FORM",
    "",
    "Applicant (Praemienzahler)",
    "  Vorname / first name .......  An",
    "  Name / surname ............  Nguyen Van",
    "  Anrede ...................  Herr",
    "  Geburtsdatum .............  1996-11-02   (Age 29)",
    "  Beruf / occupation .......  Software Engineer",
    "  Marital status ...........  single",
    "",
    "Product line ...............  Individual Life",
    "Sum Assured requested ......  USD 80,000",
    "CHF (brutto) annual earning   85,000",
    "",
    "Supporting documents attached: ID verification, health questionnaire."
  ],
  "id-verification.pdf": [
    "IDENTITY VERIFICATION RECORD",
    "",
    "Full name: Nguyen Van An",
    "Date of birth: 1996-11-02      Age: 29",
    "Marital status: Single",
    "Nationality: Vietnamese        Document: Passport (verified)",
    "Occupation on file: Software Engineer",
    "",
    "KYC check: PASSED. Address confirmed against a utility bill."
  ],
  "doctor-notes.pdf": [
    "SPRINGFIELD CARDIOLOGY ASSOCIATES - CLINICAL SUMMARY",
    "",
    "Patient: Tran Thi Bich          Date of birth: 1972-04-18   Age: 53",
    "Occupation: Restaurant Owner",
    "",
    "History:",
    "- Controlled hypertension since 2019, on Bisoprolol 5mg daily.",
    "- One prior Myocardial Infarction (anterior STEMI) in March 2023,",
    "  treated with primary PCI and a single drug-eluting stent.",
    "- No angina or hospital admission in the last 12 months.",
    "- Non-smoker. Alcohol: occasional. BMI 28.",
    "",
    "Current medication: Bisoprolol, Atorvastatin 40mg, Aspirin 100mg.",
    "",
    "Assessment: Stable ischaemic heart disease, well managed, adherent to therapy.",
    "Dr. A. Nguyen, Consultant Cardiologist"
  ],
  "medical-questionnaire.pdf": [
    "LIFE INSURANCE - HEALTH QUESTIONNAIRE",
    "",
    "Applicant: Dang Thi Thu           Age: 51        Sex: F",
    "Height: 164 cm    Weight: 79 kg    BMI: 29.4",
    "",
    "1. Do you smoke tobacco?                              NO",
    "2. Any diagnosed chronic condition?                   YES",
    "   -> Type 2 Diabetes, insulin-dependent, diagnosed 2016.",
    "      Last HbA1c 7.8%. Under endocrinology follow-up.",
    "3. Regular medication?                                YES (insulin, Metformin)",
    "4. Dangerous sports or hobbies?                       NO",
    "5. Foreign travel > 3 months in the next year?        NO",
    "",
    "Declared by the applicant as true and complete."
  ],
  "financial-statement.pdf": [
    "PERSONAL FINANCIAL STATEMENT (SUMMARY)",
    "",
    "Name: Dang Thi Thu             Prepared: 2026-08-30",
    "Employment: HR Director, Meridian Logistics Co.",
    "",
    "Gross annual income .......................  USD 145,000",
    "Liquid assets .............................  USD 210,000",
    "Total liabilities ........................   USD  60,000",
    "",
    "Requested Sum Assured ....................   USD 480,000",
    "Cover-to-income multiple .................   ~3.3x  (within guideline)",
    "",
    "Notes: Audited figures attached. No adverse credit history."
  ],
  "doctor-notes-oncology.pdf": [
    "REGIONAL ONCOLOGY CENTRE - FOLLOW-UP LETTER",
    "",
    "Patient: Vu Thi Mai             Age: 57",
    "Occupation: Business Consultant",
    "",
    "- Breast carcinoma, diagnosed 2019, treated with surgery + adjuvant chemotherapy.",
    "- Currently in remission. Annual oncology screening clear, most recent 2026-05.",
    "- No recurrence, no current oncology medication.",
    "- Non-smoker. BMI 24.",
    "",
    "Assessment: Stable, in long-term remission.",
    "Dr. P. Tran, Consultant Oncologist"
  ],
  "hnw-financial-dossier.pdf": [
    "HIGH-NET-WORTH FINANCIAL PROFILE",
    "",
    "Name: Le Hoang Minh            Age: 63",
    "Occupation: Offshore Drilling Supervisor",
    "",
    "Gross annual income .......................  USD 640,000",
    "Net worth (verified) .....................   USD 12,400,000",
    "Requested Sum Assured ....................   USD 1,800,000",
    "",
    "Purpose: estate planning + business succession.",
    "Requests HNW financial profiling review alongside medical underwriting."
  ]
};

for (const [name, lines] of Object.entries(DOCS)) {
  writeFileSync(join(OUT_DIR, name), makePdf(lines));
  writeFileSync(join(OUT_DIR, name.replace(/\.pdf$/, ".txt")), lines.join("\n"), "utf8");
}

console.log(`Wrote ${Object.keys(DOCS).length * 2} files to ${OUT_DIR}`);
