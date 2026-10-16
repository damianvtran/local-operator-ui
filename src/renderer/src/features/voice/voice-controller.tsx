/**
 * SESSION VOICE'S CONTROLLER (`docs/design/session-voice.md`), mounted ONCE at
 * the app root so an exchange survives navigation: a take sent from the chat
 * route is still answered aloud on the settings route.
 *
 * What it owns, and nothing else:
 *
 * 1. THE SLOT MIRROR. The machine feed's `voice` frame writes the store, so a
 *    switch made in any window moves every window's toggle and sidebar marker.
 * 2. THE SPEAK TRIGGER. While a session holds the slot, one subscription to that
 *    session's own stream folds its frames through `voice-turns.ts`: the last
 *    assistant message of a turn this window sent words to is spoken once per
 *    message id (replays after a reconnect are deduped), and an approval is
 *    ANNOUNCED - never answered (V7).
 * 3. PUSH-TO-TALK. A `VOICE`-priority handler on the shared hold manager
 *    (`keymap.push_to_talk`), active only while the conversation on screen holds
 *    the slot. Hold records; release uploads the take to the utterance route.
 *
 * THERE IS NO PATH FROM HERE TO A GATE ANSWER. The utterance route admits words
 * as a prompt or a steer, and its server side has no call to `answer_gate`; this
 * file sends only `voice.utterance` (words in) and `voice.speech` (a source
 * reference out), and imports nothing that can approve, deny or answer.
 * `scripts/voice-turns.test.mjs` pins that by reading this folder's source.
 */

import {
	desktopMedia,
	mediaError,
} from "@shared/api/local-operator/desktop-api";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import {
	SpeechToTextPriority,
	useSpeechToTextManager,
} from "@shared/hooks/use-speech-to-text-manager";
import { t } from "@shared/i18n";
import {
	panelSessionIdOfView,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useSpeechStore } from "@shared/store/speech-store";
import {
	dismissToast,
	showErrorToast,
	showInfoToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { type FC, useCallback, useEffect, useRef } from "react";
import type { DesktopMediaResponse } from "../../../../shared/desktop-contract";
import { applyVoiceActive, useVoiceStatus } from "./use-voice-status";
import { useVoiceStore } from "./voice-store";
import { type VoiceStreamHandle, subscribeVoiceStream } from "./voice-stream";
import {
	VOICE_TAKE_ROW_TTL_MS,
	type VoiceSpeakSource,
	type VoiceTurnsInput,
	type VoiceTurnsState,
	initialVoiceTurns,
	stepVoiceTurns,
	takeOutstanding,
} from "./voice-turns";

/** A take shorter than this is a tap, not speech; it is discarded unsent. */
const MIN_TAKE_MS = 250;

/** The speech-store key a voice answer plays under, so it never collides. */
export const voiceSpeechKey = (source: VoiceSpeakSource): string =>
	source.kind === "message"
		? `voice:message:${source.messageId}`
		: `voice:gate:${source.requestId}`;

/**
 * The utterance's idempotency key: a DASHED lowercase UUID, exactly what
 * `crypto.randomUUID()` returns. The route validates it with the same
 * `RequestID` pattern `/messages` uses (`desktop_sessions.py`), and the dashless
 * form round 1 sent was refused 422 on every take (QA round 1, Q1).
 */
export function newVoiceRequestId(): string {
	return crypto.randomUUID();
}

/** The sentence a refused media call owes the reader, per voice code. */
function utteranceFailure(result: DesktopMediaResponse): string {
	if (result.kind === "error" && result.voiceCode === "voice_not_enabled")
		return t("ui.chat.voice.not_enabled");
	if (result.kind === "error" && result.voiceCode === "empty_transcript")
		return t("ui.chat.voice.empty_transcript");
	if (result.kind === "error" && result.voiceCode === "approval_pending")
		return t("ui.chat.voice.card_pending");
	if (result.kind === "error" && result.voiceCode === "stt_unavailable")
		return t("ui.chat.voice.stt_unavailable", { reason: result.detail });
	return t("ui.chat.voice.utterance_failed", {
		reason: mediaError(result).message,
	});
}

/**
 * Send one utterance - audio bytes, or text (the key-free door the dev driver
 * uses) - to the session holding the slot, and arm the speak trigger.
 *
 * Exported for the dev driver's `voiceUtterance` verb, which must go through the
 * SAME path a held key does: a second path would be a second thing to review.
 */
export async function sendVoiceUtterance(
	sessionId: string,
	take: { text: string } | { audio: Blob },
): Promise<{ ok: boolean; status: number; detail?: string }> {
	const store = useVoiceStore.getState();
	store.setPhase("sending", sessionId);
	/*
	 * The id is minted BEFORE arming, because it is the binding: the server mints
	 * the take's user message with `message.id == request_id`, and only the turn
	 * whose stream carries that message answers this take (design V14).
	 */
	const requestId = newVoiceRequestId();
	feedTurns(sessionId, { kind: "armed", requestId });
	scheduleTakeExpiry(sessionId, requestId);
	let result: DesktopMediaResponse;
	try {
		result =
			"text" in take
				? await desktopMedia(
						{ op: "voice.utterance", sessionId, requestId, text: take.text },
						null,
					)
				: await desktopMedia(
						{
							op: "voice.utterance",
							sessionId,
							requestId,
							fileName: "utterance.webm",
							mimeType: take.audio.type || "audio/webm",
						},
						new Uint8Array(await take.audio.arrayBuffer()),
					);
	} catch (error) {
		/*
		 * A THROWN SEND IS A FAILED SEND (review round 6, R6-m2): the bridge or the
		 * blob read can reject instead of answering. Left uncaught, the take stayed
		 * outstanding and the header stayed on "Sending" for good.
		 */
		feedTurns(sessionId, { kind: "disarmed", requestId });
		const reason = error instanceof Error ? error.message : String(error);
		useVoiceStore.getState().setPhase("error", sessionId);
		showErrorToast(t("ui.chat.voice.utterance_failed", { reason }));
		return { ok: false, status: 0, detail: reason };
	}
	if (result.kind === "json" && result.status >= 200 && result.status < 300) {
		/*
		 * `working` only while this session still owes an answer (review round 5,
		 * R5-m1). A fast turn can beat this response home and already be spoken,
		 * and a resume can have dropped the take while the upload was out; either
		 * way nothing will move the header off `working` later, so it rests.
		 */
		if (useVoiceStore.getState().phase === "sending") {
			const owed = takeOutstanding(
				turnsBySession.get(sessionId) ?? initialVoiceTurns(),
			);
			useVoiceStore
				.getState()
				.setPhase(owed ? "working" : "idle", owed ? sessionId : null);
		}
		return { ok: true, status: result.status };
	}
	feedTurns(sessionId, { kind: "disarmed", requestId });
	const sentence = utteranceFailure(result);
	if (result.kind === "error" && result.voiceCode === "approval_pending") {
		// The card is on screen and blocking; the take changed nothing (V7, V13).
		useVoiceStore.getState().setPhase("idle", null);
		showCardToast(sessionId, sentence);
	} else if (
		result.kind === "error" &&
		result.voiceCode === "empty_transcript"
	) {
		// Nothing broke: the take held no words. Info, and back to rest.
		useVoiceStore.getState().setPhase("idle", null);
		showInfoToast(sentence);
	} else {
		useVoiceStore.getState().setPhase("error", sessionId);
		showErrorToast(sentence);
	}
	return {
		ok: false,
		status: result.status,
		detail: result.kind === "error" ? (result.voiceCode ?? result.detail) : "",
	};
}

/*
 * THE TURN STATE IS MODULE STATE, PER SESSION, so the driver verb and the hold
 * path feed the same fold the stream watcher reads.
 *
 * KEPT ACROSS A SLOT ROUND-TRIP (U4): A -> B -> A must not re-announce the gate
 * A already announced, nor re-speak a message A already spoke, so a session's
 * dedupe sets outlive the slot leaving it. What does NOT outlive it is the
 * in-flight part - an armed take whose session lost the slot is not answered
 * aloud (`resetTurnFlight`). Bounded to a handful of sessions; the oldest goes.
 */
const TURN_SESSIONS_KEPT = 8;
const turnsBySession = new Map<string, VoiceTurnsState>();
let speakSink: ((source: VoiceSpeakSource) => void) | null = null;

export function feedTurns(sessionId: string, input: VoiceTurnsInput): void {
	const before = turnsBySession.get(sessionId) ?? initialVoiceTurns();
	const step = stepVoiceTurns(before, input);
	clearTakeExpiry(before, step.state);
	/*
	 * A TAKE CONSUMED IN SILENCE ENDS THE EXCHANGE (R4-M1). When a step leaves
	 * this session owing nothing without asking to speak - a resume that dropped
	 * the take, an interrupted turn, a turn with nothing to say - nothing else
	 * will move the header off "Working", so it returns to rest here. `sending` is
	 * left alone: the upload's own answer settles that phase (R5-m1).
	 */
	if (
		takeOutstanding(before) &&
		!takeOutstanding(step.state) &&
		step.speak.length === 0
	) {
		const voice = useVoiceStore.getState();
		if (voice.phaseSessionId === sessionId && voice.phase === "working")
			voice.setPhase("idle", null);
	}
	turnsBySession.delete(sessionId);
	turnsBySession.set(sessionId, step.state);
	while (turnsBySession.size > TURN_SESSIONS_KEPT) {
		const oldest = turnsBySession.keys().next().value;
		if (oldest === undefined) break;
		turnsBySession.delete(oldest);
	}
	useVoiceStore
		.getState()
		.setCardPending(sessionId, step.state.pendingCard !== null);
	for (const source of step.speak) speakSink?.(source);
}

/**
 * Drop a take whose user row never arrived (review round 6, R6-m1), after
 * `VOICE_TAKE_ROW_TTL_MS`. A take the server is still holding as a queued steer
 * survives the check, so it is checked again one TTL later rather than dropped.
 */
const takeExpiry = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleTakeExpiry(sessionId: string, requestId: string): void {
	const timer = setTimeout(() => {
		takeExpiry.delete(requestId);
		feedTurns(sessionId, { kind: "expired", requestId });
		if (turnsBySession.get(sessionId)?.takes.includes(requestId))
			scheduleTakeExpiry(sessionId, requestId);
	}, VOICE_TAKE_ROW_TTL_MS);
	// Bookkeeping, not work: it must never keep a process alive (node hosts).
	(timer as { unref?: () => void }).unref?.();
	takeExpiry.set(requestId, timer);
}

/** A take that left the outstanding list (bound, failed, reset) needs no timer. */
function clearTakeExpiry(before: VoiceTurnsState, after: VoiceTurnsState) {
	for (const id of before.takes) {
		if (after.takes.includes(id)) continue;
		const timer = takeExpiry.get(id);
		if (timer === undefined) continue;
		clearTimeout(timer);
		takeExpiry.delete(id);
	}
}

/**
 * Where the header rests once something it showed is over (review round 6, I9):
 * `working` while the session still owes this window an answer - a take out or
 * its turn running, including after an approval was answered on screen - and
 * idle otherwise.
 */
export function settleVoicePhase(sessionId: string): void {
	const voice = useVoiceStore.getState();
	if (takeOutstanding(turnsBySession.get(sessionId) ?? initialVoiceTurns()))
		voice.setPhase("working", sessionId);
	else voice.setPhase("idle", null);
}

/** The slot left this session: forget its takes, keep what it has said. */
function resetTurnFlight(sessionId: string): void {
	const state = turnsBySession.get(sessionId);
	if (!state) return;
	clearTakeExpiry(state, initialVoiceTurns());
	turnsBySession.set(sessionId, {
		...initialVoiceTurns(),
		spoken: state.spoken,
		announced: state.announced,
	});
	useVoiceStore.getState().setCardPending(sessionId, false);
}

/*
 * ONE TOAST PER SESSION FOR "A CARD IS ON SCREEN" (design round 2, D8; named for
 * any card since round 3, R4-n1: an approval or a blocking ask).
 * The gate's announcement and a refused take say the same thing - answer the
 * card - so they share an id and the later replaces the earlier rather than
 * stacking two notices about one card. A warning in both cases: the card is
 * blocking, and the refusal is the same fact restated.
 */
export const voiceCardToastId = (sessionId: string): string =>
	`voice-card:${sessionId}`;

function showCardToast(sessionId: string, message: string): void {
	showWarningToast(message, { id: voiceCardToastId(sessionId) });
}

/**
 * Whether the slot session has a card pending - an approval or a blocking ask -
 * as its stream last said. Any card, because the route's V13 refuses at any
 * (review round 3, R3-m2): a take refused here never opens the microphone.
 */
export function voiceCardPending(sessionId: string): boolean {
	return Boolean(turnsBySession.get(sessionId)?.pendingCard);
}

/**
 * Speak one source reference: the server resolves and synthesises it (V8), and
 * the bytes play through the shared speech store, which owns the one audio
 * element (so a dictation replay and a voice answer can never talk over each
 * other). The fetch happens HERE rather than inside the store's fetcher so the
 * refusal that means "the slot moved" can stay silent instead of reaching the
 * store's generic failure toast.
 */
async function speakSource(
	sessionId: string,
	source: VoiceSpeakSource,
): Promise<void> {
	if (source.kind === "gate") {
		// The announcement's on-screen half: the approval card is the only answer.
		showCardToast(sessionId, t("ui.chat.voice.approval_waiting"));
	}
	useVoiceStore.getState().setPhase("speaking", sessionId);
	const result = await desktopMedia(
		{
			op: "voice.speech",
			sessionId,
			source:
				source.kind === "message"
					? { kind: "message", messageId: source.messageId }
					: { kind: "gate", requestId: source.requestId },
		},
		null,
	);
	if (result.kind !== "bytes") {
		const voice = useVoiceStore.getState();
		if (voice.phaseSessionId === sessionId) settleVoicePhase(sessionId);
		// The slot moved mid-answer: silence is the right answer, not an error.
		if (result.kind === "error" && result.voiceCode === "voice_not_enabled")
			return;
		console.error(
			`[voice] speech refused: ${result.status} ${result.kind === "error" ? (result.voiceCode ?? result.detail) : result.kind}`,
		);
		showErrorToast(t("ui.chat.voice.speech_failed"));
		return;
	}
	const audio = new Blob([result.data as BlobPart], { type: result.mimeType });
	await useSpeechStore
		.getState()
		.speak(voiceSpeechKey(source), async () => audio);
}

/** The conversation on screen, read the way the pane reads it. */
function viewedSessionId(): string | undefined {
	const state = useCanonicalSessionsStore.getState();
	const draft = state.activeDraftKey
		? state.drafts[state.activeDraftKey]
		: undefined;
	return panelSessionIdOfView(
		state.activeDraftKey,
		draft?.sessionId,
		state.activeSessionId,
	);
}

export const VoiceController: FC = () => {
	const status = useVoiceStatus();
	const activeSessionId = status.activeSessionId;
	const feed = useDesktopFeed();

	// 1. The slot mirror: the feed's level frame goes into the one cache entry.
	const client = useQueryClient();
	useEffect(() => {
		if (feed.voiceActive !== undefined)
			applyVoiceActive(feed.voiceActive, client);
	}, [feed.voiceActive, client]);

	/*
	 * `speaking` ends when the audio does. The store's `speak` resolves when
	 * playback STARTS, so the phase follows its `playingKey`/`loadingKey` instead:
	 * once neither names a voice key, nothing of ours is playing.
	 */
	useEffect(
		() =>
			useSpeechStore.subscribe((speech, previous) => {
				const voice = useVoiceStore.getState();
				if (voice.phase !== "speaking") return;
				const ours = (key: string | null) => key?.startsWith("voice:") ?? false;
				const was = ours(previous.playingKey) || ours(previous.loadingKey);
				const is = ours(speech.playingKey) || ours(speech.loadingKey);
				// Only an EDGE ends it: an unrelated store write while our fetch is
				// still out (neither key set yet) is not the audio finishing. An
				// announced approval ends mid-turn: the turn still owes its answer.
				if (was && !is) {
					if (voice.phaseSessionId) settleVoicePhase(voice.phaseSessionId);
					else voice.setPhase("idle", null);
				}
			}),
		[],
	);

	// 2. The speak trigger, on the slot holder's own stream.
	const watcher = useRef<VoiceStreamHandle | null>(null);
	useEffect(() => {
		if (!status.enabled || !activeSessionId) {
			speakSink = null;
			return;
		}
		speakSink = (source) => void speakSource(activeSessionId, source);
		const lostToastId = `voice-stream-lost:${activeSessionId}`;
		const handle = subscribeVoiceStream(
			activeSessionId,
			(input) => feedTurns(activeSessionId, input),
			(status) => {
				// Back by any path - focus, feed reconnect, Reconnect (R3-m1).
				if (status === "recovered") {
					dismissToast(lostToastId);
					return;
				}
				// The bounded retry gave up (U5): say so once, with the way back (N1).
				if (status !== "exhausted") return;
				showWarningToast(t("ui.chat.voice.stream_lost"), {
					id: lostToastId,
					duration: Number.POSITIVE_INFINITY,
					action: {
						label: t("ui.chat.voice.stream_reconnect"),
						onClick: () => handle.retry(),
					},
				});
			},
		);
		watcher.current = handle;
		return () => {
			watcher.current = null;
			handle.dispose();
			dismissToast(lostToastId);
			speakSink = null;
			resetTurnFlight(activeSessionId);
			/*
			 * The slot leaving this session stops what it is saying: the operator
			 * moved the microphone, and an answer from the old session playing over
			 * the new one would be speech nobody asked for here.
			 */
			const speaking = useSpeechStore.getState().playingKey;
			if (speaking?.startsWith("voice:"))
				useSpeechStore.getState().stopSpeech();
		};
	}, [status.enabled, activeSessionId]);

	/*
	 * THE WAY BACK FROM `exhausted` (review round 2, N1): a watcher that gave up
	 * is retried when the window regains focus - the operator came back to it -
	 * and when the machine feed reconnects, which is the backend itself coming
	 * back. `retry()` is a no-op unless the watcher is exhausted, so neither
	 * signal disturbs a healthy stream.
	 */
	useEffect(() => {
		const onFocus = () => watcher.current?.retry();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, []);
	const feedReconnects = feed.authoringReconnectRevision;
	useEffect(() => {
		if (feedReconnects > 0) watcher.current?.retry();
	}, [feedReconnects]);

	// 3. Push-to-talk.
	const recorder = useRef<{
		recorder: MediaRecorder;
		chunks: Blob[];
		startedAt: number;
		sessionId: string;
		aborted: boolean;
	} | null>(null);
	const starting = useRef<symbol | null>(null);

	const start = useCallback(() => {
		const sessionId = viewedSessionId();
		if (!sessionId || recorder.current || starting.current) return;
		/*
		 * A CARD ON SCREEN FIRST (V7, V13). The route refuses the take with
		 * `approval_pending` at any parked card - an approval or a blocking ask
		 * (R3-m2) - so refusing it here means the microphone never opens for words
		 * that cannot be admitted, and the hint is immediate.
		 */
		if (voiceCardPending(sessionId)) {
			showCardToast(sessionId, t("ui.chat.voice.card_pending"));
			return;
		}
		// A new take interrupts the answer being spoken: barge-in by hand.
		useSpeechStore.getState().stopSpeech();
		useVoiceStore.getState().setPhase("listening", sessionId);
		const attempt = Symbol("take");
		starting.current = attempt;
		void navigator.mediaDevices
			.getUserMedia({ audio: true })
			.then((stream) => {
				if (starting.current !== attempt) {
					// Released before the microphone opened: nothing to keep.
					for (const track of stream.getTracks()) track.stop();
					return;
				}
				starting.current = null;
				const media = new MediaRecorder(stream);
				const take = {
					recorder: media,
					chunks: [] as Blob[],
					startedAt: performance.now(),
					sessionId,
					aborted: false,
				};
				media.ondataavailable = (event) => take.chunks.push(event.data);
				media.onstop = () => {
					for (const track of stream.getTracks()) track.stop();
					const long = performance.now() - take.startedAt >= MIN_TAKE_MS;
					if (take.aborted || !long) {
						useVoiceStore.getState().setPhase("idle", null);
						if (!take.aborted) showInfoToast(t("ui.chat.voice.empty_take"));
						return;
					}
					const audio = new Blob(take.chunks, {
						type: media.mimeType || "audio/webm",
					});
					void sendVoiceUtterance(take.sessionId, { audio });
				};
				recorder.current = take;
				media.start();
			})
			.catch(() => {
				starting.current = null;
				useVoiceStore.getState().setPhase("error", sessionId);
				showErrorToast(
					t("ui.chat.voice.utterance_failed", {
						reason: t("ui.chat.voice.toggle_unavailable_generic"),
					}),
				);
			});
	}, []);

	const stop = useCallback((reason?: "release" | "abort") => {
		if (starting.current) {
			starting.current = null;
			useVoiceStore.getState().setPhase("idle", null);
			return;
		}
		const take = recorder.current;
		if (!take) return;
		recorder.current = null;
		take.aborted = reason === "abort";
		take.recorder.stop();
	}, []);

	useSpeechToTextManager(
		"session-voice",
		SpeechToTextPriority.VOICE,
		{ start, stop },
		/*
		 * ACTIVE ONLY ON THE SLOT HOLDER, WHILE IT IS ON SCREEN. Everywhere else the
		 * hold falls through to dictation exactly as before; and a take already
		 * running is not a second take.
		 */
		() =>
			status.enabled &&
			activeSessionId !== null &&
			viewedSessionId() === activeSessionId &&
			recorder.current === null &&
			starting.current === null,
	);

	return null;
};
