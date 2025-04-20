/**
 * Chat Settings Component
 *
 * Component for displaying and editing chat-specific agent settings
 */

import {
	faComments,
	faGear,
	faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	IconButton,
	Paper,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import { SliderSetting } from "@shared/components/common/slider-setting";
import type { useUpdateAgent } from "@shared/hooks/use-update-agent";
import type { FC } from "react";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

type ChatSettingsProps = {
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
	width: 24,
	height: 24,
	backgroundColor: alpha(theme.palette.primary.main, 0.1),
}));

const InfoButton = styled(IconButton)(({ theme }) => ({
	marginLeft: theme.spacing(1),
	color: theme.palette.primary.main,
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.08),
	},
}));

const UnsetContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2.5),
	borderRadius: theme.shape.borderRadius * 2,
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.grey[100], 0.9)
			: alpha(theme.palette.background.default, 0.7),
	border:
		theme.palette.mode === "light"
			? `1px solid ${alpha(theme.palette.grey[300], 0.8)}`
			: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	transition: "all 0.2s ease",
	marginBottom: theme.spacing(2),
	display: "flex",
	flexDirection: "column",
	"&:hover": {
		backgroundColor:
			theme.palette.mode === "light"
				? alpha(theme.palette.grey[100], 1)
				: alpha(theme.palette.background.default, 0.9),
		boxShadow:
			theme.palette.mode === "light"
				? "0 4px 12px rgba(0,0,0,0.08)"
				: "0 4px 12px rgba(0,0,0,0.15)",
		border:
			theme.palette.mode === "light"
				? `1px solid ${alpha(theme.palette.primary.main, 0.2)}`
				: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
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
 * Chat Settings Component
 *
 * Component for displaying and editing chat-specific agent settings
 */
export const ChatSettings: FC<ChatSettingsProps> = ({
	selectedAgent,
	savingField,
	setSavingField,
	updateAgentMutation,
	refetchAgent,
	initialSelectedAgentId,
}) => {
	// Create a local copy of the agent data that we can update immediately
	const [localAgent, setLocalAgent] = useState<AgentDetails>(selectedAgent);

	// Update local agent when selectedAgent changes
	useEffect(() => {
		setLocalAgent(selectedAgent);
	}, [selectedAgent]);
	return (
		<Box sx={{ mt: 4, mb: 3 }}>
			<SectionTitle variant="subtitle1">
				<TitleIcon icon={faComments} />
				Chat Settings
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
					You can set custom values for these settings by updating the options
					below. If not set, default values will be used that are optimized
					based on user testing.
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
								agentId: selectedAgent.id,
								update,
							});

							// Update local state immediately
							setLocalAgent((prev) => ({
								...prev,
								temperature: value,
							}));

							// Also refresh the agent data
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
								agentId: selectedAgent.id,
								update,
							});
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
								agentId: selectedAgent.id,
								update,
							});

							// Update local state immediately
							setLocalAgent((prev) => ({
								...prev,
								top_p: value,
							}));

							// Also refresh the agent data
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
								agentId: selectedAgent.id,
								update,
							});
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
								agentId: selectedAgent.id,
								update,
							});

							// Update local state immediately
							setLocalAgent((prev) => ({
								...prev,
								top_k: value,
							}));

							// Also refresh the agent data
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
								agentId: selectedAgent.id,
								update,
							});
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
								agentId: selectedAgent.id,
								update,
							});

							// Update local state immediately
							setLocalAgent((prev) => ({
								...prev,
								max_tokens: value,
							}));

							// Also refresh the agent data
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
								agentId: selectedAgent.id,
								update,
							});
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
			)}

			{localAgent.stop === null ? (
				<UnsetContainer elevation={0}>
					<LabelWrapper>
						<LabelText variant="subtitle2">
							<FontAwesomeIcon icon={faGear} style={{ marginRight: "10px" }} />
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
										agentId: selectedAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) => ({
										...prev,
										stop: [],
									}));

									// Also refresh the agent data
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
								agentId: selectedAgent.id,
								update,
							});
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
								agentId: selectedAgent.id,
								update,
							});

							// Update local state immediately
							setLocalAgent((prev) => ({
								...prev,
								frequency_penalty: value,
							}));

							// Also refresh the agent data
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
								agentId: selectedAgent.id,
								update,
							});
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
								agentId: selectedAgent.id,
								update,
							});

							// Update local state immediately
							setLocalAgent((prev) => ({
								...prev,
								presence_penalty: value,
							}));

							// Also refresh the agent data
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
								agentId: selectedAgent.id,
								update,
							});
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
			)}

			{localAgent.seed === null ? (
				<UnsetContainer elevation={0}>
					<LabelWrapper>
						<LabelText variant="subtitle2">
							<FontAwesomeIcon icon={faGear} style={{ marginRight: "10px" }} />
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
										agentId: selectedAgent.id,
										update,
									});

									// Update local state immediately
									setLocalAgent((prev) => ({
										...prev,
										seed: 42,
									}));

									// Also refresh the agent data
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
								agentId: selectedAgent.id,
								update,
							});
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
			)}
		</Box>
	);
};
