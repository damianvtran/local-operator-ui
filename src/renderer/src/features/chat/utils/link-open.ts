/**
 * What the app DOES with a link target: the effectful half, once.
 *
 * `link-actions.ts` decides what a target is and which actions it offers; this
 * module performs them, and it is one module rather than three call sites because
 * every one of these actions has a failure path that must be worded the same way
 * wherever the reader pressed it - a link's own click, the link toolbar's Open,
 * its Open folder, its Copy. The failure that made that necessary was silence:
 * `shell.openPath` RETURNS its error rather than throwing, so a caller that
 * ignored the answer could not tell an opened file from one that opened nothing.
 *
 * The two DOM-shaped helpers live here too. `selectionTouches` is the drag-select
 * guard the anchor's click needs (see `markdown-renderer.tsx`); it is here rather
 * than there because it is part of "what a click on a target means", which this
 * module owns.
 */

import { showErrorToast } from "@shared/utils/toast-manager";
import { getFileName } from "./get-file-name";
import { type LinkKind, forgetProbe } from "./link-actions";

/**
 * Whether the reader's own highlight currently touches this element.
 *
 * THE DRAG-SELECT GUARD, and it is not defensive: `mousedown` and `mouseup`
 * inside one link fire `click`, so a drag that began inside a link and released
 * inside it is a CLICK as far as the browser is concerned - and without this a
 * drag over a file link would launch an application mid-gesture. Read from the
 * live selection rather than from a flag, because the browser owns the
 * selection: whatever ended the gesture, the state that matters is whether text
 * is still lit.
 */
export const selectionTouches = (element: Element): boolean => {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return false;
	}
	return selection.getRangeAt(0).intersectsNode(element);
};

/** The one sentence a press that could not open something says. */
const openFailure = (target: string): string =>
	`Could not open ${getFileName(target)}. The file may have been moved, renamed, or deleted.`;

/**
 * Open a LOCAL path in the OS's own application.
 *
 * Answers whether it worked, so a caller that has its own follow-up (the link
 * toolbar re-probes a path whose cached answer just proved wrong) can act on it
 * rather than re-deriving it. `undefined` from the bridge is treated as success:
 * outside Electron there is nothing to open with, and a reader looking at
 * Storybook is not owed an error for a bridge that is not there.
 */
export async function openLocalTarget(target: string): Promise<boolean> {
	const open = window.api?.openFile;
	if (typeof open !== "function") return true;
	const outcome = await open(target);
	if (outcome && outcome.ok === false) {
		forgetProbe(target);
		showErrorToast(openFailure(target));
		return false;
	}
	return true;
}

/** Reveal a LOCAL path in the OS file manager. */
export async function revealLocalTarget(target: string): Promise<boolean> {
	const reveal = window.api?.showItemInFolder;
	if (typeof reveal !== "function") return true;
	const outcome = await reveal(target);
	if (outcome && outcome.ok === false) {
		showErrorToast(openFailure(target));
		return false;
	}
	return true;
}

/**
 * Open a URL in the reader's browser.
 *
 * The `http(s)` path the anchor's own `target="_blank"` already takes, wired here
 * so the toolbar's Open does the same thing from the same place. The scheme is
 * NOT re-checked: `classifyHref` is what decided this is a URL, and a second
 * check here would be a second answer to one question.
 */
export async function openUrlTarget(target: string): Promise<void> {
	const open = window.api?.openExternal;
	if (typeof open !== "function") return;
	await open(target);
}

/** Copy a target's own spelling to the clipboard. */
export async function copyTarget(target: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(target);
		return true;
	} catch (error) {
		console.error("Failed to copy: ", error);
		showErrorToast("Failed to copy");
		return false;
	}
}

/** Open a target by the kind the classifier gave it. */
export function openTarget(kind: LinkKind, target: string): Promise<boolean> {
	return kind === "url"
		? openUrlTarget(target).then(() => true)
		: openLocalTarget(target);
}
