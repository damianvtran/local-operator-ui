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
import { replaceControlLabel } from "./integration-model";

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
	name: string;
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
	const { name, keyless, freeName, names, values, replace, canReplace } = input;
	if (keyless) {
		const reference = keylessReference(name, freeName);
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
 * itself. The id is the config's own internal name for the secret, and a field
 * for it would be a second question with only one useful answer.
 *
 * PER SERVER, AND THAT IS THE POINT (U15). The id is what the encrypted store is
 * keyed by, so deriving it from the header alone made two unrelated services
 * that both want `X-Api-Key` share ONE secret: the second one's write came back
 * `replace_confirmation_required`, the dialog had no control to answer it, and
 * answering it by overwriting would have broken the integration that worked.
 * The integration's own name is the part of the identity that differs, so it
 * leads and the header follows.
 */
export function keylessReference(serverName: string, header: string): string {
	const prefix = screaming(serverName);
	const suffix = screaming(header);
	/*
	 * NO HEADER, NO REFERENCE: the header is the field the write needs beside the
	 * value (`add_key`), so an empty one has to leave this empty and keep the Save
	 * button disabled rather than producing a name for a write that cannot happen.
	 */
	if (!suffix) return "";
	const combined = [prefix, suffix].filter(Boolean).join("_");
	const normalised = /^[A-Za-z_]/.test(combined) ? combined : `K_${combined}`;
	if (normalised.length <= MAX_REFERENCE_LENGTH) return normalised;
	/*
	 * The backend's own reference pattern caps the id at 128 characters
	 * (`SECRET_ID_RE` in `mcp/config.py`), and a config name can be 100.
	 * Truncating without more would let two servers whose names share a long
	 * prefix collide into one secret - the defect this whole function exists to
	 * fix - so the truncated name carries a digest of the FULL name: same server,
	 * same id, different servers, different ids.
	 */
	const digest = shortDigest(prefix);
	const room = MAX_REFERENCE_LENGTH - suffix.length - digest.length - 2;
	const tail = [prefix.slice(0, Math.max(room, 0)), digest, suffix]
		.filter(Boolean)
		.join("_");
	return tail.length <= MAX_REFERENCE_LENGTH
		? tail
		: tail.slice(-MAX_REFERENCE_LENGTH);
}

/** The backend's `SECRET_ID_RE` upper bound, verbatim. */
export const MAX_REFERENCE_LENGTH = 128;

/** A header or name as the reference alphabet spells it. */
const screaming = (text: string): string =>
	text
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");

/**
 * A short, stable digest of a string, for disambiguating a truncated reference.
 *
 * FNV-1a, spelled out rather than pulled in: the only requirement is that it is
 * deterministic and depends on the whole input, and a dependency for six
 * characters of base 36 would be worse than eleven lines.
 */
const shortDigest = (text: string): string => {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36).toUpperCase().slice(0, 5);
};

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
	const names = keyless ? [keylessReference(name, freeName)] : [...keyNames];
	/** The fields that hold secrets: the sentinel in keyless mode, the ids otherwise. */
	const fieldKeys = keyless ? [KEYLESS_VALUE_KEY] : names;
	const filled =
		(keyless ? keylessReference(name, freeName).length > 0 : true) &&
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
								name,
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
				 * `p-1.5` is the room a focused control's outline needs inside the scroll
				 * body, and it is ALL of the body's geometry: the negative margin that
				 * used to sit beside it made the body 12 px wider than the scroller, so
				 * the box was 404 px inside a 398 px area and the scroller drew a stray
				 * horizontal strip under the last control (n3). The prose carries its own
				 * `-mx-1.5` instead, which puts the TEXT on the title's edge without
				 * making anything overflow, and the controls sit one step in - 6 px, which
				 * is what the outline needs and is the shared-component indent the design
				 * round deferred as D20.
				 */
				className="flex flex-col gap-3 p-1.5 text-body text-ink-muted"
			>
				<p className="-mx-1.5">
					{keyless
						? "Keys are saved encrypted on this computer. This one is stored under a name derived from this integration, so no other server shares it."
						: "Keys are saved encrypted on this computer. Other integrations that use the same key name share it."}
				</p>
				{keyless ? (
					<div className="flex flex-col gap-1.5">
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
						<p className="-mx-1.5 text-ink-dim text-meta">
							This server declares no key of its own, so Local Operator adds one
							to its config for you.
						</p>
					</div>
				) : null}
				{fieldKeys
					.filter((key) => keyless !== true || key.trim().length > 0)
					.map((key) => (
						<div key={key} className="flex flex-col gap-1.5">
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
					<div className="flex items-center gap-2 text-body-sm">
						<Checkbox
							id="integration-key-replace"
							checked={replace}
							onCheckedChange={(checked) => setReplace(checked === true)}
						/>
						<Label htmlFor="integration-key-replace" className="font-normal">
							{/* One spelling of this label, shared with the sentence that
							    names it (`replaceControlLabel`). */}
							{replaceControlLabel(names.length)}
						</Label>
					</div>
				) : null}
				{failure ? (
					<p className="-mx-1.5 text-body-sm text-danger" role="alert">
						{failure}
					</p>
				) : null}
			</div>
		</BaseDialog>
	);
};
