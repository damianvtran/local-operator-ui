/**
 * The `dir` for a field that holds the operator's OWN text (a name, an agent's
 * instructions, a comment), whose script need not match the interface language.
 *
 * THE FAULT. Inheriting an RTL locale's direction put an English value's
 * punctuation at the wrong end: `.You implement...` and `!bad name` in ur
 * (design review on UI #1952). `dir="auto"` lets the value's first strong
 * character decide, and an Urdu value still reads right-to-left under en.
 *
 * WHY NOT A PLAIN `dir="auto"`. An EMPTY `dir=auto` control resolves to LTR in
 * Chromium (measured in this app's Storybook under ur: the empty tool-name
 * input computed `direction: ltr`), so the translated placeholder and the
 * caret jumped to the left edge of an Urdu form. While the value is empty the
 * attribute is omitted and the field inherits the locale's direction; the
 * first typed character switches it to `auto`.
 */
export const userTextDir = (
	value: string | null | undefined,
): "auto" | undefined => (value ? "auto" : undefined);

/**
 * The alignment for a single-line DISPLAY of the operator's text that carries
 * `dir="auto"` (a roster name, a pane heading, a member's agent name).
 *
 * WHY NOT `rtl:text-right`. Tailwind's `rtl:` matches an element's OWN resolved
 * `:dir(rtl)` too, and `dir="auto"` makes an Urdu-script value resolve RTL under
 * en, so the name right-aligned away from the icon or subtitle it labels
 * (review on UI #1974, R1-1 / D2). `[[dir=rtl]_&]` matches only an RTL
 * ANCESTOR - the `<html dir>` the locale writes - so the edge follows the
 * interface language while `dir="auto"` still decides glyph order and which end
 * the ellipsis falls on. A literal here (not built from parts) so Tailwind's
 * source scan generates both classes.
 */
export const USER_TEXT_ALIGN = "text-left [[dir=rtl]_&]:text-right";
