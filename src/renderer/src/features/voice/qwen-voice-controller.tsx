/**
 * QWEN VOICE'S CONTROLLER (the backend's `docs/design/qwen-voice.md`, Q4-Q8),
 * mounted ONCE at the app root so an exchange survives navigation.
 *
 * The path of one take, end to end:
 *
 *   rig hears words -> Gateway task -> main `voice.qwen.take {taskId, text}`
 *   -> HERE: echo guard -> `/voice/utterance` (text door, the slot session)
 *   -> `voice.qwen.result {taskId, ok | code}` (the launcher speaks a Q7 phrase)
 *   -> the take's own user message on the session stream binds the turn (V14)
 *   -> its last assistant message -> `/voice/text {kind: message}`
 *   -> `voice.qwen.speak {text, kind: reply}` -> Qwen3-TTS, word for word.
 *
 * An approval on the bound turn is announced the same way with `{kind: gate}`
 * and is answered ON SCREEN ONLY (V7): a spoken "yes" reaches `/utterance`,
 * which refuses it with 409 `approval_pending`.
 *
 * What it owns, and nothing else:
 *
 * 1. THE SLOT MIRROR: the feed's `voice` frame writes the store.
 * 2. THE RIG MIRROR: main's `voice.qwen.status` writes the store.
 * 3. THE SPEAK TRIGGER: one subscription to the slot session's stream, folded
 *    through `voice-turns.ts` (carried unchanged).
 * 4. THE ECHO GUARD (design "Risks"): a take whose words match 80% or more of
 *    anything this window had spoken in the last 30 s is dropped unsent - the
 *    microphone heard the reply - so the reply cannot steer the session.
 *
 * THERE IS NO PATH FROM HERE TO A GATE ANSWER. This file sends `voice.utterance`
 * (words in) and `voice.text` (a source reference out), and imports nothing that
 * can approve, deny or answer. `scripts/voice-turns.test.mjs` pins that by
 * reading this folder's source.
 */

import {
	desktopMedia,
	desktopResult,
	mediaError,
} from "@shared/api/local-operator/desktop-api";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { t } from "@shared/i18n";
import {
	dismissToast,
	showErrorToast,
	showInfoToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { type FC, useEffect, useRef } from "react";
import type {
	DesktopMediaResponse,
	QwenVoiceBridge,
	QwenVoiceStatus,
} from "../../../../shared/desktop-contract";
import type { DesktopVoiceText } from "../../../../shared/desktop-control-contract";
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

/** Main's rig bridge, or undefined outside Electron (browser development). */
const bridge = (): QwenVoiceBridge | undefined =>
	(window as { api?: { desktop?: { qwenVoice?: QwenVoiceBridge } } }).api
		?.desktop?.qwenVoice;

/**
 * The utterance's idempotency key: a DASHED lowercase UUID, exactly what
 * `crypto.randomUUID()` returns, the shape the route's `RequestID` validates.
 */
export function newVoiceRequestId(): string {
	return crypto.randomUUID();
}

/* -------------------------------------------------------------------------- */
/* THE ECHO GUARD                                                              */
/* -------------------------------------------------------------------------- */

/** How long a spoken text can come back through the microphone. */
export const ECHO_WINDOW_MS = 30_000;
/** The share of a take's words that must match a spoken text to be its echo. */
export const ECHO_THRESHOLD = 0.8;

const NON_WORD = /[^\p{L}\p{N}\s']/gu;
const WHITESPACE = /\s+/;

/** Lowercase words, punctuation dropped: what Parakeet and the reply share. */
export function echoWords(text: string): string[] {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(NON_WORD, " ")
		.split(WHITESPACE)
		.filter(Boolean);
}

/**
 * Whether `take` is an echo of `spoken`: 80% or more of the take's words appear,
 * IN ORDER, as a contiguous-enough run of the spoken text (the longest common
 * subsequence, over the take's length). Order matters because "yes do it" is
 * not an echo of a reply that merely contains those three words somewhere; a
 * take of one or two words is never judged an echo (it is too short to tell, and
 * dropping a real "stop" would be worse than relaying a stray "okay").
 */
export function isEcho(take: string, spoken: string): boolean {
	const a = echoWords(take);
	const b = echoWords(spoken);
	if (a.length < 3 || b.length === 0) return false;
	let previous = new Array<number>(b.length + 1).fill(0);
	for (let i = 1; i <= a.length; i += 1) {
		const row = new Array<number>(b.length + 1).fill(0);
		for (let j = 1; j <= b.length; j += 1) {
			row[j] =
				a[i - 1] === b[j - 1]
					? previous[j - 1] + 1
					: Math.max(previous[j], row[j - 1]);
		}
		previous = row;
	}
	return previous[b.length] / a.length >= ECHO_THRESHOLD;
}

/** What this window asked the rig to say, newest last, for the guard. */
const recentlySpoken: { text: string; at: number }[] = [];

export function rememberSpoken(text: string, now = Date.now()): void {
	recentlySpoken.push({ text, at: now });
	while (recentlySpoken.length > 16) recentlySpoken.shift();
}

/** The echo guard's verdict for one take, against the last 30 s of speech. */
export function takeIsEcho(text: string, now = Date.now()): boolean {
	return recentlySpoken.some(
		(entry) => now - entry.at <= ECHO_WINDOW_MS && isEcho(text, entry.text),
	);
}

/* -------------------------------------------------------------------------- */
/* THE TAKE PATH                                                               */
/* -------------------------------------------------------------------------- */

/** One take's outcome, as `voice.qwen.result` and the driver verb report it. */
export type VoiceTakeOutcome =
	| { ok: true; status: number; sessionId: string; requestId: string }
	| {
			ok: false;
			status: number;
			code: string;
			sessionId: string | null;
			detail?: string;
	  };

/** The sentence a refused take owes the reader, per voice code. */
function utteranceFailure(result: DesktopMediaResponse): string {
	if (result.kind === "error" && result.voiceCode === "voice_not_enabled")
		return t("ui.chat.voice.not_enabled");
	if (result.kind === "error" && result.voiceCode === "approval_pending")
		return t("ui.chat.voice.card_pending");
	if (result.kind === "error" && result.voiceCode === "empty_transcript")
		return t("ui.chat.voice.empty_transcript");
	return t("ui.chat.voice.utterance_failed", {
		reason: mediaError(result).message,
	});
}

/**
 * Send one take's words to the session holding the slot and arm the speak
 * trigger. The ONE take path: the rig's `voice.qwen.take` and the dev driver's
 * `voiceTake(text)` both come through here, so there is no second thing to
 * review.
 */
export async function sendVoiceTake(text: string): Promise<VoiceTakeOutcome> {
	const sessionId = useVoiceStore.getState().active?.session_id ?? null;
	if (!sessionId)
		return { ok: false, status: 0, code: "voice_not_enabled", sessionId };
	if (!text.trim())
		return { ok: false, status: 0, code: "empty_transcript", sessionId };
	/*
	 * A CARD ON SCREEN REFUSES WORDS (V13): the route would answer 409
	 * `approval_pending`, so the take is not sent at all - an approval or a
	 * blocking ask is answered on screen, and words must not withdraw it. The same
	 * code goes back to the launcher, which speaks its `on_screen_first` phrase.
	 */
	if (voiceCardPending(sessionId)) {
		showCardToast(sessionId, t("ui.chat.voice.card_pending"));
		return { ok: false, status: 409, code: "approval_pending", sessionId };
	}
	if (takeIsEcho(text)) {
		// The microphone heard the reply: relaying it would steer the session
		// with the agent's own words. Dropped unsent, and said so in the log.
		console.warn("[voice] take dropped by the echo guard");
		return { ok: false, status: 0, code: "echo", sessionId };
	}
	/*
	 * The id is minted BEFORE arming, because it is the binding: the server mints
	 * the take's user message with `message.id == request_id`, and only the turn
	 * whose stream carries that message answers this take (V14). Armed at send,
	 * not at the answer: a fast turn can beat the 200 home.
	 */
	const requestId = newVoiceRequestId();
	feedTurns(sessionId, { kind: "armed", requestId });
	scheduleTakeExpiry(sessionId, requestId);
	useVoiceStore.getState().setExchange("working", sessionId);
	let result: DesktopMediaResponse;
	try {
		result = await desktopMedia(
			{
				op: "voice.utterance",
				sessionId,
				requestId,
				text,
				textOrigin: "qwen_s2s",
			},
			null,
		);
	} catch (error) {
		// A thrown send is a failed send: nothing was admitted.
		feedTurns(sessionId, { kind: "disarmed", requestId });
		const reason = error instanceof Error ? error.message : String(error);
		useVoiceStore.getState().setExchange("error", sessionId);
		showErrorToast(t("ui.chat.voice.utterance_failed", { reason }));
		return { ok: false, status: 0, code: "failed", sessionId, detail: reason };
	}
	if (result.kind === "json" && result.status >= 200 && result.status < 300) {
		// `working` only while the session still owes an answer: a fast turn can
		// already have been spoken by the time this 200 lands.
		settleExchange(sessionId);
		return { ok: true, status: result.status, sessionId, requestId };
	}
	feedTurns(sessionId, { kind: "disarmed", requestId });
	const code =
		result.kind === "error" ? (result.voiceCode ?? "failed") : "failed";
	const sentence = utteranceFailure(result);
	if (code === "approval_pending") {
		// The card is on screen and blocking; the take changed nothing (V7, V13).
		settleExchange(sessionId);
		showCardToast(sessionId, sentence);
	} else if (code === "empty_transcript") {
		settleExchange(sessionId);
		showInfoToast(sentence);
	} else {
		useVoiceStore.getState().setExchange("error", sessionId);
		showErrorToast(sentence);
	}
	return {
		ok: false,
		status: result.status,
		code,
		sessionId,
		detail: result.kind === "error" ? result.detail : "",
	};
}

/** One rig take: the take path, then its admission back to the launcher. */
async function onRigTake(take: { taskId: string; text: string }) {
	const outcome = await sendVoiceTake(take.text);
	await bridge()?.result(
		outcome.ok
			? { taskId: take.taskId, ok: true }
			: { taskId: take.taskId, ok: false, code: outcome.code },
	);
}

/* -------------------------------------------------------------------------- */
/* THE TURN FOLD (per session, module state)                                   */
/* -------------------------------------------------------------------------- */

/*
 * KEPT ACROSS A SLOT ROUND-TRIP: A -> B -> A must not re-announce the gate A
 * already announced, nor re-speak a message A already spoke, so a session's
 * dedupe sets outlive the slot leaving it. What does NOT outlive it is the
 * in-flight part (`resetTurnFlight`). Bounded; the oldest session goes.
 */
const TURN_SESSIONS_KEPT = 8;
const turnsBySession = new Map<string, VoiceTurnsState>();
let speakSink: ((source: VoiceSpeakSource) => void) | null = null;

export function feedTurns(sessionId: string, input: VoiceTurnsInput): void {
	const before = turnsBySession.get(sessionId) ?? initialVoiceTurns();
	const step = stepVoiceTurns(before, input);
	clearTakeExpiry(before, step.state);
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
	// A take consumed (answered, interrupted, expired) settles the header.
	if (takeOutstanding(before) && !takeOutstanding(step.state))
		settleExchange(sessionId);
	for (const source of step.speak) speakSink?.(source);
}

/** `working` while the session still owes this window an answer, else rest. */
function settleExchange(sessionId: string): void {
	const voice = useVoiceStore.getState();
	if (voice.exchange && voice.exchange.sessionId !== sessionId) return;
	const owed = takeOutstanding(
		turnsBySession.get(sessionId) ?? initialVoiceTurns(),
	);
	voice.setExchange(owed ? "working" : null, sessionId);
}

const takeExpiry = new Map<string, ReturnType<typeof setTimeout>>();

/** Drop a take whose user row never arrived, after `VOICE_TAKE_ROW_TTL_MS`. */
function scheduleTakeExpiry(sessionId: string, requestId: string): void {
	const timer = setTimeout(() => {
		takeExpiry.delete(requestId);
		feedTurns(sessionId, { kind: "expired", requestId });
		if (turnsBySession.get(sessionId)?.takes.includes(requestId))
			scheduleTakeExpiry(sessionId, requestId);
	}, VOICE_TAKE_ROW_TTL_MS);
	(timer as { unref?: () => void }).unref?.();
	takeExpiry.set(requestId, timer);
}

function clearTakeExpiry(before: VoiceTurnsState, after: VoiceTurnsState) {
	for (const id of before.takes) {
		if (after.takes.includes(id)) continue;
		const timer = takeExpiry.get(id);
		if (timer === undefined) continue;
		clearTimeout(timer);
		takeExpiry.delete(id);
	}
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

/** Whether the slot session has a card pending, as its stream last said. */
export function voiceCardPending(sessionId: string): boolean {
	return Boolean(turnsBySession.get(sessionId)?.pendingCard);
}

/*
 * ONE TOAST PER SESSION FOR "A CARD IS ON SCREEN": the gate's announcement and
 * a refused take say the same thing, so they share an id and the later replaces
 * the earlier.
 */
export const voiceCardToastId = (sessionId: string): string =>
	`voice-card:${sessionId}`;

function showCardToast(sessionId: string, message: string): void {
	showWarningToast(message, { id: voiceCardToastId(sessionId) });
}

/* -------------------------------------------------------------------------- */
/* SPEAKING                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Speak one source reference: the server resolves the words (`/voice/text`),
 * main checks they are the words it just relayed, and the rig says them. The
 * renderer never composes what is spoken.
 */
async function speakSource(
	sessionId: string,
	source: VoiceSpeakSource,
): Promise<void> {
	if (source.kind === "gate") {
		// The announcement's on-screen half: the approval card is the only answer.
		showCardToast(sessionId, t("ui.chat.voice.approval_waiting"));
	}
	let spoken: DesktopVoiceText;
	try {
		spoken = await desktopResult<DesktopVoiceText>({
			op: "voice.text",
			sessionId,
			source,
		});
	} catch (error) {
		// The slot moved mid-answer, or the source is gone: silence, not an error.
		console.warn(
			`[voice] nothing to speak: ${error instanceof Error ? error.message : String(error)}`,
		);
		return;
	}
	// The slot moved while the text was out: the old session is not spoken.
	if (useVoiceStore.getState().active?.session_id !== sessionId) return;
	const kind = source.kind === "gate" ? "gate" : "reply";
	rememberSpoken(spoken.text);
	const answer = await bridge()?.speak({ text: spoken.text, kind });
	if (answer && !answer.spoken)
		console.warn(`[voice] the rig did not speak: ${answer.reason ?? ""}`);
}

/** Ask main to start the rig for the slot already held (the relaunch case). */
export async function startQwenRig(): Promise<void> {
	const status = await bridge()?.start();
	if (status) useVoiceStore.getState().setRig(status);
}

/* -------------------------------------------------------------------------- */
/* THE COMPONENT                                                               */
/* -------------------------------------------------------------------------- */

export const QwenVoiceController: FC = () => {
	const status = useVoiceStatus();
	const activeSessionId = status.activeSessionId;
	const feed = useDesktopFeed();

	// 1. The slot mirror: the feed's level frame goes into the one cache entry.
	const client = useQueryClient();
	useEffect(() => {
		if (feed.voiceActive !== undefined)
			applyVoiceActive(feed.voiceActive, client);
	}, [feed.voiceActive, client]);

	// 2. The rig mirror, and the takes main relays from the rig.
	useEffect(() => {
		const rig = bridge();
		if (!rig) return;
		const setRig = (next: QwenVoiceStatus) =>
			useVoiceStore.getState().setRig(next);
		void rig.getStatus().then(setRig, () => undefined);
		const offStatus = rig.onStatus(setRig);
		const offTake = rig.onTake((take) => void onRigTake(take));
		return () => {
			offStatus();
			offTake();
		};
	}, []);

	// 3. The speak trigger, on the slot holder's own stream.
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
				if (status === "recovered") {
					dismissToast(lostToastId);
					return;
				}
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
		};
	}, [status.enabled, activeSessionId]);

	/*
	 * THE WAY BACK FROM `exhausted`: a watcher that gave up is retried when the
	 * window regains focus and when the machine feed reconnects. `retry()` is a
	 * no-op unless the watcher is exhausted.
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

	return null;
};
