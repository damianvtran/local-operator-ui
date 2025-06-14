import { GlobalStyles } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { FC } from "react";
import { createGlobalScrollbarStyles } from "@shared/themes/global-scrollbar-styles";

/**
 * Global scrollbar styles component
 * 
 * Applies consistent scrollbar styling across the entire application
 * based on the current theme configuration
 */
export const GlobalScrollbarStyles: FC = () => {
	const theme = useTheme();
	const scrollbarStyles = createGlobalScrollbarStyles(theme);

	return <GlobalStyles styles={scrollbarStyles} />;
};
