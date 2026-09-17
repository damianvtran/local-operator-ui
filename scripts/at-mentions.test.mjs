import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's `@` mention layer, asserted against the harness semantics it
 * ports and the behaviour the design direction decided.
 *
 * Three modules, one bundle: `at-token.ts` (a port of `local_operator/sigils.py`
 * and of the scan `references.py:_reference_tokens` performs), `at-rank.ts` (the
 * ordering, which the design states as a contract) and `at-contract.ts` (the key
 * routing, the measured row budget, the copy and the atomic delete). Every one of
 * them HAS a right answer decided somewhere else — in Python, in the design
 * document, or in the design's own numbers — and a test that only checks "the
 * picker looks right" drifts from all three the first time either side is edited.
 *
 * The module under test is the REAL one; nothing is re-implemented here. Bundled
 * rather than imported because these are TypeScript modules in the renderer tree,
 * the pattern `slash-token.test.mjs` established.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * as token from "./src/renderer/src/features/chat/components/at-token";',
			'export * as rank from "./src/renderer/src/features/chat/components/at-rank";',
			'export * as contract from "./src/renderer/src/features/chat/components/at-contract";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { token, rank, contract } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const {
	atToken,
	atTokenSpans,
	atPickerToken,
	atSegments,
	splitToken,
	isBoundary,
	tokenEnd,
	activeAt,
	atReference,
	referenceBlockSpans,
} = token;
const {
	rankAtRows,
	rowsFromListing,
	descendRows,
	atDescendTargets,
	interleaveDescend,
	compareAtRows,
	RECENT_BOOST,
	COMMON_BOOST,
} = rank;
const {
	atKeyIntent,
	atRowBudget,
	atFooter,
	atCount,
	atEmptyCopy,
	atDeleteSpan,
	atSpanKey,
	atRowId,
	atCandidateKey,
	atChipSpans,
	AT_ROW_PITCH,
	AT_UNAVAILABLE_REASON,
} = contract;

/* ---------------------------------------------------------------- grammar -- */

/*
 * `is_boundary` — the ONE rule that makes running this on every keystroke safe.
 * Ported whole, so `src/foo`, `user@host.com` and `a@b` are checked by the same
 * function the harness checks them with.
 */
test("a token opens only at a boundary @", () => {
	assert.equal(isBoundary("@a", 0), true);
	assert.equal(isBoundary("x @a", 2), true);
	assert.equal(isBoundary("x\n@a", 2), true);
	assert.equal(isBoundary("x@a", 1), false);
	assert.equal(isBoundary("a@b", 1), false);
});

test("an email address is never a token", () => {
	for (const caret of [0, 4, 8, 13])
		assert.equal(atToken("user@host.com", caret), null);
});

test("a bare @ opens the list on the working directory", () => {
	assert.deepEqual(atToken("@", 1), { start: 0, query: "", end: 1 });
	// Rather than being special-cased closed: `@` is how you ask what is here.
	assert.deepEqual(atToken("@", 0), { start: 0, query: "", end: 1 });
});

test("an unquoted token spans / and . and stops at whitespace only", () => {
	const text = "look at @src/app.py, then fix";
	// The comma is INSIDE the token, which is why the harness prints a notice
	// naming `@a.py,` rather than expanding `@a.py`: the token is `@src/app.py,`
	// and no such path exists.
	assert.deepEqual(atToken(text, 18), {
		start: 8,
		query: "src/app.py,",
		end: 20,
	});
	assert.deepEqual(atTokenSpans(text), [
		{ start: 8, end: 20, typed: "@src/app.py,", path: "src/app.py," },
	]);
});

test("the caret must be inside the token: a space closes it", () => {
	const text = "@a.py now";
	assert.deepEqual(atToken(text, 5), { start: 0, query: "a.py", end: 5 });
	// One cell past the token's end is the terminating space's own cell, and the
	// user has moved on: `column > end` is the harness's own test.
	assert.equal(atToken(text, 6), null);
	assert.equal(atToken(text, 9), null);
});

test("the quoted form is the only way to name a file with a space", () => {
	assert.deepEqual(atToken('@"my file.txt"', 14), {
		start: 0,
		query: "my file.txt",
		end: 14,
	});
	assert.deepEqual(atTokenSpans('see @"my file.txt" too'), [
		{ start: 4, end: 18, typed: '@"my file.txt"', path: "my file.txt" },
	]);
});

test("an unterminated quote degrades to the whitespace rule", () => {
	// Ported exactly, `"` included in the query: the harness's `_token_end` falls
	// through to the whitespace loop and returns `line[at + 1 : end]`. A query
	// carrying a quote names no path, so the token is prose — which is the honest
	// outcome for a half-typed `@"` rather than swallowing the line.
	assert.deepEqual(tokenEnd('@"my file', 0), { end: 4, query: '"my' });
});

test("the token the caret is on is the last boundary @ at or before it", () => {
	// The caret past the buffer is clamped to its end (the harness's own rule), so
	// the token is the one under it: `@sr`, running to the buffer's last cell.
	assert.deepEqual(atToken("@a @sr", 7), { start: 3, query: "sr", end: 6 });
	assert.equal(activeAt("@a @sr", 7), 3);
});

test("a token never spans a newline", () => {
	const text = "@a.py\nnext";
	assert.deepEqual(atToken(text, 5), { start: 0, query: "a.py", end: 5 });
	assert.equal(atToken(text, 8), null);
});

test("@a@b is ONE unresolvable span, not two chips", () => {
	const spans = atTokenSpans("fix @a@b now");
	assert.equal(spans.length, 1);
	assert.deepEqual(spans[0], {
		start: 4,
		end: 8,
		typed: "@a@b",
		path: "a@b",
	});
});

test("a bare @ is not a candidate reference", () => {
	assert.deepEqual(atTokenSpans("ask @ then wait"), []);
	assert.equal(atTokenSpans("ask @").length, 0);
});

/*
 * THE PASTED BLOCK, ported because a chip over one asserts an expansion the
 * resolver will not perform (review round 1, M4).
 *
 * `references._block_spans` and `references._already_expanded`, both executed
 * against the branch that adds them. The second half is the one a plain span skip
 * cannot reach: the harness's own `typed="…"` recovery exists because the user's
 * token SURVIVES in the prose beside the block, so a re-scan would find it and
 * expand it a second time.
 */
test("a token inside a pasted block marker is not a candidate chip", () => {
	const text =
		"<operator-references>\n@src/app.py\n</operator-references>\nand @src/app.py again";
	const blocks = referenceBlockSpans(text);
	assert.equal(blocks.length, 1);
	assert.deepEqual(blocks[0], [
		0,
		text.indexOf("</operator-references>") + "</operator-references>".length,
	]);
	const spans = atTokenSpans(text);
	// The one in the prose expands and is a chip; the one inside the block does not.
	assert.equal(spans.length, 1);
	assert.equal(spans[0].path, "src/app.py");
	assert.equal(spans[0].start, text.lastIndexOf("@src/app.py"));
	// An UNCLOSED marker runs to the end, the harness's own fail-closed reading.
	assert.deepEqual(referenceBlockSpans("a <operator-references> b"), [
		[2, "a <operator-references> b".length],
	]);
});

test("a token a block's typed= attribute already names is not a candidate", () => {
	const text =
		'<operator-references>\n<file path="src/app.py" typed="@src/app.py">x</file>\n</operator-references>\n' +
		"and @src/app.py again";
	const spans = atTokenSpans(text);
	// The prose token is named by the block, so the resolver skips it as already
	// expanded — and a chip on it would say otherwise.
	assert.deepEqual(spans, []);
	// A token the block does NOT name still expands.
	const other =
		'<operator-references>\n<file path="a" typed="@a">x</file>\n</operator-references>\nsee @b';
	assert.deepEqual(
		atTokenSpans(other).map((span) => span.path),
		["b"],
	);
	// The attribute decoder runs `&amp;` last, so a literal `&amp;lt;` cannot come
	// back as `<`.
	const escaped =
		'<operator-references>\n<file path="a" typed="@a&amp;lt;b">x</file>\n</operator-references>\nsee @a&lt;b';
	assert.deepEqual(atTokenSpans(escaped), []);
});

test("the picker's own token honours the same two exclusions", () => {
	const blocked = "<operator-references>\n@src/app.py\n</operator-references>";
	assert.equal(atToken(blocked, blocked.length), null, "no token at all here");
	// The caret is inside the block, at the end of the token: `atToken` finds it,
	// `atPickerToken` refuses it, which is what keeps a list from opening over a
	// span whose token will be sent as prose.
	const caret = blocked.indexOf("@src/app.py") + "@src/app.py".length;
	assert.ok(atToken(blocked, caret));
	assert.equal(atPickerToken(blocked, caret), null);
	// Outside the block the same draft offers its token as usual.
	const open = "see @src/app.py now";
	assert.deepEqual(atPickerToken(open, 14), atToken(open, 14));
});

test("splitToken cuts at the last slash, exactly as the harness does", () => {
	assert.deepEqual(splitToken(""), ["", ""]);
	assert.deepEqual(splitToken("sr"), ["", "sr"]);
	assert.deepEqual(splitToken("src/"), ["src/", ""]);
	assert.deepEqual(splitToken("src/ap"), ["src/", "ap"]);
	assert.deepEqual(splitToken("../sibling/x"), ["../sibling/", "x"]);
});

test("atSegments splits the draft against the spans it will measure", () => {
	const text = "look at @a.py and @b.py";
	const spans = atTokenSpans(text);
	const segments = atSegments(text, spans);
	assert.equal(segments.map((segment) => segment.text).join(""), text);
	assert.deepEqual(
		segments.filter((segment) => segment.span).map((segment) => segment.text),
		["@a.py", "@b.py"],
	);
	assert.deepEqual(
		segments.map((segment) => (segment.span ? atSpanKey(segment.span) : null)),
		[null, "8:13", null, "18:23"],
	);
});

/* --------------------------------------------------------- what a pick writes */

test("atReference keeps the directory, quotes a space, and closes a file", () => {
	assert.equal(
		atReference({ path: "src/components/button.tsx", directory: false }),
		"@src/components/button.tsx ",
	);
	// A directory keeps its trailing slash so the token stays OPEN and the list
	// drills in: `split_token("src/components/")` is that directory with an empty
	// name query, which is the next listing rather than the end of the gesture.
	assert.equal(
		atReference({ path: "src/components", directory: true }),
		"@src/components/",
	);
	assert.equal(
		atReference({ path: "my file.txt", directory: false }),
		'@"my file.txt" ',
	);
	// The quotes go around the WHOLE path, the trailing slash included — which is
	// what the harness's own picker writes (`f'"{path}"'`, and its directory rows
	// already carry the slash), so the two round-trip as one token.
	assert.equal(atReference({ path: "my dir", directory: true }), '@"my dir/"');
});

/* ----------------------------------------------------------------- ranking -- */

const row = (path, directory = false) => {
	const name = path.split("/").pop() ?? path;
	const cut = path.lastIndexOf("/");
	return {
		path,
		name,
		parent: cut === -1 ? "./" : path.slice(0, cut + 1),
		directory,
	};
};

const LISTING = [
	row("src/app.py"),
	row("src/components", true),
	row("README.md"),
	row("package.json"),
	row("zzz.md"),
	row("app.tsx"),
];

test("a bare @ lists the whole directory", () => {
	const ranked = rankAtRows(LISTING, "");
	assert.equal(ranked.length, LISTING.length);
});

test("at equal score a directory comes before a file", () => {
	// No boost applies to either, which is the condition the chain states: the
	// common pool is free to lift a pooled FILE above an unpooled directory, and
	// that is a decision rather than an accident of this comparison.
	const ranked = rankAtRows([row("app.py"), row("src", true)], "");
	assert.equal(ranked[0].path, "src");
});

test("exact beats prefix beats fuzzy", () => {
	const ranked = rankAtRows(
		[row("app.py"), row("app"), row("appendix.py")],
		"app",
	);
	assert.deepEqual(
		ranked.map((entry) => entry.name),
		["app", "app.py", "appendix.py"],
	);
});

test("fuzzy is a subsequence, not a prefix", () => {
	// The whole reason the matcher is not `startsWith`: a user who learned the
	// TUI's habit types an abbreviation.
	assert.deepEqual(
		rankAtRows([row("src/button.tsx"), row("other.txt")], "btt").map(
			(entry) => entry.name,
		),
		["button.tsx"],
	);
	// A one-letter query is a subsequence of far too much to be useful, and the
	// slash matcher's `FUZZY_MIN_QUERY_CHARS` is not applied here on purpose: a
	// FILE list has no command to mis-rank, and the short query is the common case
	// for a path ("@ma" for "main.py"). What keeps it usable is the ordering, not a
	// floor: the shortest matching name wins the tail.
	assert.deepEqual(
		rankAtRows([row("markdown.md"), row("main.py")], "ma").map(
			(entry) => entry.name,
		),
		["main.py", "markdown.md"],
	);
});

test("a recent outranks an equal-scoring neighbour but never a better band", () => {
	const rows = [row("aaa.md"), row("zzz.md")];
	const ranked = rankAtRows(rows, "", new Set(["zzz.md"]));
	assert.equal(ranked[0].path, "zzz.md");
	// A recent can NOT lift a fuzzy candidate past a prefix match.
	const withPrefix = rankAtRows(
		[row("reads.md"), row("zreads.md")],
		"reads",
		new Set(["zreads.md"]),
	);
	assert.equal(withPrefix[0].path, "reads.md");
	assert.ok(RECENT_BOOST < 900);
});

test("the common pool nudges an entry, and adds no row of its own", () => {
	const ranked = rankAtRows([row("aaa.md"), row("README.md")], "");
	// Without the boost the shorter name wins the alphabetical tail; the pool
	// entry outranks it, and an entry the directory does NOT have is never added.
	assert.equal(ranked[0].name, "README.md");
	assert.equal(ranked.length, 2);
	assert.ok(COMMON_BOOST < RECENT_BOOST);
});

test("the ordering is total, so a listing's own order cannot leak through", () => {
	const forwards = rankAtRows(LISTING, "");
	const backwards = rankAtRows([...LISTING].reverse(), "");
	assert.deepEqual(
		forwards.map((entry) => entry.path),
		backwards.map((entry) => entry.path),
	);
	// And two rows with the same name in different directories still compare.
	assert.notEqual(
		compareAtRows(
			{ row: row("a/x.md"), score: 0 },
			{ row: row("b/x.md"), score: 0 },
		),
		0,
	);
});

test("rowsFromListing keeps the directory part and states where a row lives", () => {
	const entries = [
		{ name: "app.py", directory: false },
		{ name: "components", directory: true },
	];
	assert.deepEqual(
		rowsFromListing(entries, "").map((entry) => [entry.path, entry.parent]),
		[
			["app.py", "./"],
			["components", "./"],
		],
	);
	assert.deepEqual(
		rowsFromListing(entries, "src/").map((entry) => [entry.path, entry.parent]),
		[
			["src/app.py", "src/"],
			["src/components", "src/"],
		],
	);
});

test("descendRows lists a matched directory's children under its own path", () => {
	const children = descendRows(
		[{ name: "button.tsx", directory: false }],
		"src/components",
	);
	assert.deepEqual(children, [
		{
			path: "src/components/button.tsx",
			name: "button.tsx",
			parent: "src/components/",
			directory: false,
		},
	]);
});

test("descend is bounded to the top two MATCHING directories", () => {
	const rows = [
		row("components", true),
		row("config", true),
		row("cache", true),
		row("app.py"),
	];
	const ranked = rankAtRows(rows, "co");
	const targets = atDescendTargets(ranked, "co");
	assert.equal(targets.length, 2);
	assert.ok(targets.every((target) => target.directory));
	// Nothing matching is nothing to descend into, and a bare `@` is not a query.
	assert.deepEqual(atDescendTargets(ranked, "qq"), []);
	assert.deepEqual(atDescendTargets(ranked, ""), []);
});

test("interleaveDescend puts children after the row that matched", () => {
	const ranked = [row("components", true), row("app.py")];
	const children = new Map([["components", [row("components/button.tsx")]]]);
	assert.deepEqual(
		interleaveDescend(ranked, children).map((entry) => entry.path),
		["components", "components/button.tsx", "app.py"],
	);
});

/* ---------------------------------------------------------------- contract -- */

const KEY = { composing: false, open: true, active: 0, count: 3 };

test("a closed or composing list passes every key", () => {
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Enter", open: false }), {
		kind: "pass",
	});
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Enter", composing: true }), {
		kind: "pass",
	});
});

test("arrows clamp and report whether the marker moved", () => {
	assert.deepEqual(atKeyIntent({ ...KEY, key: "ArrowDown" }), {
		kind: "move",
		index: 1,
		moved: true,
	});
	assert.deepEqual(
		atKeyIntent({ ...KEY, key: "ArrowDown", active: 2, count: 3 }),
		{ kind: "move", index: 2, moved: false },
	);
	assert.deepEqual(atKeyIntent({ ...KEY, key: "ArrowUp", active: 0 }), {
		kind: "move",
		index: 0,
		moved: false,
	});
	assert.deepEqual(atKeyIntent({ ...KEY, key: "ArrowUp", active: 2 }), {
		kind: "move",
		index: 1,
		moved: true,
	});
});

test("Enter and Tab both apply the row, with no ambiguity gate", () => {
	// The divergence from `slashKeyIntent`, stated as the property: writing a path
	// has no blast radius, so there is no second keystroke and nothing to extend.
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Enter" }), {
		kind: "apply",
		index: 0,
	});
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Tab", active: 2 }), {
		kind: "apply",
		index: 2,
	});
});

/*
 * THE EMPTY LIST, which is the one case the two keys do NOT share (UX round 1,
 * U3). Enter is the composer's SUBMIT, so with no row to take it must be held:
 * `pass` handed it to the submit path, and on a failed or non-matching listing —
 * which is every `@` on a brand-new chat's own state — the first `@…`+Enter a user
 * pressed sent their half-written sentence instead of referencing a file. Tab's
 * own meaning is a focus move and claims nothing about a file, so it still passes
 * and the composer's Tab ladder is untouched.
 */
test("Enter is held when the list holds no row, and Tab is not", () => {
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Enter", count: 0 }), {
		kind: "hold",
	});
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Enter", count: 0, active: 0 }), {
		kind: "hold",
	});
	// A marker past the end of the rows is the same state: nothing to apply.
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Enter", count: 2, active: 5 }), {
		kind: "hold",
	});
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Tab", count: 0 }), {
		kind: "pass",
	});
});

test("Escape closes, and everything else is the composer's", () => {
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Escape" }), { kind: "close" });
	assert.deepEqual(atKeyIntent({ ...KEY, key: "a" }), { kind: "pass" });
	assert.deepEqual(atKeyIntent({ ...KEY, key: "Backspace" }), { kind: "pass" });
});

test("the row budget is measured, clamped, and a whole number of rows", () => {
	// A full-height window: the ceiling applies.
	assert.equal(atRowBudget(800, 0), 8);
	// The minimum window, where the column clips the popup: the floor applies and
	// the shell shrinks rather than being pushed off the bottom.
	assert.equal(atRowBudget(100, 0), 3);
	// 143.2px of room is four rows at the MEASURED 35.5px pitch (142px) and only
	// three at the 36px the constant used to claim — which is the finding
	// (QA round 1, Q-1) in one line: the wrong pitch both overflowed the cap on a
	// long listing and under-counted the rows on a short one.
	assert.equal(atRowBudget(200, 0), 4);
	// And a middle case is an exact multiple of the pitch rather than a slice.
	assert.equal(atRowBudget(400, 0), 8);
	assert.equal(atRowBudget(52.8 + 4 + AT_ROW_PITCH * 3 + 1, 0), 3);
	// The pitch itself, so a later edit to it is a decision rather than a typo.
	assert.equal(AT_ROW_PITCH, 35.5);
});

test("the footer reads off the active row", () => {
	// "Enter"/"Esc" name KEYS, and the slash popup in the same slot capitalises
	// them too (design round 1, D5).
	assert.equal(
		atFooter({ path: "src/app.py", directory: false }),
		"Enter inserts @src/app.py · Esc closes",
	);
	assert.equal(
		atFooter({ path: "src/components", directory: true }),
		"Enter opens src/components · Esc closes",
	);
	assert.equal(
		atFooter({ path: "my file.txt", directory: false }),
		'Enter inserts @"my file.txt" · Esc closes',
	);
	// No row to act on: the Escape clause is joined by the statement that there is
	// NOTHING FOR ENTER TO TAKE (UX round 2, U13). It used to read `Esc closes`
	// alone, which answered a press of Enter with no response of any kind — the one
	// gesture a user reaches for after typing a file name — while Enter is held in
	// this state rather than passed to the submit.
	assert.equal(atFooter(undefined), "Nothing to insert · Esc closes");
});

test("the harness's own refusal is one sentence that promises nothing", () => {
	// UX round 2, U12: the state every released install is in said NOTHING, and the
	// sentence has to name the backend as the reason. Two things are asserted about
	// it because two things make it honest: it says what the harness cannot do, and
	// it does not carry the `@` it is refusing (the composer may not teach a gesture
	// its backend cannot serve) or an offer to update (the capability it lacks is one
	// no harness advertises, so that promise has nothing behind it).
	assert.match(AT_UNAVAILABLE_REASON, /^This backend cannot /);
	assert.ok(!AT_UNAVAILABLE_REASON.includes("@"));
	assert.ok(!/update/i.test(AT_UNAVAILABLE_REASON));
});

test("the count appears only when it adds something", () => {
	assert.equal(atCount(4, 37), "4 of 37");
	assert.equal(atCount(37, 37), undefined);
	assert.equal(atCount(0, 0), undefined);
	// THE CASE THE COLUMN WAS BLIND TO (design round 1, D3): a ten-entry listing
	// whose region draws seven rows withheld three of them, and the count said
	// nothing because the two numbers it was handed were both the matched count.
	assert.equal(atCount(7, 10), "7 of 10");
	assert.equal(atCount(0, 10), "0 of 10");
	assert.equal(atCount(3, 11), "3 of 11");
});

test("the four empty facts get four different sentences", () => {
	assert.equal(
		atEmptyCopy({
			loading: false,
			entries: 0,
			matched: 0,
			query: "",
			scope: "./",
		}),
		"This folder is empty.",
	);
	// The SCOPE is named, not just the query: a user who knows the file name and
	// not its directory was told only that nothing matched, while the header above
	// said where the search had looked and said nothing about it (UX round 1, U6).
	assert.equal(
		atEmptyCopy({
			loading: false,
			entries: 12,
			matched: 0,
			query: "zz",
			scope: "./",
		}),
		'No files match "zz" in ./.',
	);
	assert.equal(
		atEmptyCopy({
			loading: false,
			entries: 4,
			matched: 0,
			query: "zz",
			scope: "src/components/",
		}),
		'No files match "zz" in src/components/.',
	);
	assert.equal(
		atEmptyCopy({
			loading: true,
			entries: 0,
			matched: 0,
			query: "",
			scope: "./",
		}),
		"Reading this folder…",
	);
	assert.equal(
		atEmptyCopy({
			loading: false,
			entries: 0,
			matched: 0,
			query: "",
			scope: "./",
			error: "EACCES: permission denied, scandir '/private/tmp/x/secret-dir/'",
		}),
		"Could not read this folder. It may need a permission this app does not have.",
	);
	// A folder that vanished while the picker was open gets the other sentence, and
	// no failure quotes the errno, the syscall or the absolute path at the user
	// (design round 1's D4 and UX round 1's U5 measured that sentence live).
	assert.equal(
		atEmptyCopy({
			loading: false,
			entries: 0,
			matched: 0,
			query: "",
			scope: "./",
			error: "ENOENT: no such file or directory, scandir '~'",
		}),
		"Could not read this folder. Check that it exists and that you can open it.",
	);
	for (const detail of [
		"EACCES: permission denied",
		"ENOENT: no such file or directory",
		"something else entirely",
	])
		assert.doesNotMatch(
			atEmptyCopy({
				loading: false,
				entries: 0,
				matched: 0,
				query: "",
				scope: "./",
				error: detail,
			}),
			/EACCES|ENOENT|scandir|\//,
		);
	// A listing already on screen is not replaced while the next one is in flight.
	assert.equal(
		atEmptyCopy({
			loading: true,
			entries: 3,
			matched: 3,
			query: "",
			scope: "./",
		}),
		"This folder is empty.",
	);
});

test("the atomic delete takes a whole chip at its edge, and nothing else", () => {
	const spans = atTokenSpans("look at @a.py then");
	const resolved = new Map([["8:13", { outside: false }]]);
	assert.deepEqual(atDeleteSpan(13, "back", spans, resolved), spans[0]);
	assert.deepEqual(atDeleteSpan(8, "forward", spans, resolved), spans[0]);
	// Inside the token: ordinary characters, by the browser's own rules.
	assert.equal(atDeleteSpan(11, "back", spans, resolved), null);
	assert.equal(atDeleteSpan(11, "forward", spans, resolved), null);
	// On the separator after a closed token: the separator is deleted, not the
	// token — the promise stops at whitespace.
	assert.equal(atDeleteSpan(14, "back", spans, resolved), null);
	// And an unresolved token is prose, so it is not a chip to take.
	assert.equal(atDeleteSpan(13, "back", spans, new Map()), null);
});

test("a row's id is stable and legal, and the candidate key is the whole set", () => {
	// `/` is not legal in an id without escaping; `.` is, and stays.
	assert.equal(atRowId({ path: "src/app.py" }), "at-src_app.py");
	assert.equal(
		atCandidateKey([{ path: "a" }, { path: "b/c" }]),
		"at-a\nat-b_c",
	);
});

/* -------------------------------------------------------------- the chip rule */

/*
 * `chip <=> the token resolves`, which the design direction calls "the rule that
 * makes it a chip". Both halves are asserted, because the valuable half is the
 * NEGATIVE one: a hand-typed path that names nothing stays plain text, and that
 * absence is the only place this surface can tell the user that the harness will
 * send their token as written, silently, with no notice at all.
 */
test("only a token whose path exists is a chip", () => {
	const spans = atTokenSpans("see @src/app.py and @src/ap.py and @");
	const facts = new Map([
		["src/app.py", { exists: true, outside: false }],
		["src/ap.py", { exists: false, outside: false }],
	]);
	const chips = atChipSpans(spans, facts);
	assert.deepEqual([...chips.keys()], ["4:15"]);
	assert.equal(chips.get("4:15").outside, false);
});

test("the needs-approval fact travels with the chip", () => {
	const spans = atTokenSpans("@../outside/x.md");
	const chips = atChipSpans(
		spans,
		new Map([["../outside/x.md", { exists: true, outside: true }]]),
	);
	assert.equal(chips.size, 1);
	assert.equal(chips.get("0:16").outside, true);
});

test("a directory mention is a chip exactly as a file is", () => {
	// One chip treatment for both: a directory is a legal reference (the harness
	// sends a flat one-level listing) and a second treatment would be a second
	// kind of reference where the backend has one.
	const spans = atTokenSpans("@src/components/");
	const chips = atChipSpans(
		spans,
		new Map([["src/components/", { exists: true, outside: false }]]),
	);
	assert.equal(chips.size, 1);
});
