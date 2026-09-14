/**
 * Model & Hosting Section Component
 *
 * Displays and manages model and hosting provider settings
 */

import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import { HostingSelect, ModelSelect } from "@shared/components/hosting";
import { Button, Tooltip } from "@shared/components/ui";
import type { UseMutationResult } from "@tanstack/react-query";
import { Info, Server } from "lucide-react";
import type { FC } from "react";
import { updateAgentSetting } from "../utils/chat-options-utils";

type ModelHostingSectionProps = {
	/**
	 * Agent data
	 */
	agent: AgentDetails;

	/**
	 * Currently saving field
	 */
	savingField: string | null;

	/**
	 * Function to set the currently saving field
	 */
	setSavingField: React.Dispatch<React.SetStateAction<string | null>>;

	/**
	 * Function to update local agent state
	 */
	setLocalAgent: React.Dispatch<React.SetStateAction<AgentDetails | null>>;

	/**
	 * Function to refetch agent data
	 */
	refetchAgent?: () => Promise<unknown>;

	/**
	 * Update agent mutation
	 */
	updateAgentMutation: UseMutationResult<
		AgentDetails | undefined,
		Error,
		{ agentId: string; update: AgentUpdate },
		unknown
	>;
};

/**
 * Model & Hosting Section Component
 *
 * Displays and manages model and hosting provider settings
 */
export const ModelHostingSection: FC<ModelHostingSectionProps> = ({
	agent,
	savingField,
	setSavingField,
	setLocalAgent,
	refetchAgent,
	updateAgentMutation,
}) => {
	return (
		<>
			<h3 className="mt-6 mb-4 flex items-center font-semibold text-heading text-ink">
				<span className="mr-2 flex items-center rounded-sm bg-accent-wash p-1 text-accent">
					<Server size={16} aria-hidden="true" />
				</span>
				Model and hosting
				<Tooltip content="Configure which model and hosting provider to use">
					<Button
						variant="ghost"
						size="icon-sm"
						type="button"
						className="ml-1 text-accent"
						aria-label="More info"
					>
						<Info aria-hidden="true" />
					</Button>
				</Tooltip>
			</h3>

			{/* `gap-4`, not child margins: `SearchableSelect` no longer ships an
			    outer margin, because the container owns the gap. */}
			<div className="mb-4 flex flex-col gap-4 rounded-md border border-hairline bg-sunken p-4">
				<HostingSelect
					value={agent.hosting || ""}
					isSaving={savingField === "hosting"}
					onSave={async (value) => {
						await updateAgentSetting(
							"hosting",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>

				<ModelSelect
					value={agent.model || ""}
					hostingId={agent.hosting || ""}
					isSaving={savingField === "model"}
					onSave={async (value) => {
						await updateAgentSetting(
							"model",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			</div>
		</>
	);
};
