import { useCanvasStore } from "@shared/store/canvas-store";
import { showInfoToast } from "@shared/utils/toast-manager";
import { keptWordsMessage } from "./close-copy";
import { closeBuffer } from "./document-buffers";

/**
 * WHEN A CLOSE KEEPS THE READER'S WORDS, SAY SO (UX round 1, U1).
 *
 * The close's promise is that un-written words survive it, and the reader is told
 * nothing at the one moment it happens: the tab goes, the pane shows its empty
 * state, and the freshness row - including its live region - unmounts with the
 * document, so the fact `closeBuffer` raises has nowhere left to be read. The
 * result is silence between three very different states ("saved", "gone", "kept"),
 * and the boundary is worse than the wording implies: the registries that hold the
 * words are module state, so "kept" means until the app quits, not for good.
 *
 * WHAT THIS DOES, and what it deliberately does not. It reports the close's own
 * outcome once, through the app's existing toast channel (`toast-manager.ts`) - no
 * new surface, and nothing is said about a close that wrote its words to disk (the
 * autosave model the reader already meets elsewhere in this surface is silent, and
 * UX round 1's U5 records that as intended). The same boundary is named where the
 * reader can read it BEFORE the close, in the hold sentence itself:
 * `FACT_DETAIL["disk-changed"]` in `use-file-freshness.ts`.
 *
 * WHY THE STORE DECIDES WHETHER THIS WAS A CLOSE. The three editors' unmount
 * cleanup is `closeBuffer`, and it runs for every unmount - a close, but also the
 * tab switch that unmounts the document the reader left, and the pane or
 * conversation going away with the buffer still held. Only one of those is a close,
 * and the difference is exactly "is this document still open": the store is read
 * here, after the flush has settled, and a document that is still in `files`
 * somewhere was not closed, so it is not announced. (Across conversations on
 * purpose: a path held open in another conversation has not been closed either,
 * and saying so would be the one sentence this module must not say.)
 *
 * THE FUNCTION'S OWN SHAPE. Fire-and-forget, because every call site is an unmount
 * cleanup: the report is chained rather than awaited, and a failure to report is
 * logged rather than thrown into a cleanup. The sentence itself lives in
 * `close-copy.ts`, which is where the suites read it from.
 */
export function closeDocumentBuffer(document: {
	id: string;
	title: string;
}): void {
	closeBuffer(document.id)
		.then((outcome) => {
			if (!outcome.keptWords) return;
			const conversations = useCanvasStore.getState().conversations ?? {};
			const stillOpen = Object.values(conversations).some((conversation) =>
				(conversation?.files ?? []).some((file) => file.id === document.id),
			);
			if (stillOpen) return;
			showInfoToast(keptWordsMessage(document.title));
		})
		.catch((error) => {
			console.error("could not report what a close kept:", error);
		});
}
