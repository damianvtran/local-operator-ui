import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * What the update panel says while an install runs, and after one lands.
 *
 * WHY THESE ARE ASSERTED AT ALL (UX U4, U5, U3). The panel used to have one sentence
 * for the whole pre-quit wait - a button label - and, after a successful direct
 * install, nothing at all: the window came back in seconds, so the app's return
 * stopped being the report that the update had gone in. The other direction was a
 * sentence that promised minutes for a window that is now seconds, which is a claim
 * about the world rather than a label, and the failure mode of a wrong one is a
 * person reopening the app into the swap.
 *
 * The assertions drive the SHIPPED module (bundled from `src/`, then called) and read
 * the shipped component for the wiring, so a second copy of the wording inside the
 * component is what fails rather than what passes.
 */
const bundle = await build({
	stdin: {
		contents: `export { installPhaseCopy, installSucceededCopy } from "./src/renderer/src/shared/utils/update-install-copy";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: { "@shared": "./src/renderer/src/shared" },
	write: false,
});
const { installPhaseCopy, installSucceededCopy } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const COMPONENT =
	"src/renderer/src/shared/components/common/update-notification.tsx";

test("every pre-quit step has its own sentence, and the unknown step claims the least", () => {
	const phases = ["verifying", "staging", "starting"];
	const sentences = phases.map((phase) => installPhaseCopy(phase));
	for (const sentence of sentences) {
		assert.equal(typeof sentence, "string");
		assert.ok(sentence.length > 0);
		assert.match(
			sentence,
			/\.\.\.$|…$/,
			`${sentence} does not read as in progress`,
		);
	}
	// One sentence per step: a phase that reused another's wording would tell the
	// person nothing about what is happening.
	assert.equal(new Set(sentences).size, phases.length);
	// The null phase is "the button has been pressed and the main process has not
	// named a step yet", and the honest answer for it is the vaguest one.
	assert.equal(installPhaseCopy(null), "Preparing to install…");
	assert.equal(installPhaseCopy(undefined), installPhaseCopy(null));

	/*
	 * And none of them promises a duration. That is the shape of the defect this
	 * replaces: the closed-window notice said "this can take a few minutes" for a
	 * window that a direct install finishes in 2-5 s, so the sentence a person acts
	 * on was wrong by two orders of magnitude.
	 */
	for (const sentence of [...sentences, installPhaseCopy(null)]) {
		assert.doesNotMatch(
			sentence,
			/minute|second|hour|while you wait/i,
			sentence,
		);
	}
});

test("the affirmation names the version it landed on, and claims only that", () => {
	const sentence = installSucceededCopy("0.30.0");
	assert.match(sentence, /updated to v0\.30\.0/);
	// It is a reading of the version the install was for - which is the version the
	// app is running by the time this is shown - and it says nothing about what the
	// update contained or what the person should do next.
	assert.doesNotMatch(sentence, /restart|please|simply|successfully/i);
	assert.notEqual(installSucceededCopy("0.30.1"), sentence);
});

test("the panel uses these sentences rather than a copy of them", async () => {
	const source = await readFile(COMPONENT, "utf8");
	// The JSX wraps its sentences across lines, so the assertions below are made
	// against the text with its whitespace collapsed: what is being checked is the
	// sentence a person reads, not how it was laid out in the file.
	const prose = source.replace(/\s+/g, " ");
	// Imported from the module under test: a second literal in the component would
	// leave the assertions above passing while the screen said something else.
	assert.match(source, /from "@shared\/utils\/update-install-copy"/);
	assert.match(source, /installPhaseCopy\(installPhase\)/);
	assert.match(source, /installSucceededCopy\(installSucceeded\)/);
	// The three phases arrive from the main process rather than from a timer: the
	// panel must not guess which step is running.
	assert.match(source, /onUpdateInstallProgress\(/);
	assert.match(source, /onUpdateInstallSucceeded\(/);

	/*
	 * And the sentence a person reads BEFORE pressing Install now describes both
	 * paths, because both are real: a direct install is seconds, a Squirrel
	 * fallback is minutes (measured on this machine: 4 min 28.9 s). It used to
	 * promise the slow one unconditionally (UX U3), which under-sold the fast path
	 * by ~20x - and the instruction that must survive is the one the whole change
	 * rests on.
	 */
	assert.match(prose, /usually a few seconds, occasionally a few minutes/);
	assert.match(prose, /Don't reopen it until it starts by itself\./);
	assert.match(
		prose,
		/Opening it while the update is installing cancels the install\./,
	);
});

/**
 * One sentence names the step, and it is the current attempt's.
 *
 * WHAT WAS WRONG (UX U8, measured in round 2 by rendering the real component):
 * pressing Install now rendered the same sentence twice - the button's generic
 * "Preparing to install..." beside the status line's "Preparing to install...",
 * differing only in the ellipsis glyph - and with a phase set the pair stayed, so
 * the line never replaced the label the code comment claimed it replaced. The
 * second half is the stale phase: `installPhase` outlives a refused attempt, and
 * a second press rendered the PREVIOUS attempt's last step until the new event
 * arrived, which is the one thing the copy module's own rule forbids (an unknown
 * step must not claim to be a known one).
 */
test("the panel names the current step once, and resets it for the next attempt", async () => {
	const source = await readFile(COMPONENT, "utf8");
	// The line is the carrier, and it is the element the platform treats as a live
	// region for the result of an action.
	assert.match(
		source,
		/<output className="mt-2 block text-body text-ink-muted">\s*\{installPhaseCopy\(installPhase\)\}/,
	);
	// The button does NOT restate it while the install runs: its label is stable,
	// which is what removes the duplicate - and what stops it widening at the
	// instant of the press (UX U12's reflow, half of it, for free).
	assert.doesNotMatch(
		source,
		/installing \? "Preparing to install\.\.\." : "Install now"/,
	);
	assert.match(source, /Install now\n\s*<\/Button>/);

	// Every attempt starts from no phase: the state survives a refusal, and a
	// second press must not name the previous attempt's step while the new one is
	// only an IPC hop away. The reset is asserted BEFORE the invoke, because after
	// it the app is on its way out and nothing there reaches a renderer.
	const start = source.indexOf("const installUpdate = useCallback(");
	const installUpdate = source.slice(start, source.indexOf("}, []);", start));
	assert.ok(start > 0, "installUpdate is not in the component any more");
	assert.match(installUpdate, /setInstallPhase\(null\)/);
	assert.ok(
		installUpdate.indexOf("setInstallPhase(null)") <
			installUpdate.indexOf("quitAndInstall()"),
		"the phase is cleared after the invoke, so a stale step can still be rendered",
	);
});
