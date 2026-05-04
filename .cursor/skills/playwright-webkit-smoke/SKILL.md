---
name: playwright-webkit-smoke
description: Verify Run Club frontend or layout changes with Playwright MCP using WebKit on a mobile-sized viewport. Use after UI, layout, chat, feed, modal, sheet, viewer, map, chart, or realtime surface changes.
disable-model-invocation: true
---

# Playwright WebKit Smoke

## Instructions

- Verification only unless explicitly asked to fix.
- Do not change code during smoke test.
- Use Playwright MCP with WebKit for UI verification after frontend or layout changes.
- Prefer a mobile viewport around `390x844`.
- Verify actual `browserTypeName` is `webkit` when possible. If the MCP flow cannot confirm it, say that clearly in the report.
- Check that the page loads successfully.
- Check that the primary UI is visible.
- Check that primary CTA buttons are visible and usable.
- Check form inputs and textareas are visible and usable when present.
- Check for no obvious console errors.
- Check for no obvious horizontal overflow.
- Check for no obvious bottom or safe-area blocking.
- Report mobile and WebKit layout risks, even if they are only suspected.

## Run Club Focus

- Be extra careful with chat composer behavior.
- Check mobile tab bar overlap with content and actions.
- Check feed scroll restore.
- Check workout detail layout.
- Check modals and sheets.
- Check image and photo viewer behavior.
- Check comments and discussion composer behavior.
- Check maps and charts if present.
- Check realtime and chat UI surfaces.

## Output

- Browser used, including whether `browserTypeName=webkit` was confirmed.
- Viewport used.
- Any errors seen, including obvious console issues.
- Whether overflow or safe-area blocking was observed.
- Mobile and WebKit layout risks.
- Manual QA still required on a real iPhone or installed PWA for keyboard behavior, safe-area handling, standalone PWA behavior, bottom nav, chat composer, maps or autocomplete, photo gestures, and scroll physics.
