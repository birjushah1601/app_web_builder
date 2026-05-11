#!/usr/bin/env node
// Usage:
//   node tools/test-gen-cli.mjs baseline list
//   node tools/test-gen-cli.mjs baseline show <kind>
//   node tools/test-gen-cli.mjs drift check <calibration.json>

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  HumanBaselineStore,
  DriftDetector,
  TestGeneratorRegistry
} from "../packages/test-generator-registry/dist/index.js";
import { SkillRegistry, loadSkillsFromDir } from "../packages/skill-runtime/dist/index.js";

const [, , cmd, sub, ...rest] = process.argv;
const REPO_ROOT = resolve(process.cwd());
const BASELINES_DIR = resolve(REPO_ROOT, ".atlas/baselines");
const TEST_GEN_SKILLS = resolve(REPO_ROOT, "packages/skill-library/skills/test-generators");

async function main() {
  if (cmd === "baseline" && sub === "list") {
    const store = await HumanBaselineStore.fromDir(BASELINES_DIR);
    for (const kind of store.kinds()) {
      console.log(`${kind}: ${store.getAssertions(kind).length} assertions`);
    }
    return 0;
  }
  if (cmd === "baseline" && sub === "show") {
    const [kind] = rest;
    if (!kind) {
      console.error("Usage: baseline show <kind>");
      return 2;
    }
    const store = await HumanBaselineStore.fromDir(BASELINES_DIR);
    const assertions = store.getAssertions(kind);
    for (const a of assertions) {
      console.log(`[${a.id}] ${a.description}`);
      console.log(`  checklist: ${a.checklistItem}`);
      console.log(`  rationale: ${a.rationale.replace(/\n/g, " ").trim()}`);
      console.log(`  mustEmitTest: ${a.mustEmitTest}  owner: ${a.owner}`);
    }
    return 0;
  }
  if (cmd === "drift" && sub === "check") {
    const [calibPath] = rest;
    if (!calibPath) {
      console.error("Usage: drift check <calibration.json>");
      return 2;
    }
    const calibration = JSON.parse(await readFile(resolve(calibPath), "utf8"));
    let graph = { nodes: {} };
    try {
      graph = JSON.parse(await readFile(resolve(REPO_ROOT, ".atlas/spec.graph.json"), "utf8"));
    } catch {
      /* optional */
    }

    const skills = loadSkillsFromDir(TEST_GEN_SKILLS);
    const skillReg = new SkillRegistry(skills);
    const reg = TestGeneratorRegistry.fromSkillRegistry(skillReg);
    const baselines = await HumanBaselineStore.fromDir(BASELINES_DIR);
    const detector = new DriftDetector({ registry: reg, skillRegistry: skillReg, baselines });
    const report = await detector.check(calibration, graph);
    console.log(JSON.stringify(report, null, 2));
    return report.driftedCount > 0 ? 1 : 0;
  }
  console.error(
    "Commands:\n  baseline list\n  baseline show <kind>\n  drift check <calibration.json>"
  );
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
