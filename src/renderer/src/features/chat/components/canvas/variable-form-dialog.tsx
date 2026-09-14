import {
	DesktopControlError,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import type {
	SessionVariable,
	VariableType,
	VariableWrite,
} from "@shared/api/local-operator/session-variables-api";
import { VARIABLE_TYPES } from "@shared/api/local-operator/session-variables-api";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
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
	Textarea,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Info, Save, SquareX } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";

/**
 * The dialog's props, typed by what the SESSION surface accepts.
 *
 * `VariableWrite` is the transport's own shape, and `VARIABLE_TYPES` is the
 * transport's own table - both imported rather than restated, because the
 * table this form used to hold named `string`, `boolean`, `object` and
 * `array` while the write path could coerce none of the four: every value the
 * select defaulted to was refused by the worker, and nothing said so until the
 * user pressed Create.
 */
type VariableFormDialogProps = {
	open: boolean;
	onClose: () => void;
	onSubmit: (data: VariableWrite) => Promise<void>;
	initialData?: SessionVariable | null;
};

// Represents the form state.
type FormDataType = {
	key: string;
	value: string; // Store value as string initially for text input
	type: VariableType;
};

const isVariableType = (type: string): type is VariableType =>
	(VARIABLE_TYPES as readonly string[]).includes(type);

/**
 * Which control a refusal is asking the user to change.
 *
 * A refusal already says WHY it refused, in the backend's own words, and it
 * reached the user as a floating toast - which names the reason but not the
 * field it is about, so for `already_exists` the user had to work out which of
 * three controls the sentence meant. The backend's `code` is the part that
 * knows, so it is mapped here once. Every code not listed is about the write as
 * a whole (no kernel, a busy cell, a cold session) or about a name the panel
 * did not offer to write; those stay a form-level sentence rather than being
 * blamed on a field that is not wrong.
 */
const REFUSAL_FIELD: Record<string, "key" | "value"> = {
	already_exists: "key",
	reserved_name: "key",
	invalid_name: "key",
	invalid_value: "value",
	too_large: "value",
};

/** The refusal the dialog is currently showing, if any. */
type Refusal = { code?: string; message: string };

const refusalOf = (error: unknown): Refusal => ({
	code: error instanceof DesktopControlError ? error.code : undefined,
	message: userFacingMessage(
		error,
		"The variable could not be saved. Try again.",
	),
});

const getDefaultFormState = (
	initialData?: SessionVariable | null,
): FormDataType => {
	if (initialData) {
		const type = isVariableType(initialData.type) ? initialData.type : "str";
		/*
		 * A `list` or `dict` is read back as a Python repr (`{'late_days': 7}`),
		 * which JSON cannot parse - and the write path parses exactly JSON. So
		 * those two types start empty, with the field's own hint asking for the
		 * structure, rather than pre-filled with text the form would then have to
		 * refuse. The scalar types round-trip as the text they were read as.
		 */
		const structured = type === "list" || type === "dict";
		return {
			key: initialData.key,
			type,
			value: structured ? "" : String(initialData.value),
		};
	}
	return {
		key: "",
		type: "str",
		value: "",
	};
};

/**
 * Marks a field the form will not submit without. The asterisk carries the
 * colour; `required` on the control is what actually tells assistive tech.
 */
const RequiredMark: FC = () => (
	<span className={cn("text-danger")} aria-hidden="true">
		*
	</span>
);

/**
 * VariableFormDialog component
 * A dialog for creating or editing agent execution variables.
 */
export const VariableFormDialog: FC<VariableFormDialogProps> = ({
	open,
	onClose,
	onSubmit,
	initialData,
}) => {
	const [formData, setFormData] = useState<FormDataType>(
		getDefaultFormState(initialData),
	);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [refusal, setRefusal] = useState<Refusal | null>(null);

	const isEditMode = !!initialData;

	useEffect(() => {
		if (open) {
			setFormData(getDefaultFormState(initialData));
			setRefusal(null);
		}
	}, [open, initialData]);

	const handleSubmit = async () => {
		setIsSubmitting(true);
		setRefusal(null);
		try {
			const variableToSubmit: VariableWrite = {
				key: formData.key,
				type: formData.type,
				value: formData.value,
			};

			await onSubmit(variableToSubmit);
			onClose(); // Success toast is handled by the mutation hooks
		} catch (error) {
			/*
			 * No toast here. The mutation hook owns the sentence, because the
			 * refusal's reason (a reserved name, a value the type cannot coerce, a
			 * kernel that is busy) is written by the backend that knows it - and a
			 * second toast from this layer said the same thing twice, in weaker
			 * words. The dialog stays open AND repeats that same sentence beside the
			 * control it is about, which is where the fix is: a toast floats past,
			 * the field it names is still on screen when the user looks back.
			 */
			console.error("Failed to submit variable:", error);
			setRefusal(refusalOf(error));
		} finally {
			setIsSubmitting(false);
		}
	};

	const refusalField = refusal?.code ? REFUSAL_FIELD[refusal.code] : undefined;

	/*
	 * One vocabulary for the whole surface: the panel says "Code memory" and lists
	 * "variables", so the dialog says "New variable" / "Edit variable" and its
	 * buttons say "Create" / "Save". The dialog previously titled itself "Create
	 * execution variable" - the backend's term for the legacy agent-scoped
	 * surface this PR deletes, and a word the tour never uses.
	 */
	const dialogTitle = isEditMode ? "Edit variable" : "New variable";

	const dialogActions = (
		<>
			<SecondaryButton
				onClick={onClose}
				disabled={isSubmitting}
				startIcon={<SquareX size={18} aria-hidden="true" />}
			>
				Cancel
			</SecondaryButton>
			<PrimaryButton
				onClick={() => void handleSubmit()}
				disabled={isSubmitting || !formData.key.trim()}
				startIcon={
					isSubmitting ? <Spinner /> : <Save size={18} aria-hidden="true" />
				}
			>
				{isSubmitting ? "Saving…" : isEditMode ? "Save" : "Create"}
			</PrimaryButton>
		</>
	);

	const valueFieldLabel = useMemo(() => {
		switch (formData.type) {
			case "dict":
				return "Value (JSON object)";
			case "list":
				return "Value (JSON array)";
			case "bool":
				return "Value (true/false)";
			default:
				return "Value";
		}
	}, [formData.type]);

	const isJsonValue = formData.type === "dict" || formData.type === "list";

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
		>
			<div className={cn("flex flex-col gap-5 pt-2")}>
				<div className={cn("flex flex-col gap-1.5")}>
					<div className={cn("flex items-center gap-1")}>
						<Label htmlFor="variable-key">
							Name (key)
							<RequiredMark />
						</Label>
						<Tooltip content="The unique identifier for the variable (e.g., 'api_key', 'user_preference'). Cannot be changed after creation.">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className={cn("text-info")}
								aria-label="About the variable name"
							>
								<Info aria-hidden="true" />
							</Button>
						</Tooltip>
					</div>
					<Input
						id="variable-key"
						value={formData.key}
						onChange={(event) =>
							setFormData((prev) => ({ ...prev, key: event.target.value }))
						}
						required
						disabled={isSubmitting || isEditMode} // Key is not editable
						placeholder="e.g., my_variable_name"
						aria-invalid={refusalField === "key"}
						aria-describedby={
							refusalField === "key" ? "variable-key-refusal" : undefined
						}
						className={cn(refusalField === "key" && "border-danger")}
					/>
					{refusalField === "key" && (
						<p
							id="variable-key-refusal"
							role="alert"
							className={cn("text-body-sm text-danger")}
						>
							{refusal?.message}
						</p>
					)}
				</div>

				<div className={cn("flex flex-col gap-1.5")}>
					<Label htmlFor="variable-type-select">
						Type
						<RequiredMark />
					</Label>
					<Select
						value={formData.type}
						onValueChange={(type) => {
							// Radix hands back a plain string; every item comes from
							// `VARIABLE_TYPES`, so a value outside it can only be a mistake in
							// this file - and the selection is typed by the contract's table.
							if (!isVariableType(type)) return;
							setFormData((prev) => ({ ...prev, type }));
						}}
						disabled={isSubmitting}
					>
						<SelectTrigger id="variable-type-select">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{/* The backend's own names, un-prettified: `str`, not
							    "String". The list column beside this form prints the
							    same names back, so the vocabulary a user picks here is
							    the vocabulary they then read there. */}
							{VARIABLE_TYPES.map((type) => (
								<SelectItem key={type} value={type}>
									{type}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className={cn("flex flex-col gap-1.5")}>
					<Label htmlFor="variable-value">
						{valueFieldLabel}
						<RequiredMark />
					</Label>
					<Textarea
						id="variable-value"
						value={formData.value}
						onChange={(event) =>
							setFormData((prev) => ({ ...prev, value: event.target.value }))
						}
						required
						disabled={isSubmitting}
						rows={isJsonValue ? 5 : 2}
						aria-describedby={cn(
							isJsonValue && "variable-value-hint",
							refusalField === "value" && "variable-value-refusal",
						)}
						aria-invalid={refusalField === "value"}
						className={cn(refusalField === "value" && "border-danger")}
						placeholder={
							formData.type === "dict"
								? `{ "example_key": "example_value" }`
								: formData.type === "list"
									? `[ "item1", "item2" ]`
									: formData.type === "bool"
										? "true or false"
										: "Enter variable value"
						}
					/>
					{isJsonValue && (
						<p
							id="variable-value-hint"
							className={cn("text-ink-muted text-meta")}
						>
							Enter a valid JSON structure.
						</p>
					)}
					{refusalField === "value" && (
						<p
							id="variable-value-refusal"
							role="alert"
							className={cn("text-body-sm text-danger")}
						>
							{refusal?.message}
						</p>
					)}
				</div>
				{refusal && !refusalField && (
					<p role="alert" className={cn("text-body-sm text-danger")}>
						{refusal.message}
					</p>
				)}
			</div>
		</BaseDialog>
	);
};
