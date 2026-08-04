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
import { showErrorToast } from "@shared/utils/toast-manager";
import type { UseMutationResult } from "@tanstack/react-query";
import { Info, Settings, SlidersHorizontal } from "lucide-react";
import type { FC } from "react";
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
	return (
		<>
			<h3 className="mt-6 mb-4 flex items-center font-semibold text-heading text-ink">
				<span className="mr-2 flex items-center rounded-sm bg-accent-wash p-1 text-accent">
					<SlidersHorizontal size={16} aria-hidden="true" />
				</span>
				Generation settings
				<Tooltip content="Settings that control how the agent generates responses">
					<Button
						variant="ghost"
						size="icon-sm"
						type="button"
						className="ml-1 text-accent"
						aria-label="More info"
					>
						<Info size={12} aria-hidden="true" />
					</Button>
				</Tooltip>
			</h3>

			<div className="mb-4">
				<p className="mb-4 text-body-sm text-ink-muted">
					You can set custom values for these settings by updating the options
					below. If not set, default values will be used that are optimized
					based on user testing.
				</p>
			</div>

			{/* Temperature Setting */}
			{agent.temperature === null ? (
				<UnsetSliderSetting
					label="Temperature"
					description="Controls randomness in responses (0.0-1.0). Higher values make output more random."
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
					label="Temperature"
					description="Controls randomness in responses (0.0-1.0). Higher values make output more random."
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
					label="Top P"
					description="Controls cumulative probability of tokens to sample from (0.0-1.0)."
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
					label="Top P"
					description="Controls cumulative probability of tokens to sample from (0.0-1.0)."
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
					label="Top K"
					description="Limits tokens to sample from at each step."
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
					label="Top K"
					description="Limits tokens to sample from at each step."
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
					label="Max tokens"
					description="Maximum tokens to generate in response."
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
					label="Max tokens"
					description="Maximum tokens to generate in response."
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
					label="Stop sequences"
					description="Sequences that will cause the model to stop generating text."
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
					label="Stop sequences"
					placeholder="Enter stop sequences (one per line)..."
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
					label="Frequency penalty"
					description="Reduces repetition by lowering likelihood of repeated tokens (-2.0 to 2.0)."
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
					label="Frequency penalty"
					description="Reduces repetition by lowering likelihood of repeated tokens (-2.0 to 2.0)."
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
					label="Presence penalty"
					description="Increases diversity by lowering likelihood of prompt tokens (-2.0 to 2.0)."
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
					label="Presence penalty"
					description="Increases diversity by lowering likelihood of prompt tokens (-2.0 to 2.0)."
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
					label="Seed"
					description="Random number seed for deterministic generation."
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
					label="Seed"
					placeholder="Random number seed for deterministic generation"
					icon={<Settings size={16} />}
					isSaving={savingField === "seed"}
					onSave={async (value) => {
						const seedValue = value.trim()
							? Number.parseInt(value, 10)
							: undefined;

						// Validate that the seed is a valid number if provided
						if (value.trim() && Number.isNaN(seedValue as number)) {
							showErrorToast("Seed must be a valid number");
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
		</>
	);
};
