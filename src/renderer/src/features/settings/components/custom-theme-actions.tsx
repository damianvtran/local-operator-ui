import { Button } from "@shared/components/ui";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { t } from "@shared/i18n";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { isThemeName, themes } from "@shared/themes";
import {
	deleteCustomTheme,
	reloadCustomThemes,
	useCustomThemes,
} from "@shared/themes/custom-theme-store";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import type { CustomThemeV1 } from "../../../../../shared/theme-engine/appearance.mjs";
import {
	IMPORT_MAX_BYTES,
	exportCustomTheme,
	parseThemeImport,
	uniqueThemeName,
} from "../../../../../shared/theme-engine/custom.mjs";
import { CustomThemeEditor } from "./custom-theme-editor";
import { CustomThemeStatus } from "./custom-theme-status";

const newId = () =>
	`custom-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

/** Gallery actions hold the modal transaction, not the global preferences.
 * Import opens a draft, even if its colours fail floors; only Save can apply.
 * IDs/timestamps are local identity and intentionally excluded from exports.
 */
export const useCustomThemeActions = () => {
	const library = useCustomThemes();
	const active = useUiPreferencesStore((s) => s.customThemeId);
	const baseName = useUiPreferencesStore((s) => s.themeName);
	const [editor, setEditor] = useState<CustomThemeV1 | null>(null);
	const [deleting, setDeleting] = useState<CustomThemeV1 | null>(null);
	const [exporting, setExporting] = useState<CustomThemeV1 | null>(null);
	const [importing, setImporting] = useState(false);
	const [json, setJson] = useState("");
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const duplicate = (id: string) => {
		const source = library.themes.find((theme) => theme.id === id);
		const base = source?.base ?? id;
		if (!isThemeName(base)) return;
		const name = uniqueThemeName(
			t("ui.settings.appearance.editor.new_name", {
				name: source?.name ?? themes[base].name,
			}),
			library.themes,
		);
		setEditor({
			format: "local-operator-theme",
			version: 1,
			id: newId(),
			name,
			base,
			seeds: { ...source?.seeds },
			overrides: { ...source?.overrides },
			updatedAt: Date.now(),
		});
	};
	const readImport = (text: string) => {
		try {
			const draft = parseThemeImport(text, isThemeName, { id: newId() });
			draft.name = uniqueThemeName(draft.name, library.themes);
			setImporting(false);
			setError("");
			setEditor(draft);
		} catch (e) {
			const code = e instanceof Error ? e.message : "import_error";
			const messages: Record<string, string> = {
				import_invalid_json: t(
					"ui.settings.appearance.editor.import_invalid_json",
				),
				import_format: t("ui.settings.appearance.editor.import_format"),
				import_version: t("ui.settings.appearance.editor.import_version"),
				import_size: t("ui.settings.appearance.editor.import_size"),
				import_base: t("ui.settings.appearance.editor.import_base"),
				import_name: t("ui.settings.appearance.editor.import_name"),
				import_roles: t("ui.settings.appearance.editor.import_roles"),
				import_unsafe: t("ui.settings.appearance.editor.import_unsafe"),
			};
			setError(
				messages[code] ?? t("ui.settings.appearance.editor.import_error"),
			);
		}
	};
	const menu = (id: string, tabbable = true) => {
		const custom = library.themes.find((theme) => theme.id === id);
		const name = custom?.name ?? (isThemeName(id) ? themes[id].name : id);
		return (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						tabIndex={tabbable ? 0 : -1}
						aria-label={t("ui.settings.appearance.editor.more", { name })}
						className="absolute end-1 top-1 z-10 bg-canvas"
					>
						<MoreHorizontal size={14} />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{custom && (
						<DropdownMenuItem onSelect={() => setEditor(custom)}>
							{t("ui.settings.appearance.editor.edit")}
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onSelect={() => duplicate(id)}>
						{t("ui.settings.appearance.editor.duplicate")}
					</DropdownMenuItem>
					{custom && (
						<>
							<DropdownMenuItem
								onSelect={() => {
									setExporting(custom);
									setError("");
									setMessage("");
								}}
							>
								{t("ui.settings.appearance.editor.export")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									setDeleting(custom);
									setError("");
								}}
							>
								{t("ui.settings.appearance.editor.delete")}
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		);
	};
	const header = (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap justify-end gap-2">
				<Button
					variant="secondary"
					size="sm"
					onClick={() => {
						const custom = library.themes.find((item) => item.id === active);
						if (custom) setEditor(custom);
						else duplicate(baseName);
					}}
				>
					{t("ui.settings.appearance.editor.customize")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						setImporting(true);
						setError("");
						setJson("");
					}}
				>
					{t("ui.settings.appearance.editor.import")}
				</Button>
			</div>
			<CustomThemeStatus
				loading={library.loading}
				error={library.error}
				count={library.themes.length}
				onRetry={reloadCustomThemes}
			/>
		</div>
	);
	const dialogs = (
		<>
			{editor && (
				<CustomThemeEditor
					key={editor.id}
					initial={editor}
					onClose={() => setEditor(null)}
				/>
			)}
			<Dialog
				open={!!deleting}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
			>
				<DialogContent>
					<DialogTitle>
						{t("ui.settings.appearance.editor.delete_title", {
							name: deleting?.name ?? "",
						})}
					</DialogTitle>
					<DialogDescription>
						{t("ui.settings.appearance.editor.delete_description")}
					</DialogDescription>
					{error && (
						<p role="alert" className="text-meta text-danger">
							{error}
						</p>
					)}
					<div className="flex justify-end gap-2">
						<Button variant="secondary" onClick={() => setDeleting(null)}>
							{t("ui.settings.appearance.editor.cancel")}
						</Button>
						<Button
							variant="danger"
							onClick={() => {
								if (!deleting) return;
								try {
									deleteCustomTheme(deleting.id);
									if (active === deleting.id)
										useUiPreferencesStore.setState({ customThemeId: null });
									setDeleting(null);
									showSuccessToast(t("ui.settings.appearance.editor.deleted"));
								} catch {
									setError(t("ui.settings.appearance.editor.save_error"));
								}
							}}
						>
							{t("ui.settings.appearance.editor.delete")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
			<Dialog open={importing} onOpenChange={setImporting}>
				<DialogContent>
					<DialogTitle>
						{t("ui.settings.appearance.editor.import_title")}
					</DialogTitle>
					<DialogDescription>
						{t("ui.settings.appearance.editor.import_description")}
					</DialogDescription>
					<label className="flex flex-col gap-1 text-body-sm">
						{t("ui.settings.appearance.editor.import_text")}
						<textarea
							dir="ltr"
							aria-invalid={!!error}
							value={json}
							onChange={(e) => setJson(e.target.value)}
							className="min-h-48 w-full rounded-sm border border-control bg-sunken p-2 font-mono text-meta"
						/>
					</label>
					{error && (
						<p role="alert" className="text-meta text-danger">
							{error}
						</p>
					)}
					<div className="flex flex-wrap justify-between gap-2">
						<label className="cursor-pointer rounded-sm border border-control px-2 py-1.5 text-body-sm focus-within:outline-2 focus-within:outline-accent">
							{t("ui.settings.appearance.editor.import_file")}
							<input
								type="file"
								accept=".json,application/json"
								className="sr-only"
								onChange={async (e) => {
									const file = e.target.files?.[0];
									if (!file) return;
									if (file.size > IMPORT_MAX_BYTES) {
										setError(t("ui.settings.appearance.editor.import_size"));
										return;
									}
									try {
										readImport(await file.text());
									} catch {
										setError(t("ui.settings.appearance.editor.import_read"));
									}
									e.target.value = "";
								}}
							/>
						</label>
						<Button disabled={!json.trim()} onClick={() => readImport(json)}>
							{t("ui.settings.appearance.editor.import_submit")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
			<Dialog
				open={!!exporting}
				onOpenChange={(open) => {
					if (!open) setExporting(null);
				}}
			>
				<DialogContent>
					<DialogTitle>
						{t("ui.settings.appearance.editor.export_title", {
							name: exporting?.name ?? "",
						})}
					</DialogTitle>
					<DialogDescription>
						{t("ui.settings.appearance.editor.export_title", {
							name: exporting?.name ?? "",
						})}
					</DialogDescription>
					{error && (
						<p role="alert" className="text-meta text-danger">
							{error}
						</p>
					)}
					<textarea
						dir="ltr"
						aria-label={t("ui.settings.appearance.editor.import_text")}
						readOnly
						value={exporting ? exportCustomTheme(exporting) : ""}
						className="min-h-48 w-full rounded-sm border border-control bg-sunken p-2 font-mono text-meta"
					/>
					<p aria-live="polite" className="text-meta text-success">
						{message}
					</p>
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							variant="secondary"
							onClick={() => {
								if (!exporting) return;
								try {
									const url = URL.createObjectURL(
										new Blob([exportCustomTheme(exporting)], {
											type: "application/json",
										}),
									);
									const anchor = document.createElement("a");
									anchor.href = url;
									anchor.download = `${exporting.name.replace(/[^a-z0-9_-]/gi, "-").slice(0, 60) || "theme"}.json`;
									anchor.click();
									setTimeout(() => URL.revokeObjectURL(url), 1000);
								} catch {
									setError(t("ui.settings.appearance.editor.export_error"));
								}
							}}
						>
							{t("ui.settings.appearance.editor.export_file")}
						</Button>
						<Button
							onClick={async () => {
								if (!exporting) return;
								try {
									await navigator.clipboard.writeText(
										exportCustomTheme(exporting),
									);
									setMessage(t("ui.settings.appearance.editor.export_copied"));
								} catch {
									setError(t("ui.settings.appearance.editor.clipboard_error"));
								}
							}}
						>
							{t("ui.settings.appearance.editor.export_copy")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
	return { library, active, header, menu, dialogs };
};
