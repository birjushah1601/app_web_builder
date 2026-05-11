import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTsCompilerMap, buildTsCompilerAstMapper } from "../src/ts-compiler-mapper.js";

async function mkProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "atlas-astmap-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return root;
}

describe("buildTsCompilerMap — Page mapping", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("maps /app/page.tsx to the Page node whose path is '/'", async () => {
    root = await mkProject({
      "app/page.tsx": "export default function HomePage() { return null; }\n"
    });
    const graph = {
      nodes: {
        "page:home": {
          kind: "page",
          id: "page:home",
          path: "/",
          title: "Home",
          renderMode: "ssr",
          authRequired: false
        }
      }
    };
    const file = await buildTsCompilerMap({
      projectRoot: root,
      graphJson: JSON.stringify(graph)
    });
    expect(file.mappings.find((m) => m.nodeId === "page:home")).toBeDefined();
    const mapping = file.mappings.find((m) => m.nodeId === "page:home")!;
    expect(mapping.ranges[0]?.file).toBe("app/page.tsx");
    expect(mapping.confidence).toBeCloseTo(0.9, 2);
  });

  it("maps /app/about/page.tsx to the Page with path='/about'", async () => {
    root = await mkProject({
      "app/about/page.tsx": "export default function AboutPage() { return null; }\n"
    });
    const graph = {
      nodes: {
        "page:about": {
          kind: "page",
          id: "page:about",
          path: "/about",
          title: "About",
          renderMode: "ssr",
          authRequired: false
        }
      }
    };
    const file = await buildTsCompilerMap({
      projectRoot: root,
      graphJson: JSON.stringify(graph)
    });
    expect(file.mappings.find((m) => m.nodeId === "page:about")).toBeDefined();
  });

  it("ignores route-group segments like (marketing)/ in the href mapping", async () => {
    root = await mkProject({
      "app/(marketing)/pricing/page.tsx": "export default function P() { return null; }\n"
    });
    const graph = {
      nodes: {
        "page:pricing": {
          kind: "page",
          id: "page:pricing",
          path: "/pricing",
          title: "Pricing",
          renderMode: "ssr",
          authRequired: false
        }
      }
    };
    const file = await buildTsCompilerMap({
      projectRoot: root,
      graphJson: JSON.stringify(graph)
    });
    expect(file.mappings.find((m) => m.nodeId === "page:pricing")).toBeDefined();
  });

  it("supports src/app/ convention", async () => {
    root = await mkProject({
      "src/app/page.tsx": "export default function HomePage() { return null; }\n"
    });
    const graph = {
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "h", renderMode: "ssr" }
      }
    };
    const file = await buildTsCompilerMap({
      projectRoot: root,
      graphJson: JSON.stringify(graph)
    });
    expect(file.mappings.find((m) => m.nodeId === "page:home")).toBeDefined();
  });
});

describe("buildTsCompilerMap — Component mapping", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("maps exported function declaration Hero to component:Hero", async () => {
    root = await mkProject({
      "components/Hero.tsx": "export function Hero() { return null; }\n"
    });
    const graph = {
      nodes: { "component:Hero": { kind: "component", id: "component:Hero" } }
    };
    const file = await buildTsCompilerMap({
      projectRoot: root,
      graphJson: JSON.stringify(graph)
    });
    const mapping = file.mappings.find((m) => m.nodeId === "component:Hero");
    expect(mapping).toBeDefined();
    expect(mapping?.ranges[0]?.file).toBe("components/Hero.tsx");
    expect(mapping?.confidence).toBeCloseTo(0.85, 2);
  });

  it("skips non-exported declarations", async () => {
    root = await mkProject({
      "components/Internal.tsx": "function Internal() { return null; }\n"
    });
    const graph = {
      nodes: { "component:Internal": { kind: "component", id: "component:Internal" } }
    };
    const file = await buildTsCompilerMap({
      projectRoot: root,
      graphJson: JSON.stringify(graph)
    });
    expect(file.mappings.find((m) => m.nodeId === "component:Internal")).toBeUndefined();
  });

  it("skips exports whose names are not in the graph", async () => {
    root = await mkProject({
      "components/Unused.tsx": "export function Unused() { return null; }\n"
    });
    const graph = { nodes: {} };
    const file = await buildTsCompilerMap({
      projectRoot: root,
      graphJson: JSON.stringify(graph)
    });
    expect(file.mappings).toEqual([]);
  });
});

describe("buildTsCompilerMap — output shape", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = "";
  });

  it("stamps graphHash with sha256 of the graph JSON", async () => {
    root = await mkProject({});
    const graphJson = JSON.stringify({ nodes: {} });
    const file = await buildTsCompilerMap({ projectRoot: root, graphJson });
    expect(file.graphHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("returns a FileBackedAstMapper via buildTsCompilerAstMapper convenience", async () => {
    root = await mkProject({
      "app/page.tsx": "export default function HomePage() { return null; }\n"
    });
    const mapper = await buildTsCompilerAstMapper({
      projectRoot: root,
      graphJson: JSON.stringify({
        nodes: { "page:home": { kind: "page", id: "page:home", path: "/", title: "h", renderMode: "ssr" } }
      })
    });
    expect(mapper.rangesForNode("page:home")).toBeDefined();
    expect(mapper.rangesForNode("page:unknown")).toBeUndefined();
  });
});
