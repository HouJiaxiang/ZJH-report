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
- Anonymous Supabase sessions now establish the visitor identity without email, password, phone, or WeChat authorization. A returning browser reuses its session. Every mutation compares the actor to the signed JWT's auth.uid(); public player IDs alone grant no authority.
- New rooms use protocol 2. Direct table writes/deletes and the internal mutation engine are revoked from client roles. Members (including former members for shared-ledger access) may read only rooms they joined. Outsiders get a minimal room preview, not member balances or logs.
- Rejoining with the same valid anonymous identity restores that member's existing balance. Clearing browser storage or changing browser creates a different identity and cannot claim the old balance by nickname.
- Create-room retries also use durable request receipts. Preview builds no longer contain a production URL/key fallback: missing configuration fails closed.

## Production blockers

**Do not apply this migration to production or merge until these are resolved.**

1. Enable Anonymous Sign-Ins in the isolated test project's Auth settings. No login UI is introduced. Review the anonymous-signup rate limit (friends sharing Wi-Fi share an IP), abuse prevention and anonymous-user retention before production. Do not silently enable a CAPTCHA requiring user interaction. Apply BOTH migrations in order during a coordinated maintenance window; the first migration alone is not a secure release.
2. Back up rooms and settle active rounds. Test the migration against an isolated Supabase project with the same table and RLS, then validate real multi-connection lock contention. PGlite unit tests use a single queued connection, not a distributed load test.
3. Configure BOTH VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for staging. Missing values show a setup screen and never fall back to production. Use a public/publishable key, never a service-role key. Configure production separately only after test approval.
4. Test multiple real phones in mainland China, including WeChat, iOS/Android, Wi-Fi and cellular, background/foreground, airplane-mode recovery, and lost-response retries. Collect click-to-confirmation and peer-update p50/p95, not only SQL execution time.
5. Coordinate frontend/database rollout: the revision trigger rejects old-browser overwrites. In addition to the identity restrictions, block legacy direct deletes. All participants must reload. The migration has not been applied to the live project.
6. Legacy rooms have no verifiable member credentials. The second migration makes them inaccessible to client roles without altering their content; never bind old IDs to the first visitor claiming them. Before release, settle/export those rooms, keep the backup accessible to the owner, and have friends create new rooms. Automatic score carry-over is intentionally not implemented.

## Verification

Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.
Tests exercise SQL invariants, 60 interleaved bets, retries, stale rounds, invalid input, host-ID checks, rename, archival, capacity, old-client rejection, and client pending/revision behavior.
Additional tests execute both migrations under authenticated/anon roles with simulated signed-user claims: forged host IDs, direct writes/deletes, internal function access, outsider reads, create retry idempotency, anonymous-session reuse, and legacy-room takeover prevention. These test authorization logic, not the hosted Auth service or JWT cryptography.

Browser screenshots were not verified in this environment: no Chromium executable was installed, and the browser download returned an invalid archive. Desktop/mobile/WeChat visual and end-to-end QA is still required.

## Rollback and retention

Keep a pre-deployment database backup and the old frontend artifact. Do not simply restore the old frontend after the migration: it cannot write through the revision trigger and it would restore the lost-update bug. Prefer a maintenance/read-only page while rolling back code and database together. Do not discard archived members or the request history: logs currently serve as the idempotency ledger. Their long-term growth and a separate archive/ledger retention policy remain follow-up work.
