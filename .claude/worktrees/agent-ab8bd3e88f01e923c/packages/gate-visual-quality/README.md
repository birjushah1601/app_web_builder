# @atlas/gate-visual-quality

L7-visual-advisory merge gate. Screenshots the rendered preview, critiques against the chosen DesignTokens via multimodal Sonnet, returns a VisualQualityReport.

Dual-interface: `VisualQualityRole` (postDeveloperChain) + `VisualQualityGateRunner` (direct gate call).

## Test
```bash
pnpm test
```
