#!/usr/bin/env node
/**
 * The sweep's own output is the FRAMES, not the directories holding them.
 *
 * Why this is a test rather than a paragraph: `clearSweptFrames` runs once, at
 * the head of a forty-minute sweep nobody watches, and everything it gets wrong
 * is unrecoverable from the tree afterwards. Two properties it has to hold, and
 * both have already been broken once in this repository's history:
 *
 *   1. a declared set survives, whole (the frames this script cannot retake -
 *      a pointer hover, a live backend, a different source tree);
 *   2. a file the sweep did not write survives even in a directory it DID
 *      sweep. The gate counts frames, so anything else that disappears -
 *      a README explaining how a surface was captured, or the reference the
 *      tool rows were ported from - goes silently.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	PLAY_FAILURE,
	THEME_SETTLE_DEFAULT_MS,
	THEME_SETTLE_ENV,
	THEME_SETTLE_POLL_MS,
	clearSweptFrames,
	partialCaptureRecord,
	partialPassContinues,
	profileOwnerPid,
	resolveThemeSettleMs,
	storyDrew,
} from "./capture-evidence.mjs";
import { EVIDENCE_TZ, pinnedEvidenceEnv } from "./evidence-tz.mjs";

/*
 * The two patterns the theme-settle tests assert against, at the top level
 * because `lint/performance/useTopLevelRegex` is part of the contract
 * `scripts/` is held to.
 */
const THEME_SETTLE_REFUSAL = /positive whole number of milliseconds/;
const THEME_SETTLE_JOINED = /joined with '='/;
const MODULE_LOADED = /loaded/;

const build = () => {
	const out = mkdtempSync(join(tmpdir(), "lo-sweep-"));
	const write = (rel, body = "x") => {
		const path = join(out, rel);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, body);
	};
	write(
		"manifest.json",
		JSON.stringify({
			frames: 3,
			supplementary: [{ path: "kept-set", frames: 1 }],
		}),
	);
	// The sweep's own output: regenerated on every run, so it goes.
	write("swept-story/localOperatorDark.webp");
	write("swept-story/localOperatorLight.webp");
	// Written by a hand or another tool, in a directory the sweep owns.
	write("swept-story/README.md", "# how these frames were taken");
	write("swept-story/png-pair/after-1380.png");
	// Declared: this script cannot re-derive it.
	write("kept-set/localOperatorDark.webp");
	return out;
};

test("a sweep takes its frames and nothing else", () => {
	const out = build();
	const supplementary = clearSweptFrames(out);

	assert.deepEqual(supplementary, [{ path: "kept-set", frames: 1 }]);
	// (1) the declared set survives, frame and all
	assert.ok(existsSync(join(out, "kept-set/localOperatorDark.webp")));
	// (2) the stale frames go
	assert.ok(!existsSync(join(out, "swept-story/localOperatorDark.webp")));
	assert.ok(!existsSync(join(out, "swept-story/localOperatorLight.webp")));
	// ... and the prose and the hand-taken PNGs beside them do not
	assert.ok(
		existsSync(join(out, "swept-story/README.md")),
		"a README in a swept directory is not the sweep's to delete",
	);
	assert.ok(
		existsSync(join(out, "swept-story/png-pair/after-1380.png")),
		"a frame this script does not write is not part of its output",
	);
	// The manifest stays until the run replaces it, so a crash inside the sweep
	// leaves a stale-but-honest declaration rather than none.
	assert.ok(existsSync(join(out, "manifest.json")));
	assert.equal(
		JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).frames,
		3,
	);
});

test("a directory the sweep empties is removed, one that still holds prose is not", () => {
	const out = build();
	clearSweptFrames(out);
	// `swept-story` keeps its README, so it stays; `png-pair` holds a PNG, so it
	// stays too. Nothing here asserts the reverse - a directory left holding only
	// frames must go, which is the stale-surface case.
	assert.ok(existsSync(join(out, "swept-story")));
	assert.ok(existsSync(join(out, "swept-story/png-pair")));

	const bare = mkdtempSync(join(tmpdir(), "lo-sweep-bare-"));
	mkdirSync(join(bare, "gone-story"), { recursive: true });
	writeFileSync(join(bare, "gone-story", "localOperatorDark.webp"), "x");
	writeFileSync(join(bare, "manifest.json"), JSON.stringify({ frames: 1 }));
	clearSweptFrames(bare);
	assert.ok(
		!existsSync(join(bare, "gone-story")),
		"a surface whose frames all went does not stay behind empty",
	);
});

/*
 * The readiness floor, at both of its edges.
 *
 * Why this is a test rather than a paragraph in the capture script: the floor
 * read 8, the smallest story in the set draws 7 of its own elements, and
 * `chat-slash-completion--argument-phase-no-match` therefore timed out of the
 * sweep as "Storybook never finished preparing the story (60s)" while it was
 * rendering its sentence, its label and its row region the whole time. A
 * threshold that no longer admits what the app draws looks exactly like a
 * broken story from the outside, so the number has to be pinned where the next
 * person to move it can see the measurement it came from.
 */
/*
 * The play-failure guard, driven over the case that widened it.
 *
 * WHY THIS IS A TEST. The guard decides whether a frame is EVIDENCE: a story
 * whose play threw must not be photographed, because the picture then shows a
 * state the play's own assertions had just rejected. Its widening was reasoned
 * from a measured miss - the model picker's evidence pass shipped a frame whose
 * play had thrown ``TypeError: Received `callback` arg must be a function``,
 * the sweep exited 0 and printed `Captured 4 frames` - and a rule that keeps
 * being widened by hand is a rule whose next hole is found in the same place.
 * The cases that decided it are pinned here instead, and the last assertion
 * pins that the sweep still reads this constant rather than a copy of it.
 */
test("a play that threw a TypeError is caught, and a healthy console is not", () => {
	// The measured miss, verbatim from the console entry that produced it.
	assert.ok(
		PLAY_FAILURE.test("TypeError: Received `callback` arg must be a function"),
		"a TypeError out of a play is exactly the case that shipped a frame of a state the play never reached",
	);
	assert.ok(
		PLAY_FAILURE.test(
			"Error: expected 'Claude Opus 5' to equal 'Claude Opus 5.5'",
		),
		"and the plain Error an `expect` raises stays caught",
	);
	assert.ok(
		PLAY_FAILURE.test(
			"Unable to perform pointer interaction as the element has `pointer-events: none`",
		),
		"`user-event`'s own refusal is not an Error and stays named",
	);
	assert.ok(
		PLAY_FAILURE.test(
			"Uncaught Error: Cannot read properties of undefined (reading 'rows')",
		),
		"a thrown Error the page reports itself carries the `Uncaught ` prefix, and the anchor must not miss it (round 2, reviewer NIT 2)",
	);
	for (const benign of [
		"Download the React DevTools for a better development experience: https://react.dev/link/react-devtools",
		'Warning: Each child in a list should have a unique "key" prop.',
		"Models listing failed: provider anthropic did not answer",
	]) {
		assert.ok(
			!PLAY_FAILURE.test(benign),
			`a page console line that is not a thrown phase must not stop a sweep: ${benign}`,
		);
	}

	/*
	 * And the copy-drift half: the pattern exists ONCE in the sweep, at its
	 * definition, and the call site reads it by name. A second literal there -
	 * which is how this guard was widened twice - fails here.
	 */
	const source = readFileSync(
		new URL("./capture-evidence.mjs", import.meta.url),
		"utf8",
	);
	assert.equal(
		source.split("\\w*Error:").length - 1,
		1,
		"the play-failure pattern's error clause is defined once",
	);
	assert.match(
		source,
		/\.find\(\(text\) => PLAY_FAILURE\.test\(text\)\)/,
		"and the sweep matches console entries through the exported constant",
	);
});

test("the drawn-story floor rejects the decorator's own furniture", () => {
	assert.equal(storyDrew(0), false);
	assert.equal(storyDrew(1), false);
	// The preview decorator's theme wrapper and toast container, and nothing a
	// story rendered: the failure the floor exists to catch.
	assert.equal(storyDrew(2), false);
});

test("the drawn-story floor admits the smallest story in the set", () => {
	// `chat-slash-completion--argument-phase-no-match`, measured from the
	// rendered document: 7 content elements in a 9-element story root.
	assert.equal(storyDrew(9), true);
	// One element fewer than that story - a shape no story in the list has.
	assert.equal(storyDrew(8), false);
});

/*
 * The predicate is injected into the page through its own source text, so a
 * body that named a module-level constant would throw inside the browser rather
 * than here. Evaluating it in a bare scope is the same evaluation the page does.
 */
test("the predicate the page runs is the predicate this suite pins", () => {
	const inPage = new Function(`return ${storyDrew}`)();
	for (const counted of [0, 2, 8, 9, 40]) {
		assert.equal(inPage(counted), storyDrew(counted));
	}
});

/* ---- the stale-profile sweep, over a synthetic temp root ----------------- */

/*
 * The sweep's candidate rule, which used to be a loose prefix.
 *
 * `sweepStaleProfiles` reaps abandoned Chrome profiles out of the SHARED system
 * temp directory, so the only thing between it and another process's directory
 * is its own name test. That test used to be `startsWith("lo-evidence-")`, and
 * `evidence-manifest.test.mjs` built its synthetic evidence tree in that same
 * directory as `mkdtempSync(join(tmpdir(), "lo-evidence-manifest-"))` - so a
 * capture running at the same time deleted a LIVE tree out from under a test
 * that was walking it. The mechanism is worth stating, because no reading of
 * either file shows it: `Number("manifest-XXXXXX")` is `NaN`,
 * `process.kill(NaN, 0)` throws a `TypeError`, and the sweep's bare `catch` read
 * a throw that was never about a process as "no such process, so the profile is
 * abandoned".
 *
 * Why this is a test rather than a paragraph: it surfaced as flakiness - that
 * file's six `countsMean` cells share one module-scope scratch root and the
 * five that walk it fail together with an `ENOENT` on it - on a machine running
 * several lanes at once, which is the shape
 * that costs a re-run rather than a bug report. Two properties are pinned, and
 * a fix that holds only the first is a sweep that silently stopped sweeping: an
 * abandoned profile is still reaped, and a directory whose name is not a profile
 * is not deleted.
 *
 * BOTH SPELLINGS ARE PINNED, and that is the half of the repair that lives on
 * the other side of the collision. That fixture has since moved OUT of this
 * namespace - it is `lop-evidence-manifest-`, outside the profile prefix - and
 * each of its cells now builds and removes its own tree, so no name test is the
 * only thing between the sweep and a live tree any more. The RULE still has to
 * answer for the old spelling, because a lane running the pre-fix sweep deleted
 * the tree by it on a box where several checkouts run at once, and it is the
 * fixture's name that keeps this rule from reaching the fixture again: if the
 * prefix is ever widened back, both lines go red here rather than intermittently
 * in Desktop Tests.
 */

/** A pid that is certainly not running: a child that exited and was reaped. */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

/*
 * The scratch roots the test below makes, reclaimed when the file finishes.
 * They are real temp directories with a child's HOME in one of them, so leaving
 * them behind would outlive the run rather than tidy itself up.
 */
const cleaned = [];
after(() => {
	for (const dir of cleaned) rmSync(dir, { recursive: true, force: true });
});

test("the profile-name rule answers for the profile shape and nothing else", () => {
	assert.equal(profileOwnerPid("lo-evidence-4242"), 4242);
	assert.equal(profileOwnerPid("lo-evidence-1"), 1);
	// The name that made this a defect: a sibling test's LIVE scratch tree, under
	// the spelling it carried when a concurrent capture reaped it mid-walk.
	assert.equal(profileOwnerPid("lo-evidence-manifest-uexKDI"), null);
	// The same fixture's CURRENT name, which is the spelling that has to stay out
	// of reach now that its tree is built per case.
	assert.equal(profileOwnerPid("lop-evidence-manifest-uexKDI"), null);
	/*
	 * Suffix shapes that are not a pid. Every one of these reached `process.kill`
	 * before this rule existed, and every throw it produced was read as
	 * "abandoned". The last is the one `\d+` alone would still admit: all digits,
	 * and far above any pid the kernel hands out.
	 */
	assert.equal(profileOwnerPid("lo-evidence-"), null);
	assert.equal(profileOwnerPid("lo-evidence-abc"), null);
	assert.equal(profileOwnerPid("lo-evidence-12x"), null);
	assert.equal(profileOwnerPid("lo-evidence-0"), null);
	assert.equal(profileOwnerPid("lo-evidence-99999999999999999999"), null);
	// Not this script's directories at all.
	assert.equal(profileOwnerPid("lo-evidence"), null);
	assert.equal(profileOwnerPid("lo-sweep-4242"), null);
});

test("the sweep takes the abandoned profile and leaves the rest of the temp directory", () => {
	const root = mkdtempSync(join(tmpdir(), "lo-sweep-profiles-"));
	// A scratch home for the child, so nothing it does derives from the
	// operator's, and deliberately OUTSIDE the swept root.
	const home = mkdtempSync(join(tmpdir(), "lo-sweep-home-"));
	cleaned.push(root, home);

	// What a SIGKILL under `timeout` leaves behind: the profile, uncollected.
	const abandoned = join(root, `lo-evidence-${deadPid()}`);
	mkdirSync(join(abandoned, "Default"), { recursive: true });
	writeFileSync(join(abandoned, "Default", "Cookies"), "a leaked profile");

	/*
	 * A sibling test's scratch tree, under the name that collided with the loose
	 * prefix. Its frame is the thing the ENOENT was raised on, so it is asserted
	 * by path and not by the directory alone.
	 */
	const sibling = join(root, "lo-evidence-manifest-uexKDI");
	const siblingFrame = join(sibling, "swept-story", "localOperatorDark.webp");
	mkdirSync(join(sibling, "swept-story"), { recursive: true });
	writeFileSync(siblingFrame, "a live tree");

	/*
	 * The same fixture's CURRENT spelling, which is the one the sweep would have
	 * to reach to delete a live tree today. Both are here because the coupling
	 * this file guards is with a name, and a name that moves is exactly when a
	 * rule stops being pinned to it.
	 */
	const currentSibling = join(root, "lop-evidence-manifest-uexKDI");
	const currentSiblingFrame = join(
		currentSibling,
		"swept-story",
		"localOperatorDark.webp",
	);
	mkdirSync(join(currentSibling, "swept-story"), { recursive: true });
	writeFileSync(currentSiblingFrame, "a live tree");

	/*
	 * A third name that is not a profile, so the rule is pinned as a shape rather
	 * than as "the manifest one is special".
	 */
	const other = join(root, "lo-evidence-not-a-pid");
	mkdirSync(other, { recursive: true });

	/*
	 * The sweep is module-scope and reads `tmpdir()`, so the only way to exercise
	 * it against a synthetic root without a capture and without Chrome is a child
	 * whose TMPDIR is that root. The environment is built rather than inherited:
	 * `CMUX_*`/`LOP_*` belong to whatever session is running this suite, and a test
	 * that spawns anything must not hand them on.
	 */
	const script = `import { sweepStaleProfiles } from ${JSON.stringify(
		new URL("./capture-evidence.mjs", import.meta.url).href,
	)};
sweepStaleProfiles();`;
	const run = spawnSync(
		process.execPath,
		["--input-type=module", "-e", script],
		{
			env: { PATH: process.env.PATH, HOME: home, TMPDIR: root },
			encoding: "utf8",
		},
	);
	assert.equal(
		run.status,
		0,
		`the sweep child exited ${run.status}: ${run.stderr}`,
	);

	// (1) the abandoned profile is still reaped, whole
	assert.ok(!existsSync(abandoned), "an abandoned profile is the sweep's job");
	// (2) the sibling's tree is not, and neither is a name that is not a profile
	assert.ok(
		existsSync(siblingFrame),
		"a directory that is not a profile is not the sweep's to delete",
	);
	assert.ok(
		existsSync(currentSiblingFrame),
		"the fixture's current spelling is not the sweep's to delete either",
	);
	assert.ok(existsSync(other));
	assert.ok(existsSync(root));
});

/*
 * The theme guard's budget, at every edge it has.
 *
 * Why this is a test rather than a paragraph in the capture script: the budget
 * was the literal `40` (40 x 250 ms, ~10.9 s with the 900 ms post-navigation
 * settle) until it was made configurable on 2026-09-18, after three runs died
 * at the first entry of a set with `document carries theme "" after 10s` on a
 * host at load 144-233 - where CDP measured the SAME story reaching
 * `tokyoNight` at 72.1 s. Two properties have to hold and neither is visible
 * from outside the script: the DEFAULT must stay the value every committed
 * frame was taken with (a default that drifted would silently re-time the
 * gate), and a malformed value must FAIL the run rather than quietly fall back
 * to 10 s on the machine that has already demonstrated 10 s does not fit.
 */
test("the theme guard's flag is honoured, and the default is the shipped 10s", () => {
	assert.equal(THEME_SETTLE_DEFAULT_MS, 10_000);
	// The shipped budget as the guard actually spends it: 40 polls of 250 ms.
	// Pinned as arithmetic because the literal it replaced was `attempt < 40`.
	assert.equal(
		Math.ceil(THEME_SETTLE_DEFAULT_MS / THEME_SETTLE_POLL_MS),
		40,
		"the default budget no longer spends the 40 polls the frames were taken in",
	);
	assert.equal(resolveThemeSettleMs([], {}), THEME_SETTLE_DEFAULT_MS);
	assert.equal(resolveThemeSettleMs(["--theme-settle-ms=45000"], {}), 45_000);
	// The environment is the second door to the same number, and the flag wins
	// over it, because the flag is the one a reader of the command line sees.
	assert.equal(
		resolveThemeSettleMs([], { [THEME_SETTLE_ENV]: "120000" }),
		120_000,
	);
	assert.equal(
		resolveThemeSettleMs(["--theme-settle-ms=45000"], {
			[THEME_SETTLE_ENV]: "120000",
		}),
		45_000,
	);
	// Surrounding whitespace in an exported variable is not a malformed value.
	assert.equal(
		resolveThemeSettleMs([], { [THEME_SETTLE_ENV]: " 30000 " }),
		30_000,
	);
});

test("a malformed theme-settle budget is refused, not defaulted", () => {
	const bad = [
		"--theme-settle-ms=abc",
		"--theme-settle-ms=",
		"--theme-settle-ms=0",
		"--theme-settle-ms=-5",
		"--theme-settle-ms=1.5",
		"--theme-settle-ms=10s",
		// A safe-integer check rather than only a digits check: this passes
		// `/^\d+$/` and would otherwise become an unbounded poll.
		"--theme-settle-ms=99999999999999999999",
	];
	for (const arg of bad) {
		assert.throws(
			() => resolveThemeSettleMs([arg], {}),
			THEME_SETTLE_REFUSAL,
			`${arg} was accepted instead of refused`,
		);
	}
	for (const value of ["", "ten seconds", "0", "-1", "1e6", "60000ms"]) {
		assert.throws(
			() => resolveThemeSettleMs([], { [THEME_SETTLE_ENV]: value }),
			THEME_SETTLE_REFUSAL,
			`${THEME_SETTLE_ENV}=${JSON.stringify(value)} was accepted instead of refused`,
		);
	}
});

/*
 * The refusal above is only worth anything if the script actually reads it - a
 * resolver nothing calls fails open. So the module is imported in a child with
 * the bad flag in ITS argv, which is the path a typo takes, and the same child
 * without the flag is the control: without it, a failure here could be the
 * import rather than the flag.
 */
test("the script refuses to load at all on a malformed theme-settle flag", () => {
	const home = mkdtempSync(join(tmpdir(), "lop-theme-settle-"));
	cleaned.push(home);
	const script = `await import(${JSON.stringify(
		new URL("./capture-evidence.mjs", import.meta.url).href,
	)});
console.log("loaded");`;
	const run = (arg) =>
		spawnSync(
			process.execPath,
			["--input-type=module", "-e", script, "probe", ...(arg ? [arg] : [])],
			{
				env: { PATH: process.env.PATH, HOME: home, TMPDIR: home },
				encoding: "utf8",
			},
		);

	const control = run(null);
	assert.equal(
		control.status,
		0,
		`the same child without the flag exited ${control.status}: ${control.stderr}`,
	);
	assert.match(control.stdout, MODULE_LOADED);

	const refused = run("--theme-settle-ms=ten");
	assert.notEqual(refused.status, 0, "a malformed flag loaded the script");
	assert.match(refused.stderr, THEME_SETTLE_REFUSAL);
});

/*
 * The space-separated spelling, which the file's shared `flag()` shape cannot
 * see: round 5 (R5-8) measured that `--theme-settle-ms 300000` matched nothing
 * and the run silently took the 10 s default - on the host that had already
 * shown 10 s does not fit. It is refused by name now, which is the difference
 * between a knob that fails closed and one that fails quietly.
 */
test("a space-separated theme-settle flag is refused rather than ignored", () => {
	assert.throws(
		() => resolveThemeSettleMs(["--theme-settle-ms", "300000"], {}),
		THEME_SETTLE_JOINED,
	);
	// The `=` form is the one that works, and the environment is still read when
	// the flag is absent entirely.
	assert.equal(resolveThemeSettleMs(["--theme-settle-ms=300000"], {}), 300_000);
	assert.equal(
		resolveThemeSettleMs([], { [THEME_SETTLE_ENV]: "300000" }),
		300_000,
	);
});

/*
 * The budget and the guard that spends it, pinned as ONE thing.
 *
 * Why this is a test rather than a sentence in the commit message: round 5's
 * R5-3 probed a copy of the module with the guard's loop body reverted to the
 * pre-change literal (`attempt < 40`, the shape this knob replaced) and the
 * whole file stayed green at 10/10 — because every assertion above is about the
 * constants, and a guard that ignores them is invisible from the outside. That
 * revert is the one regression that would silently re-time every capture
 * without moving a constant, so the coupling is asserted against the shipped
 * source, where it lives.
 */
test("the theme guard spends the configurable budget, not a literal", () => {
	const source = readFileSync(
		new URL("./capture-evidence.mjs", import.meta.url),
		"utf8",
	);
	const required = [
		"const settleAttempts = Math.ceil(THEME_SETTLE_MS / THEME_SETTLE_POLL_MS);",
		"for (let attempt = 0; attempt < settleAttempts; attempt++) {",
		"await sleep(THEME_SETTLE_POLL_MS);",
		'document carries theme "${applied}" after ${THEME_SETTLE_MS / 1000}s',
	];
	for (const needle of required) {
		assert.ok(
			source.includes(needle),
			`the guard no longer contains: ${needle}`,
		);
	}
	assert.ok(
		!source.includes("attempt < 40"),
		"the pre-change literal is back in the guard: the budget constants are no longer what it spends",
	);
});

/*
 * The pass record has to survive a FOLD, which is every lane's daily cadence.
 *
 * Why the numbers below are real rather than made up: the decision this pins
 * lives behind `main()`'s Chrome loop, which no CI workflow runs, and the loss
 * it allowed was invisible to BOTH `check-evidence.mjs` terms - they derive
 * their denominators from the same fields the reset re-anchors, so a record
 * replaced wholesale passes a gate that measures it against itself. These are
 * PR #555's own values, read out of its manifest, and they are the reproducer:
 *
 *   `a4348e9a4a`  8987 frames / 837 directories   the pass's own record
 *   `d9e9cd8f44`  the fold: the resolution took main's copy of the block, so
 *                 `refreshedAtHead` came to name `6173e6bcb6` - the tip of a
 *                 `fix(chat)` branch that is NOT on origin/main and NOT an
 *                 ancestor of the fold
 *   `21e96242f5`  144 frames / 17 directories      the pass's next subset run
 *
 * 837 directories became 17 because the gate the decision below replaced asked
 * ONE question - is the recorded `refreshedAtHead` reachable from this head -
 * and the fold had put a foreign sha in that one field, while the pass's own
 * start (`f933ea304f`) was still an ancestor. The pass's start is therefore the
 * signal the decision reads, along with the manifest's own capture head.
 */
const PASS_START = "f933ea304f";
const FOREIGN_HEAD = "6173e6bcb6";
const FOLD_HEAD = "d9e9cd8f44";
const onlyPassStart = (sha) => sha === PASS_START;

/* The manifest the folded tree's subset run found on disk, to main's numbers. */
const foldedManifest = () => ({
	head: FOREIGN_HEAD,
	partialCapture: {
		refreshedAt: "2026-09-26T16:34:37.398Z",
		refreshedAtHead: FOREIGN_HEAD,
		refreshedFromHead: PASS_START,
		refreshedFrames: 8891,
		refreshedStories: [
			"chat-sidebar-sections--chats-first",
			"installer-installercontent--default",
		],
		refreshedThemes: ["localOperatorDark", "dracula"],
		addedFrames: 296,
		addedSurfaces: ["installer-installercontent/reduced-motion"],
		addedAt: "2026-09-26T16:34:37.453Z",
		addedAtHead: FOREIGN_HEAD,
	},
});

const runOn = (previous, overrides = {}) =>
	partialCaptureRecord({
		previous,
		head: FOLD_HEAD,
		captured: 144,
		storyDirs: ["installer-installercontent--installed"],
		themes: ["localOperatorDark", "neon"],
		addedFrameCount: 0,
		addedSurfaces: [],
		reachable: onlyPassStart,
		...overrides,
	});

test("a subset run at a folded head continues the pass instead of replacing it", () => {
	const previous = foldedManifest();
	assert.equal(
		partialPassContinues(previous, FOLD_HEAD, onlyPassStart),
		true,
		"the pass's own start is still in this history, so its record is this lineage's to continue",
	);

	const record = runOn(previous);

	assert.equal(
		record.refreshedFrames,
		8891 + 144,
		"the pass's total adds this run's frames; writing 144 here is the record being replaced",
	);
	assert.equal(
		record.refreshedFromHead,
		PASS_START,
		"the pass still started where it started, so the gate keeps measuring the round rather than the run",
	);
	assert.deepEqual(
		record.refreshedStories,
		[
			...previous.partialCapture.refreshedStories,
			"installer-installercontent--installed",
		],
		"the directories the earlier runs rewrote are still named",
	);
	assert.deepEqual(record.refreshedThemes, [
		"localOperatorDark",
		"dracula",
		"neon",
	]);
	// A zero-add run is not an adding pass, even when it continues one.
	assert.equal(record.addedFrames, undefined);
	assert.equal(record.addedAt, undefined);
});

/*
 * The control, without which the test above would be satisfied by a decision
 * that always inherits: a record with NO head this history carries is another
 * branch's, and a fresh pass is the honest answer for it.
 */
test("a record with no head this history carries still starts a fresh pass", () => {
	const previous = foldedManifest();
	const nothingReachable = () => false;
	assert.equal(
		partialPassContinues(previous, FOLD_HEAD, nothingReachable),
		false,
	);

	const record = runOn(previous, { reachable: nothingReachable });

	assert.equal(record.refreshedFrames, 144);
	assert.equal(record.refreshedFromHead, FOLD_HEAD);
	assert.deepEqual(record.refreshedStories, [
		"installer-installercontent--installed",
	]);
	assert.deepEqual(record.refreshedThemes, ["localOperatorDark", "neon"]);
	// The same head needs no git read at all, and must not become a reset.
	assert.equal(
		partialPassContinues(
			{ head: FOLD_HEAD, partialCapture: { refreshedAtHead: FOLD_HEAD } },
			FOLD_HEAD,
			nothingReachable,
		),
		true,
	);
});

/*
 * The property the field's own note promises and the one the first report of
 * this defect named: consecutive subset runs at an unmoved head accumulate.
 * Pinned here too, because the fix above widened the gate rather than replacing
 * it, and a widening is exactly the change that could lose this case.
 */
test("a second subset run at the same head adds to the pass rather than starting over", () => {
	const head = "c1d31003db";
	const beyond = { reachable: () => false };
	const first = runOn(
		{},
		{
			head,
			captured: 12,
			storyDirs: ["a-panel--one"],
			themes: ["dracula"],
			...beyond,
		},
	);
	// The manifest the first run leaves: its record, plus the fields the caller writes.
	const committed = {
		head,
		partialCapture: { ...first, refreshedAtHead: head },
	};
	const second = runOn(committed, {
		head,
		captured: 8,
		storyDirs: ["a-panel--one", "a-panel--two"],
		themes: ["dracula", "neon"],
		addedFrameCount: 3,
		addedSurfaces: ["a-panel/two"],
		...beyond,
	});

	assert.equal(second.refreshedFrames, 20);
	assert.equal(second.refreshedFromHead, head);
	assert.deepEqual(second.refreshedStories, ["a-panel--one", "a-panel--two"]);
	// ... and the pass that DID add frames stamps its own citation, at its own head.
	assert.equal(second.addedFrames, 3 + 0);
	assert.equal(second.addedAtHead, head);
});

/*
 * A full sweep must stay what it was: its own run's counts, no pass record
 * carried forward. Nothing above can show that - it is the arm the decision is
 * NOT spent on - so it is pinned against the shipped source, the way the
 * theme-settle guard is.
 */
test("the pass record is spent on narrowed runs, and the sweep still writes its own", () => {
	const source = readFileSync(
		new URL("./capture-evidence.mjs", import.meta.url),
		"utf8",
	);
	const arms = source.slice(
		source.indexOf("const manifest = PARTIAL"),
		source.indexOf("writeFileSync(manifestPath"),
	);
	assert.equal(
		arms.split("...partialCaptureRecord(").length - 1,
		1,
		"the pass record has exactly one call site, in the narrowed arm",
	);
	const sweepArm = arms.slice(arms.lastIndexOf("\t\t: {"));
	assert.ok(
		!sweepArm.includes("partialCaptureRecord"),
		"the sweep must not carry a previous pass's record forward",
	);
	assert.ok(
		sweepArm.includes("frames: captured"),
		"the sweep's own arm still writes this run's frames, which is what makes a repeat sweep idempotent",
	);
});

/* ---- the frame-timezone pin, proved against a live child ------------------ */

/*
 * The pin BEATS an ambient zone - the property the acceptance rests on ("the
 * same story captured under two host zones produces IDENTICAL frames"), and
 * one no reading of a constant can show.
 *
 * The reading is a live child handed the exact env the Chrome spawn passes
 * (`pinnedEvidenceEnv(process.env)`) while the launching environment says
 * another zone; the control is the same child with that ambient env untouched.
 * Without the control the assertion could be about a child that ignores `TZ`
 * entirely, and without the pin the ambient zone is exactly what the frames
 * would bake.
 */
const ZONE_PROBE =
	"console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)";

test("the capture pin beats an ambient zone in the env Chrome is spawned with", () => {
	const ambient = { PATH: process.env.PATH, TZ: "Asia/Tokyo" };
	const control = spawnSync(process.execPath, ["-e", ZONE_PROBE], {
		env: ambient,
		encoding: "utf8",
	});
	assert.equal(
		control.stdout.trim(),
		"Asia/Tokyo",
		`the zone probe reads no TZ at all: ${control.stderr}`,
	);
	const run = spawnSync(process.execPath, ["-e", ZONE_PROBE], {
		env: pinnedEvidenceEnv(ambient),
		encoding: "utf8",
	});
	assert.equal(
		run.stdout.trim(),
		EVIDENCE_TZ,
		`the ambient zone survived the pin: ${run.stderr}`,
	);
});

/*
 * Importing the rig must not re-zone the importer.
 *
 * WHY: sibling test files import this module (`this file`, and
 * `evidence-manifest.test.mjs`), so the pin lives inside `main()` - which an
 * import never calls - rather than at module scope, where it would silently
 * re-zone every test process that reaches for `clearSweptFrames` or
 * `partialCaptureRecord`. A child under an ambient zone imports the rig and
 * must still report that ambient zone.
 */
test("importing the capture rig does not re-zone its importer", () => {
	const home = mkdtempSync(join(tmpdir(), "lop-evidence-tz-"));
	cleaned.push(home);
	const script = `await import(${JSON.stringify(
		new URL("./capture-evidence.mjs", import.meta.url).href,
	)});
console.log("loaded");
console.log(Intl.DateTimeFormat().resolvedOptions().timeZone);`;
	const run = spawnSync(
		process.execPath,
		["--input-type=module", "-e", script, "probe"],
		{
			env: {
				PATH: process.env.PATH,
				HOME: home,
				TMPDIR: home,
				TZ: "Asia/Tokyo",
			},
			encoding: "utf8",
		},
	);
	assert.equal(
		run.status,
		0,
		`the importer child exited ${run.status}: ${run.stderr}`,
	);
	assert.match(run.stdout, MODULE_LOADED);
	assert.equal(
		run.stdout.trim().split("\n").at(-1).trim(),
		"Asia/Tokyo",
		"importing the rig re-zoned its importer",
	);
});
