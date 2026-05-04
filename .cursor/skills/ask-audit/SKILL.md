---
name: ask-audit
description: Audit a Run Club issue without changing code. Use when the user asks for investigation, root cause analysis, audit-only work, or risky bugs before implementation.
disable-model-invocation: true
---

# Ask Audit

## Instructions

- Do not change code, configuration, schema, or generated files.
- Inspect the relevant files and trace the smallest path needed to understand the issue.
- Find the likely root cause and distinguish evidence from assumptions.
- List affected files and explain why each matters.
- Propose the smallest safe fix, but stop before implementation.
- Flag risks involving DB, RLS, auth, iOS PWA layout, feed, chat, realtime, push, XP, race, or Strava.
- If the issue touches sensitive systems, call out regression areas and suggested verification.

## Output

- Root cause
- Affected files
- Smallest safe fix
- Risks and verification notes
