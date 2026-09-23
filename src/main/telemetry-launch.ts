/**
 * Whether this launch may send product telemetry, resolved once and handed to
 * both processes the app runs in.
 *
 * WHY THIS EXISTS. Test, harness, QA and CI runs boot the REAL app, and the app
 * ships a live PostHog project key: main constructs a `posthog-node` client at
 * module load and the renderer mounts `posthog-js`'s provider, so every one of
 * those runs registered as a user and as a session replay in the "Local Operator
 * Usage" project and inflated its MAU. Nothing in the app could turn that off,
 * and an empty `VITE_PUBLIC_POSTHOG_KEY` is not an off switch either: the
 * schema's default is the real key, so omitting the variable still ships it, and
 * an explicitly empty one threw inside `new PostHog("")` ("You must pass your
 * PostHog project's api key.") at module load, before `app.whenReady()`, which
 * surfaced as a main-process error dialog rather than a quiet run.
 *
 * So there is one switch, it is a LAUNCH FACT, and it is read exactly the way
 * `window-mode.ts` and `dev-driver.ts` read theirs: from the environment the
 * process was LAUNCHED with (`launchEnv`), never from `process.env` after
 * `backend/config.ts` has folded a `.env` over it with dotenv `override: true`.
 * That asymmetry is the point of the switch. A repo `.env` is where an agent
 * reaching for "an environment variable" puts one, so a file must be able to
 * neither switch off a real user's telemetry nor switch it back on for a rig:
 * only the operator or the harness that launched the process decides.
 *
 * THE RULES, and the reason each direction is the safe one:
 *
 *  - the launch says NOTHING: telemetry stays ON. This is the shipped app on a
 *    user's own machine, and their analytics are the feature — a default of
 *    "off unless asked" would silently delete them for everybody.
 *  - the launch says `off` (`off`, `0`, `false`, `no`): none of the app's
 *    clients is constructed, and the renderer is told the same thing through the
 *    window's `additionalArguments` rather than through an environment of its
 *    own (its `VITE_*` values are inlined at BUILD time, so a runtime switch
 *    cannot reach it as a variable).
 *  - the launch says something ELSE: refused, LOUDLY, and telemetry is OFF. This
 *    is the fail-closed half, and it is the direction that differs from
 *    `window-mode.ts`'s typo rule (which keeps its `normal` fallback because the
 *    alternative is a silently hidden window). A text typo here is far likelier
 *    to be somebody trying to silence a run and missing a letter than a user
 *    trying to switch analytics on and missing one, and the cost of guessing
 *    wrong is one run's events in a customer-facing dashboard. The line names
 *    the accepted values, so a harness that silently sent nothing is told.
 *  - the build carries NO project key: no client either, and a line saying so.
 *    That is the crash above turned into the thing an empty key plainly means.
 *
 * What it deliberately is NOT: a privacy control for the shipped app's users
 * (there is no UI for it, and the launch is not theirs to set), and not a
 * network-isolation guarantee — an off launch makes no PostHog request of its
 * own, but it still reaches the Local Operator backend the app was pointed at.
 *
 * Pure by construction, like the two modules whose rules it copies: it imports
 * nothing from Electron and nothing from `backend/config` (the caller passes the
 * key in), so `scripts/telemetry-launch.test.mjs` bundles it and asserts the
 * decisions in milliseconds instead of booting an app.
 */

/** The launch fact. Unset — the shipped app — means telemetry stays on. */
export const TELEMETRY_ENV = "LOCAL_OPERATOR_UI_TELEMETRY";

/**
 * The entry main writes into a renderer process's `argv`, and the only channel
 * this decision has to the renderer.
 *
 * It is ALWAYS written, unlike the dev driver's entry, which is written only
 * when armed. The dev driver is an opt-in whose absence can be read as "off";
 * telemetry's default is ON, so if silence also meant "on" then a window created
 * by a path that forgot to compose this entry would leak the very events this
 * switch exists to stop — and the reader below could not tell that case apart
 * from a launch that was never an app window at all. Spelling the decision out
 * every time makes the renderer's fail-closed default ("no entry, no telemetry")
 * safe to hold.
 */
export const TELEMETRY_ARG = "--lo-telemetry";

/** The values that keep telemetry on, and the ones that switch it off. */
const ON_VALUES = ["on", "1", "true", "yes"];
const OFF_VALUES = ["off", "0", "false", "no"];

/** The resolved decision, and everything a caller needs to report it. */
export interface TelemetryLaunchDecision {
	/** When false, no client is constructed in either process. */
	enabled: boolean;
	/**
	 * Set-but-refused or otherwise unusual input, in the same spirit as
	 * `WindowLaunchPlan.problems` and `DevDriverArming.problems`: nothing here
	 * prints, so a test can assert on them and `index.ts` logs them.
	 */
	problems: string[];
	/** Why telemetry is off, phrased for a log line. Null when it is on. */
	offReason: string | null;
}

/**
 * Resolve the decision from plain values.
 *
 * Pure: the caller passes the environment the process was LAUNCHED with and the
 * project key its build carries, so a test can ask "what does a normal launch
 * do" without an app, a window, an Electron or a PostHog.
 */
export function resolveTelemetryLaunch(input: {
	env: Record<string, string | undefined>;
	/** The PostHog project key this build carries; empty means none. */
	projectKey: string;
}): TelemetryLaunchDecision {
	const off = (offReason: string, problems: string[] = []) => ({
		enabled: false,
		offReason,
		problems,
	});

	const raw = input.env[TELEMETRY_ENV];
	// An EMPTY value is not a considered choice — a stale shell export or a
	// `.env` line in the empty shape — so it is treated as the key the launch
	// never set, the same reading `notifications-off.mjs` applies to its own
	// empty case. It cannot be read as "off" here the way it is there, because
	// the two defaults point in opposite directions and this one is a person's
	// own analytics.
	if (raw !== undefined && raw.trim() !== "") {
		const value = raw.trim().toLowerCase();
		if (!ON_VALUES.includes(value) && !OFF_VALUES.includes(value)) {
			/*
			 * THE TWO HALVES CARRY DIFFERENT FACTS, deliberately: `offReason` says WHY
			 * the launch is off without repeating the value, and `problems` names what
			 * arrived and what would have been accepted. `describeTelemetryLaunch`
			 * joins them, so a value in both read as one fact stated twice - measured
			 * on the PR's own evidence as `switched off because
			 * LOCAL_OPERATOR_UI_TELEMETRY="flase" is not a value this launch
			 * understands; LOCAL_OPERATOR_UI_TELEMETRY="flase" is not understood
			 * (accepted: ...)`.
			 */
			return off(
				`switched off because ${TELEMETRY_ENV} is not a value this launch understands`,
				[
					`${TELEMETRY_ENV}="${raw}" is not understood (accepted: ${ON_VALUES.join(", ")} to keep telemetry, ${OFF_VALUES.join(", ")} to switch it off); telemetry is off, because an unrecognised setting is refused rather than obeyed`,
				],
			);
		}
		if (OFF_VALUES.includes(value)) {
			return off(`switched off by ${TELEMETRY_ENV}="${raw}"`);
		}
	}

	/*
	 * The key is `backendConfig.VITE_PUBLIC_POSTHOG_KEY`: product configuration,
	 * so reading it after the `.env` fold is correct and deliberate — that IS
	 * where a build's key is supposed to come from. It is checked here rather
	 * than at the construction site because "blank" is a fact about the launch
	 * like any other, and because the crash it used to cause belongs to the same
	 * decision as the switch: the answer to "may this process make a PostHog
	 * client" is no, whether the reason is the switch or the key.
	 */
	if (input.projectKey.trim() === "") {
		return off("this build carries no PostHog project key");
	}

	return { enabled: true, offReason: null, problems: [] };
}

/**
 * The `additionalArguments` entry that carries the decision to a renderer, and
 * the preload's reader below — one writer, one reader, no second spelling of the
 * vocabulary.
 */
export function telemetryArgument(enabled: boolean): string {
	return `${TELEMETRY_ARG}=${enabled ? "on" : "off"}`;
}

/**
 * Read the decision out of a renderer process's `argv`.
 *
 * `null` for an argument that is absent or unintelligible (a bare
 * `--lo-telemetry` with no value, or a value that is neither word). The
 * renderer's rule is that only an explicit `on` enables anything — and that the
 * build it is running in must carry a project key, because the renderer's key is
 * inlined at build time and this argument cannot speak for it — so
 * "unintelligible" and "absent" are deliberately the same answer here, and it is
 * the closed one.
 */
export function readTelemetryArgument(
	argv: readonly string[],
): { enabled: boolean } | null {
	const prefix = `${TELEMETRY_ARG}=`;
	const match = argv.find((entry) => entry.startsWith(prefix));
	if (match === undefined) return null;
	const value = match.slice(prefix.length);
	if (value === "on") return { enabled: true };
	if (value === "off") return { enabled: false };
	return null;
}

/**
 * The one line a non-default launch prints, and nothing at all on the ordinary
 * one.
 *
 * A run that switched telemetry off says so on its own stdout, for the same
 * reason the window mode does: a rig that believes it sent nothing, and a run
 * that really sent nothing, must be told apart from outside the app — the
 * evidence for this change greps this line, and so does the next agent
 * wondering whether its launch was the one that showed up in PostHog.
 */
export function describeTelemetryLaunch(
	decision: TelemetryLaunchDecision,
): string | null {
	if (decision.enabled) return null;
	const detail = [decision.offReason, ...decision.problems]
		.filter((part): part is string => part !== null && part !== undefined)
		.join("; ");
	return `[telemetry] off: ${detail}`;
}
