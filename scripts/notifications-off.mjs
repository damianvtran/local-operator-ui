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
 * callers take the name from here instead of restating the string.
 */
export const NOTIFICATIONS_ENV = "LOCAL_OPERATOR_NO_NOTIFICATIONS";

/**
 * `env` with notifications switched off for a child about to be spawned.
 *
 * Returns the SAME object, so a call site can wrap its literal inline:
 *
 *     const env = withNotificationsOff({ ...process.env, HOME: scratch });
 *
 * AN EXPLICIT VALUE WINS, and that is what makes this a default rather than an
 * override. Someone who deliberately sets `0` — an operator debugging why a
 * banner went missing, say — means it, and flipping their choice silently would
 * reproduce the very class of defect this closes: tooling deciding something
 * about the operator's desktop without telling them.
 *
 * Only an ABSENT or EMPTY value takes the default. Empty is deliberate:
 * `os.environ.get()` returns `""`, which is falsy in `notifications_enabled()`
 * and therefore already means ENABLED, so treating `LOCAL_OPERATOR_NO_
 * NOTIFICATIONS=` (what a shell mishap or a stale export leaves behind) as a
 * considered choice would quietly re-arm every banner.
 */
export function withNotificationsOff(env) {
	const current = env[NOTIFICATIONS_ENV];
	if (current === undefined || current === "") env[NOTIFICATIONS_ENV] = "1";
	return env;
}
