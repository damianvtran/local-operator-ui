/**
 * The pane wrapper that owns the ONE transient-save announcement per surface.
 *
 * WHY ONE REGION FOR A WHOLE PANE (note § 2.6): a fast editor saves field
 * after field, and a live region per FIELD would narrate each of them into
 * noise. The record producers are the fields - each calls the announce
 * function this component publishes when its save lands - and the single
 * `aria-live="polite"` region here is the one thing a screen reader hears.
 * The VISUAL acknowledgement stays per field (the transient caption the
 * feedback row draws), so the two channels do not duplicate each other.
 *
 * THE REGION IS `sr-only` ON PURPOSE: sighted readers get the caption beside
 * the field, and a visible copy in a fixed spot would be a second, moving
 * target for the eye. A consumer that mounts fields WITHOUT this wrapper keeps
 * every other behaviour; only the announcement goes silent, which is why the
 * hook treats the context as optional rather than requiring the wrapper.
 *
 * The clear-then-set is what makes a repeated message audible twice ("Saved"
 * after "Saved" is the same text node otherwise, and unchanged live-region
 * content is not re-announced). The 50ms delay is one animation frame plus a
 * margin, not a waiting state: both writes happen inside the same gesture.
 */

import {
	type FC,
	type MutableRefObject,
	type ReactNode,
	createContext,
	useMemo,
	useState,
} from "react";

/**
 * The announce seam. A mutable ref rather than a function, so the hook can
 * read the LATEST publisher without listing it as a dependency (a stale
 * publisher is a missed announcement, and a changing prop would re-create
 * every field's callbacks for nothing).
 */
export const InlineEditAnnounceContext = createContext<MutableRefObject<
	((text: string) => void) | null
> | null>(null);

/** How long between clearing the region and writing the new message. */
const REANNOUNCE_DELAY_MS = 50;

export const InlineEditPane: FC<{ children: ReactNode }> = ({ children }) => {
	const [message, setMessage] = useState("");
	const announce = useMemo(
		() => ({
			current: (text: string) => {
				setMessage("");
				window.setTimeout(() => setMessage(text), REANNOUNCE_DELAY_MS);
			},
		}),
		[],
	);
	return (
		<InlineEditAnnounceContext.Provider value={announce}>
			{children}
			{/*
			 * ONE polite region per pane, visually hidden: the words the caption
			 * shows go here, and nothing else does.
			 */}
			<span
				data-inline-edit-announcement=""
				aria-live="polite"
				className="sr-only"
			>
				{message}
			</span>
		</InlineEditAnnounceContext.Provider>
	);
};
