import type { CredentialUpdate } from "@shared/api/local-operator/types";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
} from "@shared/components/ui";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useUpdateCredential } from "@shared/hooks/use-update-credential";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { FC } from "react";
import { CredentialCard } from "./credential-card";
import { CredentialDialog } from "./credential-dialog";
import { CREDENTIAL_MANIFEST } from "./credential-manifest";
import { CredentialsSection } from "./credentials-section";

/**
 * Contents of the API credentials settings section: what is configured, what is
 * available to configure, and the dialogs for both.
 *
 * The heading and the tour tag belong to the `SettingsSection` this renders
 * inside, so nothing here draws a section of its own — the two group panels are
 * the only boundaries on this part of the page.
 */
export const Credentials: FC = () => {
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
				<div className="flex min-h-40 items-center justify-center">
					{/* Standalone spinner, so it carries the label that names the wait. */}
					<Spinner size="lg" label="Loading credentials" />
				</div>
			);
		}

		if (error || !credentialsData) {
			return (
				<Alert variant="danger" role="alert">
					<AlertTitle>Could not load credentials</AlertTitle>
					<AlertDescription>
						{error instanceof Error
							? error.message
							: "The server did not say why. Check that Local Operator is running, then reopen this page."}
					</AlertDescription>
				</Alert>
			);
		}

		return (
			<>
				<CredentialsSection
					title="Configured credentials"
					description="These API credentials are currently configured and available for use."
					isEmpty={existingKeys.length === 0}
					emptyStateType="noCredentials"
				>
					{existingKeys.map((key) => (
						<CredentialCard
							key={key}
							credentialKey={key}
							isConfigured={true}
							onEdit={handleEditCredential}
							onClear={handleClearCredential}
						/>
					))}
				</CredentialsSection>

				<CredentialsSection
					title="Available credentials"
					description="These are common API credentials you can configure to enhance functionality."
					isEmpty={availableCredentials.length === 0}
					emptyStateType="allConfigured"
				>
					{availableCredentials.map((cred) => (
						<CredentialCard
							key={cred.key}
							credentialKey={cred.key}
							isConfigured={false}
							onAdd={() => handleAddCredential(cred.key)}
						/>
					))}
				</CredentialsSection>

				<div className="flex justify-center">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => handleAddCredential(null)}
					>
						<Plus />
						Add custom credential
					</Button>
				</div>

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

	return <div className="flex flex-col gap-6">{renderContent()}</div>;
};
