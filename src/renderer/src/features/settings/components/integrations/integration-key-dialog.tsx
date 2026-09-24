/**
 * Adding the key(s) an integration's config references, from Settings.
 *
 * Not the run panel's `McpKeyDialog`: that one ends every failure with "Open
 * this server in Settings", which from Settings is a link to the page the
 * reader is already on (UX walk flow 4, step 25). Same store, same bound, same
 * masked fields - only the way out differs, so the form is small enough to
 * keep as its own rather than threading a "we are already there" flag through
 * the shared one.
 */

import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Checkbox, Input, Label } from "@shared/components/ui";
import { type FC, useState } from "react";

export type IntegrationKeyDialogProps = {
	name: string;
	/** The reference ids the config declares, e.g. `NOTION_TOKEN`. */
	keyNames: readonly string[];
	/**
	 * Whether the config declares NO reference for this server.
	 *
	 * The backend offers `set_key` when the config names a reference, so a
	 * server added by URL that turns out to want a key - a plain 401 with no
	 * OAuth metadata - offers nothing to fill in. That is the dead end UX round 1
	 * recorded as U3: the row said "Needs a key" and the only control was Sign
	 * in. In this mode the dialog asks for the NAME as well, and the value is
	 * stored under it.
	 */
	keyless?: boolean;
	/**
	 * The references that already hold a stored value, so the replace checkbox
	 * is offered only when there is something to replace (D10).
	 */
	savedKeys?: readonly string[];
	saving: boolean;
	failure: string | null;
	/**
	 * `header` is present only in keyless mode: the HTTP header the key travels
	 * in, which the backend binds to the one id in `values` (contract #1511
	 * `aa927158a`).
	 */
	onSave: (
		values: Record<string, string>,
		confirmedReplace: string[],
		header?: string,
	) => void;
	onClose: () => void;
};

/**
 * What the dialog hands `onSave` when Save is pressed.
 *
 * WHY THIS IS A FUNCTION AND NOT AN INLINE EXPRESSION. The header is the third
 * argument, and a dropped argument here is invisible: the dialog closes, the
 * backend takes its `set_key` path, refuses with `invalid_target`, and the page
 * blames the store. That is exactly what shipped in round 1 - the call site read
 * `onSave(values, replace && canReplace ? names : [])` while the parameter was
 * added downstream - so the buttons' arguments now come from one place a test
 * can call (R2-1, round 2).
 */
/**
 * The field key the keyless mode's secret is typed into.
 *
 * A FIXED sentinel rather than the derived `${ID}`, because the id follows the
 * header as the user types it: binding the field to the derived name meant
 * editing the header after typing the key left the secret under the old id and
 * the Save button disabled with no way to see why. Real references are upper
 * case, so this can never collide with one.
 */
export const KEYLESS_VALUE_KEY = "key";

export function keyDialogSave(input: {
	keyless: boolean;
	freeName: string;
	names: string[];
	values: Record<string, string>;
	replace: boolean;
	canReplace: boolean;
}): {
	values: Record<string, string>;
	confirmedReplace: string[];
	header: string | undefined;
} {
	const { keyless, freeName, names, values, replace, canReplace } = input;
	if (keyless) {
		const reference = keylessReference(freeName);
		return {
			// Exactly one id, which is what the backend's `add_key` path requires
			// beside a `header`.
			values: { [reference]: (values[KEYLESS_VALUE_KEY] ?? "").trim() },
			confirmedReplace: replace && canReplace ? [reference] : [],
			header: freeName.trim(),
		};
	}
	return {
		values: Object.fromEntries(
			names.map((key) => [key, (values[key] ?? "").trim()]),
		),
		confirmedReplace: replace && canReplace ? names : [],
		header: undefined,
	};
}

/**
 * The `${ID}` a keyless write binds its header to.
 *
 * The backend wants exactly one id in `values` and writes
 * `headers[header] = "${ID}"` with it, so the page has to name the reference
 * itself. Derived from the header rather than asked for separately: the id is
 * the config's own internal name for the secret, and a field for it would be a
 * second question with only one useful answer. The `${ID}` syntax is
 * `[A-Za-z_][A-Za-z0-9_]*`, which is what the normalisation guarantees.
 */
export function keylessReference(header: string): string {
	const normalised = header
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (!normalised) return "";
	return /^[A-Z_]/.test(normalised) ? normalised : `K_${normalised}`;
}

export const IntegrationKeyDialog: FC<IntegrationKeyDialogProps> = ({
	name,
	keyNames,
	keyless = false,
	savedKeys = [],
	saving,
	failure,
	onSave,
	onClose,
}) => {
	const [values, setValues] = useState<Record<string, string>>({});
	const [replace, setReplace] = useState(false);
	/*
	 * The keyless mode's single field pair: the name the credential is stored
	 * under, and its value. `names` is what the rest of this component iterates,
	 * so the two modes share one rendering path.
	 */
	const [freeName, setFreeName] = useState("");
	const names = keyless ? [keylessReference(freeName)] : [...keyNames];
	/** The fields that hold secrets: the sentinel in keyless mode, the ids otherwise. */
	const fieldKeys = keyless ? [KEYLESS_VALUE_KEY] : names;
	const filled =
		(keyless ? keylessReference(freeName).length > 0 : true) &&
		fieldKeys.every((key) => (values[key] ?? "").trim());
	const canReplace = names.some((key) => savedKeys.includes(key));

	return (
		<BaseDialog
			open
			onClose={onClose}
			maxWidth="xs"
			title={
				keyless || keyNames.length === 1
					? `Add the key for ${name}`
					: `Add keys for ${name}`
			}
			actions={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<PrimaryButton
						disabled={!filled || saving}
						onClick={() => {
							const payload = keyDialogSave({
								keyless,
								freeName,
								names,
								values,
								replace,
								canReplace,
							});
							onSave(payload.values, payload.confirmedReplace, payload.header);
						}}
					>
						{saving ? "Saving…" : "Save and test"}
					</PrimaryButton>
				</>
			}
		>
			<div
				/*
				 * `p-1.5 -mx-1.5` is D7's pair: the negative margin puts the prose on
				 * the title's edge and the padding is the room a focused control's
				 * outline needs inside the scroll body. The controls carry their own
				 * `px-1.5` (D12, round 2) so that room survives: with the body's
				 * negative margin the control used to span the container's content
				 * box exactly, and the ring's left and right sides were clipped away.
				 */
				className="-mx-1.5 flex flex-col gap-3 p-1.5 text-body text-ink-muted"
			>
				<p>
					Keys are saved encrypted on this computer. Other integrations that use
					the same key name share it.
				</p>
				{keyless ? (
					<div className="flex flex-col gap-1.5 px-1.5">
						<Label htmlFor="integration-key-name">
							The header this server wants the key in
						</Label>
						<Input
							id="integration-key-name"
							autoComplete="off"
							placeholder="e.g. Authorization or X-Api-Key"
							value={freeName}
							onChange={(event) => setFreeName(event.target.value)}
						/>
						<p className="text-ink-dim text-meta">
							This server declares no key of its own, so Local Operator adds one
							to its config for you.
						</p>
					</div>
				) : null}
				{fieldKeys
					.filter((key) => keyless !== true || key.trim().length > 0)
					.map((key) => (
						<div key={key} className="flex flex-col gap-1.5 px-1.5">
							<Label htmlFor={`integration-key-${key}`} className="font-mono">
								{keyless ? "Key" : key}
							</Label>
							<Input
								id={`integration-key-${key}`}
								type="password"
								autoComplete="off"
								value={values[key] ?? ""}
								onChange={(event) =>
									setValues((previous) => ({
										...previous,
										[key]: event.target.value,
									}))
								}
							/>
						</div>
					))}
				{/*
				 * Only when there IS a saved value for one of these keys (D10):
				 * "Replace saved values" (plural) named a thing the user had not
				 * made and could not see.
				 */}
				{canReplace ? (
					<div className="flex items-center gap-2 px-1.5 text-body-sm">
						<Checkbox
							id="integration-key-replace"
							checked={replace}
							onCheckedChange={(checked) => setReplace(checked === true)}
						/>
						<Label htmlFor="integration-key-replace" className="font-normal">
							{names.length === 1
								? "Replace the saved key"
								: "Replace saved keys"}
						</Label>
					</div>
				) : null}
				{failure ? (
					<p className="text-body-sm text-danger" role="alert">
						{failure}
					</p>
				) : null}
			</div>
		</BaseDialog>
	);
};
