import type { ExecutionVariable } from "@shared/api/local-operator/types";
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
import { showErrorToast } from "@shared/utils/toast-manager";
import { Info, Save, XSquare } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";

const VARIABLE_TYPES: ExecutionVariable["type"][] = [
	"string",
	"int",
	"float",
	"bool",
	"dict",
	"list",
];

type VariableFormDialogProps = {
	open: boolean;
	onClose: () => void;
	onSubmit: (data: ExecutionVariable) => Promise<void>;
	initialData?: ExecutionVariable | null;
};

// Represents the form state.
type FormDataType = Omit<ExecutionVariable, "value" | "type"> & {
	value: string; // Store value as string initially for text input
	type: ExecutionVariable["type"];
};

const getDefaultFormState = (
	initialData?: ExecutionVariable | null,
): FormDataType => {
	if (initialData) {
		let valueString: string;
		if (initialData.type === "object" || initialData.type === "array") {
			try {
				valueString = JSON.stringify(initialData.value, null, 2);
			} catch {
				valueString = String(initialData.value); // Fallback
			}
		} else if (initialData.type === "boolean") {
			valueString = String(initialData.value);
		} else {
			valueString = String(initialData.value);
		}
		return {
			key: initialData.key,
			type: initialData.type,
			value: valueString,
		};
	}
	return {
		key: "",
		type: "string",
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

	const isEditMode = !!initialData;

	useEffect(() => {
		if (open) {
			setFormData(getDefaultFormState(initialData));
		}
	}, [open, initialData]);

	const handleSubmit = async () => {
		setIsSubmitting(true);
		try {
			const variableToSubmit: ExecutionVariable = {
				key: formData.key,
				type: formData.type,
				value: formData.value,
			};

			await onSubmit(variableToSubmit);
			onClose(); // Success toast is handled by the mutation hooks
		} catch (error) {
			console.error("Failed to submit variable:", error);
			showErrorToast(
				`Failed to save variable: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const dialogTitle = isEditMode
		? "Edit execution variable"
		: "Create execution variable";

	const dialogActions = (
		<>
			<SecondaryButton
				onClick={onClose}
				disabled={isSubmitting}
				startIcon={<XSquare size={18} aria-hidden="true" />}
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
				{isSubmitting
					? "Saving..."
					: isEditMode
						? "Save changes"
						: "Create variable"}
			</PrimaryButton>
		</>
	);

	const valueFieldLabel = useMemo(() => {
		switch (formData.type) {
			case "object":
				return "Value (JSON object)";
			case "array":
				return "Value (JSON array)";
			case "boolean":
				return "Value (true/false)";
			default:
				return "Value";
		}
	}, [formData.type]);

	const isJsonValue = formData.type === "object" || formData.type === "array";

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
					/>
				</div>

				<div className={cn("flex flex-col gap-1.5")}>
					<Label htmlFor="variable-type-select">
						Type
						<RequiredMark />
					</Label>
					<Select
						value={formData.type}
						onValueChange={(type) => setFormData((prev) => ({ ...prev, type }))}
						disabled={isSubmitting}
					>
						<SelectTrigger id="variable-type-select">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{VARIABLE_TYPES.map((type) => (
								<SelectItem key={type} value={type}>
									{type.charAt(0).toUpperCase() + type.slice(1)}
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
						aria-describedby={isJsonValue ? "variable-value-hint" : undefined}
						placeholder={
							formData.type === "object"
								? `{ "example_key": "example_value" }`
								: formData.type === "array"
									? `[ "item1", "item2" ]`
									: formData.type === "boolean"
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
				</div>
			</div>
		</BaseDialog>
	);
};
