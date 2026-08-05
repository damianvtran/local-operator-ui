/**
 * Model Select Component
 *
 * A component for selecting an AI model with autocomplete functionality.
 * Filters available options based on the selected hosting provider.
 */

import { Tooltip } from "@shared/components/ui";
import { useModels } from "@shared/hooks";
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
		return "Auto (recommended)";
	}
	if (modelId === "") {
		return "General";
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
	return "Other models";
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

const RecommendedStar: FC = () => (
	<Tooltip content="Recommended based on community usage and feedback">
		<span className="flex items-center text-warning">
			<Star size={12} aria-hidden="true" />
			<span className="sr-only">Recommended</span>
		</span>
	</Tooltip>
);

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
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Get available models for the selected hosting provider
	const availableModels = useMemo(() => {
		if (!hostingId) {
			return [];
		}

		// Get models for the selected hosting provider
		const models = getModelsForHostingProvider(hostingId);

		return models;
	}, [hostingId]);

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
	const modelOptions: ModelOption[] = useMemo(() => {
		const finalOptions: ModelOption[] = [];
		const addedIds = new Set<string>();

		const toOption = (model: Model): ModelOption => ({
			id: model.id,
			name: model.name,
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
				name: "Default",
				description: "Clear model selection",
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

		// 4. Add the current 'value' as a custom option if it's not empty and not already in finalOptions
		if (value && value.trim() !== "" && !addedIds.has(value)) {
			finalOptions.push({
				id: value,
				name: value,
				description: "Custom model",
				group: getGroupForModel(value, hostingId),
				model: undefined,
			});
		}

		return finalOptions;
	}, [availableModels, value, hostingId, allowDefault]);

	// Helper text to show when no models are available
	const helperText = useMemo(() => {
		if (!hostingId && !allowDefault) {
			return "Select a hosting provider first.";
		}
		if (
			hostingId &&
			availableModels.length === 0 &&
			!allowDefault &&
			!modelOptions.some((opt) => opt.id === value && value !== "")
		) {
			return "No models available for selected provider.";
		}
		if (availableModels.length === 0 && hostingId) {
			const provider = getHostingProviderById(hostingId);
			if (provider) {
				return `No models for ${provider.name}`;
			}
			return "No models available";
		}
		return undefined;
	}, [availableModels.length, hostingId, allowDefault, modelOptions, value]);

	// Find the current selected option
	const selectedOption = useMemo(() => {
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

		// Check if the value exists exactly in the available options
		const exactMatch = modelOptions.find((option) => option.id === value);
		if (exactMatch) {
			return exactMatch;
		}

		// Check if the value is a model name without provider prefix
		if (!value.includes("/") && hostingId) {
			// Try to find a model with this name in the current hosting provider
			const matchByName = modelOptions.find(
				(option) =>
					option.id.endsWith(`/${value}`) ||
					option.name.toLowerCase() === value.toLowerCase(),
			);
			if (matchByName) {
				return matchByName;
			}
		}

		// Return a custom option if no match is found
		return {
			id: value,
			name: value,
			description: "Custom model",
			model: undefined,
		};
	}, [value, modelOptions, hostingId, allowDefault, availableModels.length]);

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
			label="Model"
			icon={<Cpu size={16} aria-hidden="true" />}
			labelTooltip="Select the AI model that you want to use.  Each model has different capabilities and costs.  Recommended: Automatic"
			placeholder="Select a model..."
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
			busyLabel="Loading models"
			disabled={isDisabled}
		/>
	);
};
