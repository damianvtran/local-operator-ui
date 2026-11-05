import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	type KeyboardEvent,
	type PointerEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { normalizeHex } from "../../../../../shared/theme-engine/accent.mjs";
import {
	type Oklch,
	hexToOklch,
	oklchToHex,
	rgbToHex,
} from "../../../../../shared/theme-engine/oklch.mjs";
import { Button } from "./button";

const RECENT_KEY = "lo-recent-colours-v1";
const recentColours = (): string[] => {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
		return Array.isArray(value)
			? value
					.filter((v) => typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v))
					.slice(0, 8)
			: [];
	} catch {
		return [];
	}
};
export const rememberColour = (hex: string) => {
	try {
		localStorage.setItem(
			RECENT_KEY,
			JSON.stringify(
				[hex, ...recentColours().filter((v) => v !== hex)].slice(0, 8),
			),
		);
	} catch {
		/* Optional history must not turn a successful save into a failure. */
	}
};

/** No canvas-only controls: the two-axis area has a keyboard contract and
 * independently labelled native sliders expose every dimension. Pointer moves
 * paint only this draft; persistence belongs to the caller's explicit Save.
 */
export const ColourPicker = ({
	value,
	onChange,
	onValidityChange,
	swatches = [],
}: {
	value: string;
	onChange: (hex: string) => void;
	swatches?: string[];
	onValidityChange?: (valid: boolean) => void;
}) => {
	useI18nLocale();
	const id = useId();
	const lastPainted = useRef(value);
	const [coordinates, setCoordinates] = useState(() => hexToOklch(value));
	const [text, setText] = useState(value);
	const [format, setFormat] = useState("hex");
	const [error, setError] = useState(false);
	const [clipped, setClipped] = useState(false);
	const [eyeError, setEyeError] = useState(false);

	const formatText = useCallback(
		(hex: string, coord: Oklch, mode = format) =>
			mode === "rgb"
				? [1, 3, 5]
						.map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
						.join(", ")
				: mode === "oklch"
					? `${(coord.l * 100).toFixed(2)} ${coord.c.toFixed(4)} ${coord.h.toFixed(2)}`
					: hex,
		[format],
	);
	useEffect(() => {
		if (value === lastPainted.current) return;
		lastPainted.current = value;
		const next = hexToOklch(value);
		setCoordinates(next);
		setText(formatText(value, next));
		setClipped(false);
		setError(false);
		onValidityChange?.(true);
	}, [value, formatText, onValidityChange]);
	const paint = (coord: Oklch) => {
		const next = {
			l: Math.max(0, Math.min(1, coord.l)),
			c: Math.max(0, Math.min(0.4, coord.c)),
			h: ((coord.h % 360) + 360) % 360,
		};
		const result = oklchToHex(next);
		setCoordinates(next);
		lastPainted.current = result.hex;
		setClipped(result.clipped);
		setText(formatText(result.hex, next));
		setError(false);
		onValidityChange?.(true);
		onChange(result.hex);
	};
	const choose = (hex: string) => {
		const coord = hexToOklch(hex);
		lastPainted.current = hex;
		setCoordinates(coord);
		setText(formatText(hex, coord));
		setClipped(false);
		setError(false);
		onValidityChange?.(true);
		onChange(hex);
	};
	const commit = () => {
		const numbers = text
			.trim()
			.split(/[\s,]+/)
			.map(Number);
		const hex =
			format === "hex"
				? normalizeHex(text)
				: format === "rgb"
					? rgbToHex(numbers)
					: null;
		if (
			format === "oklch" &&
			numbers.length === 3 &&
			numbers.every(Number.isFinite) &&
			numbers[0] >= 0 &&
			numbers[0] <= 100 &&
			numbers[1] >= 0 &&
			numbers[1] <= 0.4 &&
			numbers[2] >= 0 &&
			numbers[2] <= 360
		) {
			paint({ l: numbers[0] / 100, c: numbers[1], h: numbers[2] });
			return;
		}
		if (!hex) {
			setError(true);
			onValidityChange?.(false);
			return;
		}
		choose(hex);
	};
	const pointer = (event: PointerEvent<HTMLDivElement>) => {
		const box = event.currentTarget.getBoundingClientRect();
		paint({
			...coordinates,
			c: ((event.clientX - box.left) / box.width) * 0.4,
			l: 1 - (event.clientY - box.top) / box.height,
		});
	};
	const key = (event: KeyboardEvent<HTMLDivElement>) => {
		const step = event.shiftKey ? 0.1 : 0.01;
		const next = { ...coordinates };
		switch (event.key) {
			case "ArrowLeft":
				next.c -= step * 0.4;
				break;
			case "ArrowRight":
				next.c += step * 0.4;
				break;
			case "ArrowUp":
				next.l += step;
				break;
			case "ArrowDown":
				next.l -= step;
				break;
			case "Home":
				next.c = 0;
				break;
			case "End":
				next.c = 0.4;
				break;
			case "PageUp":
				next.l += 0.1;
				break;
			case "PageDown":
				next.l -= 0.1;
				break;
			default:
				return;
		}
		event.preventDefault();
		paint(next);
	};
	// Sample the same gamut-mapped OKLCH function used by pointer/keyboard edits.
	// A generic white/hue/black gradient would lie about both axes in OKLCH.
	const areaRows = useMemo(
		() =>
			Array.from({ length: 48 }, (_, row) => {
				const l = 1 - (row + 0.5) / 48;
				return `linear-gradient(to right, ${Array.from({ length: 17 }, (_, column) => oklchToHex({ l, c: (column / 16) * 0.4, h: coordinates.h }).hex).join(", ")})`;
			}),
		[coordinates.h],
	);
	const EyeDropper = (
		globalThis as typeof globalThis & {
			EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
		}
	).EyeDropper;
	return (
		<div className="flex min-w-0 flex-col gap-3" data-colour-picker="">
			<div id={`${id}-help`} className="sr-only">
				{t("ui.settings.appearance.editor.picker.area_description")}
			</div>
			<div
				role="slider"
				tabIndex={0}
				aria-label={t("ui.settings.appearance.editor.picker.area")}
				aria-describedby={`${id}-help`}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(coordinates.l * 100)}
				aria-valuetext={t("ui.settings.appearance.editor.picker.area_value", {
					lightness: String(Math.round(coordinates.l * 100)),
					chroma: coordinates.c.toFixed(3),
					hue: String(Math.round(coordinates.h)),
				})}
				onKeyDown={key}
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId);
					pointer(event);
				}}
				onPointerMove={(event) => {
					if (event.currentTarget.hasPointerCapture(event.pointerId))
						pointer(event);
				}}
				className="relative h-40 touch-none rounded-md border border-control focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
			>
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 flex flex-col"
				>
					{areaRows.map((background, index) => (
						<div
							key={String(index)}
							className="min-h-0 flex-1"
							style={{ background }}
						/>
					))}
				</div>
				<span
					aria-hidden="true"
					className="pointer-events-none absolute size-3 rounded-full border-2 border-white outline-1 outline-black"
					style={{
						left: `calc(${(coordinates.c / 0.4) * 100}% - 6px)`,
						top: `calc(${(1 - coordinates.l) * 100}% - 6px)`,
						background: value,
					}}
				/>
			</div>
			<label className="flex flex-col gap-1 text-meta">
				{t("ui.settings.appearance.picker.hue")}
				<input
					type="range"
					dir="ltr"
					min={0}
					max={360}
					step={1}
					value={coordinates.h}
					onChange={(e) => paint({ ...coordinates, h: Number(e.target.value) })}
					className="h-6 w-full accent-accent"
					style={{
						background:
							"linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
					}}
				/>
			</label>
			<div className="grid grid-cols-2 gap-2">
				<label className="flex flex-col gap-1 text-meta">
					{t("ui.settings.appearance.editor.picker.lightness")}
					<input
						type="range"
						dir="ltr"
						min={0}
						max={100}
						value={coordinates.l * 100}
						onChange={(e) =>
							paint({ ...coordinates, l: Number(e.target.value) / 100 })
						}
						className="h-6 w-full accent-accent"
					/>
				</label>
				<label className="flex flex-col gap-1 text-meta">
					{t("ui.settings.appearance.editor.picker.chroma")}
					<input
						type="range"
						dir="ltr"
						min={0}
						max={0.4}
						step={0.001}
						value={coordinates.c}
						onChange={(e) =>
							paint({ ...coordinates, c: Number(e.target.value) })
						}
						className="h-6 w-full accent-accent"
					/>
				</label>
			</div>
			<div className="flex min-w-0 gap-2">
				<select
					aria-label={t("ui.settings.appearance.editor.picker.format")}
					value={format}
					onChange={(e) => {
						setFormat(e.target.value);
						setText(formatText(value, coordinates, e.target.value));
						setError(false);
					}}
					className="min-w-0 rounded-sm border border-control bg-sunken px-2 text-body-sm"
				>
					<option value="hex">{t("ui.settings.appearance.picker.hex")}</option>
					<option value="rgb">
						{t("ui.settings.appearance.editor.picker.rgb")}
					</option>
					<option value="oklch">
						{t("ui.settings.appearance.editor.picker.oklch")}
					</option>
				</select>
				<input
					dir="ltr"
					aria-label={
						format === "hex"
							? t("ui.settings.appearance.picker.hex")
							: format === "rgb"
								? t("ui.settings.appearance.editor.picker.rgb")
								: t("ui.settings.appearance.editor.picker.oklch")
					}
					value={text}
					aria-invalid={error}
					aria-describedby={error ? `${id}-error` : undefined}
					onChange={(e) => {
						setText(e.target.value);
						setError(true);
						onValidityChange?.(false);
					}}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						}
					}}
					className="min-w-0 flex-1 rounded-sm border border-control bg-sunken px-2 py-1.5 font-mono text-meta"
				/>
				<span
					aria-hidden="true"
					className="size-8 shrink-0 rounded-sm border border-control"
					style={{ backgroundColor: value }}
				/>
			</div>
			{error && (
				<p id={`${id}-error`} role="alert" className="text-meta text-danger">
					{t("ui.settings.appearance.editor.picker.invalid_channels")}
				</p>
			)}
			{clipped && (
				<p className="text-meta text-ink-muted">
					{t("ui.settings.appearance.editor.picker.gamut")}
				</p>
			)}
			{[
				{
					key: "theme",
					label: t("ui.settings.appearance.editor.picker.theme_swatches"),
					items: swatches,
				},
				{
					key: "recent",
					label: t("ui.settings.appearance.editor.picker.recent"),
					items: recentColours(),
				},
			].map((group) => (
				<div key={group.key} className="flex flex-col gap-1">
					<span className="text-meta text-ink-muted">{group.label}</span>
					<div className="flex flex-wrap gap-1">
						{[...new Set(group.items)].map((hex) => (
							<button
								key={hex}
								type="button"
								aria-label={t("ui.settings.appearance.editor.picker.swatch", {
									hex,
								})}
								className="size-7 rounded-sm border border-control focus-visible:outline-2 focus-visible:outline-accent"
								style={{ background: hex }}
								onClick={() => choose(hex)}
							/>
						))}
					</div>
					{!group.items.length && (
						<span className="text-meta text-ink-dim">
							{t("ui.settings.appearance.editor.picker.recent_empty")}
						</span>
					)}
				</div>
			))}
			{EyeDropper && (
				<Button
					type="button"
					variant="secondary"
					onClick={async () => {
						try {
							const result = await new EyeDropper().open();
							const hex = normalizeHex(result.sRGBHex);
							if (hex) choose(hex);
							setEyeError(false);
						} catch (e) {
							if (!(e instanceof DOMException && e.name === "AbortError"))
								setEyeError(true);
						}
					}}
				>
					{t("ui.settings.appearance.picker.eyedropper")}
				</Button>
			)}
			{eyeError && (
				<p role="alert" className="text-meta text-danger">
					{t("ui.settings.appearance.editor.picker.eyedropper_error")}
				</p>
			)}
		</div>
	);
};
