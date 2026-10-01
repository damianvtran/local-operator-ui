import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's `$skill` token ink, asserted state by state against the gates
 * it ports (`spec-reconciliation.md` §2 — the manager-ratified contract;
 * `design-spec.md` §1.1 carries the same classes).
 *
 * `skill-highlight.ts` is the `$` sibling of `slash-highlight.ts` and follows
 * the same split: the pure module carries the whole rule, so every gate below
 * is executable without a browser, and the mirror keeps ONE run list
 * (`segmentsOf`) for both families — which is why this file bundles the
 * mirror's own totality helper and not a happy-path stub of it.
 *
 * Bundled rather than imported because the modules are TypeScript in the
 * renderer tree; the modules under test are the REAL ones.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/skill-highlight";\n' +
			'export { runInkClass } from "./src/renderer/src/features/chat/components/slash-highlight";\n' +
			/*
			 * The merge between the two families happens in the mirror, and
			 * `segmentsOf` is the layer that would silently DROP a character if the
			 * two families' runs ever met badly — the textarea's own glyphs are
			 * transparent whenever a run exists. Same move as `slash-highlight.test.mjs`
			 * (its review round 1 MINOR 2).
			 */
			'export { segmentsOf } from "./src/renderer/src/features/chat/components/composer-highlight";',
		resolveDir: process.cwd(),
	},
	/* The renderer's own aliases, because `composer-highlight.tsx` is a real renderer module. */
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { skillHighlightRuns, runInkClass, segmentsOf } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/*
 * The source pins' patterns, at module scope: biome's `useTopLevelRegex`
 * charges a literal compiled inside a function, and every one of these runs
 * per assertion.
 */
const WHITESPACE_RUN = /\s+/g;
const WEIGHT_UTILITY =
	/(?:^|\s)font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?:\s|$)/;
const MERGE_SITE =
	/const composerRuns = useMemo\( \(\) => \[\.\.\.slashRuns, \.\.\.skillRuns\], \[slashRuns, skillRuns\], \);/;
const SKILL_RUNS_CALL =
	/skillHighlightRuns\(\{ draft: newMessage, vocabulary: skills\.vocabulary, settled: skills\.settled, picking: skills\.open, \}\)/;
const MIRROR_RUNS = /runs=\{composerRuns\}/;
const HIGHLIGHT_SWITCH =
	/const highlighting = highlightPaints\(composerRuns\);/;

/** The fixture vocabulary — the same three names the cluster story serves. */
const VOCABULARY = [
	{ name: "research" },
	{ name: "release-notes" },
	{ name: "secret-ritual" },
];

/**
 * One call with the fixture defaults: settled vocabulary, list closed.
 *
 * Every case names only the input it varies, so the delta in the expectation
 * is the feature under test rather than the setup.
 */
const runs = (draft, over = {}) =>
	skillHighlightRuns({
		draft,
		vocabulary: VOCABULARY,
		settled: true,
		picking: false,
		...over,
	});

/* ------------------------------------------------------------------ */
/* Resolved: leading + settled case-insensitive member                 */
/* ------------------------------------------------------------------ */

test("a leading $name that names a settled skill paints the resolver extent", () => {
	assert.deepEqual(runs("$research"), [{ start: 0, end: 9, kind: "skill" }]);
	// Case-insensitive membership is the resolver's rule (`invoke.py:151-162`);
	// the ink must claim exactly what Enter will fire.
	assert.deepEqual(runs("$Research"), [{ start: 0, end: 9, kind: "skill" }]);
	assert.deepEqual(runs("$RESEARCH"), [{ start: 0, end: 9, kind: "skill" }]);
	// Hidden skills fire when named explicitly (issue #664's contract), so the
	// ink claims them too — the vocabulary is the discoverable set.
	assert.deepEqual(runs("$secret-ritual"), [
		{ start: 0, end: 14, kind: "skill" },
	]);
	// The resolved state has NO whole-draft gate: the token is a verdict the
	// moment it is leading, and this is the primary case (a request follows).
	assert.deepEqual(runs("$research fix this"), [
		{ start: 0, end: 9, kind: "skill" },
	]);
	assert.deepEqual(runs("  $research fix this"), [
		{ start: 2, end: 11, kind: "skill" },
	]);
	// Leading is whitespace-only before the token, on any line — blank lines
	// before it are not content.
	assert.deepEqual(runs("\n\n$research fix"), [
		{ start: 2, end: 11, kind: "skill" },
	]);
});

test("the extent is the RESOLVER's name class, so the corners read exactly as the submit will", () => {
	/*
	 * `$research,` FIRES: the comma is outside the name class, so
	 * `parseSkillInvocation` reads `research` and the invocation is attempted —
	 * the ink covers exactly that span and leaves the comma prose. Under-promise
	 * in neither direction, which is why the extent is the resolver's and not the
	 * picker's to-whitespace word (architect plan §3(b); UX u6).
	 */
	assert.deepEqual(runs("$research, fix this"), [
		{ start: 0, end: 9, kind: "skill" },
	]);
	/*
	 * `$research.` DOES NOT FIRE: the dot is INSIDE the class, the parse reads
	 * `research.`, misses the vocabulary and sends prose — so the ink is the
	 * inert step over the whole extent, dot included ("the dot is part of the
	 * typo"). Pinned so a later "fix" cannot silently flip the honesty call.
	 */
	assert.deepEqual(runs("$research."), [
		{ start: 0, end: 10, kind: "skill-unknown" },
	]);
	// Greedy on purpose: `$research_extra` parses the name `research_extra` and
	// does NOT fall back to `research` — the ink mirrors the swallow.
	assert.deepEqual(runs("$research_extra"), [
		{ start: 0, end: 15, kind: "skill-unknown" },
	]);
});

test("a resolved token paints THROUGH the open list; an unresolved one waits for closure", () => {
	/*
	 * The manager-ratified correction (spec §2): membership is a verdict, not a
	 * prefix in progress — the list cannot change what an exact member means, so
	 * `$research` keeps its ink while rows are offered for it.
	 */
	assert.deepEqual(runs("$research fix this", { picking: true }), [
		{ start: 0, end: 9, kind: "skill" },
	]);
	// An unresolved token under the open list is a prefix in progress, not a
	// typo (the slash `picking` suppression): NO ink, so the miss line and the
	// dim can never talk over each other.
	assert.deepEqual(runs("$zzz", { picking: true }), []);
	assert.deepEqual(runs("$res", { picking: true }), []);
	// Escape closes the list, and THEN the inert step arrives — the captured
	// pair the UX walk names (`$zzz` open, `$zzz` after Escape).
	assert.deepEqual(runs("$zzz"), [{ start: 0, end: 4, kind: "skill-unknown" }]);
});

/* ------------------------------------------------------------------ */
/* The settled gate: no claims while the answer cannot be believed     */
/* ------------------------------------------------------------------ */

test("no ink at all while the vocabulary is loading, absent or errored", () => {
	/*
	 * One gate for all three states: the caller folds "loading" and "errored"
	 * into `settled: false` (the hook's own flag reads only `isSuccess`), and the
	 * whole paint is withheld — a resolved claim that flickers off during a
	 * refetch, or a dim flash while the first load is in flight, are the two
	 * failures this exists for.
	 */
	for (const draft of ["$research", "$research fix this", "$zzz", "$res"]) {
		assert.deepEqual(
			runs(draft, { settled: false }),
			[],
			`${JSON.stringify(draft)} paints nothing while unsettled`,
		);
	}
	// Empty-but-settled resolves nothing — and dim is still allowed (spec §1.2).
	const empty = [];
	assert.deepEqual(
		skillHighlightRuns({
			draft: "$research",
			vocabulary: empty,
			settled: true,
			picking: false,
		}),
		[{ start: 0, end: 9, kind: "skill-unknown" }],
	);
	assert.deepEqual(
		skillHighlightRuns({
			draft: "$zzz",
			vocabulary: empty,
			settled: true,
			picking: false,
		}),
		[{ start: 0, end: 4, kind: "skill-unknown" }],
	);
});

/* ------------------------------------------------------------------ */
/* Inert: whole-draft + lowercase evidence, and the neutral guards     */
/* ------------------------------------------------------------------ */

test("the inert step needs the word to BE the whole draft and to carry lowercase evidence", () => {
	// Bare word: inert, "will be sent as prose".
	assert.deepEqual(runs("$zzz"), [{ start: 0, end: 4, kind: "skill-unknown" }]);
	// Whitelisted by the trimmed draft: trailing separator runs do not defeat it.
	assert.deepEqual(runs("$zzz "), [
		{ start: 0, end: 4, kind: "skill-unknown" },
	]);
	assert.deepEqual(runs("$zzz\n"), [
		{ start: 0, end: 4, kind: "skill-unknown" },
	]);
	// Text after it: the token could be a sentence in progress — no ink.
	assert.deepEqual(runs("$zzz fix this"), []);
	assert.deepEqual(runs("$zzz fix"), []);
	assert.deepEqual(runs("$res fix this"), []);
	// Lowercase evidence is the picker's own `hasLowercaseEvidence` rule — the
	// one gate that keeps money and shell out.
	assert.deepEqual(runs("$5"), []);
	assert.deepEqual(runs("$PATH"), []);
	assert.deepEqual(runs("$ZZZ"), []);
});

test("money, shell, glue, inline and slash-claimed tokens stay neutral", () => {
	// Glued to a word: `$` is punctuation inside it, never a sigil.
	assert.deepEqual(runs("costs$5"), []);
	assert.deepEqual(runs("a$b"), []);
	// Inline in ANY state: only the anchored leading token fires on submit
	// (`skill-invocation.ts:83-108`), so no ink claims an inline token — the
	// accept gesture's reassembly is what makes one leading.
	assert.deepEqual(runs("fix this $research"), []);
	assert.deepEqual(runs("fix this $research", { picking: true }), []);
	assert.deepEqual(runs("fix this $zzz"), []);
	// A bare `$` and a `$-foo` have no name to judge: the list may open, the ink
	// has nothing to claim. (Money/shell stay neutral by the evidence gate.)
	assert.deepEqual(runs("$"), []);
	assert.deepEqual(runs("$-foo"), []);
	// A recognised command claims the rest of its line, and the desktop keeps
	// that claim TOTAL (`skill-token.ts:25-35`): `/model $5` and the relaxed-TUI
	// shape `/team delivery $research` are both prose here — and structurally so,
	// because neither `$` is leading.
	assert.deepEqual(runs("/model $5"), []);
	assert.deepEqual(runs("/team delivery $research"), []);
});

/* ------------------------------------------------------------------ */
/* The classes the kinds paint with                                    */
/* ------------------------------------------------------------------ */

test("the new kinds step colour when refused and wear the ratified classes", () => {
	// Branding: disabled changes colour, never opacity — every kind, no exceptions.
	for (const kind of ["skill", "skill-unknown"]) {
		assert.equal(runInkClass(kind, true), "text-ink-disabled", kind);
	}
	// Resolved wears the structured-token role name-for-name (`/command`), the
	// stroke that does not move the mirror's wrap points (design §1.1).
	assert.equal(
		runInkClass("skill", false),
		"text-token-command slash-run-bold",
	);
	// Inert wears the slash `unknown` role's own quietest legal ink.
	assert.equal(runInkClass("skill-unknown", false), "text-ink-dim");
	for (const kind of ["skill", "skill-unknown"]) {
		assert.doesNotMatch(
			runInkClass(kind, false),
			WEIGHT_UTILITY,
			`${kind} must not carry a weight utility: it moves the advances and the mirror then wraps where the textarea does not (QA round 1 Q1)`,
		);
	}
});

/* ------------------------------------------------------------------ */
/* The merge site, and the totality the mirror paints from             */
/* ------------------------------------------------------------------ */

test("the composer merges the `$` runs AFTER the plan gate, and asks the four gated inputs", () => {
	/*
	 * Source assertions, for the same reason `slash-highlight.test.mjs` states
	 * for its own: the memo lives inside a React render, where no unit test can
	 * reach the call. Whitespace is normalised so the assertion pins the
	 * SEMANTICS, not a format.
	 *
	 * THE ORDER IS THE PIN. A `$research fix this` draft is a SEND
	 * (`plan.kind === "send"`), and `runsMatchingPlan` blanks every run for it —
	 * merging the skill runs THROUGH the gate would blank exactly the primary
	 * case this feature exists for. So the merge site must be an append of the
	 * gated slash runs and the skill runs, in that order.
	 */
	const composer = readFileSync(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	const flat = composer.replace(WHITESPACE_RUN, " ");
	assert.match(
		flat,
		MERGE_SITE,
		"the merge site must append the skill runs to the gated slash runs",
	);
	assert.match(
		flat,
		SKILL_RUNS_CALL,
		"the skill runs must read the draft, the shared vocabulary, its settled flag and the list's open state",
	);
	// Both consumers of the merge: the mirror receives it, and the transparent-
	// textarea switch reads the SAME list (two tests would be two chances for a
	// transparent textarea with no mirror behind it).
	assert.match(flat, MIRROR_RUNS, "the mirror must paint the merged list");
	assert.match(
		flat,
		HIGHLIGHT_SWITCH,
		"the transparent-text switch must read the merged list",
	);
});

test("a mixed draft's segments keep every character (the mirror's totality)", () => {
	/*
	 * The mirror is the ONLY painter of the draft whenever a run exists (the
	 * textarea's glyphs are transparent), so a segment that vanishes takes the
	 * user's characters with it — and no frame would show why. The totality is
	 * asserted over the mixed-family shape rather than assumed.
	 */
	for (const draft of [
		"$research fix this",
		"  $research and some prose",
		"$zzz",
		"$zzz\ntrailing lines stay painted",
		"plain prose with no runs at all",
	]) {
		const mixed = [...runs(draft)];
		const segments = segmentsOf(draft, mixed);
		assert.equal(
			segments.map((segment) => segment.text).join(""),
			draft,
			`every character of ${JSON.stringify(draft)} survives segmentation`,
		);
	}
	// And the kind reaches the span verbatim — the readback probes key on it.
	const segments = segmentsOf("$research fix this", runs("$research fix this"));
	assert.equal(segments[0].kind, "skill");
	assert.equal(segments[0].text, "$research");
});
