/**
 * The draft model behind one settings row: what a draft IS, whether it differs
 * from the server, and what request it becomes.
 *
 * Why this is its own module rather than three helpers inside the row. The
 * section has to be able to answer two questions the row cannot answer alone —
 * "how many unsaved changes are there on this page" and "save them all" — and
 * both have to work for a section the reader has COLLAPSED, whose rows are no
 * longer mounted. So the draft lives in the section's state and the row is a
 * controlled view over it: one source of truth, drafts that survive a collapse
 * instead of being silently discarded with the row, and a `Save all` that is the
 * same code path as a single row's Save rather than a second implementation of
 * the wire request.
 *
 * What this deliberately does NOT change: the save model. Draft plus an explicit
 * Save, per kind, exactly as before. Instant apply was considered and rejected —
 * the audit's own reading is that the conservative model is not the thing to fix
 * (Primer: never mix save patterns in a single form), and the defect was that it
 * was SILENT, not that it was explicit.
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import type { DesktopRequest } from "../../../../../shared/desktop-contract";

/** The cascade editor's sentinel: no chain edit yet, so nothing to submit. */
export const CASCADE_SENTINEL = "__cascade__";

/** What a row's unsaved edit consists of. */
export type SettingDraft = {
	/** The serialized draft value, compared against the server's for dirty. */
	value: string;
	/**
	 * Cascade edits keep the base chains the reader started from, so a merge
	 * never flattens a concurrent terminal edit or stored effort metadata.
	 */
	cascadeBase: Record<string, string[]> | null;
};

/**
 * The wire's JSON spelling of a value.
 *
 * `null` and `undefined` both serialize to the empty string, which is what makes
 * an unset text field compare equal to an empty one rather than reading as
 * dirty on first paint.
 */
export function serialize(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** The draft a row starts from, given the server's projection of it. */
export function draftFromSetting(setting: BackendSetting): SettingDraft {
	return {
		value:
			setting.kind === "list"
				? ((setting.value as string[] | null) ?? []).join("\n")
				: setting.kind === "cascade"
					? CASCADE_SENTINEL
					: serialize(setting.value),
		cascadeBase: null,
	};
}

/** Whether a draft would write something the server does not already hold. */
export function isDraftDirty(
	setting: BackendSetting,
	draft: SettingDraft,
): boolean {
	if (draft.cascadeBase !== null) return true;
	if (setting.kind === "cascade") return draft.value !== CASCADE_SENTINEL;
	if (setting.kind === "list") {
		return draft.value !== (setting.value as string[] | null)?.join("\n");
	}
	return draft.value !== serialize(setting.value);
}

/** A submit outcome: the request to send, or the reason it cannot be built. */
export type EditOutcome =
	| { ok: true; request: DesktopRequest }
	| { ok: false; error: string };

/**
 * The request a draft becomes, or the reason it is not writable.
 *
 * Failure is a VALUE rather than a thrown error because the caller has to show
 * the sentence beside the row it belongs to, and a rejected promise loses which
 * field it was about.
 */
export function editOutcome(
	setting: BackendSetting,
	draft: SettingDraft,
): EditOutcome {
	// JSON is the wire type, and `undefined` is the one value the vocabulary
	// refuses, so every branch below assigns a JSON value.
	let value: unknown = null;
	let base: Record<string, string[]> | undefined;
	switch (setting.kind) {
		case "bool":
			value = draft.value === "true";
			break;
		case "int": {
			const parsed = Number.parseInt(draft.value, 10);
			if (Number.isNaN(parsed)) {
				return { ok: false, error: "Enter a whole number." };
			}
			value = parsed;
			break;
		}
		case "float": {
			const parsed = Number.parseFloat(draft.value);
			if (!Number.isFinite(parsed)) {
				return { ok: false, error: "Enter a finite number." };
			}
			value = parsed;
			break;
		}
		case "enum": {
			// Preserve the choice's declared type identity: "1" the string and 1
			// the integer are different enum values on the backend.
			const choice = setting.choices.find(
				(candidate) => serialize(candidate.value) === draft.value,
			);
			value = choice ? choice.value : draft.value;
			break;
		}
		case "list":
			value = draft.value
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
			break;
		case "cascade": {
			if (!draft.cascadeBase) {
				return { ok: false, error: "Nothing has been edited yet." };
			}
			const chains: Record<string, string[]> = {};
			for (const [key, entry] of Object.entries(draft.cascadeBase)) {
				chains[key] = entry;
			}
			value = chains;
			base = (setting.value ?? undefined) as
				| Record<string, string[]>
				| undefined;
			break;
		}
		default:
			/*
			 * An emptied field is the EMPTY STRING on the wire, never `null`.
			 *
			 * A hotkey is a string on the wire like any other text field, and
			 * `empty_unsets` is how the registry spells "an empty value means the
			 * default": both are properties of the FIELD, not of the kind. The
			 * route owns which of the two an empty string MEANS - it resets a key
			 * whose registry row sets `empty_unsets` and stores the empty string on
			 * one that does not - so this layer's job is only to spell "empty" the
			 * way the route reads it (`server/routes/settings.py`'s `edit_setting`
			 * tests `edit.value == ""`), which is also how the TUI clears a
			 * setting (`settings_io.reset_setting`).
			 *
			 * This arm used to write `null` for an `empty_unsets` row. `null` is not
			 * a value the text validator accepts - it answers "expected text" - so
			 * an emptied field was rejected by the backend with a raw validator
			 * string, on EVERY `empty_unsets` text row, long before the settings
			 * comboboxes existed and by the plain `<Input>` these rows shipped
			 * with. What the comboboxes changed is how easy the empty state is to
			 * reach: they added a one-click clear affordance, so a path that was
			 * previously "select all, delete" became a button that always lands in
			 * it. Fixed here, in the layer every `empty_unsets` row passes through,
			 * rather than at the call site that made it visible (QA round 1, Q1).
			 *
			 * The two outcomes stay distinct: this is the CLEAR, and text that
			 * simply matched no listing is committed as itself by the branch below.
			 */
			if (setting.empty_unsets && draft.value.trim() === "") {
				value = "";
			} else {
				value = draft.value;
			}
	}
	return {
		ok: true,
		request: {
			op: "settings.edit",
			key: setting.key,
			// The switch above resolves every kind to a JSON value, which is what
			// the vocabulary's refined-unknown arm accepts; the cast is at the
			// boundary, not smuggled through the branches.
			value: value as never,
			...(base ? { base } : {}),
		},
	};
}
