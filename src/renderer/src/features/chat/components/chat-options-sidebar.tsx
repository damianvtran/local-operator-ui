/**
 * Chat Options Sidebar Component
 *
 * Displays the chat options and settings for the current agent.
 */

import type { AgentDetails } from "@shared/api/local-operator/types";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import {
	Button,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@shared/components/ui";
import { useAgent } from "@shared/hooks/use-agents";
import { useClearAgentConversation } from "@shared/hooks/use-clear-agent-conversation";
import { useUpdateAgent } from "@shared/hooks/use-update-agent";
import { Trash2, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
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
		<div>
			<Button
				variant="danger"
				className="mb-4 mt-6 w-full"
				onClick={() => setIsConfirmationOpen(true)}
			>
				<Trash2 size={16} aria-hidden="true" />
				Clear conversation
			</Button>

			<ConfirmationModal
				open={isConfirmationOpen}
				title="Clear conversation"
				message="This permanently deletes every message in this conversation. It cannot be undone."
				confirmText="Clear"
				cancelText="Cancel"
				isDangerous
				onConfirm={handleClearConversation}
				onCancel={() => setIsConfirmationOpen(false)}
			/>
		</div>
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
		<Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
			<SheetContent
				side="right"
				showClose={false}
				className="w-[380px] max-w-[380px] gap-0 bg-surface p-0"
			>
				<div className="flex items-center justify-between border-hairline border-b px-6 py-4">
					<div className="flex flex-col gap-0.5">
						<SheetTitle className="font-semibold text-heading text-ink">
							Chat Options
						</SheetTitle>
						<SheetDescription className="text-body-sm text-ink-muted">
							Customize settings for this agent
						</SheetDescription>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={onClose}
						aria-label="Close"
					>
						<X size={14} aria-hidden="true" />
					</Button>
				</div>

				<div className="grow overflow-y-auto px-6 py-4">
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
				</div>
			</SheetContent>
		</Sheet>
	);
};
