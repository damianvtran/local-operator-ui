import type { Reply } from "@shared/store/conversation-input-store";
import { v4 as uuidv4 } from "uuid";

/*
 * One reply block, as `buildSendPayload` writes it: the markup at the START of
 * the payload, with block text that may span several lines.
 *
 * Two properties here are load-bearing, and the scan was wrong about both.
 *
 * DOTALL. `[\s\S]` rather than `.` because `.` never crosses a newline.
 * The quote path deliberately does not truncate (a quote is a claim about what
 * was said), so a quoted turn is routinely several paragraphs; with `.` nothing
 * matched, `remainingContent` was the whole payload, and the sent row painted
 * `<reply-to>...</reply-to>` as literal text at reading weight - the exact
 * defect this split exists to remove, in the common case rather than an edge.
 * The reader's own drag reaches the same scan by a second route:
 * `selection.toString()` carries the newline between two visual lines.
 *
 * THE ANCHOR. `buildSendPayload` is the only writer of this markup in the
 * product and it always PREFIXES it - one block per staged reply, newline
 * joined, then the typed words - so an occurrence anywhere else is not
 * transport. Matching the tag anywhere rewrote prose: an assistant answer (this
 * codebase's own sessions discuss this wire format) that recites
 * `<reply-to>x</reply-to>` had that text deleted from its body and re-painted
 * as a quote block labelled "Replying to", which is a rendering lie of the same
 * family. Reading only the leading run makes that impossible by construction
 * and loses nothing legitimate, including the echoed prompt the assistant row
 * documents - an echo of a payload is a leading run too.
 *
 * `\s*` after the anchor also eats the newline `buildSendPayload` joins stacked
 * blocks with, so a run of blocks stays one run however many are staged, and it
 * leaves leading blank lines outside the quote rather than inside it.
 *
 * Non-greedy, and anchored is not greedy: a quoted body that itself mentions
 * `<reply-to>` keeps those words. A literal `</reply-to>` inside a quoted body
 * is the format's own limit - the tag is not escapable, so the scan closes the
 * block at the first one - and it is pinned as that rather than papered over in
 * `scripts/message-quote.test.mjs`.
 *
 * Not global, so `exec` is not stateful here and no `lastIndex` survives a call;
 * the loop advances by slicing, which is the anchored scan's own measure of how
 * much of the string is transport.
 */
const REPLY_BLOCK = /^\s*<reply-to>([\s\S]*?)<\/reply-to>/;

/**
 * The reply markup a payload carries, and the payload without it.
 *
 * Shared by the canonical transcript and the legacy `message-paper.tsx` path,
 * so this rule is what both of them render by.
 */
export const parseReplies = (
	content: string,
): { replies: Reply[]; remainingContent: string } => {
	const replies: Reply[] = [];
	let rest = content;

	for (;;) {
		// Anchored, so this cannot run past the transport prefix and start
		// consuming prose that happens to quote the tags.
		const match = REPLY_BLOCK.exec(rest);
		if (match === null) {
			break;
		}
		// This is the part of the match that is inside the tag
		replies.push({ id: uuidv4(), text: match[1] });
		rest = rest.slice(match[0].length);
	}

	// Whatever follows the run is the speaker's own words; the whitespace the
	// run left behind - the join newline, any blank line - is not content.
	return { replies, remainingContent: rest.trim() };
};
