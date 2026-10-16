/**
 * Security Settings Component
 *
 * Component for displaying and editing security settings
 */

import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import { Button, Tooltip } from "@shared/components/ui";
import type { useUpdateAgent } from "@shared/hooks/use-update-agent";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Info, Shield } from "lucide-react";
import type { FC } from "react";
import { t } from "../../../../../i18n/messages";

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
	// Subscribe without remounting: language changes must not discard unsaved fields.
	useI18nLocale();
	return (
		/*
		 * No top margin here: the settings shell owns the gap between panes, so a
		 * margin on the pane itself would stack with it and only on this one pane.
		 * The tour matches this tag by value, so it must survive verbatim.
		 */
		<div data-tour-tag="agent-settings-security">
			<h2 className="flex items-center gap-2 text-heading text-ink">
				<Shield size={16} className="shrink-0 text-ink-dim" />
				{t("ui.agents.settings.security.security_instructions")}
				{/*
				 * A real button rather than a bare icon: the tooltip is keyboard
				 * reachable only if its trigger can take focus.
				 */}
				<Tooltip
					content={t(
						"ui.agents.settings.security.security_instructions_that_guide_the_agent_s",
					)}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t(
							"ui.agents.settings.security.about_security_instructions",
						)}
					>
						<Info />
					</Button>
				</Tooltip>
			</h2>

			<p className="mt-1 max-w-2xl text-body-sm text-ink-muted">
				{t("ui.agents.settings.security.this_prompt_is_directed_to_the_ai")}
			</p>

			<div className="mt-4">
				<EditableField
					value={selectedAgent.security_prompt || ""}
					label=""
					placeholder={t(
						"ui.agents.settings.security.enter_instructions_for_the_security_agent",
					)}
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
