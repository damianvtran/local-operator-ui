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
 *   -> `voice.qwen.speak {text, kind: reply}` -> Qwen3-TTS, verbatim up to
 *      whitespace normalisation.
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
 * 4. THE ECHO GUARD (design "Risks"): a take that is one of the rig's own Q7
 *    phrases, or a reply or gate text this window had spoken in the last 30 s,
 *    is dropped unsent and silently - the microphone heard the rig - so the
 *    rig's own speech never steers the session or answers itself.
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
import { useNavigate } from "react-router-dom";
import QWEN_PHRASES from "../../../../../resources/qwen-voice/phrases.json";
import type {
	DesktopMediaResponse,
	QwenVoiceBridge,
	QwenVoiceStatus,
} from "../../../../shared/desktop-contract";
import type { DesktopVoiceText } from "../../../../shared/desktop-control-contract";
import { applyVoiceActive, useVoiceStatus } from "./use-voice-status";
import { playReplyEndTone } from "./voice-earcons";
import { activityOfEvent, useVoiceStore } from "./voice-store";
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

/**
 * How long a spoken text can come back through the microphone AFTER it has
 * finished playing. The launcher does not report the end of playback, so the
 * playback itself is estimated from the word count (`speechMs`) and added.
 */
export const ECHO_WINDOW_MS = 30_000;
/** Qwen3-TTS speaks at roughly 2.5 words a second. */
export const ECHO_WORDS_PER_SECOND = 2.5;

/** How long the rig takes to say `text`, estimated from its words. */
export function speechMs(text: string): number {
	return Math.ceil((echoWords(text).length / ECHO_WORDS_PER_SECOND) * 1000);
}
/** The shortest run of shared words that can make a longer take an echo. */
export const ECHO_MIN_RUN = 6;
/** The share of a take's words that run must cover. */
export const ECHO_COVERAGE = 0.8;

const NON_WORD = /[^\p{L}\p{N}\s']/gu;
const WHITESPACE = /\s+/;
/** A sentence ends at `.`, `!` or `?` followed by space or the end ("plan.txt" does not). */
const SENTENCE_END = /(?<=[.!?])\s+/u;

/*
 * Contractions spelled out, so "Voice's off" and "Voice is off" are the same
 * words. Applied after lower-casing; the apostrophe is the one punctuation mark
 * `NON_WORD` keeps so that this can run.
 */
const CONTRACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bcan't\b/g, "can not"],
	[/\bwon't\b/g, "will not"],
	[/n't\b/g, " not"],
	[/'re\b/g, " are"],
	[/'s\b/g, " is"],
	[/'ll\b/g, " will"],
	[/'ve\b/g, " have"],
	[/'m\b/g, " am"],
	[/'d\b/g, " would"],
];

/** Lowercase words, punctuation dropped: what Parakeet and the reply share. */
export function echoWords(text: string): string[] {
	let value = text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u2018\u2019]/g, "'");
	for (const [pattern, spelled] of CONTRACTIONS)
		value = value.replace(pattern, spelled);
	return value
		.replace(NON_WORD, " ")
		.replace(/'/g, "")
		.split(WHITESPACE)
		.filter(Boolean);
}

const echoKey = (text: string): string => echoWords(text).join(" ");

/* -------- the fuzzy match for SHORT takes (QA round 2, Q10) ---------------- */

/** Edit distance allowed for a one-word phrase ("Switched." heard as "Switch."). */
export const ECHO_WORD_EDITS = 2;
/** Word-level similarity a multi-word short take needs ("Voices off ..."). */
export const ECHO_WORD_SIMILARITY = 0.8;

/** Levenshtein distance between two strings (characters or word arrays). */
function editDistance<T>(
	a: ArrayLike<T>,
	b: ArrayLike<T>,
	same: (x: T, y: T) => boolean,
): number {
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i += 1) {
		const row = [i];
		for (let j = 1; j <= b.length; j += 1)
			row[j] = Math.min(
				previous[j] + 1,
				row[j - 1] + 1,
				previous[j - 1] + (same(a[i - 1], b[j - 1]) ? 0 : 1),
			);
		previous = row;
	}
	return previous[b.length];
}

const charDistance = (a: string, b: string): number =>
	editDistance(a, b, (x, y) => x === y);

/*
 * Two words are "the same word heard" when they are equal, or when both are
 * long enough to carry a mishearing (4+ letters) and differ by one edit:
 * "voices"/"voice", "scent"/"sent". Short words must match exactly, so "is"
 * never stands in for "it".
 */
const sameHeardWord = (a: string, b: string): boolean =>
	a === b || (a.length >= 4 && b.length >= 4 && charDistance(a, b) <= 1);

/**
 * Whether a SHORT take is the rig's `target` misheard by Parakeet. A one-word
 * target allows `ECHO_WORD_EDITS` character edits against a one-word take; a
 * longer target needs a word-level similarity of `ECHO_WORD_SIMILARITY`
 * (1 - word edits / longer length, with misheard words counted as equal).
 */
export function isHeardAs(take: string[], target: string[]): boolean {
	if (take.length === 0 || target.length === 0) return false;
	/*
	 * One word: up to `ECHO_WORD_EDITS` edits AND the same first letter. The
	 * letter is what keeps a real one-word command two edits from a phrase from
	 * being dropped ("test", "next", "best", "end" sat within two edits of the
	 * removed "Sent."), while every measured mishearing keeps the first letter
	 * ("Switch.", "switched").
	 */
	if (target.length === 1)
		return (
			take.length === 1 &&
			take[0][0] === target[0][0] &&
			charDistance(take[0], target[0]) <= ECHO_WORD_EDITS
		);
	const edits = editDistance(take, target, sameHeardWord);
	return (
		1 - edits / Math.max(take.length, target.length) >= ECHO_WORD_SIMILARITY
	);
}

/**
 * THE RIG'S OWN PHRASES (Q7), the closed set the launcher speaks from the same
 * file. A take that IS a phrase (after normalisation) is an echo at any time: a
 * person does not say "Answer it on screen first." to their own agent, and
 * relaying it is what made the rig answer itself in a loop (QA round 1, Q4).
 */
const PHRASE_WORDS: ReadonlyArray<string[]> = Object.values(
	QWEN_PHRASES as Record<string, string>,
).map(echoWords);
const PHRASE_KEYS: ReadonlySet<string> = new Set(
	PHRASE_WORDS.map((words) => words.join(" ")),
);

export function isQwenPhrase(take: string): boolean {
	const key = echoKey(take);
	return key.length > 0 && PHRASE_KEYS.has(key);
}

/**
 * A take that is a phrase as Parakeet MISHEARS it ("Scent", "Voices off for
 * this conversation.", QA round 2, Q10). Only trusted right after the rig
 * spoke a phrase (`PHRASE_ECHO_WINDOW_MS`): at any other time "sync", "set" or
 * "switch" is the user, and dropping it silently and repeatedly reads as voice
 * being broken (review round 3, M1).
 */
export function isQwenPhraseHeard(take: string): boolean {
	const words = echoWords(take);
	return PHRASE_WORDS.some((phrase) => isHeardAs(words, phrase));
}

/**
 * How long after the launcher speaks a phrase its mishearing can come back:
 * a phrase is at most 6 words (~2.5 s of speech), then Parakeet's end of turn.
 */
export const PHRASE_ECHO_WINDOW_MS = 10_000;

/*
 * When the launcher last spoke a phrase, as far as this window can tell: it
 * speaks one for a refusal that is not an echo, cancel or close (relay-core
 * `phraseForOutcome`), and "Switched." on a slot change between two sessions.
 * A successful take speaks nothing.
 */
let phraseSpokenAt: number | null = null;

export function markPhraseSpoken(now = Date.now()): void {
	phraseSpokenAt = now;
}

function phraseJustSpoken(now: number): boolean {
	return (
		phraseSpokenAt !== null &&
		now >= phraseSpokenAt &&
		now - phraseSpokenAt <= PHRASE_ECHO_WINDOW_MS
	);
}

/**
 * s2s's `--max_speech_ms` cap. It is a SAFETY NET, not a normal bound (review
 * BRIEF-1): segments soft-end through smart-turn at ~10.6 s, and QA's 60 s take
 * produced no discard at all. A segment that DOES reach the cap is thrown away
 * whole by the VAD with no take and no error, so the app owes the person a line
 * instead of silence. Rare, therefore cheap.
 */
export const LONG_TAKE_MS = 30_000;

/** The line the strip owes after a dropped take, as its catalogue key. */
export function takeDroppedNotice(): string {
	return t("ui.chat.voice.take_too_long");
}

let speechSegmentStartedAt: number | null = null;

/**
 * Fold one speech event into the drop guard, on the Gateway's clock.
 *
 * WHY DURATION AND NOT "NO TAKE ARRIVED": a take reaches this window seconds
 * after the segment ends (STT runs first), so "no take yet" cannot be told apart
 * from "take still transcribing". A segment at the cap is exactly what the VAD
 * throws away when it does throw one away, so its length is the only local
 * evidence. Returns the time of the drop, or null when this event says nothing.
 */
export function noteSpeechSegment(type: string, at: number): number | null {
	if (type === "realtime.provider.speech_started") {
		speechSegmentStartedAt = at;
		return null;
	}
	if (type !== "realtime.provider.speech_stopped") return null;
	const started = speechSegmentStartedAt;
	speechSegmentStartedAt = null;
	if (started === null) return null;
	return at - started >= LONG_TAKE_MS ? at : null;
}

/** The longest run of consecutive words `a` and `b` share. */
function longestSharedRun(a: string[], b: string[]): number {
	let best = 0;
	let previous = new Array<number>(b.length + 1).fill(0);
	for (let i = 1; i <= a.length; i += 1) {
		const row = new Array<number>(b.length + 1).fill(0);
		for (let j = 1; j <= b.length; j += 1) {
			if (a[i - 1] !== b[j - 1]) continue;
			row[j] = previous[j - 1] + 1;
			if (row[j] > best) best = row[j];
		}
		previous = row;
	}
	return best;
}

/**
 * Whether `take` is an echo of `spoken`, the rule round 1 settled on: the take
 * must BE the spoken text, not merely share its vocabulary.
 *
 * - A take of `ECHO_MIN_RUN` (6) words or more is an echo when one CONTIGUOUS
 *   run of words it shares with the spoken text is at least 6 words long and
 *   covers at least 80% of the take. Contiguous, not a subsequence: the earlier
 *   in-order-subsequence ratio dropped real follow-ups such as "can you mock the
 *   clock" after a reply that happened to contain "mock the clock".
 * - A shorter take is an echo only when it equals the whole spoken text, or one
 *   of its sentences under 6 words. Too few words to tell otherwise, and
 *   dropping a real "stop" is worse than relaying a stray fragment.
 */
export function isEcho(take: string, spoken: string): boolean {
	const a = echoWords(take);
	const b = echoWords(spoken);
	if (a.length === 0 || b.length === 0) return false;
	if (a.length < ECHO_MIN_RUN) {
		/*
		 * EXACT, not fuzzy (review round 3, m1): a reply sentence is open text,
		 * so a near match is as likely the user answering it - "should I fix the
		 * parser" after "Should I fix the loader?", "fix" after "Fixed." - as
		 * its echo. Only the whole text, or one whole short sentence of it.
		 */
		const key = a.join(" ");
		if (key === b.join(" ")) return true;
		return spoken
			.split(SENTENCE_END)
			.map(echoWords)
			.some((part) => part.length < ECHO_MIN_RUN && part.join(" ") === key);
	}
	const run = longestSharedRun(a, b);
	return run >= ECHO_MIN_RUN && run / a.length >= ECHO_COVERAGE;
}

/** What this window asked the rig to say, newest last, for the guard. */
const recentlySpoken: { text: string; at: number }[] = [];

export function rememberSpoken(text: string, now = Date.now()): void {
	recentlySpoken.push({ text, at: now });
	while (recentlySpoken.length > 16) recentlySpoken.shift();
}

/**
 * The echo guard's verdict for one take: a Q7 phrase at any time; a misheard
 * phrase within `PHRASE_ECHO_WINDOW_MS` of the rig speaking one; or a reply or
 * gate text this window had the rig say, within its estimated playback plus
 * 30 s (review round 2, minor 2: a long reply still plays after 30 s).
 */
export function takeIsEcho(text: string, now = Date.now()): boolean {
	if (isQwenPhrase(text)) return true;
	if (phraseJustSpoken(now) && isQwenPhraseHeard(text)) return true;
	return recentlySpoken.some(
		(entry) =>
			now - entry.at <= ECHO_WINDOW_MS + speechMs(entry.text) &&
			isEcho(text, entry.text),
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
	/*
	 * THE ECHO GUARD RUNS FIRST, before the slot and card checks, because each of
	 * those answers with a phrase the rig speaks aloud: an echoed "Answer it on
	 * screen first." refused at the card, or "Voice is off for this
	 * conversation." refused for an empty slot, would be spoken again and heard
	 * again, forever (QA round 1, Q4). `echo` is a SILENT drop: the launcher says
	 * nothing for it, and nothing is sent.
	 */
	if (takeIsEcho(text)) {
		console.warn("[voice] take dropped by the echo guard");
		return { ok: false, status: 0, code: "echo", sessionId };
	}
	if (!sessionId)
		return { ok: false, status: 0, code: "voice_not_enabled", sessionId };
	/*
	 * PAUSED ADMITS NO TAKES. The page that would hear one is closed, so a take
	 * arriving here is a stale one - and admitting it would put "Working" up for
	 * words nobody heard. Silent, like the echo guard: there is nothing to say.
	 */
	if (useVoiceStore.getState().rig?.paused)
		return { ok: false, status: 0, code: "paused", sessionId };
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
		useVoiceStore.getState().noteNotSent(sessionId, text, Date.now());
		return { ok: false, status: 409, code: "approval_pending", sessionId };
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
	/* The strip's subject and the history's `You:` half, from the same call. */
	useVoiceStore.getState().noteTake(sessionId, text, Date.now());
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
		useVoiceStore.getState().setExchange("error", sessionId, "not_sent");
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
		useVoiceStore.getState().setExchange("error", sessionId, "not_sent");
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
	/*
	 * A SUCCESS IS SILENT (plan §7), and so are an echo, a cancel and a close;
	 * every other refusal is answered with a phrase, and only then can that
	 * phrase be heard back. Marking a success as "a phrase was spoken" held the
	 * one-word echo rule over the next ten seconds of real speech.
	 */
	const spoken =
		!outcome.ok &&
		!["echo", "cancelled", "closed", "paused"].includes(outcome.code);
	if (spoken) markPhraseSpoken();
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

/** The router's navigate, set by the mounted controller (it sits inside the router). */
let openSession: ((sessionId: string) => void) | null = null;

/**
 * Go to the conversation that holds the slot, for the composer's "Go there".
 * The chat page installs the navigator while its controller is mounted (see
 * `QwenVoiceController`), so this is the same door the card toast's "Open" uses.
 */
export function openVoiceSession(sessionId: string): void {
	openSession?.(sessionId);
}

/** The session the window shows now, from the `HashRouter` URL. */
const VIEWED_CHAT = /^#\/chat\/([^/?#]+)/;
export function viewedSessionId(
	hash = globalThis.location?.hash ?? "",
): string | null {
	const match = VIEWED_CHAT.exec(hash);
	return match ? decodeURIComponent(match[1]) : null;
}

/*
 * ONLY WHEN BEN IS ELSEWHERE (round 1, U5/D7): inside the voice session the
 * header's own hint says "Answer on screen first." beside the card itself, so
 * a toast there repeats it. Elsewhere the toast is how he learns of the card,
 * and its "Open" action takes him to it.
 */
function showCardToast(sessionId: string, message: string): void {
	if (viewedSessionId() === sessionId) return;
	showWarningToast(message, {
		id: voiceCardToastId(sessionId),
		action: {
			label: t("ui.chat.voice.open_session"),
			onClick: () => openSession?.(sessionId),
		},
	});
}

/* -------------------------------------------------------------------------- */
/* SPEAKING                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Whether the server cut the spoken text at its cap (plan §8). An absent field
 * is "not cut": the backend slice that adds `truncated` lands in parallel, so a
 * reply without it is the normal case, not an error.
 */
export function spokenTruncated(
	spoken: DesktopVoiceText | null | undefined,
): boolean {
	return spoken?.truncated === true;
}

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
	/*
	 * THE CUT FLAG (plan §8): the server says whether the spoken text was cut at
	 * the cap, and the panel marks it. Absent means not cut - the backend slice
	 * that adds the field lands in parallel, so the missing case is the normal
	 * one until it ships.
	 */
	useVoiceStore.getState().setLastSpoken({
		sessionId,
		text: spoken.text,
		truncated: spokenTruncated(spoken),
		at: Date.now(),
	});
	const answer = await bridge()?.speak({ text: spoken.text, kind });
	if (answer && !answer.spoken)
		console.warn(`[voice] the rig did not speak: ${answer.reason ?? ""}`);
}

/**
 * Open the OS microphone pane. Main owns the URL (a fixed constant); the
 * renderer names no scheme, so this is not the vetted `open-external` door.
 */
export async function openMicrophoneSettings(): Promise<void> {
	await bridge()?.openMicrophoneSettings();
}

/** Ask main to start the rig for the slot already held (the relaunch case). */
export async function startQwenRig(): Promise<void> {
	const status = await bridge()?.start();
	if (status) useVoiceStore.getState().setRig(status);
}

/**
 * THE STRIP'S TWO CONTROLS (design spec §4). Main owns both and answers with the
 * new status, which is mirrored at once so the chip and the buttons move
 * without waiting for a push (the push follows and agrees).
 *
 * PAUSE closes the app's hidden voice page: the microphone is released - which
 * is what lets this window dictate again - and the Gateway and the models stay
 * warm. Resume recreates the page through the same path as Retry.
 */
export async function pauseQwenVoice(): Promise<void> {
	const status = await bridge()?.pause();
	if (status) useVoiceStore.getState().setRig(status);
}

export async function resumeQwenVoice(): Promise<void> {
	const status = await bridge()?.resume();
	if (status) useVoiceStore.getState().setRig(status);
}

/** Silence Qwen's own speech (the page's audio), not this app's. */
export async function setQwenMuted(muted: boolean): Promise<void> {
	const status = await bridge()?.setMuted(muted);
	if (status) useVoiceStore.getState().setRig(status);
}

/* -------------------------------------------------------------------------- */
/* THE COMPONENT                                                               */
/* -------------------------------------------------------------------------- */

export const QwenVoiceController: FC = () => {
	const status = useVoiceStatus();
	const activeSessionId = status.activeSessionId;
	const feed = useDesktopFeed();
	const navigate = useNavigate();
	useEffect(() => {
		openSession = (sessionId) =>
			navigate(`/chat/${encodeURIComponent(sessionId)}`);
		return () => {
			openSession = null;
		};
	}, [navigate]);

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
		/*
		 * THE RIG'S OWN AUDIO EVENTS (plan §8/§10): only the Gateway knows when
		 * sound is actually moving, so the header's "Hearing you" and "Speaking"
		 * come from here, and a finished reply plays the end tone. A cancelled
		 * playback clears the phase and stays silent.
		 */
		const offEvent = rig.onEvent((event) => {
			const next = activityOfEvent(event.type);
			if (next !== null)
				useVoiceStore.getState().setActivity(next === "idle" ? null : next);
			/*
			 * THE PLAYBACK'S OWN CLOCK (design D2/D3): "Reply ended" and "Interrupted
			 * at m:ss" are said for a fixed beat and then replaced by "Listening", so
			 * the two moments they are said about are recorded where the events arrive
			 * rather than re-derived in the strip. The rig's `at` is the Gateway's
			 * clock; a frame without a parseable one falls back to this window's, which
			 * only costs the interruption's seconds their precision.
			 */
			const at = Date.parse(event.at);
			const playedAt = Number.isFinite(at) ? at : Date.now();
			const holder = useVoiceStore.getState().active?.session_id;
			if (holder) {
				if (event.type === "realtime.playback.started")
					useVoiceStore.getState().notePlayback("started", holder, playedAt);
				else if (
					event.type === "realtime.playback.ended" &&
					event.accepted === true
				)
					useVoiceStore.getState().notePlayback("ended", holder, playedAt);
				else if (event.type === "realtime.playback.cancelled")
					useVoiceStore.getState().notePlayback("cancelled", holder, playedAt);
			}
			/*
			 * A LONG TAKE IS DROPPED BY THE VAD (BRIEF-1): the segment never
			 * becomes a take, so the only evidence is its own duration against the
			 * cap. The strip says so instead of leaving a silent failure.
			 */
			if (Number.isFinite(at)) {
				const dropped = noteSpeechSegment(event.type, at);
				if (dropped !== null) useVoiceStore.getState().setDroppedTake(dropped);
			}
			/*
			 * THE END CUE NEEDS AN ACCEPTED RECEIPT (review M1): the Gateway logs
			 * `playback.ended` even for a response this connection was not
			 * playing, and a tone for that would announce a reply that never
			 * happened here.
			 */
			if (event.type === "realtime.playback.ended" && event.accepted === true)
				void playReplyEndTone();
		});
		return () => {
			offStatus();
			offTake();
			offEvent();
		};
	}, []);

	// The launcher says "Switched." when the slot moves between two sessions.
	const lastSlot = useRef<string | null>(null);
	useEffect(() => {
		const next = activeSessionId ?? null;
		if (lastSlot.current !== null && next !== null && next !== lastSlot.current)
			markPhraseSpoken();
		lastSlot.current = next;
	}, [activeSessionId]);

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
