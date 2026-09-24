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
 */
export const INSTALL_PHASE_LABELS: Record<InstallPhase, string> = {
	python: "Preparing the runtime",
	environment: "Creating its own Python",
	components: "Downloading components",
	verify: "Checking the installation",
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
 */
export const INSTALL_PHASE_DETAILS: Record<InstallPhase, string> = {
	python: "Copying what the app starts from.",
	environment: "Giving it a private copy of Python nothing else touches.",
	components: "The packages it runs on, and the longest step.",
	verify: "Starting the backend once to see it come up.",
};

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
	| { kind: "phase"; phase: InstallPhase | null; installed?: false }
	| { kind: "installed"; phase: InstallPhase; installed: true }
	| { kind: "failed"; phase: InstallPhase | null; failure: InstallFailure };

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
	return `Setup stopped while ${INSTALL_PHASE_LABELS[phase].toLowerCase()}.`;
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
	if (payload.kind === "phase" || payload.kind === "installed") return true;
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
