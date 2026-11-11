import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { FileDiff } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	type ProfileProposalRef,
	profileProposalReviewPath,
} from "../../profile-proposal-ask";

/*
 * BOUNDED ASK CARDS - ONE PRIMITIVE FOR EVERY SURFACE THAT DRAWS A QUESTION.
 *
 * THE INCIDENT. A team-brief proposal arrived as an approval whose text was the
 * whole proposed brief. The inline card ("The agent is asking") grew to the text's
 * height: it filled the conversation pane, the pane could not scroll it, and the
 * answer pair and the composer were pushed off-screen - so the only way to answer
 * was gone. Nothing about that is specific to proposals: ANY long question (a
 * pasted log, a model that over-explains) does the same, on the inline dock, in
 * the Asks side panel, and in the notification drawer's detail pane (which
 * embeds the same `AskPanel`).
 *
 * THE RULE, shared so the three surfaces cannot drift:
 * - the QUESTION BODY scrolls inside a viewport-relative cap (`ASK_BODY_MAX_H`);
 * - the CONTROLS (options, the `Other` field, the actions) are siblings of that
 *   region, never inside it, so they stay where the reader can press them;
 * - a long OPTION LIST is capped too (`ASK_OPTIONS_MAX_H`), but the `Other`
 *   row and its field sit OUTSIDE that capped list, so free text is always one
 *   press away however many options the model wrote;
 * - the inline dock's card is additionally capped as a whole (`ASK_CARD_MAX_H`)
 *   with its own scroll as the last resort, so even a tiny window keeps the
 *   composer below it on screen.
 *
 * WHY `vh` AND NOT A CONTAINER UNIT. A container-relative cap would need
 * `container-type: size` on the chat column, the drawer and the notifications
 * pane - three layout owners this fix has no other reason to touch, and `size`
 * containment changes how each of them sizes. The viewport is what the bug is
 * about (the card outgrew the window), and the `rem` arm of each `min()` keeps
 * a tall monitor from handing one question most of a 1440px screen.
 */
export const ASK_BODY_MAX_H = "max-h-[min(40vh,28rem)]";
export const ASK_OPTIONS_MAX_H = "max-h-[min(30vh,20rem)]";
export const ASK_CARD_MAX_H = "max-h-[min(70vh,48rem)]";

/*
 * The data attribute is the structural contract the DOM tests (and design QA's
 * geometry probes) read: "the body is a scroll region and the controls are not
 * inside it" is asserted against these markers, not against class strings.
 */
export const ASK_SCROLL_ATTR = "data-lo-ask-scroll";

/**
 * The question body's scroll region.
 *
 * KEYBOARD. A region that overflows takes a Tab stop (`tabIndex=0`) and a name,
 * so a keyboard reader can scroll it with the arrow keys; one that fits takes
 * neither, because an empty Tab stop on every short question is noise. Chromium
 * also makes scrollers focusable on its own (keyboard-focusable scrollers), but
 * only when they contain nothing focusable - a markdown link inside the body
 * would switch that off - so the measurement here is explicit.
 *
 * Escape is untouched: the region has no key handler, so the card's own
 * Esc-collapse (the dock) and Esc-claim (the panel's chooser) still see the key.
 */
export const AskScrollBody = ({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) => {
	const ref = useRef<HTMLDivElement>(null);
	const [overflows, setOverflows] = useState(false);
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) return;
		const measure = () =>
			// One pixel of slack: sub-pixel line heights round differently in
			// scrollHeight and clientHeight, and a phantom Tab stop is the cost.
			setOverflows(node.scrollHeight > node.clientHeight + 1);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		// The content's own size changes (markdown settling, a font swap) do
		// not resize the capped box, so the first child is watched as well.
		if (node.firstElementChild) observer.observe(node.firstElementChild);
		return () => observer.disconnect();
	}, []);
	return (
		<div
			ref={ref}
			{...{ [ASK_SCROLL_ATTR]: overflows ? "overflow" : "fits" }}
			tabIndex={overflows ? 0 : undefined}
			role={overflows ? "region" : undefined}
			aria-label={overflows ? t("ui.chat.asks.bounds.body_label") : undefined}
			className={cn(
				ASK_BODY_MAX_H,
				/*
				 * `min-h-0` so a flex parent may shrink it below its content (the dock's
				 * card cap), `overscroll-contain` so reaching the end does not start
				 * scrolling the transcript behind the card, and `overflow-wrap:anywhere`
				 * because the payload that caused this was paths and ids with no spaces.
				 */
				"min-h-0 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]",
				"rounded-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
				className,
			)}
		>
			<div>{children}</div>
		</div>
	);
};

/**
 * The proposal's own line: what is being changed, and the way to its real review.
 *
 * A proposal's approval is a decision about a DIFF, and the card is the wrong
 * place to read one - so instead of the full before/after the card names the
 * target and links to the Agents page's proposal review, which renders the
 * changed lines. Accept/reject stay on the card (the link is in addition to the
 * answer pair, never instead of it), and the proposal id stays in the question
 * text the agent sent, which is what spoken approval in chat matches.
 *
 * In-app navigation (`useNavigate`), the same call the sidebar's agent links
 * use, so the reader keeps the session and can come back to answer.
 */
export const ProposalReviewNotice = ({
	proposal,
	className,
}: {
	proposal: ProfileProposalRef;
	className?: string;
}) => {
	const navigate = useNavigate();
	const fields = proposal.fields ?? [];
	return (
		<div
			data-lo-ask-proposal={proposal.id}
			className={cn("flex flex-col gap-1", className)}
		>
			<p className="text-ink-muted text-meta">
				{t("ui.chat.asks.proposal.summary", {
					kind: proposal.kind,
					name: proposal.name,
				})}
			</p>
			{fields.length > 0 ? (
				<ul className="flex flex-col text-ink-muted text-meta">
					{fields.slice(0, 3).map((field) => (
						<li key={field.label} className="truncate">
							{field.added === undefined && field.removed === undefined
								? t("ui.chat.asks.proposal.field_changed", {
										label: field.label,
									})
								: t("ui.chat.asks.proposal.field_lines", {
										label: field.label,
										added: field.added ?? 0,
										removed: field.removed ?? 0,
									})}
						</li>
					))}
				</ul>
			) : null}
			<button
				type="button"
				data-lo-ask-proposal-review=""
				onClick={() => navigate(profileProposalReviewPath(proposal))}
				className={cn(
					"inline-flex min-h-6 items-center gap-1.5 self-start rounded-md border border-control px-2 py-1",
					"text-ink text-xs transition-colors duration-fast ease-out-quart hover:bg-sunken",
					"outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
				)}
			>
				<FileDiff aria-hidden={true} className="size-3.5 shrink-0" />
				<span>{t("ui.chat.asks.proposal.review")}</span>
			</button>
		</div>
	);
};
