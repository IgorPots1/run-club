# Bugbot Review Rules

Flag these Run Club risks during review:

- Missing migrations for schema changes.
- Service role usage in client code.
- Broad unrelated refactors.
- Feed visibility regressions.
- `app_access_status` leakage.
- Chat or realtime regressions.
- Push notification idempotency or deduplication issues.
- XP, achievement, or race integrity regressions.
- Strava sync changes that affect duplicate protection, incremental sync, backfill, token refresh, or raw payload preservation.
- iOS PWA layout risks in mobile shell, chat, feed, or navigation changes.
