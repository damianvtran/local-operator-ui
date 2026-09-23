/**
 * The telemetry kill switch, applied to the environment this repo's tooling
 * hands its children.
 *
 * WHY THIS EXISTS. The app ships a live PostHog project key — the schema's
 * default in `src/main/backend/config.ts` and in the renderer's
 * `env-schema.ts` is the real `phc_…` key, so a build that simply omits the
 * variable still carries one — and it uses it in both of its processes: main
 * constructs a `posthog-node` client at module load and the renderer mounts
 * `posthog-js`'s provider with `capture_exceptions`. Every test, harness, QA and
 * CI run therefore arrived in the "Local Operator Usage" project as a USER, and
 * the renderer's session replay recorder made each one a replay to watch on top
 * of that. The numbers this distorts are the ones the project exists for: MAU
 * and session counts. Depending on each agent and human to remember an
 * incantation is exactly how that happened, so the switch is set in the CHILD
 * environment: it then holds however the tool is invoked, including from a shell
 * that has never heard of the variable.
 *
 * The switch itself is the app's, not this repo's tooling's:
 * `LOCAL_OPERATOR_UI_TELEMETRY` is resolved by `src/main/telemetry-launch.ts`
 * from the environment this process was LAUNCHED with (`launchEnv`, the snapshot
 * taken before `backend/config.ts` folds a working-directory `.env` over
 * `process.env` with dotenv `override: true`). Main then composes the same
 * decision into every window's `webPreferences.additionalArguments`, which the
 * preload reads out of its own `argv` — the renderer's `VITE_*` values are
 * inlined at BUILD time, so a runtime variable cannot reach it — and
 * `shared/config/telemetry.ts` is the renderer's reader. One switch, one
 * decision, both processes; a `.env` in a checkout can neither silence a real
 * user nor speak for a rig.
 *
 * THE ONE PLACE A FILE COULD HAVE OUTRANKED A LAUNCH is the `dev` script, whose
 * `.env` is loaded inside the very shell the app is started from. It holds
 * because `dotenv-cli` does NOT overwrite a variable already in the environment
 * (`--override` is the opt-in, and this repo does not pass it): the launch's
 * value wins for every key and the file supplies the rest, so the prefix on
 * `dev:headless` reaches the app. That is pinned by
 * `scripts/telemetry-spawn-sites.test.mjs`, which runs the real `dev` body
 * against a scratch `.env` in the empty, the `on` and the absent shape - the
 * spellings that used to re-arm a headless run when `dev` re-exported the file
 * after the caller's prefix.
 *
 * WHAT DELIBERATELY DOES NOT COME THROUGH HERE.
 *
 *  - `pnpm start`, `pnpm dev` and the published `npx local-operator-ui` launcher
 *    are a person's own app on their own screen: those events belong to whoever
 *    is using the app. The agent-driven variants (`app:headless`,
 *    `dev:headless`) do set the switch, and the published launcher spawns
 *    Electron with the caller's environment, so exporting the variable covers
 *    that too.
 *  - Nothing here reaches a telemetry path outside the app's own two clients.
 *    `bin/local-operator-ui.js` passes no `env`, which is what makes an export
 *    of the operator's own reach it, and is pinned as such by
 *    `scripts/telemetry-spawn-sites.test.mjs`.
 *
 * EVERY SITE IS ENUMERATED RATHER THAN REMEMBERED.
 * `scripts/telemetry-spawn-sites.test.mjs` scans `scripts/` and `bin/` for the
 * calls that start Electron and fails on one that is not in its table — the same
 * shape as `notification-spawn-sites.test.mjs`, because the rig somebody adds
 * next month is the one that will forget this line. Its sibling's table cannot
 * be reused for this decision: the two disagree on a real row —
 * `scripts/npx-smoke-test.mjs` boots the packaged app in CI, which is silent
 * about the notification path but is exactly the run that was reporting to
 * PostHog from a hosted runner.
 *
 * WHY THE UPSTREAM FIX IS NOT THE RIGHT ONE. The tempting "correct" change —
 * drop the key's default, or blank the key in a rig's `.env` — is wrong in both
 * directions. The default is what makes a released build report at all, and an
 * EMPTY key is not the off switch it looks like: it used to throw inside
 * `new PostHog("")` at module load, before `app.whenReady()`, so the run died
 * with an error dialog instead of reporting nothing (that crash is fixed in the
 * same change, and now means "no telemetry" rather than "no app"). The invariant
 * that belongs to THIS repository is the one above: a test, harness or evidence
 * run must not appear in the product's analytics, and the switch is applied
 * where those runs build their children's environment.
 */

/**
 * The app's own launch switch, spelled once.
 *
 * `src/main/telemetry-launch.ts` reads this exact name and
 * `scripts/telemetry-spawn-sites.test.mjs` asserts the two agree, because
 * nothing else would notice them drifting apart.
 *
 * WHAT THIS PIN DOES NOT COVER: the app parses this value rather than treating
 * its presence as a choice, so the NAME is the contract and the values are part
 * of it — `off` is the word this module writes, and an unrecognised value is
 * refused loudly and lands on off in the app anyway.
 */
export const TELEMETRY_ENV = "LOCAL_OPERATOR_UI_TELEMETRY";

/**
 * The value this helper writes. `off` rather than `0` or an arbitrary string,
 * because the consumer parses it: it is one of the words
 * `resolveTelemetryLaunch` accepts, so a rig's launch prints no refusal line and
 * its intent is legible in the app's own output (`[telemetry] off: switched off
 * by LOCAL_OPERATOR_UI_TELEMETRY="off"`).
 */
export const TELEMETRY_OFF_VALUE = "off";

/**
 * `env` with telemetry switched off for a child about to be spawned.
 *
 * Returns the SAME object, so a call site can wrap its literal inline, and
 * composes with the notification switch in either order:
 *
 *     const env = withTelemetryOff(withNotificationsOff({ ...process.env, HOME: scratch }));
 *
 * A VALUE THE CALLER SET IS STILL PASSED THROUGH UNTOUCHED, and that is what
 * makes this a default rather than an override: silently flipping a caller's
 * choice would reproduce the very class of defect this closes — tooling deciding
 * something about a run without telling them. A caller who spells `on`, `1` or
 * `true` there is deliberately asking to report and is on the record; the way to
 * take the default back is to UNSET the key.
 *
 * Only an ABSENT or BLANK value takes the default: `""` and a whitespace-only
 * value alike. Blank is deliberate - a stale shell export or a `.env` line in
 * the empty shape arrives reading as "nobody chose anything" - and the
 * whitespace half is not tidiness: the app TRIMS before it decides
 * (`src/main/telemetry-launch.ts`), so a value it folds back to "nothing" must
 * not be left in this child reading as a considered choice HERE. Measured
 * before this matched: `"   "` and `"\t"` passed through untouched, arrived as
 * "unset" and left the app reporting, with no off-line to show it - a whitespace
 * from a shell mishap read as a deliberate `on`.
 *
 * The consequence of the pass-through is stated rather than hidden: an export of
 * `on` in the shell a rig is run from travels into that rig's child by this rule,
 * because the rigs build their children from `process.env`. That is the intended
 * escape hatch for studying real telemetry, and the reason it is a deliberate
 * `on` rather than a `0` is that the app refuses values it does not understand
 * and lands on OFF — a typo cannot re-arm a run.
 */
export function withTelemetryOff(env) {
	const current = env[TELEMETRY_ENV];
	// `.trim()`, to read a blank the way the app does: see the docblock above and
	// `resolveTelemetryLaunch`, which folds whitespace back to "nothing" before it
	// treats anything as a choice.
	if (current === undefined || current.trim() === "")
		env[TELEMETRY_ENV] = TELEMETRY_OFF_VALUE;
	return env;
}
