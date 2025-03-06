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
import { Box, Divider, Grid, Typography, alpha } from "@mui/material";
import { HostingSelect, ModelSelect } from "../hosting";
import { styled } from "@mui/material/styles";
import type {
	AgentDetails,
	AgentUpdate,
} from "@renderer/api/local-operator/types";
import type { useUpdateAgent } from "@renderer/hooks/use-update-agent";
import type { FC } from "react";
import { useState } from "react";
import { toast } from "react-toastify";
import { EditableField } from "../common/editable-field";

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

const TitleIcon = styled(FontAwesomeIcon)({
	marginRight: 10,
	color: "#f2f2f3",
});

const InfoCard = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	marginBottom: theme.spacing(2),
	padding: theme.spacing(2),
	borderRadius: 16,
	backgroundColor: alpha(theme.palette.background.default, 0.7),
}));

const CardIcon = styled(FontAwesomeIcon)({
	marginRight: 12,
	opacity: 0.8,
	color: "#f2f2f3",
});

const LabelText = styled(Box)(({ theme }) => ({
	color: theme.palette.text.secondary,
	marginRight: theme.spacing(1),
}));

const ValueText = styled(Box)({
	fontWeight: 500,
});

const MonospaceValueText = styled(ValueText)({
	fontFamily: "monospace",
});

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
	const [currentHosting, setCurrentHosting] = useState<string>(selectedAgent.hosting || "");
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
							} catch (error) {
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
										model: "" 
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
								} catch (error) {
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
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
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
						} catch (error) {
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
