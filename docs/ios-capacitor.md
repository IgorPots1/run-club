# iOS Capacitor Shell

This repo now includes a minimal Capacitor setup for an iOS-only shell that loads the existing hosted Run Club app inside a native `WKWebView`.

## Strategy

- The web app remains the source of truth and default runtime.
- The iOS shell loads the hosted app via `server.url`.
- No static export was added.
- No Android platform was added.
- Push notifications are intentionally out of scope for this first iOS shell build.

## One-time setup

1. Install project dependencies:

```bash
npm install
```

2. Set the hosted app URL for Capacitor:

```bash
export CAPACITOR_APP_URL="https://your-hosted-run-club-url"
```

`APP_URL` also works, but `CAPACITOR_APP_URL` is preferred for the native shell so the web deploy config stays independent.

If you skip this variable, the iOS shell opens a small placeholder page instead of the hosted app so the native project can still build safely.

3. Sync the iOS project:

```bash
npm run cap:sync:ios
```

4. Open Xcode:

```bash
npm run cap:open:ios
```

## Install on an iPhone

1. Open `ios/App/App.xcworkspace` in Xcode if it is not already open.
2. Select the `App` target.
3. Set your Apple Developer Team in Signing & Capabilities.
4. If needed, replace the bundle identifier with one that is unique for your team.
5. Connect the iPhone with a cable or use wireless device deployment.
6. Enable Developer Mode on the iPhone if iOS prompts for it.
7. Choose the iPhone as the active run destination.
8. Press Run in Xcode.

The app should install as a native iOS app and load the hosted Run Club URL inside the shell.

## What is intentionally isolated

- Existing browser and PWA behavior remains unchanged.
- Capacitor is only used when the app runs inside the native shell.
- Service worker registration is skipped inside Capacitor to avoid native-shell caching and web-push side effects.
- Web push support is reported as unsupported inside Capacitor for this first iOS shell build.

## First-test checklist

- Standard email/password login inside the native shell.
- Session persistence after app background/foreground.
- Email confirmation links returning to the hosted app correctly.
- Strava connect flow and redirect back to `/profile/strava`.
- Chat thread keyboard open/close behavior and message composer visibility.
- Chat scroll positioning after keyboard transitions.
- Top and bottom safe area spacing on dashboard, detail screens, sheets, and chat.
- External links, especially any link that should leave the hosted app origin.

## Known risks for v1

- Strava OAuth may behave differently in an embedded iOS web view than it does in Safari.
- External third-party links may need explicit native browser handling in a follow-up if they should always leave the app shell.
- Chat keyboard behavior should be tested on a real device because `WKWebView` viewport changes can differ from Safari and installed PWA behavior.
- Since push is not implemented natively, any push-specific UX should be considered web/PWA-only for now.
