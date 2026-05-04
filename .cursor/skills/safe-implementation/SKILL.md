---
name: safe-implementation
description: Implement small Run Club changes with minimal diff and strict scope control. Use when the user requests a focused fix or feature implementation.
disable-model-invocation: true
---

# Safe Implementation

## Instructions

- Implement only the requested task.
- Keep the diff minimal and easy to review.
- Do not make unrelated refactors, renames, formatting sweeps, or architecture changes.
- Preserve existing behavior unless the user explicitly requests a change.
- Be especially careful around feed, chat, realtime, push, XP, race, Strava, and iOS PWA behavior.
- When runtime code changes, run `npm run lint` and `npm run build` unless the user explicitly skips them.
- Do not claim checks passed unless they actually ran.

## Output

- Changed files
- Verification results
- Regression risks, if any
- Suggested commit message
