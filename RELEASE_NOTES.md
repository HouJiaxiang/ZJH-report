# Atomic scoring and member controls (draft, not deployed)

## Diagnosis

- The old client downloaded a whole JSON room, changed it locally, and overwrote the row. Concurrent bets, looks, transfers, and settlements could lose other clients' writes.
- Each mutation required a read and a write, then waited for Realtime to update the initiating UI.
- Browsers connect directly to the Supabase project in us-east-1, not through a Netlify backend. Mainland China latency has NOT been measured.
- The old page depended on Tailwind's runtime CDN and Google Fonts. These are replaced by bundled CSS and system fonts.
- A read-only aggregate audit found one existing room with a nonzero sum of player balances plus pot. This does not establish its cause: old leaveRoom deleted player balances. No historical scores were changed.

## Changes

- All room mutations use one transaction with SELECT FOR UPDATE. A request UUID deduplicates retries; round numbers reject late requests from an earlier round.
- RPC replies update the initiating UI immediately. Revisions reject older responses, and reconnect/visibility refresh plus a 15-second safety poll recover missed updates.
- Pending commands are persisted locally. Ambiguous failures require retrying the same command rather than creating another bet. Buttons are guarded during submission.
- Hosts can remove members between rounds. Members can rename themselves (1-20 characters). Removed members' balances/logs are retained and visible; they receive no subsequent antes.
- Joining, leaving, kicking and disbanding require a settled round. Disband archives the room instead of deleting its history. A kicked person is not permanently banned from rejoining with a new identity.

## Production blockers

**Do not apply this migration to production or merge until these are resolved.**

1. The existing RLS policies allow public SELECT/INSERT/UPDATE/DELETE. Player IDs are public and supplied by the browser; the host-ID check is a workflow guard, NOT proof of authenticated ownership. This patch uses SECURITY INVOKER and does not claim to fix that legacy security model. Add verified identity (for example Supabase anonymous Auth with server-bound membership), restrict direct writes, and test impersonation prevention before release. Existing sessions need an explicit migration/rejoin plan; do not silently assign ownership to whoever claims an old ID first.
2. Back up rooms and settle active rounds. Test the migration against an isolated Supabase project with the same table and RLS, then validate real multi-connection lock contention. PGlite unit tests use a single queued connection, not a distributed load test.
3. Configure BOTH VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for staging. Without overrides the legacy production connection remains the default. Do not point a preview at production.
4. Test multiple real phones in mainland China, including WeChat, iOS/Android, Wi-Fi and cellular, background/foreground, airplane-mode recovery, and lost-response retries. Collect click-to-confirmation and peer-update p50/p95, not only SQL execution time.
5. Coordinate frontend/database rollout: the revision trigger rejects old-browser overwrites. In addition to the identity restrictions, block legacy direct deletes. All participants must reload. The migration has not been applied to the live project.

## Verification

Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.
Tests exercise SQL invariants, 60 interleaved bets, retries, stale rounds, invalid input, host-ID checks, rename, archival, capacity, old-client rejection, and client pending/revision behavior.

Browser screenshots were not verified in this environment: no Chromium executable was installed, and the browser download returned an invalid archive. Desktop/mobile/WeChat visual and end-to-end QA is still required.

## Rollback and retention

Keep a pre-deployment database backup and the old frontend artifact. Do not simply restore the old frontend after the migration: it cannot write through the revision trigger and it would restore the lost-update bug. Prefer a maintenance/read-only page while rolling back code and database together. Do not discard archived members or the request history: logs currently serve as the idempotency ledger. Their long-term growth and a separate archive/ledger retention policy remain follow-up work.
