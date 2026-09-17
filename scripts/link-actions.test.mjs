import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * What a link IS, and what may be done with it — asserted rather than judged from
 * a frame.
 *
 * The frame shows the toolbar that a hover or a highlight produced. It cannot
 * show the four states that produce a DIFFERENT toolbar (existing file,
 * directory, missing path, no probe bridge at all), the press that is deliberately
 * not offered, or the strings that must never become a link in the first place.
 * Those are the rules of `link-actions.ts`, and they are pure functions of an href
 * and a probe's answer, so they are asserted here.
 *
 * It also pins the SELECTION rule the two toolbars are chosen by
 * (`selectionWhollyWithin`), whose boundaries are the ones that decide whether a
 * quote is attributed to a link or to the turn — `scripts/message-quote.test.mjs`
 * owns the rest of that rule and asserts the exclusion its `QUOTE_TOOLKIT_ATTR`
 * half depends on.
 */

const bundle = await build({
	stdin: {
		contents: `
			export {
				classifyHref,
				hasHighlight,
				forgetProbe,
				linkToolbarModel,
				probeStateFor,
				probeTarget,
				resetProbeCache,
				selectionLinkIn,
				selectionWhollyWithin,
				shouldOpenOnClick,
				LINK_TARGET_ATTR,
			} from "./src/renderer/src/features/chat/utils/link-actions";
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

/* `linkAncestorOf` tests `nodeType` against `Node.ELEMENT_NODE`; node has no DOM. */
globalThis.Node = { ELEMENT_NODE: 1 };

const {
	classifyHref,
	forgetProbe,
	hasHighlight,
	linkToolbarModel,
	probeStateFor,
	probeTarget,
	resetProbeCache,
	selectionLinkIn,
	selectionWhollyWithin,
	shouldOpenOnClick,
	LINK_TARGET_ATTR,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/* ------------------------------------------------------------- classifyHref */

test("an href is classified by its own shape", () => {
	assert.deepEqual(classifyHref("https://example.com/a/b.pdf"), {
		kind: "url",
		target: "https://example.com/a/b.pdf",
	});
	assert.deepEqual(classifyHref("http://localhost:1111/v1/static"), {
		kind: "url",
		target: "http://localhost:1111/v1/static",
	});
	assert.deepEqual(classifyHref("/Users/x/report.xlsx"), {
		kind: "file",
		target: "/Users/x/report.xlsx",
	});
	assert.deepEqual(classifyHref("~/workspace/proj"), {
		kind: "file",
		target: "~/workspace/proj",
	});
});

test("a file:// href is decoded to a path, and a foreign host stays other", () => {
	assert.deepEqual(classifyHref("file:///Users/x/My%20Docs/a.pdf"), {
		kind: "file",
		target: "/Users/x/My Docs/a.pdf",
	});
	assert.deepEqual(classifyHref("file://localhost/tmp/a.pdf"), {
		kind: "file",
		target: "/tmp/a.pdf",
	});
	/*
	 * `file://other-host/share` names another machine's share. Opening it would
	 * be a press that fails inside Finder, so it keeps the behaviour it had -
	 * which is what `other` means everywhere in this module.
	 */
	assert.equal(classifyHref("file://other-host/share/a.pdf")?.kind, "other");
});

test("everything this app does not open is `other`, not a file", () => {
	for (const href of [
		"notes.md",
		"./src/foo.ts",
		"src/foo.ts",
		"mailto:damian@example.com",
		"ftp://host/a.pdf",
		"tel:+1234",
		"data:text/plain,hello",
	]) {
		assert.equal(classifyHref(href)?.kind, "other", href);
	}
	assert.equal(classifyHref(""), null);
	assert.equal(classifyHref(null), null);
	assert.equal(classifyHref(undefined), null);
});

test("only a local file is the app's own click to handle", () => {
	assert.equal(shouldOpenOnClick("file"), true);
	/* A URL keeps `target="_blank"` into `openExternal`; `other` is untouched. */
	assert.equal(shouldOpenOnClick("url"), false);
	assert.equal(shouldOpenOnClick("other"), false);
});

/* ------------------------------------------------------------ the toolbar matrix */

const modelFor = (input) =>
	linkToolbarModel({ quotable: false, probe: null, ...input });

test("a file offers Copy, Open and Open folder", () => {
	const model = modelFor({
		kind: "file",
		target: "~/x/report.xlsx",
		probe: { exists: true, isFile: true },
	});
	assert.deepEqual(
		model.actions.map((action) => action.id),
		["copy", "open", "open-folder"],
	);
	assert.equal(model.note, null);
	assert.equal(model.label, "Actions for report.xlsx");
});

test("a directory offers Open and drops Open folder", () => {
	/*
	 * `shell.showItemInFolder` on a directory selects the directory's PARENT, so
	 * the reader would watch Finder reveal somewhere they did not ask for. The
	 * press that is missing is missing on purpose, and no note is needed: a
	 * directory is not a failure.
	 */
	const model = modelFor({
		kind: "file",
		target: "~/workspace/opoint-renewal-2026-09-17",
		probe: { exists: true, isFile: false },
	});
	assert.deepEqual(
		model.actions.map((action) => action.id),
		["copy", "open"],
	);
	assert.equal(model.note, null);
});

test("a missing path offers Copy only, and says why", () => {
	const model = modelFor({
		kind: "file",
		target: "~/x/report.xlsx",
		probe: { exists: false, isFile: false },
	});
	assert.deepEqual(
		model.actions.map((action) => action.id),
		["copy"],
	);
	assert.equal(model.note, "No file at ~/x/report.xlsx");
});

test("an unprobed path offers the whole matrix", () => {
	/*
	 * `null` is "nothing is known", and the direction is deliberate: with no
	 * bridge to stat through (Storybook, a browser), disabling Open would be the
	 * app asserting that a path the reader can see does not exist.
	 */
	assert.deepEqual(
		modelFor({ kind: "file", target: "/tmp/x", probe: null }).actions.map(
			(action) => action.id,
		),
		["copy", "open", "open-folder"],
	);
});

test("a URL offers Copy and Open, and never Open folder", () => {
	const model = modelFor({ kind: "url", target: "https://example.com/a" });
	assert.deepEqual(
		model.actions.map((action) => action.id),
		["copy", "open"],
	);
	assert.equal(model.label, "Actions for a");
	assert.equal(model.actions[0].label, "Copy link");
	assert.equal(model.actions[1].label, "Open in browser");
});

test("a target this app does not open has no toolbar at all", () => {
	assert.equal(modelFor({ kind: "other", target: "mailto:x@y" }), null);
});

test("Quote leads when the highlight is inside the link, and is absent otherwise", () => {
	const quotable = modelFor({
		kind: "file",
		target: "/tmp/a.pdf",
		probe: { exists: true, isFile: true },
		quotable: true,
	});
	assert.deepEqual(
		quotable.actions.map((action) => action.id),
		["quote", "copy", "open", "open-folder"],
	);
	/*
	 * The reader has already chosen the thing they are acting on, so the press
	 * that continues their gesture leads; and with nothing highlighted the same
	 * link offers no Quote at all, because there is nothing to carry.
	 */
	assert.deepEqual(
		modelFor({
			kind: "file",
			target: "/tmp/a.pdf",
			quotable: false,
		}).actions.map((action) => action.id),
		["copy", "open", "open-folder"],
	);
	assert.deepEqual(
		modelFor({
			kind: "url",
			target: "https://example.com/a",
			quotable: true,
		}).actions.map((action) => action.id),
		["quote", "copy", "open"],
	);
});

/* ----------------------------------------------------------------- the probe */

test("a probe is asked once per target, and its answer is cached", async () => {
	resetProbeCache();
	const asked = [];
	const ask = async (paths) => {
		asked.push(paths);
		return [{ exists: true, isFile: true }];
	};
	await probeTarget("/tmp/a.pdf", ask);
	await probeTarget("/tmp/a.pdf", ask);
	assert.deepEqual(asked, [["/tmp/a.pdf"]]);
	assert.deepEqual(probeStateFor("/tmp/a.pdf"), { exists: true, isFile: true });
	// Two spellings of one file are two keys: the toolbar acts on the string the
	// reader is looking at, and the second is not asked on the first's answer.
	await probeTarget("~/x/a.pdf", ask);
	assert.equal(asked.length, 2);
});

test("a negative is cached too, and a failed press is what clears it", async () => {
	resetProbeCache();
	await probeTarget("/tmp/gone.pdf", async () => [
		{ exists: false, isFile: false },
	]);
	assert.deepEqual(probeStateFor("/tmp/gone.pdf"), {
		exists: false,
		isFile: false,
	});
	/*
	 * The recovery the app has: `openLocalTarget` drops the entry when the press
	 * on it fails, so the next reveal asks again rather than repeating an answer
	 * that just proved itself wrong.
	 */
	forgetProbe("/tmp/gone.pdf");
	assert.equal(probeStateFor("/tmp/gone.pdf"), undefined);
});

test("no bridge and a throwing bridge both leave the answer unknown", async () => {
	resetProbeCache();
	await probeTarget("/tmp/a.pdf", undefined);
	assert.equal(probeStateFor("/tmp/a.pdf"), undefined);
	await probeTarget("/tmp/b.pdf", async () => {
		throw new Error("stat failed");
	});
	/* A stat that failed says nothing about whether the file exists, so it is
	   NOT cached as a negative - the same rule `use-mentioned-files` states for
	   its tiles. */
	assert.equal(probeStateFor("/tmp/b.pdf"), undefined);
});

/* ------------------------------------------------- the selection-in-link rule */

/** The smallest tree these rules read: identity, containment, ancestry. */
const node = (tag, parent = null, attrs = {}) => {
	const self = {
		nodeType: 1,
		tagName: tag,
		parentElement: parent,
		closest: (selector) => {
			if (selector === `[${LINK_TARGET_ATTR}]` && self.attrs.kind) return self;
			return parent ? parent.closest(selector) : null;
		},
		contains: (other) => {
			for (let at = other; at; at = at.parentElement) {
				if (at === self) return true;
			}
			return false;
		},
		attrs,
	};
	return self;
};

/** The reader's highlight between two fake endpoints. */
const highlight = (start, end, collapsed = false) => {
	const range = {
		startContainer: start,
		endContainer: end,
		collapsed,
		toString: () => "text",
	};
	globalThis.window = {
		getSelection: () => ({
			rangeCount: 1,
			isCollapsed: collapsed,
			getRangeAt: () => range,
			toString: () => range.toString(),
		}),
	};
	return range;
};

const noSelection = () => {
	globalThis.window = {
		getSelection: () => ({
			rangeCount: 0,
			isCollapsed: true,
			getRangeAt: () => null,
			toString: () => "",
		}),
	};
};

test("a highlight inside one link is that link's, whole or part", () => {
	const turn = node("div");
	const linkA = node("a", turn, { kind: "file" });
	const textA = node("span", linkA);
	const linkB = node("a", turn, { kind: "file" });
	const textB = node("span", linkB);

	highlight(textA, textA);
	assert.equal(selectionLinkIn(turn), linkA);
	assert.equal(selectionWhollyWithin(linkA), true);
	assert.equal(selectionWhollyWithin(linkB), false);

	// A highlight whose endpoints are the anchor itself - what a drag built from
	// the element boundary produces - is still that link's.
	highlight(linkA, linkA);
	assert.equal(selectionWhollyWithin(linkA), true);
	assert.equal(hasHighlight(), true);
});

test("every spanning shape answers no, so the turn keeps the quote", () => {
	const turn = node("div");
	const linkA = node("a", turn, { kind: "file" });
	const textA = node("span", linkA);
	const linkB = node("a", turn, { kind: "file" });
	const textB = node("span", linkB);
	const prose = node("span", turn);

	// Two links in one turn.
	highlight(textA, textB);
	assert.equal(selectionLinkIn(turn), null);
	assert.equal(selectionWhollyWithin(linkA), false);

	// A link and the prose beside it.
	highlight(textA, prose);
	assert.equal(selectionLinkIn(turn), null);
	assert.equal(selectionWhollyWithin(linkA), false);

	// A collapsed caret, which is not a highlight at all.
	highlight(textA, textA, true);
	assert.equal(selectionLinkIn(turn), null);
	assert.equal(hasHighlight(), false);
	assert.equal(selectionWhollyWithin(linkA), false);

	// No highlight, and no selection object.
	noSelection();
	assert.equal(selectionLinkIn(turn), null);
	assert.equal(selectionWhollyWithin(linkA), false);
	assert.equal(hasHighlight(), false);

	// An endpoint on a toolbar is outside every link, so the answer is no: the
	// toolbars carry `QUOTE_TOOLKIT_ATTR` and no link marker
	// (`scripts/message-quote.test.mjs` pins the exclusion itself).
	const toolbar = node("div", turn, {});
	highlight(textA, toolbar);
	assert.equal(selectionLinkIn(turn), null);
});

test("a highlight in another turn is not this turn's link", () => {
	const turnA = node("div");
	const linkA = node("a", turnA, { kind: "file" });
	const textA = node("span", linkA);
	const turnB = node("div");
	const linkB = node("a", turnB, { kind: "file" });
	const textB = node("span", linkB);

	highlight(textB, textB);
	assert.equal(selectionLinkIn(turnA), null);
	assert.equal(selectionLinkIn(turnB), linkB);
	assert.equal(selectionLinkIn(null), null);
});
