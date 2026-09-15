/**
 * Masked MCP key entry for declared secret IDs, never header/environment field
 * names. The owner writes its encrypted store through a dedicated off-record
 * operation. No provider API, config mutation, browser history, or key cache.
 * Values survive refusal in this mounted form and are cleared on close/target
 * change; connection success, not persistence alone, is the closing condition.
 */

import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { DialogDescription, Input, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import { useEffect, useState } from "react";

/** The server this dialog is for, and the field names its config declares. */
export type McpKeyTarget = {
	name: string;
	keyNames: readonly string[];
};

export type McpKeyDialogProps = {
	open: boolean;
	target: McpKeyTarget | null;
	/** True while the credentials are being written and the server reconnected. */
	saving: boolean;
	/** The backend's own sentence for a failed write, or `null`. */
	error: string | null;
	onCancel: () => void;
	/**
	 * Write these credentials and reconnect the server.
	 *
	 * Owned by `use-mcp-remedy.ts` rather than by this component: the panel has one
	 * place that starts operations, and a second writer here would be a second place
	 * for the reconnect and the cache write to drift.
	 */
	onSave: (values: Record<string, string>, confirmedReplace?: string[]) => void;
};

/** One id per field, named once and shared by label, control and help text. */
const fieldId = (name: string) => `mcp-key-${name}`;

export const McpKeyDialog: FC<McpKeyDialogProps> = ({
	open,
	target,
	saving,
	error,
	onCancel,
	onSave,
}) => {
	const [values, setValues] = useState<Record<string, string>>({});
	const [replace, setReplace] = useState(false);
	const keyNames = target?.keyNames ?? [];

	/*
	 * Cleared on every open, and on a change of server: a password field is the one
	 * control whose contents cannot be read back, so a value left behind would be
	 * saved against the wrong server by the next press without anyone seeing it.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: open/target are the reset triggers, not read values
	useEffect(() => {
		setValues({});
		setReplace(false);
	}, [open, target?.name]);

	const filled = keyNames.every(
		(name) => (values[name] ?? "").trim().length > 0,
	);

	return (
		<BaseDialog
			open={open}
			onClose={onCancel}
			maxWidth="sm"
			title={
				keyNames.length === 1
					? `Enter the key for ${target?.name ?? ""}`
					: `Enter the credentials for ${target?.name ?? ""}`
			}
			actions={
				<>
					<SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
					<PrimaryButton
						onClick={() => onSave(values, replace ? [...keyNames] : [])}
						disabled={!filled || saving}
					>
						{saving ? "Saving…" : "Save and reconnect"}
					</PrimaryButton>
				</>
			}
		>
			<DialogDescription asChild>
				{/*
				 * `p-1.5` is not decoration: the dialog's scroll body (`base-dialog.tsx:142`)
				 * is `overflow-y-auto` with no padding of its own, so a control flush with its
				 * edge has its focus ring clipped to whichever segment has room — this field
				 * rendered a top-only accent line instead of a ring (design review round 1,
				 * D2). 6px is the 2px outline plus its 2px offset, with a pixel to spare.
				 */}
				<div
					className={cn("flex flex-col gap-3 p-1.5 text-body text-ink-muted")}
				>
					<p>
						{/*
						 * A claim about what this dialog DOES, not about what the runtime will do
						 * with the value. Reference resolution is a backend capability this build
						 * cannot assume (`docs/run-sidebar.md` § 13), so the copy promises the
						 * store and the reconnect and nothing further — and the outcome is stated
						 * by the write's own result instead: `use-mcp-remedy.pressKey` reads the
						 * returned snapshot and says the server still needs sign-in when it does,
						 * which is true against a backend with the resolver and one without it.
						 */}
						Saved to the encrypted secret store, then this server is
						reconnected. These keys may be shared by other servers and sessions.
					</p>
					{keyNames.map((name) => (
						<div key={name} className="flex flex-col gap-1">
							<Label htmlFor={fieldId(name)} className="font-mono text-meta">
								{name}
							</Label>
							<Input
								id={fieldId(name)}
								type="password"
								autoComplete="off"
								value={values[name] ?? ""}
								onChange={(event) =>
									setValues((previous) => ({
										...previous,
										[name]: event.target.value,
									}))
								}
							/>
						</div>
					))}
					<label className="flex items-start gap-2 text-body-sm">
						<input
							type="checkbox"
							checked={replace}
							onChange={(event) => setReplace(event.target.checked)}
						/>
						Replace existing values for these shared keys.
					</label>
					{error ? (
						<p className="text-body-sm text-danger" role="alert">
							{error}
						</p>
					) : null}
				</div>
			</DialogDescription>
		</BaseDialog>
	);
};
