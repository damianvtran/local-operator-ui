/**
 * Which registry keys get a searchable combobox, and what each one searches.
 *
 * ## Why a keyed map rather than a new `Kind`
 *
 * `hosting`, `model_name` and `subagents.models.*` stay `Kind.TEXT`, on the
 * server and on the wire. The interaction is "type freely, with help" — which
 * is what TEXT already is — and the suggestions ASSIST rather than constrain: a
 * value no catalogue has ever heard of still coerces and saves exactly as
 * before. A new kind would force `coerce`, `validate` and the CLI to grow a
 * branch for a value space that is deliberately open, which is the argument the
 * TUI recorded when it shipped this same feature
 * (`local_operator/tui/widgets/settings_view.py`, `_SUGGEST_KEYS`).
 *
 * This is the sibling of `backend-settings-tiers.ts`, and it is a curated map
 * for the same reason: neither the source nor the placeholder can be inferred
 * from `kind` or from `label`. It differs from that map in what drift costs —
 * an unclassified key here falls through to the plain text field the row has
 * always rendered, which is correct, so there is no completeness assertion to
 * write. The assertion worth having is the inverse, and
 * `scripts/backend-setting-combos.test.mjs` makes it: every key named here is a
 * key the registry actually sends, so a rename cannot leave a stale entry that
 * silently stops doing anything.
 */

/** What a combobox row searches, i.e. which op feeds it. */
export type ComboKind = "provider" | "model" | "provider-model";

/**
 * The curated map, one line per key that gets a combobox.
 *
 * The KIND is decided by the shape the key STORES, which the three rows do not
 * agree on and which the backend does not normalise between:
 *
 * - `hosting` holds a bare provider id (`anthropic`);
 * - `model_name` holds a bare model id (`claude-opus-5`), NOT a
 *   `provider/model` selector — `/model default` splits its selector on the
 *   first `/` and writes the right-hand side here beside the left in `hosting`,
 *   because storing a selector would leave `model_name` holding
 *   `anthropic/claude-opus-5` under an `anthropic` hosting and boot a model id
 *   no provider owns;
 * - `subagents.models.*` holds the full `provider/model` selector, because
 *   `configured_effort_tiers` partitions each value on `/` and drops any value
 *   missing a side.
 *
 * A combobox that stores what it displays is therefore wrong for `model_name`,
 * and a combobox that stores a bare id is wrong for the subagent tiers. The
 * component already separates the two (`option.id` is stored, `option.name` is
 * shown), which is why this map only has to say which shape each key is.
 */
export const SETTING_COMBOS: Record<string, ComboKind> = {
	hosting: "provider",
	model_name: "model",
	"subagents.models.lo": "provider-model",
	"subagents.models.med": "provider-model",
	"subagents.models.hi": "provider-model",
};

/** The source for one key, or null for a key that keeps the plain text field. */
export function settingComboSource(key: string): ComboKind | null {
	return SETTING_COMBOS[key] ?? null;
}

/**
 * The field's placeholder, from the row's SOURCE and never from
 * `setting.placeholder`.
 *
 * Two reasons, and the second is the trap. The wire sends no `placeholder`
 * (`server/routes/settings.py::_view`) — the field is projected without one —
 * so a placeholder read from the row would be absent in the shipped app. It is
 * present in the Storybook fixtures, which carry `placeholder`, `warning` and
 * `gated_by` that the released `_view` does not project, so a placeholder taken
 * from the row would look right in every committed frame and be missing for
 * every user. "Search models" is the phrase the chat picker's own field already
 * uses, so this reuses a sentence rather than inventing one.
 */
export const COMBO_PLACEHOLDER: Record<ComboKind, string> = {
	provider: "Search providers",
	model: "Search models",
	"provider-model": "Search models",
};
