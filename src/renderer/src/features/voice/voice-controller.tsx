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
	resolvePushToTalkBinding,
	useSpeechToTextManager,
} from "@shared/hooks/use-speech-to-text-manager";
import { t } from "@shared/i18n";
import {
	panelSessionIdOfView,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useSpeechStore } from "@shared/store/speech-store";
import {
	showErrorToast,
	showInfoToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import { type FC, useCallback, useEffect, useRef } from "react";
import type { DesktopMediaResponse } from "../../../../shared/desktop-contract";
import { useVoiceStatus } from "./use-voice-status";
import { useVoiceStore } from "./voice-store";
import { subscribeVoiceStream } from "./voice-stream";
import {
	type VoiceSpeakSource,
	type VoiceTurnsInput,
	type VoiceTurnsState,
	initialVoiceTurns,
	stepVoiceTurns,
} from "./voice-turns";

/** A take shorter than this is a tap, not speech; it is discarded unsent. */
const MIN_TAKE_MS = 250;

/** The speech-store key a voice answer plays under, so it never collides. */
export const voiceSpeechKey = (source: VoiceSpeakSource): string =>
	source.kind === "message"
		? `voice:message:${source.messageId}`
		: `voice:gate:${source.requestId}`;

function newRequestId(): string {
	return crypto.randomUUID().replace(/-/g, "");
}

/** The sentence a refused media call owes the reader, per voice code. */
function utteranceFailure(result: DesktopMediaResponse): string {
	if (result.kind === "error" && result.voiceCode === "voice_not_enabled")
		return t("ui.chat.voice.not_enabled");
	if (result.kind === "error" && result.voiceCode === "empty_transcript")
		return t("ui.chat.voice.empty_transcript");
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
	feedTurns(sessionId, { kind: "armed" });
	const requestId = newRequestId();
	const result =
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
	if (result.kind === "json" && result.status >= 200 && result.status < 300) {
		/*
		 * The phase moves to `working` unless the turn already ended and the answer
		 * is already being spoken (a fast turn beats this response home).
		 */
		if (useVoiceStore.getState().phase === "sending")
			useVoiceStore.getState().setPhase("working", sessionId);
		return { ok: true, status: result.status };
	}
	feedTurns(sessionId, { kind: "disarmed" });
	const sentence = utteranceFailure(result);
	if (result.kind === "error" && result.voiceCode === "empty_transcript") {
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
 * THE TURN STATE IS MODULE STATE, keyed by session, so the driver verb and the
 * hold path feed the same fold the stream watcher reads. It is dropped when the
 * slot leaves the session (a new holder starts clean).
 */
let turns: { sessionId: string; state: VoiceTurnsState } | null = null;
let speakSink: ((source: VoiceSpeakSource) => void) | null = null;

function feedTurns(sessionId: string, input: VoiceTurnsInput): void {
	if (turns?.sessionId !== sessionId)
		turns = { sessionId, state: initialVoiceTurns() };
	const step = stepVoiceTurns(turns.state, input);
	turns = { sessionId, state: step.state };
	for (const source of step.speak) speakSink?.(source);
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
		showWarningToast(t("ui.chat.voice.approval_waiting"));
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
		if (voice.phaseSessionId === sessionId) voice.setPhase("idle", null);
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
	const setActive = useVoiceStore((s) => s.setActive);
	const activeSessionId = status.activeSessionId;
	const feed = useDesktopFeed();

	// 1. The slot mirror: the feed's level frame wins over a stale poll.
	useEffect(() => {
		if (feed.voiceActive !== undefined) setActive(feed.voiceActive);
	}, [feed.voiceActive, setActive]);

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
				// still out (neither key set yet) is not the audio finishing.
				if (was && !is) voice.setPhase("idle", null);
			}),
		[],
	);

	// 2. The speak trigger, on the slot holder's own stream.
	useEffect(() => {
		if (!status.enabled || !activeSessionId) {
			turns = null;
			speakSink = null;
			return;
		}
		speakSink = (source) => void speakSource(activeSessionId, source);
		const dispose = subscribeVoiceStream(activeSessionId, (input) =>
			feedTurns(activeSessionId, input),
		);
		return () => {
			dispose();
			speakSink = null;
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

/** The hold key's label, for the toggle's hint. */
export const voiceHoldKeyLabel = (): string => resolvePushToTalkBinding().label;
