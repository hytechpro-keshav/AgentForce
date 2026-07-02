// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TriageConfidenceChart } from "@/components/TriageConfidenceChart";

const factors = [
  { id: "case_clarity", label: "Case clarity", weight: 30 },
  { id: "data_completeness", label: "Data completeness", weight: 25 },
  { id: "routing_certainty", label: "Routing certainty", weight: 25 },
  { id: "step_feasibility", label: "Step feasibility", weight: 20 }
];

describe("TriageConfidenceChart", () => {
  it("renders animated confidence chart with factor legend", () => {
    const { container } = render(
      <TriageConfidenceChart
        workflowConfidence={82}
        confidenceFactors={factors}
        humanInterventionRecommended={false}
      />
    );
    expect(screen.getByTestId("triage-confidence-chart")).toBeInTheDocument();
    expect(screen.getByTestId("triage-confidence-score")).toHaveTextContent("0%");
    expect(screen.getByTestId("triage-confidence-verdict")).toHaveTextContent(
      /AI can likely complete the workflow/i
    );
    expect(container.querySelectorAll("svg path").length).toBeGreaterThan(0);
    expect(screen.getByTestId("confidence-factor-case_clarity")).toBeInTheDocument();
  });

  it("does not reset score when parent re-renders during animation", async () => {
    const { rerender, container } = render(
      <TriageConfidenceChart
        workflowConfidence={82}
        confidenceFactors={factors}
        humanInterventionRecommended={false}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 350));
    const mid = Number.parseInt(
      within(container).getByTestId("triage-confidence-score").textContent ?? "0",
      10
    );

    rerender(
      <TriageConfidenceChart
        workflowConfidence={82}
        confidenceFactors={[...factors]}
        humanInterventionRecommended={false}
      />
    );

    const after = Number.parseInt(
      within(container).getByTestId("triage-confidence-score").textContent ?? "0",
      10
    );
    expect(after).toBeGreaterThanOrEqual(mid);
  });

  it("completes animation after parent re-renders with new factor array reference", async () => {
    const { rerender, container } = render(
      <TriageConfidenceChart
        workflowConfidence={85}
        confidenceFactors={factors}
        humanInterventionRecommended={false}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    rerender(
      <TriageConfidenceChart
        workflowConfidence={85}
        confidenceFactors={[...factors]}
        humanInterventionRecommended={false}
      />
    );

    await waitFor(
      () => {
        expect(
          within(container).getByTestId("triage-confidence-score")
        ).toHaveTextContent("85%");
      },
      { timeout: 3000 }
    );
  });

  it("shows human review verdict when intervention is recommended", () => {
    const { container } = render(
      <TriageConfidenceChart
        workflowConfidence={55}
        confidenceFactors={factors}
        humanInterventionRecommended
      />
    );
    expect(
      within(container).getByTestId("triage-confidence-verdict")
    ).toHaveTextContent(/Human review recommended/i);
  });
});
