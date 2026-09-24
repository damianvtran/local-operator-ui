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
	saving: boolean;
	failure: string | null;
	onSave: (values: Record<string, string>, confirmedReplace: string[]) => void;
	onClose: () => void;
};

export const IntegrationKeyDialog: FC<IntegrationKeyDialogProps> = ({
	name,
	keyNames,
	saving,
	failure,
	onSave,
	onClose,
}) => {
	const [values, setValues] = useState<Record<string, string>>({});
	const [replace, setReplace] = useState(false);
	const filled = keyNames.every((key) => (values[key] ?? "").trim());

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
						onClick={() => onSave(values, replace ? [...keyNames] : [])}
					>
						{saving ? "Saving…" : "Save and test"}
					</PrimaryButton>
				</>
			}
		>
			<div className="flex flex-col gap-3 p-1.5 text-body text-ink-muted">
				<p>
					Keys are saved encrypted on this computer. Other integrations that use
					the same key name share it.
				</p>
				{keyNames.map((key) => (
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
				<div className="flex items-center gap-2 text-body-sm">
					<Checkbox
						id="integration-key-replace"
						checked={replace}
						onCheckedChange={(checked) => setReplace(checked === true)}
					/>
					<Label htmlFor="integration-key-replace" className="font-normal">
						Replace saved values
					</Label>
				</div>
				{failure ? (
					<p className="text-body-sm text-danger" role="alert">
						{failure}
					</p>
				) : null}
			</div>
		</BaseDialog>
	);
};
