import { CREDENTIAL_MANIFEST } from "@features/settings/components/credential-manifest";
import type { CredentialUpdate } from "@shared/api/local-operator/types";
import { BaseDialog } from "@shared/components/common/base-dialog";
import { Spinner } from "@shared/components/common/spinner";
import {
	Button,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { useEffect, useState } from "react";
import type { FC } from "react";
import { InfoItem } from "./settings-section";

/**
 * Sentinel for the "custom credential" row. It is not a credential key, so it
 * can never collide with one from the manifest or from `existingKeys`.
 */
const CUSTOM_KEY_OPTION = "_custom_";

/*
 * Ids are named once and shared by the label, the control, and its help text.
 * A typo in an inline `htmlFor` string breaks the association silently — the
 * field still looks labelled, and only a screen reader finds out otherwise.
 */
const CUSTOM_KEY_INPUT_ID = "credential-custom-key";
const CUSTOM_KEY_ERROR_ID = "credential-custom-key-error";
const TYPE_SELECT_ID = "credential-type";
const TYPE_HELP_ID = "credential-type-help";
const VALUE_INPUT_ID = "credential-value";
const VALUE_HELP_ID = "credential-value-help";

/**
 * Dialog for adding or editing a credential
 */
export type CredentialDialogProps = {
	open: boolean;
	onClose: () => void;
	onSave: (update: CredentialUpdate) => void;
	/** Key being edited, or a pre-selected key when adding */
	initialKey?: string;
	existingKeys: string[];
	isSaving: boolean;
	/** Differentiates between add and edit modes */
	isEditMode: boolean;
};

/**
 * Add or edit a single credential.
 *
 * Every control is bound to a `Label` by id. A dialog form is the one place a
 * missing label is unrecoverable: there is no surrounding page text for a
 * screen reader to fall back on, and the value field is a password input whose
 * contents cannot be read back.
 *
 * Invalid state is carried by `aria-invalid` alone — the `Input` primitive
 * paints its border from that attribute, so the red edge and the announced
 * error can never disagree.
 */
export const CredentialDialog: FC<CredentialDialogProps> = ({
	open,
	onClose,
	onSave,
	initialKey = "",
	existingKeys,
	isSaving,
	isEditMode,
}) => {
	const [key, setKey] = useState(initialKey); // For Select dropdown
	const [value, setValue] = useState(""); // Credential value (password)
	const [customKey, setCustomKey] = useState(""); // For custom key input
	const [useCustomKey, setUseCustomKey] = useState(false); // Toggle for custom key field

	// Reset state when dialog opens or initialKey/isEditMode changes
	useEffect(() => {
		if (open) {
			const isManifestKey = CREDENTIAL_MANIFEST.some(
				(cred) => cred.key === initialKey,
			);
			const shouldInitCustom = !isEditMode && initialKey && !isManifestKey;

			setKey(isManifestKey ? initialKey : ""); // Set Select value only if it's in manifest
			setValue(""); // Always clear value on open
			setCustomKey(shouldInitCustom ? initialKey : ""); // Set custom key if adding non-manifest key
			setUseCustomKey(shouldInitCustom || (isEditMode && !isManifestKey)); // Use custom field if editing non-manifest or adding custom
		}
	}, [open, initialKey, isEditMode]);

	const handleSave = () => {
		// Determine the final key based on whether it's edit mode or add mode (custom/select)
		let finalKey = "";
		if (isEditMode) {
			finalKey = initialKey; // Key cannot be changed in edit mode
		} else {
			finalKey = useCustomKey ? customKey.trim() : key;
		}

		if (!finalKey) {
			console.error("No key provided for credential");
			return; // Should ideally show validation message
		}
		if (!value.trim()) {
			console.error("No value provided for credential");
			return; // Should ideally show validation message
		}

		onSave({ key: finalKey, value });
	};

	// Check if a key (from select or custom input) already exists (excluding the one being edited)
	const isExistingKey = (k: string) =>
		existingKeys.includes(k) && k !== initialKey;

	const isCustomKeyTaken = isExistingKey(customKey);

	// Validation logic
	const isKeyValid = isEditMode
		? true // Key is fixed in edit mode
		: useCustomKey
			? customKey.trim() !== "" && !isCustomKeyTaken // Custom key must be non-empty and not exist
			: key !== "" && !isExistingKey(key); // Selected key must be non-empty and not exist

	const isValueValid = value.trim() !== "";
	const canSave = isKeyValid && isValueValid && !isSaving;

	// Find details for the selected manifest credential (if any)
	const selectedCredentialManifest = CREDENTIAL_MANIFEST.find(
		(cred) => cred.key === key,
	);
	const showCredentialHelp =
		Boolean(selectedCredentialManifest) && !useCustomKey;

	const dialogTitle = isEditMode ? "Update credential" : "Add new credential";

	const dialogActions = (
		<>
			<Button variant="secondary" onClick={onClose}>
				Cancel
			</Button>
			<Button variant="primary" onClick={handleSave} disabled={!canSave}>
				{/*
				 * The spinner's accent quadrant would be accent-on-accent inside a
				 * filled primary button, so the moving edge is re-pointed at the
				 * ink role that fill already guarantees contrast for. No `label`:
				 * the button's own text says what is happening.
				 */}
				{isSaving && <Spinner size="sm" className="border-t-on-accent" />}
				{isSaving ? "Saving..." : "Save"}
			</Button>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
		>
			<div className="flex flex-col gap-4">
				{isEditMode ? (
					/*
					 * Read-only in edit mode, so it is a label/value pair rather than a
					 * field. The quieter `InfoItem` label is the signal: a form label
					 * here would promise an editable key. The key itself is an
					 * identifier, hence machine voice.
					 */
					<InfoItem
						label="Credential key"
						value={<span className="text-mono-sm">{initialKey}</span>}
					/>
				) : (
					<>
						<div className="flex flex-col gap-2">
							<Label htmlFor={TYPE_SELECT_ID}>Credential type</Label>
							<Select
								value={useCustomKey ? CUSTOM_KEY_OPTION : key}
								onValueChange={(selectedValue) => {
									if (selectedValue === CUSTOM_KEY_OPTION) {
										setUseCustomKey(true);
										setKey("");
									} else {
										setUseCustomKey(false);
										setKey(selectedValue);
										setCustomKey("");
									}
								}}
							>
								<SelectTrigger
									id={TYPE_SELECT_ID}
									aria-describedby={
										showCredentialHelp ? TYPE_HELP_ID : undefined
									}
								>
									{/*
									 * An empty `value` shows this placeholder; the dropdown no
									 * longer carries a disabled empty row, which was never a
									 * choice a user could make.
									 */}
									<SelectValue placeholder="Select a credential type" />
								</SelectTrigger>
								<SelectContent>
									{CREDENTIAL_MANIFEST.filter((cred) => !cred.internal).map(
										(cred) => (
											<SelectItem
												key={cred.key}
												value={cred.key}
												disabled={isExistingKey(cred.key)}
											>
												{cred.name}
												{isExistingKey(cred.key) && " (configured)"}
											</SelectItem>
										),
									)}
									<SelectItem value={CUSTOM_KEY_OPTION}>
										Custom credential
									</SelectItem>
								</SelectContent>
							</Select>

							{/*
							 * The manifest blurb and its sign-up link used to sit in a
							 * filled, bordered well inside an already bordered dialog.
							 * It is help text for the select above it, so it reads as help
							 * text and the gap does the separating.
							 */}
							{showCredentialHelp && selectedCredentialManifest && (
								<div
									id={TYPE_HELP_ID}
									className="flex flex-col items-start gap-1"
								>
									<p className="text-meta text-ink-dim">
										{selectedCredentialManifest.description}
									</p>
									{selectedCredentialManifest.url && (
										<a
											href={selectedCredentialManifest.url}
											target="_blank"
											rel="noopener noreferrer"
											className="text-accent text-meta underline-offset-4 hover:text-accent-hover hover:underline"
										>
											Get your {selectedCredentialManifest.name} key
										</a>
									)}
								</div>
							)}
						</div>

						{useCustomKey && (
							<div className="flex flex-col gap-2">
								<Label htmlFor={CUSTOM_KEY_INPUT_ID}>
									Custom credential key
								</Label>
								<Input
									id={CUSTOM_KEY_INPUT_ID}
									value={customKey}
									onChange={(e) => setCustomKey(e.target.value)}
									aria-invalid={isCustomKeyTaken || undefined}
									aria-describedby={
										isCustomKeyTaken ? CUSTOM_KEY_ERROR_ID : undefined
									}
									required
									// Focused because it only appears in response to choosing
									// "Custom credential", and it is then the next thing to fill.
									autoFocus
								/>
								{isCustomKeyTaken && (
									<p id={CUSTOM_KEY_ERROR_ID} className="text-danger text-meta">
										This credential already exists
									</p>
								)}
							</div>
						)}
					</>
				)}

				<div className="flex flex-col gap-2">
					<Label htmlFor={VALUE_INPUT_ID}>Credential value</Label>
					<Input
						id={VALUE_INPUT_ID}
						type="password"
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && canSave) {
								handleSave();
							}
						}}
						aria-describedby={isEditMode ? VALUE_HELP_ID : undefined}
						required
						autoFocus={isEditMode}
						placeholder="Enter the credential value or API key"
					/>
					{/*
					 * Only in edit mode, where it names which credential is being
					 * replaced. In add mode the help text repeated the placeholder
					 * word for word.
					 */}
					{isEditMode && (
						<p id={VALUE_HELP_ID} className="text-ink-dim text-meta">
							Enter the new value for {initialKey}
						</p>
					)}
				</div>
			</div>
		</BaseDialog>
	);
};
