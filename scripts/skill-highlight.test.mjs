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
 * The trigger is `skillMentions` now, so an INLINE mention paints resolved —
 * the rule the harness's inline change moved to. The cases below pin that
 * against the same resolver the submit path calls, not against a second
 * leading-only reading.
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
	/skillHighlightRuns\(\{ draft: newMessage, vocabulary: skills\.vocabulary, settled: skills\.settled, picking: skills\.open, expands: planForDraft\(newMessage, caret\)\.kind === "send", \}\)/;
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
		expands: true,
		...over,
	});

/* ------------------------------------------------------------------ */
/* Resolved: every mention the trigger accepts, wherever it sits       */
/* ------------------------------------------------------------------ */

test("a resolved $name paints on its own token, inline included", () => {
	assert.deepEqual(runs("$research"), [{ start: 0, end: 9, kind: "skill" }]);
	// Case-insensitive membership is the resolver's leading rule; the ink must
	// claim exactly what Enter will fire.
	assert.deepEqual(runs("$Research"), [{ start: 0, end: 9, kind: "skill" }]);
	assert.deepEqual(runs("$RESEARCH"), [{ start: 0, end: 9, kind: "skill" }]);
	// Hidden skills fire when named explicitly (issue #664's contract), so the
	// ink claims them too — the vocabulary is the discoverable set.
	assert.deepEqual(runs("$secret-ritual"), [
		{ start: 0, end: 14, kind: "skill" },
	]);
	// INLINE is the change: the trigger reads the whole message, so a token in
	// the middle of a sentence is painted where it sits.
	assert.deepEqual(runs("fix this $research"), [
		{ start: 9, end: 18, kind: "skill" },
	]);
	assert.deepEqual(runs("/team delivery $research"), [
		{ start: 15, end: 24, kind: "skill" },
	]);
	// Every line, and every mention: a message may name several skills, in text
	// order.
	assert.deepEqual(runs("line one\n$research"), [
		{ start: 9, end: 18, kind: "skill" },
	]);
	assert.deepEqual(runs("compare $research and $release-notes"), [
		{ start: 8, end: 17, kind: "skill" },
		{ start: 22, end: 36, kind: "skill" },
	]);
	// Dedupe by resolved name, first-seen: one body, one painted span.
	assert.deepEqual(runs("$research and $Research"), [
		{ start: 0, end: 9, kind: "skill" },
	]);
});

test("a token the send will not attach is not painted", () => {
	/*
	 * The block shapes submit's idempotence rules create: a name inside a block
	 * will not attach (skipSpans), and a name the block already carries will not
	 * attach a second time. The ink reads the PLAN, so neither is painted
	 * resolved — a claim the send would not honour.
	 */
	const block = [
		"<operator-skills>",
		"",
		"The user invoked the following skills directly. Follow them for this request. Their reference files, if any, are listed at the end of each body and are read with `skill://<name>/<path>`.",
		"",
		'<skill name="research">',
		"the body quotes $research",
		"</skill>",
		"",
		"</operator-skills>",
	].join("\n");
	assert.deepEqual(runs(block), []);
	assert.deepEqual(runs(`$research fix\n\n${block}`), []);
	// A name the block does not carry still paints, before it.
	assert.deepEqual(runs(`$release-notes and $research\n\n${block}`), [
		{ start: 0, end: 14, kind: "skill" },
	]);
});

test("the extent is the RESOLVER's name class, so the corners read exactly as the submit will", () => {
	// `$research,` FIRES: the comma is outside the name class, so the ink
	// covers exactly the name and leaves the comma prose.
	assert.deepEqual(runs("$research, fix this"), [
		{ start: 0, end: 9, kind: "skill" },
	]);
	/*
	 * `$research.` ALSO FIRES now: the dot is inside the raw name class, but the
	 * resolver trims trailing `.`/`-`/`_` back to a discovered name, so the send
	 * expands `research` and the dot stays prose. The ink follows the trigger.
	 */
	assert.deepEqual(runs("$research."), [{ start: 0, end: 9, kind: "skill" }]);
	// A run that cannot be trimmed back to a name is unresolved: inert when it
	// is the whole draft, nothing otherwise.
	assert.deepEqual(
		skillHighlightRuns({
			draft: "$research_extra",
			vocabulary: VOCABULARY,
			settled: true,
			picking: false,
			expands: true,
		}),
		[{ start: 0, end: 15, kind: "skill-unknown" }],
	);
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
	assert.deepEqual(runs("fix this $research", { picking: true }), [
		{ start: 9, end: 18, kind: "skill" },
	]);
	// An unresolved token under the open list is a prefix in progress, not a
	// typo (the slash `picking` suppression): NO ink, so the miss line and the
	// dim can never talk over each other.
	assert.deepEqual(runs("$zzz", { picking: true }), []);
	assert.deepEqual(runs("$res", { picking: true }), []);
	assert.deepEqual(runs("fix this $zzz", { picking: true }), []);
	// Escape closes the list, and THEN the inert step arrives — the captured
	// pair the UX walk names (`$zzz` open, `$zzz` after Escape).
	assert.deepEqual(runs("$zzz"), [{ start: 0, end: 4, kind: "skill-unknown" }]);
	assert.deepEqual(runs("$res"), [{ start: 0, end: 4, kind: "skill-unknown" }]);
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
			expands: true,
		}),
		[{ start: 0, end: 9, kind: "skill-unknown" }],
	);
	assert.deepEqual(
		skillHighlightRuns({
			draft: "$zzz",
			vocabulary: empty,
			settled: true,
			picking: false,
			expands: true,
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
	// Text around it: the token could be a sentence in progress — no ink.
	assert.deepEqual(runs("$zzz fix this"), []);
	assert.deepEqual(runs("$zzz fix"), []);
	assert.deepEqual(runs("fix this $zzz"), []);
	// Lowercase evidence is the picker's own `hasLowercaseEvidence` rule — the
	// one gate that keeps money and shell out.
	assert.deepEqual(runs("$5"), []);
	assert.deepEqual(runs("$PATH"), []);
	assert.deepEqual(runs("$ZZZ"), []);
	// An inline UPPERCASE token has no evidence either, even when a lower-case
	// skill by that name exists: `$RESEARCH` mid-sentence stays prose (and the
	// submit agrees), unlike the leading legacy spelling.
	assert.deepEqual(runs("fix $RESEARCH"), []);
	assert.deepEqual(runs("$RESEARCH"), [{ start: 0, end: 9, kind: "skill" }]);
});

test("money, shell, glue and bare sigils stay neutral", () => {
	// Glued to a word: `$` is punctuation inside it, never a sigil.
	assert.deepEqual(runs("costs$5"), []);
	assert.deepEqual(runs("a$b"), []);
	assert.deepEqual(runs("`$research`"), []);
	assert.deepEqual(runs("$$research"), []);
	// A bare `$` and a `$-foo` have no name to judge: the list may open, the ink
	// has nothing to claim. (Money/shell stay neutral by the evidence gate.)
	assert.deepEqual(runs("$"), []);
	assert.deepEqual(runs("$-foo"), []);
	// A slash command's money argument stays prose.
	assert.deepEqual(runs("/model $5"), []);
});

/* ------------------------------------------------------------------ */
/* The surface gate: only a draft Enter SENDS expands a skill          */
/* ------------------------------------------------------------------ */

test("a draft Enter dispatches as a slash command paints no skill ink", () => {
	/*
	 * M1's rule, executed: the desktop never sends a slash line as a prompt, so
	 * every token on one is neutral — resolved or not, leading or inline. The
	 * caller reads `expands` from the same planner Enter uses; this file only
	 * honours it.
	 */
	for (const draft of [
		"/team delivery $research",
		"/goal ship $release-notes this week",
		"/agent reviewer $research the diff",
		"/compact hello $research",
		"/model $5",
		"$research",
		"$zzz",
	]) {
		assert.deepEqual(
			runs(draft, { expands: false }),
			[],
			`${JSON.stringify(draft)} paints nothing on a command surface`,
		);
	}
	// A leading slash word the planner treats as prose still sends, so it still
	// paints — the same line with the gate on.
	assert.deepEqual(runs("/tmp/notes fix $research"), [
		{ start: 15, end: 24, kind: "skill" },
	]);
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
		"fix this $research and $release-notes",
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
