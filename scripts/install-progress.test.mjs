import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
			environment: "Creating virtual environment at $VENV_PATH",
			components: "UV_INSTALLED=false",
		},
	],
	[
		"src/main/backend/scripts/windows-install-script.ps1",
		{
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
	assert.equal(INSTALL_PHASE_LABELS.python, "Preparing the runtime");
	assert.equal(INSTALL_PHASE_LABELS.verify, "Checking the installation");
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
		assert.deepEqual(
			found.map(([, phase]) => phase),
			["environment", "components"],
			`${file} must announce exactly its two script-owned phases, in order`,
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
	assert.equal(INSTALL_PHASE_LABELS.python, "Preparing the runtime");
	assert.equal(INSTALL_PHASE_LABELS.verify, "Checking the installation");
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
		"Setup stopped while downloading components.",
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
