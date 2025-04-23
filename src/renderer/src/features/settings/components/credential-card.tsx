import {
	faEdit,
	faInfoCircle,
	faKey,
	faLock,
	faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	alpha,
	Box,
	Button,
	IconButton,
	Tooltip,
	Typography,
	styled,
	useTheme,
} from "@mui/material";
import type { FC } from "react";
import { getCredentialInfo } from "./credential-manifest";

// Shadcn-inspired card container
const CredentialCardContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(2),
	height: "100%",
	display: "flex",
	flexDirection: "column",
	borderRadius: theme.shape.borderRadius * 0.75,
	border: `1px solid ${theme.palette.divider}`,
	backgroundColor: theme.palette.background.paper,
	transition: "border-color 0.2s ease-in-out",
	"&:hover": {
		borderColor: theme.palette.text.disabled,
	},
}));

// Styling for the credential name (title)
const CredentialName = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(1),
	fontSize: "0.9375rem",
	marginBottom: theme.spacing(0.25),
}));

// Styling for the credential key (subtitle)
const CredentialKey = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	fontSize: "0.75rem",
	fontFamily: "'Roboto Mono', monospace",
	marginBottom: theme.spacing(1),
	wordBreak: "break-all",
}));

// Styling for the credential description
const CredentialDescription = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	fontSize: "0.8125rem",
	lineHeight: 1.5,
	marginBottom: theme.spacing(2),
	flexGrow: 1,
}));

// Container for action buttons at the bottom
const CredentialActions = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "flex-end",
	alignItems: "center",
	marginTop: "auto",
	gap: theme.spacing(1),
}));

type CredentialCardProps = {
	credentialKey: string;
	isConfigured?: boolean;
	onEdit?: (key: string) => void;
	onClear?: (key: string) => void;
	onAdd?: (key: string) => void;
};

/**
 * Component for displaying a credential card with shadcn-inspired styling.
 * Shows details and actions based on whether the credential is configured.
 */
export const CredentialCard: FC<CredentialCardProps> = ({
	credentialKey,
	isConfigured = false,
	onEdit,
	onClear,
	onAdd,
}) => {
	const theme = useTheme();
	const credInfo = getCredentialInfo(credentialKey);

	// Common button styles based on shadcn
	const buttonSx = {
		textTransform: "none",
		fontSize: "0.8125rem",
		padding: theme.spacing(0.5, 1.5),
		borderRadius: theme.shape.borderRadius * 0.75,
	};

	const secondaryButtonSx = {
		...buttonSx,
		borderColor: theme.palette.divider,
		color: theme.palette.text.secondary,
		"&:hover": {
			backgroundColor: theme.palette.action.hover,
			borderColor: theme.palette.divider,
		},
	};

	const destructiveButtonSx = {
		...buttonSx,
		borderColor: theme.palette.divider,
		color: theme.palette.error.main,
		"&:hover": {
			backgroundColor: alpha(theme.palette.error.main, 0.05),
			borderColor: alpha(theme.palette.error.main, 0.5),
		},
	};

	const primaryButtonSx = {
		...buttonSx,
	};

	return (
		<CredentialCardContainer>
			{/* Card Header */}
			<Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
				<CredentialName>
					{/* Icon based on configured status */}
					<FontAwesomeIcon
						icon={isConfigured ? faLock : faKey}
						size="sm"
						fixedWidth
						style={{ marginRight: theme.spacing(0.5) }}
					/>
					{credInfo.name}
				</CredentialName>
				{/* Info Tooltip - Keep ts-ignore as requested */}
				{/* @ts-ignore */}
				<Tooltip title={credInfo.description} placement="top">
					<IconButton
						size="small"
						sx={{ ml: "auto", color: theme.palette.text.disabled }}
					>
						<FontAwesomeIcon icon={faInfoCircle} size="xs" />
					</IconButton>
				</Tooltip>
			</Box>

			{/* Credential Key */}
			<CredentialKey>{credentialKey}</CredentialKey>

			{/* Description */}
			<CredentialDescription variant="body2">
				{credInfo.description}
			</CredentialDescription>

			{/* Action Buttons */}
			<CredentialActions>
				{isConfigured ? (
					<>
						{/* Update Button (Secondary Style) */}
						<Button
							variant="outlined"
							size="small"
							startIcon={<FontAwesomeIcon icon={faEdit} size="xs" />}
							onClick={() => onEdit?.(credentialKey)}
							sx={secondaryButtonSx}
						>
							Update
						</Button>
						{/* Clear Button (Destructive Style) */}
						<Button
							variant="outlined"
							size="small"
							startIcon={<FontAwesomeIcon icon={faTrash} size="xs" />}
							onClick={() => onClear?.(credentialKey)}
							sx={destructiveButtonSx}
						>
							Clear
						</Button>
					</>
				) : (
					<>
						{/* Configure Button (Primary Style) */}
						<Button
							variant="outlined"
							size="small"
							color="primary"
							startIcon={<FontAwesomeIcon icon={faKey} size="xs" />}
							onClick={() => onAdd?.(credentialKey)}
							sx={{ ...primaryButtonSx, boxShadow: "none" }}
						>
							Configure
						</Button>
						{/* Link to get key (if URL exists) */}
						{credInfo.url && (
							// Keep ts-ignore as requested
							// @ts-ignore
							<Tooltip title={`Get your ${credInfo.name} key`} placement="top">
								<IconButton
									size="small"
									sx={{ color: theme.palette.text.disabled }} // Subtle color
									component="a"
									href={credInfo.url}
									target="_blank"
									rel="noopener noreferrer"
									aria-label={`Get your ${credInfo.name} key`}
								>
									<FontAwesomeIcon icon={faInfoCircle} size="xs" />
								</IconButton>
							</Tooltip>
						)}
					</>
				)}
			</CredentialActions>
		</CredentialCardContainer>
	);
};
