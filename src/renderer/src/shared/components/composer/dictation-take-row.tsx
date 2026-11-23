import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
/**
 * The row that says a take was kept, and carries what may be done with it.
 *
 * WHY IT IS A ROW AND NOT A TOAST (design round 1, D1/D2, #1087). A toast
 * dismisses and the recording does not, so an offer that lives only in one
 * outlives neither the sentence nor the failure. The row sits under the box the
 * take was recorded in, for as long as the bytes are held.
 *
 * ITS CONTROLS COME FROM ONE DECISION, NOT FROM THIS FILE. `retakeOfferFor`
 * chooses whether a row exists at all, whether it carries Retry, and what it
 * says; this component renders that answer and nothing more. That is deliberate:
 * the composer previously derived "is this retryable" itself, in a second place
 * beside the copy, which is how a refusal came to be shown a control offering to
 * re-send the bytes it had just rejected. A row with no Retry is not a missing
 * feature here - it is a failure where sending the same bytes cannot help
 * (HTTP 413's over-sized take, HTTP 422's rejected request), and Discard is the
 * only action left.
 *
 * DISCARD IS A REAL COST, so it is never the row's only affordance by accident:
 * every row that shows a kept take has one, because a recording a person cannot
 * send and cannot throw away is state they cannot get out of (the defect #1087
 * fixed for Retry, one control over). It clears the bytes; it sends nothing and
 * deletes nothing that was ever sent.
 */
import { CircleAlert } from "lucide-react";
import { useId } from "react";

export interface DictationTakeRowProps {
	/** The sentence the policy chose, naming the take and the controls beside it. */
	message: string;
	/** Whether the same bytes may be sent again (the transient class only). */
	retry: boolean;
	/** Send the kept take again. */
	onRetry: () => void;
	/** Throw the kept take away. */
	onDiscard: () => void;
}

export const DictationTakeRow = ({
	message,
	retry,
	onRetry,
	onDiscard,
}: DictationTakeRowProps) => {
	/*
	 * The controls are bare words ("Retry", "Discard"), and each one is only
	 * unambiguous against the sentence that says what it acts on. The description
	 * is that link for a screen reader arriving at the button on its own - the
	 * visible row already reads that way to a sighted reader.
	 */
	const messageId = useId();
	return (
		<div
			data-dictation-take-row=""
			className="mt-1 flex items-center gap-2 px-2 [min-height:1.5rem]"
		>
			{/*
			 * AN ERROR REGISTER, not the metadata one (design round 1, D6). The row
			 * in `ink-muted` with no mark at all read as the same quiet status as
			 * "Processing audio", and the toast it stands in for carried the danger
			 * icon. The take is still here, but the attempt failed: the icon says
			 * which, and the sentence stays at reading ink.
			 */}
			<CircleAlert
				aria-hidden="true"
				className="size-3.5 shrink-0 text-danger"
			/>
			<span id={messageId} className="font-medium text-body-sm text-ink-muted">
				{message}
			</span>
			<div className="ms-auto flex shrink-0 items-center gap-1">
				{retry && (
					<Button
						type="button"
						variant="link"
						size="sm"
						data-dictation-retry=""
						/*
						 * A REAL TARGET AND A VISIBLE AFFORDANCE (design round 1, D3).
						 * The `link` variant's `h-auto p-0` left this control 29x12px -
						 * the text's own line box - and the underline appeared only on
						 * hover, so the one recovery control in the state was a
						 * colour-only word. `h-7 px-2` restores a 28px target (the size
						 * every other `sm` control in the row takes) and `underline`
						 * makes it look pressable at rest. Discard takes the same step
						 * for the same reason: the two are a pair of words, and only one
						 * of them being pressable-looking would read as one action.
						 */
						className="h-7 shrink-0 px-2 underline"
						aria-describedby={messageId}
						onClick={onRetry}
					>
						{t("ui.common.actions.retry")}
					</Button>
				)}
				<Button
					type="button"
					variant="link"
					size="sm"
					data-dictation-discard=""
					className="h-7 shrink-0 px-2 underline"
					aria-describedby={messageId}
					onClick={onDiscard}
				>
					{t("ui.common.actions.discard")}
				</Button>
			</div>
		</div>
	);
};
