/**
 * Settings -> Notifications -> Sound: the group's decisions, kept out of the
 * render (the `speech-settings-model.ts` pattern).
 *
 * WHY THIS IS ITS OWN MODULE. Every judgement the screen makes that a reviewer
 * has to be able to read, and a test has to be able to bind without a DOM,
 * lives here: which registry rows the group owns, how the daemon's listing is
 * read, which sentence a refused upload earns, what the volume readout says,
 * which icon the volume shows, and where focus lands after a removal. The
 * components are thin projections of these.
 *
 * THE CONTRACT IS THE DAEMON'S (core `server/routes/notification_sounds.py`,
 * `features.notification_sounds`):
 *
 *  - `GET /v1/notification-sounds` -> `{sounds:[{id,label,builtin,duration_s,
 *    is_default}], selected, enabled, volume, limits}`. Built-in labels arrive
 *    localized; custom labels are the user's own text and are never translated.
 *    `system` is a row with `duration_s: null` (it has no audio).
 *  - Selection, volume and on/off are NOT written through those routes: they
 *    are the registry keys below, written with `settings.edit` / `settings.reset`
 *    like every other row (one write funnel, design §3.4).
 *
 * Settings spec: notif-sounds-settings-spec.md (designer, 2026-11-03), §11
 * build map. Section numbers in comments below refer to it.
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import type { MessageKey } from "@shared/i18n";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** The master switch the Sound group depends on (promoted here, §2.1). */
export const NOTIFICATIONS_ENABLED_KEY = "display.notifications";
/** The second promoted master row: whether a banner names its session. */
export const NOTIFICATION_SESSION_NAME_KEY =
	"display.notification_session_name";

/** The three sound keys, in the daemon's registry order. */
export const NOTIFICATION_SOUND_KEYS = [
	"notifications.sound.enabled",
	"notifications.sound.id",
	"notifications.sound.volume",
] as const;

export type NotificationSoundKey = (typeof NOTIFICATION_SOUND_KEYS)[number];

/** Every registry key this section renders, so Backend settings can hide them. */
export const NOTIFICATIONS_SECTION_KEYS: readonly string[] = [
	NOTIFICATIONS_ENABLED_KEY,
	NOTIFICATION_SESSION_NAME_KEY,
	...NOTIFICATION_SOUND_KEYS,
];

/**
 * The engine owner every preview in the group plays under.
 *
 * ONE owner for the whole group (§3.3): the shared engine stops whatever played
 * before on every `play()`, so a second preview stops the first without this
 * group tracking it. The group keeps the playing sound's id beside it to know
 * which row shows Stop.
 */
export const PREVIEW_OWNER_ID = "notification-sound-preview";

/** The id that means "lop plays nothing; the OS or terminal default plays". */
export const SYSTEM_SOUND_ID = "system";

/** The selection the daemon falls back to when the selected custom sound goes. */
export const DEFAULT_SOUND_ID = "soft-pulse";

/** The registry default for the volume, used when the row carries none. */
export const DEFAULT_VOLUME = 70;

/**
 * The slider's step for pointer and arrow keys (§4.2): 21 positions is plenty,
 * and the readout stays a round number.
 */
export const VOLUME_STEP = 5;
/** PageUp / PageDown travel (§4.2). */
export const VOLUME_PAGE_STEP = 20;

/** Debounce between the last selection change and its write (§3.2, C5). */
export const SELECTION_WRITE_DEBOUNCE_MS = 400;

/**
 * The daemon's limits, used only when the listing omits them (an older #3403
 * build). The listing's own `limits` always wins: these mirror
 * `custom_sounds.MAX_*` and exist so a missing field cannot disable Add.
 */
export const FALLBACK_LIMITS = {
	max_sounds: 50,
	max_bytes: 10 * 1024 * 1024,
	max_duration_s: 10,
	max_name_chars: 40,
} as const;

export type NotificationSoundLimits = {
	max_sounds: number;
	max_bytes: number;
	max_duration_s: number;
	max_name_chars: number;
};

export type NotificationSound = {
	id: string;
	label: string;
	builtin: boolean;
	duration_s: number | null;
	is_default: boolean;
};

export type NotificationSoundListing = {
	sounds: NotificationSound[];
	selected: string;
	enabled: boolean;
	volume: number;
	limits: NotificationSoundLimits;
};

/** The listing, split the way the list renders it (§3.1 order). */
export type NotificationSoundGroups = {
	/** Built-ins in the daemon's registry order (Soft pulse first). */
	builtin: NotificationSound[];
	/** The `system` row, when the daemon lists one. */
	system: NotificationSound | null;
	/** Custom sounds, oldest first (the daemon's index order). */
	custom: NotificationSound[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The listing, or `null` when the payload is not one.
 *
 * VALIDATED BEFORE IT IS BELIEVED, as Speech validates its report:
 * `desktopResult` casts, so a 200 of another shape would otherwise reach the
 * render as a `TypeError`. A row missing an id or label is dropped rather than
 * failing the whole listing, because one bad index entry must not hide the ten
 * sounds that are fine.
 */
export function parseNotificationSoundListing(
	payload: unknown,
): NotificationSoundListing | null {
	if (!isObject(payload) || !Array.isArray(payload.sounds)) return null;
	const sounds: NotificationSound[] = [];
	for (const raw of payload.sounds) {
		if (!isObject(raw)) continue;
		if (typeof raw.id !== "string" || !raw.id) continue;
		sounds.push({
			id: raw.id,
			label: typeof raw.label === "string" && raw.label ? raw.label : raw.id,
			builtin: raw.builtin === true,
			duration_s:
				typeof raw.duration_s === "number" && Number.isFinite(raw.duration_s)
					? raw.duration_s
					: null,
			is_default: raw.is_default === true,
		});
	}
	const limitsRaw = isObject(payload.limits) ? payload.limits : {};
	const limit = (key: keyof NotificationSoundLimits): number => {
		const value = limitsRaw[key];
		return typeof value === "number" && Number.isFinite(value) && value > 0
			? value
			: FALLBACK_LIMITS[key];
	};
	return {
		sounds,
		selected:
			typeof payload.selected === "string"
				? payload.selected
				: DEFAULT_SOUND_ID,
		enabled: payload.enabled !== false,
		volume:
			typeof payload.volume === "number" && Number.isFinite(payload.volume)
				? payload.volume
				: DEFAULT_VOLUME,
		limits: {
			max_sounds: limit("max_sounds"),
			max_bytes: limit("max_bytes"),
			max_duration_s: limit("max_duration_s"),
			max_name_chars: limit("max_name_chars"),
		},
	};
}

/** Split the listing into the three blocks the list renders, in order. */
export function groupNotificationSounds(
	sounds: readonly NotificationSound[],
): NotificationSoundGroups {
	const builtin: NotificationSound[] = [];
	const custom: NotificationSound[] = [];
	let system: NotificationSound | null = null;
	for (const sound of sounds) {
		if (sound.id === SYSTEM_SOUND_ID) system = sound;
		else if (sound.builtin) builtin.push(sound);
		else custom.push(sound);
	}
	return { builtin, system, custom };
}

export type NotificationSoundRows = {
	/** The registry rows for the three sound keys, by key. */
	byKey: Partial<Record<NotificationSoundKey, BackendSetting>>;
	/**
	 * Sound keys the registry did not carry at all. Reported rather than
	 * ignored (the `speechVoiceRows` rule): a group that silently drops a row
	 * reads as complete when it is not.
	 */
	missing: NotificationSoundKey[];
};

/** The group's rows, selected from the registry by key. */
export function notificationSoundRows(
	settings: readonly BackendSetting[],
): NotificationSoundRows {
	const index = new Map(settings.map((setting) => [setting.key, setting]));
	const byKey: NotificationSoundRows["byKey"] = {};
	const missing: NotificationSoundKey[] = [];
	for (const key of NOTIFICATION_SOUND_KEYS) {
		const row = index.get(key);
		if (row) byKey[key] = row;
		else missing.push(key);
	}
	return { byKey, missing };
}

/* ------------------------------------------------------------------ volume */

/** The readout beside the slider (§4.1): `70% · Default` or `45%`. */
export function volumeReadout(
	value: number,
	defaultValue: number,
): {
	key:
		| "ui.settings.notifications.volume.readout"
		| "ui.settings.notifications.volume.readout_default";
	value: number;
} {
	const rounded = Math.round(value);
	return {
		key:
			rounded === Math.round(defaultValue)
				? "ui.settings.notifications.volume.readout_default"
				: "ui.settings.notifications.volume.readout",
		value: rounded,
	};
}

/**
 * The volume's leading icon (§4.2). An INDICATOR, never a mute button (C3):
 * the thresholds are `audio-attachment.tsx`'s, so the two speakers in the app
 * read the same.
 */
export function volumeIcon(value: number): LucideIcon {
	if (value <= 0) return VolumeX;
	if (value < 50) return Volume1;
	return Volume2;
}

/**
 * Which description the slider carries (§4.2): the System sound has no volume
 * lop controls, 0 is a stated mute, otherwise the release-to-preview hint.
 */
export function volumeDescriptionKey(
	value: number,
	selectedId: string,
):
	| "ui.settings.notifications.volume.system"
	| "ui.settings.notifications.volume.muted"
	| "ui.settings.notifications.volume.description" {
	if (selectedId === SYSTEM_SOUND_ID)
		return "ui.settings.notifications.volume.system";
	if (value <= 0) return "ui.settings.notifications.volume.muted";
	return "ui.settings.notifications.volume.description";
}

/** `0:02` for a custom row's duration slot (§3.1). Never under one second. */
export function formatSoundDuration(seconds: number | null): string | null {
	if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
	const whole = Math.max(1, Math.round(seconds));
	const minutes = Math.floor(whole / 60);
	const rest = whole % 60;
	return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/* ----------------------------------------------------------------- uploads */

/** What an upload refusal looks like once it reached the renderer. */
export type UploadRefusal = {
	/** The daemon's machine code, or `null` for a transport/unknown failure. */
	code: string | null;
	params?: Record<string, unknown>;
};

/** The copy a refused upload row shows, and whether it offers Retry (§5.2). */
export type UploadErrorCopy = {
	key: MessageKey;
	/** `network` offers Retry; every refusal of the FILE offers another file. */
	action: "retry" | "choose_another";
};

/** Codecs the daemon names in `params.format` that have their own sentence. */
const UNREADABLE_CODECS = new Set(["opus", "m4a", "aac"]);

/**
 * The client-side sentence for an upload refusal, keyed by `code` (§5.2).
 *
 * The client never parses the server's `text`: these are the fallbacks keyed by
 * code, so a reworded server sentence cannot change which remedy is offered.
 * `silent` and `invalid_name` are #3403 codes the spec's table predates; they
 * read as "this file cannot be used" (`undecodable`) because the remedy is the
 * same one: choose another file.
 */
export function uploadErrorCopyKey(refusal: UploadRefusal): UploadErrorCopy {
	switch (refusal.code) {
		case "too_large":
			return {
				key: "ui.settings.notifications.error.too_large",
				action: "choose_another",
			};
		case "unsupported_format": {
			const format = refusal.params?.format;
			return {
				key:
					typeof format === "string" && UNREADABLE_CODECS.has(format)
						? "ui.settings.notifications.error.unsupported_codec"
						: "ui.settings.notifications.error.unsupported_format",
				action: "choose_another",
			};
		}
		case "too_long":
			return {
				key: "ui.settings.notifications.error.too_long",
				action: "choose_another",
			};
		case "undecodable":
		case "silent":
		case "invalid_name":
			return {
				key: "ui.settings.notifications.error.undecodable",
				action: "choose_another",
			};
		case "limit_reached":
			return {
				key: "ui.settings.notifications.custom.full",
				action: "choose_another",
			};
		default:
			return {
				key: "ui.settings.notifications.error.network",
				action: "retry",
			};
	}
}

/**
 * The seconds a `too_long` refusal names, formatted for the sentence.
 *
 * The daemon puts the measured length in `params.seconds` (one decimal); a
 * missing value falls back to the limit itself, which keeps the sentence true
 * ("is over 10 seconds" is what the reader needs either way).
 */
export function refusalSeconds(
	refusal: UploadRefusal,
	limitSeconds: number,
): string {
	const raw = refusal.params?.seconds;
	if (typeof raw === "string" && raw.trim()) return raw;
	if (typeof raw === "number" && Number.isFinite(raw)) return raw.toFixed(1);
	return String(limitSeconds);
}

/** Either path separator: a picked file's name never carries one, a dropped path might. */
const PATH_SEPARATOR = /[\\/]/;

/** The display name an added file gets: its stem, cut to the name limit. */
export function fileStem(fileName: string, maxChars: number): string {
	const base = fileName.split(PATH_SEPARATOR).pop() ?? fileName;
	const dot = base.lastIndexOf(".");
	const stem = (dot > 0 ? base.slice(0, dot) : base).trim() || base;
	return Array.from(stem).slice(0, maxChars).join("");
}

/**
 * Split a batch of chosen files into the ones that get a request and the ones
 * refused locally with `limit_reached` (§5.1): files beyond the remaining slots
 * never cost a request.
 */
export function partitionBySlots<T>(
	files: readonly T[],
	customCount: number,
	maxSounds: number,
): { accepted: T[]; overLimit: T[] } {
	const slots = Math.max(0, maxSounds - customCount);
	return { accepted: files.slice(0, slots), overLimit: files.slice(slots) };
}

/* ----------------------------------------------------------------- rename */

/** Inline validation for a rename (§5.3); `null` when the name is fine. */
export function renameError(
	name: string,
	maxChars: number,
):
	| "ui.settings.notifications.custom.rename_empty"
	| "ui.settings.notifications.custom.rename_long"
	| null {
	const trimmed = name.trim();
	if (!trimmed) return "ui.settings.notifications.custom.rename_empty";
	if (Array.from(trimmed).length > maxChars)
		return "ui.settings.notifications.custom.rename_long";
	return null;
}

/* ----------------------------------------------------------------- remove */

/**
 * Where focus goes after a custom sound is removed (§5.4): the next custom
 * row's More button, else the previous one's, else Add sound.
 *
 * Returns the id of the row whose More button takes focus, or `null` for Add.
 */
export function nextFocusAfterRemove(
	customIds: readonly string[],
	removedId: string,
): string | null {
	const index = customIds.indexOf(removedId);
	if (index < 0) return null;
	return customIds[index + 1] ?? customIds[index - 1] ?? null;
}
