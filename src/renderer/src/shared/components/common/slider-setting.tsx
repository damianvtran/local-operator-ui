/**
 * Slider Setting Component
 *
 * A numeric setting with a range slider and a directly editable field.
 *
 * The slider is a native `<input type="range">` rather than a rebuilt widget:
 * keyboard support, `aria-valuenow` and form semantics come with it, which is
 * exactly the list of things a hand-rolled div slider would have to
 * re-implement. There is no slider primitive in the shared layer because this
 * is its only consumer.
 *
 * The track is drawn as the input's background: a 6px-tall horizontal
 * gradient, accent up to the current fill and `sunken` past it. An overlay
 * div for the fill would sit behind a transparent thumb and is one more
 * element to keep in sync; a background cannot drift out of sync because it
 * is the element. Thumb styling has to use the `::-webkit-slider-thumb`
 * arbitrary variants — this app renders in Chromium, so no `-moz-` path is
 * declared.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Card, Input } from "@shared/components/ui";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, FC, KeyboardEvent } from "react";

type SliderSettingProps = {
	/**
	 * Current value of the setting
	 */
	value: number;

	/**
	 * Label for the setting
	 */
	label: string;

	/**
	 * Description of what the setting does
	 */
	description?: string;

	/**
	 * Minimum value for the slider
	 */
	min: number;

	/**
	 * Maximum value for the slider
	 */
	max: number;

	/**
	 * Step size for the slider
	 */
	step?: number;

	/**
	 * Unit label to display after the value (optional)
	 */
	unit?: string;

	/**
	 * Callback function when the value is changed
	 * @param value - The new value
	 */
	onChange: (value: number) => Promise<void>;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: LucideIcon;

	/**
	 * Whether the setting is currently being saved
	 */
	isSaving?: boolean;
};

/**
 * Slider Setting Component
 *
 * A component for adjusting numeric settings with a slider and direct input
 *
 * @param props - The component props.
 * @returns The SliderSetting component.
 */
export const SliderSetting: FC<SliderSettingProps> = ({
	value,
	label,
	description,
	min,
	max,
	step = 1,
	unit,
	onChange,
	icon: Icon,
	isSaving = false,
}) => {
	const [sliderValue, setSliderValue] = useState<number>(value);
	const [inputValue, setInputValue] = useState<string>(value.toString());
	const [isEditing, setIsEditing] = useState(false);

	const fieldId = useId();
	const labelId = `${fieldId}-label`;
	const descriptionId = `${fieldId}-description`;

	// The value the next commit writes. A ref, because the commit is triggered
	// by window-level listeners that would otherwise capture a stale state.
	const latestValue = useRef(sliderValue);
	latestValue.current = sliderValue;

	// Update local state when the external value prop changes
	useEffect(() => {
		// Only update if not currently editing the input to avoid overriding user input
		if (!isEditing) {
			setSliderValue(value);
			setInputValue(value.toString());
		}
	}, [value, isEditing]);

	/**
	 * Commits the current slider position: what MUI's `onChangeCommitted` did.
	 * Invoked on pointer release, on key release after an arrow adjustment, and
	 * on blur, so a release that lands outside the input after a drag is not
	 * lost.
	 */
	const commitValue = useCallback(async () => {
		if (isSaving) return;

		const clampedValue = Math.max(min, Math.min(max, latestValue.current));

		setSliderValue(clampedValue);
		setInputValue(clampedValue.toString());

		if (clampedValue !== value) {
			try {
				await onChange(clampedValue);
			} catch (error) {
				console.error("Error updating setting via slider:", error);
				// Revert UI state on error
				setSliderValue(value);
				setInputValue(value.toString());
			}
		}
	}, [isSaving, min, max, value, onChange]);

	/**
	 * Handles slider change events (live, while dragging or pressing arrows)
	 */
	const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
		const numValue = Number(e.target.value);
		setSliderValue(numValue);
		setInputValue(numValue.toString());
		// The commit happens on pointer/key release, not here, so one drag is one save.
	};

	/**
	 * Starts watching for the pointer release that ends this drag. The release
	 * can land anywhere once the thumb is captured, so the listener is global.
	 */
	const handleSliderPointerDown = () => {
		const onPointerUp = () => {
			window.removeEventListener("pointerup", onPointerUp);
			void commitValue();
		};
		window.addEventListener("pointerup", onPointerUp);
	};

	/**
	 * Commits after an arrow-key adjustment once the key is released.
	 */
	const handleSliderKeyUp = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
			void commitValue();
		}
	};

	/**
	 * Handles direct input changes
	 */
	const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value);
	};

	/**
	 * Handles input blur - validates and commits the change.
	 */
	const handleInputBlur = async () => {
		setIsEditing(false); // Mark editing as finished

		if (isSaving) return;

		let numValue = Number.parseFloat(inputValue); // Use parseFloat for potential decimal steps

		// Validate and clamp the input value
		if (Number.isNaN(numValue)) {
			numValue = value; // Reset to original value if invalid
		} else {
			numValue = Math.max(min, Math.min(max, numValue));
			// Snap to the nearest step
			if (step) {
				numValue = Math.round(numValue / step) * step;
				// Handle potential floating point inaccuracies
				const precision = step.toString().split(".")[1]?.length || 0;
				numValue = Number.parseFloat(numValue.toFixed(precision));
			}
		}

		// Update state only if the clamped/validated value differs from the original prop
		if (numValue !== value) {
			setSliderValue(numValue);
			setInputValue(numValue.toString());
			try {
				await onChange(numValue);
			} catch (error) {
				console.error("Error updating setting via input:", error);
				// Revert UI state on error
				setSliderValue(value);
				setInputValue(value.toString());
			}
		} else {
			// If the value hasn't changed effectively, still reset the input
			// string representation to the official value (e.g., user typed "5.0" but value is 5)
			setSliderValue(value);
			setInputValue(value.toString());
		}
	};

	/**
	 * Handles input focus
	 */
	const handleInputFocus = () => {
		setIsEditing(true);
	};

	/**
	 * Handles key press in the input field
	 */
	const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			(e.target as HTMLInputElement).blur();
		}
	};

	// Fraction of the track that is filled, driving the accent/sunken split.
	const fill =
		max > min
			? `${(((sliderValue - min) / (max - min)) * 100).toFixed(2)}%`
			: "0%";

	return (
		<Card className="mb-4">
			<div>
				<label
					id={labelId}
					htmlFor={`${fieldId}-range`}
					className="flex items-center gap-2 text-body text-ink"
				>
					{Icon && (
						<Icon size={14} aria-hidden="true" className="text-ink-muted" />
					)}
					{label}
				</label>
				{description && (
					<p id={descriptionId} className="mt-1 text-body-sm text-ink-muted">
						{description}
					</p>
				)}
			</div>

			<div className="flex items-center gap-4">
				<div className="flex-1 pr-2">
					<input
						id={`${fieldId}-range`}
						type="range"
						value={sliderValue}
						min={min}
						max={max}
						step={step}
						disabled={isSaving}
						onChange={handleSliderChange}
						onPointerDown={handleSliderPointerDown}
						onKeyUp={handleSliderKeyUp}
						onBlur={() => void commitValue()}
						aria-labelledby={labelId}
						aria-describedby={description ? descriptionId : undefined}
						style={{ "--fill": fill } as CSSProperties}
						className={
							// The track is the background: accent up to --fill, sunken
							// past it, 6px tall and centred in the 16px hit area. Disabled
							// drops the gradient so the whole track reads as one sunken bar
							// rather than an accent fill that only looks interactive.
							"h-4 w-full cursor-pointer appearance-none bg-transparent bg-center bg-no-repeat " +
							"bg-[length:100%_6px] " +
							"bg-[linear-gradient(to_right,var(--color-accent)_0_var(--fill),var(--color-sunken)_var(--fill)_100%)] " +
							"disabled:cursor-not-allowed disabled:bg-none disabled:bg-sunken " +
							// rounded-full on the thumb: the same status-dot exception the
							// Switch primitive takes — a squared slider thumb reads as a bug.
							"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent " +
							"[&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:duration-fast [&::-webkit-slider-thumb]:ease-out-quart " +
							"[&::-webkit-slider-thumb]:hover:bg-accent-hover " +
							"disabled:[&::-webkit-slider-thumb]:bg-ink-disabled"
						}
					/>
					<div className="mt-0.5 flex justify-between font-mono text-mono-sm text-ink-dim">
						<span>{min}</span>
						<span>{max}</span>
					</div>
				</div>

				<div className="flex min-w-27.5 items-center justify-end gap-1">
					{isSaving ? (
						<Spinner size="md" label={`Saving ${label}`} />
					) : (
						<>
							<Input
								inputSize="sm"
								type="number"
								value={inputValue}
								onChange={handleInputChange}
								onBlur={handleInputBlur}
								onFocus={handleInputFocus}
								onKeyDown={handleKeyPress}
								min={min}
								max={max}
								step={step}
								disabled={isSaving}
								aria-labelledby={labelId}
								aria-describedby={description ? descriptionId : undefined}
								className="w-20 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
							/>
							{unit && (
								<span className="shrink-0 text-meta text-ink-muted">
									{unit}
								</span>
							)}
						</>
					)}
				</div>
			</div>
		</Card>
	);
};
