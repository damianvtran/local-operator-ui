/**
 * What an agent's picture slot draws, and whether it is a door - pure, no app
 * imports, so a Node test can execute the whole table.
 *
 * WHY ONE FUNCTION. The chat header and the transcript's turn head each used to
 * answer "is there a picture to show?" with a private `if (!present) return
 * null`, and an agent with no picture drew NOTHING: no mark, so no way to learn
 * that a picture could be set at all. Both now ask this function, so the two
 * surfaces cannot disagree about the states a slot can be in:
 *
 *   absent     no digest anywhere - the agent never had a picture;
 *   present    the digest's bytes resolved to a paintable URL;
 *   failed     a digest is CLAIMED but the bytes do not resolve (a 404, a file
 *              removed behind the row, a stale digest) - settled, no URL;
 *   cold       the answer is not known yet (the agents map or the bytes are
 *              still in flight);
 *   uploading  this window is writing (or clearing) the picture right now.
 *
 * `failed` AND `absent` DRAW THE SAME THING, by construction: both are
 * `settled` with no `src`, and `claimed` is read by no branch (a test asserts it
 * changes nothing). A failed picture that drew differently from an absent one
 * would be a second empty state with its own door, and one that kept the door of
 * a picture drew a door onto an empty plate - the defect the header's round-1 m3
 * fixed by drawing nothing at all.
 *
 * `cold` DRAWS A PLATE, NOT THE PLACEHOLDER. Pictured agents are the common case
 * after setup, and every one of them is cold for a few frames per load; the
 * placeholder's dashed ring and glyph would flash on each, then swap for a face.
 * A plain `sunken` plate holds the same box (so nothing reflows when the picture
 * lands) and says nothing it might have to retract. It carries no door either: a
 * door onto a slot we have not yet read would offer "change picture" on a
 * picture that is about to paint.
 *
 * THE PLACEHOLDER EXISTS ONLY AS A DOOR. A neutral mark for an agent the viewer
 * cannot change would be D11's repetition with nothing to offer, so it is drawn
 * for an OWNED, BOUND agent and for no one else: not-owned, remote, human and
 * unbound (`agentId` null - a draft, a packaged profile with no registry row)
 * keep drawing nothing, exactly what they drew before.
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
	 * Whether the session row CLAIMS a digest. Read by no branch: failed and
	 * absent must draw the same, and the unit test pins that.
	 */
	claimed?: boolean;
	/** This window is writing (or clearing) the agent's picture right now. */
	uploading?: boolean;
	/** The viewer may change this picture (`sessionPictureEditable`). */
	owned: boolean;
};

/** What a slot draws. `null` is "nothing", the pre-feature look. */
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
	if (!facts.agentId || !facts.owned) return null;
	if (!facts.settled && !busy) return { kind: "plate" };
	return { kind: "placeholder", door, busy };
}
