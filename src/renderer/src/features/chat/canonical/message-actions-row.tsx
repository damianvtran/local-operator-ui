/**
 * The row of actions under a turn-closing answer: Copy, and Speak when speech
 * is configured.
 *
 * WHY THIS IS NOT THE LINK TOOLBAR'S COMPONENT. That strip floats over what the
 * pointer is on, takes the elevated ground and the one overlay shadow, and
 * lives inside its subject's box. This row is IN THE FLOW, permanently, on one
 * of the transcript's own lines - a bordered ground here would read as a card
 * around a meta line (branding §7: a completed action is one quiet line, not a
 * card), so it takes no ground at rest and the only colour it owns is the ink
 * step on hover. It shares the toolbar ROLE and the button anatomy with that
 * strip rather than its register.
 *
 * WHAT IT IS GIVEN, AND WHY THAT IS THE WHOLE CONTRACT. `bodyText` is the
 * answer's VISIBLE text - `parseReplies(record.text).remainingContent`, exactly
 * the string the prose above renders - so a reply-quoted send copies the reply
 * rather than the `<reply-to>` markup that prefixed it (memo (e)). The row
 * never reads `record.text` itself: one derivation, one answer, and the payload
 * cannot drift from what the reader is looking at.
 *
 * `agentId` is the conversation the speech engine synthesises against, and its
 * ABSENCE is what makes Speak unavailable (with a missing credential it is the
 * second half of the same gate) - the same pair `text-selection-controls.tsx`
 * reads. `speechId` keys this row in the speech store, so the button's busy and
 * playing states belong to this answer and cannot be claimed by another.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { useSpeechStore } from "@shared/store/speech-store";
import { cn } from "@shared/lib/utils";
import { Check, ClipboardCopy, Square, Volume2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { copyTarget } from "../utils/link-open";
import {
	ANSWER_ACTIONS_LABEL,
	COPY_FEEDBACK_MS,
	answerActionsFor,
} from "./message-actions";

export type AnswerActionRowProps = {
	/** The answer's visible text, as the prose above renders it (memo (e)). */
	bodyText: string;
	/** The conversation the speech engine synthesises against, when there is one. */
	agentId?: string;
	/** This row's key in the speech store. */
	speechId: string;
};

export const AnswerActionRow = memo(function AnswerActionRow({
	bodyText,
	agentId,
	speechId,
}: AnswerActionRowProps) {
	const [copied, setCopied] = useState(false);
	/*
	 * The reset timer is held in a ref rather than in state: the button is
	 * re-rendered per delta on a live row, and a timer id in state would re-render
	 * it a second time for a fact nothing paints.
	 */
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const { playSpeech, stopSpeech, loadingMessageId, playingMessageId } =
		useSpeechStore();

	/*
	 * The speech credential probe, borrowed whole from `text-selection-controls.tsx`
	 * including its two different reasons: the probe answers "no key" both when
	 * nothing is configured and when the local server could not be reached, and
	 * those need different sentences - one sends the reader to settings, the other
	 * tells them to wait.
	 */
	const { hasRadientApiKey, isUnavailable } = useRadientCredentialProbe();
	const canEnableSpeechFeature = hasRadientApiKey && !isUnavailable;
	const speechUnavailableReason = isUnavailable
		? "Text to speech is unavailable while Local Operator is offline"
		: "Sign in to Radient in the settings page to enable text to speech";

	const isPlaying = playingMessageId === speechId;
	const isLoading = loadingMessageId === speechId;
	const actions = answerActionsFor({ agentId });

	/*
	 * A timer that outlives its row would flip a button that is no longer mounted
	 * (and, under React 18's strict double-mount in development, one that was
	 * never really there), so the unmount clears it. The press path clears the
	 * previous one as well: a second press restarts the window rather than
	 * leaving the first press's timer to end the second press's feedback early.
	 */
	useEffect(() => {
		return () => {
			if (resetTimer.current !== null) clearTimeout(resetTimer.current);
		};
	}, []);

	const handleCopy = async () => {
		/*
		 * `Copied` is set ONLY on a true answer. `copyTarget` is the canonical
		 * path's single clipboard call site - it writes the text, logs and raises
		 * the existing `Failed to copy` toast when the write is refused - so a
		 * press that failed leaves the label alone instead of claiming an outcome
		 * the app did not get.
		 */
		if (!(await copyTarget(bodyText))) return;
		setCopied(true);
		if (resetTimer.current !== null) clearTimeout(resetTimer.current);
		resetTimer.current = setTimeout(() => {
			resetTimer.current = null;
			setCopied(false);
		}, COPY_FEEDBACK_MS);
	};

	const handleSpeak = () => {
		if (isPlaying) {
			stopSpeech();
			return;
		}
		if (agentId && bodyText) playSpeech(speechId, agentId, bodyText);
	};

	return (
		<div
			role="toolbar"
			aria-label={ANSWER_ACTIONS_LABEL}
			data-lo-answer-actions=""
			/*
			 * `shrink-0` and one line at every width (memo (c)): the buttons are the
			 * row's fixed part and the caption beside them is the part that truncates,
			 * so the toolbar must never be the thing a narrow column squeezes.
			 */
			className={cn("flex shrink-0 items-center gap-1")}
		>
			{actions.map((action) =>
				action === "copy" ? (
					<Tooltip key={action} content={copied ? "Copied" : "Copy"}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={copied ? "Copied" : "Copy"}
							className={cn("text-ink-dim hover:bg-accent-wash hover:text-accent")}
							onClick={handleCopy}
						>
							{copied ? (
								<Check aria-hidden="true" />
							) : (
								<ClipboardCopy aria-hidden="true" />
							)}
						</Button>
					</Tooltip>
				) : isPlaying ? (
					<Tooltip key={action} content="Stop">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Stop"
							className={cn("text-ink-dim hover:bg-accent-wash hover:text-accent")}
							onClick={handleSpeak}
						>
							<Square aria-hidden="true" />
						</Button>
					</Tooltip>
				) : (
					<Tooltip
						key={action}
						content={
							isLoading
								? "Loading"
								: !canEnableSpeechFeature
									? speechUnavailableReason
									: "Speak aloud"
						}
					>
						{/*
						 * A disabled button fires no pointer events, so the tooltip needs a
						 * wrapper that does - the same wrapper, for the same reason, as the
						 * selection strip's.
						 */}
						<span className={cn("flex")}>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={isLoading ? "Loading speech" : "Speak aloud"}
								className={cn(
									"text-ink-dim hover:bg-accent-wash hover:text-accent",
								)}
								onClick={handleSpeak}
								disabled={isLoading || !canEnableSpeechFeature}
							>
								{isLoading ? (
									<Spinner size="xs" />
								) : (
									<Volume2 aria-hidden="true" />
								)}
							</Button>
						</span>
					</Tooltip>
				),
			)}
		</div>
	);
});
