import { updateErrorCopy } from "@shared/utils/update-error-copy";
import type { FC } from "react";
import { FloatingAlert } from "./floating-alert";

/**
 * The bottom-right alert an update-path failure paints, with the sentence a
 * person reads and the machine's own words under it.
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
 */
export interface UpdateErrorAlertProps {
	open: boolean;
	/** The message the app's update path produced, raw. */
	message: string;
	onClose: () => void;
	/** Milliseconds before it dismisses itself. Omit to leave it up. */
	autoHideDuration?: number;
}

export const UpdateErrorAlert: FC<UpdateErrorAlertProps> = ({
	open,
	message,
	onClose,
	autoHideDuration,
}) => {
	const { sentence, detail } = updateErrorCopy(message);
	return (
		<FloatingAlert
			open={open}
			autoHideDuration={autoHideDuration}
			onClose={onClose}
			variant="danger"
		>
			<p>{sentence}</p>
			{detail !== null ? (
				/*
				 * `break-words` rather than `truncate`: a wrapper-shaped failure
				 * ("Cannot parse releases feed: ...") is long, and a machine line that
				 * silently loses its tail is worse than one that wraps - it reads as
				 * the whole of what the machine said.
				 */
				<p className="break-words font-mono text-mono-sm text-ink-dim">
					{detail}
				</p>
			) : null}
		</FloatingAlert>
	);
};
