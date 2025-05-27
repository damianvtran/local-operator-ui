import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Card, CardContent, Typography, styled } from "@mui/material";
import type { FC, ReactNode, RefObject } from "react";

const StyledCard = styled(Card)(({ theme }) => ({
	marginBottom: theme.spacing(3),
	backgroundColor: theme.palette.background.paper,
	borderRadius: 6,
	backgroundImage: "none",
	border: `1px solid ${theme.palette.divider}`,
	boxShadow: "none",
	width: "100%",
}));

const StyledCardContent = styled(CardContent)(({ theme }) => ({
	padding: theme.spacing(3),
	"&:last-child": {
		paddingBottom: theme.spacing(3),
	},
}));

const CardTitle = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(0.5),
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(1.5),
	fontSize: "1.125rem",
	fontWeight: 500,
}));

const CardDescription = styled(Typography)(({ theme }) => ({
	marginBottom: theme.spacing(3),
	color: theme.palette.text.secondary,
	fontSize: "0.875rem",
	lineHeight: 1.5,
}));

type SettingsSectionCardProps = {
	title: string;
	description?: string;
	icon?: IconDefinition;
	children: ReactNode;
	titleComponent?: ReactNode;
	contentProps?: Record<string, unknown>;
	cardRef?: RefObject<HTMLDivElement>;
	dataTourTag?: string;
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
  dataTourTag,
}) => {
	return (
		// Attach ref here for scrolling purposes
		<StyledCard ref={cardRef} data-tour-tag={dataTourTag}>
			<StyledCardContent {...contentProps}>
				{titleComponent ? (
					titleComponent
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

/**
 * A container for form fields or settings within a SettingsSectionCard, providing consistent spacing.
 */
export const FieldsContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(2),
}));

/**
 * A responsive grid container for displaying InfoBox components.
 */
export const InfoGrid = styled(Box)(({ theme }) => ({
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
	gap: theme.spacing(2),
}));

/**
 * A styled box for displaying individual pieces of information (label/value pairs).
 * Features subtle background, border, and padding consistent with shadcn aesthetics.
 */
export const InfoBox = styled(Box)(({ theme }) => ({
	padding: theme.spacing(1.5),
	borderRadius: 4,
	backgroundColor: theme.palette.action.hover,
	border: `1px solid ${theme.palette.divider}`,
	height: "100%",
	display: "flex",
	flexDirection: "column",
	justifyContent: "center",
}));

/**
 * Styled label for information displayed within an InfoBox.
 */
export const InfoLabel = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(0.5),
	fontSize: "0.75rem",
	lineHeight: 1.4,
	fontWeight: 400,
}));

/**
 * Styled value for information displayed within an InfoBox.
 */
export const InfoValue = styled(Typography)(() => ({
	fontWeight: 500,
	fontSize: "0.875rem",
	lineHeight: 1.4,
	wordBreak: "break-word",
}));
