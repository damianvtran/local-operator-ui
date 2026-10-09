import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The install-progress contract: what a milestone marker is, what it is not, and
 * what the window is told when an install fails.
 *
 * The module under test ships to BOTH halves - the main process parses markers
 * out of an install script's stdout, the setup window renders the phases - so
 * this file is the one place the two spellings are pinned together.
 *
 * WHY THE MARKER FIXTURES ARE READ OFF THE SHIPPED SCRIPTS. A parser tested
 * against a transcript someone copied into this file is tested against a copy:
 * it went stale the moment the scripts changed under the branch (main #434
 * deleted the FFmpeg fetch these scripts used to do, and a transcript captured
 * before that still named it). So the marker half of this file READS
 * `src/main/backend/scripts/*` and asserts on the lines that are there now - the
 * count, the spelling, the phase each one names, and that each one stands on a
 * line of its own directly above the work it names.
 *
 * `REAL_FAILING_STDOUT` is still a captured transcript, from an actual run of
 * the shipped macOS script with a `PYTHON_BIN` that does not exist, because the
 * noise half is about what the parser must IGNORE and only real narration can
 * answer for that.
 *
 * WHAT IT DOES NOT PROVE: that the milestones fire in the real install. That is
 * a property of the scripts and the main process, and it is verified by running
 * the installer, not here.
 */

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/shared/install-progress";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const progress = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The installer PANEL, bundled so a test can read what it renders.
 *
 * Same idiom as the contract bundle above, and `scripts/canvas-goals.test.mjs`'s
 * terms, with the three things a renderer component needs that the contract does
 * not: React stays external so the bundle shares ONE copy with this file's own
 * imports (two copies and every render throws on an invalid hook call), the two
 * `@`-aliases and the png the identity block imports are declared by hand because
 * esbuild cannot read tsconfig paths, and `lucide-react` stays external because its
 * icons are a real dependency rather than something to inline.
 *
 * WHY RENDER AT ALL. An earlier version of the rail's assertions read the panel's
 * SOURCE text, and one of them matched an expression 24 characters away from the
 * element it was named after - so it stayed green with the connector hidden and
 * green again with the connector made unconditional (both mutation-tested by the
 * reviewer). An assertion about what a step's completion does to the rule under it
 * has to watch the rendered PAIR; see the two rail tests below for what that buys.
 */
const panelBundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { InstallPanel } from "./src/renderer/src/features/installer/components/installer-panel";
			export const renderPanel = (props) =>
				renderToStaticMarkup(createElement(InstallPanel, props));
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@assets": "./src/renderer/src/assets",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"lucide-react",
	],
	loader: { ".css": "empty", ".png": "dataurl" },
	jsx: "automatic",
	write: false,
});
const panelBundlePath = new URL(
	"./_install-progress-panel.bundle.mjs",
	import.meta.url,
);
await writeFile(panelBundlePath, panelBundle.outputFiles[0].text);
const { renderPanel } = await import(panelBundlePath.href);
await unlink(panelBundlePath);
/**
 * One of the main process's dependency-free leaves, bundled on its own.
 *
 * `setup-failure-causes.ts` is deliberately import-free (the update path has to
 * be able to load it without the installer's script imports), which is also what
 * lets this file load it the same way it loads the contract.
 */
async function bundleLeaf(path) {
	const leaf = await build({
		stdin: { contents: `export * from "${path}";`, resolveDir: process.cwd() },
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
	});
	return await import(
		`data:text/javascript;base64,${Buffer.from(leaf.outputFiles[0].text).toString("base64")}`
	);
}

const {
	INSTALL_PHASES,
	INSTALL_IPC_CHANNELS,
	INSTALL_PHASE_DETAILS,
	INSTALL_PHASE_LABELS,
	INSTALL_MARKER_PREFIX,
	INSTALL_WINDOW_CANVAS,
	installMarker,
	parseInstallMarker,
	splitLines,
	installFailureReason,
	installFailureSentence,
	isInstallProgressPayload,
	EMPTY_SUB_PROGRESS,
	INSTALL_EXPECTATION,
	INSTALL_OVERRUN_FACTOR,
	INSTALL_PHASE_BASELINE_MS,
	foldInstallLine,
	formatElapsed,
	installEta,
	installPlatform,
	installSubProgressLine,
} = progress;

/**
 * The header and closing failure of the SHIPPED macOS script, taken from a run
 * of it and nothing else - `bash src/main/backend/scripts/macos-install-script.sh`
 * with `PYTHON_BIN` pointing at a path that does not exist, so it stops at the
 * interpreter check before it creates anything.
 *
 * It is here for the NOISE half of the contract: of every line this run printed,
 * not one is a milestone, and that is the property an installer's narration has
 * to have. Note what it does NOT contain any more - this script used to fetch a
 * third-party FFmpeg binary and narrate that for four lines, and main #434
 * deleted the fetch. A fixture that still had those lines would be asserting
 * against a script that no longer exists.
 */
const REAL_FAILING_STDOUT = `==============================================
Mon Sep 21 21:48:07 EDT 2026: Starting Local Operator backend installation...
==============================================
Python bin path: /tmp/probe/nonexistent-bin/python3
Virtual environment path: /tmp/probe/venv3
App data directory: /tmp/probe/home3/Library/Application Support/Local Operator
Log file: /tmp/probe/home3/Library/Application Support/Local Operator/backend-install.log
==============================================
Error: Bundled Python not found at /tmp/probe/nonexistent-bin/python3
Please ensure standalone Python is properly installed in the application resources.`;

/** The scripts this platform's markers are read from, and the line each names. */
const SCRIPT_MARKERS = [
	[
		"src/main/backend/scripts/macos-install-script.sh",
		{
			environment: "Creating virtual environment at $VENV_PATH",
			/*
			 * The install BLOCK's first line, not the pip call inside it: the block
			 * opens by deciding between the bundled uv and pip (#440), so a marker
			 * aimed at `python -m pip install` would land inside a branch half the
			 * runs do not take.
			 */
			components: "UV_INSTALLED=false",
		},
	],
	[
		"src/main/backend/scripts/linux-install-script.sh",
		{
			/*
			 * The stage's first work: the connectivity probe, which can spend up to
			 * 2 x 30 s on a dead network and therefore runs INSIDE the stage rather
			 * than before it (code review round 2, N-2). Linux has no managed
			 * runtime to copy, so this is its "Getting ready" - the same work macOS
			 * reports from `managed-python.ts`.
			 */
			python: "check_connectivity",
			environment: "Creating virtual environment at $VENV_PATH",
			components: "UV_INSTALLED=false",
		},
	],
	[
		"src/main/backend/scripts/windows-install-script.ps1",
		{
			/*
			 * Resolution into `$PythonExe`, which on a clean machine fetches the
			 * interpreter through the bundled uv - the arm that used to run with no
			 * phase announced at all.
			 */
			python: "$PythonExe = $null",
			environment: "Creating virtual environment at $VenvPath",
			components: "Installing local-operator in virtual environment",
		},
	],
];

/**
 * The completing half: the two script-owned milestones in order, with the
 * narration the current scripts print around them (`pip`'s shapes, which are the
 * same whatever is being installed).
 */
const REAL_COMPLETING_STDOUT = [
	"==============================================",
	"Mon Sep 21 17:04:02 EDT 2026: Starting Local Operator backend installation...",
	"==============================================",
	"venv module is available",
	installMarker("environment"),
	"Creating virtual environment at /tmp/probe/venv...",
	"Successfully created virtual environment",
	"Virtual environment structure verified",
	"Installing local-operator in virtual environment...",
	"Upgrading pip...",
	"pip upgrade successful: pip 25.2",
	"Checking network connectivity to PyPI...",
	installMarker("components"),
	"Installing local-operator package...",
	"Collecting local-operator",
	"  Downloading local_operator-0.30.6-py3-none-any.whl.metadata (2.1 kB)",
	"Collecting httpx<1,>=0.27 (from local-operator)",
	"  Downloading httpx-0.28.1-py3-none-any.whl.metadata (7.1 kB)",
	"Installing collected packages: local-operator, httpx",
	"Successfully installed local-operator-0.30.6",
	"local-operator installation successful",
	"Local Operator backend installed successfully!",
].join("\n");

test("every marker the scripts print parses back to its phase", () => {
	for (const phase of INSTALL_PHASES) {
		assert.equal(parseInstallMarker(installMarker(phase)), phase);
	}
	// The spelling the scripts embed literally, so a change to the builder cannot
	// silently stop matching the scripts that were not regenerated with it.
	assert.equal(parseInstallMarker("|LO1:environment"), "environment");
	assert.equal(parseInstallMarker("|LO1:components"), "components");
	assert.equal(INSTALL_MARKER_PREFIX, "|LO1:");
});

test("the marker leads a whole line and nothing else on it", () => {
	assert.equal(parseInstallMarker("   |LO1:verify  "), "verify");
	assert.equal(parseInstallMarker("\t|LO1:python\r"), "python");
	// The three shapes a stray line could take: a marker inside a sentence, a
	// marker that continues, and one that is only a prefix of the phase.
	assert.equal(parseInstallMarker("log: |LO1:verify"), null);
	assert.equal(parseInstallMarker("|LO1:verify: done"), null);
	assert.equal(parseInstallMarker("|LO1:verifying"), null);
	assert.equal(parseInstallMarker("|LO1:"), null);
	assert.equal(parseInstallMarker(""), null);
});

test("an unknown version is ignored rather than guessed at", () => {
	// A newer script, an older app: the window degrades to indeterminate instead
	// of acting on a phase name this build does not have.
	assert.equal(parseInstallMarker("|LO2:verify"), null);
	assert.equal(parseInstallMarker("|LO:verify"), null);
});

test("installer log lines are never mistaken for markers", () => {
	const lines = REAL_COMPLETING_STDOUT.split("\n").concat(
		REAL_FAILING_STDOUT.split("\n"),
	);
	for (const line of lines) {
		if (line.includes(INSTALL_MARKER_PREFIX)) continue;
		assert.equal(
			parseInstallMarker(line),
			null,
			`a log line parsed as a milestone: ${JSON.stringify(line)}`,
		);
	}
	// The shapes that look most like a marker to a careless matcher: a
	// percent-complete column, a wheel name, a long absolute path, and a bare
	// equals-rule.
	assert.equal(
		parseInstallMarker("100   257  100   257    0     0   1168      0"),
		null,
	);
	assert.equal(
		parseInstallMarker("=============================================="),
		null,
	);
	assert.equal(
		parseInstallMarker(
			"  Downloading httpx-0.28.1-py3-none-any.whl.metadata (7.1 kB)",
		),
		null,
	);
});

test("the milestones of a real completing run arrive in order", () => {
	const seen = REAL_COMPLETING_STDOUT.split("\n")
		.map(parseInstallMarker)
		.filter((phase) => phase !== null);
	assert.deepEqual(seen, ["environment", "components"]);
	// The phases the MAIN PROCESS owns are not in any script, and the window has
	// to name them, so the vocabulary is the contract's rather than the scripts'.
	assert.deepEqual(INSTALL_PHASES, [
		"python",
		"environment",
		"components",
		"verify",
	]);
	// Plain-language labels (first-run onboarding, D9/U8): the user's nouns,
	// not ours - no "runtime", no "components".
	assert.equal(INSTALL_PHASE_LABELS.python, "Getting ready");
	assert.equal(INSTALL_PHASE_LABELS.verify, "Starting it up");
});

test("a chunk split mid-line does not lose or invent a milestone", () => {
	// The reader is fed whatever size chunk the pipe hands it, so a marker is
	// routinely split across two `data` events.
	const text = `${REAL_COMPLETING_STDOUT}\n${installMarker("verify")}\n`;
	const chunks = [text.slice(0, 40), text.slice(40, 120), text.slice(120)];
	let carry = "";
	const seen = [];
	for (const chunk of chunks) {
		const split = splitLines(carry, chunk);
		carry = split.carry;
		for (const line of split.lines) {
			const phase = parseInstallMarker(line);
			if (phase) seen.push(phase);
		}
	}
	const last = parseInstallMarker(carry);
	if (last) seen.push(last);
	assert.deepEqual(seen, ["environment", "components", "verify"]);
});

test("a failure reason is the last real line, not pip's progress bars", () => {
	const reason = installFailureReason(REAL_COMPLETING_STDOUT, "");
	assert.equal(reason, "Local Operator backend installed successfully!");
	// The failing shape: the script's own sentence, not the curl meter under it.
	assert.equal(
		installFailureReason(REAL_FAILING_STDOUT, ""),
		"Please ensure standalone Python is properly installed in the application resources.",
	);
});

test("a pip failure reports the error, not the download narration", () => {
	const stdout = [
		installMarker("components"),
		"Installing local-operator package...",
		"Collecting local-operator",
		"  Downloading local_operator-0.30.6-py3-none-any.whl.metadata (2.1 kB)",
		"Looking in indexes: https://pypi.org/simple",
		"ERROR: Could not find a version that satisfies the requirement local-operator",
	].join("\n");
	assert.equal(
		installFailureReason(stdout, ""),
		"ERROR: Could not find a version that satisfies the requirement local-operator",
	);
});

test("each shipped script announces the phases it actually runs, in order", () => {
	/*
	 * Read, not copied. Every marker line in the shipped scripts, asserted where
	 * it sits: the whole-line spelling, the phase it names, and that it stands
	 * directly above the work it announces - which is the half a copied
	 * transcript cannot keep true when the script changes under it.
	 */
	for (const [file, named] of SCRIPT_MARKERS) {
		const lines = readFileSync(file, "utf8").split("\n");
		/*
		 * A source line, not a line of output: the script says
		 * `echo "|LO1:environment"`, so the marker is lifted out of its quotes
		 * and then put through the SAME parser the main process uses on the real
		 * stdout. Asserting on the echo rather than on a copy of what it prints is
		 * what keeps this honest when the script is edited.
		 */
		const found = lines
			.map((line, index) => {
				const quoted = line.match(/"([^"]*\|LO1:[^"]*)"/);
				return [index, quoted ? parseInstallMarker(quoted[1]) : null];
			})
			.filter(([, phase]) => phase !== null);
		/*
		 * THREE SCRIPT-OWNED PHASES on the two platforms that have no managed
		 * runtime: they announce `python` themselves because nothing else does
		 * (code review round 1, R1 - `managed-python.ts` is macOS-only, so the
		 * panel used to open on "Step 2 of 4" with the rail's first row never lit).
		 * macOS still announces two, because its `python` comes from the app.
		 */
		assert.deepEqual(
			found.map(([, phase]) => phase),
			named.python
				? ["python", "environment", "components"]
				: ["environment", "components"],
			`${file} must announce exactly its script-owned phases, in order`,
		);
		for (const [index, phase] of found) {
			// The line after the marker is the work it names: a marker emitted
			// somewhere else would point the window at the wrong step.
			const next = lines[index + 1] ?? "";
			assert.ok(
				next.includes(named[phase]),
				`${file}:${index + 1} announces ${phase} but the line under it does not start ${JSON.stringify(named[phase])}`,
			);
			// And the quoted payload is the bare marker, which is the whole-line
			// rule: nothing else may ride on the line the script prints.
			assert.equal(
				lines[index].match(/"([^"]*\|LO1:[^"]*)"/)[1].trim(),
				`${INSTALL_MARKER_PREFIX}${phase}`.trim(),
			);
		}
	}
});

test("the shipped script's ordinary narration is never read as a milestone", () => {
	const parsed = REAL_FAILING_STDOUT.split("\n").map(parseInstallMarker);
	assert.deepEqual(
		parsed.filter((phase) => phase !== null),
		[],
	);
	// The phases the MAIN PROCESS owns are not in any script, and the window has
	// to name them, so the vocabulary is the contract's rather than the scripts'.
	assert.deepEqual(INSTALL_PHASES, [
		"python",
		"environment",
		"components",
		"verify",
	]);
	// Plain-language labels (first-run onboarding, D9/U8): the user's nouns,
	// not ours - no "runtime", no "components".
	assert.equal(INSTALL_PHASE_LABELS.python, "Getting ready");
	assert.equal(INSTALL_PHASE_LABELS.verify, "Starting it up");
	/*
	 * Every phase has BOTH strings, and the two are different: the label is the
	 * row, the detail is the line under the bar that says what the row means
	 * (design D7, UX U8). A phase with no detail would render an empty live region
	 * - silently, since a `role="status"` with no text announces nothing.
	 */
	for (const entry of INSTALL_PHASES) {
		assert.ok(INSTALL_PHASE_LABELS[entry].length > 0, `${entry} has no label`);
		assert.ok(
			INSTALL_PHASE_DETAILS[entry].length > 0,
			`${entry} has no detail line`,
		);
		assert.notEqual(INSTALL_PHASE_DETAILS[entry], INSTALL_PHASE_LABELS[entry]);
	}
});

test("a run that recorded nothing yields no line, and a sentence instead", () => {
	// Two different facts, and the panel renders them differently: the sentence at
	// reading weight, the captured line under it in machine voice. A function that
	// returned prose for the empty case would have the panel print that shape
	// twice (design D3).
	assert.equal(installFailureReason("", ""), null);
	assert.equal(
		installFailureReason(
			["---", "Collecting local-operator", ""].join("\n"),
			"",
		),
		null,
	);
	assert.equal(
		installFailureSentence(null),
		"Setup stopped before it could finish.",
	);
	assert.equal(
		installFailureSentence("components"),
		"Setup stopped while downloading what it needs.",
	);
	// The product's name keeps its capitals inside the sentence: a lowercased
	// label printed "setting up local operator" here.
	assert.equal(
		installFailureSentence("environment"),
		"Setup stopped while setting up Local Operator.",
	);
	// The sentence is always derivable, whatever the phase, because it is what the
	// panel leads with when the causes table recognises nothing.
	for (const phase of INSTALL_PHASES) {
		assert.ok(installFailureSentence(phase).startsWith("Setup stopped while"));
	}
});

test("a payload from the bridge is only accepted in the shapes the panel renders", () => {
	assert.ok(isInstallProgressPayload({ kind: "phase", phase: "components" }));
	assert.ok(isInstallProgressPayload({ kind: "phase", phase: null }));
	assert.ok(isInstallProgressPayload({ kind: "installed", phase: "verify" }));
	assert.ok(
		isInstallProgressPayload({
			kind: "failed",
			phase: "components",
			failure: {
				phase: "components",
				reason: "boom",
				detail: null,
				exitCode: 1,
			},
		}),
	);
	assert.equal(
		isInstallProgressPayload({ kind: "failed", phase: "components" }),
		false,
	);
	/*
	 * THE SHAPE THAT THREW (review R1-7). The handler dereferences
	 * `failure.phase`, so a failure object carrying a reason but no phase used to
	 * raise inside the window's only inbound channel - and a phase the contract does
	 * not know would paint a stepper that matches no row either.
	 */
	assert.equal(
		isInstallProgressPayload({
			kind: "failed",
			phase: "components",
			failure: { reason: "boom" },
		}),
		false,
	);
	assert.equal(
		isInstallProgressPayload({
			kind: "failed",
			phase: "components",
			failure: { phase: "downloading", reason: "boom" },
		}),
		false,
	);
	assert.equal(
		isInstallProgressPayload({ kind: "phase", phase: "downloading" }),
		false,
	);
	assert.equal(isInstallProgressPayload(null), false);
	assert.equal(isInstallProgressPayload("phase"), false);
	assert.equal(isInstallProgressPayload({}), false);
});

test("the preload bridge carries every channel this contract owns", () => {
	/*
	 * The preload is an explicit allowlist, and a channel it does not carry is
	 * dropped in SILENCE: no throw, no log, the window simply keeps painting its
	 * last state. That is how the two channels this change added - the replay ask
	 * and the Retry - would have shipped inert if nothing had read this file.
	 *
	 * Read as text rather than imported: `src/preload/index.ts` is a separate
	 * bundle with Electron in its graph, so a test cannot import it, and the file's
	 * own header says why the values are literals rather than the contract's
	 * constants.
	 */
	const preload = readFileSync("src/preload/index.ts", "utf8");
	const sendBlock = preload.slice(0, preload.indexOf("on: (channel"));
	const onBlock = preload.slice(preload.indexOf("on: (channel"));
	for (const channel of [
		INSTALL_IPC_CHANNELS.cancel,
		INSTALL_IPC_CHANNELS.retry,
		INSTALL_IPC_CHANNELS.replay,
	]) {
		assert.ok(
			sendBlock.includes(JSON.stringify(channel)),
			`the preload's outbound allowlist does not carry ${channel}`,
		);
	}
	assert.ok(
		onBlock.includes(JSON.stringify(INSTALL_IPC_CHANNELS.progress)),
		`the preload's inbound allowlist does not carry ${INSTALL_IPC_CHANNELS.progress}`,
	);
});

test("the window, the story and the capture tuple agree on one size", () => {
	/*
	 * The size half of the pair the canvas test beside it covers (design D15), and
	 * the guard the round-1 blocker did not have: 640x480 is stated in three files
	 * that nothing related - the window the app builds, the story's viewport, and
	 * the capture tuple that sizes the browser - so changing any one of them
	 * silently re-creates the defect where every frame was shot at a size the app
	 * never used. The frames cannot catch that on their own: they are internally
	 * consistent whatever the other two say.
	 */
	const main = readFileSync("src/main/backend/backend-installer.ts", "utf8");
	const story = readFileSync(
		"src/renderer/src/features/installer/components/installer-content.stories.tsx",
		"utf8",
	);
	const rig = readFileSync("scripts/capture-evidence.mjs", "utf8");
	const window = main.match(
		/useContentSize: true,\s*width: (\d+),\s*height: (\d+),/,
	);
	assert.ok(window, "the preparation window no longer pins a content size");
	const viewport = story.match(
		/styles: \{ width: "(\d+)px", height: "(\d+)px" \}/,
	);
	assert.ok(viewport, "the installer story no longer declares a viewport");
	const rows = [
		...rig.matchAll(
			/\["installer-installercontent--([a-z-]+)", (\d+), (\d+)\]/g,
		),
	];
	assert.ok(
		rows.length >= 5,
		`the capture tuple lists ${rows.length} installer stories`,
	);
	for (const [, name, width, height] of rows) {
		assert.equal(
			`${width}x${height}`,
			`${window[1]}x${window[2]}`,
			`${name} is captured at ${width}x${height} while the window builds ${window[1]}x${window[2]}`,
		);
	}
	assert.equal(
		`${viewport[1]}x${viewport[2]}`,
		`${window[1]}x${window[2]}`,
		"the story's viewport and the window's content size disagree",
	);
});

const PHASE_ORDER = ["python", "environment", "components", "verify"];
const noop = () => {};

/** The panel's props for a run state, with the paths a story does not exercise off. */
const panelProps = (overrides) => ({
	phase: null,
	installed: false,
	failure: null,
	onCancel: noop,
	onRetry: noop,
	...overrides,
});

/** A rendered failure, through the same sentence the main process falls back to. */
const failureFor = (phase) => ({
	phase,
	reason: progress.installFailureSentence(phase),
	detail: null,
	exitCode: 1,
});

/** The rail's `<li>` chunks, in order, out of a rendered panel. */
function railRows(markup) {
	const list = markup.slice(markup.indexOf("<ol"), markup.indexOf("</ol>"));
	return list
		.split("<li")
		.slice(1)
		.map((chunk) => chunk.slice(0, chunk.indexOf("</li>")));
}

/**
 * A row's connector classes, or null when the row draws no rule.
 *
 * Matched on `origin-top`, which is the rule's own transform origin rather than a
 * string in a comment about it - the whole point of rendering.
 */
function connectorOf(row) {
	const span = row.match(/<span[^>]*class="([^"]*\borigin-top\b[^"]*)"/);
	return span ? span[1].split(/\s+/) : null;
}

/** A row's marker classes: the first element carrying the marker's own colour role. */
function markerOf(row) {
	const elements = [...row.matchAll(/<(?:span|svg)[^>]*class="([^"]*)"/g)].map(
		(match) => match[1],
	);
	const marker = elements.find((classes) =>
		/bg-accent|border-control|border-t-accent|text-danger/.test(classes),
	);
	return marker ? marker.split(/\s+/) : null;
}

/*
 * The three utilities that suppress an element's visibility in this codebase. A
 * rule that keeps its `scale-y-100` and gains one of these is a rule the path
 * never draws, which is exactly the mutation a source-shaped assertion missed.
 */
const SUPPRESSES_VISIBILITY = ["hidden", "invisible", "opacity-0"];

test("the rail draws a rule only under a step that finished", () => {
	/*
	 * The invariant the whole redesign rests on: a connector is whole exactly when
	 * the step above it finished, and no other state can fill it. Read from the
	 * rendered rows against an expectation derived from the payload - never from the
	 * source, because the source version of this assertion matched an expression 24
	 * characters away from the element it named and stayed green both with the
	 * connector hidden and with it made unconditional (review P2, both mutation-tested).
	 */
	const runs = [
		{ phase: "python", drawn: [false, false, false] },
		{ phase: "components", drawn: [true, true, false] },
		{ phase: "verify", drawn: [true, true, true] },
		{ phase: null, drawn: [false, false, false] },
		{ phase: "verify", installed: true, drawn: [true, true, true] },
	];
	for (const { phase, installed = false, drawn } of runs) {
		const rows = railRows(renderPanel(panelProps({ phase, installed })));
		assert.equal(
			rows.length,
			4,
			`a rail of four steps rendered ${rows.length} rows`,
		);
		drawn.forEach((expected, index) => {
			const classes = connectorOf(rows[index]);
			assert.ok(classes, `row ${index + 1} draws no rule at all`);
			assert.deepEqual(
				classes.filter((name) => SUPPRESSES_VISIBILITY.includes(name)),
				[],
				`row ${index + 1}'s rule is suppressed rather than scaled`,
			);
			assert.equal(
				classes.includes("scale-y-100"),
				expected,
				`row ${index + 1}'s rule disagrees with the step above it (phase ${phase}, installed ${installed})`,
			);
		});
		/*
		 * The last row draws no rule of its own: what reaches the terminus is drawn by
		 * the terminus, so the two cannot disagree about whether the run finished.
		 */
		assert.equal(
			connectorOf(rows[3]),
			null,
			"the last row draws a rule as well",
		);
	}
});

test("the rail's markers follow the run's own state", () => {
	/*
	 * The grammar, as rendered: a finished step is the accent fill, the running one
	 * is the ring that turns, a waiting one is the control-weight ring, and the
	 * failed one is the alert glyph. The waiting ring's WEIGHT is pinned here rather
	 * than left to a comment because it is a measured fix: at 1px on 8px it rendered
	 * 2.76:1 darkest in the light themes, under the 3:1 floor the sole boundary of a
	 * control has to clear (design D4), so a change back to `border` is a regression
	 * this test should refuse.
	 */
	const rows = railRows(renderPanel(panelProps({ phase: "components" })));
	for (const [index, row] of rows.entries()) {
		assert.ok(markerOf(row), `row ${index + 1} renders no marker at all`);
	}
	assert.ok(
		markerOf(rows[0]).includes("bg-accent"),
		"a finished step is not filled",
	);
	assert.ok(
		markerOf(rows[2]).includes("animate-install-turn"),
		"the running step's marker does not turn",
	);
	assert.ok(
		!markerOf(rows[2]).includes("bg-accent"),
		"the running step is drawn as a finished one",
	);
	/*
	 * And the RUNNING ring's stroke is pinned for the same reason the waiting
	 * ring's weigh is, one block down: design round 2's D7 - the working mark
	 * shipped in the faintest border token and measured 1.22:1 against the
	 * waiting rings' 3.13-3.42:1, so the mark that says "working" was the
	 * faintest object in the column. `border-control` is the floor; the accent
	 * quadrant is the one channel telling the two rings apart besides the turn.
	 */
	for (const name of ["border-2", "border-control", "border-t-accent"]) {
		assert.ok(
			markerOf(rows[2]).includes(name),
			`a running ring no longer draws the floored stroke (missing ${name})`,
		);
	}
	for (const name of ["border-2", "border-control"]) {
		assert.ok(
			markerOf(rows[3]).includes(name),
			`a waiting ring no longer clears its floor (missing ${name})`,
		);
	}
});

test("the rail claims work is happening only while it is", () => {
	/*
	 * Two compositions, one rule, and this rail has got each of them wrong once:
	 *
	 *  - the head mark exists exactly when work is happening AND no step is known;
	 *  - a failure that named no phase also leaves `phase === null`, so a gate on the
	 *    phase alone painted a turning "work is happening" mark above four hollow
	 *    rings on a screen that said setup had stopped (review P1). That state is why
	 *    this renders a payload instead of trusting a gate, and why it pins the
	 *    finished rail's terminus glyph in the same breath: a state that says "done"
	 *    and a state that says "working" must not be able to render at once.
	 */
	const turning = (markup) =>
		(markup.match(/animate-install-turn/g) ?? []).length;

	const unannounced = renderPanel(panelProps({}));
	assert.equal(turning(unannounced), 1, "no mark while work is unannounced");
	assert.ok(
		unannounced.indexOf("animate-install-turn") < unannounced.indexOf("<li"),
		"the unannounced mark is not at the rail's head",
	);
	/*
	 * The head mark draws the same ring the running step does (design round 2,
	 * D7: both sites were `hairline`, both are `control` now), so the stroke is
	 * pinned here as well - a single-site pin would stay green while this one
	 * regressed.
	 */
	const headMark = unannounced
		.slice(0, unannounced.indexOf("<li"))
		.match(/class="([^"]*animate-install-turn[^"]*)"/);
	assert.ok(headMark, "the unannounced head mark renders no element");
	for (const name of ["border-2", "border-control", "border-t-accent"]) {
		assert.ok(
			headMark[1].split(/\s+/).includes(name),
			`the head mark no longer draws the floored stroke (missing ${name})`,
		);
	}

	const running = renderPanel(panelProps({ phase: "components" }));
	assert.equal(
		turning(running),
		1,
		"the running rail draws more than one mark",
	);
	assert.ok(
		railRows(running)[2].includes("animate-install-turn"),
		"the mark is not on the running step's row",
	);

	for (const phase of [null, "components"]) {
		const failed = renderPanel(
			panelProps({ phase, failure: failureFor(phase) }),
		);
		assert.equal(
			turning(failed),
			0,
			`a failure still claims work is happening (${phase})`,
		);
	}

	const finished = renderPanel(
		panelProps({ phase: "verify", installed: true }),
	);
	assert.equal(turning(finished), 0, "the finished rail is still working");
	assert.ok(
		finished.includes("text-success"),
		"the finished rail ends in nothing rather than in a glyph",
	);
	/* And the terminus is the only glyph: the four rows are still dots. */
	for (const row of railRows(finished)) {
		assert.ok(
			!row.includes("text-success"),
			"a row carries the terminus glyph",
		);
	}
});

test("the panel states distance in steps, never as a fraction of the run", () => {
	/*
	 * The rail replaced a bar whose fill was `indexOf(phase)/4`. That expression is
	 * the defect this change exists to remove, so it is pinned rather than described
	 * in a comment: `python` is the whole of a cold run's opening minutes and nothing
	 * is behind it, so the bar claimed 0% for all of them while `components` claimed
	 * exactly 50% for the longest step in the run - the same lie in two places,
	 * because the panel knows stage BOUNDARIES and publishes nothing inside one.
	 *
	 * WHAT THE FIRST VERSION OF THIS TEST MISSED (review P3). It banned
	 * `/percent|style=\{\{\s*width/`, which fails on a COMMENT that merely says
	 * "percent" and passes on a fraction reintroduced the likelier way in a
	 * Tailwind-classed component: a width utility (`w-1/2`). So this reads the code
	 * with its comments stripped - prose about fractions is not a fraction - and it
	 * bans the arbitrary-value route too, because that is how the connector's own
	 * `scale-y-*` would carry one.
	 */
	const panel = readFileSync(
		"src/renderer/src/features/installer/components/installer-panel.tsx",
		"utf8",
	);
	const code = panel
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
	const fractionSpellings = [
		[/percent/i, "a percentage"],
		[/%\]/, "an arbitrary-value percentage"],
		[/style=\{\{\s*width/, "an inline width"],
		[/\bw-\d+\/\d+/, "a fractional width utility"],
	];
	for (const [pattern, what] of fractionSpellings) {
		assert.ok(
			!pattern.test(code),
			`the installer panel sizes a progress element with ${what}`,
		);
	}
	/*
	 * And the same ban on what it RENDERS, in each state the run passes through: a
	 * fraction assembled at runtime is a fraction the source never spells.
	 */
	for (const phase of [...PHASE_ORDER, null]) {
		const markup = renderPanel(panelProps({ phase }));
		assert.ok(
			!/\bw-\d+\/\d+/.test(markup),
			`a rendered row is sized as a fraction of the run (phase ${phase})`,
		);
	}
});

test("the window and the main process name the same channels", () => {
	const main = readFileSync("src/main/backend/backend-installer.ts", "utf8");
	const renderer = readFileSync(
		"src/renderer/src/features/installer/use-install-progress.ts",
		"utf8",
	);
	// Both sides go through the contract's constants, so this asserts the wiring
	// rather than the spelling - a hand-written channel name on either side is the
	// failure this catches.
	for (const source of [main, renderer]) {
		assert.ok(source.includes("INSTALL_IPC_CHANNELS"));
	}
	assert.ok(main.includes("INSTALL_IPC_CHANNELS.progress"));
	assert.ok(main.includes("INSTALL_IPC_CHANNELS.replay"));
	assert.ok(renderer.includes("INSTALL_IPC_CHANNELS.cancel"));
	assert.ok(renderer.includes("INSTALL_IPC_CHANNELS.retry"));
	assert.ok(renderer.includes("INSTALL_IPC_CHANNELS.progress"));
});

test("the main process actually consumes the markers it reads off stdout", () => {
	/*
	 * THE TEST THAT WAS MISSING, and the reason a green suite shipped a channel the
	 * app never read (review R1-1, UX U1). Everything else in this file proves the
	 * PARSER is right; nothing proved anything CALLED it. `parseInstallMarker` and
	 * `splitLines` had exactly one caller in the tree - this file - so
	 * `|LO1:environment` and `|LO1:components` were printed by the scripts, written
	 * to the installer log, and dropped, and the panel could only ever go
	 * `python -> verify`. It sat on "Preparing Python" for 2m37s of a real 3m11s
	 * install, and named that phase when a pip failure had happened two phases
	 * later.
	 *
	 * WHY THE REGION AND NOT THE FILE. A membership check over the whole module is
	 * satisfied by a mention in a comment or in `runInstallScript`'s type - the
	 * first version of this test was exactly that shape. The assertion is therefore
	 * scoped to the stdout `data` handler's own body, which is the one place a
	 * marker arrives, and it requires all three calls IN ORDER: split the chunk,
	 * parse each complete line, hand the phase to the sink the window reads.
	 */
	const source = readFileSync("src/main/backend/backend-installer.ts", "utf8");
	const handlerStart = source.indexOf('stdout.on("data"');
	assert.ok(
		handlerStart > 0,
		"the install script's stdout handler is gone, so no marker can be read",
	);
	/*
	 * BOUNDED BY THE NEXT STRUCTURAL MARKER, not by the first `});` (review R2-N1).
	 * `indexOf("});")` happened to land on this handler's own close, but only
	 * because its first statement is a call that opens no closure - a one-line
	 * reshape inside the handler (an early return, a nested call) would have shrunk
	 * the region silently and left this test passing over a body it never read,
	 * which is the failure mode it exists to catch. The stderr block is the next
	 * sibling in the same method and cannot appear inside this one.
	 */
	const nextSibling = source.indexOf(
		"this.installProcess.stderr",
		handlerStart,
	);
	const handler = source.slice(
		handlerStart,
		nextSibling > handlerStart ? nextSibling : undefined,
	);
	const split = handler.indexOf("splitLines(");
	const parse = handler.indexOf("parseInstallMarker(");
	const sink = handler.indexOf("rememberInstallPhase(");
	assert.ok(
		split > 0,
		"the stdout handler does not split its chunks into lines",
	);
	assert.ok(parse > split, "the handler does not parse the lines it split");
	assert.ok(
		sink > parse,
		"the handler parses a phase and never tells the window's sink",
	);
});

test("the chunks a real install writes arrive as phases", () => {
	/*
	 * The runtime half of the test above: the same three calls, over output shaped
	 * like the pipe's, so the ORDER asserted in the source is also the order that
	 * works. The script's two markers are fed as the pipe splits them - one of them
	 * across a chunk boundary, because that is the case a per-chunk parser loses
	 * silently.
	 */
	const seen = [];
	const sink = (phase) => seen.push(phase);
	let carry = "";
	for (const chunk of [
		"Creating virtual environment at /tmp/venv...\n|LO1:envir",
		"onment\nSuccessfully created virtual environment\n|LO1:components\n",
	]) {
		const split = splitLines(carry, chunk);
		carry = split.carry;
		for (const line of split.lines) {
			const phase = parseInstallMarker(line);
			if (phase !== null) sink(phase);
		}
	}
	assert.deepEqual(seen, ["environment", "components"]);
	// And the narration around them is not a milestone, which is the half that
	// keeps a stray log line from moving the stepper.
	assert.equal(
		parseInstallMarker("Creating virtual environment at /tmp/venv..."),
		null,
	);
	assert.equal(carry, "");
});

test("the ground Electron paints is the ground the panel paints", () => {
	/*
	 * The pair is a hand-copied duplicate in the main process - it has to be, since
	 * it is painted before any theme module loads - and the previous copy had
	 * already drifted: `#16130e` is not this palette's `canvas` at all but its
	 * `onAccent`, i.e. ink painted underneath the whole window, measured at deltaE
	 * 3.94 / 1.14:1 against the ground every frame after it shows (design D2). A
	 * one-frame flash at launch is exactly what no still can show, which is why
	 * this needed asserting rather than looking at.
	 *
	 * Read from the GENERATED CSS rather than from the palette module, because the
	 * generated file is what the renderer's role utilities actually compile
	 * against: a palette edit that never regenerates would otherwise pass here.
	 */
	const css = readFileSync(
		"src/renderer/src/styles/themes.generated.css",
		"utf8",
	);
	const block = css.slice(css.indexOf('[data-theme="localOperatorDark"]'));
	const canvas = block.match(/--lo-canvas:\s*(#[0-9a-fA-F]{6})/)?.[1];
	assert.ok(
		canvas,
		"localOperatorDark has no --lo-canvas in the generated CSS",
	);
	assert.equal(
		canvas.toLowerCase(),
		INSTALL_WINDOW_CANVAS.toLowerCase(),
		"the window's pre-first-frame ground and the panel's canvas have drifted apart",
	);
});

test("an unreachable index is not reported as a missing file", async () => {
	/*
	 * The cause a real first-run failure got wrong (UX U4). The panel said "A file
	 * the setup needed was missing, which usually means the download or the copy did
	 * not finish" for a run whose log said
	 * `ERROR: Could not find a version that satisfies the requirement
	 * local-operator (from versions: none)` - pip failing to REACH the index.
	 * `could not find` swallowed pip's sentence, so the user was sent looking for a
	 * broken download and never told the one remedy that helps.
	 *
	 * Asserted against the two spellings pip uses for the same failure and against
	 * the file case it used to be confused with, because the fix is an ORDER (the
	 * index entry sits above the file one), and an order is what a test can hold.
	 */
	const causes = await bundleLeaf("./src/main/backend/setup-failure-causes.ts");
	assert.match(
		causes.setupFailureCause(
			new Error(
				"ERROR: Could not find a version that satisfies the requirement local-operator (from versions: none)",
			),
		),
		/package index/,
	);
	assert.match(
		causes.setupFailureCause(
			new Error("ERROR: No matching distribution found for local-operator"),
		),
		/package index/,
	);
	// The file case still reads as one, and the disk case still outranks it.
	assert.match(
		causes.setupFailureCause(new Error("ENOENT: no such file or directory")),
		/missing/,
	);
	assert.match(
		causes.setupFailureCause(
			new Error("OSError: [Errno 28] No space left on device"),
		),
		/disk space/,
	);
});

test("a certificate verdict separates trust from expiry, and neither claims the other's remedy", async () => {
	/*
	 * Review round 1's R1-3: the verification entry used to carry a bare
	 * `SSLError` alternative, so EVERY SSL-shaped failure - an expired
	 * certificate, a proxy answering plain HTTP, an aborted handshake - was
	 * answered with "ask IT for the root certificate", which only one of the
	 * three causes deserves. The three strings below are the reviewer's own
	 * reproductions, in their shapes; `null` is the honest answer for the two
	 * that are not trust problems, because the app's generic sentence is true of
	 * them and the certificate remedy is not.
	 */
	const causes = await bundleLeaf("./src/main/backend/setup-failure-causes.ts");
	// The verification words still get the store remedy - uv's spelling and
	// pip's, the two clients the install path actually runs.
	assert.match(
		causes.setupFailureCause(
			new Error("uv: invalid peer certificate: UnknownIssuer"),
		),
		/root certificate/,
	);
	assert.match(
		causes.setupFailureCause(
			new Error(
				"SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1006)'))",
			),
		),
		/root certificate/,
	);
	// An expired certificate goes to the clock instead, and the ORDER is the
	// mechanism: the raw text carries `CERTIFICATE_VERIFY_FAILED` too, so only
	// the expiry entry sitting above the verification one can answer first.
	assert.match(
		causes.setupFailureCause(
			new Error(
				"SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: certificate has expired (_ssl.c:1006)'))",
			),
		),
		/date and time/,
	);
	// The two SSL shapes that are neither a trust problem nor an expiry fall
	// through to the generic cause rather than borrowing the certificate remedy.
	assert.equal(
		causes.setupFailureCause(
			new Error("SSLError(1, '[SSL: WRONG_VERSION_NUMBER]')"),
		),
		null,
		"a proxy answering plain HTTP is not a certificate the user can add",
	);
	assert.equal(
		causes.setupFailureCause(
			new Error(
				"SSLError(SSLEOFError(8, 'EOF occurred in violation of protocol'))",
			),
		),
		null,
		"an aborted handshake is not a certificate the user can add either",
	);
});

test("a probe's answer never becomes the reason a setup failed", () => {
	/*
	 * Captured from a REAL run of the shipped macOS script against an unreachable
	 * index (`PIP_INDEX_URL=http://127.0.0.1:9/simple`, a real `PYTHON_BIN`, this
	 * machine, 2026-09-21). The failing branch prints pip's error and then runs its
	 * own `curl -sI` reachability check, whose lowercase headers are the LAST thing
	 * the run writes - so the previous "last non-noise line" rule offered the user
	 * `content-length: 27965` while pip's error sat four lines above it.
	 */
	const stdout = [
		installMarker("components"),
		"Installing local-operator package...",
		"ERROR: Failed to install local-operator package. Exit code: 1",
		"Python version:",
		"Python 3.13.7",
		"=== Diagnostic Information ===",
		"Checking PyPI connectivity...",
		"HTTP/2 200",
		"content-length: 27965",
		"x-content-type-options: nosniff",
		"permissions-policy: publickey-credentials-create=(self)",
	].join("\n");
	const stderr = [
		"ERROR: Could not find a version that satisfies the requirement local-operator (from versions: none)",
		"ERROR: No matching distribution found for local-operator",
	].join("\n");
	assert.equal(
		installFailureReason(stdout, stderr),
		"ERROR: Failed to install local-operator package. Exit code: 1",
	);
	// With no error-shaped line anywhere, the last real line is still the answer -
	// the tiering is a preference, not a filter that empties the field.
	assert.equal(
		installFailureReason("Starting the install\nBackend directory ready\n", ""),
		"Backend directory ready",
	);
	// And a header line alone is not a reason.
	assert.equal(
		installFailureReason("HTTP/2 200\ncontent-length: 27965\n", ""),
		null,
	);
});

/* ---------------------------------------------- first-run onboarding (U8/D9) */

/**
 * The bundled uv's own narration of a real cold install, verbatim from a run of
 * the shipped macOS script on 2026-10-08 (uv 0.12.17, empty cache): the lines
 * the sub-progress is folded from. Taken from a run rather than written, for the
 * reason the fixture above gives - a parser pinned to invented lines proves
 * nothing about the client that prints them.
 */
/** The word the old expectation line used for a wait that now takes seconds. */
const MINUTES_WORD = /minutes/;

const UV_COLD_RUN = [
	"Installing local-operator with uv (uv 0.12.17 (635500036 2026-09-18 aarch64-apple-darwin))...",
	"Using Python 3.14.3 environment at: support/managed-venv",
	"Resolved 55 packages in 888ms",
	"Downloading pydantic-core (1.9MiB)",
	"Downloading local-operator (13.5MiB)",
	"Downloading cryptography (3.7MiB)",
	"Downloading pillow (4.6MiB)",
	"Downloading pygments (1.2MiB)",
	"Downloading pillow-heif (4.1MiB)",
	" Downloaded pygments",
	" Downloaded pydantic-core",
	" Downloaded cryptography",
	" Downloaded pillow-heif",
	" Downloaded pillow",
	" Downloaded local-operator",
	"Prepared 55 packages in 6.11s",
	"Installed 55 packages in 73ms",
	" + annotated-doc==0.0.5",
];

test("uv's own narration folds into counts, and the line only moves forward", () => {
	/*
	 * Consecutive repeats are collapsed: a new `Downloading X` line moves the fold
	 * (the started count is real) without changing the sentence, so what this
	 * asserts is the sequence a READER sees rather than the sequence of sends.
	 * The collapse is what makes "monotonic" checkable - a repeat can hide a
	 * regression, a changed line cannot.
	 */
	const seen = [];
	let sub = EMPTY_SUB_PROGRESS;
	for (const line of UV_COLD_RUN) {
		const next = foldInstallLine(sub, line);
		if (next !== sub) {
			const rendered = installSubProgressLine(next);
			if (rendered !== seen[seen.length - 1]) seen.push(rendered);
		}
		sub = next;
	}
	/*
	 * EVERY LINE HERE IS MONOTONIC, which is the property design round 1 (D3) and
	 * code review round 1 (R2) both filed against: the old shape printed a
	 * fraction whose denominator grew with the work uv was still discovering.
	 * The count of finished files only ever rises, and the sentence under it
	 * carries the constant `Resolved N` rather than a second moving number.
	 */
	assert.deepEqual(seen, [
		"Found 55 packages to fetch.",
		"Fetching the large files\u2026",
		"1 large download finished \u00b7 55 packages in all.",
		"2 large downloads finished \u00b7 55 packages in all.",
		"3 large downloads finished \u00b7 55 packages in all.",
		"4 large downloads finished \u00b7 55 packages in all.",
		"5 large downloads finished \u00b7 55 packages in all.",
		"6 large downloads finished \u00b7 55 packages in all.",
		"Unpacking and finishing up.",
	]);
	// A line that says nothing returns the SAME object, which is what lets the
	// main process skip a send for every `+ package==x` line.
	assert.equal(foldInstallLine(sub, " + anyio==4.15.1"), sub);
	// pip's narration counts too, when uv is absent.
	let pip = foldInstallLine(EMPTY_SUB_PROGRESS, "Collecting local-operator");
	pip = foldInstallLine(pip, "Collecting httpx>=0.28");
	assert.equal(installSubProgressLine(pip), "Fetched 2 packages so far.");

	/*
	 * THE SHAPE THE OLD CODE GOT WRONG, folded from pip's real narration (the
	 * repro in code review round 1, R2): pip prints `Downloading X (size)` and NO
	 * `Downloaded X` line, so `downloadsDone` stays 0 forever while
	 * `downloadsStarted` climbs. The old line read `0 of 1`, `0 of 2`, ... `0 of
	 * 10 large downloads done` - a growing denominator over a stuck zero, on the
	 * screen whose whole job is to prove the install is moving. The collected
	 * count is the honest fact pip does give, and it is what the line now falls
	 * back to; the test above could not catch this because it fed bare
	 * `Collecting` lines with no download line in front of them.
	 */
	const pipRealNarration = [
		"Collecting local-operator",
		"  Downloading local_operator-0.30.6-py3-none-any.whl (13.5 MB)",
		"Collecting pydantic",
		"  Downloading pydantic-2.11.9-py3-none-any.whl (444 kB)",
		"Collecting cryptography",
		"  Downloading cryptography-45.0.7-cp39-abi3-macosx_10_12_universal2.whl (4.2 MB)",
		"Installing collected packages: local-operator, pydantic, cryptography",
		"Successfully installed cryptography-45.0.7 local-operator-0.30.6 pydantic-2.11.9",
	];
	const pipLines = [];
	let pipSub = EMPTY_SUB_PROGRESS;
	for (const line of pipRealNarration) {
		const next = foldInstallLine(pipSub, line);
		if (next !== pipSub) {
			const rendered = installSubProgressLine(next);
			if (rendered !== pipLines[pipLines.length - 1]) pipLines.push(rendered);
		}
		pipSub = next;
	}
	assert.deepEqual(pipLines, [
		"Fetched 1 package so far.",
		"Fetched 2 packages so far.",
		"Fetched 3 packages so far.",
		"Unpacking and finishing up.",
	]);
	// And nothing in the whole narration ever prints a zero denominator.
	assert.ok(
		pipLines.every((line) => !/\b0 of\b/.test(line ?? "")),
		"the pip fallback still prints a stuck zero",
	);
	assert.equal(installSubProgressLine(EMPTY_SUB_PROGRESS), null);
	assert.equal(installSubProgressLine(null), null);
});

test("the estimate is the measured baselines, rounded, and never negative", () => {
	const mac = INSTALL_PHASE_BASELINE_MS.darwin;
	// Every platform has a baseline for every phase, and the cold total the
	// window promises fits the operator's <30 s target with headroom on macOS.
	for (const platform of ["darwin", "win32", "linux"])
		for (const phase of INSTALL_PHASES)
			assert.ok(INSTALL_PHASE_BASELINE_MS[platform][phase] > 0);
	const total = INSTALL_PHASES.reduce((sum, phase) => sum + mac[phase], 0);
	assert.ok(total < 30_000, `macOS baselines sum to ${total} ms`);
	// At the start of `components`: its own baseline plus `verify`, to 5 s.
	/*
	 * `components` + `verify` at the start of `components`. It moved from 15 s
	 * when QA's cold 8.08 s reading for that phase showed the old 8 s baseline had
	 * no headroom at all (Q-1) - the number is the measured figure plus headroom,
	 * so this expectation moves with it.
	 */
	assert.equal(installEta("darwin", "components", 0), "about 20 s left");
	// Small numbers are exact, so the last seconds count down one by one.
	assert.equal(installEta("darwin", "verify", 0), "about 4 s left");
	// Outrunning a phase is said in words, never as a negative count - and the
	// sentence needs INSTALL_OVERRUN_FACTOR times the budget, not one millisecond
	// past it (QA round 2, Q2-1): at the budget itself the estimate is only the
	// later phases' time, because the budget already carries headroom.
	assert.equal(
		installEta("darwin", "components", mac.components),
		"about 4 s left",
	);
	assert.equal(
		installEta("darwin", "components", mac.components * INSTALL_OVERRUN_FACTOR),
		"about 4 s left",
	);
	assert.equal(
		installEta(
			"darwin",
			"components",
			mac.components * INSTALL_OVERRUN_FACTOR + 1,
		),
		"taking longer than usual",
	);
	/*
	 * AND THE FACTOR'S VALUE IS PINNED BY ABSOLUTE CASES, not only by the edge
	 * cases above (code review round 3, R3-1): those compare against the constant,
	 * so a mutant moved the boundary with them - 1.0 kept the suite green (QA's
	 * loaded 15.56 s reading would print the sentence again, the behaviour Q2-1
	 * removed) and 5.0 did too. These two cannot move with it: a reading inside a
	 * 1.5x rule must stay a number, and one DOUBLE the budget must be the sentence.
	 */
	assert.equal(installEta("darwin", "components", 15_560), "about 4 s left");
	assert.equal(
		installEta("darwin", "components", mac.components * 2),
		"taking longer than usual",
	);
	/*
	 * And the value itself, because it is a decision rather than a derived
	 * quantity: the two cases above bound it to (1.11, 2.0] - QA's loaded reading
	 * over the budget is the lower bound and twice the budget the upper - and this
	 * says which point in that band was chosen, so changing the factor means
	 * changing this line deliberately, in the same commit.
	 */
	assert.equal(INSTALL_OVERRUN_FACTOR, 1.5);
	assert.equal(installPlatform("freebsd"), "linux");
	assert.equal(formatElapsed(0), "0:00");
	assert.equal(formatElapsed(67_400), "1:07");
	assert.doesNotMatch(INSTALL_EXPECTATION, MINUTES_WORD);
});

test("every baseline that can overrun carries headroom over its own measurement", () => {
	/*
	 * THE TABLE'S PROVENANCE CLAIM AS DATA (code review round 2, M-3): the comment
	 * over `INSTALL_PHASE_BASELINE_MS` says the overrun-capable entries are the
	 * measured figure plus 1.5x-or-more, and half of them were not - a datacentre
	 * runner's own time is a measurement, not a budget. The measured figures are
	 * the ones the comment names, so a re-pin to a measurement fails here rather
	 * than in the field.
	 */
	const measured = {
		darwin: { environment: 1_900, components: 8_080 },
		win32: { environment: 6_400, components: 8_900 },
		linux: { environment: 3_200, components: 7_600 },
	};
	for (const [platform, phases] of Object.entries(measured))
		for (const [phase, ms] of Object.entries(phases))
			assert.ok(
				INSTALL_PHASE_BASELINE_MS[platform][phase] >= ms * 1.5,
				`${platform} ${phase}: ${INSTALL_PHASE_BASELINE_MS[platform][phase]} ms is not 1.5x the measured ${ms} ms`,
			);
});

test("a phase payload's timing is admitted whole or not at all", () => {
	const timing = {
		startedAt: 1,
		phaseStartedAt: 2,
		platform: "darwin",
		sub: null,
	};
	assert.ok(
		isInstallProgressPayload({ kind: "phase", phase: "components", ...timing }),
	);
	assert.ok(
		isInstallProgressPayload({
			kind: "phase",
			phase: "components",
			...timing,
			sub: foldInstallLine(EMPTY_SUB_PROGRESS, "Resolved 3 packages in 1ms"),
		}),
	);
	// Half a clock would render "about NaN s left"; refused rather than painted.
	assert.ok(
		!isInstallProgressPayload({
			kind: "phase",
			phase: "components",
			startedAt: 1,
		}),
	);
	assert.ok(
		!isInstallProgressPayload({
			kind: "phase",
			phase: "components",
			...timing,
			platform: "plan9",
		}),
	);
	assert.ok(
		!isInstallProgressPayload({
			kind: "phase",
			phase: "components",
			...timing,
			sub: { resolved: "many" },
		}),
	);
});
