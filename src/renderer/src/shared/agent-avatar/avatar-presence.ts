/**
 * What an agent's picture slot draws, and whether it is a door - pure, no app
 * imports, so a Node test can execute the whole table.
 *
 * WHY ONE FUNCTION. The chat header and the transcript's turn head both ask this
 * function, so the two surfaces cannot disagree about the states a slot can be in:
 *
 *   absent     no digest anywhere - the agent never had a picture;
 *   present    the digest's bytes resolved to a paintable URL;
 *   failed     a digest is CLAIMED but the bytes do not resolve (a 404, a file
 *              removed behind the row, a stale digest) - settled, no URL;
 *   cold       the answer is not known yet (the agents map or the bytes are
 *              still in flight);
 *   uploading  this window is writing (or clearing) the picture right now.
 *
 * NO PICTURE, NO MARK - AND NO SPACE (operator, 2026-11-04: "make the photo icon
 * not appear if the agent doesn't have an image yet, it doesn't need to be there
 * or occupy space or attention"). #1651 drew a dashed camera placeholder as a
 * door for every owned agent with no picture, so the feature was findable from
 * chat. On the transcript it took a line of its own above the first tool row,
 * and in the header a box before the title, for agents that will mostly never
 * get a picture: most sessions are simple tasks delegated to a generic role
 * (manager, coder), not agents with a "personality". An empty mark costs space
 * and attention on every one of them, and the place to set a picture is the
 * agent's editor (Agents -> agent -> Edit), which keeps its own empty-state
 * camera. So `absent`, `failed` and `unreadable` answer `null` - owned or not -
 * and the caller draws no wrapper, no margin and no gap.
 *
 * THE ONE EXCEPTION: `suggestPicture`. A proactive-class agent, or the chief of
 * staff, is an agent the operator relates to as someone - the operator's own
 * words: "only suggest that on proactive class agents or on the chief of staff".
 * For those, and only on the surface that passes the fact (the CHAT HEADER, once
 * per conversation), an owned, bound agent with no picture still gets the
 * placeholder door. The transcript, the sidebar rows and Team Bridge never pass
 * it: a row per turn or per conversation is exactly the cost the operator
 * objected to.
 *
 * `cold` DRAWS A PLATE ONLY WHEN A DIGEST IS CLAIMED. Pictured agents are cold
 * for a few frames per load; a plain `sunken` plate holds the box so nothing
 * reflows when the face lands. Without a claimed digest there is no face coming,
 * and a plate would be a transient box that flashes and vanishes on every
 * pictureless agent - so an unclaimed cold read draws nothing. (An unhinted read
 * cannot claim anything until the agents map answers, so it draws nothing until
 * then too.) The plate carries no door: a door onto a slot we have not yet read
 * would offer "change picture" on a picture that is about to paint.
 *
 * `uploading` keeps the box busy ONLY where a placeholder would be drawn (a
 * `suggestPicture` header): the write then swaps a door for a spinner without
 * a reflow. Everywhere else a first upload draws nothing until the face lands -
 * the editor that is writing shows its own progress - and a picture being
 * replaced keeps drawing, door closed.
 *
 * THE DOOR (the pencil on hover) is on a PRESENT picture of an OWNED, BOUND
 * agent, and on the `suggestPicture` placeholder: not-owned, remote, human and
 * unbound (`agentId` null - a draft, a packaged profile with no registry row)
 * never get one, and never get a placeholder either.
 */

/** The address a mark's door opens. Both fields are required to build a link. */
export type AvatarDoor = { agentId: string; agentName: string };

/** Everything the decision reads. */
export type AvatarPresenceFacts = {
	/** The local agent the picture belongs to; null when none could key one. */
	agentId: string | null;
	/** The agent's own name (the editor link's address); null when unknown. */
	agentName: string | null;
	/** The paintable URL the bytes resolved to, or null for any reason they have not. */
	src: string | null;
	/**
	 * False while the answer is still being read (the agents map, or the bytes).
	 * With a `src` it is irrelevant; without one it separates `cold` from
	 * `failed`/`absent`.
	 */
	settled: boolean;
	/**
	 * Whether a digest is CLAIMED for the agent (the row's hint, or the agents
	 * map's answer): a picture is on its way. Decides whether a cold read holds a
	 * plate or draws nothing. Once settled it changes nothing - failed and absent
	 * both draw nothing, and the unit test pins that.
	 */
	claimed?: boolean;
	/** This window is writing (or clearing) the agent's picture right now. */
	uploading?: boolean;
	/**
	 * The agents list could not be read, so "no picture" is unknown, not an
	 * answer (agent review m-3). Without a `src` it draws nothing, even while
	 * cold: there is no claimed digest to hold a box for.
	 */
	unreadable?: boolean;
	/** The viewer may change this picture (`sessionPictureEditable`). */
	owned: boolean;
	/**
	 * This surface may SUGGEST a picture when there is none: true only from the
	 * chat header, and only for a proactive-class agent or the chief of staff
	 * (`agentSuggestsPicture`). Absent is false - every other surface and agent.
	 */
	suggestPicture?: boolean;
};

/**
 * What a slot draws. `null` is "nothing": no element and no reserved space, the
 * look of every pictureless agent.
 */
export type AvatarMark =
	| { kind: "picture"; src: string; door: AvatarDoor | null }
	| { kind: "placeholder"; door: AvatarDoor | null; busy: boolean }
	| { kind: "plate" };

export function decideAvatarMark(
	facts: AvatarPresenceFacts,
): AvatarMark | null {
	const busy = facts.uploading === true;
	/*
	 * THE DOOR IS CLOSED WHILE A WRITE IS IN FLIGHT: the editor that is writing is
	 * already open (it is the only writer in this window), so a second way in
	 * would lead to a pane that is read-only until the write settles.
	 */
	const door: AvatarDoor | null =
		facts.owned && !busy && facts.agentId && facts.agentName
			? { agentId: facts.agentId, agentName: facts.agentName }
			: null;
	if (facts.src) return { kind: "picture", src: facts.src, door };
	const bound = Boolean(facts.agentId) && facts.owned;
	const suggest = bound && facts.suggestPicture === true;
	/*
	 * A write in flight on a suggesting surface: the box stays (it held the door a
	 * moment ago), busy and closed, so nothing reflows when the face lands.
	 */
	if (suggest && busy) return { kind: "placeholder", door, busy };
	/*
	 * A plate only holds the box for a face that is coming: a claimed digest, a
	 * read not yet settled, and an owned, bound agent (a remote agent's bytes may
	 * never resolve here, and a plate that then vanishes is the flash this rule
	 * exists to avoid). A suggesting surface holds the plate too, while it cannot
	 * yet tell "no picture" from "not read yet", so the door does not flash in
	 * over a picture about to paint.
	 */
	if (!facts.settled && !facts.unreadable && bound)
		return facts.claimed === true || suggest ? { kind: "plate" } : null;
	if (suggest && facts.settled && !facts.unreadable)
		return { kind: "placeholder", door, busy };
	return null;
}

/**
 * The registry name of the chief of staff's seat (`AIDA_SEAT_NAME` in
 * `features/aida/use-aida-target.ts`), spelled here because this module stays
 * import-free so a Node test can execute it; a test pins the two equal.
 */
export const CHIEF_OF_STAFF_SEAT = "aida";

/**
 * Whether an agent is one the header may SUGGEST a picture for: the chief of
 * staff, or a proactive-class agent (operator, 2026-11-04). Everything else - the
 * generic roles most sessions are delegated to, an unknown agent, a profile list
 * not read yet - is no, so the default answer draws nothing. The class is read
 * the way `classOf` reads it: only the literal `proactive` counts.
 */
export function agentSuggestsPicture(
	agentName: string | null,
	profiles: ReadonlyArray<{ name: string; action_class?: unknown }> | undefined,
): boolean {
	if (!agentName) return false;
	if (agentName === CHIEF_OF_STAFF_SEAT) return true;
	return (
		profiles?.some(
			(row) => row.name === agentName && row.action_class === "proactive",
		) ?? false
	);
}
