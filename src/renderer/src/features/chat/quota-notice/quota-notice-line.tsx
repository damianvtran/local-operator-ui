/**
 * @file quota-notice-line.tsx
 * @description
 * The composer's pre-emptive "no quota" line: one quiet sentence, its remedy
 * links, the resend action's own states and a dismiss, mounted next to
 * `NoProviderLine` on the empty chat band.
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
 * WHERE THE WORDS COME FROM. `body` is the server's sentence, verbatim and
 * never re-authored here — for a Radient account it is literally
 * `radient_recovery.recovery_line`'s text. The two sentences this component
 * DOES own are the resend press's outcomes (`quota-notice.ts`), which are
 * facts about THIS client's request, not about the account.
 *
 * `title` is deliberately not painted: the wire's `body` is the complete
 * sentence (it carries the reset phrase and any top-up URL itself), and the
 * title repeats its opening clause for every balance and limit case, so
 * painting both would read the same claim twice.
 */

import { Button } from "@shared/components/ui";
import type { FC } from "react";
import type { QuotaNoticeAction } from "../../../../../shared/desktop-contract";
import type { QuotaNoticeModel } from "./use-quota-notice";
import { useQuotaNotice } from "./use-quota-notice";

/**
 * One action, as the wire ordered it.
 *
 * `resend_verification` is the only action with engine behind it: the press
 * runs the proxy op, and the disabled state is the resend phase's. The other
 * two are doors (`open_url` opens the remedy page; `refresh` re-asks the
 * notice), so neither authors copy either.
 */
const ActionButton: FC<{
	action: QuotaNoticeAction;
	model: Extract<QuotaNoticeModel, { visible: true }>;
}> = ({ action, model }) => {
	if (action.id === "resend_verification") {
		return (
			<Button
				variant="link"
				size="sm"
				disabled={model.resend.disabled}
				onClick={model.onResend}
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
			onClick={model.onRefresh}
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
export const QuotaNoticeLine: FC = () => {
	const model = useQuotaNotice();
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
		 */
		<div
			className="flex flex-col gap-0.5 text-ink-dim text-meta"
			data-quota-notice-line=""
			data-quota-notice-state={model.state}
			data-quota-notice-resend-phase={model.resendPhase}
		>
			<span className="whitespace-pre-line" data-quota-notice-body="">
				{model.body}
			</span>
			<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
				{model.actions.map((action) => (
					<ActionButton key={action.id} action={action} model={model} />
				))}
				{model.resend.sentence ? (
					<output data-quota-notice-resend-state="">
						{model.resend.sentence}
					</output>
				) : null}
				<Button
					variant="link"
					size="sm"
					onClick={model.onDismiss}
					data-quota-notice-dismiss=""
				>
					Dismiss
				</Button>
			</span>
		</div>
	);
};
