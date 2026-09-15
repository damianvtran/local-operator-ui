/**
 * The notification kill switch, resolved as a LAUNCH fact for the backend this
 * app spawns.
 *
 * WHY THIS EXISTS, one level below `scripts/notifications-off.mjs`. That module
 * (the repo's tooling side) keeps a test, harness or evidence run from reaching
 * the operator's Notification Center by setting the switch in the environment
 * it hands its children. The app then spawns the backend with its OWN
 * environment (`backendSpawnEnv`), and that environment is no longer the launch
 * it was given: `backend/config.ts` folds a `.env` from the working directory
 * with dotenv `override: true`, so a file in the checkout wins over the value
 * `pnpm app:headless` set, and `dev:headless`'s is replaced before Electron even
 * starts because `pnpm dev` re-exports the same file inside its own shell.
 *
 * Measured (QA round 1 on #206, both rows through `pnpm app:headless`):
 *
 *     .env: LOCAL_OPERATOR_NO_NOTIFICATIONS=0    -> backend child sees "0"
 *     .env: LOCAL_OPERATOR_NO_NOTIFICATIONS=     -> backend child sees ""
 *
 * The empty row is the dangerous one: the consumer reads the variable with
 * `os.environ.get()`, so `""` is falsy and the banners are ARMED again while the
 * launch that switched them off reports success. Resolving the key here, at the
 * point the environment is handed to the spawn, is the same lesson this codebase
 * already applies to the python bytecode prefix and to the window mode and the
 * renderer dev driver: a fact about the launch must come from the launch, not
 * from the order in which a file happened to be folded in.
 *
 * THE RULES, and the asymmetry with `scripts/notifications-off.mjs` is
 * deliberate:
 *
 *  - the launch carries a NON-EMPTY value: that value is what the backend gets.
 *    `notify.py` is presence-based (`if os.environ.get(_ENV_DISABLE): return
 *    False`), so `0`, `1`, `no` and `false` all mean silenced — the value is
 *    passed through rather than normalised, because the app has no business
 *    deciding which spellings of "off" are equivalent when the consumer does not.
 *  - the launch carries the key but EMPTY: the backend gets `1`. An empty value
 *    is never a considered choice — nobody exports a variable to the empty
 *    string on purpose — and the two things that produce one are a stale shell
 *    export and a `.env` line in the empty shape, both of which arrive reading
 *    as "not disabled". This is the same rule `notifications-off.mjs` applies to
 *    a child environment, spelled once in each runtime because one of them is
 *    the app and the other is a node script; `scripts/notification-launch.test.mjs`
 *    asserts the two names agree.
 *  - the launch says NOTHING: nothing is added, and whatever the `.env` fold and
 *    the operator's shell rc left in the environment passes through untouched.
 *    This is the shipped app on a user's own machine, where the parked-gate
 *    banner is the feature: defaulting that leg to silence would delete the
 *    notification `notify.py`'s `detached_notify` exists to send, which is the
 *    one thing this change must not do.
 *
 * The consequence to know when reading a log: an empty value in a `.env` alone
 * (an interactive `pnpm start`) still leaves banners ON, because a launch that
 * says nothing is not the app's to overrule. An empty value that reaches the
 * LAUNCH — which is what `dev:headless` produces through `dev`'s own export —
 * silences the backend, which is what that command asks for.
 */

/**
 * The backend's own kill switch, spelled once per runtime.
 *
 * `local_operator/tui/notify.py` reads this exact name as `_ENV_DISABLE`, and a
 * typo disables the fix silently: the backend would simply keep bannering while
 * this repo's tests stayed green. `scripts/notification-launch.test.mjs` asserts
 * this constant equals the literal and equals `scripts/notifications-off.mjs`'s
 * `NOTIFICATIONS_ENV`, so the app and the tooling cannot drift apart.
 */
export const NOTIFICATIONS_ENV = "LOCAL_OPERATOR_NO_NOTIFICATIONS";

/**
 * The environment entries the backend spawn must add for the kill switch, from
 * the environment this process was LAUNCHED with (`launchEnv`).
 *
 * Returns an empty object when the launch said nothing, so a caller can spread
 * it unconditionally and an ordinary launch's environment is left exactly as it
 * was. See the rules at the top of this module for why the three cases differ.
 */
export function resolveNotificationLaunch(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const value = env[NOTIFICATIONS_ENV];
	if (value === undefined) return {};
	return { [NOTIFICATIONS_ENV]: value === "" ? "1" : value };
}
