/**
 * The failure jump (U14), lifted out of the turn foot so the collapsed turn's
 * bar drives the same one.
 *
 * The reader is owed a route from "something failed" to the thing that failed
 * without reading the run. The route crosses up to THREE gated layers now, and
 * each one unmounts its children until it opens, so the walk is staged:
 *
 * 1. the turn bar (`[data-turn-summary]`) — a collapsed run's rows are not in
 *    the DOM at all (`Disclosure` renders `isOpen && children`);
 * 2. the action group (`[data-fold-ids]`) inside it, when the failed row is in
 *    a run of three or more calls;
 * 3. the failed row's own detail disclosure.
 *
 * It was a single function only on the foot's line when folded runs were the
 * deepest layer; with the bar above them it is two frame steps. Every step
 * only ever opens: a layer already open is left exactly as it is (the walk
 * checks the layer's OWN trigger, the first `button[aria-expanded]` in its
 * subtree, rather than "any collapsed button", which is what an open fold's
 * first child would otherwise present).
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
 * Open whatever hides `failedId` and bring the row to the centre.
 *
 * `root` is the transcript content box the caller resolved (`closest`, not a
 * document-wide query — a canvas pane rendering the same record must not be
 * the one that opens).
 */
export function jumpToFailedRow(root: ParentNode, failedId: string): void {
	const bar = [
		...root.querySelectorAll<HTMLElement>("[data-turn-summary]"),
	].find((node) => containsId(node, "data-run-ids", failedId));
	const barTrigger = bar?.querySelector<HTMLElement>("button[aria-expanded]");
	if (barTrigger?.getAttribute("aria-expanded") === "false") {
		barTrigger.click();
	}
	window.requestAnimationFrame(() => {
		const fold = [
			...root.querySelectorAll<HTMLElement>("[data-fold-ids]"),
		].find((node) => containsId(node, "data-fold-ids", failedId));
		const foldTrigger = fold?.querySelector<HTMLElement>(
			"button[aria-expanded]",
		);
		if (foldTrigger?.getAttribute("aria-expanded") === "false") {
			foldTrigger.click();
		}
		/*
		 * The row itself, one commit after the fold's press. `:not([data-turn-summary])`
		 * because the bar carries the FIRST hidden row's id as its own anchor — the
		 * slot it took — and a lookup for that row must find the row (mounted by
		 * now), not the bar that replaced its place.
		 */
		window.requestAnimationFrame(() => {
			const target = root.querySelector<HTMLElement>(
				`[data-record-id="${failedId}"]:not([data-turn-summary])`,
			);
			if (!target) return;
			const trigger = target.querySelector<HTMLElement>(
				"button[aria-expanded]",
			);
			if (trigger?.getAttribute("aria-expanded") === "false") trigger.click();
			target.scrollIntoView({
				block: "center",
				behavior: prefersReducedMotion() ? "auto" : "smooth",
			});
		});
	});
}
