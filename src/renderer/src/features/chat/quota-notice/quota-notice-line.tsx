/**
 * @file quota-notice-line.tsx
 * @description
 * The composer's pre-emptive "no quota" line: one quiet sentence, its remedy
 * links, the two presses' states and outcomes, and a dismiss, mounted on the
 * empty chat band's splash side of the composer (see the mount in
 * `message-input.tsx` for why it is above the foot rather than below the box).
 *
 * WHY A LINE AND NOT A CARD. The notice arrives BEFORE the user has done
 * anything — they opened a session and may be about to type. A card would be
 * a claim about an error that has not happened; `NoProviderLine` sets the
 * register (the design's own instruction), so this is one row of meta text
 * with link-weight actions and nothing that lifts, fills or blocks. The
 * notice never gates the composer: a stale or wrong verdict must not stop a
 * send, and the copy says "no credit left", never "you cannot send" (the
 * backend's gate is a per-request estimate).
 *
 * THE STATUS SLOT IS LAST IN THE ROW (design round 1, D4). The row is
 * remedies, the quiet Dismiss, and then the presses' outcome — so a sentence
 * appearing or clearing moves NOTHING: the first option D4 offered ("status
 * last, so nothing moves") over the second ("right after Resend", which would
 * shift `I verified` and Dismiss instead). The outcome is still one slot
 * shared by both presses, and `tabIndex={-1}` lets a keyboard press land on
 * it instead of falling to `<body>` (U5 — a disabled button cannot hold
 * focus, so the sentence it disabled it FOR takes it).
 *
 * WHERE THE WORDS COME FROM. `body` is the server's sentence, verbatim and
 * never re-authored here — for a Radient account it is literally
 * `radient_recovery.recovery_line`'s text. The sentences this component DOES
 * own are the two presses' local outcomes (`quota-notice.ts`), which are
 * facts about THIS client's request, not about the account.
 *
 * `title` is deliberately not painted: the wire's `body` is the complete
 * sentence (it carries the reset phrase and any top-up URL itself), and the
 * title repeats its opening clause for every balance and limit case, so
 * painting both would read the same claim twice.
 */

import { Button } from "@shared/components/ui";
import { type FC, type RefObject, useEffect, useRef } from "react";
import type { QuotaNoticeAction } from "../../../../../shared/desktop-contract";
import type {
	QuotaNoticeModel,
	QuotaNoticeSelection,
} from "./use-quota-notice";
import { useQuotaNotice } from "./use-quota-notice";

/**
 * One action, as the wire ordered it.
 *
 * `resend_verification` is the only action with engine behind it: the press
 * runs the proxy op, and the disabled state is the resend phase's. The other
 * two are doors (`open_url` opens the remedy page; `refresh` re-asks the
 * notice), so neither authors copy either.
 *
 * Both engine-backed presses record whether the press came from the KEYBOARD
 * (`detail === 0` is what a keyboard-generated click carries) so the line can
 * take focus back when the control it disables cannot hold it (U5).
 */
const ActionButton: FC<{
	action: QuotaNoticeAction;
	model: Extract<QuotaNoticeModel, { visible: true }>;
	onPressStarted: (event: { detail?: number }) => void;
	resendRef: RefObject<HTMLButtonElement>;
}> = ({ action, model, onPressStarted, resendRef }) => {
	if (action.id === "resend_verification") {
		return (
			<Button
				ref={resendRef}
				variant="link"
				size="sm"
				disabled={model.resend.disabled}
				onClick={(event) => {
					onPressStarted(event);
					model.onResend();
				}}
				data-quota-notice-resend-action=""
			>
				{action.label}
			</Button>
		);
	}
	if (action.id === "open_url") {
		/* A url-less open_url is degenerate; render the label as plain text
		 * rather than a control that cannot open anything. */
		if (!action.url) return <span>{action.label}</span>;
		return (
			<Button
				variant="link"
				size="sm"
				onClick={() => model.onOpenUrl(action.url as string)}
				data-quota-notice-open-url=""
			>
				{action.label}
			</Button>
		);
	}
	return (
		<Button
			variant="link"
			size="sm"
			disabled={model.refreshing}
			onClick={(event) => {
				onPressStarted(event);
				model.onRefresh();
			}}
			data-quota-notice-refresh-action=""
		>
			{action.label}
		</Button>
	);
};

/**
 * The line. Renders nothing unless the hook has an answer to show and the
 * answer is not the dismissed (provider, state) pair.
 */
export const QuotaNoticeLine: FC<{ selection?: QuotaNoticeSelection }> = ({
	selection = null,
}) => {
	const model = useQuotaNotice(selection);
	const resendRef = useRef<HTMLButtonElement>(null);
	const statusRef = useRef<HTMLOutputElement>(null);
	const keyboardPress = useRef(false);
	const statusSentence = model.visible ? model.statusSentence : null;
	const phase = model.visible ? model.resendPhase : null;

	/*
	 * THE FOCUS RETURN (U5). A keyboard press disables its own button, and a
	 * disabled control cannot hold focus — the browser drops it to `<body>`
	 * and the next Tab starts from the top of the page. So when a sentence
	 * appears after a keyboard press, focus moves to it (it is the result the
	 * press was made to read, and `tabIndex={-1}` makes it focusable without
	 * joining the tab order). When a press settles with nothing to read, focus
	 * returns to the resend control, which is offered again.
	 */
	useEffect(() => {
		if (!keyboardPress.current) return;
		if (statusSentence) {
			statusRef.current?.focus();
			keyboardPress.current = false;
			return;
		}
		if (phase === "idle") {
			resendRef.current?.focus();
			keyboardPress.current = false;
		}
	}, [statusSentence, phase]);

	if (!model.visible) return null;
	return (
		/*
		 * BODY THEN ACTIONS, stacked — not one flex row of everything. The wire's
		 * body can be two lines (the Radient verification copy is, by its own
		 * newline), and in one wrapped flex row an action lands CENTRED against
		 * the tall span, i.e. floating between the sentence's lines: laid out
		 * here, the remedies read as one row under the statement whatever the
		 * body's length. The register is still `NoProviderLine`'s — `text-ink-dim
		 * text-meta`, link-weight controls, no fill or border of its own.
		 *
		 * `gap-1` between the statement and the row (D5's optional note): at 2px
		 * the links read as a continuation line of the body.
		 */
		<div
			className="flex flex-col gap-1 text-ink-dim text-meta"
			data-quota-notice-line=""
			data-quota-notice-state={model.state}
			data-quota-notice-resend-phase={model.resendPhase}
		>
			<span className="whitespace-pre-line" data-quota-notice-body="">
				{model.body}
			</span>
			<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
				{model.actions.map((action) => (
					<ActionButton
						key={action.id}
						action={action}
						model={model}
						onPressStarted={(event) => {
							keyboardPress.current = (event.detail ?? 0) === 0;
						}}
						resendRef={resendRef}
					/>
				))}
				<Button
					variant="linkQuiet"
					size="sm"
					onClick={model.onDismiss}
					data-quota-notice-dismiss=""
				>
					Dismiss
				</Button>
				{model.statusSentence ? (
					<output ref={statusRef} tabIndex={-1} data-quota-notice-status="">
						{model.statusSentence}
					</output>
				) : null}
			</span>
		</div>
	);
};
