import React from "react";
import renderer from "react-test-renderer";
import Index from "../app/index";

describe("atlas-expo-rn smoke", () => {
  it("renders the index screen without throwing", () => {
    const tree = renderer.create(<Index />).toJSON();
    expect(tree).toBeTruthy();
  });

  it("includes the expected smoke copy", () => {
    const tree = renderer.create(<Index />).toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain("Atlas Expo Sandbox is live");
  });
});
