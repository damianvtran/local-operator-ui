/**
 * THE SPOKEN SUMMARY, DRAWN AT THE END OF THE MESSAGE (design placement C).
 *
 * With voice on, the agent ends a voiced reply with a `Spoken:` paragraph and
 * the server speaks that paragraph instead of the reply's first 800 characters.
 * The paragraph stays in the stored message, so the transcript draws it here as
 * a quiet labelled block - what the person heard, beside what they can read -
 * rather than as a raw "Spoken: ..." line of prose. The block's states and the
 * detection rule are pure (`spoken-summary-model.ts`, `spoken-summary.ts`).
 *
 * THE BLOCK CLAIMS ONLY WHAT HAPPENED. It exists only when the message has the
 * paragraph (never invented), reads "Spoken summary" with no control when voice
 * is off or this window did not speak the message, and "Spoken aloud" with
 * Replay only for a message this window spoke from the summary and whose audio
 * the rig has not refused: from the request until playback starts it reads
 * "Speaking", and a refused speak puts the record back (`speakSource`). The
 * label is one polite live region, so a screen reader hears the same sequence
 * the eye sees; Replay stays mounted (`aria-disabled`) while a take plays so a
 * keyboard press does not lose its focus.
 *
 * Tokens only: `bg-sunken`, `border-hairline`, `text-ink`/`text-ink-dim`, no
 * accent and no stripe - it is a record, not an alert.
 */

import { Button } from "@shared/components/ui/button";
import { type WithoutParams, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { type FC, useMemo } from "react";
import { pressReplay } from "./qwen-voice-controller";
import {
	type SpokenBlockTone,
	replayFactsOf,
	replayOffer,
	replyCutNote,
	spokenBlockView,
} from "./spoken-summary-model";
import { useVoiceStore } from "./voice-store";

const LABEL: Record<SpokenBlockTone, WithoutParams> = {
	upcoming: "ui.chat.voice.summary_upcoming",
	speaking: "ui.chat.voice.summary_speaking",
	spoken: "ui.chat.voice.summary_label",
	stopped: "ui.chat.voice.summary_stopped",
	muted: "ui.chat.voice.summary_muted",
	cut: "ui.chat.voice.summary_cut",
	static: "ui.chat.voice.summary_static",
};

/** What this message's block and footnote read from the store. */
function useSpokenFacts(sessionId: string | undefined, messageId: string) {
	const voiceHere = useVoiceStore(
		(s) => sessionId !== undefined && s.active?.session_id === sessionId,
	);
	const entry = useVoiceStore((s) => s.spoken[messageId]);
	const playingThis = useVoiceStore(
		(s) =>
			s.activity === "speaking" &&
			s.lastSpoken?.messageId === messageId &&
			s.lastSpoken.sessionId === sessionId,
	);
	const requested = useVoiceStore(
		(s) =>
			s.speakRequest?.messageId === messageId &&
			s.speakRequest.sessionId === sessionId,
	);
	const muted = useVoiceStore((s) => s.rig?.muted === true);
	const paused = useVoiceStore((s) => s.rig?.paused === true);
	const busy = useVoiceStore((s) => replayFactsOf(s, sessionId).busy);
	const answerOwed = useVoiceStore(
		(s) => s.exchange?.kind === "working" && s.exchange.sessionId === sessionId,
	);
	return {
		voiceHere,
		entry,
		playingThis,
		requested,
		muted,
		paused,
		busy,
		answerOwed,
	};
}

/**
 * What Replay is for one conversation right now - the ONE rule
 * (`replayOffer`) as a hook, for the History rows and the strip, which sit
 * outside the block. `null`: not offered.
 */
export function useReplayOffer(
	sessionId: string | undefined,
): { word: "replay" | "play"; disabled: boolean } | null {
	// A string key so the selector returns a primitive, stable between renders.
	const key = useVoiceStore((s) => {
		const offer = replayOffer(replayFactsOf(s, sessionId));
		return offer ? `${offer.word}:${offer.disabled}` : "";
	});
	return useMemo(
		() =>
			key === ""
				? null
				: {
						word: key.startsWith("play") ? "play" : "replay",
						disabled: key.endsWith("true"),
					},
		[key],
	);
}

/**
 * The quiet text button the block and the footnote carry. Unavailable is
 * `aria-disabled`, not `disabled`: it keeps its place in the tab order and the
 * focus the press gave it, and a press does nothing. `className` places it: the
 * block pushes it to the trailing edge, the footnote leaves it beside its note.
 */
const ReplayButton: FC<{
	onPress: () => void;
	word: WithoutParams;
	icon: "replay" | "play";
	isSmallView: boolean;
	disabled?: boolean;
	className?: string;
}> = ({ onPress, word, icon, isSmallView, disabled = false, className }) => (
	<Button
		type="button"
		variant="ghost"
		size="sm"
		data-spoken-control={icon}
		aria-label={t(word)}
		title={t(word)}
		aria-disabled={disabled || undefined}
		onClick={disabled ? undefined : onPress}
		className={cn(
			"h-6 shrink-0 gap-1 px-1.5 text-meta text-ink-muted aria-disabled:cursor-default aria-disabled:opacity-50",
			className,
		)}
	>
		{icon === "replay" ? (
			<RotateCcw aria-hidden="true" />
		) : (
			<Play aria-hidden="true" />
		)}
		<span className={cn(isSmallView && "sr-only")}>{t(word)}</span>
	</Button>
);

export type SpokenSummaryBlockProps = {
	sessionId: string | undefined;
	/** The message's record id: what the server resolves, and the store's key. */
	messageId: string;
	/** The paragraph's words, label removed; empty while it has just begun. */
	summary: string;
	streaming: boolean;
	isSmallView?: boolean;
};

export const SpokenSummaryBlock: FC<SpokenSummaryBlockProps> = ({
	sessionId,
	messageId,
	summary,
	streaming,
	isSmallView = false,
}) => {
	useI18nLocale();
	const facts = useSpokenFacts(sessionId, messageId);
	const view = spokenBlockView({ ...facts, streaming });
	const press = () => {
		if (sessionId) void pressReplay(sessionId, messageId);
	};
	return (
		<section
			data-spoken-summary={view.tone}
			aria-label={t("ui.chat.voice.summary_static")}
			className="mt-3 rounded-md border border-hairline bg-sunken px-3 py-2"
		>
			<div className="flex min-h-6 items-center gap-1.5 text-meta text-ink-dim">
				{view.tone === "muted" ? (
					<VolumeX aria-hidden="true" className="size-3 shrink-0" />
				) : (
					<Volume2 aria-hidden="true" className="size-3 shrink-0" />
				)}
				{/* The label is the block's one live region (`<output>`, this file's
				    spelling of role=status): To be spoken, Speaking, Spoken aloud. */}
				<output className="min-w-0 truncate">{t(LABEL[view.tone])}</output>
				{view.control && (
					<ReplayButton
						onPress={press}
						word={
							view.control === "play"
								? "ui.chat.voice.play"
								: "ui.chat.voice.replay"
						}
						icon={view.control}
						isSmallView={isSmallView}
						disabled={view.disabled}
						// Logical, so the trailing edge is the left in a right-to-left locale.
						className="ms-auto"
					/>
				)}
			</div>
			{summary !== "" && (
				<p className="mt-0.5 whitespace-pre-line break-words text-body-sm text-ink">
					{summary}
				</p>
			)}
		</section>
	);
};

/**
 * THE FALLBACK'S FOOTNOTE (frame 10): the reply was spoken from its own text and
 * cut at the cap, and there is no summary block to say so. One quiet line under
 * the reply with the same Replay; rendered only when `replyCutNote` says the cut
 * is true.
 */
export const SpokenReplyNote: FC<{
	sessionId: string | undefined;
	messageId: string;
	isSmallView?: boolean;
}> = ({ sessionId, messageId, isSmallView = false }) => {
	useI18nLocale();
	const { entry, voiceHere } = useSpokenFacts(sessionId, messageId);
	const offer = useReplayOffer(sessionId);
	if (!replyCutNote(entry, voiceHere)) return null;
	return (
		<p
			data-spoken-reply-note=""
			className="mt-2 flex min-h-6 items-center gap-1.5 text-meta text-ink-dim"
		>
			<Volume2 aria-hidden="true" className="size-3 shrink-0" />
			<span className="min-w-0 truncate">
				{t("ui.chat.voice.spoken_part_note")}
			</span>
			{offer && (
				// Beside its note, not at the far edge: it belongs to the line.
				<ReplayButton
					onPress={() => {
						if (sessionId) void pressReplay(sessionId, messageId);
					}}
					word={
						offer.word === "play"
							? "ui.chat.voice.play"
							: "ui.chat.voice.replay"
					}
					icon={offer.word}
					isSmallView={isSmallView}
					disabled={offer.disabled}
				/>
			)}
		</p>
	);
};
