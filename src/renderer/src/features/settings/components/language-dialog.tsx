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
import { Check, Languages } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { presentSetting } from "../backend-setting-copy";
import { backendSettingsKeys } from "./backend-settings-section";
import { useLanguageDialogStore } from "./language-dialog-store";
import { settingHelpId } from "./setting-combobox";
import { SettingControl } from "./setting-control";
import { SettingsSection } from "./settings-section";

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

/** Immediate General writes share the palette's API/renegotiation seam.
 * The cache is written only AFTER the write op resolves, so a REJECTED write
 * leaves committed truth untouched and never becomes an optimistic preference.
 * A confirmed write followed by a failed readback is still cached as written,
 * and is reported as `readback-unknown` to disable duplicate saves; the
 * readback is a separate signal from the cache's own precondition.
 */
export async function saveImmediateLanguageValue(options: {
	value: string;
	queryClient: QueryClient;
}): Promise<"confirmed" | "readback-unknown"> {
	await saveLanguageValue(options);
	options.queryClient.setQueryData<BackendSettings>(
		backendSettingsKeys.all,
		(previous) =>
			previous
				? {
						...previous,
						settings: previous.settings.map((setting) =>
							setting.key === LANGUAGE_SETTING_KEY
								? {
										...setting,
										value: options.value,
										is_default: options.value === setting.default,
									}
								: setting,
						),
					}
				: previous,
	);
	try {
		await options.queryClient.fetchQuery({
			queryKey: backendSettingsKeys.all,
			queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
			staleTime: 0,
			retry: false,
		});
		return "confirmed";
	} catch {
		return "readback-unknown";
	}
}

/** Top-General entry point. No locale-keyed remount: profile drafts and other
 * dirty forms survive a backend locale update. The select represents confirmed
 * state even while its next requested value is pending or was rejected.
 */
export const GeneralLanguageSetting: FC<{ focus?: boolean }> = ({
	focus = false,
}) => {
	const queryClient = useQueryClient();
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "settings");
	const settings = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled,
		retry: false,
		refetchOnReconnect: true,
	});
	const setting = settings.data?.settings.find(
		(candidate) => candidate.key === LANGUAGE_SETTING_KEY,
	);
	const [pending, setPending] = useState(false);
	const [rejected, setRejected] = useState<{
		value: string;
		message: string;
	} | null>(null);
	const [readbackUnknown, setReadbackUnknown] = useState(false);
	const [saved, setSaved] = useState(false);
	const writing = useRef(false);
	const container = useRef<HTMLDivElement>(null);
	const focused = useRef(false);
	useEffect(() => {
		if (!focus) {
			focused.current = false;
			return;
		}
		if (!setting || focused.current) return;
		container.current?.querySelector<HTMLElement>("[role=combobox]")?.focus();
		focused.current = true;
	}, [focus, setting]);
	useEffect(() => {
		if (settings.isSuccess && !settings.isFetching) setReadbackUnknown(false);
	}, [settings.isFetching, settings.isSuccess]);

	const save = async (value: string) => {
		if (
			!setting ||
			writing.current ||
			readbackUnknown ||
			!setting.choices.some((choice) => choice.value === value)
		)
			return;
		writing.current = true;
		setPending(true);
		setRejected(null);
		setSaved(false);
		try {
			const outcome = await saveImmediateLanguageValue({ value, queryClient });
			setReadbackUnknown(outcome === "readback-unknown");
			setSaved(outcome === "confirmed");
		} catch (cause) {
			setRejected({
				value,
				message: cause instanceof Error ? cause.message : "",
			});
		} finally {
			writing.current = false;
			setPending(false);
		}
	};
	const retryRead = async () => {
		const [settingsAnswer, capabilityAnswer] = await Promise.all([
			settings.refetch(),
			capabilities.refetch(),
		]);
		if (!settingsAnswer.isError && !capabilityAnswer.isError)
			setReadbackUnknown(false);
	};
	const coldError =
		(!settings.data && settings.error) ||
		(!capabilities.data && capabilities.error);
	const unavailable =
		capabilities.data && (!enabled || (settings.data && !setting));
	const loading = !coldError && !unavailable && !setting;
	const resolvedLanguage = capabilities.data?.features?.i18n
		? capabilities.data.language
		: undefined;
	/*
	 * Only the BACKEND's resolved locale may name the caption. An absent or
	 * malformed answer leaves it unnamed instead of falling back to the client
	 * OS, which would be a guess about a machine the renderer cannot see.
	 */
	const locale =
		typeof resolvedLanguage === "string" && resolvedLanguage !== ""
			? resolvedLanguage
			: undefined;
	return (
		<SettingsSection
			title={t("ui.settings.language.dialog.title")}
			icon={Languages}
			description={t("ui.settings.language.general.description")}
		>
			<div
				ref={container}
				data-setting-key={LANGUAGE_SETTING_KEY}
				className="flex flex-col gap-3"
				aria-busy={pending}
			>
				{loading && (
					<output className="text-meta text-ink-dim">
						{t("ui.settings.language.dialog.loading")}
					</output>
				)}
				{unavailable && (
					<p className="text-meta text-ink-dim">
						{t("ui.settings.language.dialog.unavailable")}
					</p>
				)}
				{setting && (
					<SettingControl
						setting={{
							...presentSetting(setting),
							label: t("ui.settings.language.dialog.title"),
						}}
						value={String(setting.value)}
						onValueChange={(value) => {
							void save(value);
						}}
						disabled={pending || readbackUnknown}
						/*
						 * The section renders the caption for this surface (the `<output>`
						 * below, which is phase-aware: pending / saved / in-effect /
						 * last-known / not-resolved). The picker's inner note would repeat
						 * the same tag in a second voice directly above it, so it is
						 * suppressed here and kept wherever this control is the header of
						 * its own surface (design round 1 D1, confirming UX U1).
						 */
						suppressEffectiveNote
					/>
				)}
				<output aria-live="polite" className="text-meta text-ink-dim">
					{pending
						? t("ui.settings.language.general.pending")
						: saved
							? t("ui.settings.language.general.saved")
							: locale
								? t(
										readbackUnknown || capabilities.error
											? "ui.settings.language.general.last_known"
											: "ui.settings.language.general.effective",
										{ locale },
									)
								: t("ui.settings.language.general.no_resolution")}
				</output>
				{(coldError || rejected || readbackUnknown) && (
					<Alert variant="danger">
						<div className="flex flex-col gap-2">
							<p role="alert">
								{rejected
									? t("ui.settings.language.general.write_error", {
											message: rejected.message,
										})
									: readbackUnknown
										? t("ui.settings.language.general.readback_error")
										: t("ui.settings.language.dialog.unavailable")}
							</p>
							<Button
								variant="outline"
								size="sm"
								disabled={
									pending || settings.isFetching || capabilities.isFetching
								}
								onClick={() => {
									if (rejected) {
										void save(rejected.value);
									} else {
										void retryRead();
									}
								}}
							>
								{t("ui.settings.language.dialog.retry")}
							</Button>
						</div>
					</Alert>
				)}
			</div>
		</SettingsSection>
	);
};

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
	 * (round 2, R2-1/U5/Q-2). THE REFUSAL IS AN ANSWER'S VERDICT, never an
	 * absence of one: `capabilities.data && !enabled`. The no-answer states
	 * are distinguished rather than collapsed into "this backend does not
	 * serve the settings":
	 *
	 * - still asking (no data, no error): strictly loading - no sentence
	 *   about a backend that has not spoken;
	 * - failed COLD (error with no data at all): the pairing table's own
	 *   sentence, and the Retry below now has a reachable arm for it
	 *   (`capabilities.refetch`);
	 * - failed WITH prior data: the data governs (the section's own rule - a
	 *   refetch failure is not evidence that the earlier answer was unusable),
	 *   so an earlier refusal stays a refusal and an earlier grant keeps
	 *   working.
	 */
	const answered = Boolean(capabilities.data);
	const refused = answered && !enabled;
	const capabilitiesFault =
		capabilities.error && !capabilities.data ? capabilities.error : null;
	const loadError = capabilitiesFault ?? settingsQuery.error;
	const pendingCapabilities = !answered && !loadError;
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

	/*
	 * WHICH CONTROL the first Enter should reach once one exists (round-1
	 * D1/U3; round-3 D8): the picker when there is one, otherwise the Retry a
	 * cold failure offers - the principle applies to the error states too,
	 * which is where focus used to sit on the container while a control
	 * existed. `none` while the body is loading or refused: nothing to focus,
	 * and the effect stays out of those renders entirely.
	 */
	const focusTarget = setting ? "combo" : loadError ? "retry" : "none";
	useEffect(() => {
		if (!open || focusTarget === "none") return;
		requestAnimationFrame(() => {
			contentRef.current
				?.querySelector<HTMLElement>(
					focusTarget === "combo"
						? '[role="combobox"]'
						: "[data-language-retry]",
				)
				?.focus();
		});
	}, [open, focusTarget]);

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
				{pendingCapabilities ? (
					<div className="flex items-center gap-2 text-body-sm text-ink-muted">
						<Spinner />
						{t("ui.settings.language.dialog.loading")}
					</div>
				) : refused ? (
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
									data-language-retry=""
									onClick={() => {
										/* Reachable cold: the arm retries the fault's own query. */
										if (capabilitiesFault) void capabilities.refetch();
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
				) : settingsQuery.isPending ? (
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
						{/*
						 * min-h-8 pins the footer to the `md` Button's own
						 * height, so the Save -> `Saved` swap no longer
						 * shrinks it and the dialog stops re-centring 6px
						 * when the confirmation appears (round-2 D7).
						 */}
						<div className="flex min-h-8 items-center justify-end">
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
					/*
					 * R2-2: kept, and now REACHABLE - a settled registry whose
					 * answer does not carry the language row resolves here (the
					 * sentence is true for it), instead of spinning in the old
					 * `!setting && !isError` loading guard.
					 */
					<Alert variant="warning">
						<span>{t("ui.settings.language.dialog.unavailable")}</span>
					</Alert>
				)}
			</DialogContent>
		</Dialog>
	);
};
