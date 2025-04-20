import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Alert, Box, Button, CircularProgress, Grid } from "@mui/material";
import type { CredentialUpdate } from "@shared/api/local-operator/types";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useUpdateCredential } from "@shared/hooks/use-update-credential";
import { useState } from "react";
import type { FC } from "react";
import { CredentialCard } from "./credential-card";
import { CredentialDialog } from "./credential-dialog";
import { CREDENTIAL_MANIFEST } from "./credential-manifest";
import { CredentialsSection } from "./credentials-section";
import {
	LoadingContainer,
	StyledCard,
	StyledCardContent,
} from "./credentials-styled";

/**
 * Credentials component
 * Displays and allows management of API credentials
 */
export const Credentials: FC = () => {
	const { data: credentialsData, isLoading, error, refetch } = useCredentials();
	const updateCredentialMutation = useUpdateCredential();
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [currentCredential, setCurrentCredential] = useState<string | null>(
		null,
	);

	const handleEditCredential = (key: string) => {
		setCurrentCredential(key);
		setEditDialogOpen(true);
	};

	const handleAddCredential = () => {
		setCurrentCredential(null);
		setAddDialogOpen(true);
	};

	const handleSaveCredential = async (update: CredentialUpdate) => {
		try {
			await updateCredentialMutation.mutateAsync(update);
			setEditDialogOpen(false);
			setAddDialogOpen(false);
			await refetch();
		} catch (error) {
			console.error("Error saving credential:", error);
		}
	};

	const handleClearCredential = async (key: string) => {
		try {
			await updateCredentialMutation.mutateAsync({
				key,
				value: "",
			});
			await refetch();
		} catch (error) {
			console.error("Error clearing credential:", error);
		}
	};

	// Loading state
	if (isLoading) {
		return (
			<StyledCard>
				<StyledCardContent>
					<LoadingContainer>
						<CircularProgress />
					</LoadingContainer>
				</StyledCardContent>
			</StyledCard>
		);
	}

	// Error state
	if (error || !credentialsData) {
		return (
			<StyledCard>
				<StyledCardContent>
					<Alert severity="error">
						Failed to load credentials. Please try again later.
					</Alert>
				</StyledCardContent>
			</StyledCard>
		);
	}

	const existingKeys = credentialsData.keys || [];
	const availableCredentials = CREDENTIAL_MANIFEST.filter(
		(cred) => !existingKeys.includes(cred.key),
	);

	return (
		<StyledCard>
			<StyledCardContent>
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
								onAdd={() => {
									setCurrentCredential(cred.key);
									setAddDialogOpen(true);
								}}
							/>
						</Grid>
					))}
				</CredentialsSection>

				{/* Add Custom Credential Button */}
				<Box display="flex" justifyContent="center" mt={4}>
					<Button
						variant="contained"
						color="primary"
						startIcon={<FontAwesomeIcon icon={faPlus} />}
						onClick={handleAddCredential}
					>
						Add Custom Credential
					</Button>
				</Box>

				{/* Edit Credential Dialog */}
				<CredentialDialog
					open={editDialogOpen}
					onClose={() => setEditDialogOpen(false)}
					onSave={handleSaveCredential}
					initialKey={currentCredential || ""}
					existingKeys={existingKeys}
					isSaving={updateCredentialMutation.isPending}
				/>

				{/* Add Credential Dialog */}
				<CredentialDialog
					open={addDialogOpen}
					onClose={() => setAddDialogOpen(false)}
					onSave={handleSaveCredential}
					initialKey={currentCredential || ""}
					existingKeys={existingKeys}
					isSaving={updateCredentialMutation.isPending}
				/>
			</StyledCardContent>
		</StyledCard>
	);
};
