/**
 * Chat Settings Component
 *
 * Component for displaying and editing chat-specific agent settings
 */

import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import { SliderSetting } from "@shared/components/common/slider-setting";
import { Button, Tooltip } from "@shared/components/ui";
import type { useUpdateAgent } from "@shared/hooks/use-update-agent";
import { showErrorToast } from "@shared/utils/toast-manager";
import { ChevronDown, ChevronRight, Info, Settings } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useEffect, useId, useState } from "react";

type ChatSettingsProps = {
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
 * The value offered when a parameter has never been set.
 *
 * One table rather than a literal per call site: the number appears twice for
 * every parameter — in the button's label and in the update it sends — and the
 * two drifting apart is a lie the UI tells silently. The same numbers are also
 * the slider fallbacks, so a set-then-cleared parameter shows the same value
 * the button promised.
 */
const DEFAULTS = {
	temperature: 0.2,
	top_p: 0.9,
	top_k: 40,
	max_tokens: 4096,
	frequency_penalty: 0,
	presence_penalty: 0,
	seed: 42,
} as const;

type UnsetSettingProps = {
	label: string;
	description: string;
	/** Shown in the button: the default value, or a word for it ("empty"). */
	defaultLabel: string | number;
	onSet: () => Promise<void>;
};

/**
 * A parameter the agent has not overridden.
 *
 * This used to be a bordered panel — three separate copies of one, in fact —
 * sitting inside the bordered settings pane, so every unset row drew an edge
 * around a label and a button. The state reads perfectly well from the type
 * scale and the button's own copy, so the edge is gone: one boundary per
 * grouping, and a busy panel loses a border rather than gaining tighter
 * spacing (branding § 5).
 */
const UnsetSetting: FC<UnsetSettingProps> = ({
	label,
	description,
	defaultLabel,
	onSet,
}) => (
	<div className="flex items-start justify-between gap-4">
		<div className="min-w-0">
			<div className="flex items-baseline gap-2">
				<span className="text-body-sm text-ink">{label}</span>
				<span className="text-meta text-ink-dim">Not set yet</span>
			</div>
			<p className="mt-1 text-meta text-ink-dim">{description}</p>
		</div>
		<Button variant="secondary" size="sm" className="shrink-0" onClick={onSet}>
			Set to default ({defaultLabel})
		</Button>
	</div>
);

/**
 * A named run of related parameters.
 *
 * Eight controls in one flat column read as a wall, and the sliders each carry
 * their own explanation already; a quiet heading every few rows is cheaper
 * than a boundary and gives the eye somewhere to rest.
 */
const SettingGroup: FC<{ title: string; children: ReactNode }> = ({
	title,
	children,
}) => (
	<div className="flex flex-col gap-4">
		<h3 className="text-body-sm font-semibold text-ink-muted">{title}</h3>
		{children}
	</div>
);

/**
 * Chat Settings Component
 *
 * Component for displaying and editing chat-specific agent settings
 */
export const ChatSettings: FC<ChatSettingsProps> = ({
	selectedAgent,
	savingField,
	setSavingField,
	updateAgentMutation,
	refetchAgent,
	initialSelectedAgentId,
}) => {
	// Create a local copy of the agent data that we can update immediately
	const [localAgent, setLocalAgent] = useState<AgentDetails>(selectedAgent);

	// Update local agent when selectedAgent changes
	useEffect(() => {
		setLocalAgent(selectedAgent);
	}, [selectedAgent]);

	const [isExpanded, setIsExpanded] = useState(false);
	const contentId = useId();

	const Chevron = isExpanded ? ChevronDown : ChevronRight;

	return (
		/*
		 * No margin on the pane itself: the settings shell spaces its panes, so a
		 * margin here would stack with that gap and only under this one pane.
		 */
		<div>
			<h2 className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => setIsExpanded(!isExpanded)}
					aria-expanded={isExpanded}
					aria-controls={contentId}
					className="group flex items-center gap-2 py-1 text-left text-heading text-ink"
				>
					<Chevron
						size={16}
						aria-hidden="true"
						className="shrink-0 text-ink-dim transition-colors duration-fast ease-out-quart group-hover:text-ink"
					/>
					Advanced chat settings
				</button>
				{/*
				 * A real button rather than a bare icon: the tooltip is keyboard
				 * reachable only if its trigger can take focus. It sits beside the
				 * disclosure rather than inside it, because a button nested in a
				 * button is not markup a browser can resolve.
				 */}
				<Tooltip content="Advanced settings to change how the agent generates responses">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="About advanced chat settings"
					>
						<Info />
					</Button>
				</Tooltip>
			</h2>

			{/*
			 * Conditional render rather than a hidden subtree: the previous
			 * `Collapse` unmounted on exit, and the fields hold draft edit state
			 * that must not survive a close.
			 */}
			{isExpanded && (
				<div id={contentId} className="mt-3">
					<p className="max-w-2xl text-body-sm text-ink-muted">
						Set custom values for any of these options. Anything left unset uses
						a default optimized from user testing.
					</p>

					<div className="mt-6 flex flex-col gap-8">
						<SettingGroup title="Sampling">
							{localAgent.temperature === null ? (
								<UnsetSetting
									label="Temperature"
									description="Controls randomness in responses (0.0-1.0). Higher values make output more random."
									defaultLabel={DEFAULTS.temperature}
									onSet={async () => {
										setSavingField("temperature");
										try {
											const update: AgentUpdate = {
												temperature: DEFAULTS.temperature,
											};
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) => ({
												...prev,
												temperature: DEFAULTS.temperature,
											}));

											// Also refresh the agent data
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							) : (
								<SliderSetting
									value={localAgent.temperature ?? DEFAULTS.temperature}
									label="Temperature"
									description="Controls randomness in responses (0.0-1.0). Higher values make output more random."
									min={0}
									max={1}
									step={0.01}
									isSaving={savingField === "temperature"}
									onChange={async (value) => {
										setSavingField("temperature");
										try {
											const update: AgentUpdate = { temperature: value };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							)}

							{localAgent.top_p === null ? (
								<UnsetSetting
									label="Top P"
									description="Controls cumulative probability of tokens to sample from (0.0-1.0)."
									defaultLabel={DEFAULTS.top_p}
									onSet={async () => {
										setSavingField("top_p");
										try {
											const update: AgentUpdate = { top_p: DEFAULTS.top_p };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) => ({
												...prev,
												top_p: DEFAULTS.top_p,
											}));

											// Also refresh the agent data
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							) : (
								<SliderSetting
									value={localAgent.top_p ?? DEFAULTS.top_p}
									label="Top P"
									description="Controls cumulative probability of tokens to sample from (0.0-1.0)."
									min={0}
									max={1}
									step={0.01}
									isSaving={savingField === "top_p"}
									onChange={async (value) => {
										setSavingField("top_p");
										try {
											const update: AgentUpdate = { top_p: value };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							)}

							{localAgent.top_k === null ? (
								<UnsetSetting
									label="Top K"
									description="Limits tokens to sample from at each step."
									defaultLabel={DEFAULTS.top_k}
									onSet={async () => {
										setSavingField("top_k");
										try {
											const update: AgentUpdate = { top_k: DEFAULTS.top_k };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) => ({
												...prev,
												top_k: DEFAULTS.top_k,
											}));

											// Also refresh the agent data
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							) : (
								<SliderSetting
									value={localAgent.top_k ?? DEFAULTS.top_k}
									label="Top K"
									description="Limits tokens to sample from at each step."
									min={1}
									max={100}
									step={1}
									isSaving={savingField === "top_k"}
									onChange={async (value) => {
										setSavingField("top_k");
										try {
											const update: AgentUpdate = { top_k: value };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							)}

							{localAgent.seed === null ? (
								<UnsetSetting
									label="Seed"
									description="Random number seed for deterministic generation."
									defaultLabel={DEFAULTS.seed}
									onSet={async () => {
										setSavingField("seed");
										try {
											const update: AgentUpdate = { seed: DEFAULTS.seed };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) => ({
												...prev,
												seed: DEFAULTS.seed,
											}));

											// Also refresh the agent data
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							) : (
								<EditableField
									value={localAgent.seed?.toString() || ""}
									label="Seed"
									placeholder="Random number seed for deterministic generation"
									icon={<Settings size={16} />}
									isSaving={savingField === "seed"}
									onSave={async (value) => {
										setSavingField("seed");
										try {
											const seedValue = value.trim()
												? Number.parseInt(value, 10)
												: undefined;

											// Validate that the seed is a valid number if provided
											if (value.trim() && Number.isNaN(seedValue as number)) {
												showErrorToast("Seed must be a valid number");
												return;
											}

											const update: AgentUpdate = { seed: seedValue };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							)}
						</SettingGroup>

						<SettingGroup title="Repetition">
							{localAgent.frequency_penalty === null ? (
								<UnsetSetting
									label="Frequency penalty"
									description="Reduces repetition by lowering likelihood of repeated tokens (-2.0 to 2.0)."
									defaultLabel={DEFAULTS.frequency_penalty}
									onSet={async () => {
										setSavingField("frequency_penalty");
										try {
											const update: AgentUpdate = {
												frequency_penalty: DEFAULTS.frequency_penalty,
											};
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) => ({
												...prev,
												frequency_penalty: DEFAULTS.frequency_penalty,
											}));

											// Also refresh the agent data
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							) : (
								<SliderSetting
									value={
										localAgent.frequency_penalty ?? DEFAULTS.frequency_penalty
									}
									label="Frequency penalty"
									description="Reduces repetition by lowering likelihood of repeated tokens (-2.0 to 2.0)."
									min={-2}
									max={2}
									step={0.01}
									isSaving={savingField === "frequency_penalty"}
									onChange={async (value) => {
										setSavingField("frequency_penalty");
										try {
											const update: AgentUpdate = { frequency_penalty: value };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							)}

							{localAgent.presence_penalty === null ? (
								<UnsetSetting
									label="Presence penalty"
									description="Increases diversity by lowering likelihood of prompt tokens (-2.0 to 2.0)."
									defaultLabel={DEFAULTS.presence_penalty}
									onSet={async () => {
										setSavingField("presence_penalty");
										try {
											const update: AgentUpdate = {
												presence_penalty: DEFAULTS.presence_penalty,
											};
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) => ({
												...prev,
												presence_penalty: DEFAULTS.presence_penalty,
											}));

											// Also refresh the agent data
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							) : (
								<SliderSetting
									value={
										localAgent.presence_penalty ?? DEFAULTS.presence_penalty
									}
									label="Presence penalty"
									description="Increases diversity by lowering likelihood of prompt tokens (-2.0 to 2.0)."
									min={-2}
									max={2}
									step={0.01}
									isSaving={savingField === "presence_penalty"}
									onChange={async (value) => {
										setSavingField("presence_penalty");
										try {
											const update: AgentUpdate = { presence_penalty: value };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							)}
						</SettingGroup>

						<SettingGroup title="Length and stopping">
							{localAgent.max_tokens === null ? (
								<UnsetSetting
									label="Max tokens"
									description="Maximum tokens to generate in response."
									defaultLabel={DEFAULTS.max_tokens}
									onSet={async () => {
										setSavingField("max_tokens");
										try {
											const update: AgentUpdate = {
												max_tokens: DEFAULTS.max_tokens,
											};
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) => ({
												...prev,
												max_tokens: DEFAULTS.max_tokens,
											}));

											// Also refresh the agent data
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							) : (
								<SliderSetting
									value={localAgent.max_tokens ?? DEFAULTS.max_tokens}
									label="Max tokens"
									description="Maximum tokens to generate in response."
									min={1}
									max={8192}
									step={1}
									isSaving={savingField === "max_tokens"}
									onChange={async (value) => {
										setSavingField("max_tokens");
										try {
											const update: AgentUpdate = { max_tokens: value };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							)}

							{localAgent.stop === null ? (
								<UnsetSetting
									label="Stop sequences"
									description="Sequences that will cause the model to stop generating text."
									defaultLabel="empty"
									onSet={async () => {
										setSavingField("stop");
										try {
											const update: AgentUpdate = { stop: [] };
											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});

											// Update local state immediately
											setLocalAgent((prev) => ({
												...prev,
												stop: [],
											}));

											// Also refresh the agent data
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							) : (
								<EditableField
									value={localAgent.stop?.join("\n") || ""}
									label="Stop sequences"
									placeholder="Enter stop sequences (one per line)..."
									icon={<Settings size={16} />}
									multiline
									rows={3}
									isSaving={savingField === "stop"}
									onSave={async (value) => {
										setSavingField("stop");
										try {
											// Split by newlines and filter out empty lines
											const stopSequences = value
												.split("\n")
												.map((line) => line.trim())
												.filter((line) => line.length > 0);

											const update: AgentUpdate = {
												stop:
													stopSequences.length > 0 ? stopSequences : undefined,
											};

											await updateAgentMutation.mutateAsync({
												agentId: selectedAgent.id,
												update,
											});
											if (
												selectedAgent.id === initialSelectedAgentId &&
												refetchAgent
											) {
												await refetchAgent();
											}
										} catch {
											// Error is already handled in the mutation
										} finally {
											setSavingField(null);
										}
									}}
								/>
							)}
						</SettingGroup>
					</div>
				</div>
			)}
		</div>
	);
};
