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
 * WHAT THE PRESS CARRIES NOW THAT IT ASKS (`ProbedTarget`). The probe's answer
 * gives the document its three facts that are not the path's spelling: the
 * RESOLVED path (the store's identity rule - see `canvas-document.ts`), the size
 * (what bounds the eager read below), and the mtime (the freshness baseline the
 * canvas compares a later probe against, which is the same field the Files
 * panel's click passes as `readMtimeMs`).
 */

import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { canvasDocumentForPath } from "./canvas-document";
import type { CanvasPane } from "./canvas-pane";
import { getFileTypeFromPath } from "./file-types";
import { getFileName } from "./get-file-name";
import { probeStateFor, probeTarget } from "./link-actions";
import { READ_ENCODING, viewerFor } from "./viewer-routing";

/**
 * The ceiling on the bytes a press reads INTO the document.
 *
 * One mebibyte, and the number is about the store rather than about reading:
 * `canvas-store` persists its documents to `localStorage` with no `partialize`,
 * so a document's `content` is a persisted string, base64 inflates it by about a
 * third, and the whole app shares a quota of roughly 5 MB. Above this the
 * document is opened the way every Files-panel MENTION is opened - a pointer
 * with `sizeBytes` and no bytes - and the viewer reads for itself when the
 * reader looks at it (`canvas-file-viewer.tsx` reads on demand), so the press
 * is neither refused nor persisted at megabyte scale.
 *
 * It is a bound this press needs because a transcript link can name any path an
 * agent wrote; the Files panel's own click makes the same read uncapped, and
 * that is its own change rather than this one's (`docs/design/chat-link-affordances.md`
 * § 10 records the difference).
 */
const MAX_EAGER_READ_BYTES = 1024 * 1024;

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
	/*
	 * ASK WHEN NOTHING IS KNOWN, so the press acts on its own answer rather than on
	 * whatever a hover happened to leave behind.
	 *
	 * The hover normally warms this cache (the toolbar's liveness is learned there,
	 * so a row is not a stat storm), and the kinds that read their own bytes
	 * (`bytes`, `range`) read nothing here at all - so without this a file that
	 * vanished between the reveal and the press opened a tab onto nothing, where
	 * the text kinds correctly refuse and hand the path to the OS. A press can
	 * also arrive with no hover at all: a keyboard activation, a touch, a link
	 * whose strip was never revealed.
	 *
	 * A probe that throws, or a surface with no bridge, leaves the answer unknown,
	 * and unknown is NOT a reason to refuse: the document is built without a
	 * probe's facts and the canvas renders its own state, which is the optimistic
	 * direction `probeTarget` documents.
	 */
	let known = probeStateFor(path);
	if (known === undefined) {
		await probeTarget(path, window.api?.probeFiles);
		known = probeStateFor(path);
	}
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
	 * ONE FILE, ONE DOCUMENT. `~/workspace/x/report.xlsx` and
	 * `/Users/someone/workspace/x/report.xlsx` are the same file, and the store
	 * dedupes by `id` ALONE (`canvas-store.ts`'s `addFileAndSelect`), so the
	 * document is keyed by what the probe resolved the spelling to - the same
	 * string the Files panel's tile for that file already carries
	 * (`use-mentioned-files.ts` rewrites every tile to `result.resolved`).
	 * Without this the panel and the transcript put two tabs on one file.
	 */
	const identity = known?.resolved ?? path;

	/*
	 * The same split the panel's click makes: the text kinds are read here, so the
	 * document carries its bytes, and the kinds that read their own (`bytes`,
	 * `range`) are handed over without them - a PDF's 40 MB must never become a
	 * base64 string in a store that is persisted to `localStorage`.
	 *
	 * The read is bounded twice, both times because the press now holds the probe's
	 * answer. It is SKIPPED when the document is already open - the store keeps
	 * the entry it has, so re-reading would read bytes nobody looks at - and it is
	 * skipped above `MAX_EAGER_READ_BYTES`, where the document is opened as a
	 * pointer and its viewer reads on demand.
	 */
	const encoding = READ_ENCODING[kind];
	let content: string | undefined;
	if (encoding === "utf-8" || encoding === "base64") {
		const read = window.api?.readFile;
		// No bridge at all (Storybook, browser development): nothing to open with,
		// and no reason to claim a document whose bytes nobody read.
		if (typeof read !== "function") return false;
		const alreadyOpen = (
			useCanvasStore.getState().conversations[conversationId]?.files ?? []
		).some((file) => file.id === identity);
		const aboveCap = (known?.sizeBytes ?? 0) > MAX_EAGER_READ_BYTES;
		if (!alreadyOpen && !aboveCap) {
			const result = await read(path, encoding);
			if (!result.success) return false;
			content = result.data;
		}
	}

	const document = canvasDocumentForPath(identity, {
		title: getFileName(identity),
		type,
		content,
		/*
		 * The probe's own facts, on the same contract the Files panel's click uses
		 * (`canvas/index.tsx`'s tile handler passes the same three): `availability`
		 * is what stops the canvas asking about a file it already knows is there,
		 * `sizeBytes` is what lets a viewer pre-state "too large" instead of
		 * discovering it while reading, and `readMtimeMs` is the freshness baseline
		 * - set only when bytes were actually read, because a pointer's baseline
		 * belongs to whoever reads it.
		 */
		...(known?.exists && known.isFile ? { availability: "present" as const } : {}),
		...(known?.sizeBytes != null ? { sizeBytes: known.sizeBytes } : {}),
		...(known?.mtimeMs != null ? { lastAgentModified: known.mtimeMs } : {}),
		...(content !== undefined && known?.mtimeMs != null
			? { readMtimeMs: known.mtimeMs }
			: {}),
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
