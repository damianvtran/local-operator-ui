/**
 * @file use-provider-status.ts
 * @description
 * The two facts every provider surface reads -- the census, and which provider
 * and model are the default -- plus the one derived question the chat asks:
 * "is ANY model provider connected?"
 *
 * ## Why the config read is spelled here instead of calling `useConfig`
 *
 * `useConfig` lives beside the renderer's env loader (`@shared/config`), which
 * reads `import.meta.env` at MODULE LOAD and throws outside Vite. The provider
 * list is bundled into Node tests (`backend-error-surfaces.test.mjs`,
 * `provider-grid-pin.test.mjs`), so pulling that loader in would turn those
 * tests into load-time failures. The read below goes through `ConfigApi`
 * (desktop transport only, no env) under the SAME query key and returns the
 * SAME shape `useConfig` caches, so both readers share one cache entry and
 * one refetch.
 */

import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { ConfigApi } from "@shared/api/local-operator/config-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import type { ConfigResponse } from "@shared/api/local-operator/types";
import { hasConnectedProvider } from "@shared/hooks/first-time-user";
import { useQuery } from "@tanstack/react-query";

/** `use-config.ts`'s key, restated because importing it pulls the env loader. */
export const CONFIG_QUERY_KEY = ["config"];

/** The configured default, or nulls when none is set or it cannot be read. */
export function useDefaultModel(): {
	hosting: string | null;
	model: string | null;
	isLoading: boolean;
} {
	const config = useQuery({
		queryKey: CONFIG_QUERY_KEY,
		queryFn: async (): Promise<ConfigResponse | null> => {
			const response = await ConfigApi.getConfig("");
			return (response.result as ConfigResponse) ?? null;
		},
		staleTime: 5000,
		refetchOnWindowFocus: false,
		retry: retryDesktopQuery,
	});
	const values = config.data?.values;
	return {
		hosting: values?.hosting || null,
		model: values?.model_name || null,
		isLoading: config.isLoading,
	};
}

/**
 * Whether the app should tell the user to connect a provider.
 *
 * `needsProvider` is true only when the answer is KNOWN: the census was read,
 * no cloud provider has a credential, and no default is configured (a
 * configured default is how a local runtime shows up here -- this does not
 * probe servers from the chat). While either read is pending, failed, or the
 * backend predates the census, it is false: nagging a user whose setup this
 * app simply could not read is the worse failure, and the connectivity banner
 * already owns "the server is not answering".
 */
export function useProviderStatus(): {
	needsProvider: boolean;
	isKnown: boolean;
} {
	const capabilities = useDesktopCapabilities();
	const censusEnabled = desktopFeatureEnabled(capabilities.data, "auth");
	const providers = useDesktopProviders(censusEnabled);
	const { hosting, isLoading } = useDefaultModel();
	const isKnown = censusEnabled && providers.isSuccess && !isLoading;
	return {
		isKnown,
		needsProvider:
			isKnown && !hosting && !hasConnectedProvider(providers.data ?? []),
	};
}
