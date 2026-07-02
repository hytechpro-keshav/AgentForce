// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TriagePriorityDonut } from "@/components/TriagePriorityDonut";

const factors = [
  { id: "customer_risk", label: "Customer risk", weight: 40 },
  { id: "case_urgency", label: "Case urgency", weight: 35 },
  { id: "repeat_pattern", label: "Repeat pattern", weight: 25 }
];

describe("TriagePriorityDonut", () => {
  it("renders one SVG segment per factor", () => {
    const { container } = render(<TriagePriorityDonut factors={factors} />);
    expect(container.querySelectorAll("svg path")).toHaveLength(factors.length);
    expect(screen.getByTestId("donut-factor-customer_risk")).toBeInTheDocument();
    expect(screen.getByTestId("donut-factor-case_urgency")).toBeInTheDocument();
    expect(screen.getByTestId("donut-factor-repeat_pattern")).toBeInTheDocument();
  });
});
