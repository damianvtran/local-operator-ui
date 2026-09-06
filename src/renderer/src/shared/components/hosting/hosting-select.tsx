/**
 * Hosting Select Component
 *
 * A component for selecting a hosting provider with autocomplete functionality.
 * Filters available options based on user credentials.
 */

import { readyHostingIds } from "@features/providers/provider-labels";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import { useCredentials, useModels } from "@shared/hooks";
import { Server } from "lucide-react";
import type { FC } from "react";
import { useMemo, useState } from "react";
import {
	type HostingProvider,
	getAvailableHostingProviders,
	getHostingProviderById,
	getHostingProviders,
} from "./hosting-model-manifest";
import { type SearchableOption, SearchableSelect } from "./searchable-select";

/**
 * Type for hosting provider option in the autocomplete
 */
type HostingOption = SearchableOption & {
	provider?: HostingProvider;
};

type HostingSelectProps = {
	/**
	 * Current hosting provider ID
	 */
	value: string;

	/**
	 * Callback function when the hosting provider is changed
	 * @param value - The new hosting provider ID
	 */
	onSave: (value: string) => Promise<void>;

	/**
	 * Whether the field is currently being saved
	 */
	isSaving?: boolean;

	/**
	 * Whether to show all hosting providers or only those available with current credentials
	 * Default: true (only show available providers)
	 */
	filterByCredentials?: boolean;
	/**
	 * What to say when credentials filtering leaves nothing to choose.
	 *
	 * The default sends the reader to Settings, which is right from the chat
	 * and the agent form and wrong on the Settings page itself - where the
	 * credentials section is three rows down the same nav. A caller that IS the
	 * destination names the section instead.
	 */
	emptyHelperText?: string;

	/**
	 * Whether to allow custom hosting provider entries
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
 * Hosting Select Component
 *
 * A component for selecting a hosting provider with autocomplete functionality.
 * Filters available options based on user credentials.
 */
export const HostingSelect: FC<HostingSelectProps> = ({
	value,
	onSave,
	isSaving = false,
	filterByCredentials = true,
	emptyHelperText = "No hosting providers available. Add credentials in Settings.",
	allowCustom = true,
	allowDefault = true,
}) => {
	const capabilities = useDesktopCapabilities();
	const censusEnabled = desktopFeatureEnabled(capabilities.data, "auth");
	const census = useDesktopProviders(censusEnabled);
	const { data: credentialsData } = useCredentials();
	const userCredentials = useMemo(
		() => credentialsData?.keys || [],
		[credentialsData],
	);

	const [isSubmitting, setIsSubmitting] = useState(false);

	const availableHostingProviders = useMemo(() => {
		const all = getHostingProviders();
		if (!filterByCredentials) return all;
		if (censusEnabled) {
			// Advertised census owns this filter even while it is still loading
			// or has 5xx'd: falling through to the env-file list is Q3.
			if (!census.data) return all;
			const ready = readyHostingIds(census.data);
			return all.filter((provider) => ready.has(provider.id));
		}
		// Unmanaged / old backends have no census; the env-file list is the
		// only remaining source. Never mix it with a live census: that is
		// how Anthropic showed "Requires additional credentials" while the
		// grid said Signed in.
		return getAvailableHostingProviders(userCredentials);
	}, [filterByCredentials, censusEnabled, census.data, userCredentials]);

	// Convert hosting providers to autocomplete options
	const hostingOptions: HostingOption[] = useMemo(() => {
		const options: HostingOption[] = [];
		if (allowDefault) {
			options.push({
				id: "",
				name: "Default",
				description: "Clear hosting provider selection",
				provider: undefined,
			});
		}

		// Map available hosting providers to options
		for (const provider of availableHostingProviders) {
			options.push({
				id: provider.id,
				name: provider.name,
				description: provider.description,
				provider,
			});
		}

		// If the current value is not in the available options, add it as a custom option
		if (
			value &&
			!availableHostingProviders.some((provider) => provider.id === value)
		) {
			const customProvider = getHostingProviderById(value);
			if (customProvider) {
				// If it's a known provider but not available with current credentials
				options.push({
					id: customProvider.id,
					name: customProvider.name,
					description: `${customProvider.description} (Requires additional credentials)`,
					provider: customProvider,
				});
			} else if (allowCustom) {
				// If it's a completely custom provider
				options.push({
					id: value,
					name: value,
					description: "Custom hosting provider",
					provider: {
						id: value,
						name: value,
						description: "Custom hosting provider",
						url: "",
						requiredCredentials: [],
						supportedModels: [],
					},
				});
			}
		}

		return options;
	}, [availableHostingProviders, value, allowCustom, allowDefault]);

	/*
	 * "No hosting providers available" under a select that is displaying
	 * `openrouter` contradicts the row above it. The list being empty means
	 * no provider has credentials yet, which is worth saying - but only when
	 * the control is genuinely showing nothing. A value that is already set
	 * came from somewhere and the reader can see it, so the line would be
	 * telling them their own setting does not exist.
	 */
	const helperText = useMemo(() => {
		if (
			filterByCredentials &&
			availableHostingProviders.length === 0 &&
			!value
		) {
			return emptyHelperText;
		}
		return undefined;
	}, [
		availableHostingProviders.length,
		filterByCredentials,
		emptyHelperText,
		value,
	]);

	// Find the current selected option
	const selectedOption = useMemo(() => {
		// If value is empty and default is not allowed, or if there are no options at all
		// when default is not allowed, treat as no selection.
		if (
			(!value && !allowDefault) ||
			(!allowDefault &&
				availableHostingProviders.length === 0 &&
				!hostingOptions.some((opt) => opt.id === value && value !== ""))
		) {
			return null;
		}
		if (!value && allowDefault) {
			// Find the "Default" option if value is empty and default is allowed
			return hostingOptions.find((option) => option.id === "") || null;
		}
		if (!value) return null;

		return (
			hostingOptions.find((option) => option.id === value) || {
				id: value,
				name: value,
				description: "Custom hosting provider",
				provider: undefined,
			}
		);
	}, [value, hostingOptions, allowDefault, availableHostingProviders.length]);

	const { refreshModels } = useModels();

	// Persist a hosting id and pull the model list that belongs to it. The
	// refresh is best-effort: a stale model list is recoverable, a lost hosting
	// selection is not, so its failure must not roll back the save.
	const save = async (hostingId: string) => {
		try {
			setIsSubmitting(true);

			await onSave(hostingId);

			if (hostingId !== value) {
				try {
					await refreshModels();
				} catch (error) {
					console.error(
						"Error refreshing models after hosting provider change:",
						error,
					);
				}
			}
		} catch (error) {
			console.error("Error saving hosting provider:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	// Disable if no credentials and default not allowed
	const isDisabled =
		!allowDefault &&
		filterByCredentials &&
		availableHostingProviders.length === 0 &&
		!hostingOptions.some((opt) => opt.id === value && value !== "");

	return (
		<SearchableSelect
			label="Hosting provider"
			icon={<Server size={16} aria-hidden="true" />}
			labelTooltip="Select the AI provider that you want to use.  Each provider has different models available.  Recommended: Radient"
			placeholder="Select a hosting provider..."
			options={hostingOptions}
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
			busy={isSaving || isSubmitting}
			busyLabel="Saving hosting provider"
			disabled={isDisabled}
		/>
	);
};
