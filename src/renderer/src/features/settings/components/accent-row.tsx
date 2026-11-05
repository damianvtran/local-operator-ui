import { Button, Input } from "@shared/components/ui";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@shared/components/ui/context-menu";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@shared/components/ui/popover";
import { Tooltip, TooltipProvider } from "@shared/components/ui/tooltip";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Check, Pipette, Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, FC, KeyboardEvent, ReactNode } from "react";
import type { AccentRef } from "../../../../../shared/theme-engine/accent.mjs";
import { normalizeHex } from "../../../../../shared/theme-engine/accent.mjs";
import { CUSTOM_ACCENTS_LIMIT } from "../../../../../shared/theme-engine/appearance.mjs";
import type {
	AccentSwatch,
	HueName,
} from "../../../../../shared/theme-engine/picker.mjs";
import {
	CUSTOM_ACCENT_NAME_MAX,
	hexToLch,
	hueName,
	lchToHex,
	onAccentPreview,
} from "../../../../../shared/theme-engine/picker.mjs";

/**
 * The ACCENT layer (designer spec 7): the theme's own accent first, its second
 * accent, a short curated row from other same-mode themes (expandable to all),
 * a divider, the user's own accents (MRU, <= 12), and "+".
 *
 * The selection is a REFERENCE (`AccentRef`), not a colour: `{kind:"theme"}`
 * follows whichever theme is active, so a user who never touches this row sees
 * no change on a theme switch, while a `custom` or `palette` ref keeps the
 * user's colour across theme switches (re-solved for legibility by the engine).
 * Controlled and presentational: `AppearanceLayers` owns the store.
 *
 * ON-ACCENT INK IS NEVER THE USER'S JOB: the engine picks it (`pickOnAccent`),
 * the selected swatch's check is drawn in it, and the "+" picker shows the
 * text-on-accent ratio before the colour is committed.
 */

export type AccentRowProps = {
	themeName: string;
	themeAccent: string;
	themeAccentAlt: string;
	curated: AccentSwatch[];
	all: AccentSwatch[];
	/** Display name of a palette id ("Tokyo Night"). */
	paletteName: (id: string) => string;
	custom: string[];
	customNames: Record<string, string>;
	selected: AccentRef;
	/** The accent the document actually paints (after the legibility solve). */
	paintedAccent: string;
	/** The engine's ΔE00 move for the selected accent; > 5 shows the hint. */
	adjusted: number;
	/** False when no legible version existed and the theme's accent is shown. */
	applied: boolean;
	onSelect: (ref: AccentRef) => void;
	onAdd: (hex: string) => void;
	onReplace: (from: string, to: string) => void;
	onRename: (hex: string, name: string) => void;
	onRemove: (hex: string) => void;
};

/** The ΔE00 past which the solved accent is "adjusted" (architect 5.3). */
const ADJUSTED_DELTA_E = 5;

const HUE_KEY: Record<HueName, Parameters<typeof t>[0]> = {
	red: "ui.settings.appearance.hue.red",
	orange: "ui.settings.appearance.hue.orange",
	amber: "ui.settings.appearance.hue.amber",
	yellow: "ui.settings.appearance.hue.yellow",
	lime: "ui.settings.appearance.hue.lime",
	green: "ui.settings.appearance.hue.green",
	teal: "ui.settings.appearance.hue.teal",
	cyan: "ui.settings.appearance.hue.cyan",
	blue: "ui.settings.appearance.hue.blue",
	indigo: "ui.settings.appearance.hue.indigo",
	violet: "ui.settings.appearance.hue.violet",
	pink: "ui.settings.appearance.hue.pink",
	neutral: "ui.settings.appearance.hue.neutral",
};
export const hueLabel = (hex: string): string =>
	t(HUE_KEY[hueName(hex)] as "ui.settings.appearance.hue.red");

const sameRef = (a: AccentRef, b: AccentRef): boolean => {
	if (a.kind !== b.kind) return false;
	if (a.kind === "palette" && b.kind === "palette") return a.id === b.id;
	if (a.kind === "custom" && b.kind === "custom") return a.hex === b.hex;
	return true;
};

type Entry = {
	key: string;
	ref: AccentRef;
	hex: string;
	label: string;
	custom?: string;
};

export const AccentRow: FC<AccentRowProps> = (props) => {
	useI18nLocale();
	const {
		themeName,
		themeAccent,
		themeAccentAlt,
		curated,
		all,
		paletteName,
		custom,
		customNames,
		selected,
		paintedAccent,
		adjusted,
		applied,
	} = props;
	const [showAll, setShowAll] = useState(false);
	const [picker, setPicker] = useState<
		| { kind: "add" }
		| { kind: "edit"; hex: string }
		| { kind: "rename"; hex: string }
		| null
	>(null);

	const fromThemes = showAll ? all : curated;
	const builtins: Entry[] = useMemo(
		() => [
			{
				key: "theme",
				ref: { kind: "theme" },
				hex: themeAccent,
				label: t("ui.settings.appearance.accent.theme_accent", {
					theme: themeName,
				}),
			},
			{
				key: "theme-alt",
				ref: { kind: "theme-alt" },
				hex: themeAccentAlt,
				label: t("ui.settings.appearance.accent.theme_second_accent", {
					theme: themeName,
				}),
			},
			...fromThemes.map((s) => ({
				key: `palette:${s.id}`,
				ref: { kind: "palette", id: s.id } as AccentRef,
				hex: s.hex,
				label: t("ui.settings.appearance.accent.from_theme", {
					theme: paletteName(s.id),
					hue: hueLabel(s.hex),
				}),
			})),
		],
		[themeName, themeAccent, themeAccentAlt, fromThemes, paletteName],
	);
	const yours: Entry[] = custom.map((hex) => ({
		key: `custom:${hex}`,
		ref: { kind: "custom", hex },
		hex,
		custom: hex,
		label: t("ui.settings.appearance.accent.custom_swatch", {
			name: customNames[hex] ?? hex,
		}),
	}));
	/* A borrowed accent the curated row does not show (picked from "Show all",
	   then collapsed) still needs a visible, checked swatch: state is never
	   carried by nothing. Appended to the theme group while selected. */
	const shown: Entry[] = [...builtins];
	if (
		selected.kind === "palette" &&
		!builtins.some((e) => sameRef(e.ref, selected))
	) {
		const hit = all.find((s) => s.id === selected.id);
		if (hit)
			shown.push({
				key: `palette:${hit.id}`,
				ref: selected,
				hex: hit.hex,
				label: t("ui.settings.appearance.accent.from_theme", {
					theme: paletteName(hit.id),
					hue: hueLabel(hit.hex),
				}),
			});
	}
	const entries = [...shown, ...yours];
	const selectedIndex = Math.max(
		0,
		entries.findIndex((e) => sameRef(e.ref, selected)),
	);
	const adjustedNote =
		selected.kind !== "theme" && applied && adjusted > ADJUSTED_DELTA_E
			? t("ui.settings.appearance.accent.adjusted")
			: null;

	/*
	 * ONE TAB STOP, ARROWS MOVE AND SELECT - the `radiogroup` pattern (and the
	 * same single-stop rule the theme grid follows), so the row costs a keyboard
	 * user one Tab however many swatches it holds. The custom group shares the
	 * stop: the divider is visual, not a second group to tab through.
	 */
	const groupRef = useRef<HTMLDivElement>(null);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
		if (
			!keys.includes(event.key) &&
			event.key !== "Home" &&
			event.key !== "End"
		)
			return;
		const radios = [
			...(groupRef.current?.querySelectorAll<HTMLButtonElement>(
				'[role="radio"]',
			) ?? []),
		];
		const at = radios.indexOf(event.target as HTMLButtonElement);
		if (at < 0) return;
		event.preventDefault();
		/* Logical direction: in RTL the row runs right to left, so ArrowRight
		   moves BACK - the arrow follows what the user sees. */
		const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
		const forward =
			event.key === "ArrowDown" ||
			(event.key === "ArrowRight" && !rtl) ||
			(event.key === "ArrowLeft" && rtl);
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? radios.length - 1
					: (at + (forward ? 1 : -1) + radios.length) % radios.length;
		radios[next]?.focus();
		radios[next]?.click();
	};

	const swatch = (entry: Entry, index: number): ReactNode => {
		const isSelected = index === selectedIndex;
		const button = (
			<button
				// biome-ignore lint/a11y/useSemanticElements: a swatch is a coloured circle with a check drawn in the engine's on-accent ink and a context menu; a native radio cannot carry either, and the radiogroup's arrow-key contract is implemented above.
				type="button"
				role="radio"
				aria-checked={isSelected}
				aria-label={entry.label}
				tabIndex={isSelected ? 0 : -1}
				data-accent-swatch={entry.key}
				onClick={() => props.onSelect(entry.ref)}
				className={cn(
					/* A 32px hit target around a 24px circle; selected is a 2px ink
					   ring at 2px offset PLUS a check (state is never colour alone). */
					"relative flex size-8 shrink-0 items-center justify-center rounded-full",
				)}
			>
				<span
					aria-hidden="true"
					style={{ backgroundColor: entry.hex } as CSSProperties}
					className={cn(
						"flex size-6 items-center justify-center rounded-full border border-hairline",
						isSelected && "outline-2 outline-ink outline-offset-2",
					)}
				>
					{isSelected && (
						<Check
							size={14}
							strokeWidth={3}
							/* The check is drawn in the ink the engine chose for text
							   on this accent, when the accent is the painted one; a
							   swatch shown for reference gets the black/white that
							   reads on its own colour. */
							style={{
								color:
									entry.hex.toUpperCase() === paintedAccent.toUpperCase()
										? "var(--color-on-accent)"
										: onAccentPreview(entry.hex).ink,
							}}
						/>
					)}
				</span>
			</button>
		);
		const tip =
			isSelected && adjustedNote
				? `${entry.label}. ${adjustedNote}`
				: entry.label;
		const withTip = (
			<Tooltip key={entry.key} side="bottom" content={tip}>
				{button}
			</Tooltip>
		);
		if (!entry.custom) return withTip;
		const hex = entry.custom;
		return (
			<ContextMenu key={entry.key}>
				<ContextMenuTrigger asChild>
					<span className="inline-flex">{withTip}</span>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onSelect={() => setPicker({ kind: "edit", hex })}>
						{t("ui.settings.appearance.accent.edit_colour")}
					</ContextMenuItem>
					<ContextMenuItem onSelect={() => setPicker({ kind: "rename", hex })}>
						{t("ui.settings.appearance.accent.rename")}
					</ContextMenuItem>
					<ContextMenuItem destructive onSelect={() => props.onRemove(hex)}>
						{t("ui.settings.appearance.accent.remove")}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		);
	};

	return (
		<TooltipProvider>
			<div className="flex flex-col gap-2">
				{/* The visible heading and its Reset link are the section's
				    (`AppearanceLayerControls`); the group is named for assistive
				    tech here. */}
				<Popover
					open={picker !== null}
					onOpenChange={(open) => {
						if (!open) setPicker(null);
					}}
				>
					<div
						ref={groupRef}
						role="radiogroup"
						aria-label={t("ui.settings.appearance.accent.row_label")}
						onKeyDown={onKeyDown}
						className="flex flex-wrap items-center gap-x-2 gap-y-1"
					>
						{shown.map((e, i) => swatch(e, i))}
						{yours.length > 0 && (
							<span
								aria-hidden="true"
								className="mx-1 h-6 w-px shrink-0 bg-hairline"
							/>
						)}
						{yours.map((e, i) => swatch(e, shown.length + i))}
						<PopoverAnchor asChild>
							<span className="inline-flex">
								<Tooltip
									side="bottom"
									content={t("ui.settings.appearance.accent.add")}
								>
									<button
										type="button"
										aria-label={t("ui.settings.appearance.accent.add")}
										data-accent-add=""
										onClick={() => setPicker({ kind: "add" })}
										className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink"
									>
										<span className="flex size-6 items-center justify-center rounded-full border border-control border-dashed">
											<Plus size={14} />
										</span>
									</button>
								</Tooltip>
							</span>
						</PopoverAnchor>
					</div>
					<PopoverContent
						align="start"
						className="w-66"
						aria-label={
							picker?.kind === "rename"
								? t("ui.settings.appearance.picker.rename_dialog")
								: picker?.kind === "edit"
									? t("ui.settings.appearance.picker.edit_dialog")
									: t("ui.settings.appearance.picker.dialog")
						}
					>
						{picker?.kind === "rename" ? (
							<RenameForm
								initial={customNames[picker.hex] ?? ""}
								onCancel={() => setPicker(null)}
								onSave={(name) => {
									props.onRename(picker.hex, name);
									setPicker(null);
								}}
							/>
						) : picker ? (
							<ColourForm
								key={picker.kind === "edit" ? picker.hex : "add"}
								initial={picker.kind === "edit" ? picker.hex : paintedAccent}
								submitLabel={
									picker.kind === "edit"
										? t("ui.settings.appearance.picker.save")
										: t("ui.settings.appearance.picker.add")
								}
								onCancel={() => setPicker(null)}
								onSubmit={(hex) => {
									if (picker.kind === "edit") props.onReplace(picker.hex, hex);
									else props.onAdd(hex);
									setPicker(null);
								}}
							/>
						) : null}
					</PopoverContent>
				</Popover>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
					<Button
						variant="linkQuiet"
						size="sm"
						aria-expanded={showAll}
						onClick={() => setShowAll((v) => !v)}
					>
						{showAll
							? t("ui.settings.appearance.accent.show_fewer")
							: t("ui.settings.appearance.accent.show_all")}
					</Button>
					{custom.length >= CUSTOM_ACCENTS_LIMIT && (
						<span className="text-meta text-ink-dim">
							{t("ui.settings.appearance.accent.limit")}
						</span>
					)}
				</div>
				{/* Honest engine caps (designer 6.3): a colour the engine could not
				    make legible is not silently swapped. */}
				{!applied && selected.kind !== "theme" && (
					<output className="block px-1 text-meta text-warning">
						{t("ui.settings.appearance.accent.not_applied")}
					</output>
				)}
				{adjustedNote && (
					<p className="px-1 text-meta text-ink-muted">{adjustedNote}</p>
				)}
			</div>
		</TooltipProvider>
	);
};

/* ------------------------------------------------------------ the picker */

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/**
 * The basic "+" picker: a live swatch with its text-on-accent readout, a hue
 * slider and a lightness slider (CIELAB LCh at the colour's own chroma), a hex
 * field, and the eyedropper where the platform has one. The full OKLCH area
 * picker belongs to the custom-theme editor (PR C).
 *
 * THE HEX FIELD COMMITS ON ENTER OR BLUR, never per keystroke: a half-typed
 * `#1a` is not a colour, and painting it would flash. While the text is invalid
 * the swatch keeps the last valid colour and the field says why (designer 6.2).
 */
const ColourForm: FC<{
	initial: string;
	submitLabel: string;
	onSubmit: (hex: string) => void;
	onCancel: () => void;
}> = ({ initial, submitLabel, onSubmit, onCancel }) => {
	const [hex, setHex] = useState(normalizeHex(initial) ?? "#3B82F6");
	const [text, setText] = useState(hex);
	const [invalid, setInvalid] = useState(false);
	/* The sliders hold their own LCh so a lightness move does not drift the hue
	   through hex rounding (a grey has no hue to recover). */
	const [lch, setLch] = useState(() => hexToLch(hex));
	const errorId = useId();
	const hexId = useId();
	useEffect(() => {
		setText(hex);
	}, [hex]);
	const fromLch = (next: typeof lch) => {
		setLch(next);
		setHex(lchToHex(next));
		setInvalid(false);
	};
	const commitText = (): string | null => {
		const parsed = normalizeHex(text);
		if (!parsed) {
			setInvalid(true);
			return null;
		}
		setInvalid(false);
		setHex(parsed);
		setLch(hexToLch(parsed));
		return parsed;
	};
	const readout = onAccentPreview(hex);
	const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;
	const hueGradient =
		"linear-gradient(to right in oklch longer hue, oklch(0.7 0.15 0), oklch(0.7 0.15 360))";
	const lightGradient = `linear-gradient(to right, #000, ${lchToHex({ ...lch, l: 50 })}, #fff)`;

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				const parsed = commitText();
				if (parsed) onSubmit(parsed);
			}}
		>
			<div
				data-picker-swatch=""
				style={{ backgroundColor: hex, color: readout.ink }}
				className="flex h-12 items-end rounded-md border border-hairline px-2 py-1 text-meta"
			>
				{t("ui.settings.appearance.picker.text_on_accent", {
					ratio: readout.ratio.toFixed(1),
				})}
			</div>
			<ChannelSlider
				label={t("ui.settings.appearance.picker.hue")}
				valueText={t("ui.settings.appearance.picker.hue_value", {
					deg: String(Math.round(lch.h)),
					name: hueLabel(hex),
				})}
				min={0}
				max={360}
				value={Math.round(lch.h)}
				background={hueGradient}
				onChange={(h) => fromLch({ ...lch, h })}
			/>
			<ChannelSlider
				label={t("ui.settings.appearance.picker.lightness")}
				valueText={t("ui.settings.appearance.picker.lightness_value", {
					value: String(Math.round(lch.l)),
				})}
				min={0}
				max={100}
				value={Math.round(lch.l)}
				background={lightGradient}
				onChange={(l) => fromLch({ ...lch, l })}
			/>
			<div className="flex items-end gap-2">
				<label className="flex min-w-0 flex-1 flex-col gap-1" htmlFor={hexId}>
					<span className="text-meta text-ink-muted">
						{t("ui.settings.appearance.picker.hex")}
					</span>
					<Input
						id={hexId}
						inputSize="sm"
						value={text}
						spellCheck={false}
						autoComplete="off"
						aria-invalid={invalid || undefined}
						aria-describedby={invalid ? errorId : undefined}
						data-picker-hex=""
						onChange={(event) => setText(event.target.value)}
						onBlur={() => {
							/* An invalid entry is discarded on blur: the value reverts
							   and the error stays until the next valid entry. */
							if (!commitText()) setText(hex);
						}}
						className="font-mono"
					/>
				</label>
				{hasEyeDropper && (
					<Tooltip content={t("ui.settings.appearance.picker.eyedropper")}>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.settings.appearance.picker.eyedropper")}
							onClick={() => {
								const Ctor = (
									window as unknown as { EyeDropper: EyeDropperCtor }
								).EyeDropper;
								/* Esc cancels the pick and rejects: silent by design. */
								new Ctor()
									.open()
									.then(({ sRGBHex }) => {
										const parsed = normalizeHex(sRGBHex);
										if (parsed) {
											setHex(parsed);
											setLch(hexToLch(parsed));
											setInvalid(false);
										}
									})
									.catch(() => {});
							}}
						>
							<Pipette />
						</Button>
					</Tooltip>
				)}
			</div>
			{invalid && (
				<p id={errorId} className="text-meta text-danger">
					{t("ui.settings.appearance.picker.invalid")}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					{t("ui.settings.appearance.picker.cancel")}
				</Button>
				<Button type="submit" variant="primary" size="sm">
					{submitLabel}
				</Button>
			</div>
		</form>
	);
};

const ChannelSlider: FC<{
	label: string;
	valueText: string;
	min: number;
	max: number;
	value: number;
	background: string;
	onChange: (value: number) => void;
}> = ({ label, valueText, min, max, value, background, onChange }) => (
	<label className="flex flex-col gap-1">
		<span className="text-meta text-ink-muted">{label}</span>
		<input
			type="range"
			min={min}
			max={max}
			step={1}
			value={value}
			aria-valuetext={valueText}
			onChange={(event) => onChange(Number(event.target.value))}
			style={{ backgroundImage: background }}
			className={
				"h-3 w-full cursor-pointer appearance-none rounded-full border border-hairline " +
				"[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full " +
				"[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-canvas"
			}
		/>
	</label>
);

const RenameForm: FC<{
	initial: string;
	onSave: (name: string) => void;
	onCancel: () => void;
}> = ({ initial, onSave, onCancel }) => {
	const [name, setName] = useState(initial);
	const id = useId();
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				onSave(name);
			}}
		>
			<label htmlFor={id} className="flex flex-col gap-1">
				<span className="text-meta text-ink-muted">
					{t("ui.settings.appearance.picker.name")}
				</span>
				<Input
					id={id}
					inputSize="sm"
					autoFocus
					maxLength={CUSTOM_ACCENT_NAME_MAX}
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
			</label>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					{t("ui.settings.appearance.picker.cancel")}
				</Button>
				<Button type="submit" variant="primary" size="sm">
					{t("ui.settings.appearance.picker.save")}
				</Button>
			</div>
		</form>
	);
};
