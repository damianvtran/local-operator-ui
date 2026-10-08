import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

/*
 * Two things are asserted here, and both are ports of behaviour that lives in
 * another language.
 *
 * 1. The tool row's arithmetic (`tool-row-model.ts`) mirrors the TUI's
 *    `tool_card.py`. A port whose rules are only checked by looking at a story
 *    drifts from its source the first time either side is edited, so the rules
 *    that HAVE a right answer — which arguments survive into the summary, how a
 *    duration is spelled, what an MCP tool is called — are asserted against the
 *    Python semantics they mirror.
 *
 * 2. The `sessions.attachment` media op reaches exactly one backend path with
 *    main's own bearer, and a renderer cannot steer it anywhere else. That is
 *    the same property `desktop-contract.test.mjs` asserts for the JSON
 *    transport, applied to the relay that carries bytes.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/components/trace/tool-row-model";',
			'export * from "./src/renderer/src/features/chat/components/trace/tool-glyphs";',
			'export { requestDesktopMedia } from "./src/main/desktop-media";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	compactPath,
	deliveryRowOutcome,
	deliverySettledVerb,
	deliveryStateFromDetails,
	diffBody,
	diffCount,
	diffFromDetails,
	diffLineKind,
	diffOverflowLabel,
	displayName,
	formatBytes,
	formatDuration,
	isBareToolName,
	formatSettledDuration,
	isDiffBodyTool,
	isDiffBodyRow,
	isFailedResult,
	isPartialDelivery,
	preferDiff,
	preferDiffCounts,
	preferDeliveryState,
	outputFallbackLine,
	requestDesktopMedia,
	SEND_DELIVERY_LABEL,
	SEND_DELIVERY_NOTE,
	SEND_DELIVERY_TITLE,
	SEND_DELIVERY_WORD,
	stripDiffHeader,
	summaryFromArgs,
	toolCategory,
	toolIcon,
	toolOp,
	toolRowLabel,
	toolVerb,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("the summary is the identity arguments, not the payload", () => {
	// A `write` carries both `path` and `content`; joining the first two scalars
	// in argument order would bury the filename under the first sixty characters
	// of the file being written, which is the one thing the row is for.
	assert.equal(
		summaryFromArgs("write", {
			content: "a very long file body that must not win",
			path: "notes.md",
		}),
		"notes.md",
	);
	// First TWO identity scalars, joined by a space.
	assert.equal(
		summaryFromArgs("grep", { pattern: "needle", path: "src" }),
		"needle src",
	);
	// An unknown or MCP tool has no recognisable identity argument, so every
	// scalar is in scope — still first two, still argument order.
	assert.equal(
		summaryFromArgs("mcp__linear_create_issue", { team: "core", title: "Bug" }),
		"core Bug",
	);
	// Non-scalars are dropped rather than stringified into `[object Object]`.
	assert.equal(summaryFromArgs("todo", { items: ["a"] }), "todo");
	// The OPERATION SELECTOR is not an object once a verb table reads it: `op`
	// is the word the row's verb is about to say, and `{items:["a"], op:"add"}`
	// used to resolve to `add` - which is how the row came to read `Updated
	// todos add` and, for `agent`, `Delegated list` (operator report,
	// 2026-09-27). For a tool with no op table the scalars are untouched.
	assert.equal(summaryFromArgs("todo", { items: ["a"], op: "add" }), "todo");
	assert.equal(summaryFromArgs("agent", { op: "list" }), "agent");
	assert.equal(
		summaryFromArgs("agent", { op: "show", name: "designer" }),
		"designer",
	);
	assert.equal(
		summaryFromArgs("browser", { action: "type", text: "hi" }),
		"type hi",
	);
	assert.equal(
		summaryFromArgs("mcp__linear_create_issue", {
			action: "list",
			team: "core",
		}),
		"list core",
	);
	// Nothing usable at all: the tool's own name, never an empty row.
	assert.equal(summaryFromArgs("eval", {}), "eval");
	assert.equal(summaryFromArgs("eval", null), "eval");
});

test("a send row leads with the delivery mode", () => {
	// The row truncates from the right, so with the marker after the target
	// three calls to the same peer with three different delivery promises paint
	// identical rows at ordinary widths — and one of them woke a peer while
	// another did not. The discriminator goes first.
	assert.equal(
		summaryFromArgs("send", { target: "coder", message: "ping" }),
		"wake · coder · ping",
	);
	assert.equal(
		summaryFromArgs("send", { target: "coder", wake: false, message: "ping" }),
		"quiet · coder · ping",
	);
	assert.equal(
		summaryFromArgs("send", { pid: 48213, now: true, message: "stop" }),
		"now · pid 48213 · stop",
	);
	// Nothing addresses a peer: `?` rather than a blank, which would read as
	// though the next field were the target.
	assert.equal(summaryFromArgs("send", { message: "hi" }), "wake · ? · hi");
});

test("a send row's delivery state is read from details, and absent or unknown is no statement", () => {
	/*
	 * The renderers must not sniff prose - the rule the row's other state fields
	 * already keep - so the state comes from `details.delivery.state` alone. Two
	 * ways of saying nothing have to read the SAME, because their fallback is
	 * exactly the row this field did not exist for: an old transcript, an old core
	 * and a tool that never had a delivery.
	 */
	for (const state of ["delivered", "mailbox", "unconfirmed", "failed"]) {
		assert.equal(deliveryStateFromDetails({ delivery: { state } }), state);
	}
	// A state this build does not know is treated as absent, never guessed at.
	assert.equal(
		deliveryStateFromDetails({ delivery: { state: "queued" } }),
		null,
	);
	assert.equal(deliveryStateFromDetails({ delivery: { state: "" } }), null);
	assert.equal(deliveryStateFromDetails({ delivery: { state: 7 } }), null);
	// Absent, in every shape a result can be absent in - and ANOTHER tool's
	// `details` object, which must not be read as a delivery that says nothing
	// new but as no delivery at all.
	assert.equal(deliveryStateFromDetails({}), null);
	assert.equal(deliveryStateFromDetails({ delivery: {} }), null);
	assert.equal(deliveryStateFromDetails({ delivery: "mailbox" }), null);
	assert.equal(deliveryStateFromDetails({ diff: ["+ one"], pid: 42 }), null);
	assert.equal(deliveryStateFromDetails(null), null);
	assert.equal(deliveryStateFromDetails(undefined), null);

	/*
	 * And the reducer's rule, which is `preferDiffCounts`' rule because it is the
	 * same question: a frame whose `details` were stripped says NOTHING and keeps
	 * what the row held, where a frame that carried an object states the delivery
	 * (`{}` included, which is the producer saying "no delivery here").
	 */
	assert.equal(preferDeliveryState(undefined, "mailbox"), "mailbox");
	assert.equal(preferDeliveryState(null, "unconfirmed"), "unconfirmed");
	assert.equal(preferDeliveryState(undefined, null), null);
	assert.equal(
		preferDeliveryState({ delivery: { state: "failed" } }, "mailbox"),
		"failed",
	);
	assert.equal(preferDeliveryState({}, "mailbox"), null);

	/*
	 * THE WORDS, THE SPOKEN SENTENCES, THE HOVERS AND THE EXPANSION NOTES,
	 * verbatim - and the provenance of each is stated rather than implied (agent
	 * review round 1: for one round the `unconfirmed` hover was asserted as "the
	 * frozen interface's own strings" when nothing froze it, so the assertion
	 * could not tell the copy from the design).
	 *
	 * FROZEN: the three words (the fourth state's word is `delivery unconfirmed`
	 * per the round-1 disposition, which supersedes the round-0 brief's bare
	 * `unconfirmed`), the mailbox hover, and the mailbox spoken sentence.
	 *
	 * THIS CHANGE'S OWN COMPOSITION, for the design round to bless or replace: the
	 * `unconfirmed` hover, the hedge on the `unconfirmed` spoken sentence (UX U3),
	 * and the three `SEND_DELIVERY_NOTE` sentences (UX U1/U4). They are asserted so
	 * an edit is visible in the suite, NOT as a claim that a design note asked for
	 * them.
	 */
	assert.deepEqual(SEND_DELIVERY_WORD, {
		mailbox: "wake unconfirmed",
		unconfirmed: "delivery unconfirmed",
		failed: "not delivered",
	});
	assert.deepEqual(SEND_DELIVERY_LABEL, {
		mailbox: "delivered, wake unconfirmed",
		unconfirmed:
			"delivery unconfirmed — it may still arrive, so check before resending",
	});
	assert.deepEqual(SEND_DELIVERY_TITLE, {
		mailbox:
			"In their mailbox. The wake got no answer, so they will read it on their next turn.",
		unconfirmed:
			"No wake answer and not yet in their transcript — it may still arrive. Check before resending.",
	});
	// Only the two amber states carry a hover: `not delivered` is the whole
	// statement and `delivered` says nothing at all. Nor does `failed` carry a
	// spoken sentence - its drawn word IS the announcement - so an entry there
	// would be a string nothing renders.
	assert.equal(SEND_DELIVERY_TITLE.failed, undefined);
	assert.equal(SEND_DELIVERY_TITLE.delivered, undefined);
	assert.equal(SEND_DELIVERY_LABEL.failed, undefined);
	assert.equal(SEND_DELIVERY_LABEL.delivered, undefined);
	// Every word is distinct with the colour off, which is what makes the pair
	// readable to a reader who cannot see the amber/red step.
	assert.equal(
		new Set(Object.values(SEND_DELIVERY_WORD)).size,
		Object.keys(SEND_DELIVERY_WORD).length,
	);
	/*
	 * The expansion's own sentences (UX round 1, U1/U4): one per state that did not
	 * plainly succeed, and NONE for `delivered` - a success says nothing, and its
	 * expansion is the row it always was.
	 */
	assert.deepEqual(Object.keys(SEND_DELIVERY_NOTE).sort(), [
		"failed",
		"mailbox",
		"unconfirmed",
	]);
	assert.equal(SEND_DELIVERY_NOTE.delivered, undefined);
	for (const note of Object.values(SEND_DELIVERY_NOTE)) {
		assert.match(note, /\.$/);
		// No agent API in a sentence a PERSON reads (U4): the check the reader can
		// run lives in the model-facing result text, not here.
		assert.ok(
			!/sessions\(|op=|\(id /.test(note),
			`the expansion's note speaks to the reader, not the model — got ${note}`,
		);
		// The states that must not be re-sent say so; the one that may be retried
		// says that instead. Either way there is an action in the sentence.
		assert.match(note, /again|resending|retry/i);
	}
	/*
	 * ...AND THE DIRECTION A NOTE POINTS MUST BE THE DIRECTION THE CARD RENDERS
	 * (agent review round 2, MINOR-1 / design D2 / UX U9). The note is drawn ABOVE
	 * the result block (`[target][message][wake][note][label][machine line]`), so a
	 * "cause above" sent the reader to the arguments grid while the cause is named
	 * in the machine line BELOW it. Pinned as a direction rather than as the
	 * sentence, so the copy can still be rewritten without the pointer drifting
	 * back.
	 */
	assert.doesNotMatch(SEND_DELIVERY_NOTE.failed, /cause above/i);
	assert.match(SEND_DELIVERY_NOTE.failed, /cause named below/i);

	/*
	 * Which outcome each state earns, and the COUNT rule that follows from it: the
	 * fold's failed count, the turn foot's `· N failed` and the failed-row jump all
	 * read `isFailedResult`, so a settled partial can never be counted or jumped to
	 * as a failure even if a producer put `is_error` on it. `failed` earns NO row
	 * outcome of its own - it is the error the row already had, and the word beside
	 * it comes from the table above.
	 */
	assert.equal(deliveryRowOutcome("mailbox"), "partial");
	assert.equal(deliveryRowOutcome("unconfirmed"), "partial");
	assert.equal(deliveryRowOutcome("failed"), null);
	assert.equal(deliveryRowOutcome("delivered"), null);
	assert.equal(deliveryRowOutcome(null), null);
	assert.equal(deliveryRowOutcome(undefined), null);
	assert.ok(isPartialDelivery("mailbox") && isPartialDelivery("unconfirmed"));
	assert.ok(!isPartialDelivery("failed") && !isPartialDelivery("delivered"));
	assert.ok(!isPartialDelivery(null));
	assert.equal(isFailedResult(true, "failed"), true);
	assert.equal(isFailedResult(true, null), true);
	assert.equal(isFailedResult(false, "failed"), false);
	assert.equal(isFailedResult(true, "mailbox"), false);
	assert.equal(isFailedResult(true, "unconfirmed"), false);
	assert.equal(isFailedResult(undefined, "failed"), false);
	/*
	 * And the settled VERB a failed delivery earns (UX round 1, U8): the row must
	 * not open with `Sent` and close with `not delivered`. Only the proven-failure
	 * state overrides; the amber pair keeps the tool's own verb.
	 */
	assert.equal(deliverySettledVerb("failed"), "Attempted");
	assert.equal(deliverySettledVerb("mailbox"), null);
	assert.equal(deliverySettledVerb("unconfirmed"), null);
	assert.equal(deliverySettledVerb("delivered"), null);
	assert.equal(deliverySettledVerb(null), null);
});

test("a sessions row names its operation, its address, and its window", () => {
	/*
	 * `sessions` is one tool with six ops (list/info/spawn/resume/stop/peek,
	 * `docs/design/sessions-tool.md` §3.1), and it mirrors the TUI/phone's
	 * shared summary (`sessions_row_summary`, `harness/rows.py`, sibling PR
	 * `damianvtran/local-operator` #1825) in this row's own grammar: the verb
	 * carries the op, the object everything else. The discriminator rule is
	 * `send`'s, one layer down - the row sheds from the right, so `spawn`
	 * carries its VISIBILITY first (both values; the default is spelled) and
	 * a `stop` beside a `peek` on one session never reads the same.
	 */
	const row = (args) =>
		toolRowLabel(
			"sessions",
			summaryFromArgs("sessions", args),
			null,
			false,
			toolOp(args),
		);

	// A spawn with a name and a prompt: the visibility leads, the name is the
	// subject. An omitted flag still reads `workstream` - the default is the
	// fix this tool ships and must not be the field a narrow row drops.
	assert.deepEqual(row({ op: "spawn", name: "night-audit", prompt: "go" }), {
		verb: "Spawned session",
		object: "workstream · night-audit",
	});
	// The ephemeral arm, prompt-only: no name, and the visibility still leads.
	assert.deepEqual(
		row({ op: "spawn", visibility: "ephemeral", prompt: "fix the shard" }),
		{ verb: "Spawned session", object: "ephemeral · fix the shard" },
	);
	// Addressed ops take the resolver's own precedence: pid, then the exact
	// session id, then the substring (`_sessions_address`).
	assert.deepEqual(row({ op: "stop", target: "release-crew" }), {
		verb: "Stopped session",
		object: "release-crew",
	});
	assert.deepEqual(row({ op: "resume", session: "5d3f2a9c" }), {
		verb: "Resumed session",
		object: "5d3f2a9c",
	});
	assert.deepEqual(row({ op: "info", pid: 48213 }), {
		verb: "Viewed session",
		object: "pid 48213",
	});
	// The lax spellings the schema executes read as the pid they execute as -
	// a string that coerces, and the `.0` float - while a non-integer float,
	// which the schema REFUSES, paints no pid at all and falls through to the
	// address ladder (review round 1, R-3).
	assert.deepEqual(row({ op: "stop", pid: "48213" }), {
		verb: "Stopped session",
		object: "pid 48213",
	});
	assert.deepEqual(row({ op: "info", pid: "48213.0" }), {
		verb: "Viewed session",
		object: "pid 48213",
	});
	assert.deepEqual(row({ op: "stop", pid: 48213.5 }), {
		verb: "Stopped session",
		object: "?",
	});
	// An addressed op that names no address: `?`, never blank (the send rule).
	assert.deepEqual(row({ op: "stop" }), {
		verb: "Stopped session",
		object: "?",
	});
	// peek: the address, then the window. `query` outranks `steps` because the
	// tool keeps `steps` as the match window's SIZE - `last 6` would be a read
	// this call never makes, and the search term would be dropped.
	assert.deepEqual(row({ op: "peek", target: "night-audit", steps: 12 }), {
		verb: "Peeked at session",
		object: "night-audit · last 12",
	});
	assert.deepEqual(
		row({ op: "peek", target: "night-audit", query: "flaky", steps: 6 }),
		{
			verb: "Peeked at session",
			object: "night-audit · search flaky · 6 around",
		},
	);
	assert.deepEqual(row({ op: "peek", target: "night-audit", digest: true }), {
		verb: "Peeked at session",
		object: "night-audit · digest",
	});
	// A call that names no window must not claim one (the tool's default
	// applies, and the row must not invent a `last 12`).
	assert.deepEqual(row({ op: "peek", target: "night-audit" }), {
		verb: "Peeked at session",
		object: "night-audit",
	});
	// The lax ints: a string `steps` executes exactly like its number (the
	// hub/wait lesson, QA Q1b), and a non-numeric string is not a window.
	assert.deepEqual(row({ op: "peek", target: "night-audit", steps: "12" }), {
		verb: "Peeked at session",
		object: "night-audit · last 12",
	});
	assert.deepEqual(row({ op: "peek", target: "night-audit", steps: "many" }), {
		verb: "Peeked at session",
		object: "night-audit",
	});
	// list: the scope markers ride the object; a bare listing names nothing.
	assert.deepEqual(
		row({ op: "list", include_stored: true, query: "release" }),
		{ verb: "Listed sessions", object: "stored · release" },
	);
	assert.deepEqual(row({ op: "list" }), {
		verb: "Listed sessions",
		object: "",
	});
	// The running half is the present participle, as everywhere else.
	assert.equal(toolVerb("sessions", "spawn").running, "Spawning session");
	assert.equal(toolVerb("sessions", "peek").running, "Peeking at session");
	// An operation this build does not know takes the GENERIC verb, and the
	// selector token does not leak into the object (the agent precedent): the
	// call is named, nothing is guessed.
	assert.deepEqual(row({ op: "frobnicate" }), {
		verb: "Called",
		object: "sessions",
	});
	assert.deepEqual(row({ op: "frobnicate", target: "x" }), {
		verb: "Called",
		object: "sessions x",
	});
});

test("a whole-token absolute path is shortened against home", () => {
	assert.equal(compactPath("/Users/damian/notes.md"), "~/notes.md");
	assert.equal(compactPath("/home/damian/src/app.ts"), "~/src/app.ts");
	// Not a whole token: a sentence that merely mentions a slash keeps its
	// wording, because the rewrite exists for paths eating the budget.
	assert.equal(compactPath("/Users/damian/a b.md"), "/Users/damian/a b.md");
	assert.equal(compactPath("relative/path.md"), "relative/path.md");
});

test("an MCP tool displays as the call, not the mint", () => {
	// `mcp__` plus a server name eats the column before a single informative
	// character: three tools from one Linear server all read `mcp__lin`.
	assert.equal(displayName("mcp__linear_create_issue"), "create_issue");
	assert.equal(displayName("mcp__linear_list_issues"), "list_issues");
	// Only the FIRST segment is treated as the server, because a server whose
	// own name has an underscore cannot be split back out — the remainder is
	// still the call's identifier rather than the constant.
	assert.equal(displayName("mcp__my_server_do_thing"), "server_do_thing");
	// Never empty: a name that is only the prefix keeps what it had.
	assert.equal(displayName("mcp__"), "mcp__");
	assert.equal(displayName("bash"), "bash");
});

test("durations are spelled the way each state spells them", () => {
	// Settled: a tenth below ten seconds, whole seconds below a minute.
	assert.equal(formatSettledDuration(2.94), "2.9s");
	// `<0.1s`, never `0.0s`: rounding a genuinely instant call to `0.0s`
	// reprints the string the old fabricated-duration bug produced, so a reader
	// cannot tell a real sub-50 ms call from a row whose duration was lost
	// (`tool_card.py:2615-2623`).
	assert.equal(formatSettledDuration(0), "<0.1s");
	assert.equal(formatSettledDuration(0.04), "<0.1s");
	assert.equal(formatSettledDuration(0.05), "0.1s");
	assert.equal(formatSettledDuration(34.4), "34s");
	assert.equal(formatSettledDuration(117), "1m57s");
	assert.equal(formatSettledDuration(7500), "2h5m");
	// A replayed row whose duration the transcript did not keep leaves the slot
	// empty rather than claiming zero.
	assert.equal(formatSettledDuration(null), "");
	// Running: integer seconds, bounded at six characters over its whole domain.
	assert.equal(formatDuration(0.4), "0s");
	assert.equal(formatDuration(59), "59s");
	assert.equal(formatDuration(60), "1m");
	assert.equal(formatDuration(3599), "59m59s");
	assert.equal(formatDuration(3600), "1h");
	assert.equal(formatDuration(86399), "23h59m");
	assert.equal(formatDuration(86400), "1d");
	assert.equal(formatDuration(100 * 86400), "100d+");
	for (const seconds of [0, 59, 3599, 86399, 99 * 86400 + 82800]) {
		assert.ok(formatDuration(seconds).length <= 6, `${seconds}`);
	}
});

test("a diff counter is a positive integer or it is unknown", () => {
	assert.equal(diffCount(42), 42);
	// `+0` claims that nothing was added; a missing count claims nothing at all,
	// and these are all the second kind.
	assert.equal(diffCount(0), 0);
	assert.equal(diffCount(-3), 0);
	assert.equal(diffCount(true), 0);
	assert.equal(diffCount("7"), 0);
	assert.equal(diffCount(undefined), 0);
	assert.equal(diffCount(1.5), 0);
});

test("a row opens with a verb in the user's terms, never the wire name (D5)", () => {
	/*
	 * §E1's row is a sentence: `Ran pnpm vitest`, `Read src/chat.tsx`. The first
	 * column used to print `bash`, `read`, `web_search` - an identifier in the
	 * sans face - in a fixed-width column that left a hole after a short name.
	 */
	assert.deepEqual(toolVerb("bash"), {
		settled: "Ran",
		running: "Running",
		named: true,
	});
	assert.equal(toolVerb("read").settled, "Read");
	assert.equal(toolVerb("edit").settled, "Edited");
	assert.equal(toolVerb("write").settled, "Wrote");
	assert.equal(toolVerb("web_search").settled, "Searched the web");
	assert.equal(toolVerb("web_fetch").settled, "Fetched");
	// The name is model-controlled; a provider echoing `Bash` keeps the verb.
	assert.equal(toolVerb("Bash").settled, "Ran");
	// A tool the table does not know takes a generic verb and says so, so the
	// row keeps the tool's own name at the head of its object.
	assert.deepEqual(toolVerb("mcp__linear_create_issue"), {
		settled: "Called",
		running: "Calling",
		named: false,
	});
});

test("a meta tool's row names its operation, never the family's one word (operator report, 2026-09-27)", () => {
	/*
	 * `agent`, `team` and `hub` are one tool each that does many jobs, and their
	 * name-only verbs said `Delegated` for all of them: the operator's
	 * screenshot showed `Delegated list` and `Delegated designer` for profile
	 * READS that delegated nothing. The verb is chosen from the arguments'
	 * operation (`toolOp`), and the object never echoes the selector back
	 * (`summaryFromArgs` drops it for the tools whose verb table reads it).
	 */
	const row = (name, args) =>
		toolRowLabel(name, summaryFromArgs(name, args), null, false, toolOp(args));

	// The two rows the operator reported, as labels.
	assert.deepEqual(row("agent", { op: "list" }), {
		verb: "Listed agents",
		object: "",
	});
	assert.deepEqual(row("agent", { op: "show", name: "designer" }), {
		verb: "Viewed agent",
		object: "designer",
	});
	// A write op beside them, so the table is asserted in both directions.
	assert.equal(
		row("agent", { op: "create", name: "docs-writer" }).verb,
		"Created agent",
	);
	assert.deepEqual(row("team", { op: "list" }), {
		verb: "Listed teams",
		object: "",
	});
	assert.deepEqual(row("hub", { op: "peek", to: ["9860"] }), {
		verb: "Peeked at",
		object: "",
	});
	// The object's own precedence is untouched: `hub send` still leads with the
	// message it carries, not the target.
	assert.deepEqual(row("hub", { op: "send", to: ["9860"], message: "ping" }), {
		verb: "Messaged",
		object: "ping",
	});
	// `task` is the call that IS delegation, and it keeps the word.
	assert.equal(row("task", { agent: "designer" }).verb, "Delegated");
	// An operation this build does not know takes the GENERIC verb, and the
	// selector token does not leak into the object - a claim the table cannot
	// make is not made.
	assert.deepEqual(row("agent", { op: "frobnicate" }), {
		verb: "Called",
		object: "agent",
	});
	assert.deepEqual(row("agent", null), { verb: "Called", object: "agent" });
	// A COMPOSING row (no arguments in hand yet) takes the same generic verb,
	// never the old family word: nothing is delegated at that moment.
	assert.deepEqual(toolRowLabel("agent", "composing · 22 B", null, true), {
		verb: "Calling",
		object: "agent composing · 22 B",
	});
});

test("the builtins the row table once missed name their call, and their operation when it matters", () => {
	// The unmapped half of the audit (operator report, 2026-09-27): every tool
	// the running build can emit has a word. A static one where the name says it
	// all; an operation's where one name spans materially different calls.
	assert.equal(toolVerb("web_read").settled, "Read");
	assert.equal(toolVerb("wait").settled, "Waited for jobs");
	assert.equal(toolVerb("team_delete").settled, "Deleted team");
	assert.equal(toolVerb("project_delete").settled, "Deleted project");

	const opRow = (name, op) => toolVerb(name, op);
	assert.equal(opRow("secret", "retrieve").settled, "Retrieved secret");
	assert.equal(opRow("secret", "delete").settled, "Deleted secret");
	assert.equal(opRow("project", "link").settled, "Linked session to");
	assert.equal(opRow("project", "milestone").settled, "Updated milestone");
	assert.equal(opRow("todo", "view").settled, "Read todos");
	assert.equal(opRow("todo", "done").settled, "Updated todos");
	assert.equal(opRow("wake", "list").settled, "Listed wakes");
	assert.equal(opRow("jobs", "cancel").settled, "Cancelled job");
	assert.equal(opRow("network", "status").settled, "Checked network status");
	assert.equal(opRow("network", "join").settled, "Joined network");
	assert.equal(opRow("console", "create").settled, "Opened console");
	assert.equal(opRow("console", "keys").settled, "Sent keys");
	assert.equal(opRow("lsp", "definitions").settled, "Found definition");
	assert.equal(opRow("lsp", "rename_preview").settled, "Previewed rename");
	// The running half is the present participle, as everywhere else.
	assert.equal(opRow("agent", "sync").running, "Syncing agents");
	assert.equal(opRow("hub", "resume").running, "Resuming");
	// And an op-aware tool with no known op is generic, never a neighbouring
	// claim - the same discipline an unknown NAME takes.
	assert.deepEqual(toolVerb("secret"), {
		settled: "Called",
		running: "Calling",
		named: false,
	});
});

test("the project family names every operation, and the milestone flag decides add or remove (operator report follow-up, 2026-09-27)", () => {
	/*
	 * The second report: a project VIEW rendered `Called project
	 * ui-update-account-robustness` under the generic wrench. `project` has
	 * seven ops in the running build's schema (`project_tool.py`: list, show,
	 * create, update, link, unlink, milestone) and NO `remove` op - the removal
	 * is the `milestone` op's `remove` flag, which is why the row's token is
	 * composed from the flag as well as the op.
	 */
	const row = (name, args) =>
		toolRowLabel(name, summaryFromArgs(name, args), null, false, toolOp(args));

	// The row the operator's screenshot showed.
	assert.deepEqual(
		row("project", { op: "show", name: "ui-update-account-robustness" }),
		{
			verb: "Viewed project",
			object: "ui-update-account-robustness",
		},
	);
	// A listing has no subject, and the selector never echoes into the object.
	assert.deepEqual(row("project", { op: "list" }), {
		verb: "Listed projects",
		object: "",
	});
	// The milestone op goes both ways; the row says which.
	assert.deepEqual(row("project", { op: "milestone", milestone: "ship-v2" }), {
		verb: "Updated milestone",
		object: "ship-v2",
	});
	assert.deepEqual(
		row("project", { op: "milestone", milestone: "ship-v2", remove: true }),
		{ verb: "Removed milestone", object: "ship-v2" },
	);
	// Every op the installed build accepts names its call: `Called` is what a
	// row says when it does NOT know, and none of these are that. The five
	// meta tools whose ops the tables key on are all covered EXHAUSTIVELY here
	// (review round 1, R1-2; `sessions` added by the trace-sessions lane): a
	// typo or a dropped entry in any of them used to fall to `Called` with
	// nothing failing.
	for (const [tool, ops] of Object.entries({
		agent: [
			"list",
			"show",
			"search",
			"install",
			"reset",
			"create",
			"update",
			"sync",
		],
		team: ["list", "show", "create", "update"],
		hub: ["list", "peek", "send", "ask", "steer", "pause", "cancel", "resume"],
		project: [
			"list",
			"show",
			"create",
			"update",
			"link",
			"unlink",
			"milestone",
		],
		sessions: ["list", "info", "spawn", "resume", "stop", "peek"],
	})) {
		for (const op of ops) {
			assert.notEqual(
				toolVerb(tool, op).settled,
				"Called",
				`${tool} op \`${op}\` must name its operation`,
			);
		}
	}
	// The remove flag's SPELLINGS are the full set the tool itself accepts, not
	// only the bare boolean: pydantic 2.13.5 coerces `true`, `1` and - any case -
	// `"true" | "yes" | "y" | "t" | "on" | "1"` to True before the milestone op
	// runs, and `"yes"` removes in the wild (review round 2, QA Q1a), so every
	// one of them must compose the removal and must not read as an update.
	for (const spelling of [
		true,
		1,
		"true",
		"TRUE",
		"Yes",
		"y",
		"T",
		"on",
		"1",
	]) {
		assert.deepEqual(
			row("project", {
				op: "milestone",
				milestone: "ship-v2",
				remove: spelling,
			}),
			{ verb: "Removed milestone", object: "ship-v2" },
			`remove: ${JSON.stringify(spelling)} removes`,
		);
	}
	// The falsy set keeps the update verb, and so do spellings the tool REJECTS:
	// `" true "` (with whitespace) is a validation error, not a spelling - the
	// comparison lowercases but never trims - and `2` is no boolean at all.
	// Neither removed anything, which is the one thing the row must not claim.
	for (const spelling of [
		false,
		0,
		"false",
		"FALSE",
		"No",
		"off",
		"n",
		"F",
		"0",
		" true ",
		2,
	]) {
		assert.equal(
			row("project", {
				op: "milestone",
				milestone: "ship-v2",
				remove: spelling,
			}).verb,
			"Updated milestone",
			`remove: ${JSON.stringify(spelling)} updates`,
		);
	}
	// The separate delete tool, whose name alone could not say it.
	assert.deepEqual(
		row("project_delete", { name: "ui-update-account-robustness" }),
		{ verb: "Deleted project", object: "ui-update-account-robustness" },
	);
	// The count noun for hub's peek steps (design round 1, D1): `Peeked at 3`
	// cannot say what 3 counts; jobs' peek carries no such count and keeps its
	// scalar.
	assert.deepEqual(row("hub", { op: "peek", to: ["9f2a"], steps: 3 }), {
		verb: "Peeked at",
		object: "3 steps",
	});
	assert.deepEqual(row("hub", { op: "peek", to: ["9f2a"], steps: 1 }), {
		verb: "Peeked at",
		object: "1 step",
	});
	assert.deepEqual(row("jobs", { op: "peek", job_id: "9360", since: "1h" }), {
		verb: "Peeked at",
		object: "9360 1h",
	});
	// The wait timeout spells its unit (design round 1, D5): two bare numbers
	// beside each other read as two ids.
	assert.deepEqual(row("wait", { job_id: "9360", wait_ms: 600_000 }), {
		verb: "Waited for jobs",
		object: "9360 · 10m",
	});
	assert.deepEqual(row("wait", { job_id: "9360", wait_ms: 3_600_000 }), {
		verb: "Waited for jobs",
		object: "9360 · 1h",
	});
	// The tools' lax ints accept the STRING spellings of the same counts and
	// execute them (`"3"` arrives 16 times in 36 h of transcripts - review
	// round 2, QA Q1b), so the renderers coerce numeric strings and keep the
	// unit; a non-numeric string is not a number and stays untouched.
	assert.deepEqual(row("hub", { op: "peek", to: ["9f2a"], steps: "3" }), {
		verb: "Peeked at",
		object: "3 steps",
	});
	assert.deepEqual(row("hub", { op: "peek", to: ["9f2a"], steps: "1" }), {
		verb: "Peeked at",
		object: "1 step",
	});
	assert.deepEqual(row("wait", { job_id: "9360", wait_ms: "600000" }), {
		verb: "Waited for jobs",
		object: "9360 · 10m",
	});
	assert.deepEqual(row("hub", { op: "peek", to: ["9f2a"], steps: "many" }), {
		verb: "Peeked at",
		object: "many",
	});
});

test("toolOp reads the three selector spellings, in their order, and never invents one", () => {
	// `op` is the meta tools' own word, `network` spells it `action` and
	// `console` `method`. Pinned directly because the extraction is what every
	// op-aware label stands on (review round 1, R1-2).
	assert.equal(toolOp({ op: "send" }), "send");
	assert.equal(toolOp({ action: "status" }), "status");
	assert.equal(toolOp({ method: "create" }), "create");
	// Model-written, so trimmed and case-folded.
	assert.equal(toolOp({ action: "  STATUS " }), "status");
	assert.equal(toolOp({ method: "Keys" }), "keys");
	// `op` wins where several appear; a selector that is not a non-empty string
	// is skipped rather than coerced.
	assert.equal(
		toolOp({ op: "send", action: "status", method: "create" }),
		"send",
	);
	assert.equal(toolOp({ action: "status", method: "create" }), "status");
	assert.equal(toolOp({ op: "  ", action: "status" }), "status");
	assert.equal(toolOp({ op: 7, action: "status" }), "status");
	// Nothing selectable is nothing - the generic verb's territory, never a
	// guessed token.
	assert.equal(toolOp(null), "");
	assert.equal(toolOp({}), "");
	assert.equal(toolOp({ command: "pnpm test" }), "");
});

test("the project pair carries its glyphs, and the two fallbacks stay distinct", () => {
	// A project row under the generic wrench is indistinguishable from a tool
	// nobody knows (operator report follow-up, 2026-09-27). The pair mirrors
	// the TUI's own marks (sibling branch `feat/tui-project-line-15c4`, commit
	// `4ce339597`; review round 1, D2/D4 - the first cut took FolderKanban
	// alone, which is a folder-family mark the sibling's rationale retired):
	// `Columns3` for the workstream, `Trash2` for the irreversible removal.
	assert.equal(toolIcon("project").displayName, "Columns3");
	// Case-insensitive, because a tool name is model-controlled.
	assert.equal(toolIcon("Project").displayName, "Columns3");
	assert.equal(toolIcon("project_delete").displayName, "Trash2");
	assert.equal(toolIcon("some_custom_tool").displayName, "Wrench");
	assert.equal(toolIcon("mcp__linear_create_issue").displayName, "Plug");
});

test("the sessions glyph is the second window, not the wrench or a copy", () => {
	/*
	 * PR C's desk half (sibling `damianvtran/local-operator` #1825): a
	 * `sessions` row used to lead with the generic wrench. The TUI picked
	 * nf-fa-window_restore - two windows, "a second window opened beside this
	 * one" - and this table mirrors the SEMANTIC in lucide's vocabulary:
	 * `PictureInPicture2` is the one mark that draws two windows. It must not
	 * take either fallback and must not duplicate its nearest neighbours:
	 * `task`/`agent` (work handed to a child) and `send` (a note to a peer) -
	 * a peer session is a window of its own that this session watches rather
	 * than owns. The category follows the tool family (coordination, the same
	 * `meta` lane `project` and `console` sit in).
	 */
	assert.equal(toolIcon("sessions").displayName, "PictureInPicture2");
	// Case-insensitive, because a tool name is model-controlled.
	assert.equal(toolIcon("Sessions").displayName, "PictureInPicture2");
	assert.notEqual(toolIcon("sessions").displayName, "Wrench");
	assert.notEqual(toolIcon("sessions").displayName, "Users");
	assert.notEqual(toolIcon("sessions").displayName, "Send");
	assert.equal(toolCategory("sessions"), "meta");
});

/* ------------------------------------------------------- the media relay */

let server;
let url;
const seen = [];
const token = "synthetic-main-process-token";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

before(async () => {
	server = createServer((req, res) => {
		seen.push({
			path: req.url,
			method: req.method,
			authorization: req.headers.authorization,
			accept: req.headers.accept,
		});
		res.setHeader("Content-Type", "image/png");
		res.end(PNG);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
});

test("an attachment fetch reaches one path with main's bearer and returns bytes", async () => {
	const digest = "7310e3e79e5eafd8fb21f1dcfed39c17";
	const response = await requestDesktopMedia(
		{ op: "sessions.attachment", sessionId: "0123456789ab", digest },
		null,
		url,
		token,
	);
	assert.equal(response.status, 200);
	assert.equal(response.kind, "bytes");
	assert.equal(response.mimeType, "image/png");
	assert.deepEqual(Buffer.from(response.data), PNG);
	const last = seen.at(-1);
	assert.equal(
		last.path,
		`/v1/desktop/sessions/0123456789ab/attachments/${digest}`,
	);
	// A GET carries no body; `fetch` rejects one outright.
	assert.equal(last.method, "GET");
	assert.equal(last.authorization, `Bearer ${token}`);
	assert.ok(last.accept.includes("image/*"));
	// The bearer never crosses back to the caller.
	assert.ok(!JSON.stringify(response.mimeType).includes(token));
});

test("a renderer cannot steer the attachment fetch anywhere else", async () => {
	const count = seen.length;
	for (const request of [
		// Traversal in either identifier. The digest becomes a filename on the
		// backend, so this is the one that matters most.
		{
			op: "sessions.attachment",
			sessionId: "0123456789ab",
			digest: "../../../etc/passwd",
		},
		{
			op: "sessions.attachment",
			sessionId: "../admin",
			digest: "a".repeat(32),
		},
		// Wrong lengths and wrong alphabet.
		{
			op: "sessions.attachment",
			sessionId: "0123456789ab",
			digest: "a".repeat(31),
		},
		{
			op: "sessions.attachment",
			sessionId: "0123456789ab",
			digest: "A".repeat(32),
		},
		{ op: "sessions.attachment", sessionId: "short", digest: "a".repeat(32) },
		// Extra fields are refused rather than ignored: the schema is `.strict()`
		// precisely so a caller cannot smuggle one past it.
		{
			op: "sessions.attachment",
			sessionId: "0123456789ab",
			digest: "a".repeat(32),
			path: "/v1/anything",
		},
	]) {
		const response = await requestDesktopMedia(request, null, url, token);
		assert.equal(response.status, 422, JSON.stringify(request));
		assert.equal(response.kind, "error");
	}
	// Nothing reached HTTP at all.
	assert.equal(seen.length, count);
});

test("an unpaired backend refuses the attachment fetch rather than calling it unauthenticated", async () => {
	const count = seen.length;
	const response = await requestDesktopMedia(
		{
			op: "sessions.attachment",
			sessionId: "0123456789ab",
			digest: "a".repeat(32),
		},
		null,
		url,
		null,
	);
	assert.equal(response.status, 503);
	assert.equal(seen.length, count);
});

test("a CHILD's attachment fetch reaches the child-scoped path and nothing else", async () => {
	// The reader's rows reference digests in the shared store, and the parent's
	// route refuses them: it takes the session whose transcript holds the
	// reference, which a child session is not. So the two ids in the PATH are the
	// whole contract, and a wiring regression that dropped back to the parent's op
	// would 404 in the app while every renderer test stayed green.
	const digest = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
	const response = await requestDesktopMedia(
		{
			op: "subagents.attachment",
			sessionId: "0123456789ab",
			childId: "fedcba987654",
			digest,
		},
		null,
		url,
		token,
	);
	assert.equal(response.status, 200);
	assert.equal(response.kind, "bytes");
	assert.deepEqual(Buffer.from(response.data), PNG);
	const last = seen.at(-1);
	assert.equal(
		last.path,
		`/v1/desktop/sessions/0123456789ab/children/fedcba987654/attachments/${digest}`,
	);
	assert.equal(last.method, "GET");
	assert.equal(last.authorization, `Bearer ${token}`);
});

test("a renderer cannot steer the child attachment fetch either", async () => {
	const count = seen.length;
	for (const request of [
		// Traversal in the child id, which is the identifier this op adds.
		{
			op: "subagents.attachment",
			sessionId: "0123456789ab",
			childId: "../../admin",
			digest: "a".repeat(32),
		},
		{
			op: "subagents.attachment",
			sessionId: "0123456789ab",
			childId: "a".repeat(31),
			digest: "a".repeat(32),
		},
		{
			op: "subagents.attachment",
			sessionId: "0123456789ab",
			childId: "FEDCBA987654",
			digest: "a".repeat(32),
		},
		// The parent op cannot be reached by omitting the child id.
		{
			op: "subagents.attachment",
			sessionId: "0123456789ab",
			digest: "a".repeat(32),
		},
		// `.strict()`, as above: no smuggled path, and no parent field.
		{
			op: "subagents.attachment",
			sessionId: "0123456789ab",
			childId: "fedcba987654",
			digest: "a".repeat(32),
			path: "/v1/anything",
		},
	]) {
		const response = await requestDesktopMedia(request, null, url, token);
		assert.equal(response.status, 422, JSON.stringify(request));
		assert.equal(response.kind, "error");
	}
	assert.equal(seen.length, count);
});

/* --------------------------------------------------------- renderer CSP */

test("the app window's CSP admits the blob images the attachment path produces", async () => {
	// A durable transcript image lives in the attachment store: the row carries
	// a digest, main fetches the bytes with the bearer, and the renderer has a
	// Uint8Array rather than a URL it can name — so the only way to show it is a
	// blob. Under the previous policy that <img> was BLOCKED in the real app
	// window (measured over CDP) while an identical data: URI loaded, and the
	// failure is silent: the view draws its "unavailable" placeholder and
	// nothing says why.
	//
	// Asserted against the shipped HTML rather than against a browser, because
	// this is a regression guard: the policy is one line that a future edit can
	// tighten back without anyone noticing until a screenshot goes missing.
	const { readFileSync } = await import("node:fs");
	const html = readFileSync("src/renderer/index.html", "utf8");
	const policy = html.match(/content="([^"]*default-src[^"]*)"/)?.[1] ?? "";
	assert.ok(policy, "index.html declares a CSP");
	const imgSrc = policy.match(/img-src ([^;]*)/)?.[1] ?? "";
	assert.ok(
		imgSrc.includes("blob:"),
		`img-src must allow blob: (got "${imgSrc}")`,
	);
	// `media-src` already had it; keeping both in one assertion documents that
	// they are the same requirement for two element types.
	const mediaSrc = policy.match(/media-src ([^;]*)/)?.[1] ?? "";
	assert.ok(
		mediaSrc.includes("blob:"),
		`media-src must allow blob: (got "${mediaSrc}")`,
	);
});

/* ------------------------------------------------- transcript row spacing */

/*
 * `buildRows` decides the vertical rhythm, and it is the half of the spacing
 * model that a screenshot cannot pin: the frames prove the pitch is uniform
 * TODAY, and these assert the two rules that keep it uniform.
 *
 * It is bundled separately from the block above because it pulls the React
 * component module; only the pure exports are exercised.
 */
const rowsBundle = await build({
	stdin: {
		contents:
			'export { buildRows, GAP, isTraceLike, ledgerName, paintsSomething, splitFirstLine } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	loader: { ".css": "empty" },
	external: ["react", "react-dom", "react/jsx-runtime"],
	// The renderer's own aliases, from `electron.vite.config.js`. Only the two
	// this module's import graph reaches are needed.
	alias: {
		"@shared": resolve("src/renderer/src/shared"),
		"@renderer": resolve("src/renderer/src"),
	},
	write: false,
});
const {
	buildRows,
	GAP,
	isTraceLike,
	ledgerName,
	paintsSomething,
	splitFirstLine,
} = await import(
	`data:text/javascript;base64,${Buffer.from(rowsBundle.outputFiles[0].text).toString("base64")}`
);

const toolRecord = (id) => ({
	kind: "tool",
	id,
	ts: 1,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: { command: "ls" },
	phase: "done",
	argumentBytes: 0,
	output: "ok",
	isError: false,
	durationS: 0.1,
	images: [],
	added: 0,
	removed: 0,
	stopped: false,
});

/** The tool-call-only assistant record the reducer keeps for id coalescing. */
const emptyAssistant = (id) => ({
	kind: "assistant",
	id,
	ts: 1,
	text: "",
	streaming: false,
	stopReason: "toolUse",
	error: false,
});

test("an empty tool-call-only assistant record never becomes a row", () => {
	// It has no prose to paint, but the reducer must keep it so a live echo
	// coalesces onto its id. A row for it would carry a top margin around a box
	// of zero height — a gap with no visible cause.
	const rows = buildRows(
		[toolRecord("t1"), emptyAssistant("a1"), toolRecord("t2")],
		[],
	);
	assert.deepEqual(
		rows.map((row) => row.record.id),
		["t1", "t2"],
		"the invisible record is not painted",
	);
});

test("a receipt row is a ledger row, not prose", () => {
	// A peer message and a wake delivery sit INSIDE a run of tool calls — a note
	// that arrived mid-run belongs to the run — so they take the ledger's 2px
	// tier rather than prose's air (the operator's "extra space randomly inserted
	// which doesn't look very uniform" is what a second tier in a run looks like).
	const peer = { kind: "peer", id: "p1", ts: 2, body: "hi", sender: {} };
	const wake = {
		kind: "wake",
		id: "w1",
		ts: 3,
		text: "(alarm) Scheduled wake w-1",
	};
	assert.equal(isTraceLike(peer), true);
	assert.equal(isTraceLike(wake), true);
	assert.equal(paintsSomething(peer), true);
	// A peer row with NO body still paints: the identity alone is what the
	// expansion is for, so an empty note is a row and not an invisible record.
	assert.equal(paintsSomething({ ...peer, body: "" }), true);

	const run = buildRows([toolRecord("t1"), peer, wake, toolRecord("t2")], []);
	assert.deepEqual(
		run.map((row) => row.gap),
		["first", "trace", "trace", "trace"],
		"a receipt in a run of calls takes the run's own tier",
	);

	// And the shared name column counts them, or a receipt scrolling into view
	// would shift every other row's summary rail.
	assert.equal(ledgerName(peer), "peer");
	assert.equal(ledgerName(wake), "wake");
	assert.equal(ledgerName(emptyAssistant("a1")), "");
});

test("an invisible record does not break trace adjacency", () => {
	// The regression that produced the operator's ragged column: the gap tier is
	// decided from the PREVIOUS row, so an invisible record standing between two
	// tool rows made the second one look like the start of a new run and it fell
	// back to the wider `item` tier.
	const withGhost = buildRows(
		[toolRecord("t1"), emptyAssistant("a1"), toolRecord("t2")],
		[],
	);
	const without = buildRows([toolRecord("t1"), toolRecord("t2")], []);
	assert.deepEqual(
		withGhost.map((row) => row.gap),
		without.map((row) => row.gap),
		"the ghost changes nothing about the spacing",
	);
	assert.equal(withGhost[1].gap, "trace");
	// And a run of like rows is ONE tier throughout, which is what "uniform"
	// means here: every adjacent pair is the same distance apart.
	const run = buildRows(["t1", "t2", "t3", "t4", "t5"].map(toolRecord), []);
	assert.deepEqual(
		run.map((row) => row.gap),
		["first", "trace", "trace", "trace", "trace"],
	);
	// `trace` is the 2px hairline, and the SAME 2px in the small view: every
	// other tier shrinks there, but 2px is already the floor at which a gap is
	// still a gap. `mt-0.5` on the 4px ramp, the step `TraceGroup` composes with.
	assert.deepEqual(GAP.trace, ["mt-0.5", "mt-0.5"]);
	// The gap applies only BETWEEN rows of a run: the row that OPENS one takes
	// `first` or `turn`, never `trace`, so nothing is pushed off the top.
	assert.equal(run[0].gap, "first");
	assert.equal(GAP.first[0], "", "the opening row carries no margin");
});

/*
 * The ladder, as numbers rather than as class names.
 *
 * The tiers only carry information if they are DISTINGUISHABLE and ordered:
 * `transcript-rows.ts` says the distance between tiers is what tells "still the
 * same run" from "a new turn started". Two tiers that happen to compile to the
 * same margin would still pass a deepEqual on their own spellings, which is why
 * this resolves them through the ramp and compares the pixels.
 */
test("the gap tiers are strictly ordered, trace tightest", () => {
	/*
	 * The ramp is READ from the stylesheet rather than transcribed as `* 4`.
	 * A literal would let this file keep asserting 2px after someone changed
	 * `--spacing`, which is the one number the whole comparison rests on - and
	 * the assertion would still pass while every distance on screen had moved.
	 */
	const css = readFileSync(
		resolve("src/renderer/src/styles/index.css"),
		"utf8",
	);
	const ramp = css.match(/^\s*--spacing:\s*([\d.]+)rem;/m);
	assert.ok(ramp, "styles/index.css must declare the --spacing ramp");
	// No `html` font-size override in this app; only `body` sets a type step,
	// and `rem` resolves against the root regardless.
	const step = Number(ramp[1]) * 16;
	assert.equal(step, 4, "the 4px ramp this ladder is spelled on");
	const px = (cls) => {
		if (cls === "") return 0;
		const n = Number(cls.replace("mt-", ""));
		// `mt-px` and any other non-numeric step would otherwise yield NaN, which
		// compares false against everything and quietly passes the ordering below.
		assert.ok(
			Number.isFinite(n),
			`${cls} is not a step on the ramp; this ladder is spelled in ramp units`,
		);
		return n * step;
	};
	for (const view of [0, 1]) {
		const trace = px(GAP.trace[view]);
		const item = px(GAP.item[view]);
		const turn = px(GAP.turn[view]);
		assert.equal(trace, 2, "a run's rows sit a hairline apart");
		assert.ok(
			trace < item && item <= turn,
			`tiers must widen: trace ${trace} < item ${item} <= turn ${turn}`,
		);
		/*
		 * There is no third tier between these two any more. The `mark` tier existed
		 * to raise a row whose caption says its own text is not whole (design round 1,
		 * D1), and §D1 sets every gap INSIDE a turn to 12px — so `item` is 12px and the
		 * raise became a second name for the same class string. Its own assertion was
		 * `mark >= item * 1.5`, which is unreachable at 12 against 12: a tier nobody can
		 * see and no test can reach is what silently becomes a drift later.
		 */
		assert.equal(item, 12, "§D1: inside a turn, 12px");
		/*
		 * D1 (design review round 1) is a RATIO requirement, not a preference: the
		 * caption lives INSIDE the row it describes, 4px from its own chunk, so the gap
		 * above that row has to be at least 3× the caption's margin for the line to
		 * attach to the row rather than to the paragraph above it. 12px is the ramp's
		 * smallest between-components step, and it is asserted here rather than trusted
		 * to the comment because the failure mode — an `item`-sized gap on a marked row
		 * — is invisible in a diff and reads as a note on somebody else's answer.
		 */
		assert.ok(
			item >= 12,
			`the marked row's gap must clear the caption's own margin (item ${item})`,
		);
		// The hierarchy the tightening had to preserve: a turn boundary is an
		// order of magnitude airier than an adjacent pair inside a run, so the
		// density buys nothing at the boundary's expense.
		assert.ok(turn >= trace * 8, "a turn boundary still reads as a boundary");
	}
});

test("a row whose caption says its text is not whole takes the mark gap", () => {
	/*
	 * WHICH rows take it, and which the raise leaves alone: only the `item`/`trace`
	 * tiers are ambiguous against a 4px caption margin. `turn` is already wider than
	 * the floor and `first` has no row above it, so the tier is raised and never
	 * lowered — a marked row that opens a turn keeps the turn's own air.
	 */
	const prose = (id, extra) => ({
		kind: "assistant",
		id,
		ts: 1,
		text: "the chunk",
		streaming: true,
		stopReason: null,
		error: false,
		...extra,
	});
	const marked = buildRows(
		[
			{ kind: "user", id: "u1", ts: 1, text: "go", images: [] },
			prose("a1"),
			prose("a2", { truncated: "prefix" }),
		],
		[],
	);
	assert.deepEqual(
		marked.map((row) => row.gap),
		["first", "turn", "item"],
		"the marked row separates from the answer above it by the in-turn step",
	);
	// The D1 case that was worst before the tier existed: a marked row directly
	// under a tool row used to inherit the 2px hairline.
	const afterTool = buildRows(
		[toolRecord("t1"), prose("a1", { truncated: "interrupted" })],
		[],
	);
	assert.equal(
		afterTool[1].gap,
		"item",
		"a marked row under a ledger row does not take the hairline",
	);
	// And an UNMARKED row is untouched, including the small view's narrower item.
	const plain = buildRows(
		[{ kind: "user", id: "u1", ts: 1, text: "go", images: [] }, prose("a1")],
		[],
	);
	assert.deepEqual(
		plain.map((row) => row.gap),
		["first", "turn"],
	);
});

test("an invisible record does not consume the avatar or a turn boundary", () => {
	// The avatar marks the first row of an agent turn. If a ghost counted as
	// that first row, the avatar would vanish from the turn entirely.
	const rows = buildRows(
		[
			{ kind: "user", id: "u1", ts: 1, text: "go", images: [] },
			emptyAssistant("a1"),
			toolRecord("t1"),
		],
		[],
	);
	assert.deepEqual(
		rows.map((row) => row.record.id),
		["u1", "t1"],
	);
	/*
	 * D11 DELETES THE AVATAR AND ITS GUTTER, so there is no longer a flag to consume:
	 * the assertion is that the row model carries none at all (a re-added flag would
	 * be the avatar coming back through the model rather than through the markup) and
	 * that the container which used to draw it renders neither a glyph nor the 40px
	 * indent that justified it.
	 */
	assert.ok(
		!("showAvatar" in rows[1]),
		"the row model carries no avatar flag (D11)",
	);
	const container = readFileSync(
		"src/renderer/src/features/chat/components/message-item/message-container.tsx",
		"utf8",
	);
	// Asked of the CODE, not the words: this file's own comment explains what the
	// `pl-10` indent used to cost, and a token check that read comments would fail
	// on the explanation of the deletion rather than on a re-introduction.
	assert.ok(
		!/from "\.\/message-avatar"/.test(container),
		"message-container.tsx imports no avatar (D11)",
	);
	assert.ok(
		!/"pl-10"|AGENT_GUTTER/.test(container),
		"message-container.tsx carries no 40px gutter (D11)",
	);
	assert.equal(rows[1].gap, "turn", "a turn boundary still gets its air");
	// The hierarchy the tightening must preserve: a turn boundary is strictly
	// airier than an adjacent pair inside a run.
	assert.notDeepEqual(GAP.turn, GAP.trace);
});

test("a streaming record with no text yet paints nothing", () => {
	// The gap between `message_start` and the first token. This used to paint a
	// row reading "Writing" directly above the working line, which was already
	// saying `thinking` — two elements for one fact, and the redundant one in
	// the answer's register rather than on the ledger. Liveness has ONE channel
	// here, the same way the TUI has one `WorkingBlock` and no per-message
	// equivalent.
	const streamingEmpty = {
		kind: "assistant",
		id: "s1",
		ts: 1,
		text: "",
		streaming: true,
		stopReason: null,
		error: false,
	};
	assert.equal(paintsSomething(streamingEmpty), false);
	// And it must not reach the row list, for the same reason a settled empty
	// record must not: a wrapper with a margin around a box of zero height.
	const rows = buildRows([toolRecord("t1"), streamingEmpty], []);
	assert.deepEqual(
		rows.map((row) => row.record.id),
		["t1"],
	);
	// The first token is what makes it visible, and nothing else changes.
	assert.equal(paintsSomething({ ...streamingEmpty, text: "Here" }), true);
});

test("a streaming record cannot swallow the avatar or a gap tier", () => {
	// The avatar marks the first row of an agent turn, and the gap tier is
	// decided from the previous row that PAINTED. An empty streaming record
	// leading a turn must therefore be as invisible to both as a settled empty
	// one — this is the invisible-row defect's own regression surface, re-run
	// for the record that just stopped painting.
	const streamingEmpty = {
		kind: "assistant",
		id: "s1",
		ts: 1,
		text: "",
		streaming: true,
		stopReason: null,
		error: false,
	};
	const rows = buildRows(
		[
			{ kind: "user", id: "u1", ts: 1, text: "go", images: [] },
			streamingEmpty,
			toolRecord("t1"),
		],
		[],
	);
	assert.deepEqual(
		rows.map((row) => row.record.id),
		["u1", "t1"],
	);
	assert.ok(
		!("showAvatar" in rows[1]),
		"the row model carries no avatar flag (D11)",
	);
	assert.equal(rows[1].gap, "turn", "a turn boundary still gets its air");
	// And it cannot break trace adjacency between two ledger rows either.
	const run = buildRows(
		[toolRecord("t1"), streamingEmpty, toolRecord("t2")],
		[],
	);
	assert.equal(run[1].gap, "trace");
});

test("the transcript no longer renders a Writing row", () => {
	// A source assertion, because the component's own guard and the predicate
	// have to agree and only one of them is reachable from here. Both halves are
	// checked: the copy is gone, and `AssistantRow` still returns null on
	// `paintsSomething` rather than on a second copy of the condition — two
	// copies of it is how the row comes back.
	const transcript = readFileSync(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		"utf8",
	);
	assert.ok(!/>\s*Writing\s*</.test(transcript), "no Writing row is rendered");
	assert.match(
		transcript,
		/if \(!paintsSomething\(record\)\) return null;/,
		"AssistantRow guards on the shared predicate",
	);
});

/*
 * The table-cell ceiling (design note D1, the markdown-table width fix of
 * 2026-09-30): `th, td { max-width: 64ch }` is a ceiling on ONE CELL's
 * min-content demand - the token with no word boundary at all - not a reading
 * measure on prose, and the property test below admits exactly this one, by
 * VALUE and by RULE. Hoisted because `scripts/` is held to
 * `lint/performance/useTopLevelRegex`; kept beside the test because the
 * exception and its guards read together.
 */
const WIDTH_CAP_DECLARATION = /max-width\s*:\s*([^;}]+)/g;
const CH_UNIT = /[\d.]+ch\b/g;
const CELL_CAP_RULES = /\.lo-markdown th,\s*\.lo-markdown td\s*\{[^}]*\}/g;
const CELL_CAP_VALUE = /max-width\s*:\s*64ch/;
const CELL_CAP_WORD_BREAK = /word-break\s*:\s*normal/;
const CELL_CAP_OVERFLOW_WRAP = /overflow-wrap\s*:\s*break-word/;

test("no reading measure survives on either surface, by property not by name", () => {
	// The operator's report of 2026-09-16: a user card widened by a reply quote
	// or a wide attachment left the message floating as a centre-constrained
	// column inside it, with equal slack on each side. The 62ch cap and the
	// centring that produced it are gone, and so is the class that opted a box
	// into them.
	//
	// This test used to assert the opposite for the user bubble — "agent prose
	// takes no reading cap, and the user bubble keeps one" — on the reading that
	// the bubble's narrower box is what makes a turn an aside, and that widening
	// it was the unrequested half of the earlier change. The report above
	// reversed that call: the aside is the CARD's own `max-w-[85%]` (§D2) inside
	// `CHAT_MEASURE`, and the prose fills the card. The agent half is unchanged —
	// no cap there either, so it shares the tool rows' edges.
	//
	// IT ASKS ABOUT THE PROPERTY, NOT THE SPELLINGS (code review round 1, MAJOR
	// 4). The first version looked for `.lo-measured .lo-markdown {` and for a
	// bare `MEASURE` token sharing a line with `cn(`, so it passed for a
	// DESCENDANT cap (`.lo-measured .lo-markdown > :is(p, ul) { max-width: 62ch
	// }`), for a selector-list cap, for the class re-applied through a `cn(` call
	// split over several lines, for a renamed class, and for a Tailwind
	// `max-w-[62ch]` on the body div. Each of the four questions below fails for
	// every one of those, because each asks what a reading measure IS rather than
	// what it was called: a stylesheet cap (`max-width` other than `100%`, and no
	// `ch` unit left at all), centring by margin (`auto` never appears in a margin
	// declaration), a cap or an inline style in either component (`max-w-*` only
	// the card's own two steps, no `maxWidth`) and re-centring by text alignment.
	//
	// SCOPE WIDENED IN ROUND 2, AND TWO FALSE POSITIVES REMOVED (code review
	// round 2, MINOR 1). Round 1's version asked the right questions of too few
	// files. A cap re-applied where `.lo-markdown` is RENDERED - the renderer's own
	// `cn("lo-markdown", className)` - passed all five assertions, and injected
	// live it put the reported defect straight back: card 675, prose 351.1..897.9,
	// 47.1px of slack on each side. A non-`auto` `width: 546px` on the root passed
	// too, and that is a column which does not fill the card, i.e. the report's
	// literal words. And a Tailwind `w-[62ch] mx-auto` on the body div passed,
	// which returns the text-only card to its pre-fix 580.7px. So the render site
	// is read as well, `width` is asserted beside `max-width`, and the body wrapper
	// is asserted on its own.
	//
	// The two false positives are gone with that scope: a file-wide token check
	// made a legitimate `max-w-full` fail - images use it, in both surfaces - as
	// though the contract had broken, and a file-wide `mx-auto` ban fails on the
	// comment at `canonical-transcript.tsx:1490` that merely quotes the utility.
	// The token question is therefore asked of ARBITRARY-VALUE caps (`max-w-[…]`,
	// `w-[…]`) and the centring question of the body wrapper, which is the only
	// place a centring could hide.
	//
	// WHAT IT STILL DOES NOT CATCH, stated so this is not read as a guarantee: a
	// cap in a stylesheet OTHER than `markdown.css` (these component files and the
	// renderer are read, the rest of the tree is not), a width applied at runtime
	// by something other than a class string or this stylesheet, and a cap written
	// in a unit and a property no declaration here uses. And the deliberate cost
	// stands but for ONE ARGUED ACT: the markdown-table fix of 2026-09-30 (design
	// note D1) puts `max-width: 64ch` on `th, td` - a ceiling on one table cell's
	// min-content demand, not a reading measure on prose - and the assertions
	// below admit exactly that cap, by value and by rule (see
	// `WIDTH_CAP_DECLARATION` above); a SECOND cap anywhere in this file is still
	// a failing test, which is the property this test exists to keep.
	const source = (path) => readFileSync(path, "utf8");
	// Comments stripped first: this file's own measure argument QUOTES `max-width:
	// 62ch` and `margin-inline: auto` while explaining why they are gone, and a
	// test that read the prose as a rule would fail on its own explanation.
	const css = source(
		"src/renderer/src/features/chat/components/markdown.css",
	).replace(/\/\*[\s\S]*?\*\//g, "");
	const capValues = [...css.matchAll(WIDTH_CAP_DECLARATION)]
		.map(([, value]) => value.trim())
		.filter((value) => value !== "100%");
	assert.deepEqual(
		capValues,
		["64ch"],
		"the only width cap beyond `100%` is the argued table-cell ceiling (design note D1); any other cap is the reading measure coming back",
	);
	// And it really is the CELL rule that carries it, together with the pair of
	// declarations the fix depends on - so the exception cannot drift to another
	// selector, another number, or a cell rule that lost its word-break mode.
	const cellCapRules = (css.match(CELL_CAP_RULES) ?? []).filter((rule) =>
		CELL_CAP_VALUE.test(rule),
	);
	assert.equal(
		cellCapRules.length,
		1,
		"the 64ch ceiling lives on the th/td override rule",
	);
	assert.match(cellCapRules[0], CELL_CAP_WORD_BREAK);
	assert.match(cellCapRules[0], CELL_CAP_OVERFLOW_WRAP);
	// `width` as well as `max-width` (code review round 2, MINOR 1): a fixed
	// `width: 546px` on the root needs no `max-width`, no `ch` unit and no `auto`
	// margin, and it leaves a column inside the card that never reaches the card's
	// right edge - the left-aligned half of the same report. `100%` is the allowed
	// value and is in use: `.lo-markdown pre` and `.lo-markdown table` wrap to
	// their container rather than to a measure.
	assert.deepEqual(
		[...css.matchAll(/(?<!max-)\bwidth\s*:\s*([^;}]+)/g)]
			.map(([, value]) => value.trim())
			.filter((value) => value !== "100%"),
		[],
		"markdown.css declares no `width` other than `100%`",
	);
	// A reading measure is a `ch` cap - 62ch was the number - so one re-added
	// under another name still has to spell a `ch` unit in this file. The ONE
	// `ch` allowed is the table-cell ceiling admitted above, and demanding the
	// array be exactly `["64ch"]` is also what stops a second `ch` cap hiding
	// beside it.
	assert.deepEqual(
		css.match(CH_UNIT) ?? [],
		["64ch"],
		"the only `ch` unit in markdown.css is the argued table-cell ceiling (design note D1)",
	);
	assert.ok(
		!/(?:^|[;{\s])margin[a-z-]*\s*:[^;}]*\bauto\b/.test(css),
		"no margin in markdown.css centres a block",
	);
	assert.ok(
		!/text-align\s*:\s*(?:center|justify)/.test(css),
		"markdown.css centres nothing by text alignment either",
	);
	// The two user-turn surfaces, because the two have to keep agreeing, plus the
	// file that renders `.lo-markdown` itself.
	const SURFACES = [
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		"src/renderer/src/features/chat/components/message-item/message-paper.tsx",
	];
	// An arbitrary-value cap or a centring utility - never a `max-w-*` allowlist
	// over the whole file. `max-w-full` is legitimate here (images use it, in both
	// surfaces), so the round-1 version failed for adding one anywhere in either
	// file, which is a false positive on a change that has nothing to do with this
	// contract.
	const CAP_OR_CENTRING =
		/max-w-|w-\[|mx-auto|maxWidth|minWidth|\bwidth\s*[=:]/;
	for (const path of SURFACES) {
		const file = source(path);
		assert.deepEqual(
			[...new Set(file.match(/\b(?:max-)?w-\[[^\]]+\]/g) ?? [])].sort(),
			["max-w-[85%]", "max-w-[92%]"],
			`${path}: the only arbitrary-value widths are the card's two steps`,
		);
		// The BODY wrapper - the div inside the card that holds the quote chip and
		// the rendered markdown, found as the last opening tag before the chip. A
		// Tailwind width here (`w-[62ch]`), or a centring (`mx-auto`), is the third
		// shape the reviewer injected, and it returns the text-only card to its
		// pre-fix 580.7px.
		const chip = file.indexOf("{replies.length > 0");
		assert.ok(
			chip > 0,
			`${path}: the chip that marks the body wrapper is still there`,
		);
		const wrapper = [
			...file.slice(0, chip).matchAll(/<div\b[^>]*?>/g),
		].pop()?.[0];
		assert.ok(
			wrapper,
			`${path}: the user-turn body wrapper is still reachable`,
		);
		assert.ok(
			!CAP_OR_CENTRING.test(wrapper),
			`${path}: the body wrapper caps and centres nothing of its own - ${wrapper}`,
		);
	}
	// And the render site. `MarkdownRenderer` emits `cn("lo-markdown", className)`
	// with a style built from a font size and a line height, so there is nothing in
	// that file to cap with - and a width added here would land on every markdown
	// surface at once, which is what made it the sharpest of the three shapes.
	//
	// SCOPED LIKE THE TWO SURFACES ABOVE (code review round 3, NIT C): round 2
	// widened the scope to this file but kept the BROAD `max-w-` token here, so a
	// legitimate `max-w-full` in it failed a contract that change had not touched -
	// the same false positive the round-2 fix removed from the other two files. An
	// ARBITRARY-VALUE cap (`w-[…]`, which `max-w-[62ch]` matches), a centring
	// utility and a style width still fail, so nothing that put the defect back
	// live is let through.
	const renderer = source(
		"src/renderer/src/features/chat/components/markdown-renderer.tsx",
	);
	assert.deepEqual(
		[...new Set(renderer.match(/\b(?:max-)?w-\[[^\]]+\]/g) ?? [])],
		[],
		"markdown-renderer.tsx adds no arbitrary-value width where `.lo-markdown` is rendered",
	);
	assert.ok(
		!/(?:mx-auto|maxWidth|minWidth|\bwidth\s*[=:])/.test(renderer),
		"markdown-renderer.tsx caps and centres nothing where `.lo-markdown` is rendered",
	);
});

test("an unchanged row keeps its object identity across a rebuild", () => {
	// `TranscriptRow` is memoised on the row object, on a surface that repaints
	// per token. A rebuild that minted fresh rows for unchanged records would
	// re-render the whole transcript on every delta.
	const records = [toolRecord("t1"), emptyAssistant("a1"), toolRecord("t2")];
	const first = buildRows(records, []);
	const second = buildRows(records, first);
	assert.equal(second[0], first[0]);
	assert.equal(second[1], first[1]);
});

test("the ledger row height is one number, not two that can drift", () => {
	// `ToolRow` and a dense `TraceLine` sit in the SAME column of the canonical
	// transcript, so a run that mixed them would read as ragged if their heights
	// diverged. They cannot import from each other without pointing the
	// dependency the wrong way (a generic trace primitive depending on one
	// specific row type), so the constants are asserted equal here instead.
	const source = (path) => readFileSync(path, "utf8");
	const heightOf = (path, name) =>
		source(path).match(new RegExp(`const ${name} = "([^"]+)"`))?.[1];
	const toolRow = heightOf(
		"src/renderer/src/features/chat/components/trace/tool-row.tsx",
		"ROW_HEIGHT",
	);
	const traceLine = heightOf(
		"src/renderer/src/features/chat/components/trace/trace-line.tsx",
		"DENSE_ROW",
	);
	assert.ok(toolRow, "ToolRow declares a ROW_HEIGHT");
	assert.equal(traceLine, toolRow, "the dense trace row matches the tool row");
	// And it is genuinely an override of the shared idiom rather than a change
	// to it: the app-wide disclosure default must still be the comfortable one.
	assert.match(
		source("src/renderer/src/shared/components/ui/disclosure.tsx"),
		/const ROW = "flex min-h-6 w-full items-center gap-1\.5 py-0\.5 text-left"/,
		"the shared disclosure keeps its comfortable default",
	);
});

test("the name/summary stutter guard covers MCP rows too (R6)", () => {
	// The guard's whole job: a summary that repeats the name beside it is
	// dropped. For a builtin the wire name and the displayed name are the same
	// string, so comparing against either worked.
	assert.equal(
		isBareToolName(summaryFromArgs("eval", {}), "eval"),
		true,
		"an argument-less builtin falls back to its own name",
	);

	// For an MCP tool they are NOT the same string, and that is the case the
	// original guard missed. `summaryFromArgs` falls back to the wire name while
	// the column shows `displayName`'s stripped form, so a display-name-only
	// comparison let the row render `list_issues  mcp__linear_list_issues` —
	// printing the exact prefix `displayName` exists to remove.
	const wire = "mcp__linear_list_issues";
	const summary = summaryFromArgs(wire, {});
	assert.equal(summary, wire, "the fallback really is the wire name");
	assert.notEqual(
		displayName(wire),
		wire,
		"and the column shows something else",
	);
	assert.equal(
		isBareToolName(summary, wire),
		true,
		"an argument-less MCP row is caught — it was not before",
	);

	// And it must not swallow a real summary that merely resembles a name.
	assert.equal(
		isBareToolName(summaryFromArgs("read", { path: "notes.md" }), "read"),
		false,
		"a row with a genuine object keeps it",
	);
	assert.equal(
		isBareToolName("list_issues", "mcp__linear_create_issue"),
		false,
		"a summary matching ANOTHER tool's name is still a summary",
	);
});

/* ---------------------------------------------------------------------- *
 * The write/edit diff body.
 *
 * The rules asserted here are ported from `_append_diff_body`
 * (tool_card.py:2178-2225) and the producer it reads
 * (`_diff_details`, tools/builtin.py:4863-4888). Asserting them is not
 * ceremony: the header strip and the cap are the two places where a plausible
 * implementation is WRONG in a way a frame cannot show — a pattern-based header
 * filter deletes a real removed line, and a cap applied before the strip
 * announces two lines more than it hid. Each assertion below names the
 * implementation it rejects.
 * ---------------------------------------------------------------------- */

/** A diff exactly as `difflib.unified_diff(..., n=2, lineterm="")` emits it. */
const EDIT_DIFF = [
	"--- ",
	"+++ ",
	"@@ -18,7 +18,8 @@ export function diffCounts(details: unknown) {",
	" \tconst source = (details ?? {}) as Record<string, unknown>;",
	"-\tconst count = (value: unknown) =>",
	'-\t\ttypeof value === "number" && value > 0 ? value : 0;',
	"+\tconst count = (value: unknown) =>",
	'+\t\ttypeof value === "number" && Number.isInteger(value) && value > 0;',
	" \treturn { added: count(source.added), removed: count(source.removed) };",
	" }",
];

test("the file-header pair is stripped POSITIONALLY, never by pattern", () => {
	// The nameless pair: difflib emits `--- ` / `+++ ` (empty filename, and with
	// `lineterm=""` no line terminator) so each line is exactly the separator
	// plus a trailing space.
	const stripped = stripDiffHeader(EDIT_DIFF);
	assert.equal(stripped.length, EDIT_DIFF.length - 2);
	assert.equal(stripped[0].startsWith("@@"), true);
	// Trailing-whitespace-insensitive, as the terminal's `rstrip()` comparison
	// is: a producer that emitted the pair without the trailing space still gets
	// it stripped rather than printed as two blank-label lines.
	assert.deepEqual(stripDiffHeader(["---", "+++", "+a"]), ["+a"]);
	// The argument is not mutated: the record's own array is shared with the
	// identity gate, and a function that shifted it would corrupt every row.
	assert.equal(EDIT_DIFF.length, 10);

	// The case the positional rule exists for. A REMOVED line whose content
	// begins `--` (a SQL or Lua comment, in a diff of a .sql file) renders as
	// `--- …`. A pattern filter over the body — `line.startsWith("---")` —
	// deletes it, and the diff then reports a removal the reader cannot see.
	const withComment = [
		"--- ",
		"+++ ",
		"@@ -1,3 +1,3 @@",
		"--- keep the migration idempotent",
		"+\t-- keep the migration idempotent, now with a guard",
		" \tDROP TABLE IF EXISTS t;",
	];
	const body = diffBody(withComment);
	// Four body lines after the strip: the hunk header, the removed comment, its
	// replacement, and the context line.
	assert.equal(body.lines.length, 4, "the comment line survives the strip");
	assert.equal(body.lines[1].kind, "removed");
	assert.equal(body.lines[1].text, "--- keep the migration idempotent");

	// And the pair is only stripped when BOTH lines are the pair: a `---` at
	// line 0 followed by anything else is content.
	assert.deepEqual(stripDiffHeader(["--- ", "@@ -1 +1 @@"]), [
		"--- ",
		"@@ -1 +1 @@",
	]);
	// A single-line diff has no pair to strip.
	assert.deepEqual(stripDiffHeader(["--- "]), ["--- "]);
});

test("ink is chosen by the LEADING character alone", () => {
	assert.equal(diffLineKind("@@ -1,3 +1,4 @@"), "hunk");
	// `@` is the marker, not `@@`: a hunk header with a function context after
	// the closing `@@` is still a hunk, and a context line that merely contains
	// `@@` is still context.
	assert.equal(diffLineKind("@"), "hunk");
	assert.equal(diffLineKind("+added"), "added");
	assert.equal(diffLineKind("-removed"), "removed");
	assert.equal(diffLineKind(" context"), "context");
	assert.equal(diffLineKind(""), "context");
	// The producer's own truncation marker is ORDINARY content: it is the last
	// element of a 200-line-cap payload, not this component's overflow marker.
	assert.equal(diffLineKind("…"), "context");

	// The marker column survives: leading whitespace is what carries a unified
	// diff's structure, so the rstrip is trailing-only. A `trim()` would move
	// every context line to column 0 and the body would stop reading as a diff.
	const body = diffBody([" context", "+added", "-removed"]);
	assert.equal(body.lines[0].text, " context");
	assert.equal(body.lines[0].marker, " ");
	assert.equal(body.lines[0].kind, "context");
	assert.equal(body.lines[1].text, "+added");
	assert.equal(body.lines[1].marker, "+");
	// Trailing whitespace does go, exactly as the terminal rstrips.
	assert.equal(diffBody([" \tcontext   "]).lines[0].text, " \tcontext");
	// And a blank context line — difflib's `" "` prefix over an empty line —
	// rstrips to nothing at all, in the terminal as here: the marker is empty
	// and there is no tint to paint on it.
	const blank = diffBody([" "]).lines[0];
	assert.equal(blank.text, "");
	assert.equal(blank.marker, "");
	assert.equal(blank.kind, "context");
});

test("the body shows at most 40 lines and says how many it hid", () => {
	const long = [
		"--- ",
		"+++ ",
		"@@ -1,3 +1,43 @@",
		...Array.from({ length: 43 }, (_, i) => `+\trow ${i + 1}`),
	];
	const body = diffBody(long);
	// 43 additions + 1 hunk header = 44 body lines after the strip; 40 shown.
	assert.equal(body.lines.length, 40);
	assert.equal(body.hidden, 4, "the cap counts AFTER the header strip");
	// The pre-fix shape this rejects: capping before the strip reports 6 hidden
	// while showing the same 40 lines, and the marker overstates the body.
	assert.equal(body.hidden, long.length - 2 - 40);
	// Exactly at the cap, nothing is announced. An off-by-one here prints
	// "… 0 more diff lines" under a complete diff.
	assert.equal(diffBody(long.slice(0, 42)).hidden, 0);
	assert.equal(diffBody(long.slice(0, 43)).hidden, 1);

	// Singular and plural, spelled as the terminal spells them.
	assert.equal(diffOverflowLabel(1), "… 1 more diff line");
	assert.equal(diffOverflowLabel(2), "… 2 more diff lines");
	assert.equal(diffOverflowLabel(161), "… 161 more diff lines");

	// The producer's trailing `…` is a LINE, so it is counted and hidden like
	// any other. An implementation that special-cased it would under-count the
	// hidden lines by one on every capped payload.
	const capped = ["--- ", "+++ ", "@@ -1 +1 @@", "…"];
	const small = diffBody(capped);
	assert.equal(small.hidden, 0);
	assert.equal(small.lines[1].text, "…");
});

test("a diff payload is normalised, and a malformed one degrades to no diff", () => {
	// A durable row's list, through pydantic, stays a list.
	assert.deepEqual(diffFromDetails({ diff: ["+a", "-b"] }), ["+a", "-b"]);
	assert.equal(diffFromDetails({ diff: [] }), null);
	// A pre-joined string is TOLERATED, and it is defensive tolerance rather than
	// a shape anything sends: every real payload measured is a list of strings
	// (9,501 of them across the 1,166 stored transcripts this machine held on
	// 2026-09-12, a dated snapshot of a live store rather than a fixed
	// property), and the mobile fold copies
	// each key through untouched (mobile/projection.py:284-288), so a list stays
	// a list. The comment here used to claim the fold pre-joined them, which
	// measured false.
	assert.deepEqual(diffFromDetails({ diff: "+a\n-b" }), ["+a", "-b"]);
	assert.equal(diffFromDetails({ diff: "" }), null);
	// Members that are not strings are DROPPED rather than stringified:
	// `String({})` is "[object Object]", a line no producer ever wrote.
	assert.deepEqual(diffFromDetails({ diff: [1, "+a", null] }), ["+a"]);
	assert.equal(diffFromDetails({ diff: [1, 2] }), null);
	// Absent, wrong-typed and non-object payloads are all "no diff reported",
	// which is what makes the row fall back to its arguments.
	assert.equal(diffFromDetails({ path: "a.md" }), null);
	assert.equal(diffFromDetails({ diff: 42 }), null);
	assert.equal(diffFromDetails(undefined), null);
	assert.equal(diffFromDetails(null), null);
	assert.equal(diffFromDetails("+a\n-b"), null);

	// `preferDiff` is the identity gate's half: an equal extraction returns the
	// PREVIOUS array by reference, because `shallowEqual` compares by `!==` and a
	// rebuilt array would re-render the row on every polled delta.
	const previous = ["+a", "-b"];
	const rebuilt = ["+a", "-b"];
	assert.equal(preferDiff(rebuilt, previous), previous);
	// A genuinely different diff wins, and it is the NEW array rather than the
	// previous one.
	const replacement = ["+c"];
	assert.equal(preferDiff(replacement, previous), replacement);
	// An absent extraction never clears a body a row already showed.
	assert.equal(preferDiff(null, previous), previous);
	assert.equal(preferDiff(null, null), null);
});

test("only the two tools this backend has take a diff body", () => {
	assert.equal(isDiffBodyTool("write"), true);
	assert.equal(isDiffBodyTool("edit"), true);
	// Case and padding, because the wire name is the model's to spell.
	assert.equal(isDiffBodyTool(" Write "), true);
	assert.equal(isDiffBodyTool("EDIT"), true);
	// Deliberately NOT the mobile port's set: it also names `apply_patch` and
	// `patch` (mobile/web/src/components/tool-row.tsx:75), which this backend
	// does not expose — `_TOOL_CATEGORY` lists `write` and `edit` alone. Naming
	// them here would claim a diff body for a tool that can only arrive as an
	// MCP server's own name, whose `details` are not this payload.
	assert.equal(isDiffBodyTool("apply_patch"), false);
	assert.equal(isDiffBodyTool("patch"), false);
	assert.equal(isDiffBodyTool("bash"), false);
	assert.equal(isDiffBodyTool("read"), false);
	assert.equal(isDiffBodyTool(""), false);
});

test("a FAILED write keeps its arguments even when a diff came with it", () => {
	// The terminal gates the diff-alone body on the call's own state as well as
	// on the payload (`self._state == "success" and self._diff`,
	// tool_card.py:1928). On a failure the arguments are the only account of what
	// was attempted and the error only makes sense beside them, so a row that
	// somehow carried BOTH must paint the args and the error rather than a diff
	// alone. No producer does that today — every error exit goes through `_error`
	// (tools/builtin.py:1041) or `_invalid_arguments` (`:1051`, which DOES set
	// `details`, but only its `FAULT_KEY` fault marker, `:1066`; it is
	// `details.diff` that no error path sets, which is the claim this guard
	// rests on), and all 9,501 real `details.diff` rows measured are successful
	// `write`/`edit` results — which is why this is pinned by an assertion on the
	// rule instead of by a frame: the frame would have to depict a payload the
	// wire does not produce. Remove `!row.isError` from `isDiffBodyRow` and the
	// first assertion below fails.
	assert.equal(
		isDiffBodyRow({ toolName: "write", diff: ["+a"], isError: true }),
		false,
	);
	assert.equal(
		isDiffBodyRow({ toolName: "write", diff: ["+a"], isError: false }),
		true,
	);
	// The other two conditions hold on their own: it is a diff body only for the
	// two tools that emit this payload, and only when there is one.
	assert.equal(
		isDiffBodyRow({ toolName: "bash", diff: ["+a"], isError: false }),
		false,
	);
	assert.equal(
		isDiffBodyRow({ toolName: "write", diff: null, isError: false }),
		false,
	);
});

test("the stand-in line skips the harness wiring a result opens with", () => {
	// A `bash` result opens with its own OUTCOME, then section markers. The TUI
	// never had to care, because it has an outcome column and never reads the
	// result for an object; this port has no such column, which is how a
	// transcript came to read forty rows of `exit code: 0` under a heading that
	// promised the command. Nothing informative is dropped with it: the row's own
	// glyph already carries the outcome, and a non-zero exit is what turns that
	// glyph into a cross.
	assert.equal(
		outputFallbackLine(
			"exit code: 0\n--- stdout ---\n=== downloads ===\nLO.app",
		),
		"… === downloads ===",
		"the status line and the section marker both step aside",
	);
	assert.equal(
		outputFallbackLine("exit code: -9\n--- stderr ---\n/LO.app: killed"),
		"… /LO.app: killed",
	);
	// Observed in a real transcript: a killed call writes the marker without a
	// number at all, and an indented one.
	assert.equal(
		outputFallbackLine("      exit code\n--- stdout ---\nreal"),
		"… real",
	);

	// The marker is what keeps a line of the RESULT from reading as the call's
	// own object in that column — the design round's D1. Every line that reaches
	// the column through this path carries it.
	assert.ok(
		outputFallbackLine("exit code: 0\n--- stdout ---\n=== x ===").startsWith(
			"… ",
		),
	);

	// The producer's shape for a call that printed nothing, verbatim
	// (`tools/builtin.py:1694-1695`, joined at `:2379`). Skipping the markers but
	// not the `(empty)` bodies left the worst case reading `(empty)` — wiring
	// quoted as prose, which is the class this rule exists to stop.
	assert.equal(
		outputFallbackLine(
			"exit code: 0\n--- stdout ---\n(empty)\n--- stderr ---\n(empty)",
		),
		null,
		"a silent call has no stand-in to offer",
	);
	assert.equal(
		outputFallbackLine(
			"exit code: 1\n--- stdout ---\n(empty)\n--- stderr ---\n(bash: x: command not found)",
		),
		"… (bash: x: command not found)",
		"the marker steps aside only where the section had nothing",
	);

	// A timeout DOES open with the fact the row exists to carry, so it stays.
	assert.equal(
		outputFallbackLine("TIMEOUT after 120.0s (process killed)\nexit code: -9"),
		"… TIMEOUT after 120.0s (process killed)",
	);
	// Anything that is not those markers is text, whatever it looks like.
	assert.equal(
		outputFallbackLine("exit code: 0 and then some"),
		"… exit code: 0 and then some",
	);
	assert.equal(
		outputFallbackLine("200 match(es) for 'wake'"),
		"… 200 match(es) for 'wake'",
	);

	// Nothing to offer is `null`, not an empty string: the row must be able to
	// tell "there was no stand-in" from "the stand-in is blank".
	assert.equal(outputFallbackLine(null), null);
	assert.equal(outputFallbackLine(""), null);
	assert.equal(outputFallbackLine("exit code: 0\n--- stdout ---\n\n"), null);
	assert.equal(
		outputFallbackLine("exit code: 0\n--- stdout ---\n   \n--- stderr ---"),
		null,
	);

	// Bounded, because the object column is one line: a 4 KB result must not
	// push a long string through the truncation machinery on every render.
	const long = `exit code: 0\n--- stdout ---\n${"x".repeat(400)}`;
	assert.equal(outputFallbackLine(long).length, 160 + "… ".length);
});

test("the dictation counter is spelled at a glance", () => {
	// `_format_bytes` (tool_card.py:360-371). The number exists to MOVE, so an
	// unreadable spelling defeats it: the app's own `KiB` had no step above a
	// kilobyte and printed a multi-megabyte dictation as `2048.0 KiB`.
	assert.equal(formatBytes(0), "0 B");
	assert.equal(formatBytes(812), "812 B");
	assert.equal(formatBytes(1024), "1.0 KB");
	assert.equal(formatBytes(12_688), "12.4 KB");
	assert.equal(formatBytes(1024 * 1024), "1.0 MB");
	assert.equal(formatBytes(2_097_152), "2.0 MB");
});

/* --------------------------------------- expanded detail and receipt rows */

/*
 * The defect this section exists for, in the operator's words: an expanded tool
 * row rendered "JSON.stringify(record.args)" inside one bordered box with the
 * result in a second, and an inbound peer message rendered its own card whose
 * body was the model-facing envelope, `<peer-session-message from_pid=92064 …>`,
 * verbatim.
 *
 * TWO THINGS ABOUT THE FIX CANNOT BE SEEN IN A FRAME, which is why they are
 * asserted here rather than photographed. A reader looking at a working pane
 * cannot tell that JSON punctuation which should not be there is not there, and
 * a reader looking at a peer row cannot tell that an envelope which is no longer
 * printed would have been. Both are absences, and an absence has to be written
 * down (`assert.ok(!text.includes("{"))`) or it is only a habit.
 *
 * Bundled separately from the blocks above because these two modules import
 * nothing but `@shared/lib/utils` (the `cn` helper) into the component they feed;
 * the models themselves are pure.
 */
const detailBundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/components/trace/tool-detail-model";',
			'export * from "./src/renderer/src/features/chat/components/trace/receipt-row-model";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	EMPTY_SENDER,
	SUBPIXEL_TOLERANCE,
	argumentLines,
	detailOverflowLabel,
	detailText,
	hasDetail,
	linesBelowFold,
	peerFields,
	peerHasDetail,
	peerIdentity,
	peerIdentityLine,
	peerSnippet,
	peerSummary,
	resultLines,
	sameSender,
	senderField,
	wakeIsCatchup,
	wakePromptBody,
	wakeReceiptHeadline,
} = await import(
	`data:text/javascript;base64,${Buffer.from(detailBundle.outputFiles[0].text).toString("base64")}`
);

/** Every mark the pane is forbidden to print. */
const JSON_MARKS = ["{", "}", "[", "]", '"'];

const sender = (over = {}) => ({ ...EMPTY_SENDER, ...over });

test("an expanded call prints labelled values, never a JSON dump", () => {
	// The shape the report was about: a `write` whose `content` is a whole file,
	// and an MCP-ish `params` that nests an object and an array.
	const args = {
		path: "invoices/march.csv",
		content: "line one\nline two",
		params: { filter: { status: "open" }, tags: ["a", "b"] },
		limit: 3,
		dry: true,
		missing: null,
		blank: "",
		gone: {},
	};
	const text = detailText(argumentLines(args));

	for (const mark of JSON_MARKS) {
		assert.ok(
			!text.includes(mark),
			`the pane must not print JSON punctuation: found "${mark}" in\n${text}`,
		);
	}

	// A string keeps its own newlines — the reason `_argument_text` exists is
	// that a heredoc's shape IS the thing being reported, and flattening it is
	// what made the collapsed row unable to carry it.
	assert.ok(text.includes("content: line one\nline two"), text);
	// A scalar prints as itself, unquoted.
	assert.ok(text.includes("limit: 3"), text);
	assert.ok(text.includes("dry: true"), text);
	// `_argument_text`'s `str()`: a None argument prints as the word, not as a
	// blank that reads like a rendering failure.
	assert.ok(text.includes("missing: null"), text);
	// The TUI's own rule (`if not text: continue`): a value that prints nothing
	// is dropped entirely rather than leaving a bare `key:` line.
	assert.ok(!text.includes("blank"), text);
	assert.ok(!text.includes("gone"), text);

	// Nesting is one `key.subkey` line per LEAF, so an array element and an
	// object's field are spelled the same way and neither needs braces.
	assert.ok(text.includes("params.filter.status: open"), text);
	assert.ok(text.includes("params.tags.0: a"), text);
	assert.ok(text.includes("params.tags.1: b"), text);
	// The indent is the leaf's depth, one step per level: the top level is flush
	// and `params.filter.status` is two levels down. It is what tells a nested
	// field apart from a second top-level argument.
	assert.ok(text.includes("\n    params.filter.status: open"), text);

	// ARGUMENT ORDER survives: it is the TUI's order and the collapsed row's
	// summary rule ("the first two identity scalars in argument order") depends
	// on it.
	assert.ok(text.indexOf("path:") < text.indexOf("content:"), text);
});

test("a JSON result is structured by the same rules, and anything else is text", () => {
	// A result that is not a container — a shell block, a plain-text tool —
	// passes through untouched, which is every result in the app except the ones
	// this branch is for.
	assert.equal(resultLines("exit code: 0\n--- stdout ---\nhi"), null);
	assert.equal(resultLines(""), null);
	assert.equal(resultLines(null), null);
	// A container whose leaves are ALL empty (`{}`, `{"a": {}}`, `{"items": []}`)
	// has no leaf to print, and the raw text is NOT the honest fallback: it puts
	// `{"a": {}}` under the Output label, which is the JSON punctuation this pane
	// exists to keep out, and an empty container is reachable — it is what a "no
	// rows found" API returns (reviewer F4). It prints the app's own word for a
	// section that holds nothing instead, the one the producer writes
	// (`tools/builtin.py`) and the object column already filters as wiring.
	assert.equal(detailText(resultLines("{}")), "(empty)");
	assert.equal(detailText(resultLines("[]")), "(empty)");
	assert.equal(detailText(resultLines('{"a": {}}')), "(empty)");
	assert.equal(detailText(resultLines('{"items": []}')), "(empty)");
	assert.equal(detailText(resultLines('{"a": {}, "b": []}')), "(empty)");
	// A bare scalar is a value the tool chose to encode, not a record. Printing
	// it as `x: 3` under an invented key would be the pane making something up.
	assert.equal(resultLines("3"), null);
	assert.equal(resultLines('"a string"'), null);
	assert.equal(resultLines("true"), null);
	// Look-alikes that do not parse are text, not JSON.
	assert.equal(resultLines("{not json}"), null);
	assert.equal(resultLines("[1, 2"), null);
	// A container with ONE printable leaf drops the empty siblings rather than
	// reporting the whole result as empty.
	assert.equal(detailText(resultLines('{"a": {}, "b": 1}')), "b: 1");

	// The real shapes: an object, and an array at the root. A nested leaf is
	// indented by its depth — `items.0.id` sits two levels under the root — and a
	// flat one is flush, which is the TUI's one-block-per-key reading.
	assert.equal(detailText(resultLines('{"ok": true}')), "ok: true");
	assert.equal(
		detailText(resultLines('{"items": [{"id": 1}, {"id": 2}]}')),
		"    items.0.id: 1\n    items.1.id: 2",
	);
	assert.equal(detailText(resultLines("[1, 2]")), "0: 1\n1: 2");

	// No punctuation here either: this is the same renderer as the input half —
	// and the invariant covers the EMPTY container's rendering too, which is the
	// case the earlier claim was false for.
	for (const raw of [
		'{"path": "a/b.md", "tags": ["x"]}',
		"{}",
		'{"a": {}}',
		'{"items": []}',
	]) {
		const structured = detailText(resultLines(raw) ?? []);
		for (const mark of JSON_MARKS) {
			assert.ok(!structured.includes(mark), `${raw} -> ${structured}`);
		}
	}
});

test("the pane is only offered when there is something to disclose", () => {
	// The gate has to AGREE with the pane, not approximate it: every path below
	// has arguments and prints NOTHING, which is how a durable `read` row whose
	// arguments were `{"path": ""}` came to offer a click onto an empty bordered
	// box (reviewer F2, QA Q-2).
	assert.equal(hasDetail(null, null), false);
	assert.equal(hasDetail({}, null), false);
	// `argumentLines` treats a missing `args` as nothing, and this sibling threw
	// on the same value (`Object.keys(undefined)`).
	assert.equal(hasDetail(undefined, null), false);
	assert.equal(hasDetail({ params: {} }, null), false);
	assert.equal(hasDetail({ a: [] }, null), false);
	assert.equal(hasDetail({ a: { b: {} } }, null), false);
	assert.equal(hasDetail({ "": "" }, null), false);
	assert.equal(hasDetail({ items: [], gone: {}, blank: "" }, null), false);
	assert.equal(hasDetail(null, "ok"), true);
	assert.equal(hasDetail({}, "ok"), true);
	assert.equal(hasDetail({ path: "a" }, null), true);
	assert.equal(hasDetail({ a: null }, null), true);
	assert.equal(hasDetail({ path: "" }, "ok"), true);
	// A printable leaf BEHIND an empty container is still found, which is the
	// difference between walking the value and counting its keys.
	assert.equal(hasDetail({ a: {}, b: [1] }, null), true);
	assert.equal(hasDetail({ a: [{ b: "" }, { c: "x" }] }, null), true);
	// An empty output is no output: `""` is what a call that printed nothing
	// carries, and a pane with an "Output" label over nothing is the lie the
	// TUI's empty-card rules exist to prevent.
	assert.equal(hasDetail(null, ""), false);
	// The walk is bounded, and exhaustion answers the way that cannot LOSE
	// content: a row that hides a real payload loses it silently, while an offered
	// click onto nothing is visible and is closed by the pane's own empty guard.
	// This is an all-empty payload WIDE enough to exhaust the budget — the point
	// is that it answers `true` rather than `false`.
	const wide = Object.fromEntries(
		Array.from({ length: 2000 }, (_, index) => [`k${index}`, {}]),
	);
	assert.equal(hasDetail(wide, null), true);
	// A deep payload is cut by `MAX_DEPTH` instead, and a cut subtree PRINTS its
	// marker — so it is content on both sides of this gate.
	let deep = {};
	for (let i = 0; i < 40; i++) deep = { nested: deep };
	assert.equal(hasDetail(deep, null), true);
});

test("a capped section says how much of itself is not shown", () => {
	// The terminal's own line (`tool_card.py`: `f"… {hidden} more line{'s' if
	// hidden != 1 else ''}"`), singular included — the diff body's
	// `diffOverflowLabel` is spelled the same way for the same reason.
	assert.equal(detailOverflowLabel(1), "… 1 more line");
	assert.equal(detailOverflowLabel(3), "… 3 more lines");
	assert.equal(detailOverflowLabel(0), "… 0 more lines");
});

test("a sub-pixel overhang is not a line below the fold", () => {
	/*
	 * The branch of `tool-detail.tsx` this suite can reach. The count lives in
	 * the model precisely so this boundary is a number here rather than a
	 * picture in `docs/evidence`: no script under `pnpm test:desktop` imports
	 * the component, jsdom measures no layout, and three mutations of that file
	 * left the suite green (reviewer round 3, N6).
	 *
	 * The two overhangs are the ones reviewer F8 and designer D7 measured
	 * independently at 560, on a section parked at its OWN scroll limit — the
	 * state this pane's fix is about. Chrome saturates a non-composited scroller
	 * on an integer offset, so 0.203px of the first pane's last line and 0.469px
	 * of the second's stay outside the box forever, and the reader is looking
	 * straight at those lines.
	 */
	const line = 17.4;
	const firstPane = { top: 361.204 - line, height: line };
	const secondPane = { top: 729.641 - line, height: line };
	assert.equal(linesBelowFold([firstPane], line, 361.0, SUBPIXEL_TOLERANCE), 0);
	assert.equal(
		linesBelowFold([secondPane], line, 729.172, SUBPIXEL_TOLERANCE),
		0,
	);
	// Without the tolerance those two ARE the defect: one line each, claimed
	// through every wheel notch, about a line that is on screen.
	assert.equal(linesBelowFold([firstPane], line, 361.0, 0), 1);
	assert.equal(linesBelowFold([secondPane], line, 729.172, 0), 1);
});

test("the count is line boxes below the fold, and the tolerance is one of them", () => {
	const line = 20;
	const boxBottom = 100;
	const flush = { top: boxBottom - line, height: line };
	// Flush and exactly-one-tolerance both count as inside; the tolerance is a
	// boundary, not a licence to hide the next line.
	assert.equal(linesBelowFold([flush], line, boxBottom, SUBPIXEL_TOLERANCE), 0);
	assert.equal(
		linesBelowFold(
			[{ top: flush.top + SUBPIXEL_TOLERANCE, height: line }],
			line,
			boxBottom,
			SUBPIXEL_TOLERANCE,
		),
		0,
	);
	assert.equal(
		linesBelowFold(
			[{ top: flush.top + SUBPIXEL_TOLERANCE + 0.01, height: line }],
			line,
			boxBottom,
			SUBPIXEL_TOLERANCE,
		),
		1,
	);
	// A row two line boxes tall is two lines, not one row: the reader counts
	// lines, and the pitch between rows is a different number (QA round 2, Q-6).
	assert.equal(
		linesBelowFold(
			[{ top: boxBottom, height: 2 * line }],
			line,
			boxBottom,
			SUBPIXEL_TOLERANCE,
		),
		2,
	);
	// An element with no box occupies no line, and a section whose line-height
	// cannot be resolved reports nothing rather than an infinity of lines.
	assert.equal(
		linesBelowFold(
			[{ top: boxBottom, height: 0 }],
			line,
			boxBottom,
			SUBPIXEL_TOLERANCE,
		),
		0,
	);
	assert.equal(
		linesBelowFold([flush], Number.NaN, boxBottom, SUBPIXEL_TOLERANCE),
		0,
	);
	assert.equal(linesBelowFold([], line, boxBottom, SUBPIXEL_TOLERANCE), 0);
});

test("a receipt row never degrades to an unnamed pid", () => {
	// The ladder: the name the peer chose (quoted, because it IS a name), then
	// the directory it runs in (with a trailing slash, because it is not), then
	// an id prefix, then the pid, then the vocabulary `harness/comms.py` uses.
	assert.equal(
		peerIdentity(sender({ conversationName: "review-agent" })),
		'"review-agent"',
	);
	assert.equal(
		peerIdentity(sender({ cwd: "/Users/damian/minervaai/" })),
		"minervaai/",
	);
	assert.equal(
		peerIdentity(sender({ cwd: "C:\\work\\admin-api" })),
		"admin-api/",
	);
	assert.equal(
		peerIdentity(sender({ sessionId: "01J8ZQ4K7XABCDEF" })),
		"01J8ZQ4K",
	);
	assert.equal(peerIdentity(sender({ pid: "92064" })), "pid 92064");
	assert.equal(peerIdentity(sender()), "another session");

	// The ladder is ordered, not a set: each rung only answers when the one
	// above it is absent.
	assert.equal(
		peerIdentity(sender({ conversationName: "review-agent", cwd: "/work/x" })),
		'"review-agent"',
	);
	assert.equal(
		peerIdentity(sender({ cwd: "/work/x", sessionId: "01J8ZQ4K7X" })),
		"x/",
	);
	// A cwd of only separators has no basename, so it falls through rather than
	// printing a lone slash.
	assert.equal(
		peerIdentity(sender({ cwd: "/", sessionId: "01J8ZQ4K7X" })),
		"01J8ZQ4K",
	);

	// The expansion's line: name · pid · model, the TUI's order and its shed
	// order (the model is context, not an address).
	assert.equal(
		peerIdentityLine(
			sender({
				conversationName: "lo-usage-panel",
				pid: "92064",
				modelLabel: "deepseek/deepseek-flash",
			}),
		),
		'"lo-usage-panel" · pid 92064 · deepseek/deepseek-flash',
	);
	assert.equal(peerIdentityLine(sender({ pid: "1" })), "pid 1");
	// The TUI's own quirk, ported rather than corrected: with no name and no pid,
	// a model label IS the whole line. It reads oddly, but the case needs a
	// sender with neither a name nor a pid nor a session id AND a model, and every
	// producer puts a pid on the wire — so inventing "another session · sonnet"
	// here would be a second rule no reference surface has.
	assert.equal(peerIdentityLine(sender({ modelLabel: "sonnet" })), "sonnet");
	assert.equal(peerIdentityLine(sender()), "another session");
});

test("a sender field is one line, bounded, and free of both rendering hazards", () => {
	// A newline in a name split the TUI's pinned one-row card into three rows;
	// whitespace runs collapse so a name stays one paragraph and the row one row.
	assert.equal(senderField("a\nb\tc    d"), "a b c d");
	assert.equal(senderField(92064), "92064");
	assert.equal(senderField(null), "");
	assert.equal(senderField(undefined), "");

	// HAZARD ONE: Unicode `Cf`. A format character is not markup, so React's
	// escaping does not touch it, and the browser's text layout honours it — an
	// unterminated `U+202E` visibly reorders the glyphs around it, including the
	// pid printed beside the name. Both reviewers reproduced the surviving
	// override in the running app (reviewer F1, QA Q-1).
	assert.equal(senderField("rev\u202Eiew-agent"), "review-agent");
	assert.equal(senderField("\u202E"), "");
	assert.equal(senderField("a\u200Bb\uFEFFc"), "abc");
	assert.equal(
		peerFields({
			body: "",
			sender: { pid: 92064, conversation_name: "rev\u202Eiew-agent" },
		}).sender.conversationName,
		"review-agent",
	);
	// The identity LINE a row leads with is therefore clean too, because every
	// `PeerSender` the app holds was built by `peerFields` — the only constructor,
	// and the reducer's only source of one.
	assert.equal(
		peerIdentityLine(
			peerFields({
				body: "",
				sender: { pid: 92064, conversation_name: "rev\u202Eiew-agent" },
			}).sender,
		),
		'"review-agent" · pid 92064',
	);

	// HAZARD TWO: control sequences. They re-ink whatever host they are painted
	// into, and they are removed WITH their payload rather than as a lone `ESC`,
	// so an injected colour leaves nothing behind to puzzle over.
	assert.equal(senderField("a\u001b[31mred\u001b[0m"), "ared");
	// The 8-bit (C1) form is the one that does not look like an escape once
	// decoded, and it survives a 7-bit-only pattern.
	assert.equal(senderField("a\u009b31mred"), "ared");
	// …and its STRING form is the same branch of the alternation, so it is pinned
	// here rather than left to the CSI line above: the introducers (`\u009d` OSC,
	// `\u0090` DCS, `\u0098` SOS, `\u009e` PM, `\u009f` APC) go WITH their payload
	// up to `\u009c`, because a pattern that took the introducer alone would leave
	// `0;pwned` standing in an identity label — wrong text, not absent text.
	// Deleting `[\u009d\u0090\u0098\u009e\u009f]` from `CONTROL_SEQUENCES` used to
	// leave this suite 45/45 green (reviewer F7).
	assert.equal(senderField("a\u009d0;pwned\u009cb"), "ab");
	assert.equal(senderField("a\u0090dcs\u009cb"), "ab");
	assert.equal(senderField("a\u009fapc\u009cb"), "ab");
	assert.equal(senderField("a\u001b]0;title\u0007b"), "ab");
	// A control character hiding a newline in its payload cannot split the row:
	// the strip runs BEFORE the whitespace collapse, so the newline goes with the
	// sequence that contained it rather than being left standing.
	assert.equal(senderField("a\u001b]0;x\ny\u0007b"), "ab");

	// HAZARD THREE: size. `_SENDER_FIELD_MAX_CHARS`, and the bound counts the
	// characters a reader can actually see because it is applied last.
	assert.equal(senderField("x".repeat(500)).length, 120);
	assert.equal(senderField(`${"x".repeat(300)}\u202E`).length, 120);
});

test("a peer row offers its disclosure only when it carries a new fact", () => {
	// A body is a fact the collapsed row can only preview one line of, so it is
	// always worth opening.
	assert.equal(peerHasDetail(sender({ pid: "92064" }), "hi"), true);
	// With no body, the expansion has to add the pid or the model the one-line
	// summary has no room for — the TUI's own justification for an
	// always-expandable peer block.
	assert.equal(
		peerHasDetail(sender({ pid: "92064", modelLabel: "sonnet" }), ""),
		true,
	);
	assert.equal(
		peerHasDetail(
			sender({ conversationName: "review-agent", pid: "92064" }),
			"",
		),
		true,
	);
	// A name on its own is not one: the summary already leads with it, so the
	// expansion would print the same words.
	assert.equal(
		peerHasDetail(sender({ conversationName: "review-agent" }), ""),
		false,
	);
	// The case this closes: the summary is `pid 92064` and the expansion was
	// `pid 92064` again, one click for nothing.
	assert.equal(peerHasDetail(sender({ pid: "92064" }), ""), false);
	// …and the all-absent sender, whose summary and expansion were both
	// `another session` (design D5, UX U2). The sibling wake row already rules
	// the same no-content case static, and the two receipts have to agree.
	assert.equal(peerHasDetail(sender(), ""), false);
	assert.equal(peerHasDetail(sender(), "   \n"), false);
});

test("the collapsed peer row leads with the sender, then the message", () => {
	// The FIRST non-empty line, whitespace-collapsed: a body that opens with a
	// blank line still previews its first real line rather than nothing.
	assert.equal(peerSnippet("\n\n  hello   there\nsecond"), "hello there");
	assert.equal(peerSnippet("one line"), "one line");
	assert.equal(peerSnippet("   \n\t\n"), "");

	assert.equal(
		peerSummary(sender({ conversationName: "review-agent" }), "merged, thanks"),
		'"review-agent" · merged, thanks',
	);
	// An empty body leaves the identity alone rather than a dangling separator.
	assert.equal(
		peerSummary(sender({ conversationName: "review-agent" }), ""),
		'"review-agent"',
	);
	assert.equal(peerSummary(sender({ pid: "42" }), ""), "pid 42");
});

test("the sender object is reused when a replayed row teaches nothing new", () => {
	// The transcript's equality gate compares record fields by reference, so a
	// freshly built sender on every re-read would repaint every peer row of the
	// page.
	const base = sender({ conversationName: "review-agent", pid: "92064" });
	assert.equal(sameSender(base, { ...base }), true);
	assert.equal(sameSender(base, { ...base, pid: "92065" }), false);
	assert.equal(sameSender(base, { ...base, modelLabel: "sonnet" }), false);
});

test("a peer delivery is projected from its human fields, with the envelope as a fallback", () => {
	const text =
		"<peer-session-message from_pid=92064 conversation='review-agent' model='deepseek/deepseek-flash'>\n" +
		"the tool row needs the same treatment\n" +
		"</peer-session-message>";
	const envelope = {
		from_pid: "92064",
		conversation: "review-agent",
		model: "deepseek/deepseek-flash",
	};

	// 1. The normal case: `details.body` and `details.sender` are what the UIs
	// render (the phone's fold does exactly this), and the envelope is ignored
	// even though it is present and parsable.
	const normal = peerFields({
		text,
		body: "the tool row needs the same treatment",
		sender: {
			pid: 92064,
			conversation_name: "review-agent",
			cwd: "/Users/damian/local-operator-ui",
			session_id: "01J8ZQ4K7XABCDEF",
			model_label: "deepseek/deepseek-flash",
		},
	});
	assert.equal(normal.body, "the tool row needs the same treatment");
	assert.equal(normal.sender.conversationName, "review-agent");
	assert.equal(normal.sender.pid, "92064");
	assert.equal(normal.sender.cwd, "/Users/damian/local-operator-ui");
	assert.equal(normal.sender.sessionId, "01J8ZQ4K7XABCDEF");
	assert.equal(normal.sender.modelLabel, "deepseek/deepseek-flash");

	// 2. A row that carries ONLY the envelope — an older producer, or a delivery
	// path that never learned about `body` — still names its sender and still has
	// something to say, instead of degrading to "another session".
	const recovered = peerFields({ text });
	assert.equal(recovered.body, "the tool row needs the same treatment");
	assert.equal(recovered.sender.pid, envelope.from_pid);
	assert.equal(recovered.sender.conversationName, envelope.conversation);
	assert.equal(recovered.sender.modelLabel, envelope.model);
	// The three the envelope does not carry stay empty rather than invented.
	assert.equal(recovered.sender.cwd, "");
	assert.equal(recovered.sender.sessionId, "");

	// 2b. …and the same row when the open tag CANNOT be parsed: an unterminated
	// quoted attribute, or a conversation name carrying both quote kinds, which is
	// what Python's `repr` produces for `Damian's "tool trace" work`. The
	// quote-aware scan does not match at all here, so there is no `inner` to
	// recover — and the body used to come back empty, which is a row that keeps
	// NEITHER the sender nor the message: `body=""` against round 1's
	// `body="please re-run the export"` on the same input (QA round 2, Q-5). What
	// a reader gets now is the text behind the tag, which is cut at its first `>`
	// — the only tag end available without a parse — while the attributes that
	// could not be read stay absent rather than being guessed at piecemeal.
	const unterminated = peerFields({
		text: "<peer-session-message from_pid=1 conversation='a model='m'>\nplease re-run the export\n</peer-session-message>",
	});
	assert.equal(unterminated.body, "please re-run the export");
	// The envelope must not be what the row says, whichever way it failed to parse.
	assert.equal(unterminated.body.includes("peer-session-message"), false);
	const bothQuotes = peerFields({
		text: `<peer-session-message from_pid=1 conversation='Damian\\'s "tool trace" work' model='m'>\nplease re-run the export\n</peer-session-message>`,
	});
	assert.equal(bothQuotes.body, "please re-run the export");
	assert.equal(bothQuotes.body.includes("peer-session-message"), false);

	// 3. The two sources are combined FIELD BY FIELD, not wholesale: a `sender`
	// missing only `model_label` takes that one field from the envelope rather
	// than losing the other four.
	const partial = peerFields({
		text,
		sender: { pid: 7, cwd: "/work/x" },
	});
	assert.equal(partial.sender.pid, "7");
	assert.equal(partial.sender.cwd, "/work/x");
	assert.equal(partial.sender.conversationName, "review-agent");
	assert.equal(partial.sender.modelLabel, "deepseek/deepseek-flash");

	// 4. `repr` quoting: a name containing an apostrophe comes back in DOUBLE
	// quotes, and both spellings have to parse.
	assert.equal(
		peerFields({
			text: `<peer-session-message from_pid=1 conversation="damian's shell" model='x'>\nhi\n</peer-session-message>`,
		}).sender.conversationName,
		"damian's shell",
	);

	// 5. The envelope must not survive, wherever it came from: not from the
	// envelope's own inner text, and NOT from a `details.body` that quotes one.
	// The operator's rule is that no XML reaches an expanded body, so this is a
	// strip over whichever body was CHOSEN rather than a check — the case that
	// used to paint the tag was a body quoting one whole (reviewer F3, QA Q-4),
	// and a test used to assert that survival.
	const quoted = peerFields({
		body: "see <peer-session-message from_pid=1>this</peer-session-message> too",
	});
	assert.equal(quoted.body.includes("peer-session-message"), false);
	assert.equal(quoted.body, "see this too");
	const recoveredQuoted = peerFields({
		text: "<peer-session-message from_pid=1 conversation='a' model='m'>\nquote: <peer-session-message from_pid=2>x</peer-session-message>\n</peer-session-message>",
	});
	assert.ok(
		!recoveredQuoted.body.includes("peer-session-message"),
		`the envelope must not reach the view: ${recoveredQuoted.body}`,
	);

	// A quoted attribute containing `>` is what Python's `repr` produces for a
	// name with one in it, and a `[^>]*` scan broke the whole unwrap there:
	// the name parsed as `'a` and the rest of the envelope landed in the BODY
	// (reviewer N3).
	const angled = peerFields({
		text: "<peer-session-message from_pid=1 conversation='a>b' model='m'>\nhi\n</peer-session-message>",
	});
	assert.equal(angled.sender.conversationName, "a>b");
	assert.equal(angled.sender.pid, "1");
	assert.equal(angled.sender.modelLabel, "m");
	assert.equal(angled.body, "hi");
	// …and the same spelling reaches the strip on the body path.
	assert.equal(
		peerFields({
			body: "before <peer-session-message from_pid=1 conversation='a>b'>x</peer-session-message> after",
		}).body,
		"before x after",
	);

	// 6. A row with nothing at all still projects to a printable shape: an empty
	// body and an all-absent sender, which the row paints as the fallback name
	// alone.
	const bare = peerFields({});
	assert.equal(bare.body, "");
	assert.equal(bare.sender.pid, "");
	assert.equal(peerSummary(bare.sender, bare.body), "another session");
});

test("a wake receipt is the headline, and its prompt is the part behind the envelope", () => {
	// Ported from `wake_receipt_headline` (`harness/rows.py:397`) and asserted
	// against the SAME inputs, with the expected values read off the Python
	// function itself rather than retyped from its docstring.
	const delivery =
		'(alarm) Scheduled wake w-9 (1, every 6h) — cancel with wake({op:"cancel",id:"w-9"})';
	assert.equal(
		wakeReceiptHeadline(`${delivery}\n\ncheck the deploy`),
		"w-9 (1, every 6h)",
	);
	assert.equal(
		wakePromptBody(`${delivery}\n\ncheck the deploy`),
		"check the deploy",
	);
	// The cancel how-to is an instruction for the model, and the (alarm) /
	// `Scheduled wake` markers restate what the row's own clock glyph says.
	assert.equal(
		wakeReceiptHeadline("(alarm) Scheduled wake w-2 (3, every 1d)"),
		"w-2 (3, every 1d)",
	);
	// EVERY leading marker is stripped, not one: a single strip leaves
	// "(alarm) (alarm) …" on a human surface, which is the exact defect the
	// function exists to prevent surviving inside the function that prevents it.
	assert.equal(
		wakeReceiptHeadline(
			"(alarm) (alarm) Scheduled wake w-1 (2, at 09:00)\n\nbody",
		),
		"w-1 (2, at 09:00)",
	);
	// Envelope whitespace collapses before anything else, so a doubled space is
	// not a reason to keep the marker.
	assert.equal(
		wakeReceiptHeadline(
			'(alarm)   Scheduled  wake   w-3 (4, every 30m) — cancel with wake({"op": "cancel"})\n\nx',
		),
		"w-3 (4, every 30m)",
	);
	// A delivery with no envelope is its own headline rather than an empty row.
	assert.equal(
		wakeReceiptHeadline("plain first paragraph\n\nsecond"),
		"plain first paragraph",
	);
	// No prompt behind the envelope is an empty disclosure, which the row reads
	// as "nothing to offer" rather than as a blank line under a label.
	assert.equal(wakePromptBody("(alarm) Scheduled wake w-1 (1, every 1h)"), "");

	// The CATCH-UP is not a receipt: both shipping surfaces skip it on replay,
	// because it is user-attributed and its first paragraph is addressed to the
	// model. The projection has to agree.
	assert.equal(wakeIsCatchup({ wake_catchup: true }), true);
	assert.equal(wakeIsCatchup({}), false);
	assert.equal(wakeIsCatchup({ wake_catchup: 0 }), false);
});

/* ------------------------------------------------------ the working line */

/*
 * The aggregate working line's ladder, and the one rung on it the app drives
 * from its own state rather than from a frame the owner sent.
 *
 * That rung covers the operator's own report: an accepted send on a cold
 * session spends seconds inside the message request spawning its runtime, and
 * until the first frame landed the transcript painted the user's own bubble and
 * then nothing at all. So the rung must exist, must sit on the ladder's own
 * phase (one wait, one clock), and — the half a story cannot pin — must CLEAR.
 * A line that lingers is a claim that outlives the work it names, so every
 * clear is asserted here rather than eyeballed in a frame.
 *
 * The module imports two runtime values (`displayName`, `paintsSomething`)
 * besides its types, so this bundle is not free — it is small and side-effect
 * free, which is why the assertions can live here rather than in a browser.
 */
const workingLineBundle = await build({
	stdin: {
		contents:
			'export { deriveWorkingLine, ADMITTED_SEND_ACTIVITY, STARTING_SESSION_ACTIVITY, COMPACTING_ACTIVITY, sendUnsettledForSession, ownerAnswered, turnStopped, stoppedAfterAdmission, workingLineClaimed, workingLineInputFor } from "./src/renderer/src/features/chat/canonical/working-line-model";\n' +
			'export { visibleRecords } from "./src/renderer/src/features/chat/canonical/cross-session-visibility";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	deriveWorkingLine,
	ADMITTED_SEND_ACTIVITY,
	STARTING_SESSION_ACTIVITY,
	COMPACTING_ACTIVITY,
	sendUnsettledForSession,
	ownerAnswered,
	turnStopped,
	stoppedAfterAdmission,
	workingLineClaimed,
	workingLineInputFor,
	visibleRecords,
} = await import(
	`data:text/javascript;base64,${Buffer.from(workingLineBundle.outputFiles[0].text).toString("base64")}`
);

test("frame-only stopped outcomes retire only the send they follow", () => {
	// The real refusal frame may contain no completion_attention transcript
	// entry at all. The pane synthesizes its visible incident from this record;
	// a fixture containing only a raw notice cannot cover that production path.
	// The v2 neutral closure (2026-09-29) retires the wait too: the runtime was
	// disposed, and a fence-less spinner beside a "Completed — runtime
	// retired/disposed" receipt is the Q4 contradiction this gate exists for.
	// The retire-for-build kind joins for the same reason: the drain is leaving
	// and the turn was cut, so a spinner beside "Retired for an update …" would
	// be that contradiction again.
	for (const kind of ["error", "interrupted", "closed", "retired"]) {
		const attention = { anchor_id: "completion-new", kind, unseen: true };
		assert.equal(stoppedAfterAdmission(attention, null), true);
		assert.equal(stoppedAfterAdmission(attention, "completion-old"), true);
		assert.equal(
			stoppedAfterAdmission({ ...attention, unseen: false }, null),
			true,
		);
		assert.equal(stoppedAfterAdmission(attention, "completion-new"), false);
	}
	assert.equal(stoppedAfterAdmission(null, null), false);
	assert.equal(stoppedAfterAdmission({ kind: "error" }, null), false);
	assert.equal(
		stoppedAfterAdmission(
			{ anchor_id: "completion-new", kind: "success" },
			null,
		),
		false,
	);
});

const userRow = (id, text) => ({ kind: "user", id, ts: 1, text, images: [] });
const assistantRow = (id, text) => ({
	kind: "assistant",
	id,
	ts: 1,
	text,
	streaming: true,
	stopReason: null,
	error: false,
});
const runningToolRow = (id) => ({
	kind: "tool",
	id,
	ts: 1,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args: null,
	phase: "running",
	argumentBytes: 0,
	output: null,
	isError: false,
	durationS: null,
	startedAt: 1,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
});
const noticeRow = (id) => ({
	kind: "notice",
	id,
	ts: 1,
	text: "Cleared the conversation",
	level: "info",
});
/*
 * A durable completion marker, which the reducer writes on a `notice` for
 * exactly three outcomes — "Stopped with an error", "Interrupted", and the v2
 * neutral closure "Completed — runtime retired/disposed" — and never for its
 * own renderer notes. The `complete` field is the marker; the text is copied
 * from `transcript-reducer.ts` only so a reader can see what it is.
 */
const incidentRow = (id, level = "error") => ({
	kind: "notice",
	id,
	ts: 2,
	complete: true,
	text: level === "error" ? "Stopped with an error" : "Interrupted",
	level,
});

/** A send this pane admitted, with its echo painted under the anchor id. */
const ECHO = "admission-1";
const admitted = (records, over = {}) =>
	deriveWorkingLine({
		waiting: false,
		compacting: false,
		starting: true,
		startingAfterId: ECHO,
		gate: false,
		unavailable: false,
		records: [userRow(ECHO, "go"), ...records],
		...over,
	});

test("an admitted send that has painted nothing yet says the app is waiting", () => {
	// The echo IS the transcript at this point: the user's own row, and no
	// assistant or tool row after it. Before this rung the frame showed the
	// bubble and then dead air for the length of the cold engage.
	assert.deepEqual(admitted([]), {
		activity: ADMITTED_SEND_ACTIVITY,
		phase: "thinking",
	});
});

test("the wait sits on the ladder's own phase, so one wait keeps one clock", () => {
	// Phases are what the clock is keyed to (`working-line.tsx`). A phase of its
	// own would restart the count at 0s the moment the first frame arrived,
	// which is the "restarting the clock on every label change" defect the line
	// is documented against — the engage and the model call that follows are one
	// wait to the reader.
	const plainWaiting = deriveWorkingLine({
		waiting: true,
		compacting: false,
		starting: false,
		gate: false,
		unavailable: false,
		records: [],
	});
	assert.equal(admitted([]).phase, plainWaiting.phase);
});

test("a painted answer after the echo ends the wait, wherever it sits", () => {
	// The clear sweeps EVERY record after the send's own echo, which is the rule
	// `buildRows` and `AssistantRow` use. Scoped to the tail (the first cut) it
	// re-asserted the rung over an answer already on screen whenever the last
	// record happened to paint nothing — measured: painted prose followed by an
	// empty `message_start` placeholder (review round 1, R3).
	assert.equal(admitted([assistantRow("a1", "Here is the answer")]), null);
	assert.equal(admitted([runningToolRow("t1")]), null);
	assert.equal(
		admitted([
			assistantRow("a1", "Here is the answer"),
			assistantRow("a2", ""),
		]),
		null,
		"a placeholder after the answer must not bring the rung back",
	);
	// A placeholder on its own is not an answer: `message_start` opens one at
	// the top of every provider call, before a token exists, and that record
	// paints no row.
	assert.deepEqual(admitted([assistantRow("a1", "")]), {
		activity: ADMITTED_SEND_ACTIVITY,
		phase: "thinking",
	});
	// A notice is not the agent answering either — it is the app's own receipt
	// sitting at the foot of the column.
	assert.deepEqual(admitted([noticeRow("n1")]), {
		activity: ADMITTED_SEND_ACTIVITY,
		phase: "thinking",
	});
});

test("records BEFORE the echo are another turn's business", () => {
	// An existing conversation's own history sits above the send. Anchored on
	// the echo, none of it can pass for an answer to this send — which the tail
	// rule could read as one whenever the echo had not painted yet.
	const records = [
		userRow("u-old", "earlier question"),
		assistantRow("a-old", "earlier answer"),
		userRow(ECHO, "go"),
	];
	assert.deepEqual(admitted([], { records }), {
		activity: ADMITTED_SEND_ACTIVITY,
		phase: "thinking",
	});
});

test("a question for the user outranks the wait, and a dead stream suspends it", () => {
	// Branding § 7: a pending question is the only thing on screen that needs a
	// decision, so the working line yields to it — the same rule the ladder's
	// own branches obey.
	assert.equal(admitted([], { gate: true }), null);
	// An unrecoverable stream renders the error in the transcript; a working
	// line beside it would claim progress the transport is not making.
	assert.equal(admitted([], { unavailable: true }), null);
});

test("the rung only shows when nothing the owner drove has taken over", () => {
	// A turn the owner IS generating still reads the ladder, with the admitted
	// send true alongside it: the first frame wins as soon as it arrives.
	assert.deepEqual(
		admitted([runningToolRow("t1")], {
			waiting: true,
			records: [userRow(ECHO, "go"), runningToolRow("t1")],
		}),
		// The `startedAt` is the RUNNING arm's own anchor, not the admitted-send
		// rung's: a running batch is dated by its oldest card's own start, so the
		// band resumes the age the call has instead of restarting at zero
		// (`working-line-model.ts`; the fixture's row is stamped at 1).
		{ activity: "running bash", phase: "running", startedAt: 1 },
	);
	assert.deepEqual(
		admitted([], {
			waiting: true,
			records: [userRow(ECHO, "go"), assistantRow("a1", "Streaming")],
		}),
		{ activity: "responding", phase: "responding" },
	);
	// And with no send in flight at all, nothing is claimed.
	assert.equal(
		deriveWorkingLine({
			waiting: false,
			compacting: false,
			starting: false,
			gate: false,
			unavailable: false,
			records: [userRow("u1", "go")],
		}),
		null,
	);
});

/* ---------------------- the in-flight claim: the pair, the terminal yield */

/*
 * The operator incident (2026-10-07), at the model level and at the call sites.
 *
 * The report: a running turn showed NO in-flight indicator while work ran - the
 * working line blanked on every ~1.5-4 s receipt gap a busy session answers
 * with, and for the whole stretch of a flapping link. The tests below pin the
 * rule that fixes it: the model's two facts, the press's own rung, and where
 * the call sites get them.
 */
test("a busy turn keeps its line through a reconnect and yields only to a terminal statement", () => {
	/*
	 * The model cannot see a gap as such - it reads `waiting` and `unavailable`,
	 * and it is the CALL SITES that decide which fact lands in each. So the first
	 * two cases below feed `waiting` the way `chat-page.tsx`'s `turnAlive` does
	 * (the pair, `frontend ?? heldFrontend`) and the third is the discriminating
	 * one: a terminal statement stands the rung down even though the stale
	 * `frontend` still says `streaming` (the hook keeps that field across an
	 * `end`/`error`, which is exactly why `waiting` alone cannot decide this).
	 */
	const turnAlive = (frontend, heldFrontend) =>
		(frontend ?? heldFrontend)?.streaming === true;
	const pane = (over = {}) =>
		deriveWorkingLine({
			waiting: true,
			compacting: false,
			starting: false,
			gate: false,
			unavailable: false,
			records: [],
			...over,
		});
	// busy + healthy: the authoritative frontend is present and streaming.
	assert.deepEqual(
		pane({ waiting: turnAlive({ streaming: true }, null) }),
		{ activity: "thinking", phase: "thinking" },
		"a healthy busy turn keeps its line",
	);
	// busy + a receipt gap: `frontend` is null and the last reading is held.
	// This is the state the flapping link lives in, and the claim survives it -
	// the frame `reconnect-gap.stories.tsx`'s `RestoredRunning` photographs.
	assert.deepEqual(
		pane({ waiting: turnAlive(null, { streaming: true }) }),
		{ activity: "thinking", phase: "thinking" },
		"the held reading's streaming keeps the in-flight claim up through the gap",
	);
	// busy + a TERMINAL statement: the pane renders its failure instead of the
	// conversation, so the rung stands down (the call sites pass
	// `canonicalTranscriptTerminal`, which the reconnecting status does not
	// reach - see its doc in `transcript-pane.ts`).
	assert.equal(
		pane({ waiting: turnAlive({ streaming: true }, null), unavailable: true }),
		null,
		"a terminal statement stands the rung down even while the stale reading streams",
	);
});

test("a Stop press in flight relabels the line and withholds its clock, without restarting it", () => {
	/*
	 * The press's own rung: from the press until its receipt or its bound, the
	 * line says the cancel is in progress. It does so by OVERLAYING the live
	 * state, so the phase and anchor underneath survive and the clock cannot
	 * restart or jump - the operator's tell is a fresh `0s` under the press, and
	 * a label-only swap cannot print one because the number is withheld for the
	 * whole window (`clock: false`, the queued arm's rule).
	 */
	const stoppingInput = (over = {}) => ({
		waiting: true,
		compacting: false,
		starting: false,
		gate: false,
		unavailable: false,
		stopping: true,
		records: [],
		...over,
	});
	// The live phase and its anchor, relabelled with the clock withheld.
	assert.deepEqual(deriveWorkingLine(stoppingInput()), {
		activity: "stopping the turn",
		phase: "thinking",
		clock: false,
	});
	// A running batch keeps its OWN anchor and phase under the label: the
	// clock's zero is the batch's oldest card, and the overlay must not move it.
	assert.deepEqual(
		deriveWorkingLine(
			stoppingInput({ records: [userRow(ECHO, "go"), runningToolRow("t1")] }),
		),
		{
			activity: "stopping the turn",
			phase: "running",
			startedAt: 1,
			clock: false,
		},
	);
	// A state the ladder does not claim is never relabelled into one.
	assert.equal(deriveWorkingLine(stoppingInput({ gate: true })), null);
	assert.equal(deriveWorkingLine(stoppingInput({ unavailable: true })), null);
	// The composer's hint reads the same derivation, so the press cannot hide
	// the box's own sentence while the turn is still the thing running.
	assert.equal(workingLineClaimed(stoppingInput()), true);
});

test("the disputed idle keeps the line and withholds its clock (UX round 2, U9)", () => {
	/*
	 * The disputed idle's half of the overlay rule: an `idle` receipt under a
	 * held live claim leaves the claim STANDING - the runtime's answer and the
	 * pane's last reading disagree, and neither side can be declared the liar
	 * from here - but the line must stop asserting a duration, because the
	 * ticking `running bash 15s` beside `This view may be out of date.` was the
	 * operator-visible tell. Same shape as `stopping`, one rung less: the label
	 * stays the live state's own, only the number goes.
	 */
	const disputedInput = (over = {}) => ({
		waiting: true,
		compacting: false,
		starting: false,
		gate: false,
		unavailable: false,
		idleDisputed: true,
		records: [],
		...over,
	});
	// The label stays the live state's own; only the clock is withheld.
	assert.deepEqual(deriveWorkingLine(disputedInput()), {
		activity: "thinking",
		phase: "thinking",
		clock: false,
	});
	// A running batch keeps its own label and anchor - the line still claims
	// the work, it just stops dating it.
	assert.deepEqual(
		deriveWorkingLine(
			disputedInput({ records: [userRow(ECHO, "go"), runningToolRow("t1")] }),
		),
		{
			activity: "running bash",
			phase: "running",
			startedAt: 1,
			clock: false,
		},
	);
	// `stopping` outranks it if both were ever set (they cannot be - the
	// disputed sentence is written by the idle receipt that RESOLVES the
	// press window - but the order is the rule).
	assert.deepEqual(deriveWorkingLine(disputedInput({ stopping: true })), {
		activity: "stopping the turn",
		phase: "thinking",
		clock: false,
	});
	// A gate or a terminal statement still outranks everything.
	assert.equal(deriveWorkingLine(disputedInput({ gate: true })), null);
	assert.equal(deriveWorkingLine(disputedInput({ unavailable: true })), null);
});

test("the line, the hint and every control read the one pair", () => {
	/*
	 * The wiring half of the incident, pinned in source because
	 * `chat-content.tsx` is a page component this suite cannot mount (the
	 * sibling guards, `stopped-row-measure.test.mjs` among them, read it the
	 * same way). Round 1's D2 extended the pair from the two claim surfaces to
	 * every consumer that acts on the turn: through a gap the raw field is
	 * false while the pane still claims a running turn, and the split it
	 * replaced left the line saying `running bash 6s` while Stop was absent, Esc
	 * sent nothing (three presses, zero `/interrupt` requests on the wire), and
	 * Enter sent `mode:"prompt"` - the wire shape that parks a message sent
	 * during a live turn. One predicate, so a promise and the control that
	 * answers it cannot disagree.
	 */
	const strip = (source) =>
		source
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	const content = strip(
		readFileSync(
			"src/renderer/src/features/chat/components/chat-content.tsx",
			"utf8",
		),
	);
	const page = strip(
		readFileSync(
			"src/renderer/src/features/chat/components/chat-page.tsx",
			"utf8",
		),
	);
	assert.match(
		page,
		/const turnAlive =\s*\n\s*\(canonical\.frontend \?\? canonical\.heldFrontend\)\?\.streaming === true;/,
		"turnAlive is the pair, defined once in the page that owns the prop",
	);
	// The two CLAIMS.
	assert.match(
		content,
		/waiting=\{canonical\.turnAlive\}/,
		"the working line reads the pair",
	);
	assert.match(
		content,
		/waiting: canonical\.turnAlive,/,
		"the composer's hint reads the pair",
	);
	// The CONTROLS and the SEND MODE, on the same pair (D2): the Stop control
	// the composer draws, the aside adopt gate that must not disagree with it,
	// and the steer-vs-prompt mode the send path posts.
	assert.match(
		content,
		/active: canonical\.turnAlive,/,
		"the Stop control is drawn from the pair",
	);
	/*
	 * The Escape accelerator's call site is pinned with them (QA round 2, Q5):
	 * the hook's own module is tested, but the wiring that decides WHICH fact
	 * arrives there was rig-only coverage - a raw field at this seam left every
	 * suite green while the key died in a gap. It lives in the PAGE (the
	 * accelerator is the page's own listener), so it is asserted on `page`.
	 */
	assert.match(
		page,
		/useInterruptOnEscape\(\{\s*sessionId,\s*turnAlive,/,
		"the escape accelerator reads the pair at its call site",
	);
	/*
	 * The composer's `Stopping the turn` yields on the same fall the line does
	 * (UX round 2, U10): with the receipt withheld, the feed showed the turn
	 * over and the box kept claiming to still be stopping for the full 15 s -
	 * the band's Retry directly above it. `stoppingTurn` (the phase) still
	 * drives the rung; the sentence takes the pair's reading explicitly.
	 */
	assert.match(
		content,
		/const stoppingShown = stoppingTurn && canonical\?\.turnAlive === true;/,
		"the composer's stopping sentence yields when the feed showed the turn over",
	);
	assert.match(content, /stopping: stoppingShown,/);
	assert.match(content, /stopping=\{stoppingTurn\}/);
	/*
	 * And the disputed idle's clock-withhold rides the rung (UX round 2, U9):
	 * the page folds it from the notice's own kind, so the sentence and the
	 * withheld number are one fact with one lifetime.
	 */
	assert.match(
		content,
		/idleDisputed=\{canonical\.idleDisputed === true\}/,
		"the rung is handed the disputed-idle withhold",
	);
	assert.match(
		content,
		/asideStreaming=\{canonical\.turnAlive\}/,
		"the aside adopt gate reads the pair the Stop control reads",
	);
	assert.match(
		page,
		/mode: turnAlive \? "steer" : "prompt",/,
		"the send mode reads the pair",
	);
	// NOTHING may go back to the raw field - that is the blanking defect this
	// pair exists to remove, in every one of its consumers.
	assert.doesNotMatch(content, /canonical\.busy/);
	assert.doesNotMatch(page, /mode: busy \?/);
	assert.doesNotMatch(page, /busy: canonical\.frontend\?\.streaming === true;/);
});

test("the press window's resolutions are pinned (round 1's R1-2)", () => {
	/*
	 * The strand class the fix is about: an outcome that can be SET but never
	 * resolved leaves the rung standing, the band suppressed, or an alert with
	 * no state that clears it. Each resolution is pinned as source here (the
	 * page cannot be mounted in this suite), the way the band's own terms are
	 * pinned in `stopped-row-measure.test.mjs` - and the two guards that make
	 * them PRESS-SCOPED are pinned with them, because round 1 measured what
	 * their absence does (a dropped first press's late bound retracting a
	 * second press's confirmed band).
	 */
	const strip = (source) =>
		source
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	const page = strip(
		readFileSync(
			"src/renderer/src/features/chat/components/chat-page.tsx",
			"utf8",
		),
	);
	// Every answer is keyed to its press and a superseded one writes nothing.
	assert.match(
		page,
		/if \(pressId !== pressSeq\.current\) return;/,
		"a superseded press must not write",
	);
	/*
	 * A press while a press is IN FLIGHT neither sends nor takes a number
	 * (design round 2, D10, the coalesce): the double-tap is how people press
	 * Escape, and the second press used to bounce the rung to `running bash`,
	 * print `nothing was stopped` over a press the server had confirmed, and
	 * lose the band (measured in the `dblesc`/`gapesc` reads).
	 */
	assert.match(page, /stopOutcomeRef\.current = stopOutcome;/);
	assert.match(
		page,
		/const phase = stopOutcomeRef\.current;/,
		"the press reads the committed phase",
	);
	assert.match(
		page,
		/if \(phase === "pending" \|\| phase === "awaiting-end"\) return;/,
		"a press during a live press window is coalesced",
	);
	// A receipt: a confirmed cancel keeps the rung until the stream shows the
	// end - but ONLY while the feed still claims the turn (R2-1): a receipt
	// landing after the end the pair already showed must resolve clean, or
	// `awaiting-end` strands the composer on a spent edge.
	assert.match(
		page,
		/receipt\.status === "interrupted" && turnAliveRef\.current\s*\? "awaiting-end"\s*:\s*null/,
		"the receipt resolves the press (and keeps the rung through teardown only while the turn is still claimed)",
	);
	// The bound: stated as unconfirmed ONLY while the turn is still alive; an
	// end the feed already showed resolves clean instead.
	assert.match(
		page,
		/if \(!turnAliveRef\.current\) \{/,
		"the bound must not unconfirm a turn the feed showed over",
	);
	assert.match(page, /setStopOutcome\("unconfirmed"\)/);
	// The alert is remembered as THIS machinery's sentence so its retirement
	// cannot erase someone else's.
	assert.match(
		page,
		/stopAlertSentence\.current = sentence;/,
		"the bound's sentence is remembered for its own retirement",
	);
	// The two edges that retire the window: a new turn's first reading and a
	// session change - and the first is the PAIR's own edge, never `busy`
	// (a reconnect must not fire it; the incident's premise).
	assert.match(page, /pressSeq\.current \+= 1;/);
	assert.match(
		page,
		/if \(!previous && turnAlive\) \{/,
		"the new-turn retire is the pair's own edge (a reconnect cannot fake it)",
	);
	assert.match(
		page,
		/\} else if \(previous && !turnAlive\) \{/,
		"and the turn's end retires the waiting phases",
	);
	assert.match(
		page,
		/current === "awaiting-end" \|\| current === "unconfirmed"/,
		"the turn's end resolves the waiting phases",
	);
	// And the disputed idle asks the conversation again (U1), with its own
	// notice kind (U9) so the rung's clock-withhold has exactly the sentence's
	// lifetime - retiring on the pair's fall with the plain idle, never on a
	// timer.
	assert.match(
		page,
		/if \(receipt\.status === "idle" && claimAlive\) canonical\.retry\(\);/,
		"an idle receipt under a live claim triggers a re-read",
	);
	assert.match(
		page,
		/receipt\.status !== "idle"\s*\? "outcome"\s*:\s*claimAlive\s*\? "idle-disputed"\s*:\s*"idle",/,
		"the disputed idle is its own kind",
	);
	assert.match(
		page,
		/current\?\.kind === "idle" \|\| current\?\.kind === "idle-disputed"/,
		"both idle sentences retire on the pair's fall",
	);
	/*
	 * Q5 (QA round 2): the call-site wiring that was rig-only. The selection
	 * itself is tested in `interrupt-control.test.mjs`; what is pinned here is
	 * that the call site hands it the PANE'S live claim, and that the stop
	 * alert has exactly its three owners - a fourth caller would be an eraser
	 * nobody signed for.
	 */
	assert.match(
		page,
		/interruptNotice\(receipt, \{ turnClaimed: claimAlive \}\)/,
		"the disputed-idle selection is handed the pane's live claim",
	);
	assert.equal(
		(page.match(/clearStopAlert\(\);/g) ?? []).length,
		3,
		"the stop alert has exactly its three owners: the receipt arm and the pair's two edges",
	);
});

/* ---------------------------------- which send is "unsettled" (the box's claim) */

/*
 * The rule that decides whether the composer says the message is still going
 * out (`sendUnsettledForSession`), asserted over the draft rows it reads, with
 * no store and no React - the way `draftIdentityFor` is.
 *
 * The old rule at this site was `admittedSendFor(sessionId, row)`, and two of
 * its three terms are gone. The session-id conjunct was the dead-air window
 * itself: before `sessions.create` answers there is no session id, so the claim
 * was false for the whole create hop - the row is now painted at the press
 * (see `pendingSendForView` in `use-canonical-session`), and the pane's claim
 * comes from the registry instead. `admissionAttempted` was the receipt's
 * latch: it is written after the create hop, so requiring it withheld the box's
 * sentence for exactly the window this reader gained.
 *
 * What is left is the row's own `pending`, read by whichever name this
 * conversation's send can have under: the session id (a row the create
 * patched), a `send:<id>` key (the live path), and the DRAFT key (a remounted
 * boom whose create is still in flight). Its lifetime - written at the press,
 * cleared by the failure arms - is pinned against the real store in
 * `canonical-chat.test.mjs`.
 */
test("a send is unsettled while its row is pending, under any of its names", () => {
	const row = {
		key: "send:111111111111",
		pending: true,
		admissionAttempted: true,
		admissionRequestId: ECHO,
	};
	assert.equal(
		sendUnsettledForSession({ "send:111111111111": row }, "111111111111"),
		true,
	);

	// The create hop: pending and NOT yet attempted. This is the window the old
	// `admissionAttempted` conjunct went silent in, and the sentence a remounted
	// composer must still find when its create is in flight.
	assert.equal(
		sendUnsettledForSession(
			{
				"draft:d1": {
					key: "draft:d1",
					pending: true,
					admissionRequestId: ECHO,
				},
			},
			"draft:d1",
		),
		true,
	);
	// The same row found by the session the create patched onto it.
	assert.equal(
		sendUnsettledForSession(
			{
				"draft:d1": {
					key: "draft:d1",
					sessionId: "111111111111",
					pending: true,
					admissionRequestId: ECHO,
				},
			},
			"111111111111",
		),
		true,
	);

	// A settled or failed send: the request is no longer in flight, and the row's
	// own sentence (or the transcript's) says what happened instead.
	assert.equal(
		sendUnsettledForSession(
			{ "send:111111111111": { ...row, pending: false } },
			"111111111111",
		),
		false,
	);
	// Nothing of this conversation's in flight at all.
	assert.equal(sendUnsettledForSession({}, "111111111111"), false);
	assert.equal(sendUnsettledForSession({}, undefined), false);
});

/* ---------------------------------------------- the create hop's own label */

test("the wait line reads `starting the session` until the session exists", () => {
	const before = deriveWorkingLine({
		waiting: false,
		compacting: false,
		starting: true,
		startingAfterId: ECHO,
		startingSession: true,
		startingSince: 1_760_000_000_000,
		gate: false,
		unavailable: false,
		records: [],
	});
	assert.deepEqual(before, {
		activity: STARTING_SESSION_ACTIVITY,
		phase: "thinking",
		startedAt: 1_760_000_000_000,
	});

	// The create answered: same wait, same clock, the other label. The PHASES are
	// equal, which is the whole clock rule - a second phase would restart the
	// elapsed number at the create's answer.
	const after = deriveWorkingLine({
		waiting: false,
		compacting: false,
		starting: true,
		startingAfterId: ECHO,
		startingSession: false,
		startingSince: 1_760_000_000_000,
		gate: false,
		unavailable: false,
		records: [],
	});
	assert.deepEqual(after, {
		activity: ADMITTED_SEND_ACTIVITY,
		phase: "thinking",
		startedAt: 1_760_000_000_000,
	});
	assert.equal(before.phase, after.phase);

	// A caller that knows neither fact derives EXACTLY what it always did,
	// including the absent anchor: no `startedAt` key, so every deep comparison
	// in the suites that predate this label keeps its old shape.
	assert.deepEqual(
		deriveWorkingLine({
			waiting: false,
			compacting: false,
			starting: true,
			startingAfterId: ECHO,
			gate: false,
			unavailable: false,
			records: [],
		}),
		{ activity: ADMITTED_SEND_ACTIVITY, phase: "thinking" },
	);
});

test("the anchored clear is the transcript's own predicate, swept", () => {
	assert.equal(ownerAnswered([userRow(ECHO, "go")], ECHO), false);
	assert.equal(
		ownerAnswered([userRow(ECHO, "go"), assistantRow("a1", "hi")], ECHO),
		true,
	);
	assert.equal(
		ownerAnswered(
			[userRow(ECHO, "go"), assistantRow("a1", "hi"), assistantRow("a2", "")],
			ECHO,
		),
		true,
	);
	// Without an anchor in the list — an evicted echo, a transcript replaced by
	// `/clear` — the fallback falls back to the tail. `true` here IS the clear
	// (it is what makes `deriveWorkingLine` return null); what the fallback
	// withholds is the RUNG, in the case below where nothing paints.
	assert.equal(
		ownerAnswered([assistantRow("a1", "hi")], "missing-anchor"),
		true,
	);
	assert.equal(ownerAnswered([userRow("u1", "go")], "missing-anchor"), false);
});

test("the admitted-send copy claims nothing the renderer cannot check", () => {
	// The one rung that is not a fact the owner sent, so it is held to the
	// weaker rule: name the waiting, never the mechanism. The renderer cannot
	// tell a session whose runtime is still spawning from one that is warm and
	// merely slow to answer, so "starting the session" (considered, and
	// rejected) or the ladder's own `thinking` — which means "a model call is in
	// flight" — would assert something it has no way to check. If a later change
	// wants a mechanism word here, it has to make it checkable first.
	assert.equal(ADMITTED_SEND_ACTIVITY, "waiting for the agent");
	assert.doesNotMatch(
		ADMITTED_SEND_ACTIVITY,
		/runtime|model|session|start|think/i,
	);
});

test("a turn that dies before it paints retires the wait, and a renderer note does not", () => {
	/*
	 * The regression QA round 2 measured (Q4): with the round-1 clear set an
	 * incident retires nothing, because the owner never painted a row and the
	 * transport is still live. The line was still up at t+55s beside "Stopped
	 * with an error", and the composer's hint stayed on "Waiting for the agent"
	 * underneath it - a stuck claim about work that has stopped and then failed,
	 * which is worse than the dead air this whole change removed.
	 */
	const records = [userRow(ECHO, "go"), incidentRow("stop-1")];
	assert.equal(admitted([incidentRow("stop-1")]), null);
	assert.equal(turnStopped(records, ECHO), true);
	// "Interrupted" is the same marker: a turn the USER stopped has also ended.
	assert.equal(admitted([incidentRow("stop-2", "warning")]), null);

	/*
	 * THE OTHER DIRECTION, which is what keeps this from retiring the rung
	 * mid-turn: the reducer writes plenty of notices with no marker - a retry
	 * line, a harness recovery notice, a subagent failure - and none of them is
	 * the turn being over.
	 */
	assert.equal(
		turnStopped([userRow(ECHO, "go"), noticeRow("note-1")], ECHO),
		false,
	);
	assert.deepEqual(admitted([noticeRow("note-1")]), {
		activity: ADMITTED_SEND_ACTIVITY,
		phase: "thinking",
	});
	// A marker BEFORE the echo belongs to an earlier turn (the anchor rule).
	assert.equal(
		turnStopped([incidentRow("stop-0"), userRow(ECHO, "go")], ECHO),
		false,
	);
	// And with no anchor in the list the fallback reads the tail, so a marker
	// there retires rather than holding a rung over a finished turn.
	assert.equal(turnStopped([incidentRow("stop-1")], "missing-anchor"), true);
});

test("the composer's hint is the rung's own derivation, not a second condition", () => {
	/*
	 * Review round 2's R2-3 and design round 2's D5 are one defect: the composer
	 * asked the latch directly (`awaitingReply={canonical.starting}`), so it went
	 * on saying "Waiting for the agent" in the states the line deliberately
	 * yields in - a pending question, and a dead transport - 46px below a pane
	 * that had withdrawn the claim. Both surfaces now call this module; the
	 * property worth pinning is that they cannot disagree, so each case asserts
	 * the pair.
	 */
	const pane = (over = {}) =>
		workingLineInputFor({
			waiting: false,
			compacting: false,
			starting: true,
			startingAfterId: ECHO,
			gate: false,
			unavailable: false,
			records: [userRow(ECHO, "go")],
			...over,
		});
	// The cold window: both claim it.
	assert.notEqual(deriveWorkingLine(pane()), null);
	assert.equal(workingLineClaimed(pane()), true);
	// A pending question outranks the wait (branding § 7): neither claims it.
	assert.equal(deriveWorkingLine(pane({ gate: true })), null);
	assert.equal(workingLineClaimed(pane({ gate: true })), false);
	// A dead transport: neither.
	assert.equal(workingLineClaimed(pane({ unavailable: true })), false);
	// A stopped turn: neither, on the same derivation.
	assert.equal(
		workingLineClaimed(
			pane({ records: [userRow(ECHO, "go"), incidentRow("s1")] }),
		),
		false,
	);
	// A painted answer: neither.
	assert.equal(
		workingLineClaimed(
			pane({ records: [userRow(ECHO, "go"), assistantRow("a1", "hi")] }),
		),
		false,
	);
	// The ladder is a claim too, so the hint stays up through the hand-off
	// instead of swapping a true sentence for "Ask me for help" while the agent
	// is demonstrably writing.
	assert.equal(
		workingLineClaimed(pane({ waiting: true, records: [userRow(ECHO, "go")] })),
		true,
	);
	/*
	 * A compaction pass, which the modal used to speak for. It is the more
	 * specific fact than `waiting` — a pass is why the session is busy — so the
	 * label is the pass's and the phase is its own, which is what the clock times.
	 * The literal is asserted rather than the exported constant: this is the one
	 * place that pins the COPY, and the copy is the terminal host's own
	 * (`local_operator/tui/app.py`'s `compacting context` fallback) so a reader who
	 * learned the phrase there does not learn a second one here.
	 */
	const pass = pane({ compacting: true, waiting: true });
	assert.deepEqual(deriveWorkingLine(pass), {
		activity: "compacting context",
		phase: "compacting",
	});
	assert.equal(COMPACTING_ACTIVITY, "compacting context");
	assert.equal(workingLineClaimed(pass), true);
	// A pending question still outranks it: the user is blocked on a decision.
	assert.equal(deriveWorkingLine(pane({ compacting: true, gate: true })), null);
	// And a dead transport suppresses the rung rather than being cleared by it,
	// so a reconnect cannot resurrect a claim by leaving the flag standing.
	assert.equal(
		workingLineClaimed(pane({ compacting: true, unavailable: true })),
		false,
	);
	// With no pass in flight nothing changes: the flag is an addition to the
	// ladder, not a replacement for it.
	assert.equal(workingLineClaimed(pane({ compacting: false })), true);
	// Nothing happening at all: neither.
	assert.equal(
		workingLineClaimed(
			pane({ starting: false, records: [userRow("u1", "go")] }),
		),
		false,
	);
});

test("a running send is absent from the working line once filtered", () => {
	/*
	 * The desktop working line reads RECORDS, not mounted cards (unlike the TUI's
	 * card-derived line), so the transcript feeds it the FILTERED list - without
	 * that, a pane hiding cross-session traffic would still say `running send`
	 * beside rows that no longer include it. Both directions are pinned: the
	 * unfiltered list names the card (the leak the seam removes), the filtered
	 * one falls to the ladder's generic arm.
	 */
	const pane = (records) =>
		workingLineInputFor({
			waiting: true,
			compacting: false,
			starting: false,
			gate: false,
			unavailable: false,
			records,
		});
	const records = [
		userRow("u1", "go"),
		{ ...runningToolRow("t1"), toolName: "send" },
	];
	assert.deepEqual(deriveWorkingLine(pane(records)), {
		activity: "running send",
		phase: "running",
		startedAt: 1,
	});
	const shown = visibleRecords(records, true);
	assert.deepEqual(
		deriveWorkingLine(pane(shown)),
		{
			activity: "thinking",
			phase: "thinking",
		},
		"the hidden card is not named; the rung falls to its generic arm",
	);
	// And the default hands back the bare reference, so nothing about the line
	// changes with the option off.
	assert.equal(visibleRecords(records, false), records);
});

test("a notice's body is partitioned between its row and its disclosure", () => {
	// The row paints the opening line; the disclosure paints the rest, and only
	// the rest. Round 2's D7/Q5/R11/U14: a long single-line notice painted all of
	// itself and then repeated it verbatim behind the chevron, so the affordance
	// promised material it did not add.
	const single = splitFirstLine(`${"z".repeat(400)} END`);
	assert.equal(
		single.rest,
		null,
		"a newline-free body is all headline, nothing to disclose",
	);
	assert.equal(single.headline.length, 404);

	const multi = splitFirstLine(
		"Two lines of notice.\nThe second line, disclosed.",
	);
	assert.equal(multi.headline, "Two lines of notice.");
	assert.equal(multi.rest, "The second line, disclosed.");
	// The two halves never overlap: this is the property the duplication broke.
	assert.ok(!multi.rest.includes(multi.headline));

	// Leading blanks do not become the headline, and the rest still follows it.
	const padded = splitFirstLine("\n\n  Indented opening.  \nThe rest.");
	assert.equal(padded.headline, "Indented opening.");
	assert.equal(padded.rest, "The rest.");

	// Whitespace alone has nothing to say, and says it as a static line.
	assert.deepEqual(splitFirstLine("   \n \n"), { headline: "", rest: null });
});

/* ---------------------------------------------- the selectable-text marker */

/*
 * R22: nothing bound `data-text-surface` to the guard that reads it, and the
 * failure mode of a divergence is silent and already-fixed: a span written
 * without the marker makes a drag across it TOGGLE the row and drop that span
 * from the copy (U7/U17).
 *
 * So this asserts the property neither side can assert alone — the real row,
 * rendered, marks every text it exposes to a drag — plus the binding itself:
 * the writer and the reader both name the marker through one shared constant,
 * so changing the attribute in one place cannot leave the other behind. The
 * render is `react-dom/server` with React external, the same shape
 * `ask-options.test.mjs` uses (the repo has no jsdom and does not need one).
 */
const surfaceBundle = await build({
	stdin: {
		contents: [
			'export { TraceLine } from "./src/renderer/src/features/chat/components/trace/trace-line";',
			'export { TEXT_SURFACE_ATTR, TEXT_SURFACE_PROPS } from "./src/renderer/src/shared/components/ui/text-surface";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});
const surfacePath = new URL("./_text-surface.bundle.mjs", import.meta.url);
await writeFile(surfacePath, surfaceBundle.outputFiles[0].text);
const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { TraceLine, TEXT_SURFACE_ATTR, TEXT_SURFACE_PROPS } = await import(
	surfacePath.href
);
await unlink(surfacePath);

test("the marker the guard reads is the marker the row writes", () => {
	// The binding: one constant, two importers. `PROPS` is what the row spreads
	// onto its spans, and it must carry exactly the name the guard asks for.
	assert.equal(TEXT_SURFACE_PROPS[TEXT_SURFACE_ATTR], "true");
	const guard = readFileSync(
		resolve("src/renderer/src/shared/components/ui/disclosure.tsx"),
		"utf8",
	);
	const row = readFileSync(
		resolve("src/renderer/src/features/chat/components/trace/trace-line.tsx"),
		"utf8",
	);
	for (const [file, source] of [
		["disclosure.tsx", guard],
		["trace-line.tsx", row],
	]) {
		assert.match(source, /TEXT_SURFACE_(ATTR|PROPS)/, `${file} imports it`);
		// A literal would be a second spelling of the attribute, which is the
		// divergence this constant exists to make impossible.
		assert.equal(
			source.includes(`"${TEXT_SURFACE_ATTR}"`),
			false,
			`${file} does not spell the attribute itself`,
		);
	}
});

test("every text a row exposes to a drag carries the marker", () => {
	const shapes = [
		// An open tool row: a disclosure trigger with its body behind it.
		h(TraceLine, {
			action: "READ",
			filePath: "invoices/march.csv",
			narration: "summing the unpaid invoices",
			details: h("pre", null, "rows: 12"),
		}),
		// A static line, the shape a row takes when it has nothing to disclose.
		h(TraceLine, {
			action: "READ",
			filePath: "invoices/march.csv",
			narration: "summing the unpaid invoices",
		}),
		// The incident shape: a derived verb, a machine-voice object and a
		// wrapping message — the row type U17 was about.
		h(TraceLine, {
			dense: true,
			verbOverride: "mcp",
			object: "anthropic/claude-opus-5",
			narration:
				"MCP server 'notion': MCP authorization failed; run /mcp reauth notion",
			failed: true,
			wrap: true,
		}),
	];

	for (const [index, element] of shapes.entries()) {
		const markup = renderToStaticMarkup(element);
		// Every span the row makes selectable must carry the marker, or a drag
		// over it toggles the row and drops it from the copy.
		const selectable = markup.match(/class="[^"]*select-text[^"]*"/g) ?? [];
		assert.ok(selectable.length > 0, `shape ${index} exposes text`);
		for (const span of markup.match(/<span[^>]*>/g) ?? []) {
			if (!/select-text/.test(span)) continue;
			assert.ok(
				span.includes(`${TEXT_SURFACE_ATTR}="true"`),
				`shape ${index}: a selectable span is marked — ${span}`,
			);
		}
		// And the marker is not put on anything that is NOT text: the trigger's
		// own chrome must stay unmarked, or a press on it stops being a row action.
		for (const tag of markup.match(
			/<(span|div|button)[^>]*data-text-surface[^>]*>/g,
		) ?? []) {
			assert.match(tag, /select-text/, `marked but not selectable — ${tag}`);
		}
	}
});

/* ------------------------------------------------------------ the tool's ink
 *
 * The operator's report, twice, and the reason this section exists.
 *
 * FIRST: `task`/`hub`/`todo` rendered an accent NAME beside a grey GLYPH —
 * two expressions inside one row, disagreeing. That was answered by collapsing
 * both onto one hueless ink, which fixed the disagreement and, in the same move
 * deleted the per-category colour the operator was comparing against the TUI
 * ("it looks like a lot of color was lost ... please fix that"). The correction
 * restores the map and keeps the one expression, so the two cannot disagree
 * AGAIN while still carrying the category.
 *
 * A green suite would not have caught either half. The defect is a property of
 * the PAIR of spans inside one rendered row, and the map's coverage is a
 * property of a table nothing asserted. Both are asserted here, over the
 * production component's own markup.
 */
const rowBundle = await build({
	stdin: {
		contents:
			'export { ToolRow } from "./src/renderer/src/features/chat/components/trace/tool-row";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});
const rowPath = new URL("./_tool-row.bundle.mjs", import.meta.url);
await writeFile(rowPath, rowBundle.outputFiles[0].text);
const { ToolRow } = await import(rowPath.href);
await unlink(rowPath);

/** Render one row and return its markup as a string. */
const renderRow = (toolName, outcome, over = {}) =>
	renderToStaticMarkup(
		h(ToolRow, {
			toolName,
			summary: `${toolName} arg`,
			outcome,
			durationS: outcome === "running" ? null : 0.4,
			...over,
		}),
	);

/**
 * The ink tokens on a tag, and ONLY the ink tokens.
 *
 * Filtered by name rather than by `/^text-/`, because every span in this row
 * also carries type and alignment utilities — `text-mono-sm`, `text-right` —
 * and a matcher that takes those for ink would compare two spans on their
 * font size and call it a colour.
 */
const INK_TOKEN =
	/^text-(?:ink|ink-muted|ink-dim|ink-disabled|accent|accent-hover|accent-active|accent-alt|info|danger|success|warning|token-command)$/;
const inkOf = (tag) => {
	const classes = (tag.match(/class="([^"]*)"/) ?? [])[1] ?? "";
	return classes.split(/\s+/).filter((c) => INK_TOKEN.test(c));
};

/**
 * The row's TOOL GLYPH span and its NAME span.
 *
 * Found structurally rather than by a class name, because the outcome mark's
 * span carries the same box classes as the tool glyph's — one ink each, and a
 * matcher keyed on the box would compare the pair wrongly. The name is the
 * first span that titles itself; the tool glyph is the nearest span before it
 * inside the same cluster. That is also the ORDER the reader sees, so an
 * assertion over the pair is an assertion about what is on screen.
 */
const glyphAndName = (markup) => {
	const spans = markup.match(/<span[^>]*>/g) ?? [];
	const nameIndex = spans.findIndex((tag) => / title="/.test(tag));
	assert.ok(nameIndex > 0, `no titled name span in ${markup.slice(0, 200)}`);
	let glyphIndex = -1;
	for (let i = nameIndex - 1; i >= 0; i--) {
		if (/size-3\.5/.test(spans[i])) {
			glyphIndex = i;
			break;
		}
	}
	assert.ok(glyphIndex >= 0, `no tool glyph before the name in ${markup}`);
	return { glyph: spans[glyphIndex], name: spans[nameIndex] };
};

test("a tool's category is the ledger's own map, looked up case-insensitively", () => {
	// `_TOOL_CATEGORY` (tool_card.py:218-238) is the BASE of the map; the entries
	// the trace-label change added for names the TUI does not carry (`web_read`,
	// `lsp`, `console`, `team`, `wait`, `jobs`, `secret`, `network`,
	// `team_delete`) are UI-side decisions stated as such in the source, not
	// parity claims (review round 1, R1-5). The axis is what the call did to the
	// machine, so what is asserted is the SET each tool lands in and not the
	// spelling of the table.
	for (const name of [
		"read",
		"glob",
		"grep",
		"web_fetch",
		"web_read",
		"web_search",
		"browser",
		"lsp",
		"list_variables",
		"read_variable",
	]) {
		assert.equal(toolCategory(name), "read", `${name} reads`);
	}
	for (const name of ["write", "edit"]) {
		assert.equal(toolCategory(name), "mutate", `${name} mutates`);
	}
	// `console` is the app's own terminal in a frame, which is why it takes the
	// exec ink the TUI gives `bash`/`eval` rather than the wrench's neutral.
	for (const name of ["bash", "eval", "console"]) {
		assert.equal(toolCategory(name), "exec", `${name} executes`);
	}
	for (const name of [
		"task",
		"agent",
		"team",
		"hub",
		"todo",
		"send",
		"wake",
		"ask",
		"wait",
		"jobs",
		"secret",
		"network",
		"project",
		"team_delete",
		"project_delete",
	]) {
		assert.equal(toolCategory(name), "meta", `${name} is meta`);
	}

	// MODEL-controlled, so the lookup cannot be exact-match: a provider that
	// echoes `Bash` back has to land in the same category as `bash`, which is the
	// same reasoning `toolIcon` states for its own table.
	assert.equal(toolCategory("Bash"), "exec");
	assert.equal(toolCategory("  EDIT  "), "mutate");
	assert.equal(toolCategory("WEB_FETCH"), "read");
	assert.equal(toolCategory("Task"), "meta");

	// Unclassified is QUIET, never mis-filed: an MCP call, a builtin nobody has
	// classified, and a name that is not a tool at all all take the neutral.
	for (const name of [
		"mcp__linear_create_issue",
		"mcp__",
		"peer",
		"a_builtin_that_does_not_exist_yet",
		"",
	]) {
		assert.equal(toolCategory(name), "plain", `${name} is unfiled`);
	}

	// AND THE PROTOTYPE KEYS, which are the one family of name a bare subscript
	// gets wrong. `CATEGORIES[key] ?? "plain"` read the object's INHERITED
	// properties, so `constructor` answered `Object`, `toString` answered a
	// function and `__proto__` answered an object — none of them a `ToolCategory`,
	// so the row rendered with NO ink class at all rather than the neutral every
	// unclassified tool is promised. The names are model-controlled, so a provider
	// naming a tool `constructor` is reachable; the TUI's `dict.get` has no chain
	// to read and answered `plain` for all of them. Asserted as a GROUP, because
	// the fix is a property of the lookup (own-property, not subscript) and the
	// next prototype key nobody thought of is the one that would slip through a
	// single-name test.
	for (const name of [
		"constructor",
		"toString",
		"hasOwnProperty",
		"valueOf",
		"__proto__",
		"__defineGetter__",
		// Through the same trim/lowercase path: `  Constructor  ` must not be able
		// to reach the inherited property the bare key reached.
		"  Constructor  ",
		"ToString",
	]) {
		assert.equal(
			toolCategory(name),
			"plain",
			`${name} is an inherited property, not a filed tool`,
		);
	}
});

test("the glyph takes identity ink, the name takes state ink, and they agree on state", () => {
	// [tool name, outcome, the ink both spans must carry]. The first five are the
	// categories; the rest are liveness outranking identity, which is the rule
	// that must not be lost now that identity has colour again.
	const CASES = [
		["read", "success", "text-info"],
		["grep", "success", "text-info"],
		// The case-insensitive path, through the component and not only the table.
		["Web_Fetch", "success", "text-info"],
		["write", "success", "text-ink-muted"],
		["edit", "success", "text-ink-muted"],
		["bash", "success", "text-ink-muted"],
		["eval", "success", "text-ink-muted"],
		["task", "success", "text-accent-alt"],
		["team", "success", "text-accent-alt"],
		["hub", "success", "text-accent-alt"],
		["secret", "success", "text-accent-alt"],
		["console", "success", "text-ink-muted"],
		["lsp", "success", "text-info"],
		// Unclassified, and a receipt whose name is not a tool: the neutral.
		["mcp__linear_create_issue", "success", "text-ink-muted"],
		["peer", "receipt", "text-ink-muted"],
		// A `wake` RECEIPT is the neutral too, and NOT the meta ink its name would
		// earn as a tool card. A receipt is not a call: the TUI's receipt blocks
		// (`WakeBlock`, `PeerMessageBlock`) paint icon `dim` / name `muted` and ask
		// the category table nothing, and `_category_element` has exactly one
		// caller, `ToolCard`. So both receipts read the same, which is the pair the
		// docstring names.
		["wake", "receipt", "text-ink-muted"],
		// …while the same name as a CALL still takes the map's answer, which is what
		// keeps this from being "`wake` is neutral":
		["wake", "success", "text-accent-alt"],
		// STATE OUTRANKS IDENTITY. A running `read` is not blue and a failed `task`
		// is not violet.
		["read", "running", "text-accent"],
		["task", "running", "text-accent"],
		["bash", "running", "text-accent"],
		["read", "error", "text-danger"],
		["write", "error", "text-danger"],
		["hub", "not-run", "text-danger"],
		// `interrupted` is settled, so it takes the identity its tool earned —
		// which is the record a previous round left stale when it wrote that the
		// interrupted outcome was the one with no colour at all. The MARK stays
		// hueless; the row's identity does not.
		["grep", "interrupted", "text-info"],
		["bash", "interrupted", "text-ink-muted"],
		["task", "interrupted", "text-accent-alt"],
	];

	/*
	 * THE NAME'S INK IS THE ROW'S STATE AND NOTHING ELSE (§E1, D8).
	 *
	 * The pair used to share one expression, on the rule that identity and state
	 * must not be painted differently inside one row. D8 is the counter-example
	 * that rule could not survive: a settled `read` row drew its VERB in `info`,
	 * so the loudest ink on a settled ledger was the tool's name - the part of the
	 * row that says the least - while the result beside it was grey. The glyph
	 * keeps identity (its SHAPE is what carries the tool anyway), the verb is
	 * quiet, and the two still agree wherever the row has something to say about
	 * what is HAPPENING: a running row is accent in both spans, a failed one
	 * `danger` in both. That is the part of the old rule that was load-bearing.
	 */
	const stateOnly = {
		running: "text-accent",
		error: "text-danger",
		"not-run": "text-danger",
	};
	for (const [toolName, outcome, expected] of CASES) {
		const markup = renderRow(toolName, outcome);
		const { glyph, name } = glyphAndName(markup);
		const glyphInk = inkOf(glyph);
		const nameInk = inkOf(name);
		assert.deepEqual(
			glyphInk,
			[expected],
			`${toolName}/${outcome}: the tool glyph's ink — got ${glyphInk.join(" ")} on ${glyph}`,
		);
		const expectedName = stateOnly[outcome] ?? "text-ink-muted";
		assert.deepEqual(
			nameInk,
			[expectedName],
			`${toolName}/${outcome}: the name reads state only — got ${nameInk.join(" ")} where ${expectedName} was expected`,
		);
		if (stateOnly[outcome]) {
			assert.deepEqual(
				nameInk,
				glyphInk,
				`${toolName}/${outcome}: state must read the same on both spans — glyph ${glyphInk.join(" ")} against name ${nameInk.join(" ")}`,
			);
		}
	}
	// And the case D8 is about, stated as itself: a settled read row's VERB is not
	// the category ink its glyph carries.
	const readRow = glyphAndName(renderRow("read", "success"));
	assert.ok(
		!inkOf(readRow.name).includes("text-info"),
		"a settled read row must not draw its verb in the category ink (D8)",
	);

	// The command SUMMARY stays uncoloured, which is the operator's own wording
	// from the report that started all of this ("the tool call preview does not
	// need to be colored"): it is the machine voice beside the identity, never a
	// second copy of it. Uncoloured means the neutral register — the summary has
	// always taken one and that is not what this change moved — and specifically
	// NOT a category hue, which is the part that would make the row say its
	// category twice.
	const HUE = [
		"text-info",
		"text-accent",
		"text-accent-alt",
		"text-danger",
		"text-success",
		"text-warning",
	];
	const NEUTRAL = ["text-ink", "text-ink-muted", "text-ink-dim"];
	for (const outcome of ["success", "running", "error", "interrupted"]) {
		const titled =
			renderRow("read", outcome).match(/<span[^>]* title="[^"]*"/g) ?? [];
		assert.equal(titled.length, 2, "the name and the summary tile themselves");
		const summaryInk = inkOf(titled[1]);
		assert.equal(
			summaryInk.length,
			1,
			`the summary takes one ink — got ${summaryInk.join(" ")}`,
		);
		assert.ok(
			NEUTRAL.includes(summaryInk[0]),
			`the summary is uncoloured — got ${summaryInk[0]} on ${outcome}`,
		);
		for (const hue of HUE) {
			assert.ok(
				!summaryInk.includes(hue),
				`the summary carries no category hue — got ${hue} on ${outcome}`,
			);
		}
	}
});

test("the category-to-ink map is written once, and no second one shadows it", () => {
	// Two maps that agree with each other are indistinguishable from two maps
	// that are both correct, right up until one is edited. So the tokens the map
	// spends are asserted to appear exactly once each in the component: a second
	// table, or an inline expression per span, shows up here as a duplicate.
	const source = readFileSync(
		resolve("src/renderer/src/features/chat/components/trace/tool-row.tsx"),
		"utf8",
	);
	for (const token of ["text-info", "text-accent-alt"]) {
		const uses = source.split(`"${token}"`).length - 1;
		assert.equal(
			uses,
			1,
			`\`${token}\` is declared once, in the category map — got ${uses} uses`,
		);
	}
	// And the ink the pair reads is derived, never written out: one call site per
	// span, both naming the same function, so a future edit cannot colour one and
	// leave the other. Matched with the call's own trailing comma, because the
	// doc comments above name the expression too and prose is not a call site.
	// ONE expression per span, and they are different expressions now: the glyph
	// derives identity-from-state, the name derives state alone. Both are named
	// functions called at exactly one site, so a future edit cannot colour one span
	// inline and leave the other behind — which is what this matched before the two
	// inks separated.
	const glyphCalls = source.match(/rowInk\(outcome, toolName\),/g) ?? [];
	assert.equal(
		glyphCalls.length,
		1,
		`the glyph reads the one identity/state expression — got ${glyphCalls.length}`,
	);
	const nameCalls = source.match(/nameInk\(outcome\),/g) ?? [];
	assert.equal(
		nameCalls.length,
		1,
		`the name reads the one state expression — got ${nameCalls.length}`,
	);
	// The state-only function must not reach for the category map: that is the
	// whole point of it, and a token appearing inside its body would restore D8's
	// defect through a second call path.
	const nameInkBody = source.slice(
		source.indexOf("const nameInk"),
		source.indexOf("const DiffCounters"),
	);
	for (const token of ["CATEGORY_INK", "text-info", "text-accent-alt"]) {
		assert.ok(
			!nameInkBody.includes(token),
			`the state-only ink must not consult ${token}`,
		);
	}
});

test("a row whose first label read is in flight shows no stand-in yet", () => {
	/*
	 * The first frame of a mid-turn join. Every seeded row starts without its
	 * arguments, and the stand-in would put the call's RESULT in the command's
	 * column — the operator's `bash  … {"text": 200, "solo_cpu": 0.08…` rows.
	 * While the read that finds the arguments is pending the column is empty;
	 * once it settles (`labelPending` false) the stand-in is exactly what it was.
	 */
	const output = '{"text": 200, "solo_cpu": 0.08, "fanout": 4}';
	assert.equal(outputFallbackLine(output, true), null);
	assert.equal(
		outputFallbackLine(output, false),
		'… {"text": 200, "solo_cpu": 0.08, "fanout": 4}',
	);
	assert.equal(
		outputFallbackLine(output),
		outputFallbackLine(output, false),
		"the default is the settled rule, so every other caller is unchanged",
	);
});

test("the mark's state reaches a reader who cannot see it, and only while it stands", () => {
	/*
	 * UX round 4, U7. The late-hold glyph is `aria-hidden` — it is a glyph, and
	 * "…" is not a word — so before this the cell said NOTHING to assistive tech
	 * for the whole hold: 49.9 s on a wedged owner and 25.0 s on the refusing
	 * route, where a sighted reader gets the cue at 2.0 s. The word rides in the
	 * SAME branch as the mark, which is what bounds it to the state that
	 * justifies it: the pre-threshold blank carries no word (nothing is being
	 * announced on a row that is merely waiting), and the release takes the word
	 * away with the glyph, so no stale "pending" outlives the hold.
	 *
	 * WHAT IT IS NOT, stated so a later round does not change it by accident: it
	 * is not a live region. The mark's arrival is ONE event for a whole hold
	 * batch — 26 rows in the reported conversation, in the same frame — so
	 * `aria-live` here would announce 26 times at the threshold. The row's
	 * existing idiom for a mark that says something is exactly this: a static
	 * `sr-only` word beside it, read when the reader reaches the row.
	 */
	const blank = renderRow("bash", "success", { summaryHold: false });
	const marked = renderRow("bash", "success", { summaryHold: true });
	assert.match(
		marked,
		/<span class="sr-only">pending<\/span>/,
		"the marked cell spells its state out for assistive tech",
	);
	assert.equal(
		blank.includes(">pending<"),
		false,
		"and the blank cell says nothing: the word exists only while the mark stands",
	);
	assert.equal(
		/aria-live/.test(marked),
		false,
		"and it is not a live region: a hold batch is one event across every held row, so a live region would announce once per row at the threshold",
	);
	// The glyph stays decorative: the word is a SIBLING of the hidden span, not
	// inside it, or `aria-hidden` would hide the word with the glyph.
	const hidden = marked.slice(marked.indexOf('aria-hidden="true"'));
	const hiddenContent = hidden.slice(0, hidden.indexOf("</span>"));
	assert.equal(
		hiddenContent.includes("pending"),
		false,
		`the word is not inside the hidden span — got ${hiddenContent}`,
	);
});

test("a result with no details keeps the counts the row already had", () => {
	/*
	 * The sequence from the report, reduced to the rule: the durable row said
	 * `+91 -19`, then the seed's end for the same call arrived with `details:
	 * null` because `_bound_live_result_in_place` stripped it. "Said nothing"
	 * keeps the counts; a stated `details` object wins, zero included.
	 */
	const had = { added: 91, removed: 19 };
	assert.deepEqual(preferDiffCounts(null, had), had);
	assert.deepEqual(preferDiffCounts(undefined, had), had);
	assert.deepEqual(preferDiffCounts(null, null), { added: 0, removed: 0 });
	assert.deepEqual(preferDiffCounts({ added: 3, removed: 0 }, had), {
		added: 3,
		removed: 0,
	});
	// A stated object with no counts is the producer saying "none", not silence:
	// `{}` is the `details` every non-diff tool reports.
	assert.deepEqual(preferDiffCounts({}, had), { added: 0, removed: 0 });
	// Malformed counts read as unknown, as `diffCount` always did.
	assert.deepEqual(preferDiffCounts({ added: -1, removed: "7" }, had), {
		added: 0,
		removed: 0,
	});
});

test("the partial delivery pair paints an amber word and its own mark, and never the danger ground", () => {
	/*
	 * The incident this exists for: a `send` whose message landed in a busy
	 * peer's mailbox was painted with the SAME row as a refusal - danger wash,
	 * the word `failed`, an Error block - so a delivered message read as a lost
	 * one. These assertions are the pair's own properties, over the production
	 * component's markup: the word, the mark BESIDE it (so the two states read
	 * apart with the colour off), the sentence assistive tech hears instead of
	 * the abbreviation, and the ground that must NOT be the failure's.
	 */
	/** The class list of the span that draws exactly `text`, or null. */
	const wordClasses = (markup, text) => {
		const match = markup.match(
			new RegExp(`<span class="([^"]*)"[^>]*>${text}</span>`),
		);
		return match ? match[1].split(/\s+/) : null;
	};
	/*
	 * The word's class list EXACTLY, which is also the drop gate (UX round 1,
	 * U7): `hidden` until the row's own `toolrow` container is at least 19rem, then
	 * `inline`. Pinned as a full list rather than a `includes` so a mutation - the
	 * gate removed, its breakpoint moved, the state swapped - fails here rather
	 * than passing on the tokens that happen to survive.
	 */
	const WORD_INK = [
		"font-medium",
		"text-meta",
		"text-warning",
		"hidden",
		"@[19rem]/toolrow:inline",
	];
	const srOnly = (markup) =>
		[...markup.matchAll(/<span class="sr-only">([^<]*)<\/span>/g)].map(
			([, text]) => text,
		);

	const mailbox = renderRow("send", "partial", { deliveryState: "mailbox" });
	assert.deepEqual(
		wordClasses(mailbox, "wake unconfirmed"),
		WORD_INK,
		"the mailbox row draws its own word in the warning role",
	);
	assert.ok(
		// The mark is a SECOND channel: a shape of its own beside the word, not a
		// recollection of the tick or the cross.
		mailbox.includes("lucide-mailbox"),
		"the mailbox row draws the mailbox mark beside its word",
	);
	assert.deepEqual(
		srOnly(mailbox),
		["delivered, wake unconfirmed"],
		"the row speaks the fact its word abbreviates, and only once",
	);
	assert.ok(
		mailbox.includes('title="In their mailbox.'),
		"the word tiles itself with the hedge the reader acts on",
	);

	const unconfirmed = renderRow("send", "partial", {
		deliveryState: "unconfirmed",
	});
	/*
	 * The fourth state's drawn word NAMES ITS SUBJECT (UX round 1, U2): the bare
	 * `unconfirmed` read as a verdict at the row's trailing edge (`Sent …
	 * unconfirmed`), which is the one reading that leads to a duplicate delivery.
	 */
	assert.deepEqual(wordClasses(unconfirmed, "delivery unconfirmed"), WORD_INK);
	assert.ok(
		unconfirmed.includes("lucide-mail-question"),
		"the unconfirmed row draws a DIFFERENT mark from the mailbox one",
	);
	/*
	 * NOT the dashed circle (UX round 1, U5): that ring is the app's busy
	 * silhouette (`LoaderCircle … animate-spin` on the running states), so a
	 * settled row wearing it said "still working" - the inverse of the state.
	 */
	assert.ok(!unconfirmed.includes("lucide-circle-dashed"));
	assert.ok(!unconfirmed.includes("animate-spin"));
	assert.ok(!unconfirmed.includes("lucide-mailbox"));
	/*
	 * And the spoken sentence carries the hedge the hover carries (UX round 1,
	 * U3): the drawn word is `aria-hidden`, so this span is the whole of what a
	 * reader with no screen gets - and `delivery unconfirmed` alone is "it did not
	 * go".
	 */
	assert.deepEqual(srOnly(unconfirmed), [
		"delivery unconfirmed — it may still arrive, so check before resending",
	]);
	assert.ok(unconfirmed.includes('title="No wake answer'));

	// Both are settled NON-failures: no danger on the ground, none in the ink,
	// and the silhouette the failed row has (a word in `danger`) is not theirs.
	for (const markup of [mailbox, unconfirmed]) {
		assert.ok(
			!markup.includes("bg-danger-wash"),
			"a partial row never wears the failure's ground",
		);
		assert.ok(
			!markup.includes("text-danger"),
			"a partial row never wears the failure's ink",
		);
	}

	// ...while `failed` keeps the danger pathway and says the fact the reader
	// acts on - `not delivered`, not the generic `failed`, which read as a
	// statement about the MESSAGE ("Sent ... failed").
	const failed = renderRow("send", "error", { deliveryState: "failed" });
	assert.deepEqual(
		wordClasses(failed, "not delivered"),
		["font-medium", "text-meta", "text-danger"],
		/*
		 * NO DROP GATE ON THIS ONE, and it is load-bearing rather than an omission
		 * (see `StatusCluster`): the partial pair can shed its word because the MARK
		 * beside it carries the state with the colour off, and a failed row has no
		 * mark - its word IS the whole of its non-colour statement, so shedding it
		 * would leave the danger WASH (colour alone) saying that the call failed.
		 */
	);
	assert.ok(failed.includes("bg-danger-wash"));
	assert.ok(!failed.includes("text-warning"));
	assert.ok(!failed.includes("lucide-mailbox"));
	/*
	 * And the row does not contradict itself (UX round 1, U8): the settled verb
	 * for a delivery that provably happened is `Attempted`, never `Sent` beside
	 * `not delivered`.
	 */
	assert.ok(
		/>Attempted</.test(failed),
		`a failed delivery must not open with the settled verb \`Sent\` — got ${failed.match(/>[A-Za-z]+</g)}`,
	);
	assert.deepEqual(
		srOnly(failed),
		[],
		"the drawn word IS the announcement for a failure - never read out twice",
	);

	// `delivered`, and every row whose result stated nothing at all, keep
	// exactly the row they had: no word, no mark, no delivery ink.
	for (const [outcome, state] of [
		["success", "delivered"],
		["success", null],
		["error", "queued"],
	]) {
		const quiet = renderRow("send", outcome, { deliveryState: state });
		assert.deepEqual(wordClasses(quiet, "not delivered"), null);
		assert.equal(wordClasses(quiet, "delivery unconfirmed"), null);
		assert.ok(!quiet.includes("text-warning"));
		assert.ok(!quiet.includes("lucide-mailbox"));
		assert.ok(!quiet.includes("lucide-mail-question"));
	}

	/*
	 * THE WIDTH RULE, both halves, and what this test can and cannot claim.
	 *
	 * The design's rule has two halves ("drop it below the width that holds it
	 * whole; summary truncates first, the word never truncates") and until round 1
	 * the suite asserted only the second - with a property any implementation has,
	 * including one whose word is squeezed or clipped: no `truncate` on the word,
	 * `truncate` on the summary. This pins the OTHER half as a mechanism: the
	 * partial pair's word sits behind the row's own `toolrow` container query, and
	 * the failed row's word does not.
	 *
	 * It cannot pin the GEOMETRY: jsdom has no layout engine, so a container query
	 * resolves to nothing here whatever the class list says - the same limit
	 * `scripts/stopped-row-measure.test.mjs` records for the chat measure. What
	 * makes it discriminating is that it names the whole contract, so the
	 * mutations that matter all fail it: gate removed, `shrink-0` kept as the only
	 * mechanism, breakpoint changed, gate added to the failure word, the state
	 * swapped. The BEHAVIOUR is measured in a real browser instead, at three
	 * widths, and the readings are on the PR (the word present at 390px and 560px,
	 * absent at 320px with the mark and the spoken sentence still carrying the
	 * state).
	 */
	const narrow = renderRow("send", "partial", { deliveryState: "unconfirmed" });
	assert.ok(
		!wordClasses(narrow, "delivery unconfirmed").includes("truncate"),
		"the state word is never truncated (a `wake unconf…` would say nothing)",
	);
	assert.ok(
		/class="min-w-0 flex-1 truncate[^"]*"/.test(narrow),
		"the summary is the cell that truncates first",
	);
	assert.ok(
		wordClasses(narrow, "delivery unconfirmed").includes(
			"@[19rem]/toolrow:inline",
		),
		"the word is gated on the ROW's own container, so the row sheds it rather than the summary",
	);
	/*
	 * ...AND THE DURATION IS WHAT GIVES WAY WHEN THE FAILED ROW CANNOT (QA round 2,
	 * Q1): the refusal's word is frozen and it has no mark to fall back on, so at
	 * 320px its 259px of content overflowed the 240px box by 19px and the trailing
	 * `0.4s` is the slot that sheds instead. Pinned EXACTLY, on both a partial row
	 * and a refusal: a gate removed, moved to another breakpoint or applied to only
	 * one of them fails here rather than passing on the tokens that survive.
	 */
	const DURATION_SLOT = [
		"hidden",
		"w-[5ch]",
		"text-right",
		"font-mono",
		"text-ink-dim",
		"text-mono-sm",
		"tabular-nums",
		"@[19rem]/toolrow:inline",
	];
	const durationClasses = (markup) =>
		[...markup.matchAll(/<span class="([^"]*w-\[5ch\][^"]*)"/g)].map((m) =>
			m[1].split(/\s+/),
		);
	assert.deepEqual(
		durationClasses(narrow),
		[DURATION_SLOT],
		"the duration sheds on the same container the word does",
	);
	assert.deepEqual(
		durationClasses(renderRow("send", "error", { deliveryState: "failed" })),
		[DURATION_SLOT],
		"the refusal's row sheds the duration too - it is the failed word's containment",
	);
	/*
	 * ...AND A ROW WITH NO MARK RESERVES NO MARK BOX (design round 3, D5). The
	 * status cluster's slot is 14px plus its 6px gap, and `failed` draws no glyph by
	 * design, so at the floor that unspent 20px starved the summary cell to ONE
	 * character (`Attempted w not delivered`). The slot itself stays: it holds the
	 * sr-only sentence, which is absolutely positioned and cannot hold the box open.
	 *
	 * Counted rather than matched, because the row has TWO slots with this class
	 * list - the leading tool icon, which always holds a glyph, and the status
	 * cluster's - so a bare `!includes` would pass on either one. The filter is on
	 * the class TOKENS and not on the variant: React escapes the `&` in
	 * `[&_svg]:size-3.5` to `[&amp;_svg]:size-3.5` in the rendered attribute, so a
	 * regex written against the source spelling matches nothing at all.
	 */
	const sizedSlots = (markup) =>
		[...markup.matchAll(/<span class="([^"]*)"/g)]
			.map((m) => m[1].split(/\s+/))
			.filter((list) => list.includes("shrink-0") && list.includes("size-3.5"));
	assert.deepEqual(
		sizedSlots(renderRow("send", "error", { deliveryState: "failed" })).length,
		1,
		"a row that draws no mark reserves no mark's box: only the tool icon is sized",
	);
	assert.deepEqual(
		sizedSlots(renderRow("send", "partial", { deliveryState: "mailbox" }))
			.length,
		2,
		"...while a row that DOES draw one keeps its box",
	);
});

/*
 * The pane the `send` row expands into, bundled on its own.
 *
 * The delivery note (UX round 1, U1/U4) is a slot on `ToolDetail`, and the
 * reasons it exists are positional: it has to sit between the arguments and the
 * machine result, and it has to WRAP - the result body cannot, which is what the
 * finding was about. Both are properties of the rendered markup, so this bundles
 * the shipped component rather than reading its source.
 */
const paneBundle = await build({
	stdin: {
		contents:
			'export { ToolDetail } from "./src/renderer/src/features/chat/components/trace/tool-detail";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	jsx: "automatic",
	external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
});
const panePath = new URL("./_tool-detail-pane.bundle.mjs", import.meta.url);
await writeFile(panePath, paneBundle.outputFiles[0].text);
const { ToolDetail } = await import(panePath.href);
await unlink(panePath);

test("the pane's note slot wraps, and sits between the arguments and the machine result", () => {
	const NOTE = "Delivered to their mailbox. Do not send it again.";
	const markup = renderToStaticMarkup(
		h(ToolDetail, {
			args: { target: "night-audit", message: "re-run the shard" },
			output: "→ night-audit (pid 51120): delivered to its mailbox",
			isError: false,
			note: h("span", null, NOTE),
		}),
	);
	const noteAt = markup.indexOf('data-detail-section="note"');
	assert.ok(noteAt > 0, `the note slot renders — got ${markup.slice(0, 200)}`);
	// The reader's sentence comes after the arguments (the design note's order,
	// and the order that puts it above the line nobody can read to the end) and
	// before the result body, which stays.
	assert.ok(
		markup.indexOf("night-audit") < noteAt,
		"the note follows the arguments",
	);
	assert.ok(
		noteAt < markup.indexOf("Output"),
		"the note precedes the result body",
	);
	// It WRAPS, in the sans face: the box it sits in is the machine payload's
	// `font-mono` + `whitespace-pre`, which is exactly what could not be read.
	const noteTag = markup.slice(noteAt - 260, noteAt);
	assert.match(noteTag, /whitespace-normal/);
	assert.match(noteTag, /font-sans/);
	assert.ok(markup.includes("Output"), "the machine result is still rendered");

	// And a pane with no note is the pane it always was: the slot is opt-in, so
	// every other tool's expansion is untouched by this change.
	const bare = renderToStaticMarkup(
		h(ToolDetail, { args: { a: 1 }, output: "ok", isError: false }),
	);
	assert.ok(!bare.includes('data-detail-section="note"'));
});

test("the transcript wires the note and the failure predicate into the pane", () => {
	/*
	 * The two connections the components cannot assert for themselves: that the
	 * ROW hands the note to the pane at all, and that the pane's `Error` heading
	 * reads the same failure predicate the counts read (QA round 1, Q2 - before
	 * this the heading read `record.isError` alone, so a producer that set
	 * `is_error` on a partial painted an amber row over an `Error` block).
	 *
	 * A source read, because the transcript is a page component this suite has no
	 * way to mount (it reads the canonical stores, the router and the preference
	 * hooks); the same limit `scripts/stopped-row-measure.test.mjs` records for
	 * `chat-content.tsx`. Comments are stripped so the prose above these
	 * expressions cannot satisfy the match.
	 */
	const source = readFileSync(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
		"utf8",
	).replace(/\/\*[\s\S]*?\*\//g, "");
	assert.match(
		source,
		/note=\{\s*record\.delivery\s*\?\s*<DeliveryNote state=\{record\.delivery\} \/>\s*:\s*undefined\s*\}/,
		"the row hands the delivery note to the pane",
	);
	assert.match(
		source,
		/isError=\{isFailedResult\(record\.isError, record\.delivery\)\}/,
		"the pane's Error heading reads the same predicate the failure counts read",
	);
});
