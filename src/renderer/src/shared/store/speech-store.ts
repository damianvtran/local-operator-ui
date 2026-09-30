/**
 * @file speech-store.ts
 * @description
 * The one speech-playback store: what is loading, what is playing, and the
 * audio cache behind both.
 *
 * THE KEY IS THE IDENTITY. Playback is keyed by a string that names WHAT is
 * being spoken, so one playing/loading slot can serve every surface:
 *
 *   - `msg:<id>`   - a message's own words (`messageSpeechKey`).
 *   - `sel:<scope>:<fnv1a(text)>` - a reader's highlight, hashed because the
 *     text can be the full 10000-character read (`selectionSpeechKey`).
 *
 * The two surfaces that share one store entry share its spinner and its Stop
 * state: a message row and the selection toolbar that raised a press for the
 * same words cannot disagree about whether those words are playing.
 *
 * THE GENERATION COUNTER IS THE PRESS ORDER. Presses race - a slow first
 * response can resolve after a second press has started - and a response that
 * starts playing when it lands would play under a control the reader has since
 * moved on from. Every press increments `generation`; a response whose
 * generation is stale returns before it touches the audio element, and a stale
 * failure reports nothing (the newer press owns the state).
 *
 * FAILED PRESSES ARE BILLING-VISIBLE and must never look like nothing
 * happened: the catch both records `error` (the store's own test surface) and
 * raises the app's one error channel, so every surface that presses this store
 * discloses a failure without a second implementation of the disclosure.
 *
 * THE CACHE IS CAPPED at {@link AUDIO_CACHE_LIMIT} entries. Audio is the
 * largest thing this store holds, and a conversation replays the same handful
 * of messages far more often than it replays twenty; the cap keeps a long
 * session from pinning every utterance it ever played. A hit refreshes the
 * entry's position, so the messages in use survive and the ones untouched the
 * longest are the ones evicted.
 *
 * THE OBJECT URL BELONGS TO THE ELEMENT. `currentUrl` is the URL the playing
 * element was built from, and stop/end/error revoke THAT URL - the previous
 * implementation rebuilt a fresh URL from the cached blob to revoke it, which
 * released nothing and leaked the one that was actually playing.
 */

import { createLocalOperatorClient } from "@shared/api/local-operator";
import { apiConfig } from "@shared/config";
import { showErrorToast } from "@shared/utils/toast-manager";
import { create } from "zustand";

/** How many utterances the audio cache keeps. See the file header. */
export const AUDIO_CACHE_LIMIT = 20;

/** The store key of a message's own words. */
export const messageSpeechKey = (messageId: string): string =>
	`msg:${messageId}`;

/**
 * FNV-1a, 32-bit, lowercase hex. Non-cryptographic on purpose: the key only
 * has to separate two different utterances inside one conversation's cache,
 * and the full text stays the source of truth at press time.
 */
const fnv1a = (input: string): string => {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
};

/**
 * The store key of a highlight read aloud. `scope` is the conversation (or
 * whatever string identifies the speaking context on the surface), and `text`
 * is the text as it will be sent - clip FIRST, so the key, the cache entry and
 * the request all describe the same characters.
 */
export const selectionSpeechKey = (scope: string, text: string): string =>
	`sel:${scope}:${fnv1a(text)}`;

/**
 * The relay call for one utterance, in the store's fetcher shape.
 *
 * A factory rather than a store method so surfaces with their own key (the
 * selection toolbars) can call `speak` directly and still share the one
 * request path - the desktop relay attaches the auth the renderer cannot
 * (`speech-api.ts`), and a second spelling of the call is how the two ends
 * drift.
 */
export const fetchAgentSpeech =
	(agentId: string, inputText: string) => (): Promise<Blob | null> =>
		client.speech.createForAgent(agentId, { input_text: inputText });

type SpeechState = {
	/** Utterances by key, most recently used last. Capped; see the header. */
	audioCache: Map<string, Blob>;
	/** The key whose fetch is in flight, or null. */
	loadingKey: string | null;
	/** The key whose audio is playing, or null. */
	playingKey: string | null;
	/** The last failure, for the surfaces' own tests; the toast is the reader's. */
	error: string | null;
	audioElement: HTMLAudioElement | null;
	/** The object URL `audioElement` was built from. See the header. */
	currentUrl: string | null;
	/** The press order. See the header. */
	generation: number;
};

type SpeechActions = {
	/**
	 * Speak `key`, fetching through `fetcher` on a cache miss.
	 *
	 * The primitive every surface ends at: message surfaces through
	 * `playSpeech`, selection surfaces directly with a `selectionSpeechKey`.
	 */
	speak: (key: string, fetcher: () => Promise<Blob | null>) => Promise<void>;
	stopSpeech: () => void;
	/**
	 * A message's own words, kept for its existing callers and tests. A press
	 * whose key is already cached replays that entry without a fetch.
	 */
	playSpeech: (
		messageId: string,
		agentId: string,
		inputText: string,
	) => Promise<void>;
};

const client = createLocalOperatorClient(apiConfig.baseUrl);

/** Evict oldest-first until the cache is within the cap. */
const capCache = (cache: Map<string, Blob>): void => {
	while (cache.size > AUDIO_CACHE_LIMIT) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) return;
		cache.delete(oldest);
	}
};

export const useSpeechStore = create<SpeechState & SpeechActions>(
	(set, get) => ({
		audioCache: new Map(),
		loadingKey: null,
		playingKey: null,
		error: null,
		audioElement: null,
		currentUrl: null,
		generation: 0,

		speak: async (key, fetcher) => {
			const generation = get().generation + 1;
			get().stopSpeech(); // Stop any currently playing audio
			set({ loadingKey: key, error: null, generation });

			try {
				let audioBlob = get().audioCache.get(key);

				if (audioBlob) {
					/*
					 * A hit refreshes the entry's place in the eviction order: the
					 * reader asking for these words again is exactly the signal that
					 * they, not the twentieth-oldest utterance, are worth keeping.
					 */
					const cache = new Map(get().audioCache);
					cache.delete(key);
					cache.set(key, audioBlob);
					set({ audioCache: cache });
				} else {
					const fetched = await fetcher();
					if (!fetched) {
						throw new Error(
							"Speech generation failed, no audio data received.",
						);
					}
					/*
					 * A PRESS THAT LANDED AFTER THIS ONE OWNS THE STATE (`generation`):
					 * this response was superseded while the fetch was in flight, so it
					 * must not start playing - and must not overwrite the newer press's
					 * loading slot on its way out.
					 */
					if (get().generation !== generation) return;
					audioBlob = fetched;
					const cache = new Map(get().audioCache);
					cache.set(key, fetched);
					capCache(cache);
					set({ audioCache: cache });
				}

				if (get().generation !== generation) return;

				const audioUrl = URL.createObjectURL(audioBlob);
				const audioElement = new Audio(audioUrl);
				audioElement.onended = () => {
					URL.revokeObjectURL(audioUrl);
					set((state) =>
						state.audioElement === audioElement
							? { playingKey: null, audioElement: null, currentUrl: null }
							: {},
					);
				};
				audioElement.onerror = () => {
					URL.revokeObjectURL(audioUrl);
					set((state) =>
						state.audioElement === audioElement
							? {
									error: "Error playing audio.",
									playingKey: null,
									audioElement: null,
									currentUrl: null,
								}
							: {},
					);
				};

				await audioElement.play();
				/*
				 * `play()` is the last await before this press owns the element, so
				 * the generation is re-read here too: a press that arrived while the
				 * element was starting would otherwise be overwritten by this one's
				 * `playingKey` the moment the promise settles.
				 */
				if (get().generation !== generation) {
					audioElement.pause();
					audioElement.onended = null;
					audioElement.onerror = null;
					URL.revokeObjectURL(audioUrl);
					return;
				}
				set({
					playingKey: key,
					loadingKey: null,
					audioElement,
					currentUrl: audioUrl,
				});
			} catch (err) {
				if (get().generation !== generation) return;
				const errorMessage =
					err instanceof Error ? err.message : "Failed to generate speech";
				set({ error: errorMessage, loadingKey: null });
				/*
				 * THE READER'S HALF OF A FAILED PRESS (`toast-manager`'s one channel,
				 * the same one `copyTarget` uses): whatever the surface, the failure
				 * is visible rather than a press that did nothing.
				 */
				showErrorToast(errorMessage);
			}
		},

		stopSpeech: () => {
			const { audioElement, currentUrl } = get();
			if (audioElement) {
				audioElement.pause();
				audioElement.onended = null; // Clean up listener
				audioElement.onerror = null; // Clean up listener
				/*
				 * Revoke the URL the element was actually built from. The previous
				 * spelling recomputed a URL from the cached blob and revoked THAT,
				 * which released nothing and left the playing URL alive.
				 */
				if (currentUrl) URL.revokeObjectURL(currentUrl);
			}
			set({ playingKey: null, audioElement: null, currentUrl: null });
		},

		playSpeech: async (messageId, agentId, inputText) => {
			await get().speak(
				messageSpeechKey(messageId),
				fetchAgentSpeech(agentId, inputText),
			);
		},
	}),
);
