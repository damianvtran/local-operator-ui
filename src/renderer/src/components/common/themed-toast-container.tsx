import { useTheme } from "@mui/material/styles";
import type { FC } from "react";
import { ToastContainer } from "react-toastify";
import { Global, css } from "@emotion/react";

/**
 * ThemedToastContainer component
 *
 * A wrapper around ToastContainer that applies theme-aware styling using Global CSS
 */
export const ThemedToastContainer: FC = () => {
	const theme = useTheme();
	const isDarkMode = theme.palette.mode === "dark";

	// Define colors based on theme - ensure opacity is 1 for opaque backgrounds
	const backgroundColor = isDarkMode
		? "#1A1B26" // Dark background from Tokyo Night theme
		: "#FFFFFF";
	const textColor = theme.palette.text.primary;
	const borderColor = isDarkMode
		? "rgba(255, 255, 255, 0.1)"
		: "rgba(0, 0, 0, 0.1)";
	const shadowColor = isDarkMode ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.1)";
	const closeButtonColor = isDarkMode
		? "rgba(255, 255, 255, 0.6)"
		: "rgba(0, 0, 0, 0.6)";

	// Success colors - using darker backgrounds for dark mode
	const successBg = isDarkMode
		? "#0F1A14" // Very dark green with just a tinge
		: "#F7FBF8"; // Very light green with just a tinge
	const successBorder = theme.palette.success.main;

	// Error colors - using darker backgrounds for dark mode
	const errorBg = isDarkMode
		? "#1A0F0F" // Very dark red with just a tinge
		: "#FBF7F7"; // Very light red with just a tinge
	const errorBorder = theme.palette.error.main;

	// Info colors - using darker backgrounds for dark mode
	const infoBg = isDarkMode
		? "#0F141A" // Very dark blue with just a tinge
		: "#F7F9FB"; // Very light blue with just a tinge
	const infoBorder = theme.palette.info.main;

	// Warning colors - using darker backgrounds for dark mode
	const warningBg = isDarkMode
		? "#1A160F" // Very dark amber with just a tinge
		: "#FBF9F7"; // Very light amber with just a tinge
	const warningBorder = theme.palette.warning.main;

	return (
		<>
			<Global
				styles={css`
					.Toastify__toast {
						background-color: ${backgroundColor};
						color: ${textColor};
						font-family: ${theme.typography.fontFamily};
						font-size: ${theme.typography.fontSize}px;
						border-radius: 8px;
						border: 1px solid ${borderColor};
						box-shadow: 0 4px 12px ${shadowColor};
						padding: 16px 20px;
						min-height: auto;
					}
					
					.Toastify__toast-body {
						padding: 6px 0;
						align-items: center;
					}
					
					.Toastify__close-button {
						color: ${closeButtonColor};
						opacity: 0.7;
					}
					
					.Toastify__close-button:hover {
						opacity: 1;
					}
					
					.Toastify__progress-bar {
						height: 4px;
					}
					
					/* Success toast */
					.Toastify__toast--success {
						background-color: ${successBg};
						border-left: 4px solid ${successBorder};
					}
					
					.Toastify__toast--success .Toastify__progress-bar {
						background-color: ${successBorder};
					}
					
					/* Error toast */
					.Toastify__toast--error {
						background-color: ${errorBg};
						border-left: 4px solid ${errorBorder};
					}
					
					.Toastify__toast--error .Toastify__progress-bar {
						background-color: ${errorBorder};
					}
					
					/* Info toast */
					.Toastify__toast--info {
						background-color: ${infoBg};
						border-left: 4px solid ${infoBorder};
					}
					
					.Toastify__toast--info .Toastify__progress-bar {
						background-color: ${infoBorder};
					}
					
					/* Warning toast */
					.Toastify__toast--warning {
						background-color: ${warningBg};
						border-left: 4px solid ${warningBorder};
					}
					
					.Toastify__toast--warning .Toastify__progress-bar {
						background-color: ${warningBorder};
					}
				`}
			/>
			<ToastContainer
				position="top-right"
				autoClose={5000}
				hideProgressBar={false}
				newestOnTop
				closeOnClick
				rtl={false}
				pauseOnFocusLoss
				draggable
				pauseOnHover
				theme={isDarkMode ? "dark" : "light"}
				aria-label="toast-notifications"
			/>
		</>
	);
};
