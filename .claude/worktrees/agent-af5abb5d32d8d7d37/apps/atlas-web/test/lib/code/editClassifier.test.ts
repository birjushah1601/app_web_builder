import { describe, it, expect } from "vitest";
import { classifyEdit } from "../../../lib/code/editClassifier";

describe("classifyEdit", () => {
  it("returns cosmetic for a Tailwind class-only change in a .tsx file", () => {
    const result = classifyEdit({
      filePath: "components/Button.tsx",
      oldContent: '<button className="bg-blue-500 text-white">Click</button>',
      newContent: '<button className="bg-green-600 text-white font-bold">Click</button>',
    });
    expect(result).toBe("cosmetic");
  });

  it("returns structural when a new import is added", () => {
    const result = classifyEdit({
      filePath: "components/Form.tsx",
      oldContent: 'export function Form() { return <form />; }',
      newContent: 'import { useState } from "react";\nexport function Form() { return <form />; }',
    });
    expect(result).toBe("structural");
  });

  it("returns structural when a function signature changes", () => {
    const result = classifyEdit({
      filePath: "lib/api.ts",
      oldContent: 'export function fetchUser(id: string) {}',
      newContent: 'export function fetchUser(id: string, opts?: RequestInit) {}',
    });
    expect(result).toBe("structural");
  });

  it("returns cosmetic for a single-line copy change in an .md file", () => {
    const result = classifyEdit({
      filePath: "README.md",
      oldContent: "# My App\nWelcome.",
      newContent: "# My App\nWelcome to the platform.",
    });
    expect(result).toBe("cosmetic");
  });

  it("returns structural for a .json change (config files always structural)", () => {
    const result = classifyEdit({
      filePath: "package.json",
      oldContent: '{"version":"1.0.0"}',
      newContent: '{"version":"1.1.0"}',
    });
    expect(result).toBe("structural");
  });

  it("returns structural when linesChanged exceeds 50", () => {
    const longOld = Array.from({ length: 10 }, (_, i) => `const x${i} = ${i};`).join("\n");
    const longNew = Array.from({ length: 80 }, (_, i) => `const y${i} = ${i};`).join("\n");
    const result = classifyEdit({ filePath: "src/big.ts", oldContent: longOld, newContent: longNew });
    expect(result).toBe("structural");
  });

  it("returns cosmetic for a whitespace-only change", () => {
    const result = classifyEdit({
      filePath: "src/utils.ts",
      oldContent: 'export const add = (a: number, b: number) => a + b;',
      newContent: 'export const add = ( a: number, b: number ) => a + b;',
    });
    expect(result).toBe("cosmetic");
  });
});
