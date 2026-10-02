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
 * DISMISSAL IS NOT A PRESS. A selection toolbar can be taken away - the reader
 * clicks away, presses Escape, drags a new highlight - and the audio it started
 * must not outlive the only control that owned it. `dismiss(key)` stops this
 * key's playback and CANCELS an in-flight fetch so its response can never
 * start playing for a dismissed subject (UX review round 1, U1). A superseded
 * response is still CACHED even when its playback is suppressed: the synthesis
 * was paid for the moment it was requested, and a later press of the same
 * words must replay it, not buy it a second time (agent review round 1,
 * MINOR-1).
 *
 * TWO PRESSES OF ONE KEY NEVER PAY TWICE (agent review round 2, MINOR-1): a
 * press that arrives while the same key's synthesis is still on the wire joins
 * that fetch instead of issuing a second billed request, and `heardKeys` marks
 * the keys playback has actually started for - the datum the resting label
 * reads beside the cache, so audio fetched but never heard (a cancelled press
 * whose response landed) is offered as `Speak aloud`, not as a `Replay` of an
 * experience that did not happen (UX round 2, U-r2-3).
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
import {
	SPEECH_FAILURE_DETAIL_PREFIX,
	SPEECH_PLAYBACK_COPY,
	isUnknownAgentSpeechRefusal,
	speechFailureCopy,
} from "@shared/lib/speech-errors";
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
 *
 * THE KEY COVERS TEXT AND SCOPE, NOTHING ELSE (agent review round 1, NIT-3,
 * scoped to documentation). Every other request parameter is fixed
 * server-side today - the daemon's route pins provider, voice and settings -
 * so two presses of the same words really are the same utterance. The day a
 * parameter gains a caller (the `language_code` on `AgentSpeechRequest` is
 * the one already plumbed), this key must grow a component for it: a cache
 * hit must never replay audio synthesised for a different language. The
 * 32-bit hash's collision surface (~1e-6 at a hundred distinct highlights in
 * one conversation) is accepted on the same round: a collision replays
 * another utterance within this scope, and the remedy - storing the text
 * beside the blob and comparing on a hit - is the upgrade this comment
 * reserves the place for.
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
 *
 * THE TWO ROUTES, AND WHICH ONE A PRESS TAKES (`@shared/lib/speech-target`
 * carries the full argument): `agentId` is the conversation's ROLE AGENT, and
 * the agent route is the more specific target - it is the daemon's own
 * voice selection that runs on it (`determine_voice` classifies the agent's
 * name and description). A conversation with no binding takes the agent-less
 * route, which needs no registry entry and is therefore always resolvable.
 *
 * THE UNKNOWN-AGENT REFUSAL IS THE LAST RUNG. A binding can go stale under a
 * mounted transcript (the agent deleted, the daemon's config root moved), and
 * the daemon answers that with the unknown-agent sentence - a sentence whose
 * remedy is a DIFFERENT REQUEST, not a different attempt. So that one refusal
 * fails over to the agent-less route: the reader asked to hear the conversation,
 * not for an agent that happens to be spelled correctly, and every other refusal
 * (a credit gate, a rate limit, a transport failure) propagates untouched - the
 * toast must keep saying what actually went wrong.
 *
 * THE AGENT-LESS BODY NAMES NO MODEL AND NO VOICE, deliberately. The daemon owns
 * both for this route, the way `radient_client.create_speech` already omits them
 * when a caller named none ("the hub owns the speech model choice, and a caller
 * that named no voice must not have one invented client-side"), and a fallback
 * that invented a vendor model or a fixed voice would pin the product to a
 * provider's roster - the class of defect the agent route's alias-based voice
 * exists to avoid.
 */
export const fetchSpeechFor =
	(agentId: string | null, inputText: string) => (): Promise<Blob | null> => {
		const agentless = () => client.speech.create({ input: inputText });
		if (agentId === null) return agentless();
		return client.speech
			.createForAgent(agentId, { input_text: inputText })
			.catch((error: unknown) => {
				if (!isUnknownAgentSpeechRefusal(error)) throw error;
				return agentless();
			});
	};

type SpeechState = {
	/** Utterances by key, most recently used last. Capped; see the header. */
	audioCache: Map<string, Blob>;
	/**
	 * The keys this session has actually HEARD - playback started for them at
	 * least once. The resting control's label reads this beside the cache: a
	 * response that arrived for a press the reader cancelled is cached (the
	 * synthesis was paid for) but was never heard, so offering `Replay speech`
	 * for it would name an experience that did not happen (UX round 2, U-r2-3).
	 */
	heardKeys: Set<string>;
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
	 * Speak `key`, fetching through `fetcher` on a cache miss - or joining the
	 * same key's in-flight fetch, when a press raced one that is still out.
	 *
	 * The primitive every surface ends at: message surfaces through
	 * `playSpeech`, selection surfaces directly with a `selectionSpeechKey`.
	 */
	speak: (key: string, fetcher: () => Promise<Blob | null>) => Promise<void>;
	stopSpeech: () => void;
	/**
	 * Abandon this key's press: stop it if it is playing, and cancel an
	 * in-flight fetch so its response cannot start playing for a subject the
	 * reader has dismissed. The fetched audio is still cached; see the header's
	 * dismissal paragraph.
	 */
	dismiss: (key: string) => void;
	/**
	 * A message's own words, under the message's key.
	 *
	 * The wrapper the message surfaces call (`canonical-transcript.tsx`'s answer
	 * row, the legacy strip): it only names the key and hands on the fetch, so
	 * every message press shares the selection surfaces' `speak` - one request
	 * path, one cache, one generation guard.
	 *
	 * `agentId` is the conversation's ROLE AGENT, or `null` for a conversation
	 * with none; `fetchSpeechFor` owns what each of those means.
	 */
	playSpeech: (
		messageId: string,
		agentId: string | null,
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

/**
 * One in-flight fetch per key (agent review round 2, MINOR-1): a press that
 * arrives while this key's synthesis is still out AWAITS that promise instead
 * of issuing a second billed request for identical text.
 *
 * WHY THIS WINDOW EXISTS AT ALL: U2's cancel lets the response land and be
 * cached - the synthesis is paid the moment the request is issued - but the
 * cache is only written when it LANDS, so a reader who cancels a slow read
 * and then presses again after the cancel (the exact moment U2 creates) used
 * to miss the cache and pay for the same words twice. The entry is dropped
 * the instant it settles; after that the cache is the dedupe.
 *
 * Module scope beside `capCache` rather than store state: it is a fact about
 * requests currently on the wire, not something a surface renders, and no
 * action but `speak` reads it. `dismiss` deliberately does NOT clear it - the
 * whole point is that the abandoned press's synthesis is still joinable.
 */
const inflight = new Map<string, Promise<Blob | null>>();

const fetchOnce = (
	key: string,
	fetcher: () => Promise<Blob | null>,
): Promise<Blob | null> => {
	let pending = inflight.get(key);
	if (pending === undefined) {
		pending = fetcher().finally(() => {
			inflight.delete(key);
		});
		inflight.set(key, pending);
	}
	return pending;
};

export const useSpeechStore = create<SpeechState & SpeechActions>(
	(set, get) => ({
		audioCache: new Map(),
		heardKeys: new Set(),
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
					/*
					 * `fetchOnce`, not `fetcher`, so a re-press that races this key's
					 * still-out response joins it rather than paying again (agent review
					 * round 2, MINOR-1).
					 */
					const fetched = await fetchOnce(key, fetcher);
					if (!fetched) {
						throw new Error(
							"Speech generation failed, no audio data received.",
						);
					}
					/*
					 * THE CACHE WRITE COMES FIRST, BEFORE THE PRESS-ORDER CHECK, and that
					 * order is the point: the synthesis was paid for the moment this fetch
					 * was issued, so a response that lost the press race (agent review
					 * round 1, MINOR-1 - this check used to sit above the write) must still
					 * be kept for a later replay. What the check suppresses is the PLAYBACK
					 * below, never the cache: the next press of these same words is a cache
					 * hit, not a second billed call.
					 */
					audioBlob = fetched;
					const cache = new Map(get().audioCache);
					cache.set(key, fetched);
					capCache(cache);
					set({ audioCache: cache });
					if (get().generation !== generation) return;
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
					const wasCurrent = get().audioElement === audioElement;
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
					if (!wasCurrent) return;
					/*
					 * THE PLAYBACK HALF OF "NO SILENT FAILURES" (copy review round 1,
					 * C1): a press that fetched and then failed to play used to return to
					 * rest with nothing said. Same channel as the fetch path; the element's
					 * own detail has no reader sentence, so the sentence is fixed and the
					 * detail stays in the console.
					 */
					console.error(
						`${SPEECH_FAILURE_DETAIL_PREFIX} playback failed for ${key}`,
					);
					showErrorToast(SPEECH_PLAYBACK_COPY);
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
				/*
				 * Playback is starting, so from this press on the key is `heard` - the
				 * stamp that keeps the resting label honest for audio the reader never
				 * got to hear (UX round 2, U-r2-3).
				 */
				const heard = new Set(get().heardKeys);
				heard.add(key);
				set({
					playingKey: key,
					loadingKey: null,
					audioElement,
					currentUrl: audioUrl,
					heardKeys: heard,
				});
			} catch (err) {
				if (get().generation !== generation) return;
				const errorMessage =
					err instanceof Error ? err.message : "Failed to generate speech";
				set({ error: errorMessage, loadingKey: null });
				/*
				 * THE READER'S HALF OF A FAILED PRESS (`toast-manager`'s one channel,
				 * the same one `copyTarget` uses): whatever the surface, the failure
				 * is visible rather than a press that did nothing. `error` keeps the
				 * raw detail for the surfaces' own tests; the TOAST carries the
				 * designed sentence - the daemon's refusals verbatim, everything else
				 * mapped (`speech-errors.ts`) so a support diagnostic never reads as
				 * copy (UX round 1 U3 / copy round 1 C5).
				 */
				showErrorToast(speechFailureCopy(err));
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

		dismiss: (key) => {
			const { loadingKey, playingKey, generation } = get();
			/*
			 * CANCEL AN IN-FLIGHT FETCH, do not await it: bumping the generation
			 * makes the response stale so it can never start playing for a subject
			 * the reader has dismissed (UX review round 1, U1's in-flight half), and
			 * clearing the slot now returns the control to resting immediately. The
			 * response still lands and is still cached - the synthesis is paid either
			 * way, and `speak`'s own comment owns that rule.
			 */
			if (loadingKey === key) {
				set({ generation: generation + 1, loadingKey: null });
			}
			if (playingKey === key) {
				get().stopSpeech();
			}
		},

		playSpeech: async (messageId, agentId, inputText) => {
			await get().speak(
				messageSpeechKey(messageId),
				fetchSpeechFor(agentId, inputText),
			);
		},
	}),
);
