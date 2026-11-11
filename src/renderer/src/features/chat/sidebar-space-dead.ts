/**
 * Space landing on the chat sidebar's scroller is DEAD, and why it is a
 * function.
 *
 * The scroller (`tabIndex={-1} data-sidebar-region="scroller"` in
 * `chat-sidebar.tsx`) takes focus when the reader clicks its empty area, with
 * no focus ring - an invisible focus. From there, Space has Chromium's
 * DEFAULT action, which is to scroll the focused scroller: the whole
 * conversation list flies to the bottom while the reader just holds Space to
 * dictate (and the dictation manager's own guard once let that same press
 * engage recording). The input box already ignores Space this way for the
 * mirror reason - a space in an editable field is a space.
 *
 * This predicate is the scroller's half of that: Space landing on the
 * scroller ITSELF (the empty area, not a row) is claimed so the page-scroll
 * never runs. Rows keep their own Space behaviour - a row is a button and
 * Space presses it. A leaf function with no imports, like `clear-search.ts`
 * beside it, so the rule is testable without a DOM harness
 * (`scripts/dictation-space-dead.test.mjs` bundles this module).
 */
export const sidebarScrollerSpaceIsDead = (
	event: Pick<KeyboardEvent, "target" | "currentTarget" | "code" | "key">,
): boolean =>
	event.target === event.currentTarget &&
	(event.code === "Space" || event.key === " ");
