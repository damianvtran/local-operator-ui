/*
 * STORY FIXTURES FOR THE BOUNDED ASK CARD (`ask-bounds.tsx`).
 *
 * Shared by the inline-dock, Asks-panel and notifications stories so design
 * review screenshots the SAME payload on all three surfaces. Two proposal shapes,
 * because both reach a card in practice:
 *
 * - `PROPOSAL_SUMMARY_TEXT` is the core's new contract: the first line, a
 *   per-field line count, and the origin/review line;
 * - `PROPOSAL_LEGACY_TEXT` is what an older runtime still sends - the first line
 *   followed by the whole before/after brief (~10k characters). It is the payload
 *   from the incident, and the bound has to hold for it too.
 *
 * English on purpose: this is model/runtime-authored content, which the app
 * renders as received and never translates.
 */

const BRIEF_PARAGRAPH = [
	"DELEGATION: coder implements; reviewer and independent qa-tester exercise",
	"every PR before merge. Architect only for structural or cross-subsystem",
	"trade-offs; designer for user-visible changes using rendered artifacts;",
	"ux-reviewer for changed interactions using real flows. When several review",
	"roles run concurrently, wait for all initial reports, collect findings into",
	"one remediation task, one commit. Clean is terminal: after all streams are",
	"clean, a new commit lands only for red required CI or a real blocker.",
].join(" ");

/** A body of roughly `chars` characters, in numbered paragraphs, ending in END. */
export const longText = (chars: number, lead = ""): string => {
	const parts: string[] = lead ? [lead] : [];
	let index = 1;
	while (parts.join("\n\n").length < chars) {
		parts.push(`${index}. ${BRIEF_PARAGRAPH}`);
		index += 1;
	}
	return `${parts.join("\n\n")}\n\nEND`;
};

export const LONG_QUESTION = longText(
	10_000,
	"Before I change the alert disposition types for every tenant feed, here is the full plan and the reasoning behind each step. Should I go ahead?",
);

export const PROPOSAL_ID = "pp_7abf6b3116c87a99";

export const PROPOSAL_SUMMARY_TEXT = [
	`Apply proposal ${PROPOSAL_ID} to team 'minervadev'?`,
	"Instructions: +38 −12 lines · Description: changed",
	"Origin: trusted. Review changes in Agents → minervadev.",
].join("\n");

export const PROPOSAL_LEGACY_TEXT = [
	`Apply proposal ${PROPOSAL_ID} to team 'minervadev'?`,
	"Origin: trusted. Review in Agents → minervadev.",
	`instructions: ${longText(4_800)} → ${longText(5_200)}`,
].join("\n");

export const LONG_OPTIONS = Array.from({ length: 24 }, (_, index) => ({
	label: `Disposition set ${index + 1}`,
	description: "Applies to every tenant feed in this workspace",
}));
