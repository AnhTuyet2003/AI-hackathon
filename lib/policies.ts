import { queueLoadCapByTier } from "./underwriters";
import type {
  ComplexityResult,
  NERResult,
  PolicyCheck,
  Underwriter,
  UnderwriterEvaluation,
} from "./types";

// The 8 named policies from the module proposal (Section 3, Component C / Section 4 build spec),
// implemented as plain TypeScript functions driven by declarative config -- the "policy-as-code"
// spirit of Claims-Triage-AI's OPA-based RouterAgent, without adding a second runtime.

function checkAuthorityLimit(uw: Underwriter, sumAssured: number): PolicyCheck {
  const passed = uw.authorityLimit === null || uw.authorityLimit >= sumAssured;
  return {
    policy: "Authority Limit",
    passed,
    detail: passed
      ? `${uw.name}'s authority (${uw.authorityLimit === null ? "Unlimited" : `$${uw.authorityLimit.toLocaleString("en-US")}`}) covers Sum Assured $${sumAssured.toLocaleString("en-US")}.`
      : `${uw.name}'s authority limit ($${uw.authorityLimit?.toLocaleString("en-US")}) is below Sum Assured ($${sumAssured.toLocaleString("en-US")}).`,
  };
}

function checkSpecialization(
  uw: Underwriter,
  specialtiesRequired: string[],
): PolicyCheck {
  if (specialtiesRequired.length === 0) {
    return {
      policy: "Specialization",
      passed: true,
      detail: "No specialist domain required for this case.",
    };
  }
  const matched = specialtiesRequired.filter((s) =>
    uw.specializationTags.includes(s),
  );
  const passed = matched.length === specialtiesRequired.length;
  return {
    policy: "Specialization",
    passed,
    detail: passed
      ? `Matches required specialty: ${matched.join(", ")}.`
      : `Does not cover required specialty: ${specialtiesRequired.join(", ")}.`,
  };
}

function checkStpEligibility(band: ComplexityResult["band"]): PolicyCheck {
  // Informational only: STP vs Manual is decided from the complexity band at the orchestration
  // level (lib/pipeline.ts), this just documents that decision for the audit trail.
  return {
    policy: "STP Eligibility",
    passed: true,
    detail:
      band === "low"
        ? "Score 1-3: case is a Straight-Through-Processing candidate."
        : `Score band "${band}": requires manual underwriter review.`,
  };
}

function checkWorkloadBalancing(uw: Underwriter): PolicyCheck {
  const cap = queueLoadCapByTier[uw.tier];
  const passed = uw.currentQueueLoad < cap;
  return {
    policy: "Workload Balancing",
    passed,
    detail: passed
      ? `Queue depth ${uw.currentQueueLoad}/${cap} (${uw.tier} cap) -- capacity available.`
      : `Queue depth ${uw.currentQueueLoad}/${cap} (${uw.tier} cap) -- at or over capacity.`,
  };
}

function checkSlaPriority(uw: Underwriter): PolicyCheck {
  // Informational: SLA remaining is used as a ranking tiebreaker in the Optimization Node,
  // not a hard filter, but is always logged for explainability.
  return {
    policy: "SLA Priority",
    passed: true,
    detail: `Average SLA time remaining across ${uw.name}'s queue: ${uw.slaMinutesRemainingAvg} min.`,
  };
}

function checkAvailability(uw: Underwriter): PolicyCheck {
  const passed = uw.availability === "active";
  return {
    policy: "Availability",
    passed,
    detail: passed
      ? `${uw.name} is Active.`
      : `${uw.name} is ${uw.availability === "dnd" ? "In Meeting (DND)" : "Offline"}.`,
  };
}

function checkBiasFairness(): PolicyCheck {
  // Demographic fields (zip code, nationality, ...) are never collected in the case model that
  // reaches this matching stage -- this policy documents that guardrail explicitly for auditors.
  return {
    policy: "Bias & Fairness Guardrail",
    passed: true,
    detail:
      "Demographic fields (zip code, nationality) are stripped before allocation; decision is based only on risk, skill, and workload.",
  };
}

export function evaluateUnderwriter(
  uw: Underwriter,
  sumAssured: number,
  ner: NERResult,
  complexity: ComplexityResult,
): UnderwriterEvaluation {
  const policies = [
    checkAuthorityLimit(uw, sumAssured),
    checkSpecialization(uw, ner.specialtiesRequired),
    checkStpEligibility(complexity.band),
    checkWorkloadBalancing(uw),
    checkSlaPriority(uw),
    checkAvailability(uw),
    checkBiasFairness(),
  ];

  // Hard-gating policies (Escalation Policy, #8, is evaluated separately at the orchestration level
  // once every underwriter's eligibility here is known).
  const gating = [
    "Authority Limit",
    "Specialization",
    "Workload Balancing",
    "Availability",
  ];
  const eligible = policies
    .filter((p) => gating.includes(p.policy))
    .every((p) => p.passed);

  return { underwriterId: uw.id, policies, eligible, matchRank: 0 };
}
