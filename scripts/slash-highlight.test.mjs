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
			'export { planSlashSubmission } from "./src/renderer/src/features/chat/components/slash-submit";',
		resolveDir: process.cwd(),
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

test("every run steps colour when the composer is disabled", () => {
	// Branding: disabled changes colour, never opacity — and the mirror's container
	// cannot do it, because a descendant span wins (design round 1 D2).
	for (const kind of ["command", "name", "unknown"]) {
		assert.equal(runInkClass(kind, true), "text-ink-disabled", kind);
	}
	assert.equal(
		runInkClass("command", false),
		"text-token-command font-semibold",
	);
	assert.equal(runInkClass("name", false), "text-success");
	assert.equal(runInkClass("unknown", false), "text-ink-dim");
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

test("the composer and the mirror both make the calls these pins describe", () => {
	/*
	 * A source assertion, and deliberately so: the gates are called from a React
	 * render, where no unit test can reach the CALL without a DOM harness this repo
	 * does not have for the composer. It fails on exactly the mutation the reviewer
	 * used (`return runs;` at the memo, or a mirror that stops asking for the ink),
	 * which is the property worth pinning.
	 */
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	);
	assert.match(
		composer,
		/runsMatchingPlan\(runs, newMessage, \{\s*sendsAsWritten: plan\.kind === "send",/,
		"the composer must consult the plan before painting",
	);
	const mirror = readFileSync(
		"src/renderer/src/features/chat/components/composer-highlight.tsx",
		"utf8",
	);
	assert.match(
		mirror,
		/runInkClass\(segment\.kind, disabled\)/,
		"the mirror must step its ink through the same helper the pin exercises",
	);
});
