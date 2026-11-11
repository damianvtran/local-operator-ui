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
 * merged first). The TEXT is the contract - the approval gate carries only
 * `(tool_name, description, job_id)` through TUI, mobile, SDK and the control
 * handlers, so a structured side channel was judged disproportionate - and the
 * text is line-structured (core `profile_proposals.approval_card_text`):
 *
 *   1. `Apply proposal <pp_id> to <kind> <name-repr>?` - kind agent|team|skill,
 *      name Python-repr quoted (`'name'`, or `"name"` when it holds `'`). The id
 *      must stay in the text: spoken approval in chat matches `proposal_id in
 *      text`, so this line is rendered as-is, never rewritten;
 *   2. `Changes: <label> +A −R lines; <label> changed; … N more` (≤ 160 chars);
 *   3. `Origin: <trust>. Review changes in Agents → <name>.`
 *
 * The TUI and mobile show the three lines raw. This module splits them so the
 * desktop card can draw line 2 and the origin as its own compact summary and
 * drop line 3's "Review changes in Agents → X" sentence, which duplicates the
 * card's Review button and names the target a second time.
 *
 * DEGRADING. Only line 1 is required. An older runtime's card is line 1 followed
 * by the WHOLE brief; there lines 2/3 do not match, nothing is stripped, and the
 * full text stays in the bounded body - the card still gets its review link.
 * Lines 2/3 are recognised only in their positions (right after line 1), so a
 * brief that happens to contain "Changes: " further down is never lifted out.
 */

export type ProfileProposalKind = "agent" | "team" | "skill";

export type ProfileProposalRef = {
	id: string;
	kind: ProfileProposalKind;
	name: string;
};

/** A recognised proposal card: its identity plus the text split by role. */
export type ProfileProposalCard = ProfileProposalRef & {
	/** Line 2 verbatim (`Changes: …`), or `null` on a runtime without it. */
	changes: string | null;
	/** Line 3's origin sentence alone (`Origin: agent.`), or `null`. */
	origin: string | null;
	/**
	 * What the card's question body should still print: line 1 plus every line
	 * that was NOT recognised as line 2/3 (an older runtime's full dump).
	 */
	body: string;
};

/*
 * Line 1. Anchored at both ends of the sentence: a proposal id quoted in the
 * MIDDLE of some other question ("did you mean to Apply proposal pp_... ?") is
 * not a proposal card, and linking it would offer a review the ask is not about.
 *
 * The name accepts both Python-repr quote forms (manager decision on core review
 * M1): `'name'`, and `"name"`, which repr picks for a name holding an
 * apostrophe. Inside either, a backslash escape is one unit (`\\.`) so an
 * escaped quote (`\'` in the single-quoted form, which repr writes when the name
 * holds BOTH quote kinds) does not end the name early; `unescapeRepr` then turns
 * `\\` / `\'` / `\"` back into the characters the user typed. Other repr escapes
 * (`\n`, `\x07`) are not decoded - profile names are slugs, and a name holding
 * a control character would not round-trip through the Agents URL anyway.
 */
const PROPOSAL_LINE =
	/^Apply proposal (pp_[0-9a-f]+) to (agent|team|skill) (?:'((?:[^'\\\n]|\\.)+)'|"((?:[^"\\\n]|\\.)+)")\?/;

const CHANGES_LINE = /^Changes: \S/;

/*
 * Line 3. The core clips it at 200 chars (`_clip` appends `…`); a clipped line
 * no longer ends in the review sentence, fails this match, and is kept in the
 * body verbatim rather than half-stripped.
 */
const ORIGIN_LINE = /^(Origin: [^\n]+?\.) Review changes in Agents → [^\n]+\.$/;

/** `\\` -> `\`, `\'` -> `'`, `\"` -> `"`: the escapes repr can put in a name. */
const unescapeRepr = (quoted: string): string =>
	quoted.replace(/\\(["'\\])/g, "$1");

/** Read a proposal card out of an ask/approval text, or `null`. */
export const parseProfileProposalCard = (
	text: string | null | undefined,
): ProfileProposalCard | null => {
	if (!text) return null;
	// Leading blank lines are tolerated: an ask question may open with one.
	const lines = text.trimStart().split("\n");
	const match = PROPOSAL_LINE.exec(lines[0] ?? "");
	if (!match) return null;
	const rest = lines.slice(1);
	let changes: string | null = null;
	let origin: string | null = null;
	if (rest[0] !== undefined && CHANGES_LINE.test(rest[0])) {
		changes = rest.shift() ?? null;
	}
	const originMatch = rest[0] === undefined ? null : ORIGIN_LINE.exec(rest[0]);
	if (originMatch) {
		origin = originMatch[1];
		rest.shift();
	}
	return {
		id: match[1],
		kind: match[2] as ProfileProposalKind,
		name: unescapeRepr(match[3] ?? match[4]),
		changes,
		origin,
		body: [lines[0], ...rest].join("\n").trimEnd(),
	};
};

/** The first text that carries a proposal card, or `null`. */
export const profileProposalOf = (
	...texts: Array<string | null | undefined>
): ProfileProposalCard | null => {
	for (const text of texts) {
		const parsed = parseProfileProposalCard(text);
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
