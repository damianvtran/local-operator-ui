/**
 * General Settings Component
 *
 * Component for displaying and editing general agent settings
 */

import {
	faCalendarAlt,
	faCodeBranch,
	faIdCard,
	faInfoCircle,
	faRobot,
	faTag,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Divider,
	Grid,
	TextField,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { ModelSelect } from "@shared/components/hosting/model-select";
import type { useUpdateAgent } from "@shared/hooks/use-update-agent";
import type { FC } from "react";
import { useState } from "react";
import { toast } from "react-toastify";

type GeneralSettingsProps = {
	/**
	 * The selected agent to display settings for
	 */
	selectedAgent: AgentDetails;

	/**
	 * Currently saving field
	 */
	savingField: string | null;

	/**
	 * Function to set the saving field
	 */
	setSavingField: (field: string | null) => void;

	/**
	 * Agent update mutation
	 */
	updateAgentMutation: ReturnType<typeof useUpdateAgent>;

	/**
	 * Function to refetch agent data after updates
	 */
	refetchAgent?: () => Promise<unknown>;

	/**
	 * Initial selected agent ID
	 */
	initialSelectedAgentId?: string;
};

const FieldContainer = styled(Box)({
	marginBottom: 24,
	position: "relative",
});

const FieldLabel = styled(Typography)(({ theme }) => ({
	marginBottom: 8,
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.secondary,
	fontWeight: 600,
}));

const LabelIcon = styled(Box)({
	marginRight: 12,
	opacity: 0.8,
});

const HeaderContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	marginBottom: theme.spacing(2),
	gap: theme.spacing(2),
}));

const SectionTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 600,
	marginBottom: theme.spacing(2),
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
}));

const TitleIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	marginRight: 10,
	color: theme.palette.primary.main,
	padding: theme.spacing(0.5),
	borderRadius: 999,
	backgroundColor: alpha(theme.palette.primary.main, 0.1),
}));

const InfoCard = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	marginBottom: theme.spacing(2),
	padding: theme.spacing(2),
	borderRadius: theme.shape.borderRadius * 2,
	backgroundColor: theme.palette.inputField.background,
	border: `1px solid ${theme.palette.inputField.border}`,
	transition: "all 0.2s ease",
	"&:hover": {
		backgroundColor: theme.palette.inputField.hoverBackground,
		boxShadow:
			theme.palette.mode === "light"
				? "0 2px 8px rgba(0,0,0,0.05)"
				: "0 2px 8px rgba(0,0,0,0.15)",
	},
}));

const CardIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	marginRight: 12,
	opacity: 0.8,
	color:
		theme.palette.mode === "light"
			? theme.palette.grey[700]
			: theme.palette.text.primary,
}));

// Use span instead of Box to avoid nesting <div> inside <p>
const LabelText = styled("span")(({ theme }) => ({
	color: theme.palette.text.secondary,
	marginRight: theme.spacing(1),
	display: "inline-block",
}));

// Use span instead of Box to avoid nesting <div> inside <p>
const ValueText = styled("span")(({ theme }) => ({
	fontWeight: 500,
	display: "inline-block",
	color: theme.palette.text.primary,
}));

const MonospaceValueText = styled(ValueText)(({ theme }) => ({
	fontFamily: "monospace",
	color:
		theme.palette.mode === "light"
			? theme.palette.grey[900]
			: theme.palette.text.primary,
}));

/**
 * General Settings Component
 *
 * Component for displaying and editing general agent settings
 */
export const GeneralSettings: FC<GeneralSettingsProps> = ({
	selectedAgent,
	savingField,
	setSavingField,
	updateAgentMutation,
	refetchAgent,
	initialSelectedAgentId,
}) => {
	// Track the current hosting provider to detect changes
	// Initialize with selectedAgent.hosting and don't update it in a useEffect
	// This prevents flickering when the hosting changes
	const [currentHosting, setCurrentHosting] = useState<string>(
		selectedAgent.hosting || "",
	);

	return (
		<>
			<HeaderContainer>
				<Box sx={{ width: "100%" }}>
					<EditableField
						value={selectedAgent.name}
						label="Agent Name"
						placeholder="Enter agent name..."
						icon={<FontAwesomeIcon icon={faRobot} />}
						isSaving={savingField === "name"}
						onSave={async (value) => {
							if (!value.trim()) {
								toast.error("Agent name cannot be empty");
								return;
							}
							setSavingField("name");

							try {
								const update: AgentUpdate = { name: value };

								// Perform the API update
								await updateAgentMutation.mutateAsync({
									agentId: selectedAgent.id,
									update,
								});

								// Only refetch if needed (when viewing the current agent)
								if (
									selectedAgent.id === initialSelectedAgentId &&
									refetchAgent
								) {
									await refetchAgent();
								}
							} catch (_error) {
								// Error is already handled in the mutation
							} finally {
								setSavingField(null);
							}
						}}
					/>
				</Box>

				<Grid container spacing={2}>
					<Grid item xs={12} md={6}>
						<HostingSelect
							// Modified key to not include the selectedAgent.id, so it doesn't re-render and reset when agent changes
							// This allows users to select a different hosting provider after making an initial selection
							key={`hosting-select-${selectedAgent.hosting || ""}`}
							value={selectedAgent.hosting || ""}
							isSaving={savingField === "hosting"}
							onSave={async (value) => {
								setSavingField("hosting");

								// Update the local state immediately to prevent flickering
								// This ensures the ModelSelect component gets the new hosting value right away
								setCurrentHosting(value);

								try {
									// Update both hosting and reset model to ensure compatibility
									const update: AgentUpdate = {
										hosting: value,
										// Clear model when hosting changes to avoid incompatible models
										model: "",
									};

									// Perform the API update
									await updateAgentMutation.mutateAsync({
										agentId: selectedAgent.id,
										update,
									});

									// Only refetch if needed (when viewing the current agent)
									if (
										selectedAgent.id === initialSelectedAgentId &&
										refetchAgent
									) {
										await refetchAgent();
									}
								} catch (_error) {
									// Error is already handled in the mutation
									// Revert the local state if there's an error
									setCurrentHosting(selectedAgent.hosting || "");
								} finally {
									setSavingField(null);
								}
							}}
							filterByCredentials={false}
						/>
					</Grid>

					<Grid item xs={12} md={6}>
						{/* Only render ModelSelect if we have a hosting provider selected */}
						{currentHosting ? (
							<ModelSelect
								// Modified key to not include the selectedAgent.id, so it doesn't re-render and reset when agent changes
								// This allows users to select a different model after making an initial selection
								key={`model-select-${currentHosting}`}
								value={selectedAgent.model || ""}
								hostingId={currentHosting}
								isSaving={savingField === "model"}
								onSave={async (value) => {
									setSavingField("model");

									try {
										const update: AgentUpdate = { model: value };

										// Perform the API update
										await updateAgentMutation.mutateAsync({
											agentId: selectedAgent.id,
											update,
										});

										// Only refetch if needed (when viewing the current agent)
										if (
											selectedAgent.id === initialSelectedAgentId &&
											refetchAgent
										) {
											await refetchAgent();
										}
									} catch (_error) {
										// Error is already handled in the mutation
									} finally {
										setSavingField(null);
									}
								}}
							/>
						) : (
							<FieldContainer>
								<FieldLabel variant="subtitle2">
									<LabelIcon>
										<FontAwesomeIcon icon={faRobot} />
									</LabelIcon>
									Model
								</FieldLabel>
								<TextField
									placeholder="Select a hosting provider first..."
									variant="outlined"
									size="small"
									disabled
									fullWidth
									InputProps={{
										sx: {
											fontSize: "0.875rem",
											lineHeight: 1.6,
											backgroundColor: (theme) =>
												theme.palette.inputField.background,
											borderRadius: 2,
											padding: "16px",
										},
									}}
								/>
							</FieldContainer>
						)}
					</Grid>
				</Grid>
			</HeaderContainer>

			<Divider sx={{ mb: 3 }} />

			<Box sx={{ mb: 3 }}>
				<SectionTitle variant="subtitle1">
					<TitleIcon icon={faInfoCircle} />
					Agent Information
				</SectionTitle>

				<EditableField
					value={selectedAgent.description || ""}
					label="Description"
					placeholder="Enter agent description..."
					icon={<FontAwesomeIcon icon={faTag} />}
					multiline
					rows={3}
					isSaving={savingField === "description"}
					onSave={async (value) => {
						setSavingField("description");

						try {
							const update: AgentUpdate = { description: value };

							// Perform the API update
							await updateAgentMutation.mutateAsync({
								agentId: selectedAgent.id,
								update,
							});

							// Only refetch if needed (when viewing the current agent)
							if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
								await refetchAgent();
							}
						} catch (_error) {
							// Error is already handled in the mutation
						} finally {
							setSavingField(null);
						}
					}}
				/>

				<Grid container spacing={3}>
					<Grid item xs={12} sm={6}>
						<InfoCard>
							<CardIcon icon={faIdCard} />
							<Typography
								variant="body2"
								title="Unique identifier for this agent"
							>
								<LabelText>ID</LabelText>
								<MonospaceValueText>{selectedAgent.id}</MonospaceValueText>
							</Typography>
						</InfoCard>
					</Grid>

					<Grid item xs={12} sm={6}>
						<InfoCard>
							<CardIcon icon={faCalendarAlt} />
							<Typography variant="body2" title="When this agent was created">
								<LabelText>Created</LabelText>
								<ValueText>
									{new Date(selectedAgent.created_date).toLocaleString()}
								</ValueText>
							</Typography>
						</InfoCard>
					</Grid>

					<Grid item xs={12} sm={6}>
						<InfoCard>
							<CardIcon icon={faCodeBranch} />
							<Typography variant="body2" title="Agent version number">
								<LabelText>Version</LabelText>
								<ValueText>{selectedAgent.version}</ValueText>
							</Typography>
						</InfoCard>
					</Grid>
				</Grid>
			</Box>
		</>
	);
};
