/**
 * The notification kill switch, applied to the environment this repo's tooling
 * hands its children.
 *
 * WHY THIS EXISTS. A `pnpm test:desktop` run posted roughly 46 banners into the
 * operator's REAL macOS Notification Center in six minutes while he was working
 * on something else, burying what he needed to see. The path is not visible
 * from this repository, which is why it went unnoticed: the app spawns a Local
 * Operator BACKEND (`src/main/backend/backend-service.ts::backendSpawnEnv`
 * spreads the app's own environment into that child), the backend's serving
 * runtime announces a parked gate from `session/runtime/serving.py::
 * _announce_pending`, and that leg ends in `local_operator/tui/notify.py` —
 * `osascript -e 'display notification ...'` on macOS, which the OS attributes
 * to Script Editor (`com.apple.ScriptEditor2`) because the osascript process
 * carries no bundle identity. A Notification Center is not a sandbox: a test
 * suite that banners there is a defect in the SUITE, not a quirk of the app.
 *
 * The switch already exists and is read at the source of that path:
 * `LOCAL_OPERATOR_NO_NOTIFICATIONS` is `notify.py`'s `_ENV_DISABLE`, consumed by
 * `notifications_enabled()`, which `detached_notify()` checks before it does
 * anything. Nothing in this repo set it, so every run bannered by default.
 * Depending on each agent and human to remember an incantation is precisely why
 * it happened at 3 a.m. to somebody who had never heard of the variable; set in
 * the CHILD environment it holds however the tool is invoked, including from a
 * shell that has never heard of it either.
 *
 * WHAT DELIBERATELY DOES NOT COME THROUGH HERE.
 *
 *  - `scripts/notification-evidence.mjs` raises real banners on purpose: it
 *    exists so a reviewer can photograph the shipped notifier, and it prints
 *    the payloads so a banner can be matched to one. Suppressing it would
 *    produce no evidence at all.
 *  - `pnpm start`, `pnpm dev` and the published `npx local-operator-ui`
 *    launcher are a person's own app at their own screen, run interactively;
 *    there the banner is the feature rather than collateral. The agent-driven
 *    headless variants (`app:headless`, `dev:headless`) do set the switch, and
 *    the launcher spawns Electron with the caller's environment, so exporting
 *    the variable covers it too.
 *
 * EVERY SITE IS ENUMERATED RATHER THAN REMEMBERED.
 * `scripts/notification-spawn-sites.test.mjs` scans `scripts/` and `bin/` for
 * the calls that start Electron and fails on one that is not in its table; the
 * rig somebody adds next month is exactly the one that would forget this line.
 * The other end of the same path — the app's own spawn of the backend — is
 * resolved from the launch in `src/main/backend/notification-launch.ts`, because
 * the environment the app hands that child is not the launch it was given.
 *
 * WHY THE UPSTREAM FIX IS NOT THE RIGHT ONE. The tempting "correct" change —
 * have `notify.py` default to off when a session is not attached to a TTY —
 * is wrong in both directions. Reaching a user who is NOT attached is the
 * whole purpose of `detached_notify` (its own docstring says so), and the
 * desktop app's backend is a windowless `serve` process with no TTY whose
 * parked-gate banner is exactly what tells a user their session is waiting on
 * them. "No TTY means silence" would delete a notification real users need in
 * order to stop a test run from posting one. The invariant that belongs to
 * THIS repository is narrower and enforceable: a test, harness or evidence run
 * must not touch the operator's Notification Center, so the switch is applied
 * where those runs build their children's environment.
 */

/**
 * The backend's own kill switch, spelled once.
 *
 * `local_operator/tui/notify.py` reads this exact name as `_ENV_DISABLE`, and a
 * typo would fail silently — the backend would simply keep bannering — so
 * callers take the name from here instead of restating the string. The app
 * spells the same key in `src/main/backend/notification-launch.ts` for the
 * backend it spawns, and `scripts/notification-launch.test.mjs` asserts the two
 * agree, because nothing else would notice them drifting apart.
 *
 * WHAT THIS PIN DOES NOT COVER, and it is the honest edge of the whole change:
 * the consumer is that python file, and it lives in a separately installed
 * backend package this repo does not pin
 * (`src/main/update-install.ts` -> `pip install --upgrade local-operator`). A
 * rename upstream turns every switch set here into a variable nobody reads, and
 * every test in this repo stays green while the banners come back. A pin would
 * have to assert the installed backend's own name or version against this
 * constant; nothing in this repo can do that today.
 */
export const NOTIFICATIONS_ENV = "LOCAL_OPERATOR_NO_NOTIFICATIONS";

/**
 * `env` with notifications switched off for a child about to be spawned.
 *
 * Returns the SAME object, so a call site can wrap its literal inline:
 *
 *     const env = withNotificationsOff({ ...process.env, HOME: scratch });
 *
 * THE CONSUMER IS PRESENCE-BASED, and that decides what this function can and
 * cannot promise. `notify.py` reads the key with `os.environ.get()` and silences
 * on any NON-EMPTY string, measured against the shipped reader:
 *
 *     unset -> banners ON      0 -> SILENCED      1 -> SILENCED      no -> SILENCED
 *
 * So there is no value that means "banners back on". `0` is not re-arm, and
 * saying so — three places in this repo did before review caught it — is worse
 * than saying nothing, because `LOCAL_OPERATOR_NO_NOTIFICATIONS=0` is exactly the
 * instruction a person would follow to get their banners back, and following it
 * yields silence while looking switched off. The way back on is to UNSET the
 * key, which is what this change's own harness does:
 *
 *     env -u LOCAL_OPERATOR_NO_NOTIFICATIONS <command>
 *
 * A VALUE THE CALLER SET IS STILL PASSED THROUGH UNTOUCHED, and that is what
 * makes this a default rather than an override: silently flipping a caller's
 * choice would reproduce the very class of defect this closes — tooling deciding
 * something about the operator's desktop without telling them. Read together
 * with the rule above, the pass-through means `0` in a child environment
 * silences that child exactly as `1` does.
 *
 * Only an ABSENT or EMPTY value takes the default. Empty is deliberate:
 * `os.environ.get()` returns `""`, which is falsy in `notifications_enabled()`
 * and therefore already means ENABLED, so treating `LOCAL_OPERATOR_NO_
 * NOTIFICATIONS=` (what a shell mishap or a stale export leaves behind) as a
 * considered choice would quietly re-arm every banner.
 *
 * The APP applies the same rule to its own LAUNCH environment for the backend it
 * spawns (`src/main/backend/notification-launch.ts`), so a `.env` in the working
 * directory cannot replace what a launch was given — the same "empty is not a
 * choice" reading, one runtime over.
 */
export function withNotificationsOff(env) {
	const current = env[NOTIFICATIONS_ENV];
	if (current === undefined || current === "") env[NOTIFICATIONS_ENV] = "1";
	return env;
}
