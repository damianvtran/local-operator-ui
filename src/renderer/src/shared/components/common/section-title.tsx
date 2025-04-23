import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Typography } from "@mui/material";
import type { TypographyProps } from "@mui/material";
import type { FC } from "react";

type SectionTitleProps = TypographyProps & {
	title: string;
	icon?: IconDefinition;
	iconSize?: "xs" | "sm" | "lg" | "1x" | "2x"; // Allow specifying icon size
};

/**
 * A reusable component for displaying section titles with an optional icon.
 * Applies consistent styling and spacing.
 */
export const SectionTitle: FC<SectionTitleProps> = ({
	title,
	icon,
	iconSize = "sm", // Default icon size
	variant = "h6", // Default variant
	gutterBottom = false, // Default gutterBottom
	sx,
	...props
}) => {
	return (
		<Typography
			variant={variant}
			gutterBottom={gutterBottom}
			sx={{
				display: "flex",
				alignItems: "center",
				gap: 1.5, // Consistent gap (12px)
				fontWeight: 500, // Medium weight for titles
				mb: gutterBottom ? 1.5 : 0, // Apply margin bottom if gutterBottom is true
				...sx, // Allow overriding styles
			}}
			{...props}
		>
			{icon && (
				<Box sx={{ width: 20, textAlign: "center" }}>
					{" "}
					{/* Container for fixed width */}
					<FontAwesomeIcon icon={icon} size={iconSize} />
				</Box>
			)}
			{title}
		</Typography>
	);
};
