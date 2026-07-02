"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";

import type { TriagePriorityFactor } from "@/lib/orchestration";

import styles from "./SteppedOrchestrationView.module.css";

const SEGMENT_COLORS = [
  "#111111",
  "#b45309",
  "#d97706",
  "#6f6f6b",
  "#a2a29d",
  "#bcbcb6",
  "#141414",
  "#92400e"
];

interface TriagePriorityDonutProps {
  factors: TriagePriorityFactor[];
}

export function TriagePriorityDonut({ factors }: TriagePriorityDonutProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
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

    group
      .selectAll("path")
      .data(pie(factors))
      .enter()
      .append("path")
      .attr("d", arc)
      .attr("fill", (_, index) => SEGMENT_COLORS[index % SEGMENT_COLORS.length])
      .attr("stroke", "#fbfbfa")
      .attr("stroke-width", 1.5);
  }, [factors]);

  return (
    <div className={styles.donutWrap} data-testid="triage-priority-donut">
      <svg
        ref={svgRef}
        className={styles.donutSvg}
        role="img"
        aria-label={`Priority factor mix: ${factors
          .map((factor) => `${factor.label} ${factor.weight}%`)
          .join(", ")}`}
      />
      <ul className={styles.donutLegend} aria-hidden="true">
        {factors.map((factor, index) => (
          <li key={factor.id} data-testid={`donut-factor-${factor.id}`}>
            <span
              className={styles.donutSwatch}
              style={{
                background: SEGMENT_COLORS[index % SEGMENT_COLORS.length]
              }}
            />
            <span className={styles.donutLabel}>
              {factor.label} {factor.weight}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
