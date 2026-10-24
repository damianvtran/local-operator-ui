/**
 * Generation Settings Section Component
 *
 * Displays and manages generation settings for the agent
 */

import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import { SliderSetting } from "@shared/components/common/slider-setting";
import { Button, Tooltip } from "@shared/components/ui";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { showErrorToast } from "@shared/utils/toast-manager";
import type { UseMutationResult } from "@tanstack/react-query";
import { Info, Settings, SlidersHorizontal } from "lucide-react";
import type { FC } from "react";
import { t } from "../../../../../i18n/messages";
import { updateAgentSetting } from "../utils/chat-options-utils";
import { UnsetSliderSetting } from "./unset-slider-setting";
import { UnsetTextSetting } from "./unset-text-setting";

type GenerationSettingsSectionProps = {
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
 * Generation Settings Section Component
 *
 * Displays and manages generation settings for the agent
 */
export const GenerationSettingsSection: FC<GenerationSettingsSectionProps> = ({
	agent,
	savingField,
	setSavingField,
	setLocalAgent,
	refetchAgent,
	updateAgentMutation,
}) => {
	useI18nLocale();
	return (
		/*
		 * `gap-4` on the container, not margins on the rows: `SliderSetting`,
		 * `EditableField` and `UnsetSliderSetting` no longer ship an outer margin
		 * of their own, because a component that does cannot be composed — it
		 * stacks with whatever gap its parent sets.
		 */
		<div className="flex flex-col gap-4 pt-6">
			<div>
				<h3 className="flex items-center font-semibold text-heading text-ink">
					<span className="mr-2 flex items-center rounded-sm bg-accent-wash p-1 text-accent">
						<SlidersHorizontal size={16} aria-hidden="true" />
					</span>
					{t("ui.chat.options.generation_settings_section.generation_settings")}
					<Tooltip
						content={t(
							"ui.chat.options.generation_settings_section.settings_that_control_how_the_agent_generates_responses",
						)}
					>
						<Button
							variant="ghost"
							size="icon-sm"
							type="button"
							className="ml-1 text-accent"
							aria-label={t(
								"ui.chat.options.generation_settings_section.more_info",
							)}
						>
							<Info aria-hidden="true" />
						</Button>
					</Tooltip>
				</h3>

				<p className="mt-1 text-body-sm text-ink-muted">
					{t(
						"ui.chat.options.generation_settings_section.you_can_set_custom_values_for_these_settings_by_updating",
					)}
				</p>
			</div>

			{/* Temperature Setting */}
			{agent.temperature === null ? (
				<UnsetSliderSetting
					label={t("ui.chat.options.generation_settings_section.temperature")}
					description={t(
						"ui.chat.options.generation_settings_section.controls_randomness_in_responses_0_0_1_0_higher_values",
					)}
					defaultValue={0.2}
					onSetValue={async (value) => {
						await updateAgentSetting(
							"temperature",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			) : (
				<SliderSetting
					value={agent.temperature ?? 0.2}
					label={t("ui.chat.options.generation_settings_section.temperature")}
					description={t(
						"ui.chat.options.generation_settings_section.controls_randomness_in_responses_0_0_1_0_higher_values",
					)}
					min={0}
					max={1}
					step={0.01}
					isSaving={savingField === "temperature"}
					onChange={async (value) => {
						await updateAgentSetting(
							"temperature",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			)}

			{/* Top P Setting */}
			{agent.top_p === null ? (
				<UnsetSliderSetting
					label={t("ui.chat.options.generation_settings_section.top_p")}
					description={t(
						"ui.chat.options.generation_settings_section.controls_cumulative_probability_of_tokens_to_sample_from_0_0",
					)}
					defaultValue={0.9}
					onSetValue={async (value) => {
						await updateAgentSetting(
							"top_p",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			) : (
				<SliderSetting
					value={agent.top_p ?? 0.9}
					label={t("ui.chat.options.generation_settings_section.top_p")}
					description={t(
						"ui.chat.options.generation_settings_section.controls_cumulative_probability_of_tokens_to_sample_from_0_0",
					)}
					min={0}
					max={1}
					step={0.01}
					isSaving={savingField === "top_p"}
					onChange={async (value) => {
						await updateAgentSetting(
							"top_p",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			)}

			{/* Top K Setting */}
			{agent.top_k === null ? (
				<UnsetSliderSetting
					label={t("ui.chat.options.generation_settings_section.top_k")}
					description={t(
						"ui.chat.options.generation_settings_section.limits_tokens_to_sample_from_at_each_step",
					)}
					defaultValue={40}
					onSetValue={async (value) => {
						await updateAgentSetting(
							"top_k",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			) : (
				<SliderSetting
					value={agent.top_k ?? 40}
					label={t("ui.chat.options.generation_settings_section.top_k")}
					description={t(
						"ui.chat.options.generation_settings_section.limits_tokens_to_sample_from_at_each_step",
					)}
					min={1}
					max={100}
					step={1}
					isSaving={savingField === "top_k"}
					onChange={async (value) => {
						await updateAgentSetting(
							"top_k",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			)}

			{/* Max Tokens Setting */}
			{agent.max_tokens === null ? (
				<UnsetSliderSetting
					label={t("ui.chat.options.generation_settings_section.max_tokens")}
					description={t(
						"ui.chat.options.generation_settings_section.maximum_tokens_to_generate_in_response",
					)}
					defaultValue={4096}
					onSetValue={async (value) => {
						await updateAgentSetting(
							"max_tokens",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			) : (
				<SliderSetting
					value={agent.max_tokens ?? 4096}
					label={t("ui.chat.options.generation_settings_section.max_tokens")}
					description={t(
						"ui.chat.options.generation_settings_section.maximum_tokens_to_generate_in_response",
					)}
					min={1}
					max={8192}
					step={1}
					isSaving={savingField === "max_tokens"}
					onChange={async (value) => {
						await updateAgentSetting(
							"max_tokens",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			)}

			{/* Stop Sequences Setting */}
			{agent.stop === null ? (
				<UnsetTextSetting
					label={t(
						"ui.chat.options.generation_settings_section.stop_sequences",
					)}
					description={t(
						"ui.chat.options.generation_settings_section.sequences_that_will_cause_the_model_to_stop_generating_text",
					)}
					defaultValue={[]}
					defaultDisplayText="empty"
					icon={<Settings size={16} className="mr-2.5" aria-hidden="true" />}
					onSetValue={async () => {
						await updateAgentSetting(
							"stop",
							[],
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			) : (
				<EditableField
					value={agent.stop?.join("\n") || ""}
					label={t(
						"ui.chat.options.generation_settings_section.stop_sequences",
					)}
					placeholder={t(
						"ui.chat.options.generation_settings_section.enter_stop_sequences_one_per_line",
					)}
					icon={<Settings size={16} />}
					multiline
					rows={3}
					isSaving={savingField === "stop"}
					onSave={async (value) => {
						// Split by newlines and filter out empty lines
						const stopSequences = value
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line.length > 0);

						await updateAgentSetting(
							"stop",
							stopSequences.length > 0 ? stopSequences : undefined,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			)}

			{/* Frequency Penalty Setting */}
			{agent.frequency_penalty === null ? (
				<UnsetSliderSetting
					label={t(
						"ui.chat.options.generation_settings_section.frequency_penalty",
					)}
					description={t(
						"ui.chat.options.generation_settings_section.reduces_repetition_by_lowering_likelihood_of_repeated_tokens_2_0",
					)}
					defaultValue={0}
					onSetValue={async (value) => {
						await updateAgentSetting(
							"frequency_penalty",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			) : (
				<SliderSetting
					value={agent.frequency_penalty ?? 0}
					label={t(
						"ui.chat.options.generation_settings_section.frequency_penalty",
					)}
					description={t(
						"ui.chat.options.generation_settings_section.reduces_repetition_by_lowering_likelihood_of_repeated_tokens_2_0",
					)}
					min={-2}
					max={2}
					step={0.01}
					isSaving={savingField === "frequency_penalty"}
					onChange={async (value) => {
						await updateAgentSetting(
							"frequency_penalty",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			)}

			{/* Presence Penalty Setting */}
			{agent.presence_penalty === null ? (
				<UnsetSliderSetting
					label={t(
						"ui.chat.options.generation_settings_section.presence_penalty",
					)}
					description={t(
						"ui.chat.options.generation_settings_section.increases_diversity_by_lowering_likelihood_of_prompt_tokens_2_0",
					)}
					defaultValue={0}
					onSetValue={async (value) => {
						await updateAgentSetting(
							"presence_penalty",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			) : (
				<SliderSetting
					value={agent.presence_penalty ?? 0}
					label={t(
						"ui.chat.options.generation_settings_section.presence_penalty",
					)}
					description={t(
						"ui.chat.options.generation_settings_section.increases_diversity_by_lowering_likelihood_of_prompt_tokens_2_0",
					)}
					min={-2}
					max={2}
					step={0.01}
					isSaving={savingField === "presence_penalty"}
					onChange={async (value) => {
						await updateAgentSetting(
							"presence_penalty",
							value,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			)}

			{/* Seed Setting */}
			{agent.seed === null ? (
				<UnsetTextSetting
					label={t("ui.chat.options.generation_settings_section.seed")}
					description={t(
						"ui.chat.options.generation_settings_section.random_number_seed_for_deterministic_generation",
					)}
					defaultValue={42}
					defaultDisplayText="42"
					icon={<Settings size={16} className="mr-2.5" aria-hidden="true" />}
					onSetValue={async () => {
						await updateAgentSetting(
							"seed",
							42,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			) : (
				<EditableField
					value={agent.seed?.toString() || ""}
					label={t("ui.chat.options.generation_settings_section.seed")}
					placeholder={t(
						"ui.chat.options.generation_settings_section.random_number_seed_for_deterministic_generation",
					)}
					icon={<Settings size={16} />}
					isSaving={savingField === "seed"}
					onSave={async (value) => {
						const seedValue = value.trim()
							? Number.parseInt(value, 10)
							: undefined;

						// Validate that the seed is a valid number if provided
						if (value.trim() && Number.isNaN(seedValue as number)) {
							showErrorToast(
								t(
									"ui.chat.options.generation_settings_section.seed_must_be_a_valid_number",
								),
							);
							return;
						}

						await updateAgentSetting(
							"seed",
							seedValue,
							agent.id,
							updateAgentMutation,
							setLocalAgent,
							refetchAgent,
							setSavingField,
						);
					}}
				/>
			)}
		</div>
	);
};
