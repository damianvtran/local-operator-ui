/**
 * The question for the user — the first and most prominent tier of § 7.
 *
 * The agent is blocked and waiting; this is the only thing on screen that
 * needs a decision, and it must be unmissable: "its own affordance, not a
 * paragraph that happens to end in a question mark."
 *
 * Design decision (why this shape and not the alternatives):
 * - **Accent-washed callout, not a badge.** The deleted `action-highlight.tsx`
 *   had the right instinct — mark the question — but a floating "QUESTION"
 *   badge still leaves the question itself as ordinary prose. The affordance
 *   has to contain the question. This callout is the one accent spend on a
 *   chat screen: § 2 budgets accent about three times per screen, and the
 *   thing waiting on the user outranks every other candidate.
 * - **No action buttons.** The answer is typed in the composer, which is
 *   always visible below; adding "Reply" here would duplicate the input
 *   affordance and imply a flow that does not exist.
 * - **No jump anchor.** An ASK ends a turn, so the question is always the
 *   last item while it is actionable; the existing scroll-to-bottom control
 *   already covers finding it.
 * - **A real icon, not colour alone.** The callout must be findable while
 *   scrolling, and colour-only signals fail colour-blind users.
 *
 * The text is `text-accent` on `bg-accent-wash` with a `border-accent` edge —
 * the exact triple the contrast contract measures for accent badges, so the
 * callout is legible in all twelve palettes by construction rather than by
 * inspection.
 */

import { cn } from "@shared/lib/utils";
import { MessageCircleQuestion } from "lucide-react";
import { MarkdownRenderer } from "../markdown-renderer";

export type AgentQuestionProps = {
	/** The question text. Empty renders nothing. */
	content?: string;
	/** Extra classes on the callout. */
	className?: string;
};

export const AgentQuestion = ({ content, className }: AgentQuestionProps) => {
	if (!content) return null;

	return (
		<section
			aria-label="Question from the agent"
			className={cn(
				"flex gap-3 rounded-md border border-accent bg-accent-wash px-4 py-3",
				className,
			)}
		>
			<MessageCircleQuestion
				className="mt-0.5 size-4 shrink-0 text-accent"
				aria-hidden={true}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="font-medium text-accent text-meta">
					Waiting for your answer
				</p>
				{/* The body is `ink`, not `accent`.
				 *
				 * Accent ink on accent wash passes the contract, but the contract
				 * measures accent as a *badge* colour — a short label, at 12px, on
				 * its own tint. This is the one sentence in the app the user has to
				 * read and answer before anything continues, and at 4.59:1 it was
				 * the faintest prose on screen while ordinary assistant text next
				 * to it sat above 7:1. Importance was signalled by making the most
				 * important text hardest to read.
				 *
				 * Identity still comes from the icon, the border and the eyebrow
				 * label, which are the parts accent is actually good at. Measured
				 * on `bg-accent-wash` across all twelve palettes: accent floored at
				 * 4.59:1 (localOperatorLight), ink floors at 8.36:1 (iceberg). */}
				<div className="lo-on-wash text-ink">
					<MarkdownRenderer content={content} />
				</div>
			</div>
		</section>
	);
};
