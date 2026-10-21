/**
 * The fork auto-tag intent, decided in ONE place.
 *
 * THREE READERS HAVE TO AGREE on the same two answers - the View-options row
 * (does it draw at all?), the fork picker (does the body carry `auto_tag`?),
 * and the tests that pin both. A second copy of either rule is how a control
 * ends up drawn against a backend whose fork route would refuse the field, so
 * this file owns the capability gate and the payload decision together.
 *
 * THE WIRE FIELD IS ADDITIVE, BUT ONLY A CAPABLE BACKEND MAY RECEIVE IT. The
 * core's request models inherit `extra="forbid"` (`Input` in
 * `local_operator/server/routes/desktop_lifecycle.py`), so a fork body carrying
 * `auto_tag` against a backend whose `Fork` model predates it is a 422 - the
 * fork fails, which is a worse outcome than no auto-tagging. The field
 * therefore travels only when the backend advertises its own
 * `session_tags_auto_tag` key; older cores keep the exact body they shipped
 * with (`desktop-contract.ts` drops `undefined`).
 *
 * WHY THE AUTO-TAG HALF HAS ITS OWN KEY. `session_tags: 1` is the durable tag
 * store every tag surface reads; `session_tags_auto_tag: 1` is the fork field
 * and the naming contract behind it. The core keeps them separate because a
 * daemon with the catalogue and without auto-tagging must keep its whole tag
 * UI, and because a client has to ask a narrower question than "are tags
 * here?" before it sends a key an older `Fork` model would refuse. Bumping
 * `session_tags` could only answer that by also hiding a working catalogue.
 * See `docs/design/sidebar-tags-v2.md` §5.4 and the core's
 * `local_operator/server/features.py`.
 */

import type { DesktopCapabilities } from "@shared/api/local-operator/desktop-api";
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import type { SidebarView } from "./chat-sidebar-view";

/**
 * The `session_tags_auto_tag` version that introduced the fork field.
 *
 * Version 1 is the first and only shape of this key; naming it here keeps the
 * floor visible beside the predicate rather than as a bare `1` inside it.
 */
export const AUTO_TAG_MINIMUM_VERSION = 1;

/** Whether this backend can honour (and will accept) the fork's `auto_tag`. */
export function autoTagSupported(
	capabilities: DesktopCapabilities | null | undefined,
): boolean {
	return desktopFeatureEnabled(
		capabilities,
		"session_tags_auto_tag",
		AUTO_TAG_MINIMUM_VERSION,
	);
}

/**
 * The fork body's `auto_tag`, or `undefined` when the key must not travel.
 *
 * THREE CASES, and the third is why this is not a boolean:
 *
 *  - `undefined` - the backend predates the field, so the request keeps its
 *    released shape and no capability is claimed;
 *  - `true` - tags are on for the view and the reader left auto-tagging on;
 *  - `false` - the reader turned it off (or tags are off). Sent explicitly,
 *    because on a capable backend "do not auto-tag" is a real instruction the
 *    route records, not an absence to interpret.
 *
 * `tagsEnabled` is read HERE rather than at the call site: the design's rule is
 * one conjunction (`tagsEnabled && autoTagForks`), and a caller that forgot
 * the first half would auto-tag futures while the reader has tags switched
 * off - which the design forbids in as many words (§5.4: "turning tags off
 * never runs auto-tagging").
 */
export function forkAutoTag(
	view: Pick<SidebarView, "tagsEnabled" | "autoTagForks">,
	supported: boolean,
): boolean | undefined {
	if (!supported) return undefined;
	return view.tagsEnabled && view.autoTagForks;
}
