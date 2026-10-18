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
	Square,
	TriangleAlert,
} from "lucide-react";
import {
	type FC,
	type KeyboardEvent as ReactKeyboardEvent,
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
	| "stopped";

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
		tick: VoiceTick | null;
	},
	sessionId: string | undefined,
	now: number,
): VoiceComposerView {
	const holder = state.active?.session_id ?? null;
	if (!sessionId || !holder) return { kind: "off" };
	if (holder !== sessionId) {
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
		case "starting":
			return {
				kind: "here",
				chip: "starting",
				caption: { kind: "starting" },
				action: null,
				cut,
			};
		case "off":
			/* The slot is held but the rig is stopped (an app relaunch). */
			return {
				kind: "here",
				chip: "stopped",
				caption: null,
				action: "start",
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
					caption: take ? { kind: "not_sent", text: take.text } : null,
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
			caption: take ? { kind: "not_sent", text: take.text } : null,
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
	ended: "bg-accent-wash text-accent",
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
};

const CHIP_WORD: Record<VoiceChipKind, WithoutParams> = {
	starting: "ui.chat.voice.phase_starting",
	listening: "ui.chat.voice.phase_listening",
	hearing: "ui.chat.voice.phase_hearing",
	working: "ui.chat.voice.phase_working",
	speaking: "ui.chat.voice.phase_speaking",
	ended: "ui.chat.voice.reply_ended",
	interrupted: "ui.chat.voice.phase_interrupted",
	approval: "ui.chat.voice.approve_on_screen",
	mic_blocked: "ui.chat.voice.mic_blocked",
	waiting_mic: "ui.chat.voice.phase_mic_prompting",
	unheard: "ui.chat.voice.phase_unheard",
	error: "ui.chat.voice.phase_error",
	stopped: "ui.chat.voice.phase_off",
};

/**
 * The chip's mark, at the size the spec gives it. The level dot's halo is a
 * `box-shadow`, so a moving level never moves layout; with no meter wired the
 * value holds at .3 and the hearing chip opens fully (spec §4's fallback).
 */
const ChipMark: FC<{ chip: VoiceChipKind }> = ({ chip }) => {
	if (chip === "starting" || chip === "waiting_mic")
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
	if (chip === "ended") return <Check aria-hidden="true" className="size-3" />;
	if (chip === "interrupted")
		return <Square aria-hidden="true" className="size-3" />;
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
			return (
				<>
					<span className="shrink-0">
						{t("ui.chat.voice.not_sent_approve")}
					</span>{" "}
					{caption.text ? (
						<span className="truncate">{caption.text}</span>
					) : null}
				</>
			);
		case "mic_blocked":
			return <>{t("ui.chat.voice.mic_blocked_caption")}</>;
		case "waiting_mic":
			return <>{t("ui.chat.voice.phase_mic_prompting")}</>;
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

const StoryRow: FC<{ row: VoiceStoryRow }> = ({ row }) => {
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
				<span className="ml-auto text-ink-dim tabular-nums">
					{formatTime(row.at)}
				</span>
			</div>
		);
	}
	if (row.kind === "not_sent") {
		return (
			<div
				data-voice-story="not_sent"
				className="flex items-center gap-1.5 border-t border-hairline bg-danger-wash px-3 py-1 text-meta text-danger"
			>
				<TriangleAlert aria-hidden="true" className="size-3" />
				<span>{t("ui.chat.voice.not_sent_approve")}</span>
				<span className="ml-auto text-ink-dim tabular-nums">
					{formatTime(row.at)}
				</span>
			</div>
		);
	}
	return (
		<div
			data-voice-story="exchange"
			className="grid grid-cols-[42px_1fr] gap-x-2 border-t border-hairline px-3 py-1.5 text-body-sm"
		>
			<span className="row-span-2 pt-0.5 text-meta text-ink-dim tabular-nums">
				{formatTime(row.at)}
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
	const tick = useVoiceStore((s) => s.tick);
	const story = useVoiceStore((s) => s.story);
	const clearTick = useVoiceStore((s) => s.clearTick);
	const pendingControl = useVoiceStore((s) => s.pending);
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
	const panel = useRef<HTMLDivElement | null>(null);
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
	 * ESCAPE IS SCOPED TO THIS BAND (spec §6). A window listener would also fire
	 * for an Escape aimed at the composer - which is the page's own interrupt
	 * ladder - so the listener rides the band the panel belongs to, and only while
	 * the panel is open.
	 */
	const onStripKeyDown = (event: ReactKeyboardEvent) => {
		if (!open || event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		collapse();
	};

	if (!enabled || !sessionId || view.kind === "off") return null;

	const box = "bg-sunken border-hairline";
	/* Flush with the box's own padding, so the band spans edge to edge. */
	const inset = isSmallView
		? "-mx-2 -mt-2 rounded-t-md"
		: "-mx-4 -mt-4 rounded-t-frame";
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
					"flex min-h-10 items-center gap-2 border-b px-3 pr-1.5",
					inset,
					box,
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

	return (
		<div
			onKeyDown={onStripKeyDown}
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
					<div className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
						<span>{t("ui.chat.voice.history")}</span>
						<span className="font-normal normal-case tracking-normal">
							{t("ui.chat.voice.history_last", { count: String(story.length) })}
						</span>
					</div>
					{story.length === 0 ? (
						<p className="px-3 pb-2 text-meta text-ink-dim">
							{t("ui.chat.voice.empty_history")}
						</p>
					) : (
						story.map((row) => (
							<StoryRow key={`${row.kind}:${row.at}`} row={row} />
						))
					)}
				</div>
			)}
			<div
				data-voice-strip=""
				className="flex min-h-10 items-center gap-2 px-2.5 pr-1"
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
						/* Hidden with the caption on a narrow box, not from the reading. */
						className="hidden min-w-0 flex-1 items-baseline gap-1 truncate whitespace-nowrap text-meta text-ink-dim @min-[360px]/chatcol:flex"
					>
						<Caption caption={view.caption} />
					</span>
				) : (
					<span className="min-w-0 flex-1" />
				)}
				{failureAction}
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
					<span className="hidden @min-[420px]/chatcol:inline">
						{open
							? t("ui.chat.voice.history_hide")
							: t("ui.chat.voice.history")}
					</span>
					{open ? (
						<ChevronDown aria-hidden="true" className="size-3.5" />
					) : (
						<ChevronUp aria-hidden="true" className="size-3.5" />
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
	const holderTitle = voiceSessionTitle(holder);
	const label = on
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
			)}
		>
			<AudioLines aria-hidden="true" />
			{dot && (
				<span
					aria-hidden="true"
					data-voice-dot-mark=""
					className={cn(
						"absolute top-1 right-1 size-[7px] rounded-full ring-2 ring-[var(--color-elevated)]",
						dot === "danger" && "bg-danger",
						dot === "warning" && "bg-warning",
						dot === "elsewhere" && "bg-accent",
					)}
				/>
			)}
		</Button>
	);
};
