import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResearcherBriefCard } from "@/components/research/ResearcherBriefCard";
import type { BriefPayload } from "@/lib/research/useResearcherBrief";

const fullBrief: BriefPayload = {
  category: "saas-landing",
  audienceCues: ["devs", "indie-hackers"],
  references: [
    {
      name: "Linear",
      url: "https://linear.app",
      why: "Crisp typography + restrained palette",
      sourceTier: "local-catalog",
      palettePreview: ["#5E6AD2", "#0E0F11", "#FFFFFF"],
      typographyPreview: { primary: "Inter", secondary: "JetBrains Mono" }
    },
    {
      name: "Stripe",
      url: "https://stripe.com",
      why: "Story-led product reveal",
      sourceTier: "web",
      palettePreview: ["#635BFF"],
      typographyPreview: { primary: "Inter" }
    }
  ],
  patternsThatWin: ["above-the-fold product screenshot", "split testimonial+logo strip"],
  patternsThatLose: ["wall-of-features grid"]
};

describe("ResearcherBriefCard", () => {
  it("renders the brief category in the summary", () => {
    render(<ResearcherBriefCard brief={fullBrief} ritualId="r-1" />);
    expect(screen.getByText("Researcher brief")).toBeInTheDocument();
    expect(screen.getByText("saas-landing")).toBeInTheDocument();
  });

  it("renders the unique palette swatches as accessible chips", () => {
    render(<ResearcherBriefCard brief={fullBrief} ritualId="r-1" />);
    const palette = screen.getByTestId("brief-palette");
    expect(palette.children).toHaveLength(4); // 3 from Linear + 1 from Stripe (no dupes)
    expect(screen.getByLabelText(/color swatch #5E6AD2/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/color swatch #635BFF/i)).toBeInTheDocument();
  });

  it("renders typography pairings (deduped by primary/secondary)", () => {
    render(<ResearcherBriefCard brief={fullBrief} ritualId="r-1" />);
    const list = screen.getByTestId("brief-typography");
    // Linear: Inter / JetBrains Mono. Stripe: Inter (no secondary). Two distinct pairs.
    expect(list.children).toHaveLength(2);
    expect(list).toHaveTextContent("Inter");
    expect(list).toHaveTextContent("JetBrains Mono");
  });

  it("renders winning + losing patterns in two distinct lists", () => {
    render(<ResearcherBriefCard brief={fullBrief} ritualId="r-1" />);
    expect(screen.getByText("Patterns that win")).toBeInTheDocument();
    expect(screen.getByText("Patterns that lose")).toBeInTheDocument();
    expect(screen.getByTestId("brief-patterns-win").children).toHaveLength(2);
    expect(screen.getByTestId("brief-patterns-lose").children).toHaveLength(1);
  });

  it("links each reference's name to its url with safe rel attributes", () => {
    render(<ResearcherBriefCard brief={fullBrief} ritualId="r-1" />);
    const link = screen.getByRole("link", { name: "Linear" });
    expect(link).toHaveAttribute("href", "https://linear.app");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("propagates the ritualId via data-ritual-id for parent keying", () => {
    render(<ResearcherBriefCard brief={fullBrief} ritualId="r-1" />);
    expect(screen.getByTestId("researcher-brief-card")).toHaveAttribute("data-ritual-id", "r-1");
  });

  it("gracefully handles a sparse brief with no references / palette / typography", () => {
    const minimal: BriefPayload = {
      category: "docs-site",
      audienceCues: [],
      references: [],
      patternsThatWin: [],
      patternsThatLose: []
    };
    render(<ResearcherBriefCard brief={minimal} ritualId="r-2" />);
    expect(screen.getByText("docs-site")).toBeInTheDocument();
    expect(screen.queryByTestId("brief-palette")).not.toBeInTheDocument();
    expect(screen.queryByTestId("brief-typography")).not.toBeInTheDocument();
    expect(screen.queryByTestId("brief-references")).not.toBeInTheDocument();
  });

  it("shows the source-tier badge for each reference", () => {
    render(<ResearcherBriefCard brief={fullBrief} ritualId="r-1" />);
    expect(screen.getByText("local-catalog")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
  });
});
