/**
 * Model & Hosting Section Component
 *
 * Displays and manages model and hosting provider settings
 */

import { faInfoCircle, faServer } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Tooltip } from "@mui/material";
import type {
	AgentDetails,
	AgentUpdate,
} from "@renderer/api/local-operator/types";
import { HostingSelect, ModelSelect } from "@renderer/components/hosting";
import type { UseMutationResult } from "@tanstack/react-query";
import type { FC } from "react";
import {
	InfoButton,
	SectionTitle,
	ModelHostingSection as StyledModelHostingSection,
	TitleIcon,
} from "./chat-options-sidebar-styled";
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
			<SectionTitle variant="subtitle1">
				<TitleIcon icon={faServer} />
				Model & Hosting
				{/* @ts-ignore - Tooltip has issues with TypeScript but works fine */}
				<Tooltip
					title="Configure which model and hosting provider to use"
					arrow
					placement="top"
				>
					<InfoButton size="small">
						<FontAwesomeIcon icon={faInfoCircle} size="xs" />
					</InfoButton>
				</Tooltip>
			</SectionTitle>

			<StyledModelHostingSection>
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
			</StyledModelHostingSection>
		</>
	);
};
