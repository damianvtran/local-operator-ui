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
