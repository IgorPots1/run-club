---
name: ios-pwa-review
description: Review Run Club mobile UI changes for iOS Safari and installed PWA behavior. Use for layout, navigation, chat, feed, modal, sheet, or global CSS changes.
disable-model-invocation: true
---

# iOS PWA Review

## Checklist

- Check iOS PWA safe-area behavior for top, bottom, and keyboard-adjacent UI.
- Verify keyboard behavior, especially input focus and composer visibility.
- Review `visualViewport`, `dvh`, `svh`, and fallback usage.
- Check bottom tab bar overlap with content and action controls.
- Verify chat composer stability during scroll, focus, and keyboard open/close.
- Check feed scroll restore and avoid unexpected scroll jumps.
- Review modal and sheet behavior on small screens.
- Check for horizontal overflow.

## Output

- Findings ordered by severity
- Manual mobile QA notes
- Residual iOS PWA risks
