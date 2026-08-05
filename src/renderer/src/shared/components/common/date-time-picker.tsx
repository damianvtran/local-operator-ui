/**
 * Combined date and time field.
 *
 * Named exception in the MUI removal: the calendar and clock themselves are
 * still `@mui/x-date-pickers`, because the primitive layer has no calendar and
 * hand-rolling one is its own project. What changed is everything around them —
 * the field chrome is a plain input that the pickers drive through their
 * `textField` slot, so no `@mui/material` import remains here.
 *
 * The slot receives MUI TextField-shaped props (an `InputProps` object for the
 * box and an `inputProps` object for the element) because that is the contract
 * `enableAccessibleFieldDOMStructure={false}` still speaks. The mapping below
 * is deliberate, not decorative: `InputProps.ref` is where the popper anchors,
 * and the handlers the pickers put on the wrapper manage the section-based
 * editing inside the field, so dropping any of them silently breaks typing.
 */

import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { isValid, parseISO } from "date-fns";
import { CalendarDays, Clock, History } from "lucide-react";
import { forwardRef, useEffect, useId, useState } from "react";
import type { FC, InputHTMLAttributes, ReactNode, Ref } from "react";

type PickerTextFieldProps = {
	id?: string;
	className?: string;
	placeholder?: string;
	value?: string;
	disabled?: boolean;
	readOnly?: boolean;
	required?: boolean;
	name?: string;
	autoComplete?: string;
	autoFocus?: boolean;
	error?: boolean;
	/** MUI styling hook the pickers send; consumed so it never hits the DOM. */
	focused?: boolean;
	onChange?: InputHTMLAttributes<HTMLInputElement>["onChange"];
	onBlur?: InputHTMLAttributes<HTMLDivElement>["onBlur"];
	onFocus?: InputHTMLAttributes<HTMLDivElement>["onFocus"];
	onClick?: InputHTMLAttributes<HTMLDivElement>["onClick"];
	InputProps?: {
		ref?: Ref<HTMLDivElement>;
		startAdornment?: ReactNode;
		endAdornment?: ReactNode;
	};
	inputProps?: InputHTMLAttributes<HTMLInputElement> & {
		ref?: Ref<HTMLInputElement>;
	};
};

const assignRef = <T,>(ref: Ref<T> | undefined, node: T | null) => {
	if (typeof ref === "function") ref(node);
	else if (ref) (ref as { current: T | null }).current = node;
};

const PickerTextField = forwardRef<HTMLDivElement, PickerTextFieldProps>(
	(
		{
			id,
			className,
			placeholder,
			value,
			disabled,
			readOnly,
			required,
			name,
			autoComplete,
			autoFocus,
			error,
			focused: _focused,
			onChange,
			onBlur,
			onFocus,
			onClick,
			InputProps,
			inputProps,
		},
		ref,
	) => (
		// biome-ignore lint/a11y/useKeyWithClickEvents: the click is forwarded to the MUI date-pickers widget behind the field, which owns the keyboard semantics; this div is its anchor, not an independent control.
		<div
			ref={(node) => {
				// Both refs point at the same box: the pickers' rootRef measures the
				// field and the triggerRef anchors the popper to it.
				assignRef(ref, node);
				assignRef(InputProps?.ref, node);
			}}
			onBlur={onBlur}
			onFocus={onFocus}
			onClick={onClick}
			className={cn(
				"flex h-9 items-center gap-1 rounded-md border border-control bg-surface px-3",
				"transition-colors duration-fast ease-out-quart",
				// The field suppresses its own outline because this box is the
				// visible control - adornments included - so the ring belongs here.
				// `outline-solid` is required: `outline-none` on the input pins
				// `--tw-outline-style: none`, which the width utility alone cannot
				// undo.
				"has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-2",
				"has-[input:focus-visible]:outline-accent has-[input:focus-visible]:outline-offset-2",
				error && "border-danger",
				disabled && "border-hairline bg-sunken",
				className,
			)}
		>
			{InputProps?.startAdornment}
			<input
				id={id}
				name={name}
				placeholder={placeholder}
				value={value ?? ""}
				disabled={disabled}
				readOnly={readOnly}
				required={required}
				autoComplete={autoComplete}
				aria-invalid={error || undefined}
				onChange={onChange}
				{...inputProps}
				ref={(node) => {
					/* Compose with the ref the pickers pass in `inputProps` — that one
					   drives section-based editing, so it must not be clobbered. The
					   autofocus focus is the one extra behaviour on top. */
					assignRef(inputProps?.ref, node);
					if (autoFocus && node) node.focus();
				}}
				className={cn(
					"h-full min-w-0 flex-1 bg-transparent outline-none",
					"text-body-sm text-ink placeholder:text-ink-dim",
					"disabled:text-ink-disabled disabled:placeholder:text-ink-disabled",
				)}
			/>
			{InputProps?.endAdornment}
		</div>
	),
);
PickerTextField.displayName = "PickerTextField";

type DateTimePickerProps = {
	label: string; // This will be the static label
	value: string | null; // ISO string or null
	onChange: (isoDateString: string | null) => void;
	disabled?: boolean;
	helperText?: string;
	/**
	 * Open the date popup on mount.
	 *
	 * A capture surface for the evidence set: the picker's calendar had no
	 * frame in any round because nothing ever opened it. It is controlled
	 * state, so the story that wants the popup visible asks for it here
	 * rather than clicking.
	 */
	initialOpen?: boolean;
};

export const DateTimePicker: FC<DateTimePickerProps> = ({
	label,
	value,
	onChange,
	initialOpen = false,
	disabled,
	helperText,
}) => {
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const [selectedTime, setSelectedTime] = useState<Date | null>(null);
	const [dateOpen, setDateOpen] = useState(initialOpen);
	const baseId = useId();

	useEffect(() => {
		if (value && isValid(parseISO(value))) {
			const dateValue = parseISO(value);
			setSelectedDate(dateValue);
			setSelectedTime(dateValue);
		} else {
			setSelectedDate(null);
			setSelectedTime(null);
		}
	}, [value]);

	const handleDateChange = (date: Date | null) => {
		setSelectedDate(date);
		if (date && isValid(date)) {
			const newDateTime = new Date(date);
			if (selectedTime && isValid(selectedTime)) {
				newDateTime.setHours(selectedTime.getHours());
				newDateTime.setMinutes(selectedTime.getMinutes());
				newDateTime.setSeconds(selectedTime.getSeconds());
			} else {
				// Default to midnight if no time is set
				newDateTime.setHours(0, 0, 0, 0);
			}
			onChange(newDateTime.toISOString());
		} else {
			// Date cleared or invalid: the pair is meaningless without a date.
			onChange(null);
		}
	};

	const handleTimeChange = (time: Date | null) => {
		setSelectedTime(time);
		if (time && isValid(time)) {
			// Time picked with no date yet means today.
			const newDateTime = selectedDate ? new Date(selectedDate) : new Date();
			newDateTime.setHours(time.getHours());
			newDateTime.setMinutes(time.getMinutes());
			newDateTime.setSeconds(time.getSeconds());
			if (!selectedDate) {
				setSelectedDate(
					new Date(
						newDateTime.getFullYear(),
						newDateTime.getMonth(),
						newDateTime.getDate(),
					),
				);
			}
			onChange(newDateTime.toISOString());
		} else if (time === null && selectedDate) {
			// Time cleared, but date exists. Set time to midnight.
			const newDateTime = new Date(selectedDate);
			newDateTime.setHours(0, 0, 0, 0);
			setSelectedTime(newDateTime);
			onChange(newDateTime.toISOString());
		} else {
			onChange(null);
		}
	};

	const handleSetToCurrent = () => {
		const now = new Date();
		setSelectedDate(now);
		setSelectedTime(now);
		onChange(now.toISOString());
	};

	return (
		<LocalizationProvider dateAdapter={AdapterDateFns}>
			<div>
				<label
					htmlFor={`${baseId}-date-field`}
					className="mb-1.5 block font-medium text-body-sm text-ink-muted"
				>
					{label}
				</label>
				<div className="flex items-center gap-2">
					<div className="min-w-0 flex-1">
						<DatePicker
							value={selectedDate}
							onChange={handleDateChange}
							disabled={disabled}
							open={initialOpen ? dateOpen : undefined}
							onOpen={() => setDateOpen(true)}
							onClose={() => setDateOpen(false)}
							enableAccessibleFieldDOMStructure={false}
							slots={{
								textField: PickerTextField,
								openPickerIcon: () => <CalendarDays size={16} />,
							}}
							slotProps={{
								textField: {
									id: `${baseId}-date-field`,
									placeholder: "Select date",
								},
								openPickerButton: {
									"aria-label": `Choose ${label} date`,
									size: "small",
								},
							}}
						/>
					</div>
					<div className="min-w-0 flex-1">
						<TimePicker
							value={selectedTime}
							onChange={handleTimeChange}
							disabled={disabled}
							enableAccessibleFieldDOMStructure={false}
							slots={{
								textField: PickerTextField,
								openPickerIcon: () => <Clock size={16} />,
							}}
							slotProps={{
								textField: {
									id: `${baseId}-time-field`,
									placeholder: "Select time",
								},
								openPickerButton: {
									"aria-label": `Choose ${label} time`,
									size: "small",
								},
							}}
						/>
					</div>
					<Tooltip content="Set to current time">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={handleSetToCurrent}
							disabled={disabled}
							aria-label={`Set ${label} to current time`}
						>
							<History />
						</Button>
					</Tooltip>
				</div>
				{helperText && (
					<p className="mt-1 ml-0.5 text-ink-muted text-meta">{helperText}</p>
				)}
			</div>
		</LocalizationProvider>
	);
};
