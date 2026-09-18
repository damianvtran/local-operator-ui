import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Coverage for the Files panel's PRODUCER — the extractor that turns a
 * transcript into the list of paths the panel shows, plus the grid's view model.
 *
 * Why this file exists, in the shape of the incident that would need it. The
 * panel's content is inferred from prose, tool arguments, tool output and diff
 * bodies, because the canonical wire carries no file list. Every inference rule
 * is therefore a claim about text, and the failure modes are asymmetric: a
 * missed mention is a file the agent touched that the panel does not show (the
 * bug this change fixes), while a false positive is a tile for a file that does
 * not exist (the bug this change could introduce). The negatives below are
 * therefore not padding — each one is a real string that appears in real
 * transcripts on this machine, and each one is asserted by name so a future
 * loosening of the rules fails here rather than in the operator's panel.
 *
 * REAL: the shipped `mentioned-files.ts`, `file-tiles.ts` and their dependency
 * chain, bundled from source by esbuild. The rules under test are the ones the
 * app runs.
 *
 * REAL TOO: the false-positive family. `0.5.1`, `v1.2.3`, `node_modules/…`,
 * `https://…`, `/v1/static/images?path=…`, `/usr/bin/python3` and the
 * truncated `file:///Users/x/My Docs/a.pdf` are transcribed from the
 * reconnaissance that produced the design, not invented for the test.
 */

const bundle = await build({
	stdin: {
		contents: `
			export {
				extractMentionedPaths,
				extractFromArgs,
				normalizeCandidate,
				KNOWN_EXTENSIONS,
			} from "./src/renderer/src/features/chat/canonical/mentioned-files";
			export {
				SCAN_PAGE_BUDGET,
				mentionScanState,
				newScanBook,
				restartScan,
				scanLane,
				shouldRequestPage,
			} from "./src/renderer/src/features/chat/canonical/mentioned-files-scan";
			export { buildFileTiles, displayParent, parentDirectory } from "./src/renderer/src/features/chat/components/canvas/file-tiles";
			export { viewerFor, READ_ENCODING } from "./src/renderer/src/features/chat/utils/viewer-routing";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@features": "./src/renderer/src/features",
		"@shared": "./src/renderer/src/shared",
	},
	write: false,
});
const {
	extractMentionedPaths,
	extractFromArgs,
	normalizeCandidate,
	KNOWN_EXTENSIONS,
	SCAN_PAGE_BUDGET,
	mentionScanState,
	newScanBook,
	restartScan,
	scanLane,
	shouldRequestPage,
	buildFileTiles,
	displayParent,
	parentDirectory,
	viewerFor,
	READ_ENCODING,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

// ---------------------------------------------------------------- fixtures

/** An assistant record, the shape the reducer emits. */
const assistant = (id, text) => ({
	kind: "assistant",
	id,
	ts: Number(id) || 0,
	text,
	streaming: false,
	stopReason: null,
	error: false,
});

const user = (id, text) => ({ kind: "user", id, ts: 0, text, images: [] });

const tool = (id, args, output = null, diff = null) => ({
	kind: "tool",
	id: `tool:${id}`,
	ts: 0,
	toolCallId: id,
	toolName: "bash",
	intent: null,
	args,
	phase: "done",
	argumentBytes: 0,
	output,
	isError: false,
	durationS: null,
	startedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff,
	stopped: false,
});

const paths = (records, cwd) =>
	extractMentionedPaths(records, cwd).map((mention) => mention.path);

const sources = (records, cwd) =>
	Object.fromEntries(
		extractMentionedPaths(records, cwd).map((m) => [m.path, m.source]),
	);

// --------------------------------------------------------------- positives

test("1. a file:// URL in assistant prose becomes the path it names", () => {
	assert.deepEqual(
		paths([assistant(1, "Written to file:///Users/damian/Documents/x.pdf.")]),
		["/Users/damian/Documents/x.pdf"],
	);
});

test("2. a markdown link keeps the path and loses the brackets", () => {
	assert.deepEqual(
		paths([
			assistant(1, "See [the spec](/Users/damian/w/spec.md) for details."),
		]),
		["/Users/damian/w/spec.md"],
	);
});

test("3. a ~ path is kept verbatim: expansion belongs to main", () => {
	const [mention] = extractMentionedPaths([
		assistant(1, "Plan saved to ~/notes/plan.md"),
	]);
	assert.equal(mention.path, "~/notes/plan.md");
});

test("4. a path key in tool args is admitted as tool-arg", () => {
	const records = [tool("a", { path: "/tmp/out/chart.png" })];
	assert.deepEqual(paths(records), ["/tmp/out/chart.png"]);
	assert.equal(sources(records)["/tmp/out/chart.png"], "tool-arg");
});

test("5. a relative path key is recorded as the relative candidate it is", () => {
	// The extractor must NOT invent an absolute path: resolution is
	// `resolveUserPath` in main, which is the only place that knows the home
	// directory. What the cwd buys is admission, not rewriting.
	const records = [tool("a", { file_path: "src/app.ts" })];
	assert.deepEqual(paths(records, "/Users/damian/proj"), ["src/app.ts"]);
	assert.deepEqual(
		paths(records),
		[],
		"with no cwd a relative candidate is unresolvable and is not admitted",
	);
});

test("6. a path in tool output is found", () => {
	assert.deepEqual(
		paths([
			tool(
				"a",
				{ command: "ls" },
				"wrote /Users/damian/Documents/report.pdf (12 KB)",
			),
		]),
		["/Users/damian/Documents/report.pdf"],
	);
});

test("7. a diff body yields only the absolute paths in it", () => {
	// The documented diff format strips the nameless pair, so `--- a/x` and
	// `+++ b/x` are relative and are not mentions; the structured `args.path` is
	// what names the file the call touched.
	const records = [
		tool("a", { path: "/Users/damian/local-operator/README.md" }, null, [
			"--- a/README.md",
			"+++ b/README.md",
			"@@ -1 +1 @@",
			"+See /Users/damian/docs/notes.md",
		]),
	];
	assert.deepEqual(paths(records), [
		"/Users/damian/local-operator/README.md",
		"/Users/damian/docs/notes.md",
	]);
});

test("8. sentence-final punctuation is trimmed before the extension test", () => {
	assert.deepEqual(paths([assistant(1, "saved to /tmp/a.pdf.")]), [
		"/tmp/a.pdf",
	]);
	assert.deepEqual(paths([assistant(1, "saved to /tmp/a.pdf, and then")]), [
		"/tmp/a.pdf",
	]);
});

test("9. a tab-separated or line-adjacent path is still found", () => {
	assert.deepEqual(paths([assistant(1, "/tmp/one.md\t/tmp/two.md")]), [
		"/tmp/one.md",
		"/tmp/two.md",
	]);
	assert.deepEqual(
		paths([assistant(1, "wrote:\n/Users/x/three.png\nnext line")]),
		["/Users/x/three.png"],
	);
});

test("a shell redirect in a non-path argument is a real mention", () => {
	// A `bash` call's own command text names files, and its key is `command`,
	// not `path`. This is the second structured source, and it is the reason a
	// `convert in.png > /tmp/out.png` shows up in the panel.
	assert.deepEqual(
		paths([tool("a", { command: "convert in.png > /tmp/out.png" })]),
		["/tmp/out.png"],
	);
});

test("an array under a path key contributes every member", () => {
	assert.deepEqual(paths([tool("a", { files: ["/tmp/a.md", "/tmp/b.md"] })]), [
		"/tmp/a.md",
		"/tmp/b.md",
	]);
});

// --------------------------------------------------------------- negatives

test("10. version strings are not paths", () => {
	assert.deepEqual(paths([assistant(1, "bumped to 0.5.1 and v1.2.3")]), []);
});

test("11. relative paths in prose are not mentions", () => {
	assert.deepEqual(
		paths([assistant(1, "edited src/foo.py and node_modules/react/index.js")]),
		[],
	);
});

test("12. an http URL is stripped, not scanned", () => {
	assert.deepEqual(
		paths([assistant(1, "see https://example.com/a/b.png for the diagram")]),
		[],
	);
});

test("13. an API path is not a file", () => {
	assert.deepEqual(
		paths([assistant(1, "the image is at /v1/static/images?path=/a.png")]),
		[],
	);
});

test("14. a path with no known extension is not a mention", () => {
	assert.deepEqual(
		paths([assistant(1, "on /2026/09/13 we ran /usr/bin/python3")]),
		[],
	);
});

test("15. the space-truncated file:// URL is rejected, not guessed", () => {
	// The documented cost of not having a quoting grammar. The scanner sees
	// `file:///Users/x/My` and stops; recovering the real path would mean
	// splitting on whitespace and guessing where the path ends. `/Users/x/My`
	// is a file that does not exist, so it is dropped instead of being shown.
	const found = extractMentionedPaths([
		assistant(1, "opened file:///Users/x/My Docs/a.pdf for review"),
	]);
	assert.deepEqual(found, []);
	assert.equal(
		found.some((mention) => mention.path === "/Users/x/My"),
		false,
		"the truncated token is never what gets recorded",
	);
	// The same rejection for the quoted spelling: the match is truncated by the
	// space before the scanner reaches the quote.
	assert.deepEqual(
		paths([assistant(1, "opened `file:///Users/x/My Docs/a.pdf`")]),
		[],
	);
});

test("15b. a file:// URL followed by ordinary prose is still admitted", () => {
	// The truncation guard must not reject a URL that merely ends a sentence.
	assert.deepEqual(
		paths([
			assistant(1, "written to file:///Users/damian/out/report.pdf and done"),
		]),
		["/Users/damian/out/report.pdf"],
	);
});

test("15c. an editor line reference is a path, not a filename with :59 on it", () => {
	// Real-payload finding (risk 2). The file-url tier admits on the URL alone, so
	// a `:59` from an editor reference rode along as part of the path and the
	// panel offered a file that does not exist. Prose never had the bug: `mjs:59`
	// is not a known extension and is rejected there.
	assert.deepEqual(
		paths([assistant(1, "see file:///Users/damian/scripts/run.mjs:59")]),
		["/Users/damian/scripts/run.mjs"],
	);
	assert.deepEqual(
		paths([assistant(1, "see file:///Users/damian/scripts/run.mjs:59:12")]),
		["/Users/damian/scripts/run.mjs"],
	);
});

test("normalizeCandidate rejects the whole documented family", () => {
	assert.equal(normalizeCandidate("https://example.com/a.png"), null);
	assert.equal(normalizeCandidate("//host/share/a.png"), null);
	assert.equal(normalizeCandidate("/v1/static/images"), null);
	assert.equal(normalizeCandidate("src/app.ts"), null);
	assert.equal(normalizeCandidate("/Users/x/My Docs/a.pdf"), null);
	assert.equal(normalizeCandidate("x".repeat(5000)), null);
	assert.equal(normalizeCandidate("/Users/x/a.png"), "/Users/x/a.png");
});

test("a shell metacharacter is a placeholder, not a path", () => {
	// Found on screen during the QA walk: `qa-res-$PID.pdf`, `prod-res-$PID.pdf`
	// and a heredoc's `<name` were full tiles with a missing-file receipt under
	// them, and in that session a third of the grid was dead tiles.
	assert.deepEqual(paths([assistant(1, "wrote /tmp/qa-res-$PID.pdf")]), []);
	assert.deepEqual(paths([assistant(1, "wrote /tmp/prod-res-$PID.pdf")]), []);
	assert.deepEqual(paths([assistant(1, "wrote /tmp/a{b,c}.ts")]), []);
	assert.deepEqual(paths([assistant(1, "wrote /tmp/out/*.log")]), []);
	assert.deepEqual(
		paths([assistant(1, "opened file:///tmp/agent-out/<name>.")]),
		[],
		"the placeholder must not be cut short into a tile for its directory",
	);
	assert.equal(normalizeCandidate("/tmp/a$b.md"), null);
});

test("a file:// URL whose name contains a bracket is recorded whole", () => {
	// macOS names screenshots `Screenshot 2024-01-01 at 10.00.00 (1).png`, and the
	// scanner's character class had to stop at `(` to avoid swallowing a markdown
	// link's closing bracket — so the path was recorded truncated. Parsing the URL
	// separates the two questions.
	assert.deepEqual(
		paths([assistant(1, "saved file:///Users/x/Downloads/screen(1).png")]),
		["/Users/x/Downloads/screen(1).png"],
	);
	// The bracket a SENTENCE closes with is still trimmed.
	assert.deepEqual(
		paths([
			assistant(1, "see [the shot](file:///Users/x/Downloads/screen(1).png)"),
		]),
		["/Users/x/Downloads/screen(1).png"],
	);
	// And a percent-encoded spelling names the file on disk.
	assert.deepEqual(
		paths([assistant(1, "open file:///Users/x/My%20Docs/a.pdf")]),
		["/Users/x/My Docs/a.pdf"],
	);
	// A non-local host is not a path on this machine.
	assert.deepEqual(
		paths([assistant(1, "share is file://other-host/share/a.pdf")]),
		[],
	);
});

test("a plain path list keeps its file:// entry (the next line is not a continuation)", () => {
	// The truncation guard could not tell "the same line continues" from "the
	// next line starts", so a reply naming a file ONLY as a `file://` link on a
	// line followed by another path lost it silently.
	assert.deepEqual(
		paths([
			assistant(
				1,
				"file:///Users/damian/local-operator-ui/AGENTS.md\n~/local-operator-ui/AGENTS.md",
			),
		]),
		[
			"/Users/damian/local-operator-ui/AGENTS.md",
			"~/local-operator-ui/AGENTS.md",
		],
	);
	// A blank line between them is still a new line.
	assert.deepEqual(paths([assistant(1, "file:///Users/x/a.md\n\n/tmp/b.md")]), [
		"/Users/x/a.md",
		"/tmp/b.md",
	]);
});

test("a metacharacter inside a file:// URL is rejected in that tier too", () => {
	// QA round 2, Q2-1. The metacharacter rule had a hole exactly where the
	// scanner's own character class truncates: `a*.log` stops the match at the
	// `*`, and the fragment `/tmp/agent-out/a` carries no metacharacter for the
	// rule to reject — so a path no file has reached the panel as a tile whose
	// only possible reading is the not-found receipt.
	assert.deepEqual(
		paths([assistant(1, "wrote file:///tmp/agent-out/a*.log")]),
		[],
		"the glob must not become the truncated path in front of it",
	);
	assert.deepEqual(
		paths([assistant(1, "wrote file:///tmp/agent-out/run?.log")]),
		[],
		"`?` starts a query for `new URL`, so the parsed pathname has lost the glob",
	);
	assert.deepEqual(paths([assistant(1, "wrote file:///tmp/out/{a,b}.ts")]), []);
	// Markup a URL legitimately sits inside is not a truncated path: nothing
	// path-like follows the marker, so the URL keeps its tile.
	assert.deepEqual(
		paths([assistant(1, "see **file:///Users/damian/out/report.pdf** for it")]),
		["/Users/damian/out/report.pdf"],
	);
	// The tiers agree. Prose never admitted a glob - its extension test rejects
	// the fragment - and the tool-arg tier rejects the metacharacter outright.
	assert.deepEqual(paths([assistant(1, "wrote /tmp/a*.md")]), []);
	assert.deepEqual(paths([tool(1, { path: "/tmp/a*.md" })]), []);
});

test("a semantic label is not a path key", () => {
	// The harness's own `send` tool: `target` is a peer PID or another session's
	// conversation name. With a cwd present both used to be admitted, resolved
	// against the session and probed into missing-file tiles.
	const cwd = "/Users/damian/proj";
	for (const key of ["target", "source", "dest", "destination"])
		assert.deepEqual(
			paths([tool("a", { [key]: "50809" })], cwd),
			[],
			`${key} must not admit a bare token`,
		);
	assert.deepEqual(paths([tool("a", { target: "lop-bridge-wedge" })], cwd), []);
	// The real path keys are unchanged.
	assert.deepEqual(paths([tool("a", { file_path: "src/app.ts" })], cwd), [
		"src/app.ts",
	]);
});

// ------------------------------------------------------------ invariants

test("16. scanning twice is idempotent, and a streamed delta adds no duplicate", () => {
	const first = assistant(1, "wrote /tmp/a.md");
	const records = [first, assistant(2, "and /tmp/b.md")];
	const once = extractMentionedPaths(records);
	const twice = extractMentionedPaths(records);
	assert.deepEqual(twice, once, "same records, same answer");

	// A delta replaces the record OBJECT (the reducer's identity contract) and
	// appends to its text. The path it already named must not appear twice.
	const grown = { ...first, text: "wrote /tmp/a.md and then /tmp/c.md" };
	const after = extractMentionedPaths([grown, records[1]]);
	assert.deepEqual(
		after.map((m) => m.path),
		["/tmp/a.md", "/tmp/c.md", "/tmp/b.md"],
	);
});

test("16b. the memo is per record object and per cwd", () => {
	// The cwd is an input: a record whose `file_path` is relative is admitted
	// only once a cwd arrives, so the cwd-less answer must not be cached as the
	// answer for the cwd-bearing call.
	const record = tool("a", { file_path: "src/app.ts" });
	assert.deepEqual(paths([record]), []);
	assert.deepEqual(paths([record], "/Users/damian/proj"), ["src/app.ts"]);
	assert.deepEqual(
		paths([record]),
		[],
		"and the cwd-less answer is still stable",
	);
});

test("17. order is first mention, and a re-scan never re-sorts", () => {
	const records = [
		assistant(1, "wrote /tmp/b.md"),
		assistant(2, "wrote /tmp/a.md"),
	];
	assert.deepEqual(paths(records), ["/tmp/b.md", "/tmp/a.md"]);

	// An older page arriving at the FRONT of the record list (the reducer's
	// durable-before-live order) leaves the entries already read in their own
	// relative order; nothing is re-sorted by name, extension or tier.
	const withOlder = [assistant(0, "wrote /tmp/z.md"), ...records];
	const after = paths(withOlder);
	assert.deepEqual(after, ["/tmp/z.md", "/tmp/b.md", "/tmp/a.md"]);
	assert.deepEqual(
		after.filter((path) => path !== "/tmp/z.md"),
		["/tmp/b.md", "/tmp/a.md"],
	);
});

test("a square bracket in a file:// name survives, and a sentence's closing one does not", () => {
	// QA round 3, Q3-2. The class stopped at `]` for the same reason it stopped
	// at `(` — a markdown link's closing bracket — so a name was recorded cut at
	// the bracket: the fixture spelling below, and the store's own
	// `…/run-details/[eval1` (node's eval frame) and `/tmp/x/notes[1`, all
	// arriving through the OPPOSITE bracket of the case above. What they produced
	// was `/tmp/x/a[1` — a path no file has, reaching the grid as a permanent
	// `No longer on disk` tile.
	assert.deepEqual(paths([assistant(1, "wrote file:///tmp/x/a[1].pdf")]), [
		"/tmp/x/a[1].pdf",
	]);
	assert.deepEqual(
		paths([assistant(1, "wrote file:///tmp/x/report(1)[2].png")]),
		["/tmp/x/report(1)[2].png"],
		"both bracket pairs name one file",
	);
	// The bracket a SENTENCE closes with is still trimmed, which is what makes
	// admitting them safe — for the square bracket exactly as for the round one.
	assert.deepEqual(
		paths([assistant(1, "see [the doc](file:///tmp/x/a[1].pdf)")]),
		["/tmp/x/a[1].pdf"],
	);
	assert.deepEqual(paths([assistant(1, "in [file:///tmp/x/a.pdf]")]), [
		"/tmp/x/a.pdf",
	]);
	// The prose tier keeps its own rule — it stops at both brackets — and that
	// stays SAFE rather than silently wrong: the truncated token has no known
	// extension, so nothing is admitted at all. The URL tier is the one that
	// cannot fall back on an extension test (a `file://` URL is admitted on the
	// URL alone), which is why the fix belongs there.
	assert.deepEqual(paths([assistant(1, "wrote /tmp/x/a[1].pdf")]), []);
	assert.deepEqual(paths([assistant(1, "wrote /tmp/a[1].md")]), []);
});

test("a `?` in a file:// URL is a query only when it reads as one", () => {
	// Round 4, R4-3 / QA round 3, Q3-1. Round 3 moved the metacharacter rule
	// onto the RAW match, which closed the glob hole and took every legitimate
	// query with it: `?` is the URL's own query delimiter, and the real
	// cache-busted local file below — taken from one of the operator's own
	// transcripts, and a file that exists on disk — resolved to nothing where the
	// round-2 head resolved it correctly. The rule is now the query's SHAPE: a
	// `key=value` parameter list is a query, anything else is the tail of a
	// filename, i.e. this scanner's own truncation.
	assert.deepEqual(
		paths([
			assistant(
				1,
				"the popup it rendered is at file:///tmp/lo-design-r3/popup-render/popup.html?state=pending&pin=86",
			),
		]),
		["/tmp/lo-design-r3/popup-render/popup.html"],
		"the cache-busted file the audit found must keep its path",
	);
	assert.deepEqual(paths([assistant(1, "open file:///tmp/a.html?v=2")]), [
		"/tmp/a.html",
	]);
	assert.deepEqual(paths([assistant(1, "wrote file:///tmp/a.pdf?x=1&y=2")]), [
		"/tmp/a.pdf",
	]);
	// A fragment is not a path either, and may carry a `?` of its own.
	for (const text of [
		"file:///tmp/a.pdf#toolbar=0",
		"file:///tmp/a.pdf?x=1#frag",
		"file:///tmp/a.pdf#x?y",
	])
		assert.deepEqual(
			paths([assistant(1, `wrote ${text}`)]),
			["/tmp/a.pdf"],
			text,
		);
	// The QUERY is not a path and its content is not a reason to reject one.
	assert.deepEqual(paths([assistant(1, "file:///tmp/a.pdf?x=*")]), [
		"/tmp/a.pdf",
	]);
	// The glob case stays rejected: `.log` is a filename tail, not a query.
	assert.deepEqual(
		paths([assistant(1, "wrote file:///tmp/agent-out/run?.log")]),
		[],
		"a `?` the parser would hide must not become `/tmp/agent-out/run`",
	);
	// A `?` with no query behind it is not a query either — the fail-safe
	// direction this module trades in (a missing tile, never a wrong one).
	for (const text of [
		"file:///tmp/a.pdf?",
		"file:///tmp/a.pdf?x",
		"file:///tmp/a.pdf?}",
	])
		assert.deepEqual(paths([assistant(1, `wrote ${text}`)]), [], text);
});

test("a path named in prose and again in a read call keeps its first mention", () => {
	// First mention wins the source label, and the record list's order is what
	// "first" means: the label is evidence about how the file entered the panel,
	// not a ranking to be recomputed as the transcript grows.
	const records = [
		assistant(1, "reading /Users/x/spec.md now"),
		tool("a", { path: "/Users/x/spec.md" }),
	];
	assert.deepEqual(paths(records), ["/Users/x/spec.md"]);
	assert.equal(sources(records)["/Users/x/spec.md"], "prose");

	// The other order gives the stronger tier, because that is the first mention.
	const reversed = [
		tool("a", { path: "/Users/y/spec.md" }),
		assistant(1, "reading /Users/y/spec.md now"),
	];
	assert.equal(sources(reversed)["/Users/y/spec.md"], "tool-arg");
});

test("the extractor has no output cap: a long conversation yields its tail", () => {
	// The 200-path cap used to truncate here, and because records only append and
	// the scan restarts from record 0, the same first 200 came back on every pass —
	// so paths 201+ were unreachable for the life of the conversation, not merely
	// delayed. Measured on this machine: 23 of 1,735 real sessions returned exactly
	// 200 paths, and one lost ~1,700 of them.
	const records = [
		assistant(
			1,
			Array.from({ length: 300 }, (_, i) => `/tmp/f${i}.md`).join(" "),
		),
	];
	const found = extractMentionedPaths(records);
	assert.equal(
		found.length,
		300,
		"every mention is reported, not the first 200",
	);
	assert.equal(
		found[299].path,
		"/tmp/f299.md",
		"the tail is present, in order",
	);

	// The same claim in the shape a real session has: the tail lives in the OLDEST
	// records, which arrive by paging. Nothing about admitting them depends on
	// where in the list they sit.
	const older = [
		assistant(0, "/tmp/only-in-the-oldest-page.pdf"),
		...Array.from({ length: 250 }, (_, i) =>
			assistant(i + 1, `/tmp/middle-${i}.md`),
		),
	];
	assert.ok(
		paths(older).includes("/tmp/only-in-the-oldest-page.pdf"),
		"a path reachable only through older history is reported",
	);
});

test("the scan pauses at its budget and the tail is recoverable", () => {
	// The bound that remains is a SCAN bound, and the panel states it. This is the
	// "first N of M" case asserted rather than described: with a budget of three
	// pages and more available, the scan stops, says so, and the resume action is
	// what reaches the rest.
	const base = {
		active: true,
		scanned: 300,
		hasMore: true,
		inFlight: false,
		budget: 3,
	};
	assert.equal(shouldRequestPage({ ...base, pagesFetched: 0 }), true);
	assert.equal(
		shouldRequestPage({ ...base, pagesFetched: 3 }),
		false,
		"budget spent",
	);
	assert.deepEqual(mentionScanState({ ...base, pagesFetched: 1 }), {
		active: true,
		scanned: 300,
		hasMore: true,
		paging: true,
		stopped: false,
	});
	const stopped = mentionScanState({ ...base, pagesFetched: 3 });
	assert.equal(
		stopped.stopped,
		true,
		"the head can say which messages were searched",
	);
	assert.equal(stopped.paging, false);

	// `resume` raises the budget by one step, and the tail becomes reachable again.
	const resumed = { ...base, budget: 3 + SCAN_PAGE_BUDGET, pagesFetched: 3 };
	assert.equal(shouldRequestPage(resumed), true);
	assert.equal(mentionScanState(resumed).stopped, false);

	// A closed panel asks for nothing, and says nothing.
	const idle = mentionScanState({ ...base, active: false, pagesFetched: 0 });
	assert.deepEqual(idle, {
		active: false,
		scanned: 300,
		hasMore: true,
		paging: false,
		stopped: false,
	});
	assert.equal(
		shouldRequestPage({ ...base, active: false, pagesFetched: 0 }),
		false,
	);

	// A whole transcript is neither paging nor stopped.
	const done = mentionScanState({ ...base, hasMore: false, pagesFetched: 2 });
	assert.equal(done.paging, false);
	assert.equal(done.stopped, false);
});

test("a page that failed is re-requested by the resume action", () => {
	// The dead retry (found in review round 3, raised as a fix here). A stop can
	// be reached with the cursor UNMOVED - a page request that failed, or an empty
	// page at the end of a history that still claims more - and `scanLane` spends
	// the budget for it. The head then offers `Search earlier messages` as the way
	// out, and a `resume` that raised the budget without re-arming the cursor left
	// the lane reading "already asked for this cursor, nothing in flight" and
	// stopping again WITHOUT issuing anything: the only action offered at that
	// stop was a no-op exactly where the user needs it.
	//
	// The whole loop is driven through the shipped rules: `shouldRequestPage` is
	// what the hook passes as `canRequest`, and `newScanBook`/`scanLane`/
	// `restartScan` are the bookkeeping the hook runs.
	const CURSOR = "m100";
	const book = newScanBook();
	const lane = (b) =>
		scanLane(b, {
			canRequest: shouldRequestPage({
				active: true,
				scanned: 2400,
				hasMore: true,
				inFlight: b.inFlight,
				pagesFetched: b.pages,
				budget: b.budget,
			}),
			blocked: false,
			oldestId: CURSOR,
		});

	assert.equal(lane(book), "request", "the scan asks for the oldest cursor");
	assert.equal(
		book.requestedFor,
		CURSOR,
		"the cursor it asked for is recorded",
	);
	assert.equal(book.inFlight, true, "and a request is out");

	// It came back with nothing: the hook clears `inFlight` in its `finally`.
	book.inFlight = false;
	assert.equal(
		lane(book),
		"stop",
		"the cursor did not move, so the scan stops and says which messages it read",
	);
	assert.equal(book.pages, book.budget, "and the budget is what it reports");
	assert.equal(
		shouldRequestPage({
			active: true,
			scanned: 2400,
			hasMore: true,
			inFlight: false,
			pagesFetched: book.pages,
			budget: book.budget,
		}),
		false,
		"the head is stopped, which is what puts the action on screen",
	);

	// The action. This is the assertion the defect failed: a request is ISSUED.
	restartScan(book);
	assert.equal(book.budget, SCAN_PAGE_BUDGET * 2, "the budget is raised");
	assert.equal(book.requestedFor, null, "and the cursor is re-armed");
	assert.equal(
		lane(book),
		"request",
		"the retry asks again for the SAME cursor, which is the page still missing",
	);
	assert.equal(book.requestedFor, CURSOR);

	// Two rules the lane keeps that the hook's own gate already excludes, stated
	// here because they are the LANE's: a request already out for this cursor is
	// left to answer for itself - in the hook `shouldRequestPage` also carries
	// `!inFlight`, so it never reaches this arm, which is the guard for a caller
	// that asks without that gate - and the reader's own older-history page is a
	// wait rather than a spent budget (round 2, R2-5).
	assert.equal(
		lane(book),
		"idle",
		"a request is already out, so nothing is asked",
	);
	assert.equal(
		scanLane(book, { canRequest: true, blocked: false, oldestId: CURSOR }),
		"in-flight",
	);
	assert.equal(
		scanLane(book, { canRequest: true, blocked: true, oldestId: CURSOR }),
		"wait",
		"the reader's own page is a wait, not a spent budget",
	);
});

test("the known-extension set is the one the classifier owns", () => {
	// Asserted through the set itself rather than a copied list, so this test
	// cannot drift from `file-kind.ts`.
	for (const extension of ["pdf", "png", "txt", "md", "xlsx", "mp3", "mp4"])
		assert.ok(KNOWN_EXTENSIONS.has(extension), `${extension} must be known`);
	for (const extension of ["pyc", "so", "1", "3"])
		assert.equal(
			KNOWN_EXTENSIONS.has(extension),
			false,
			`${extension} must not be a known document extension`,
		);
});

test("extractFromArgs labels the source and skips empty values", () => {
	assert.deepEqual(extractFromArgs({ path: "" }), []);
	assert.deepEqual(extractFromArgs(null), []);
	assert.deepEqual(extractFromArgs({ path: null, count: 3 }), []);
	assert.deepEqual(extractFromArgs({ path: "/tmp/a.md" }), [
		{ path: "/tmp/a.md", source: "tool-arg" },
	]);
});

test("a user record's prose is scanned as well as the assistant's", () => {
	assert.deepEqual(paths([user(1, "look at /Users/damian/notes/todo.md")]), [
		"/Users/damian/notes/todo.md",
	]);
});

// -------------------------------------------------------- grid view model

const doc = (path, extra = {}) => ({
	id: path,
	title: path.split("/").pop(),
	path,
	content: "",
	type: "markdown",
	...extra,
});

test("two files with one basename survive as two tiles with a parent line", () => {
	const tiles = buildFileTiles([
		doc("/Users/dana/work/reports/summary.md"),
		doc("/Users/dana/work/archive/summary.md"),
		doc("/Users/dana/work/notes.md"),
	]);
	assert.equal(tiles.length, 3, "nothing is merged away");
	assert.deepEqual(
		tiles.map((tile) => tile.name),
		["summary.md", "summary.md", "notes.md"],
	);
	assert.deepEqual(
		tiles.map((tile) => tile.showParent),
		[true, true, false],
		"only the clashing basenames carry a second line",
	);
	// The line as it is PAINTED, which is the part design round 1 (D1) was about:
	// `/Users/dana/work/reports` and `/Users/dana/work/archive` used to render
	// `/Users/dana/work/rep…` and `/Users/dana/work/arch…` — 17 shared characters
	// kept, the three that differ cut off — so the line could not do the one thing
	// it exists for. Abbreviating the home prefix is what makes both fit.
	assert.equal(tiles[0].parent, "~/work/reports");
	assert.equal(tiles[1].parent, "~/work/archive");
	assert.notEqual(
		tiles[0].parent,
		tiles[1].parent,
		"the collision is resolved",
	);
});

test("displayParent keeps the tail when the path cannot fit", () => {
	// The same rule one level down, where the abbreviation alone is not enough.
	assert.equal(
		displayParent("/Users/dana/work/clients/northwind/reports"),
		"…/northwind/reports",
	);
	assert.equal(displayParent("/Users/dana/notes"), "~/notes");
	assert.equal(displayParent("~/notes"), "~/notes");
	// The account name is NOT dropped: `/Users/dana` and `/Users/sam` are
	// different directories, and nothing after the name can carry that.
	assert.equal(displayParent("/Users/dana"), "/Users/dana");
	assert.equal(displayParent("/tmp"), "/tmp");
	assert.equal(displayParent("C:\\Users\\dana\\notes"), "~\\notes");
	// A budget too small for even the leaf is cut from the LEFT anyway: the tail
	// of a long name is the informative end, and the leading `…` says where the
	// information was dropped.
	const long = displayParent("/a/very-long-directory-name", 8);
	assert.equal(long.length <= 8, true, `\`${long}\` fits the budget`);
	assert.equal(long.startsWith("…"), true);
});

test("a missing document keeps its position and is marked", () => {
	const tiles = buildFileTiles([
		doc("/tmp/a.md"),
		doc("/tmp/gone.md", { availability: "missing" }),
		doc("/tmp/c.md"),
	]);
	assert.deepEqual(
		tiles.map((tile) => tile.missing),
		[false, true, false],
	);
	assert.deepEqual(
		tiles.map((tile) => tile.name),
		["a.md", "gone.md", "c.md"],
	);
});

test("order is append order, never re-sorted", () => {
	const tiles = buildFileTiles([
		doc("/tmp/z.md"),
		doc("/tmp/a.md"),
		doc("/tmp/m.md"),
	]);
	assert.deepEqual(
		tiles.map((tile) => tile.name),
		["z.md", "a.md", "m.md"],
	);
});

test("parentDirectory handles roots, dotfiles and data URIs", () => {
	assert.equal(parentDirectory("/a/b.md"), "/a");
	assert.equal(parentDirectory("~/notes/plan.md"), "~/notes");
	assert.equal(parentDirectory("report.md"), null);
	assert.equal(parentDirectory("data:image/png;base64,AAAA"), null);
});

// ---------------------------------------------------- the scratchpad protocol

/*
 * The backend gives every session a scratch folder addressed as a URL, and every
 * tool result prints the RESOLVED ABSOLUTE PATH beside the URL it was given:
 *
 *   Created <scheme>run/perf.md -> /…/sessions/<id>/scratchpad/run/perf.md (207 chars).
 *
 * So the panel's contract here is two-sided, and the two sides fail in opposite
 * directions. The URL is a SCHEME, not a path: nothing on disk is named
 * `<scheme>run/perf.md`, so admitting one puts a tile in front of the user for a
 * file that cannot open. The resolved path is an ordinary absolute path with a
 * known extension - exactly what the prose tier admits - and dropping it is the
 * missed mention the whole panel exists to prevent.
 *
 * The strings below are transcribed from a real transcript produced by the
 * sibling backend worktree, not invented for the test; see
 * `docs/evidence/scratchpad-files/README.md` for the session they came from.
 */

/**
 * The scheme, spelled ONCE.
 *
 * It was renamed once already (`notes://` → `scratchpad://`, decided in the same
 * round as this change), and this file asserts the scheme's behaviour in a dozen
 * places - so every literal here is built from this constant. A rename is one
 * edit in this file and the same one edit in the guide the backend ships.
 */
const SCRATCHPAD_SCHEME = "scratchpad://";

/** A session directory, in the shape the harness creates (`sessions/<12 hex>`). */
const SESSION_DIR = "/Users/damian/.local-operator/sessions/0f3a91c4b7d2";
const NOTE_DIR = `${SESSION_DIR}/scratchpad/run`;

test("a bare scheme URL is a scheme, not a path, in every argument form", () => {
	// Every spelling the grammar accepts, including the two directory forms
	// (`<scheme>` lists the root, `<scheme>run/` descends) and a query, which the
	// grammar does not define but a URL-shaped string can still carry.
	for (const url of [
		`${SCRATCHPAD_SCHEME}run/perf.md`,
		`${SCRATCHPAD_SCHEME}`,
		`${SCRATCHPAD_SCHEME}.`,
		`${SCRATCHPAD_SCHEME}run/`,
		`${SCRATCHPAD_SCHEME}run/perf.md?x=1`,
	]) {
		assert.deepEqual(
			paths([tool("a", { path: url })]),
			[],
			`${url} names no file on disk`,
		);
		assert.deepEqual(
			paths([tool("a", { file_path: url })]),
			[],
			`${url} is not a file under any path key`,
		);
		// And under a NON-path key, where the prose rules apply: there the match
		// begins at the URL's own `//`, which is a network location rather than an
		// absolute path, and is rejected on that ground instead.
		assert.deepEqual(
			paths([tool("a", { command: `cat ${url}` })]),
			[],
			`${url} in a command string is still not a path`,
		);
	}
});

test("a scratchpad write result yields its resolved path and never the URL beside it", () => {
	const records = [
		tool(
			"a",
			{ path: `${SCRATCHPAD_SCHEME}run/perf.md` },
			`Created ${SCRATCHPAD_SCHEME}run/perf.md -> ${NOTE_DIR}/perf.md (207 chars).`,
		),
	];
	assert.deepEqual(paths(records), [`${NOTE_DIR}/perf.md`]);
	assert.equal(sources(records)[`${NOTE_DIR}/perf.md`], "prose");
});

test("a scratchpad note read back names its resolved path too", () => {
	// The read form is `<url> -> <path>` followed by the numbered body.
	const records = [
		tool(
			"a",
			{ path: `${SCRATCHPAD_SCHEME}run/metrics.csv` },
			`${SCRATCHPAD_SCHEME}run/metrics.csv -> ${NOTE_DIR}/metrics.csv\n1| name,p50_ms,p95_ms\n2| canary,41,118`,
		),
	];
	assert.deepEqual(paths(records), [`${NOTE_DIR}/metrics.csv`]);
});

test("every format the protocol promises becomes exactly one tile", () => {
	/*
	 * The shapes the backend's guide names, plus the script extensions the store
	 * now also holds - a session that writes a helper script through the scheme
	 * gets a tile for it exactly like a note, and the routing test below is what
	 * says which surface opens it.
	 */
	const cases = [
		["md", "perf"],
		["json", "run-config"],
		["csv", "metrics"],
		["tsv", "metrics"],
		["txt", "session-log"],
		["text", "session-log"],
		["yaml", "config"],
		["yml", "config"],
		["log", "rollout"],
		["sh", "rollout"],
		["bash", "rollout"],
		["py", "collect"],
	];
	for (const [ext, name] of cases) {
		const url = `${SCRATCHPAD_SCHEME}run/${name}.${ext}`;
		assert.deepEqual(
			paths([
				tool(
					"a",
					{ path: url },
					`Created ${url} -> ${NOTE_DIR}/${name}.${ext} (12 chars).`,
				),
			]),
			[`${NOTE_DIR}/${name}.${ext}`],
			`${ext} resolves to exactly one tile`,
		);
	}
});

test("a text path outvotes a type that disagrees with it", () => {
	// The branch sits ABOVE the `type` fallback, so these three rows move from
	// answering the document's own type to answering by the path (measured as the
	// only non-text-extension rows a 61-row base/head matrix moves; QA round 1).
	// Reachability through the panel is nil — a `.txt` document's type is derived
	// from the same path — but a shared helper's precedence belongs in the test
	// that pins it rather than only in a comment.
	for (const [path, type] of [
		["/x/weird.txt", "spreadsheet"],
		["/x/weird.txt", "image"],
		["/x/weird.log", "markdown"],
	]) {
		assert.equal(
			viewerFor(path, type),
			"code",
			`${path} as ${type} routes by path`,
		);
	}
});

test("every promised format opens in the viewer a user expects", () => {
	/*
	 * A script is CODE and must never reach the markdown viewer: a `.sh` opened
	 * as prose would render a shebang as a heading, which is the failure this
	 * table exists to catch rather than a routing detail.
	 */
	const expected = {
		md: "markdown",
		json: "code",
		csv: "spreadsheet",
		tsv: "spreadsheet",
		txt: "code",
		text: "code",
		yaml: "code",
		yml: "code",
		log: "code",
		sh: "code",
		bash: "code",
		py: "code",
	};
	for (const [ext, kind] of Object.entries(expected)) {
		const path = `${NOTE_DIR}/note.${ext}`;
		assert.equal(viewerFor(path), kind, `${ext} opens as ${kind}`);
		// The document's own `type` must not outvote the path it came with: a
		// `.txt` note is text whatever a stale classification says.
		assert.equal(
			viewerFor(path, "other"),
			kind,
			`${ext} routes by its path when the type disagrees`,
		);
	}
	// The encoding is half the answer: the grid reads base64, the text viewers
	// decode as UTF-8.
	assert.equal(READ_ENCODING.markdown, "utf-8");
	assert.equal(READ_ENCODING.code, "utf-8");
	assert.equal(READ_ENCODING.spreadsheet, "base64");
});

test("an extensionless note yields no tile, which is why the guide names one", () => {
	// The naming rule the backend's guide teaches, with a test behind it: the
	// prose tier demands a known extension, so `<scheme>run/perf` is listed but
	// never tiled.
	const records = [
		tool(
			"a",
			{ path: `${SCRATCHPAD_SCHEME}run/perf` },
			`Created ${SCRATCHPAD_SCHEME}run/perf -> ${NOTE_DIR}/perf (12 chars).`,
		),
	];
	assert.deepEqual(paths(records), []);
});

test("a scratchpad listing names a directory, not a file", () => {
	// The listing prints the scratchpad root's absolute path and its entries by
	// name - the header's own wording is not what this turns on. Neither the root
	// (a directory, no extension) nor a bare entry name is a mention, which is the
	// deliberate trade recorded in the backend's design: the panel gets its tiles
	// from the notes the agent actually writes.
	const listing = `Scratchpad listing ${SCRATCHPAD_SCHEME} -> ${SESSION_DIR}/scratchpad (2 entries):\nperf.md\nrun`;
	assert.deepEqual(
		paths([tool("a", { path: SCRATCHPAD_SCHEME }, listing)]),
		[],
	);
});

test("a templated or abbreviated path yields no candidate at all", () => {
	/*
	 * Two forms, both MEASURED in a real run (QA round 1, PR #336) against the
	 * guide the feature ships, whose own example lines put a path-shaped
	 * placeholder in the transcript:
	 *
	 *   guide line 58  `scratchpad://logs/run.md -> /…/sessions/<id>/scratchpad/logs/run.md`
	 *   guide line 23  the printed path (`bash /…/scratchpad/probe.sh`, `eval`, `grep`)
	 *
	 * The first is the TAIL of an angle-bracket placeholder - the scanner stops at
	 * `<` and resumes after the `>` - and the second is an ABBREVIATED path whose
	 * ellipsis segment was admitted whole. Both put a tile for a file that does not
	 * exist in front of the user, which is this module's documented worst failure,
	 * and the live panel read `6 files` for a session with four real ones.
	 *
	 * A template reaches a transcript through a tool RESULT as readily as through
	 * a guide paragraph, so all three carriers are asserted: assistant prose, a
	 * tool result, and a tool argument.
	 */
	const templateLine = `in the form\n\`${SCRATCHPAD_SCHEME}logs/run.md -> /…/sessions/<id>/scratchpad/logs/run.md\`. That path`;
	assert.deepEqual(paths([assistant(1, templateLine)]), []);
	const abbreviatedLine =
		"the printed path (`bash /…/scratchpad/probe.sh`, `eval`, `grep`).";
	assert.deepEqual(paths([assistant(1, abbreviatedLine)]), []);
	assert.deepEqual(
		paths([
			tool(
				"a",
				{ path: `${SCRATCHPAD_SCHEME}run/perf.md` },
				`Created ${SCRATCHPAD_SCHEME}run/perf.md -> /…/sessions/<id>/scratchpad/run/perf.md (42 chars).`,
			),
		]),
		[],
	);
	// The same two shapes under a path key, where the structured tier sees them.
	assert.deepEqual(paths([tool("a", { path: "/…/scratchpad/probe.sh" })]), []);
	assert.deepEqual(
		paths([tool("a", { path: "/…/sessions/<id>/scratchpad/logs/run.md" })]),
		[],
	);
	// The ASCII spelling of the same abbreviation.
	assert.deepEqual(
		paths([assistant(1, "run `bash .../scratchpad/probe.sh` and read back")]),
		[],
	);
});

test("the abbreviation trade: a name containing an ellipsis is admitted by no tier", () => {
	/*
	 * The cost of the rule above, stated as a test rather than discovered later.
	 * Rejecting `…` anywhere in a candidate is what makes an abbreviation
	 * impossible to admit whole, and a file whose NAME legitimately contains the
	 * character pays for it — in EVERY tier, because the marker class is applied
	 * wherever a candidate is canonicalised. That is this module's standing trade
	 * (a missing tile, never a tile for a path no file has), and the asymmetry is
	 * deliberate: a character that means "text was removed" is the one thing a
	 * text-inferring scanner cannot tell from a name.
	 */
	assert.deepEqual(paths([assistant(1, "opened /tmp/notes/we…ird.md")]), []);
	assert.deepEqual(
		paths([assistant(1, "opened file:///tmp/notes/we…ird.md")]),
		[],
	);
	assert.deepEqual(paths([tool("a", { path: "/tmp/notes/we…ird.md" })]), []);
});
