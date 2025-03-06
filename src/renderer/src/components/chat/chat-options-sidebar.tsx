/**
 * Chat Options Sidebar Component
 *
 * An expandable sidebar that displays and allows editing of chat settings
 * for the currently selected agent.
 */

import {
	faGear,
	faInfoCircle,
	faRobot,
	faServer,
	faSliders,
	faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	Drawer,
	IconButton,
	Paper,
	Tooltip,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import type {
	AgentDetails,
	AgentUpdate,
} from "@renderer/api/local-operator/types";
import { useAgent } from "@renderer/hooks/use-agents";
import { useUpdateAgent } from "@renderer/hooks/use-update-agent";
import type { FC } from "react";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { EditableField } from "../common/editable-field";
import { SliderSetting } from "../common/slider-setting";

type ChatOptionsSidebarProps = {
	/**
	 * Whether the sidebar is open
	 */
	open: boolean;

	/**
	 * Function to close the sidebar
	 */
	onClose: () => void;

	/**
	 * ID of the current agent/conversation
	 */
	agentId?: string;
};

const SidebarContainer = styled(Box)(({ theme }) => ({
	width: 380,
	height: "100%",
	display: "flex",
	flexDirection: "column",
	backgroundColor: theme.palette.background.paper,
	boxShadow: "-4px 0 20px rgba(0,0,0,0.1)",
}));

const SidebarHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: theme.spacing(2, 3),
	borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}));

const HeaderTitle = styled(Box)({
	display: "flex",
	flexDirection: "column",
});

const CloseButton = styled(IconButton)(({ theme }) => ({
	color: theme.palette.text.secondary,
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.08),
	},
}));

const SidebarContent = styled(Box)({
	flexGrow: 1,
	overflowY: "auto",
	padding: "16px 24px",
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: "4px",
	},
});

const SectionTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 600,
	marginBottom: theme.spacing(2),
	marginTop: theme.spacing(3),
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
}));

const TitleIcon = styled(FontAwesomeIcon)({
	marginRight: 10,
	color: "#f2f2f3",
});

const InfoButton = styled(IconButton)(({ theme }) => ({
	marginLeft: theme.spacing(1),
	color: theme.palette.primary.main,
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.08),
	},
}));

const ModelHostingSection = styled(Box)(({ theme }) => ({
	marginBottom: theme.spacing(2),
	padding: theme.spacing(2),
	backgroundColor: alpha(theme.palette.background.default, 0.4),
	borderRadius: theme.shape.borderRadius * 2,
}));

const UnsetContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2.5),
	borderRadius: theme.shape.borderRadius * 2,
	backgroundColor: alpha(theme.palette.background.default, 0.7),
	transition: "all 0.2s ease",
	marginBottom: theme.spacing(2),
	display: "flex",
	flexDirection: "column",
	"&:hover": {
		backgroundColor: alpha(theme.palette.background.default, 0.9),
		boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
	},
}));

const LabelWrapper = styled(Box)({
	marginBottom: 8,
});

const LabelText = styled(Typography)(({ theme }) => ({
	marginBottom: 4,
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
	fontWeight: 600,
}));

const DescriptionText = styled(Typography)(({ theme }) => ({
	fontSize: "0.875rem",
	lineHeight: 1.5,
	marginBottom: theme.spacing(2),
}));

/**
 * Unset Slider Setting Component
 *
 * Displays a "Not set" state with a button to set the value
 */
type UnsetSliderSettingProps = {
	label: string;
	description: string;
	defaultValue: number;
	onSetValue: (value: number) => Promise<void>;
	icon?: React.ReactNode;
};

const UnsetSliderSetting: FC<UnsetSliderSettingProps> = ({
	label,
	description,
	defaultValue,
	onSetValue,
	icon,
}) => {
	return (
		<UnsetContainer elevation={0}>
			<LabelWrapper>
				<LabelText variant="subtitle2">
					{icon && icon}
					{label}
				</LabelText>
				<DescriptionText variant="body2" color="text.secondary">
					{description}
				</DescriptionText>
			</LabelWrapper>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<Typography variant="body2" color="text.secondary" fontStyle="italic">
					Not set yet
				</Typography>
				<Button
					variant="outlined"
					size="small"
					onClick={async () => {
						await onSetValue(defaultValue);
					}}
				>
					Set to default ({defaultValue})
				</Button>
			</Box>
		</UnsetContainer>
	);
};

/**
 * Chat Options Sidebar Component
 *
 * An expandable sidebar that displays and allows editing of chat settings
 * for the currently selected agent.
 */
export const ChatOptionsSidebar: FC<ChatOptionsSidebarProps> = ({
	open,
	onClose,
	agentId,
}) => {
	const [savingField, setSavingField] = useState<string | null>(null);
	const updateAgentMutation = useUpdateAgent();

	// Fetch agent details
	const {
		data: agentData,
		refetch: refetchAgent,
		isLoading,
	} = useAgent(agentId);

	// Create a local copy of the agent data that we can update immediately
	const [localAgent, setLocalAgent] = useState<AgentDetails | null>(null);

	// Update local agent when agentData changes
	useEffect(() => {
		if (agentData) {
			setLocalAgent(agentData);
		}
	}, [agentData]);

	if (!localAgent || isLoading) {
		return null;
	}

	return (
		<Drawer
			anchor="right"
			open={open}
			onClose={onClose}
			PaperProps={{
				sx: {
					width: 380,
					border: "none",
				},
			}}
		>
			<SidebarContainer>
				<SidebarHeader>
					<HeaderTitle>
						<Typography variant="h6" fontWeight={600}>
							Chat Options
						</Typography>
						<Typography variant="body2" color="text.secondary">
							Customize settings for this agent
						</Typography>
					</HeaderTitle>
					<CloseButton onClick={onClose} size="large">
						<FontAwesomeIcon icon={faTimes} />
					</CloseButton>
				</SidebarHeader>

				<SidebarContent>
					{/* Model and Hosting Section */}
					<SectionTitle variant="subtitle1">
						<TitleIcon icon={faServer} />
						Model & Hosting
						{/* @ts-ignore - Tooltip has issues with TypeScript but works fine */}
						<Tooltip
							title="Configure which model and hosting provider to use"
							arrow
							placement="top"
						>
							<InfoButton size="small">
								<FontAwesomeIcon icon={faInfoCircle} size="xs" />
							</InfoButton>
						</Tooltip>
					</SectionTitle>

					<ModelHostingSection>
						<EditableField
							value={localAgent.hosting || ""}
							label="Hosting Provider"
							placeholder="Default"
							icon={<FontAwesomeIcon icon={faServer} />}
							isSaving={savingField === "hosting"}
							onSave={async (value) => {
								setSavingField("hosting");
								try {
									const update: AgentUpdate = { hosting: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													hosting: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>

						<Box sx={{ mt: 2 }}>
							<EditableField
								value={localAgent.model || ""}
								label="Model"
								placeholder="Default"
								icon={<FontAwesomeIcon icon={faRobot} />}
								isSaving={savingField === "model"}
								onSave={async (value) => {
									setSavingField("model");
									try {
										const update: AgentUpdate = { model: value };
										await updateAgentMutation.mutateAsync({
											agentId: localAgent.id,
											update,
										});

										// Update local state immediately
										setLocalAgent((prev) =>
											prev
												? {
														...prev,
														model: value,
													}
												: null,
										);

										// Also refresh the agent data
										if (refetchAgent) {
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
					</ModelHostingSection>

					{/* Chat Settings Section */}
					<SectionTitle variant="subtitle1">
						<TitleIcon icon={faSliders} />
						Generation Settings
						{/* @ts-ignore - Tooltip has issues with TypeScript but works fine */}
						<Tooltip
							title="Settings that control how the agent generates responses"
							arrow
							placement="top"
						>
							<InfoButton size="small">
								<FontAwesomeIcon icon={faInfoCircle} size="xs" />
							</InfoButton>
						</Tooltip>
					</SectionTitle>

					<Box sx={{ mb: 2 }}>
						<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
							You can set custom values for these settings by updating the
							options below. If not set, default values will be used that are
							optimized based on user testing.
						</Typography>
					</Box>

					{localAgent.temperature === null ? (
						<UnsetSliderSetting
							label="Temperature"
							description="Controls randomness in responses (0.0-1.0). Higher values make output more random."
							defaultValue={0.2}
							onSetValue={async (value) => {
								setSavingField("temperature");
								try {
									const update: AgentUpdate = { temperature: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													temperature: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					) : (
						<SliderSetting
							value={localAgent.temperature ?? 0.2}
							label="Temperature"
							description="Controls randomness in responses (0.0-1.0). Higher values make output more random."
							min={0}
							max={1}
							step={0.01}
							isSaving={savingField === "temperature"}
							onChange={async (value) => {
								setSavingField("temperature");
								try {
									const update: AgentUpdate = { temperature: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													temperature: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					)}

					{localAgent.top_p === null ? (
						<UnsetSliderSetting
							label="Top P"
							description="Controls cumulative probability of tokens to sample from (0.0-1.0)."
							defaultValue={0.9}
							onSetValue={async (value) => {
								setSavingField("top_p");
								try {
									const update: AgentUpdate = { top_p: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													top_p: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					) : (
						<SliderSetting
							value={localAgent.top_p ?? 0.9}
							label="Top P"
							description="Controls cumulative probability of tokens to sample from (0.0-1.0)."
							min={0}
							max={1}
							step={0.01}
							isSaving={savingField === "top_p"}
							onChange={async (value) => {
								setSavingField("top_p");
								try {
									const update: AgentUpdate = { top_p: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													top_p: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					)}

					{localAgent.top_k === null ? (
						<UnsetSliderSetting
							label="Top K"
							description="Limits tokens to sample from at each step."
							defaultValue={40}
							onSetValue={async (value) => {
								setSavingField("top_k");
								try {
									const update: AgentUpdate = { top_k: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													top_k: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					) : (
						<SliderSetting
							value={localAgent.top_k ?? 40}
							label="Top K"
							description="Limits tokens to sample from at each step."
							min={1}
							max={100}
							step={1}
							isSaving={savingField === "top_k"}
							onChange={async (value) => {
								setSavingField("top_k");
								try {
									const update: AgentUpdate = { top_k: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													top_k: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					)}

					{localAgent.max_tokens === null ? (
						<UnsetSliderSetting
							label="Max Tokens"
							description="Maximum tokens to generate in response."
							defaultValue={4096}
							onSetValue={async (value) => {
								setSavingField("max_tokens");
								try {
									const update: AgentUpdate = { max_tokens: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													max_tokens: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					) : (
						<SliderSetting
							value={localAgent.max_tokens ?? 4096}
							label="Max Tokens"
							description="Maximum tokens to generate in response."
							min={1}
							max={8192}
							step={1}
							isSaving={savingField === "max_tokens"}
							onChange={async (value) => {
								setSavingField("max_tokens");
								try {
									const update: AgentUpdate = { max_tokens: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													max_tokens: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					)}

					{localAgent.stop === null ? (
						<UnsetContainer elevation={0}>
							<LabelWrapper>
								<LabelText variant="subtitle2">
									<FontAwesomeIcon
										icon={faGear}
										style={{ marginRight: "10px" }}
									/>
									Stop Sequences
								</LabelText>
								<DescriptionText variant="body2" color="text.secondary">
									Sequences that will cause the model to stop generating text.
								</DescriptionText>
							</LabelWrapper>
							<Box
								sx={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
								}}
							>
								<Typography
									variant="body2"
									color="text.secondary"
									fontStyle="italic"
								>
									Not set yet
								</Typography>
								<Button
									variant="outlined"
									size="small"
									onClick={async () => {
										setSavingField("stop");
										try {
											const update: AgentUpdate = { stop: [] };
											await updateAgentMutation.mutateAsync({
												agentId: localAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) =>
												prev
													? {
															...prev,
															stop: [],
														}
													: null,
											);

											// Also refresh the agent data
											if (refetchAgent) {
												await refetchAgent();
											}
										} catch (error) {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								>
									Set to default (empty)
								</Button>
							</Box>
						</UnsetContainer>
					) : (
						<EditableField
							value={localAgent.stop?.join("\n") || ""}
							label="Stop Sequences"
							placeholder="Enter stop sequences (one per line)..."
							icon={<FontAwesomeIcon icon={faGear} />}
							multiline
							rows={3}
							isSaving={savingField === "stop"}
							onSave={async (value) => {
								setSavingField("stop");
								try {
									// Split by newlines and filter out empty lines
									const stopSequences = value
										.split("\n")
										.map((line) => line.trim())
										.filter((line) => line.length > 0);

									const update: AgentUpdate = {
										stop: stopSequences.length > 0 ? stopSequences : undefined,
									};

									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													stop:
														stopSequences.length > 0
															? stopSequences
															: undefined,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					)}

					{localAgent.frequency_penalty === null ? (
						<UnsetSliderSetting
							label="Frequency Penalty"
							description="Reduces repetition by lowering likelihood of repeated tokens (-2.0 to 2.0)."
							defaultValue={0}
							onSetValue={async (value) => {
								setSavingField("frequency_penalty");
								try {
									const update: AgentUpdate = { frequency_penalty: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													frequency_penalty: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					) : (
						<SliderSetting
							value={localAgent.frequency_penalty ?? 0}
							label="Frequency Penalty"
							description="Reduces repetition by lowering likelihood of repeated tokens (-2.0 to 2.0)."
							min={-2}
							max={2}
							step={0.01}
							isSaving={savingField === "frequency_penalty"}
							onChange={async (value) => {
								setSavingField("frequency_penalty");
								try {
									const update: AgentUpdate = { frequency_penalty: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													frequency_penalty: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					)}

					{localAgent.presence_penalty === null ? (
						<UnsetSliderSetting
							label="Presence Penalty"
							description="Increases diversity by lowering likelihood of prompt tokens (-2.0 to 2.0)."
							defaultValue={0}
							onSetValue={async (value) => {
								setSavingField("presence_penalty");
								try {
									const update: AgentUpdate = { presence_penalty: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													presence_penalty: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					) : (
						<SliderSetting
							value={localAgent.presence_penalty ?? 0}
							label="Presence Penalty"
							description="Increases diversity by lowering likelihood of prompt tokens (-2.0 to 2.0)."
							min={-2}
							max={2}
							step={0.01}
							isSaving={savingField === "presence_penalty"}
							onChange={async (value) => {
								setSavingField("presence_penalty");
								try {
									const update: AgentUpdate = { presence_penalty: value };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													presence_penalty: value,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					)}

					{localAgent.seed === null ? (
						<UnsetContainer elevation={0}>
							<LabelWrapper>
								<LabelText variant="subtitle2">
									<FontAwesomeIcon
										icon={faGear}
										style={{ marginRight: "10px" }}
									/>
									Seed
								</LabelText>
								<DescriptionText variant="body2" color="text.secondary">
									Random number seed for deterministic generation.
								</DescriptionText>
							</LabelWrapper>
							<Box
								sx={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
								}}
							>
								<Typography
									variant="body2"
									color="text.secondary"
									fontStyle="italic"
								>
									Not set yet
								</Typography>
								<Button
									variant="outlined"
									size="small"
									onClick={async () => {
										setSavingField("seed");
										try {
											// Set to a default seed value, e.g., 42
											const update: AgentUpdate = { seed: 42 };
											await updateAgentMutation.mutateAsync({
												agentId: localAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) =>
												prev
													? {
															...prev,
															seed: 42,
														}
													: null,
											);

											// Also refresh the agent data
											if (refetchAgent) {
												await refetchAgent();
											}
										} catch (error) {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								>
									Set to default (42)
								</Button>
							</Box>
						</UnsetContainer>
					) : (
						<EditableField
							value={localAgent.seed?.toString() || ""}
							label="Seed"
							placeholder="Random number seed for deterministic generation"
							icon={<FontAwesomeIcon icon={faGear} />}
							isSaving={savingField === "seed"}
							onSave={async (value) => {
								setSavingField("seed");
								try {
									const seedValue = value.trim()
										? Number.parseInt(value, 10)
										: undefined;

									// Validate that the seed is a valid number if provided
									if (value.trim() && Number.isNaN(seedValue as number)) {
										toast.error("Seed must be a valid number");
										return;
									}

									const update: AgentUpdate = { seed: seedValue };
									await updateAgentMutation.mutateAsync({
										agentId: localAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) =>
										prev
											? {
													...prev,
													seed: seedValue,
												}
											: null,
									);

									// Also refresh the agent data
									if (refetchAgent) {
										await refetchAgent();
									}
								} catch (error) {
									// Error is already handled in the mutation
								} finally {
									setSavingField(null);
								}
							}}
						/>
					)}
				</SidebarContent>
			</SidebarContainer>
		</Drawer>
	);
};
