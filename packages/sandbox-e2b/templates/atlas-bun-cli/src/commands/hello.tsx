import { Command } from "commander";
import React, { useEffect, useState } from "react";
import { render, Box, Text } from "ink";
import Spinner from "ink-spinner";

interface HelloProps {
  name: string;
}

/**
 * Default-export ink component for the `hello` subcommand. Demonstrates the
 * canonical ink pattern: <Box> for layout, <Text color="..."> for color,
 * <Spinner> for in-flight indicators, hooks for state.
 */
export default function Hello({ name }: HelloProps): React.ReactElement {
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDone(true), 600);
    return () => clearTimeout(t);
  }, []);

  if (!done) {
    return (
      <Box>
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> Greeting {name}...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Hello, {name}!</Text>
      <Text dimColor>(rendered via ink — Atlas CLI v0.1.0)</Text>
    </Box>
  );
}

/**
 * Register the `hello` subcommand on a Commander program. Convention for all
 * subcommand files: export `registerX(program: Command)`. cli.ts wires them
 * up; tests can register against an isolated program for assertions.
 */
export function registerHello(program: Command): void {
  program
    .command("hello")
    .description("Print a friendly greeting (ink demo)")
    .argument("[name]", "name to greet", "world")
    .option("-n, --name <name>", "name to greet (option form)")
    .action((nameArg: string, opts: { name?: string }) => {
      const name = opts.name ?? nameArg;
      render(<Hello name={name} />);
    });
}
