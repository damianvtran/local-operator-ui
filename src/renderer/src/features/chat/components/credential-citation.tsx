import type { FC, ReactNode } from "react";
import type { Components } from "react-markdown";
import { CredentialChip } from "./credential-chip";
import {
	type CitationRef,
	citationFromHref,
} from "./credential-citation-remark";

/*
 * THE TRANSCRIPT'S HALF OF THE CREDENTIAL CHIP: the rendered element, and the
 * anchor override that hands it the citation the remark plugin recognised.
 *
 * The plugin itself lives in `credential-citation-remark.ts`, and the split is
 * deliberate: that half is a pure function of the markdown tree and is driven by
 * `scripts/credential-capture.test.mjs` over real mdast trees, while this half is
 * the React element the frames photograph. Read that file's header for what the
 * operator reported and why the text never changes.
 */

/**
 * The chip one citation link renders as.
 *
 * THE TWO REGISTERS, from the segment the URL names: a stored credential shows
 * the name the model was told to use — the operator's own words for what a chip
 * has to say: "the credential NAME" — and a citation whose value did not survive
 * shows the warning register with its cause in the title, the same treatment the
 * composer gives a restored draft's marker (see `CREDENTIAL_NOT_STORED_ROLE`).
 *
 * NO CLEAR CONTROL, deliberately. A sent message cannot be un-sent: the
 * transcript is a record of what the model was given, and the credential store
 * on the runtime already holds the value under that name. An `x` here would have
 * to mean one of two things and both are wrong — delete a line from a record the
 * model has already read, which is a lie about what was said, or delete the key
 * from the session's store, which would silently break a bash call the agent may
 * be about to make from a different pane. What it would take to add one: a verb
 * that withdraws the credential from the session store AND reports back what the
 * model has already read, i.e. a conversation-store change rather than a render.
 * The composer's chip has one because there the reference has not been sent yet
 * and nothing else holds it.
 */
export const CredentialCitationChip: FC<{
	citation: CitationRef;
	title?: string;
}> = ({ citation, title }) => (
	<CredentialChip
		tone={citation.kind === "unstored" ? "warning" : "live"}
		label={
			citation.kind === "unstored" ? "Credential not stored" : citation.key
		}
		chars={citation.kind === "unstored" ? null : citation.chars}
		title={title}
		// Inline flow, which is the whole requirement: a citation mid-sentence must
		// stay inside its paragraph. `align-middle` keeps the chip's box on the
		// text's own baseline band instead of lifting the line, and the leading is
		// the paragraph's.
		className="align-middle"
	/>
);

/**
 * The props the override hands a link it does not recognise as a citation.
 *
 * Spelled here rather than imported as `Components["a"]`, because the caller's
 * anchor is the one implementation of a link in the app and it takes exactly
 * these: declaring the shape this file NEEDS is what lets `MarkdownAnchor`
 * (whose own props are narrower) be passed without a cast.
 */
type CitationFallbackProps = {
	href?: string;
	title?: string;
	children?: ReactNode;
};

/**
 * The `a` override that renders a citation and passes every other link through.
 *
 * A FACTORY RATHER THAN A COMPONENT, and the reason is `main`'s change, not this
 * one (`#311`, 2026-09-18): the renderer now has an anchor of its own
 * (`MarkdownAnchor`) that every link in the app renders through - file links, the
 * click decision, the drag-select refusal. A second `<a>` written here would be
 * exactly the "second implementation of one thing" the renderer's own comment
 * refuses, and the import cannot run the other way (the renderer imports THIS
 * module), so the caller passes its anchor in and this file stays the place the
 * citation rule lives.
 *
 * Called once at module scope by the renderer, for the reason that file states: a
 * component built inside a render hands react-markdown a new object every frame
 * and re-processes the whole document.
 */
export const citationAwareAnchor =
	(fallback: FC<CitationFallbackProps>): Components["a"] =>
	({ href, title, children }) => {
		const citation = citationFromHref(href);
		if (citation === null) {
			// Capitalised so JSX treats it as the component it is rather than as an
			// intrinsic tag: the caller's anchor IS the anchor, and this file does not
			// carry a second one.
			const Fallback = fallback;
			return (
				<Fallback href={href} title={title}>
					{children}
				</Fallback>
			);
		}
		return <CredentialCitationChip citation={citation} title={title} />;
	};
