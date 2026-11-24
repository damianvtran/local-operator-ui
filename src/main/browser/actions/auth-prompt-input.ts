/**
 * Input that would DRIVE a password manager's prompt, refused while one is
 * present in the tab (architect option A, review S1/B4;
 * `extensions/auth-request.ts` "PRESENCE-KEYED" has the model).
 *
 * WHY HERE AND NOT IN THE CDP POOL. The pool sees one command at a time and
 * cannot tell a click on the page from a click on the prompt, nor a key aimed
 * at a page element from one that lands wherever focus happens to be. Both
 * questions need a measurement that only the action can take at the moment it
 * dispatches, so the narrowing lives beside the two dispatch sites
 * (`actions/input.ts` `hover` and `press`), and everything outside the
 * prompt's rect, or aimed at a page element, keeps working.
 *
 * WHY THE RECT IS MEASURED PER DISPATCH, FROM THE PAGE SESSION. A prompt moves
 * (1Password repositions its card as the page scrolls) and appears without
 * notice, so a cached rect is wrong in both directions. The page session is
 * the only side the agent may read: attaching to the provider frame to ask its
 * own geometry would be driving it (`actions/frames.ts`
 * `assertNotExtensionFrame`). `DOM.getFrameOwner` would want the provider
 * frame's DevTools id, which this host cannot learn without that attach (the
 * page session cannot describe an out-of-process target: measured,
 * `Target.getTargetInfo` -> "No target with given id found"), so the owners are
 * found the other way round: the page's own pierced DOM, closed shadow roots
 * included, lists every `<iframe>` whose `src` is an extension document, and
 * `DOM.getBoxModel` answers its border box in the page's viewport \u2014 the
 * coordinate space `Input.dispatchMouseEvent` uses.
 *
 * FAIL CLOSED. Unmeasurable means refused: the DOM read fails, a box cannot be
 * read, an owner sits inside a nested frame (whose box is in that frame's own
 * coordinates, not the page's), or a prompt is present but no owner is found
 * (a provider that navigated its frame away from its `src`). The agent's
 * alternatives are named in the refusal.
 */

import type { CdpContents } from "../cdp";
import { authPromptRefusal } from "../extensions/auth-request";
import type { TabRecord } from "../registry";
import type { BrowserActionContext } from "./context";

/** An extension document URL, as a frame owner's `src` or a frame's url. */
const EXTENSION_SRC = /^\s*chrome-extension:/i;

interface DomNode {
	nodeName?: string;
	backendNodeId?: number;
	attributes?: string[];
	children?: DomNode[];
	shadowRoots?: DomNode[];
	contentDocument?: DomNode;
	templateContent?: DomNode;
}

interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** The extension frame owners of the page's own document, or null when one
 * sits in a nested document (its box would be in another coordinate space). */
function providerOwners(root: DomNode): number[] | null {
	const owners: number[] = [];
	let nested = false;
	const walk = (node: DomNode, depth: number): void => {
		const name = node.nodeName?.toUpperCase();
		if ((name === "IFRAME" || name === "FRAME") && isExtensionOwner(node)) {
			if (depth > 0) nested = true;
			else if (typeof node.backendNodeId === "number")
				owners.push(node.backendNodeId);
			else nested = true; // no handle to measure: treat as unmeasurable
		}
		for (const child of node.children ?? []) walk(child, depth);
		for (const shadow of node.shadowRoots ?? []) walk(shadow, depth);
		if (node.templateContent) walk(node.templateContent, depth);
		if (node.contentDocument) walk(node.contentDocument, depth + 1);
	};
	walk(root, 0);
	return nested ? null : owners;
}

function isExtensionOwner(node: DomNode): boolean {
	const attributes = node.attributes ?? [];
	for (let index = 0; index + 1 < attributes.length; index += 2) {
		if (attributes[index]?.toLowerCase() !== "src") continue;
		return EXTENSION_SRC.test(attributes[index + 1] ?? "");
	}
	return false;
}

function rectOf(quad: unknown): Rect | null {
	if (!Array.isArray(quad) || quad.length < 8) return null;
	const xs = [quad[0], quad[2], quad[4], quad[6]];
	const ys = [quad[1], quad[3], quad[5], quad[7]];
	if (![...xs, ...ys].every((value) => typeof value === "number")) return null;
	return {
		left: Math.min(...xs),
		top: Math.min(...ys),
		right: Math.max(...xs),
		bottom: Math.max(...ys),
	};
}

/** The provider frames' rects in viewport coordinates, or null (unmeasurable). */
async function providerRects(
	ctx: BrowserActionContext,
	contents: CdpContents,
): Promise<Rect[] | null> {
	try {
		const document = await ctx.cdp.send<{ root?: DomNode }>(
			contents,
			"DOM.getDocument",
			{ depth: -1, pierce: true },
		);
		if (!document?.root) return null;
		const owners = providerOwners(document.root);
		if (!owners || owners.length === 0) return null;
		const rects: Rect[] = [];
		for (const backendNodeId of owners) {
			const box = await ctx.cdp.send<{ model?: { border?: unknown } }>(
				contents,
				"DOM.getBoxModel",
				{ backendNodeId },
			);
			const rect = rectOf(box?.model?.border);
			if (!rect) return null;
			rects.push(rect);
		}
		return rects;
	} catch {
		return null;
	}
}

/**
 * Refuse a positional mouse/touch dispatch at (x, y) that would land in a
 * provider prompt. Costs nothing on a tab with no prompt present: no CDP call
 * is made unless one is.
 */
export async function assertPointOutsideAuthPrompt(
	ctx: BrowserActionContext,
	record: TabRecord,
	x: number,
	y: number,
): Promise<void> {
	const contents = record.view.webContents;
	if (!ctx.registry.authPromptPresent(contents.id)) return;
	const rects = await providerRects(ctx, contents);
	// Still refused when unmeasurable (fail closed), but with copy that says so
	// rather than claiming the point was inside the prompt (review U9).
	if (rects === null) throw authPromptRefusal("input", null, true);
	const inside = rects.some(
		(rect) =>
			x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
	);
	if (inside) throw authPromptRefusal("input", null);
}

/**
 * Refuse a TARGETLESS key while a provider prompt is present and holds focus,
 * or while its focus cannot be read (review B4): the key would type into vault
 * UI. Read from the main process (`webContents.focusedFrame`), which is the
 * browser's own record of the focused frame and is not something the page can
 * spoof. A key aimed at a page element (`press` with a selector) never asks:
 * that path moves focus to the element first.
 */
export function assertKeyNotIntoAuthPrompt(
	ctx: BrowserActionContext,
	record: TabRecord,
): void {
	const contents = record.view.webContents;
	if (!ctx.registry.authPromptPresent(contents.id)) return;
	const focusedUrl = focusedFrameUrl(contents);
	if (focusedUrl === null) return;
	if (focusedUrl === undefined || EXTENSION_SRC.test(focusedUrl))
		throw authPromptRefusal("key", null);
}

/**
 * Whether the view's focused frame is verifiably an extension (provider)
 * document. Unknowable reads as false: the one caller (the notice's Escape,
 * review U10) only uses it to LEAVE a key to the page, so guessing "provider"
 * would be the unsafe direction for nothing.
 */
export function providerFrameFocused(contents: unknown): boolean {
	const url = focusedFrameUrl(contents);
	return typeof url === "string" && EXTENSION_SRC.test(url);
}

/** The focused frame's URL: null when nothing is focused, undefined when it
 * cannot be read. */
function focusedFrameUrl(contents: unknown): string | null | undefined {
	let focusedUrl: string | null | undefined;
	try {
		const focused = (
			contents as unknown as {
				focusedFrame?: { url?: string; isDestroyed?: () => boolean } | null;
			}
		).focusedFrame;
		if (focused === undefined)
			focusedUrl = undefined; // API absent: unknowable
		else if (focused === null)
			focusedUrl = null; // nothing focused
		else if (focused.isDestroyed?.() === true) focusedUrl = null;
		else focusedUrl = typeof focused.url === "string" ? focused.url : undefined;
	} catch {
		focusedUrl = undefined;
	}
	return focusedUrl;
}
