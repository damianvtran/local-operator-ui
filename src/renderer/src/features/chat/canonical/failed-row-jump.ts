/**
 * The jump primitive's REVEAL half: open every gated layer that hides a
 * record, then hand the row to the caller. Two jumps drive it — the failure
 * jump (U14, lifted here from the turn foot) and the checkpoint rail's tick
 * jump (§D7 stage 2) — and it is ONE walk rather than two because the failure
 * jump's generalization was already the rail's walk: the same layers sit
 * between any caller and any record.
 *
 * The route crosses up to THREE gated layers, and each one unmounts its
 * children until it opens, so the walk is staged:
 *
 * 1. the turn bar (`[data-turn-summary]`) — a collapsed run's rows are not in
 *    the DOM at all (`Disclosure` renders `isOpen && children`);
 * 2. the action group (`[data-fold-ids]`) inside it, when the target sits in
 *    a run of three or more calls;
 * 3. the row's own detail disclosure.
 *
 * It was a single function only on the foot's line when folded runs were the
 * deepest layer; with the bar above them it is two frame steps. Every step
 * only ever opens, and — the property the rail needs and the failure jump
 * gets for free — only a COLLAPSED gate that NAMES the id, and only while the
 * row is not already on screen: a jump to a row that some layer merely
 * CONTAINS (a completion checkpoint's answer, which the collapse keeps
 * visible beside its bar) must not expand the run it happens to sit in. A
 * layer already open is left exactly as it is (the walk checks the layer's
 * OWN trigger, the first `button[aria-expanded]` in its subtree, rather than
 * "any collapsed button", which is what an open fold's first child would
 * otherwise present).
 *
 * WHY THE FRAME WAITS. The layers open through React state, so their children
 * commit after the current task; `requestAnimationFrame` is the first moment
 * the next layer is in the DOM. The original foot implementation made the same
 * promise with one rAF because it had one gated layer to cross; this one waits
 * once per layer it actually finds.
 */

/**
 * Whether the user has asked the OS for less motion.
 *
 * The failure jump is this surface's only scroll animation: §B7's 240ms is a
 * CEILING rather than a target, and a preference set at the OS level is the one
 * signal that outranks it. Read per call rather than cached, because the
 * preference can change while the app is open and this is one `matchMedia` on
 * a press. (Moved here with the jump from `canonical-transcript.tsx`, which
 * still owns every other scroll behaviour.)
 */
export function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const containsId = (node: HTMLElement, attr: string, id: string): boolean =>
	(node.getAttribute(attr) ?? "").split(" ").includes(id);

/**
 * Whether the row itself is in the DOM.
 *
 * `:not([data-turn-summary])` because the bar carries the FIRST hidden row's
 * id as its own anchor — the slot it took — and a lookup for that row must
 * find the row, not the bar that replaced its place.
 */
export function isRecordPresent(root: ParentNode, id: string): boolean {
	return (
		root.querySelector<HTMLElement>(
			`[data-record-id="${id}"]:not([data-turn-summary])`,
		) !== null
	);
}

/**
 * The collapsed gate that names `id`, when one is in the DOM, or null.
 *
 * Bars are searched before folds (outermost layer first), and a gate whose
 * trigger is missing or already open is not a gate the walk can use — that is
 * also what keeps `isRecordReachable` honest, since the two share this answer.
 */
function collapsedGateContaining(
	root: ParentNode,
	id: string,
): HTMLElement | null {
	const shapes: Array<[string, string]> = [
		["[data-turn-summary]", "data-run-ids"],
		["[data-fold-ids]", "data-fold-ids"],
	];
	for (const [selector, attr] of shapes) {
		for (const node of root.querySelectorAll<HTMLElement>(selector)) {
			if (!containsId(node, attr, id)) continue;
			const trigger = node.querySelector<HTMLElement>("button[aria-expanded]");
			if (trigger?.getAttribute("aria-expanded") === "false") return node;
		}
	}
	return null;
}

/**
 * Whether the reveal can get to `id` at all: the row is on screen, or a
 * collapsed gate in the DOM names it.
 *
 * The rail's ensure-loaded loop reads this as its stopping predicate
 * (`reveal-record.ts`): a row inside a collapsed bar is REACHABLE although it
 * is not mounted, and mounting more of the render window for it would be
 * wasted work.
 */
export function isRecordReachable(root: ParentNode, id: string): boolean {
	return (
		isRecordPresent(root, id) || collapsedGateContaining(root, id) !== null
	);
}

/** How many gate clicks a reveal may spend before giving up. Two exist. */
const REVEAL_MAX_DEPTH = 3;

export type RevealHandlers = {
	/** The row, once every layer above it is open. */
	onRevealed: (target: HTMLElement) => void;
	/**
	 * No collapsed gate names `id` and the row is absent: the caller's
	 * ensure-loaded half has to run first (the rail's loop), or the id is not
	 * this root's to show.
	 */
	onMissing: () => void;
};

/**
 * Open whatever hides `id` and hand the row to `onRevealed`.
 *
 * `root` is the transcript content box the caller resolved (`closest`, not a
 * document-wide query — a canvas pane rendering the same record must not be
 * the one that opens).
 */
export function revealRecord(
	root: ParentNode,
	id: string,
	handlers: RevealHandlers,
): void {
	const settle = (depth: number): void => {
		const target = root.querySelector<HTMLElement>(
			`[data-record-id="${id}"]:not([data-turn-summary])`,
		);
		if (target) {
			/*
			 * The row's own detail disclosure, when it has one — a failed call's
			 * output is the reason the failure jump exists, and for a checkpoint's
			 * row the press is a no-op (an answer carries no disclosure).
			 */
			const trigger = target.querySelector<HTMLElement>(
				"button[aria-expanded]",
			);
			if (trigger?.getAttribute("aria-expanded") === "false") trigger.click();
			handlers.onRevealed(target);
			return;
		}
		if (depth >= REVEAL_MAX_DEPTH) {
			handlers.onMissing();
			return;
		}
		const gate = collapsedGateContaining(root, id);
		const gateTrigger = gate?.querySelector<HTMLElement>(
			"button[aria-expanded]",
		);
		if (!gateTrigger) {
			handlers.onMissing();
			return;
		}
		gateTrigger.click();
		window.requestAnimationFrame(() => {
			settle(depth + 1);
		});
	};
	settle(0);
}

/**
 * The failure jump: reveal the failed row and bring it to the centre.
 *
 * The platform's own scroll is kept here — this jump's shipped behaviour —
 * while the rail's jump goes through `reveal-record.ts`'s region scroll; the
 * two callers differ in exactly that, and in nothing about the walk.
 */
export function jumpToFailedRow(root: ParentNode, failedId: string): void {
	revealRecord(root, failedId, {
		onRevealed: (target) => {
			target.scrollIntoView({
				block: "center",
				behavior: prefersReducedMotion() ? "auto" : "smooth",
			});
		},
		onMissing: () => {},
	});
}
