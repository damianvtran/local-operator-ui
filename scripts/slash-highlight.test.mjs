import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's slash syntax highlight, asserted row by row against the TUI
 * rule it ports.
 *
 * `slash-highlight.ts` is the renderer twin of `Editor._compute_slash_runs`
 * (`local_operator/tui/widgets/editor.py:4232-4359`), and every test below
 * cites the TUI line it mirrors, so a divergence is a decision someone made
 * rather than something a later reader rediscovers. It is pure, so the whole
 * rule is executable without a browser.
 *
 * Bundled rather than imported because the module is TypeScript in the renderer
 * tree; the module under test is the REAL one.
 */

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/components/slash-highlight";\n' +
			'export { planSlashSubmission } from "./src/renderer/src/features/chat/components/slash-submit";\n' +
			/*
			 * `segmentsOf` is the one layer that could DROP text — it is what the mirror
			 * paints from, and the textarea's own glyphs are transparent whenever a run
			 * exists, so a segment that vanishes takes the user's characters with it.
			 * Exported for this file rather than asserted in a comment (review round 1
			 * MINOR 2).
			 */
			'export { segmentsOf } from "./src/renderer/src/features/chat/components/composer-highlight";',
		resolveDir: process.cwd(),
	},
	/*
	 * The renderer's own path aliases, because `composer-highlight.tsx` is a real
	 * renderer module: without them the bundler stops at its `@shared` import and
	 * the segments assertion below would silently stop running.
	 */
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
const {
	slashHighlightRuns,
	firstContentLine,
	runsMatchingPlan,
	runInkClass,
	planSlashSubmission,
	segmentsOf,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The registry-derived vocabularies the composer hands the builder. */
const COMMAND_NAMES = new Set([
	"team",
	"teams",
	"agent",
	"agents",
	"goal",
	"loop",
	"btw",
	"fork",
	"usage",
	"compact",
	"model",
	"theme",
	"mcp",
]);
/** `inlineArgumentFor(destination).nameThenMessage` — the NAME+message commands. */
const NAME_LIST_COMMANDS = new Set(["team", "teams", "agent", "agents"]);
/*
 * The two registry-derived vocabularies main's planner takes beside
 * `promptCommands`: the words whose argument is a value chosen from a list, and
 * the words the registry itself declares an argument for (`arguments !== "none"`,
 * which is where `/login`, `/move` and their peers live). Both are built in
 * `slash-commands.tsx` from the same `SlashCommandMeta` rows this fixture names.
 */
const VALUE_ARGUMENT_COMMANDS = [
	"team",
	"teams",
	"agent",
	"agents",
	"model",
	"theme",
	"themes",
];
const ARGUMENT_COMMANDS = ["move", "rename", "title", "model", "theme"];
/** The roster snapshot the completion list's own query holds. */
const NAME_CHOICES = new Set(["ops", "frontend-guild", "reviewer"]);

const runs = (draft, over = {}) =>
	slashHighlightRuns({
		draft,
		commandNames: COMMAND_NAMES,
		nameListCommands: NAME_LIST_COMMANDS,
		nameChoices: NAME_CHOICES,
		picking: false,
		...over,
	});

test("the leading token of the FIRST CONTENT LINE is the command (editor.py:4273-4286)", () => {
	// A bare command word: the whole token, from its `/` through the word.
	assert.deepEqual(runs("/compact"), [{ start: 0, end: 8, kind: "command" }]);
	assert.deepEqual(runs("/usage more prose and more"), [
		{ start: 0, end: 6, kind: "command" },
	]);
	// Blank lines before it are SKIPPED — the command is still the first content
	// line's leading token, not the draft's first character.
	assert.deepEqual(runs("\n\n/usage now"), [
		{ start: 2, end: 8, kind: "command" },
	]);
	// The line's own indentation is part of the position and is NOT painted.
	assert.deepEqual(runs("   /usage"), [{ start: 3, end: 9, kind: "command" }]);
	// A draft with no content at all paints nothing.
	assert.deepEqual(runs(""), []);
	assert.deepEqual(runs("  \n\t\n"), []);
});

test("a recognised word is the command run, case-insensitively and through aliases (editor.py:4308-4322)", () => {
	assert.deepEqual(runs("/TEAM ops review"), [
		{ start: 0, end: 5, kind: "command" },
		// ...and the NAME lookup is case-insensitive in the same way.
		{ start: 6, end: 9, kind: "name" },
	]);
	// An ALIAS is a command too: `/teams` resolves to `/team`'s recipe, so the
	// row a user typed is the row the registry recognises.
	assert.deepEqual(runs("/teams ops review"), [
		{ start: 0, end: 6, kind: "command" },
		{ start: 7, end: 10, kind: "name" },
	]);
});

test("an unrecognised word is inert text, and the tint is suppressed while the list is choosing (editor.py:4310-4322)", () => {
	// The leading word that names no command: dimmed, because it is text that
	// WILL be sent rather than a command about to run.
	assert.deepEqual(runs("/teem fix this"), [
		{ start: 0, end: 5, kind: "unknown" },
	]);
	// A path-like leading token is the same case — the tokenizer takes the whole
	// word, so `/etc/hosts` is one unknown token rather than a command plus prose.
	assert.deepEqual(runs("/etc/hosts is wrong"), [
		{ start: 0, end: 10, kind: "unknown" },
	]);
	// A bare `/` is an empty word: unknown, and suppressed while choosing.
	assert.deepEqual(runs("/"), [{ start: 0, end: 1, kind: "unknown" }]);
	// While the command list is still choosing, a prefix is in progress rather
	// than wrong, so there is no tint at all.
	assert.deepEqual(runs("/teem", { picking: true }), []);
	// ...which does not suppress a RECOGNISED word: it stops being uncertain the
	// moment it resolves.
	assert.deepEqual(runs("/team ops", { picking: true }), [
		{ start: 0, end: 5, kind: "command" },
		{ start: 6, end: 9, kind: "name" },
	]);
});

test("a slash inside a sentence paints nothing (editor.py:4279-4281)", () => {
	// The first content line does not START with the slash, so there is no
	// command token anywhere in the draft.
	assert.deepEqual(runs("fix this /usage"), []);
	assert.deepEqual(runs("please /compact this"), []);
	assert.deepEqual(runs("src/foo and/or"), []);
	// A command token on a LATER line is not on the first content line either.
	assert.deepEqual(runs("hello\n/team ops"), []);
	// A newline after the command line is the same fact: the draft is a message
	// body, so even a recognised word on line 1 paints nothing.
	assert.deepEqual(runs("/usage\nfix this"), []);
});

test("a newline after the command line kills every run, EXCEPT for the NAME+message commands (editor.py:4303-4304)", () => {
	// The buffer is a message body from the newline on, and a stray command tint
	// there would contradict "this is prose".
	assert.deepEqual(runs("/usage\nfix this"), []);
	assert.deepEqual(runs("/teem\nthere"), []);
	// `/team`·`/agent` are DEFINED as `<command> <name> <free-text message>` with
	// the message expected to span lines, and the command still dispatches across
	// the newline, so its tokens keep their tint.
	assert.deepEqual(runs("/team ops review the queue\nand then ship it"), [
		{ start: 0, end: 5, kind: "command" },
		{ start: 6, end: 9, kind: "name" },
	]);
	// The same draft for a command that is NOT a NAME+message command: the whole
	// run set is dropped, name or no name.
	assert.deepEqual(runs("/goal ops review\nand more"), []);
	assert.deepEqual(runs("/mcp logout seems\nbroken"), []);
});

test("the NAME token is tinted only for a roster hit (editor.py:4324-4358)", () => {
	// An exact snapshot hit: the resolved argument must not collapse into the
	// command word, which is the whole point of the second tint.
	assert.deepEqual(runs("/team frontend-guild review the queue"), [
		{ start: 0, end: 5, kind: "command" },
		{ start: 6, end: 20, kind: "name" },
	]);
	// A half-typed name stays prose rather than flickering.
	assert.deepEqual(runs("/team front"), [
		{ start: 0, end: 5, kind: "command" },
	]);
	// Extra spaces before the name are skipped, and the name is what is painted.
	assert.deepEqual(runs("/agent   reviewer   look at this"), [
		{ start: 0, end: 6, kind: "command" },
		{ start: 9, end: 17, kind: "name" },
	]);
	// A word that is not a name-list command has no name run even when its first
	// argument IS a roster name: `/goal`'s argument is free text.
	assert.deepEqual(runs("/goal ops review"), [
		{ start: 0, end: 5, kind: "command" },
	]);
	// `/team chart` is the reserved two-level subcommand, so its first argument is
	// never a roster name to paint — even if a team were literally called `chart`.
	assert.deepEqual(runs("/team chart", { nameChoices: new Set(["chart"]) }), [
		{ start: 0, end: 5, kind: "command" },
	]);
	// `/agent chart` is NOT reserved (the exclusion is `/team`'s own subcommand),
	// so a roster entry with that name paints.
	assert.deepEqual(runs("/agent chart", { nameChoices: new Set(["chart"]) }), [
		{ start: 0, end: 6, kind: "command" },
		{ start: 7, end: 12, kind: "name" },
	]);
});

test("the free-text tail is never painted (tcss:738-760)", () => {
	// The instruction set — the half of the contrast the highlight exists for —
	// is ordinary prose from the name's terminating space on.
	const draft = "/team frontend-guild review the queue and merge it";
	const painted = runs(draft);
	const tail = draft.indexOf("review");
	for (const run of painted) {
		assert.ok(
			run.end <= tail,
			`the run ${JSON.stringify(run)} covers the instruction set`,
		);
	}
	// And on a single-line non-name command the same holds for its argument: only
	// the word is structure, the value after it is prose.
	assert.deepEqual(runs("/model gpt-5"), [
		{ start: 0, end: 6, kind: "command" },
	]);
});

test("a CRLF line paints the command and withholds the name, exactly as the TUI does", () => {
	/*
	 * A pasted CRLF draft leaves the `\r` on the line: the TUI strips it in the
	 * TOKENIZER, not in the highlighter, so its name lookup sees `ops\r` and
	 * misses the snapshot. This pins the same behaviour here rather than silently
	 * diverging — the renderer could strip it, and if it should, that is a change
	 * to make in both hosts with a test in each.
	 */
	assert.deepEqual(runs("/team ops\r\nbody"), [
		{ start: 0, end: 5, kind: "command" },
	]);
});

test("the first content line is the mirror's payload, from one definition", () => {
	// The offsets the builder paints and the slice the mirror renders come from
	// the same function, so the painted layer cannot disagree with the offsets.
	assert.deepEqual(firstContentLine("/usage\nfix"), { start: 0, end: 6 });
	assert.deepEqual(firstContentLine("\n  /team ops\nbody"), {
		start: 3,
		end: 12,
	});
	assert.equal(firstContentLine("   \n\n"), null);
	assert.deepEqual(firstContentLine("hello"), { start: 0, end: 5 });
	// A run is always inside the line `firstContentLine` reports, which is the
	// invariant the mirror depends on.
	for (const draft of ["/team frontend-guild review\nmore", "\n /usage x"]) {
		const line = firstContentLine(draft);
		for (const run of runs(draft)) {
			assert.ok(run.start >= line.start && run.end <= line.end);
		}
	}
});

/*
 * THE TWO GATES THE FRAMES COULD NOT PIN (review round 2 MINOR-1).
 *
 * Both are behaviour the round-1 remediation shipped with no executed assertion:
 * reverting either left every suite green, and the frame set cannot fail a
 * regression it has no predicate for. They are pure functions in the module above
 * for exactly this reason.
 */
test("the tint is dropped where Enter sends the draft as a message", () => {
	const draft = "/compact hello";
	const painted = runs(draft);
	assert.ok(painted.length > 0, "the run rule paints this word on its own");
	assert.deepEqual(
		runsMatchingPlan(painted, draft, { sendsAsWritten: true }),
		[],
		"a draft the planner sends as a message paints nothing",
	);
	assert.deepEqual(
		runsMatchingPlan(painted, draft, { sendsAsWritten: false }),
		painted,
		"and the same runs survive where the command runs",
	);
});

test("the `unknown` run is narrowed to the bare word", () => {
	// With text after it the line is neither sent nor run — the dispatcher answers
	// "unknown command" and keeps the draft — so the ink whose meaning is "inert
	// text that WILL be sent" may not be painted (design D6).
	const withText = "/teem fix this";
	assert.ok(runs(withText).length > 0, "the rule still paints an unknown word");
	assert.deepEqual(
		runsMatchingPlan(runs(withText), withText, { sendsAsWritten: false }),
		[],
	);
	const bare = "/teem";
	assert.equal(
		runsMatchingPlan(runs(bare), bare, { sendsAsWritten: false }).length,
		runs(bare).length,
		"the bare word keeps its dim",
	);
});

test("every run steps colour when the composer refuses input", () => {
	// Branding: disabled changes colour, never opacity — and the mirror's container
	// cannot do it, because a descendant span wins (design round 1 D2).
	for (const kind of ["command", "name", "unknown"]) {
		assert.equal(runInkClass(kind, true), "text-ink-disabled", kind);
	}
	assert.equal(runInkClass("name", false), "text-success");
	assert.equal(runInkClass("unknown", false), "text-ink-dim");
});

test("the command run's weight step is painted, so the mirror still wraps where the textarea does", () => {
	/*
	 * QA round 1 Q1, and the reason this is a test rather than a class string.
	 *
	 * The mirror paints every glyph while the textarea's own text is transparent, so
	 * the mirror's line breaking has to BE the textarea's. A real weight step moves
	 * the advances: `/agent coder ` + 65 characters is 780.67px at weight 400 and
	 * wraps inside a 782px column at 600, and the mirror's own `overflow: hidden`
	 * then swallowed the 65 characters the user had just typed. The step is a stroke
	 * instead — the design round's own measurement (a 4px stem against prose's 3px
	 * at dsf 2, i.e. +0.5 CSS px, and a stroke of width W grows a stem by W) in a
	 * channel that changes no advance, so the tint survives and the layout does not
	 * move.
	 */
	assert.equal(
		runInkClass("command", false),
		"text-token-command slash-run-bold",
	);
	for (const kind of ["command", "name", "unknown"]) {
		assert.doesNotMatch(
			runInkClass(kind, false),
			/(?:^|\s)font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?:\s|$)/,
			`${kind} must not carry a weight utility: it moves the advances and the mirror then wraps where the textarea does not (QA round 1 Q1)`,
		);
	}
	const styles = readFileSync("src/renderer/src/styles/index.css", "utf8");
	/*
	 * ONE CONSTANT WIDTH, PINNED — AND NO RASTER BAND (design round 3 D8). Round 2
	 * pinned both halves of a raster-query floor; round 3's own author withdrew the
	 * finding that floor was written for (D6: on a REAL 1x build the 0.5px stroke
	 * paints at half strength, not nothing — the round-2 proxy rasterised 0.25
	 * device px, not 0.5) and showed what the floor cost: below 2dppx it took the
	 * run's stems from prose's 1 device pixel to 2 (+122% ink, counters closed),
	 * where the 2x band shows +50%. So the width is the design round's own
	 * measurement at every raster, and the band's ABSENCE is asserted too: a band is
	 * what let twelve frames of one row print two different widths (review round 3
	 * MAJOR 1), and a rule that does not vary with the raster cannot.
	 */
	assert.match(
		styles,
		/\.slash-run-bold\s*\{[^}]*-webkit-text-stroke:\s*0\.5px currentColor/,
		"the painted weight step is one constant width — the one the design round measured (0.5 CSS px = one device px at dsf 2)",
	);
	assert.doesNotMatch(
		styles,
		/@media[^{]*min-resolution[^{]*\{[\s\S]{0,200}?slash-run-bold/,
		"the stroke's width must not be a raster band: the floor was withdrawn in round 3 (D8) and a per-raster width is what made one row's frames disagree (review round 3 MAJOR 1)",
	);
});

test("segmentsOf emits every character of the draft exactly once", () => {
	/*
	 * Totality, EXECUTED (review round 1 MINOR 2). The mirror is the only painter of
	 * the draft whenever a run exists, so a dropped segment is invisible text loss —
	 * and no frame can show the character that is missing. The defensive branches
	 * (stale offsets after a keystroke, overlapping and out-of-range runs) cannot be
	 * produced by the rule, so they are driven directly at the bottom.
	 */
	const nameChoices = new Set(["frontend-guild", "ops"]);
	const paintedRuns = (draft) =>
		slashHighlightRuns({
			draft,
			commandNames: COMMAND_NAMES,
			nameListCommands: NAME_LIST_COMMANDS,
			nameChoices,
			picking: false,
		});
	const drafts = [
		"",
		"/compact",
		"/team ops review the queue",
		"/team frontend-guild review the queue\nand then send it on to the reviewer",
		"/teem fix this",
		"fix this /usage",
		"prose with no token at all",
		`/agent coder ${"w".repeat(65)}`,
		"/team ops\r\nbody of the instruction",
	];
	for (const draft of drafts) {
		const segments = segmentsOf(draft, paintedRuns(draft));
		assert.equal(
			segments.map((segment) => segment.text).join(""),
			draft,
			`the segments must reproduce ${JSON.stringify(draft)} exactly`,
		);
		let at = 0;
		for (const segment of segments) {
			assert.equal(
				segment.start,
				at,
				"segments are contiguous and in draft order",
			);
			assert.ok(segment.text.length > 0, "no empty segment is emitted");
			at += segment.text.length;
		}
		assert.equal(at, draft.length);
	}
	/* The branches no rule output reaches: a stale run past the end, a reversed
	 * offset, an overlap and an empty span. `hel` is the first run clipped to what
	 * the draft holds, the overlap is skipped rather than re-painting characters a
	 * run already owns, and `lo` is the prose tail — every character still lands
	 * exactly once. */
	const defensive = segmentsOf("hello", [
		{ start: 2, end: 99, kind: "command" },
		{ start: 0, end: 3, kind: "unknown" },
		{ start: -4, end: 1, kind: "name" },
		{ start: 4, end: 4, kind: "command" },
	]);
	assert.equal(defensive.map((segment) => segment.text).join(""), "hello");
	assert.deepEqual(
		defensive.map((segment) => segment.text),
		["hel", "lo"],
	);
});

/*
 * THE WIRING, NOT ONLY THE PREDICATES (review r3 MINOR-1).
 *
 * The pure gate was pinned in round 2, and deleting the CALL left 149 tests green:
 * a suite that only exercises `runsMatchingPlan` cannot see a composer that stopped
 * asking it. These two rows go draft -> real plan -> runs, which is the chain the
 * composer runs, and the source assertion below is what fails if the call itself is
 * removed (the shape the reviewer measured: `return runs;`).
 */
test("draft -> plan -> runs: the tint follows what Enter will do", () => {
	const planFor = (draft) =>
		planSlashSubmission({
			draft,
			caret: draft.length,
			commandNames: COMMAND_NAMES,
			// The composer's own derivation (`promptCommands ∪ inlineArgumentFor`),
			// as the popup builds it: the words whose trailing text is prose.
			promptCommands: new Set(["goal", "loop", "btw", "fork", "team", "agent"]),
			nameListCommands: NAME_LIST_COMMANDS,
			armedOnlyCommands: new Set(["goal"]),
			// The registry's own declaration of an argument, which this host's
			// planner takes beside the prompt list (main's rule; the WIRE's
			// `argument_shape` vocabulary is a separate branch's work and is not
			// what is being pinned here).
			valueArgumentCommands: new Set(VALUE_ARGUMENT_COMMANDS),
			argumentCommands: new Set(ARGUMENT_COMMANDS),
			enabled: true,
		});
	const painted = (draft) =>
		runsMatchingPlan(runs(draft), draft, {
			sendsAsWritten: planFor(draft).kind === "send",
		});

	/*
	 * A word whose trailing text this host does not own: Enter sends the draft, so
	 * nothing is painted even though the run rule paints the word on its own.
	 */
	assert.equal(planFor("/compact hello").kind, "send");
	assert.deepEqual(painted("/compact hello"), []);
	// The same word as the whole draft: Enter runs it, so the run stays.
	assert.equal(planFor("/compact").kind, "whole");
	assert.ok(painted("/compact").length > 0);
});

test("with the commands capability off, the tint is withheld as well as Enter", () => {
	/*
	 * The falsifier for the override this gate no longer has (review round 1 MAJOR
	 * 1). `planSlashSubmission` answers `send` for every draft when the capability
	 * is off, unconditionally and first, so a mount that asked the plan with the
	 * capability IT has paints nothing — and one that asked with `enabled: true`
	 * painted a bare `/compact` that Enter posts to the model as prose. Both halves
	 * are executed here on the real planner, and `slash-highlight.test.mjs`'s source
	 * assertion keeps the call site from passing an override again.
	 */
	const plan = (draft, enabled) =>
		planSlashSubmission({
			draft,
			caret: draft.length,
			commandNames: COMMAND_NAMES,
			promptCommands: new Set(["goal", "loop", "btw", "fork", "team", "agent"]),
			nameListCommands: NAME_LIST_COMMANDS,
			armedOnlyCommands: new Set(["goal"]),
			valueArgumentCommands: new Set(VALUE_ARGUMENT_COMMANDS),
			argumentCommands: new Set(ARGUMENT_COMMANDS),
			enabled,
		});
	const paintedWith = (draft, enabled) =>
		runsMatchingPlan(runs(draft), draft, {
			sendsAsWritten: plan(draft, enabled).kind === "send",
		});

	assert.equal(plan("/compact", false).kind, "send");
	assert.deepEqual(paintedWith("/compact", false), []);
	assert.equal(plan("/team ops review the queue", false).kind, "send");
	assert.deepEqual(paintedWith("/team ops review the queue", false), []);

	assert.equal(plan("/compact", true).kind, "whole");
	assert.ok(paintedWith("/compact", true).length > 0);
	assert.deepEqual(
		paintedWith("/team ops review the queue", true).map((run) => run.kind),
		["command", "name"],
	);
});

test("the composer and the mirror both make the calls these pins describe", () => {
	/*
	 * Source assertions, and deliberately so: the gates are called from a React
	 * render, where no unit test can reach the CALL without a DOM harness this repo
	 * does not have for the composer. They fail on exactly the mutations the
	 * reviewers used (`return runs;` at the memo, a mirror that stops asking for the
	 * ink, a plan call site that hands itself a capability).
	 *
	 * WHITESPACE IS NORMALISED before matching (review round 1 NIT 3): the earlier
	 * form required three arguments on one line, so a reformat failed the suite with
	 * no behaviour change — the assertion has to pin the SEMANTICS.
	 */
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	);
	const flatComposer = composer.replace(/\s+/g, " ");
	assert.match(
		flatComposer,
		/runsMatchingPlan\(runs, newMessage, \{ sendsAsWritten: plan\.kind === "send",/,
		"the composer must consult the plan before painting",
	);
	/*
	 * NO CAPABILITY OVERRIDE (review round 1 MAJOR 1). The highlight briefly asked
	 * `planFor(..., { enabled: true })` so the dispatcher-less Storybook harness would
	 * still paint, which let a commands-off mount show a tinted word Enter posts as
	 * prose. The mount's own value is the only one either consumer may use, so no
	 * call site may pass one and `planFor` may not take one.
	 */
	assert.doesNotMatch(
		flatComposer,
		/planFor\([^)]*enabled:/,
		"a plan call site must not pass a capability override: the tint and Enter have to answer from one capability",
	);
	assert.doesNotMatch(
		flatComposer,
		/over:\s*\{\s*enabled/,
		"`planFor` must not accept an `enabled` override",
	);
	/*
	 * AND THE VALUE IS THE MOUNT'S OWN (review round 2 MINOR 1). The absence pins
	 * above guard the override's SHAPE — no call site passes one, `planFor` takes
	 * none — and neither reads the value the override used to be: replacing
	 * `planFor`'s own `enabled:` line with a constant left this file 17/17 green,
	 * which is code review round 1 MAJOR 1's counterfactual, recreated with a green
	 * suite. So the source is pinned POSITIVELY, and positively is the only form
	 * that works here: a negative `/enabled:\s*true/` would match the commentary
	 * above (which quotes the removed override to explain why it is gone).
	 */
	assert.match(
		flatComposer,
		/enabled:\s*slash\.available\s*&&\s*Boolean\(onSlashCommand\)/,
		"the plan must answer from this mount's own capability: the tint and Enter have to agree, and a constant here is the override returning",
	);
	/*
	 * AND THE HARNESS SUPPLIES THE HALF IT WAS MISSING instead. The bridge already
	 * advertises the `commands` feature; the dispatcher is the other half of
	 * `slash.available && Boolean(onSlashCommand)`, so a harness that paints runs is a
	 * harness that would run them.
	 */
	const stories = readFileSync(
		"src/renderer/src/features/chat/components/slash-highlight.stories.tsx",
		"utf8",
	);
	assert.match(
		stories,
		/onSlashCommand=\{harnessDispatch\}/,
		"the Storybook harness must hand the composer a dispatcher, so its tint is gated on a capability the mount really has",
	);
	const mirror = readFileSync(
		"src/renderer/src/features/chat/components/composer-highlight.tsx",
		"utf8",
	);
	assert.match(
		mirror,
		/runInkClass\(segment\.kind, refused\)/,
		"the mirror must step its ink through the same helper the pin exercises",
	);
});

/*
 * Q3-1: THE SEPARATOR CLASS THE TINT TOKENISES ON IS PYTHON'S. This file read `\s`
 * while the planner read Python's set, so the five characters Python separates on
 * and JavaScript does not ran a command with NO tint — 2,804 rows of a
 * 3,652-draft sweep, against 0 once both read the one class. Asserted through the
 * planner's own filter, because "a command executes with the colour affordance
 * the reader was promised" is the property, not "a run exists".
 */
test("the tint tokenises on the Python separator class, not `\\s` (Q3-1)", () => {
	for (const [name, separator] of [
		["U+001C", "\u001c"],
		["U+001D", "\u001d"],
		["U+001E", "\u001e"],
		["U+001F", "\u001f"],
		["U+0085", "\u0085"],
	]) {
		for (const draft of [
			`${separator}/mcp logout srv`,
			// The IN-WORD position is the one that discriminates the word-end
			// separator: with `\s` the word here is `mcp<sep>logout`, which names
			// nothing, so no command run is emitted at all.
			`/mcp${separator}logout srv`,
		]) {
			const painted = runsMatchingPlan(runs(draft), draft, {
				sendsAsWritten: false,
			});
			assert.ok(
				painted.some(
					(r) => r.kind === "command" && draft.slice(r.start, r.end) === "/mcp",
				),
				`${name} in ${JSON.stringify(draft)} tints the command that runs`,
			);
		}
	}
	// The reverse sign: U+FEFF is NOT a separator, so the word is not the draft's
	// first token and there is nothing for the tint to own.
	for (const feff of ["\ufeff/mcp logout srv", "/mcp\ufefflogout srv"]) {
		const painted = runsMatchingPlan(runs(feff), feff, {
			sendsAsWritten: false,
		});
		assert.equal(
			painted.some((r) => r.kind === "command"),
			false,
			`U+FEFF is a character in the word, not a separator (${JSON.stringify(feff)})`,
		);
	}
});
