import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
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
 *    in exactly THREE admissions - the known-extension filter, the fragment
 *    guard and the evidence gate - and the property below names ALL THREE, with
 *    a case each, over a corpus: every link target the panel admits is a link
 *    target, and the only extras are the ones one of those three flags explains.
 *    (Round 1, review M2: the first version of this property said ONE and only
 *    inspected the linkifier's extras, so a change that only NARROWED the panel
 *    - `MENTION_POLICY.rejectFragments = true`, a real change to what the Files
 *    panel shows - left every suite green. This change added the third flag and
 *    moved this note and the test's name with it, for the same reason: a
 *    property that counts the differences it happens to know about certifies
 *    the one it does not.)
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
				ambiguousTargetsIn,
				isAmbiguousCandidate,
				targetsIn,
			} from "./src/renderer/src/features/chat/utils/link-grammar";
			import { remarkLinkifyTargets } from "./src/renderer/src/features/chat/utils/remark-linkify-targets";
			export { remarkLinkifyTargets };
			export { extractFromArgs, extractMentionedPaths } from "./src/renderer/src/features/chat/canonical/mentioned-files";
			/*
			 * The probe cache, because the plugin now READS it: the production policy
			 * is LINK_POLICY plus link-actions.ts's evidenceFor, so a test that wants an
			 * extensionless token to link has to answer the disk through the same door
			 * the app does rather than stub the grammar's oracle directly.
			 * resetProbeCache is called before every test below for that reason.
			 *
			 * (No backticks anywhere in this comment: this whole program is one
			 * template literal, and a backtick in prose ends it.)
			 */
			export {
				evidenceFor,
				probeTarget,
				resetProbeCache,
			} from "./src/renderer/src/features/chat/utils/link-actions";

			/**
			 * The real pipeline, with the plugin optionally absent - which is what
			 * "byte-identical" has to be measured against.
			 */
			export const parseWith = (document, linkify) => {
				let processor = unified().use(remarkParse).use(remarkGfm);
				if (linkify) processor = processor.use(remarkLinkifyTargets);
				/*
				 * The source is passed as the file, which is how react-markdown runs this
				 * pipeline (it calls runSync with its own VFile whose value is the markdown).
				 * The plugin reads the character the source holds before a node's first
				 * character - the predecessor test round 1's review R1-4 asked for - and
				 * runSync(tree) alone hands it a file with no value, so a harness that
				 * omitted this would exercise a branch production never takes.
				 */
				return processor.runSync(processor.parse(document), document);
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
	ambiguousTargetsIn,
	isAmbiguousCandidate,
	targetsIn,
	remarkLinkifyTargets,
	extractFromArgs,
	extractMentionedPaths,
	parseWith,
	evidenceFor,
	probeTarget,
	resetProbeCache,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

assert.equal(typeof remarkLinkifyTargets, "function");
assert.equal(typeof parseWith, "function");

/**
 * The linkifier's PRODUCTION policy, with the disk answering from a stub.
 *
 * `LINK_POLICY` itself carries no oracle - deliberately, so the two pure suites
 * keep asserting the fail-safe default - and the app's own answer comes from
 * `link-actions.ts`'s cache instead (`LINK_POLICY_EVIDENCED` in
 * `remark-linkify-targets.ts`). This is the same policy shape with the question
 * answered yes, which is what isolates the three ADMISSION flags from the disk:
 * without it, a corpus of real-looking text would assert the absence rule three
 * times over and the flags themselves never.
 */
const LINKING = { ...LINK_POLICY, evidence: () => "exists" };
const REFUSING = { ...LINK_POLICY, evidence: () => "missing" };

/*
 * The plugin reads a module-level cache now, so a test that primed a spelling
 * must not leak its answer into the next one - and a negative is as sticky as an
 * answer (that is the point of the cache), which is exactly how a later case
 * would silently inherit `/new`'s refusal and pass for the wrong reason.
 */
beforeEach(() => resetProbeCache());

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

test("the three policy differences are the extension filter, the fragment guard and the evidence gate", () => {
	/*
	 * The operator's case for the FIRST flag, and the reason the linkifier drops
	 * the filter: a directory the agent named has no extension, and "Open folder"
	 * is what makes it useful. The panel still refuses it - a tile claims a file
	 * exists. The linkifier column is the PRODUCTION shape (the disk answering
	 * yes) rather than bare `LINK_POLICY`, because extensionlessness is also the
	 * third flag's input: with no oracle the same token is refused for a different
	 * reason, and a test that conflated them would pass with either fix reverted.
	 */
	for (const token of [
		"~/workspace/opoint-renewal-2026-09-17",
		"/tmp/out",
		"/private/tmp/lo302",
	]) {
		assert.deepEqual(found(`wrote ${token}`, MENTION_POLICY), [], token);
		assert.deepEqual(
			found(`wrote ${token}`, LINKING),
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
	assert.deepEqual(found("see /tmp/out/report.pdf(banana) here", LINKING), []);
	/*
	 * And the THIRD, which is what makes a slash command stay plain text: an
	 * ambiguous token is admitted only on the disk's answer. The panel refuses it
	 * whether or not an oracle is supplied, because its extension test runs FIRST -
	 * that ordering is the whole reason this difference is the linkifier's alone,
	 * and it is asserted here rather than asserted about.
	 */
	assert.deepEqual(
		found("started with /new and nothing sent", MENTION_POLICY),
		[],
	);
	assert.deepEqual(
		found("started with /new and nothing sent", {
			...MENTION_POLICY,
			evidence: () => "exists",
		}),
		[],
		"the panel's extension test runs first, so evidence cannot widen it",
	);
	for (const evidence of [
		LINK_POLICY,
		REFUSING,
		{ ...LINK_POLICY, evidence: () => "unknown" },
	]) {
		assert.deepEqual(
			found("started with /new and nothing sent", evidence),
			[],
			"an absent oracle, a missing file and an unanswered question all refuse",
		);
	}
	assert.deepEqual(found("started with /new and nothing sent", LINKING), [
		"path:/new",
	]);
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
		assert.deepEqual(found(`wrote ${text} here`, LINKING), [], text);
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

test("the grammar is shared: the difference between the surfaces is exactly three flags", () => {
	/*
	 * The property that makes "genuinely shared" checkable rather than asserted
	 * (round 1, review M2 rewrote it): over a corpus of real-looking text, every
	 * answer EITHER surface gives lies inside the union of the three flags - a
	 * policy with all of them relaxed - and the difference between the two
	 * surfaces is exactly the difference those three flags predict, case by case.
	 *
	 * The first version asserted only "mentions ⊆ links" and inspected only the
	 * linkifier's extras, which cannot see a change that NARROWS the panel:
	 * `MENTION_POLICY.rejectFragments = true` - a real change to what the Files
	 * panel shows - left all four suites green. The corpus therefore carries the
	 * fragment case, and the difference is computed in BOTH directions. This
	 * change adds the THIRD flag (the evidence gate) and moves the name with it,
	 * for the same reason: a property that counts the differences it happens to
	 * know about certifies the one it does not.
	 *
	 * THE LINKIFIER COLUMN RUNS THE PRODUCTION SHAPE, with the disk answering yes
	 * (`LINKING`). Bare `LINK_POLICY` carries no oracle, so under it every
	 * extensionless token is refused - including the one this corpus exists to
	 * show being admitted on the EXTENSION flag - and the two flags would then be
	 * indistinguishable from the third. The stub is the honest instrument for the
	 * same reason a frame's stub is: the corpus is about which flag explains a
	 * difference, and "the disk said no" explains none of them.
	 */
	const RELAXED = {
		knownExtensionRequired: false,
		rejectFragments: false,
		evidence: () => "exists",
	};
	const corpus = [
		{
			text: "The write went to /Users/x/out/report.xlsx and the log is /tmp/run.log.",
			why: "all three flags agree",
		},
		{
			text: "Opened ~/workspace/opoint-renewal-2026-09-17/proj for the migration.",
			why: "the EXTENSION filter: the linkifier admits the directory, the panel does not",
			linkOnly: ["path:~/workspace/opoint-renewal-2026-09-17/proj"],
		},
		{
			text: "I noticed that sometimes when new conversations are started with /new and no message has been sent yet",
			why: "the EVIDENCE gate: the linkifier takes the disk's answer, the panel's extension rule answers first",
			linkOnly: ["path:/new"],
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
		const links = new Set(found(text, LINKING));
		const relaxed = new Set(found(text, RELAXED));
		/*
		 * Every answer either surface gives is an answer the three flags describe:
		 * a fourth knob would show up here as a token outside the union.
		 */
		for (const token of [...mentions, ...links]) {
			assert.ok(
				relaxed.has(token),
				`${token} in ${text} is outside all three flags`,
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

/* ------------------------------------------------------------- the disk gate */

test("the disk is consulted for extensionless shapes and for nothing else", () => {
	/*
	 * WHAT `isAmbiguousCandidate` IS, stated as the four families it answers over -
	 * because it is the input to a stat, and every shape it wrongly names costs an
	 * IPC round trip per rendered row.
	 */
	for (const token of [
		"/new",
		"/help",
		"/new-chat",
		"/Users/damian/workspace",
		"/Users/damian/Downloads/",
		"/v2/things",
		"~/workspace",
	]) {
		assert.equal(isAmbiguousCandidate(token), true, token);
	}
	for (const token of [
		"/tmp/a.pdf",
		"/tmp/agent-out/out.json",
		"~/workspace/notes.md",
		"/Users/damian/.zshrc",
		"/Users/damian/.config",
	]) {
		assert.equal(isAmbiguousCandidate(token), false, token);
	}
	/*
	 * SEGMENT COUNT IS NOT PART OF IT. A single-segment rule would fix `/new` and
	 * leave the same defect one segment longer - and the operator's own sentence
	 * contains the multi-segment directory that must keep its link.
	 */
	assert.equal(isAmbiguousCandidate("/v2/things"), true);
	assert.equal(
		isAmbiguousCandidate("/Users/damian/workspace/opoint-renewal-2026-09-17"),
		true,
	);
	/*
	 * A DOTFILE IS A SYNTAX ARTIFACT, NOT AN AMBIGUITY: `extensionOf` answers null
	 * for `.zshrc` because the only dot IS the first character of the name, and
	 * reading that as "no extension" would send a spelling nobody types by
	 * accident to the disk and demote it whenever the answer was `unknown`.
	 */
	assert.equal(isAmbiguousCandidate("/Users/damian/.zshrc"), false);
	assert.equal(isAmbiguousCandidate("/Users/damian/.config/"), false);
});

test("the pre-scan is exactly what the evidence gate decides, for every case", () => {
	/*
	 * THE PROPERTY THAT KEEPS THE QUERY AND THE GATE TOGETHER, and the reason the
	 * renderer may ask about what `ambiguousTargetsIn` returns without a second
	 * scanner: the suspects are exactly the `path` targets a policy that suspends
	 * the question ADMITS and one that answers "missing" REFUSES. If either side
	 * drifts - a new exemption in the predicate, a reordering in `targetsIn` - this
	 * is the test that says so rather than a row that quietly stops linking.
	 */
	const DISCOVERY = { ...LINK_POLICY, evidence: () => "exists" };
	const corpus = [
		"I noticed that sometimes when new conversations are started with /new and no message has been sent yet",
		"`/new` starts one and `/model gpt-5` changes the model.",
		"- /new\n- /resume\n- /model",
		"start with /new, then send the message",
		"the folder /Users/damian/workspace is large",
		"wrote ~/workspace/notes.md and /tmp/agent-out/out.json",
		"see /Users/damian/.zshrc and file:///tmp/agent-out now",
		"nothing in doubt here at all",
	];
	for (const text of corpus) {
		const admitted = targetsIn(text, DISCOVERY)
			.filter((span) => span.kind === "path")
			.map((span) => span.target);
		const refused = new Set(
			targetsIn(text, REFUSING)
				.filter((span) => span.kind === "path")
				.map((span) => span.target),
		);
		const expected = [...new Set(admitted)].filter(
			(target) => !refused.has(target),
		);
		assert.deepEqual(ambiguousTargetsIn(text), expected, text);
	}
	/* The dedupe is by SPELLING, in document order, not one entry per occurrence. */
	assert.deepEqual(ambiguousTargetsIn("/new then /new again"), ["/new"]);
});

test("a slash command stays plain text until the disk says otherwise", async () => {
	/*
	 * THE REPORTED BUG, end to end through the real plugin: the operator's own
	 * sentence, where `/new` used to render as an anchor whose toolbar answered
	 * `No file at /new`. The plugin's policy reads `probeCache` through
	 * `evidenceFor`, so this asks the disk the way the app does - `probeTarget` with
	 * a stub standing in for the preload - rather than by handing the grammar an
	 * oracle the production path never builds.
	 */
	const sentence =
		"I noticed that sometimes when new conversations are started with /new and no message has been sent yet";
	assert.deepEqual(linksIn(sentence), [], "nothing asked: plain text");
	assert.equal(evidenceFor("/new"), "unknown");

	await probeTarget("/new", async (paths) =>
		paths.map(() => ({ exists: false, isFile: false })),
	);
	assert.equal(evidenceFor("/new"), "missing");
	assert.deepEqual(linksIn(sentence), [], "the disk says there is no /new");

	/*
	 * The same shape, one the disk vouches for: the directory keeps its link, which
	 * is the half a "refuse every extensionless token" fix would have taken away.
	 */
	const folder = "the folder /Users/damian/workspace is the one";
	assert.deepEqual(linksIn(folder), []);
	await probeTarget("/Users/damian/workspace", async (paths) =>
		paths.map(() => ({ exists: true, isFile: false })),
	);
	assert.equal(evidenceFor("/Users/damian/workspace"), "exists");
	assert.deepEqual(linksIn(folder), [
		{ url: "/Users/damian/workspace", text: "/Users/damian/workspace" },
	]);
	/* And a backticked command is refused on the same answer. */
	assert.deepEqual(linksIn("`/new` at the prompt"), []);
});

test("an extensioned path, a dotfile and a file:// URL never ask the disk", async () => {
	/*
	 * The cost bound, asserted rather than reasoned about: the pre-scan is what
	 * drives every probe the transcript makes, so the shapes it does NOT name are
	 * the shapes that cost no IPC. A counting stub over the real ask path is the
	 * instrument - `ambiguousTargetsIn` returning them would be a stat per row per
	 * spelling, on main's own event loop.
	 */
	const text =
		"wrote /tmp/agent-out/out.json, read /Users/damian/.zshrc, opened file:///tmp/agent-out";
	const suspects = ambiguousTargetsIn(text);
	assert.deepEqual(suspects, [], "none of these three is in doubt");
	/*
	 * THE INSTRUMENT NEEDS A CORPUS WITH SOMETHING IN IT, and the earlier version of
	 * this test did not have one: it looped over the array it had just asserted
	 * empty, so the counting stub could never run and `assert.deepEqual(asked, [])`
	 * was vacuous (round 1, review R1-8). One ambiguous token added to the SAME
	 * document is what makes the count mean something - the ask happens, it is about
	 * the one shape in doubt, and the three undoubted shapes beside it cost nothing.
	 */
	const mixed = `${text}, then look at /Users/damian/workspace`;
	assert.deepEqual(ambiguousTargetsIn(mixed), ["/Users/damian/workspace"]);
	const asked = [];
	await probeTarget("/Users/damian/workspace", async (paths) => {
		asked.push(...paths);
		return paths.map(() => ({ exists: true, isFile: false }));
	});
	assert.deepEqual(asked, ["/Users/damian/workspace"], "one ask, one shape");
	/*
	 * And they are links on the FIRST frame, with no answer in the cache at all -
	 * which is the difference between "not in doubt" and "doubted and lucky":
	 * the gate is never reached for them.
	 */
	resetProbeCache();
	assert.deepEqual(
		linksIn(text).map((link) => link.url),
		["/tmp/agent-out/out.json", "/Users/damian/.zshrc", "/tmp/agent-out"],
	);
});

test("the pre-scan and the walker agree: a token the raw scan cannot name is not linked", async () => {
	/*
	 * ROUND 1'S REVIEW R1-4, which is the property this test fails before the fix.
	 *
	 * The pre-scan reads the RAW document, where the character before a token has to
	 * be in `ALLOWED_PREFIX`, and `_` is not - while the walker reads node values,
	 * from which markdown has already DELETED that character. So `_/Users/x/…_` is a
	 * token the pre-scan never names, which means nothing asks the disk about it,
	 * which means its evidence is `unknown` - unless ANOTHER row happened to ask about
	 * the same spelling, and then the anchor appeared. Measured before this fix: with
	 * `/Users/x/workspace` primed, `linksIn` returned a link for the emphasised
	 * document while `ambiguousTargetsIn` returned `[]` for it. An anchor whose
	 * existence depends on unrelated cache state is the defect; the direction kept is
	 * the module's own - refuse, and miss the link.
	 *
	 * `allowsProsePathAfter` is what closes it: the walker answers the same question
	 * from the SOURCE's own character, so the two scanners cannot disagree AT A NODE
	 * BOUNDARY - which is the scope of this case rather than of every index (round 2,
	 * review R2-4: a character markdown consumes INSIDE a node value is invisible to
	 * the raw scan and to this test, and the last block below pins that limit).
	 */
	const emphasised = "the folder _/Users/x/workspace_ is large";
	assert.deepEqual(
		ambiguousTargetsIn(emphasised),
		[],
		"the raw scan cannot name that spelling",
	);
	/* A neighbour row answers the very spelling, which used to be enough. */
	await probeTarget("/Users/x/workspace", async (paths) =>
		paths.map(() => ({ exists: true, isFile: false })),
	);
	assert.equal(evidenceFor("/Users/x/workspace"), "exists");
	assert.deepEqual(
		linksIn(emphasised),
		[],
		"the asker could not have asked, so the walker does not link",
	);
	/*
	 * THE CONTROLS, so the case is about the predecessor and not about emphasis:
	 * `*` IS an allowed predecessor, so strong emphasis links the same spelling on
	 * the same primed answer - and the plain paragraph is the shape the pre-scan
	 * names.
	 */
	assert.deepEqual(linksIn("the folder **/Users/x/workspace** is large"), [
		{ url: "/Users/x/workspace", text: "/Users/x/workspace" },
	]);
	const plain = "the folder /Users/x/workspace is large";
	assert.deepEqual(ambiguousTargetsIn(plain), ["/Users/x/workspace"]);
	assert.deepEqual(linksIn(plain), [
		{ url: "/Users/x/workspace", text: "/Users/x/workspace" },
	]);
	/*
	 * And a token at the START of a document - offset 0, where there is no
	 * predecessor character at all - keeps its link, because that is the case
	 * `targetsIn` has always treated as a legal start.
	 */
	assert.deepEqual(linksIn("/Users/x/workspace at the start"), [
		{ url: "/Users/x/workspace", text: "/Users/x/workspace" },
	]);
	/*
	 * AND THE REFUSAL IS THE AMBIGUOUS CLASS'S ALONE (round 2, review R2-3). The gate
	 * is about the ASK, and an extensioned target is never asked about -
	 * `isAmbiguousCandidate` is false for it, so the evidence rule is never reached -
	 * which is why the same consumed boundary cannot cost it anything. Scoping the
	 * test to that class is what restores these five, and they link here with NO
	 * answer in the cache at all, which is the point: their anchor never depended on
	 * one. That the cache is cold is measured rather than assumed, one line below.
	 * The ambiguous half is the case above - the same consumed boundary, a primed
	 * answer for the spelling, and still plain text - so the scoping moved the
	 * extensioned class only. Measured before the scoping, with every one of these
	 * five spellings primed: `linksIn` returned plain text for all five, against
	 * links for all five at `2b3ac8a2b` (rebased as `2b3ac8a2b`).
	 */
	for (const spelling of ["/tmp/a.pdf", "~/notes/todo.md", "/tmp/b.pdf"]) {
		assert.equal(evidenceFor(spelling), "unknown", spelling);
	}
	for (const [document, url] of [
		["the folder _/tmp/a.pdf_ is large", "/tmp/a.pdf"],
		["the folder __/tmp/a.pdf__ is large", "/tmp/a.pdf"],
		["see _~/notes/todo.md_ here", "~/notes/todo.md"],
		["the folder ~~/tmp/a.pdf~~ is large", "/tmp/a.pdf"],
		["see [x](/tmp/a.pdf)/tmp/b.pdf here", "/tmp/b.pdf"],
	]) {
		assert.deepEqual(
			linksIn(document)
				.map((link) => link.url)
				.filter((href) => href === url),
			[url],
			document,
		);
	}
	/*
	 * WHERE THE RULE DOES NOT REACH, pinned instead of left to the prose (round 2,
	 * review R2-4). Markdown can consume a character INSIDE a node value as well, and
	 * no boundary test can see that one: in `see \/Users/x/workspace here` micromark
	 * decodes the escape, so the node value holds the token at index 4 while the raw
	 * text the pre-scan reads holds the backslash - so nothing asks, and the walker
	 * links the spelling once the cache has it (primed by the row above). It measures
	 * the same on `2b3ac8a2b` (rebased as `2b3ac8a2b`), so this is a gap the rule neither introduced nor
	 * closes; if a later change reaches inside node values, these two assertions are
	 * the ones to change deliberately.
	 */
	const escaped = "see \\/Users/x/workspace here";
	assert.deepEqual(
		ambiguousTargetsIn(escaped),
		[],
		"the raw scan cannot name it",
	);
	assert.deepEqual(
		linksIn(escaped).map((link) => link.url),
		["/Users/x/workspace"],
		"the walker links it on a primed cache - the documented limit",
	);
});

test("the slash-command battery: 38 named cases, cold and with the disk answering", async () => {
	/*
	 * WHY THIS TABLE IS IN THE TREE. The implementation round reported its numbers
	 * from `/tmp/linkify-repro.mjs` - 38 cases, 22 linkified before this change and
	 * 7 after, 11 slash-shaped to 0 - and a scratch file outside the tree is a
	 * number nobody can re-run, reviewer or CI (round 1, review R1-9). The cases and
	 * both readings are here now, and the aggregate counts are asserted rather than
	 * described.
	 *
	 * THE COLD COLUMN is the reported reading, taken with the same instrument: the
	 * shipped pipeline, one document per case, the probe cache emptied first, so an
	 * extensionless token has no answer yet and stays plain. The DISK column is the
	 * same 38 with an oracle that answers - `exists` for everything except the
	 * command-shaped spellings, which is the operator's own machine - and it is here
	 * because the SHAPES cannot separate `/new` from `/tmp`: only the disk does, and
	 * that is the fix.
	 *
	 * Two of the seven cold links are not this plugin's: the `https://` fixtures are
	 * remark-gfm's own autolinks, which must not be doubled. They are in the table
	 * because they are in the battery, and they are named where they are asserted.
	 */
	const CASES = [
		// The operator's report, and the family of slash-shaped commands it named.
		[
			"screenshot sentence",
			"I noticed that sometimes when new conversations are started with /new and no message has been sent yet, peer messages can end up arriving at the session",
			[],
			[],
		],
		["bare command", "/new", [], []],
		["command mid-sentence", "then run /new to start over.", [], []],
		["command in list", "- /new\n- /resume\n- /model", [], []],
		["command with arg", "use /model gpt-5 for that", [], []],
		["command, comma", "start with /new, then send the message", [], []],
		["command in backticks", "`/new` starts a session", [], []],
		["command-ish word", "/notification", [], []],
		["command with dash", "/new-chat", [], []],
		[
			"known commands",
			"/help /clear /compact /status /move /credential",
			[],
			[],
		],
		// Real files, which must keep their links.
		[
			"real absolute file",
			"read /Users/damian/workspace/report-2026-09-18.csv",
			["/Users/damian/workspace/report-2026-09-18.csv"],
			["/Users/damian/workspace/report-2026-09-18.csv"],
		],
		[
			"real tilde file",
			"wrote ~/workspace/notes.md",
			["~/workspace/notes.md"],
			["~/workspace/notes.md"],
		],
		[
			"real dir with slash",
			"the dir /Users/damian/Downloads/ is large",
			[],
			["/Users/damian/Downloads/"],
		],
		[
			"extensionless dir that exists",
			"/Users/damian/workspace",
			[],
			["/Users/damian/workspace"],
		],
		[
			"tmp file",
			"/tmp/agent-out/out.json",
			["/tmp/agent-out/out.json"],
			["/tmp/agent-out/out.json"],
		],
		[
			"dotfile",
			"/Users/damian/.zshrc",
			["/Users/damian/.zshrc"],
			["/Users/damian/.zshrc"],
		],
		["single-segment existing dir", "/tmp", [], ["/tmp"]],
		// Other slash motifs that are not files. None may link, either way.
		["and/or", "tabs and/or spaces", [], []],
		["either/or choice", "pick either/or", [], []],
		["ratio", "24/7 support", [], []],
		["unit", "60 km/h", [], []],
		["without", "w/o the flag", [], []],
		["date", "due 3/4/2026", [], []],
		["fraction", "1/2 of the batch", [], []],
		["TCP/IP", "the TCP/IP stack", [], []],
		["I/O", "blocking I/O", [], []],
		["n/a", "answer: n/a", [], []],
		["OS/2", "an OS/2 build", [], []],
		// remark-gfm's own autolink, present in both columns and not this plugin's.
		[
			"path in url",
			"see https://example.com/v1/static/images?path=x",
			["https://example.com/v1/static/images?path=x"],
			["https://example.com/v1/static/images?path=x"],
		],
		["ipv6 cidr", "the range 2001:db8::1/64 is fine", [], []],
		["comment style", "// this is a comment", [], []],
		["markdown heading", "#/ heading weirdness", [], []],
		["shell redirect", "echo hi > /dev/null", [], ["/dev/null"]],
		["glob", "/tmp/agent-out/*.log", [], []],
		["placeholder", "write to /tmp/<name>.json", [], []],
		[
			"line reference",
			"/Users/damian/proj/run.mjs:59",
			["/Users/damian/proj/run.mjs"],
			["/Users/damian/proj/run.mjs"],
		],
		["relative", "src/renderer/src/app.tsx", [], []],
		// The second GFM autolink.
		[
			"url",
			"https://github.com/damianvtran/local-operator-ui/pull/355",
			["https://github.com/damianvtran/local-operator-ui/pull/355"],
			["https://github.com/damianvtran/local-operator-ui/pull/355"],
		],
	];
	/*
	 * The model the disk column uses: the slash-shaped spellings the battery writes
	 * are not on the operator's disk, and everything else it mentions is. A machine
	 * WITH a directory called `/new` is the case `a slash command stays plain text`
	 * already pins from the other side - there the disk vouches and the link is
	 * correct.
	 */
	const ABSENT = new Set([
		"/new",
		"/resume",
		"/model",
		"/notification",
		"/new-chat",
		"/help",
		"/clear",
		"/compact",
		"/status",
		"/move",
		"/credential",
	]);

	let cold = 0;
	let singleSegment = 0;
	for (const [label, text, coldUrls] of CASES) {
		resetProbeCache();
		const urls = linksIn(text).map((link) => link.url);
		assert.deepEqual(urls, coldUrls, `${label}: cold cache`);
		if (urls.length > 0) cold += 1;
		if (urls.some((url) => !url.slice(1).includes("/"))) singleSegment += 1;
	}
	assert.equal(CASES.length, 38);
	assert.equal(cold, 7, "the reported cold reading: seven of the thirty-eight");
	assert.equal(
		singleSegment,
		0,
		"no case links a single-segment slash-shaped token with an empty cache",
	);

	let disk = 0;
	for (const [label, text, , diskUrls] of CASES) {
		resetProbeCache();
		for (const suspect of ambiguousTargetsIn(text)) {
			await probeTarget(suspect, async (paths) =>
				paths.map((path) => ({
					exists: !ABSENT.has(path),
					isFile: false,
				})),
			);
		}
		const urls = linksIn(text).map((link) => link.url);
		assert.deepEqual(urls, diskUrls, `${label}: with the disk answering`);
		if (urls.length > 0) disk += 1;
	}
	assert.equal(disk, 11, "eleven of the thirty-eight, once the disk answers");
});

test("a token the markdown SPLIT is not linked as if it were whole", async () => {
	/*
	 * `write to /tmp/<name>.json` is ONE string to the grammar and correctly refused
	 * as a placeholder, but mdast hands the walker three nodes - `text("write to
	 * /tmp/")`, `html("<name>")`, `text(".json")` - and the per-node call saw a
	 * COMPLETE token `/tmp/` and linked it. The `isFragment` guard exists for
	 * exactly this shape and cannot see past a node boundary.
	 *
	 * Asserted on `linksIn` and NOT only on `targetsIn`: the whole-string call was
	 * already correct, which is the entire point - a test that stopped at the
	 * scanner would pass on the broken tree.
	 */
	assert.deepEqual(found("write to /tmp/<name>.json", LINKING), []);
	assert.deepEqual(linksIn("write to /tmp/<name>.json"), []);
	/*
	 * `/tmp` is primed as an existing directory for the two cases below, so that
	 * what they measure is the BOUNDARY rule and not the evidence gate: with an
	 * empty cache every extensionless token is refused for the other reason, and
	 * both assertions would pass on a tree where the guard did nothing at all.
	 */
	await probeTarget("/tmp", async (paths) =>
		paths.map(() => ({ exists: true, isFile: false })),
	);
	/* A heredoc placeholder is the same shape one node over. */
	assert.deepEqual(linksIn("here: /tmp/<name> is the file"), []);
	/*
	 * AND THE NARROWING, in both directions - the two cases that decide whether
	 * this fix is a fix or a blunt instrument.
	 *
	 * A token SPLIT across a boundary that completes into a longer name is refused
	 * (`/Users/x/rep` plus `` `ort.md` ``): the next node's text is the rest of the
	 * name, so the half the reader sees is not a path anybody has.
	 */
	assert.deepEqual(linksIn("wrote /Users/x/rep`ort.md`"), []);
	/*
	 * A token followed by WHITESPACE before the boundary is untouched: the text
	 * node ends in the space, so nothing is concatenated onto the token and the
	 * ordinary `See /tmp <b>bold</b>` shape keeps its link. The right-hand half of
	 * the pair is the glued spelling, which is refused - and it is refused for the
	 * reason the grammar states for `isPlaceholderTail`: a token with a `<`
	 * immediately after it is a placeholder tail, not a path.
	 */
	assert.deepEqual(linksIn("see /tmp <b>bold</b> now"), [
		{ url: "/tmp", text: "/tmp" },
	]);
	assert.deepEqual(linksIn("see /tmp<b>bold</b> now"), []);
	/* An emphasis marker abutting a path had no `value` to continue into. */
	assert.deepEqual(linksIn("see **/tmp/notes.md** now"), [
		{ url: "/tmp/notes.md", text: "/tmp/notes.md" },
	]);
});

test("an editor line reference is trimmed on the prose tier too, and the span stops short of it", () => {
	/*
	 * `LINE_REFERENCE` used to be a `file://`-tier rule only, and prose got the
	 * right answer by accident: `/a/run.mjs:59` was refused because its extension
	 * read `mjs:59`. So a real file named in an editor reference had no link, and
	 * the two tiers of one grammar disagreed about what a name is - the same class
	 * of divergence this module exists to prevent.
	 *
	 * The span is asserted, not only the target: a link whose TARGET is the `.mjs`
	 * while its TEXT still covers `:59` would claim a file that does not exist, and
	 * the off-by-one is invisible in the target alone.
	 */
	const text = "see /Users/x/proj/run.mjs:59 here";
	const [span] = targetsIn(text, LINK_POLICY);
	assert.equal(span.target, "/Users/x/proj/run.mjs");
	assert.equal(text.slice(span.start, span.end), "/Users/x/proj/run.mjs");
	/* A range (`:59:12`) is the same suffix. */
	const ranged = "see /Users/x/proj/run.mjs:59:12 here";
	const [rangedSpan] = targetsIn(ranged, LINK_POLICY);
	assert.equal(rangedSpan.target, "/Users/x/proj/run.mjs");
	assert.equal(
		ranged.slice(rangedSpan.start, rangedSpan.end),
		"/Users/x/proj/run.mjs",
	);
	/* And through the plugin, which is what renders the anchor. */
	assert.deepEqual(linksIn(text), [
		{ url: "/Users/x/proj/run.mjs", text: "/Users/x/proj/run.mjs" },
	]);
	/*
	 * The trim is the same rule the `file://` tier already applied, so the two
	 * spellings of one reference now agree - which is the point of one grammar.
	 */
	assert.deepEqual(
		found("see file:///Users/x/proj/run.mjs:59 here", LINK_POLICY),
		["file-url:/Users/x/proj/run.mjs"],
	);
	/*
	 * AND THE `file://` SPAN, which round 1's review R1-3 measured: the TARGET was
	 * right while the span kept the reference, so the anchor's own visible TEXT read
	 * `file:///…/run.mjs:59` and opened `run.mjs`. Both halves are asserted, because
	 * the target alone is what hid it.
	 */
	const urlText = "see file:///Users/x/proj/run.mjs:59 here";
	const [urlSpan] = targetsIn(urlText, LINK_POLICY);
	assert.equal(urlSpan.kind, "file-url");
	assert.equal(urlSpan.target, "/Users/x/proj/run.mjs");
	assert.equal(
		urlText.slice(urlSpan.start, urlSpan.end),
		"file:///Users/x/proj/run.mjs",
	);
	assert.deepEqual(linksIn(urlText), [
		{ url: "/Users/x/proj/run.mjs", text: "file:///Users/x/proj/run.mjs" },
	]);
	/* A range, and a sentence full stop, trim the same way on this tier. */
	const urlRanged = "see file:///Users/x/proj/run.mjs:59:12 here";
	const [urlRangedSpan] = targetsIn(urlRanged, LINK_POLICY);
	assert.equal(
		urlRanged.slice(urlRangedSpan.start, urlRangedSpan.end),
		"file:///Users/x/proj/run.mjs",
	);
	const urlStopped = "see file:///Users/x/proj/run.mjs. here";
	const [urlStoppedSpan] = targetsIn(urlStopped, LINK_POLICY);
	assert.equal(
		urlStopped.slice(urlStoppedSpan.start, urlStoppedSpan.end),
		"file:///Users/x/proj/run.mjs",
	);
	/*
	 * A sentence colon is not a line reference: nothing to trim, nothing lost.
	 */
	assert.deepEqual(found("wrote /tmp/notes.md: and stopped", LINK_POLICY), [
		"path:/tmp/notes.md",
	]);
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
