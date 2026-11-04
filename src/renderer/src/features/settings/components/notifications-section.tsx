/**
 * Settings -> Notifications: how the app tells you a session finished or
 * needs you, and what that sounds like.
 *
 * WHY A SECTION OF ITS OWN (settings spec §2.1, C1). The master switch
 * (`display.notifications`) used to be one row inside Backend settings, a
 * thousand pixels from anything about sound. The Sound group depends on it,
 * so a "notifications are off" state had no remedy in view. The switch is
 * promoted here (with its sibling `display.notification_session_name`), and the
 * three `notifications.sound.*` keys with it, so a `?setting=` deep link to any
 * of them lands on this section (`promoted-setting-sections.ts`).
 *
 * THE ONE JOB OF THE SCREEN: choose what a notification sounds like, and how
 * loud. Turning it off is one click away, so the off switch comes first.
 *
 * WHAT IT IS NOT. Not a second write path for the settings: the switch, the
 * selection and the volume are registry keys written through `settings.edit` /
 * `settings.reset`, the same funnel every other row uses. The daemon's
 * `/v1/notification-sounds` routes carry only what the registry cannot: the
 * localized catalogue with durations, the gain-baked preview audio, and the
 * custom-sound store (add, rename, remove).
 *
 * NOTHING GREYS OUT (C2). `ink-disabled` on `canvas` is 1.67:1 worst with 48
 * of 59 palettes under 3:1, so a greyed list of eleven names is unreadable,
 * and choosing a sound ahead of turning sounds on is a legitimate task. When
 * sounds or notifications are off, one sentence says why nothing plays and
 * every control stays usable. The one exception is the volume slider while the
 * System sound is selected, which genuinely changes nothing and says so.
 */

import { pairingCardCopy } from "@shared/api/local-operator/backend-error";
import type {
	BackendSetting,
	BackendSettings,
} from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	type DesktopFeatureState,
	desktopFeatureState,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { ErrorBoundary } from "@shared/components/common/error-boundary";
import { SliderSetting } from "@shared/components/common/slider-setting";
import { Spinner } from "@shared/components/common/spinner";
import { ToggleSetting } from "@shared/components/common/toggle-setting";
import { Alert, Button } from "@shared/components/ui";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { usePairingCause } from "@shared/hooks/use-pairing-cause";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FC, RefObject } from "react";
import type { FallbackProps } from "react-error-boundary";
import {
	DEFAULT_VOLUME,
	NOTIFICATIONS_ENABLED_KEY,
	NOTIFICATION_SESSION_NAME_KEY,
	SYSTEM_SOUND_ID,
	VOLUME_PAGE_STEP,
	VOLUME_STEP,
	notificationSoundRows,
	parseNotificationSoundListing,
	volumeDescriptionKey,
	volumeIcon,
	volumeReadout,
} from "../notification-sound-model";
import { backendSettingsKeys } from "./backend-settings-section";
import {
	NotificationSoundList,
	type NotificationSoundListHandle,
	type NotificationSoundListPresets,
} from "./notification-sound-list";
import { SettingsSection } from "./settings-section";

/** Query key for the daemon's sound listing. */
export const notificationSoundKeys = {
	list: [...desktopKeys.settings, "notification-sounds"] as const,
};

type NotificationsSectionProps = {
	sectionRef?: RefObject<HTMLDivElement>;
	/**
	 * Story/test seam: per-row states (a preview playing, a pending upload, an
	 * open rename) that otherwise need a real engine or a real upload to reach.
	 * Production passes nothing.
	 */
	listPresets?: NotificationSoundListPresets;
};

/** Which of the group's renderings a feature state admits (Speech's rule). */
function groupState(state: DesktopFeatureState): "ready" | "older" | "pairing" {
	if (state === "enabled") return "ready";
	if (state === "below-version") return "older";
	return "pairing";
}

const ListFallback = ({ resetErrorBoundary }: FallbackProps) => {
	useI18nLocale();
	return (
		<Alert variant="warning">
			<div className="flex flex-col items-start gap-3">
				<span>
					{t("ui.settings.notifications.load.failed", { reason: "" }).trim()}
				</span>
				<Button variant="secondary" size="sm" onClick={resetErrorBoundary}>
					<RotateCw aria-hidden="true" />
					{t("ui.settings.notifications.retry")}
				</Button>
			</div>
		</Alert>
	);
};

const boolValue = (row: BackendSetting | undefined, fallback: boolean) =>
	typeof row?.value === "boolean" ? row.value : fallback;

const numberValue = (row: BackendSetting | undefined, fallback: number) =>
	typeof row?.value === "number" && Number.isFinite(row.value)
		? row.value
		: fallback;

export const NotificationsSection: FC<NotificationsSectionProps> = ({
	sectionRef,
	listPresets,
}) => {
	useI18nLocale();
	const queryClient = useQueryClient();
	const capabilities = useDesktopCapabilities();
	const pairingCause = usePairingCause();
	const featureState = desktopFeatureState(
		capabilities.data,
		"notification_sounds",
	);
	const state = groupState(featureState);

	/*
	 * The SAME registry read the Backend section and Speech take, under the same
	 * query key: one cache entry, one refetch after a write. The master switch is
	 * a registry row on every backend, so this read is not gated on the sound
	 * capability; only the sound listing is.
	 */
	const settingsQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled: state !== "pairing",
		staleTime: 10_000,
	});

	const listingQuery = useQuery({
		queryKey: notificationSoundKeys.list,
		queryFn: async () => {
			const payload = await desktopResult<unknown>({
				op: "notification_sounds.list",
			});
			const parsed = parseNotificationSoundListing(payload);
			// A 200 of another shape is a failed read, never "no sounds".
			if (!parsed) throw new Error("unreadable notification sound listing");
			return parsed;
		},
		enabled: state === "ready",
		staleTime: 10_000,
	});

	const settings = settingsQuery.data?.settings ?? [];
	const byKey = useMemo(
		() => new Map(settings.map((row) => [row.key, row])),
		[settings],
	);
	const notificationsRow = byKey.get(NOTIFICATIONS_ENABLED_KEY);
	const sessionNameRow = byKey.get(NOTIFICATION_SESSION_NAME_KEY);
	const soundRows = useMemo(() => notificationSoundRows(settings), [settings]);
	const enabledRow = soundRows.byKey["notifications.sound.enabled"];
	const idRow = soundRows.byKey["notifications.sound.id"];
	const volumeRow = soundRows.byKey["notifications.sound.volume"];

	/* ------------------------------------------------------------ the writes */

	const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
	const [writeErrors, setWriteErrors] = useState<Record<string, string | null>>(
		{},
	);
	const markSaving = useCallback(
		(key: string, saving: boolean) =>
			setSavingKeys((current) => ({ ...current, [key]: saving })),
		[],
	);
	const setWriteError = useCallback(
		(key: string, error: string | null) =>
			setWriteErrors((current) => ({ ...current, [key]: error })),
		[],
	);

	/*
	 * One write, then one refetch of both reads: the listing reports
	 * `selected` / `enabled` / `volume` from the same config the registry does,
	 * so they move together.
	 */
	const refreshAll = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: backendSettingsKeys.all }),
			queryClient.invalidateQueries({ queryKey: notificationSoundKeys.list }),
		]);
	}, [queryClient]);

	/*
	 * WRITES ARE SERIALIZED PER KEY. The switches and the slider stay focused
	 * and live while they save (`savingInPlace`, QA Q1 / UX U1), so a second
	 * press can arrive before the first write lands. Each key keeps one chain:
	 * a write waits for the previous one, so the daemon sees them in the order
	 * the user made them and the last one wins.
	 */
	const writeChains = useRef(new Map<string, Promise<unknown>>());
	const inFlight = useRef(new Map<string, number>());
	const writeSetting = useCallback(
		(key: string, value: string | number | boolean) => {
			const previous = writeChains.current.get(key) ?? Promise.resolve();
			inFlight.current.set(key, (inFlight.current.get(key) ?? 0) + 1);
			markSaving(key, true);
			setWriteError(key, null);
			const run = previous
				.catch(() => {})
				.then(async () => {
					try {
						await desktopResult({ op: "settings.edit", key, value });
						await refreshAll();
					} catch (error) {
						setWriteError(
							key,
							error instanceof Error && error.message
								? error.message
								: t("ui.settings.notifications.save.failed_generic"),
						);
						throw error;
					} finally {
						const left = (inFlight.current.get(key) ?? 1) - 1;
						inFlight.current.set(key, left);
						if (left === 0) markSaving(key, false);
					}
				});
			writeChains.current.set(key, run);
			return run;
		},
		[refreshAll, markSaving, setWriteError],
	);

	const resetSetting = useCallback(
		async (key: string) => {
			markSaving(key, true);
			setWriteError(key, null);
			try {
				await desktopResult({ op: "settings.reset", key });
				await refreshAll();
			} catch (error) {
				setWriteError(
					key,
					error instanceof Error && error.message
						? error.message
						: t("ui.settings.notifications.save.failed_generic"),
				);
			} finally {
				markSaving(key, false);
			}
		},
		[refreshAll, markSaving, setWriteError],
	);

	/*
	 * LIVE CHANGES FROM ELSEWHERE (UX round 1, U2). An agent or the TUI can add
	 * a sound or select one while this page is open. A `config` frame names
	 * TOP-LEVEL keys (core `desktop_feed.py`), so a sound setting arrives as
	 * `notifications` (main's `observeConfigChange` reads the same frame);
	 * `display` covers the promoted master switch. Adding a custom sound writes
	 * no config at all, so the listing is also re-read when the window regains
	 * focus, which is when a user comes back from the terminal. Deduped by the
	 * frame's own identity, as `locale-sync.ts` does.
	 */
	const feed = useDesktopFeed();
	const handledFrame = useRef<string | null>(null);
	useEffect(() => {
		const change = feed.configChange;
		if (!change) return;
		const stamp = `${change.epoch}:${change.seq}`;
		if (handledFrame.current === stamp) return;
		handledFrame.current = stamp;
		if (
			change.changedKeys.some(
				(key) =>
					key === "notifications" ||
					key.startsWith("notifications.") ||
					key === "display" ||
					key === NOTIFICATIONS_ENABLED_KEY ||
					key === NOTIFICATION_SESSION_NAME_KEY,
			)
		)
			void refreshAll();
	}, [feed.configChange, refreshAll]);
	useEffect(() => {
		const onFocus = () => {
			void queryClient.invalidateQueries({
				queryKey: notificationSoundKeys.list,
			});
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [queryClient]);

	const listRef = useRef<NotificationSoundListHandle>(null);

	/* ------------------------------------------------------------- the copy */

	const title = t("ui.settings.notifications.section.title");
	const description = t("ui.settings.notifications.section.description");

	const sectionFrame = (children: React.ReactNode) => (
		<SettingsSection
			title={title}
			icon={Bell}
			description={description}
			sectionRef={sectionRef}
			searchSection="notifications"
			searchSectionLabel={title}
			searchIgnore="notification rows are registry keys read from the daemon's own selection"
		>
			{children}
		</SettingsSection>
	);

	if (state === "pairing") {
		const { sentence } = pairingCardCopy(
			pairingCause ?? null,
			t("ui.settings.notifications.load.failed", { reason: "" }).trim(),
			capabilities.data ? null : (capabilities.error ?? null),
		);
		return sectionFrame(<Alert variant="warning">{sentence}</Alert>);
	}

	const notificationsOn = boolValue(notificationsRow, true);

	/* --------------------------------------------- the promoted master rows */

	const masterRows = (
		<div className="flex flex-col gap-1">
			{notificationsRow && (
				<ToggleSetting
					label={notificationsRow.label}
					description={notificationsRow.help || undefined}
					value={notificationsOn}
					isSaving={Boolean(savingKeys[NOTIFICATIONS_ENABLED_KEY])}
					savingInPlace
					onChange={(value) =>
						writeSetting(NOTIFICATIONS_ENABLED_KEY, value).catch(() => {})
					}
				/>
			)}
			{sessionNameRow && (
				<ToggleSetting
					label={sessionNameRow.label}
					description={sessionNameRow.help || undefined}
					value={boolValue(sessionNameRow, true)}
					isSaving={Boolean(savingKeys[NOTIFICATION_SESSION_NAME_KEY])}
					savingInPlace
					onChange={(value) =>
						writeSetting(NOTIFICATION_SESSION_NAME_KEY, value).catch(() => {})
					}
				/>
			)}
			{[NOTIFICATIONS_ENABLED_KEY, NOTIFICATION_SESSION_NAME_KEY].map(
				(key) =>
					writeErrors[key] && (
						<output key={key} className="block text-meta text-danger">
							{writeErrors[key]}
						</output>
					),
			)}
		</div>
	);

	if (settingsQuery.isPending) {
		return sectionFrame(
			<div className="flex items-center gap-2 text-body-sm text-ink-muted">
				<Spinner size="sm" />
				{t("ui.settings.notifications.load.loading")}
			</div>,
		);
	}

	if (settingsQuery.error) {
		const { sentence } = pairingCardCopy(
			pairingCause ?? null,
			t("ui.settings.notifications.load.failed", { reason: "" }).trim(),
			settingsQuery.error,
		);
		// Retry, as Speech offers beside the same reason (QA round 1, Q3).
		return sectionFrame(
			<Alert variant="warning">
				<div className="flex flex-col items-start gap-3">
					<span>{sentence}</span>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => {
							void settingsQuery.refetch();
						}}
					>
						<RotateCw aria-hidden="true" />
						{t("ui.settings.notifications.retry")}
					</Button>
				</div>
			</Alert>,
		);
	}

	/* ---------------------------------------------------- the Sound group */

	const soundHeading = (
		<h3 className="text-body font-medium text-ink">
			{t("ui.settings.notifications.sound.heading")}
		</h3>
	);

	if (state === "older") {
		return sectionFrame(
			<div className="flex flex-col gap-6">
				{masterRows}
				<div className="flex flex-col gap-2 border-t border-hairline pt-6">
					{soundHeading}
					<p className="text-body-sm text-ink-muted">
						{t("ui.settings.notifications.backend_older")}
					</p>
				</div>
			</div>,
		);
	}

	const listing = listingQuery.data ?? null;
	const soundOn = boolValue(enabledRow, listing?.enabled ?? true);
	const selectedId =
		typeof idRow?.value === "string" ? idRow.value : (listing?.selected ?? "");
	const volumeDefault = numberValue(
		volumeRow ? { ...volumeRow, value: volumeRow.default } : undefined,
		DEFAULT_VOLUME,
	);
	const volume = numberValue(volumeRow, listing?.volume ?? DEFAULT_VOLUME);
	const readout = (value: number) => {
		const { key, value: shown } = volumeReadout(value, volumeDefault);
		return t(key, { value: shown });
	};

	return sectionFrame(
		<div className="flex flex-col gap-6">
			{masterRows}

			<div
				className="flex flex-col gap-4 border-t border-hairline pt-6"
				data-notification-sound-group=""
			>
				{soundHeading}

				{!notificationsOn && (
					<Alert variant="info">
						<div className="flex flex-col items-start gap-3">
							<span>{t("ui.settings.notifications.sound.gated")}</span>
							<Button
								variant="secondary"
								size="sm"
								disabled={Boolean(savingKeys[NOTIFICATIONS_ENABLED_KEY])}
								onClick={() => {
									void writeSetting(NOTIFICATIONS_ENABLED_KEY, true).catch(
										() => {},
									);
								}}
							>
								{t("ui.settings.notifications.sound.gated_action")}
							</Button>
						</div>
					</Alert>
				)}

				{enabledRow && (
					<div className="flex flex-col gap-1">
						<ToggleSetting
							searchRow="notifications.sound.enabled"
							searchTerms={t("ui.settings.notifications.search_terms")}
							label={t("ui.settings.notifications.sound.enabled_label")}
							description={t(
								"ui.settings.notifications.sound.enabled_description",
							)}
							value={soundOn}
							isSaving={Boolean(savingKeys["notifications.sound.enabled"])}
							savingInPlace
							onChange={(value) =>
								writeSetting("notifications.sound.enabled", value).catch(
									() => {},
								)
							}
						/>
						{!soundOn && (
							<p className="text-body-sm text-ink-muted" data-sound-off-note="">
								{t("ui.settings.notifications.sound.enabled_off_note")}
							</p>
						)}
						{writeErrors["notifications.sound.enabled"] && (
							<output className="block text-meta text-danger">
								{writeErrors["notifications.sound.enabled"]}
							</output>
						)}
					</div>
				)}

				{volumeRow && (
					<div
						className="flex flex-col gap-1"
						data-search-row="notifications.sound.volume"
						data-search-control=""
					>
						<SliderSetting
							value={volume}
							label={t("ui.settings.notifications.volume.label")}
							description={t(volumeDescriptionKey(volume, selectedId))}
							min={0}
							max={100}
							step={VOLUME_STEP}
							pageStep={VOLUME_PAGE_STEP}
							icon={volumeIcon(volume)}
							readout={readout}
							valueText={(value) =>
								t("ui.settings.notifications.volume.valuetext", {
									value: Math.round(value),
								})
							}
							disabled={selectedId === SYSTEM_SOUND_ID}
							isSaving={Boolean(savingKeys["notifications.sound.volume"])}
							savingInPlace
							trailing={
								Math.round(volume) !== Math.round(volumeDefault) ? (
									<Button
										variant="link"
										size="sm"
										// Reset moves a control that is disabled for System,
										// so it is disabled with it (QA Q6 / UX U12).
										disabled={selectedId === SYSTEM_SOUND_ID}
										onClick={() => {
											void resetSetting("notifications.sound.volume").then(() =>
												// Hear the default you went back to (UX U11).
												listRef.current?.previewSelected(volumeDefault),
											);
										}}
									>
										{t("ui.settings.notifications.volume.reset")}
									</Button>
								) : null
							}
							onChange={async (value) => {
								await writeSetting("notifications.sound.volume", value);
								// Preview on release (§4.2): the selected sound at the new level.
								listRef.current?.previewSelected(value);
							}}
						/>
						{writeErrors["notifications.sound.volume"] && (
							<output className="block text-meta text-danger">
								{writeErrors["notifications.sound.volume"]}
							</output>
						)}
					</div>
				)}

				{listingQuery.error ? (
					<Alert variant="warning">
						<div className="flex flex-col items-start gap-3">
							<span>
								{t("ui.settings.notifications.load.failed", {
									reason:
										listingQuery.error instanceof Error
											? listingQuery.error.message
											: "",
								}).trim()}
							</span>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => {
									void listingQuery.refetch();
								}}
							>
								<RotateCw aria-hidden="true" />
								{t("ui.settings.notifications.retry")}
							</Button>
						</div>
					</Alert>
				) : !listing ? (
					<div className="flex items-center gap-2 text-body-sm text-ink-muted">
						<Spinner size="sm" />
						{t("ui.settings.notifications.load.loading")}
					</div>
				) : (
					<ErrorBoundary fallbackRender={ListFallback}>
						<NotificationSoundList
							ref={listRef}
							listing={listing}
							selectedId={selectedId}
							volume={volume}
							canSelect={Boolean(idRow)}
							onSelect={(id) => writeSetting("notifications.sound.id", id)}
							onChanged={refreshAll}
							{...listPresets}
						/>
					</ErrorBoundary>
				)}

				{soundRows.missing.length > 0 && (
					<p className="text-meta text-ink-dim">
						{t("ui.settings.notifications.missing_rows", {
							count: soundRows.missing.length,
							rows: soundRows.missing.join(", "),
						})}
					</p>
				)}

				<TestNotificationButton />
			</div>
		</div>,
	);
};

/**
 * "Send test notification" (§2.2, C11): one real banner through main's
 * shared sound helper, because the Settings preview plays at the output
 * volume and a macOS banner may follow the alert volume or be silenced by
 * Focus. The confirmation names both. Hidden outside Electron, where there is
 * no main process to raise a banner (Storybook stubs the bridge).
 */
const TestNotificationButton: FC = () => {
	useI18nLocale();
	const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "failed">(
		"idle",
	);
	const send = window.api?.sendTestNotification;
	if (typeof send !== "function") return null;
	return (
		<div className="flex flex-col items-start gap-2">
			<Button
				variant="secondary"
				size="sm"
				disabled={phase === "sending"}
				onClick={async () => {
					setPhase("sending");
					try {
						const result = await send();
						setPhase(result.shown ? "sent" : "failed");
					} catch {
						setPhase("failed");
					}
				}}
			>
				{phase === "sending" && <Spinner size="xs" />}
				{t("ui.settings.notifications.test.action")}
			</Button>
			<output aria-live="polite" className="text-body-sm text-ink-muted">
				{phase === "sent"
					? t("ui.settings.notifications.test.sent")
					: phase === "failed"
						? t("ui.settings.notifications.test.failed")
						: ""}
			</output>
		</div>
	);
};
