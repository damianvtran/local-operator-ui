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

import { pairingCardCopy } from "@shared/api/local-operator/backend-error";
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
import { Alert } from "@shared/components/ui";
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui";
import { usePairingCause } from "@shared/hooks/use-pairing-cause";
import { LANGUAGE_SETTING_KEY, t } from "@shared/i18n";
import { renegotiateLanguage } from "@shared/i18n/language-writes";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { presentSetting } from "../backend-setting-copy";
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

	const contentRef = useRef<HTMLDivElement>(null);
	const pairingCause = usePairingCause();
	/*
	 * The registry row, by its wire shape. Narrowed here rather than trusted:
	 * the dialog only needs the fields `SettingControl` takes, and a backend
	 * that moved the row would render nothing rather than crash.
	 */
	const wireSetting = (settingsQuery.data?.settings ?? []).find(
		(candidate) => candidate.key === LANGUAGE_SETTING_KEY,
	) as BackendSetting | undefined;
	/*
	 * The row's PRESENTED copy, through the one seam both doors share
	 * (round-1 D3/U2): the dialog shows `Interface language` and the scope
	 * sentence, not the registry's raw label and help - otherwise the same
	 * setting would be described differently by its two editors.
	 */
	const setting = wireSetting ? presentSetting(wireSetting) : undefined;

	const [draft, setDraft] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/*
	 * The re-seed contract (round-1 R1-2). The draft follows the SERVER while
	 * it is clean, and a fresh OPEN always starts clean - so an external
	 * change (or a write from the settings row, or the TUI) can never leave a
	 * stale value sitting here as a phantom dirty edit that Save would write
	 * back over the change. `lastServer` is what marks clean: a draft equal to
	 * the value it was seeded from is the server's, not the user's.
	 */
	const lastServer = useRef<string | null>(null);
	useEffect(() => {
		if (open) setDraft(null);
	}, [open]);
	useEffect(() => {
		if (!open || !setting) return;
		const value = String(setting.value ?? "");
		if (draft === null || draft === lastServer.current) setDraft(value);
		lastServer.current = value;
	}, [open, setting, draft]);
	/*
	 * A fresh OPEN clears the transient states. Deliberately keyed on `open`
	 * alone: keyed on `setting` too, the post-save refetch (a new array, a new
	 * row object) would re-run it a moment after every save and wipe the
	 * `Saved` confirmation - which is the write's only feedback (round 1, D2),
	 * so it has to stay up until the next open or edit.
	 */
	useEffect(() => {
		if (!open) return;
		setSaved(false);
		setError(null);
	}, [open]);

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

	/*
	 * The load state, classified the way the settings section classifies it
	 * (round-1 U1): a capabilities answer that never granted `settings` is a
	 * REFUSAL with no remedy here; a failed query is the pairing table's own
	 * sentence with its Retry; and "loading" is reserved for a query that is
	 * genuinely in flight. A dialog that said "Loading" forever on a backend
	 * that will never answer is the state this replaces.
	 */
	const loadError =
		(capabilities.data ? null : capabilities.error) ?? settingsQuery.error;
	const refused = !enabled;
	const { sentence: pairingSentence, remedy } = pairingCardCopy(
		pairingCause ?? null,
		"Your settings could not be loaded.",
		loadError,
	);
	const retrying = capabilities.isFetching || settingsQuery.isFetching;

	/*
	 * Focus lands on the CONTROL, not the Close button (round-1 D1/U3): the
	 * initial Enter must reach the picker rather than dismiss the dialog. The
	 * auto-focus is suppressed on the content and this runs once the control
	 * has actually mounted - which is after the loading body resolves, the
	 * half that a plain auto-focus cannot cover.
	 */
	useEffect(() => {
		if (!open || !setting) return;
		requestAnimationFrame(() => {
			contentRef.current
				?.querySelector<HTMLElement>('[role="combobox"]')
				?.focus();
		});
	}, [open, setting]);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeLanguage()}>
			<DialogContent
				ref={contentRef}
				onOpenAutoFocus={(event) => event.preventDefault()}
				className="max-w-[min(28rem,calc(100vw-4rem))] gap-4"
			>
				<div className="flex flex-col gap-1">
					<DialogTitle className="text-title">
						{t("ui.settings.language.dialog.title")}
					</DialogTitle>
					<DialogDescription className="text-body-sm text-ink-muted">
						{t("ui.settings.language.dialog.description")}
					</DialogDescription>
				</div>
				{refused ? (
					<Alert variant="warning">
						<span>{t("ui.settings.language.dialog.unavailable")}</span>
					</Alert>
				) : loadError ? (
					<Alert variant="warning">
						<div className="flex items-center justify-between gap-3">
							<span>{pairingSentence}</span>
							{remedy && (
								<Button
									variant="secondary"
									size="sm"
									className="shrink-0"
									onClick={() => {
										if (capabilities.isError) void capabilities.refetch();
										else void settingsQuery.refetch();
									}}
									disabled={retrying}
								>
									{retrying
										? t("ui.settings.language.dialog.retrying")
										: t("ui.settings.language.dialog.retry")}
								</Button>
							)}
						</div>
					</Alert>
				) : settingsQuery.isLoading || (!setting && !settingsQuery.isError) ? (
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
							{saved && !dirty ? (
								/*
								 * In-place confirmation in NORMAL ink (round-1 D2):
								 * the disabled button rendered it at 2.37:1, and it is
								 * the write's only feedback. A status line with a check
								 * reads at body ink and is announced.
								 */
								<output
									data-language-save=""
									className="inline-flex items-center gap-1.5 text-body-sm text-ink"
								>
									<Check aria-hidden="true" className="size-3.5" />
									{t("ui.settings.language.dialog.saved")}
								</output>
							) : (
								<Button
									onClick={save}
									disabled={saveDisabled}
									data-language-save=""
								>
									{saving
										? `${t("ui.settings.language.dialog.save")}...`
										: t("ui.settings.language.dialog.save")}
								</Button>
							)}
						</div>
					</>
				) : (
					<Alert variant="warning">
						<span>{t("ui.settings.language.dialog.unavailable")}</span>
					</Alert>
				)}
			</DialogContent>
		</Dialog>
	);
};
