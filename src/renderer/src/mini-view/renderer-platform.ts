/**
 * The platform, as the display mapping and the prior-art table spell it.
 *
 * ONE FUNCTION, THREE SURFACES. The settings row, the mini composer and the
 * registration toasts all render sentences spelled with the platform's own key
 * names, and each used to carry its own copy of this three-line reader — a
 * third copy is how the surfaces come to disagree about what machine they are
 * on (review round 1's U1 fix needed the same answer from a new consumer).
 *
 * Read from the same synchronous chrome facts every renderer uses; a window
 * that predates the facts falls back to `linux`, which is that argument's own
 * default (`DEFAULT_WINDOW_CHROME_FACTS`) rather than a second guess.
 */

import type { MiniViewPlatform } from "../../../shared/mini-view";

export function rendererPlatform(): MiniViewPlatform {
	try {
		return window.api?.windowChrome?.facts?.().platform ?? "linux";
	} catch {
		return "linux";
	}
}
