import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import NewProjectPage from "@/app/projects/new/page";

describe("NewProjectPage form (Server Component)", () => {
  it("renders a form with a required `name` input and a submit button", () => {
    render(<NewProjectPage />);

    const heading = screen.getByRole("heading", { name: /new project/i });
    expect(heading).toBeInTheDocument();

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input).toHaveAttribute("name", "name");
    expect(input).toBeRequired();

    const submit = screen.getByRole("button", { name: /create/i });
    expect(submit).toBeInTheDocument();
    expect(submit).toHaveAttribute("type", "submit");
  });
});
