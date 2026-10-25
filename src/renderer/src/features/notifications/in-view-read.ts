/**
 * In-view auto-read for the transcript's flag lines (notifications contract
 * § 6.4, design.md § 17.2-§ 17.3).
 *
 * THE RULE, VERBATIM FROM ATTENTION.md, WITH THE ADDENDUM'S INPUT EDGE: an item
 * is read only when its anchor is rendered, uncovered and visible in a focused
 * foreground window, AND a fresh user input happened while it was visible. Per
 * item, with the revision the renderer observed. Never a timer, a poll, a
 * subscription or a focus change reaching a batch on its own: that is R10, and
 * nothing here relaxes it.
 *
 * Concretely, an item qualifies when ALL of these hold (contract § 6.4 a-e):
 *  (a) ≥ 50 % of the flag line is inside the scroller's viewport
 *      (`IntersectionObserver`, whose intersection is clipped by every
 *      scrolling ancestor, so the transcript scroller's rect is honoured);
 *  (b) it is uncovered: `elementFromPoint` at its centre is the line or a
 *      descendant (a modal, an overlaying drawer, a child-agent page fails);
 *  (c) a user input edge (pointerdown, keydown, wheel, window focus-gain)
 *      happened while it was visible;
 *  (d) it stayed visible ≥ 1 s after that edge, which rules out a scroll-past;
 *  (e) the edge is later than the item's `updated_at` (a keyed update that
 *      lands after the reader looked is not something they saw).
 *
 * WHAT DECIDES IS THE SERVER. This module only gathers evidence; main's
 * foreground guard refuses the post when the window is not foreground, and
 * the route re-checks session, revision and the edge's age (≤ 120 s).
 */

/** The ≥ 1 s dwell after the input edge (contract § 6.4 d). */
export const IN_VIEW_DWELL_MS = 1_000;

/** The fraction of the line that must be inside the viewport (§ 6.4 a). */
export const IN_VIEW_RATIO = 0.5;

export type InputKind = "pointer" | "key" | "wheel" | "focus";

/** One anchor's observed state at the moment the dwell timer fires. */
export type AnchorObservation = {
	/** When the line last became ≥ 50 % visible, or null while it is not. */
	visibleSinceMs: number | null;
	/** `elementFromPoint` at the line's centre resolved inside the line. */
	uncovered: boolean;
	/** The item's `updated_at`, ms since epoch. */
	updatedAtMs: number;
	/** The item is unread (a read row is never re-posted). */
	unread: boolean;
};

/**
 * Whether one anchor qualifies for an input edge at `inputAtMs`, checked at
 * `nowMs` (the dwell timer's firing time). Pure, so the five conditions are
 * pinned by `scripts/notifications-model.test.mjs` rather than by a browser.
 */
export function qualifiesInView(
	anchor: AnchorObservation,
	inputAtMs: number,
	nowMs: number,
): boolean {
	if (!anchor.unread) return false;
	if (anchor.visibleSinceMs === null) return false; // (a) not visible now
	if (anchor.visibleSinceMs < anchor.updatedAtMs) return false;
	if (inputAtMs > nowMs || nowMs - inputAtMs > 120_000) return false;
	if (anchor.visibleSinceMs > inputAtMs) return false; // (c) edge before it was visible
	if (!anchor.uncovered) return false; // (b)
	if (nowMs - inputAtMs < IN_VIEW_DWELL_MS) return false; // (d)
	if (inputAtMs <= anchor.updatedAtMs) return false; // (e)
	return true;
}

/** The registered half of an anchor: what the coordinator needs to post it. */
export type InViewAnchor = {
	id: string;
	revision: number;
	anchorId: string;
	updatedAtMs: number;
	unread: boolean;
	element: HTMLElement;
	/** The actual displayed transcript owning both the anchor and input. */
	owner: HTMLElement;
};

/**
 * Whether an input target sits inside the pane that owns the anchor.
 *
 * Structural rather than `instanceof Element`: the node test host has no DOM
 * classes, and the rule this encodes is "the target can say which pane it is
 * in", which `closest` answers in a browser and in a controlled host alike.
 */
const isElementInOwner = (target: unknown, owner: Element): boolean => {
	const closest = (target as { closest?: unknown } | null)?.closest;
	return (
		typeof closest === "function" &&
		(target as Element).closest("[data-notification-owner]") === owner
	);
};

/** Whether the line's centre point resolves inside the line itself. */
export function anchorUncovered(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return false;
	const hit = document.elementFromPoint(
		rect.left + rect.width / 2,
		rect.top + rect.height / 2,
	);
	return hit !== null && (hit === element || element.contains(hit));
}

/** The window is foreground and focused (the renderer's half of the guard). */
const foreground = (): boolean =>
	document.visibilityState === "visible" && document.hasFocus();

export type InViewPost = (batch: {
	items: { id: string; revision: number; anchorId: string }[];
	inputKind: InputKind;
	inputAtMs: number;
	visibleSinceMs: number;
}) => void;

/**
 * The coordinator one transcript owns: observes every registered flag line,
 * listens for input edges on the window, and posts the qualifying anchors once
 * per edge after the dwell. A batch lists EXACTLY the ids that qualified, with
 * the revisions observed (design § 17.3: a per-item batch, not a sweep).
 *
 * `IntersectionObserver` absent (a test host) means nothing is ever visible,
 * which fails toward unread: the honest direction (contract § 6.3).
 */
export function createInViewReader(post: InViewPost, now = () => Date.now()) {
	const anchors = new Map<HTMLElement, InViewAnchor>();
	const visibleSince = new Map<HTMLElement, number>();
	/* Ids already posted at a revision, so one edge storm posts each once. */
	const posted = new Set<string>();
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const observer =
		typeof IntersectionObserver === "undefined"
			? null
			: new IntersectionObserver(
					(entries) => {
						for (const entry of entries) {
							const element = entry.target as HTMLElement;
							if (entry.intersectionRatio >= IN_VIEW_RATIO) {
								if (!visibleSince.has(element))
									visibleSince.set(element, now());
							} else {
								visibleSince.delete(element);
							}
						}
					},
					{ threshold: [0, IN_VIEW_RATIO, 1] },
				);

	const onEdge = (inputKind: InputKind, target: EventTarget | null) => {
		if (!foreground() || anchors.size === 0) return;
		const inputAtMs = now();
		// Capture the actually visible, uncovered anchors AT the input edge. A
		// key pressed behind a modal is not evidence if the modal closes later.
		const candidates = new Map<HTMLElement, { since: number; token: string }>();
		for (const [element, anchor] of anchors) {
			const since = visibleSince.get(element);
			if (
				isElementInOwner(target, anchor.owner) &&
				since !== undefined &&
				since <= inputAtMs &&
				anchor.unread &&
				anchorUncovered(element)
			)
				candidates.set(element, {
					since,
					token: `${anchor.id}@${anchor.revision}`,
				});
		}
		if (candidates.size === 0) return;
		const timer = setTimeout(() => {
			timers.delete(timer);
			if (!foreground()) return;
			const firedAt = now();
			const batch: { id: string; revision: number; anchorId: string }[] = [];
			let latestVisible = 0;
			for (const [element, anchor] of anchors) {
				const token = `${anchor.id}@${anchor.revision}`;
				if (posted.has(token)) continue;
				const since = visibleSince.get(element) ?? null;
				if (
					since === null ||
					candidates.get(element)?.since !== since ||
					candidates.get(element)?.token !== token
				)
					continue;
				const ok = qualifiesInView(
					{
						visibleSinceMs: since,
						uncovered: since !== null && anchorUncovered(element),
						updatedAtMs: anchor.updatedAtMs,
						unread: anchor.unread,
					},
					inputAtMs,
					firedAt,
				);
				if (!ok || since === null) continue;
				posted.add(token);
				latestVisible = Math.max(latestVisible, since);
				batch.push({
					id: anchor.id,
					revision: anchor.revision,
					anchorId: anchor.anchorId,
				});
			}
			if (batch.length > 0)
				post({
					items: batch,
					inputKind,
					inputAtMs,
					visibleSinceMs: latestVisible,
				});
		}, IN_VIEW_DWELL_MS);
		timers.add(timer);
	};
	const onPointer = (event: PointerEvent) => {
		if (event.isTrusted) onEdge("pointer", event.target);
	};
	const onKey = (event: KeyboardEvent) => {
		if (event.isTrusted) onEdge("key", event.target);
	};
	const onWheel = (event: WheelEvent) => {
		if (event.isTrusted) onEdge("wheel", event.target);
	};
	const onFocus = (event: FocusEvent) => {
		if (event.isTrusted) onEdge("focus", document.activeElement);
	};
	const cancelDwell = () => {
		for (const timer of timers) clearTimeout(timer);
		timers.clear();
	};
	// Losing foreground during the dwell invalidates the edge; returning must
	// earn a fresh edge rather than resuming a partly observed receipt.
	window.addEventListener("blur", cancelDwell);
	document.addEventListener("visibilitychange", cancelDwell);
	window.addEventListener("pointerdown", onPointer, true);
	window.addEventListener("keydown", onKey, true);
	window.addEventListener("wheel", onWheel, { capture: true, passive: true });
	window.addEventListener("focus", onFocus);

	return {
		/** A failed/refused post needs a NEW input edge, not a permanent latch. */
		forget(items: readonly { id: string; revision: number }[]) {
			for (const item of items) posted.delete(`${item.id}@${item.revision}`);
		},
		register(anchor: InViewAnchor): () => void {
			anchors.set(anchor.element, anchor);
			observer?.observe(anchor.element);
			return () => {
				anchors.delete(anchor.element);
				visibleSince.delete(anchor.element);
				observer?.unobserve(anchor.element);
			};
		},
		dispose() {
			observer?.disconnect();
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
			window.removeEventListener("pointerdown", onPointer, true);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("wheel", onWheel, true);
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", cancelDwell);
			document.removeEventListener("visibilitychange", cancelDwell);
		},
	};
}

export type InViewReader = ReturnType<typeof createInViewReader>;
