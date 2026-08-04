/**
 * Hosting Select Component
 *
 * A component for selecting a hosting provider with autocomplete functionality.
 * Filters available options based on user credentials.
 */

import { useCredentials, useModels } from "@shared/hooks";
import { Server } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
	allowCustom = true,
	allowDefault = true,
}) => {
	// Get user credentials
	const { data: credentialsData } = useCredentials();
	const userCredentials = useMemo(
		() => credentialsData?.keys || [],
		[credentialsData],
	);

	const [isSubmitting, setIsSubmitting] = useState(false);

	// Refs to track credential fetch attempts and prevent excessive re-renders
	const credentialFetchAttemptsRef = useRef<number>(0);
	const MAX_CREDENTIAL_FETCH_ATTEMPTS = 3;
	const lastCredentialFetchTimeRef = useRef<number | null>(null);
	const CREDENTIAL_FETCH_THROTTLE = 2000; // 2 seconds

	// Get available hosting providers based on user credentials
	const availableHostingProviders = useMemo(() => {
		if (!filterByCredentials) {
			return getHostingProviders();
		}

		// Prevent excessive credential fetches
		if (credentialFetchAttemptsRef.current >= MAX_CREDENTIAL_FETCH_ATTEMPTS) {
			console.warn(
				`Exceeded maximum credential fetch attempts (${MAX_CREDENTIAL_FETCH_ATTEMPTS})`,
			);
			// Return all providers if we've exceeded the maximum attempts
			return getHostingProviders();
		}

		// Add throttling to prevent rapid successive calls
		const now = Date.now();
		if (
			lastCredentialFetchTimeRef.current &&
			now - lastCredentialFetchTimeRef.current < CREDENTIAL_FETCH_THROTTLE
		) {
			// If we've fetched recently, use the last result
			return getHostingProviders();
		}

		// Track credential fetch attempts and time
		credentialFetchAttemptsRef.current += 1;
		lastCredentialFetchTimeRef.current = now;

		return getAvailableHostingProviders(userCredentials);
	}, [userCredentials, filterByCredentials]);

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

	// Helper text to show when no credentials are available
	const helperText = useMemo(() => {
		if (filterByCredentials && availableHostingProviders.length === 0) {
			return "No hosting providers available. Add credentials in Settings.";
		}
		return undefined;
	}, [availableHostingProviders.length, filterByCredentials]);

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

	// Reset credential fetch attempts when component mounts
	useEffect(() => {
		credentialFetchAttemptsRef.current = 0;
	}, []);

	// Get access to the models refresh function
	const { refreshModels } = useModels();

	// Persist a hosting id and pull the model list that belongs to it. The
	// refresh is best-effort: a stale model list is recoverable, a lost hosting
	// selection is not, so its failure must not roll back the save.
	const save = async (hostingId: string) => {
		try {
			setIsSubmitting(true);
			// Reset credential fetch attempts when hosting provider changes
			credentialFetchAttemptsRef.current = 0;

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
			label="Hosting Provider"
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
