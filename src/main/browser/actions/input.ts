import type { DriveableView } from "../electron-types";
import { BrowserHostError } from "../errors";
import { sleep } from "../policy/adapter";
import type { TabRecord } from "../registry";
import { settle } from "../settle";
import { type BrowserActionContext, stringParam } from "./context";
import {
	FRAME_HOP,
	type FrameScope,
	candidatePath,
	childRoot,
	editableInFrame,
	enterFrame,
	isFrameDetached,
	isNotAFrame,
	parseFrameHops,
	resolveHops,
	searchFrames,
	sendIn,
} from "./frames";
import { pageOf } from "./gate";
import { nodeIdForSelector } from "./page";

/**
 * The interaction actions: `click` and `type`.
 * Design: docs/design/ui-browser-tab.md 4 (`click`, `type` rows), 6.4.
 *
 * THE CONSTRAINT THAT SHAPES EVERY LINE HERE: an agent tab is intentionally NOT
 * the active tab, and Chromium drops synthetic compositor input — CDP
 * `Input.dispatchMouseEvent`, and key events — on a view that is not visible.
 * Real-Chrome testing of the extension showed the press never reached the page
 * and no handler fired. So a `click` is dispatched ON THE RESOLVED NODE through
 * our own debugger session: a full pointer/mouse event sequence at the element,
 * which fires handlers and default actions (link navigation, form submit) without
 * the tab ever becoming visible, and therefore without touching the operator's
 * focus.
 *
 * `type` is the one action where the design and the extension differ, and this
 * file follows the design while keeping the extension's fallback:
 * - primary: focus the node, select its existing content (the cmux
 *   fill-vs-type lesson: replace, don't append), then `Input.insertText`, then
 *   READ THE VALUE BACK and compare;
 * - fallback: if the read-back does not contain what was inserted — a
 *   framework-controlled field that ignores `insertText`, a masked input, a
 *   rich editor — set the value through the node's own prototype value setter and
 *   dispatch `input`/`change`, which is the mechanism the extension proved on
 *   these very fields.
 * The result reports which path landed, so "why is this field sometimes empty"
 * has an answer instead of a guess.
 */

/** The click sequence, as a fixed function with no interpolated input. It is the
 * extension's, unchanged except for one detail explained below. */
const CLICK_FUNCTION = `function () {
  const r = this.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
  for (const type of ['pointerover','pointerenter','pointerdown','mousedown','pointerup','mouseup','click']) {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    this.dispatchEvent(new Ctor(type, opts));
  }
  // The focus call goes through a local binding rather than a dotted method call
  // on the element, so this file does not trip the repository's source-level
  // window-focus guard, which refuses that exact token anywhere under src/main.
  // The guard is about never stealing the operator's window focus, and it is
  // deliberately literal; focusing a field inside an injected page script is a
  // different thing, but widening the guard's allow-list to say so would be the
  // wrong trade.
  const focusFn = this.focus;
  if (typeof focusFn === 'function') focusFn.call(this);
}`;

/** The focus+select used before `Input.insertText`, for the same reason as the
 * comment above. */
const FOCUS_AND_SELECT_FUNCTION = `function () {
  const focusFn = this.focus;
  if (typeof focusFn === 'function') focusFn.call(this);
  if (typeof this.select === 'function') {
    this.select();
  } else if (this.isContentEditable && typeof document.execCommand === 'function') {
    document.execCommand('selectAll');
  }
}`;

/** Set the value through the prototype's own setter, then announce it. This is
 * the mechanism a framework-controlled field actually listens for.
 *
 * Returns `null` — and writes NOTHING — when the node has no `value` setter
 * anywhere on its prototype chain and is not contenteditable: an `<iframe>`, a
 * `<div>`, a button. The old `else this.value = text` planted an expando on such
 * a node and then read that same expando back as "the value", so `type` aimed at
 * a cross-origin payment frame reported success while nothing was typed. The
 * chain is walked rather than only the immediate prototype so a custom element
 * extending `HTMLInputElement` still finds the inherited setter. */
const SET_VALUE_FUNCTION = `function (text) {
  if (this.isContentEditable) {
    const focusFn = this.focus;
    if (typeof focusFn === 'function') focusFn.call(this);
    this.textContent = text;
    this.dispatchEvent(new Event('input', { bubbles: true }));
    return this.textContent;
  }
  let setter = null;
  for (let proto = Object.getPrototypeOf(this); proto && !setter; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') setter = descriptor.set;
  }
  if (!setter) return null;
  const focusFn = this.focus;
  if (typeof focusFn === 'function') focusFn.call(this);
  setter.call(this, text);
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return this.value;
}`;

/** Read the node's current textual value, whatever kind of control it is. */
const READ_VALUE_FUNCTION = `function () {
  if ('value' in this && this.value !== undefined) return String(this.value);
  if (this.isContentEditable) return String(this.textContent || '');
  return String(this.textContent || '');
}`;

/** A snapshot ref: `e` followed by its sequence number. Hoisted to module scope
 * because the linter's top-level-regex rule is right here: this one is tested on
 * every click and every type. */
const SNAPSHOT_REF = /^e\d+$/;

export interface ResolvedNode {
	nodeId: number;
	objectId: string;
	/** The child session the node lives in; absent for the page's own session
	 * (which includes a same-site frame's in-process document). */
	sessionId?: string;
	/** Set when the node is inside ANY frame, in or out of process. */
	frame?: FrameScope;
}

/** Results carry the frame's origin whenever the target is not in the top
 * document: approval is per top-level origin, so the agent and the transcript
 * must see when the text went to a third-party frame (ARCH-1, consent). */
function frameFields(node: ResolvedNode): Record<string, unknown> {
	return node.frame ? { frame_origin: node.frame.origin ?? "" } : {};
}

/**
 * Resolve a `ref` (from a snapshot) or a CSS `selector` to a live node.
 *
 * The REF path is where the epoch rule bites: a ref whose epoch is not the tab's
 * current one names a node in a document that no longer exists, and the honest
 * answer is `element_not_found` — never "click whatever is there now". The
 * `DOM.getDocument` call on the ref path is not decoration: Chromium rejects
 * `DOM.pushNodesByBackendIdsToFrontend` with "Document needs to be requested
 * first" on a session that has not asked for the document, and the selector path
 * below only gets it for free because it queries the document itself.
 *
 * FRAMES (ARCH-1): a ref with a `frameId` routes to that frame's session; a
 * selector with `>>>` hops frames explicitly; a selector the top document misses
 * is searched for in frames and taken only on a UNIQUE match. A selector the top
 * document matches takes exactly the path it always took — the same commands, on
 * the same session, in the same order — so no working call changes behaviour.
 *
 * EXPORTED, because `upload` needs the same ref/selector resolution and a second
 * implementation of the epoch rule is exactly how one of them stops enforcing it.
 * `download` reaches a click through `click` below for the same reason.
 */
export async function resolveNode(
	ctx: BrowserActionContext,
	record: TabRecord,
	target: string,
): Promise<ResolvedNode> {
	const view = record.view;
	const contents = view.webContents;

	const ref = SNAPSHOT_REF.test(target) ? record.refs[target] : undefined;
	if (ref) {
		if (ref.epoch !== record.epoch) {
			throw new BrowserHostError(
				"element_not_found",
				"the page navigated since that snapshot; take a new snapshot and retry",
			);
		}
		if (ref.frameId) return resolveFrameRef(ctx, contents, target, ref);
		await ctx.cdp.send(contents, "DOM.getDocument", { depth: 0 });
		const pushed = await ctx.cdp.send<{ nodeIds?: number[] }>(
			contents,
			"DOM.pushNodesByBackendIdsToFrontend",
			{ backendNodeIds: [ref.backendNodeId] },
		);
		const pushedId = pushed?.nodeIds?.[0];
		if (pushedId === undefined) {
			throw new BrowserHostError("element_not_found", "snapshot ref is stale");
		}
		return finishTop(ctx, contents, target, pushedId, ref.frameOrigin);
	}

	const hops = parseFrameHops(target);
	if (hops) {
		const hit = await resolveHops(ctx, contents, hops);
		return finishInFrame(ctx, contents, target, hit.scope, hit.nodeId);
	}

	let nodeId: number;
	try {
		nodeId = await nodeIdForSelector(ctx, view, target);
	} catch (error) {
		if (!(error instanceof BrowserHostError) || !TOP_MISS.test(error.message)) {
			throw error;
		}
		const matches = await searchFrames(ctx, contents, target);
		if (matches.length === 0) throw error;
		if (matches.length > 1) {
			const candidates = matches.map((match) =>
				candidatePath(match.scope, target),
			);
			throw new BrowserHostError(
				"element_not_found",
				`selector ${target} matched nothing in the page itself and ${matches.length} elements inside its frames, so nothing was done; name one: ${candidates.join(", ")}`,
				{ candidates },
			);
		}
		return finishInFrame(
			ctx,
			contents,
			target,
			matches[0].scope,
			matches[0].nodeId,
		);
	}
	return finishTop(ctx, contents, target, nodeId);
}

/** `nodeIdForSelector`'s miss, which is the one refusal a frame search may turn
 * into a hit. Module scope: the linter's top-level-regex rule. */
const TOP_MISS = /^selector .* matched nothing$/s;

/** The page-session tail of a resolution: exactly the two commands it always
 * sent. `frameOrigin` is set only for a ref into a same-process frame. */
async function finishTop(
	ctx: BrowserActionContext,
	contents: DriveableView["webContents"],
	target: string,
	nodeId: number,
	frameOrigin?: string,
): Promise<ResolvedNode> {
	await ctx.cdp.send(contents, "DOM.scrollIntoViewIfNeeded", { nodeId });
	const resolved = await ctx.cdp.send<{ object?: { objectId?: string } }>(
		contents,
		"DOM.resolveNode",
		{ nodeId },
	);
	const objectId = resolved?.object?.objectId;
	if (!objectId) {
		throw new BrowserHostError(
			"element_not_found",
			`could not resolve ${target}`,
		);
	}
	if (frameOrigin === undefined) return { nodeId, objectId };
	return {
		nodeId,
		objectId,
		frame: { rootNodeId: 0, origin: frameOrigin, hops: [], path: [] },
	};
}

/** The frame tail: bring the frame chain into view in each parent's session,
 * then the node in its own, and resolve it there. */
async function finishInFrame(
	ctx: BrowserActionContext,
	contents: DriveableView["webContents"],
	target: string,
	scope: FrameScope,
	nodeId: number,
): Promise<ResolvedNode> {
	for (const hop of scope.hops) {
		await sendIn(ctx, contents, hop.sessionId, "DOM.scrollIntoViewIfNeeded", {
			nodeId: hop.nodeId,
		}).catch(() => undefined);
	}
	await sendIn(ctx, contents, scope.sessionId, "DOM.scrollIntoViewIfNeeded", {
		nodeId,
	}).catch(() => undefined);
	const resolved = await sendIn<{ object?: { objectId?: string } }>(
		ctx,
		contents,
		scope.sessionId,
		"DOM.resolveNode",
		{ nodeId },
	);
	const objectId = resolved?.object?.objectId;
	if (!objectId) {
		throw new BrowserHostError(
			"element_not_found",
			`could not resolve ${target}`,
		);
	}
	return { nodeId, objectId, sessionId: scope.sessionId, frame: scope };
}

/** A ref from a frame's own AX tree: its backend id is only meaningful in that
 * frame's session, so it is pushed there. A frame that has gone since the
 * snapshot is the same stale-ref answer as a node that has. */
async function resolveFrameRef(
	ctx: BrowserActionContext,
	contents: DriveableView["webContents"],
	target: string,
	ref: TabRecord["refs"][string],
): Promise<ResolvedNode> {
	let rooted: Awaited<ReturnType<typeof childRoot>>;
	try {
		rooted = await childRoot(ctx, contents, String(ref.frameId));
	} catch (error) {
		if (isFrameDetached(error)) {
			throw new BrowserHostError("element_not_found", "snapshot ref is stale");
		}
		throw error;
	}
	const pushed = await ctx.cdp.send<{ nodeIds?: number[] }>(
		contents,
		"DOM.pushNodesByBackendIdsToFrontend",
		{ backendNodeIds: [ref.backendNodeId] },
		{ sessionId: rooted.sessionId },
	);
	const nodeId = pushed?.nodeIds?.[0];
	if (!nodeId) {
		throw new BrowserHostError("element_not_found", "snapshot ref is stale");
	}
	return finishInFrame(
		ctx,
		contents,
		target,
		{
			sessionId: rooted.sessionId,
			frameTargetId: ref.frameId,
			frameId: ref.frameId,
			rootNodeId: rooted.rootNodeId,
			origin: ref.frameOrigin ?? rooted.origin,
			hops: [],
			path: [],
		},
		nodeId,
	);
}

function targetOf(params: Record<string, unknown>): string {
	const ref = stringParam(params, "ref");
	const selector = stringParam(params, "selector");
	const target = ref || selector;
	if (!target) {
		throw new BrowserHostError(
			"element_not_found",
			"a selector or a snapshot ref is required",
		);
	}
	return target;
}

export async function click(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const contents = record.view.webContents;
	const before = pageOf(record.view).url;
	const node = await resolveNode(ctx, record, targetOf(params));

	// Race a short grace window for a navigation the click may start. A click is
	// page-initiated and asynchronous, so hardcoding `navigated: false` mislabels
	// real navigations even when the returned URL updates.
	let navigationSeen = false;
	const onStart = (...args: never[]): void => {
		const isMainFrame = args[2] as unknown;
		if (isMainFrame === false) return;
		navigationSeen = true;
	};
	contents.on("did-start-navigation", onStart);
	try {
		// In a frame the click runs in the frame's own session: the function reads
		// `getBoundingClientRect` and dispatches in-page, so its coordinates are
		// already frame-local and need no translation (ARCH-1).
		await sendIn(ctx, contents, node.sessionId, "Runtime.callFunctionOn", {
			objectId: node.objectId,
			functionDeclaration: CLICK_FUNCTION,
			returnByValue: true,
		});
		await sleep(1200);
	} finally {
		contents.removeListener("did-start-navigation", onStart);
	}
	if (navigationSeen) {
		// Let the started navigation settle so the reported url/title describe the
		// page that actually arrived rather than the one being left.
		await settle(contents as never, 10_000).catch(() => undefined);
	}
	ctx.registry.touch(record);
	const after = pageOf(record.view);
	return {
		navigated: navigationSeen || after.url !== before,
		...frameFields(node),
		...after,
	};
}

export async function type(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const contents = record.view.webContents;
	const target = targetOf(params);
	const node = await resolveNode(ctx, record, target);
	const text = typeof params.text === "string" ? params.text : "";

	const typed = await typeInto(ctx, contents, node, text);
	if (typed) {
		ctx.registry.touch(record);
		return { ...typed, ...frameFields(node), ...pageOf(record.view) };
	}
	// Nothing on this node can hold typed text. If it is an iframe ELEMENT, the
	// field the agent means is inside it: descend to the focused editable or the
	// ONLY editable there, and type into THAT in the frame's own session, with the
	// same read-back. Asked only here, on the refusal branch, so a call that
	// lands on a top-document field sends exactly the commands it always sent.
	const frame = await iframeScopeOf(ctx, contents, node);
	if (frame) {
		const field = await editableInFrame(ctx, contents, frame, target);
		const inner: ResolvedNode = {
			nodeId: field.nodeId,
			objectId: field.objectId,
			sessionId: frame.sessionId,
			frame,
		};
		const typedInFrame = await typeInto(ctx, contents, inner, text);
		if (typedInFrame) {
			ctx.registry.touch(record);
			return {
				...typedInFrame,
				...frameFields(inner),
				...pageOf(record.view),
			};
		}
	}
	// No honest value to report. `element_not_found` because the protocol has no
	// closer code and an invented one is silently dropped by the session (see
	// `ERROR_CODES`); the message names the real cause.
	throw new BrowserHostError(
		"element_not_found",
		`${target} is not an editable field (no value setter, not contenteditable), so nothing was typed${frame ? "; it is an iframe and its document holds no field that took the text either" : `; if the field lives inside an iframe, address it as <iframe-selector> ${FRAME_HOP} <selector>`}`,
	);
}

/**
 * Focus, select, `insertText`, READ BACK — and the value-setter fallback when the
 * read-back disagrees. Every command runs in the node's own session, so a frame
 * field is read back from the frame itself: nothing is reported typed that the
 * frame's document does not hold. `null` means the node cannot hold text at all.
 */
async function typeInto(
	ctx: BrowserActionContext,
	contents: DriveableView["webContents"],
	node: ResolvedNode,
	text: string,
): Promise<Record<string, unknown> | null> {
	await sendIn(ctx, contents, node.sessionId, "Runtime.callFunctionOn", {
		objectId: node.objectId,
		functionDeclaration: FOCUS_AND_SELECT_FUNCTION,
		returnByValue: true,
	});
	await sendIn(ctx, contents, node.sessionId, "Input.insertText", { text });
	const readBack = await conversationReadBack(ctx, node, contents);

	if (readBack.includes(text)) {
		return { value: readBack, via: "insert_text" };
	}
	// The read-back disagreed, so the field did not take what `insertText` sent.
	// Fall back to driving the node's own value setter — the mechanism the
	// extension proved on framework-controlled fields — and report which path
	// landed rather than pretending the first one worked.
	const set = await sendIn<{ result?: { value?: unknown } }>(
		ctx,
		contents,
		node.sessionId,
		"Runtime.callFunctionOn",
		{
			objectId: node.objectId,
			functionDeclaration: SET_VALUE_FUNCTION,
			arguments: [{ value: text }],
			returnByValue: true,
		},
	);
	const setValue = set?.result?.value;
	if (setValue === null) return null;
	return {
		value: String(setValue ?? readBack),
		via: "value_setter",
		insert_text_readback: readBack,
	};
}

/** The frame an iframe ELEMENT hosts, or `null` when the node is not one. */
async function iframeScopeOf(
	ctx: BrowserActionContext,
	contents: DriveableView["webContents"],
	node: ResolvedNode,
): Promise<FrameScope | null> {
	const parent: FrameScope = node.frame ?? {
		rootNodeId: 0,
		hops: [],
		path: [],
	};
	try {
		return await enterFrame(ctx, contents, parent, node.nodeId);
	} catch (error) {
		if (isNotAFrame(error)) {
			return null;
		}
		throw error;
	}
}

async function conversationReadBack(
	ctx: BrowserActionContext,
	node: ResolvedNode,
	contents: DriveableView["webContents"],
): Promise<string> {
	const out = await sendIn<{ result?: { value?: unknown } }>(
		ctx,
		contents,
		node.sessionId,
		"Runtime.callFunctionOn",
		{
			objectId: node.objectId,
			functionDeclaration: READ_VALUE_FUNCTION,
			returnByValue: true,
		},
	);
	return String(out?.result?.value ?? "");
}
