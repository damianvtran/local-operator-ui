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
import type { DesktopProvider } from "../../../../shared/desktop-contract";

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
export function providerStatusFrom(input: {
	censusEnabled: boolean;
	censusLoaded: boolean;
	configLoading: boolean;
	/** The configured default hosting, or null. */
	hosting: string | null;
	/**
	 * The census rows, as `providers.list` returned them -- the SHARED census type,
	 * not a structural subset: a local copy of four of its fields stopped
	 * type-checking the moment the census grew another one (`credential_optional`,
	 * `configured`), which is the same class of drift this rule exists to catch.
	 */
	/*
	 * The SAME type the hook reads them as (`useDesktopProviders` -> `DesktopProvider[]`),
	 * not a structural subset: a local copy of a few fields stopped type-checking the
	 * moment the census grew another one.
	 */
	rows: DesktopProvider[];
}): { needsProvider: boolean; needsModel: boolean; isKnown: boolean } {
	const { censusEnabled, censusLoaded, configLoading, hosting, rows } = input;
	const isKnown = censusEnabled && censusLoaded && !configLoading;
	/*
	 * A CONFIGURED `hosting` is not the same fact as a usable provider. Signing
	 * out clears the credential (`auth.logout`) and leaves `hosting` in the
	 * config, so after signing out of the only provider there was no card, no
	 * status line and no placeholder - while every send failed against a default
	 * whose key was gone (code round 1 m3).
	 *
	 * The row decides, because only the census knows whether the credential is
	 * still there: local runtimes and providers that need no credential count as
	 * usable (this answers "can anything answer a message", not "is a cloud key
	 * present"), and a `hosting` whose row this census does not carry is trusted,
	 * because a backend that cannot describe the provider is not evidence that it
	 * is unusable.
	 */
	const hostingRow = hosting
		? (rows.find((row) => row.id === hosting) ?? null)
		: null;
	const hostingUsable =
		hosting !== null &&
		(hostingRow === null ||
			hostingRow.local === true ||
			hostingRow.has_credential === true ||
			(hostingRow.stored_credentials ?? 0) > 0);
	/*
	 * THE STATE ONE STEP PAST `needsProvider`: a provider IS connected and this app
	 * cannot name a model to run on -- a first run whose provider was connected but
	 * whose default was deliberately not written, because the backend lists no models
	 * for it (UX round 5, U21: the band said "Choose a model" and Enter still sent).
	 *
	 * Same rule, opposite branch: `hostingUsable` decides both, so a configured default
	 * (which is how a local runtime shows up here) makes this false, and a census this
	 * app could not read keeps it false as well -- "I could not tell" is not "nothing
	 * can answer".
	 */
	const needsModel = isKnown && !hostingUsable && hasConnectedProvider(rows);
	return {
		isKnown,
		needsProvider: isKnown && !hostingUsable && !hasConnectedProvider(rows),
		needsModel,
	};
}

/** The hook: the same rule over the two reads the chat already has. */
export function useProviderStatus(): {
	needsProvider: boolean;
	needsModel: boolean;
	isKnown: boolean;
} {
	const capabilities = useDesktopCapabilities();
	const censusEnabled = desktopFeatureEnabled(capabilities.data, "auth");
	const providers = useDesktopProviders(censusEnabled);
	const { hosting, isLoading } = useDefaultModel();
	return providerStatusFrom({
		censusEnabled,
		censusLoaded: providers.isSuccess,
		configLoading: isLoading,
		hosting,
		rows: providers.data ?? [],
	});
}
