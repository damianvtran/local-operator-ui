/**
 * Served wire catalogues over the desktop control plane.
 *
 * The backend route is public, but the renderer has no backend URL: main owns
 * the address and the bearer, and every renderer request rides the existing
 * `desktopResult` op vocabulary. This wrapper is the one place the renderer
 * names the operation; `desktopResult` already maps a non-2xx answer through
 * the envelope renderer, so the loader can treat every rejection the same way
 * (keep the cached map, register nothing new).
 */

import { desktopResult } from "./desktop-api";

/** One locale's eager `wire.*` bundle. Validated by `catalogue-supply`. */
export function fetchWireCatalogueBundle(locale: string): Promise<unknown> {
	return desktopResult<unknown>({ op: "i18n.catalogues", locale });
}
