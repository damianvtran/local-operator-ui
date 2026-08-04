import type { AgentDetails } from "@shared/api/local-operator/types";
import { Card } from "@shared/components/ui";
import { useUpdateAgent } from "@shared/hooks/use-update-agent";
import { ArrowLeft, Bot } from "lucide-react";
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
 * The agent details pane: the one boundary around the four settings panes.
 *
 * The panes themselves are borderless, so this card is the only edge in view
 * and the 32px section gap below is what separates one pane from the next.
 * Wrapping each pane in its own card would put a boundary inside a boundary
 * and say nothing the outer one already says (branding § 5).
 *
 * Two structural details worth keeping:
 *
 * - It must stay a `div`. The onboarding tour matches
 *   `div[data-tour-tag="agent-settings-details-paper"]` with the element name
 *   in the selector, so replacing it with a `section` breaks the tour silently.
 *   `Card` renders a `div`, which is why it is used here rather than hand-rolled
 *   markup that could drift.
 * - The padding sits on this element and the scroll lives on the child, so the
 *   pane's inset stays put instead of scrolling away with the content.
 */
export const AgentSettings: FC<AgentSettingsProps> = ({
	selectedAgent,
	refetchAgent,
	initialSelectedAgentId,
}) => {
	const [savingField, setSavingField] = useState<string | null>(null);
	const updateAgentMutation = useUpdateAgent();

	return (
		<Card
			data-tour-tag="agent-settings-details-paper"
			padding="none"
			className="h-full overflow-hidden p-6"
		>
			{selectedAgent ? (
				<div className="flex h-full flex-col gap-8 overflow-auto">
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
			) : (
				<div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
					{/* The glyph is scenery, so it stays ink; the accent is spent once,
					    on the one thing here that tells you what to do next. */}
					<Bot size={48} className="text-ink-dim" aria-hidden="true" />
					<h2 className="text-heading text-ink">No agent selected</h2>
					<p className="max-w-md text-body-sm text-ink-muted">
						Select an agent from the list to view its configuration and details
					</p>
					<div className="mt-2 flex items-center gap-2 text-accent">
						<ArrowLeft size={16} aria-hidden="true" />
						<span className="text-body-sm">Select an agent</span>
					</div>
				</div>
			)}
		</Card>
	);
};
