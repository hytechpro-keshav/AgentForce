"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import * as d3 from "d3";

import type { TriagePriorityFactor } from "@/lib/orchestration";

import styles from "./SteppedOrchestrationView.module.css";

const SEGMENT_COLORS = [
  "#15803d",
  "#16a34a",
  "#22c55e",
  "#4ade80",
  "#86efac",
  "#166534",
  "#14532d",
  "#052e16"
];

const ANIMATION_MS = 900;

interface TriageConfidenceChartProps {
  workflowConfidence: number;
  confidenceFactors?: TriagePriorityFactor[];
  humanInterventionRecommended?: boolean;
}

function confidenceTone(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function factorsSignature(factors: TriagePriorityFactor[]): string {
  return factors.map((factor) => `${factor.id}:${factor.weight}`).join("|");
}

function gaugeFill(tone: "high" | "medium" | "low"): string {
  if (tone === "high") return "#16a34a";
  if (tone === "medium") return "#d97706";
  return "#dc2626";
}

function drawConfidenceChart(
  svgElement: SVGSVGElement,
  options: {
    workflowConfidence: number;
    confidenceFactors: TriagePriorityFactor[];
    tone: "high" | "medium" | "low";
    animate: boolean;
  }
): void {
  const { workflowConfidence, confidenceFactors, tone, animate } = options;
  const showFactors = confidenceFactors.length >= 2;
  const svg = d3.select(svgElement);
  svg.selectAll("*").interrupt();
  svg.selectAll("*").remove();

  const size = 112;
  const radius = size / 2;
  const innerRadius = radius - 18;

  const pie = d3
    .pie<TriagePriorityFactor>()
    .value((datum) => datum.weight)
    .sort(null);

  const arc = d3
    .arc<d3.PieArcDatum<TriagePriorityFactor>>()
    .innerRadius(innerRadius)
    .outerRadius(radius - 4);

  const group = svg
    .attr("viewBox", `0 0 ${size} ${size}`)
    .append("g")
    .attr("transform", `translate(${radius}, ${radius})`);

  if (showFactors) {
    const slices = pie(confidenceFactors);
    group
      .selectAll("path")
      .data(slices)
      .enter()
      .append("path")
      .attr("fill", (_, index) => SEGMENT_COLORS[index % SEGMENT_COLORS.length])
      .attr("stroke", "#fbfbfa")
      .attr("stroke-width", 1.5)
      .each(function (datum) {
        const element = this as SVGPathElement & {
          _current?: d3.PieArcDatum<TriagePriorityFactor>;
        };
        element._current = animate
          ? { ...datum, startAngle: datum.startAngle, endAngle: datum.startAngle }
          : datum;
      })
      .attr("d", (datum) => arc(datum) ?? "")
      .filter(function () {
        return animate;
      })
      .transition()
      .duration(ANIMATION_MS)
      .delay((_, index) => index * 120)
      .attrTween("d", function (datum) {
        const element = this as SVGPathElement & {
          _current: d3.PieArcDatum<TriagePriorityFactor>;
        };
        const interpolate = d3.interpolate(element._current, datum);
        return (t) => {
          const value = interpolate(t);
          element._current = value;
          return arc(value) ?? "";
        };
      });
    return;
  }

  const track = d3.arc().innerRadius(innerRadius).outerRadius(radius - 4);
  group
    .append("path")
    .attr(
      "d",
      track({ startAngle: 0, endAngle: Math.PI * 2 } as d3.DefaultArcObject)
    )
    .attr("fill", "#e8e8e4");

  const valueArc = d3
    .arc<d3.DefaultArcObject>()
    .innerRadius(innerRadius)
    .outerRadius(radius - 4)
    .startAngle(0);

  const targetEnd = (workflowConfidence / 100) * Math.PI * 2;
  const arcDatum: d3.DefaultArcObject = {
    innerRadius,
    outerRadius: radius - 4,
    startAngle: 0,
    endAngle: animate ? 0 : targetEnd
  };

  const valuePath = group
    .append("path")
    .attr("fill", gaugeFill(tone))
    .datum(arcDatum)
    .attr("d", (datum) => valueArc.endAngle(datum.endAngle)(datum) ?? "");

  if (animate) {
    valuePath
      .transition()
      .duration(ANIMATION_MS)
      .attrTween("d", function (datum) {
        const element = this as SVGPathElement & { _current: d3.DefaultArcObject };
        element._current = { ...datum, endAngle: 0 };
        const target = { ...datum, endAngle: targetEnd };
        const interpolate = d3.interpolate(element._current, target);
        return (t) => {
          const value = interpolate(t);
          element._current = value;
          return valueArc.endAngle(value.endAngle)(value) ?? "";
        };
      });
  }
}

export function TriageConfidenceChart({
  workflowConfidence,
  confidenceFactors = [],
  humanInterventionRecommended
}: TriageConfidenceChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const animatedSignatureRef = useRef<string | null>(null);
  const [displayScore, setDisplayScore] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const tone = confidenceTone(workflowConfidence);
  const showFactors = confidenceFactors.length >= 2;
  const chartSignature = useMemo(
    () => `${workflowConfidence}:${factorsSignature(confidenceFactors)}`,
    [workflowConfidence, confidenceFactors]
  );

  const verdict =
    humanInterventionRecommended ?? workflowConfidence < 70
      ? "Human review recommended before advancing"
      : "AI can likely complete the workflow";

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const shouldAnimate = animatedSignatureRef.current !== chartSignature;
    if (shouldAnimate) {
      animatedSignatureRef.current = chartSignature;
    }

    drawConfidenceChart(svgElement, {
      workflowConfidence,
      confidenceFactors,
      tone,
      animate: shouldAnimate
    });

    if (!shouldAnimate) {
      setDisplayScore(workflowConfidence);
      setRevealed(true);
      return;
    }

    setDisplayScore(0);
    setRevealed(false);
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / ANIMATION_MS);
      setDisplayScore(Math.round(workflowConfidence * progress));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setRevealed(true);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      d3.select(svgElement).selectAll("*").interrupt();
    };
  }, [chartSignature, confidenceFactors, tone, workflowConfidence]);

  return (
    <div
      className={clsx(
        styles.confidenceBlock,
        revealed ? styles.confidenceBlockSettled : styles.confidenceBlockEnter
      )}
      data-testid="triage-confidence-chart"
    >
      <div className={styles.confidenceHeader}>
        <div className={styles.confidenceTitle}>AI workflow confidence</div>
        <div
          className={clsx(
            styles.confidenceVerdict,
            tone === "high" && styles.confidenceVerdictHigh,
            tone === "medium" && styles.confidenceVerdictMedium,
            tone === "low" && styles.confidenceVerdictLow
          )}
          data-testid="triage-confidence-verdict"
        >
          {verdict}
        </div>
      </div>
      <div className={styles.donutWrap}>
        <div className={styles.confidenceGauge}>
          <svg
            ref={svgRef}
            className={styles.donutSvg}
            role="img"
            aria-label={`AI workflow confidence ${workflowConfidence}%`}
          />
          <div
            className={clsx(
              styles.confidenceScore,
              tone === "high" && styles.confidenceScoreHigh,
              tone === "medium" && styles.confidenceScoreMedium,
              tone === "low" && styles.confidenceScoreLow
            )}
            data-testid="triage-confidence-score"
          >
            {displayScore}%
          </div>
        </div>
        {showFactors ? (
          <ul className={styles.donutLegend} aria-hidden="true">
            {confidenceFactors.map((factor, index) => (
              <li key={factor.id} data-testid={`confidence-factor-${factor.id}`}>
                <span
                  className={clsx(
                    styles.donutSwatch,
                    styles[`confidenceSwatch${index % SEGMENT_COLORS.length}` as keyof typeof styles]
                  )}
                />
                <span className={styles.donutLabel}>
                  {factor.label} {factor.weight}%
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
