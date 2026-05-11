---
name: critique-copy
description: Detect generic LLM-prose vs intentional, category-appropriate copy
activate_on: visual-quality
model_hint: sonnet
---

# Critique: Copy

## When to use

Composed by the Visual-Quality gate to check whether the rendered headlines and microcopy sound like they were written by a person who knows the category, vs. generic AI-prose.

## Checklist

- [ ] Headline avoids generic phrases: "Experience the finest", "Where dreams become reality", "Discover the difference".
- [ ] Specific to the category: a restaurant page mentions actual dishes, neighborhoods, hours; a SaaS page mentions concrete value props, not "transform your business".
- [ ] Microcopy on CTAs is action-led: "Book a table" beats "Click here". "Reserve" beats "Submit".
- [ ] No placeholder text leaks (Lorem ipsum, "[Your text here]", "TBD").

## Output contract

Issues with `category: "copy"`. Severity:
- `critical` = placeholder text leaks (Lorem, TBD).
- `major` = headlines clearly generic AI-prose.
- `minor` = microcopy could be more action-led.

## Anti-patterns

- Don't penalize copy the user explicitly asked for ("the user wrote this exact headline").
- Don't flag i18n-style template strings as placeholders.
