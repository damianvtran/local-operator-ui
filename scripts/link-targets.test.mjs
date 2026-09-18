import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The linkifier's rules, asserted rather than judged from a frame.
 *
 * Five things live here, and they are the ones a screenshot cannot settle:
 *
 * 1. WHICH TOKENS ARE ADMITTED, per target kind, and what each one resolves to.
 *    A frame shows the links that were made; it cannot show the hundreds of
 *    strings in real transcripts that must NOT become one.
 * 2. THAT THE GRAMMAR IS GENUINELY SHARED. The Files panel and the linkifier
 *    are two readers of one token grammar (`link-grammar.ts`), and the failure
 *    this pins is two parsers that agree until one is fixed. The policies differ
 *    in exactly TWO admissions - the known-extension filter and the fragment
 *    guard - and the property below names BOTH, with a case each, over a corpus:
 *    every link target the panel admits is a link target, and the only extras are
 *    the ones one of those two flags explains. (Round 1, review M2: the first
 *    version of this property said ONE and only inspected the linkifier's extras,
 *    so a change that only NARROWED the panel - `MENTION_POLICY.rejectFragments
 *    = true`, a real change to what the Files panel shows - left every suite
 *    green.)
 * 3. THAT EXISTING MARKDOWN IS UNTOUCHED. Markdown links, GFM autolinks,
 *    reference links and images must come out of the pipeline BYTE-IDENTICAL
 *    whether or not the plugin ran. That is a test rather than a claim, and it
 *    is a deep equality on the mdast, so "identical" means identical.
 * 4. THAT THE STRUCTURAL GUARDS HOLD - code fences, inline code that is not one
 *    whole target, a link's own label, image alt text.
 * 5. THAT THE SPANS ARE RIGHT, which is what the plugin actually consumes: an
 *    off-by-one here underlines the full stop of a sentence, and the frame that
 *    shows it looks like a styling choice rather than a bug.
 *
 * REAL: the shipped `link-grammar.ts`, `remark-linkify-targets.ts` and
 * `mentioned-files.ts`, bundled from source by esbuild, parsed by the real
 * `unified`/`remark-parse`/`remark-gfm` pipeline the app runs.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { unified } from "unified";
			import remarkParse from "remark-parse";
			import remarkGfm from "remark-gfm";

			export {
				LINK_POLICY,
				MENTION_POLICY,
				targetsIn,
			} from "./src/renderer/src/features/chat/utils/link-grammar";
			import { remarkLinkifyTargets } from "./src/renderer/src/features/chat/utils/remark-linkify-targets";
			export { remarkLinkifyTargets };
			export { extractFromArgs, extractMentionedPaths } from "./src/renderer/src/features/chat/canonical/mentioned-files";

			/**
			 * The real pipeline, with the plugin optionally absent - which is what
			 * "byte-identical" has to be measured against.
			 */
			export const parseWith = (document, linkify) => {
				let processor = unified().use(remarkParse).use(remarkGfm);
				if (linkify) processor = processor.use(remarkLinkifyTargets);
				return processor.runSync(processor.parse(document));
			};
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
	LINK_POLICY,
	MENTION_POLICY,
	targetsIn,
	remarkLinkifyTargets,
	extractFromArgs,
	extractMentionedPaths,
	parseWith,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

assert.equal(typeof remarkLinkifyTargets, "function");
assert.equal(typeof parseWith, "function");

/** Every target in a string, as `kind:target` strings, for compact tables. */
const found = (text, policy) =>
	targetsIn(text, policy).map((target) => `${target.kind}:${target.target}`);

/** Every link the plugin made, as its url and the text it covers. */
function linksIn(document) {
	const links = [];
	const walk = (node) => {
		if (node.type === "link") {
			links.push({
				url: node.url,
				text: node.children.map((child) => child.value ?? "").join(""),
			});
			return;
		}
		for (const child of node.children ?? []) walk(child);
	};
	walk(parseWith(document, true));
	return links;
}

/* ---------------------------------------------------------------- admission */

test("a bare `~` or `/` path is a target under both policies", () => {
	for (const policy of [MENTION_POLICY, LINK_POLICY]) {
		assert.deepEqual(found("saved to ~/workspace/report.xlsx today", policy), [
			"path:~/workspace/report.xlsx",
		]);
		assert.deepEqual(found("saved to /Users/x/report.xlsx today", policy), [
			"path:/Users/x/report.xlsx",
		]);
	}
});

test("the two policy differences are the extension filter and the fragment guard", () => {
	/*
	 * The operator's case, and the reason the linkifier drops the filter: a
	 * directory the agent named has no extension, and "Open folder" is what
	 * makes it useful. The panel still refuses it - a tile claims a file exists.
	 */
	for (const token of [
		"~/workspace/opoint-renewal-2026-09-17",
		"/tmp/out",
		"/private/tmp/lo302",
	]) {
		assert.deepEqual(found(`wrote ${token}`, MENTION_POLICY), [], token);
		assert.deepEqual(
			found(`wrote ${token}`, LINK_POLICY),
			[`path:${token}`],
			token,
		);
	}
	/*
	 * And the OTHER difference, which round 1 measured the code denying: a token
	 * that stopped inside a longer name is the panel's to admit (its extension rule
	 * answers `report.pdf` and never looks at the bracket) and the linkifier's to
	 * refuse, because an anchor there claims a file called `report.pdf(banana)`.
	 */
	assert.deepEqual(
		found("see /tmp/out/report.pdf(banana) here", MENTION_POLICY),
		["path:/tmp/out/report.pdf"],
	);
	assert.deepEqual(
		found("see /tmp/out/report.pdf(banana) here", LINK_POLICY),
		[],
	);
});

test("a `file://` URL needs no extension on either side, and is decoded", () => {
	for (const policy of [MENTION_POLICY, LINK_POLICY]) {
		assert.deepEqual(
			found("see file:///Users/x/Downloads/Screenshot%20(1).png now", policy),
			["file-url:/Users/x/Downloads/Screenshot (1).png"],
		);
		assert.deepEqual(found("see file:///tmp/agent-out now", policy), [
			"file-url:/tmp/agent-out",
		]);
		assert.deepEqual(
			found("see file://localhost/tmp/agent-out/report.md now", policy),
			["file-url:/tmp/agent-out/report.md"],
		);
		/* A line reference is an editor suffix, not part of the name. */
		assert.deepEqual(found("see file:///a/run.mjs:59 now", policy), [
			"file-url:/a/run.mjs",
		]);
	}
});

test("relative tokens are admitted by NEITHER surface", () => {
	for (const token of [
		"notes.md",
		"src/foo.ts",
		"node_modules/react/index.js",
	]) {
		assert.deepEqual(
			found(`see ${token} for details`, MENTION_POLICY),
			[],
			token,
		);
		assert.deepEqual(found(`see ${token} for details`, LINK_POLICY), [], token);
	}
});

test("the documented false-positive family still falls out", () => {
	const noise = [
		"https://example.com/a/b.png",
		"http://localhost:1111/v1/static/images?path=/a.png",
		"/v1/static/images",
		"/api/usage",
		"ftp://host/a.pdf",
		"mailto:damian@example.com",
		"//host/share/a.pdf",
		"qa-res-$PID.pdf",
		"/tmp/{a,b}.ts",
		"/tmp/a*.log",
		`/tmp/${"x".repeat(4200)}`,
	];
	for (const text of noise) {
		assert.deepEqual(found(`wrote ${text} here`, LINK_POLICY), [], text);
	}
});

test("a placeholder tail and an abandoned abbreviation are not links either", () => {
	/*
	 * Round 3, R3-1: the abbreviation and placeholder-tail rules live in the SHARED
	 * scanner (`targetsIn`), so landing them there widened them onto `LINK_POLICY`
	 * as well as the panel's `MENTION_POLICY`. This test is that widening STATED
	 * rather than discovered - the right direction, because a link to
	 * `/…/scratchpad/probe.sh` is exactly as bogus as a tile for it, and pressing
	 * it opens nothing.
	 *
	 * Both directions, because the guard is only safe in one of them, and this
	 * policy is also the one a reader is most likely to see fire (chat text).
	 */
	for (const text of [
		"see /…/sessions/<id>/scratchpad/run/perf.md there",
		"open /Users/x/.../scratchpad/probe.sh now",
		"read /…/scratchpad/probe.sh next",
	]) {
		assert.deepEqual(found(text, LINK_POLICY), [], text);
	}
	// The narrowing, on this policy too: a real path after a tag, a generic or a
	// heredoc seam is still a link.
	for (const text of [
		"use <code>/tmp/real/notes.md here",
		"done </b>/tmp/real/notes.md here",
		"Map<T>/tmp/notes/real.md",
		"<br/>/tmp/notes/real.md",
		"cat <<EOF>/tmp/real/notes.md",
	]) {
		assert.equal(found(text, LINK_POLICY).length, 1, text);
	}
});

test("a path in prose keeps its sentence punctuation out of the span", () => {
	const matches = targetsIn("saved to /tmp/a.pdf. See it.", LINK_POLICY);
	assert.equal(matches.length, 1);
	assert.equal(matches[0].target, "/tmp/a.pdf");
	assert.equal(
		"saved to /tmp/a.pdf. See it.".slice(matches[0].start, matches[0].end),
		"/tmp/a.pdf",
	);
});

test("spans are offsets into the text, across lines and in a table cell", () => {
	/*
	 * The offsets are what the plugin slices with, so they are asserted directly
	 * rather than through a rendered link: a scanner that answered the right
	 * TOKENS at the wrong offsets would still pass every admission test above
	 * and would underline the wrong run of characters.
	 */
	const paragraph =
		"First line has nothing.\nThe report is ~/w/report.xlsx here.\n";
	const [paragraphTarget] = targetsIn(paragraph, LINK_POLICY);
	assert.equal(
		paragraph.slice(paragraphTarget.start, paragraphTarget.end),
		"~/w/report.xlsx",
	);

	const cell = "| a | /tmp/out/report.pdf |";
	const [cellTarget] = targetsIn(cell, LINK_POLICY);
	assert.equal(
		cell.slice(cellTarget.start, cellTarget.end),
		"/tmp/out/report.pdf",
	);
});

test("a `#` in a prose path ends the link at the file, as it does for a URL", () => {
	/*
	 * ROUND 1, REVIEW M4: `/tmp/a.pdf#page=2` used to be admitted whole - an anchor
	 * whose target named a file nothing has - while the `file://` tier STRIPPED the
	 * same fragment. One rule now: a fragment is not a path. The span ends at the
	 * `#`, so the reader's `#page=2` stays ordinary text, and the target is the file
	 * that is actually there.
	 */
	for (const policy of [MENTION_POLICY, LINK_POLICY]) {
		assert.deepEqual(found("see /tmp/a.pdf#page=2 now", policy), [
			"path:/tmp/a.pdf",
		]);
		assert.deepEqual(found("opened /tmp/run.log#L59", policy), [
			"path:/tmp/run.log",
		]);
	}
	const text = "see /tmp/a.pdf#page=2 now";
	const [match] = targetsIn(text, LINK_POLICY);
	assert.equal(text.slice(match.start, match.end), "/tmp/a.pdf");
	/* The file-url tier already did this; both tiers now answer the same. */
	assert.deepEqual(found("see file:///tmp/a.pdf#page=2 now", LINK_POLICY), [
		"file-url:/tmp/a.pdf",
	]);
	/* A bare `#` with nothing before it is not a path at all. */
	assert.deepEqual(found("see #page=2 now", LINK_POLICY), []);
});

test("a URL's own path is never admitted as a path", () => {
	assert.deepEqual(
		found("see https://example.com/a/b.png now", LINK_POLICY),
		[],
	);
	assert.deepEqual(found("https://example.com/a.png /tmp/b.png", LINK_POLICY), [
		"path:/tmp/b.png",
	]);
});

/* ------------------------------------------------------- the shared grammar */

test("the grammar is shared: the difference between the surfaces is exactly two flags", () => {
	/*
	 * The property that makes "genuinely shared" checkable rather than asserted
	 * (round 1, review M2 rewrote it): over a corpus of real-looking text, every
	 * answer EITHER surface gives lies inside the union of the two flags - a
	 * policy with both of them relaxed - and the difference between the two
	 * surfaces is exactly the difference those two flags predict, case by case.
	 *
	 * The first version asserted only "mentions ⊆ links" and inspected only the
	 * linkifier's extras, which cannot see a change that NARROWS the panel:
	 * `MENTION_POLICY.rejectFragments = true` - a real change to what the Files
	 * panel shows - left all four suites green. The corpus therefore carries the
	 * fragment case, and the difference is computed in BOTH directions.
	 */
	const RELAXED = { knownExtensionRequired: false, rejectFragments: false };
	const corpus = [
		{
			text: "The write went to /Users/x/out/report.xlsx and the log is /tmp/run.log.",
			why: "both flags agree",
		},
		{
			text: "Opened ~/workspace/opoint-renewal-2026-09-17/proj for the migration.",
			why: "the EXTENSION filter: the linkifier admits the directory, the panel does not",
			linkOnly: ["path:~/workspace/opoint-renewal-2026-09-17/proj"],
		},
		{
			text: "see file:///tmp/a.pdf and /tmp/b.pdf",
			why: "a file:// target needs no extension on either side",
		},
		{
			text: "`/tmp/a.pdf` and /v1/static/images and src/foo.ts",
			why: "the whole-span rule and the shared rejections",
		},
		{
			text: "failed on /tmp/x$PID.log then wrote /tmp/ok.md",
			why: "the shared metacharacter and extension rules",
		},
		{
			text: "the tool cut it off at /tmp/out/report.pdf(banana) mid-name",
			why: "the FRAGMENT guard: the panel admits the token, the linkifier refuses it",
			panelOnly: ["path:/tmp/out/report.pdf"],
		},
	];
	for (const { text, why, linkOnly = [], panelOnly = [] } of corpus) {
		const mentions = new Set(found(text, MENTION_POLICY));
		const links = new Set(found(text, LINK_POLICY));
		const relaxed = new Set(found(text, RELAXED));
		/*
		 * Every answer either surface gives is an answer the two flags describe:
		 * a third knob would show up here as a token outside the union.
		 */
		for (const token of [...mentions, ...links]) {
			assert.ok(
				relaxed.has(token),
				`${token} in ${text} is outside both flags`,
			);
		}
		assert.deepEqual(
			[...links].filter((token) => !mentions.has(token)).sort(),
			[...linkOnly].sort(),
			`linkifier-only targets in ${text} (${why})`,
		);
		assert.deepEqual(
			[...mentions].filter((token) => !links.has(token)).sort(),
			[...panelOnly].sort(),
			`panel-only targets in ${text} (${why})`,
		);
	}
});

/* ---------------------------------------------------- existing markdown, untouched */

const MARKDOWN_ONLY = [
	"# Title",
	"",
	"A [labelled link](https://example.com/a/b.png) and bare https://example.com/c/d.png.",
	"",
	"A [reference][ref] and a [relative one](notes.md) and [an absolute one](/tmp/out.md).",
	"",
	"[ref]: https://example.com/e/f.png",
	"",
	"![alt text](/tmp/chart.png)",
	"",
	"| col |",
	"| --- |",
	"| https://example.com/g/h.png |",
	"",
	"```sh",
	"rm -rf /tmp/x && cat /tmp/a.pdf > /tmp/b.pdf",
	"```",
	"",
	/*
	 * An inline-code span that is NOT one whole target, so it stays literal and
	 * this document really is markdown-only: a linkified span is a CHANGE, and
	 * the point of this fixture is a document where the plugin must change
	 * nothing at all.
	 */
	"An inline `--out=/tmp/x` span.",
].join("\n");

test("a markdown-only document is byte-identical with the plugin on and off", () => {
	assert.equal(
		JSON.stringify(parseWith(MARKDOWN_ONLY, true)),
		JSON.stringify(parseWith(MARKDOWN_ONLY, false)),
	);
});

test("markdown nodes are untouched beside a bare path the plugin links", () => {
	/*
	 * ROUND 1, REVIEW M3: the document-level byte-identity test above is inert by
	 * construction - `MARKDOWN_ONLY` holds no admitted target, so a plugin that DID
	 * disturb an existing markdown link could not have failed it. This fixture holds
	 * both at once: an existing labelled link, a GFM autolink, a reference, an
	 * image, AND a bare path the plugin must linkify in the SAME paragraph. The
	 * claim is then a real one rather than a tautology, and it is made node by node
	 * because the bare path legitimately changes the tree.
	 */
	const document = [
		"A [labelled link](https://example.com/a/b.png) and /tmp/bare.pdf beside it.",
		"",
		"An autolink https://example.com/c/d.png and a [reference][ref].",
		"",
		"[ref]: https://example.com/e/f.png",
		"",
		"![alt text](/tmp/chart.png)",
	].join("\n");
	const before = linksIn(document);
	const after = parseWith(document, true);
	/*
	 * 1. The plugin really did act, or the rest of this test proves nothing.
	 */
	assert.ok(linksIn(document).some((link) => link.url === "/tmp/bare.pdf"));
	assert.ok(
		JSON.stringify(after).includes('"/tmp/bare.pdf"'),
		"the fixture must contain a bare path the plugin links",
	);
	const walk = (node, visit) => {
		visit(node);
		for (const child of node.children ?? []) walk(child, visit);
	};
	/*
	 * 2. Every `link`/`image`/`definition` node present WITHOUT the plugin has an
	 * identical counterpart WITH it - same url, same label children - which is the
	 * "do not disrupt what markdown already captured" claim in the shape that can
	 * actually fail.
	 */
	const collect = (tree) => {
		const nodes = [];
		walk(tree, (node) => {
			if (
				node.type === "link" ||
				node.type === "image" ||
				node.type === "definition"
			) {
				nodes.push({ type: node.type, url: node.url, children: node.children });
			}
		});
		return nodes;
	};
	const untouched = (nodes) =>
		nodes.filter((node) => node.url !== "/tmp/bare.pdf");
	assert.deepEqual(
		untouched(collect(parseWith(document, true))),
		untouched(collect(parseWith(document, false))),
	);
	/*
	 * 3. And the paragraph the plugin edited kept every one of those links as its
	 * OWN node, rather than being flattened into text around the new anchor.
	 */
	assert.deepEqual(
		after.children[0].children.map((child) => child.type),
		["text", "link", "text", "link", "text"],
	);
	assert.deepEqual(
		after.children[0].children.map((child) => child.value ?? child.url),
		[
			"A ",
			"https://example.com/a/b.png",
			" and ",
			"/tmp/bare.pdf",
			" beside it.",
		],
	);
	assert.equal(before[0].text, "labelled link");
});

test("existing markdown links keep their own hrefs", () => {
	const links = linksIn(MARKDOWN_ONLY);
	const urls = links.map((link) => link.url);
	assert.ok(urls.includes("https://example.com/a/b.png"));
	assert.ok(urls.includes("notes.md"));
	assert.ok(urls.includes("/tmp/out.md"));
	assert.equal(links.filter((link) => link.text === "labelled link").length, 1);
	/*
	 * A REFERENCE-style link has no `url` in the mdast at all: the definition is
	 * resolved during mdast-to-hast, by a plugin this one does not replace. So the
	 * claim here is the node's own shape, not a resolved href - and the byte
	 * equality above is what says the plugin did not disturb the resolution.
	 */
	assert.ok(
		parseWith(MARKDOWN_ONLY, true).children.some(
			(node) =>
				node.type === "definition" &&
				node.url === "https://example.com/e/f.png",
		),
	);
});

test("a GFM autolink is left to remark-gfm rather than doubled", () => {
	const links = linksIn("bare https://example.com/c/d.png here");
	assert.deepEqual(
		links.filter((link) => link.url === "https://example.com/c/d.png").length,
		1,
	);
});

/* ---------------------------------------------------------- structural guards */

test("a code fence is never linkified, for any policy", () => {
	const document = [
		"```sh",
		"cat /tmp/a.pdf > /tmp/b.pdf",
		"```",
		"",
		"    indented /tmp/c.pdf",
	].join("\n");
	assert.deepEqual(linksIn(document), []);
	assert.equal(
		JSON.stringify(parseWith(document, true)),
		JSON.stringify(parseWith(document, false)),
	);
});

test("inline code is linkified only when the span IS the whole target", () => {
	assert.deepEqual(linksIn("`~/x/report.xlsx`"), [
		{ url: "~/x/report.xlsx", text: "~/x/report.xlsx" },
	]);
	assert.deepEqual(linksIn("`rm -rf /tmp/x`"), []);
	assert.deepEqual(linksIn("`--out=/tmp/x`"), []);
	assert.deepEqual(linksIn("`/tmp/a.pdf /tmp/b.pdf`"), []);
	assert.deepEqual(linksIn("see `/tmp/a.pdf` and `/tmp/b.pdf`"), [
		{ url: "/tmp/a.pdf", text: "/tmp/a.pdf" },
		{ url: "/tmp/b.pdf", text: "/tmp/b.pdf" },
	]);
});

test("a linked inline-code span keeps its code child", () => {
	/*
	 * § 4 spends monospace on machine voice, and the path was SHOWN in it; the
	 * anchor wraps the span rather than replacing it, so the face survives and
	 * `markdown.css`'s `a code` rule is what stops the two colours fighting.
	 */
	const [link] = parseWith("`~/x/report.xlsx`", true).children[0].children;
	assert.equal(link.type, "link");
	assert.equal(link.children.length, 1);
	assert.equal(link.children[0].type, "inlineCode");
	assert.equal(link.children[0].value, "~/x/report.xlsx");
});

test("a link's label and an image's alt are never walked into", () => {
	const links = linksIn("[see /tmp/a.pdf](/tmp/b.pdf)");
	assert.deepEqual(links, [{ url: "/tmp/b.pdf", text: "see /tmp/a.pdf" }]);
	assert.deepEqual(linksIn("![/tmp/a.pdf](/tmp/b.pdf)"), []);
});

test("prose around a target is preserved exactly, markdown and all", () => {
	const links = linksIn("**bold** /tmp/a.pdf _em_");
	assert.deepEqual(links, [{ url: "/tmp/a.pdf", text: "/tmp/a.pdf" }]);
	const paragraph = parseWith("**bold** /tmp/a.pdf _em_", true).children[0];
	assert.deepEqual(
		paragraph.children.map((child) => child.type),
		["strong", "text", "link", "text", "emphasis"],
	);
});

test("two targets in one text node become two links with the text between", () => {
	const paragraph = parseWith("a /tmp/a.pdf b /tmp/b.pdf c", true).children[0];
	assert.deepEqual(
		paragraph.children.map((child) => child.type),
		["text", "link", "text", "link", "text"],
	);
	assert.deepEqual(
		paragraph.children.map((child) => child.value ?? child.url),
		["a ", "/tmp/a.pdf", " b ", "/tmp/b.pdf", " c"],
	);
});

/* ------------------------------------------------------------------ the href */

test("a detected link carries a PATH in href, never a file:// URL", () => {
	/*
	 * react-markdown runs every href through remark-rehype's
	 * `defaultUrlTransform`, whose safe list is `https?|ircs?|mailto|xmpp`: a
	 * `file:///…` href is silently replaced with `""`, and the result renders an
	 * anchor that goes nowhere with nothing in the markup to show it. So the
	 * href is asserted, not the click handler's intentions.
	 */
	for (const document of [
		"see file:///tmp/a.pdf now",
		"see file:///tmp/out now",
		"`file:///tmp/a.pdf`",
	]) {
		const [link] = linksIn(document);
		assert.ok(link, document);
		assert.ok(!link.url.includes("://"), `${document} -> ${link.url}`);
	}
	assert.deepEqual(linksIn("see file:///tmp/a.pdf now"), [
		{ url: "/tmp/a.pdf", text: "file:///tmp/a.pdf" },
	]);
});

test("a wrapped path is one link per its own span, not the whole line", () => {
	const document = "The report is ~/w/report.xlsx and nothing else.";
	const [link] = linksIn(document);
	assert.equal(link.text, "~/w/report.xlsx");
	assert.equal(link.url, "~/w/report.xlsx");
});
