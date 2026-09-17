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
			trace < item && item < turn,
			`tiers must widen: trace ${trace} < item ${item} < turn ${turn}`,
		);
		// The hierarchy the tightening had to preserve: a turn boundary is an
		// order of magnitude airier than an adjacent pair inside a run, so the
		// density buys nothing at the boundary's expense.
		assert.ok(turn >= trace * 8, "a turn boundary still reads as a boundary");
	}
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
	// reversed that call: the aside is the CARD's own `max-w-[75%]` inside
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
	// stands: any future non-`100%` `width`/`max-width` in `markdown.css` is a
	// failing test, because that file is the one place such a measure could retire
	// to and a new cap there should be an argued act rather than a silent one.
	const source = (path) => readFileSync(path, "utf8");
	// Comments stripped first: this file's own measure argument QUOTES `max-width:
	// 62ch` and `margin-inline: auto` while explaining why they are gone, and a
	// test that read the prose as a rule would fail on its own explanation.
	const css = source(
		"src/renderer/src/features/chat/components/markdown.css",
	).replace(/\/\*[\s\S]*?\*\//g, "");
	assert.deepEqual(
		[...css.matchAll(/max-width\s*:\s*([^;}]+)/g)]
			.map(([, value]) => value.trim())
			.filter((value) => value !== "100%"),
		[],
		"markdown.css declares no width cap beyond `100%`",
	);
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
	// A reading measure is a `ch` cap — 62ch was the number — so one re-added
	// under another name still has to spell a `ch` unit in this file.
	assert.deepEqual(
		css.match(/[\d.]+ch\b/g) ?? [],
		[],
		"markdown.css keeps no `ch` unit: the reading measure has no spelling left",
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
			["max-w-[75%]", "max-w-[92%]"],
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
			'export { deriveWorkingLine, ADMITTED_SEND_ACTIVITY, COMPACTING_ACTIVITY, admittedSendFor, ownerAnswered, turnStopped, stoppedAfterAdmission, workingLineClaimed, workingLineInputFor } from "./src/renderer/src/features/chat/canonical/working-line-model";',
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
	COMPACTING_ACTIVITY,
	admittedSendFor,
	ownerAnswered,
	turnStopped,
	stoppedAfterAdmission,
	workingLineClaimed,
	workingLineInputFor,
} = await import(
	`data:text/javascript;base64,${Buffer.from(workingLineBundle.outputFiles[0].text).toString("base64")}`
);

test("frame-only stopped outcomes retire only the send they follow", () => {
	// The real refusal frame may contain no completion_attention transcript
	// entry at all. The pane synthesizes its visible incident from this record;
	// a fixture containing only a raw notice cannot cover that production path.
	for (const kind of ["error", "interrupted"]) {
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
 * exactly two outcomes - "Stopped with an error" and "Interrupted" - and never
 * for its own renderer notes. The `complete` field is the marker; the text is
 * copied from `transcript-reducer.ts` only so a reader can see what it is.
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

/* ------------------------------------------- which send is "admitted" */

/*
 * The one rule that decides whether the rung appears at all (`chat-page.tsx`).
 *
 * It is a derivation over the store's draft row, so it is asserted here the way
 * `draftIdentityFor` and `panelIdentityFor` are: swapping it for the composer's
 * local `admitting` state, or dropping the `sessionId` conjunct, restores the
 * operator's dead-air report while every other test stays green. The row's own
 * lifetime is pinned against the real store in `canonical-chat.test.mjs`.
 */
test("a send is admitted only when the request was actually issued", () => {
	const row = {
		pending: true,
		admissionAttempted: true,
		admissionRequestId: ECHO,
	};
	assert.deepEqual(admittedSendFor("111111111111", row), { requestId: ECHO });

	// Before admission there is nothing to wait on: the composer still holds
	// the user's text, and the store has not issued a request it cannot take
	// back. On that hop the pane is legitimately empty.
	assert.equal(
		admittedSendFor("111111111111", { ...row, admissionAttempted: false }),
		null,
	);
	// A settled or failed send: the request is no longer in flight.
	assert.equal(
		admittedSendFor("111111111111", { ...row, pending: false }),
		null,
	);
	// No session yet: the New-chat hop, where the create has not returned and
	// the owner has no conversation to answer on.
	assert.equal(admittedSendFor(undefined, row), null);
	// A row with no identity cannot anchor a clear, so it cannot carry a rung.
	assert.equal(
		admittedSendFor("111111111111", { ...row, admissionRequestId: undefined }),
		null,
	);
	assert.equal(admittedSendFor("111111111111", undefined), null);
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
