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
				clickDecision,
				canvasActionFor,
				evidenceFor,
				hasHighlight,
				forgetProbe,
				linkToolbarModel,
				missingNote,
				probeStateFor,
				probeTarget,
				probeTargets,
				resetProbeCache,
				selectionLinkIn,
				selectionWhollyWithin,
				subscribeProbes,
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
	clickDecision,
	canvasActionFor,
	evidenceFor,
	forgetProbe,
	hasHighlight,
	linkToolbarModel,
	missingNote,
	probeStateFor,
	probeTarget,
	probeTargets,
	resetProbeCache,
	selectionLinkIn,
	selectionWhollyWithin,
	subscribeProbes,
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
	/*
	 * REACHABLE, and asserted through the rendered anchor in
	 * `scripts/chat-link-affordances.test.mjs`: round 1 (review M1) found this
	 * branch dead, because `defaultUrlTransform` blanked a hand-written `file:`
	 * href before the component ever saw it. `MarkdownRenderer` now passes a
	 * `urlTransform` that preserves `file:`, so a hand-written
	 * `[report](file:///tmp/a.pdf)` reaches this classifier and gets its toolbar.
	 */
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

test("a percent-encoded plain path is decoded ONCE, at the classifier", () => {
	/*
	 * The rendering layer percent-encodes a link destination (`remark-rehype`'s
	 * `normalizeUri`), so this is the branch a DETECTED link arrives on and the
	 * layer that undoes it (round 1, QA Q-1 and UX U3: Copy copied `%20`s and
	 * `shell.openPath` was handed a string naming no file). The four shapes are
	 * the ones one decode has to survive - and the reason a SECOND decode anywhere
	 * down the line would be a bug rather than belt-and-braces.
	 */
	assert.deepEqual(classifyHref("/tmp/qa-link/a%20b.txt"), {
		kind: "file",
		target: "/tmp/qa-link/a b.txt",
	});
	/* The fixture's own case: macOS's default screenshot name. */
	assert.deepEqual(
		classifyHref(
			"/Users/someone/Downloads/Screenshot%202026-09-17%20at%2010.14.02.png",
		),
		{
			kind: "file",
			target: "/Users/someone/Downloads/Screenshot 2026-09-17 at 10.14.02.png",
		},
	);
	/* A literal `%`: the encoder wrote `%25`, so one decode restores it exactly. */
	assert.deepEqual(classifyHref("/tmp/50%25%20off/notes.txt"), {
		kind: "file",
		target: "/tmp/50% off/notes.txt",
	});
	/* A non-ASCII name, encoded as UTF-8 bytes and decoded back whole. */
	assert.deepEqual(classifyHref("/tmp/caf%C3%A9/r%C3%A9sum%C3%A9.pdf"), {
		kind: "file",
		target: "/tmp/café/résumé.pdf",
	});
	/*
	 * A malformed escape is NOT an escape: `decodeURIComponent` throws, and the
	 * literal is the right answer because `50% off/notes.txt` is a legal file name
	 * the encoder left alone.
	 */
	assert.deepEqual(classifyHref("/tmp/50% off/notes.txt"), {
		kind: "file",
		target: "/tmp/50% off/notes.txt",
	});
	assert.deepEqual(classifyHref("/tmp/a%2"), {
		kind: "file",
		target: "/tmp/a%2",
	});
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
		"javascript:alert(1)",
		"vbscript:msgbox(1)",
	]) {
		assert.equal(classifyHref(href)?.kind, "other", href);
	}
	assert.equal(classifyHref(""), null);
	assert.equal(classifyHref(null), null);
	assert.equal(classifyHref(undefined), null);
});

test("the click decision: a file opens, a drag refuses, everything else default", () => {
	/*
	 * THE TWO TRAPS, asserted where they are decided (round 1, review M3). Neither
	 * can be read off a frame - a still of an opened file and a still of a suppressed
	 * click look the same - and the anchor's own handler is the one place they live,
	 * so the decision was lifted here to be assertable without a browser.
	 * `hold` is the drag-select refusal: `mousedown` and `mouseup` inside one anchor
	 * fire `click`, so a drag over a file link without it would launch an
	 * application mid-gesture. `browse` is everything this app has no answer for:
	 * a URL keeps `target="_blank"`, and a highlight over one does NOT stop that
	 * click, which is the behaviour it had before this change.
	 *
	 * `canOpenInCanvas` is the THIRD input and the operator's ask: a local path this
	 * app has a viewer for, in a pane that has a canvas, opens there on a plain press
	 * rather than in the OS's own application. Both directions are asserted here and
	 * both are needed - the canvas half because it is the new behaviour, and the
	 * fallback half because a change that routed EVERY local path to the canvas would
	 * take a `.zip`, a directory and a `.dmg` away from the OS with the tab as its
	 * only evidence.
	 */
	const clickFor = (input) =>
		clickDecision({ canOpenInCanvas: false, ...input });

	assert.equal(
		clickFor({ kind: "file", hasHighlight: false }),
		"open",
		"no pane in reach: today's OS hand-off",
	);
	assert.equal(
		clickFor({ kind: "file", hasHighlight: false, canOpenInCanvas: true }),
		"canvas",
		"a viewer and a pane: the canvas is what a plain press opens",
	);
	assert.equal(
		clickFor({ kind: "file", hasHighlight: true, canOpenInCanvas: true }),
		"hold",
		"the drag refusal outranks the canvas, as it outranks the OS",
	);
	assert.equal(
		clickFor({ kind: "url", hasHighlight: false, canOpenInCanvas: true }),
		"browse",
		"a URL is never the canvas's, whatever the caller says about viewers",
	);

	assert.equal(clickFor({ kind: "file", hasHighlight: true }), "hold");
	assert.equal(clickFor({ kind: "url", hasHighlight: false }), "browse");
	assert.equal(clickFor({ kind: "url", hasHighlight: true }), "browse");
	assert.equal(clickFor({ kind: "other", hasHighlight: false }), "browse");
	assert.equal(clickFor({ kind: "other", hasHighlight: true }), "browse");
});

/* ------------------------------------------------------------ the toolbar matrix */

/*
 * `canOpenInCanvas: false` is the DEFAULT of both helpers below, because that is
 * the answer everywhere this app renders markdown without a chat pane: the legacy
 * message rows, the trace rows, Storybook, the run panel's child reader. Every
 * case written before this change keeps its old expectation through that default,
 * which is the assertion that "no pane" is still exactly today's matrix.
 */
const modelFor = (input) =>
	linkToolbarModel({
		quotable: false,
		probe: null,
		canOpenInCanvas: false,
		...input,
	});
const canvasModelFor = (input) =>
	linkToolbarModel({
		quotable: false,
		probe: null,
		canOpenInCanvas: true,
		...input,
	});

test("a canvas-openable file offers both opens, and the canvas is the one called Open", () => {
	/*
	 * The operator's ask, as the matrix: "opening up files ... supported by canvas
	 * view by default are opened in the canvas instead of opened by the OS unless
	 * the user clicks to open with default application". So the two presses are both
	 * THERE and they are different places: the id `open` is the canvas, and the OS
	 * gets an id of its own rather than the ambiguity of two buttons whose labels
	 * are the only difference.
	 */
	const model = canvasModelFor({
		kind: "file",
		target: "~/x/report.xlsx",
		probe: { exists: true, isFile: true },
	});
	assert.deepEqual(
		model.actions.map((entry) => entry.id),
		["copy", "open", "open-default", "open-folder", "quote"],
	);
	assert.deepEqual(
		model.actions.map((entry) => entry.label),
		[
			"Copy path",
			"Open in canvas",
			"Open in default app",
			"Open folder",
			"Quote",
		],
	);
	/*
	 * The OS label is the string the canvas's own viewer chrome already ships
	 * (`OpenInOsButton`, `file-viewer-state.tsx`). Asserted literally because a
	 * second spelling for one action is how a reader concludes the two presses
	 * differ.
	 */
	assert.equal(model.label, "Actions for report.xlsx");
});

test("a canvas-openable file leads with Quote when the highlight is inside it", () => {
	assert.deepEqual(
		canvasModelFor({
			kind: "file",
			target: "/tmp/a.pdf",
			probe: { exists: true, isFile: true },
			quotable: true,
		}).actions.map((entry) => entry.id),
		["quote", "copy", "open", "open-default", "open-folder"],
	);
});

test("a DIRECTORY keeps one Open even where a canvas is in reach", () => {
	/*
	 * The veto that a naive `viewerFor` check would miss: a directory named
	 * `notes.md` HAS a viewer by extension and is still not a document, so the
	 * canvas action is off for every directory - and the single `Open` it keeps is
	 * the OS's, which is what opens a folder.
	 */
	const model = canvasModelFor({
		kind: "file",
		target: "~/workspace/opoint-renewal-2026-09-17",
		probe: { exists: true, isFile: false },
	});
	assert.deepEqual(
		model.actions.map((entry) => entry.id),
		["copy", "open", "quote"],
	);
	assert.equal(model.actions[1].label, "Open");
});

test("a file type with no viewer keeps the OS's Open even where a canvas exists", () => {
	/*
	 * `canOpenInCanvas` is FALSE here for the reason it exists: `viewerFor` answers
	 * `null` for a `.zip`, so the caller cannot offer a canvas for it. The matrix is
	 * asserted in that shape as well as through `canvasModelFor`, because the flag is
	 * the caller's answer rather than a re-derivation of the extension list here.
	 */
	const model = modelFor({
		kind: "file",
		target: "~/x/bundle.zip",
		probe: { exists: true, isFile: true },
	});
	assert.deepEqual(
		model.actions.map((entry) => entry.id),
		["copy", "open", "open-folder", "quote"],
	);
	assert.equal(model.actions[1].label, "Open");
});

test("a missing path offers no canvas action, whatever the caller claims", () => {
	const model = canvasModelFor({
		kind: "file",
		target: "~/x/gone.xlsx",
		probe: { exists: false, isFile: false },
	});
	assert.deepEqual(
		model.actions.map((entry) => entry.id),
		["copy", "quote"],
	);
	assert.equal(model.note, "No file at …/x/gone.xlsx");
});

test("a file above the read ceiling keeps the OS shape and says why (round 3, U8a)", () => {
	/*
	 * The strip must not promise a destination the press refuses. The press reads
	 * the eagerly-read kinds itself and returns `false` above `MAX_EAGER_READ_BYTES`
	 * (the store persists document contents), so this file's toolbar loses the canvas
	 * button and keeps the OS one - the same shape a `.zip` has - with the note slot
	 * explaining the absence, because the reader's expectation (set by the operator's
	 * own rule for supported types) is that a `.csv` HAS a canvas.
	 */
	const overCeiling = canvasModelFor({
		kind: "file",
		target: "~/x/enormous.csv",
		probe: { exists: true, isFile: true, sizeBytes: 9_411_130 },
	});
	assert.deepEqual(
		overCeiling.actions.map((entry) => entry.id),
		["copy", "open", "open-folder", "quote"],
		"no canvas action, because the press would refuse this file",
	);
	assert.equal(overCeiling.actions[1].label, "Open");
	assert.equal(overCeiling.note, "Too large for the canvas preview");

	/*
	 * The bytes/range kinds read their own bytes, so the ceiling is not theirs: a
	 * 40 MB PDF is exactly what the canvas is for and keeps its action.
	 */
	const pdf = canvasModelFor({
		kind: "file",
		target: "~/x/annual-report.pdf",
		probe: { exists: true, isFile: true, sizeBytes: 40 * 1024 * 1024 },
	});
	assert.deepEqual(
		pdf.actions.map((entry) => entry.id),
		["copy", "open", "open-default", "open-folder", "quote"],
	);
	assert.equal(pdf.note, null);

	/* And an eagerly-read file BELOW the ceiling is untouched. */
	const small = canvasModelFor({
		kind: "file",
		target: "~/x/quarterly.csv",
		probe: { exists: true, isFile: true, sizeBytes: 623_918 },
	});
	assert.deepEqual(
		small.actions.map((entry) => entry.id),
		["copy", "open", "open-default", "open-folder", "quote"],
	);
	assert.equal(small.note, null);
});

test("the canvas action is one predicate, asked by the matrix and the icon map alike", () => {
	/*
	 * `canvasActionFor` is what keeps the fifth button and the icon that marks it
	 * from drifting: the two cases that are easy to get wrong are here rather than
	 * only inside `linkToolbarModel`, because the toolbar's icon map reads this and
	 * NOT the model's action list.
	 */
	assert.equal(
		canvasActionFor({
			target: "/tmp/x/report.xlsx",
			isDirectory: false,
			probe: { exists: true, isFile: true, sizeBytes: 37_000 },
			canOpenInCanvas: true,
		}),
		true,
	);
	assert.equal(
		canvasActionFor({
			target: "/tmp/x/notes.md",
			isDirectory: true,
			probe: { exists: true, isFile: false },
			canOpenInCanvas: true,
		}),
		false,
	);
	assert.equal(
		canvasActionFor({
			target: "/tmp/x/gone.txt",
			isDirectory: false,
			probe: { exists: false, isFile: false },
			canOpenInCanvas: true,
		}),
		false,
	);
	/*
	 * And the ceiling, which is the fourth of the same kind of veto (round 3,
	 * U8a). What the strip must not do is offer `Open in canvas` for a path the
	 * press will refuse, so the predicate answers `false` for an eagerly-read kind
	 * above `MAX_EAGER_READ_BYTES` - and `true` for the kinds that read their own
	 * bytes at any size, which is what keeps a 40 MB PDF's canvas action.
	 */
	assert.equal(
		canvasActionFor({
			target: "/tmp/x/enormous.csv",
			isDirectory: false,
			probe: { exists: true, isFile: true, sizeBytes: 9_411_130 },
			canOpenInCanvas: true,
		}),
		false,
		"an eagerly-read file above the ceiling must not be offered the canvas",
	);
	assert.equal(
		canvasActionFor({
			target: "/tmp/x/enormous.pdf",
			isDirectory: false,
			probe: { exists: true, isFile: true, sizeBytes: 40_000_000 },
			canOpenInCanvas: true,
		}),
		true,
		"a bytes/range kind is never capped, whatever its size",
	);
	/*
	 * Nothing known is the OPTIMISTIC case, the same direction `probeTarget`
	 * documents: with no answer to stat through, the app has no grounds to withhold
	 * the canvas, and a wrong guess costs one press that reports itself.
	 */
	assert.equal(
		canvasActionFor({
			target: "/tmp/x/report.xlsx",
			isDirectory: false,
			probe: null,
			canOpenInCanvas: true,
		}),
		true,
	);
	assert.equal(
		canvasActionFor({
			target: "/tmp/x/report.xlsx",
			isDirectory: false,
			probe: { exists: true, isFile: true },
			canOpenInCanvas: false,
		}),
		false,
	);
});

test("an unprobed canvas-openable file offers the whole canvas matrix", () => {
	assert.deepEqual(
		canvasModelFor({ kind: "file", target: "/tmp/x.xlsx" }).actions.map(
			(entry) => entry.id,
		),
		["copy", "open", "open-default", "open-folder", "quote"],
	);
});

test("a file offers Copy, Open, Open folder and Quote", () => {
	const model = modelFor({
		kind: "file",
		target: "~/x/report.xlsx",
		probe: { exists: true, isFile: true },
	});
	assert.deepEqual(
		model.actions.map((action) => action.id),
		["copy", "open", "open-folder", "quote"],
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
		["copy", "open", "quote"],
	);
	assert.equal(model.note, null);
});

test("a missing path's reason names the FILE, not the directory", () => {
	/*
	 * Round 1 (design D4) measured the ellipsis eating `report-2026-09-17.pdf` -
	 * the only part of the sentence that distinguishes one missing path from
	 * another - while the directory sat there in full. The directory is what the
	 * rule gives up now, and the full path stays available to the tooltip.
	 */
	assert.deepEqual(missingNote("/tmp/lo-link-missing/report-2026-09-17.pdf"), {
		note: "No file at report-2026-09-17.pdf",
		title: "No file at /tmp/lo-link-missing/report-2026-09-17.pdf",
	});
	/* Short enough for the directory to fit: the pair, not the basename alone. */
	assert.deepEqual(missingNote("/tmp/out/a.pdf"), {
		note: "No file at …/out/a.pdf",
		title: "No file at /tmp/out/a.pdf",
	});
	/* A `~` path keeps its own shape: `~` is a root the app can resolve. */
	assert.deepEqual(missingNote("~/x/gone.pdf"), {
		note: "No file at …/x/gone.pdf",
		title: "No file at ~/x/gone.pdf",
	});
	/* A bare name has no directory to drop. */
	assert.equal(missingNote("report.pdf").note, "No file at report.pdf");
});

test("a missing path offers Copy and Quote, and says why", () => {
	const model = modelFor({
		kind: "file",
		target: "~/x/report.xlsx",
		probe: { exists: false, isFile: false },
	});
	assert.deepEqual(
		model.actions.map((action) => action.id),
		["copy", "quote"],
	);
	assert.equal(model.note, "No file at …/x/report.xlsx");
	assert.equal(model.noteTitle, "No file at ~/x/report.xlsx");
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
		["copy", "open", "open-folder", "quote"],
	);
});

test("a URL offers Copy and Open, and never Open folder", () => {
	const model = modelFor({ kind: "url", target: "https://example.com/a" });
	assert.deepEqual(
		model.actions.map((action) => action.id),
		["copy", "open", "quote"],
	);
	assert.equal(model.label, "Actions for a");
	assert.equal(model.actions[0].label, "Copy link");
	assert.equal(model.actions[1].label, "Open in browser");
});

test("a target this app does not open has no toolbar at all", () => {
	assert.equal(modelFor({ kind: "other", target: "mailto:x@y" }), null);
});

test("Quote leads when the highlight is inside the link, and trails when there is none", () => {
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
	 * that continues their gesture leads. With NOTHING highlighted the same link
	 * still offers Quote - round 2, UX U4: the highlight-inside-a-link state is
	 * not reachable with a mouse, so a Quote that waited for it was dead UI - and
	 * it trails, because a reader who has not chosen is offered the actions on
	 * the link first and the quote of the link's own words last.
	 */
	assert.deepEqual(
		modelFor({
			kind: "file",
			target: "/tmp/a.pdf",
			quotable: false,
		}).actions.map((action) => action.id),
		["copy", "open", "open-folder", "quote"],
	);
	assert.deepEqual(
		modelFor({
			kind: "url",
			target: "https://example.com/a",
			quotable: true,
		}).actions.map((action) => action.id),
		["quote", "copy", "open"],
	);
	assert.deepEqual(
		modelFor({
			kind: "url",
			target: "https://example.com/a",
			quotable: false,
		}).actions.map((action) => action.id),
		["copy", "open", "quote"],
	);
});

/* ----------------------------------------------------------------- the probe */

test("a probe is asked once per target, and its answer is cached", async () => {
	resetProbeCache();
	const asked = [];
	const ask = async (paths) => {
		asked.push(paths);
		return [
			{
				exists: true,
				isFile: true,
				resolved: "/tmp/a.pdf",
				sizeBytes: 1024,
				mtimeMs: 1_760_000_000_000,
			},
		];
	};
	await probeTarget("/tmp/a.pdf", ask);
	await probeTarget("/tmp/a.pdf", ask);
	assert.deepEqual(asked, [["/tmp/a.pdf"]]);
	/*
	 * The whole answer is cached, not the two booleans it started with: the press
	 * that needs the RESOLVED path (the document's identity), the size (the read's
	 * ceiling) and the mtime (the freshness baseline) reads them from here rather
	 * than asking again on the path the reader is waiting on.
	 */
	assert.deepEqual(probeStateFor("/tmp/a.pdf"), {
		exists: true,
		isFile: true,
		resolved: "/tmp/a.pdf",
		sizeBytes: 1024,
		mtimeMs: 1_760_000_000_000,
	});
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
		resolved: "/tmp/gone.pdf",
		sizeBytes: null,
		mtimeMs: null,
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

/* ------------------------------------------------- the grammar's read of the probe */

test("`evidenceFor` answers the grammar's question in three states", async () => {
	/*
	 * The transcript's linkifier decides whether an extensionless token is a LINK
	 * from this function (`TargetPolicy.evidence`), so its three answers are the
	 * difference between an anchor and plain text - and "unknown" is not a
	 * smaller yes: the grammar refuses on it.
	 */
	resetProbeCache();
	assert.equal(evidenceFor("/new"), "unknown", "nothing has asked");
	await probeTarget("/new", async () => [{ exists: false, isFile: false }]);
	assert.equal(evidenceFor("/new"), "missing");
	await probeTarget("/Users/you/workspace", async () => [
		{ exists: true, isFile: false },
	]);
	assert.equal(evidenceFor("/Users/you/workspace"), "exists");
	/*
	 * The same reset the stories use: one cache, so clearing the toolbar's answers
	 * clears the grammar's evidence too and the token demotes to plain text rather
	 * than keeping a claim nobody can now check.
	 */
	resetProbeCache();
	assert.equal(evidenceFor("/new"), "unknown");
	assert.equal(evidenceFor("/Users/you/workspace"), "unknown");
});

test("a batch is deduped, chunked at maxBatch and asked in order", async () => {
	/*
	 * 65 paths with one repeat: one call per `maxBatch` chunk and no call for the
	 * repeat, which is the whole reason this entry point exists rather than a loop
	 * over `probeTarget`. The cap is a PARAMETER rather than `MAX_PROBE_PATHS`
	 * imported here, because this module is bundled by a bare `node --test` file and
	 * importing `desktop-contract` would drag zod in behind it; 64 is the value the
	 * renderer passes.
	 */
	resetProbeCache();
	const asks = [];
	const ask = async (paths) => {
		asks.push(paths);
		return paths.map(() => ({ exists: true, isFile: true }));
	};
	const paths = Array.from(
		{ length: 65 },
		(_, index) => `/tmp/batch/${index}.pdf`,
	);
	await probeTargets([...paths, paths[0]], ask, 64);
	assert.deepEqual(
		asks.map((chunk) => chunk.length),
		[64, 1],
		"one call per chunk, the repeat not asked at all",
	);
	assert.deepEqual(asks[1], ["/tmp/batch/64.pdf"]);
	assert.equal(evidenceFor("/tmp/batch/64.pdf"), "exists");
	/* An answer already in the cache is not asked again, whatever the batch is. */
	asks.length = 0;
	await probeTargets([paths[0], "/tmp/batch/fresh.pdf"], ask, 64);
	assert.deepEqual(asks, [["/tmp/batch/fresh.pdf"]]);
});

test("two askers of one spelling in the same frame cost one call", async () => {
	/*
	 * The shape the transcript produces in bulk: two rows carrying `/tmp` paint in
	 * the same frame, see a cold cache and would both ask. Main stats
	 * SYNCHRONOUSLY on its own event loop, so the duplicate is an app-wide stall
	 * rather than one row's delay - which is why the in-flight set exists on top of
	 * the cache.
	 */
	resetProbeCache();
	let calls = 0;
	let release = () => {};
	const ask = (paths) => {
		calls += 1;
		return new Promise((resolve) => {
			release = () =>
				resolve(paths.map(() => ({ exists: true, isFile: true })));
		});
	};
	const first = probeTargets(["/tmp/dup", "/tmp/other"], ask, 64);
	const second = probeTargets(["/tmp/dup"], ask, 64);
	assert.equal(calls, 1, "the second asker waits on the first");
	release();
	await Promise.all([first, second]);
	assert.equal(calls, 1);
	assert.deepEqual(probeStateFor("/tmp/dup"), { exists: true, isFile: true });
});

test("a landed answer notifies with the spellings it landed, once", async () => {
	/*
	 * The subscription is how the component that owns the parse learns an answer
	 * arrived (it has no prop for this and is memoised), so the PAYLOAD matters as
	 * much as the call: a row armed on three tokens must not re-parse when an
	 * unrelated spelling comes back, and a listener that unsubscribed must not be
	 * called at all.
	 */
	resetProbeCache();
	const landed = [];
	const stop = subscribeProbes((changed) => landed.push([...changed]));
	const ask = async (paths) =>
		paths.map((input) => ({ exists: input !== "/new", isFile: false }));
	await probeTargets(["/new", "/tmp", "/other"], ask, 2);
	assert.deepEqual(landed, [["/new", "/tmp"], ["/other"]]);
	stop();
	await probeTarget("/tmp/after-stop", ask);
	assert.equal(landed.length, 2, "an unsubscribed listener hears nothing");
});

test("a throwing chunk leaves its spellings unknown and warns once", async () => {
	/*
	 * A stat that failed says nothing about whether the file exists, so those
	 * spellings stay `unknown` - which the grammar refuses - rather than being
	 * cached as absent. The warning is per CALL and not per chunk: one broken bridge
	 * is one fact, and a batch of chunks failing is the same fact repeated.
	 */
	resetProbeCache();
	const warnings = [];
	const original = console.warn;
	console.warn = (...args) => warnings.push(args);
	try {
		await probeTargets(
			["/tmp/x.pdf", "/tmp/y.pdf"],
			async () => {
				throw new Error("stat failed");
			},
			1,
		);
	} finally {
		console.warn = original;
	}
	assert.equal(warnings.length, 1);
	assert.equal(probeStateFor("/tmp/x.pdf"), undefined);
	assert.equal(probeStateFor("/tmp/y.pdf"), undefined);
	assert.equal(evidenceFor("/tmp/x.pdf"), "unknown");
	/*
	 * And the failed chunk left the in-flight set clean, so the next asker retries
	 * instead of inheriting a token that is permanently "being asked about".
	 */
	await probeTarget("/tmp/x.pdf", async (paths) =>
		paths.map(() => ({ exists: true, isFile: false })),
	);
	assert.equal(evidenceFor("/tmp/x.pdf"), "exists");
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
