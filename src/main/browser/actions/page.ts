import { BrowserHostError } from "../errors";
import { drainLogs } from "../log-capture";
import { SCROLL_DIRECTIONS, sleep } from "../policy/adapter";
import type { LogEntry, ScrollResult } from "../protocol";
import type { TabRecord } from "../registry";
import { type AXNode, compactAX } from "../vendor/driver/ax-compact";
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
 * is no reason to compile it per read. */
const INVALID_SELECTOR = /SyntaxError|not a valid selector/i;

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
			record.view.webContents.executeJavaScriptInIsolatedWorld(
				ISOLATED_WORLD_ID,
				[{ code }],
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
	const { snapshot: rendered, refs } = compactAX(nodes, record.epoch);
	record.refs = refs;
	ctx.registry.touch(record);
	return {
		snapshot: rendered,
		refs: Object.keys(refs).length,
		epoch: record.epoch,
		...pageOf(record.view),
	};
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
 * The capture itself branches on `presented` — see the flag's own note at the call
 * site for the measurement that makes a background tab need it. */
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
	// TWO FLAGS, ONE COMMAND, and the flag is what makes a background capture
	// possible at all. `captureBeyondViewport: false` — the historical value — asks
	// Chromium to copy the COMPOSITED surface, which a hidden view does not have, so
	// on a background tab the command never replied (measured: 6 s, 8 s and 15 s
	// ceilings all expired, while `read`, `snapshot` and `type` on the same tab
	// answered in tens of milliseconds). `true` asks for the capture to be produced
	// from the view's own rendering and answers on a hidden view with a real
	// viewport-sized PNG (measured: 18,672 bytes, 2560x1440 — the view's 1280x720 at
	// 2x, NOT the taller document).
	//
	// The presented case keeps `false` deliberately: it is the narrower operation,
	// it is what the foreground path has always used, and changing a path that works
	// is not part of this fix.
	//
	// WHY A RETRY, and why only here: a HIDDEN view produces a frame lazily, so
	// consecutive background captures alternate between answering and never
	// answering — measured on one hidden view, six calls in a row: OK, stall, OK,
	// stall, OK, stall. The stall is not slowness, it is "this call had no frame to
	// produce", and the very next call has one, so a second attempt is a
	// deterministic recovery rather than a hopeful wait. The attempts are bounded so
	// the whole action still fits the 20 s screenshot budget with room for the
	// handler to answer: 3 x 5 s = 15 s, which is exactly the innermost ceiling the
	// deadline table allows (`CDP_DEADLINE_MS`). A presented view needs none of this
	// — it has a composited surface — so it keeps a single attempt at the full
	// ceiling and its behaviour is unchanged.
	const beyondViewport = !record.presented;
	// The clip is what makes a background capture the tab's VIEWPORT rather than the
	// whole document: without it, the same call returned 2560x3778 for a 1280x720
	// view (measured), while with a clip to the view's own bounds it returned
	// 2560x1440 — the dimension the PRESENTED path returns, so one tool still
	// produces one shape. `scale: 1` is deliberate: scale 2 doubled it to 5120x2880.
	const viewportBounds = record.view.getBounds?.();
	const clip =
		beyondViewport && viewportBounds
			? { ...viewportBounds, scale: 1 }
			: undefined;
	const attempts = beyondViewport ? 3 : 1;
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const attemptShot = await ctx.cdp.send<{ data?: string }>(
				contents,
				"Page.captureScreenshot",
				{
					format: "png",
					captureBeyondViewport: beyondViewport,
					...(clip ? { clip } : {}),
				},
				{
					deadlineMs: beyondViewport
						? BACKGROUND_CAPTURE_ATTEMPT_MS
						: undefined,
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
 * build an answer — the nesting rule the deadline table documents. */
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
		throw new BrowserHostError(
			"element_not_found",
			`selector ${selector} matched nothing`,
		);
	}
	return queried.nodeId;
}

/** Re-exported for `input.ts`, which resolves refs against the same table. */
export const CDP_COMMAND_DEADLINE_MS = CDP_DEADLINE_MS;
