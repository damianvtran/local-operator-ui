import { createHash } from "node:crypto";
import { BrowserHostError } from "../errors";
import { drainLogs } from "../log-capture";
import { SCROLL_DIRECTIONS, sleep } from "../policy/adapter";
import type { LogEntry, ScrollResult } from "../protocol";
import type { TabRecord, TabRef } from "../registry";
import {
	type AXNode,
	compactAX,
	windowSnapshot,
} from "../vendor/driver/ax-compact";
import { locatorSuggestions } from "../vendor/driver/ax-locator";
import {
	CDP_DEADLINE_MS,
	SCRIPTING_DEADLINE_MS,
	deadline,
} from "../vendor/driver/deadline";
import {
	SCROLL_INTO_VIEW_FN,
	defaultScrollExpression,
	deltaScrollExpression,
	scrollExpressionFor,
} from "../vendor/driver/scroll-expressions";
import { type BrowserActionContext, numberParam, stringParam } from "./context";
import {
	FRAME_HOP,
	type FrameScope,
	MAX_FRAMES_SEARCHED,
	MAX_FRAME_DEPTH,
	enterFrame,
	sendIn,
	topScope,
} from "./frames";
import { pageOf } from "./gate";

/**
 * The page-reading actions: `read`, `snapshot`, `scroll`, `logs`, `screenshot`.
 * Design: docs/design/ui-browser-tab.md 4 (the matrix rows, each with its
 * mechanism), 6.4 (ref epochs), 12.1 (the substitutions).
 *
 * The two mechanisms worth naming here, because each is the row's whole argument:
 *
 * - `read` runs in an ISOLATED world (`executeJavaScriptInIsolatedWorld`). The
 *   main world would let the page observe the agent's reads and interfere with
 *   them; the isolated world is Electron's nearest equivalent of the extension's
 *   `ISOLATED` scripting world.
 * - `screenshot` uses `Page.captureScreenshot`, NOT `capturePage`. `capturePage`
 *   is documented as forcing visibility semantics ("the page is considered
 *   visible when its browser window is hidden and the capturer count is
 *   non-zero"), so capturing a hidden tab would change what the page renders.
 *   CDP capture sidesteps the question and returns the same base64 the Python side
 *   already validates against PNG magic.
 */

/** The world id `read` runs in. Non-zero: zero is the main world. */
export const ISOLATED_WORLD_ID = 999;

/**
 * The text extraction, as a fixed function with the selector passed as an
 * ARGUMENT rather than interpolated into code.
 *
 * The posture is the extension's: no page-supplied string is ever evaluated. The
 * selector is the agent's, not the page's, but the rule is kept unconditionally
 * because a rule with exceptions is the one that eventually gets it wrong. The
 * clone-and-strip is what makes a `read` of `<body>` show the document rather
 * than the page's scripts, and the whitespace collapse is what makes it readable
 * at all.
 */
/** A selector that is not valid CSS reaches us as an isolated-world rejection with
 * this in the message. Module scope: the linter's top-level-regex rule, and there
 * is no reason to compile it per read. Shared with `geometry.ts`, whose
 * selector-keyed reads raise the same refusal. */
export const INVALID_SELECTOR = /SyntaxError|not a valid selector/i;

const READ_FUNCTION = `function (selector) {
  const element = document.querySelector(selector);
  if (!element) return null;
  const clone = element.cloneNode(true);
  const strip = clone.querySelectorAll("script,style,noscript,template");
  for (const node of strip) node.remove();
  return (clone.textContent || "")
    .replace(/[ \\t\\u00a0]+/g, " ")
    .replace(/\\n\\s*\\n\\s*\\n+/g, "\\n\\n")
    .trim();
}`;

/** `read`: the page's text, or the refusal the tool already knows. */
export async function read(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const selector = stringParam(params, "selector") || "body";
	const code = `(${READ_FUNCTION})(${JSON.stringify(selector)})`;
	let text: unknown;
	try {
		text = await deadline(
			ctx.registry.guardRead(record, () =>
				record.view.webContents.executeJavaScriptInIsolatedWorld(
					ISOLATED_WORLD_ID,
					[{ code }],
				),
			),
			SCRIPTING_DEADLINE_MS,
			`read(${selector})`,
		);
	} catch (error) {
		// A syntax error in a selector reaches us as the isolated world's rejection;
		// it is the caller's input, not a host fault.
		if (error instanceof Error && INVALID_SELECTOR.test(error.message)) {
			throw new BrowserHostError(
				"element_not_found",
				`selector ${selector} is not valid`,
			);
		}
		throw error;
	}
	if (text === null || text === undefined) {
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} matched nothing`,
		);
	}
	ctx.registry.touch(record);
	return { text: String(text), ...pageOf(record.view) };
}

/**
 * The bytes an element shows, as a fixed isolated-world function.
 *
 * WHY A COMMITTED SOURCE STRING and not a page program built at runtime: the
 * same reason `READ_FUNCTION` is one — a bytecode build makes anything handed to
 * `Function.prototype.toString()` come back as a dummy zero-width source, so a
 * program the host cannot verify from its own tree is a program the next reader
 * has to guess about.
 *
 * WHY IT ISOLATED (the mirror of `read`'s reason, and load-bearing here in a way
 * it is not there): the text this returns is written to the USER'S CLIPBOARD, so
 * a page that could patch `Node.prototype.textContent` (or `value` on the input
 * prototypes) could have the host copy whatever it liked while the receipt —
 * `chars` and `sha256` — described the lie as if it were the element's content.
 * An isolated world shares the DOM but not the JavaScript heap, so the page
 * cannot see this function or redefine what it reads.
 *
 * EXACTLY ONE ELEMENT: `querySelectorAll` rather than `querySelector`, because a
 * selector that matches five things has no single answer, and silently copying
 * the first is how a caller copies a header instead of a key. The refusal names
 * what DID match (bounded to five, tag/id/name only — never their text, which is
 * what this action must not spill) so one call corrects the selector.
 *
 * `value` for a form field, trimmed `textContent` otherwise: an `input`'s
 * displayed content is its value (its text nodes are empty), while markup adds
 * the newlines and indentation of the source rather than of the text.
 */
export const COPY_TEXT_FUNCTION = `function (selector) {
  const matches = document.querySelectorAll(selector);
  if (matches.length !== 1) {
    return {
      status: matches.length === 0 ? "missing" : "ambiguous",
      count: matches.length,
      matches: Array.prototype.slice.call(matches, 0, 5).map(function (node) {
        return {
          tag: String(node.tagName || "").toLowerCase(),
          id: String(node.id || ""),
          name: String((node.getAttribute && node.getAttribute("name")) || ""),
        };
      }),
    };
  }
  const element = matches[0];
  const tag = String(element.tagName || "").toLowerCase();
  const field = tag === "input" || tag === "textarea" || tag === "select";
  const raw = field ? element.value : element.textContent;
  return {
    status: "ok",
    count: 1,
    tag: tag,
    id: String(element.id || ""),
    name: String((element.getAttribute && element.getAttribute("name")) || ""),
    text: field ? String(raw === null || raw === undefined ? "" : raw) : String(raw === null || raw === undefined ? "" : raw).trim(),
  };
}`;

/** What the page program above answers, as much of it as this module reads. */
interface CopyAnswer {
	status?: string;
	count?: number;
	matches?: Array<{ tag?: string; id?: string; name?: string }>;
	tag?: string;
	id?: string;
	name?: string;
	text?: string;
}

/** `copy`'s answer: identity proof for bytes that never travel with it. */
export interface CopyResult {
	/** The text's length in CODE POINTS (Python's `len`), not UTF-16 units. */
	chars: number;
	/** The first 16 hex characters of the UTF-8 bytes' SHA-256. */
	sha256: string;
	element: { tag: string; id: string; name: string };
	/** Whether a compare-only readback in MAIN matched what was written. */
	verified: boolean;
}

/**
 * `copy`: put an element's bytes on the OS clipboard, from the MAIN process.
 *
 * WHY MAIN AND NOT THE PAGE: the page's own `navigator.clipboard.writeText` is
 * the mechanism requirement 1 fixes (the permission grant in `profile.ts`), but
 * a harness action cannot depend on a page permission, on a user gesture, or on
 * the page not overriding the API — and an agent must be able to copy from a page
 * whose copy button is broken or absent. `clipboard.writeText` in main has none
 * of those dependencies, and this host already writes the user's clipboard from
 * main for the page context menu's "Copy link address" (`index.ts`).
 *
 * WHAT NEVER LEAVES THIS FUNCTION: the text. Not in the result, not in a log
 * line, not in an error message, not in a stack — the receipt carries `chars` and
 * a 16-hex fingerprint instead, which is enough to prove WHICH bytes landed
 * without ever holding them. That is the whole reason this action exists: a key
 * displayed exactly once must reach a secret store, or a shell, without passing
 * through a transcript on the way.
 *
 * THE READBACK IS COMPARE-ONLY: `clipboard.readText()` runs in main (never in a
 * page, so it is not the read permission this session refuses), its value is
 * compared and dropped, and only the boolean survives. A `verified: false` is an
 * honest "something else owns the clipboard now" — the write still happened.
 *
 * ERRORS travel as codes from the ONE vocabulary (`protocol.py`'s `ErrorCode`,
 * mirrored in `protocol.ts`): an unknown code is SILENTLY DROPPED by the
 * session's model validation, and the caller then waits out its whole budget. A
 * missing, ambiguous or invalid selector is `element_not_found` with
 * `data.reason` naming which (the code every caller already branches on), an
 * element that exists with no text is `empty_element_text`, and a clipboard the
 * OS refused is `clipboard_write_failed` — the two codes added with this action,
 * because collapsing either into the older ones would give the model advice for
 * the wrong problem.
 */
export async function copy(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const selector = stringParam(params, "selector");
	if (!selector) {
		throw new BrowserHostError("internal", "copy needs a selector", {
			reason: "invalid_arguments",
		});
	}
	const record = ctx.registry.requireSurface(params.tab);
	const code = `(${COPY_TEXT_FUNCTION})(${JSON.stringify(selector)})`;
	let answer: unknown;
	try {
		answer = await deadline(
			ctx.registry.guardRead(record, () =>
				record.view.webContents.executeJavaScriptInIsolatedWorld(
					ISOLATED_WORLD_ID,
					[{ code }],
				),
			),
			SCRIPTING_DEADLINE_MS,
			`copy(${selector})`,
		);
	} catch (error) {
		// A syntax error in a selector reaches us as the isolated world's rejection;
		// it is the caller's input, not a host fault.
		if (error instanceof Error && INVALID_SELECTOR.test(error.message)) {
			throw new BrowserHostError(
				"element_not_found",
				`selector ${selector} is not valid`,
			);
		}
		throw error;
	}
	const read = (
		answer && typeof answer === "object" ? answer : {}
	) as CopyAnswer;
	if (read.status === "missing") {
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} matched nothing`,
		);
	}
	if (read.status === "ambiguous") {
		const count = typeof read.count === "number" ? read.count : 0;
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} matched ${count} elements; copy needs exactly one`,
			{
				reason: "ambiguous_selector",
				count,
				matches: Array.isArray(read.matches) ? read.matches : [],
			},
		);
	}
	if (read.status !== "ok" || typeof read.text !== "string") {
		// The document went away between the registry lookup and the read, or the
		// isolated world answered something this host does not recognise. Naming it
		// as a host fault is the honest reading: a page cannot produce this shape
		// through the committed program above.
		throw new BrowserHostError(
			"internal",
			`copy could not read the element ${selector} names`,
			{ reason: "unreadable_answer" },
		);
	}
	if (!read.text) {
		// The element EXISTS and is empty (a cleared field, a placeholder-only
		// button). `element_not_found` is the code the session branches on and this
		// list has no `empty`; `reason` is what says which case it was, so the
		// model's correction is "there is nothing to copy", not "wrong selector".
		throw new BrowserHostError(
			"empty_element_text",
			`selector ${selector} matched an element with no text to copy`,
			{ reason: "empty_text" },
		);
	}
	const text = read.text;
	/*
	 * WHY THE ELECTRON IMPORT IS DYNAMIC AND NOT AT MODULE SCOPE: this module is
	 * bundled by several node-only rigs (`browser-select`, `browser-chord`,
	 * `browser-page-controls`, `browser-toolbar`, `browser-chrome-gaps` all reach it
	 * through `select.ts`/`input.ts`/`query.ts`), and the electron package's
	 * `index.js` calls `getElectronPath()` at module scope, which throws in plain
	 * Node when the binary is not where it expects. A static import here would make
	 * every one of those bundles require the electron binary just to load a module
	 * that never touches the clipboard — so the import happens inside the ONE
	 * function that needs it, and a rig that never calls `copy` never resolves it.
	 */
	const { clipboard } = await import("electron");
	try {
		// `await` because this runtime's clipboard is PROMISE-ONLY (Electron 45 made
		// `writeText`/`readText` async — the same change `index.ts`'s paste handler
		// answers with `sendSync`). A dropped rejection here would report a receipt for
		// a copy that never happened, which is the one failure this action must not have.
		await clipboard.writeText(text);
	} catch (error) {
		// The OS clipboard refused (a sandboxed or locked session, a platform
		// without one). Never interpolate the text into this message: the caller
		// gets the reason, not the bytes.
		throw new BrowserHostError(
			"clipboard_write_failed",
			`the clipboard refused the text of ${selector}: ${error instanceof Error ? error.message : String(error)}`,
			{ reason: "clipboard_write_failed" },
		);
	}
	let verified = false;
	try {
		verified = (await clipboard.readText()) === text;
	} catch {
		// A readback that fails is not a write that failed; `verified: false` says
		// only that this function could not confirm it.
		verified = false;
	}
	const receipt: CopyResult = {
		// `chars` is the character count a reader expects (code points, so an emoji
		// counts once), not `String.length`'s UTF-16 units: the audience for this
		// number is a person checking a key came across whole.
		chars: Array.from(text).length,
		// THE FINGERPRINT IS THE POINT OF THE RECEIPT: it lets a caller prove WHICH
		// bytes landed on the clipboard without ever holding them, and it is what
		// makes `lop secret set` verifiable later — re-copy the same element, compare
		// the hash, and know the value is the one already stored.
		sha256: createHash("sha256")
			.update(text, "utf8")
			.digest("hex")
			.slice(0, 16),
		element: {
			tag: typeof read.tag === "string" ? read.tag : "",
			id: typeof read.id === "string" ? read.id : "",
			name: typeof read.name === "string" ? read.name : "",
		},
		verified,
	};
	ctx.registry.touch(record);
	return { ...receipt };
}

/**
 * `snapshot`: the accessibility tree, pruned, with refs stamped by epoch.
 *
 * Refs are stored ON THE TAB (`record.refs`), never globally: a snapshot taken on
 * one tab must never supply the click target on another (the extension keeps refs
 * per surface for this exact reason). The epoch they carry is what makes the
 * agent's next `click` fail with `element_not_found` when the page moved under it
 * instead of clicking whatever now sits at that position.
 */
export async function snapshot(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const contents = record.view.webContents;
	// The scope is resolved BEFORE the a11y read, and the order is the contract:
	// a selector that matches nothing must fail as a typed element_not_found
	// naming the selector, without paying for a whole tree first (agent review
	// round 1, R1-3 — the comment claimed this order while the read came first).
	const scope = stringParam(params, "selector");
	const rootBackendNodeId = scope
		? await backendNodeIdForSelector(ctx, record.view, scope)
		: undefined;
	// Enabling the a11y domain for the read window is documented CDP hygiene: a
	// bare `getFullAXTree` on a freshly attached target can return a degraded tree
	// on some Chromium builds.
	await ctx.cdp.send(contents, "Accessibility.enable", {});
	let nodes: AXNode[] = [];
	try {
		const tree = await ctx.cdp.send<{ nodes?: AXNode[] }>(
			contents,
			"Accessibility.getFullAXTree",
			{},
		);
		nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
	} finally {
		// Bounded and catch-all: a view that died between enable and read needs no
		// disable, and a failed disable must not replace the read's outcome.
		await ctx.cdp.send(contents, "Accessibility.disable", {}).catch(() => {});
	}
	const {
		snapshot: topRendered,
		refs: topRefs,
		scoped,
		framesInScope,
	} = compactAX(nodes, record.epoch, { rootBackendNodeId });
	if (rootBackendNodeId !== undefined && !scoped) {
		// The DOM element exists but contributes no accessible node
		// (display:none, aria-hidden, or inside a closed <details>). "matched
		// nothing" would be a lie here; name the state the agent has to change.
		throw new BrowserHostError(
			"element_not_found",
			`selector ${scope} matched an element with no accessibility subtree (hidden, aria-hidden, or inside a collapsed section); expand it first, then snapshot again`,
		);
	}
	const refs: Record<string, TabRef> = { ...topRefs };
	let rendered = topRendered;
	// Frames are walked only when the page's own tree shows one, so a page with no
	// iframe sends exactly the commands it always sent (ARCH-1). A SCOPED read
	// deliberately does not walk them: the caller asked for one subtree, and a
	// frame block would arrive from a different document than the scope names.
	if (!scope && nodes.some(isFrameNode)) {
		const blocks = await frameSnapshots(ctx, record, nodes, refs);
		if (blocks.length) rendered = [rendered, ...blocks].join("\n");
	}
	record.refs = refs;
	ctx.registry.touch(record);
	// Windowed at the TEXT level, after refs are minted, so a ref keeps its name
	// across pages: an agent that pages a form and then clicks a ref it saw two
	// calls ago clicks the element it read. The numbers are what the footer in
	// the Python tool renders.
	// A scoped read deliberately does not walk frames, but silence is the failure
	// this lane exists to kill: a scoped subtree that CONTAINS a frame host would
	// otherwise read as "this section is one line" (agent review round 1, R1-2).
	//
	// THE COUNT IS THE SCOPE'S OWN (agent review round 2, R2-1): gating on the
	// page's tree told a caller that a frameless section held a frame it was not
	// seeing, and — because the note was appended before the window — it also
	// inflated `total_lines` and could match `search=`. Appending it AFTER the
	// window keeps it a remark about the scope, not a line of the tree.
	let note = "";
	if (scope && framesInScope > 0) {
		const frames = framesInScope;
		note =
			`\n- (a scoped snapshot does not read frames: this section contains ${frames} frame` +
			`${frames === 1 ? "" : "s"}; snapshot without selector= for their contents)`;
	}
	const page = windowSnapshot(rendered, {
		search: stringParam(params, "search"),
		start: numberParam(params, "start") ?? 1,
		limit: numberParam(params, "limit") ?? 0,
	});
	return {
		snapshot: page.text + note,
		refs: Object.keys(refs).length,
		epoch: record.epoch,
		scoped,
		frames_in_scope: framesInScope,
		total_lines: page.totalLines,
		matched_lines: page.matchedLines,
		returned_lines: page.returnedLines,
		start: page.start,
		limit: page.limit,
		search: page.search,
		...pageOf(record.view),
	};
}

/** The AX role Chromium gives an `<iframe>`/`<frame>` element. */
function isFrameNode(node: AXNode): boolean {
	return node.role?.value === "Iframe" && node.backendDOMNodeId !== undefined;
}

/** A ref label in a rendered line. Module scope: the top-level-regex rule. */
const REF_LABEL = /\[e(\d+)\]/g;

/**
 * One nested block per frame the page's tree names, each from that frame's OWN
 * AX tree: the page's tree stops at the frame boundary (measured: no textbox for
 * a field inside a cross-site OR a same-site frame).
 *
 * Refs continue the page's counter, so a ref name is still `e<n>` and unique on
 * the tab; each carries the frame's session target and origin (`TabRef`). An
 * out-of-process frame's tree comes from its child session; a same-process one
 * from the session that holds it, by `frameId`. A frame that fails to read is
 * skipped rather than failing the page's snapshot. Bounded by the same depth and
 * frame caps as the selector search.
 */
async function frameSnapshots(
	ctx: BrowserActionContext,
	record: TabRecord,
	topNodes: AXNode[],
	refs: Record<string, TabRef>,
): Promise<string[]> {
	const contents = record.view.webContents;
	const blocks: string[] = [];
	let entered = 0;
	let level: Array<{ scope: FrameScope; nodes: AXNode[] }> = [
		{ scope: await topScope(ctx, contents), nodes: topNodes },
	];
	for (let depth = 0; depth < MAX_FRAME_DEPTH && level.length; depth += 1) {
		const next: typeof level = [];
		for (const { scope: parent, nodes } of level) {
			for (const frameNode of nodes.filter(isFrameNode)) {
				if (entered >= MAX_FRAMES_SEARCHED) return blocks;
				entered += 1;
				try {
					const pushed = await sendIn<{ nodeIds?: number[] }>(
						ctx,
						contents,
						parent.sessionId,
						"DOM.pushNodesByBackendIdsToFrontend",
						{ backendNodeIds: [frameNode.backendDOMNodeId] },
					);
					const iframeNodeId = pushed?.nodeIds?.[0];
					if (!iframeNodeId) continue;
					// `enterFrame` refuses a frame from an origin the user DENIED before
					// reading anything in it, so it contributes no line, ref or text and
					// its subtree is not walked (review round 1 M1, QA round 2 Q-3).
					const scope = await enterFrame(ctx, contents, parent, iframeNodeId);
					const frameNodes = await frameTree(ctx, contents, scope);
					const { snapshot: inner, refs: innerRefs } = compactAX(
						frameNodes,
						record.epoch,
					);
					const offset = Object.keys(refs).length;
					for (const [name, ref] of Object.entries(innerRefs)) {
						refs[`e${Number(name.slice(1)) + offset}`] = {
							...ref,
							...(scope.frameTargetId ? { frameId: scope.frameTargetId } : {}),
							frameOrigin: scope.origin ?? "",
						};
					}
					const indent = "  ".repeat(depth);
					const body = inner
						.replace(REF_LABEL, (_m, n) => `[e${Number(n) + offset}]`)
						.split("\n")
						.filter(Boolean)
						.map((line) => `${indent}  ${line}`);
					blocks.push(
						`${indent}- frame ${scope.path.join(` ${FRAME_HOP} `)}${scope.origin ? ` (${scope.origin})` : ""}:`,
						...body,
					);
					next.push({ scope, nodes: frameNodes });
				} catch (error) {
					// One unreadable frame is skipped; a tab DevTools took, or one that
					// closed, ends the snapshot with its own typed answer (round 1, m2).
					if (
						error instanceof BrowserHostError &&
						error.code !== "debugger_conflict" &&
						error.code !== "tab_closed"
					)
						continue;
					throw error;
				}
			}
		}
		level = next;
	}
	return blocks;
}

async function frameTree(
	ctx: BrowserActionContext,
	contents: TabRecord["view"]["webContents"],
	scope: FrameScope,
): Promise<AXNode[]> {
	// A same-process frame shares its parent's session; `frameId` picks its
	// document. An out-of-process frame's session IS its document.
	const params =
		scope.frameTargetId === scope.frameId || !scope.frameId
			? {}
			: { frameId: scope.frameId };
	await sendIn(ctx, contents, scope.sessionId, "Accessibility.enable", {});
	try {
		const tree = await sendIn<{ nodes?: AXNode[] }>(
			ctx,
			contents,
			scope.sessionId,
			"Accessibility.getFullAXTree",
			params,
		);
		return Array.isArray(tree?.nodes) ? tree.nodes : [];
	} finally {
		await sendIn(
			ctx,
			contents,
			scope.sessionId,
			"Accessibility.disable",
			{},
		).catch(() => {});
	}
}

/** The scroll-position report, as a fixed expression: `moreBelow`/`moreRight`
 * are what let the agent stop paging at the end instead of looping. */
const METRICS_EXPRESSION = `(() => {
  const de = document.scrollingElement || document.documentElement;
  const x = window.scrollX, y = window.scrollY;
  return {
    scrollX: Math.round(x),
    scrollY: Math.round(y),
    moreBelow: (de.scrollHeight - (y + window.innerHeight)) > 1,
    moreRight: (de.scrollWidth - (x + window.innerWidth)) > 1,
  };
})()`;

/**
 * `scroll`: selector → explicit deltas → direction → one viewport down.
 *
 * Every movement goes through the FIXED expressions in `vendor/driver/scroll-
 * expressions.ts`, and every one of them pins `behavior:'instant'`: a smooth
 * scroll is a rAF-driven animation and Chromium throttles rAF to zero in a hidden
 * view, which is exactly what an agent-driven tab is.
 */
export async function scroll(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const contents = record.view.webContents;
	const selector = stringParam(params, "selector");
	const direction = stringParam(params, "direction").toLowerCase();
	const dx = numberParam(params, "x");
	const dy = numberParam(params, "y");

	if (selector) {
		const nodeId = await nodeIdForSelector(ctx, record.view, selector);
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
				`selector ${selector} matched nothing`,
			);
		}
		await ctx.cdp.send(contents, "Runtime.callFunctionOn", {
			objectId,
			functionDeclaration: SCROLL_INTO_VIEW_FN,
			returnByValue: true,
		});
	} else if (dx !== undefined || dy !== undefined) {
		await ctx.cdp.send(contents, "Runtime.evaluate", {
			expression: deltaScrollExpression(dx ?? 0, dy ?? 0),
			returnByValue: true,
		});
	} else if (direction) {
		if (!SCROLL_DIRECTIONS.has(direction)) {
			throw new BrowserHostError(
				"internal",
				`unknown scroll direction: ${direction} (top/bottom/up/down/left/right)`,
			);
		}
		await ctx.cdp.send(contents, "Runtime.evaluate", {
			expression: scrollExpressionFor(direction),
			returnByValue: true,
		});
	} else {
		await ctx.cdp.send(contents, "Runtime.evaluate", {
			expression: defaultScrollExpression(),
			returnByValue: true,
		});
	}

	// Scrolls are instant now, but scroll-linked effects (lazy loading, sticky
	// headers, IntersectionObserver reveals) may still reflow the page right
	// after; a short settle keeps the reported position and `moreBelow` honest.
	await sleep(150);
	const metrics = await readMetrics(ctx, record.view);
	ctx.registry.touch(record);
	const result: ScrollResult = {
		...metrics,
		...pageOf(record.view),
	};
	return { ...result };
}

async function readMetrics(
	ctx: BrowserActionContext,
	view: import("../electron-types").DriveableView,
): Promise<Omit<ScrollResult, "url" | "title">> {
	const out = await ctx.cdp.send<{
		result?: { value?: Partial<ScrollResult> };
	}>(view.webContents, "Runtime.evaluate", {
		expression: METRICS_EXPRESSION,
		returnByValue: true,
	});
	const value = out?.result?.value ?? {};
	return {
		scrollX: Number(value.scrollX ?? 0),
		scrollY: Number(value.scrollY ?? 0),
		moreBelow: Boolean(value.moreBelow),
		moreRight: Boolean(value.moreRight),
	};
}

/**
 * `logs`: the buffered console, exceptions and browser messages for this tab.
 *
 * Reads a ring buffer that has been filling since the tab was attached — the
 * whole point of `logs` is that a page's console history is not readable after
 * the fact, so an uncaught exception that already happened must have been
 * captured when it happened.
 */
export async function logs(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const level = stringParam(params, "level").toLowerCase();
	const limit = numberParam(params, "limit");
	const entries: LogEntry[] = drainLogs(record.view.webContents.id, {
		level: level && level !== "all" ? level : "",
		limit,
	});
	return { entries, count: entries.length, ...pageOf(record.view) };
}

/** `screenshot`: a PNG, as base64. The Python side keeps path resolution, the
 * PNG-magic check and the write approval — this host never writes a file.
 *
 * WHY the zero-area guard, with the measurement behind it: with the view left at
 * its default 0x0 there is nothing to capture on any path, and
 * `Page.captureScreenshot` then NEVER REPLIES (measured: 15 s, twice, while `read`,
 * `snapshot` and `scroll` on the same page answered in tens of milliseconds). A
 * 15 s stall with no explanation is the worst version of that, so it is refused up
 * front and the refusal names the cause.
 *
 * The capture is ONE shape for every view — the note at the call site carries the
 * measurement — and the retry's ceiling is unchanged: `BACKGROUND_CAPTURE_ATTEMPT_MS`
 * records the runs that kept it after the flag changed. */
export async function screenshot(
	ctx: BrowserActionContext,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const record = ctx.registry.requireSurface(params.tab);
	const contents = record.view.webContents;
	const bounds = record.view.getBounds?.();
	if (bounds && (bounds.width === 0 || bounds.height === 0)) {
		throw new BrowserHostError(
			"internal",
			"the browser view has no area to capture: the app's browser chrome has not reported a page area yet",
			{ reason: "no_content_rect" },
		);
	}
	await ctx.cdp.attach(contents);
	// ONE SHAPE FOR EVERY VIEW, and `captureBeyondViewport: false` on a BACKGROUND
	// tab is the reversal of what this file argued before. `true` asks Chromium to
	// produce the capture beyond the viewport; combined with a `clip` that means
	// emulating the clip box AS the viewport. Measured through the proof rig
	// (Electron 44, 2026-10-02): that call RESIZED the renderer of a hidden 1280x720
	// view and fired TWO page `resize` events, and the reading is §5d's own capture
	// check (`a capture does not resize the page`, `resize 0 -> 2`,
	// `lastResizeSize=1280x720`) — NOT the ladder, whose row for the same shapes is
	// the opposite reading and no less informative: the clipped call answered
	// NOTHING inside 20 s in both runs. The resize landed on a page whose viewport
	// already read 1280x720, so the capture was not even buying the shape it claimed.
	// `false` copies the COMPOSITED surface: on the same hidden view it answered in
	// 1.2 s with a viewport-sized PNG and fired NO `resize` at all. That difference is
	// a correctness bug rather than a nicety, because a page
	// `resize` closes an open `radix-ui/react-select` popup (`SelectContentImpl`
	// listens for it), so an agent's own screenshot dismissed the popup it was about
	// to read — the same class of blindness as the popup that never painted, whose
	// content Radix clamps through `--radix-select-content-available-height`.
	//
	// WHY THE OLD MEASUREMENT STILL LOOKS RIGHT: "`false` never replied on a hidden
	// view" (6 s, 8 s and 15 s ceilings) was real, and it predates sizing a view
	// BEFORE its first hide (`index.ts`'s `setBounds(BACKGROUND_VIEWPORT)`). A view
	// that was hidden before it was ever sized has no surface to composite; one that
	// was sized first does. The ladder's COMPOSITED row is the re-measurement that
	// settles it — it answered with no resize at all on both runs (1205 ms, then
	// 100 ms) — and its CLIPPED row, which answered NOTHING inside 20 s, is the other
	// half of why the reverse argument is not kept as a fallback.
	//
	// The per-attempt ceiling and the retry are NOT what this fix removes — see the
	// retry's own note below — only the flag and the clip are.
	const attempts = record.presented ? 1 : 3;
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const attemptShot = await ctx.cdp.send<{ data?: string }>(
				contents,
				"Page.captureScreenshot",
				{ format: "png", captureBeyondViewport: false },
				{
					deadlineMs: record.presented
						? undefined
						: BACKGROUND_CAPTURE_ATTEMPT_MS,
				},
			);
			return finishCapture(ctx, record, attemptShot);
		} catch (error) {
			// Only a STALL is retryable: it is the typed "no reply" arm the deadline
			// helper produces. A teardown, a debugger conflict or a protocol error is
			// the real answer and retrying would only delay it.
			if (!isStall(error) || attempt === attempts - 1) throw error;
			lastError = error;
		}
	}
	throw lastError;
}

/** One attempt's ceiling for a BACKGROUND capture, and it is a retry trigger
 * rather than a work limit: the stall it bounds is the typed "this call had no
 * frame to produce" answer, which the next attempt resolves. Three of these fit
 * inside the 20 s screenshot budget while still leaving the handler its 5 s to
 * build an answer — the nesting rule the deadline table documents.
 *
 * WHY IT SURVIVES THE FLAG CHANGE, measured rather than assumed: the refusal to
 * retry would have been the tempting simplification ("copying a composited frame
 * cannot stall"), and the proof rig refuted it on the first AFTER run — the very
 * first capture of a freshly-created hidden view stalled at its 15 s ceiling with
 * `captureBeyondViewport: false`, and the next attempt answered. Lazy frame
 * production belongs to a hidden view rather than to the clipped shape, so the
 * retry stays exactly as it was.
 *
 * DEFENCE IN DEPTH, and QA measured the arm this covers on the long run: the chosen
 * shape can stall inside its own 20 s ceiling when it runs FIRST on a view left
 * mutated by earlier beyond-viewport captures (the ladder's clipped and contrast legs
 * leave such a view at the full content height), while the same shape answers
 * immediately on a fresh view and on every shipped-path capture. The 3 x 5 s retry is
 * what turns that arm into a recovered call instead of a failed action — reported as
 * defence in depth rather than as an exercised path, because the stall did not
 * reproduce on a fresh view. */
const BACKGROUND_CAPTURE_ATTEMPT_MS = 5_000;

/** Whether an error is the deadline helper's typed "no reply" arm.
 *
 * Kept as a test of the SHAPE rather than of a message: `deadline()` rejects with
 * `data.stalled` and the wire keeps the code `internal` deliberately (an unknown
 * code is dropped by an older peer's validation, which turns a typed refusal into
 * a blind timeout). */
function isStall(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		typeof (error as { data?: { stalled?: unknown } }).data?.stalled ===
			"string"
	);
}

/** Validate and shape one successful capture for the caller. */
function finishCapture(
	ctx: BrowserActionContext,
	record: TabRecord,
	shot: { data?: string } | undefined,
): Record<string, unknown> {
	const data = shot?.data;
	if (!data) {
		throw new BrowserHostError(
			"internal",
			"the page returned no screenshot data",
		);
	}
	ctx.registry.touch(record);
	return { data, ...pageOf(record.view) };
}

/** Resolve a CSS selector to a DOM node id, with the document requested first
 * (Chromium rejects node operations on a session that has not asked for the
 * document). */
export async function nodeIdForSelector(
	ctx: BrowserActionContext,
	view: import("../electron-types").DriveableView,
	selector: string,
): Promise<number> {
	const contents = view.webContents;
	const document = await ctx.cdp.send<{ root?: { nodeId?: number } }>(
		contents,
		"DOM.getDocument",
		{ depth: 0 },
	);
	const rootId = document?.root?.nodeId;
	if (rootId === undefined) {
		throw new BrowserHostError("internal", "the page has no document to query");
	}
	const queried = await ctx.cdp.send<{ nodeId?: number }>(
		contents,
		"DOM.querySelector",
		{
			nodeId: rootId,
			selector,
		},
	);
	if (!queried?.nodeId) {
		// The miss names the elements that DO exist (measured: nine CSS guesses,
		// each a whole tool call, each answering only "element not found").
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} matched nothing`,
			{ candidates: await missCandidates(ctx, view, selector) },
		);
	}
	return queried.nodeId;
}

/** The page's accessibility tree for a read that needs it (locators,
 *  candidates). Enable → read → disable, the documented window `snapshot` uses.
 *
 *  What serializes two commands on ONE tab is the host's per-tab command lane
 *  (`host.ts` → `registry.lane`, `busy` set in `registry.ts`), NOT `CdpPool`:
 *  `cdp.ts`'s `send` calls `debugger.sendCommand` immediately with no per-target
 *  lock. Naming the wrong mechanism is how a future reader trusts a lock that
 *  does not exist — the extension needed an explicit queue for this exact hazard
 *  (`commands/ax-tree.ts`) (agent review round 1, R1-2; the claim moved here
 *  with the helper and was corrected in place).
 *
 *  TOP-FRAME ONLY, and that is MEASURED, not promised (agent review round 1,
 *  R1-1): driven against the built app on 2026-10-23 over `iframe#pay-frame`
 *  (same site, port 8766) holding a button named "Pay now", `click
 *  text="Pay now"` answered `element_not_found` while `snapshot` showed the
 *  frame's contents through its own sessions. A locator therefore cannot land
 *  in a frame, cannot bypass `assertFrameNotDenied`, and cannot mis-report
 *  `frame_origin`; frames stay reachable through the explicit `>>>` hop.
 *
 *  Lives here rather than in `input.ts` because both the locator resolver and
 *  the miss diagnostics need it, and `page.ts` is what `input.ts` imports (the
 *  reverse would be a cycle). */
export async function readAccessibilityTree(
	ctx: BrowserActionContext,
	contents: import("../electron-types").DriveableView["webContents"],
): Promise<AXNode[]> {
	await ctx.cdp.send(contents, "Accessibility.enable", {});
	try {
		const tree = await ctx.cdp.send<{ nodes?: AXNode[] }>(
			contents,
			"Accessibility.getFullAXTree",
			{},
		);
		return Array.isArray(tree?.nodes) ? tree.nodes : [];
	} finally {
		await ctx.cdp.send(contents, "Accessibility.disable", {}).catch(() => {});
	}
}

/** The closest real elements for a selector that matched nothing, in the shape
 *  the tool renders (`role`, `name`, `locator`). Best-effort: a tree read that
 *  fails must not replace the caller's own error. */
async function missCandidates(
	ctx: BrowserActionContext,
	view: import("../electron-types").DriveableView,
	selector: string,
): Promise<Array<{ role: string; name: string; locator: string }>> {
	const nodes = await readAccessibilityTree(ctx, view.webContents).catch(
		() => [],
	);
	return locatorSuggestions(nodes, selector);
}

/** A CSS selector's element, named by the id the ACCESSIBILITY tree uses.
 *
 * `snapshot` scoping needs this rather than `nodeIdForSelector`: the AX tree
 * indexes nodes by `backendDOMNodeId`, while frontend node ids belong to one
 * session's document. The describe hop translates, and `depth: 0` keeps it to
 * the element itself. It lives here, beside `nodeIdForSelector`, because the
 * document-request dance and the typed miss should have exactly one spelling.
 */
export async function backendNodeIdForSelector(
	ctx: BrowserActionContext,
	view: import("../electron-types").DriveableView,
	selector: string,
): Promise<number> {
	const nodeId = await nodeIdForSelector(ctx, view, selector);
	const described = await ctx.cdp.send<{ node?: { backendNodeId?: number } }>(
		view.webContents,
		"DOM.describeNode",
		{ nodeId, depth: 0 },
	);
	const backendNodeId = described?.node?.backendNodeId;
	if (backendNodeId === undefined) {
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} has no backend node id`,
		);
	}
	return backendNodeId;
}

/** Re-exported for `input.ts`, which resolves refs against the same table. */
export const CDP_COMMAND_DEADLINE_MS = CDP_DEADLINE_MS;
