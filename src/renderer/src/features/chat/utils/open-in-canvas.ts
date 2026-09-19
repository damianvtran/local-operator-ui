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
 * THE PRESS ASKS FOR ITSELF, AND THE CACHE IS ONLY ITS FALLBACK (`askFresh`). A
 * hover warms `link-actions.ts`'s cache - the toolbar's liveness is learned there
 * so a row is not a stat storm - but a cached positive is a fact about a MOMENT,
 * and round 2's QA found the cost of trusting it: hover a link, delete the file,
 * press it, and the stale `exists: true` opened a tab onto nothing where the fresh
 * answer refuses and hands the path to the OS. The cache is read here for exactly
 * two things: the fallback when there is no bridge to ask, and the facts that come
 * with an answer (the resolved spelling, the size, the mtime).
 *
 * `null` - nothing known at all - is NOT treated as a reason to refuse: the
 * document is built without a probe's facts and the canvas renders its own state,
 * which is the optimistic direction `probeTarget` documents.
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
import { type ProbedTarget, forgetProbe, probeStateFor } from "./link-actions";
import {
	MAX_EAGER_READ_BYTES,
	READ_ENCODING,
	viewerFor,
} from "./viewer-routing";

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
 * Ask the bridge about ONE path, freshly, and answer `null` when there is no
 * bridge or the ask failed.
 *
 * NOT `probeTarget`, deliberately: that one answers from the cache when it has an
 * entry, which is the right economy for a hover that repeats and the wrong answer
 * for a press. A cached positive is a fact about a moment that has passed (round
 * 2, QA R2-2: hover, delete, press still opened a dead tab for the kinds that read
 * nothing here), so the press asks for itself and the cache is only what it falls
 * back to when the ask cannot happen at all.
 */
async function askFresh(path: string): Promise<ProbedTarget> {
	const ask = window.api?.probeFiles;
	if (typeof ask !== "function") return null;
	try {
		const [answer] = await ask([path]);
		if (!answer) return null;
		return {
			exists: answer.exists,
			isFile: answer.isFile,
			resolved: answer.resolved ?? path,
			sizeBytes: answer.sizeBytes ?? null,
			mtimeMs: answer.mtimeMs ?? null,
		};
	} catch (error) {
		console.warn("probe-files failed:", error);
		return null;
	}
}

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
	 * THE PRESS ASKS FOR ITSELF, EVERY TIME, and the cached answer is only the
	 * fallback for a surface with no bridge or an ask that failed.
	 *
	 * A hover warms the cache; a cached positive is therefore a fact about a moment
	 * that has passed, and round 1's own repro (hover the link, delete the file,
	 * press it) went on opening a dead tab for every kind that reads nothing here -
	 * the stale `exists: true` passed the guard. Asking costs one stat (0.0-0.3 ms on
	 * QA's rig) and buys the honest answer: refuse, and let the caller hand the path
	 * to the OS with its sentence.
	 *
	 * The stale entry is dropped when the fresh answer disagrees with it, because
	 * the toolbar's own strip is drawn from the cache and would otherwise keep
	 * offering `Open in canvas` for a file that is gone; the next reveal re-probes
	 * (`forgetProbe`'s documented recovery).
	 */
	const asked = await askFresh(path);
	const known = asked ?? probeStateFor(path);
	/*
	 * A path the probe has answered for is only a document if it is a FILE that is
	 * THERE. A directory has no viewer state to open into, and a missing path's tab
	 * would open onto a "not there" viewer - a dead tab, which is worse than the OS
	 * attempt and its sentence. Applied to the FRESH answer first, so a file that
	 * vanished after the hover is refused rather than trusted.
	 */
	if (asked && (!asked.exists || !asked.isFile)) {
		forgetProbe(path);
		return false;
	}
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
	 * AN OPEN DOCUMENT WINS OVER EVERYTHING BELOW (review round 3, U8b).
	 *
	 * The document may already be in this pane's canvas - the Files panel's own
	 * click reads uncapped, so a 9 MB spreadsheet can be sitting there open - and a
	 * press on its link must SELECT it, not refuse it. The refusal below is about
	 * what this press can BUILD; a document that is already built has nothing to do
	 * with the ceiling, and refusing here would send a reader who is looking at the
	 * file to the OS to open the same file again. It runs before the cap check for
	 * the same reason, and it re-selects the EXISTING document rather than a freshly
	 * built one: the store keeps the entry it has, so passing the live object back is
	 * what keeps the reader's own edits and the viewer's own read in place.
	 */
	const open = useCanvasStore.getState().conversations[conversationId];
	const existing = (open?.files ?? []).find((file) => file.id === identity);
	if (existing) {
		useUiPreferencesStore.getState().setCanvasOpen(true);
		useCanvasStore.getState().addFileAndSelect(conversationId, existing);
		return true;
	}

	/*
	 * The same split the panel's click makes: the text kinds are read here, so the
	 * document carries its bytes, and the kinds that read their own (`bytes`,
	 * `range`) are handed over without them - a PDF's 40 MB must never become a
	 * base64 string in a store that is persisted to `localStorage`.
	 *
	 * Above `MAX_EAGER_READ_BYTES` the press REFUSES, and that is the whole contract:
	 * a document without bytes is an empty sheet, an empty editor and - leaving a
	 * spreadsheet - a `Workbook is empty` throw that takes the window into the error
	 * boundary, so there is no version of "open it anyway" worth handing over. The
	 * ceiling is exported by `viewer-routing.ts` and read by the toolbar too, so the
	 * strip does not offer a destination this `return false` would not reach.
	 */
	const encoding = READ_ENCODING[kind];
	let content: string | undefined;
	if (encoding === "utf-8" || encoding === "base64") {
		const read = window.api?.readFile;
		// No bridge at all (Storybook, browser development): nothing to open with,
		// and no reason to claim a document whose bytes nobody read.
		if (typeof read !== "function") return false;
		if ((known?.sizeBytes ?? 0) > MAX_EAGER_READ_BYTES) return false;
		const result = await read(path, encoding);
		if (!result.success) return false;
		content = result.data;
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
		...(known?.exists && known.isFile
			? { availability: "present" as const }
			: {}),
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
