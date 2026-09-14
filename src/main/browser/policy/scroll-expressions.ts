/**
 * Fixed scroll expressions, in a host-free module.
 *
 * LOCAL PORT of `extension/src/scroll-expressions.ts` in
 * `damianvtran/local-operator` at `d383e6bfe`, copied so the algorithm and its
 * rationale are identical rather than re-derived.
 *
 * The design's end state (docs/design/ui-browser-tab.md 12.2) is that this file
 * is one of the 648 chrome-free lines MOVED into `extension/src/driver/` in the
 * lop repo and then VENDORED here as `src/main/browser/vendor/driver/*.ts` by
 * `scripts/sync-vendored.mjs`, with `PROVENANCE.json` pinning the ref and
 * `check-vendored.mjs` gating it. That lop-side move is design PR 1 and has not
 * landed on this branch's base, so this is the clearly-labelled local
 * implementation the task allows.
 *
 * TODO(vendoring): delete this file in favour of the vendored copy, keeping the
 * import path the same so nothing else changes.
 *
 * CONSTRAINT — behavior:'instant' everywhere: `window.scrollBy`/`scrollTo` and
 * `Element.scrollIntoView` honour the page's CSS `scroll-behavior: smooth`, and
 * a smooth scroll is a requestAnimationFrame-driven animation. Chromium throttles
 * rAF to zero in a hidden view, so on our intentionally-inactive agent tab a
 * smooth scroll starts an animation that never advances — observed live in the
 * extension as scrollY stuck at 0 after repeated scrolls. 'instant' overrides
 * the page CSS and does not depend on the animation-frame clock.
 */

/** A "page" step leaves this much overlap so the agent does not skip a band of
 * content between reads — the same courtesy a PageDown key gives. */
export const PAGE_OVERLAP_PX = 80;

/** One viewport down (minus overlap): the default "read more" gesture. */
export function defaultScrollExpression(): string {
	return scrollExpressionFor("down");
}

/** Explicit pixel deltas; callers must pass finite numbers, never page input. */
export function deltaScrollExpression(dx: number, dy: number): string {
	return `window.scrollBy({left: ${dx}, top: ${dy}, behavior: 'instant'})`;
}

/** Body for `Runtime.callFunctionOn` against a resolved node: center the
 * element so it is usable after the scroll rather than jammed against a
 * viewport edge. */
export const SCROLL_INTO_VIEW_FN =
	"function(){ this.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'}); }";

/** Fixed expression per direction keyword; unknown directions are a no-op. */
export function scrollExpressionFor(direction: string): string {
	const page = `(window.innerHeight - ${PAGE_OVERLAP_PX})`;
	const across = `(window.innerWidth - ${PAGE_OVERLAP_PX})`;
	switch (direction) {
		case "top":
			return "window.scrollTo({left: window.scrollX, top: 0, behavior: 'instant'})";
		case "bottom": {
			const de = "(document.scrollingElement||document.documentElement)";
			return `window.scrollTo({left: window.scrollX, top: ${de}.scrollHeight, behavior: 'instant'})`;
		}
		case "up":
			return `window.scrollBy({left: 0, top: -${page}, behavior: 'instant'})`;
		case "down":
			return `window.scrollBy({left: 0, top: ${page}, behavior: 'instant'})`;
		case "left":
			return `window.scrollBy({left: -${across}, top: 0, behavior: 'instant'})`;
		case "right":
			return `window.scrollBy({left: ${across}, top: 0, behavior: 'instant'})`;
		default:
			return "void 0";
	}
}

/** Every direction keyword `scrollExpressionFor` understands. Callers validate
 * against this rather than against a second literal list. */
export const SCROLL_DIRECTIONS: ReadonlySet<string> = new Set([
	"top",
	"bottom",
	"up",
	"down",
	"left",
	"right",
]);
