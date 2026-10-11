/**
 * The i18n locale store's WRITER: mirrors the capabilities query into it.
 *
 * Mounted once, in `App` — the `useWindowChrome` precedent, one mount because
 * the store is one value, and it renders nothing. It fires on the first
 * capabilities answer and on every re-negotiation (`useDesktopCapabilities`
 * re-polls by design, for the plane's own reasons). Before any answer, nothing
 * is applied and the store keeps the device locale: that is the RFC §2.5
 * pre-connection rule, not an oversight. An answer WITHOUT `features.i18n`
 * (an older backend) resolves the same way — the device stays — which is what
 * "ships dark" means for a client that predates the capability.
 */

import { useDesktopCapabilities } from "@shared/api/local-operator/desktop-hooks";
import { useEffect } from "react";

import { applyCapabilities } from "../../../../i18n/locale";

/** Mirror the capabilities answer (or its absence) into the locale store. */
export function useI18nLocaleSync(): void {
	const { data } = useDesktopCapabilities();
	useEffect(() => {
		if (data) applyCapabilities(data);
	}, [data]);
}
