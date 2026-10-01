/**
 * The name a team is READ by: its label when it has one, its slug otherwise.
 *
 * WHY THIS IS ITS OWN LEAF MODULE. A team record carries two names that answer
 * different questions: `name`, the TUI-safe slug every surface ADDRESSES it by
 * (the value `/team` commands, bindings and catalogue keys carry), and `label`,
 * an optional free-text name a person reads. The split has exactly one rule -
 * display prefers the label, falls back to the slug - and it is stated ONCE
 * because it is read from a half-dozen surfaces (the sidebar's entity rows and
 * session slots, the chat header's identity chip, the draft title, the slash
 * popup, the picker dialogs, the agents roster) and a second spelling of it is
 * how one of them would eventually disagree with the others.
 *
 * A LEAF with no imports, on purpose: `chat-header-identity-model.ts` imports
 * this module and is bundled by `scripts/header-identity-model.test.mjs` with
 * no path aliases configured, so anything imported here would have to resolve
 * (and bundle) inside that test's harness. The same discipline
 * `format-bytes.ts` records for its own bundling.
 *
 * THE TRIM IS LOAD-BEARING for the same class of reason `chat-title.ts`
 * documents for titles: an absent field and a whitespace-only one are the same
 * fact ("no label"), and a `"   "` that won the precedence would blank the name
 * a surface shows. The SLUG is deliberately not trimmed: it is a key, not
 * prose, and a key that renders differently from the string the wire carries is
 * one surface disagreeing with every other about the same record.
 *
 * WHAT THIS IS NOT: an addressing helper. Nothing that writes - a command
 * argument, a binding, a catalogue key - may route through this function; the
 * label is local display metadata and must never reach the wire where a name is
 * expected. Every caller's own comment repeats that half for its site.
 */
export function teamDisplayName(row: {
	name: string;
	label?: string | null;
}): string {
	return row.label?.trim() || row.name;
}
