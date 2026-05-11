---
name: rtl-layout
description: Test fixture — minimal rtl-layout skill
activate_on: accessibility
---

# RTL Layout (fixture)

- Verify dir="rtl" or direction: rtl is set for right-to-left languages.
- Flag missing logical CSS properties (margin-inline vs margin-left) as A11Y-RTL-001.
- Check bidirectional text isolation using the unicode-bidi property.
- Report high when RTL layout is implicit but not explicit.
