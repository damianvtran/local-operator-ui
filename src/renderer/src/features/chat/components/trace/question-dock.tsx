/**
 * The agent's question, DOCKED above the composer (chat redesign §F1).
 *
 * ## Why it is docked rather than inline
 *
 * The question used to render as the transcript's last item. A long turn put it
 * off-screen - the scroll-hunt failure the UX baseline recorded (U14) - and it is
 * the one thing on screen the agent is blocked on, so § 7's first tier says it must
 * be unmissable. Docking it at the composer's top edge also makes the focus order
 * deterministic (card -> composer) and keeps the scroll-to-bottom control from ever
 * covering it. The spec takes this against the inline reading deliberately.
 *
 * ## What the card is
 *
 * One elevated card, radius 14, with a 1px `accent` border - the accent's one spend
 * on this card (branding § 2); the options inside are rows (`AskOptions`), not
 * controls with edges of their own. The header line names what is happening
 * (`The agent is asking` / `Sending your answer…`), the question is at
 * `text-heading` in `ink`, and a hint line under the options names the keys that
 * actually work.
 *
 * ## Esc collapses it to a pill, and only that
 *
 * `Esc` inside the card collapses it to a `? The agent is asking · Show` pill at
 * the same docked position and hands focus back to the composer - visible and
 * reversible, so the reader who wanted the transcript back has it without losing
 * the question. It never stops the turn: nothing is running while a question is
 * pending, and this is the one place Esc's meaning is not "stop". The press is
 * claimed with `preventDefault`, which is the claim the app-wide interrupt
 * listener already defers to (`use-interrupt-on-escape.ts`'s ladder).
 *
 * The collapsed state is keyed on the QUESTION (`request_id` + `question_index`),
 * not a boolean: collapsing one question does not hide the next one the agent
 * asks, which is a new claim on the reader's attention.
 *
 * ## An approval gate
 *
 * `kind: "approval"` has no options and is answered by `yes`/`no` in the
 * composer; it docks the same way with its own hint, because it is the same
 * blocked-on-you state.
 */

import { cn } from "@shared/lib/utils";
import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PendingDesktopGate } from "../../../../../../shared/desktop-session-contract";
import { focusComposer } from "../../composer-field";
import { MarkdownRenderer } from "../markdown-renderer";
import { AskOptions } from "./ask-options";

export type QuestionDockProps = {
	gate: PendingDesktopGate;
	/** Submit an option's label; absent where the surface cannot answer. */
	onAnswer?: (label: string) => void;
	/** An answer is in flight from any surface: every option is disabled. */
	answering?: boolean;
	/**
	 * This panel's own record of the gate it answered: the card holds itself
	 * disabled after a press until the gate moves, and `refused` carries the
	 * sentence when the owner would not take the answer.
	 */
	answer?: { sending: boolean; refused: string | null } | null;
	/** Extra classes on the dock's outer box (the caller owns the measure). */
	className?: string;
};

/** The identity of one question: a new question is a new claim on the reader. */
export const questionKeyOf = (gate: {
	request_id: string;
	question_index: number;
}) => `${gate.request_id}:${String(gate.question_index)}`;

/**
 * The hint line's copy, as a function so the suite asserts it without a DOM.
 *
 * It names only keys that WORK: `Up/Down` and `Enter` inside the options, `1-9`
 * because the card answers a digit directly, `Esc` because it collapses the card,
 * and the composer below because the options are never guaranteed exhaustive. A
 * `secret` ask carries no options, so its hint is the composer alone.
 */
export const questionDockHint = (gate: PendingDesktopGate): string => {
	if (gate.kind === "approval")
		return "Reply yes or no below, or press Escape to stop the turn.";
	const prefix =
		gate.question_total > 1
			? `Question ${gate.question_index + 1} of ${gate.question_total}. `
			: "";
	if (gate.options.length === 0) return `${prefix}Type your answer below.`;
	const digits =
		gate.options.length === 1 ? "1" : `1-${Math.min(gate.options.length, 9)}`;
	return `${prefix}Up/Down choose · Enter or ${digits} answers · Esc hides · or type your own answer below`;
};

export const QuestionDock = ({
	gate,
	onAnswer,
	answering = false,
	answer = null,
	className,
}: QuestionDockProps) => {
	const key = questionKeyOf(gate);
	const [collapsedKey, setCollapsedKey] = useState<string | null>(null);
	const collapsed = collapsedKey === key;
	const cardRef = useRef<HTMLElement>(null);
	/*
	 * Re-expanding hands focus to the card's first live option, because the press
	 * that expanded it was a request to see and answer the question; collapsing
	 * hands it to the composer (below), which is where the reader goes next.
	 */
	const [expandedByPress, setExpandedByPress] = useState(false);
	useEffect(() => {
		if (!expandedByPress || collapsed) return;
		setExpandedByPress(false);
		const first = cardRef.current?.querySelector<HTMLElement>(
			"button[data-ask-option]:not([disabled])",
		);
		first?.focus();
	}, [expandedByPress, collapsed]);

	const busy = answering || answer !== null;
	const sending = answering || Boolean(answer?.sending);
	const content = gate.detail
		? `**${gate.title}**\n\n${gate.detail}`
		: gate.title;

	if (collapsed) {
		return (
			<div
				className={cn("flex pb-2", className)}
				data-lo-question-dock="collapsed"
			>
				{/*
				 * THE PILL: one control, at the dock's own position, in the same accent
				 * border so the reader still sees that the agent is waiting. A button
				 * rather than a status line because its only job is "Show".
				 */}
				<button
					type="button"
					aria-label="Show the agent's question"
					onClick={() => {
						setCollapsedKey(null);
						setExpandedByPress(true);
					}}
					className={cn(
						"inline-flex h-7 items-center gap-2 rounded-full border border-accent bg-elevated px-3",
						"text-body-sm text-ink transition-colors duration-fast ease-out-quart hover:bg-sunken",
					)}
				>
					<MessageCircleQuestion
						aria-hidden={true}
						className="size-3.5 text-accent"
					/>
					<span>The agent is asking</span>
					<span aria-hidden={true} className="text-ink-dim">
						·
					</span>
					<span className="text-ink-muted">Show</span>
				</button>
			</div>
		);
	}

	return (
		<div className={cn("pb-2", className)} data-lo-question-dock="expanded">
			<section
				ref={cardRef}
				aria-label="Question from the agent"
				onKeyDown={(event) => {
					if (event.key !== "Escape" || event.defaultPrevented) return;
					if (event.nativeEvent.isComposing) return;
					event.preventDefault();
					setCollapsedKey(key);
					focusComposer();
				}}
				className="flex flex-col gap-2 rounded-lg border border-accent bg-elevated p-4"
			>
				<div className="flex items-center gap-2">
					<MessageCircleQuestion
						aria-hidden={true}
						className="size-4 shrink-0 text-accent"
					/>
					{/*
					 * The eyebrow says what is happening, and switches while an answer
					 * is on its way so a press on a slow round trip visibly landed
					 * (design round 1, D3; UX round 1, U2).
					 */}
					<p className="font-medium text-ink-muted text-meta">
						{sending ? "Sending your answer…" : "The agent is asking"}
					</p>
					{gate.kind === "ask" && gate.options.length > 0 && (
						<p aria-hidden={true} className="ml-auto text-ink-dim text-meta">
							{gate.options.length === 1
								? "1 to answer"
								: `1-${Math.min(gate.options.length, 9)} to answer`}
						</p>
					)}
				</div>
				<div className="text-heading text-ink">
					<MarkdownRenderer content={content} />
				</div>
				{gate.kind === "ask" && (
					<AskOptions
						options={gate.options}
						recommended={gate.recommended}
						requestId={gate.request_id}
						busy={busy}
						onAnswer={(label) => onAnswer?.(label)}
					/>
				)}
				<p className="text-ink-dim text-meta">{questionDockHint(gate)}</p>
				{/*
				 * A refused answer lands on the card it was pressed on, outcome first,
				 * and the card stays held so it cannot be pressed twice (QA round 1, Q3;
				 * UX round 1, U4). `output` carries the status role implicitly.
				 */}
				{answer?.refused && (
					<output className="block text-body-sm text-danger">
						{answer.refused}
					</output>
				)}
			</section>
		</div>
	);
};
