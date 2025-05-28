import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Grid,
	useTheme,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { CredentialUpdate } from "@shared/api/local-operator/types";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useUpdateCredential } from "@shared/hooks/use-update-credential";
import { useMemo, useState } from "react";
import type { FC } from "react";
import { CredentialCard } from "./credential-card";
import { CredentialDialog } from "./credential-dialog";
import { CREDENTIAL_MANIFEST } from "./credential-manifest";
import { CredentialsSection } from "./credentials-section";

const LoadingContainer = styled(Box)({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	minHeight: 150,
});

/**
 * Credentials component - Displays and manages API credentials using shadcn-inspired styling.
 * This component renders the *content* for the API Credentials section.
 */
export const Credentials: FC = () => {
	const theme = useTheme();
	const { data: credentialsData, isLoading, error, refetch } = useCredentials();
	const updateCredentialMutation = useUpdateCredential();
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [currentCredentialKey, setCurrentCredentialKey] = useState<
		string | null
	>(null);

	const handleEditCredential = (key: string) => {
		setCurrentCredentialKey(key);
		setEditDialogOpen(true);
	};

	const handleAddCredential = (key: string | null = null) => {
		setCurrentCredentialKey(key);
		setAddDialogOpen(true);
	};

	const handleCloseDialogs = () => {
		setEditDialogOpen(false);
		setAddDialogOpen(false);
		setCurrentCredentialKey(null);
	};

	const handleSaveCredential = async (update: CredentialUpdate) => {
		try {
			await updateCredentialMutation.mutateAsync(update);
			handleCloseDialogs();
			await refetch();
		} catch (err) {
			console.error("Error saving credential:", err);
		}
	};

	const handleClearCredential = async (key: string) => {
		try {
			await updateCredentialMutation.mutateAsync({ key, value: "" });
			await refetch();
		} catch (err) {
			console.error("Error clearing credential:", err);
		}
	};

	const existingKeys = useMemo(
		() =>
			credentialsData?.keys?.filter(
				(key) =>
					!CREDENTIAL_MANIFEST.find((cred) => cred.key === key)?.internal,
			) ?? [],
		[credentialsData],
	);

	const availableCredentials = useMemo(
		() =>
			CREDENTIAL_MANIFEST.filter(
				(cred) => !existingKeys.includes(cred.key) && !cred.internal,
			),
		[existingKeys],
	);

	const renderContent = () => {
		if (isLoading) {
			return (
				<LoadingContainer>
					<CircularProgress />
				</LoadingContainer>
			);
		}

		if (error || !credentialsData) {
			return (
				<Alert severity="error" sx={{ width: "100%" }}>
					Failed to load credentials:{" "}
					{error instanceof Error ? error.message : "Unknown error"}
				</Alert>
			);
		}

		return (
			<>
				{/* Configured Credentials Section */}
				<CredentialsSection
					title="Configured Credentials"
					description="These API credentials are currently configured and available for use."
					isEmpty={existingKeys.length === 0}
					emptyStateType="noCredentials"
					isFirstSection={true}
				>
					{existingKeys.map((key) => (
						<Grid item xs={12} sm={6} md={4} key={key}>
							<CredentialCard
								credentialKey={key}
								isConfigured={true}
								onEdit={handleEditCredential}
								onClear={handleClearCredential}
							/>
						</Grid>
					))}
				</CredentialsSection>

				{/* Available Credentials Section */}
				<CredentialsSection
					title="Available Credentials"
					description="These are common API credentials you can configure to enhance functionality."
					isEmpty={availableCredentials.length === 0}
					emptyStateType="allConfigured"
				>
					{availableCredentials.map((cred) => (
						<Grid item xs={12} sm={6} md={4} key={cred.key}>
							<CredentialCard
								credentialKey={cred.key}
								isConfigured={false}
								onAdd={() => handleAddCredential(cred.key)}
							/>
						</Grid>
					))}
				</CredentialsSection>

				{/* Add Custom Credential Button */}
				<Box display="flex" justifyContent="center" mt={4}>
					<Button
						variant="outlined"
						color="primary"
						startIcon={<FontAwesomeIcon icon={faPlus} size="sm" />}
						onClick={() => handleAddCredential(null)}
						sx={{
							textTransform: "none",
							fontSize: "0.8125rem",
							padding: theme.spacing(0.75, 2),
							borderRadius: theme.shape.borderRadius * 0.75,
							boxShadow: "none",
							"&:hover": {
								boxShadow: "none",
								opacity: 0.9,
							},
						}}
					>
						Add Custom Credential
					</Button>
				</Box>

				{/* Edit Credential Dialog */}
				{editDialogOpen && (
					<CredentialDialog
						open={editDialogOpen}
						onClose={handleCloseDialogs}
						onSave={handleSaveCredential}
						initialKey={currentCredentialKey || ""}
						existingKeys={existingKeys}
						isSaving={updateCredentialMutation.isPending}
						isEditMode={true}
					/>
				)}

				{/* Add Credential Dialog */}
				{addDialogOpen && (
					<CredentialDialog
						open={addDialogOpen}
						onClose={handleCloseDialogs}
						onSave={handleSaveCredential}
						initialKey={currentCredentialKey || ""}
						existingKeys={existingKeys}
						isSaving={updateCredentialMutation.isPending}
						isEditMode={false}
					/>
				)}
			</>
		);
	};

	return <Box>{renderContent()}</Box>;
};
