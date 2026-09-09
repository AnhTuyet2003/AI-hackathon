import type { Underwriter } from "./types";

// Sample Underwriter Registry, seeded from the AI-UD module proposal (Section 3, Component C)
// plus extra staff so all three demo scenarios (STP / specialist match / escalation) are reachable.
export const underwriterRegistry: Underwriter[] = [
  {
    id: "UW-JDOE",
    name: "John Doe",
    tier: "Junior",
    authorityLimit: 100_000,
    specializationTags: ["Standard", "Accidental"],
    currentQueueLoad: 3,
    slaMinutesRemainingAvg: 600,
    availability: "active",
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
  },
  // Added so the Medical tier can actually receive an assignment: Dr. Alex Minh is DND and
  // Dr. Lan Pham is permanently over the Medical queue cap, which previously forced every
  // Complex Medical case into the Pool Queue. Dr. Do Khanh has a high but finite authority
  // limit, so catastrophic-Sum-Assured cases still escalate.
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
  },
];

// Workload cap per tier used by the Workload Balancing policy (Filter Node).
export const queueLoadCapByTier: Record<Underwriter["tier"], number> = {
  Junior: 6,
  Senior: 10,
  Medical: 8,
};
