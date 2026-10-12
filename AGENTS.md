# QUESTIFY PERMANENT RULES (read before every task)

PRODUCT: Telegram Mini App, micro-task rewards (coins + USDT). Next.js 16, Supabase, Vercel. One solo operator. REAL MONEY is involved.
VISION: one admin control room runs everything. No business number is hardcoded. The operator never edits code or SQL to change rules.

RULES
1. Work ONLY on the phase given. No extra features, no unrelated refactors.
2. First print a short plan (files you will touch), then implement.
3. Never delete, empty or rename files unless the task says so. Prefer targeted edits over rewriting whole files. End with git diff --stat.
4. One phase = one branch (phase-N-name) and one commit. Before committing run: npm run build, npx tsc --noEmit, npm run lint. Never commit red.
5. DB changes ONLY as new files in supabase/migrations/NNN_name.sql, idempotent (IF NOT EXISTS, CREATE OR REPLACE). Never edit old migrations. Never run SQL against production; the operator applies it.
6. Money: balances change ONLY inside SECURITY DEFINER RPCs callable by service_role only, each writing a ledger row in the same transaction. Every reward or withdrawal RPC must be idempotent. Never trust amounts sent by the client.
7. Business numbers (rewards, limits, commission, coin rate, fees, schedules) live in the platform_settings table, read server-side, editable from admin.
8. Secrets: never print, log or commit. New env vars: add the NAME to .env.example.
9. Be honest. Never mock or fake success. Never say done without showing the command output that proves it. If something cannot be verified, say so.
10. Final report format: DONE / NOT DONE / MANUAL STEPS FOR OPERATOR / HOW TO TEST (short numbered steps).
