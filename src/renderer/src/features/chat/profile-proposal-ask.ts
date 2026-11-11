/*
 * PROFILE / TEAM / SKILL PROPOSAL ASKS, RECOGNISED FROM THE CARD THEY ARRIVE ON.
 *
 * WHY THIS EXISTS. The core's `Session.decide_profile_proposal` raises an
 * approval (gate `account profile save`) whose text used to carry the WHOLE
 * proposed brief - before and after, every line - so one team-brief proposal
 * filled the conversation pane, could not be scrolled, and hid the answer pair
 * and the composer. Two fixes ride together: the core now sends a short summary,
 * and every surface that draws such an ask points the reader at the proposal's
 * real review (the Agents page's git-style diff) instead of trying to show it.
 *
 * THE SHARED CONTRACT with the core PR (neither side may require the other to be
 * merged first):
 * - the card's FIRST line keeps the exact form
 *   `Apply proposal <pp_id> to <kind> '<name>'?`, kind in agent|team|skill, name
 *   Python-repr-quoted. The id must stay in the text: spoken approval in chat
 *   matches `proposal_id in text`, so this module only READS that line;
 * - the core MAY attach a structured `profile_proposal: {id, kind, name, fields}`
 *   to the event. When present it wins; the text line is the floor that works
 *   against every runtime, including ones older than the structured field.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: parse the summary lines that follow. They are
 * prose for a person (and an older runtime's are the full dump); the card shows
 * them inside a bounded scroll region, and the diff viewer is the real review.
 */

export type ProfileProposalKind = "agent" | "team" | "skill";

/** One changed field, as the core summarises it (counts, never content). */
export type ProfileProposalField = {
	label: string;
	added?: number;
	removed?: number;
};

export type ProfileProposalRef = {
	id: string;
	kind: ProfileProposalKind;
	name: string;
	fields?: ProfileProposalField[];
};

/*
 * Anchored at the start and the `?`: a proposal id quoted in the MIDDLE of some
 * other question ("did you mean to Apply proposal pp_... ?") is not a proposal
 * card, and linking it would offer a review the ask is not about. Multiline so
 * the anchor is "start of a line": the dock renders `title` and `detail` and the
 * contract line is the detail's first line, which a caller passes on its own,
 * but an ask question may carry it after a leading blank line.
 *
 * The name class is `[^']+`: Python's repr picks double quotes for a name that
 * contains a single quote, and such a name would not round-trip through the
 * Agents URL as typed anyway - the structured field is the path for it.
 */
const PROPOSAL_LINE =
	/^Apply proposal (pp_[0-9a-f]+) to (agent|team|skill) '([^']+)'\?/m;

/** The id shape the core mints (`pp_` + hex); anything else is not one. */
const PROPOSAL_ID = /^pp_[0-9a-f]+$/;

const KINDS: readonly ProfileProposalKind[] = ["agent", "team", "skill"];

const isKind = (value: unknown): value is ProfileProposalKind =>
	typeof value === "string" && (KINDS as readonly string[]).includes(value);

/** Read the contract's first line out of a card's text, or `null`. */
export const parseProfileProposalText = (
	text: string | null | undefined,
): ProfileProposalRef | null => {
	if (!text) return null;
	/*
	 * Only the head of the text is searched. The match is anchored, so this is
	 * about cost rather than correctness: an older runtime's card is the full
	 * brief (the very payload this change exists for, ~10k characters), and the
	 * contract line is always the first non-empty line.
	 */
	const head = text.trimStart().slice(0, 400);
	const match = PROPOSAL_LINE.exec(head);
	if (!match || match.index !== 0) return null;
	return {
		id: match[1],
		kind: match[2] as ProfileProposalKind,
		name: match[3],
	};
};

/*
 * The structured field, validated rather than trusted: it arrives over the wire
 * from whichever runtime is attached, and a malformed object must fall back to
 * the text, never render a link built from `undefined`.
 */
export const readStructuredProposal = (
	value: unknown,
): ProfileProposalRef | null => {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	if (typeof raw.id !== "string" || !PROPOSAL_ID.test(raw.id)) return null;
	if (!isKind(raw.kind)) return null;
	if (typeof raw.name !== "string" || raw.name.length === 0) return null;
	const fields = Array.isArray(raw.fields)
		? raw.fields.flatMap((field): ProfileProposalField[] => {
				if (!field || typeof field !== "object") return [];
				const row = field as Record<string, unknown>;
				if (typeof row.label !== "string") return [];
				return [
					{
						label: row.label,
						added: typeof row.added === "number" ? row.added : undefined,
						removed: typeof row.removed === "number" ? row.removed : undefined,
					},
				];
			})
		: undefined;
	return { id: raw.id, kind: raw.kind, name: raw.name, fields };
};

/** Structured first, then the text's contract line. */
export const profileProposalOf = (
	structured: unknown,
	...texts: Array<string | null | undefined>
): ProfileProposalRef | null => {
	const fromWire = readStructuredProposal(structured);
	if (fromWire) return fromWire;
	for (const text of texts) {
		const parsed = parseProfileProposalText(text);
		if (parsed) return parsed;
	}
	return null;
};

/*
 * THE DEEP LINK, in the URL contract of the Agents page's proposal review
 * (`/agents?kind=&name=&proposal=`): `ProfileProposalPanel` reads
 * `params.get("proposal")` and renders the diff. On a build without that panel
 * the same URL still opens the agent/team detail - `kind` and `name` are what
 * the sidebar's own links already send - so the link is never a dead end.
 * `URLSearchParams` does the encoding, so a name with spaces or `&` survives.
 */
export const profileProposalReviewPath = (ref: ProfileProposalRef): string => {
	const params = new URLSearchParams({
		kind: ref.kind,
		name: ref.name,
		proposal: ref.id,
	});
	return `/agents?${params.toString()}`; // i18n: ignore in-app route path, not interface copy
};
