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
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Info, NotebookPen } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import { t } from "../../../../../i18n/messages";

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
	// Subscribe without remounting: language changes must not discard unsaved fields.
	useI18nLocale();
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
				<NotebookPen size={16} className="shrink-0 text-ink-dim" />
				{t("ui.agents.settings.system_prompt.agent_instructions")}
				{/*
				 * A real button rather than a bare icon: the tooltip is keyboard
				 * reachable only if its trigger can take focus.
				 */}
				<Tooltip
					content={t(
						"ui.agents.settings.system_prompt.system_instructions_that_define_the_agent_s",
					)}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t(
							"ui.agents.settings.system_prompt.about_agent_instructions",
						)}
					>
						<Info />
					</Button>
				</Tooltip>
			</h2>

			<p className="mt-1 max-w-2xl text-body-sm text-ink-muted">
				{t(
					"ui.agents.settings.system_prompt.define_the_agent_s_role_personality_or",
				)}
			</p>

			<div className="mt-4">
				<EditableField
					value={localSystemPrompt}
					label=""
					placeholder={
						isLoading
							? t("ui.agents.settings.system_prompt.loading_system_prompt")
							: t(
									"ui.agents.settings.system_prompt.enter_instructions_for_the_agent",
								)
					}
					multiline
					rows={6}
					isSaving={savingField === "system_prompt"}
					onSave={async (value) => {
						setSavingField("system_prompt");
						// A failure must PROPAGATE to `EditableField`, which reads a
						// resolved `onSave` as success: it exits edit mode and shows the
						// text as saved. Swallowing here (as this did) made a refused
						// prompt - the pre-flight's, or any 4xx - look saved while it was
						// never persisted, so the next refetch silently replaced the
						// user's edit with the old prompt. That is Q-7's own defect, a
						// refusal that retires the draft, one surface over (round 3, R2).
						// The toast stays the mutation's job; the rejection is what keeps
						// the editor open on the user's text.
						//
						// `finally` rather than a rethrowing `catch` because a catch that
						// only rethrows is a no-op that `noUselessCatch` rejects: this
						// clears the saving flag on both paths and leaves the rejection
						// untouched.
						try {
							await updateSystemPromptMutation.mutateAsync(value);
							// Explicitly refetch the agent data to update the UI
							if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
								await refetchAgent();
							}
						} finally {
							setSavingField(null);
						}
					}}
				/>
			</div>
		</div>
	);
};
