import type { EvidenceConfidence } from "./dto/knowledge-guidance";

/**
 * Grades overall knowledge guidance confidence from retrieval similarity
 * scores (0–1). Deterministic and safe: no model call, no chunk text.
 * This is the first typed field of the additive Knowledge guidance
 * migration; `recommendedActions` / `suggestedParts` follow with an
 * extraction step.
 */
export function deriveGuidanceConfidence(
  scores: Array<number | null | undefined>
): EvidenceConfidence {
  const topScore = scores.reduce<number>(
    (max, score) => (score != null && score > max ? score : max),
    0
  );
  if (topScore >= 0.8) return "high";
  if (topScore >= 0.55) return "medium";
  return "low";
}
