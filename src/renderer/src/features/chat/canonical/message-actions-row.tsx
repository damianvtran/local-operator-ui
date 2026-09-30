/**
 * The row of actions under a turn: Copy, and - on an answer with a speech
 * target - Speak.
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
 * THE ROW FADES AT REST, and the reason is the operator's ask on the
 * speak-aloud round: a permanent control under every turn reads as chrome on
 * every turn. The reveal is opacity-only (`message-actions.ts` carries the
 * class set and its why), so the row keeps its place and revealing it moves
 * nothing - and a press that is loading, playing or showing `Copied` PINS it
 * visible, because a state must not fade out from under the reader who caused
 * it.
 *
 * ONE COMPONENT, TWO KINDS. `kind` decides what the row offers
 * (`answerActionsFor`), which marker it carries and what its accessible name
 * is; an answer row offers Copy + Speak, a user row offers Copy alone. The
 * user arm exists because the operator asked for a copy affordance on their
 * own messages, and it is this component rather than a second one because
 * everything here - the copy press, the reveal, the toolbar semantics - is the
 * same row (branding § 9).
 *
 * WHAT IT IS GIVEN, AND WHY THAT IS THE WHOLE CONTRACT. `bodyText` is the
 * answer's VISIBLE text - `parseReplies(record.text).remainingContent`, exactly
 * the string the prose above renders - so a reply-quoted send copies the reply
 * rather than the `<reply-to>` markup that prefixed it (memo (e)). The row
 * never reads `record.text` itself: one derivation, one answer, and the payload
 * cannot drift from what the reader is looking at.
 *
 * `agentId` is the conversation the speech engine synthesises against, and its
 * ABSENCE is what makes Speak unavailable (the model does not offer it) - the
 * same pair `text-selection-controls.tsx` reads. `speechId` keys this row in
 * the speech store (`msg:<id>`), so the button's busy and playing states belong
 * to this answer and cannot be claimed by another. The Speak CONTROL itself -
 * gate, tooltip, labels, press - is `useSpeakControl`, shared with the
 * selection toolbars and the legacy strip so the four surfaces cannot drift.
 */

import {
	SpeakButton,
	useSpeakControl,
} from "@shared/components/common/speak-control";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { messageSpeechKey, useSpeechStore } from "@shared/store/speech-store";
import { Check, Copy } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { copyTarget } from "../utils/link-open";
import {
	ANSWER_ACTIONS_LABEL,
	type ActionRowRole,
	COPY_FEEDBACK_MS,
	USER_ACTIONS_LABEL,
	actionRowVisibility,
	answerActionsFor,
} from "./message-actions";

export type AnswerActionRowProps = {
	/** The turn's visible text, as the prose above renders it (memo (e)). */
	bodyText: string;
	/**
	 * Which turn the row belongs to, in the transcript's own word
	 * (`TranscriptRecord.kind`). Named `kind` rather than `role` because `role`
	 * on a component element reads as an ARIA role to the a11y lint (and
	 * `role="user"` is not one); the model's choice is the same one, under its
	 * own name (`answerActionsFor({ role })`).
	 */
	kind?: ActionRowRole;
	/** The conversation the speech engine synthesises against, when there is one. */
	agentId?: string;
	/** This row's key in the speech store. */
	speechId?: string;
};

export const AnswerActionRow = memo(function AnswerActionRow({
	bodyText,
	kind = "answer",
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

	const { playSpeech } = useSpeechStore();
	const speechControl = useSpeakControl({
		key: speechId ? messageSpeechKey(speechId) : null,
		getText: () => bodyText,
		play: ({ text }) => {
			if (agentId && speechId) playSpeech(speechId, agentId, text);
		},
	});

	const actions = answerActionsFor({ role: kind, agentId });
	/*
	 * The row is kept up while anything it owns is mid-state: a `Copied` tick
	 * or a Speak that is loading or playing is the reader's own press talking
	 * back, and it must not fade out from under them when the pointer leaves.
	 */
	const pinned = copied || speechControl.active;

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

	return (
		<div
			role="toolbar"
			aria-label={kind === "user" ? USER_ACTIONS_LABEL : ANSWER_ACTIONS_LABEL}
			/*
			 * The marker names the ROLE, not the component: the transcript's own
			 * tests and rigs count answer rows (`data-lo-answer-actions`) as a fact
			 * about answers, and a user row wearing the same attribute would make
			 * that count lie the day a user row is on screen.
			 */
			{...(kind === "user"
				? { "data-lo-user-actions": "" }
				: { "data-lo-answer-actions": "" })}
			/*
			 * `shrink-0` and one line at every width (memo (c)): the buttons are the
			 * row's fixed part and the caption beside them is the part that truncates,
			 * so the toolbar must never be the thing a narrow column squeezes.
			 */
			className={cn(
				"flex shrink-0 items-center gap-1",
				actionRowVisibility(pinned),
			)}
		>
			{actions.map((action) =>
				action === "copy" ? (
					<Tooltip key={action} content={copied ? "Copied" : "Copy"}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={copied ? "Copied" : "Copy"}
							className={cn(
								"text-ink-dim hover:bg-accent-wash hover:text-accent",
							)}
							onClick={handleCopy}
						>
							{copied ? (
								<Check aria-hidden="true" />
							) : (
								<Copy aria-hidden="true" />
							)}
						</Button>
					</Tooltip>
				) : (
					<SpeakButton key={action} control={speechControl} />
				),
			)}
		</div>
	);
});
