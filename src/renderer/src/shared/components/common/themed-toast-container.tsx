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
import { Toaster, toast } from "sonner";

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
	// Keep the close button on the right of the toast, which is where it was;
	// its colours come from the --gray* variables above.
	"--toast-close-button-start": "unset",
	"--toast-close-button-end": "0px",
	"--toast-close-button-transform": "translate(35%, -35%)",
} as CSSProperties;

/**
 * ThemedToastContainer component
 *
 * A wrapper around sonner's Toaster that applies theme-aware styling and includes a close button.
 */
export const ThemedToastContainer: FC = () => (
	<Toaster
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
