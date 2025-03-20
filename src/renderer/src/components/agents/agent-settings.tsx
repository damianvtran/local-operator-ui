/**
 * Agent Settings Component
 *
 * Component for displaying and editing agent settings
 */

import { faArrowLeft, faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Paper, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { useUpdateAgent } from "@renderer/hooks/use-update-agent";
import { useState } from "react";
import type { FC } from "react";
import { ChatSettings } from "./chat-settings";
import { GeneralSettings } from "./general-settings";
import { SecuritySettings } from "./security-settings";
import { SystemPromptSettings } from "./system-prompt-settings";

type AgentSettingsProps = {
	/**
	 * The selected agent to display settings for
	 */
	selectedAgent: AgentDetails | null;

	/**
	 * Function to refetch agent data after updates
	 */
	refetchAgent?: () => Promise<unknown>;

	/**
	 * Initial selected agent ID
	 */
	initialSelectedAgentId?: string;
};

const DetailsPaper = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(4),
	height: "100%",
	borderRadius: 8,
	backgroundColor: theme.palette.background.default,
	display: "flex",
	flexDirection: "column",
	transition: "all 0.25s ease",
	boxShadow:
		theme.palette.mode === "dark"
			? "0 4px 20px rgba(0,0,0,0.15)"
			: "0 4px 20px rgba(0,0,0,0.06)",
	"&:hover": {
		boxShadow:
			theme.palette.mode === "dark"
				? "0 8px 30px rgba(0,0,0,0.2)"
				: "0 8px 30px rgba(0,0,0,0.08)",
	},
	overflow: "hidden",
}));

const ScrollableContent = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	height: "100%",
	overflow: "auto",
	"&::-webkit-scrollbar": {
		width: "6px",
	},
	"&::-webkit-scrollbar-track": {
		backgroundColor: "transparent",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.1)"
				: "rgba(0, 0, 0, 0.1)",
		borderRadius: "10px",
		"&:hover": {
			backgroundColor:
				theme.palette.mode === "dark"
					? "rgba(255, 255, 255, 0.2)"
					: "rgba(0, 0, 0, 0.2)",
		},
	},
}));

const EmptyStateContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	flexGrow: 1,
	padding: theme.spacing(4),
	background: `linear-gradient(180deg, ${alpha(theme.palette.background.default, 0)} 0%, ${alpha(theme.palette.background.paper, 0.05)} 100%)`,
	borderRadius: 16,
}));

const PlaceholderIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	fontSize: "3rem",
	marginBottom: "1rem",
	opacity: 0.5,
	color: theme.palette.text.secondary,
}));

const DirectionIndicator = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	color: theme.palette.primary.main,
	opacity: 0.7,
}));

/**
 * Agent Settings Component
 *
 * Component for displaying and editing agent settings
 */
export const AgentSettings: FC<AgentSettingsProps> = ({
	selectedAgent,
	refetchAgent,
	initialSelectedAgentId,
}) => {
	const [savingField, setSavingField] = useState<string | null>(null);
	const updateAgentMutation = useUpdateAgent();

	return (
		<DetailsPaper>
			{selectedAgent ? (
				<ScrollableContent>
					<GeneralSettings
						selectedAgent={selectedAgent}
						savingField={savingField}
						setSavingField={setSavingField}
						updateAgentMutation={updateAgentMutation}
						refetchAgent={refetchAgent}
						initialSelectedAgentId={initialSelectedAgentId}
					/>

					<ChatSettings
						selectedAgent={selectedAgent}
						savingField={savingField}
						setSavingField={setSavingField}
						updateAgentMutation={updateAgentMutation}
						refetchAgent={refetchAgent}
						initialSelectedAgentId={initialSelectedAgentId}
					/>

					<SecuritySettings
						selectedAgent={selectedAgent}
						savingField={savingField}
						setSavingField={setSavingField}
						updateAgentMutation={updateAgentMutation}
						refetchAgent={refetchAgent}
						initialSelectedAgentId={initialSelectedAgentId}
					/>

					<SystemPromptSettings
						selectedAgent={selectedAgent}
						savingField={savingField}
						setSavingField={setSavingField}
						refetchAgent={refetchAgent}
						initialSelectedAgentId={initialSelectedAgentId}
					/>
				</ScrollableContent>
			) : (
				<EmptyStateContainer>
					<PlaceholderIcon icon={faRobot} />
					<Typography variant="h6" sx={{ mb: 1, fontWeight: 500 }}>
						No Agent Selected
					</Typography>
					<Typography
						variant="body2"
						color="text.secondary"
						align="center"
						sx={{ mb: 2, maxWidth: 500 }}
					>
						Select an agent from the list to view its configuration and details
					</Typography>
					<DirectionIndicator>
						<FontAwesomeIcon
							icon={faArrowLeft}
							style={{ marginRight: "0.5rem" }}
						/>
						<Typography variant="body2">Select an Agent</Typography>
					</DirectionIndicator>
				</EmptyStateContainer>
			)}
		</DetailsPaper>
	);
};
