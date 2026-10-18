/**
 * SESSION VOICE IN THE COMPOSER (design spec `voice-composer/SPEC.md`, 2026-10-18).
 *
 * The session header used to carry the voice control and the phase word. Both
 * moved into the composer, because both describe the BOX the person is typing
 * into: the strip sits above the textarea, the wave button sits between the
 * dictation mic and Send, and the sidebar keeps its row marker.
 *
 * THREE SURFACES, ONE COMPONENT, because they are one state read three ways and
 * a split would let them disagree:
 *
 *   - `VoiceComposerStrip` - the 40px band inside the box: a state chip, a
 *     caption, History, and (on a failure) one text action. It also owns the
 *     history panel and the "voice is on in another session" notice.
 *   - `ComposerVoiceButton` - the wave toggle, `AudioLines` in both states, off
 *     at `ink-dim` and on at the existing pressed pair. Its click is the old
 *     header toggle's click, moved rather than copied.
 *
 * WHAT IS DEGRADED, and why (spec §2's own "not available" list):
 *   - LIVE PARTIAL TRANSCRIPTS were never wired, so "Hearing you" carries no
 *     text; the word and the solid chip are the whole claim.
 *   - PLAYBACK LEVEL is not wired either, so the speaking chip's bars show
 *     ACTIVITY only, and the listening level dot holds a fixed size.
 *   - PAUSE AND SPEAKER MUTE need a rig control this app does not have (the
 *     only voice routes are status, control, utterance and text), so the strip
 *     does not draw them: an inert Pause would re-enable dictation while the rig
 *     still holds the microphone, which is the double capture the coexistence
 *     rule exists to prevent. Turning voice off is the escape, and the mic's
 *     tooltip names it.
 */

import {
	DesktopControlError,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { type WithoutParams, formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast, showInfoToast } from "@shared/utils/toast-manager";
import {
	AudioLines,
	Check,
	ChevronDown,
	ChevronUp,
	MicOff,
	Pause,
	Play,
	Square,
	TriangleAlert,
	Volume2,
	VolumeX,
} from "lucide-react";
import {
	type FC,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { QwenVoiceStatus } from "../../../../shared/desktop-contract";
import type { DesktopVoiceActive } from "../../../../shared/desktop-control-contract";
import {
	openMicrophoneSettings,
	openVoiceSession,
	pauseQwenVoice,
	resumeQwenVoice,
	setQwenMuted,
	startQwenRig,
} from "./qwen-voice-controller";
import { controlVoice, useVoiceCapability } from "./use-voice-status";
import {
	type VoiceExchangeError,
	type VoiceStoryRow,
	type VoiceTick,
	useVoiceStore,
	voicePhaseOf,
} from "./voice-store";

/**
 * A conversation's display title, or null when it has none. The callers pick a
 * whole sentence for each case: a title is quoted, and the untitled case is its
 * own sentence rather than a phrase spliced into quotes.
 */
export function voiceSessionTitle(sessionId: string | null): string | null {
	if (!sessionId) return null;
	const row = useCanonicalSessionsStore
		.getState()
		.sessions.find((session) => session.session_id === sessionId);
	const title = row?.title?.trim();
	return title ? title : null;
}

/**
 * WHY DICTATION IS OFF WHILE VOICE IS ON (spec §3), as the one sentence the
 * microphone's tooltip shows. Two cases, because the escape differs: here, turn
 * voice off; elsewhere, either move the slot here (dictation stays off, the rig
 * still owns the microphone) or turn voice off there.
 *
 * The title is the holder's own; `null` is the untitled conversation, which gets
 * a whole phrase rather than a spliced quote.
 */
export function dictationOffReason(
	onHere: boolean,
	holderTitle: string | null,
): string {
	if (onHere) return t("ui.chat.voice.dictation_off_voice");
	return t("ui.chat.voice.dictation_off_voice_elsewhere", {
		title: holderTitle ?? t("ui.chat.voice.another_conversation"),
	});
}

/* -------------------------------------------------------------------------- */
/* THE VIEW MODEL                                                              */
/* -------------------------------------------------------------------------- */

/** What the chip draws: its word, its ground and its mark. */
export type VoiceChipKind =
	| "starting"
	| "listening"
	| "hearing"
	| "working"
	| "speaking"
	| "ended"
	| "interrupted"
	| "approval"
	| "mic_blocked"
	| "waiting_mic"
	| "unheard"
	| "error"
	| "stopped"
	| "paused"
	| "connecting"
	| "silenced";

/** The caption's sentence, as a case rather than a string. */
export type VoiceCaption =
	| { kind: "idle" }
	| { kind: "starting" }
	| { kind: "heard"; text: string }
	| { kind: "said"; text: string }
	| { kind: "ended"; text: string | null }
	| { kind: "interrupted"; seconds: number }
	| { kind: "not_sent"; text: string | null }
	| { kind: "mic_blocked" }
	| { kind: "waiting_mic" }
	| { kind: "connecting" }
	| { kind: "silenced" }
	| { kind: "reason"; text: string };

export type VoiceComposerView =
	| { kind: "off" }
	| { kind: "elsewhere"; holder: string; holderTitle: string | null }
	| {
			kind: "here";
			chip: VoiceChipKind;
			caption: VoiceCaption | null;
			/** The one action this state offers: a failure's remedy, or the card. */
			action: "retry" | "try_again" | "settings" | "start" | "approve" | null;
			/** The reply was cut at the cap and the next take has not started. */
			cut: boolean;
	  };

/**
 * The reason an error shows as visible text. A RIG error wins, and shows the
 * rig's own sentence ("Port 8765 is in use; ...") because the cause is what the
 * reader can act on; the generic line is only the fallback.
 */
function errorReason(
	rig: QwenVoiceStatus | undefined,
	exchange: string | undefined,
): string {
	if (rig?.rig === "error") {
		if (rig.cause === "unexpected_exit") return t("ui.chat.voice.error_exited");
		const reason = rig.reason?.trim();
		return reason
			? reason.charAt(0).toUpperCase() + reason.slice(1)
			: t("ui.chat.voice.error_start_failed");
	}
	if (exchange === "not_sent") return t("ui.chat.voice.error_not_sent");
	return t("ui.chat.voice.error_start_failed");
}

/**
 * How long a ready rig with no connected page reads as CONNECTING rather than as
 * the "not connected" failure (design D2 / UX round 1, U8). Measured at ~200 ms
 * on a successful start; the grace is generous enough to cover a retried page
 * and short enough that a page that truly never arrives still offers Retry.
 */
export const PAGE_CONNECT_GRACE_MS = 5_000;

/**
 * Where the strip is, from the one state the slot, the rig and the exchange are
 * mirrored into. Derived, never stored, so the three cannot disagree - the same
 * rule `voicePhaseOf` keeps, extended with the two transient words and the cut
 * chip.
 *
 * `now` is passed rather than read so a test can hold the two beats at their
 * boundaries; the component supplies `Date.now()`.
 */
export function composerVoiceView(
	state: {
		active: DesktopVoiceActive | null | undefined;
		rig: QwenVoiceStatus | undefined;
		exchange: {
			kind: "working" | "error";
			sessionId: string;
			reason?: VoiceExchangeError;
		} | null;
		activity: "speaking" | "hearing" | null;
		cardPending: Record<string, true>;
		lastTake: { sessionId: string; text: string; at: number } | null;
		lastSpoken: {
			sessionId: string;
			text: string;
			truncated: boolean;
			at: number;
		} | null;
		/** The take a card refused, for the band's own refusal line (U1). */
		lastRefused: { sessionId: string; text: string; at: number } | null;
		/** The speaker mute (D7): a muted reply is "Silenced", not "Speaking". */
		muted: boolean;
		/** When the rig became ready, for the page-connect grace (D2/U8). */
		readyAt: number | null;
		tick: VoiceTick | null;
	},
	sessionId: string | undefined,
	now: number,
): VoiceComposerView {
	const holder = state.active?.session_id ?? null;
	if (!sessionId) return { kind: "off" };
	if (!holder || holder !== sessionId) {
		/*
		 * THE MICROPHONE IS APP-GLOBAL AND IS DRAWN BEFORE THE ELSEWHERE NOTICE (QA
		 * round 3, Q-1): during a start the slot has not moved yet, so a clicked
		 * conversation fell through to "off" - "Start voice" over a live OS dialog.
		 * A denial is the same app-wide fact. Nothing was spoken in THIS session, so
		 * there is no cut chip to carry.
		 */
		if (state.rig?.mic === "denied")
			return {
				kind: "here",
				chip: "mic_blocked",
				caption: { kind: "mic_blocked" },
				action: "settings",
				cut: false,
			};
		if (state.rig?.mic === "prompting")
			return {
				kind: "here",
				chip: "waiting_mic",
				caption: { kind: "waiting_mic" },
				action: "settings",
				cut: false,
			};
		if (!holder) return { kind: "off" };
		return {
			kind: "elsewhere",
			holder,
			holderTitle: voiceSessionTitle(holder),
		};
	}

	/*
	 * THE CUT CHIP OUTLIVES THE REPLY, and only the next take retires it: the
	 * spoken tail is gone in four seconds, and "the rest is above" is the one
	 * fact the person needs afterwards (design D1).
	 */
	const cut =
		state.lastSpoken !== null &&
		state.lastSpoken.sessionId === sessionId &&
		state.lastSpoken.truncated &&
		(state.lastTake === null || state.lastTake.at < state.lastSpoken.at);

	const take = state.lastTake?.sessionId === sessionId ? state.lastTake : null;
	const spoken =
		state.lastSpoken?.sessionId === sessionId ? state.lastSpoken : null;
	const refused =
		state.lastRefused?.sessionId === sessionId ? state.lastRefused : null;
	/*
	 * A READY RIG WITH NO PAGE IS A START FOR A MOMENT (design D2 / UX round 1,
	 * U8): the page is created and connects ~200 ms after the models are up, so
	 * "Voice page not connected" + Retry would flash on every successful start.
	 * The grace belongs to the ready TRANSITION, so a page that drops later still
	 * says it at once.
	 */
	const connecting =
		state.rig?.rig === "ready" &&
		(state.rig.clients ?? 0) === 0 &&
		state.readyAt !== null &&
		now - state.readyAt < PAGE_CONNECT_GRACE_MS;

	/*
	 * THE BASE WORD IS `voicePhaseOf`'s, NOT A SECOND COPY OF ITS PRECEDENCE. That
	 * derivation carries three corrections this strip must not re-decide: a rig
	 * error wins over a stale take error (U9), the microphone's prompt and denial
	 * outrank the ready words (M3), and audio actually moving beats "Working"
	 * (a barge-in or a reply being played is what the person is hearing). The
	 * strip then layers the two transient words and the card on top.
	 */
	const phase = voicePhaseOf(state, sessionId);

	switch (phase) {
		case "error":
			return {
				kind: "here",
				chip: "error",
				caption: {
					kind: "reason",
					text: errorReason(state.rig, state.exchange?.reason),
				},
				/* "Try again" restarts the RIG; a failed take has nothing to restart. */
				action: state.rig?.rig === "error" ? "try_again" : null,
				cut,
			};
		case "mic_blocked":
			return {
				kind: "here",
				chip: "mic_blocked",
				caption: { kind: "mic_blocked" },
				action: "settings",
				cut,
			};
		case "mic_prompting":
			return {
				kind: "here",
				chip: "waiting_mic",
				caption: { kind: "waiting_mic" },
				action: "settings",
				cut,
			};
		case "paused":
			/*
			 * PAUSED (spec §4): the page is closed, so the strip says so in the
			 * ready register rather than as a warning - nothing is wrong - and its
			 * one action is Resume. The cut chip stays: it is about the last thing
			 * that was said, which a pause does not unsay.
			 */
			return {
				kind: "here",
				chip: "paused",
				caption: null,
				action: null,
				cut,
			};
		case "starting":
			return {
				kind: "here",
				chip: "starting",
				caption: { kind: "starting" },
				action: null,
				cut,
			};
		case "off":
			/*
			 * THE SLOT IS HELD BUT THE RIG IS STOPPED (an app relaunch). The chip may
			 * not say "off" while the wave is lit and the sidebar says on (UX round 1,
			 * D5): one truth, so this is its own word, and the lit wave is the way
			 * back in - not a second "Start voice" mystery action beside it.
			 */
			return {
				kind: "here",
				chip: "stopped",
				caption: null,
				action: null,
				cut,
			};
		case "hearing":
			return {
				kind: "here",
				chip: "hearing",
				caption: null,
				action: null,
				cut,
			};
		case "speaking":
			/*
			 * A MUTED REPLY IS STILL PLAYING, AND SILENT (design D7 / UX round 1,
			 * U4): saying "Speaking" over a muted page is the app claiming sound it is
			 * not making. The word is "Silenced" and the caption says where the words
			 * are, because the person is missing them.
			 */
			if (state.muted)
				return {
					kind: "here",
					chip: "silenced",
					caption: { kind: "silenced" },
					action: null,
					cut,
				};
			return {
				kind: "here",
				chip: "speaking",
				caption: spoken ? { kind: "said", text: spoken.text } : null,
				action: null,
				cut,
			};
		case "working":
			/*
			 * A CARD ON SCREEN REPLACES "Working": words spoken now are refused, so the
			 * chip says what to do instead, and it is the way to the card.
			 */
			if (state.cardPending[sessionId])
				return {
					kind: "here",
					chip: "approval",
					caption: refused
						? { kind: "not_sent", text: refused.text }
						: take
							? { kind: "not_sent", text: take.text }
							: null,
					action: "approve",
					cut,
				};
			return {
				kind: "here",
				chip: "working",
				caption: take ? { kind: "heard", text: take.text } : null,
				action: null,
				cut,
			};
		case "unheard":
			if (connecting)
				return {
					kind: "here",
					chip: "connecting",
					caption: { kind: "connecting" },
					action: null,
					cut,
				};
			return {
				kind: "here",
				chip: "unheard",
				caption: null,
				action: "retry",
				cut,
			};
		case "listening":
			break;
	}

	/*
	 * THE TWO TRANSIENT WORDS ride the READY word only: they describe what just
	 * finished playing, so a failure, a prompt or a new take (all above) retires
	 * them by precedence rather than by timing.
	 */
	const tick = state.tick;
	if (tick && tick.sessionId === sessionId) {
		const lived = now - tick.at;
		if (tick.kind === "ended" && lived < 1500) {
			return {
				kind: "here",
				chip: "ended",
				caption: { kind: "ended", text: spoken?.text ?? null },
				action: null,
				cut,
			};
		}
		if (tick.kind === "interrupted" && lived < 3000) {
			return {
				kind: "here",
				chip: "interrupted",
				caption: { kind: "interrupted", seconds: tick.seconds },
				action: null,
				cut,
			};
		}
	}

	/* A card on an otherwise-idle session: "Listening" would be a lie. */
	if (state.cardPending[sessionId])
		return {
			kind: "here",
			chip: "approval",
			caption: refused
				? { kind: "not_sent", text: refused.text }
				: take
					? { kind: "not_sent", text: take.text }
					: null,
			action: "approve",
			cut,
		};

	return {
		kind: "here",
		chip: "listening",
		caption: { kind: "idle" },
		action: null,
		cut,
	};
}

/* -------------------------------------------------------------------------- */
/* THE CHIP                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The chip's ground. Colour never carries the word alone, so every tone is
 * paired with its own word in `CHIP_WORD` - and the ONE solid fill in the set is
 * "Hearing you" (design D4).
 */
const CHIP_TONE: Record<VoiceChipKind, string> = {
	starting: "text-ink-muted",
	listening: "bg-accent-wash text-accent",
	hearing: "bg-accent text-on-accent",
	/* The hairline is inset: the chip has no border of its own (spec §4). */
	working:
		"bg-surface text-ink-muted shadow-[inset_0_0_0_1px_var(--color-hairline)]",
	speaking:
		"bg-accent-wash text-accent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_40%,transparent)]",
	/* Reply ended: a FINISHED register, off the accent the live words use (D6). */
	ended:
		"bg-surface text-ink-muted shadow-[inset_0_0_0_1px_var(--color-hairline)]",
	connecting:
		"bg-surface text-ink-muted shadow-[inset_0_0_0_1px_var(--color-hairline)]",
	/* Silenced: neutral, because nothing is being said (D7). */
	silenced:
		"bg-surface text-ink-muted shadow-[inset_0_0_0_1px_var(--color-hairline)]",
	interrupted: "bg-warning-wash text-warning",
	approval:
		"bg-warning-wash text-warning shadow-[inset_0_0_0_1px_var(--color-warning-border)]",
	mic_blocked:
		"bg-danger-wash text-danger shadow-[inset_0_0_0_1px_var(--color-danger-border)]",
	waiting_mic: "text-ink-muted",
	unheard:
		"bg-danger-wash text-danger shadow-[inset_0_0_0_1px_var(--color-danger-border)]",
	error:
		"bg-danger-wash text-danger shadow-[inset_0_0_0_1px_var(--color-danger-border)]",
	stopped: "text-ink-muted",
	/* Paused is a WORD on the band, not a wash: the rig is healthy, it is the
	   microphone that is off. */
	paused: "text-ink-muted",
};

const CHIP_WORD: Record<VoiceChipKind, WithoutParams> = {
	starting: "ui.chat.voice.phase_starting",
	listening: "ui.chat.voice.phase_listening",
	hearing: "ui.chat.voice.phase_hearing",
	working: "ui.chat.voice.phase_working",
	speaking: "ui.chat.voice.phase_speaking",
	ended: "ui.chat.voice.reply_ended",
	connecting: "ui.chat.voice.phase_connecting",
	silenced: "ui.chat.voice.phase_silenced",
	interrupted: "ui.chat.voice.phase_interrupted",
	approval: "ui.chat.voice.approve_on_screen",
	mic_blocked: "ui.chat.voice.mic_blocked",
	waiting_mic: "ui.chat.voice.phase_mic_prompting",
	unheard: "ui.chat.voice.phase_unheard",
	error: "ui.chat.voice.phase_error",
	stopped: "ui.chat.voice.phase_off",
	paused: "ui.chat.voice.phase_paused",
};

/**
 * The chip's mark, at the size the spec gives it. The level dot's halo is a
 * `box-shadow`, so a moving level never moves layout; with no meter wired the
 * value holds at .3 and the hearing chip opens fully (spec §4's fallback).
 */
const ChipMark: FC<{ chip: VoiceChipKind }> = ({ chip }) => {
	if (chip === "starting" || chip === "waiting_mic" || chip === "connecting")
		return <Spinner size="xs" />;
	if (chip === "hearing")
		return (
			<span
				aria-hidden="true"
				className="ml-0.5 mr-1 size-2 rounded-full bg-current"
				style={{
					boxShadow:
						"0 0 0 calc(1px + 5px * 0.9) color-mix(in oklab, currentColor 35%, transparent)",
				}}
			/>
		);
	if (chip === "speaking")
		return (
			<span
				aria-hidden="true"
				className="mr-0.5 inline-flex h-3 items-center gap-0.5"
			>
				<span className="h-1 w-0.5 animate-pulse rounded-sm bg-current" />
				<span className="h-2 w-0.5 animate-pulse rounded-sm bg-current [animation-delay:150ms]" />
				<span className="h-1.5 w-0.5 animate-pulse rounded-sm bg-current [animation-delay:300ms]" />
			</span>
		);
	if (chip === "listening")
		return (
			<span
				aria-hidden="true"
				className="ml-0.5 mr-1 size-2 rounded-full bg-current"
				style={{
					boxShadow:
						"0 0 0 calc(1px + 4px * 0.3) color-mix(in oklab, currentColor 28%, transparent)",
				}}
			/>
		);
	if (chip === "ended")
		return <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />;
	if (chip === "silenced")
		return <VolumeX aria-hidden="true" className="size-3" />;
	if (chip === "interrupted")
		return <Square aria-hidden="true" className="size-3" />;
	if (chip === "paused")
		return (
			<span aria-hidden="true" className="flex items-center gap-0.5">
				<span className="h-2.5 w-0.5 rounded-sm bg-current" />
				<span className="h-2.5 w-0.5 rounded-sm bg-current" />
			</span>
		);
	if (chip === "mic_blocked")
		return <MicOff aria-hidden="true" className="size-3" />;
	if (chip === "approval" || chip === "error" || chip === "unheard")
		return <TriangleAlert aria-hidden="true" className="size-3" />;
	return null;
};

/* -------------------------------------------------------------------------- */
/* COPY                                                                        */
/* -------------------------------------------------------------------------- */

const Caption: FC<{ caption: VoiceCaption }> = ({ caption }) => {
	switch (caption.kind) {
		case "idle":
			return <>{t("ui.chat.voice.idle_caption")}</>;
		case "starting":
			return <>{t("ui.chat.voice.starting_caption")}</>;
		case "heard":
			return (
				<>
					<span className="shrink-0">{t("ui.chat.voice.heard_label")}</span>{" "}
					<span className="truncate">{caption.text}</span>
				</>
			);
		case "said":
			return (
				<>
					<span className="shrink-0">{t("ui.chat.voice.said_label")}</span>{" "}
					<span className="truncate">{caption.text}</span>
				</>
			);
		case "ended":
			return caption.text ? (
				<>
					<span className="shrink-0">{t("ui.chat.voice.said_label")}</span>{" "}
					<span className="truncate">{caption.text}</span>
				</>
			) : null;
		case "interrupted":
			return (
				<>
					{t("ui.chat.voice.interrupted_caption", {
						time: formatSeconds(caption.seconds),
					})}
				</>
			);
		case "not_sent":
			/*
			 * THE REFUSAL IN PLACE, IN THE WORDS THAT EXPLAIN IT (UX round 1, U1):
			 * a take refused by a card used to show nothing where the person was
			 * looking - only a row inside collapsed History - so it read as a take
			 * that vanished. The sentence is the same one the launcher speaks, and
			 * the refused words follow it so the person recognises what was dropped.
			 */
			return (
				<>
					<span className="shrink-0">{t("ui.chat.voice.card_pending")}</span>{" "}
					{caption.text ? (
						<span className="truncate">{caption.text}</span>
					) : null}
				</>
			);
		case "mic_blocked":
			return <>{t("ui.chat.voice.mic_blocked_caption")}</>;
		case "waiting_mic":
			return <>{t("ui.chat.voice.phase_mic_prompting")}</>;
		case "connecting":
			return <>{t("ui.chat.voice.connecting_caption")}</>;
		case "silenced":
			return <>{t("ui.chat.voice.silenced_caption")}</>;
		case "reason":
			return <span className="truncate">{caption.text}</span>;
	}
};

/** `m:ss`, the form the interruption's own sentence uses. */
export function formatSeconds(total: number): string {
	const safe = Math.max(0, Math.floor(total));
	const minutes = Math.floor(safe / 60);
	const seconds = safe % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* THE HISTORY PANEL                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Remembered per WINDOW, not per session (spec §6): the panel is a view of this
 * window's own exchanges, so reopening a conversation should not reopen it.
 */
let historyOpen = false;

/**
 * The history row's clock, in the locale's own clock order (`10:18 PM`).
 *
 * `formatTime` with NO options is `Intl`'s DEFAULT, which is a DATE: every row
 * printed `10/18/2026` into a 42px column, spilling over the You label and the
 * heard text (design round 1, D1). The minutes are pinned and the hour is the
 * locale's, matching the app's other clock stamps; an unparseable stamp prints
 * nothing rather than a wrong day.
 */
export function storyTime(at: number): string {
	const date = new Date(at);
	if (Number.isNaN(date.getTime())) return "";
	return formatTime(date, { hour: "numeric", minute: "2-digit" });
}

const StoryRow: FC<{ row: VoiceStoryRow; pad: string }> = ({ row, pad }) => {
	useI18nLocale();
	if (row.kind === "interrupted") {
		return (
			<div
				data-voice-story="interrupted"
				className="flex items-center gap-1.5 border-t border-hairline bg-warning-wash px-3 py-1 text-meta text-warning"
			>
				<Square aria-hidden="true" className="size-3" />
				<span>
					{t("ui.chat.voice.interrupted_at", {
						time: formatSeconds(row.seconds),
					})}
				</span>
				<span className="ml-auto whitespace-nowrap text-ink-dim tabular-nums">
					{storyTime(row.at)}
				</span>
			</div>
		);
	}
	if (row.kind === "not_sent") {
		return (
			<div
				data-voice-story="not_sent"
				className={cn(
					"flex items-center gap-1.5 border-t border-hairline bg-danger-wash py-1 text-meta text-danger",
					pad,
				)}
			>
				<TriangleAlert aria-hidden="true" className="size-3" />
				<span>{t("ui.chat.voice.not_sent_approve")}</span>
				<span className="ml-auto whitespace-nowrap text-ink-dim tabular-nums">
					{storyTime(row.at)}
				</span>
			</div>
		);
	}
	return (
		<div
			data-voice-story="exchange"
			className={cn(
				"grid grid-cols-[auto_1fr] gap-x-2 border-t border-hairline py-1.5 text-body-sm",
				pad,
			)}
		>
			<span className="row-span-2 whitespace-nowrap pt-0.5 text-meta text-ink-dim tabular-nums">
				{storyTime(row.at)}
			</span>
			<span className="flex min-w-0 gap-1.5">
				<span className="w-8 shrink-0 text-meta text-ink-dim">
					{t("ui.chat.voice.you_label")}
				</span>
				<span className="min-w-0 text-ink">{row.heard}</span>
			</span>
			<span className="flex min-w-0 gap-1.5">
				<span className="w-8 shrink-0 text-meta text-ink-dim">
					{t("ui.chat.voice.voice_label")}
				</span>
				<span className="min-w-0">
					<span className="block text-ink-muted">
						{row.spoken ?? t("ui.chat.voice.working_row")}
					</span>
					{/*
					 * THE CUT NOTE (spec §6): the spoken tail is gone in four seconds, so the
					 * row is where "there was more" survives. It is a link-like line rather
					 * than a second control because the message it points at is one scroll
					 * away, and the strip's own cut chip is the control for that.
					 */}
					{row.truncated && (
						<span
							data-voice-story-cut=""
							className="mt-0.5 flex items-center gap-1 text-meta font-medium text-warning"
						>
							<TriangleAlert aria-hidden="true" className="size-3" />
							{t("ui.chat.voice.cut_note")}
						</span>
					)}
				</span>
			</span>
		</div>
	);
};

/* -------------------------------------------------------------------------- */
/* THE STRIP                                                                   */
/* -------------------------------------------------------------------------- */

export type VoiceComposerStripProps = {
	sessionId: string | undefined;
	/** Scrolls the transcript to its newest row - the card, or the cut reply. */
	onScrollToNewest?: () => void;
	/** The box pads 16px wide and 8px in the small view; the band pays it back. */
	isSmallView?: boolean;
};

export const VoiceComposerStrip: FC<VoiceComposerStripProps> = ({
	sessionId,
	onScrollToNewest,
	isSmallView = false,
}) => {
	useI18nLocale();
	const enabled = useVoiceCapability();
	const active = useVoiceStore((s) => s.active);
	const rig = useVoiceStore((s) => s.rig);
	const exchange = useVoiceStore((s) => s.exchange);
	const activity = useVoiceStore((s) => s.activity);
	const cardPending = useVoiceStore((s) => s.cardPending);
	const lastTake = useVoiceStore((s) => s.lastTake);
	const lastSpoken = useVoiceStore((s) => s.lastSpoken);
	const lastRefused = useVoiceStore((s) => s.lastRefused);
	const readyAt = useVoiceStore((s) => s.readyAt);
	const tick = useVoiceStore((s) => s.tick);
	const story = useVoiceStore((s) => s.story);
	const clearTick = useVoiceStore((s) => s.clearTick);
	const pendingControl = useVoiceStore((s) => s.pending);
	const muted = useVoiceStore((s) => s.rig?.muted === true);
	/*
	 * THE COMPOSER MOUNTS IN DOCUMENTS WITH NO PROVIDER (the mini view, the
	 * agents composer): `useQueryClient` throws there, so the optional seam is
	 * used and its absence falls back to the app client, which `controlVoice`
	 * already defaults to. Without a provider the whole strip is hidden anyway -
	 * no capability answer means no voice.
	 */
	const { client } = useOptionalQueryClient();

	const [now, setNow] = useState(() => Date.now());
	const [open, setOpen] = useState(historyOpen);
	const historyButton = useRef<HTMLButtonElement | null>(null);
	const pauseButton = useRef<HTMLButtonElement | null>(null);
	const panel = useRef<HTMLDivElement | null>(null);
	/** A Resume press is waiting to put focus back on its own control (U5). */
	const resumeFocus = useRef(false);
	const panelId = useId();

	/*
	 * THE TWO BEATS ARE TIMED IN ONE PLACE (design D2/D3). The store records when
	 * a word went up; this schedule retires it. `setNow` re-renders the strip at
	 * the boundary, so the view model's `now` and the timer agree.
	 */
	useEffect(() => {
		if (!tick) return undefined;
		const life = tick.kind === "ended" ? 1500 : 3000;
		const remaining = life - (Date.now() - tick.at);
		if (remaining <= 0) {
			clearTick();
			return undefined;
		}
		const timer = window.setTimeout(() => {
			clearTick();
			setNow(Date.now());
		}, remaining);
		return () => window.clearTimeout(timer);
	}, [tick, clearTick]);

	const view = composerVoiceView(
		{
			active,
			rig,
			exchange,
			activity,
			cardPending,
			lastTake,
			lastSpoken,
			lastRefused,
			muted,
			readyAt,
			tick,
		},
		sessionId,
		now,
	);

	/* Newest at the bottom, and the panel opens there (spec §6). */
	useEffect(() => {
		if (!open || story.length === 0) return;
		const node = panel.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [open, story]);

	const collapse = useCallback(() => {
		historyOpen = false;
		setOpen(false);
		historyButton.current?.focus();
	}, []);

	/*
	 * ESCAPE DISMISSES HISTORY FROM ANYWHERE IN THE COMPOSER (spec §6; UX round 1,
	 * U6): the band's own `onKeyDown` only saw keys pressed inside the band, so a
	 * person typing in the textarea could not close the panel. The composer is
	 * marked `data-chat-region="composer"` on its form; the listener acts only for
	 * a target inside it - or inside the band itself, which is what the standalone
	 * harness mounts - so the page's own interrupt ladder keeps every Escape aimed
	 * elsewhere.
	 */
	useEffect(() => {
		if (!open) return undefined;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			const target = event.target;
			if (!(target instanceof window.Element)) return;
			if (!target.closest('[data-voice-band], [data-chat-region="composer"]'))
				return;
			event.preventDefault();
			event.stopPropagation();
			collapse();
		};
		window.document.addEventListener("keydown", onKeyDown, true);
		return () =>
			window.document.removeEventListener("keydown", onKeyDown, true);
	}, [open, collapse]);

	/*
	 * THE READY-WITH-NO-PAGE GRACE NEEDS ONE RE-RENDER AT ITS EDGE (design D2 / U8):
	 * `now` only moves when a transient word retires, so without this the strip
	 * would stay on "Connecting voice" until something else re-rendered it, even
	 * when the page never arrived. Armed only while the window can still expire.
	 */
	useEffect(() => {
		if (readyAt === null || rig?.rig !== "ready" || (rig.clients ?? 0) > 0)
			return undefined;
		const remaining = readyAt + PAGE_CONNECT_GRACE_MS - Date.now();
		if (remaining <= 0) return undefined;
		const timer = window.setTimeout(() => setNow(Date.now()), remaining);
		return () => window.clearTimeout(timer);
	}, [readyAt, rig]);

	/*
	 * RESUME PUTS FOCUS BACK ON THE CONTROL THAT ASKED (UX round 1, U5): resuming
	 * recreates the page, and the strip can pass through "Starting voice" - a state
	 * with no Pause/Resume control - so the button the press landed on unmounted and
	 * focus fell to the body. Once the control is back on screen it takes focus
	 * again; a resume that fails clears the debt instead of holding it.
	 */
	useEffect(() => {
		if (!resumeFocus.current) return;
		const chipNow = view.kind === "here" ? view.chip : null;
		if (chipNow === "error") {
			resumeFocus.current = false;
			return;
		}
		const shown =
			chipNow === "paused" ||
			chipNow === "listening" ||
			chipNow === "hearing" ||
			chipNow === "speaking" ||
			chipNow === "working" ||
			chipNow === "ended" ||
			chipNow === "interrupted";
		if (!shown) return;
		resumeFocus.current = false;
		pauseButton.current?.focus();
	}, [view]);

	if (!enabled || !sessionId || view.kind === "off") return null;

	const box = "bg-sunken border-hairline";
	/* Flush with the box's own padding, so the band spans edge to edge. */
	const inset = isSmallView
		? "-mx-2 -mt-2 rounded-t-md"
		: "-mx-4 -mt-4 rounded-t-frame";
	/*
	 * THE CONTENT COLUMN IS THE BOX'S OWN (design round 1, D4): the band pays the
	 * box's padding back at the edges, so it must then use the SAME padding inside
	 * - 16px, or 8px in the small view - or the chip, history and caption sit a few
	 * pixels off the textarea, the mic and Send. Measured before: 10px left / 4px
	 * right against the box's 16px.
	 */
	const pad = isSmallView ? "px-2" : "px-4";
	/* A failure's one action, 28px high in text, beside the reason it answers. */
	/*
	 * EVERY CONTROL IN THIS FILE IS `type="button"`, and that is load-bearing
	 * rather than tidy: the strip lives INSIDE the composer's `<form>`, and an
	 * HTML button with no type submits it - a press on "Try again", History or the
	 * wave would send whatever is in the box behind them.
	 */
	const failureAction =
		view.kind === "here" && view.action && view.action !== "approve" ? (
			<Button
				type="button"
				variant="ghost"
				size="sm"
				data-voice-action={view.action}
				className="shrink-0 text-meta text-ink"
				onClick={() => {
					if (view.action === "settings") void openMicrophoneSettings();
					else void startQwenRig();
				}}
			>
				{view.action === "settings"
					? t("ui.chat.voice.open_settings")
					: view.action === "start"
						? t("ui.chat.voice.start_rig")
						: view.action === "retry"
							? t("ui.chat.voice.retry")
							: t("ui.chat.voice.try_again")}
			</Button>
		) : null;

	/*
	 * THE NOTICE (spec §5): voice is on in another conversation. One band, no
	 * Pause, no History - neither belongs to this session - and two text
	 * actions: move the slot here, or go to where it is.
	 */
	if (view.kind === "elsewhere") {
		const holder = view.holder;
		return (
			<div
				data-voice-notice=""
				className={cn(
					"flex min-h-10 items-center gap-2 border-b",
					inset,
					box,
					pad,
				)}
			>
				<span className="min-w-0 flex-1 truncate text-meta text-ink-muted">
					{view.holderTitle ? (
						<>
							{t("ui.chat.voice.notice_elsewhere_prefix")}{" "}
							<b className="font-medium text-ink">{view.holderTitle}</b>
						</>
					) : (
						t("ui.chat.voice.notice_elsewhere_untitled")
					)}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="shrink-0 text-meta text-ink"
					aria-disabled={pendingControl || undefined}
					onClick={() => {
						if (pendingControl) return;
						void controlVoice("enable", sessionId, client).catch((error) => {
							const reason = userFacingMessage(
								error,
								error instanceof DesktopControlError ? error.message : "",
							);
							showErrorToast(t("ui.chat.voice.enable_failed", { reason }));
						});
					}}
				>
					{t("ui.chat.voice.move_here")}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="shrink-0 text-meta text-ink"
					onClick={() => openVoiceSession(holder)}
				>
					{t("ui.chat.voice.go_there")}
				</Button>
			</div>
		);
	}

	const chip = view.chip;
	const tone = CHIP_TONE[chip];
	const isButton = chip === "approval";
	/*
	 * THE TWO CONTROLS BESIDE THE CHIP (spec §4). Pause is offered by every state
	 * in which the rig is actually working - the ones where the microphone is
	 * live; it is not offered while the models load, over a failure, or where the
	 * page is already gone. Resume is the same control in the paused state.
	 */
	const pauseable =
		chip === "paused" ||
		chip === "listening" ||
		chip === "hearing" ||
		chip === "speaking" ||
		/* A muted reply is still playing: Pause and the unmute both apply (D7). */
		chip === "silenced" ||
		chip === "working" ||
		chip === "ended" ||
		chip === "interrupted";

	return (
		<div
			data-voice-band=""
			className={cn(
				/*
				 * FLUSH WITH THE BOX'S TOP EDGE (spec §1): the box pads its children by
				 * 16px, so the band pays that padding back and takes the box's own top
				 * radius. The panel and the strip stack inside with no seam.
				 */
				"-mx-4 -mt-4 overflow-hidden rounded-t-frame border-b",
				box,
			)}
		>
			{open && (
				<div
					ref={panel}
					id={panelId}
					data-voice-history=""
					className="max-h-[min(50vh,320px)] overflow-y-auto border-b border-hairline"
				>
					<div
						className={cn(
							"flex items-center gap-2 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim",
							pad,
						)}
					>
						<span>{t("ui.chat.voice.history")}</span>
						<span className="font-normal normal-case tracking-normal">
							{t("ui.chat.voice.history_last", { count: String(story.length) })}
						</span>
					</div>
					{story.length === 0 ? (
						<p className={cn("pb-2 text-meta text-ink-dim", pad)}>
							{t("ui.chat.voice.empty_history")}
						</p>
					) : (
						story.map((row) => (
							<StoryRow key={`${row.kind}:${row.at}`} row={row} pad={pad} />
						))
					)}
				</div>
			)}
			<div
				data-voice-strip=""
				className={cn("flex min-h-10 items-center gap-2", pad)}
			>
				{isButton ? (
					<button
						type="button"
						data-voice-chip={chip}
						onClick={() => onScrollToNewest?.()}
						className={cn(
							"flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-meta font-medium",
							tone,
						)}
					>
						<ChipMark chip={chip} />
						{t(CHIP_WORD[chip])}
					</button>
				) : (
					<output
						/*
						 * ONE LIVE REGION (spec §4): the chip is `role=status` by element, this
						 * file's established spelling (`<output>`), and the caption beside it is
						 * NOT announced - it would say the same thing twice.
						 */
						data-voice-chip={chip}
						className={cn(
							"flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-meta font-medium",
							tone,
						)}
					>
						<ChipMark chip={chip} />
						{t(CHIP_WORD[chip])}
					</output>
				)}
				{/*
				 * THE CUT CHIP (design D1): a button rather than a word, because its
				 * whole job is to take the reader to the message the tail came from.
				 */}
				{view.cut && (
					<button
						type="button"
						data-voice-cut=""
						onClick={() => onScrollToNewest?.()}
						className="flex h-6 shrink-0 items-center rounded-sm bg-warning-wash px-2 text-meta font-medium text-warning"
					>
						{t("ui.chat.voice.cut_chip")}
					</button>
				)}
				{view.caption ? (
					<span
						data-voice-caption=""
						className="flex min-w-0 flex-1 items-baseline gap-1 truncate whitespace-nowrap text-meta text-ink-dim"
					>
						<Caption caption={view.caption} />
					</span>
				) : (
					<span className="min-w-0 flex-1" />
				)}
				{failureAction}
				{pauseable && (
					<Button
						type="button"
						ref={pauseButton}
						variant="ghost"
						size="icon"
						data-voice-action={chip === "paused" ? "resume" : "pause"}
						aria-label={t(
							chip === "paused"
								? "ui.chat.voice.strip_resume"
								: "ui.chat.voice.strip_pause",
						)}
						title={t(
							chip === "paused"
								? "ui.chat.voice.strip_resume"
								: "ui.chat.voice.strip_pause",
						)}
						onClick={() => {
							if (chip === "paused") {
								resumeFocus.current = true;
								void resumeQwenVoice();
								return;
							}
							void pauseQwenVoice();
						}}
						className="shrink-0 text-ink-muted"
					>
						{chip === "paused" ? (
							<Play aria-hidden="true" />
						) : (
							<Pause aria-hidden="true" />
						)}
					</Button>
				)}
				{pauseable && (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						data-voice-mute={muted ? "on" : "off"}
						aria-pressed={muted}
						aria-label={t(
							muted ? "ui.chat.voice.unmute" : "ui.chat.voice.mute",
						)}
						title={t(muted ? "ui.chat.voice.unmute" : "ui.chat.voice.mute")}
						onClick={() => void setQwenMuted(!muted)}
						/*
						 * A MUTED TOGGLE SAYS SO IN ITS GLYPH AND ITS PRESSED FACE: the
						 * speaker with a slash is the word, the accent wash the state - the
						 * same pair the wave button uses.
						 */
						/*
						 * A MUTED TOGGLE IS NOT A LIVE ONE (design round 1, D7): the accent
						 * fill is the wave's "voice is running" register, so painting it here
						 * made a silenced rig look live. The engaged face is the quiet one -
						 * the box's own surface, a hairline and muted ink - while the glyph
						 * (a speaker with a slash) is the word.
						 */
						className={cn(
							"shrink-0 text-ink-muted",
							"aria-pressed:bg-surface aria-pressed:text-ink-muted",
							"aria-pressed:shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]",
						)}
					>
						{muted ? (
							<VolumeX aria-hidden="true" />
						) : (
							<Volume2 aria-hidden="true" />
						)}
					</Button>
				)}
				<Button
					type="button"
					ref={historyButton}
					variant="ghost"
					size="sm"
					data-voice-history-toggle=""
					aria-expanded={open}
					aria-controls={open ? panelId : undefined}
					className="shrink-0 gap-0.5 px-1.5 text-meta text-ink-muted"
					onClick={() => {
						historyOpen = !historyOpen;
						setOpen(historyOpen);
						setNow(Date.now());
					}}
				>
					<span>
						{open
							? t("ui.chat.voice.history_hide")
							: t("ui.chat.voice.history")}
					</span>
					{open ? (
						<ChevronUp aria-hidden="true" className="size-3.5" />
					) : (
						<ChevronDown aria-hidden="true" className="size-3.5" />
					)}
				</Button>
			</div>
		</div>
	);
};

/* -------------------------------------------------------------------------- */
/* THE WAVE BUTTON                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The wave toggle, moved out of the header (spec §1) with its click intact.
 *
 * One press asks the server to put the machine-wide slot on THIS session, or
 * take it off; enabling here while another conversation holds it is the switch,
 * so the label names the conversation that will lose it before the press.
 *
 * `aria-pressed` is the drawn state and the announced state in one attribute,
 * and the dots are redundant with the strip's words rather than the only cue.
 */
export const ComposerVoiceButton: FC<{
	sessionId: string | undefined;
	isSmallView?: boolean;
}> = ({ sessionId, isSmallView }) => {
	useI18nLocale();
	/*
	 * THE SLOT COMES FROM THE STORE, NOT `useVoiceStatus` (which mounts a query):
	 * this button rides the composer, and the composer mounts in documents with
	 * no QueryClient. The app's one `QwenVoiceController` mirrors the cache entry
	 * into the store, so the two readers cannot disagree about the holder - and
	 * with no controller there is no capability answer, so the button is absent.
	 */
	const enabled = useVoiceCapability();
	const pending = useVoiceStore((s) => s.pending);
	const rig = useVoiceStore((s) => s.rig);
	const holder = useVoiceStore((s) => s.active?.session_id ?? null);
	const cardPending = useVoiceStore((s) =>
		sessionId ? Boolean(s.cardPending[sessionId]) : false,
	);
	const { client } = useOptionalQueryClient();
	if (!enabled || !sessionId) return null;
	const on = holder === sessionId;
	/*
	 * A LIT WAVE ON A STOPPED RIG IS THE WAY BACK IN (UX round 1, D5): after an app
	 * restart the slot is still held (the wave is lit, the sidebar says on) but no
	 * models are loaded. Pressing it starts them, which is what a lit control means;
	 * the strip no longer offers a second "Start voice" action beside it. Turning
	 * voice off is the next press, once it is running.
	 */
	const stopped = on && rig?.rig === "stopped";
	const holderTitle = voiceSessionTitle(holder);
	const label = stopped
		? t("ui.chat.voice.start_rig")
		: on
			? t("ui.chat.voice.toggle_off")
			: holder
				? holderTitle
					? t("ui.chat.voice.toggle_switch", { title: holderTitle })
					: t("ui.chat.voice.toggle_switch_untitled")
				: t("ui.chat.voice.toggle_on");

	/* The dot is a second cue for a state the strip already names in words. */
	const dot = on
		? rig?.rig === "error" || rig?.mic === "denied"
			? "danger"
			: cardPending || rig?.rig === "starting"
				? "warning"
				: null
		: holder
			? "elsewhere"
			: null;

	const press = async () => {
		if (pending) return;
		if (stopped) {
			await startQwenRig();
			return;
		}
		try {
			const result = await controlVoice(
				on ? "disable" : "enable",
				sessionId,
				client,
			);
			if (!on && result.replaced && result.replaced !== sessionId) {
				const replacedTitle = voiceSessionTitle(result.replaced);
				showInfoToast(
					replacedTitle
						? t("ui.chat.voice.switched_from", { title: replacedTitle })
						: t("ui.chat.voice.switched_from_untitled"),
				);
			}
		} catch (error) {
			const reason = userFacingMessage(
				error,
				error instanceof DesktopControlError ? error.message : "",
			);
			showErrorToast(
				t(on ? "ui.chat.voice.disable_failed" : "ui.chat.voice.enable_failed", {
					reason,
				}),
			);
		}
	};

	return (
		<Button
			type="button"
			variant="ghost"
			size={isSmallView ? "icon-sm" : "icon"}
			data-voice-toggle={on ? "on" : "off"}
			data-voice-dot={dot ?? undefined}
			aria-pressed={on}
			aria-label={label}
			title={label}
			aria-disabled={pending || undefined}
			aria-busy={pending || undefined}
			onClick={() => void press()}
			className={cn(
				"relative",
				/*
				 * The pressed pair, unchanged from the header toggle: the outline
				 * variant's pressed mix, with pressed+hover stepping one rung further
				 * toward `accent` and `ink` as the glyph. Both pairs are asserted in
				 * `scripts/contrast-contract.mjs`.
				 */
				"aria-pressed:bg-[color-mix(in_oklab,var(--color-accent-wash)_80%,var(--color-accent))] aria-pressed:text-accent",
				"aria-pressed:hover:bg-[color-mix(in_oklab,var(--color-accent-wash)_70%,var(--color-accent))] aria-pressed:hover:text-ink",
				/*
				 * THE OFF WAVE HOVERS ON THE BOX, NOT ON THE PRESSED MINT (design round
				 * 1, nit): the ghost variant's `hover:bg-accent-wash` is the same wash
				 * the pressed state uses, so in the light theme hovering an OFF wave
				 * looked pressed. The raised step is the ordinary hover of the other
				 * composer controls.
				 */
				"hover:bg-elevated hover:text-ink",
			)}
		>
			<AudioLines aria-hidden="true" />
			{dot && (
				<span
					aria-hidden="true"
					data-voice-dot-mark=""
					className={cn(
						/*
						 * OFF THE GLYPH, on the button's own corner: at `top-1 right-1` the
						 * 7px dot sat on the waveform and its knockout ring read as none.
						 */
						"absolute -top-0.5 -right-0.5 size-[7px] rounded-full ring-2 ring-[var(--color-elevated)]",
						dot === "danger" && "bg-danger",
						dot === "warning" && "bg-warning",
						dot === "elsewhere" && "bg-accent",
					)}
				/>
			)}
		</Button>
	);
};
