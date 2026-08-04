import { Box, Typography } from "@mui/material";
import type { TypographyProps } from "@mui/material";
import type { LucideIcon } from "lucide-react";
import type { FC } from "react";

type SectionTitleProps = TypographyProps & {
	title: string;
	icon?: LucideIcon;
	/** Icon edge length in px. Lucide takes pixels, not FontAwesome's em keywords. */
	iconSize?: number;
};

/**
 * A reusable component for displaying section titles with an optional icon.
 * Applies consistent styling and spacing.
 */
export const SectionTitle: FC<SectionTitleProps> = ({
	title,
	icon: Icon,
	iconSize = 14,
	variant = "h6",
	gutterBottom = false,
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
				gap: 1.5,
				fontWeight: 500,
				fontSize: "1.125rem",
				mb: gutterBottom ? 1.5 : 0,
				...sx,
			}}
			{...props}
		>
			{Icon && (
				<Box sx={{ width: 20, textAlign: "center" }}>
					{" "}
					{/* Container for fixed width */}
					<Icon size={iconSize} />
				</Box>
			)}
			{title}
		</Typography>
	);
};
