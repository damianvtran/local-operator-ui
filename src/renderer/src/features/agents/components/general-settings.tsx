/**
 * General Settings Component
 *
 * Component for displaying and editing general agent settings
 */

import {
	InfoGrid,
	InfoItem,
} from "@features/settings/components/settings-section";
import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import { CategoriesInputChips } from "@shared/components/common/categories-input-chips";
import { EditableField } from "@shared/components/common/editable-field";
import { TagsInputChips } from "@shared/components/common/tags-input-chips";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { ModelSelect } from "@shared/components/hosting/model-select";
import { Tooltip } from "@shared/components/ui";
import { useConfig } from "@shared/hooks/use-config";
import type { useUpdateAgent } from "@shared/hooks/use-update-agent";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Calendar, Cpu, GitBranch, IdCard, Info } from "lucide-react";
import type { FC } from "react";
import { useEffect, useState } from "react";

type GeneralSettingsProps = {
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
 * General Settings Component
 *
 * Component for displaying and editing general agent settings
 */
export const GeneralSettings: FC<GeneralSettingsProps> = ({
	selectedAgent,
	savingField,
	setSavingField,
	updateAgentMutation,
	refetchAgent,
	initialSelectedAgentId,
}) => {
	const { data: config, isLoading: isConfigLoading } = useConfig();

	// currentHosting reflects the hosting provider that ModelSelect should use.
	// It's initialized based on the agent's setting or the global default,
	// and updated when the user makes a selection in HostingSelect.
	const [currentHosting, setCurrentHosting] = useState<string>("");

	useEffect(() => {
		// Initialize or reset currentHosting when the selected agent changes,
		// or when the global config loads/changes.
		if (!isConfigLoading && config?.values) {
			setCurrentHosting(selectedAgent.hosting || config.values.hosting || "");
		} else if (!isConfigLoading) {
			// Config loaded, but no values (e.g. error or empty config)
			setCurrentHosting(selectedAgent.hosting || "");
		}
		// If config is still loading, currentHosting might be empty or based on a previous state.
		// It will be updated once the config fully loads.
	}, [selectedAgent, config, isConfigLoading]);

	const [tagsSaving, setTagsSaving] = useState(false);
	const [categoriesSaving, setCategoriesSaving] = useState(false);

	return (
		/*
		 * No outer margin: the settings shell owns the gap between panes, so a
		 * margin here would stack with it on this one pane only. Inside, the same
		 * rule applies one level down — `gap-4` between fields, because the field
		 * components no longer carry a bottom margin of their own.
		 */
		<div className="flex flex-col gap-4">
			{/*
			 * No glyph. A glyph on this surface names a kind of thing, and no two
			 * labels may name the same kind — `Bot` means "an agent" everywhere
			 * in the app, so it cannot also mean "the agent's name" here. The
			 * field is full width, alone on its row, and inside the agent's own
			 * settings pane; the word "Agent name" is not ambiguous without a
			 * picture of a robot.
			 *
			 * `Bot` used to be documented as meaning "the model", which nine of
			 * its twelve render sites contradicted. The model now carries `Cpu`
			 * and agent instructions carry `NotebookPen`, so the glyph names one
			 * kind of thing.
			 *
			 * Instructions went through two wrong glyphs first, and the reason
			 * both were wrong is the check worth repeating: `ScrollText` was
			 * already the PDF file type (`canvas-file-viewer.tsx`), and
			 * `MessageSquareText` is `MessageSquare` - the Chat rail item - with
			 * two strokes added. Before picking an icon, grep for it AND look at
			 * what it is a near-homograph of.
			 */}
			<EditableField
				value={selectedAgent.name}
				label="Agent name"
				placeholder="Enter agent name..."
				isSaving={savingField === "name"}
				onSave={async (value) => {
					if (!value.trim()) {
						showErrorToast("Agent name cannot be empty");
						return;
					}
					setSavingField("name");

					try {
						const update: AgentUpdate = { name: value };

						await updateAgentMutation.mutateAsync({
							agentId: selectedAgent.id,
							update,
						});

						// Only refetch if needed (when viewing the current agent)
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

			{/* Hosting and model sit side by side from `md` up. */}
			<div className="grid gap-4 md:grid-cols-2">
				{/* The tour matches this tag by value; it must survive verbatim. */}
				<div data-tour-tag="agent-settings-hosting-select">
					<HostingSelect
						// Key ensures component re-initializes if agent or its effective hosting changes.
						// Using selectedAgent.id ensures that if the agent changes, the select resets.
						// Fallback to a string for config?.values.hosting to ensure key is always a string.
						key={`hosting-select-${selectedAgent.id}-${selectedAgent.hosting || (config?.values.hosting ?? "default")}`}
						value={selectedAgent.hosting || (config?.values.hosting ?? "")}
						isSaving={savingField === "hosting"}
						onSave={async (value) => {
							setSavingField("hosting");

							// Update the local state immediately to prevent flickering
							// This ensures the ModelSelect component gets the new hosting value right away
							setCurrentHosting(value);

							try {
								// Update both hosting and reset model to ensure compatibility
								const update: AgentUpdate = {
									hosting: value,
									// Clear model when hosting changes to avoid incompatible models
									model: "",
								};

								await updateAgentMutation.mutateAsync({
									agentId: selectedAgent.id,
									update,
								});

								// Only refetch if needed (when viewing the current agent)
								if (
									selectedAgent.id === initialSelectedAgentId &&
									refetchAgent
								) {
									await refetchAgent();
								}
							} catch {
								// Error is already handled in the mutation
								// Revert the local state if there's an error
								setCurrentHosting(selectedAgent.hosting || "");
							} finally {
								setSavingField(null);
							}
						}}
						filterByCredentials={true}
						allowDefault={true}
					/>
				</div>
				{/* The tour matches this tag by value; it must survive verbatim. */}
				<div data-tour-tag="agent-settings-model-select">
					{/* Only render ModelSelect if we have a hosting provider selected (currentHosting) */}
					{currentHosting ? (
						<ModelSelect
							// Key ensures component re-initializes if agent, current hosting, or its effective model changes.
							key={`model-select-${selectedAgent.id}-${currentHosting}-${selectedAgent.model || (!selectedAgent.hosting && config?.values.model_name ? config.values.model_name : "default")}`}
							value={
								selectedAgent.hosting
									? selectedAgent.model || ""
									: selectedAgent.model || (config?.values.model_name ?? "")
							}
							hostingId={currentHosting} // This drives which models are available
							isSaving={savingField === "model"}
							allowDefault={true}
							onSave={async (value) => {
								setSavingField("model");

								try {
									const update: AgentUpdate = { model: value };

									await updateAgentMutation.mutateAsync({
										agentId: selectedAgent.id,
										update,
									});

									// Only refetch if needed (when viewing the current agent)
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
						/*
						 * Stand-in for ModelSelect while no hosting provider is chosen.
						 * It mirrors SearchableSelect's chrome — label row with tooltip,
						 * then an input-sized box — so the swap to the real select does
						 * not move the layout. It is intentionally not interactive: there
						 * is nothing to choose until hosting is set.
						 */
						<div className="relative">
							<Tooltip content="Select a hosting provider first, and then select the AI model that you want to use.  Each model has different capabilities and costs.  Recommended: Automatic">
								<div className="mb-1.5 flex w-fit items-center gap-2 text-body-sm text-ink-muted">
									<Cpu size={16} aria-hidden="true" />
									Model
								</div>
							</Tooltip>
							{/* `rounded-sm` because the real control it stands in for is an
							    `Input`, and a placeholder with different corners tells you
							    the layout moved when it did not. */}
							<div className="flex h-8 w-full items-center rounded-sm border border-control bg-surface px-3">
								<span className="truncate text-body-sm text-ink-disabled">
									Select a hosting provider first...
								</span>
							</div>
						</div>
					)}
				</div>
			</div>

			{/*
			 * A second grouping inside the pane, so it takes the between-components
			 * tier above it rather than another gap-4: `mt-4` on top of the
			 * container's `gap-4` makes 32px, the section tier.
			 */}
			<h2 className="mt-4 flex items-center gap-2 text-heading text-ink">
				<Info size={16} className="shrink-0 text-ink-dim" />
				Agent information
			</h2>

			{/*
			 * None of the three fields in this stack carries a glyph. They are
			 * full-width controls in one column, so a glyph on some and not others
			 * indents half the labels and not the rest; and the three that were
			 * here restated their own labels — a tag beside "Tags", an info beside
			 * "Categories", a second tag beside "Description". The `Info` on the
			 * heading above names the group; the words name the fields.
			 */}
			<div className="flex flex-col gap-4">
				<EditableField
					value={selectedAgent.description || ""}
					label="Description"
					placeholder="Enter agent description..."
					multiline
					rows={3}
					isSaving={savingField === "description"}
					onSave={async (value) => {
						setSavingField("description");

						try {
							const update: AgentUpdate = { description: value };

							await updateAgentMutation.mutateAsync({
								agentId: selectedAgent.id,
								update,
							});

							// Only refetch if needed (when viewing the current agent)
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

				<TagsInputChips
					value={selectedAgent.tags || []}
					label="Tags"
					placeholder="Add tag..."
					disabled={tagsSaving}
					onChange={async (tags) => {
						if (
							Array.isArray(selectedAgent.tags) &&
							tags.length === selectedAgent.tags.length &&
							tags.every((t, i) => t === selectedAgent.tags?.[i])
						) {
							return;
						}
						setTagsSaving(true);
						try {
							const update: AgentUpdate = { tags };
							await updateAgentMutation.mutateAsync({
								agentId: selectedAgent.id,
								update,
							});
							if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
								await refetchAgent();
							}
						} catch {
							// Error handled in mutation
						} finally {
							setTagsSaving(false);
						}
					}}
				/>

				<CategoriesInputChips
					value={selectedAgent.categories || []}
					label="Categories"
					placeholder="Add category..."
					disabled={categoriesSaving}
					onChange={async (categories) => {
						if (
							Array.isArray(selectedAgent.categories) &&
							categories.length === selectedAgent.categories.length &&
							categories.every((c, i) => c === selectedAgent.categories?.[i])
						) {
							return;
						}
						setCategoriesSaving(true);
						try {
							const update: AgentUpdate = { categories };
							await updateAgentMutation.mutateAsync({
								agentId: selectedAgent.id,
								update,
							});
							if (selectedAgent.id === initialSelectedAgentId && refetchAgent) {
								await refetchAgent();
							}
						} catch {
							// Error handled in mutation
						} finally {
							setCategoriesSaving(false);
						}
					}}
				/>

				<InfoGrid>
					<InfoItem
						label={
							<>
								<IdCard size={12} aria-hidden="true" />
								ID
							</>
						}
						// Machine voice: the id is an identifier, not prose.
						value={
							<span className="font-mono text-mono-sm">{selectedAgent.id}</span>
						}
					/>
					<InfoItem
						label={
							<>
								<Calendar size={12} aria-hidden="true" />
								Created
							</>
						}
						value={new Date(selectedAgent.created_date).toLocaleString()}
					/>
					<InfoItem
						label={
							<>
								<GitBranch size={12} aria-hidden="true" />
								Version
							</>
						}
						value={selectedAgent.version}
					/>
				</InfoGrid>
			</div>
		</div>
	);
};
