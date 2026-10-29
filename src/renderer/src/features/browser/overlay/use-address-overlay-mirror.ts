/**
 * The renderer half of S2's visual mirror: measure the URL field and the dock,
 * project what the in-flow list already shows, and route a validated row click
 * back into the existing `commit()`.
 *
 * WHAT STAYS IN THE PARENT (by design, not by omission): the input, DOM focus,
 * IME composition, undo, every key and the accessible combobox. This hook never
 * focuses, never moves selection into the child and never changes `activeIndex`
 * on hover. A commit from the child is accepted only when it names the SAME
 * projection the child was measured on and the candidate at that index still has
 * the key it projected — otherwise the click is dropped silently. A wrong
 * navigation is the failure this guards; a lost click is acceptable.
 *
 * WHY IT MEASURES EVERY FRAME: a position-only shift (a sidebar collapse moves
 * the toolbar sideways without resizing it) is invisible to ResizeObserver and
 * to the page's own rectangle reporter. Only while the list is open, the hook
 * compares a signature; identical frames send nothing. A `stale_layout` refusal
 * gets four frame-spaced retries (~67 ms) and then idles; a real change resets
 * that budget, so a page that lands later is picked up by the next keystroke or
 * rect move rather than by a poll.
 */

import { useEffect, useRef } from "react";
import { lastDeliveredContentRect } from "../hooks/use-browser-chrome";
import {
	type AddressOverlayPost,
	type AddressOverlayTheme,
	type AddressOverlayView,
	addressOverlayPort,
	isPermanentOverlayRefusal,
	nextAddressOverlaySeq,
} from "./address-overlay-port";
import { nextStaleAttempt } from "./stale-layout-retry";

export interface AddressMirrorRow {
	/** Plain display text: NO bidi controls. The child strips them by design, so
	 * the isolation travels as `isolate` instead. */
	text: string;
	title: string;
	isolate?: { start: number; end: number };
	/** The candidate's stable identity (its URL). Never sent: it exists so a
	 * click can be checked against the row the child actually painted. */
	key: string;
}

export interface AddressMirrorInput {
	enabled: boolean;
	tabId: number | null;
	visible: boolean;
	active: number;
	rows: AddressMirrorRow[];
	noticeKind: "error" | "empty" | "no_match";
	noticeText: string;
	label: string;
	/** The strip's own measured band, in CSS px. The surface reads it from the
	 * strip element; main intersects it with the trusted page rect. Null until the
	 * strip is measured, which is the correct "nothing to project yet". */
	anchor: { x: number; width: number } | null;
	onCommit: (index: number) => void;
	/** A main-decided dismissal (page focus, navigation, layout, tab change).
	 * The renderer owns what "come down" means; main owns the fact. */
	onDismiss: (reason: string) => void;
	/** The pane is below the list's width floor, so main will refuse every
	 * projection until the anchor changes. The caller turns this into the
	 * field-only state; the loop stops here rather than re-asking each frame
	 * (nit round 1, MINOR-5). */
	onUnavailable?: () => void;
}

/** The dock's theme tokens, read through a scratch element because the app's
 * tokens are declared as `var(...)` chains: `getPropertyValue` on the root would
 * return the unresolved chain, not the rgb() the child can paint. */
const THEME_READS: Array<
	[
		keyof AddressOverlayTheme,
		string,
		"backgroundColor" | "color" | "borderTopColor" | "borderBottomColor",
	]
> = [
	["elevated", "--color-elevated", "backgroundColor"],
	["ink", "--color-ink", "color"],
	["inkMuted", "--color-ink-muted", "color"],
	["accent", "--color-accent", "backgroundColor"],
	["accentWash", "--color-accent-wash", "backgroundColor"],
	["rowHover", "--color-row-hover", "backgroundColor"],
	["hairline", "--color-hairline", "borderTopColor"],
	["control", "--color-control", "borderBottomColor"],
];

const RGBA = /rgba\(/;
const OPAQUE_COLOR = /^(#[0-9a-f]{6}|rgb\(\d{1,3}, ?\d{1,3}, ?\d{1,3}\))$/i;

let themeCache: { key: string; theme: AddressOverlayTheme | null } | null =
	null;

function themeKey(): string {
	const root = document.documentElement;
	const scheme =
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	return `${root.className}|${root.dataset.theme ?? ""}|${scheme}`;
}

/**
 * Resolve the eight tokens to concrete `rgb(...)`/`#rrggbb` values. A token that
 * resolves to a colour with alpha, or to nothing, makes the WHOLE theme `null`:
 * the child must be opaque, and a half-themed surface is worse than the neutral
 * fallback (main records `theme:"fallback"`).
 */
function resolveTheme(): AddressOverlayTheme | null {
	const key = themeKey();
	if (themeCache !== null && themeCache.key === key) return themeCache.theme;
	const scratch = document.createElement("div");
	scratch.style.display = "none";
	document.body.append(scratch);
	const theme = {} as AddressOverlayTheme;
	let ok = true;
	try {
		for (const [name, variable, property] of THEME_READS) {
			scratch.style[property] = `var(${variable})`;
			const value = window.getComputedStyle(scratch)[property] ?? "";
			scratch.style[property] = "";
			if (
				typeof value !== "string" ||
				value === "" ||
				RGBA.test(value) ||
				!OPAQUE_COLOR.test(value)
			) {
				ok = false;
				break;
			}
			theme[name] = value;
		}
	} finally {
		scratch.remove();
	}
	const resolved = ok ? theme : null;
	themeCache = { key, theme: resolved };
	return resolved;
}

function viewOf(input: AddressMirrorInput): AddressOverlayView {
	if (input.rows.length > 0) {
		return {
			kind: "rows",
			rows: input.rows.map((row) => ({
				text: row.text,
				title: row.title,
				...(row.isolate ? { isolate: row.isolate } : {}),
			})),
		};
	}
	return {
		kind: "notice",
		notice: input.noticeKind,
		text: input.noticeText,
	};
}

export function useAddressOverlayMirror(input: AddressMirrorInput): void {
	const latest = useRef(input);
	latest.current = input;

	useEffect(() => {
		/*
		 * THE LOOP EXISTS ONLY WHILE THERE IS A VISIBLE LIST (the OOM this shape
		 * fixes): the previous version scheduled `requestAnimationFrame` at the TOP
		 * of `tick`, before asking whether the mirror was enabled or the list open,
		 * so a renderer with the hook mounted and the list closed kept a frame loop
		 * alive for the life of the surface. Under a synchronous RAF polyfill that
		 * is unbounded recursion; in jsdom-heavy tests it accumulated until the
		 * process died. Scheduling now happens only from a running tick, and the
		 * effect itself is keyed on visibility and the bound tab, so closing the
		 * list cancels the frame and sends the one hide.
		 */
		if (!input.enabled || !input.visible || input.tabId === null) return;
		const port = addressOverlayPort();
		if (!port) return;

		const boundTabId = input.tabId;
		let frame = 0;
		let wasVisible = true;
		let lastSignature = "";
		let projected: { seq: number; keys: string[] } | null = null;
		/**
		 * Terminal stop. Main's no-handler latch, a disposed/failed controller or a
		 * vanished owner cannot become healthy inside this renderer's lifetime, and
		 * retrying them per frame is the S2-off retry storm QA round 1 measured.
		 * The effect stays subscribed for commits; it just stops projecting.
		 */
		let stopped = false;
		/**
		 * One projection in flight at a time. Without this, the first refusal's
		 * round trip outlasts a frame and several invokes are already queued before
		 * the no-handler latch can stop the loop (QA round 1 measured the shape of
		 * that storm; 2 errors is the residual). Serialising makes the S2-off path
		 * exactly one invoke, and costs S2-on at most one skipped frame.
		 */
		let pending = false;
		/** Bounded re-attempts after `stale_layout` (round-2 U11). The page being
		 * hidden is a condition, but it can END (the view lands while the field is
		 * still open). Four frame-spaced tries cover that handover without restoring
		 * the per-frame storm; any real change resets the budget, and after four
		 * refusals the loop idles until the projection body changes. */
		let staleAttempts = 0;
		let forceProject = false;
		const stop = (): void => {
			stopped = true;
			if (frame !== 0) cancelAnimationFrame(frame);
			frame = 0;
		};

		const unsubscribe = port.onEvent((event) => {
			if (!event || typeof event !== "object") return;
			if (event.type === "dismiss") {
				if (typeof event.reason === "string")
					latest.current.onDismiss(event.reason);
				return;
			}
			const commit = event as {
				type?: unknown;
				seq?: unknown;
				index?: unknown;
			};
			if (commit.type !== "commit") return;
			if (!Number.isInteger(commit.seq) || !Number.isInteger(commit.index)) {
				return;
			}
			const seq = commit.seq as number;
			const index = commit.index as number;
			const current = latest.current;
			// Three independent freshness checks: the seq the child painted, the
			// list still being open, and the same candidate still occupying the row
			// the user pressed. Any mismatch is a dropped click.
			if (projected === null || seq !== projected.seq) return;
			if (!current.visible) return;
			if (index < 0 || index >= projected.keys.length) return;
			if (current.rows[index]?.key !== projected.keys[index]) return;
			current.onCommit(index);
		});

		const sendHide = (): void => {
			void port
				.project({
					v: 2,
					seq: nextAddressOverlaySeq(),
					tabId: boundTabId,
					visible: false,
				})
				.catch(() => {});
		};
		// A window that comes back from the background has a child that main hid on
		// blur (the draft and the field row survive). Clearing the signature makes
		// the next frame re-project instead of comparing equal to a hidden child.
		const onWindowFocus = (): void => {
			lastSignature = "";
		};
		window.addEventListener("focus", onWindowFocus);

		const tick = (): void => {
			if (stopped) return;
			frame = 0;
			const current = latest.current;
			if (!current.enabled || !current.visible) return;
			const tabId = current.tabId;
			if (tabId === null) {
				if (!stopped) frame = requestAnimationFrame(tick);
				return;
			}
			const pageRect = lastDeliveredContentRect();
			const anchor = current.anchor;
			if (pageRect === null || anchor === null || anchor.width <= 0) {
				if (!stopped) frame = requestAnimationFrame(tick);
				return;
			}
			const view = viewOf(current);
			const theme = resolveTheme();
			const dir: "ltr" | "rtl" =
				window.getComputedStyle(document.documentElement).direction === "rtl"
					? "rtl"
					: "ltr";
			const body = {
				v: 2 as const,
				tabId,
				visible: true,
				pageRect,
				anchor: { x: Math.round(anchor.x), width: Math.round(anchor.width) },
				active: current.active,
				view,
				label: current.label,
				dir,
				...(theme ? { theme } : {}),
			};
			if (pending) {
				if (!stopped) frame = requestAnimationFrame(tick);
				return;
			}
			const signature = JSON.stringify(body);
			if (!forceProject && signature === lastSignature) {
				if (!stopped) frame = requestAnimationFrame(tick);
				return;
			}
			/* A REAL change resets the budget even when it lands ON a forced retry:
			   the signature differs from the refused body, so this is a new
			   condition, not another attempt at the old one (round 3, U11 NIT). */
			if (signature !== lastSignature)
				staleAttempts = nextStaleAttempt({
					attempts: staleAttempts,
					refused: false,
					signatureChanged: true,
				}).attempts;
			forceProject = false;
			lastSignature = signature;
			pending = true;
			wasVisible = true;
			const seq = nextAddressOverlaySeq();
			projected = {
				seq,
				keys: view.kind === "rows" ? current.rows.map((row) => row.key) : [],
			};
			const payload: AddressOverlayPost = { ...body, seq };
			void port
				.project(payload)
				.then((result) => {
					pending = false;
					const answer = result as { accepted?: unknown; reason?: unknown };
					if (!answer || answer.accepted !== false) return;
					// A pane below the floor is a CONDITION, not a failure: stop asking (the
					// answer cannot change without a resize) and let the field say so. Any
					// anchor width change re-runs the effect and re-enables projection.
					if (answer.reason === "anchor_too_narrow") {
						stop();
						latest.current.onUnavailable?.();
						return;
					}
					// A HIDDEN VIEW IS A CONDITION, NOT A FAILURE (S5 round 1, UX U3;
					// bounded in round 2, U11). `stale_layout` means the page is on its
					// start/failure state, so main refuses this projection while that
					// holds. Clearing the signature on every refusal was the per-frame
					// storm; never retrying at all left a list that could not come back
					// when the view landed. Four forced retries, then idle: the signature
					// keeps pointing at the refused body, so nothing loops, and the next
					// real change (typing, a rect move) is a fresh attempt.
					if (answer.reason === "stale_layout") {
						const step = nextStaleAttempt({
							attempts: staleAttempts,
							refused: true,
							signatureChanged: false,
						});
						staleAttempts = step.attempts;
						forceProject = step.retry;
						return;
					}
					// Terminal refusals stop the loop; everything else (a stale frame, a
					// layout race) is retried by the next frame.
					if (isPermanentOverlayRefusal(answer.reason)) {
						stop();
						return;
					}
					if (answer.reason !== "stale_seq") lastSignature = "";
				})
				.catch(() => {
					pending = false;
					// The port latches on the first "No handler registered" answer and
					// then returns null, which is the observable "this launch has no S2
					// channel". A reject for any other reason is retried next frame.
					if (addressOverlayPort() === null) {
						stop();
						return;
					}
					lastSignature = "";
				});
			// The ONE scheduling point: a frame is queued only after a tick that is
			// still eligible, so closing the list ends the loop with the effect.
			if (!stopped && latest.current.visible)
				frame = requestAnimationFrame(tick);
		};

		tick();
		return () => {
			stop();
			unsubscribe();
			window.removeEventListener("focus", onWindowFocus);
			if (wasVisible) sendHide();
		};
	}, [input.enabled, input.visible, input.tabId]);

	/*
	 * DISMISSALS ARRIVE WHILE THE LIST IS NOT VISIBLE TOO (review round 1, R1-1).
	 *
	 * `visible` is false during IME composition and before the first history
	 * answer, and the projection effect above returns before it subscribes then.
	 * A main dismissal in that window (page focus, page pointer, navigation) used
	 * to be lost, so the late answer or `compositionend` re-raised the child after
	 * focus had already left. This subscription handles the dismissal half only
	 * and schedules no frame: the projection loop stays gated on visibility, and
	 * only one of the two effects holds a subscription at a time, so an event is
	 * handled once (the visible effect also carries commits).
	 */
	useEffect(() => {
		if (!input.enabled || input.visible) return;
		const port = addressOverlayPort();
		if (!port) return;
		return port.onEvent((event) => {
			if (!event || typeof event !== "object") return;
			if (event.type !== "dismiss" || typeof event.reason !== "string") return;
			latest.current.onDismiss(event.reason);
		});
	}, [input.enabled, input.visible]);
}
