/**
 * The window glass setting: translucency of the app window, on by default where
 * the machine can composite it.
 *
 * WHAT IT IS. A master switch and three controls beneath it - which surfaces go
 * translucent (coverage), how far (frosted to see-through) and which system
 * material sits behind - for the OS-drawn blur that `src/shared/window-glass.ts`
 * decides and `src/main/window-glass.ts` applies. Everything is live: the
 * answer main returns is what the page paints, so the window changes under the
 * pointer as the slider moves. The one exception is Windows' master switch (see
 * `GlassCapability.liveToggle`), which says so in a notice rather than half
 * applying.
 *
 * WHY IT IS PRESENTATIONAL. It takes the state and a setter instead of reading the
 * bridge, so a story and a test can drive every branch (supported, each reason it
 * is not, restart pending) without an Electron window; `settings-page.tsx` binds it
 * to `useWindowGlass`.
 *
 * WHERE IT DOES NOT SHOW. With no bridge (Storybook, a browser) the row is absent:
 * there is nothing to control. Where the gate refuses (Windows until verified,
 * Linux, Reduce transparency, GPU off or software-only, no backdrop blur) the row
 * STAYS, greyed and disabled, with the exact cause as a tooltip and the same
 * sentence under it. Hidden controls teach nobody why the feature is missing, and
 * a dead-looking switch with no reason is the vaguer failure the operator called
 * out. The gate is enforced again at render time in main (`glassIsActive`), so a
 * stale enabled value cannot paint a window the platform cannot composite.
 *
 * THE SLIDER IS LABELLED BY ITS ENDS. "Frosted to see-through" names the axis, the
 * native range input gives keyboard and `aria-valuenow` for free (`slider-setting`'s
 * reasoning), and the value is announced as a percentage of the way to see-through
 * via `aria-valuetext`. The write is committed on release/key-up, like
 * `SliderSetting`, so one drag is one persisted write - but the live preview while
 * dragging is the point of the control, so it also sends on every change, coalesced
 * to one in flight.
 */

import { ToggleSetting } from "@shared/components/common/toggle-setting";
import { Tabs, TabsList, TabsTrigger, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { type CSSProperties, type FC, useId, useRef, useState } from "react";
import {
	GLASS_COVERAGES,
	type GlassCoverage,
	type GlassMaterial,
	type GlassReason,
	type GlassSettings,
	type WindowGlassState,
} from "../../../../../shared/window-glass";

type WindowGlassSettingProps = {
	/** Main's state, or null while it is unknown (no bridge, or not yet answered). */
	state: WindowGlassState | null;
	/** Writes a patch and applies main's answer. */
	onChange: (patch: Partial<GlassSettings>) => Promise<void>;

	/** Settings search's stable row id, when this control is a searchable row. */
	searchRow?: string;
};

const coverageLabel = (coverage: GlassCoverage): string =>
	coverage === "sidebars"
		? t("ui.settings.appearance.window_glass.coverage_sidebars")
		: t("ui.settings.appearance.window_glass.coverage_full");

const materialLabel = (material: GlassMaterial): string => {
	switch (material) {
		case "window":
			return t("ui.settings.appearance.window_glass.material_window");
		case "menu":
			return t("ui.settings.appearance.window_glass.material_menu");
		case "popover":
			return t("ui.settings.appearance.window_glass.material_popover");
		case "mica":
			return t("ui.settings.appearance.window_glass.material_mica");
		case "acrylic":
			return t("ui.settings.appearance.window_glass.material_acrylic");
		case "tabbed":
			return t("ui.settings.appearance.window_glass.material_tabbed");
	}
};

const unsupportedCopy = (reason: GlassReason): string => {
	switch (reason) {
		case "reduced-transparency":
			return t(
				"ui.settings.appearance.window_glass.unsupported_reduced_transparency",
			);
		case "windows-too-old":
			return t(
				"ui.settings.appearance.window_glass.unsupported_windows_too_old",
			);
		case "windows-unverified":
			return t(
				"ui.settings.appearance.window_glass.unsupported_windows_unverified",
			);
		case "linux-compositor-dependent":
			return t("ui.settings.appearance.window_glass.unsupported_linux");
		case "hardware-acceleration-disabled":
			return t("ui.settings.appearance.window_glass.unsupported_acceleration");
		case "gpu-unavailable":
			return t("ui.settings.appearance.window_glass.unsupported_gpu");
		case "backdrop-filter-unavailable":
			return t(
				"ui.settings.appearance.window_glass.unsupported_backdrop_filter",
			);
		default:
			return t("ui.settings.appearance.window_glass.unsupported_other");
	}
};

/** A row of the same geometry `TranscriptDisplayModeSetting` uses. */
const SegmentRow: FC<{
	label: string;
	description: string;
	value: string;
	onValueChange: (value: string) => void;
	options: readonly { value: string; label: string }[];
}> = ({ label, description, value, onValueChange, options }) => {
	const labelId = useId();
	return (
		<div className="flex items-start justify-between gap-4">
			<div className="min-w-0 flex-1">
				<span
					id={labelId}
					className="flex min-h-6 items-center text-body text-ink"
				>
					{label}
				</span>
				<p className="mt-0.5 max-w-2xl text-body-sm text-ink-muted">
					{description}
				</p>
			</div>
			<div className="flex h-6 shrink-0 items-center">
				<Tabs value={value} onValueChange={onValueChange}>
					<TabsList aria-labelledby={labelId}>
						{options.map((option) => (
							<TabsTrigger key={option.value} value={option.value}>
								{option.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			</div>
		</div>
	);
};

export const WindowGlassSetting: FC<WindowGlassSettingProps> = ({
	state,
	onChange,
	searchRow,
}) => {
	useI18nLocale();
	const sliderId = useId();
	const descriptionId = `${sliderId}-description`;
	const [dragValue, setDragValue] = useState<number | null>(null);
	/* At most one write in flight while dragging; the latest value wins after it. */
	const inFlight = useRef(false);
	const pending = useRef<number | null>(null);
	const intensity = state?.settings.intensity ?? 0;

	if (!state) return null;

	/*
	 * UNSUPPORTED IS GREYED, NOT HIDDEN. The row below renders disabled with the
	 * reason as a tooltip and as a line of its own; the three dependent controls
	 * are withheld because they would all be inert. `data-glass-gate` is the
	 * stable hook the design and QA rigs read (a reason token, not copy).
	 */
	const unsupported = !state.capability.supported;
	const reasonCopy = unsupported
		? unsupportedCopy(state.capability.reason)
		: null;

	/*
	 * ONE WRITE IN FLIGHT, THE LATEST VALUE WINS. `pending` holds the newest value
	 * seen while a write was out; when it settles the newest is sent. The local
	 * `dragValue` is cleared only once nothing is pending or in flight: clearing it on
	 * key-up while a write was still out snapped the thumb back to the OLD stored
	 * value, and the next key repeat stepped from that, dropping steps (QA Q6:
	 * six taps 0 ms apart moved +10, not +30).
	 */
	const send = async (value: number): Promise<void> => {
		if (inFlight.current) {
			pending.current = value;
			return;
		}
		inFlight.current = true;
		try {
			await onChange({ intensity: value });
		} finally {
			inFlight.current = false;
			const next = pending.current;
			pending.current = null;
			if (next !== null && next !== value) void send(next);
			else setDragValue(null);
		}
	};

	const enabled = state.settings.enabled;
	const shown = dragValue ?? intensity;

	return (
		<div
			data-search-row={searchRow}
			data-search-control={searchRow ? "" : undefined}
			className="flex flex-col gap-4"
			data-window-glass=""
			data-glass-gate={state.capability.reason}
		>
			<Tooltip content={reasonCopy} disabled={!unsupported}>
				<div className={unsupported ? "opacity-60" : undefined}>
					{/*
					 * A GREYED ROW SHOWS OFF, NOT A CHECKED EFFECT IT CANNOT RUN. The
					 * stored choice is kept in `settings` (and on a stale profile), but a
					 * checked switch promises a translucency that is not on screen; the
					 * cause line is what explains the refusal (QA Q-2). The `key` remounts
					 * the toggle when the gate flips, because `ToggleSetting` keeps its own
					 * copy of the value and would otherwise show the last interactive state
					 * (including a checked one) after a live capability drop.
					 */}
					<ToggleSetting
						key={unsupported ? "unavailable" : "available"}
						value={unsupported ? false : enabled}
						disabled={unsupported}
						label={t("ui.settings.appearance.window_glass.label")}
						description={t("ui.settings.appearance.window_glass.description")}
						onChange={async (next) => onChange({ enabled: next })}
					/>
				</div>
			</Tooltip>
			{reasonCopy && (
				<p
					data-glass-unsupported={state.capability.reason}
					className="max-w-2xl text-body-sm text-ink-muted"
				>
					{reasonCopy}
				</p>
			)}
			{state.restartRequired && (
				<output
					className="block max-w-2xl text-body-sm text-ink"
					data-glass-restart=""
				>
					{t("ui.settings.appearance.window_glass.restart_needed")}
				</output>
			)}
			{enabled && !unsupported && (
				<>
					<SegmentRow
						label={t("ui.settings.appearance.window_glass.coverage_label")}
						description={t(
							"ui.settings.appearance.window_glass.coverage_description",
						)}
						value={state.settings.coverage}
						onValueChange={(next) =>
							void onChange({ coverage: next as GlassCoverage })
						}
						options={GLASS_COVERAGES.map((value) => ({
							value,
							label: coverageLabel(value),
						}))}
					/>
					<div>
						{/* The value rides the label row, as in `SliderSetting`: a sighted
						    reader gets "what is this set to" without reading the fill. */}
						<div className="flex min-h-6 items-center justify-between gap-3">
							<label htmlFor={sliderId} className="text-body text-ink">
								{t("ui.settings.appearance.window_glass.intensity_label")}
							</label>
							<span
								data-glass-readout=""
								className="shrink-0 text-meta text-ink-dim tabular-nums"
							>
								{t("ui.settings.appearance.window_glass.intensity_value", {
									value: String(shown),
								})}
							</span>
						</div>
						<p
							id={descriptionId}
							className="mt-0.5 max-w-2xl text-body-sm text-ink-muted"
						>
							{t("ui.settings.appearance.window_glass.intensity_description")}
						</p>
						<input
							id={sliderId}
							type="range"
							min={0}
							max={100}
							step={5}
							value={shown}
							aria-describedby={descriptionId}
							aria-valuetext={t(
								"ui.settings.appearance.window_glass.intensity_value",
								{ value: String(shown) },
							)}
							onChange={(event) => {
								const value = Number(event.target.value);
								setDragValue(value);
								void send(value);
							}}
							style={
								{
									"--fill": `${shown}%`,
								} as CSSProperties
							}
							className={
								/* The same track and thumb as `SliderSetting`: accent up to the
								   fill, sunken past it, a round accent thumb. */
								"mt-3 h-4 w-full cursor-pointer appearance-none bg-transparent bg-center bg-no-repeat " +
								"bg-[length:100%_6px] " +
								"bg-[linear-gradient(to_right,var(--color-accent)_0_var(--fill),var(--color-sunken)_var(--fill)_100%)] " +
								"[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent " +
								"[&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:duration-fast [&::-webkit-slider-thumb]:ease-out-quart " +
								"[&::-webkit-slider-thumb]:hover:bg-accent-hover"
							}
						/>
						<div
							aria-hidden="true"
							className="mt-1 flex justify-between text-meta text-ink-dim"
						>
							<span>
								{t("ui.settings.appearance.window_glass.intensity_start")}
							</span>
							<span>
								{t("ui.settings.appearance.window_glass.intensity_end")}
							</span>
						</div>
					</div>
					<SegmentRow
						label={t("ui.settings.appearance.window_glass.material_label")}
						description={t(
							"ui.settings.appearance.window_glass.material_description",
						)}
						value={state.settings.material}
						onValueChange={(next) =>
							void onChange({ material: next as GlassMaterial })
						}
						options={state.capability.materials.map((value) => ({
							value,
							label: materialLabel(value),
						}))}
					/>
				</>
			)}
		</div>
	);
};
