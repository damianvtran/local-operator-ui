/**
 * Opening a transcript's path in the pane's own canvas, once.
 *
 * A link the agent wrote and the Files panel's tile are the same kind of
 * instruction - "put this file on screen" - and until this module the only
 * implementation of it for a transcript was the OS hand-off
 * (`openLocalTarget`). This is the canvas half: the document, the prefs write
 * that claims the right-hand slot, and the store write that opens the tab,
 * assembled the way the dev driver assembles it
 * (`dev-driver/install.ts`'s `openCanvasDocument`) and the way the panel's own
 * click does.
 *
 * WHY THIS IS NOT A LIFT OF THE FILES PANEL'S CLICK, WHICH IS THE OTHER CALLER
 * THAT OPENS A PATH IN THIS CANVAS. Three of that handler's parts are not this
 * one's, and lifting them together would have changed what the panel does:
 *
 * - its store write REPLACES an existing entry (`setFiles` with a new array)
 *   rather than skipping it, on purpose: a tile re-opened after an agent
 *   rewrote the file must show the new bytes, which is what
 *   `canvas-file-freshness` fixed. `addFileAndSelect` - the action every other
 *   opener uses, including the driver's - keeps the entry it already has, and
 *   an opened-once document is the right thing for a transcript press to keep;
 * - it carries the TILE's own facts onto the document (`fileDoc.availability`,
 *   `fileDoc.sizeBytes`), and its "this is no longer there" toast is worded for
 *   a tile the reader was looking at. A link has no tile and no tile state;
 * - it falls back to the OS through a local `fallbackAction` that swallows the
 *   reason, where a link's fallback is `openLocalTarget` and reports itself.
 *
 * THE PROBE IS THE CACHE, AND THAT IS A DELIBERATE BOUND rather than an
 * oversight. A press that arrived on a link the reader hovered has that path's
 * answer already (`link-actions.ts` caches it on reveal, and the toolbar's
 * liveness is learned there so a row is not a stat storm), so this reads it and
 * does not ask again. `null` - nothing known - is NOT treated as a reason to
 * refuse: the document is built without a probe's facts and the canvas renders
 * its own state, which is the optimistic direction `probeTarget` documents.
 * What the cached answer is used for is the one case where opening would be a
 * lie: a path the probe already knows is not a file (a directory, or one that
 * is gone) gets no tab, and the caller keeps today's OS behaviour instead.
 *
 * The freshness baseline is one thing this does NOT carry: `readMtimeMs` and
 * `sizeBytes` come from a probe answer, and the cached one is two booleans
 * (`ProbedTarget`). So a document opened from a link is built the way ⌘O's is
 * (`canvas/index.tsx`'s `handleOpenFile`, which also has no probe), and its
 * blob cache key is `file:<path>:0` until the viewer re-reads. Stated rather
 * than implied: making it carry the mtime means either a probe round-trip per
 * press or widening the probe cache, and neither is this change's to make.
 */

import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { canvasDocumentForPath } from "./canvas-document";
import type { CanvasPane } from "./canvas-pane";
import { getFileTypeFromPath } from "./file-types";
import { getFileName } from "./get-file-name";
import { probeStateFor } from "./link-actions";
import { READ_ENCODING, viewerFor } from "./viewer-routing";

/**
 * Whether this pane can show this path at all.
 *
 * TWO FACTS, and both belong to the caller: whether a pane is in reach (the
 * context's own answer, which is `null` on every surface with no pane identity),
 * and whether the app has a viewer for the type (`viewerFor`'s `null`, the
 * documented "hand it to the OS"). A directory, a `.zip`, a `.dmg` and an
 * unknown binary therefore answer `false` here, which is what keeps them on
 * today's click.
 */
export const opensInCanvas = (
	pane: CanvasPane | null,
	path: string | null,
): boolean => pane !== null && path !== null && viewerFor(path) !== null;

/**
 * Open a local path in `conversationId`'s canvas, or answer `false` and leave
 * the caller to do what this app did before the canvas had a say.
 *
 * The answer is the whole contract, and the caller's fallback is the reason it
 * exists: a refusal is not an error to report, it is the instruction to hand the
 * path to the OS, which is what a reader gets for a `.zip`, a directory and a
 * file the probe says is gone.
 */
export async function openPathInCanvas(
	conversationId: string,
	path: string,
): Promise<boolean> {
	const known = probeStateFor(path);
	/*
	 * A path the probe has already answered for is only a document if it is a
	 * FILE that is THERE. A directory has no viewer state to open into, and a
	 * missing path's tab would open onto a "not there" viewer - a dead tab, which
	 * is worse than the OS attempt and its sentence.
	 */
	if (known && (!known.exists || !known.isFile)) return false;

	const type = getFileTypeFromPath(path);
	const kind = viewerFor(path, type);
	if (kind === null) return false;

	/*
	 * The same split the panel's click makes: the text kinds are read here, so the
	 * document carries its bytes, and the kinds that read their own (`bytes`,
	 * `range`) are handed over without them - a PDF's 40 MB must never become a
	 * base64 string in a store that is persisted to `localStorage`.
	 */
	const encoding = READ_ENCODING[kind];
	let content: string | undefined;
	if (encoding === "utf-8" || encoding === "base64") {
		const read = window.api?.readFile;
		// No bridge at all (Storybook, browser development): nothing to open with,
		// and no reason to claim a document whose bytes nobody read.
		if (typeof read !== "function") return false;
		const result = await read(path, encoding);
		if (!result.success) return false;
		content = result.data;
	}

	const document = canvasDocumentForPath(path, {
		title: getFileName(path),
		type,
		content,
	});
	/*
	 * The slot first, the tab second: `setCanvasOpen(true)` is what claims the
	 * right-hand pane (closing the run/browser panes, which is the app's own rule
	 * for that slot), and a document selected into a canvas nobody can see is the
	 * shape this ordering exists to prevent.
	 */
	useUiPreferencesStore.getState().setCanvasOpen(true);
	useCanvasStore.getState().addFileAndSelect(conversationId, document);
	return true;
}
