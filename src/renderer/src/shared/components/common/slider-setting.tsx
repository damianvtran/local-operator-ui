import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
 *
 * ## Why it is no longer a `Card`, and carries no margin
 *
 * It was a bordered, filled card with `mb-4`. Both were wrong for the same
 * reason: the settings surfaces went borderless around it, so eight sliders
 * drew eight boxes inside a section that had deliberately given up its own —
 * and on the agent pane, inside another card as well. A busy panel loses a
 * border rather than gaining tighter spacing (branding § 5).
 *
 * The margin is the container's business. A component that ships its own outer
 * margin cannot be composed: it stacks with every parent that has a `gap`, and
 * the failure is silent because the result is still *some* spacing, just the
 * wrong tier. These sliders sat 32px apart — the section tier — inside groups
 * whose other rows sat at 16px.
 *
 * ## Why the value moved up to the label row
 *
 * Reading a column of settings, the question is "what is this set to?", and
 * the answer used to sit mid-row beside the track, at a different height in
 * every row. On the label row it lands on one right-hand edge the eye can run
 * down — the arrangement macOS System Settings and Raycast both use for a
 * numeric slider.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Input } from "@shared/components/ui";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
	CSSProperties,
	ChangeEvent,
	FC,
	KeyboardEvent,
	ReactNode,
} from "react";

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

	/**
	 * READ-ONLY READOUT MODE (notification-sound settings spec §4.1). When set,
	 * the label row shows this string (machine voice, `aria-hidden`) instead of
	 * the typed number input and unit, and the `min … max` bounds row is
	 * dropped. For a control where typing an exact value is not a task anyone
	 * has, the box and the bounds are chrome that make a two-second control
	 * look like a form; the number stays because other surfaces (the TUI, the
	 * agent's `setting` tool) speak in it. Callers that omit it are unchanged.
	 */
	readout?: (value: number) => string;

	/**
	 * The range's `aria-valuetext`. Required in practice with `readout`: the
	 * readout is hidden from assistive tech, so the range must say the value in
	 * words ("70 percent") rather than as a bare number.
	 */
	valueText?: (value: number) => string;

	/**
	 * Travel for PageUp / PageDown. Chromium's own page step is a tenth of the
	 * range, which is not the step the caller chose; set this to own it. Also
	 * makes a PageUp/PageDown release commit, as an arrow release does.
	 */
	pageStep?: number;

	/** The range cannot be moved (a colour step, never opacity). */
	disabled?: boolean;

	/** Rendered after the readout on the label row (for example a Reset link). */
	trailing?: ReactNode;

	/**
	 * SAVE IN PLACE (opt-in; readout mode only). By default a save disables the
	 * range, and a focused range that becomes disabled drops keyboard focus to
	 * <body>, so a second arrow press lands nowhere (notification-sound QA
	 * round 1, Q1 / UX U1). With this set the range stays enabled and focused,
	 * the readout stays, a small spinner sits beside it, and each release still
	 * commits: the CALLER orders its writes. Off by default because existing
	 * callers rely on a save being exclusive.
	 */
	savingInPlace?: boolean;
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
	readout,
	valueText,
	pageStep,
	disabled = false,
	trailing,
	savingInPlace = false,
}) => {
	useI18nLocale();
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

	/*
	 * IN-PLACE SAVES COMPARE AGAINST WHAT WAS LAST SENT, not the prop (review
	 * round 2, M3). With commits allowed mid-save, `value` lags: 70 -> 65 -> 70
	 * compared the second 70 against the stale prop 70, skipped the write, and
	 * the first write's refetch then moved the thumb to 65. So, in place,
	 * `committed` is the last value handed to `onChange`, the prop sync waits
	 * until every write has settled, and `settled` re-runs it at that moment.
	 * Outside in-place mode none of this is consulted.
	 */
	const committed = useRef(value);
	const pendingWrites = useRef(0);
	const [settled, setSettled] = useState(0);
	/*
	 * MID-GESTURE: a commit key is down or a pointer is dragging, so the thumb
	 * shows a step the user has not released yet (review round 3, M4). An
	 * earlier save settling then must not pull the thumb back to the daemon's
	 * value: that overwrote the unreleased step, and its keyup committed the
	 * daemon's own number back to it, so a quick 70 -> 65 -> 70 kept 65.
	 */
	const inGesture = useRef(false);

	// Update local state when the external value prop changes
	useEffect(() => {
		void settled;
		if (savingInPlace && (pendingWrites.current > 0 || inGesture.current))
			return;
		committed.current = value;
		// Only update if not currently editing the input to avoid overriding user input
		if (!isEditing) {
			setSliderValue(value);
			setInputValue(value.toString());
		}
	}, [value, isEditing, savingInPlace, settled]);

	/**
	 * Commits the current slider position: what MUI's `onChangeCommitted` did.
	 * Invoked on pointer release, on key release after an arrow adjustment, and
	 * on blur, so a release that lands outside the input after a drag is not
	 * lost.
	 */
	// In place, a commit during a save is allowed: the caller serializes.
	const blocked = isSaving && !savingInPlace;
	const commitValue = useCallback(async () => {
		if (blocked) return;

		const clampedValue = Math.max(min, Math.min(max, latestValue.current));

		setSliderValue(clampedValue);
		setInputValue(clampedValue.toString());

		if (savingInPlace) {
			inGesture.current = false;
			// The release decides from what the user sees (the thumb), against
			// what was last sent; nothing to send still re-runs the held sync.
			if (clampedValue === committed.current) {
				if (pendingWrites.current === 0) setSettled((n) => n + 1);
				return;
			}
			committed.current = clampedValue;
			pendingWrites.current += 1;
			try {
				await onChange(clampedValue);
			} catch (error) {
				// The settle below re-reads the prop: what the daemon actually holds.
				console.error("Error updating setting via slider:", error);
			} finally {
				pendingWrites.current -= 1;
				if (pendingWrites.current === 0) setSettled((n) => n + 1);
			}
			return;
		}

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
	}, [blocked, min, max, value, onChange, savingInPlace]);

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
		inGesture.current = true;
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
		if (isCommitKey(e.key, pageStep)) void commitValue();
	};

	// Owns PageUp/PageDown only when the caller named a page step; otherwise the
	// browser's default stays, so existing callers are unchanged.
	const handleSliderKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (isCommitKey(e.key, pageStep)) inGesture.current = true;
		if (pageStep === undefined) return;
		if (e.key !== "PageUp" && e.key !== "PageDown") return;
		e.preventDefault();
		const delta = e.key === "PageUp" ? pageStep : -pageStep;
		const next = Math.max(min, Math.min(max, latestValue.current + delta));
		setSliderValue(next);
		setInputValue(next.toString());
		latestValue.current = next;
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
		<div>
			{/*
			 * Label and current value share one row, so a column of settings has a
			 * single right-hand edge of values rather than one per row height.
			 * `min-h-8` reserves the input's own height on the row whether or not
			 * the input is currently swapped out for the saving spinner.
			 */}
			<div className="flex min-h-8 items-center justify-between gap-4">
				<label
					id={labelId}
					htmlFor={`${fieldId}-range`}
					className="flex min-w-0 items-center gap-2 text-body text-ink"
				>
					{Icon && (
						<Icon
							size={14}
							aria-hidden="true"
							className="shrink-0 text-ink-dim"
						/>
					)}
					<span className="truncate">{label}</span>
				</label>

				<div className="flex shrink-0 items-center gap-2">
					{readout && !blocked ? (
						<>
							{isSaving && (
								<Spinner
									size="xs"
									label={t("ui.common.forms.slider_setting.saving", {
										label: label,
									})}
								/>
							)}
							<span
								aria-hidden="true"
								className="font-mono text-mono-sm text-ink-muted"
							>
								{readout(sliderValue)}
							</span>
							{trailing}
						</>
					) : isSaving ? (
						<Spinner
							size="md"
							label={t("ui.common.forms.slider_setting.saving", {
								label: label,
							})}
						/>
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
								className="w-18 text-end [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
							/>
							{unit && (
								<span className="shrink-0 text-meta text-ink-dim">{unit}</span>
							)}
						</>
					)}
				</div>
			</div>

			{description && (
				<p
					id={descriptionId}
					className="mt-0.5 max-w-2xl text-body-sm text-ink-muted"
				>
					{description}
				</p>
			)}

			<input
				id={`${fieldId}-range`}
				type="range"
				value={sliderValue}
				min={min}
				max={max}
				step={step}
				disabled={blocked || disabled}
				aria-busy={savingInPlace && isSaving ? true : undefined}
				onChange={handleSliderChange}
				onPointerDown={handleSliderPointerDown}
				onKeyDown={handleSliderKeyDown}
				onKeyUp={handleSliderKeyUp}
				aria-valuetext={valueText ? valueText(sliderValue) : undefined}
				onBlur={() => void commitValue()}
				aria-labelledby={labelId}
				aria-describedby={description ? descriptionId : undefined}
				style={{ "--fill": fill } as CSSProperties}
				className={
					// The track is the background: accent up to --fill, sunken
					// past it, 6px tall and centred in the 16px hit area. Disabled
					// drops the gradient so the whole track reads as one sunken bar
					// rather than an accent fill that only looks interactive.
					"mt-3 h-4 w-full cursor-pointer appearance-none bg-transparent bg-center bg-no-repeat " +
					"bg-[length:100%_6px] " +
					"bg-[linear-gradient(to_right,var(--color-accent)_0_var(--fill),var(--color-sunken)_var(--fill)_100%)] " +
					// Disabled keeps the 6px track geometry (design round 1, D2): a
					// flat sunken background-colour filled the whole 16px hit area
					// and read as a grey slab, so the gradient becomes one flat
					// sunken stop at the same size instead.
					"disabled:cursor-not-allowed disabled:bg-[linear-gradient(var(--color-sunken),var(--color-sunken))] " +
					// rounded-full on the thumb: the same status-dot exception the
					// Switch primitive takes — a squared slider thumb reads as a bug.
					"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent " +
					"[&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:duration-fast [&::-webkit-slider-thumb]:ease-out-quart " +
					"[&::-webkit-slider-thumb]:hover:bg-accent-hover " +
					"disabled:[&::-webkit-slider-thumb]:bg-ink-disabled"
				}
			/>
			{/* The bounds are counts, so they are machine voice. Dropped in readout
			    mode, where the readout already states the value. */}
			{!readout && (
				<div className="flex justify-between font-mono text-mono-sm text-ink-dim">
					<span>{min}</span>
					<span>{max}</span>
				</div>
			)}
		</div>
	);
};

/** The keys whose release commits a step (and whose press starts a gesture). */
function isCommitKey(key: string, pageStep: number | undefined): boolean {
	return (
		key.startsWith("Arrow") ||
		key === "Home" ||
		key === "End" ||
		(pageStep !== undefined && (key === "PageUp" || key === "PageDown"))
	);
}
