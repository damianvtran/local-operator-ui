import { useI18nLocale } from "@shared/i18n/use-locale";

// Copy-bearing projections are intentionally recomputed after the locale hook
// repaints; caching formatted strings would retain the prior language. Network
// and structural-data caches remain in place.
import { t } from "../../../../../i18n/messages";
/**
 * Model Select Component
 *
 * A component for selecting an AI model with autocomplete functionality.
 * Filters available options based on the selected hosting provider.
 */

import { Tooltip } from "@shared/components/ui";
import { useModels } from "@shared/hooks";
import { useModelsStore } from "@shared/store/models-store";
import { Cpu, Star } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
	type Model,
	getHostingProviderById,
	getModelsForHostingProvider,
} from "./hosting-model-manifest";
import { type SearchableOption, SearchableSelect } from "./searchable-select";

/**
 * Type for model option in the autocomplete
 */
type ModelOption = SearchableOption & {
	model?: Model | undefined;
	recommended?: boolean;
};

/**
 * Resolve presentation against catalogue IDs before rescuing a custom value.
 * Only the CURRENT known hosting's outer prefix is equivalent: OpenRouter's
 * upstream `openai/model` is its actual ID, not a prefix we may discard. Names
 * are not IDs, and this lookup never rewrites the stored value or saves it.
 */
const matchModelOption = (
	options: ModelOption[],
	value: string,
	hostingId: string,
): ModelOption | undefined => {
	const exact = options.find((option) => option.id === value);
	if (exact) return exact;
	if (!hostingId || !getHostingProviderById(hostingId)) return undefined;
	const prefix = `${hostingId}/`;
	if (value.startsWith(prefix)) {
		const bare = value.slice(prefix.length);
		return bare ? options.find((option) => option.id === bare) : undefined;
	}
	return options.find((option) => option.id === `${prefix}${value}`);
};

type ModelSelectProps = {
	/**
	 * Current model ID
	 */
	value: string;

	/**
	 * Current hosting provider ID
	 */
	hostingId: string;

	/**
	 * Callback function when the model is changed
	 * @param value - The new model ID
	 */
	onSave: (value: string) => Promise<void>;

	/**
	 * Whether the field is currently being saved
	 */
	isSaving?: boolean;

	/**
	 * Whether to allow custom model entries
	 * Default: true
	 */
	allowCustom?: boolean;

	/**
	 * Whether to allow the "Default" option in the select
	 * Default: true
	 */
	allowDefault?: boolean;
};

/**
 * Extract provider from model ID (e.g., "openai/gpt-4" -> "openai")
 * This function is used to group models in the dropdown by their provider
 *
 * @param id - The model ID to extract the provider from
 * @returns The provider part of the model ID, or an empty string if no provider is found
 */
const getProviderFromId = (id: string): string => {
	// Handle empty or invalid IDs
	if (!id || typeof id !== "string") return "";

	// Extract the provider part (everything before the first slash)
	// This ensures all models from the same provider are grouped together
	// regardless of their model name
	const slashIndex = id.indexOf("/");
	if (slashIndex > 0) {
		return id.substring(0, slashIndex);
	}

	return "";
};

/**
 * The heading a model sits under in the list. Headings are emitted as the
 * group changes while walking the option list, so this only has to be stable
 * per option — the ordering is decided when the options are built.
 */
const getGroupForModel = (modelId: string, hostingId: string): string => {
	if (hostingId === "radient" && modelId === "auto") {
		return t("ui.common.models.model_select.auto_recommended");
	}
	if (modelId === "") {
		return t("ui.common.models.model_select.general");
	}

	const providerId = getProviderFromId(modelId);
	if (hostingId === "radient" && providerId === "radient") {
		return "Radient";
	}

	const provider = getHostingProviderById(providerId);
	if (provider) {
		return provider.name;
	}
	if (providerId) {
		// The manifest does not know this provider, but the id still names one.
		return providerId;
	}
	return t("ui.common.models.model_select.other_models");
};

/**
 * Descriptions arrive from the manifest as markdown and routinely contain a
 * pricing or docs link. Anchors open externally because this is an Electron
 * renderer: an in-place navigation would replace the app window.
 */
const ModelDescription: FC<{ markdown: string }> = ({ markdown }) => (
	<div className="[&_p]:m-0">
		<ReactMarkdown
			components={{
				a: ({ href, children }) => (
					<a
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						className="text-accent hover:underline"
					>
						{children}
					</a>
				),
			}}
		>
			{markdown}
		</ReactMarkdown>
	</div>
);

const RecommendedStar: FC = () => {
	useI18nLocale();
	return (
		<Tooltip
			content={t(
				"ui.common.models.model_select.recommended_based_on_community_usage_and_feedback",
			)}
		>
			<span className="flex items-center text-warning">
				<Star size={12} aria-hidden="true" />
				<span className="sr-only">
					{t("ui.common.models.model_select.recommended")}
				</span>
			</span>
		</Tooltip>
	);
};

/**
 * Model Select Component
 *
 * A component for selecting an AI model with autocomplete functionality.
 * Filters available options based on the selected hosting provider.
 */
export const ModelSelect: FC<ModelSelectProps> = ({
	value,
	hostingId,
	onSave,
	isSaving = false,
	allowCustom = true,
	allowDefault = true,
}) => {
	useI18nLocale();
	const [isSubmitting, setIsSubmitting] = useState(false);

	/*
	 * The list is DERIVED FROM THE STORE, so it is recomputed when the store fills.
	 *
	 * `getModelsForHostingProvider` reads the store imperatively, so a memo keyed on
	 * `hostingId` alone runs once -- on the first render, when the store is still
	 * empty -- and never again. The effect was the first-run path on every backend
	 * without the suggested-defaults fields: step 2's Model field sat empty and
	 * disabled behind "No models available for selected provider." while the same
	 * catalogue was listed a remount later (QA round 2 R2-Q3, the same class of bug
	 * the round-1 fix removed from `HostingSelect`). Subscribing to the two store
	 * fields the getter reads makes the memo follow them.
	 */
	const storeModels = useModelsStore((state) => state.models);
	const storeInitialized = useModelsStore((state) => state.isInitialized);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the getter reads the store imperatively, so these two are genuine inputs
	const availableModels = useMemo(() => {
		if (!hostingId) {
			return [];
		}

		// Get models for the selected hosting provider
		const models = getModelsForHostingProvider(hostingId);

		return models;
		/*
		 * The two store fields are the getter's real inputs: it reads the store
		 * imperatively, so nothing else re-runs this when the catalogue arrives.
		 * Biome cannot see through the getter and calls them surplus.
		 */
	}, [hostingId, storeModels, storeInitialized]);

	// Force refresh models when hosting provider changes
	const { refreshModels, isLoading: isModelsLoading } = useModels();
	const previousHostingIdRef = useRef<string | null>(null);
	const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const isInitialMountRef = useRef(true);

	useEffect(() => {
		// Skip the effect on initial mount to prevent unnecessary refreshes
		if (isInitialMountRef.current) {
			isInitialMountRef.current = false;
			previousHostingIdRef.current = hostingId;
			return undefined;
		}

		// Only refresh if hostingId has changed and is not null
		if (hostingId && previousHostingIdRef.current !== hostingId) {
			previousHostingIdRef.current = hostingId;

			// Clear any existing timeout to prevent multiple calls
			if (refreshTimeoutRef.current) {
				clearTimeout(refreshTimeoutRef.current);
				refreshTimeoutRef.current = null;
			}

			// Use a short debounce to prevent multiple rapid calls
			// but ensure models are refreshed quickly when hosting provider changes
			refreshTimeoutRef.current = setTimeout(() => {
				// Always refresh models when hosting provider changes
				if (!isModelsLoading) {
					refreshModels().catch((error) => {
						console.error("Error refreshing models:", error);
					});
				}

				// Clear the timeout reference after it's executed
				refreshTimeoutRef.current = null;
			}, 300); // Short delay to batch potential multiple changes

			return () => {
				if (refreshTimeoutRef.current) {
					clearTimeout(refreshTimeoutRef.current);
					refreshTimeoutRef.current = null;
				}
			};
		}

		return undefined;
	}, [hostingId, refreshModels, isModelsLoading]);

	// Convert models to autocomplete options, ensuring uniqueness by ID and specific ordering
	const modelOptions: ModelOption[] = (() => {
		const finalOptions: ModelOption[] = [];
		const addedIds = new Set<string>();
		const catalogueIds = new Set(availableModels.map((model) => model.id));
		const knownHosting = Boolean(getHostingProviderById(hostingId));

		const toOption = (model: Model): ModelOption => ({
			id: model.id,
			name: model.name,
			// Human labels need not contain the API ID. Keep that ID searchable,
			// plus its authorized selector unless another row owns it as an exact
			// canonical ID (exact identity outranks presentation equivalence).
			keywords: [
				model.id,
				...(knownHosting && !catalogueIds.has(`${hostingId}/${model.id}`)
					? [`${hostingId}/${model.id}`]
					: []),
			],
			description: model.description ? (
				<ModelDescription markdown={model.description} />
			) : undefined,
			adornment: model.recommended ? <RecommendedStar /> : undefined,
			group: getGroupForModel(model.id, hostingId),
			model,
			recommended: model.recommended,
		});

		// 1. If hostingId is "radient", add "auto" model first if it exists
		if (hostingId === "radient") {
			const autoModelFromAvailable = availableModels.find(
				(model) => model.id === "auto",
			);
			if (autoModelFromAvailable) {
				finalOptions.push(toOption(autoModelFromAvailable));
				addedIds.add(autoModelFromAvailable.id);
			}
		}

		// 2. Add "Default" option if its ID hasn't been added yet and allowDefault is true
		if (allowDefault && !addedIds.has("")) {
			finalOptions.push({
				id: "",
				name: t("ui.common.models.default"),
				description: t("ui.common.models.model_select.clear_model_selection"),
				group: getGroupForModel("", hostingId),
				model: undefined,
			});
			addedIds.add("");
		}

		// 3. Add all other models from availableModels that haven't been added yet
		for (const model of availableModels) {
			if (!addedIds.has(model.id)) {
				finalOptions.push(toOption(model));
				addedIds.add(model.id);
			}
		}

		// Rescue only truly unlisted values. Injecting an exact custom row first
		// shadows the real catalogue's provider-aware presentation match.
		if (
			value &&
			value.trim() !== "" &&
			!matchModelOption(finalOptions, value, hostingId)
		) {
			finalOptions.push({
				id: value,
				name: value,
				description: t("ui.common.models.model_select.custom_model"),
				group: getGroupForModel(value, hostingId),
				model: undefined,
			});
		}

		return finalOptions;
	})();

	// Helper text to show when no models are available
	const helperText = (() => {
		if (!hostingId && !allowDefault) {
			return t("ui.common.models.model_select.select_a_hosting_provider_first");
		}
		if (
			hostingId &&
			availableModels.length === 0 &&
			!allowDefault &&
			!modelOptions.some((opt) => opt.id === value && value !== "")
		) {
			return t(
				"ui.common.models.model_select.no_models_available_for_selected_provider",
			);
		}
		/* Same guard as the branch above: a saved model with a failed fetch is
		   an ordinary state - the config still names it and the select still
		   displays it - and telling the user "No models available" directly
		   under the model they are looking at contradicts the field itself.
		   The empty list is worth saying only when nothing is selected. */
		if (
			availableModels.length === 0 &&
			hostingId &&
			!modelOptions.some((opt) => opt.id === value && value !== "")
		) {
			const provider = getHostingProviderById(hostingId);
			return provider
				? t("ui.common.models.model_select.no_models_for", {
						name: String(provider.name),
					})
				: t("ui.common.models.model_select.no_models_available");
		}
		return undefined;
	})();

	// Find the current selected option
	const selectedOption = (() => {
		if (
			(!value || value.trim() === "") &&
			!allowDefault &&
			availableModels.length === 0
		) {
			return null;
		}
		if ((!value || value.trim() === "") && allowDefault) {
			return modelOptions.find((option) => option.id === "") || null;
		}
		if (!value || value.trim() === "") return null;

		const match = matchModelOption(modelOptions, value, hostingId);
		if (match) return match;

		// Return a custom option if no match is found
		return {
			id: value,
			name: value,
			description: t("ui.common.models.model_select.custom_model"),
			model: undefined,
		};
	})();

	const save = async (modelId: string) => {
		try {
			setIsSubmitting(true);
			await onSave(modelId);
		} catch (error) {
			console.error("Error saving model:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	// Disable if no hostingId/models and default not allowed
	const isDisabled = Boolean(
		(!hostingId && !allowDefault) ||
			(hostingId &&
				availableModels.length === 0 &&
				!allowDefault &&
				!modelOptions.some((opt) => opt.id === value && value !== "")),
	);

	return (
		<SearchableSelect
			label={t("ui.common.models.model_select.model")}
			icon={<Cpu size={16} aria-hidden="true" />}
			labelTooltip={t(
				"ui.common.models.model_select.select_the_ai_model_that_you_want_to_use_each_model_has_different",
			)}
			placeholder={t("ui.common.models.model_select.select_a_model")}
			options={modelOptions}
			selected={selectedOption}
			onSelect={(option) => {
				void save(option.id);
			}}
			onCustomSubmit={
				allowCustom
					? (text) => {
							void save(text);
						}
					: undefined
			}
			helperText={helperText}
			busy={isSaving || isSubmitting || isModelsLoading}
			busyLabel={t("ui.common.models.model_select.loading_models")}
			disabled={isDisabled}
		/>
	);
};
