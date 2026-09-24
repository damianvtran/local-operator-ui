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
	const filled =
		(keyless ? keylessReference(freeName).length > 0 : true) &&
		keyNames.every((key) => (values[key] ?? "").trim()) &&
		names.every((key) => (values[key] ?? "").trim());
	const canReplace = names.some((key) => savedKeys.includes(key));

	return (
		<BaseDialog
			open
			onClose={onClose}
			maxWidth="xs"
			title={
				keyNames.length === 1
					? `Add the key for ${name}`
					: `Add keys for ${name}`
			}
			actions={
				<>
					<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
					<PrimaryButton
						disabled={!filled || saving}
						onClick={() => onSave(values, replace && canReplace ? names : [])}
					>
						{saving ? "Saving…" : "Save and test"}
					</PrimaryButton>
				</>
			}
		>
			<div className="-mx-1.5 flex flex-col gap-3 p-1.5 text-body text-ink-muted">
				<p>
					Keys are saved encrypted on this computer. Other integrations that use
					the same key name share it.
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
						<p className="text-ink-dim text-meta">
							This server declares no key of its own, so Local Operator adds one
							to its config for you.
						</p>
					</div>
				) : null}
				{names
					.filter((key) => keyless !== true || key.trim().length > 0)
					.map((key) => (
						<div key={key} className="flex flex-col gap-1.5">
							<Label htmlFor={`integration-key-${key}`} className="font-mono">
								{key}
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
