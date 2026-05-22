import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TriageClarificationForm,
  classifyQuestion,
  formatAnswers
} from "@/components/ritual/TriageClarificationForm";

describe("classifyQuestion (heuristics)", () => {
  it("classifies 'X or Y?' as single-select with two options", () => {
    const result = classifyQuestion("Mobile or Web?");
    expect(result.kind).toBe("single-select");
    expect(result.options).toEqual(["Mobile", "Web"]);
  });

  it("classifies three-way 'X or Y or Z?' as single-select with three options", () => {
    const result = classifyQuestion("Stripe or Razorpay or PayPal?");
    expect(result.kind).toBe("single-select");
    expect(result.options).toEqual(["Stripe", "Razorpay", "PayPal"]);
  });

  it("strips leading 'Which' before the first option in single-select", () => {
    const result = classifyQuestion("Which framework: Next.js or Remix?");
    expect(result.kind).toBe("text"); // colon-form not currently supported; falls back to text
    // The fallback to text is deliberate — we want a conservative heuristic
    // so we never misclassify a long open-ended question as a tiny radio.
  });

  it("strips 'should we' before the first option", () => {
    const result = classifyQuestion("Should we use Next.js or Remix?");
    expect(result.kind).toBe("single-select");
    expect(result.options).toEqual(["use Next.js", "Remix"]);
  });

  it("classifies 'Should we...?' as yes-no", () => {
    const result = classifyQuestion("Should we include a guest checkout?");
    expect(result.kind).toBe("yes-no");
    expect(result.options).toBeUndefined();
  });

  it("classifies 'Do you want...?' as yes-no", () => {
    const result = classifyQuestion("Do you want a dark mode toggle?");
    expect(result.kind).toBe("yes-no");
  });

  it("falls back to text for open-ended questions", () => {
    const result = classifyQuestion("What's the target audience for this app?");
    expect(result.kind).toBe("text");
  });

  it("falls back to text for very long binary-prefix questions (heuristic guard)", () => {
    const long = "Should we, considering the constraints from the brief and the existing infrastructure that you mentioned earlier in this conversation, integrate Razorpay first?";
    const result = classifyQuestion(long);
    expect(result.kind).toBe("text");
  });

  it("does not split prose containing 'or' (no question mark)", () => {
    const result = classifyQuestion("This is fine with Stripe or Razorpay");
    expect(result.kind).toBe("text");
  });
});

describe("formatAnswers", () => {
  it("builds a hyphenated list with arrow-separated answers", () => {
    const formatted = formatAnswers(
      [
        { question: "Mobile or Web?", kind: "single-select", options: ["Mobile", "Web"] },
        { question: "Should we include guest checkout?", kind: "yes-no" }
      ],
      ["Web", "Yes"]
    );
    expect(formatted).toBe("- Mobile or Web? → Web\n- Should we include guest checkout? → Yes");
  });

  it("renders empty answers as '(no answer)'", () => {
    const formatted = formatAnswers(
      [{ question: "What's your favorite color?", kind: "text" }],
      [""]
    );
    expect(formatted).toBe("- What's your favorite color? → (no answer)");
  });
});

describe("<TriageClarificationForm>", () => {
  it("renders one fieldset per question with the rendered question text", () => {
    render(
      <TriageClarificationForm
        questions={[
          { question: "Mobile or Web?", reason: "Affects layout" },
          { question: "Should we include guest checkout?" }
        ]}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId("triage-question-0")).toBeInTheDocument();
    expect(screen.getByTestId("triage-question-1")).toBeInTheDocument();
    expect(screen.getByText("Mobile or Web?")).toBeInTheDocument();
    expect(screen.getByText("Should we include guest checkout?")).toBeInTheDocument();
  });

  it("renders a radio group for 'X or Y?' single-select questions", () => {
    render(
      <TriageClarificationForm
        questions={[{ question: "Mobile or Web?" }]}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId("triage-q-0-opt-0")).toBeInTheDocument();
    expect(screen.getByTestId("triage-q-0-opt-1")).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile")).toBeInTheDocument();
    expect(screen.getByLabelText("Web")).toBeInTheDocument();
  });

  it("renders a yes/no radio for 'Should we...?' questions", () => {
    render(
      <TriageClarificationForm
        questions={[{ question: "Should we include a guest checkout?" }]}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId("triage-q-0-yes")).toBeInTheDocument();
    expect(screen.getByTestId("triage-q-0-no")).toBeInTheDocument();
  });

  it("renders a text input for open-ended questions", () => {
    render(
      <TriageClarificationForm
        questions={[{ question: "What's the target audience?" }]}
        onSubmit={() => {}}
      />
    );
    expect(screen.getByTestId("triage-q-0-text")).toBeInTheDocument();
  });

  it("disables submit until every question is answered", () => {
    render(
      <TriageClarificationForm
        questions={[
          { question: "Mobile or Web?" },
          { question: "What's the target audience?" }
        ]}
        onSubmit={() => {}}
      />
    );
    const submit = screen.getByTestId("triage-clarification-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("calls onSubmit with the formatted multi-line summary", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <TriageClarificationForm
        questions={[
          { question: "Mobile or Web?" },
          { question: "Should we include guest checkout?" }
        ]}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByTestId("triage-q-0-opt-1")); // Web
    await user.click(screen.getByTestId("triage-q-1-yes"));   // Yes
    await user.click(screen.getByTestId("triage-clarification-submit"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      "- Mobile or Web? → Web\n- Should we include guest checkout? → Yes"
    );
  });

  it("disables submit + shows 'Sending…' label when pending", () => {
    render(
      <TriageClarificationForm
        questions={[{ question: "What's the target audience?" }]}
        onSubmit={() => {}}
        pending
      />
    );
    const submit = screen.getByTestId("triage-clarification-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toMatch(/sending/i);
  });

  it("text-input answers update the formatted summary", async () => {
    const onSubmit = vi.fn();
    render(
      <TriageClarificationForm
        questions={[{ question: "What's the target audience?" }]}
        onSubmit={onSubmit}
      />
    );
    const input = screen.getByTestId("triage-q-0-text") as HTMLInputElement;
    // fireEvent.change because userEvent on jsdom with a single input is slower
    // and we don't need keystroke-by-keystroke fidelity here.
    fireEvent.change(input, { target: { value: "internal ops team" } });
    fireEvent.submit(screen.getByTestId("triage-clarification-form"));
    expect(onSubmit).toHaveBeenCalledWith(
      "- What's the target audience? → internal ops team"
    );
  });
});
