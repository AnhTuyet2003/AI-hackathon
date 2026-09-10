import type { Underwriter } from "./types";

export const defaultUnderwriters: Underwriter[] = [
  {
    id: "UW-JDOE",
    name: "John Doe",
    tier: "Junior",
    authorityLimit: 100_000,
    specializationTags: ["Standard", "Accidental"],
    currentQueueLoad: 3,
    slaMinutesRemainingAvg: 600,
    availability: "active",
    careGroup: "Outpatient",
  },
  {
    id: "UW-TBECKER",
    name: "Tom Becker",
    tier: "Junior",
    authorityLimit: 150_000,
    specializationTags: ["Standard", "Accidental"],
    currentQueueLoad: 1,
    slaMinutesRemainingAvg: 700,
    availability: "active",
    careGroup: "Inpatient",
  },
  {
    id: "UW-SJENKINS",
    name: "Sarah Jenkins",
    tier: "Senior",
    authorityLimit: 1_000_000,
    specializationTags: ["Cardiology", "Oncology", "Standard"],
    currentQueueLoad: 8,
    slaMinutesRemainingAvg: 120,
    availability: "active",
    careGroup: "Outpatient",
  },
  {
    id: "UW-PNAIR",
    name: "Priya Nair",
    tier: "Senior",
    authorityLimit: 750_000,
    specializationTags: ["Endocrinology", "Standard"],
    currentQueueLoad: 4,
    slaMinutesRemainingAvg: 240,
    availability: "active",
    careGroup: "Inpatient",
  },
  {
    id: "UW-AMINH",
    name: "Dr. Alex Minh",
    tier: "Medical",
    authorityLimit: null,
    specializationTags: ["Complex Medical", "Liver"],
    currentQueueLoad: 2,
    slaMinutesRemainingAvg: 90,
    availability: "dnd",
    careGroup: "Inpatient",
  },
  {
    id: "UW-LPHAM",
    name: "Dr. Lan Pham",
    tier: "Medical",
    authorityLimit: null,
    specializationTags: ["Complex Medical", "Cardiology", "Oncology"],
    currentQueueLoad: 11,
    slaMinutesRemainingAvg: 45,
    availability: "active",
    careGroup: "Outpatient",
  },
  {
    id: "UW-DKHANH",
    name: "Dr. Do Khanh",
    tier: "Medical",
    authorityLimit: 1_500_000,
    specializationTags: [
      "Complex Medical",
      "Endocrinology",
      "Liver",
      "General Surgery",
      "Pulmonology",
      "Dental",
    ],
    currentQueueLoad: 3,
    slaMinutesRemainingAvg: 110,
    availability: "active",
    careGroup: "Dental",
  },
  {
    id: "UW-MTHAO",
    name: "Mai Thao",
    tier: "Senior",
    authorityLimit: 600_000,
    specializationTags: ["Cardiology", "Standard"],
    currentQueueLoad: 2,
    slaMinutesRemainingAvg: 200,
    availability: "active",
    careGroup: "Outpatient",
  },
  {
    id: "UW-RGUPTA",
    name: "Ravi Gupta",
    tier: "Junior",
    authorityLimit: 120_000,
    specializationTags: ["Standard", "Accidental"],
    currentQueueLoad: 4,
    slaMinutesRemainingAvg: 520,
    availability: "active",
    careGroup: "Dental",
  },
];

// Workload cap per tier used by the Workload Balancing policy (Filter Node).
export const queueLoadCapByTier: Record<Underwriter["tier"], number> = {
  Junior: 6,
  Senior: 10,
  Medical: 8,
};

const UW_KEY = "ai-ud-underwriters-v1";

export function getUnderwriters(): Underwriter[] {
  if (typeof window === "undefined") return defaultUnderwriters;
  const saved = window.localStorage.getItem(UW_KEY);
  if (!saved) {
    window.localStorage.setItem(UW_KEY, JSON.stringify(defaultUnderwriters));
    return defaultUnderwriters;
  }
  try {
    const parsed = JSON.parse(saved) as Underwriter[];
    return Array.isArray(parsed) ? parsed : defaultUnderwriters;
  } catch {
    return defaultUnderwriters;
  }
}

export function saveUnderwriters(uws: Underwriter[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(UW_KEY, JSON.stringify(uws));
  }
}
