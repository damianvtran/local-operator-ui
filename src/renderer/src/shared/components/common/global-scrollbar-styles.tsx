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
 */
const SCROLLBAR_CSS = `
*::-webkit-scrollbar {
	width: 8px;
	height: 8px;
}
*::-webkit-scrollbar-thumb {
	background-color: var(--color-control);
	border-radius: 4px;
}
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
	background-color: transparent;
}
`;

/**
 * Applies the app's scrollbar styling to every scroll container.
 */
export const GlobalScrollbarStyles: FC = () => <style>{SCROLLBAR_CSS}</style>;
