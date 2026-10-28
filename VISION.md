# QUESTIFY — PRODUCT VISION & ROADMAP

Read this alongside AGENTS.md at the start of every new session. AGENTS.md
holds coding rules; this file holds product vision, business rules, and
roadmap. If you have a new idea or plan, say it in conversation and ask for
it to be folded back into this file.

## Ownership & role model

- Solo founder/owner, will hire later, not yet.
- Framed in-product as "Founder & Supreme Owner" — a cosmetic badge layered
  on top of is_admin (profiles.is_founder). Does NOT create a new permission
  tier; is_admin remains the sole authorization check everywhere.
- Admin surface is branded "Master Control Center (MCC)" — a standalone
  dashboard at /mcc, separate browser surface from the consumer Mini App.
  In-app Admin tab is a trimmed "Quick Panel" (payouts, bans, wallet glance).

## Core philosophy

- No business number is ever hardcoded in application code. Every reward,
  fee, commission %, rate limit, schedule, threshold lives in
  platform_settings, read server-side, editable live from MCC — no redeploy.
- Money correctness over feature speed. Balances are never a mutable column
  edited directly — always derived from an append-only ledger, written
  inside idempotent SECURITY DEFINER RPCs with row/advisory locks.
- Honesty over mocking. No fake success states, no silently swallowed
  errors. (Hard lesson, Phase 3A: a Telegram API rejection was invisible
  for days because the response was never read — now every sendMessage call
  logs its full response.)
- Client never trusted as authoritative for anything money- or time-gated.
  (Lesson from an open bug below: a client-displayed countdown reaching 0
  does not guarantee the server agrees enough time has passed — the server
  must own the actual gate, driven by the same start timestamp.)
- The operator runs this entirely solo. Every workflow must be usable by
  one person with no engineering help for routine operation.
- Changes are scoped and incremental, never a blanket "rewrite everything."
  Each phase: static-reviewed migration (no local Postgres, ever — rule 11),
  gates green (test/tsc/lint/build), merged to main, reported honestly.

## Tooling note

- OpenCode has run on the "Big Pickle" model for every phase through 4A.
  Track record is strong: caught a real double-refund money bug (Phase 2B),
  found a GitHub API restriction (July 2026) and worked around it correctly
  (Phase 4A), researched current OAuth docs accurately for three providers,
  consistently reports NOT DONE items honestly. No evidence ties model
  choice to the open timer bug below — treat it as an ordinary logic bug.
  For large/creative work (e.g. the full redesign below), a stronger paid
  model (Anthropic API key / ChatGPT Plus / GitHub Copilot) is a reasonable
  upgrade if available, but not required.

## Financial architecture — Dual Wallet (Phase 2B, shipped)

- Every task completion's owner profit margin (margin_usdt, set per task)
  auto-splits into two ledger-backed wallets:
  - Owner Wallet (default 95%) — never touched by referral payouts.
  - Marketing & Referral Reserve Wallet (default 5%) — the ONLY source for
    referral bonuses, commissions, and milestones.
- If the marketing wallet can't cover a payout, the payout is skipped and
  logged (insufficient_marketing_funds) — owner wallet never drawn on.
- Split percentages: live-editable in MCC → Settings, must sum to 1.

## Referral system — Tiered commission (Phase 1B + 2B, shipped)

- One-level attribution: referred_by set once, immutable, eligibility-gated
  (age < 24h, zero completed tasks, zero withdrawals at attribution time).
- Delivered via Telegram startapp (requires Main Mini App enabled in
  BotFather) with a bot pending_referrals fallback.
- Tier-1 (direct referrer): referral_tier1_commission_pct of task margin,
  lifetime, marketing wallet only.
- Tier-2 (referrer's referrer): referral_tier2_commission_pct, same, only
  if a tier-2 referrer exists.
- Instant referral bonus: fires once, after referral_bonus_min_tasks tasks
  completed — never on signup alone.
- Milestone rewards: configurable thresholds in referral_milestone_rules.
- All percentages/amounts live-editable in MCC → Settings.
- referral_events + v_referral_debug exist so referral failures are
  diagnosable via SQL — came out of a multi-day debugging session where the
  root cause was BotFather's Main Mini App being disabled.

## Honest task verification (Phase 4A, shipped)

- Real OAuth account linking for Google, GitHub, Discord — authorization
  code flow + PKCE, CSRF state (single-use, 10-min TTL), no OAuth tokens
  persisted (identity confirmed once at link time, then discarded).
- connected_accounts_provider_identity: one external identity can only be
  linked to one Questify account (prevents identity sharing across users).
- telegram_join / telegram_boost: real-time check via Bot API
  (getChatMember / getUserChatBoosts). Bot must be admin of the target
  chat/channel for these to work.
- github_star / github_fork: checked against the user's linked GitHub
  identity via GitHub's API (works around the July-2026 stargazers-list
  restriction by using the per-user starred-list endpoint instead).
  Unlinked GitHub → task blocked with a clear "link GitHub first" prompt.
- claim_task now branches on verification_type; tasks with no
  verification_type set still behave as timer-only (intentional — not
  every task needs hard verification).
- Phase 4B (NOT STARTED): YouTube subscribe check, Discord join check
  (account LINKING works today; task-level join verification does not yet
  exist for Discord/YouTube). X (Twitter) and TikTok have no reliable free
  API — plan is a 3-tier ladder: (A) real API where possible, (B)
  screenshot/link submission + AI pre-screen + human review queue, (C)
  fully manual fallback.

## KNOWN OPEN BUG — read this first in the next session

- Symptom: on a verified task (confirmed on github_star), the client-side
  "Verify & Claim" button becomes enabled (countdown reaches 0) but the
  server still rejects with "Cannot claim — Verification still in
  progress." Reproduced with the GitHub star already genuinely completed
  (not a false verification failure — purely a timing gate mismatch).
- Hypothesis (unconfirmed): client-side countdown and server-side
  time-gate likely derive their "start" timestamp from two different
  events, or the Telegram WebView suspending/resuming JS timers while the
  user is away on github.com throws off the client's elapsed-time math.
- FIRST TASK for the next session: trace both timers precisely (client:
  the "Complete the action" modal's countdown source; server: the
  time-gate logic inside claim_task / lib/verification.ts), find the
  actual mismatch with file:line evidence, make the server authoritative,
  and make the client's displayed countdown accurately reflect when the
  server will actually allow the claim. Do not guess — read the code.

## Master Control Center (MCC)

- Phase 3A (shipped): standalone /mcc dashboard, bot magic-link auth
  (primary — Telegram Login Widget kept only as an unreliable secondary),
  Founder badge, ban/unban + manual balance adjustment, Supabase Realtime
  live numbers via a heartbeat table (mcc_live_ticks) that carries no
  money data directly.
- Phase 3A-DESIGN (shipped): MCC given its own visual identity — deep
  slate/charcoal palette, gold/amber primary accent (tied to the Founder
  badge), teal secondary accent, persistent sidebar navigation, proper
  data tables (Users/Payouts/Tasks) with sticky headers and status pills,
  Settings grouped into labelled sections. Deliberately distinct from the
  consumer Mini App's look.
- Phase 3B (NOT STARTED): analytics layer — 7/30-day trend graphs,
  monthly/yearly ledger views, category profit analytics, CSV/PDF export,
  insufficient-funds early warning, admin action timeline, one-click
  emergency withdrawal pause, scheduled report delivery via the bot.

## NEW — Full visual redesign initiative (requested, NOT YET SCHEDULED)

Operator wants a complete A-Z visual overhaul covering BOTH the consumer
Mini App and MCC: colors, theming, typography, animation, and especially
more sophisticated/modern table UI — everything more professional and
"not all looking the same." This is distinct from Phase 3B (which adds new
analytics *content*, not a restyle) and distinct from the MCC-only redesign
already done in Phase 3A-DESIGN.

Guardrails for whoever executes this (do not skip):
- This must be done the same way Phase 3A-DESIGN was: a scoped, visual/
  layout-only pass with explicit confirmation that no business logic, RPC
  calls, auth, or data shape changes. Never frame this as "rewrite
  everything" — that risks the tested, money-handling logic this whole
  project has been careful to protect.
- Decide and state up front: is this one pass covering both surfaces, or
  split into "consumer Mini App redesign" and "MCC redesign v2" as two
  separate reviewable phases? Given the size, splitting is probably safer.
- Clarify with the operator before starting: what "more sophisticated
  tables" means concretely (sorting? filtering? density options? inline
  editing?) and whether there's a reference look/competitor dashboard they
  admire, so the result matches their expectation rather than guessing.

## Trust & transparency (planned, NOT STARTED)

- Payment Proof Telegram channel: bot auto-posts a masked-username line
  (e.g. @sha***) + tx_hash whenever a withdrawal is marked paid with a
  tx_hash. Channel id stored in platform_settings.
- Telegram ecosystem: an announcement channel + community group (operator
  creates these manually in Telegram, links them via Telegram's own
  discussion-group feature), bot's /start message links both, MCC's
  existing broadcast feature later extended to post to the channel too.

## Task sourcing — current state and future plan

- TODAY: all tasks are fixed, manually created in-app tasks with
  reward_coins/reward_usdt/margin_usdt set manually per task in MCC.
- NOT YET BUILT: no third-party offerwall/CPA network integration, no
  postback/webhook handler for external networks.
- PLANNED (Phase 6, not started): start with CPAlead (instant approval,
  solid API+postback docs) to validate integration technically, then add
  AdGate Media, OfferToro, BitLabs, TimeWall for offer diversity. Payout
  terms typically Net-30 — plan cashflow accordingly. Anti-fraud (Phase 5)
  should mature BEFORE adding third-party networks.

## Security posture

- Solo-operator platform handling real USDT — defenses must be structural,
  not procedural (no second person to catch mistakes).
- Fail-closed auth (no bot token = no session, ever), rate limiting on all
  money-adjacent endpoints, tx_hash required before a withdrawal is marked
  paid, idempotency keys on claim/withdraw, RLS on all tables, admin
  actions logged with reason + actor + timestamp + ip/user_agent, OAuth
  tokens never persisted.
- No local PostgreSQL is ever spun up during development (permanent
  AGENTS.md rule). Migrations validated by static review, applied manually
  in the Supabase SQL Editor, verified with read-only queries after.

## Marketing / distribution plan

- Phase 1C (NOT STARTED): /r/<code> smart-redirect page for referral links
  opened from Facebook/Instagram/TikTok/YouTube in-app browsers — Android
  intent:// deep link attempt first, clean "Open in Telegram" fallback for
  iOS/blocked browsers, click→referral funnel tracking that never blocks
  the redirect. Sequenced AFTER money-safety and anti-fraud work, timed
  just before any real marketing push.
- A short custom domain (instead of the vercel.app subdomain) worth buying
  before any real marketing push.

## Roadmap status

- [x] Phase 1 — Security hotfix + referral link format fix
- [x] Phase 1B — Referral capture hardening, bot fallback, audit trail
- [ ] Phase 1C — Smart social-media redirect link — deferred to pre-launch
- [x] Phase 2 — Money safety: rate limiting, tx_hash gate, idempotency,
      platform_settings foundation
- [x] Phase 2B — Dual wallet, Tier-1/2 referral commission, real
      withdrawal fee collection
- [x] Phase 3A — MCC foundation (standalone dashboard, magic-link auth,
      Founder badge, ban/adjust, Realtime)
- [x] Phase 3A-DESIGN — MCC professional visual redesign
- [ ] Phase 3B — MCC analytics: graphs, ledger views, exports, warnings
- [x] Phase 4A — Real OAuth (Google/GitHub/Discord) + Telegram/GitHub task
      verification — ONE KNOWN BUG OPEN, see above, fix first
- [ ] Phase 4B — YouTube/Discord task-level verification, X/TikTok queue
- [ ] Phase 5 — Anti-fraud: multi-account/device/IP detection
- [ ] Phase 6 — Third-party offerwall/CPA integration (start CPAlead)
- [ ] NEW — Full consumer Mini App + MCC visual redesign v2 (requested,
      scope/split not yet decided — see guardrails above)
- [ ] Trust & transparency — Payment Proof channel, Telegram ecosystem
