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
				shouldRequestPage,
			} from "./src/renderer/src/features/chat/canonical/mentioned-files-scan";
			export { buildFileTiles, parentDirectory } from "./src/renderer/src/features/chat/components/canvas/file-tiles";
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
	shouldRequestPage,
	buildFileTiles,
	parentDirectory,
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
		paths([assistant(1, "See [the spec](/Users/damian/w/spec.md) for details.")]),
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
		paths([tool("a", { command: "ls" }, "wrote /Users/damian/Documents/report.pdf (12 KB)")]),
		["/Users/damian/Documents/report.pdf"],
	);
});

test("7. a diff body yields only the absolute paths in it", () => {
	// The documented diff format strips the nameless pair, so `--- a/x` and
	// `+++ b/x` are relative and are not mentions; the structured `args.path` is
	// what names the file the call touched.
	const records = [
		tool(
			"a",
			{ path: "/Users/damian/local-operator/README.md" },
			null,
			["--- a/README.md", "+++ b/README.md", "@@ -1 +1 @@", "+See /Users/damian/docs/notes.md"],
		),
	];
	assert.deepEqual(paths(records), [
		"/Users/damian/local-operator/README.md",
		"/Users/damian/docs/notes.md",
	]);
});

test("8. sentence-final punctuation is trimmed before the extension test", () => {
	assert.deepEqual(paths([assistant(1, "saved to /tmp/a.pdf.")]), ["/tmp/a.pdf"]);
	assert.deepEqual(paths([assistant(1, "saved to /tmp/a.pdf, and then")]), [
		"/tmp/a.pdf",
	]);
});

test("9. a tab-separated or line-adjacent path is still found", () => {
	assert.deepEqual(paths([assistant(1, "/tmp/one.md\t/tmp/two.md")]), [
		"/tmp/one.md",
		"/tmp/two.md",
	]);
	assert.deepEqual(paths([assistant(1, "wrote:\n/Users/x/three.png\nnext line")]), [
		"/Users/x/three.png",
	]);
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
	assert.deepEqual(paths([assistant(1, "on /2026/09/13 we ran /usr/bin/python3")]), []);
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
		paths([assistant(1, "written to file:///Users/damian/out/report.pdf and done")]),
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
	// and a heredoc's `<name` were full tiles with a `Not found` receipt under
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
		paths([assistant(1, "see [the shot](file:///Users/x/Downloads/screen(1).png)")]),
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
	assert.deepEqual(
		paths([assistant(1, "file:///Users/x/a.md\n\n/tmp/b.md")]),
		["/Users/x/a.md", "/tmp/b.md"],
	);
});

test("a semantic label is not a path key", () => {
	// The harness's own `send` tool: `target` is a peer PID or another session's
	// conversation name. With a cwd present both used to be admitted, resolved
	// against the session and probed into `Not found` tiles.
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
	assert.deepEqual(paths([record]), [], "and the cwd-less answer is still stable");
});

test("17. order is first mention, and a re-scan never re-sorts", () => {
	const records = [assistant(1, "wrote /tmp/b.md"), assistant(2, "wrote /tmp/a.md")];
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
		assistant(1, Array.from({ length: 300 }, (_, i) => `/tmp/f${i}.md`).join(" ")),
	];
	const found = extractMentionedPaths(records);
	assert.equal(found.length, 300, "every mention is reported, not the first 200");
	assert.equal(found[299].path, "/tmp/f299.md", "the tail is present, in order");

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
	assert.equal(tiles[0].parent, "/Users/dana/work/reports");
	assert.equal(tiles[1].parent, "/Users/dana/work/archive");
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
