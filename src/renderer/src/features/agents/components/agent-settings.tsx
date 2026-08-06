import type { AgentDetails } from "@shared/api/local-operator/types";
import { useUpdateAgent } from "@shared/hooks/use-update-agent";
import { Bot } from "lucide-react";
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

/**
 * The agent details pane.
 *
 * ## Why it draws nothing
 *
 * It was a bordered `surface` card with 24px of padding, sitting inside a page
 * that already insets its content by 32px — a 56px double gutter, and a
 * boundary drawn around the whole right-hand pane when the pane is already
 * bounded by the window on one side and the agent list on the other. It also
 * meant the four settings panes rendered inside a box while the settings page's
 * identical panes render on the page, so the same content had two different
 * anatomies depending on the route.
 *
 * Now it is content on `canvas`, in a measured column, exactly like Settings.
 * The 32px gap between panes is what separates one from the next.
 *
 * Two structural details worth keeping:
 *
 * - It must stay a `div`. The onboarding tour matches
 *   `div[data-tour-tag="agent-settings-details-paper"]` with the element name
 *   in the selector, so replacing it with a `section` breaks the tour silently.
 * - The scroll lives on the inner element, so the column's measure and centring
 *   stay put instead of scrolling with the content.
 */
export const AgentSettings: FC<AgentSettingsProps> = ({
	selectedAgent,
	refetchAgent,
	initialSelectedAgentId,
}) => {
	const [savingField, setSavingField] = useState<string | null>(null);
	const updateAgentMutation = useUpdateAgent();

	return (
		<div
			data-tour-tag="agent-settings-details-paper"
			className="h-full overflow-hidden"
		>
			{selectedAgent ? (
				<div className="h-full overflow-y-auto">
					<div className="mx-auto flex w-full max-w-4xl flex-col gap-8 pb-8">
						<GeneralSettings
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

						<SecuritySettings
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
					</div>
				</div>
			) : (
				<div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
					{/* Scenery, so it stays ink. No accent anywhere in this state: the
					    only thing that could earn it is a control, and there is none
					    here — the list this points at is already on screen. */}
					<Bot size={48} className="text-ink-dim" aria-hidden="true" />
					<h2 className="text-heading text-ink">No agent selected</h2>
					<p className="max-w-md text-body-sm text-ink-muted">
						Select an agent from the list on the left to view its configuration
						and details.
					</p>
				</div>
			)}
		</div>
	);
};
