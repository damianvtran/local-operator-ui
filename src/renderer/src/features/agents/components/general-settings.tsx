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
import { Box, Divider, Grid, Tooltip, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import { CategoriesInputChips } from "@shared/components/common/categories-input-chips";
import { EditableField } from "@shared/components/common/editable-field";
import { TagsInputChips } from "@shared/components/common/tags-input-chips";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { ModelSelect } from "@shared/components/hosting/model-select";
import type { useUpdateAgent } from "@shared/hooks/use-update-agent";
import { useConfig } from "@shared/hooks/use-config";
import { showErrorToast } from "@shared/utils/toast-manager";
import type { FC } from "react";
import { useEffect, useState } from "react";

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
	position: "relative",
	marginBottom: 16,
});

// Update FieldLabel to be a styled 'div' to prevent nesting issues
// Apply typography styles manually
const FieldLabel = styled("div")(({ theme }) => ({
	fontFamily: theme.typography.fontFamily,
	fontSize: "0.875rem", // Small text size
	fontWeight: 500, // Slightly less bold
	color: theme.palette.text.secondary,
	marginBottom: 6, // Reduced margin
	display: "flex",
	alignItems: "center",
}));

// Update LabelIcon to match editable-field.tsx styles
const LabelIcon = styled(Box)({
	marginRight: 8, // Reduced margin
	opacity: 0.9,
	display: "flex",
	alignItems: "center",
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

// Restyle InfoCard to be just the value display box, matching input height/padding
const InfoCard = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	height: "36px",
	padding: theme.spacing(0.5, 1.5),
	borderRadius: 4,
	backgroundColor: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
	boxSizing: "border-box",
	width: "100%",
	overflow: "hidden",
}));

// Adjust ValueText styles slightly if needed
const ValueText = styled(Typography)(({ theme }) => ({
	fontWeight: 400,
	fontSize: "0.875rem",
	color: theme.palette.text.primary,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
}));

const MonospaceValueText = styled(ValueText)(({ theme }) => ({
	fontFamily: "monospace",
	color:
		theme.palette.mode === "light"
			? theme.palette.grey[900]
			: theme.palette.text.primary,
}));

const ModelPlaceholderContainer = styled("div")(({ theme }) => ({
	padding: "4px 12px",
	borderRadius: 6,
	backgroundColor: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
	position: "relative",
	minHeight: "36px",
	height: "36px",
	display: "flex",
	alignItems: "center",
	boxSizing: "border-box",
	width: "100%",
	textAlign: "left",
	justifyContent: "flex-start",
	color: theme.palette.text.primary,
	fontWeight: "normal",
	fontFamily: "inherit",
}));

const ModelPlaceholderText = styled("div")(({ theme }) => ({
	color: theme.palette.text.disabled,
	fontStyle: "normal",
	fontSize: "0.875rem",
	lineHeight: 1.5,
	paddingRight: 30,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	flexGrow: 1,
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
	const { data: config, isLoading: isConfigLoading } = useConfig();

	// currentHosting reflects the hosting provider that ModelSelect should use.
	// It's initialized based on the agent's setting or the global default,
	// and updated when the user makes a selection in HostingSelect.
	const [currentHosting, setCurrentHosting] = useState<string>("");

	useEffect(() => {
		// Initialize or reset currentHosting when the selected agent changes,
		// or when the global config loads/changes.
		if (!isConfigLoading && config?.values) {
			setCurrentHosting(
				selectedAgent.hosting || config.values.hosting || "",
			);
		} else if (!isConfigLoading) {
			// Config loaded, but no values (e.g. error or empty config)
			setCurrentHosting(selectedAgent.hosting || "");
		}
		// If config is still loading, currentHosting might be empty or based on a previous state.
		// It will be updated once the config fully loads.
	}, [selectedAgent, config, isConfigLoading]);

	const [tagsSaving, setTagsSaving] = useState(false);
	const [categoriesSaving, setCategoriesSaving] = useState(false);

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
								showErrorToast("Agent name cannot be empty");
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

				<Grid container spacing={2} alignItems="center">
					{" "}
					{/* Vertically align grid items */}
					<Grid
						item
						xs={12}
						md={6}
						data-tour-tag="agent-settings-hosting-select"
					>
						<HostingSelect
							// Key ensures component re-initializes if agent or its effective hosting changes.
							// Using selectedAgent.id ensures that if the agent changes, the select resets.
							// Fallback to a string for config?.values.hosting to ensure key is always a string.
							key={`hosting-select-${selectedAgent.id}-${selectedAgent.hosting || (config?.values.hosting ?? "default")}`}
							value={
								selectedAgent.hosting || (config?.values.hosting ?? "")
							}
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
							filterByCredentials={true}
							allowDefault={true}
						/>
					</Grid>
					<Grid item xs={12} md={6} data-tour-tag="agent-settings-model-select">
						{/* Only render ModelSelect if we have a hosting provider selected (currentHosting) */}
						{currentHosting ? (
							<ModelSelect
								// Key ensures component re-initializes if agent, current hosting, or its effective model changes.
								key={`model-select-${selectedAgent.id}-${currentHosting}-${selectedAgent.model || (!selectedAgent.hosting && config?.values.model_name ? config.values.model_name : "default")}`}
								value={
									selectedAgent.hosting
										? selectedAgent.model || ""
										: selectedAgent.model ||
											(config?.values.model_name ?? "")
								}
								hostingId={currentHosting} // This drives which models are available
								isSaving={savingField === "model"}
								allowDefault={true}
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
								<Tooltip title="Select a hosting provider first, and then select the AI model that you want to use.  Each model has different capabilities and costs.  Recommended: Automatic">
									<FieldLabel>
										<LabelIcon>
											<FontAwesomeIcon icon={faRobot} />
										</LabelIcon>
										Model
									</FieldLabel>
								</Tooltip>
								<ModelPlaceholderContainer>
									<ModelPlaceholderText>
										Select a hosting provider first...
									</ModelPlaceholderText>
								</ModelPlaceholderContainer>
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

				{/* Tags input */}
				<TagsInputChips
					value={selectedAgent.tags || []}
					label="Tags"
					icon={<FontAwesomeIcon icon={faTag} />}
					placeholder="Add tag..."
					disabled={tagsSaving}
					onChange={async (tags) => {
						if (
							Array.isArray(selectedAgent.tags) &&
							tags.length === selectedAgent.tags.length &&
							tags.every((t, i) => t === selectedAgent.tags?.[i])
						) {
							return;
						}
						setTagsSaving(true);
						try {
							const update: AgentUpdate = { tags };
							await updateAgentMutation.mutateAsync({
								agentId: selectedAgent.id,
								update,
							});
							if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
								await refetchAgent();
							}
						} catch (_error) {
							// Error handled in mutation
						} finally {
							setTagsSaving(false);
						}
					}}
				/>

				{/* Categories input */}
				<CategoriesInputChips
					value={selectedAgent.categories || []}
					label="Categories"
					icon={<FontAwesomeIcon icon={faInfoCircle} />}
					placeholder="Add category..."
					disabled={categoriesSaving}
					onChange={async (categories) => {
						if (
							Array.isArray(selectedAgent.categories) &&
							categories.length === selectedAgent.categories.length &&
							categories.every((c, i) => c === selectedAgent.categories?.[i])
						) {
							return;
						}
						setCategoriesSaving(true);
						try {
							const update: AgentUpdate = { categories };
							await updateAgentMutation.mutateAsync({
								agentId: selectedAgent.id,
								update,
							});
							if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
								await refetchAgent();
							}
						} catch (_error) {
							// Error handled in mutation
						} finally {
							setCategoriesSaving(false);
						}
					}}
				/>

				<Grid container spacing={3}>
					{/* Agent ID */}
					<Grid item xs={12} sm={6}>
						{/* Use updated FieldLabel and LabelIcon */}
						<FieldLabel>
							<LabelIcon>
								<FontAwesomeIcon icon={faIdCard} size="xs" />
							</LabelIcon>
							ID
						</FieldLabel>
						<InfoCard title={selectedAgent.id}>
							<MonospaceValueText>{selectedAgent.id}</MonospaceValueText>
						</InfoCard>
					</Grid>

					{/* Created Date */}
					<Grid item xs={12} sm={6}>
						{/* Use updated FieldLabel and LabelIcon */}
						<FieldLabel>
							<LabelIcon>
								<FontAwesomeIcon icon={faCalendarAlt} size="xs" />
							</LabelIcon>
							Created
						</FieldLabel>
						<InfoCard
							title={new Date(selectedAgent.created_date).toLocaleString()}
						>
							<ValueText>
								{new Date(selectedAgent.created_date).toLocaleString()}
							</ValueText>
						</InfoCard>
					</Grid>

					{/* Agent Version */}
					<Grid item xs={12} sm={6}>
						{/* Use updated FieldLabel and LabelIcon */}
						<FieldLabel>
							<LabelIcon>
								<FontAwesomeIcon icon={faCodeBranch} size="xs" />
							</LabelIcon>
							Version
						</FieldLabel>
						<InfoCard title={selectedAgent.version}>
							<ValueText>{selectedAgent.version}</ValueText>
						</InfoCard>
					</Grid>
				</Grid>
			</Box>
		</>
	);
};
