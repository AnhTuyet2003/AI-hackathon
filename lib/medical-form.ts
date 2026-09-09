import type { ExtractedFields } from "./types";

export const MEDICAL_LABELS: Partial<Record<keyof ExtractedFields, string>> = {
  patientName: "Patient name",
  policyNumber: "Policy number",
  dateOfBirth: "Date of birth",
  providerCode: "Provider code",
  facilityName: "Facility name",
  department: "Department",
  serviceStart: "Service start",
  serviceEnd: "Service end",
  procedureDate: "Procedure date",
  chiefComplaint: "Reason for care",
  symptoms: "Symptoms",
  relevantMedicalHistory: "Relevant medical history",
  physicalFindings: "Examination",
  vitalSigns: "Vital signs",
  investigations: "Investigations",
  testResults: "Test results",
  treatment: "Treatment",
  procedures: "Procedures",
  clinicalCourse: "Clinical course",
  diagnosis: "Diagnosis",
  diagnosisCode: "Diagnosis code",
  supportingDocuments: "Supporting documents",
  billingAmount: "Billed amount",
  eligibleAmount: "Eligible amount",
  insurerPayment: "Insurer payment",
  patientResponsibility: "Patient responsibility",
};
const entries = Object.entries(MEDICAL_LABELS).sort(
  (a, b) => b[1]!.length - a[1]!.length,
);
const pattern = entries.map(([, label]) => label).join("|");

export function parseMedicalText(text: string): ExtractedFields {
  const f: ExtractedFields = {};
  for (const [key, label] of entries) {
    const match = text.match(
      new RegExp(
        `(?:^|\\s)${label}:\\s*(.*?)(?=\\s+(?:${pattern}|Care setting):|$)`,
        "is",
      ),
    );
    if (!match) continue;
    const value = match[1].trim();
    if (
      [
        "billingAmount",
        "eligibleAmount",
        "insurerPayment",
        "patientResponsibility",
      ].includes(key)
    ) {
      if (/^-?\d[\d,]*(?:\.\d+)?$/.test(value))
        (f as Record<string, unknown>)[key] = Number(value.replace(/,/g, ""));
    } else (f as Record<string, unknown>)[key] = value;
  }
  return f;
}

export function medicalText(fields: ExtractedFields, setting: string) {
  return (
    `Synthetic medical evidence — mentor demo only.\nCare setting: ${setting}.\n` +
    entries
      .filter(([key]) => fields[key as keyof ExtractedFields] != null)
      .map(
        ([key, label]) => `${label}: ${fields[key as keyof ExtractedFields]}`,
      )
      .join("\n")
  );
}
