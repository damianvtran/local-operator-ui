/**
 * Toasts.
 *
 * A toast has left the flow, so it takes the one shadow in the system
 * (`shadow-overlay`) on the `elevated` ground — not a ground step, because
 * the thing under it is an arbitrary scroll container, not a known surface.
 *
 * The colours are CSS custom properties on the toaster element, pointing
 * sonner's own variables at the role variables. Sonner injects its stylesheet
 * unlayered, and unlayered CSS beats Tailwind's `@layer utilities` regardless
 * of specificity, so role *classes* cannot override it — this is why the
 * styling is inline properties and not `classNames`. Reading `var(--color-*)`
 * means a theme switch repaints the toasts with no React involvement, which
 * is also what removes the old `useTheme()` + `GlobalStyles` pair: this
 * component now renders once and never re-renders on a theme change.
 */

import type { FC } from "react";
import type { CSSProperties } from "react";
import { Toaster, type ToasterProps, toast } from "sonner";

/**
 * Inline values are the only thing sonner's unlayered stylesheet cannot beat.
 * Every referenced variable is one a shared primitive already uses as a
 * utility, so it is guaranteed present in the compiled `@theme` output.
 */
const TOAST_THEME: CSSProperties = {
	"--normal-bg": "var(--color-elevated)",
	"--normal-text": "var(--color-ink)",
	"--normal-border": "var(--color-control)",
	"--border-radius": "var(--radius-md)",
	// Sonner's close button reads its greys for paint.
	"--gray12": "var(--color-ink)",
	"--gray4": "var(--color-control)",
	"--gray2": "var(--color-accent-wash)",
	"--gray5": "var(--color-control)",
	background: "var(--color-elevated)",
	color: "var(--color-ink)",
	border: "1px solid var(--color-control)",
	boxShadow: "var(--shadow-overlay)",
	fontSize: "var(--text-meta)",
	padding: "12px 16px",
	/*
	 * The close button sits on the toast's top-RIGHT corner, straddling it: its
	 * right edge 35% of its own width outside the toast's, its top edge the same
	 * distance above it. That is the mirror image of sonner's own LTR placement,
	 * which is why the transform below is the one sonner ships for RTL.
	 *
	 * `auto` rather than `unset`, and that value is the whole of the constraint.
	 * Sonner declares these two properties on `html[dir='ltr']` and on
	 * `[data-sonner-toaster][dir='ltr']` (`--toast-close-button-start: 0`,
	 * `--toast-close-button-end: unset`) and consumes them on the close button as
	 * `left: var(--toast-close-button-start); right: var(--toast-close-button-end);
	 * top: 0`, so what is written here overrides an INHERITED value — and a custom
	 * property is inherited by default, where `unset` means `inherit`. So `unset`
	 * here did not clear the inherited `0`, it re-stated it: both insets resolved
	 * to a length, and a 20px box with `width` set is the over-constrained case
	 * where the browser keeps `left` and drops `right` in LTR. The button then sat
	 * on the toast's LEFT edge and the RTL transform carried it 7px inward instead
	 * of outward. `auto` is the value that governs nothing, which leaves
	 * `right: 0px` as the single inset that does. Its colours come from the
	 * `--gray*` variables above.
	 */
	"--toast-close-button-start": "auto",
	"--toast-close-button-end": "0px",
	"--toast-close-button-transform": "translate(35%, -35%)",
} as CSSProperties;

/**
 * ThemedToastContainer component
 *
 * A wrapper around sonner's Toaster that applies theme-aware styling and includes a close button.
 */
// Undefined preserves Sonner's production lifetime. Evidence stories can hold
// their one real refusal without replaying mutations or altering error cooldowns.
export const ThemedToastContainer: FC<Pick<ToasterProps, "duration">> = ({
	duration,
}) => (
	<Toaster
		duration={duration}
		position="bottom-right"
		toastOptions={{
			style: TOAST_THEME,
			closeButton: true,
		}}
	/>
);

export const showExampleToast = (message: string): void => {
	toast(message);
};
