/**
 * Security Settings Component
 *
 * Component for displaying and editing security settings
 */

import { faInfoCircle, faShieldAlt } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, IconButton, Tooltip, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import type { useUpdateAgent } from "@shared/hooks/use-update-agent";
import type { FC } from "react";

type SecuritySettingsProps = {
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
 * Security Settings Component
 *
 * Component for displaying and editing security settings
 */
export const SecuritySettings: FC<SecuritySettingsProps> = ({
	selectedAgent,
	savingField,
	setSavingField,
	updateAgentMutation,
	refetchAgent,
	initialSelectedAgentId,
}) => {
	return (
		<Box data-tour-tag="agent-settings-security" sx={{ mt: 4 }}>
			<SectionTitle variant="subtitle1">
				<TitleIcon icon={faShieldAlt} />
				Security Instructions
				{/* @ts-ignore - Tooltip has issues with TypeScript but works fine */}
				<Tooltip
					title={`Security instructions that guide the agent's behavior and limitations.  This is the "system prompt" for the security agent.`}
					arrow
					placement="top"
				>
					<InfoButton size="small">
						<FontAwesomeIcon icon={faInfoCircle} size="xs" />
					</InfoButton>
				</Tooltip>
			</SectionTitle>

      <Typography
				variant="caption"
				color="text.secondary"
				sx={{ mb: 1, display: "block" }}
			>
				This prompt is directed to the AI security reviewer. It helps the
				reviewer decide whether to block or allow actions based on safety.  Write as if talking to another agent that is watching this agent (eg. "Allow all git operations", "Don't let the agent access drive files in the restricted folder").  Update this to allow the agent to perform actions if you are getting frequent security blocks.
			</Typography>

			<EditableField
				value={selectedAgent.security_prompt || ""}
				label=""
				placeholder="Enter instructions for the security agent..."
				multiline
				rows={6}
				isSaving={savingField === "security_prompt"}
				onSave={async (value) => {
					setSavingField("security_prompt");
					try {
						const update: AgentUpdate = { security_prompt: value };
						await updateAgentMutation.mutateAsync({
							agentId: selectedAgent.id,
							update,
						});
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
		</Box>
	);
};
