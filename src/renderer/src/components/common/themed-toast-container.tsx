import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { ToastContainer } from "react-toastify";

/**
 * Styled ToastContainer component using MUI styled API
 * Applies theme-aware styling to toast notifications
 */
const StyledToastContainer = styled(ToastContainer)(({ theme }) => {
	const isDarkMode = theme.palette.mode === "dark";

	// Define colors based on theme
	const backgroundColor = isDarkMode ? "#1A1B26" : "#FFFFFF";
	const textColor = theme.palette.text.primary;
	const borderColor = isDarkMode
		? "rgba(255, 255, 255, 0.1)"
		: "rgba(0, 0, 0, 0.1)";
	const shadowColor = isDarkMode ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.1)";
	const closeButtonColor = isDarkMode
		? "rgba(255, 255, 255, 0.6)"
		: "rgba(0, 0, 0, 0.6)";

	// Success colors
	const successBg = isDarkMode ? "#0F1A14" : "#F7FBF8";
	const successBorder = theme.palette.success.main;

	// Error colors
	const errorBg = isDarkMode ? "#1A0F0F" : "#FBF7F7";
	const errorBorder = theme.palette.error.main;

	// Info colors
	const infoBg = isDarkMode ? "#0F141A" : "#F7F9FB";
	const infoBorder = theme.palette.info.main;

	// Warning colors
	const warningBg = isDarkMode ? "#1A160F" : "#FBF9F7";
	const warningBorder = theme.palette.warning.main;

	return {
		"& .Toastify__toast": {
			backgroundColor,
			color: textColor,
			fontFamily: theme.typography.fontFamily,
			fontSize: `${theme.typography.fontSize}px`,
			borderRadius: "8px",
			border: `1px solid ${borderColor}`,
			boxShadow: `0 4px 12px ${shadowColor}`,
			padding: "16px 20px",
			minHeight: "auto",
		},
		"& .Toastify__toast-body": {
			padding: "6px 0",
			alignItems: "center",
		},
		"& .Toastify__close-button": {
			color: closeButtonColor,
			opacity: 0.7,
			"&:hover": {
				opacity: 1,
			},
		},
		"& .Toastify__progress-bar": {
			height: "4px",
		},
		"& .Toastify__toast--success": {
			backgroundColor: successBg,
			borderLeft: `4px solid ${successBorder}`,
			"& .Toastify__progress-bar": {
				backgroundColor: successBorder,
			},
		},
		"& .Toastify__toast--error": {
			backgroundColor: errorBg,
			borderLeft: `4px solid ${errorBorder}`,
			"& .Toastify__progress-bar": {
				backgroundColor: errorBorder,
			},
		},
		"& .Toastify__toast--info": {
			backgroundColor: infoBg,
			borderLeft: `4px solid ${infoBorder}`,
			"& .Toastify__progress-bar": {
				backgroundColor: infoBorder,
			},
		},
		"& .Toastify__toast--warning": {
			backgroundColor: warningBg,
			borderLeft: `4px solid ${warningBorder}`,
			"& .Toastify__progress-bar": {
				backgroundColor: warningBorder,
			},
		},
	};
});

/**
 * ThemedToastContainer component
 *
 * A wrapper around ToastContainer that applies theme-aware styling using MUI styled components
 */
export const ThemedToastContainer: FC = () => {
	return (
		<StyledToastContainer
			position="top-right"
			autoClose={5000}
			hideProgressBar={false}
			newestOnTop
			closeOnClick
			rtl={false}
			pauseOnFocusLoss
			draggable
			pauseOnHover
			aria-label="toast-notifications"
		/>
	);
};
