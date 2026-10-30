import { useI18nLocale } from "@shared/i18n/use-locale";
/**
 * The palette's language dialog: the U1 row's editor, at palette reach.
 *
 * WHAT THIS IS, AND IS NOT (i18n slice B2, the accepted proposal). The door is
 * the palette action `Change interface language...`; this dialog carries the
 * SAME enum control and `In effect:` note as the settings row, because both
 * render `SettingControl` for the same registry row - the settings page stays
 * the canonical editor and this is not a second implementation of it. Neither
 * is it a second write path: a pick calls `saveImmediateLanguageValue`, the
 * row's exact write, so the same `settings.edit` op, the same optimistic cache
 * precondition and the same `renegotiateLanguage` seam run whichever door was
 * used.
 *
 * COMMIT ON PICK, NOT ON SAVE. A pick writes immediately, exactly as the row
 * does; there is no draft and no Save step, so closing the dialog cannot drop
 * a language the picker already showed. That is the fix for the v0.42.7 defect
 * where a reader picked fr, closed the dialog, and the app stayed English with
 * zero settings writes in the backend log.
 *
 * APPLY-FORWARD-ONLY. Nothing here touches the transcript: a language change
 * re-renders the surfaces being composed (labels, formatters, the note), and
 * existing streamed content, drafts and history are left exactly as written.
 * That is the proposal's rule, and it falls out of the seam rather than being
 * enforced here - `t()` and the formatters read the store at render time.
 *
 * SELF-INITIATED CHANGES CONFIRM IN PLACE: the footer says `Saved` once the
 * write lands, and the note under the picker moves when the capabilities
 * answer returns. No info toast fires for this app's own write - the own-write
 * window in `language-writes.ts` is what keeps the external-change
 * announcement (`locale-sync.ts`) for changes that came from somewhere else. A
 * FAILED write reports in place while the dialog is open, and leaves through
 * the app's error toast if the reader had already closed it.
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
import { showErrorToast } from "@shared/utils/toast-manager";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Languages } from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { presentSetting } from "../backend-setting-copy";
import { backendSettingsKeys } from "./backend-settings-section";
import { useLanguageDialogStore } from "./language-dialog-store";
import { settingHelpId } from "./setting-combobox";
import {
	DIALOG_EFFECTIVE_SURFACE,
	SettingControl,
	languageIdentifierFor,
	settingEffectiveId,
	settingEffectiveIdFor,
} from "./setting-control";
import { SettingsSection } from "./settings-section";

/**
 * The dialog's write, as a function.
 *
 * EXPORTED because it IS the seam under test: the dialog's pick reaches it
 * through `saveImmediateLanguageValue`, and the jsdom suites (like the
 * settings row's, and for the same reason - Radix's portal listbox commits to
 * no synthetic event jsdom can produce) prove the op and the renegotiation
 * here rather than through a pointer dance the library ignores. One write path
 * either way: the settings row calls the same `renegotiateLanguage` after the
 * same op.
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
	useI18nLocale();
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
				/* One settings-search row: its rendered text is the row's title and
				   its summary, and the landing control is the picker inside it. */
				data-search-row="general.language"
				data-search-control
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
				<output
					id={settingEffectiveId(LANGUAGE_SETTING_KEY)}
					aria-live="polite"
					className="text-meta text-ink-dim"
				>
					{pending
						? t("ui.settings.language.general.pending")
						: saved
							? t("ui.settings.language.general.saved")
							: locale
								? t(
										readbackUnknown || capabilities.error
											? "ui.settings.language.general.last_known"
											: "ui.settings.language.general.effective",
										{
											locale: languageIdentifierFor(locale)?.name ?? locale,
										},
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
	useI18nLocale();
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

	const [pending, setPending] = useState(false);
	const [saved, setSaved] = useState(false);
	const [rejected, setRejected] = useState<{
		value: string;
		message: string;
	} | null>(null);
	const [readbackUnknown, setReadbackUnknown] = useState(false);
	const writing = useRef(false);

	/*
	 * A fresh OPEN clears the transient states. Deliberately keyed on `open`
	 * alone: keyed on `setting` too, the post-write refetch (a new array, a new
	 * row object) would re-run it a moment after every write and wipe the
	 * `Saved` confirmation - which is the write's only feedback (round 1, D2),
	 * so it has to stay up until the next open or pick.
	 */
	useEffect(() => {
		if (!open) return;
		setSaved(false);
		setRejected(null);
	}, [open]);

	/*
	 * A pick IS the write ("commit on selection"), through the settings row's
	 * exact path: `saveImmediateLanguageValue` writes the same key, moves the
	 * same optimistic cache, refetches the readback and renegotiates through
	 * `renegotiateLanguage`. Nothing here is a draft, so a close has nothing to
	 * discard. The guard mirrors the row's: one write in flight at a time, and
	 * no new pick while the last write's readback is unknown.
	 */
	const value = String(setting?.value ?? "");
	const save = async (next: string) => {
		if (
			!setting ||
			writing.current ||
			readbackUnknown ||
			!setting.choices.some((choice) => choice.value === next)
		)
			return;
		writing.current = true;
		setPending(true);
		setRejected(null);
		setSaved(false);
		try {
			const outcome = await saveImmediateLanguageValue({
				value: next,
				queryClient,
			});
			setReadbackUnknown(outcome === "readback-unknown");
			setSaved(outcome === "confirmed");
		} catch (cause) {
			/*
			 * No sentence for the non-`Error` arm. `write_error` already opens with
			 * "The language was not saved", so passing a translated "could not be
			 * saved" as its `{message}` rendered the same claim twice (R1-5); the
			 * General row this dialog mirrors passes "" for the same arm.
			 */
			const message = cause instanceof Error ? cause.message : "";
			setRejected({ value: next, message });
			/*
			 * The reader may already have closed the dialog - the pick committed
			 * at selection, so closing is legitimate. There is no surface left to
			 * render the refusal in, and a failed write must not look like a quiet
			 * close: it leaves through the app's error toast instead.
			 */
			if (!useLanguageDialogStore.getState().open) {
				showErrorToast(
					t("ui.settings.language.general.write_error", { message }),
				);
			}
		} finally {
			writing.current = false;
			setPending(false);
		}
	};
	const retryRead = async () => {
		const [settingsAnswer, capabilityAnswer] = await Promise.all([
			settingsQuery.refetch(),
			capabilities.refetch(),
		]);
		if (!settingsAnswer.isError && !capabilityAnswer.isError)
			setReadbackUnknown(false);
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
	/*
	 * A failed REFETCH is not a failed LOAD - the rule the block above states,
	 * applied to the readback (QA round 1, Q1). `saveImmediateLanguageValue`
	 * re-reads this same query key, so a readback that fails after a confirmed
	 * write leaves `settingsQuery.error` set while the answer it was checking is
	 * still in `data`. Reading that as `loadError` replaced the picker with "the
	 * server is not responding" - false for a server that had just answered the
	 * write - and hid the readback warning that says what actually happened. The
	 * General row draws the same line: its `coldError` requires `!settings.data`.
	 */
	const loadError =
		capabilitiesFault ?? (settingsQuery.data ? null : settingsQuery.error);
	const pendingCapabilities = !answered && !loadError;
	const { sentence: pairingSentence, remedy } = pairingCardCopy(
		pairingCause ?? null,
		t(
			"ui.settings.configuration.language_dialog.your_settings_could_not_be_loaded",
		),
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
								disabled={pending || readbackUnknown}
								helpId={settingHelpId(LANGUAGE_SETTING_KEY)}
								/*
								 * THE DIALOG'S OWN SPELLING, not the canonical one. This picker can
								 * be co-mounted with the General section (the palette dialog opened on
								 * `/settings`), and the section's caption already holds the canonical
								 * id — so this control describes ITS own note, whose id is derived
								 * from the surface name (QA round 5, Q5).
								 */
								effectiveNoteId={settingEffectiveIdFor(
									LANGUAGE_SETTING_KEY,
									DIALOG_EFFECTIVE_SURFACE,
								)}
								/*
								 * A PICK IS THE WRITE (the row's contract; see the state block).
								 * There is no draft to close over and no Save to forget: the
								 * picker's value is the backend's, and this fires when it moves.
								 */
								onValueChange={(next) => {
									void save(next);
								}}
							/>
						</div>
						{/*
						 * The write's own outcome, in place. A failed write states that the
						 * previous setting stands (the row's sentence) and offers the write
						 * again; an unknown readback refuses new picks until a read succeeds,
						 * because the picker must never claim a state nobody checked.
						 */}
						{rejected && (
							<Alert variant="danger">
								<div className="flex flex-col gap-2">
									<p role="alert">
										{t("ui.settings.language.general.write_error", {
											message: rejected.message,
										})}
									</p>
									<Button
										variant="outline"
										size="sm"
										disabled={pending || settingsQuery.isFetching}
										onClick={() => {
											void save(rejected.value);
										}}
									>
										{t("ui.settings.language.dialog.retry")}
									</Button>
								</div>
							</Alert>
						)}
						{readbackUnknown && (
							<Alert variant="danger">
								<div className="flex flex-col gap-2">
									<p role="alert">
										{t("ui.settings.language.general.readback_error")}
									</p>
									<Button
										variant="outline"
										size="sm"
										disabled={
											pending ||
											settingsQuery.isFetching ||
											capabilities.isFetching
										}
										onClick={() => {
											void retryRead();
										}}
									>
										{t("ui.settings.language.dialog.retry")}
									</Button>
								</div>
							</Alert>
						)}
						{/*
						 * min-h-8 pins the footer to one line, so the pending -> `Saved`
						 * swap does not re-centre the dialog (round-2 D7). Commit-on-pick
						 * leaves an ACTION-free footer: it carries the write's status, and
						 * there is nothing for the reader to press after a pick.
						 */}
						<div className="flex min-h-8 items-center justify-end">
							{pending ? (
								<output
									aria-live="polite"
									className="text-body-sm text-ink-muted"
								>
									{t("ui.settings.language.general.pending")}
								</output>
							) : saved ? (
								/*
								 * In-place confirmation in NORMAL ink (round-1 D2): the
								 * disabled button rendered it at 2.37:1, and it is the
								 * write's only feedback. A status line with a check reads at
								 * body ink and is announced.
								 */
								<output
									data-language-status=""
									aria-live="polite"
									className="inline-flex items-center gap-1.5 text-body-sm text-ink"
								>
									<Check aria-hidden="true" className="size-3.5" />
									{t("ui.settings.language.dialog.saved")}
								</output>
							) : null}
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
