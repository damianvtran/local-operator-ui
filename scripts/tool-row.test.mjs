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
	diffCount,
	displayName,
	formatDuration,
	isBareToolName,
	formatSettledDuration,
	requestDesktopMedia,
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
	assert.equal(
		compactPath("/Users/damian/a b.md"),
		"/Users/damian/a b.md",
	);
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
	assert.equal(formatSettledDuration(0), "0.0s");
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
		{ op: "sessions.attachment", sessionId: "../admin", digest: "a".repeat(32) },
		// Wrong lengths and wrong alphabet.
		{ op: "sessions.attachment", sessionId: "0123456789ab", digest: "a".repeat(31) },
		{ op: "sessions.attachment", sessionId: "0123456789ab", digest: "A".repeat(32) },
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
	assert.ok(imgSrc.includes("blob:"), `img-src must allow blob: (got "${imgSrc}")`);
	// `media-src` already had it; keeping both in one assertion documents that
	// they are the same requirement for two element types.
	const mediaSrc = policy.match(/media-src ([^;]*)/)?.[1] ?? "";
	assert.ok(mediaSrc.includes("blob:"), `media-src must allow blob: (got "${mediaSrc}")`);
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
			'export { buildRows, GAP } from "./src/renderer/src/features/chat/canonical/transcript-rows";',
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
const { buildRows, GAP } = await import(
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
	const run = buildRows(
		["t1", "t2", "t3", "t4", "t5"].map(toolRecord),
		[],
	);
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
		source(path).match(
			new RegExp(`const ${name} = "([^"]+)"`),
		)?.[1];
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
	assert.notEqual(displayName(wire), wire, "and the column shows something else");
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
