import { Button } from "@shared/components/ui";
import { Tooltip } from "@shared/components/ui/tooltip";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Check } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { CSSProperties, FC, KeyboardEvent, PointerEvent } from "react";
import type { PresetName } from "../../../../../shared/theme-engine/picker.mjs";
import {
	CONTRAST_STEP,
	PRESET_ORDER,
	PREVIEW_IDS,
	nearestPreset,
	nextPreset,
	presetAt,
	presetsAround,
	snapContrast,
} from "../../../../../shared/theme-engine/picker.mjs";

/**
 * The CONTRAST layer: five preset chips over a -100..+100 slider (designer spec
 * 5.1). Presentational and controlled - `AppearanceLayers` owns the store, the
 * scoped preview blocks and the commit - so stories render every state from
 * props.
 *
 * TWO VALUES, ON PURPOSE. `committed` is what the app paints (persisted, composed
 * and verified). `draft` is where the thumb is during a drag or a key repeat. The
 * control reports `onDraft` at pointer speed and `onCommit` ONCE, on release
 * (pointer up, key up, chip click), because a verified compose costs 20-1100 ms
 * (see `picker.mjs`) - recomposing per move is the jank this split exists to
 * prevent. The parent previews drafts in a scoped subtree and composes commits.
 *
 * SNAPPING. A pointer drag lands on a preset within 8 units of it, so the
 * presets are easy to hit; keys never snap (±5 must stay reachable from a
 * preset - that is what fine-tuning means), and PageUp/PageDown jump preset to
 * preset. The chip row is a `radiogroup`; when the value sits between presets,
 * no chip is checked and the nearest one reads "(adjusted)" in `ink-muted`.
 */
export type ContrastControlProps = {
	/** The persisted value for the active mode. */
	committed: number;
	/** The value the engine actually reached (`effectiveContrast`), if capped. */
	effective?: number;
	/** Which mode the control is editing (the active theme's). */
	mode: "dark" | "light";
	/** True while the parent composes a committed value. */
	pending?: boolean;
	backgroundAtCeiling?: boolean;
	onDraft: (value: number | null) => void;
	onCommit: (value: number) => void;
};

const PRESET_KEY = {
	soft: "ui.settings.appearance.contrast.soft",
	gentle: "ui.settings.appearance.contrast.gentle",
	standard: "ui.settings.appearance.contrast.standard",
	strong: "ui.settings.appearance.contrast.strong",
	high: "ui.settings.appearance.contrast.high",
} as const;
const PRESET_DESCRIPTION_KEY = {
	soft: "ui.settings.appearance.contrast.soft_description",
	gentle: "ui.settings.appearance.contrast.gentle_description",
	standard: "ui.settings.appearance.contrast.standard_description",
	strong: "ui.settings.appearance.contrast.strong_description",
	high: "ui.settings.appearance.contrast.high_description",
} as const;

export const presetLabel = (name: PresetName): string => t(PRESET_KEY[name]);

const signed = (value: number): string =>
	value > 0 ? `+${value}` : String(value);

/** The slider's spoken value: a preset name, or where it sits between two. */
export const contrastValueText = (value: number): string => {
	const on = presetAt(value);
	if (on) return presetLabel(on);
	const around = presetsAround(value);
	if (!around) return signed(value);
	return t("ui.settings.appearance.contrast.value_between", {
		from: presetLabel(around[0]),
		to: presetLabel(around[1]),
		value: signed(value),
	});
};

export const ContrastControl: FC<ContrastControlProps> = ({
	committed,
	effective,
	mode,
	pending = false,
	backgroundAtCeiling = false,
	onDraft,
	onCommit,
}) => {
	useI18nLocale();
	const [draft, setDraft] = useState<number | null>(null);
	const value = draft ?? committed;
	const hintId = useId();
	const labelId = useId();
	/* The value a release commits. A ref because the window-level pointerup
	   listener would otherwise close over a stale draft. */
	const latest = useRef(value);
	latest.current = value;
	const dragging = useRef(false);

	/* A new committed value (another window, Reset, a theme of the other mode)
	   ends any local draft: React's "adjust state on a prop change" pattern,
	   compared during render rather than in an effect, so the thumb never shows
	   the old draft for a frame. */
	const [seen, setSeen] = useState({ committed, mode, pending });
	if (
		seen.committed !== committed ||
		seen.mode !== mode ||
		seen.pending !== pending
	) {
		setSeen({ committed, mode, pending });
		if (
			seen.committed !== committed ||
			seen.mode !== mode ||
			(seen.pending && !pending)
		)
			setDraft(null);
	}

	const move = (next: number) => {
		setDraft(next);
		onDraft(next);
	};
	const commit = (next: number) => {
		// Keep the released candidate visible until the parent finishes verified
		// composition. Clearing here flashes the old palette during its two rAFs.
		if (next !== committed) {
			move(next);
			onCommit(next);
		} else {
			setDraft(null);
			onDraft(null);
		}
	};

	const checked = presetAt(value);
	const nearest = checked ? null : nearestPreset(value);
	const capped =
		effective !== undefined && !pending && draft === null
			? effective !== committed
			: false;

	const onPointerDown = (event: PointerEvent<HTMLInputElement>) => {
		if (event.button !== 0) return;
		dragging.current = true;
		const up = () => {
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
			dragging.current = false;
			commit(latest.current);
		};
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		let next: number | null = null;
		if (event.key === "PageUp") next = nextPreset(value, 1);
		else if (event.key === "PageDown") next = nextPreset(value, -1);
		else if (event.key === "Home") next = -100;
		else if (event.key === "End") next = 100;
		else if (event.key.startsWith("Arrow")) {
			/* A range input runs right-to-left in an RTL document (Softer sits at
			   the end), so Right means "toward Softer" there - the native rule. */
			const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
			const up =
				event.key === "ArrowUp" ||
				(event.key === "ArrowRight" && !rtl) ||
				(event.key === "ArrowLeft" && rtl);
			const down =
				event.key === "ArrowDown" ||
				(event.key === "ArrowLeft" && !rtl) ||
				(event.key === "ArrowRight" && rtl);
			if (up) next = snapContrast(value + CONTRAST_STEP, { snap: false });
			else if (down)
				next = snapContrast(value - CONTRAST_STEP, { snap: false });
		}
		if (next === null) return;
		/* Handled here rather than by the native range so PageUp/Down jump between
		   presets and arrows step without snapping, in both reading directions. */
		event.preventDefault();
		move(next);
	};
	const onKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
		if (
			event.key.startsWith("Arrow") ||
			event.key === "PageUp" ||
			event.key === "PageDown" ||
			event.key === "Home" ||
			event.key === "End"
		)
			commit(latest.current);
	};

	const onChipKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const keys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"];
		if (!keys.includes(event.key)) return;
		event.preventDefault();
		const current = PRESET_ORDER.findIndex(
			(p) => p.name === (checked ?? nearest),
		);
		const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
		const forward =
			event.key === "ArrowDown" || (event.key === "ArrowRight") !== rtl;
		const index = Math.max(
			0,
			Math.min(PRESET_ORDER.length - 1, current + (forward ? 1 : -1)),
		);
		const target = PRESET_ORDER[index];
		commit(target.value);
		const buttons =
			event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
		buttons[index]?.focus();
	};

	const fill = ((value + 100) / 200) * 100;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-baseline justify-between gap-3">
				<h3 id={labelId} className="px-1 text-meta text-ink-dim">
					{t("ui.settings.appearance.contrast.title")}
				</h3>
				{committed !== 0 && (
					<Button
						variant="link"
						size="sm"
						onClick={() => commit(0)}
						className="min-h-6 min-w-6 text-meta"
					>
						{t("ui.settings.appearance.contrast.reset")}
					</Button>
				)}
			</div>
			<div
				role="radiogroup"
				aria-labelledby={labelId}
				onKeyDown={onChipKeyDown}
				/* Equal columns below `lg`; ROW OF CHIPS above it. The companion sample
				   narrows this column from 848 to 592px, which leaves 112px a chip, and
				   an "adjusted" preset name measures 117px - so the chip that is the only
				   cue the value sits between presets was the one that ellipsised (UX U6).
				   Flexing lets that one chip take its content width (below) while the
				   other four share what is left: no fixed track has to guess which preset
				   is nearest, and nothing can overflow a translated label. */
				className="grid grid-cols-5 gap-2 lg:flex"
			>
				{PRESET_ORDER.map(({ name, value: preset }) => {
					const isChecked = checked === name;
					const isNearest = nearest === name;
					const tabbable = isChecked || (checked === null && isNearest);
					return (
						<Tooltip
							key={name}
							content={t(PRESET_DESCRIPTION_KEY[name])}
							side="bottom"
						>
							<button
								// biome-ignore lint/a11y/useSemanticElements: a preset chip carries a scoped theme swatch and a check; `<input type="radio">` cannot hold that content, and the radiogroup's arrow-key contract is implemented above.
								type="button"
								role="radio"
								aria-checked={isChecked}
								tabIndex={tabbable ? 0 : -1}
								data-contrast-chip={name}
								onClick={() => commit(preset)}
								className={cn(
									"relative flex h-13 min-w-0 flex-1 flex-col gap-1 rounded-md p-1 text-start transition-colors duration-fast ease-out-quart max-[900px]:h-12",
									// The adjusted chip keeps its whole label: it is the only visual cue
									// that the value is off-preset, and `flex-none` takes its natural
									// width while the four preset chips shrink to fit beside it.
									isNearest && "lg:flex-none",
									isChecked
										? "bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-accent-wash))]"
										: "hover:bg-surface",
								)}
							>
								{/*
								 * The chip's swatch is THIS theme at THIS preset, scoped by
								 * `data-theme` onto a block the parent writes
								 * (`PREVIEW_IDS.chip`), so the user sees what each preset does
								 * to their theme before choosing. The frame is the picker's
								 * chrome, outside the scoped element, so it is drawn in the
								 * app's accent rather than the previewed one.
								 */}
								<span
									className={cn(
										"relative block h-6 overflow-hidden rounded-sm border",
										isChecked ? "border-accent" : "border-hairline",
									)}
								>
									<span
										data-theme={PREVIEW_IDS.chip(name)}
										aria-hidden="true"
										className="flex h-full flex-col justify-center gap-0.5 bg-canvas px-1.5"
									>
										<span className="block h-0.5 w-3/4 rounded-full bg-ink" />
										<span className="block h-0.5 w-1/2 rounded-full bg-ink-muted" />
										<span className="mt-0.5 block h-px w-full bg-border-control" />
									</span>
									{isChecked && (
										<span className="absolute end-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent text-on-accent">
											<Check size={10} strokeWidth={3} />
										</span>
									)}
								</span>
								<span
									className={cn(
										"truncate px-0.5 text-meta",
										isChecked ? "text-ink" : "text-ink-muted",
									)}
								>
									{isNearest
										? t("ui.settings.appearance.contrast.adjusted", {
												preset: presetLabel(name),
											})
										: presetLabel(name)}
								</span>
							</button>
						</Tooltip>
					);
				})}
			</div>
			<output aria-live="polite" aria-atomic="true" className="sr-only">
				{contrastValueText(value)}
			</output>
			<div className="flex items-center gap-3 px-1">
				<span className="shrink-0 text-meta text-ink-dim">
					{t("ui.settings.appearance.contrast.softer")}
				</span>
				<input
					type="range"
					min={-100}
					max={100}
					step={CONTRAST_STEP}
					value={value}
					aria-label={t("ui.settings.appearance.contrast.slider")}
					aria-valuetext={contrastValueText(value)}
					aria-describedby={hintId}
					data-contrast-slider=""
					onPointerDown={onPointerDown}
					onKeyDown={onKeyDown}
					onKeyUp={onKeyUp}
					onChange={(event) => {
						/* Assistive technology changes ranges without pointer/key events.
						   Those changes are complete actions, unlike a live drag. */
						const next = snapContrast(Number(event.target.value), {
							snap: dragging.current,
						});
						if (dragging.current) move(next);
						else commit(next);
					}}
					style={{ "--fill": `${fill}%` } as CSSProperties}
					className={
						/* The same track and thumb as `SliderSetting` and the glass
						   slider: accent up to the fill, sunken past it. */
						"h-4 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent bg-center bg-no-repeat " +
						"bg-[length:100%_6px] " +
						"bg-[linear-gradient(to_right,var(--color-accent)_0_var(--fill),var(--color-sunken)_var(--fill)_100%)] " +
						"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent " +
						"[&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:duration-fast [&::-webkit-slider-thumb]:ease-out-quart " +
						"[&::-webkit-slider-thumb]:hover:bg-accent-hover"
					}
				/>
				<span className="shrink-0 text-meta text-ink-dim">
					{t("ui.settings.appearance.contrast.deeper")}
				</span>
			</div>
			<p
				id={hintId}
				aria-live="polite"
				className="px-1 text-meta text-ink-muted"
			>
				{pending
					? t("ui.settings.appearance.contrast.applying")
					: capped && effective !== undefined
						? t("ui.settings.appearance.contrast.capped_hint")
						: backgroundAtCeiling
							? t("ui.settings.appearance.contrast.background_ceiling")
							: mode === "dark"
								? t("ui.settings.appearance.contrast.applies_dark")
								: t("ui.settings.appearance.contrast.applies_light")}
			</p>
		</div>
	);
};
