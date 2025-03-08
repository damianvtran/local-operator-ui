/**
 * Chat Options Sidebar Component
 *
 * An expandable sidebar that displays and allows editing of chat settings
 * for the currently selected agent.
 */

import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Drawer, Typography } from "@mui/material";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { useAgent } from "@renderer/hooks/use-agents";
import { useUpdateAgent } from "@renderer/hooks/use-update-agent";
import type { FC } from "react";
import { useEffect, useState } from "react";
import {
	CloseButton,
	HeaderTitle,
	SidebarContainer,
	SidebarContent,
	SidebarHeader,
} from "./chat-options-sidebar-styled";
import { GenerationSettingsSection } from "./generation-settings-section";
import { ModelHostingSection } from "./model-hosting-section";

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
						<FontAwesomeIcon icon={faTimes} size="xs" />
					</CloseButton>
				</SidebarHeader>

				<SidebarContent>
					{/* Model and Hosting Section */}
					<ModelHostingSection
						agent={localAgent}
						savingField={savingField}
						setSavingField={setSavingField}
						setLocalAgent={setLocalAgent}
						refetchAgent={refetchAgent}
						updateAgentMutation={updateAgentMutation}
					/>

					{/* Generation Settings Section */}
					<GenerationSettingsSection
						agent={localAgent}
						savingField={savingField}
						setSavingField={setSavingField}
						setLocalAgent={setLocalAgent}
						refetchAgent={refetchAgent}
						updateAgentMutation={updateAgentMutation}
					/>
				</SidebarContent>
			</SidebarContainer>
		</Drawer>
	);
};
