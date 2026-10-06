import { FRAME_DETACHED } from "../cdp";
import type { DriveableView } from "../electron-types";
import { BrowserHostError } from "../errors";
import type { BrowserActionContext } from "./context";

/**
 * Reaching into iframes: the scope a selector or a ref resolves in.
 * Decision record: ARCH-1 (raw CDP over the view's own debugger, flattened child
 * sessions attached on demand). No Playwright, no `webFrameMain`.
 *
 * WHY THIS EXISTS: the page session's `DOM.querySelector` and its AX tree reach
 * neither an out-of-process (cross-site) frame nor the content of a same-site one
 * (measured, Electron 44: `pierce:true` misses the frame's field and the top AX
 * tree has no textbox). So a field inside a payment provider's card frame was
 * untargetable, and #851 made `type` say so instead of faking success. This module
 * is the way in; every action that uses it still reads back from the frame's OWN
 * session before it reports anything as done.
 *
 * Two kinds of frame, told apart by `DOM.describeNode`:
 * - SAME-PROCESS (same site): the iframe node carries `contentDocument`; the
 *   query continues on the SAME session from that document.
 * - OUT-OF-PROCESS (cross-site): no `contentDocument`; the iframe node's
 *   `frameId` is the frame's target id, and `CdpPool.attachFrame` gives a child
 *   session for it.
 */

type CdpContents = DriveableView["webContents"];

/** Explicit frame hop in a selector: `iframe#card >>> #number`. Not valid CSS,
 * so no selector that is valid today changes meaning. Public grammar: it appears
 * in refusals the agent acts on, so changing it is a breaking change. */
export const FRAME_HOP = ">>>";

/** How deep a hop chain or a frame search goes, and how many frames a search may
 * enter. Bounds the cost of a top-document miss on an ad-heavy page. */
export const MAX_FRAME_DEPTH = 3;
export const MAX_FRAMES_SEARCHED = 20;

/** Where a node lives: the session that owns it and the document it was found
 * in. `sessionId` absent means the page's own session. */
export interface FrameScope {
	sessionId?: string;
	/** The out-of-process frame whose session this is (its target id). */
	frameTargetId?: string;
	/** This document's own frame id; absent for the top document. */
	frameId?: string;
	rootNodeId: number;
	/** The frame document's origin; absent for the top document. */
	origin?: string;
	/** The iframe elements walked to get here, outermost first, each in its parent's
	 * session — scrolled into view before the target so a capture shows it. */
	hops: Array<{ sessionId?: string; nodeId: number }>;
	/** The `>>>` path that names this frame, for refusals that list candidates. */
	path: string[];
}

/** Send in a scope: the page session keeps the 3-argument call (and so the
 * two-argument `sendCommand`), a child session adds its id. */
export function sendIn<T>(
	ctx: BrowserActionContext,
	contents: CdpContents,
	sessionId: string | undefined,
	method: string,
	params: Record<string, unknown>,
): Promise<T> {
	return sessionId
		? ctx.cdp.send<T>(contents, method, params, { sessionId })
		: ctx.cdp.send<T>(contents, method, params);
}

/** Split `A >>> B >>> C` into hops, or `null` when the target has no hop. */
export function parseFrameHops(target: string): string[] | null {
	if (!target.includes(FRAME_HOP)) return null;
	const hops = target.split(FRAME_HOP).map((hop) => hop.trim());
	if (hops.some((hop) => hop === "")) {
		throw new BrowserHostError(
			"element_not_found",
			`${target} has an empty side of '${FRAME_HOP}'; write it as <iframe-selector> ${FRAME_HOP} <selector>`,
		);
	}
	if (hops.length - 1 > MAX_FRAME_DEPTH) {
		throw new BrowserHostError(
			"element_not_found",
			`${target} hops through ${hops.length - 1} frames; at most ${MAX_FRAME_DEPTH} are followed`,
		);
	}
	return hops;
}

/** The page's own document as a scope. */
export async function topScope(
	ctx: BrowserActionContext,
	contents: CdpContents,
): Promise<FrameScope> {
	const document = await ctx.cdp.send<{ root?: { nodeId?: number } }>(
		contents,
		"DOM.getDocument",
		{ depth: 0 },
	);
	const rootNodeId = document?.root?.nodeId;
	if (rootNodeId === undefined) {
		throw new BrowserHostError("internal", "the page has no document to query");
	}
	return { rootNodeId, hops: [], path: [] };
}

/** `DOM.querySelector` in a scope; 0 when nothing matches. */
export async function queryIn(
	ctx: BrowserActionContext,
	contents: CdpContents,
	scope: FrameScope,
	selector: string,
): Promise<number> {
	const queried = await sendIn<{ nodeId?: number }>(
		ctx,
		contents,
		scope.sessionId,
		"DOM.querySelector",
		{ nodeId: scope.rootNodeId, selector },
	);
	return queried?.nodeId ?? 0;
}

interface DescribedNode {
	nodeName?: string;
	frameId?: string;
	attributes?: string[];
	contentDocument?: { backendNodeId?: number; documentURL?: string };
}

const FRAME_NODE_NAMES = new Set(["IFRAME", "FRAME"]);

function originOf(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}

/** An id usable as `#id` without escaping. Module scope: the top-level-regex rule. */
const PLAIN_ID = /^[A-Za-z_][\w-]*$/;

/** A selector that names an iframe in its parent document, for `>>>` candidates.
 * id, then name, then title, then src: the attributes a person can see and a
 * payment widget usually sets. */
export function frameSelectorFor(attributes: string[] = []): string {
	const attrs = new Map<string, string>();
	for (let i = 0; i + 1 < attributes.length; i += 2) {
		attrs.set(attributes[i], attributes[i + 1]);
	}
	const id = attrs.get("id");
	if (id && PLAIN_ID.test(id)) return `iframe#${id}`;
	for (const key of ["name", "title", "src"]) {
		const value = attrs.get(key);
		if (value) return `iframe[${key}=${JSON.stringify(value)}]`;
	}
	return "iframe";
}

/**
 * Step into the frame an iframe element hosts. `parent` is the scope the element
 * was found in.
 *
 * A cached child session that went stale (the frame navigated to a new process,
 * or was replaced) is re-attached EXACTLY ONCE: `CdpPool` drops the cache entry
 * when it sees the stale-session error, so the second `attachFrame` asks Chromium
 * afresh. A second failure is the honest `element_not_found`.
 */
export async function enterFrame(
	ctx: BrowserActionContext,
	contents: CdpContents,
	parent: FrameScope,
	iframeNodeId: number,
): Promise<FrameScope> {
	const described = await sendIn<{ node?: DescribedNode }>(
		ctx,
		contents,
		parent.sessionId,
		"DOM.describeNode",
		{ nodeId: iframeNodeId, depth: 1 },
	);
	const node = described?.node;
	if (!node || !FRAME_NODE_NAMES.has(String(node.nodeName).toUpperCase())) {
		throw new BrowserHostError(
			"element_not_found",
			"that element is not an iframe, so there is no frame to step into",
			{ reason: NOT_A_FRAME },
		);
	}
	const hops = [
		...parent.hops,
		{ sessionId: parent.sessionId, nodeId: iframeNodeId },
	];
	const path = [...parent.path, frameSelectorFor(node.attributes)];

	const inProcess = node.contentDocument?.backendNodeId;
	if (inProcess !== undefined) {
		// Same process: the frame's document is a node of THIS session (measured:
		// `contentDocument` present for a same-site, different-port frame, and an
		// `insertText` from the page session lands in it).
		const pushed = await sendIn<{ nodeIds?: number[] }>(
			ctx,
			contents,
			parent.sessionId,
			"DOM.pushNodesByBackendIdsToFrontend",
			{ backendNodeIds: [inProcess] },
		);
		const rootNodeId = pushed?.nodeIds?.[0];
		if (!rootNodeId) {
			throw new BrowserHostError(
				"element_not_found",
				"that frame has no document yet; retry once it has loaded",
			);
		}
		return {
			sessionId: parent.sessionId,
			frameTargetId: parent.frameTargetId,
			frameId: node.frameId,
			rootNodeId,
			origin: originOf(node.contentDocument?.documentURL),
			hops,
			path,
		};
	}

	const frameId = node.frameId;
	if (!frameId) {
		throw new BrowserHostError(
			"element_not_found",
			"that frame has no document yet; retry once it has loaded",
		);
	}
	const rooted = await childRoot(ctx, contents, frameId);
	return {
		sessionId: rooted.sessionId,
		frameTargetId: frameId,
		frameId,
		rootNodeId: rooted.rootNodeId,
		origin: rooted.origin,
		hops,
		path,
	};
}

/** Attach (or reuse) a frame target's session and request its document, with
 * the one re-attach on a stale cached session. Exported for the ref path, which
 * names a frame by target id rather than by element. */
export async function childRoot(
	ctx: BrowserActionContext,
	contents: CdpContents,
	frameId: string,
): Promise<{ sessionId: string; rootNodeId: number; origin?: string }> {
	for (let attempt = 0; ; attempt += 1) {
		const sessionId = await ctx.cdp.attachFrame(contents, frameId);
		try {
			const document = await ctx.cdp.send<{
				root?: { nodeId?: number; documentURL?: string };
			}>(contents, "DOM.getDocument", { depth: 0 }, { sessionId });
			const rootNodeId = document?.root?.nodeId;
			if (rootNodeId === undefined) {
				throw new BrowserHostError(
					"element_not_found",
					"that frame has no document yet; retry once it has loaded",
				);
			}
			return {
				sessionId,
				rootNodeId,
				origin: originOf(document?.root?.documentURL),
			};
		} catch (error) {
			if (attempt === 0 && isFrameDetached(error)) continue;
			throw error;
		}
	}
}

/** `data.reason` for an element that hosts no frame: callers branch on it rather
 * than on the message. */
export const NOT_A_FRAME = "not_a_frame";

export function isNotAFrame(error: unknown): boolean {
	return (
		error instanceof BrowserHostError &&
		(error.data as { reason?: unknown } | undefined)?.reason === NOT_A_FRAME
	);
}

export function isFrameDetached(error: unknown): boolean {
	return (
		error instanceof BrowserHostError &&
		(error.data as { reason?: unknown } | undefined)?.reason === FRAME_DETACHED
	);
}

/** Walk `A >>> B >>> C`: every hop but the last must be an iframe in the scope
 * reached so far. */
export async function resolveHops(
	ctx: BrowserActionContext,
	contents: CdpContents,
	hops: string[],
): Promise<{ scope: FrameScope; nodeId: number }> {
	let scope = await topScope(ctx, contents);
	for (const hop of hops.slice(0, -1)) {
		const iframe = await queryIn(ctx, contents, scope, hop);
		if (!iframe) {
			throw new BrowserHostError(
				"element_not_found",
				`frame selector ${hop} matched nothing`,
			);
		}
		scope = await enterFrame(ctx, contents, scope, iframe).catch((error) => {
			if (isNotAFrame(error)) {
				throw new BrowserHostError(
					"element_not_found",
					`${hop} is not an iframe, so '${FRAME_HOP}' cannot step into it`,
				);
			}
			throw error;
		});
	}
	const selector = hops[hops.length - 1];
	const nodeId = await queryIn(ctx, contents, scope, selector);
	if (!nodeId) {
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} matched nothing inside ${hops.slice(0, -1).join(` ${FRAME_HOP} `)}`,
		);
	}
	return { scope, nodeId };
}

/**
 * The top document missed: look for the selector inside frames, breadth first,
 * at most `MAX_FRAME_DEPTH` deep and `MAX_FRAMES_SEARCHED` frames in all.
 *
 * Returns EVERY match it found; the caller acts only on a unique one. Picking the
 * first of several would be the guess #851 exists to refuse — Stripe-style pages
 * hold a frame per field, and auto-search must not choose between them.
 * A frame that cannot be entered (still loading, gone mid-walk) is skipped rather
 * than failing a search that may still find its target elsewhere.
 */
export async function searchFrames(
	ctx: BrowserActionContext,
	contents: CdpContents,
	selector: string,
): Promise<Array<{ scope: FrameScope; nodeId: number }>> {
	const matches: Array<{ scope: FrameScope; nodeId: number }> = [];
	for (const scope of await listFrames(ctx, contents)) {
		const nodeId = await queryIn(ctx, contents, scope, selector).catch(() => 0);
		if (nodeId) matches.push({ scope, nodeId });
	}
	return matches;
}

/** Every frame reachable from the top document, breadth first, within
 * `MAX_FRAME_DEPTH` and `MAX_FRAMES_SEARCHED`. Shared by the selector search and
 * `snapshot`, so both see the same frames under the same bounds. */
export async function listFrames(
	ctx: BrowserActionContext,
	contents: CdpContents,
): Promise<FrameScope[]> {
	const found: FrameScope[] = [];
	let level: FrameScope[] = [await topScope(ctx, contents)];
	for (let depth = 0; depth < MAX_FRAME_DEPTH && level.length; depth += 1) {
		const next: FrameScope[] = [];
		for (const parent of level) {
			const listed = await sendIn<{ nodeIds?: number[] }>(
				ctx,
				contents,
				parent.sessionId,
				"DOM.querySelectorAll",
				{ nodeId: parent.rootNodeId, selector: "iframe, frame" },
			);
			for (const iframe of listed?.nodeIds ?? []) {
				if (found.length >= MAX_FRAMES_SEARCHED) return found;
				let scope: FrameScope;
				try {
					scope = await enterFrame(ctx, contents, parent, iframe);
				} catch (error) {
					// Still loading, or gone mid-walk: skip it rather than fail a search
					// that may find its target elsewhere.
					if (error instanceof BrowserHostError) continue;
					throw error;
				}
				found.push(scope);
				next.push(scope);
			}
		}
		level = next;
	}
	return found;
}

/** A `>>>` path for a match, as the agent would write it back. */
export function candidatePath(scope: FrameScope, selector: string): string {
	return [...scope.path, selector].join(` ${FRAME_HOP} `);
}

/** The fields `type` may descend to inside a frame: things that take typed text.
 * Buttons, checkboxes, file inputs and the like are not a guess `type` makes. */
export const EDITABLE_SELECTOR =
	'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=image]):not([type=range]):not([type=color]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), [contenteditable]:not([contenteditable="false"])';

/** Run against the frame's DOCUMENT. `mode` "active": the focused editable, or
 * null. "list": a selector per editable field, for the candidate refusal. "only":
 * the editable field itself. A fixed function with arguments, never interpolated
 * code — the rule `read` states. */
const FRAME_EDITABLE_FUNCTION = `function (selector, mode) {
  const all = Array.from(this.querySelectorAll(selector));
  if (mode === 'active') {
    const active = this.activeElement;
    return active && all.indexOf(active) !== -1 ? active : null;
  }
  if (mode === 'only') return all.length === 1 ? all[0] : null;
  return all.map(function (el, index) {
    const tag = String(el.tagName || '').toLowerCase();
    if (el.id && /^[A-Za-z_][\\w-]*$/.test(el.id)) return '#' + el.id;
    const name = el.getAttribute && el.getAttribute('name');
    if (name) return tag + '[name=' + JSON.stringify(name) + ']';
    return '(' + selector.split(',')[0].trim().split(':')[0] + ' #' + (index + 1) + ')';
  });
}`;

/**
 * `type` aimed at an iframe ELEMENT: descend to the one field it can only mean.
 *
 * The focused editable wins; otherwise exactly one editable field. Zero is the
 * #851 refusal (nothing typed, cause named). Several is a refusal that lists each
 * as a `>>>` path, because picking one is a guess — a card form with number,
 * expiry and CVC in one frame is the normal case.
 */
export async function editableInFrame(
	ctx: BrowserActionContext,
	contents: CdpContents,
	scope: FrameScope,
	target: string,
): Promise<{ nodeId: number; objectId: string }> {
	const documentObject = await sendIn<{ object?: { objectId?: string } }>(
		ctx,
		contents,
		scope.sessionId,
		"DOM.resolveNode",
		{ nodeId: scope.rootNodeId },
	);
	const documentId = documentObject?.object?.objectId;
	if (!documentId) {
		throw new BrowserHostError(
			"element_not_found",
			`could not read the document inside ${target}`,
		);
	}
	const pick = (mode: string, returnByValue: boolean) =>
		sendIn<{ result?: { objectId?: string; value?: unknown } }>(
			ctx,
			contents,
			scope.sessionId,
			"Runtime.callFunctionOn",
			{
				objectId: documentId,
				functionDeclaration: FRAME_EDITABLE_FUNCTION,
				arguments: [{ value: EDITABLE_SELECTOR }, { value: mode }],
				returnByValue,
			},
		);
	let objectId = (await pick("active", false))?.result?.objectId;
	if (!objectId) objectId = (await pick("only", false))?.result?.objectId;
	if (!objectId) {
		const listed = (await pick("list", true))?.result?.value;
		const fields = Array.isArray(listed) ? listed.map(String) : [];
		if (fields.length === 0) {
			throw new BrowserHostError(
				"element_not_found",
				`${target} is not an editable field (no value setter, not contenteditable), so nothing was typed; it is an iframe and its document holds no editable field either`,
			);
		}
		throw new BrowserHostError(
			"element_not_found",
			`${target} is an iframe holding ${fields.length} editable fields, so nothing was typed; name one: ${fields
				.map((field) => candidatePath(scope, field))
				.join(", ")}`,
			{ candidates: fields.map((field) => candidatePath(scope, field)) },
		);
	}
	const requested = await sendIn<{ nodeId?: number }>(
		ctx,
		contents,
		scope.sessionId,
		"DOM.requestNode",
		{ objectId },
	);
	return { nodeId: requested?.nodeId ?? 0, objectId };
}
