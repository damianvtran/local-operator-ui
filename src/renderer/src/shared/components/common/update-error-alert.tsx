import { Button } from "@shared/components/ui";
import { updateErrorCopy } from "@shared/utils/update-error-copy";
import type { FC } from "react";
import { FloatingAlert } from "./floating-alert";
import { PanelDetails } from "./panel-details";

/**
 * The bottom-right alert an update-path failure paints, with the sentence a
 * person reads, the machine's own words under it, and the retry the sentence
 * names.
 *
 * WHY IT IS A COMPONENT AND NOT THREE LINES INSIDE `UpdateNotification`. The
 * alert used to render `{error}` - whatever string the producer set - so
 * whichever producer wrote the message decided what the user read, and the
 * operator's read `net::ERR_INTERNET_DISCONNECTED` (the whole message). It is
 * also the surface with no frame anywhere in the tree: the ErrorState story
 * drew its own `FloatingAlert` with a hardcoded sentence, which is exactly how
 * a fixture drifts from the component it stands for. One component, used by
 * the app and by the story, keeps the two from disagreeing.
 *
 * The two registers are the app's, not this file's invention: the sentence is
 * prose at reading weight, the machine's words are monospace and dim below it,
 * which is what `browser-load-failure.tsx` does for a refused page load and
 * what `docs/branding.md` 7 says about machine voice.
 *
 * WHY THE MACHINE LINE IS LABELLED AND COPYABLE, and why it is `PanelDetails`.
 * A bare unlabelled mono line reads as stray rather than as evidence, and the
 * only use a transport code has for a person is quoting it in a report - the
 * same two reasons the by-hand and install panels below already show their
 * detail under `Details:` with a copy button (design D4). This feature had two
 * idioms for one job; it now has one.
 *
 * WHY THE RETRY IS HERE. The copy says "then try again" and named no owner: the
 * app's own retries had already run, the check control lives in the update
 * panel (possibly on another screen), and the only control on the alert was the
 * X. `FloatingAlert` already supports an action beside the message - the
 * connectivity banner's Retry is one - so the sentence's promise is a button
 * (design D3, UX U1/U3). `updateErrorCopy` decides whether it applies at all: a
 * download or install failure is not answered by another check, and those
 * surfaces keep their own control.
 */
export interface UpdateErrorAlertProps {
	open: boolean;
	/** The message the app's update path produced, raw. */
	message: string;
	onClose: () => void;
	/** Milliseconds before it dismisses itself. Omit to leave it up. */
	autoHideDuration?: number;
	/** Runs the check again, for a failure whose answer is another check. */
	onRetry?: () => void;
	/** Whether that check is running now, so the button cannot stack them. */
	retrying?: boolean;
}

export const UpdateErrorAlert: FC<UpdateErrorAlertProps> = ({
	open,
	message,
	onClose,
	autoHideDuration,
	onRetry,
	retrying = false,
}) => {
	const { sentence, detail, action } = updateErrorCopy(message);
	return (
		<FloatingAlert
			open={open}
			autoHideDuration={autoHideDuration}
			onClose={onClose}
			variant="danger"
			action={
				action === "check" && onRetry ? (
					/*
					 * `primary`, not `outline`: an outlined control's only boundary here is
					 * `border-control` against the danger wash, which measures 2.98:1 in
					 * iceberg - under the 3:1 floor the contract sets for a control's sole
					 * edge - with sage 3.09 and localOperatorLight 3.32 behind it (design
					 * round 2, D10). The accent fill clears the wash everywhere (4.44-16.29
					 * edge across the twelve palettes) with `on-accent` ink at 5.26-19.06,
					 * and branding section 2 is where the accent belongs: the primary action
					 * of the surface. The pair is asserted as its own `CONTROLS` row.
					 */
					<Button
						variant="primary"
						size="sm"
						onClick={onRetry}
						disabled={retrying}
					>
						{/* The button is the owner "then try again" was missing, so its
						    label is the copy's own verb rather than a second sentence. */}
						{retrying ? "Checking..." : "Try again"}
					</Button>
				) : null
			}
		>
			<p>{sentence}</p>
			{detail !== null ? <PanelDetails detail={detail} stacked /> : null}
		</FloatingAlert>
	);
};
