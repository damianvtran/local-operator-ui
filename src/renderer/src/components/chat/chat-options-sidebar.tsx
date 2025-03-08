/**
 * Chat Options Sidebar Component
 *
 * An expandable sidebar that displays and allows editing of chat settings
 * for the currently selected agent.
 */

import { faTimes, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Button, Drawer, Typography, alpha, styled } from "@mui/material";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { useAgent } from "@renderer/hooks/use-agents";
import { useClearAgentConversation } from "@renderer/hooks/use-clear-agent-conversation";
import { useUpdateAgent } from "@renderer/hooks/use-update-agent";
import type { FC } from "react";
import { useEffect, useState } from "react";
import { ConfirmationModal } from "../common/confirmation-modal";
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
 * Styled component for the clear conversation button
 */
const ClearConversationButton = styled(Button)(({ theme }) => ({
	backgroundColor: theme.palette.error.main,
	color: theme.palette.error.contrastText,
	marginTop: theme.spacing(3),
	marginBottom: theme.spacing(2),
	borderRadius: theme.shape.borderRadius,
	textTransform: "none",
	fontWeight: 500,
	"&:hover": {
		backgroundColor: theme.palette.error.dark,
		boxShadow: `0 4px 12px ${alpha(theme.palette.error.main, 0.4)}`,
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Clear Conversation Section Component
 *
 * Displays a button to clear the conversation history and a confirmation dialog
 */
const ClearConversationSection: FC<{
	agentId: string;
}> = ({ agentId }) => {
	const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
	const clearConversationMutation = useClearAgentConversation();

	const handleClearConversation = () => {
		clearConversationMutation.mutate({ agentId });
		setIsConfirmationOpen(false);
	};

	return (
		<Box>
			<ClearConversationButton
				fullWidth
				startIcon={<FontAwesomeIcon icon={faTrash} />}
				onClick={() => setIsConfirmationOpen(true)}
			>
				Clear Conversation
			</ClearConversationButton>

			<ConfirmationModal
				open={isConfirmationOpen}
				title="Clear Conversation"
				message="Are you sure you want to clear this conversation? This action cannot be undone and all messages will be permanently deleted."
				confirmText="Clear"
				cancelText="Cancel"
				isDangerous
				onConfirm={handleClearConversation}
				onCancel={() => setIsConfirmationOpen(false)}
			/>
		</Box>
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

					{/* Clear Conversation Section */}
					{agentId && <ClearConversationSection agentId={agentId} />}
				</SidebarContent>
			</SidebarContainer>
		</Drawer>
	);
};
