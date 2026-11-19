/**
 * Inline text field with an explicit save step.
 *
 * The value is not committed on blur. Blurring with unsaved changes keeps the
 * field in edit mode, because this field edits agent configuration that is
 * persisted server-side and a stray click should not write it.
 *
 * It carries no outer margin. The container owns the gap between fields: a
 * component that ships `mb-4` stacks with every parent that has a `gap`, and
 * the failure is silent because the result is still spacing, just the wrong
 * tier. Every settings form here sat at 32px — the section tier — between two
 * fields of the same group.
 *
 * The display state is a `button` dressed as an `Input`, so its border, height
 * and radius must track the `Input` primitive exactly. A read state and an
 * edit state of one field that disagree about their corners is the kind of
 * detail that reads as sloppiness without anyone being able to name it.
 */

import { Button, Input, Label, Textarea } from "@shared/components/ui";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Check, Eraser, Pencil, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type React from "react";
import type { ChangeEvent, FC, FocusEvent, KeyboardEvent } from "react";
import { t } from "../../../../../i18n/messages";

type EditableFieldProps = {
	/** Settings search's stable row id, when this field is a searchable row. */
	searchRow?: string;
	/**
	 * Current value of the field
	 */
	value: string;

	/**
	 * Label for the field
	 */
	label: string;

	/**
	 * Callback function when the value is saved
	 * @param value - The new value
	 */
	onSave: (value: string) => Promise<void>;

	/**
	 * Whether the field is multiline
	 */
	multiline?: boolean;

	/**
	 * Number of rows for multiline fields
	 */
	rows?: number;

	/**
	 * Placeholder text when field is empty
	 */
	placeholder?: string;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: React.ReactNode;

	/**
	 * Whether the field is currently being saved
	 */
	isSaving?: boolean;

	/**
	 * Whether the field is read-only
	 */
	readOnly?: boolean;
};

/**
 * Editable Field Component
 *
 * A component that allows for inline editing of text fields with explicit save.
 *
 * @param props - EditableFieldProps
 */
export const EditableField: FC<EditableFieldProps> = ({
	searchRow,
	value,
	label,
	onSave,
	multiline = false,
	rows = 4,
	placeholder = t("ui.common.forms.autocomplete_field.enter_value"),
	icon,
	isSaving: externalIsSaving = false,
	readOnly = false,
}) => {
	useI18nLocale();
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState(value);
	const [displayValue, setDisplayValue] = useState(value);
	const [originalValue, setOriginalValue] = useState(value);
	const [internalIsSaving, setInternalIsSaving] = useState(false);
	const [isClearing, setIsClearing] = useState(false);
	const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
	const actionButtonsRef = useRef<HTMLDivElement>(null);
	const inputId = useId();

	const isSaving = externalIsSaving || internalIsSaving;

	// Update internal states when the external value prop changes
	useEffect(() => {
		if (!isEditing) {
			setEditValue(value);
			setDisplayValue(value);
			setOriginalValue(value);
		} else {
			setOriginalValue(value);
		}
	}, [value, isEditing]);

	// Focus the input and select text when entering edit mode
	useEffect(() => {
		if (isEditing) {
			// Deferred a tick: the input does not exist until this render commits.
			const timer = setTimeout(() => {
				if (inputRef.current) {
					inputRef.current.focus();
					// Select all text for easy replacement
					inputRef.current.select();
				}
			}, 0);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [isEditing]);

	/**
	 * Handles entering edit mode.
	 */
	const handleEdit = () => {
		if (readOnly) return;
		setIsEditing(true);
	};

	/**
	 * Handles changes in the text field.
	 *
	 * @param e - The change event.
	 */
	const handleChange = (
		e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		setEditValue(e.target.value);
	};

	/**
	 * Cancels editing and reverts to the original value.
	 */
	const handleCancel = () => {
		setEditValue(originalValue); // Revert edit value
		setIsEditing(false); // Exit editing mode
	};

	/**
	 * Saves the current edit value.
	 */
	const handleSave = async () => {
		if (isSaving || editValue === originalValue) return; // Prevent saving if already saving or no changes

		setInternalIsSaving(true);
		try {
			await onSave(editValue);
			// On successful save, update the baseline values and exit edit mode
			setOriginalValue(editValue);
			setDisplayValue(editValue);
			setIsEditing(false);
		} catch (error) {
			console.error("Failed to save editable field:", error);
			// Stay in edit mode on failure so the user can retry or cancel, and KEEP
			// what they typed. This used to `setEditValue(originalValue)`, which
			// contradicted the line above it: the rejected text was discarded, so
			// there was nothing left to retry - and because `handleSave` returns
			// early when `editValue === originalValue`, the Save button was inert
			// afterwards. A refusal must never cost the user their edit; Cancel is
			// how they discard it deliberately.
		} finally {
			setInternalIsSaving(false);
		}
	};

	/**
	 * Handles blur event on the text field.
	 * Prevents auto-cancel if focus is moving to one of the action buttons.
	 *
	 * @param e - The blur event.
	 */
	const handleBlur = (
		e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		// Deferred so a click on a save/cancel button lands before edit mode ends.
		setTimeout(() => {
			const relatedTarget = e.relatedTarget as Node | null;
			const isFocusWithinActionButtons =
				actionButtonsRef.current?.contains(relatedTarget) ?? false;

			// If focus moved outside the input and its action buttons, and there are no changes, cancel editing.
			// If there *are* changes, keep editing mode active. User must explicitly save or cancel.
			if (!isFocusWithinActionButtons && editValue === originalValue) {
				setIsEditing(false);
			}
		}, 0);
	};

	/**
	 * Handles key press events in the text field.
	 * Saves the value when Enter is pressed if there are changes.
	 *
	 * @param e - The keyboard event.
	 */
	const handleKeyDown = (
		e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>,
	) => {
		if (e.key === "Escape") {
			handleCancel();
		} else if (e.key === "Enter") {
			// Save on Enter for single line, Ctrl/Cmd+Enter for multiline
			if (!multiline || (multiline && (e.ctrlKey || e.metaKey))) {
				e.preventDefault(); // Prevent newline in multiline
				if (editValue !== originalValue) {
					handleSave();
				} else {
					// If no changes, Enter should just exit edit mode
					setIsEditing(false);
				}
			}
		}
	};

	/**
	 * Clears the field by forcing its value to empty and calling onSave.
	 * This function bypasses change detection and clears regardless of current value.
	 *
	 * @param e - The mouse event.
	 */
	const clearField = (e: React.MouseEvent) => {
		e.preventDefault(); // Prevent triggering edit mode if clicking clear on display view
		e.stopPropagation();

		if (readOnly || isSaving || isClearing) return; // Prevent action if already busy

		setIsClearing(true);
		setInternalIsSaving(true);

		// Optimistically update UI
		setEditValue("");
		setDisplayValue("");

		onSave("")
			.then(() => {
				setOriginalValue("");
				setIsEditing(false);
			})
			.catch((error) => {
				console.error("Failed to clear field:", error);
				setEditValue(originalValue);
				setDisplayValue(originalValue);
			})
			.finally(() => {
				setIsClearing(false);
				setInternalIsSaving(false);
			});
	};

	/**
	 * Handles keydown events on the display container (button) to activate edit mode.
	 * @param e - The keyboard event.
	 */
	const handleDisplayContainerKeyDown = (
		e: KeyboardEvent<HTMLButtonElement>,
	) => {
		if (readOnly) return;
		// Activate edit mode on Enter/Space
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			handleEdit();
		}
	};

	const hasChanged = editValue !== originalValue;
	// Show clear button if not saving, and the *original* value isn't empty.
	// This prevents showing clear immediately after clearing until a save happens.
	const showClearButton = !readOnly && !isSaving && originalValue !== "";
	const showClearWhileEditing = showClearButton && !hasChanged;

	// The action buttons float over the field, so the text has to stop short of
	// them: sized to whichever set is actually rendered rather than to the
	// widest possible one, which would leave a permanent gutter.
	const inputPadding = isSaving
		? "pe-20"
		: showClearWhileEditing
			? "pe-28"
			: hasChanged
				? "pe-18"
				: "pe-10";

	// Reveal-on-hover overlay controls. Focus is included so they are reachable
	// without a pointer; they stay out of the tab order because the display
	// button is the field's single stop.
	const overlayReveal =
		"opacity-0 transition-opacity duration-fast ease-out-quart group-hover:opacity-100 group-focus-within:opacity-100";

	return (
		<div
			data-search-row={searchRow}
			data-search-control={searchRow ? "" : undefined}
		>
			{/* Several call sites pass `label=""` because the surrounding heading
			    already names the field. Rendering the element anyway leaves an
			    empty flex row and its margin above the control. */}
			{(label || icon) && (
				<Label
					htmlFor={inputId}
					className="mb-1.5 flex items-center gap-2 text-ink-muted"
				>
					{icon}
					{label}
				</Label>
			)}

			{isEditing ? (
				<div className="relative">
					{multiline ? (
						<Textarea
							id={inputId}
							ref={inputRef}
							value={editValue}
							onChange={handleChange}
							onBlur={handleBlur}
							onKeyDown={handleKeyDown}
							rows={rows}
							placeholder={placeholder}
							autoComplete="off"
							className={cn("min-h-9", inputPadding)}
						/>
					) : (
						<Input
							id={inputId}
							ref={inputRef}
							value={editValue}
							onChange={handleChange}
							onBlur={handleBlur}
							onKeyDown={handleKeyDown}
							placeholder={placeholder}
							autoComplete="off"
							className={cn("text-ellipsis", inputPadding)}
						/>
					)}
					<div
						ref={actionButtonsRef}
						className={cn(
							"absolute end-1.5 z-10 flex items-center gap-1",
							multiline ? "top-1.5" : "top-1/2 -translate-y-1/2",
						)}
					>
						{isSaving ? (
							<span className="px-2 text-ink-dim text-meta">
								{isClearing
									? t("ui.common.forms.editable_field.clearing")
									: t("ui.common.forms.editable_field.saving")}
							</span>
						) : (
							<>
								{hasChanged && (
									<Button
										variant="ghost"
										size="icon-sm"
										onClick={handleSave}
										title={t(
											"ui.common.forms.editable_field.save_changes_enter",
										)}
										aria-label={t("ui.common.forms.autocomplete_field.save", {
											label: String(label),
										})}
										className="text-success hover:bg-success-wash hover:text-success"
									>
										<Check />
									</Button>
								)}
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={handleCancel}
									title={t("ui.common.forms.editable_field.cancel_escape")}
									aria-label={t(
										"ui.common.forms.autocomplete_field.cancel_editing",
										{ label: String(label) },
									)}
									className="text-danger hover:bg-danger-wash hover:text-danger"
								>
									<X />
								</Button>
								{showClearWhileEditing && (
									<Button
										variant="danger"
										size="sm"
										onClick={clearField}
										title={t("ui.common.forms.editable_field.clear_field")}
										aria-label={t("ui.common.forms.editable_field.clear_v2", {
											label: String(label),
										})}
									>
										<Eraser />
										{t("ui.common.forms.editable_field.clear")}
									</Button>
								)}
							</>
						)}
					</div>
				</div>
			) : (
				<div className="group relative w-full">
					{/*
					 * A native button so the whole display area is one keyboard stop.
					 * The edit and clear controls are siblings rather than children:
					 * a button cannot contain a button.
					 */}
					<button
						type="button"
						onClick={handleEdit}
						aria-label={t("ui.common.forms.editable_field.current_value", {
							detail: String(displayValue || placeholder),
							detail2: String(
								readOnly ? "" : t("ui.common.forms.field.click_to_edit"),
							),
						})}
						onKeyDown={handleDisplayContainerKeyDown}
						disabled={readOnly}
						className={cn(
							"flex w-full rounded-sm border border-control bg-surface px-3 text-start text-body-sm text-ink",
							"transition-colors duration-fast ease-out-quart",
							"disabled:cursor-default disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled",
							multiline ? "min-h-8 items-start py-2" : "h-8 items-center",
							!readOnly && "cursor-pointer hover:bg-elevated",
						)}
					>
						{displayValue ? (
							<span
								className={cn(
									"min-w-0 flex-1 pe-8",
									multiline ? "whitespace-pre-wrap break-words" : "truncate",
								)}
							>
								{displayValue}
							</span>
						) : (
							<span className="min-w-0 flex-1 truncate pe-8 text-ink-dim">
								{placeholder}
							</span>
						)}
					</button>
					{!readOnly && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={handleEdit}
							title={t("ui.common.forms.editable_field.edit")}
							aria-label={t("ui.common.forms.editable_field.edit_v2", {
								label: String(label),
							})}
							tabIndex={-1}
							className={cn(
								"absolute top-1/2 end-1.5 -translate-y-1/2",
								overlayReveal,
							)}
						>
							<Pencil />
						</Button>
					)}
					{showClearButton && (
						<Button
							variant="danger"
							size="sm"
							onClick={clearField}
							title={t("ui.common.forms.editable_field.clear_field")}
							aria-label={t("ui.common.forms.editable_field.clear_v2", {
								label: String(label),
							})}
							tabIndex={-1}
							className={cn(
								"absolute top-1/2 end-9 -translate-y-1/2",
								overlayReveal,
							)}
						>
							<Eraser />
							{t("ui.common.forms.editable_field.clear")}
						</Button>
					)}
				</div>
			)}
		</div>
	);
};
