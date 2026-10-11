/**
 * The palette's language dialog: the U1 row's editor, at palette reach.
 *
 * WHAT THIS IS, AND IS NOT (i18n slice B2, the accepted proposal). The door is
 * the palette action `Change interface language...`; this dialog carries the
 * SAME enum control and `In effect:` note as the settings row, because both
 * render `SettingControl` for the same registry row - the settings page stays
 * the canonical editor and this is not a second implementation of it. Neither
 * is it a second write path: the save calls the same `settings.edit` op and
 * the same `renegotiateLanguage` seam the row does, so the capabilities
 * chain, the store, and the note move identically whichever door was used.
 *
 * APPLY-FORWARD-ONLY. Nothing here touches the transcript: a language change
 * re-renders the surfaces being composed (labels, formatters, the note), and
 * existing streamed content, drafts and history are left exactly as written.
 * That is the proposal's rule, and it falls out of the seam rather than being
 * enforced here - `t()` and the formatters read the store at render time.
 *
 * SELF-INITIATED CHANGES CONFIRM IN PLACE: the Save button becomes `Saved`
 * once the write lands, and the note under the picker moves when the
 * capabilities answer returns. No toast fires for this app's own write - the
 * own-write window in `language-writes.ts` is what keeps the external-change
 * announcement (`locale-sync.ts`) for changes that came from somewhere else.
 */

import type {
	BackendSetting,
	BackendSettings,
} from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui";
import { LANGUAGE_SETTING_KEY, t } from "@shared/i18n";
import { renegotiateLanguage } from "@shared/i18n/language-writes";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FC, useEffect, useState } from "react";
import { backendSettingsKeys } from "./backend-settings-section";
import { useLanguageDialogStore } from "./language-dialog-store";
import { settingHelpId } from "./setting-combobox";
import { SettingControl } from "./setting-control";

/**
 * The dialog's write, as a function.
 *
 * EXPORTED because it IS the seam under test: clicking Save calls exactly
 * this, and the jsdom suite (like the settings row's, and for the same
 * reason - Radix's portal listbox commits to no synthetic event jsdom can
 * produce) proves the op and the renegotiation here rather than through a
 * pointer dance the library ignores. One write path either way: the settings
 * row calls the same `renegotiateLanguage` after the same op.
 */
export async function saveLanguageValue(options: {
	value: string;
	queryClient: QueryClient;
}): Promise<void> {
	await desktopResult({
		op: "settings.edit",
		key: LANGUAGE_SETTING_KEY,
		value: options.value as never,
	});
	renegotiateLanguage(options.queryClient);
}

export const LanguageDialog: FC = () => {
	const open = useLanguageDialogStore((state) => state.open);
	const closeLanguage = useLanguageDialogStore((state) => state.closeLanguage);
	const queryClient = useQueryClient();
	const capabilities = useDesktopCapabilities();
	/*
	 * Same gate as every other reader of the settings registry: the row only
	 * exists on a backend that serves it, so a backend without `settings`
	 * feature support must not draw a dialog over an empty list.
	 */
	const enabled = desktopFeatureEnabled(capabilities.data, "settings");

	const settingsQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled: open && enabled,
		staleTime: 10_000,
	});

	/*
	 * The registry row, by its wire shape. Narrowed here rather than trusted:
	 * the dialog only needs the fields `SettingControl` takes, and a backend
	 * that moved the row would render nothing rather than crash.
	 */
	const setting = (settingsQuery.data?.settings ?? []).find(
		(candidate) => candidate.key === LANGUAGE_SETTING_KEY,
	) as BackendSetting | undefined;

	const [draft, setDraft] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/*
	 * Seed the draft from the server, and re-seed it when the server's value
	 * moves while the draft is clean - the same contract the row keeps, so a
	 * write from another door (the settings page, the TUI) shows up here.
	 */
	useEffect(() => {
		if (!setting) return;
		const value = String(setting.value ?? "");
		setDraft((current) => (current === null ? value : current));
	}, [setting]);
	useEffect(() => {
		if (!open || !setting) return;
		setSaved(false);
		setError(null);
	}, [open, setting]);

	const value = draft ?? String(setting?.value ?? "");
	const dirty = Boolean(setting) && value !== String(setting?.value ?? "");
	const saveDisabled = !setting || !dirty || saving;

	const save = async () => {
		if (!setting || !dirty) return;
		setSaving(true);
		setError(null);
		try {
			await saveLanguageValue({ value, queryClient });
			setSaved(true);
			setDraft(null);
			await settingsQuery.refetch();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The language could not be saved.",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeLanguage()}>
			<DialogContent className="max-w-[min(28rem,calc(100vw-4rem))] gap-4">
				<div className="flex flex-col gap-1">
					<DialogTitle className="text-title">
						{t("ui.settings.language.dialog.title")}
					</DialogTitle>
					<DialogDescription className="text-body-sm text-ink-muted">
						{t("ui.settings.language.dialog.description")}
					</DialogDescription>
				</div>
				{settingsQuery.isLoading ? (
					<div className="flex items-center gap-2 text-body-sm text-ink-muted">
						<Spinner />
						{t("ui.settings.language.dialog.loading")}
					</div>
				) : setting ? (
					<>
						<div className="flex flex-col gap-1">
							<span
								id={settingHelpId(LANGUAGE_SETTING_KEY)}
								className="text-meta text-ink-dim"
							>
								{setting.help}
							</span>
							<SettingControl
								setting={setting}
								value={value}
								disabled={saving}
								helpId={settingHelpId(LANGUAGE_SETTING_KEY)}
								onValueChange={(next) => {
									setSaved(false);
									setDraft(next);
								}}
							/>
						</div>
						{error && <p className="text-meta text-danger">{error}</p>}
						<div className="flex justify-end">
							<Button
								onClick={save}
								disabled={saveDisabled}
								data-language-save=""
							>
								{saving
									? `${t("ui.settings.language.dialog.save")}...`
									: saved && !dirty
										? t("ui.settings.language.dialog.saved")
										: t("ui.settings.language.dialog.save")}
							</Button>
						</div>
					</>
				) : (
					<p className="text-body-sm text-ink-muted">
						{t("ui.settings.language.dialog.loading")}
					</p>
				)}
			</DialogContent>
		</Dialog>
	);
};
