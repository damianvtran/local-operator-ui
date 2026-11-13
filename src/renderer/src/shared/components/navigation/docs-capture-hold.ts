/**
 * The shutter-hold decision for the docs-library capture scenes, kept free of
 * React and of any import so `scripts/marketing-screens.test.mjs` can run it
 * under plain `node --test` against a stand-in document.
 *
 * Why it exists as its own module: the Asks scene's hold searched only
 * `<main>`, and the fleet ask drawer is mounted by `ChatLayout` as a SIBLING
 * of the routed content (and menus/pickers are portalled to `<body>`), so a
 * correctly painted drawer still tripped `data-capture-failed` after 20 s and
 * the rig refused the frame. A source-regex test cannot tell "searches main"
 * from "searches where the text is"; a behavioural one can.
 *
 * Constraints:
 * - The scope is chosen per scene, not widened globally: a page scene keeps
 *   `main` so a toast or rail echo of the same string cannot release it early.
 * - `document` scope reads `<body>`, which covers `#storybook-root`, siblings
 *   of `<main>` and portals alike. It is still a painted-text check; it never
 *   suppresses the failure latch, it only looks where the scene renders.
 */

/** Where a scene's settling text is painted. */
export type CaptureHoldScope = "main" | "document";

/** The slice of `Document` the hold reads; a test passes a plain object. */
export type CaptureHoldDocument = {
	querySelector: (selector: string) => { textContent: string | null } | null;
	body: { textContent: string | null } | null;
};

/** After this long without the text the frame is refused, never exported. */
export const CAPTURE_HOLD_TIMEOUT_MS = 20_000;

export function captureHoldTextPainted(
	doc: CaptureHoldDocument,
	text: string,
	scope: CaptureHoldScope,
): boolean {
	const root = scope === "main" ? doc.querySelector("main") : doc.body;
	return (root?.textContent ?? "").includes(text);
}

/**
 * One poll of the hold. `release` and `fail` are terminal: the caller stops
 * polling on either, so a released frame cannot be failed by a later tick.
 */
export function captureHoldVerdict(
	doc: CaptureHoldDocument,
	text: string,
	scope: CaptureHoldScope,
	elapsedMs: number,
): "release" | "fail" | "wait" {
	if (captureHoldTextPainted(doc, text, scope)) return "release";
	return elapsedMs > CAPTURE_HOLD_TIMEOUT_MS ? "fail" : "wait";
}

/**
 * Keeps PROGRAMMATIC focus out of a capture frame; returns the teardown.
 *
 * Why: a few shipped surfaces move focus on open, correctly for keyboard users
 * (the Team Bridge thread pane focuses its close button via
 * `manageThreadFocus`; the Teams page lands focus in its "Ask for a change"
 * composer). With no pointer input first, the browser treats that as
 * `:focus-visible`, so a still captured with no user present shows a focus
 * ring and caret the scene is not about (design round 4 D9, D11; QA Q13).
 * The product behaviour is untouched: this blurs, story-side, whatever takes
 * focus until a real (trusted) pointer or key event arrives, at which point a
 * person is driving and focus is theirs again. Untrusted events - a story's
 * `play` driving `userEvent` - do not end it, so never use this in a scene
 * whose subject is a focused control (the Mention picker).
 */
export function blurProgrammaticFocus(doc: Document): () => void {
	const blur = () => {
		const active = doc.activeElement as HTMLElement | null;
		if (active && active !== doc.body) active.blur();
	};
	/* Deferred: blurring inside `focusin` races the focusing code's own
	   follow-up (selection, scroll-into-view); one task later it has finished. */
	const onFocusIn = () => setTimeout(blur, 0);
	const onUserInput = (event: Event) => {
		if (event.isTrusted) stop();
	};
	const stop = () => {
		doc.removeEventListener("focusin", onFocusIn, true);
		doc.removeEventListener("pointerdown", onUserInput, true);
		doc.removeEventListener("keydown", onUserInput, true);
	};
	blur();
	doc.addEventListener("focusin", onFocusIn, true);
	doc.addEventListener("pointerdown", onUserInput, true);
	doc.addEventListener("keydown", onUserInput, true);
	return stop;
}
