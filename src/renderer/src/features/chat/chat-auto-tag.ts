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
 * `local_operator/server/routes/desktop_sessions.py`), so a fork body carrying
 * `auto_tag` against a backend whose `Fork` model predates it is a 422 - the
 * fork fails, which is a worse outcome than no auto-tagging. The field
 * therefore travels only when the backend ADVERSARIES `session_tags` at the
 * version that taught the route the field; older cores keep the exact body
 * they shipped with (`desktop-contract.ts` drops `undefined`).
 *
 * WHY THE TAG SUBSYSTEM'S OWN KEY AND NOT A NEW ONE. The core's feature-map
 * rule (`local_operator/server/features.py`) is that a key exists so an
 * EXISTING surface keeps working against a backend that lacks the new
 * widget; here the existing surface is tags themselves, which keep their
 * `session_tags >= 1` gate, and a bump to 2 is what lets this client ASK
 * whether the fork route understands the field before sending it. Nothing is
 * withheld from a v1 backend: its tag UI is unchanged, only this row and this
 * body field are absent. See `docs/design/sidebar-tags-v2.md` §5.4 and
 * `docs/design/sidebar-tags-flows.md` §9.3.
 */

import type { DesktopCapabilities } from "@shared/api/local-operator/desktop-api";
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import type { SidebarView } from "./chat-sidebar-view";

/**
 * The `session_tags` version whose fork body carries `auto_tag`.
 *
 * Version 1 is the durable tag store every shipped client reads; version 2
 * adds the optional fork field on the same routes. A backend on 1 is a working
 * tags backend for every other surface, so readers must keep asking for 1
 * there and ask for 2 only here.
 */
export const AUTO_TAG_MINIMUM_VERSION = 2;

/** Whether this backend can honour (and will accept) the fork's `auto_tag`. */
export function autoTagSupported(
	capabilities: DesktopCapabilities | null | undefined,
): boolean {
	return desktopFeatureEnabled(
		capabilities,
		"session_tags",
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
