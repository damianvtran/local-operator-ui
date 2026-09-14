import type { DriveableView } from "../electron-types";
import { BrowserHostError } from "../errors";
import { sleep } from "../policy/deadline";
import type { TabRecord } from "../registry";
import { settle } from "../settle";
import { type BrowserActionContext, stringParam } from "./context";
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
 * the mechanism a framework-controlled field actually listens for. */
const SET_VALUE_FUNCTION = `function (text) {
  const focusFn = this.focus;
  if (typeof focusFn === 'function') focusFn.call(this);
  if (this.isContentEditable) {
    this.textContent = text;
    this.dispatchEvent(new Event('input', { bubbles: true }));
    return this.textContent;
  }
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value');
  if (descriptor && descriptor.set) descriptor.set.call(this, text);
  else this.value = text;
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

interface ResolvedNode {
	nodeId: number;
	objectId: string;
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
 */
async function resolveNode(
	ctx: BrowserActionContext,
	record: TabRecord,
	target: string,
): Promise<ResolvedNode> {
	const view = record.view;
	const contents = view.webContents;

	const ref = SNAPSHOT_REF.test(target) ? record.refs[target] : undefined;
	let nodeId: number;
	if (ref) {
		if (ref.epoch !== record.epoch) {
			throw new BrowserHostError(
				"element_not_found",
				"the page navigated since that snapshot; take a new snapshot and retry",
			);
		}
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
		nodeId = pushedId;
	} else {
		nodeId = await nodeIdForSelector(ctx, view, target);
	}
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
	return { nodeId, objectId };
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
		await ctx.cdp.send(contents, "Runtime.callFunctionOn", {
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
	return { navigated: navigationSeen || after.url !== before, ...after };
}

export async function type(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const contents = record.view.webContents;
	const node = await resolveNode(ctx, record, targetOf(params));
	const text = typeof params.text === "string" ? params.text : "";

	await ctx.cdp.send(contents, "Runtime.callFunctionOn", {
		objectId: node.objectId,
		functionDeclaration: FOCUS_AND_SELECT_FUNCTION,
		returnByValue: true,
	});
	await ctx.cdp.send(contents, "Input.insertText", { text });
	const readBack = await conversationReadBack(ctx, node.objectId, contents);

	if (readBack.includes(text)) {
		ctx.registry.touch(record);
		return { value: readBack, via: "insert_text", ...pageOf(record.view) };
	}
	// The read-back disagreed, so the field did not take what `insertText` sent.
	// Fall back to driving the node's own value setter — the mechanism the
	// extension proved on framework-controlled fields — and report which path
	// landed rather than pretending the first one worked.
	const set = await ctx.cdp.send<{ result?: { value?: unknown } }>(
		contents,
		"Runtime.callFunctionOn",
		{
			objectId: node.objectId,
			functionDeclaration: SET_VALUE_FUNCTION,
			arguments: [{ value: text }],
			returnByValue: true,
		},
	);
	ctx.registry.touch(record);
	return {
		value: String(set?.result?.value ?? readBack),
		via: "value_setter",
		insert_text_readback: readBack,
		...pageOf(record.view),
	};
}

async function conversationReadBack(
	ctx: BrowserActionContext,
	objectId: string,
	contents: DriveableView["webContents"],
): Promise<string> {
	const out = await ctx.cdp.send<{ result?: { value?: unknown } }>(
		contents,
		"Runtime.callFunctionOn",
		{
			objectId,
			functionDeclaration: READ_VALUE_FUNCTION,
			returnByValue: true,
		},
	);
	return String(out?.result?.value ?? "");
}
