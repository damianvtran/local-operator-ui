/**
 * One generated component in its sandboxed frame (turn-supplements memo §4.1/§4.2,
 * lane U-b).
 *
 * THE INVARIANT, and nothing beyond it: `<iframe sandbox="allow-scripts"
 * src="data:text/html;base64,…">` — an opaque origin, no bridge/preload, no
 * network (the document's own CSP closes `connect-src`), no file access, no
 * popups, and a navigation guard on both sides of the boundary:
 *
 *   - MAIN permits exactly ONE child-frame navigation per mount — the exact
 *     `data:` URL the renderer armed immediately before setting `src`
 *     (`supplement-mounts.ts`; `armSupplementFrame`) — and denies every later
 *     one, so a component that tries to navigate itself (or a `meta refresh`)
 *     is stopped before the request is issued;
 *   - THIS component counts `load` events: the second `load` is a hostile
 *     navigation or a blocked attempt (measured on Chrome 155: a blocked
 *     navigation fires a second `load` too), so the frame is torn down into the
 *     frame-level fallback line and every later message from it is dropped.
 *
 * THE MESSAGE WIRE (host side) is exactly the contract's: the host sends
 * `{lo:"supplement-host", t:"theme", mode, vars, nonce}` (the nonce minted per
 * frame, carried in the FIRST push) and `{t:"ping"}`; it accepts
 * `{lo:"supplement", v:1, t:"ready"|"resize"|"error"|"pong"}` — with the nonce
 * echoed on every state-moving type — from `frame.contentWindow` at
 * `Origin: "null"` only, and clamps every height to the contract's
 * [120, 480] range regardless of what arrived.
 *
 * LIVENESS (memo §4.2): at most one `resize`/`error` per animation frame
 * (latest wins), and a watchdog — a frame that never posts `ready`, or that
 * fails to answer a ping within 5 s, is unmounted into the frame-level fallback
 * line. A frame error NEVER rewrites the row: it replaces this frame only.
 *
 * EVERYTHING HERE IS PER MOUNT. The nonce, the load counter, the watchdog and
 * its timers live in the component instance (refs), never at module scope: two
 * components on one page are two independently bounded frames, and one frame's
 * timeout must not tear down another's.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	PING_INTERVAL_MS,
	type SupplementComponent,
	type SupplementTheme,
	WATCHDOG_MS,
	acceptFrameMessage,
	clampFrameHeight,
	clampedHeightHint,
	displayText,
	mintNonce,
	readSupplementTheme,
	subscribeSupplementTheme,
	supplementFrameUrl,
} from "./supplement-model";

/** The debug line a torn-down frame logs once, per the memo's "one debug line". */
const HOSTILE_TEARDOWN_LOG =
	"[supplement] frame torn down after a second load (hostile navigation or a blocked attempt)";

export type SupplementFrameProps = {
	component: SupplementComponent;
	/**
	 * The assembled document, `null` until the media relay answers. The reserved
	 * box holds the component's clamped `height_hint` while it is null.
	 */
	documentHtml: string | null;
	/**
	 * The document could not be fetched (a pruned blob, a refusal, a malformed
	 * body): the frame paints the frame-level fallback line instead of holding
	 * its reserved box forever.
	 */
	documentFailed?: boolean;
	className?: string;
};

/**
 * The nearest scrollable ancestor, or null when the frame is not inside one
 * (Storybook, an isolated fixture).
 *
 * WHY the resize gate needs it: a frame growing ABOVE the reader's scroll
 * anchor moves the reader's content (memo §2.11 — "a resize applies … only
 * when the row is below the viewport's scroll anchor"), so a growth whose row
 * starts above the scroll port's visible top is held and re-applied on the
 * next scroll instead of moving what the reader is looking at.
 */
function nearestScrollPort(element: HTMLElement): HTMLElement | null {
	let node: HTMLElement | null = element.parentElement;
	while (node) {
		const style = window.getComputedStyle(node);
		if (
			(style.overflowY === "auto" || style.overflowY === "scroll") &&
			node.scrollHeight > node.clientHeight
		) {
			return node;
		}
		node = node.parentElement;
	}
	return null;
}

export function SupplementFrame({
	component,
	documentHtml,
	documentFailed = false,
	className,
}: SupplementFrameProps) {
	const reserved = clampedHeightHint(component);
	const [height, setHeight] = useState(reserved);
	const [failed, setFailed] = useState(false);
	const boxRef = useRef<HTMLDivElement | null>(null);
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const nonceRef = useRef("");
	const failedRef = useRef(false);
	/**
	 * WHY a frame fell back, carried to the DOM as the fallback element's
	 * attribute value. The line reads the same to a reader whichever arm fired,
	 * but a bare `data-supplement-frame-fallback` cannot tell a QA run (or the
	 * capture rig) which one it was: five distinct arms paint that line, and they
	 * have completely different causes — `document` is a missing blob, `no-ready`
	 * is a hung document, `second-load` is a navigation. Diagnosing a fallback
	 * from a screenshot alone cost a bisect; one attribute ends that.
	 */
	const failedReasonRef = useRef<string>("");
	/**
	 * Starts the ping cadence; armed by the mount effect, called on the first
	 * `load` immediately after the theme push (see that effect for why the
	 * cadence may not start earlier).
	 */
	const startPingsRef = useRef<() => void>(() => {});
	const loadCountRef = useRef(0);
	const heightRef = useRef(reserved);
	/**
	 * The newest height a resize carried while the row sat ABOVE the scroll
	 * port (see `nearestScrollPort`); re-applied on the next scroll so a message
	 * that arrived while held is not lost.
	 */
	const pendingHeightRef = useRef<number | null>(null);
	/** What the element handlers call, reassigned each render to fresh closures. */
	const onLoadRef = useRef<() => void>(() => {});
	const themePushRef = useRef<(theme: SupplementTheme) => void>(() => {});

	const fail = useCallback((reason: string) => {
		if (failedRef.current) return;
		failedRef.current = true;
		failedReasonRef.current = reason;
		setFailed(true);
	}, []);

	/*
	 * ARM, WIRE, THEN NAVIGATE — one effect, and the order inside it is the
	 * point.
	 *
	 * The listeners and the watchdog are attached BEFORE the frame is given a
	 * `src`. That ordering is not tidiness: a `data:` document begins executing
	 * in a task the browser may interleave before React's passive effects run,
	 * so a frame whose `src` is set during the commit can post its `ready`
	 * broadcast into a page that is not listening yet — and since the prelude
	 * sends `ready` exactly once, the mount then dies at the boot deadline while
	 * the document is alive and painting (measured on Storybook captures,
	 * 2026-10-11: the chart drew while the host counted the frame dead). Assigning
	 * `src` from inside the armed effect closes that window by construction, which
	 * is why the attribute is never set in JSX and lives only on this line.
	 *
	 * The arm call is awaited BEFORE `src` is assigned, because the main-process
	 * guard must already hold the permit when the navigation is issued — arming
	 * after the fact would be a race the guard is designed to refuse. In browser
	 * development and Storybook there is no channel (`armSupplementFrame` is
	 * optional on the preload), and the embedding document's own CSP is the only
	 * control, exactly as for any other frame.
	 */
	useEffect(() => {
		if (documentHtml === null) return;
		const frameEl = frameRef.current;
		if (!frameEl) return;
		nonceRef.current = mintNonce();
		const url = supplementFrameUrl(documentHtml);

		/* ---- the wire: armed before the navigation, torn down with the effect ---- */
		let live = false;
		let pingsStarted = false;
		let pingTimer: number | null = null;
		let pongDeadline: number | null = null;
		let raf: number | null = null;
		const coalesced: { resize: number | null; error: boolean } = {
			resize: null,
			error: false,
		};
		const bootDeadline = window.setTimeout(() => {
			// A frame that never posted `ready` is not a live document (§4.2).
			if (!live) fail("no-ready");
		}, WATCHDOG_MS);

		const post = (message: Record<string, unknown>) => {
			frameEl.contentWindow?.postMessage(message, "*");
		};
		const sendPing = () => {
			// ONE outstanding ping at a time, never coalesced away (§4.2).
			if (pongDeadline !== null) return;
			post({ lo: "supplement-host", t: "ping" });
			pongDeadline = window.setTimeout(() => {
				pongDeadline = null;
				fail("no-pong");
			}, WATCHDOG_MS);
		};
		/**
		 * The ping cadence starts WITH THE THEME PUSH, not at `ready`.
		 *
		 * A `pong` is nonce-required, and the nonce only reaches the frame inside
		 * the theme message — so a ping sent at `ready` (which precedes that
		 * message) is answered by a pong this host must reject, and the pong
		 * deadline would then fail a live frame five seconds later. `onLoad` calls
		 * this immediately after the first theme push, which is the earliest moment
		 * the frame can answer with the nonce.
		 */
		startPingsRef.current = () => {
			if (pingsStarted || failedRef.current) return;
			pingsStarted = true;
			sendPing();
			pingTimer = window.setInterval(sendPing, PING_INTERVAL_MS);
		};

		const applyHeight = (next: number) => {
			const box = boxRef.current;
			if (box) {
				const port = nearestScrollPort(box);
				if (
					port &&
					box.getBoundingClientRect().top < port.getBoundingClientRect().top
				) {
					pendingHeightRef.current = next;
					return;
				}
			}
			pendingHeightRef.current = null;
			if (next !== heightRef.current) {
				heightRef.current = next;
				setHeight(next);
			}
		};
		const scheduleCoalesced = () => {
			if (raf !== null) return;
			raf = window.requestAnimationFrame(() => {
				raf = null;
				const { resize, error } = coalesced;
				coalesced.resize = null;
				coalesced.error = false;
				if (error) {
					fail("frame-error");
					return;
				}
				if (resize !== null) applyHeight(resize);
			});
		};

		const onMessage = (event: MessageEvent) => {
			if (failedRef.current) return;
			// The browsing context first (`source`), then the opaque origin every
			// sandboxed document presents, then the contract's shape+nonce rule.
			if (event.source !== frameEl.contentWindow) return;
			if (event.origin !== "null") return;
			/*
			 * THE LOAD COUNTER IS DELIBERATELY NOT A GATE HERE. The prelude posts
			 * `ready` during parsing — before the first `load` event — so requiring
			 * "the first load has fired" drops exactly the message the boot deadline
			 * waits for, and a live frame dies at five seconds (measured 2026-10-11).
			 * Navigation control lives where the design puts it: main's one-shot
			 * permit refuses the navigation, and the SECOND load tears the frame down
			 * (after which this component renders no iframe at all and no message can
			 * be answered by it).
			 */
			const message = acceptFrameMessage(event.data, nonceRef.current);
			if (!message) return;
			if (message.t === "ready") {
				if (!live) {
					live = true;
					window.clearTimeout(bootDeadline);
				}
				return;
			}
			if (message.t === "pong") {
				if (pongDeadline !== null) {
					window.clearTimeout(pongDeadline);
					pongDeadline = null;
				}
				return;
			}
			if (message.t === "resize") {
				coalesced.resize = clampFrameHeight(message.h as number);
				scheduleCoalesced();
				return;
			}
			// `error`: the frame's own report. One quiet line replaces it; the row
			// is never rewritten (memo §2.8).
			coalesced.error = true;
			scheduleCoalesced();
		};
		const onScroll = () => {
			const pending = pendingHeightRef.current;
			if (pending !== null) applyHeight(pending);
		};
		window.addEventListener("message", onMessage);
		// Capture: the scroll that clears the hold happens on the transcript's own
		// scroller, which does not bubble a scroll event to the window.
		window.addEventListener("scroll", onScroll, true);

		/* ---- the wire is live; now the document may start ---- */
		let cancelled = false;
		const start = async () => {
			const arm = window.api?.desktop?.armSupplementFrame;
			if (arm) {
				try {
					await arm(url);
				} catch {
					// A refused arm is answered by the guard itself: the navigation that
					// follows is denied and the watchdog fails this frame into its
					// fallback line. Nothing to invent here.
				}
			}
			if (!cancelled) frameEl.src = url;
		};
		void start();

		return () => {
			cancelled = true;
			window.clearTimeout(bootDeadline);
			if (pingTimer !== null) window.clearInterval(pingTimer);
			if (pongDeadline !== null) window.clearTimeout(pongDeadline);
			if (raf !== null) window.cancelAnimationFrame(raf);
			window.removeEventListener("message", onMessage);
			window.removeEventListener("scroll", onScroll, true);
			startPingsRef.current = () => {};
		};
	}, [documentHtml, fail]);

	/*
	 * The theme channel. The FIRST push rides the frame's first `load` (the
	 * prelude installs its listener synchronously and stays hidden until a theme
	 * arrives, with a 400 ms prefers-color-scheme fallback as the last resort);
	 * every later theme change RE-PUSHES the tokens — the frame re-inks, it is
	 * never reloaded for a theme (a reload would be a second load, i.e. the
	 * hostile teardown, and would lose the component's state).
	 */
	themePushRef.current = (theme: SupplementTheme) => {
		if (failedRef.current || loadCountRef.current !== 1) return;
		frameRef.current?.contentWindow?.postMessage(
			{
				lo: "supplement-host",
				t: "theme",
				mode: theme.mode,
				vars: theme.vars,
				nonce: nonceRef.current,
			},
			"*",
		);
	};
	useEffect(() => {
		return subscribeSupplementTheme((theme) => themePushRef.current(theme));
	}, []);

	onLoadRef.current = () => {
		const count = loadCountRef.current + 1;
		loadCountRef.current = count;
		if (count > 1) {
			// The second load is a hostile navigation OR a blocked attempt (a
			// blocked navigation fires a second `load` too, measured on Chrome
			// 155). Either way this frame is not the document the host mounted.
			console.debug(HOSTILE_TEARDOWN_LOG);
			fail("second-load");
			return;
		}
		themePushRef.current(readSupplementTheme());
		// The theme push is what delivers the nonce, so the ping cadence starts
		// here — see `startPingsRef`'s comment in the mount effect for why any
		// earlier ping would fail a live frame.
		startPingsRef.current();
	};

	if (failed || documentFailed) {
		/*
		 * The frame-level fallback line (§2.8): one quiet line where the graphic
		 * was, never a rewrite of the row's own state. The row's committed state
		 * decides which line renders — a job-level `failed` paints its own line,
		 * and components never mount under it — so this only ever replaces a
		 * frame on a settled block.
		 */
		return (
			<div
				className="text-ink-dim text-meta"
				data-supplement-frame-fallback={
					documentFailed ? "document" : failedReasonRef.current
				}
			>
				Couldn't render this graphic
			</div>
		);
	}

	return (
		<div className={className} data-supplement-frame-box="">
			{/*
			 * The reserved box holds its space while the document loads and draws no
			 * title (§2.8): the height is the write-time clamped `height_hint` until
			 * the first resize, which is already within the same [120, 480] range.
			 */}
			<div
				ref={boxRef}
				data-supplement-frame=""
				style={{ height, width: "100%" }}
			>
				{documentHtml !== null && (
					<iframe
						ref={frameRef}
						title={component.title}
						sandbox="allow-scripts"
						/* `src` is assigned by the mount effect, AFTER the message wire is
						   armed — see that effect's header for the race it closes. */
						onLoad={() => onLoadRef.current()}
						className="block h-full w-full border-0"
						// The document's own CSP is a `<meta>` inside the bytes (a response
						// header does not survive the tunnel, and the iframe `csp` attribute
						// is unimplemented in Chromium — memo §2.7/§4.1); the sandbox above
						// is the boundary.
					/>
				)}
			</div>
			{/*
			 * The one caption the host renders: exactly one `Source: …` line per
			 * component, `text-meta`/`ink-muted`, single line with the full text in
			 * the tooltip. The document prints none (memo §2.8, D13).
			 */}
			<span
				className="block truncate text-ink-muted text-meta"
				title={`Source: ${component.source}`}
				data-supplement-source=""
			>
				Source: {displayText(component.source)}
			</span>
		</div>
	);
}
