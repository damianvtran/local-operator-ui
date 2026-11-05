import { Button, Input } from "@shared/components/ui";
import {
	ColourPicker,
	rememberColour,
} from "@shared/components/ui/colour-picker";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui/dialog";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@shared/components/ui/sheet";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { definitionOf, isThemeName, themes } from "@shared/themes";
import {
	saveCustomTheme,
	useCustomThemes,
} from "@shared/themes/custom-theme-store";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { useEffect, useId, useMemo, useState } from "react";
import type { CustomThemeV1 } from "../../../../../shared/theme-engine/appearance.mjs";
import { composeTheme } from "../../../../../shared/theme-engine/compose.mjs";
import { paletteBlock } from "../../../../../shared/theme-engine/css.mjs";
import {
	COLOUR_ROLES,
	ESSENTIALS,
	customPaletteReadings,
	deriveCustomPalette,
	suggestCustomAdjustment,
} from "../../../../../shared/theme-engine/custom.mjs";
import { hexToLch } from "../../../../../shared/theme-engine/picker.mjs";
import { CustomThemePreview } from "./custom-theme-preview";

// These explicit keys are the translator contract; role IDs never become copy.
const roleLabels = () => ({
	canvas: t("ui.settings.appearance.editor.role.canvas"),
	surface: t("ui.settings.appearance.editor.role.surface"),
	ink: t("ui.settings.appearance.editor.role.ink"),
	inkMuted: t("ui.settings.appearance.editor.role.inkMuted"),
	accent: t("ui.settings.appearance.editor.role.accent"),
	borderControl: t("ui.settings.appearance.editor.role.borderControl"),
	elevated: t("ui.settings.appearance.editor.role.elevated"),
	sunken: t("ui.settings.appearance.editor.role.sunken"),
	messageSurface: t("ui.settings.appearance.editor.role.messageSurface"),
	mediaSurface: t("ui.settings.appearance.editor.role.mediaSurface"),
	rowHover: t("ui.settings.appearance.editor.role.rowHover"),
	rowSelected: t("ui.settings.appearance.editor.role.rowSelected"),
	inkDim: t("ui.settings.appearance.editor.role.inkDim"),
	inkDisabled: t("ui.settings.appearance.editor.role.inkDisabled"),
	tokenCommand: t("ui.settings.appearance.editor.role.tokenCommand"),
	hairline: t("ui.settings.appearance.editor.role.hairline"),
	hairlineStrong: t("ui.settings.appearance.editor.role.hairlineStrong"),
	accentHover: t("ui.settings.appearance.editor.role.accentHover"),
	accentActive: t("ui.settings.appearance.editor.role.accentActive"),
	chartBarHover: t("ui.settings.appearance.editor.role.chartBarHover"),
	accentWash: t("ui.settings.appearance.editor.role.accentWash"),
	onAccent: t("ui.settings.appearance.editor.role.onAccent"),
	accentAlt: t("ui.settings.appearance.editor.role.accentAlt"),
	accentAltWash: t("ui.settings.appearance.editor.role.accentAltWash"),
	success: t("ui.settings.appearance.editor.role.success"),
	successWash: t("ui.settings.appearance.editor.role.successWash"),
	successBorder: t("ui.settings.appearance.editor.role.successBorder"),
	warning: t("ui.settings.appearance.editor.role.warning"),
	warningWash: t("ui.settings.appearance.editor.role.warningWash"),
	warningBorder: t("ui.settings.appearance.editor.role.warningBorder"),
	danger: t("ui.settings.appearance.editor.role.danger"),
	dangerWash: t("ui.settings.appearance.editor.role.dangerWash"),
	dangerBorder: t("ui.settings.appearance.editor.role.dangerBorder"),
	info: t("ui.settings.appearance.editor.role.info"),
	infoWash: t("ui.settings.appearance.editor.role.infoWash"),
	infoBorder: t("ui.settings.appearance.editor.role.infoBorder"),
	overlayShadow: t("ui.settings.appearance.editor.role.overlayShadow"),
	scrim: t("ui.settings.appearance.editor.role.scrim"),
});
export const themeRoleLabel = (role: string) =>
	roleLabels()[role as keyof ReturnType<typeof roleLabels>] ?? role;

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A local transaction: no preferences or palette store writes until Save.
 * In particular, contrast is NEVER baked into the draft or reset on save.
 * The drawer chrome stays on the saved theme so a bad draft remains editable.
 */
export const CustomThemeEditor = ({
	initial,
	onClose,
}: { initial: CustomThemeV1; onClose: () => void }) => {
	useI18nLocale();
	const uid = useId().replace(/[^a-z0-9]/gi, "");
	const previewId = `custom-draft-${uid}`;
	const [draft, setDraft] = useState(initial);
	const [previewDraft, setPreviewDraft] = useState(initial);
	useEffect(() => {
		const timer = setTimeout(() => setPreviewDraft(draft), 180);
		return () => clearTimeout(timer);
	}, [draft]);
	const [textValues, setTextValues] = useState<Record<string, string>>({});
	const [activeRole, setActiveRole] = useState<string | null>(null);
	const [pickerValid, setPickerValid] = useState(true);
	const [error, setError] = useState(false);
	const [adjustError, setAdjustError] = useState(false);
	const [discard, setDiscard] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	const [advanced, setAdvanced] = useState(() => {
		try {
			return localStorage.getItem("lo-theme-editor-advanced") === "true";
		} catch {
			return false;
		}
	});
	const [history, setHistory] = useState<CustomThemeV1[]>([]);
	const library = useCustomThemes();
	const contrast = useUiPreferencesStore((s) => s.contrast);
	const accent = useUiPreferencesStore((s) => s.accent);
	const base = definitionOf(draft.base)?.palette;
	if (!base) throw new Error("unknown custom theme base");
	const palette = useMemo(
		() => deriveCustomPalette(base, draft),
		[base, draft],
	);
	const measured = useMemo(
		() => customPaletteReadings(palette, draft.base),
		[palette, draft.base],
	);
	const previewPalette = useMemo(
		() => deriveCustomPalette(base, previewDraft),
		[base, previewDraft],
	);
	const previewValid = useMemo(
		() =>
			customPaletteReadings(previewPalette, draft.base).findings.length === 0,
		[previewPalette, draft.base],
	);
	// A half-edited invalid draft is shown literally, not passed into the verified
	// contrast solver. It has no solution yet and must not monopolize the UI.
	const composed = useMemo(
		() =>
			!previewValid
				? { palette: previewPalette }
				: composeTheme(previewPalette, {
						contrast: contrast[base.mode],
						accent: accent[base.mode],
						id: draft.base,
						paletteAccent: (id) => definitionOf(id)?.palette.accent,
					}),
		[previewPalette, previewValid, contrast, accent, base.mode, draft.base],
	);
	const chipReadings = useMemo(
		() => customPaletteReadings(composed.palette, draft.base),
		[composed.palette, draft.base],
	);
	const wrongMode =
		base.mode === "dark"
			? hexToLch(palette.canvas).l > 50
			: hexToLch(palette.canvas).l < 50;
	const dirty =
		JSON.stringify(draft) !== JSON.stringify(initial) ||
		Object.keys(textValues).length > 0;
	const invalidText = Object.values(textValues).some((v) => !HEX.test(v));
	const atLimit =
		!library.themes.some((item) => item.id === draft.id) &&
		library.themes.length >= 50;
	const update = (next: CustomThemeV1) => {
		setHistory((h) => [...h.slice(-19), draft]);
		setDraft(next);
		setError(false);
		setAdjustError(false);
	};
	const setRole = (role: string, hex: string) => {
		const field = Object.prototype.hasOwnProperty.call(draft.overrides, role)
			? "overrides"
			: ESSENTIALS.includes(role)
				? "seeds"
				: "overrides";
		update({ ...draft, [field]: { ...draft[field], [role]: hex } });
		setTextValues((values) => {
			const next = { ...values };
			delete next[role];
			return next;
		});
	};
	const requestClose = () => {
		if (dirty) setDiscard(true);
		else onClose();
	};
	const adjust = () => {
		const next = suggestCustomAdjustment(base, draft);
		if (next) {
			update(next);
			setAnnouncement(t("ui.settings.appearance.editor.validation_pass"));
		} else setAdjustError(true);
	};
	const renderRow = (role: string) => {
		const reading = chipReadings.readings
			.filter((pair) => pair.foreground === role || pair.background === role)
			.sort((a, b) => a.value / a.floor - b.value / b.floor)[0];
		const value =
			textValues[role] ??
			draft.overrides[role] ??
			draft.seeds[role] ??
			palette[role as keyof typeof palette];
		const pinned = Object.prototype.hasOwnProperty.call(draft.overrides, role);
		const inputId = `${uid}-${role}`;
		return (
			<div
				key={role}
				className="flex flex-col gap-2 border-hairline border-b py-2"
			>
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<button
						type="button"
						aria-label={t("ui.settings.appearance.editor.edit_role", {
							role: themeRoleLabel(role),
						})}
						aria-expanded={activeRole === role}
						onClick={() => {
							setActiveRole(activeRole === role ? null : role);
							setPickerValid(true);
						}}
						className="size-8 shrink-0 rounded-sm border border-control focus-visible:outline-2 focus-visible:outline-accent"
						style={{ background: palette[role as keyof typeof palette] }}
					/>
					<label htmlFor={inputId} className="min-w-0 flex-1 text-body-sm">
						{themeRoleLabel(role)}
						{pinned && (
							<span className="ms-1 text-meta text-ink-muted">
								{t("ui.settings.appearance.editor.edited")}
							</span>
						)}
					</label>
					<Input
						id={inputId}
						inputSize="sm"
						value={value}
						maxLength={7}
						aria-invalid={!HEX.test(value)}
						className="w-24 shrink-0 font-mono"
						onChange={(e) =>
							setTextValues((v) => ({ ...v, [role]: e.target.value }))
						}
						onBlur={() => {
							if (HEX.test(value)) setRole(role, value.toUpperCase());
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && HEX.test(value)) {
								e.preventDefault();
								setRole(role, value.toUpperCase());
							}
						}}
					/>
					{reading && (
						<span
							className={cn(
								"text-meta",
								reading.value < reading.floor
									? "text-danger"
									: "text-ink-muted",
							)}
							title={`${t("ui.settings.appearance.editor.pair", { foreground: themeRoleLabel(reading.foreground), background: themeRoleLabel(reading.background) })} · ${t("ui.settings.appearance.editor.floor", { value: String(reading.floor) })}`}
						>
							{t("ui.settings.appearance.editor.ratio", {
								value: reading.value.toFixed(2),
							})}
						</span>
					)}
					{(pinned ||
						Object.prototype.hasOwnProperty.call(draft.seeds, role)) && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							aria-label={t("ui.settings.appearance.editor.reset_role", {
								role: themeRoleLabel(role),
							})}
							onClick={() => {
								const seeds = { ...draft.seeds };
								const overrides = { ...draft.overrides };
								if (pinned) delete overrides[role];
								else delete seeds[role];
								update({ ...draft, seeds, overrides });
								setTextValues((v) => {
									const n = { ...v };
									delete n[role];
									return n;
								});
							}}
						>
							{t("ui.settings.appearance.editor.reset_role", {
								role: themeRoleLabel(role),
							})}
						</Button>
					)}
				</div>
				{!HEX.test(value) && (
					<p role="alert" className="text-meta text-danger">
						{t("ui.settings.appearance.editor.invalid_hex")}
					</p>
				)}
				{activeRole === role && (
					<div className="rounded-md border border-hairline bg-surface p-3">
						<ColourPicker
							key={role}
							value={palette[role as keyof typeof palette]}
							onChange={(hex) => setRole(role, hex)}
							onValidityChange={setPickerValid}
							swatches={ESSENTIALS.map(
								(r) => palette[r as keyof typeof palette],
							)}
						/>
					</div>
				)}
			</div>
		);
	};
	return (
		<>
			<Sheet
				open
				onOpenChange={(open) => {
					if (!open) requestClose();
				}}
			>
				<SheetContent
					className="flex w-full max-w-full flex-col gap-0 overflow-hidden sm:w-140 sm:max-w-140 text-ink"
					onKeyDown={(e) => {
						if (
							(e.metaKey || e.ctrlKey) &&
							e.key === "z" &&
							!(
								e.target instanceof HTMLInputElement ||
								e.target instanceof HTMLTextAreaElement ||
								(e.target instanceof HTMLElement && e.target.isContentEditable)
							)
						) {
							e.preventDefault();
							const last = history.at(-1);
							if (last) {
								setDraft(last);
								setHistory((h) => h.slice(0, -1));
							}
						}
					}}
				>
					<div className="shrink-0 border-hairline border-b pb-3 pe-8">
						<SheetTitle>{t("ui.settings.appearance.editor.edit")}</SheetTitle>
						<SheetDescription>
							{t("ui.settings.appearance.editor.preview_note")}
						</SheetDescription>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto py-4">
						<div className="flex flex-col gap-4">
							<label
								htmlFor={`${uid}-name`}
								className="flex flex-col gap-1 text-body-sm"
							>
								{t("ui.settings.appearance.editor.name")}
								<Input
									value={draft.name}
									id={`${uid}-name`}
									maxLength={60}
									onChange={(e) => update({ ...draft, name: e.target.value })}
									aria-invalid={!draft.name.trim()}
								/>
							</label>
							{!draft.name.trim() && (
								<p role="alert" className="text-meta text-danger">
									{t("ui.settings.appearance.editor.name_required")}
								</p>
							)}
							<p className="text-meta text-ink-muted">
								{t("ui.settings.appearance.editor.base", {
									name: isThemeName(draft.base)
										? themes[draft.base].name
										: draft.base,
								})}{" "}
								·{" "}
								{t(
									base.mode === "dark"
										? "ui.settings.appearance.editor.mode_dark"
										: "ui.settings.appearance.editor.mode_light",
								)}
							</p>
							{wrongMode && (
								<p className="text-meta text-warning">
									{t("ui.settings.appearance.editor.mode_warning")}
								</p>
							)}
							<style>{paletteBlock(previewId, composed.palette)}</style>
							<CustomThemePreview id={previewId} />
							<p className="text-meta text-ink-muted">
								{previewValid &&
									t("ui.settings.appearance.editor.contrast_note", {
										value: String(contrast[base.mode]),
									})}{" "}
								{previewValid && accent[base.mode].kind !== "theme"
									? t("ui.settings.appearance.editor.accent_note")
									: null}
							</p>
							<div
								aria-live="polite"
								className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-hairline bg-surface p-2 text-body-sm"
							>
								<span
									className={
										measured.findings.length ? "text-danger" : "text-success"
									}
								>
									{measured.findings.length
										? t("ui.settings.appearance.editor.validation_summary", {
												count: measured.findings.length,
											})
										: t("ui.settings.appearance.editor.validation_pass")}
								</span>
								{measured.findings.length > 0 && (
									<Button
										type="button"
										variant="secondary"
										size="sm"
										onClick={adjust}
									>
										{t("ui.settings.appearance.editor.adjust")}
									</Button>
								)}
							</div>
							{adjustError && (
								<p role="alert" className="text-meta text-danger">
									{t("ui.settings.appearance.editor.adjust_unavailable")}
								</p>
							)}
							<section>
								<h3 className="text-body-sm font-medium">
									{t("ui.settings.appearance.editor.essentials")}
								</h3>
								{ESSENTIALS.map(renderRow)}
							</section>
							<section>
								<button
									type="button"
									aria-expanded={advanced}
									className="flex w-full items-center justify-between text-start text-body-sm font-medium"
									onClick={() => {
										setAdvanced(!advanced);
										try {
											localStorage.setItem(
												"lo-theme-editor-advanced",
												String(!advanced),
											);
										} catch {}
									}}
								>
									{t("ui.settings.appearance.editor.advanced")}
									<span aria-hidden="true">{advanced ? "−" : "+"}</span>
								</button>
								<p className="mt-2 text-meta text-ink-muted">
									{t("ui.settings.appearance.editor.pinned_note")}
								</p>
								{advanced && (
									<>
										{COLOUR_ROLES.filter((r) => !ESSENTIALS.includes(r)).map(
											renderRow,
										)}
										{["overlayShadow", "scrim"].map((role) => (
											<label
												key={role}
												className="flex flex-col gap-1 py-2 text-body-sm"
											>
												{themeRoleLabel(role)}
												<input
													type="range"
													min={0}
													max={1}
													step={0.01}
													value={
														draft.overrides[role] ??
														Number(
															/\/\s*([\d.]+)/.exec(
																base[role as keyof typeof base],
															)?.[1] ?? 0.5,
														)
													}
													onChange={(e) =>
														update({
															...draft,
															overrides: {
																...draft.overrides,
																[role]: e.target.value,
															},
														})
													}
													className="h-7 accent-accent"
												/>
											</label>
										))}
									</>
								)}
							</section>
						</div>
					</div>
					<div className="shrink-0 border-hairline border-t pt-3">
						<output className="text-meta text-ink-muted">{announcement}</output>
						{error && (
							<p role="alert" className="text-meta text-danger">
								{t("ui.settings.appearance.editor.save_error")}
							</p>
						)}
						{atLimit && (
							<p role="alert" className="text-meta text-danger">
								{t("ui.settings.appearance.editor.limit")}
							</p>
						)}
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={requestClose}>
								{t("ui.settings.appearance.editor.cancel")}
							</Button>
							<Button
								variant="primary"
								disabled={
									!draft.name.trim() ||
									draft.name.length > 60 ||
									invalidText ||
									!pickerValid ||
									measured.findings.length > 0 ||
									atLimit
								}
								onClick={() => {
									try {
										const saved = {
											...draft,
											name: draft.name.trim(),
											updatedAt: Date.now(),
										};
										saveCustomTheme(saved);
										useUiPreferencesStore.setState({
											themeName: isThemeName(saved.base)
												? saved.base
												: "localOperatorDark",
											customThemeId: saved.id,
										});
										for (const hex of Object.values(saved.seeds))
											rememberColour(hex);
										showSuccessToast(t("ui.settings.appearance.editor.saved"));
										onClose();
									} catch {
										setError(true);
									}
								}}
							>
								{t("ui.settings.appearance.editor.save")}
							</Button>
						</div>
					</div>
				</SheetContent>
			</Sheet>
			<Dialog open={discard} onOpenChange={setDiscard}>
				<DialogContent>
					<DialogTitle>
						{t("ui.settings.appearance.editor.discard_title")}
					</DialogTitle>
					<DialogDescription>
						{t("ui.settings.appearance.editor.discard_description")}
					</DialogDescription>
					<div className="flex flex-wrap justify-end gap-2">
						<Button variant="secondary" onClick={() => setDiscard(false)}>
							{t("ui.settings.appearance.editor.keep_editing")}
						</Button>
						<Button variant="danger" onClick={onClose}>
							{t("ui.settings.appearance.editor.discard")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
};
