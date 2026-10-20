/**
 * The renderer's writer for SERVED wire catalogues.
 *
 * Mounted once, in `App`, beside `useI18nLocaleSync`: the locale store decides
 * WHICH catalogue the envelope renderer asks for, and this hook makes sure that
 * locale's bundle has been fetched and registered. It fires on the first
 * capabilities answer (the same answer that resolves the locale) and again on
 * every locale change, so a language switch re-registers without a restart.
 *
 * The feature gate is the RFC's: `features.i18n >= 1` on the SAME capabilities
 * answer. A backend that does not advertise the route is never called, and one
 * that stops advertising it simply stops being refreshed — the registry keeps
 * whatever was last valid, and an unknown key still degrades to the envelope's
 * own `text` (design §6).
 *
 * The loader is deliberately NOT a React Query: its answer is a side effect
 * (registered messages), not render state, and a query would add a retry loop
 * the failure contract forbids.
 */

import { useDesktopCapabilities } from "@shared/api/local-operator/desktop-hooks";
import { fetchWireCatalogueBundle } from "@shared/api/local-operator/i18n-api";
import { useEffect } from "react";

import {
	type CatalogueStorage,
	createCatalogueSupply,
	resolveCatalogueLocale,
} from "../../../../i18n/catalogue-supply";
import { useI18nLocale } from "./use-locale";

/**
 * The browser's storage, or `null` where the property is absent/blocked.
 *
 * Property access itself can throw under a hardened renderer, so the guard
 * wraps it rather than assuming `globalThis.localStorage` is merely undefined
 * in a non-browser test host.
 */
function browserStorage(): CatalogueStorage | null {
	try {
		return (
			(globalThis as { localStorage?: CatalogueStorage }).localStorage ?? null
		);
	} catch {
		return null;
	}
}

/** One loader for the process: the registry it writes to is process-global. */
export const wireCatalogueSupply = createCatalogueSupply({
	fetchBundle: fetchWireCatalogueBundle,
	storage: browserStorage(),
});

export function useI18nCatalogueSync(): void {
	const { data } = useDesktopCapabilities();
	const storeLocale = useI18nLocale();
	const enabled = (data?.features?.i18n ?? 0) >= 1;
	/*
	 * `data.language` is the answer that resolved the store, so prefer it: this
	 * hook is mounted after the writer but its effect runs before the store's
	 * notification lands on a re-render, and the device tag it would otherwise
	 * read (`en-US`) is not a shipped catalogue (404 on every startup).
	 */
	const locale = resolveCatalogueLocale(data?.language, storeLocale);

	useEffect(() => {
		if (!enabled || !locale) return;
		void wireCatalogueSupply.load(locale);
	}, [enabled, locale]);
}
