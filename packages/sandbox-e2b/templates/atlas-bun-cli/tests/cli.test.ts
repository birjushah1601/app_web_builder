import { describe, it, expect } from "bun:test";
import { buildProgram } from "../src/cli";

describe("atlas CLI — Commander parsing", () => {
  it("registers a `hello` subcommand", () => {
    const program = buildProgram();
    expect(program.commands.find((c) => c.name() === "hello")).toBeDefined();
  });

  it("hello subcommand has metadata", () => {
    const program = buildProgram();
    const hello = program.commands.find((c) => c.name() === "hello");
    expect(hello).toBeDefined();
    expect(hello!.description()).toMatch(/greet/i);
  });

  it("program metadata is populated", () => {
    const program = buildProgram();
    expect(program.name()).toBe("atlas");
    expect(program.version()).toBe("0.1.0");
    expect(program.description()).toMatch(/Atlas/i);
  });

  it("--help output mentions the hello command (smoke)", () => {
    const program = buildProgram();
    const helpText = program.helpInformation();
    expect(helpText).toMatch(/hello/);
  });
});
