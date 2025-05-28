import type { FC } from "react";
import { Toaster, toast } from "sonner";
import { useTheme } from "@mui/material/styles";

/**
 * ThemedToastContainer component
 *
 * A wrapper around sonner's Toaster that applies theme-aware styling.
 */
export const ThemedToastContainer: FC = () => {
	const theme = useTheme();
	const isDarkMode = theme.palette.mode === "dark";

	const paperBackgroundColor = theme.palette.background.paper;
	const borderColor = isDarkMode
		? "rgba(255, 255, 255, 0.23)" // A common border color for dark mode in MUI
		: "rgba(0, 0, 0, 0.23)"; // A common border color for light mode in MUI
	const textColor = theme.palette.text.primary;
	const fontSize = theme.typography.caption.fontSize; // Using caption size for smaller text

	// Define a generic function to show toasts, which can be expanded later if needed
	// For now, this component primarily sets up the Toaster's appearance.
	// Individual toast calls will be handled by the toast-manager.

	return (
		<Toaster
			position="bottom-right"
			toastOptions={{
				style: {
					background: paperBackgroundColor,
					color: textColor,
					border: `1px solid ${borderColor}`,
					fontSize: fontSize,
					padding: "12px 16px", // Adjusted padding for smaller text
				},
				// Sonner does not have a direct equivalent for react-toastify's per-type styling
				// Custom styling per type would need to be handled via classNames or by wrapping toast calls
				// For now, applying a general style.
				// Success, error, info, warning styles would typically be handled by sonner's default themes
				// or by passing specific classNames when calling toast.success(), toast.error(), etc.
			}}
			// Other Toaster props as needed:
			// richColors // if you want default rich colors for success, error, warning, info
			// theme={isDarkMode ? "dark" : "light"} // sonner has its own theme prop
			// closeButton // if a close button is desired on all toasts
			// duration // default duration for toasts
			// visibleToasts // control number of visible toasts
			// expand // whether toasts should expand on hover
			// gap // gap between toasts
		/>
	);
};

// Example of how you might export specific toast functions if needed from here,
// though it's better handled in toast-manager.ts
export const showExampleToast = (message: string): void => {
	toast(message);
};
