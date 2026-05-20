// Barrel export — so LLM-generated code can import either way:
//   import { Button } from "@/components/ui";          (this barrel)
//   import { Button } from "@/components/ui/button";   (per-file)
// Without this, the developer role frequently emits the barrel form and
// Next.js fails the build with "Module not found: Can't resolve '@components/ui'".
export * from "./badge";
export * from "./button";
export * from "./card";
export * from "./dialog";
export * from "./dropdown-menu";
export * from "./input";
export * from "./label";
export * from "./separator";
export * from "./skeleton";
export * from "./tabs";
export * from "./tooltip";
