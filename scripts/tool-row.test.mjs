import assert from "node:assert/strict";
import { createServer } from "node:http";
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
	diffCount,
	displayName,
	formatDuration,
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
