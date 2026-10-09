/**
 * The install progress contract: the four phases, the marker the install
 * scripts and the main process print to announce one, and the payload the
 * installer window receives.
 *
 * WHY A MARKER RATHER THAN A CALLBACK. The script phases happen in a bash or
 * PowerShell child (`src/main/backend/scripts/*-install-script.sh|ps1`) that
 * the app spawns and reads line by line, and the pre-script phase happens
 * inside `managed-python.ts`, which is a different module from the one that
 * owns the window. A printed marker is the one signal both halves can emit
 * without either importing the other, and it survives a script run by hand.
 *
 * WHY IT CANNOT BE MISTAKEN FOR A LOG LINE. Every installer line is
 * free-form: pip's own progress, `ls -la` output, python tracebacks, paths
 * with colons in them. The marker therefore leads a WHOLE line, starts with a
 * `|` (which no shell, python or pip line this tree produces begins with),
 * carries a version, and matches nothing unless the entire trimmed line is
 * exactly `|LO<version>:<phase>`. A truncated or interleaved line is not a
 * milestone; a milestone-shaped sentence in some future log is not one either,
 * and the test that pins this is `scripts/install-progress.test.mjs`.
 *
 * This module is deliberately dependency-free: the renderer bundles it for the
 * phase labels and the preload/main half bundles it for the parser, so it may
 * not reach for `node:*` or `electron`.
 */

/**
 * The phases, in order. Index is the step; nothing else encodes the sequence.
 *
 * The four are the honest division of the work, and the mapping is:
 *
 *  1. `python`    - `prepareRuntime` in `managed-python.ts`: copy the bundled
 *                   runtime out of the (possibly code-sealed) app bundle and
 *                   verify its signature. Skipped when a reusable copy exists.
 *  2. `environment` - the install callback: the scripts' `python -m venv`.
 *  3. `components`  - `pip install local-operator`, the long one: a bundle and
 *                   its dependency closure, so a gap between markers here is
 *                   the expected shape rather than a hang.
 *  4. `verify`      - the app's own post-install probe: launch the installed
 *                   `local-operator serve` on a scratch port and wait for
 *                   `/health`. A phase of its own because it is minutes of
 *                   work the user is otherwise told nothing about, and because
 *                   it is the one step that can fail after a successful pip.
 */
export const INSTALL_PHASES = [
	"python",
	"environment",
	"components",
	"verify",
] as const;

export type InstallPhase = (typeof INSTALL_PHASES)[number];

/**
 * What the phase is called where the user reads it.
 *
 * Sentence case, and no jargon noun where an everyday one works
 * (`docs/branding.md` section 8): "Downloading components", not "Resolving
 * dependency closure".
 *
 * THE FIRST SCREEN HAS NO VOCABULARY YET, which is why two of these were
 * renamed in the remediation round (UX U10). "Creating the environment" is a
 * Python virtual environment to us and nothing at all to someone who has never
 * seen this app; "Python" they will meet in the copy either way, so the step
 * that makes the app's own copy of it says so. "Verifying the installation"
 * became "Checking the installation" for the same reason - the row is read by
 * someone deciding whether to keep waiting, not by us.
 *
 * FIRST-RUN ONBOARDING (D9, U8) took the same rule one step further: "runtime",
 * "Python" and "components" are still OUR nouns. The four labels now say what
 * the user is waiting for in words they already have - getting ready, setting
 * the app up, downloading what it needs, starting it - and the detail line under
 * the rail carries the one technical fact each step has.
 */
export const INSTALL_PHASE_LABELS: Record<InstallPhase, string> = {
	python: "Getting ready",
	environment: "Setting up Local Operator",
	components: "Downloading what it needs",
	verify: "Starting it up",
};

/**
 * What the running phase is doing, in one line under the bar.
 *
 * WHY THE PANEL NEEDS THIS AT ALL. The four labels are a MAP - where you are in
 * a four-step journey - and design round 1 measured the consequence of shipping
 * only that: the live step was the third thing the eye found on a screen whose
 * entire content is the live step (D7). This is the sentence that says what the
 * row means, so the one line that changes has something to say beyond a label the
 * reader has already parsed from the list.
 *
 * TWO OF THEM DOUBLE AS THE ANSWER TO "HOW LONG", which the screen this replaced
 * gave in one sentence ("This takes a few minutes") and the redesign had dropped:
 * `components` is the long one, and saying so is the difference between a user
 * who waits and a user who decides the app has hung (UX U9, U10).
 *
 * Sentence case, no jargon, and nothing that assumes a vocabulary the first-run
 * reader does not have yet (UX U10: "your assistants" means nothing on a screen
 * that has never mentioned one).
 *
 * EACH SENTENCE CARRIES ITS OWN SUBJECT, because the stage name is no longer
 * printed in front of it: the rail's row names the stage one line above, and this
 * line is the second half of that row rather than a second sentence. The previous
 * wording leaned on the prefix it used to hang off - "The packages it runs on" -
 * which left "it" with nothing on screen to bind to once the prefix went (design
 * D6, measured): the fragment was correct in the live region, where a screen
 * reader hears it out of context too, and wrong on the screen, where a reader can
 * see the row it is under and still has to guess whether "it" is the app or the
 * step.
 */
export const INSTALL_PHASE_DETAILS: Record<InstallPhase, string> = {
	python: "Finding the copy of Python Local Operator runs on.",
	environment:
		"Making Local Operator its own private folder nothing else touches.",
	components: "Downloading the packages Local Operator runs on.",
	verify: "Starting Local Operator once to check it comes up.",
};

/**
 * How long each phase usually takes, per platform, in milliseconds - the input
 * the window's estimate is computed from (first-run onboarding, U8/Q5/D10).
 *
 * WHY BASELINES AND NOT A LIVE RATE. The phases report boundaries, not bytes:
 * nothing on the wire says how much of a download is left, so any estimate is a
 * prior. A measured prior per phase is the honest one, and the window says
 * "about" and switches to "taking longer than usual" the moment a phase outruns
 * it rather than counting into negative numbers.
 *
 * WHERE EACH NUMBER COMES FROM (cold uv cache, the bundled uv 0.12.17):
 *  - darwin: `environment` 1.2-1.9 s in this author's cold runs and 1.55 / 1.9 /
 *    3.72 s in QA's three (round 2, Q2-1), `components` 7.6 s this author measured,
 *    8.08 s QA measured independently and 10.55-15.56 s on three cold runs at load
 *    ~50 (resolve 0.9 s, download 6.1 s, install 0.1 s), and `verify` 3.3 s
 *    (`serve` until `/health`), measured on an M-series Mac on 2026-10-08 by
 *    running the shipped script and the smoke probe's own command; `python` is the
 *    managed runtime copy, 5-8 s cold as the UX round measured it
 *    (`prepareAndInstall`'s note).
 *  - win32: `environment` 6.4 s and `components` 8.9 s from the uv arm of the
 *    install-scripts CI job (run 36646304432); `python` is `uv python install`,
 *    3.6 s on the Mac above, doubled for a slower disk and network. `verify` is
 *    not a separate wait on win32/linux (`prepareAndInstall` settles straight
 *    after the script), so it is a token half second.
 *  - linux: the same CI job's uv arm measured `environment` 3.2 s on the venv
 *    module (uv's `--seed` path is the 1.2 s above) and `components` 1 s on a
 *    datacentre link; the Mac's 7.6 s is used for `components` instead, because
 *    a user's link is not a datacentre's.
 *
 * EVERY BASELINE THAT CAN OVERRUN CARRIES HEADROOM (code review round 2, M-3,
 * and QA round 2's Q2-1): the four network- or disk-bound entries sit at
 * ~1.6-1.7x their measured figure, so a cold run on a slower link is inside its
 * budget rather than at its edge. The two that do not are deliberate and named
 * here rather than left for a reader to notice: `python` on win32 is already the
 * doubled reading, and `verify` on win32/linux is the token half second that
 * `prepareAndInstall` never waits out.
 *
 * Rounded UP to the half second: an estimate that runs out early reads as a
 * stall, one that finishes early reads as a pleasant surprise.
 */
export const INSTALL_PHASE_BASELINE_MS: Record<
	InstallPlatform,
	Record<InstallPhase, number>
> = {
	/*
	 * `environment` 3 s, up from the 1.5 s this held: QA's cold runs were
	 * 1.55 / 1.9 / 3.72 s, so the old figure overran on EVERY ordinary install -
	 * the one phase whose whole budget had no margin (QA round 2, Q2-1).
	 *
	 * `components` 14 s, because QA's independent cold measurement of that phase
	 * was 8.08 s against the 8.0 s this used to hold, which flipped a perfectly
	 * normal install to "taking longer than usual" underneath the same screen's
	 * "less than a minute" (QA round 1, Q-1): 1.73x that reading, 1.35x this
	 * author's worst cold run (10.40 s), and above QA's slowest loaded reading
	 * (15.56 s) only by way of the 1.5x threshold in `installEta`.
	 *
	 * `python` 6 s and `verify` 4 s are the 5-8 s the UX round measured and the
	 * 3.3 s smoke probe, rounded up; neither has the 1.6x the four above carry,
	 * and `verify`'s 4 s is also the value the frames' "about 3 s left" is derived
	 * from.
	 */
	darwin: {
		python: 6_000,
		environment: 3_000,
		components: 14_000,
		verify: 4_000,
	},
	/*
	 * 1.6x the CI job's 6.4 s and 8.9 s. The datacentre runner is FASTER than a
	 * user's machine and link, which is why these were the pair most likely to
	 * overrun in the field (code review round 2, M-3): 6.5 s and 9 s were the
	 * measured figures themselves, not a budget derived from them.
	 */
	win32: {
		python: 7_500,
		environment: 10_000,
		components: 14_000,
		verify: 500,
	},
	/*
	 * `environment` 5 s against the CI job's 3.2 s, `components` 12 s against the
	 * Mac's 7.6 s (the figure the linux entry already prefers over the
	 * datacentre's 1 s). Same reasoning as win32 above.
	 */
	linux: { python: 500, environment: 5_000, components: 12_000, verify: 500 },
};

/**
 * How far past its baseline a phase may run before the window says so, as a
 * MULTIPLE rather than a millisecond (QA round 2, Q2-1).
 *
 * The baselines above already carry headroom, so firing the sentence at 1.0x
 * turned ordinary load noise into "taking longer than usual" underneath the same
 * screen's "This usually takes less than a minute." - the same contradiction
 * round 1 removed for one phase, removed here from the rule itself. 1.5x a
 * budget that is already ~1.6x the measured figure means the sentence needs
 * roughly 2.4x the measured work before it appears.
 */
export const INSTALL_OVERRUN_FACTOR = 1.5;

/** The platforms the window has a baseline for; anything else reads as linux. */
export type InstallPlatform = "darwin" | "win32" | "linux";

/** Narrow `process.platform` to the three the install scripts exist for. */
export function installPlatform(platform: string): InstallPlatform {
	return platform === "darwin" || platform === "win32" ? platform : "linux";
}

/**
 * What the install child has said inside the `components` phase, parsed from
 * its own output (first-run onboarding, D9).
 *
 * Counts, never a fraction: uv announces the large downloads it STARTS
 * (`Downloading pillow (4.6MiB)`) and finishes (` Downloaded pillow`), and pip
 * announces each package it collects - neither says how many bytes remain, and
 * neither says up front how many large files there will be. So the window says
 * what is DONE (`3 large downloads finished \u00b7 55 packages in all.`) and,
 * before the first completion, what is happening (`Fetching the large files...`);
 * a denominator it does not have is never printed, because the one it used to
 * print GREW as uv discovered work (design round 1, D3).
 */
export type InstallSubProgress = {
	/** `Resolved N packages`: how many packages the install will lay down. */
	resolved: number | null;
	/** Large downloads started, and finished, so far. */
	downloadsStarted: number;
	downloadsDone: number;
	/** pip's `Collecting X` lines: packages fetched so far, when uv is absent. */
	collected: number;
	/** `Installed N packages` / `Successfully installed`: the last step ran. */
	installed: boolean;
};

export const EMPTY_SUB_PROGRESS: InstallSubProgress = {
	resolved: null,
	downloadsStarted: 0,
	downloadsDone: 0,
	collected: 0,
	installed: false,
};

const UV_RESOLVED = /^\s*Resolved (\d+) packages?\b/;
const UV_DOWNLOADING = /^\s*Downloading \S+ \(\d/;
const UV_DOWNLOADED = /^\s*Downloaded \S+\s*$/;
const UV_INSTALLED = /^\s*Installed \d+ packages?\b/;
const PIP_COLLECTING = /^\s*Collecting \S/;
const PIP_INSTALLED = /^\s*Successfully installed\b/;

/**
 * Fold one output line into the running sub-progress, or return the same
 * object when the line says nothing about it (so a caller can skip a send).
 *
 * `Downloading X (size)` is uv's spelling for a large file; pip spells its
 * downloads `Downloading <url-or-file> (size)` too, which is why a pip run's
 * downloads are counted the same way - the two clients agree on the shape.
 */
export function foldInstallLine(
	current: InstallSubProgress,
	line: string,
): InstallSubProgress {
	const resolved = UV_RESOLVED.exec(line);
	if (resolved) return { ...current, resolved: Number(resolved[1]) };
	if (UV_DOWNLOADING.test(line))
		return { ...current, downloadsStarted: current.downloadsStarted + 1 };
	if (UV_DOWNLOADED.test(line))
		return { ...current, downloadsDone: current.downloadsDone + 1 };
	if (UV_INSTALLED.test(line) || PIP_INSTALLED.test(line))
		return { ...current, installed: true };
	if (PIP_COLLECTING.test(line))
		return { ...current, collected: current.collected + 1 };
	return current;
}

/**
 * The one line the window shows for the sub-progress, or null for nothing yet.
 *
 * MONOTONIC, and that is the property the order below is chosen for: every
 * number it prints only ever grows, so a line that changes always changes
 * forward. Two earlier shapes failed it (design round 1, D3; code review round
 * 1, R2):
 *
 *  - `done of started large downloads done` moves BACKWARDS, because uv walks
 *    the resolve and starts files as it finds them, so 6 started with 3 done
 *    becomes 9 started with 3 done. Worse on the pip fallback, which prints no
 *    `Downloaded X` line at all, so it read `0 of 1`, `0 of 2`, ... `0 of 10` -
 *    a growing denominator over a stuck zero, on the screen U8 exists to keep
 *    from looking hung.
 *  - the downloads sentence therefore now REQUIRES a completion (`downloadsDone
 *    > 0`) before it is used, and pip's own `Collecting` count is the honest
 *    fallback in between.
 *
 * `resolved` is set once by uv's `Resolved N packages` line, so quoting it on a
 * later line is a constant rather than a second moving part.
 */
export function installSubProgressLine(
	sub: InstallSubProgress | null | undefined,
): string | null {
	if (!sub) return null;
	if (sub.installed) return "Unpacking and finishing up.";
	if (sub.downloadsDone > 0) {
		const done = sub.downloadsDone;
		return `${done} large download${done === 1 ? "" : "s"} finished${
			sub.resolved !== null ? ` \u00b7 ${sub.resolved} packages in all` : ""
		}.`;
	}
	if (sub.collected > 0)
		return `Fetched ${sub.collected} package${sub.collected === 1 ? "" : "s"} so far.`;
	if (sub.downloadsStarted > 0) return "Fetching the large files\u2026";
	if (sub.resolved !== null) return `Found ${sub.resolved} packages to fetch.`;
	return null;
}

/**
 * Elapsed time, `m:ss`. A clock rather than prose because it ticks: "12 seconds"
 * re-flows the line every second, `0:12` keeps its width (with tabular figures).
 */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The estimate, in words: what is left of the running phase's baseline plus
 * every later phase's.
 *
 * ROUNDED TO 5 s ABOVE 10 s so the number does not twitch every second on a
 * screen whose whole job is to be calm, and NEVER negative: a phase that has
 * outrun its budget by `INSTALL_OVERRUN_FACTOR` is "taking longer than usual",
 * which is the true thing to say and the cue that something (usually the network)
 * is slow.
 */
export function installEta(
	platform: InstallPlatform,
	phase: InstallPhase,
	phaseElapsedMs: number,
): string {
	const baselines = INSTALL_PHASE_BASELINE_MS[platform];
	const index = INSTALL_PHASES.indexOf(phase);
	/*
	 * THE SENTENCE NEEDS 1.5x THE BASELINE, not one millisecond past it: the
	 * budgets already carry headroom, so a rule that fired at 1.0x reported the
	 * fleet's ordinary load noise as a stalled install (QA round 2, Q2-1).
	 */
	if (phaseElapsedMs > baselines[phase] * INSTALL_OVERRUN_FACTOR)
		return "taking longer than usual";
	const later = INSTALL_PHASES.slice(index + 1).reduce(
		(sum, entry) => sum + baselines[entry],
		0,
	);
	/*
	 * A phase over its OWN budget but under the threshold shows what is left of
	 * the later phases rather than a negative remainder - "about -3 s left" is not
	 * a sentence this screen says, and the clamping is why 1.4x a baseline reads
	 * as the work still to come instead of as a stall.
	 */
	const left = Math.max(0, baselines[phase] - phaseElapsedMs) + later;
	const seconds = Math.max(1, Math.ceil(left / 1000));
	if (seconds >= 90) return `about ${Math.round(seconds / 60)} min left`;
	const shown = seconds > 10 ? Math.ceil(seconds / 5) * 5 : seconds;
	return `about ${shown} s left`;
}

/**
 * What the window says about the run's whole length before any phase has
 * started. It replaced "This takes a few minutes the first time" (U8): the
 * uv-backed install measures 15-25 s end to end, and "minutes" told a user to
 * walk away from a screen that would be done before they came back.
 */
export const INSTALL_EXPECTATION = "This usually takes less than a minute.";

/**
 * The marker's leading token. Versioned because a future release may need
 * markers this parser does not know: a marker whose version does not match is
 * ignored rather than guessed at, so an older app reading a newer script
 * degrades to "no progress" (an honest indeterminate bar) instead of acting on
 * a phase name it does not understand.
 */
const MARKER_PREFIX = "|LO";
const MARKER_VERSION = "1";
export const INSTALL_MARKER_PREFIX = `${MARKER_PREFIX}${MARKER_VERSION}:`;

/** The line a script prints to announce P entering. Exported for the tests. */
export function installMarker(phase: InstallPhase): string {
	return `${INSTALL_MARKER_PREFIX}${phase}`;
}

/**
 * Whether `line` is the marker for a phase.
 *
 * Whole-line and version-exact on purpose: see the header. Leading and
 * trailing whitespace is tolerated - Windows PowerShell and a `tee`d log can
 * add either - and nothing else is.
 */
export function parseInstallMarker(line: string): InstallPhase | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith(INSTALL_MARKER_PREFIX)) return null;
	const phase = trimmed.slice(INSTALL_MARKER_PREFIX.length);
	return INSTALL_PHASES.includes(phase as InstallPhase)
		? (phase as InstallPhase)
		: null;
}

/** Splits a stream chunk into complete lines, keeping the last partial one. */
export function splitLines(
	carry: string,
	chunk: string,
): { lines: string[]; carry: string } {
	const parts = `${carry}${chunk}`.split(/\r?\n/);
	const next = parts.pop() ?? "";
	return { lines: parts, carry: next };
}

/**
 * The installer window's channel: `installation-progress`.
 *
 * `phase` is null while nothing has been announced yet, which the window MUST
 * render as an indeterminate state - the pre-flight seconds are real work with
 * no milestone in them, and a bar that claims a step before anything has said
 * which step is a guess presented as a measurement.
 *
 * The three terminals are mutually exclusive and only one arrives per run:
 * `installed` (the run succeeded), or `failed` with the reason and the phase it
 * failed at. A window that receives neither is still installing.
 *
 * HOW A FAILURE REACHES THE SCREEN, and why the panel is handed three fields
 * rather than one sentence. Design round 1 (D3) measured the failure frame
 * rendering `ERROR: Could not find a version that satisfies the requirement
 * local-operator` - a quoted exception, which `docs/branding.md` section 8
 * calls an unfinished error - and that was not an unlucky sample but the
 * DEFAULT: every failure the causes table does not recognise fell through to the
 * raw line. So the payload now carries the two halves the panel composes:
 * `reason` is always a sentence in the product's own voice, and `detail` is the
 * captured line it was derived from, rendered separately in machine voice so it
 * reads as a log line rather than as the message.
 */
export type InstallProgressPayload =
	| ({
			kind: "phase";
			phase: InstallPhase | null;
			installed?: false;
	  } & Partial<InstallTiming>)
	| { kind: "installed"; phase: InstallPhase; installed: true }
	| { kind: "failed"; phase: InstallPhase | null; failure: InstallFailure };

/**
 * The timing a phase payload carries, so a window that mounts late (or ticks a
 * clock between payloads) computes elapsed and the estimate from the MAIN
 * process's instants rather than from when it happened to hear about them.
 *
 * OPTIONAL on the wire: a payload without it is the shape every earlier build
 * sent, and the window then shows the step counter alone - no clock it cannot
 * stand behind.
 */
export type InstallTiming = {
	/** Epoch ms this attempt started (a Retry starts a new one). */
	startedAt: number;
	/** Epoch ms the current phase was announced. */
	phaseStartedAt: number;
	platform: InstallPlatform;
	/** What the install child has said inside the phase, when it said anything. */
	sub: InstallSubProgress | null;
};

/**
 * One failure, in the terms the window has to say it in: which phase, the
 * sentence to lead with, and the captured line it came from.
 */
export type InstallFailure = {
	/** The phase in progress when the failure surfaced, or null if none had. */
	phase: InstallPhase | null;
	/** A sentence in the user's terms, already derived - see `installFailureSentence`. */
	reason: string;
	/**
	 * The captured line the reason was derived from, or null when the failure
	 * carried none (a thrown error, a spawn that never started). Rendered under
	 * the sentence in mono at `text-ink-dim`, which is what keeps a wall of pip
	 * output from becoming the message.
	 */
	detail: string | null;
	/** The install child's exit code where there was one, for the log's sake. */
	exitCode: number | null;
};

/**
 * Each phase as the clause a failure sentence ends with.
 *
 * NOT the label lowercased, which is what this used to be: the plain-language
 * labels carry the product's name ("Setting up Local Operator"), and lowercasing
 * printed "setting up local operator" in the one sentence a user reads on a bad
 * day. A clause per phase keeps the name capitalised and the grammar whole.
 */
const INSTALL_PHASE_FAILURE_CLAUSE: Record<InstallPhase, string> = {
	python: "getting ready",
	environment: "setting up Local Operator",
	components: "downloading what it needs",
	verify: "starting Local Operator",
};

/**
 * The sentence the panel says when no cause in the table matches.
 *
 * WHY THIS EXISTS rather than the raw captured line (design D3): a failure the
 * table does not recognise is the common case, not the corner, and the line it
 * falls back to is written for whoever debugged the script. This says what
 * happened and stops - the phase is the "what", the line below it is the
 * evidence, and `docs/branding.md` section 8's "what to do" is answered by the
 * Retry the panel puts under both.
 *
 * A THROWN FAILURE HAS NO PHASE, and the sentence has to stay true when it does:
 * the pre-script and retry paths can fail before any milestone was announced.
 */
export function installFailureSentence(phase: InstallPhase | null): string {
	if (phase === null) return "Setup stopped before it could finish.";
	return `Setup stopped while ${INSTALL_PHASE_FAILURE_CLAUSE[phase]}.`;
}

/**
 * Whether a phase payload's OPTIONAL timing is either absent or whole.
 *
 * A half-present timing (a clock with no platform, a sub-progress that is not an
 * object) is refused rather than half-rendered: the panel computes an estimate
 * from these fields on every tick, and a NaN there is a visible "about NaN s".
 */
function timingOk(payload: Record<string, unknown>): boolean {
	const keys = ["startedAt", "phaseStartedAt", "platform", "sub"];
	const present = keys.filter((key) => payload[key] !== undefined);
	if (present.length === 0) return true;
	if (present.length !== keys.length) return false;
	if (!Number.isFinite(payload.startedAt)) return false;
	if (!Number.isFinite(payload.phaseStartedAt)) return false;
	if (!["darwin", "win32", "linux"].includes(payload.platform as string))
		return false;
	const sub = payload.sub;
	if (sub === null) return true;
	if (typeof sub !== "object") return false;
	const fields = sub as Record<string, unknown>;
	return (
		(fields.resolved === null || Number.isFinite(fields.resolved)) &&
		Number.isFinite(fields.downloadsStarted) &&
		Number.isFinite(fields.downloadsDone) &&
		Number.isFinite(fields.collected) &&
		typeof fields.installed === "boolean"
	);
}

/**
 * Whether a value from the preload bridge is a payload this window can render.
 *
 * The renderer is not the only thing that can call `send` on the channel, and a
 * malformed payload must paint nothing rather than throw inside a live region.
 */
export function isInstallProgressPayload(
	value: unknown,
): value is InstallProgressPayload {
	if (typeof value !== "object" || value === null) return false;
	const payload = value as {
		kind?: unknown;
		phase?: unknown;
		failure?: unknown;
	};
	const phaseOk = (phase: unknown) =>
		phase === null || (INSTALL_PHASES as readonly unknown[]).includes(phase);
	if (!phaseOk(payload.phase ?? null)) return false;
	if (payload.kind === "phase")
		return timingOk(value as Record<string, unknown>);
	if (payload.kind === "installed") return true;
	if (payload.kind !== "failed") return false;
	/*
	 * EVERY FIELD THE PANEL WILL READ, not just the one it reads first. The
	 * renderer's handler dereferences `failure.phase` and renders `reason`, and a
	 * payload that carried a reason but no phase threw inside the window's only
	 * inbound channel (review R1-7) - the validator existed and nothing called it.
	 */
	const failure = payload.failure as
		| { phase?: unknown; reason?: unknown; detail?: unknown }
		| undefined;
	if (typeof failure !== "object" || failure === null) return false;
	/*
	 * `phaseOk` is called on the value ITSELF here, not on `?? null`: `null` is a
	 * real answer (a failure before any milestone), an ABSENT phase is not - and
	 * the renderer stores this field straight into the view, so an undefined one
	 * would paint a stepper with no state in it rather than being rejected.
	 */
	if (!phaseOk(failure.phase)) return false;
	if (typeof failure.reason !== "string") return false;
	return (
		failure.detail === undefined ||
		failure.detail === null ||
		typeof failure.detail === "string"
	);
}

/**
 * Lines that no user should ever be shown as the reason a setup failed: pip's
 * progress bars, its own "looking in indexes" narration, and the script's
 * banner. They are the tail of a failing run and they say nothing about the
 * failure.
 */
const NOISE = [
	/^\s*[-=]{3,}\s*$/,
	/^\s*Downloading\s+\S+\s*\(.*\)\s*$/i,
	/^\s*Preparing metadata/i,
	/^\s*Looking in indexes/i,
	/^\s*Collecting\s/i,
	/^\s*Using cached/i,
	/^\s*Installing collected packages/i,
	/^\s*Successfully installed/i,
	/^\s*\[notice\]/i,
	/^\s*Requirement already satisfied/i,
	/^\s*Requirement already up-to-date/i,
	/^\s*\d+\s*[KMG]B\s+[\d.]+ [KMG]B\/s/i,
	// The script's own reachability probe answers `curl -sI`, whose status line
	// and lowercase headers are the LAST thing a failing run writes.
	/^\s*HTTP\/[\d.]+\s+\d{3}/,
	/^\s*[a-z][a-z0-9-]{1,30}:\s\S+$/,
];

/**
 * The shape of a line that says WHY, and outranks "the last thing printed".
 *
 * Deliberately narrow: these are the prefixes the failing branches of the
 * shipped scripts, pip and Python itself use, and a broader pattern (`failed`,
 * `cannot`) would start claiming narration lines as the reason.
 */
const ERROR_SHAPED =
	/^\s*(?:ERROR\b|FATAL\b|error:|Traceback\b|OSError\b|ENOENT\b|ENOSPC\b)/;

/** The longest reason the window will render before it is a paragraph. */
const REASON_LIMIT = 240;

/**
 * The one line worth showing, out of everything a failing install captured.
 *
 * The last non-noise line, because a shell script's failing branch prints the
 * diagnostic immediately before it exits and everything after it is its own
 * cleanup narration. `stderr` and `stdout` are both accepted because the
 * scripts split between them: the macOS script sends only its refusal to
 * replace an existing path to stderr and every other error to stdout.
 *
 * TWO TIERS, because one is not enough and a REAL RUN is what showed it. Taking
 * the last non-noise line alone is right until the failing branch is followed by
 * a probe: a run of the shipped macOS script against an unreachable index ends
 * with the headers of its own `curl -sI` reachability check, so the line this
 * returned was `content-length: 27965` while pip's actual error sat four lines
 * above it. A user would have been shown an HTTP header. So the last
 * ERROR-SHAPED line wins wherever there is one - `ERROR`, `FATAL`, a traceback,
 * an errno name, the shapes that mean "this is why" - and the last non-noise
 * line is the fallback for failures that carry no such line. The tiering is the
 * fix; the header shapes in `NOISE` are the belt to its braces.
 *
 * Returned whole rather than parsed further: this module has no business
 * knowing what a pip error looks like, and a reason invented here would be a
 * second, less true account of the one the script already wrote. The causes
 * table in `setup-failure-causes.ts` is tried FIRST and outranks it, and
 * `installFailureSentence` supplies the words when it does not match - which is
 * the order the window's own copy follows.
 *
 * NULL WHEN THERE IS NO LINE, rather than a sentence: the two are different
 * facts to the caller now (the panel renders the sentence at reading weight and
 * this one under it in machine voice), and a function that returned prose here
 * would have the panel print the same shape twice.
 */
export function installFailureReason(
	stdout: string,
	stderr: string,
): string | null {
	const lines = `${stderr}\n${stdout}`.split(/\r?\n/);
	const pick = (accept: (line: string) => boolean): string | null => {
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			const line = lines[index].trim();
			if (line.length === 0) continue;
			if (NOISE.some((pattern) => pattern.test(line))) continue;
			if (!accept(line)) continue;
			return line.length > REASON_LIMIT
				? `${line.slice(0, REASON_LIMIT - 1).trimEnd()}\u2026`
				: line;
		}
		return null;
	};
	return pick((line) => ERROR_SHAPED.test(line)) ?? pick(() => true);
}

/**
 * The IPC channels this contract owns, in the direction each one travels.
 *
 * WHY THEY ARE HERE rather than only in the two files that use them: the preload
 * bridge is an explicit allowlist, so a channel the window sends and the bridge
 * does not carry is dropped SILENTLY - the renderer keeps its last state and
 * nothing logs. `scripts/install-progress.test.mjs` reads
 * `src/preload/index.ts` and asserts these are all present, which is the only
 * thing that turns that silence into a failing check.
 */
/**
 * The ground the setup window paints before the renderer's first frame.
 *
 * WHY A LITERAL AND WHY HERE. `backgroundColor` is the colour Electron fills the
 * window with before any HTML is parsed, so a value that differs from the ground
 * the panel paints is a one-frame flash on every launch - on the first screen a
 * new user ever sees (design D2, which measured the flash at deltaE 3.94 /
 * 1.14:1). The main process paints it before any theme module is loaded, so it
 * cannot be read from the palette at runtime and it cannot be a CSS variable.
 *
 * It is a hand-copied duplicate of `localOperatorDark.canvas`, and hand-copied
 * duplicates drift: the previous value was `#16130e`, which is not that palette's
 * canvas at all but its `onAccent` - the ink that belongs ON the accent fill,
 * painted underneath the whole window. So the pair is ASSERTED rather than
 * trusted: `scripts/install-progress.test.mjs` reads the generated theme CSS and
 * fails if this constant and `[data-theme="localOperatorDark"] --lo-canvas`
 * disagree. Changing a palette without changing this is a failing test, not a
 * flash nobody notices.
 */
export const INSTALL_WINDOW_CANVAS = "#22201c";

export const INSTALL_IPC_CHANNELS = {
	/** main -> renderer: the current phase, the terminal message, or a failure. */
	progress: "installation-progress",
	/** renderer -> main: re-send the phase this window mounted too late to hear. */
	replay: "installation-progress-replay",
	/** renderer -> main: abort the attempt in flight. */
	cancel: "cancel-installation",
	/** renderer -> main: run the install again after a failure. */
	retry: "retry-installation",
} as const;
