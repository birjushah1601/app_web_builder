#!/usr/bin/env bun
import { Command } from "commander";
import { registerHello } from "./commands/hello.js";

/**
 * Build the root Commander program. Exported so tests can introspect it
 * without invoking process.exit. The actual entry-point at the bottom calls
 * `program.parseAsync(process.argv)`.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("atlas")
    .description("Atlas CLI sandbox")
    .version("0.1.0");

  registerHello(program);

  return program;
}

// Run only when invoked as a binary (not when imported by tests).
if (import.meta.main) {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}
