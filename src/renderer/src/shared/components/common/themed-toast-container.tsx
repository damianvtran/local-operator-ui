import GlobalStyles from "@mui/material/GlobalStyles";
import { useTheme } from "@mui/material/styles";
import type { FC } from "react";
import { Toaster, toast } from "sonner";

/**
 * ThemedToastContainer component
 *
 * A wrapper around sonner's Toaster that applies theme-aware styling and includes a close button.
 */
export const ThemedToastContainer: FC = () => {
	const theme = useTheme();
	const isDarkMode = theme.palette.mode === "dark";

	const paperBackgroundColor = theme.palette.background.paper;
	const borderColor = isDarkMode
		? "rgba(255, 255, 255, 0.23)"
		: "rgba(0, 0, 0, 0.23)";
	const textColor = theme.palette.text.primary;
	const fontSize = theme.typography.caption.fontSize;

	return (
		<>
			<GlobalStyles
				styles={{
					".themed-toast-close-button": {
						position: "absolute",
						top: "0px !important", // Added !important to ensure override
						right: "-16px !important", // Added !important to ensure override
						left: "auto !important", // Ensure left is not interfering
						backgroundColor: "black !important",
						border: "1px solid white !important",
						color: "white !important",
					},
				}}
			/>
			<Toaster
				position="bottom-right"
				toastOptions={{
					style: {
						background: paperBackgroundColor,
						color: textColor,
						border: `1px solid ${borderColor}`,
						fontSize: fontSize,
						padding: "12px 16px",
					},
					classNames: {
						closeButton: "themed-toast-close-button",
					},
					closeButton: true,
				}}
			/>
		</>
	);
};

export const showExampleToast = (message: string): void => {
	toast(message);
};
