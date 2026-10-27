import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

/*
 * The Team Bridge row-layout fix keeps its two load-bearing pieces, and the
 * emoji warm-up keeps its gate.
 *
 * WHY THIS EXISTS (agent review round 1, M1 and m1). The layout fix's proof
 * lives in Storybook `play` functions, and no CI job runs those, so nothing in
 * a gate fails if the fix is reverted. Worse, the page-timeline board could not
 * fail even in Storybook: `origin/main` already includes the block wrapper
 * there, so `LongContentRowsStayInColumn` passes with the fix reverted, and the
 * thread pane - the ONLY code whose behaviour this fix changes - had no test at
 * all.
 *
 * WHAT THIS PINS, AND WHAT IT CANNOT: it reads the source, so it cannot tell
 * whether Radix's content wrapper really lays out as a block; the after frames
 * and the geometry readback in the PR answer that. This is what fails when the
 * class is dropped in a refactor - which is how a `display: table` wrapper
 * comes back unnoticed, since nothing visually breaks until one message carries
 * a wide code block.
 */
const THREAD_PANE =
	"src/renderer/src/features/team-bridge/team-bridge-thread-pane.tsx";
const PAGE = "src/renderer/src/features/team-bridge/team-bridge-page.tsx";
const LIST =
	"src/renderer/src/features/team-bridge/team-bridge-message-list.tsx";
const SUPPORT =
	"src/renderer/src/features/team-bridge/team-bridge-emoji-support.ts";

/**
 * Radix renders its content inside a `<div>` that it styles
 * `display: table; min-width: 100%`. A table box grows to the min-content of
 * its contents, so one `pre` or one wide `table` - which scrolls itself via
 * `overflow-x: auto`, and an overflow container still contributes its
 * min-content width - widens the wrapper past the viewport. Every row's hover
 * ground and the toolbar floated at the content column's end edge then draw
 * outside the pane. `>div]:block!` is the page timeline's existing override and
 * the fix this PR ports to the thread pane.
 */
const BLOCK_WRAPPER = "[&_[data-radix-scroll-area-viewport]>div]:block!";
const LIST_WIDTH = /<ol className="[^"]*\bw-full\b[^"]*\bmin-w-0\b/;
const ROW_WIDTH = /"group\/message relative flex w-full min-w-0 gap-3/;
const SELF_START = /\bself-start\b/;
const WARM_UP_GATE =
	/if \(!TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD\) return;/;

const source = (path) => readFileSync(path, "utf8");

/**
 * The opening tag starting at `index`, up to and including its `>`.
 * Quote-aware: Tailwind's arbitrary variants contain `>` themselves
 * (`[&_[data-radix-scroll-area-viewport]>div]:block!`), so the first `>` in the
 * text is not the end of the tag.
 */
const openingTag = (text, index) => {
	let quote = "";
	for (let i = index; i < text.length; i++) {
		const char = text[i];
		if (quote) {
			if (char === quote) quote = "";
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === ">") {
			return text.slice(index, i + 1);
		}
	}
	assert.fail(`unterminated tag at ${index}`);
};

test("the thread pane lays Radix's content wrapper out as a block", () => {
	const pane = source(THREAD_PANE);
	const at = pane.indexOf("<ScrollArea");
	assert.notEqual(at, -1, "the thread pane still scrolls in a ScrollArea");
	const tag = openingTag(pane, at);
	assert.ok(
		tag.includes(BLOCK_WRAPPER),
		`the thread pane's ScrollArea lost ${BLOCK_WRAPPER}, so Radix's display:table wrapper grows to the min-content of a wide code block or table again (${tag})`,
	);
});

test("the page timeline keeps the same block wrapper", () => {
	// The page had this before the fix; the two hosts must not diverge again.
	const page = source(PAGE);
	assert.equal(
		page.split(BLOCK_WRAPPER).length - 1,
		2,
		"both page ScrollAreas (timeline and rail) still override the wrapper",
	);
});

test("message rows and their list take the viewport's width, not their content's", () => {
	const list = source(LIST);
	assert.match(
		list,
		LIST_WIDTH,
		"the timeline list must be the viewport's width (w-full min-w-0)",
	);
	assert.match(
		list,
		ROW_WIDTH,
		"every row must be the viewport's width (w-full min-w-0)",
	);
});

test("the empty-DM trigger hugs its mark instead of stretching to the pane", () => {
	const page = source(PAGE);
	const at = page.indexOf("data-draft-avatar");
	assert.notEqual(at, -1, "the draft header still marks its avatar trigger");
	const tag = openingTag(page, page.lastIndexOf("<button", at));
	// A stretched <button> is `align-self: stretch` by default in a flex column,
	// and the UA's `text-align: center` for buttons then centres the plate over
	// left-aligned text. `self-start` is what holds it to the text block's edge.
	assert.match(
		tag,
		SELF_START,
		`the draft avatar trigger must not stretch to the pane width (${tag})`,
	);
});

test("the emoji warm-up only runs where the picker can open", () => {
	// The toolbar, picker and chips all return null while reactions are held, so
	// an unguarded warm-up spends the operator's first load on a cache nothing in
	// this build can read (agent review round 1, m1).
	const list = source(LIST);
	const at = list.indexOf("warmEmojiProbeCache(");
	assert.notEqual(at, -1, "the list still warms the probe cache");
	const caller = list.slice(Math.max(0, at - 600), at);
	assert.match(
		caller,
		WARM_UP_GATE,
		"the warm-up must return before scheduling anything while reactions are held",
	);
});

/*
 * The helper's once-per-module guarantee, exercised against the real module.
 * `team-bridge-emoji-support.ts` imports nothing, so a type-stripped copy is
 * enough: no seams, no bundler configuration, and the canvas probe itself falls
 * back to `false` outside a DOM (its own `try`/`catch`), which is exactly the
 * path a headless run takes.
 */
test("the warm-up runs once per module, whatever mounts later", async () => {
	const { code } = await transform(source(SUPPORT), {
		loader: "ts",
		format: "esm",
	});
	const module = await import(
		`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
	);
	const realSetTimeout = globalThis.setTimeout;
	let scheduled = 0;
	globalThis.setTimeout = (fn, ms, ...rest) => {
		scheduled++;
		return realSetTimeout(fn, ms, ...rest);
	};
	try {
		const corpus = Array.from({ length: 64 }, (_, i) => `e${i}`);
		module.warmEmojiProbeCache(corpus);
		assert.equal(scheduled, 1, "the first caller schedules the first slice");
		// Let the walk finish, then mount a second list the way the thread pane
		// does. Without the module flag this schedules a second walk of the same
		// fixed corpus.
		await new Promise((resolve) => realSetTimeout(resolve, 200));
		const before = scheduled;
		module.warmEmojiProbeCache(corpus);
		assert.equal(
			scheduled,
			before,
			"a later mount must not schedule a walk of the corpus it has already probed",
		);
	} finally {
		globalThis.setTimeout = realSetTimeout;
	}
});
