/**
 * System Prompt Settings Component
 *
 * Component for displaying and editing agent system prompt settings
 */

import { faInfoCircle, faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, IconButton, Tooltip, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import {
	useAgentSystemPrompt,
	useUpdateAgentSystemPrompt,
} from "@shared/hooks/use-agent-system-prompt";
import type { FC } from "react";
import { useEffect, useState } from "react";

type SystemPromptSettingsProps = {
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
	backgroundColor: alpha(theme.palette.primary.main, 0.1),
}));

const InfoButton = styled(IconButton)(({ theme }) => ({
	marginLeft: theme.spacing(1),
	color: theme.palette.primary.main,
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.08),
	},
}));

/**
 * System Prompt Settings Component
 *
 * Component for displaying and editing agent system prompt settings
 */
export const SystemPromptSettings: FC<SystemPromptSettingsProps> = ({
	selectedAgent,
	savingField,
	setSavingField,
	refetchAgent,
	initialSelectedAgentId,
}) => {
	const { data: systemPrompt, isLoading } = useAgentSystemPrompt(
		selectedAgent.id,
	);
	const updateSystemPromptMutation = useUpdateAgentSystemPrompt(
		selectedAgent.id,
	);
	const [localSystemPrompt, setLocalSystemPrompt] = useState<string>("");

	// Update local state when the system prompt data changes
	useEffect(() => {
		if (systemPrompt !== undefined) {
			setLocalSystemPrompt(systemPrompt);
		}
	}, [systemPrompt]);

	return (
		<Box data-tour-tag="agent-settings-system-prompt" sx={{ mt: 4 }}>
			<SectionTitle variant="subtitle1">
				<TitleIcon icon={faRobot} />
				System Prompt
				{/* @ts-ignore - Tooltip has issues with TypeScript but works fine */}
				<Tooltip
					title="System instructions that define the agent's behavior and capabilities"
					arrow
					placement="top"
				>
					<InfoButton size="small">
						<FontAwesomeIcon icon={faInfoCircle} size="xs" />
					</InfoButton>
				</Tooltip>
			</SectionTitle>

			<EditableField
				value={localSystemPrompt}
				label=""
				placeholder={
					isLoading ? "Loading system prompt..." : "Enter system prompt..."
				}
				multiline
				rows={6}
				isSaving={savingField === "system_prompt"}
				onSave={async (value) => {
					setSavingField("system_prompt");
					try {
						await updateSystemPromptMutation.mutateAsync(value);
						// Explicitly refetch the agent data to update the UI
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
			<Typography
				variant="caption"
				color="text.secondary"
				sx={{ mt: 1, display: "block" }}
			>
				Define the agent's role, personality, or provide context. Write as if
				talking to the agent (e.g., "You are an expert researcher") and/or about
				yourself (e.g., "My name is John").
			</Typography>
		</Box>
	);
};
