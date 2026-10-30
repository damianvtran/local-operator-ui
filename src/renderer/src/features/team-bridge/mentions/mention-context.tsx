import { createContext, useContext } from "react";
import type { MentionCandidateRow } from "./candidates";

/**
 * What a composer needs to offer @-mentions, provided by the page that owns the
 * conversation and its cached reads.
 *
 * WHY A CONTEXT RATHER THAN COMPOSER PROPS. The composer and its send path
 * belong to another lane that is changing them at the same time; threading six
 * new props through `TeamBridgeComposer` would turn every one of its edits into
 * a conflict. With a context the composer's mount is one hook call and two JSX
 * slots, and a composer with NO provider (a story, the agents page) gets an
 * inert hook: no popover, no tokens, `payload()` returns undefined.
 */
export type MentionSource = {
	candidates: readonly MentionCandidateRow[];
	/** The open conversation's kind; null while composing a new message. */
	conversationKind: "dm" | "group" | "channel" | null;
	/**
	 * `team_bridge_send_mentions` answered `enabled`. Without it the composer
	 * still offers pills (the readable `@Name` stays in the body) but sends no
	 * `mentions[]`, because an older backend refuses an unknown field.
	 */
	sendMentions: boolean;
	/** Invite a non-member; absent where the reader cannot invite (or in a DM). */
	onInvite?: (candidate: MentionCandidateRow) => Promise<unknown>;
};

export const MentionSourceContext = createContext<MentionSource | null>(null);

export function useMentionSource(): MentionSource | null {
	return useContext(MentionSourceContext);
}
