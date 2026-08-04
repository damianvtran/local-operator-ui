/**
 * System Prompt Settings Component
 *
 * Component for displaying and editing agent system prompt settings
 */

import type { AgentDetails } from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import { Button, Tooltip } from "@shared/components/ui";
import {
	useAgentSystemPrompt,
	useUpdateAgentSystemPrompt,
} from "@shared/hooks/use-agent-system-prompt";
import { Bot, Info } from "lucide-react";
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
		/*
		 * No margin here: the settings shell owns the gap between panes, so a
		 * margin on the pane itself would stack with it. The tour matches this tag
		 * by value, so it must survive verbatim.
		 */
		<div data-tour-tag="agent-settings-system-prompt">
			<h2 className="flex items-center gap-2 text-heading text-ink">
				<Bot size={16} className="shrink-0 text-ink-dim" />
				Agent instructions
				{/*
				 * A real button rather than a bare icon: the tooltip is keyboard
				 * reachable only if its trigger can take focus.
				 */}
				<Tooltip
					content={`System instructions that define the agent's behavior and capabilities. This is the agent's "system prompt".`}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="About agent instructions"
					>
						<Info />
					</Button>
				</Tooltip>
			</h2>

			<p className="mt-1 max-w-2xl text-body-sm text-ink-muted">
				Define the agent's role, personality, or provide context. Write as if
				talking to the agent (e.g., "You are an expert researcher") and/or about
				yourself (e.g., "My name is John").
			</p>

			<div className="mt-4">
				<EditableField
					value={localSystemPrompt}
					label=""
					placeholder={
						isLoading
							? "Loading system prompt..."
							: "Enter instructions for the agent..."
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
						} catch {
							// Error is already handled in the mutation
						} finally {
							setSavingField(null);
						}
					}}
				/>
			</div>
		</div>
	);
};
