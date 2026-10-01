import {
	SCROLLBAR_ATTRIBUTE,
	SCROLLBAR_EASING,
	SCROLLBAR_FADE_IN_MS,
	SCROLLBAR_FADE_OUT_MS,
} from "@shared/lib/scrollbar-activity";
import type { FC } from "react";

/*
 * The thumb is `border-control` — the role floored at 3:1 on every ground —
 * because a scrollbar thumb is a control the user has to find and grab, not a
 * decorative rule. It used to be a mode-switched `rgba(255,255,255,0.1)` /
 * `rgba(0,0,0,0.2)`, which measured about 1.1:1 in dark themes: the thumb was
 * there, and it was invisible until you already knew where it was.
 *
 * The track stays transparent so the scrollbar takes the colour of whichever
 * ground it is over, rather than cutting a strip of a fifth colour through it.
 *
 * These live in a `<style>` element rather than in `styles/index.css` only
 * because `::-webkit-scrollbar` is not expressible as a Tailwind utility and
 * the app's stylesheet is owned elsewhere. Reading the role as a `var()` means
 * a theme switch repaints the scrollbar with no React involvement at all —
 * which is why this component takes no theme and never re-renders, unlike the
 * MUI `GlobalStyles` + `useTheme()` pair it replaced.
 *
 * WHAT CHANGED ON 2026-09-30 (design: `docs/design/scrollbars-fade.md`): the
 * thumb keeps that look and gains one behaviour — it is invisible at rest and
 * fades in when the reader scrolls or moves toward the bar. The fade is CSS;
 * the module that decides WHEN a scroller is awake is
 * `shared/lib/scrollbar-activity.ts`, and it is the only writer of the
 * attribute these rules key on. The durations of a reveal and of its departure
 * live here; the HOLD between them lives in the module, because it is a timer
 * and not a style.
 */
const SCROLLBAR_CSS = `
/*
 * A transition declared on ::-webkit-scrollbar-thumb does not animate in
 * Chromium — the paint snaps within one frame (the mechanism memo's probe 1).
 * A REGISTERED <number> custom property transitioned on the SCROLLER element
 * does, and the pseudo-element reads the interpolated value. Registration is
 * what makes it interpolatable at all: an unregistered custom property is a
 * token substitution and pops, and \`inherits: false\` would keep the value out
 * of the pseudo-element's reach entirely.
 */
@property --lo-sb {
	syntax: "<number>";
	inherits: true;
	initial-value: 0;
}
/*
 * THE RESET, and it is what keeps the value from leaking: with an inherited
 * property and no reset, marking an outer scroller also reveals an unmarked
 * inner one (the memo measured 79 against 255). Every element restates the
 * property at 0, so a scroller's own value is the only one its thumb can see.
 * It also bounds the cost: 49 style recalcs per fade against 98 without it.
 */
* {
	--lo-sb: 0;
}
*::-webkit-scrollbar {
	width: 8px;
	height: 8px;
}
/*
 * THE FADE IS ON THE THUMB'S COLOUR, NOT ON ITS OPACITY. The controls rule
 * ("disabled changes colour, never opacity") is about disabled controls, and
 * this is not a disabled state: the thumb is either usable and opaque or not on
 * screen. Mechanically, \`opacity\` on the pseudo would drag the track and the
 * corner along with it and is a whole-element alpha; \`color-mix(… transparent)\`
 * changes the thumb's own colour, and at alpha 1 it is still exactly
 * \`--color-control\` — the role the contract floors at 3:1.
 */
*::-webkit-scrollbar-thumb {
	background-color: color-mix(in srgb, var(--color-control) calc(var(--lo-sb) * 100%), transparent);
	border-radius: 4px;
}
/*
 * The thumb under the pointer is solid at once: a reader who has already found
 * the thumb should not have to wait out the reveal's ${SCROLLBAR_FADE_IN_MS}ms.
 * Same role, so a theme switch still repaints it.
 */
*::-webkit-scrollbar-thumb:hover {
	background-color: var(--color-control);
}
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
	background-color: transparent;
}
/*
 * THE TWO DURATIONS ARE SPLIT ACROSS TWO RULES ON PURPOSE, because a transition
 * takes its properties from the AFTER-change style. Going idle -> active the
 * after-change style is the active rule, so ${SCROLLBAR_FADE_IN_MS}ms is what the
 * reveal runs at; going active -> idle it is the base rule, so the departure
 * runs at ${SCROLLBAR_FADE_OUT_MS}ms. Leaving is slower than arriving, which is
 * the standard envelope.
 *
 * The base rule is attribute-gated rather than \`*\` because a transition on
 * every element in the tree cost about 2x TaskDuration on a hover sweep (the
 * memo's rejected X-star variant, 655 recalcs against 300), while this shape
 * measured 53 recalcs and 26 ms for the same sweep.
 */
[${SCROLLBAR_ATTRIBUTE}] {
	transition: --lo-sb ${SCROLLBAR_FADE_OUT_MS}ms ${SCROLLBAR_EASING};
}
[${SCROLLBAR_ATTRIBUTE}="active"] {
	--lo-sb: 1;
	transition: --lo-sb ${SCROLLBAR_FADE_IN_MS}ms ${SCROLLBAR_EASING};
}
/*
 * NO ANIMATION AND NO \`animation\` PROPERTY ANYWHERE IN THIS SHEET, and that is a
 * rule rather than an omission (review round 1: U2 / U3, measured on the
 * transcript). The keyboard cue used to be \`animation: lo-sb-blip ...\` on a
 * focus-visible scroller, and the shorthand takes the element's \`animation-name\`
 * (and resets \`animation-timeline\`) away from every other consumer. The
 * transcript's own scroll-linked top fade — \`animation: transcript-top-fade ...\`
 * with \`animation-timeline: scroll(self)\` — read \`animation-timeline: auto\` and a
 * 0px fade whenever the log was focus-visible and idle: the 24px top dissolve
 * popped off and back around every keyboard scroll, and because a finished
 * animation that no longer applies keeps its name, the original never returned.
 * The cue is a REVEAL now, driven by the module's \`focusin\` (same attribute, same
 * hold, same transition), which composes with whatever else the element animates
 * because it touches only the custom property. Reintroducing \`animation\` here
 * reintroduces that regression.
 */
/*
 * FORCED COLORS: the fade is suppressed and the bar is simply solid. The
 * platform overrides our colour anyway (the memo's forced-colors probe read the
 * thumb's red channel at 0 while the layout stayed 8px), and a high-contrast
 * reader is the last one who should have to move the pointer to discover a bar.
 * \`transition: none\` is stated rather than left implicit: with \`--lo-sb\` pinned
 * at 1 there is nothing to interpolate, and the line is what keeps a future
 * change from animating a system-colour bar.
 */
@media (forced-colors: active) {
	* {
		--lo-sb: 1;
	}
	[${SCROLLBAR_ATTRIBUTE}] {
		transition: none;
	}
}
`;

/**
 * Applies the app's scrollbar styling to every scroll container.
 */
export const GlobalScrollbarStyles: FC = () => <style>{SCROLLBAR_CSS}</style>;
