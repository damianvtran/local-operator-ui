/**
 * The renderer's notification-sound player: main's fallback when the OS cannot
 * play the banner sound itself (Windows and Linux, where Electron's `sound`
 * option does not exist, or macOS when staging into ~/Library/Sounds failed).
 * Main sends the backend's gain-baked WAV over `notification-sound:play`
 * (`main/notification-sound.ts`); the banner itself went out `silent: true`.
 *
 * ITS OWN ELEMENT, NEVER THE SHARED AUDIO ENGINE. `audio-engine-store.ts` is
 * exclusive by design: starting a sound there stops whatever is playing. A
 * notification that arrived while the user listened to a generated sound or a
 * read-aloud reply would cut that off. One element per chime, dropped when it
 * ends, keeps the two independent; they simply mix.
 *
 * NO VOLUME HERE. The bytes already carry the configured volume (the backend
 * renders them with the notification gain curve), so the element plays at 1.0
 * and a 70 here sounds like a 70 from the TUI.
 *
 * AUDIO-SAFETY SEAM, the same rule the audio engine states: a test or rig must
 * never reach the operator's speakers. `createElement` lets a suite inject a
 * fake element, and `route` lets a rig send a real element through a zero-gain
 * graph. `muted` / `volume = 0` would only prove an attribute, so neither is
 * offered as the control.
 */

export type NotificationSoundPlayerOptions = {
	/** Test seam: a fake element. Production builds `new Audio()`. */
	createElement?: () => HTMLAudioElement;
	/** Rig seam: route the element (zero-gain graph) before it plays. */
	route?: (element: HTMLAudioElement) => void;
	/** Test seam for the object-URL lifetime. */
	urls?: {
		create: (blob: Blob) => string;
		revoke: (url: string) => void;
	};
};

/**
 * Play one notification sound. Resolves `true` once playback started and
 * `false` when the element refused (autoplay policy, a decode error). Never
 * rejects: a missing chime must never surface as an error in the app.
 */
export async function playNotificationSound(
	bytes: Uint8Array,
	options: NotificationSoundPlayerOptions = {},
): Promise<boolean> {
	const urls = options.urls ?? {
		create: (blob: Blob) => URL.createObjectURL(blob),
		revoke: (url: string) => URL.revokeObjectURL(url),
	};
	// A copy into a fresh ArrayBuffer: `Blob` takes no view of shared memory,
	// and the IPC buffer is not ours to keep alive.
	const url = urls.create(
		new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
	);
	const element = options.createElement ? options.createElement() : new Audio();
	let released = false;
	// This player owns the URL it created, so it alone revokes it, once, when
	// the chime ends or fails.
	const release = () => {
		if (released) return;
		released = true;
		element.removeAttribute("src");
		urls.revoke(url);
	};
	element.addEventListener("ended", release, { once: true });
	element.addEventListener("error", release, { once: true });
	options.route?.(element);
	element.src = url;
	try {
		await element.play();
		return true;
	} catch {
		release();
		return false;
	}
}

/**
 * Subscribe to main's play requests, returning the unsubscribe. A no-op outside
 * Electron (Storybook, browser development) where no preload exists.
 */
export function installNotificationSoundPlayer(
	options: NotificationSoundPlayerOptions = {},
): () => void {
	const subscribe = window.api?.onNotificationSound;
	if (typeof subscribe !== "function") return () => {};
	return subscribe((bytes) => {
		void playNotificationSound(bytes, options);
	});
}
