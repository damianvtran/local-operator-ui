/**
 * The notification-sound list: Built-in, System, Your sounds, Add (settings
 * spec §3 and §5).
 *
 * ONE RADIO GROUP across all three blocks (§2.3): ↑/↓ walk Built-in -> System
 * -> Your sounds in order and wrap, so the list has no seam to manage (the
 * theme grid needed a dedicated navigation module for its seam; a list does
 * not). The group is one tab stop; each custom row's More button is its own.
 *
 * SELECTING PLAYS, WRITING WAITS (§3.2, C5). A user-initiated choice selects
 * the row and plays it once at the current volume immediately; the
 * `settings.edit` of `notifications.sound.id` is sent 400ms after the LAST
 * change, so arrowing through ten sounds is one write. Selection that is not
 * user-initiated (first load, a feed frame, the reset after a removal) never
 * plays: only `onValueChange` from the radio group plays, and that fires only
 * for the user's own act.
 *
 * PREVIEW (§3.3). One engine owner for the whole group
 * (`PREVIEW_OWNER_ID`), so the shared engine's exclusivity stops the previous
 * preview by itself. The audio is the daemon's render at `?volume=`, never the
 * engine's own `setVolume()`, which is shared with chat audio: the server
 * applies the same (v/100)^2 curve the real banner uses, so the preview is
 * what the notification will sound like.
 *
 * UPLOADS (§5.1-5.2). Several files at once ("allow multiple"); each becomes a
 * pending row where the sound will appear, uploaded one at a time. Files
 * beyond the remaining slots are refused locally with `limit_reached` and cost
 * no request. Over-length clips are REFUSED by the daemon (`too_long`), never
 * trimmed (decision C10).
 */

import {
	desktopMedia,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button, Progress, RadioGroup } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { createBlobUrl, revokeBlobUrl } from "@shared/lib/blob-url-cache";
import { useAudioEngineStore } from "@shared/store/audio-engine-store";
import { AlertCircle, Plus, X } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { KeyboardEvent, RefObject } from "react";
import {
	DEFAULT_SOUND_ID,
	type NotificationSound,
	type NotificationSoundListing,
	PREVIEW_OWNER_ID,
	SELECTION_WRITE_DEBOUNCE_MS,
	SYSTEM_SOUND_ID,
	type UploadRefusal,
	fileStem,
	groupNotificationSounds,
	nextFocusAfterRemove,
	partitionBySlots,
	refusalSeconds,
	uploadErrorCopyKey,
} from "../notification-sound-model";
import {
	type CustomRowMode,
	CustomSoundRow,
	type PreviewState,
	STATIC_ROW_CLASS,
	SoundRow,
} from "./notification-sound-row";

/** The accepted picker filter (§5.1). The daemon still sniffs the bytes. */
const ACCEPT = ".wav,.flac,.mp3,.ogg,audio/wav,audio/flac,audio/mpeg,audio/ogg";

export type NotificationSoundListHandle = {
	/** Play the selected sound at `volume` (the slider's release preview). */
	previewSelected: (volume: number) => void;
};

/** One file the user chose, on its way in or refused. */
type PendingUpload = {
	key: string;
	file: File;
	stem: string;
	phase: "queued" | "uploading" | "processing" | "error";
	refusal?: UploadRefusal;
};

type Props = {
	listing: NotificationSoundListing;
	/** The registry's `notifications.sound.id` (authoritative over the listing). */
	selectedId: string;
	volume: number;
	/** The registry carries the id key, so a selection can be written. */
	canSelect: boolean;
	onSelect: (id: string) => Promise<void>;
	/** Refetch the listing and the registry after an add/rename/remove. */
	onChanged: () => Promise<void>;
} & NotificationSoundListPresets;

/**
 * Test/story seam: preset per-row states (a frame of "playing" or a pending
 * upload) without driving the engine or a real upload. Production passes none.
 */
export type NotificationSoundListPresets = {
	initialPreview?: { id: string; state: PreviewState };
	initialPending?: Array<
		Omit<PendingUpload, "file"> & { fileName: string; percent?: number }
	>;
	initialSaveError?: string;
	initialMode?: { id: string; mode: CustomRowMode };
};

/** Read a desktop error's message, without inventing one. */
const reasonOf = (error: unknown): string =>
	error instanceof Error && error.message ? error.message : "";

/**
 * The renderer side of a media refusal, as `UploadRefusal`.
 *
 * `refusal` is the daemon's own code (main forwards it for this op only);
 * without it the failure is a transport one, which earns Retry.
 */
function refusalOf(
	response: Awaited<ReturnType<typeof desktopMedia>>,
): UploadRefusal {
	if (response.kind === "error" && response.refusal)
		return { code: response.refusal.code, params: response.refusal.params };
	return { code: null };
}

export const NotificationSoundList = forwardRef<
	NotificationSoundListHandle,
	Props
>(
	(
		{
			listing,
			selectedId,
			volume,
			canSelect,
			onSelect,
			onChanged,
			initialPreview,
			initialPending,
			initialSaveError,
			initialMode,
		},
		ref,
	) => {
		useI18nLocale();
		const groups = useMemo(
			() => groupNotificationSounds(listing.sounds),
			[listing.sounds],
		);
		const customSubheadId = useId();
		const listLabelId = useId();
		const limits = listing.limits;

		/* -------------------------------------------------------- selection */

		/*
		 * The OPTIMISTIC choice: set on the user's act, cleared once the registry
		 * catches up (or on a failed save, which reverts to the saved value).
		 */
		const [pendingChoice, setPendingChoice] = useState<string | null>(null);
		const [saveError, setSaveError] = useState<string | null>(
			initialSaveError ?? null,
		);
		const [lastFailedChoice, setLastFailedChoice] = useState<string | null>(
			null,
		);
		const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
		const shown = pendingChoice ?? selectedId;

		useEffect(() => {
			if (pendingChoice !== null && pendingChoice === selectedId)
				setPendingChoice(null);
		}, [pendingChoice, selectedId]);

		const flushChoice = useCallback(
			async (id: string) => {
				try {
					await onSelect(id);
					setSaveError(null);
					setLastFailedChoice(null);
				} catch (error) {
					// Revert to the saved value and say why (§3.2).
					setPendingChoice(null);
					setLastFailedChoice(id);
					setSaveError(reasonOf(error));
				}
			},
			[onSelect],
		);

		const scheduleWrite = useCallback(
			(id: string) => {
				if (writeTimer.current) clearTimeout(writeTimer.current);
				writeTimer.current = setTimeout(() => {
					writeTimer.current = null;
					void flushChoice(id);
				}, SELECTION_WRITE_DEBOUNCE_MS);
			},
			[flushChoice],
		);

		/* ----------------------------------------------------------- preview */

		const [preview, setPreview] = useState<{
			id: string;
			state: PreviewState;
		} | null>(initialPreview ?? null);
		/* The blob URL the current preview plays, revoked when it is replaced. */
		const previewUrl = useRef<string | null>(null);
		const previewGeneration = useRef(0);
		const engineOwner = useAudioEngineStore((state) => state.ownerId);
		const engineStatus = useAudioEngineStore((state) => state.status);

		/*
		 * The engine is shared: when another surface (a chat sound, speech) takes
		 * it, or the clip ends, this group's Stop must return to Play.
		 */
		useEffect(() => {
			if (!preview || preview.state !== "playing") return;
			if (engineOwner !== PREVIEW_OWNER_ID || engineStatus === "ended")
				setPreview(null);
		}, [engineOwner, engineStatus, preview]);

		const releaseUrl = useCallback(() => {
			if (previewUrl.current) revokeBlobUrl(previewUrl.current);
			previewUrl.current = null;
		}, []);

		const stopPreview = useCallback(() => {
			previewGeneration.current += 1;
			useAudioEngineStore.getState().stop(PREVIEW_OWNER_ID);
			setPreview(null);
		}, []);

		const play = useCallback(
			async (id: string, atVolume: number) => {
				if (id === SYSTEM_SOUND_ID) return;
				const generation = ++previewGeneration.current;
				setPreview({ id, state: "loading" });
				try {
					const response = await desktopMedia(
						{
							op: "notification_sounds.audio",
							soundId: id,
							volume: Math.max(0, Math.min(100, Math.round(atVolume))),
						},
						null,
					);
					if (generation !== previewGeneration.current) return;
					if (response.kind !== "bytes") throw new Error("no audio");
					releaseUrl();
					const url = createBlobUrl(
						response.data as BlobPart,
						response.mimeType || "audio/wav",
					);
					previewUrl.current = url;
					const started = await useAudioEngineStore
						.getState()
						.play(PREVIEW_OWNER_ID, url, {
							onEnded: () => setPreview(null),
							onError: () => setPreview({ id, state: "failed" }),
						});
					if (generation !== previewGeneration.current) return;
					setPreview(
						started ? { id, state: "playing" } : { id, state: "failed" },
					);
				} catch {
					if (generation !== previewGeneration.current) return;
					setPreview({ id, state: "failed" });
				}
			},
			[releaseUrl],
		);

		const togglePreview = (id: string) => {
			if (preview?.id === id && preview.state === "playing") {
				stopPreview();
				return;
			}
			void play(id, volume);
		};

		useImperativeHandle(
			ref,
			() => ({
				previewSelected: (atVolume: number) => {
					void play(shown, atVolume);
				},
			}),
			[play, shown],
		);

		/* Leaving Settings stops the preview and frees its bytes (§3.3). */
		useEffect(
			() => () => {
				if (writeTimer.current) clearTimeout(writeTimer.current);
				useAudioEngineStore.getState().stop(PREVIEW_OWNER_ID);
				releaseUrl();
			},
			[releaseUrl],
		);

		/* ---------------------------------------------------- the live region */

		const [announcement, setAnnouncement] = useState("");

		/* ------------------------------------------------------- custom rows */

		const [modes, setModes] = useState<Record<string, CustomRowMode>>(
			initialMode ? { [initialMode.id]: initialMode.mode } : {},
		);
		const modeOf = (id: string): CustomRowMode => modes[id] ?? { kind: "idle" };
		const setMode = (id: string, mode: CustomRowMode) =>
			setModes((current) => ({ ...current, [id]: mode }));
		const moreRefs = useRef(new Map<string, RefObject<HTMLButtonElement>>());
		const moreRefFor = (id: string) => {
			let entry = moreRefs.current.get(id);
			if (!entry) {
				entry = { current: null };
				moreRefs.current.set(id, entry);
			}
			return entry;
		};
		const addRef = useRef<HTMLButtonElement | null>(null);
		const fileInput = useRef<HTMLInputElement | null>(null);
		/* Focus requested for after the next render (a removed row's neighbour). */
		const [focusTarget, setFocusTarget] = useState<string | "add" | null>(null);
		useEffect(() => {
			if (!focusTarget) return;
			const timer = setTimeout(() => {
				if (focusTarget === "add") addRef.current?.focus();
				else moreRefs.current.get(focusTarget)?.current?.focus();
				setFocusTarget(null);
			}, 0);
			return () => clearTimeout(timer);
		}, [focusTarget]);

		const rename = async (sound: NotificationSound, name: string) => {
			setMode(sound.id, { kind: "renaming", saving: true, error: null });
			try {
				await desktopResult({
					op: "notification_sounds.rename",
					id: sound.id,
					name,
				});
				await onChanged();
				setMode(sound.id, { kind: "idle" });
				setFocusTarget(sound.id);
			} catch (error) {
				setMode(sound.id, {
					kind: "renaming",
					saving: false,
					error: t("ui.settings.notifications.custom.rename_failed", {
						reason: reasonOf(error),
					}).trim(),
				});
			}
		};

		const remove = async (sound: NotificationSound) => {
			setMode(sound.id, {
				kind: "confirm-remove",
				removing: true,
				error: null,
			});
			const ids = groups.custom.map((row) => row.id);
			try {
				const result = await desktopResult<{ selection_reset?: boolean }>({
					op: "notification_sounds.remove",
					id: sound.id,
				});
				if (preview?.id === sound.id) stopPreview();
				const reset = result?.selection_reset === true;
				// The reset is not the user's choice of Soft pulse: it does not play.
				if (reset) setPendingChoice(DEFAULT_SOUND_ID);
				setAnnouncement(
					reset
						? t("ui.settings.notifications.custom.removed_reset", {
								name: sound.label,
							})
						: t("ui.settings.notifications.custom.removed", {
								name: sound.label,
							}),
				);
				const next = nextFocusAfterRemove(ids, sound.id);
				setModes((current) => {
					const { [sound.id]: _gone, ...rest } = current;
					return rest;
				});
				await onChanged();
				setFocusTarget(next ?? "add");
			} catch (error) {
				setMode(sound.id, {
					kind: "confirm-remove",
					removing: false,
					error: t("ui.settings.notifications.custom.remove_failed", {
						name: sound.label,
						reason: reasonOf(error),
					}).trim(),
				});
			}
		};

		/* ----------------------------------------------------------- uploads */

		const [pending, setPending] = useState<PendingUpload[]>(() =>
			(initialPending ?? []).map(({ fileName, percent: _percent, ...rest }) => ({
				...rest,
				file: new File([], fileName),
			})),
		);
		const [uploadPercent, setUploadPercent] = useState<Record<string, number>>(
			() =>
				Object.fromEntries(
					(initialPending ?? []).map((row) => [row.key, row.percent ?? 0]),
				),
		);
		const uploadQueue = useRef<Promise<void>>(Promise.resolve());
		const pendingKey = useRef(0);
		const cancelled = useRef(new Set<string>());

		const patchPending = (key: string, patch: Partial<PendingUpload>) =>
			setPending((rows) =>
				rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
			);
		const dropPending = (key: string) =>
			setPending((rows) => rows.filter((row) => row.key !== key));

		/**
		 * Upload one file. Resolves the added sound's id, or null on refusal.
		 *
		 * PROGRESS. The relay is one IPC round trip, so there is no byte-level
		 * upload progress to report: reading the file (local, fast) is shown as
		 * the determinate phase, and the daemon's decode + loudness match as the
		 * indeterminate "Matching loudness…" phase.
		 */
		const uploadOne = async (row: PendingUpload): Promise<string | null> => {
			if (cancelled.current.has(row.key)) return null;
			if (row.file.size > limits.max_bytes) {
				// Refused before a byte is read, exactly as the daemon would (413).
				patchPending(row.key, {
					phase: "error",
					refusal: { code: "too_large" },
				});
				return null;
			}
			patchPending(row.key, { phase: "uploading" });
			setUploadPercent((current) => ({ ...current, [row.key]: 0 }));
			let bytes: Uint8Array;
			try {
				bytes = await readWithProgress(row.file, (fraction) =>
					setUploadPercent((current) => ({
						...current,
						[row.key]: Math.round(fraction * 100),
					})),
				);
			} catch {
				patchPending(row.key, { phase: "error", refusal: { code: null } });
				return null;
			}
			if (cancelled.current.has(row.key)) return null;
			if (bytes.byteLength > limits.max_bytes) {
				// Refused here, exactly as the daemon would (413 too_large).
				patchPending(row.key, {
					phase: "error",
					refusal: { code: "too_large" },
				});
				return null;
			}
			patchPending(row.key, { phase: "processing" });
			const response = await desktopMedia(
				{
					op: "notification_sounds.upload",
					fileName: row.file.name || "sound",
					name: row.stem,
				},
				bytes,
			).catch(() => null);
			if (cancelled.current.has(row.key)) return null;
			if (!response || response.kind !== "json") {
				patchPending(row.key, {
					phase: "error",
					refusal: response ? refusalOf(response) : { code: null },
				});
				return null;
			}
			const body = response.body as { result?: { id?: unknown } } | null;
			const id = typeof body?.result?.id === "string" ? body.result.id : null;
			/*
			 * The pending row stays until the refetched listing carries the sound,
			 * then the two swap in one render: dropping it first would shift every
			 * row below for the length of a refetch (§5.1, "nothing shifts").
			 */
			await onChanged();
			dropPending(row.key);
			return id;
		};

		const startUploads = (files: File[]) => {
			if (files.length === 0) return;
			const customCount =
				groups.custom.length +
				pending.filter((row) => row.phase !== "error").length;
			const { accepted, overLimit } = partitionBySlots(
				files,
				customCount,
				limits.max_sounds,
			);
			const rows: PendingUpload[] = [
				...accepted.map((file) => ({
					key: `upload-${++pendingKey.current}`,
					file,
					stem: fileStem(file.name, limits.max_name_chars),
					phase: "queued" as const,
				})),
				...overLimit.map((file) => ({
					key: `upload-${++pendingKey.current}`,
					file,
					stem: fileStem(file.name, limits.max_name_chars),
					phase: "error" as const,
					refusal: { code: "limit_reached" },
				})),
			];
			setPending((current) => [...current, ...rows]);
			const toSend = rows.filter((row) => row.phase === "queued");
			uploadQueue.current = uploadQueue.current.then(async () => {
				const added: Array<{ id: string; name: string }> = [];
				for (const row of toSend) {
					const id = await uploadOne(row);
					if (id) added.push({ id, name: row.stem });
				}
				if (added.length === 0) return;
				if (toSend.length === 1 && added.length === 1) {
					// One file: it becomes your sound and plays once (§5.1).
					const [only] = added;
					setPendingChoice(only.id);
					void flushChoice(only.id);
					void play(only.id, volume);
					setAnnouncement(
						t("ui.settings.notifications.custom.added_one", {
							name: only.name,
						}),
					);
				} else {
					setAnnouncement(
						t("ui.settings.notifications.custom.added_many", {
							count: added.length,
						}),
					);
				}
				addRef.current?.focus();
			});
		};

		const retryUpload = (row: PendingUpload) => {
			patchPending(row.key, { phase: "queued", refusal: undefined });
			uploadQueue.current = uploadQueue.current.then(async () => {
				const id = await uploadOne({ ...row, phase: "queued" });
				if (id) {
					setAnnouncement(
						t("ui.settings.notifications.custom.added_many", { count: 1 }),
					);
				}
			});
		};

		const cancelUpload = (row: PendingUpload) => {
			cancelled.current.add(row.key);
			dropPending(row.key);
		};

		/* --------------------------------------------------------- the render */

		const totalCustom = groups.custom.length;
		const full = totalCustom >= limits.max_sounds;
		const playing = (id: string): PreviewState =>
			preview?.id === id ? preview.state : "idle";

		const onGroupKeyDown = (event: KeyboardEvent) => {
			// Esc anywhere in the group stops the preview (§3.3).
			if (event.key === "Escape" && preview) {
				stopPreview();
			}
		};

		const chooseAnother = () => fileInput.current?.click();

		return (
			<div className="flex flex-col gap-3" onKeyDown={onGroupKeyDown}>
				<span id={listLabelId} className="sr-only">
					{t("ui.settings.notifications.list.label")}
				</span>
				<RadioGroup
					aria-labelledby={listLabelId}
					value={shown}
					loop
					disabled={!canSelect}
					onValueChange={(id) => {
						// The user's own act: select, play once, write later.
						setPendingChoice(id);
						setSaveError(null);
						void play(id, volume);
						scheduleWrite(id);
					}}
				>
					<p className="px-2 pb-1 text-meta text-ink-dim">
						{t("ui.settings.notifications.list.builtin")}
					</p>
					<div className="border-t border-hairline">
						{groups.builtin.map((sound) => (
							<SoundRow
								key={sound.id}
								sound={sound}
								isDefault={sound.is_default}
								preview={playing(sound.id)}
								onPreview={() => togglePreview(sound.id)}
							/>
						))}
						{groups.system && (
							<div className="border-t border-hairline">
								<SoundRow
									sound={{
										...groups.system,
										label: t("ui.settings.notifications.list.system_name"),
									}}
									isDefault={false}
									preview="idle"
									onPreview={() => {}}
									noPreview
									description={t(
										"ui.settings.notifications.list.system_description",
									)}
								/>
							</div>
						)}
					</div>

					<div className="flex items-baseline justify-between px-2 pt-5 pb-1">
						<p id={customSubheadId} className="text-meta text-ink-dim">
							{t("ui.settings.notifications.list.custom")}
						</p>
						{totalCustom > 0 && (
							<p className="font-mono text-mono-sm text-ink-dim">
								{t("ui.settings.notifications.list.custom_count", {
									count: totalCustom,
									max: limits.max_sounds,
								})}
							</p>
						)}
					</div>
					<div className="border-t border-hairline">
						{totalCustom === 0 && pending.length === 0 && (
							<p className={`${STATIC_ROW_CLASS} text-body-sm text-ink-muted`}>
								{t("ui.settings.notifications.custom.empty")}
							</p>
						)}
						{groups.custom.map((sound) => (
							<CustomSoundRow
								key={sound.id}
								sound={sound}
								selected={shown === sound.id}
								preview={playing(sound.id)}
								onPreview={() => togglePreview(sound.id)}
								mode={modeOf(sound.id)}
								maxNameChars={limits.max_name_chars}
								describedBy={customSubheadId}
								moreRef={moreRefFor(sound.id)}
								onStartRename={() =>
									setMode(sound.id, {
										kind: "renaming",
										saving: false,
										error: null,
									})
								}
								onRename={(name) => rename(sound, name)}
								onCancelRename={() => {
									setMode(sound.id, { kind: "idle" });
									setFocusTarget(sound.id);
								}}
								onStartRemove={() =>
									setMode(sound.id, {
										kind: "confirm-remove",
										removing: false,
										error: null,
									})
								}
								onConfirmRemove={() => void remove(sound)}
								onCancelRemove={() => {
									setMode(sound.id, { kind: "idle" });
									setFocusTarget(sound.id);
								}}
							/>
						))}
						{pending.map((row) => (
							<PendingRow
								key={row.key}
								row={row}
								percent={uploadPercent[row.key] ?? 0}
								limitSeconds={limits.max_duration_s}
								limitMegabytes={Math.round(limits.max_bytes / (1024 * 1024))}
								maxSounds={limits.max_sounds}
								onCancel={() => cancelUpload(row)}
								onDismiss={() => dropPending(row.key)}
								onChooseAnother={() => {
									dropPending(row.key);
									chooseAnother();
								}}
								onRetry={() => retryUpload(row)}
							/>
						))}
					</div>
				</RadioGroup>

				{saveError !== null && (
					<Alert variant="warning">
						<div className="flex flex-col items-start gap-3">
							<span>
								{t("ui.settings.notifications.save.failed", {
									reason: saveError,
								}).trim()}
							</span>
							{lastFailedChoice && (
								<Button
									variant="secondary"
									size="sm"
									onClick={() => {
										setPendingChoice(lastFailedChoice);
										void flushChoice(lastFailedChoice);
									}}
								>
									{t("ui.settings.notifications.retry")}
								</Button>
							)}
						</div>
					</Alert>
				)}

				<div className="flex flex-col items-start gap-2 px-2">
					<input
						ref={fileInput}
						type="file"
						multiple
						accept={ACCEPT}
						className="hidden"
						tabIndex={-1}
						aria-hidden="true"
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							event.target.value = "";
							startUploads(files);
						}}
					/>
					<Button
						ref={addRef}
						variant="secondary"
						size="sm"
						disabled={full}
						onClick={chooseAnother}
					>
						<Plus aria-hidden="true" />
						{t("ui.settings.notifications.custom.add")}
					</Button>
					<p className="text-body-sm text-ink-muted">
						{full
							? t("ui.settings.notifications.custom.full", {
									count: limits.max_sounds,
								})
							: t("ui.settings.notifications.custom.hint", {
									seconds: limits.max_duration_s,
									megabytes: Math.round(limits.max_bytes / (1024 * 1024)),
								})}
					</p>
				</div>

				<output aria-live="polite" className="sr-only">
					{announcement}
				</output>
			</div>
		);
	},
);
NotificationSoundList.displayName = "NotificationSoundList";

/**
 * The refusal sentence for one error key. Each key states only the facts its
 * own sentence uses (the typed `t()` rejects any other), so the switch is here
 * rather than in a cast.
 */
function uploadErrorSentence(
	key: ReturnType<typeof uploadErrorCopyKey>["key"],
	facts: {
		file: string;
		seconds: string;
		limitSeconds: number;
		megabytes: number;
		maxSounds: number;
	},
): string {
	switch (key) {
		case "ui.settings.notifications.error.too_large":
			return t(key, { file: facts.file, megabytes: facts.megabytes });
		case "ui.settings.notifications.error.too_long":
			return t(key, {
				file: facts.file,
				seconds: facts.seconds,
				limit: facts.limitSeconds,
			});
		case "ui.settings.notifications.custom.full":
			return t(key, { count: facts.maxSounds });
		case "ui.settings.notifications.error.unsupported_codec":
		case "ui.settings.notifications.error.unsupported_format":
		case "ui.settings.notifications.error.undecodable":
		case "ui.settings.notifications.error.network":
			return t(key, { file: facts.file });
		default:
			return t("ui.settings.notifications.error.network", { file: facts.file });
	}
}

/** Read a file, reporting the fraction read (the determinate upload phase). */
async function readWithProgress(
	file: File,
	onProgress: (fraction: number) => void,
): Promise<Uint8Array> {
	if (typeof FileReader === "undefined" || file.size === 0) {
		const buffer = await file.arrayBuffer();
		onProgress(1);
		return new Uint8Array(buffer);
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0)
				onProgress(event.loaded / event.total);
		};
		reader.onerror = () => reject(reader.error);
		reader.onload = () => {
			onProgress(1);
			resolve(new Uint8Array(reader.result as ArrayBuffer));
		};
		reader.readAsArrayBuffer(file);
	});
}

type PendingRowProps = {
	row: PendingUpload;
	percent: number;
	limitSeconds: number;
	limitMegabytes: number;
	maxSounds: number;
	onCancel: () => void;
	onDismiss: () => void;
	onChooseAnother: () => void;
	onRetry: () => void;
};

/**
 * A pending upload, at the height and position the sound will occupy (§5.1),
 * or the error row it turns into (§5.2). Not a radio: it cannot be selected.
 */
const PendingRow = ({
	row,
	percent,
	limitSeconds,
	limitMegabytes,
	maxSounds,
	onCancel,
	onDismiss,
	onChooseAnother,
	onRetry,
}: PendingRowProps) => {
	useI18nLocale();
	const file = row.file.name || row.stem;
	if (row.phase === "error") {
		const refusal = row.refusal ?? { code: null };
		const copy = uploadErrorCopyKey(refusal);
		const sentence = uploadErrorSentence(copy.key, {
			file,
			seconds: refusalSeconds(refusal, limitSeconds),
			limitSeconds,
			megabytes: limitMegabytes,
			maxSounds,
		});
		return (
			<div
				className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-2 py-1.5"
				data-pending-row={row.key}
				data-pending-phase="error"
			>
				<AlertCircle
					className="size-4 shrink-0 text-danger"
					aria-hidden="true"
				/>
				<output className="block min-w-0 flex-1 text-body-sm text-ink">
					{sentence}
				</output>
				{copy.action === "retry" ? (
					<Button variant="link" size="sm" onClick={onRetry}>
						{t("ui.settings.notifications.retry")}
					</Button>
				) : (
					<Button variant="link" size="sm" onClick={onChooseAnother}>
						{t("ui.settings.notifications.error.choose_another")}
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon"
					className="size-11 shrink-0 text-ink-muted hover:text-ink"
					aria-label={t("ui.settings.notifications.error.dismiss")}
					onClick={onDismiss}
				>
					<X aria-hidden="true" />
				</Button>
			</div>
		);
	}
	const processing = row.phase === "processing";
	return (
		<div
			className={STATIC_ROW_CLASS}
			data-pending-row={row.key}
			data-pending-phase={row.phase}
		>
			<span className="inline-flex size-4 shrink-0 items-center justify-center">
				<Spinner size="xs" />
			</span>
			<span
				className="min-w-0 flex-1 truncate text-body text-ink"
				title={row.stem}
			>
				{row.stem}
			</span>
			<span className="flex shrink-0 items-center gap-2 text-meta text-ink-muted">
				{processing
					? t("ui.settings.notifications.custom.processing")
					: t("ui.settings.notifications.custom.uploading", { percent })}
				<ProgressBar value={processing ? null : percent} />
			</span>
			<Button
				variant="ghost"
				size="icon"
				className="size-11 shrink-0 text-ink-muted hover:text-ink"
				aria-label={t("ui.settings.notifications.custom.cancel_upload", {
					file,
				})}
				onClick={onCancel}
			>
				<X aria-hidden="true" />
			</Button>
		</div>
	);
};

/** The 64px progress the duration slot holds while a file is on its way. */
const ProgressBar = ({ value }: { value: number | null }) => (
	<Progress value={value} className="w-16" aria-hidden="true" />
);
