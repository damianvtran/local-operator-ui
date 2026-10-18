/**
 * The one audio engine: a single `HTMLAudioElement` the whole app shares.
 *
 * WHY A STORE AND NOT A COMPONENT. Generated sound arrives in three surfaces the
 * reader meets in one conversation — the transcript card, the Canvas Files
 * "Sounds" band, and the message's legacy attachment — and each surface used to
 * own its own element (the legacy attachment built one per mount; the speech
 * store built one per press). Two elements means two sounds can play at once,
 * and a transcript re-render (a token flush, a scroll window shifting) remounts
 * rows and takes their elements with them. One element behind one store fixes
 * both by construction: starting a sound is a state transition, so a second
 * press anywhere stops the first (exclusivity), and playback lives in module
 * state rather than in a component's cell, so it survives any re-render.
 *
 * THE GENERATION COUNTER IS THE PRESS ORDER, the same rule the speech store
 * documents: `play()` increments `generation`, and a start whose generation is
 * stale when `play()` resolves returns without touching the shared element the
 * reader has since redirected. It is re-read after the await because `play()`
 * is the last await before this press would own the element.
 *
 * WHAT THE ENGINE OWNS, AND WHAT IT DOES NOT OWN. The engine owns the element,
 * its src, and the playing/paused/ended/error status. It does NOT create or
 * revoke object URLs: a URL's lifetime belongs to whoever created it (the
 * speech store's cache revokes on stop/end/error; the attachment resolver's
 * blob-url cache has its own refcounted discipline), and a second owner of that
 * lifetime is how a still-showing widget's URL gets revoked under it. `stop()`
 * therefore detaches the source (`removeAttribute("src")` + `load()`) so the
 * element cannot re-fetch a URL the caller is about to revoke, and stops there.
 *
 * `currentTime` IS MIRRORED, NOT DRIVEN. `timeupdate` (~4 Hz) updates the store
 * for any consumer that wants a plain value, but the SOUND PLAYER's label and
 * waveform do not read it: they run a rAF against {@link AudioEngineActions.clock}
 * while they are the active widget, which is the one path that needs per-frame
 * freshness and must not re-render React to get it.
 *
 * VOLUME AND RATE LIVE HERE too, because there is one element to carry them: a
 * widget that mutates its own element's volume would be inaudible the moment
 * playback moved to the shared one.
 *
 * AUDIO-SAFETY SEAM, for every test and capture rig in this repository. A
 * process that drives the REAL element must never be able to reach the
 * operator's speakers: `installAudioOutputGraph` lets a rig route the element
 * through a zero-gain graph (`MediaElementAudioSourceNode -> GainNode(0) ->
 * destination`) so playback state (currentTime, fill, ended) can be exercised
 * for real while the device hears nothing. Production installs no graph and the
 * element plays normally at gain 1.0. Muting an element with `muted` or
 * `volume = 0` is NOT equivalent and is not accepted: it proves an attribute,
 * not an absence of sound, if anything downstream ignores it. The test suites
 * today go further and inject a fake element (a `globalThis.Audio` stub
 * installed before this module loads), so no suite has a device path at all;
 * `scripts/audio-engine.test.mjs`'s guard fails any suite that drives this
 * engine without one of the two.
 */

import { create } from "zustand";

/** What the shared element is doing, from the one widget's point of view. */
export type AudioEngineStatus =
	| "idle"
	| "loading"
	| "playing"
	| "paused"
	| "ended"
	| "error";

/**
 * The callbacks an activation may hand the engine. They are invoked only while
 * THAT activation still owns the element, so a superseded press can never clear
 * a newer surface's state (the speech store's own failure class).
 */
export type AudioEngineHandlers = {
	onEnded?: () => void;
	onError?: () => void;
};

/**
 * `fastSeek` is Chromium's scrub primitive (the app ships only Chromium): it
 * jumps to the nearest decodable frame without the full seek pipeline, which is
 * what makes a drag's per-frame updates cheap. It is optional here because the
 * DOM type still marks it experimental and the node tests stub a plain element.
 */
type ScrubbableAudio = HTMLAudioElement & {
	fastSeek?: (time: number) => void;
};

type AudioEngineState = {
	/** The one element, created on first use. Null until then. */
	element: ScrubbableAudio | null;
	/** Who owns playback right now — a widget's stable identity, or null. */
	ownerId: string | null;
	/** The URL the element was last activated with. */
	url: string | null;
	status: AudioEngineStatus;
	/** Seconds, mirrored from the element; 0 until metadata lands. */
	currentTime: number;
	/** Seconds, mirrored from the element; 0 until metadata lands. */
	duration: number;
	volume: number;
	playbackRate: number;
	/** The press order. See the header. */
	generation: number;
	/** The current activation's callbacks. */
	handlers: AudioEngineHandlers | null;
};

type AudioEngineActions = {
	/**
	 * Start `url` for `ownerId`, stopping whatever played before. Resolves to
	 * whether THIS press owns playback when it settles (false when a newer
	 * press, or a stop, overtook it while the element was starting).
	 */
	play: (
		ownerId: string,
		url: string,
		handlers?: AudioEngineHandlers,
	) => Promise<boolean>;
	/**
	 * Resume the owner's PAUSED element without re-activating it (a start would
	 * reload the source and restart the byte range). False when the owner does
	 * not hold the element, so a caller with a stale widget does not resurrect
	 * playback for a sound the reader has moved on from.
	 */
	resume: (ownerId: string) => Promise<boolean>;
	/** Pause the owner's playback; other owners are ignored, not stolen. */
	pause: (ownerId: string) => void;
	/** Toggle play/pause for a widget — idle/ended start, playing pauses. */
	toggle: (
		ownerId: string,
		url: string,
		handlers?: AudioEngineHandlers,
	) => Promise<boolean>;
	/** Commit a seek (clamped to the known duration). */
	seek: (ownerId: string, seconds: number) => void;
	/**
	 * The scrub frame: `fastSeek` where the engine has it, a plain assignment
	 * otherwise. Kept separate from {@link seek} so a drag can flood this and a
	 * release commits exactly once.
	 */
	scrub: (ownerId: string, seconds: number) => void;
	/**
	 * Stop playback and detach the source. No owner argument stops whatever is
	 * playing (the app-wide "stop the sound" press); an owner argument stops
	 * only that widget (a dismissed toolbar, an unmounting viewer).
	 */
	stop: (ownerId?: string) => void;
	/** Volume/rate apply to the shared element, now and for the next start. */
	setVolume: (volume: number) => void;
	setPlaybackRate: (rate: number) => void;
};

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

export const useAudioEngineStore = create<
	AudioEngineState & AudioEngineActions
>((set, get) => {
	// A seek on an idle row belongs to that owner, not the currently audible row.
	const pendingSeeks = new Map<string, number>();
	/** The one wiring point for the element's events, reached on creation. */
	const wire = (audio: ScrubbableAudio) => {
		audio.onended = () => {
			const { ownerId, handlers } = get();
			if (ownerId === null) return;
			set({ status: "ended", currentTime: audio.currentTime });
			handlers?.onEnded?.();
		};
		audio.onerror = () => {
			const { ownerId, handlers } = get();
			if (ownerId === null) return;
			set({ status: "error" });
			handlers?.onError?.();
		};
		const readMeta = () => {
			set({
				duration: Number.isFinite(audio.duration) ? audio.duration : 0,
				currentTime: audio.currentTime,
			});
		};
		audio.onloadedmetadata = readMeta;
		audio.ondurationchange = readMeta;
		audio.ontimeupdate = () => {
			set({ currentTime: audio.currentTime });
		};
	};
	/**
	 * The element, created on first use rather than at module load: a session
	 * that never plays audio pays nothing.
	 *
	 * THE STATE FIELD IS THE ONLY CELL. An earlier version kept a private module
	 * variable beside `state.element`, and the two could disagree: a rig that
	 * installed its own element (a capture behind the zero-gain graph, a test's
	 * doctored clock) was silently ignored by every action, which went on driving
	 * the private one. One owner means `setState({ element })` really is the
	 * engine's element.
	 */
	const ensure = (): ScrubbableAudio => {
		const existing = get().element;
		if (existing) return existing as ScrubbableAudio;
		const created = new Audio() as ScrubbableAudio;
		created.preload = "metadata";
		wire(created);
		// The rig's route, before a single byte can play (see the header).
		outputGraph?.(created);
		set({ element: created });
		return created;
	};
	/** Pause and detach the source so a revoked URL cannot be re-fetched. */
	const detach = (audio: ScrubbableAudio) => {
		audio.pause();
		audio.removeAttribute("src");
		// `load()` with no source is the spec's way to abandon the current
		// resource; optional-called because the node test's stub need not have it.
		audio.load?.();
	};
	return {
		element: null,
		ownerId: null,
		url: null,
		status: "idle",
		currentTime: 0,
		duration: 0,
		volume: 1,
		playbackRate: 1,
		generation: 0,
		handlers: null,

		play: async (ownerId, url, handlers) => {
			const generation = get().generation + 1;
			const audio = ensure();
			// The one exclusivity point: whatever played before stops, whichever
			// surface started it (speech, a card, the legacy attachment).
			detach(audio);
			audio.volume = get().volume;
			audio.playbackRate = get().playbackRate;
			audio.src = url;
			set({
				ownerId,
				url,
				status: "loading",
				currentTime: 0,
				duration: Number.isFinite(audio.duration) ? audio.duration : 0,
				generation,
				handlers: handlers ?? null,
			});
			try {
				await audio.play();
			} catch {
				if (get().generation !== generation) return false;
				/*
				 * A rejected `play()` (no decodable source, an autoplay policy)
				 * settles the engine's own error state and runs the activation's
				 * handler; the caller's toast/copy is the caller's business, as
				 * it was when each surface owned its element.
				 */
				set({ status: "error" });
				get().handlers?.onError?.();
				return false;
			}
			if (get().generation !== generation) {
				// A newer press overtook this one while it was starting: it must
				// not steal the slot back (the speech store's own rule).
				return false;
			}
			const pending = pendingSeeks.get(ownerId);
			if (pending !== undefined) {
				get().seek(ownerId, pending);
				pendingSeeks.delete(ownerId);
			}
			set({ status: "playing" });
			return true;
		},

		resume: async (ownerId) => {
			const { element: audio, ownerId: current, status } = get();
			if (!audio || current !== ownerId) return false;
			if (status !== "paused" && status !== "ended") return false;
			const generation = get().generation + 1;
			set({ generation, status: "loading" });
			if (status === "ended") audio.currentTime = 0;
			try {
				await audio.play();
			} catch {
				if (get().generation !== generation) return false;
				set({ status: "error" });
				get().handlers?.onError?.();
				return false;
			}
			if (get().generation !== generation) {
				return false;
			}
			set({ status: "playing" });
			return true;
		},

		pause: (ownerId) => {
			const { element: audio, ownerId: current } = get();
			if (!audio || current !== ownerId) return;
			audio.pause();
			set({
				generation: get().generation + 1,
				status: "paused",
				currentTime: audio.currentTime,
			});
		},

		toggle: async (ownerId, url, handlers) => {
			const { ownerId: current, status } = get();
			if (current === ownerId && status === "playing") {
				get().pause(ownerId);
				return false;
			}
			if (current === ownerId && (status === "paused" || status === "ended"))
				return get().resume(ownerId);
			return get().play(ownerId, url, handlers);
		},

		seek: (ownerId, seconds) => {
			const { element: audio, ownerId: current, duration } = get();
			if (!audio || current !== ownerId) {
				pendingSeeks.set(ownerId, Math.max(0, seconds));
				return;
			}
			const target = clamp(seconds, 0, duration > 0 ? duration : seconds);
			audio.currentTime = target;
			set({ currentTime: target });
		},

		scrub: (ownerId, seconds) => {
			const { element: audio, ownerId: current, duration } = get();
			if (!audio || current !== ownerId) {
				pendingSeeks.set(ownerId, Math.max(0, seconds));
				return;
			}
			const target = clamp(seconds, 0, duration > 0 ? duration : seconds);
			if (typeof audio.fastSeek === "function") audio.fastSeek(target);
			else audio.currentTime = target;
		},

		stop: (ownerId) => {
			const { element: audio, ownerId: current } = get();
			if (!audio) return;
			if (ownerId !== undefined && current !== ownerId) return;
			detach(audio);
			set({
				generation: get().generation + 1,
				ownerId: null,
				url: null,
				status: "idle",
				currentTime: 0,
				duration: 0,
				handlers: null,
			});
		},

		setVolume: (volume) => {
			const next = clamp(volume, 0, 1);
			const audio = get().element;
			if (audio) audio.volume = next;
			set({ volume: next });
		},

		setPlaybackRate: (rate) => {
			const next = clamp(rate, 0.5, 4);
			const audio = get().element;
			if (audio) audio.playbackRate = next;
			set({ playbackRate: next });
		},
	};
});

/**
 * A rig's output route for the shared element. Called once, when the engine
 * creates its element; the rig keeps whatever it needs to measure (an analyser,
 * a gain node) and returns nothing — the element must never be re-routed.
 *
 * A rig that installs one MUST keep its gain at 0 (see the header): this seam
 * exists so a real element can be driven silently, not so a test can be heard.
 */
export type AudioOutputGraph = (element: HTMLAudioElement) => void;

let outputGraph: AudioOutputGraph | null = null;

/**
 * Install (or clear, with `null`) the output graph the next-created element is
 * routed through. Production never calls this; the capture rigs do.
 */
export function installAudioOutputGraph(graph: AudioOutputGraph | null): void {
	outputGraph = graph;
}

/** Whether a rig has installed a graph (the guard test's own read). */
export function audioOutputGraphInstalled(): boolean {
	return outputGraph !== null;
}

/**
 * The engine's live element, for a widget's rAF: reading `currentTime` per
 * frame off the element (rather than the store's mirrored value) is what keeps
 * the label and the played ink frame-accurate without a React render each
 * frame.
 */
export function audioEngineElement(): HTMLAudioElement | null {
	return useAudioEngineStore.getState().element;
}
