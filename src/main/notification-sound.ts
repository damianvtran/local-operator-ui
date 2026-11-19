/**
 * The configured notification sound, for every banner this app raises.
 *
 * WHY ONE HELPER FOR FOUR SITES. The app raises banners from four places
 * (`desktop-notifier.ts`, `team-bridge-notifier.ts`,
 * `browser/consent-notifier.ts`, `update-service.ts`). The operator's setting
 * ("play the configured sound, soft pulse by default, or none") is one fact
 * about the machine, so each site asks this module for the `silent` / `sound`
 * pair it passes to `new Notification` instead of deciding it on its own. A
 * site that skipped the helper would play the OS default under a user who
 * turned sounds off.
 *
 * THE RULE, from the notification-sounds design (§4.1-4.3): the sound rides the
 * banner. Whoever raised the banner plays the sound, after banner arbitration
 * has already picked one surface per event, so there is no second arbitration
 * here. What is left is a machine-wide burst throttle shared with the TUI.
 *
 * PER PLATFORM:
 *  - macOS: the OS plays it. The backend renders the WAV with the volume baked
 *    in (`GET /v1/notification-sounds/{id}/audio?volume=`), this module stages
 *    it in `~/Library/Sounds` (one of the four places UNNotificationSound looks)
 *    and the banner carries `sound: <file name>`. Going through the OS is what
 *    honours Focus / Do Not Disturb and the per-app "play sound" switch, and it
 *    works with no window at all: on macOS the app stays alive in the Dock after
 *    its last window closes, and the main process has no audio output.
 *  - Windows / Linux, or macOS when staging failed: Electron's `sound` is
 *    macOS-only, so the banner goes out `silent: true` (or the OS adds its own
 *    chime on top) and the WAV bytes go over IPC to the renderer's
 *    `notification-sound-player`, which plays them on its OWN element. Without
 *    a window there is nothing to play them and the banner stays silent.
 *
 * SETTINGS, read exactly the way `display.notifications` is read
 * (`app-attention-service.ts`): `capabilities` + `settings.list` through the
 * desktop relay, re-read on backend-ready and on a `config` feed frame naming a
 * `notifications.sound.*` key, so a change in Settings applies to the next
 * banner. Nothing is read per banner: `new Notification` is synchronous at all
 * four sites, so the sound has to be staged before the banner exists.
 *
 * OLD BACKEND: no `features.notification_sounds` means nothing here changes
 * what a site asked for, which is today's behaviour (the OS default chime).
 * The same holds before the first read settles and when this module was never
 * configured (every unit test of the four sites).
 */
import { createHash } from "node:crypto";
import {
	closeSync,
	mkdirSync,
	openSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DesktopResponse } from "../shared/desktop-contract";
import type { DesktopMediaResponse } from "./desktop-media";

export { NOTIFICATION_SOUND_PLAY_CHANNEL } from "../shared/notification-sound";

/*
 * Mirrors of the backend's constants (`local_operator/notifications/sound.py`).
 * They are restated rather than fetched because each is a default for a
 * setting the backend could not answer, and a default has to exist before any
 * answer arrives.
 */
const SETTING_ENABLED = "notifications.sound.enabled";
const SETTING_ID = "notifications.sound.id";
const SETTING_VOLUME = "notifications.sound.volume";
const DEFAULT_SOUND_ID = "soft-pulse";
const DEFAULT_VOLUME = 70;
const SYSTEM_SOUND_ID = "system";
/** Rigs, CI and captures: the same switch the backend's player honours. */
const ENV_NO_SOUND = "LOCAL_OPERATOR_NO_SOUND";

/*
 * THE MACHINE-WIDE THROTTLE (design §4.3): at most one notification sound
 * every 1.5 s per user, across the TUI, the runtime and this app. The backend's
 * `claim_throttle` and this code read and touch the same file, so a TUI banner
 * and a desktop banner for two different events one second apart make one
 * sound, not two.
 */
const THROTTLE_MS = 1500;
const THROTTLE_FILE = join("run", "notification-sound.last");

/**
 * The staged file prefix. This module owns every `~/Library/Sounds` file that
 * starts with it and deletes the ones it no longer needs; it never touches a
 * file without it, because that directory is the user's.
 */
export const STAGED_PREFIX = "LocalOperator-";

/** What a site passes to `new Notification`, merged over its own options. */
export type NotificationSoundOptions = { silent: boolean; sound?: string };

/**
 * The plan the next banner follows, computed off the banner path.
 *
 * - `legacy`: the backend has no notification sounds (or has not answered).
 * - `silent`: the user turned sounds off (or volume 0, or the rig switch).
 * - `system`: the OS default chime, which is the `system` choice's meaning.
 * - `file`: lop's sound; `staged` is the macOS file name when staging worked.
 */
export type NotificationSoundPlan =
	| { kind: "legacy" }
	| { kind: "silent"; reason: string }
	| { kind: "system" }
	| {
			kind: "file";
			soundId: string;
			volume: number;
			bytes: Uint8Array;
			staged: string | null;
	  };

export type NotificationSoundDeps = {
	/** The desktop JSON relay (`backendService.requestDesktop`). */
	request: (input: unknown) => Promise<DesktopResponse>;
	/** The desktop media relay (`backendService.requestDesktopMedia`). */
	media: (input: unknown) => Promise<DesktopMediaResponse>;
	/** Hand the bytes to the renderer player; `false` when no window exists. */
	playInRenderer: (bytes: Uint8Array) => boolean;
	/** Diagnostics only; never user-visible. */
	log?: (line: string) => void;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	/** Where staged sounds go; `~/Library/Sounds` in production. */
	soundsDir?: string;
	now?: () => number;
};

function configDir(env: NodeJS.ProcessEnv): string {
	// Resolved per call, the way `viewer-record.ts` and `local-config.ts` do: the
	// backend resolves `LOCAL_OPERATOR_CONFIG_DIR` per call too.
	return env.LOCAL_OPERATOR_CONFIG_DIR || join(homedir(), ".local-operator");
}

function body(response: DesktopResponse): Record<string, unknown> | undefined {
	if (response.status !== 200 || !response.body) return;
	const result = (response.body as { result?: unknown }).result;
	return result && typeof result === "object"
		? (result as Record<string, unknown>)
		: undefined;
}

/**
 * The staged name for one rendering. Id, volume and a content hash are all in
 * it because macOS caches a sound by name: re-using one name for new bytes
 * (another volume, an edited custom sound) can keep playing the old ones.
 */
export function stagedSoundName(
	soundId: string,
	volume: number,
	bytes: Uint8Array,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const sha = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
	return `${stagedScopePrefix(env)}${soundId}-${volume}-${sha}.wav`;
}

/**
 * `LocalOperator-<cfg8>-`: the prefix for THIS config dir's stagings.
 *
 * ~/Library/Sounds is one folder per user, but several app instances can run
 * against different config dirs (a dev build beside the installed app, a QA
 * rig). Each prunes what it no longer needs; without the scope one instance's
 * prune deleted the file the other's next banner names, and that banner got
 * the OS default instead. Each instance therefore owns only its own scope.
 */
export function stagedScopePrefix(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const scope = createHash("sha256")
		.update(configDir(env))
		.digest("hex")
		.slice(0, 8);
	return `${STAGED_PREFIX}${scope}-`;
}

/**
 * The largest notification sound this app will hold, stage or send over IPC.
 * Core caps a custom sound at 10 s, and a 10 s 48 kHz 16-bit stereo WAV is
 * ~1.9 MB, so 4 MB is headroom rather than a limit anyone meets; it bounds
 * the buffer the renderer fallback copies on every banner.
 */
export const MAX_NOTIFICATION_SOUND_BYTES = 4 * 1024 * 1024;

export class NotificationSoundService {
	private plan: NotificationSoundPlan = { kind: "legacy" };
	/**
	 * Whether any read has completed from real answers. Until one has, every
	 * banner kicks a read (see `bannerOptions`), so the window in which a banner
	 * can only follow `legacy` is as short as the backend allows.
	 */
	private settled = false;
	private inFlight: Promise<void> | null = null;
	/** Bumped by every refresh, so a slow older read cannot overwrite a newer one. */
	private generation = 0;
	private readonly platform: NodeJS.Platform;
	private readonly env: NodeJS.ProcessEnv;
	private readonly soundsDir: string;
	private readonly now: () => number;

	constructor(private readonly deps: NotificationSoundDeps) {
		this.platform = deps.platform ?? process.platform;
		this.env = deps.env ?? process.env;
		this.soundsDir = deps.soundsDir ?? join(homedir(), "Library", "Sounds");
		this.now = deps.now ?? Date.now;
	}

	/** The current plan; read by the probe and the tests, never by a site. */
	current(): NotificationSoundPlan {
		return this.plan;
	}

	/**
	 * Re-read the capability and the three settings, then fetch and stage the
	 * sound. Never throws: a sound is a convenience.
	 *
	 * ANY UNANSWERED READ KEEPS THE LAST PLAN (review round 1 M1, QA Q1). These
	 * reads run on every backend-ready, which is exactly when a restarting
	 * backend answers 0/503/504. Reading such an answer as "no settings" fell
	 * through to the defaults and played soft-pulse for a user who had turned
	 * sounds off; reading it as "no capability" played the OS chime. Only a
	 * capabilities answer that is a 200 WITHOUT the flag means an older backend.
	 */
	refresh(): Promise<void> {
		const run = this.read().finally(() => {
			if (this.inFlight === run) this.inFlight = null;
		});
		this.inFlight = run;
		return run;
	}

	private keep(what: string, status: number): void {
		this.deps.log?.(
			`[notification-sound] ${what} unanswered (status ${status}); keeping ${this.plan.kind}`,
		);
	}

	private async read(): Promise<void> {
		const generation = ++this.generation;
		const stale = () => generation !== this.generation;
		try {
			const capabilitiesResponse = await this.deps.request({
				op: "capabilities",
			});
			if (stale()) return;
			const capabilities = body(capabilitiesResponse);
			if (!capabilities)
				return this.keep("capabilities", capabilitiesResponse.status);
			const features = capabilities.features as
				| Record<string, unknown>
				| undefined;
			if (Number(features?.notification_sounds ?? 0) < 1) {
				this.plan = { kind: "legacy" };
				this.settled = true;
				return;
			}
			const listingResponse = await this.deps.request({ op: "settings.list" });
			if (stale()) return;
			const listing = body(listingResponse);
			if (!Array.isArray(listing?.settings))
				return this.keep("settings.list", listingResponse.status);
			const rows = listing.settings as Array<{
				key?: unknown;
				value?: unknown;
			}>;
			const value = (key: string) =>
				rows.find((row) => row?.key === key)?.value;
			const enabled = value(SETTING_ENABLED);
			const rawId = value(SETTING_ID);
			const rawVolume = value(SETTING_VOLUME);
			const soundId =
				typeof rawId === "string" && rawId ? rawId : DEFAULT_SOUND_ID;
			// Rounded rather than refused: core's `gain()` takes a hand-edited
			// 70.5 as-is, so the desktop must not fall back to 70 where the TUI
			// plays 70.5. The audio route takes an int, hence the rounding.
			const volume =
				typeof rawVolume === "number" && Number.isFinite(rawVolume)
					? Math.min(100, Math.max(0, Math.round(rawVolume)))
					: DEFAULT_VOLUME;
			if (this.env[ENV_NO_SOUND]) {
				this.plan = { kind: "silent", reason: `${ENV_NO_SOUND} is set` };
				this.settled = true;
				return;
			}
			// Only a real `false` turns sound off, matching the backend's
			// `resolve()`: a hand-written "no" must not silently mean off.
			if (enabled === false) {
				this.plan = { kind: "silent", reason: `${SETTING_ENABLED} is off` };
				this.settled = true;
				return;
			}
			if (soundId === SYSTEM_SOUND_ID) {
				this.plan = { kind: "system" };
				this.settled = true;
				return;
			}
			if (volume === 0) {
				this.plan = { kind: "silent", reason: `${SETTING_VOLUME} is 0` };
				this.settled = true;
				return;
			}
			let resolvedId = soundId;
			let audio = await this.fetchAudio(resolvedId, volume);
			if (stale()) return;
			/*
			 * AN ID THAT NAMES NOTHING FALLS BACK TO THE DEFAULT (review m1), as
			 * core's `resolve()` does: a hand-edited "Soft Pulse" (refused by the
			 * relay's id check, 422) or a deleted custom sound (404) still means
			 * "play a sound", and going quiet or playing the OS chime instead is the
			 * worse failure. Only those two answers mean "no such sound"; anything
			 * else is transient and keeps the last plan below.
			 */
			if (
				audio.kind !== "bytes" &&
				(audio.status === 404 || audio.status === 422) &&
				resolvedId !== DEFAULT_SOUND_ID
			) {
				this.deps.log?.(
					`[notification-sound] ${resolvedId} not found (status ${audio.status}); using ${DEFAULT_SOUND_ID}`,
				);
				resolvedId = DEFAULT_SOUND_ID;
				audio = await this.fetchAudio(resolvedId, volume);
				if (stale()) return;
			}
			if (
				audio.kind !== "bytes" ||
				!audio.mimeType.toLowerCase().startsWith("audio/wav") ||
				audio.data.byteLength === 0 ||
				audio.data.byteLength > MAX_NOTIFICATION_SOUND_BYTES
			) {
				// Keep the previous plan: a transient render failure must not turn a
				// working sound into silence or into the OS chime.
				this.deps.log?.(
					`[notification-sound] audio for ${resolvedId} unavailable (status ${audio.status}); keeping ${this.plan.kind}`,
				);
				return;
			}
			const staged =
				this.platform === "darwin"
					? this.stage(resolvedId, volume, audio.data)
					: null;
			this.plan = {
				kind: "file",
				soundId: resolvedId,
				volume,
				bytes: audio.data,
				staged,
			};
			this.settled = true;
			this.deps.log?.(
				`[notification-sound] ready id=${resolvedId} volume=${volume} bytes=${audio.data.byteLength} staged=${staged ?? "none"}`,
			);
		} catch (error) {
			this.deps.log?.(`[notification-sound] refresh failed: ${String(error)}`);
		}
	}

	private fetchAudio(
		soundId: string,
		volume: number,
	): Promise<DesktopMediaResponse> {
		return this.deps.media({
			op: "notification_sounds.audio",
			soundId,
			volume,
		});
	}

	/**
	 * A `config` feed frame: re-read only when a sound setting changed.
	 *
	 * The live feed names TOP-LEVEL config keys (core `desktop_feed.py` diffs
	 * the top level), so a PATCH of `notifications.sound.volume` arrives as
	 * `["notifications"]` (captured from `/v1/desktop/events`, QA round 1 Q2).
	 * The dotted spellings are accepted too, so a feed that one day names
	 * registry keys keeps working.
	 */
	observeConfigChange(changedKeys: readonly string[]): void {
		if (
			changedKeys.some(
				(key) => key === "notifications" || key.startsWith("notifications."),
			)
		)
			void this.refresh();
	}

	/**
	 * Write the WAV into `~/Library/Sounds` and prune older stagings. Returns the
	 * file name the banner's `sound` carries, or `null` (the renderer fallback).
	 *
	 * Written to a temporary name and renamed, so the OS never opens a
	 * half-written file under the name a banner points at.
	 */
	private stage(
		soundId: string,
		volume: number,
		bytes: Uint8Array,
	): string | null {
		const name = stagedSoundName(soundId, volume, bytes, this.env);
		const scope = stagedScopePrefix(this.env);
		try {
			mkdirSync(this.soundsDir, { recursive: true });
			const target = join(this.soundsDir, name);
			const temporary = join(this.soundsDir, `.${name}.${process.pid}.tmp`);
			writeFileSync(temporary, bytes);
			renameSync(temporary, target);
		} catch (error) {
			this.deps.log?.(
				`[notification-sound] staging ${name} failed: ${String(error)}`,
			);
			return null;
		}
		try {
			for (const entry of readdirSync(this.soundsDir)) {
				// Older stagings of THIS scope, plus `.tmp` leftovers of a write a
				// crash interrupted before its rename (review n1). Never another
				// scope's file, never anything without the prefix.
				const stale =
					(entry !== name &&
						entry.startsWith(scope) &&
						entry.endsWith(".wav")) ||
					(entry.startsWith(`.${scope}`) && entry.endsWith(".tmp"));
				if (stale) unlinkSync(join(this.soundsDir, entry));
			}
		} catch {
			// A stale file left behind costs disk, not a sound; the next stage retries.
		}
		return name;
	}

	/**
	 * The machine-wide sound slot, in two steps: `throttled()` reads it and
	 * `takeSlot()` touches it. A `stat` and then a touch, NOT atomic, on purpose
	 * (the backend's `claim_throttle` says why): a lost race costs one extra
	 * chime, and a lock could lose a sound to a stale lock. Split so the
	 * renderer fallback takes the slot only once a window accepted the sound
	 * (QA round 1 Q3b): no window means no sound, and no sound must not silence
	 * the TUI for 1.5 s. Fails OPEN when the run dir cannot be written, because
	 * a tidiness rule must not become silence.
	 */
	private throttled(): boolean {
		const path = join(configDir(this.env), THROTTLE_FILE);
		try {
			const age = this.now() - statSync(path).mtimeMs;
			return age >= 0 && age < THROTTLE_MS;
		} catch {
			// No file yet: nobody has played a sound.
			return false;
		}
	}

	private takeSlot(): void {
		const path = join(configDir(this.env), THROTTLE_FILE);
		const stamp = this.now();
		try {
			mkdirSync(join(configDir(this.env), "run"), { recursive: true });
			closeSync(openSync(path, "a"));
			utimesSync(path, stamp / 1000, stamp / 1000);
		} catch {
			// Fail open; see above.
		}
	}

	/**
	 * The `silent` / `sound` options for a banner about to be shown. Call it
	 * IMMEDIATELY before `new Notification` and show that banner: on the
	 * fallback path it also starts the renderer sound, and it takes the
	 * throttle slot.
	 *
	 * `silent` is the site's own request. A site asking for silence (Team
	 * Bridge's coalesced replacement banner) always gets it and spends no slot.
	 */
	bannerOptions(silent = false): NotificationSoundOptions {
		/*
		 * NO PLAN YET: kick a read, and follow `legacy` for THIS banner (review
		 * m2). The banner cannot wait for that read: all four sites construct
		 * their `Notification` synchronously (`show()` in the desktop notifier,
		 * `announce()` in consent, the update hold's promise executor, Team
		 * Bridge after its own image deadline), and making them async would
		 * reorder the lifetime/click wiring each one documents. `legacy` is the
		 * conservative answer: it is exactly what this app did before sounds
		 * were configurable, and what an older backend still gets.
		 */
		if (!this.settled && !this.inFlight) void this.refresh();
		if (silent) return { silent: true };
		const plan = this.plan;
		switch (plan.kind) {
			case "legacy":
			case "system":
				/*
				 * The OS default chime: today's behaviour, and `system`'s meaning.
				 * It is a sound too, so it spends the machine-wide slot like any
				 * other (design §4.3 "every player", QA round 1 Q3a): inside the
				 * window the banner goes out silent.
				 */
				if (this.throttled()) return { silent: true };
				this.takeSlot();
				return { silent: false };
			case "silent":
				return { silent: true };
			case "file": {
				if (this.throttled()) return { silent: true };
				/*
				 * The FULL file name, extension included. Electron 45 hands this
				 * string to `[UNNotificationSound soundNamed:]`
				 * (shell/browser/notifications/mac/cocoa_notification.mm), whose
				 * contract is "the name of the sound file", and the lookup matches a
				 * file in ~/Library/Sounds by that name. The extension-less form is
				 * the older NSSound convention, which this API does not use.
				 */
				if (plan.staged) {
					this.takeSlot();
					return { silent: false, sound: plan.staged };
				}
				// `silent: true` either way: with no window to play it the user who
				// picked a sound gets none, never the OS chime in its place.
				if (this.deps.playInRenderer(plan.bytes)) this.takeSlot();
				return { silent: true };
			}
		}
	}
}

/*
 * The process-wide instance, configured once by `index.ts`. A module value
 * rather than a constructor argument threaded into four owners, because three
 * of the four sites (consent, update, Team Bridge) are built far from where the
 * backend relay exists, and each only needs one synchronous answer.
 */
let service: NotificationSoundService | null = null;

export function configureNotificationSound(
	deps: NotificationSoundDeps | null,
): NotificationSoundService | null {
	service = deps ? new NotificationSoundService(deps) : null;
	return service;
}

/** The options for the next banner; today's behaviour when unconfigured. */
export function notificationSoundOptions(
	silent = false,
): NotificationSoundOptions {
	return service ? service.bannerOptions(silent) : { silent };
}
