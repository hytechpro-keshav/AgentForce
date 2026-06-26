"use client";

import clsx from "clsx";

import { TriagePriorityDonut } from "@/components/TriagePriorityDonut";
import type { SteppedTriageInsight, TriageBadgeTone } from "@/lib/stepped-view-model";

import styles from "./SteppedOrchestrationView.module.css";

interface TriageInsightCardProps {
  insight: SteppedTriageInsight;
}

function badgeClass(tone: TriageBadgeTone): string {
  switch (tone) {
    case "critical":
      return styles.insightBadgeCritical;
    case "high":
      return styles.insightBadgeHigh;
    case "low":
      return styles.insightBadgeLow;
    case "mediumRisk":
      return styles.insightBadgeMediumRisk;
    case "highRisk":
      return styles.insightBadgeHighRisk;
    case "repeatYes":
      return styles.insightBadgeRepeat;
    default:
      return styles.insightBadgeNormal;
  }
}

export function TriageInsightCard({ insight }: TriageInsightCardProps) {
  const showDonut =
    insight.priorityFactors && insight.priorityFactors.length >= 2;

  return (
    <section className={styles.insightStrip} aria-label="Triage priority insight">
      <div className={styles.insightBadges}>
        {insight.badges.map((badge) => (
          <span
            key={badge.label}
            className={clsx(styles.insightBadge, badgeClass(badge.tone))}
            data-testid={`priority-badge-${badge.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {badge.label}
          </span>
        ))}
      </div>

      <div className={styles.insightBody}>
        <div className={styles.insightCopy}>
          <div className={styles.insightHeading}>Why this priority (AI)</div>
          {insight.priorityRationale ? (
            <p
              className={styles.insightRationale}
              data-testid="triage-insight-rationale"
            >
              {insight.priorityRationale}
            </p>
          ) : (
            <p className={styles.insightRationaleMuted}>
              Priority rationale not available for this run.
            </p>
          )}
          <p className={styles.insightSummary}>{insight.summary}</p>
        </div>

        {showDonut ? (
          <div className={styles.insightChart}>
            <div className={styles.insightChartTitle}>Priority mix</div>
            <TriagePriorityDonut factors={insight.priorityFactors!} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
