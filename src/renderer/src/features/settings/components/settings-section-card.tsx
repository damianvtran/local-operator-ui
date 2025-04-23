import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Card, CardContent, Typography, styled } from "@mui/material";
import type { FC, ReactNode, RefObject } from "react";

// Shadcn-like card styles
const StyledCard = styled(Card)(({ theme }) => ({
	marginBottom: theme.spacing(3), // Consistent margin (24px)
	backgroundColor: theme.palette.background.paper,
	borderRadius: 6, // Slightly less rounded (shadcn default is often 8px, but 6px is common too)
	border: `1px solid ${theme.palette.divider}`, // Use border instead of shadow
	boxShadow: "none", // Remove default shadow
	width: "100%", // Ensure card takes full width of its container
}));

const StyledCardContent = styled(CardContent)(({ theme }) => ({
	padding: theme.spacing(3), // Consistent padding (24px)
	"&:last-child": {
		// Ensure consistent padding even for last child in MUI Card
		paddingBottom: theme.spacing(3),
	},
}));

const CardTitle = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(0.5), // Reduced margin below title (4px)
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(1.5), // Consistent gap (12px)
	fontSize: "1.125rem", // ~18px, similar to h6 but explicit
	fontWeight: 500, // Medium weight
}));

const CardDescription = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(3), // Consistent margin below description (24px)
	color: theme.palette.text.secondary,
	fontSize: "0.875rem", // Smaller description text (14px)
	lineHeight: 1.5, // Improve readability
}));

type SettingsSectionCardProps = {
	title: string;
	description?: string;
	icon?: IconDefinition;
	children: ReactNode;
	titleComponent?: ReactNode; // Optional custom title component (e.g., for Radient section)
	contentProps?: Record<string, unknown>; // Pass additional props to CardContent
	cardRef?: RefObject<HTMLDivElement>; // Add ref prop for scrolling
};

/**
 * A reusable card component for settings sections, styled similarly to shadcn/ui cards.
 * Provides consistent padding, borders, and structure for titles, descriptions, and content.
 */
export const SettingsSectionCard: FC<SettingsSectionCardProps> = ({
	title,
	description,
	icon,
	children,
	titleComponent,
	contentProps,
	cardRef, // Receive ref
}) => {
	return (
		// Attach ref here for scrolling purposes
		<StyledCard ref={cardRef}>
			<StyledCardContent {...contentProps}>
				{titleComponent ? (
					titleComponent // Render custom title if provided
				) : (
					<CardTitle variant="h6">
						{/* Use fixedWidth for consistent icon spacing */}
						{icon && <FontAwesomeIcon icon={icon} fixedWidth />}
						{title}
					</CardTitle>
				)}
				{description && (
					<CardDescription variant="body2">{description}</CardDescription>
				)}
				{/* Content area */}
				<Box>{children}</Box>
			</StyledCardContent>
		</StyledCard>
	);
};

// --- Reusable Layout Components ---

/**
 * A container for form fields or settings within a SettingsSectionCard, providing consistent spacing.
 */
export const FieldsContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(2), // Consistent gap (16px) between fields
}));

/**
 * A responsive grid container for displaying InfoBox components.
 */
export const InfoGrid = styled(Box)(({ theme }) => ({
	display: "grid",
	// Responsive grid: 1 column on small screens, auto-fit columns on larger screens
	gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
	gap: theme.spacing(2), // Consistent gap (16px) between info boxes
}));

/**
 * A styled box for displaying individual pieces of information (label/value pairs).
 * Features subtle background, border, and padding consistent with shadcn aesthetics.
 */
export const InfoBox = styled(Box)(({ theme }) => ({
	padding: theme.spacing(1.5), // Reduced padding (12px)
	borderRadius: 4, // Less rounded corners (shadcn often uses 4px or 6px)
	backgroundColor: theme.palette.action.hover, // Use a subtle background like hover state
	border: `1px solid ${theme.palette.divider}`, // Add a subtle border
	height: "100%", // Ensure consistent height if needed within a grid
	display: "flex",
	flexDirection: "column",
	justifyContent: "center", // Center content vertically if needed
}));

/**
 * Styled label for information displayed within an InfoBox.
 */
export const InfoLabel = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(0.5), // Reduced margin (4px)
	fontSize: "0.75rem", // Smaller font size (12px)
	lineHeight: 1.4, // Adjust line height for small font
	fontWeight: 400, // Normal weight for labels
}));

/**
 * Styled value for information displayed within an InfoBox.
 */
export const InfoValue = styled(Typography)(() => ({
	fontWeight: 500, // Medium weight for values
	fontSize: "0.875rem", // Consistent small font size (14px)
	lineHeight: 1.4, // Adjust line height
	wordBreak: "break-word", // Prevent long values from overflowing the box
}));
