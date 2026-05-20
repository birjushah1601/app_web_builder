import { describe, it, expect, beforeEach } from "vitest";
import { CanvasModeRegistry } from "../src/registry.js";

describe("CanvasModeRegistry", () => {
  let reg: CanvasModeRegistry<string>;
  beforeEach(() => {
    reg = new CanvasModeRegistry<string>();
  });

  it("register + lookup roundtrip", () => {
    reg.register("designing", "DesignerRenderer");
    expect(reg.lookup("designing")).toBe("DesignerRenderer");
  });

  it("lookup returns undefined for unknown id", () => {
    expect(reg.lookup("preview")).toBeUndefined();
  });

  it("list returns every registered id", () => {
    reg.register("designing", "A");
    reg.register("preview", "B");
    reg.register("schema", "C");
    expect(reg.list().sort()).toEqual(["designing", "preview", "schema"]);
  });

  it("register throws on duplicate id", () => {
    reg.register("designing", "A");
    expect(() => reg.register("designing", "B")).toThrow(/already registered/i);
  });
});
