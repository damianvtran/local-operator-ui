/**
 * Storybook-only helpers for the panel stories.
 *
 * Nothing in the app imports this file: it exists so a story can put a panel
 * section in front of the shutter, and it is dead weight in every bundle that
 * does not.
 */

import { scrollRegionToTop } from "@shared/lib/scroll";

/**
 * Bring a panel section into view, by its heading.
 *
 * A panel body is a SCROLLING region — `max-h-[min(76vh,760px)]` — and the
 * capture harness photographs the viewport without scrolling anything. So every
 * state whose distinguishing content sits below the fold produced a frame
 * byte-identical to the populated one: `/session` sections 6-9 (Timings, Tool
 * calls, Recent requests, Scope) and `/info` sections 3-6 had never been
 * photographed at all, which is how `zero-samples`, `no-tool-calls`, `build-skew`,
 * `registry-unavailable`, `roster-unread`, `no-memory` and `mcp-settling` came
 * to ship the populated image (design round 1, D2 — fifteen named states, five
 * distinct images). A taller viewport cannot fix it: the body's cap is an
 * absolute 760px, so growing the viewport grows the page, never the panel.
 *
 * The region is looked up on the DOCUMENT because the dialog is portaled to
 * `document.body`, outside the story's canvas element. Everything is a no-op when
 * the region or the heading is missing, so a story whose fixture fails to render
 * shows the top of its panel instead of throwing inside a capture sweep.
 *
 * `scrollRegionToTop` rather than `scrollIntoView`, and the comment here used to
 * claim the opposite of the truth: `scrollIntoView` does NOT "walk up to the
 * scrollable region and stop there". Its default walks EVERY scrolling box in the
 * chain to the viewport, `overflow: hidden` boxes included, which is how the same
 * call in the run panel's reveal came to shift the whole app frame (see that
 * helper for the measurements). A capture harness gets the region it named.
 */
export const scrollPanelToSection = (title: string): void => {
	const region = document.querySelector<HTMLElement>(
		'[role="region"][aria-label]',
	);
	if (!region) return;
	const heading = [...region.querySelectorAll("h3")].find((node) =>
		(node.textContent ?? "").includes(title),
	);
	if (!heading) return;
	/*
	 * `block: "start"` semantics: the section's own heading at the top of the
	 * body, which is the heading a reviewer needs in order to know what they are
	 * looking at — and the dialog around it does not move.
	 */
	scrollRegionToTop(region, heading);
};
