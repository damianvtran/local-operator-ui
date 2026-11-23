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
 * Replay only for a message this window spoke from the summary.
 *
 * Tokens only: `bg-sunken`, `border-hairline`, `text-ink`/`text-ink-dim`, no
 * accent and no stripe - it is a record, not an alert.
 */

import { Button } from "@shared/components/ui/button";
import { type WithoutParams, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import type { FC } from "react";
import { replaySpoken, setQwenMuted } from "./qwen-voice-controller";
import {
	type SpokenBlockTone,
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
	const muted = useVoiceStore((s) => s.rig?.muted === true);
	const answerOwed = useVoiceStore(
		(s) => s.exchange?.kind === "working" && s.exchange.sessionId === sessionId,
	);
	return { voiceHere, entry, playingThis, muted, answerOwed };
}

/** The quiet text button both the block and the footnote carry. */
const ReplayButton: FC<{
	onPress: () => void;
	word: WithoutParams;
	icon: "replay" | "play";
	isSmallView: boolean;
}> = ({ onPress, word, icon, isSmallView }) => (
	<Button
		type="button"
		variant="ghost"
		size="sm"
		data-spoken-control={icon}
		aria-label={t(word)}
		title={t(word)}
		onClick={onPress}
		className="ml-auto h-6 shrink-0 gap-1 px-1.5 text-meta text-ink-muted"
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
	const replay = () => {
		if (sessionId) void replaySpoken(sessionId, messageId);
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
				<span className="min-w-0 truncate">{t(LABEL[view.tone])}</span>
				{view.control === "replay" && (
					<ReplayButton
						onPress={replay}
						word="ui.chat.voice.replay"
						icon="replay"
						isSmallView={isSmallView}
					/>
				)}
				{view.control === "play" && (
					<ReplayButton
						onPress={() => {
							// Unmute first: Play is the person asking to hear it now.
							void setQwenMuted(false).then(replay);
						}}
						word="ui.chat.voice.play"
						icon="play"
						isSmallView={isSmallView}
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
			<ReplayButton
				onPress={() => {
					if (sessionId) void replaySpoken(sessionId, messageId);
				}}
				word="ui.chat.voice.replay"
				icon="replay"
				isSmallView={isSmallView}
			/>
		</p>
	);
};
