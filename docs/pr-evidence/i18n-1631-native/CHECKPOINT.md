# Native QA checkpoint — PR #1631

Head: `6fe683b6d7aae8c80e4faeb215139d057b1e1400`.
Reviewer: qa-tester — **openai/gpt-6.1-sol (actual execution)**. Requested header was anthropic/claude-sonnet-5-5, but own persisted usage.provider/model_id and native_replay metadata record GPT for round 1 and every round-2 continuation. Earlier Sonnet/no-fallback claims were incorrect.

**BLOCKED on capture admission; zero current-head native frames.** This is not design/native sign-off. Lightweight round-2 execution remains 2/2 PASS, previous-source negative control 0/2 PASS.

## Current-head build completed

The existing matching-lock donor supplies Electron45.1.0. Both lockfile SHA256 values were verified as `3c8154767ff17d8b7e038df2eb5104ef948c214fbbb75f433865b3915c60589b`. Only this owned worktree's `node_modules` symlink was repointed; no install, dependency copy or new dependency tree.

Build command used existing `scripts/run_bounded.py --timeout420 --memory-mb4096 -- node node_modules/electron-vite/bin/electron-vite.js build`, JS heap3072MiB, explicitly synthetic OAuth placeholders, `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:49461`, backend manager disabled, empty PostHog key/telemetry off, and the coordinator-authorized build-only `NODE_PATH` pointing at the existing lock-matched Babel plugin7.25.9 store parent. Actual flags had spaces between option and argument; abbreviated formatting here is prose. This is **not a stock-default build success**.

Actual corrected build result: exit0, bounded wall163.1s; renderer built in2m11s. Prior missing-environment and Babel-resolution failures remain preserved in session scratch logs. No additional resolver patch was needed. Current compiled artifacts have hashes in `build-receipt.json`.

## Admission disclosure

Before build, disk16.6949768GiB and memory78% passed, but actual printed load21.69 exceeded build<=20. The shell printed rather than fail-closed the load/memory checks. **This was a QA admission error**, disclosed to the coordinator, not a product bug and not silently represented as compliant. No rebuild is planned merely to repair the narrative.

After build, a capture preflight measured load25.7666015625 (>25) and disk16.5985222GiB. Therefore **no Electron app, daemon or capture was launched**. Native work stops rather than polling or relaxing admission. Required next allocation: one capture-only event when load<=25, free-memory>=40%, disk>=15GiB, and max2 heavy groups; execute these checks fail-closed.

## Retained ready plan and gaps

Reuse the located retained rig sources as references only; point to this worktree's current-head compiled output, with fresh isolated HOME/config/synthetic session IDs and one exact-PID-reaped app/owned typed protocol backend. Drive real settings.edit/language negotiation, not JS setLocale or localStorage language overrides. Prioritize effort popover/status plus wake count/once across seven target locales and English; Urdu native shortcut order and localized main New tab alongside unchanged remote title; first/settled frames and geometry; narrow long labels/counts. No pixels have yet been obtained, so every native matrix cell stays BLOCKED. Existing base pixels require exact-site provenance before reuse.
