import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { resolve } from "node:path";
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
	preferDiff,
	outputFallbackLine,
	requestDesktopMedia,
	stripDiffHeader,
	summaryFromArgs,
	toolCategory,
	toolNameColumn,
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
	assert.equal(summaryFromArgs("todo", { items: ["a"], op: "add" }), "add");
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

test("the name column grows to the longest visible name, within its bounds", () => {
	// A transcript of short names does not pay for a tool it never called.
	assert.equal(toolNameColumn(["bash", "read"]), 8);
	assert.equal(toolNameColumn([]), 8);
	assert.equal(toolNameColumn(["list_variables"]), 14);
	// And a pathological name cannot push the summary off the row.
	assert.equal(toolNameColumn(["a".repeat(60)]), 24);
});

test("tool categories are case-insensitive and default to plain", () => {
	// The name is MODEL-controlled: a provider echoing `Bash` must land in the
	// same category as `bash`.
	assert.equal(toolCategory("Bash"), "exec");
	assert.equal(toolCategory("read"), "read");
	assert.equal(toolCategory("edit"), "mutate");
	assert.equal(toolCategory("task"), "meta");
	assert.equal(toolCategory("mcp__linear_create_issue"), "plain");
	assert.equal(toolCategory("something_new"), "plain");
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
			'export { buildRows, GAP, paintsSomething } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
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
const { buildRows, GAP, paintsSomething } = await import(
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
	// `trace` carries no margin at all, so the row's own height IS the pitch.
	assert.deepEqual(GAP.trace, ["", ""]);
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
	assert.equal(rows[1].showAvatar, true, "the tool row opens the agent turn");
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
	assert.equal(rows[1].showAvatar, true, "the tool row opens the agent turn");
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

test("agent prose takes no reading cap, and the user bubble keeps one", () => {
	// The operator's report: agent prose must share the tool rows' left edge and
	// width, so it carries no `lo-measured` and therefore no 62ch cap and no
	// `margin-inline: auto`. The user bubble is deliberately unchanged — it is
	// an aside, and widening it is the unrequested half of this change.
	// The bare `MEASURE` token only — `CHAT_MEASURE` is the column's shared
	// width and a different thing entirely, so a substring match would count it.
	const measured = (path) =>
		readFileSync(path, "utf8")
			.split("\n")
			.filter(
				(line) => /(?<![A-Z_])MEASURE\b/.test(line) && line.includes("cn("),
			);
	// The canonical transcript: exactly one application, on the user row.
	const canonical = measured(
		"src/renderer/src/features/chat/canonical/canonical-transcript.tsx",
	);
	assert.equal(canonical.length, 1, "one measured box in the canonical path");
	// The legacy path must not keep the old behaviour either, or the same defect
	// returns on whichever surface still renders through it.
	const legacy = measured(
		"src/renderer/src/features/chat/components/message-item/message-paper.tsx",
	);
	assert.equal(legacy.length, 1, "one measured box in the legacy path");
	// The cap itself still exists, for the bubble that still wants it.
	assert.match(
		readFileSync(
			"src/renderer/src/features/chat/components/markdown.css",
			"utf8",
		),
		/\.lo-measured \.lo-markdown \{\s*max-width: 62ch;/,
		"the reading measure is still defined for the user bubble",
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
	"-\t\ttypeof value === \"number\" && value > 0 ? value : 0;",
	"+\tconst count = (value: unknown) =>",
	"+\t\ttypeof value === \"number\" && Number.isInteger(value) && value > 0;",
	' \treturn { added: count(source.added), removed: count(source.removed) };',
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
		outputFallbackLine("exit code: 0\n--- stdout ---\n=== downloads ===\nLO.app"),
		"… === downloads ===",
		"the status line and the section marker both step aside",
	);
	assert.equal(
		outputFallbackLine("exit code: -9\n--- stderr ---\n/LO.app: killed"),
		"… /LO.app: killed",
	);
	// Observed in a real transcript: a killed call writes the marker without a
	// number at all, and an indented one.
	assert.equal(outputFallbackLine("      exit code\n--- stdout ---\nreal"), "… real");

	// The marker is what keeps a line of the RESULT from reading as the call's
	// own object in that column — the design round's D1. Every line that reaches
	// the column through this path carries it.
	assert.ok(
		outputFallbackLine("exit code: 0\n--- stdout ---\n=== x ===").startsWith("… "),
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
	assert.equal(outputFallbackLine("200 match(es) for 'wake'"), "… 200 match(es) for 'wake'");

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
