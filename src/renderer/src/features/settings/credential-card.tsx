import {
	faEdit,
	faInfoCircle,
	faKey,
	faLock,
	faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	IconButton,
	Paper,
	Tooltip,
	Typography,
	styled,
} from "@mui/material";
import type { FC } from "react";
import { getCredentialInfo } from "./credential-manifest";

const CredentialCardContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2),
	height: "100%",
	display: "flex",
	flexDirection: "column",
	borderRadius: 8,
	transition: "all 0.2s ease-in-out",
	backgroundColor: "rgba(0, 0, 0, 0.02)",
	"&:hover": {
		backgroundColor: "rgba(0, 0, 0, 0.04)",
		transform: "translateY(-2px)",
		boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
	},
}));

const CredentialName = styled(Typography)(() => ({
	fontWeight: 500,
	display: "flex",
	alignItems: "center",
	gap: 8,
}));

const CredentialKey = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	fontSize: "0.85rem",
	marginTop: 4,
}));

const CredentialDescription = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	marginTop: 8,
	marginBottom: 16,
	flexGrow: 1,
}));

const CredentialActions = styled(Box)(() => ({
	display: "flex",
	justifyContent: "flex-end",
	marginTop: "auto",
	gap: 8,
}));

type CredentialCardProps = {
	credentialKey: string;
	isConfigured?: boolean;
	onEdit?: (key: string) => void;
	onClear?: (key: string) => void;
	onAdd?: (key: string) => void;
};

/**
 * Component for displaying a credential card
 * Used for both configured and available credentials
 */
export const CredentialCard: FC<CredentialCardProps> = ({
	credentialKey,
	isConfigured = false,
	onEdit,
	onClear,
	onAdd,
}) => {
	const credInfo = getCredentialInfo(credentialKey);

	return (
		<CredentialCardContainer elevation={1}>
			<CredentialName>
				<FontAwesomeIcon icon={isConfigured ? faLock : faKey} />
				{credInfo.name}
				{/* @ts-ignore - MUI Tooltip type issue */}
				<Tooltip title={credInfo.description}>
					<IconButton size="small">
						<FontAwesomeIcon icon={faInfoCircle} size="xs" />
					</IconButton>
				</Tooltip>
			</CredentialName>

			<CredentialKey>{credentialKey}</CredentialKey>

			<CredentialDescription variant="body2">
				{credInfo.description}
			</CredentialDescription>

			<CredentialActions>
				{isConfigured ? (
					<>
						<Button
							variant="outlined"
							size="small"
							startIcon={<FontAwesomeIcon icon={faEdit} />}
							onClick={() => onEdit?.(credentialKey)}
						>
							Update
						</Button>
						<Button
							variant="outlined"
							size="small"
							color="error"
							startIcon={<FontAwesomeIcon icon={faTrash} />}
							onClick={() => onClear?.(credentialKey)}
						>
							Clear
						</Button>
					</>
				) : (
					<>
						<Button
							variant="outlined"
							size="small"
							color="primary"
							startIcon={<FontAwesomeIcon icon={faKey} />}
							onClick={() => onAdd?.(credentialKey)}
						>
							Configure
						</Button>
						{credInfo.url && (
							/* @ts-ignore - MUI Tooltip type issue */
							<Tooltip title={`Get your ${credInfo.name}`}>
								<IconButton
									size="small"
									sx={{ ml: 1 }}
									component="a"
									href={credInfo.url}
									target="_blank"
									rel="noopener noreferrer"
								>
									<FontAwesomeIcon icon={faInfoCircle} />
								</IconButton>
							</Tooltip>
						)}
					</>
				)}
			</CredentialActions>
		</CredentialCardContainer>
	);
};
