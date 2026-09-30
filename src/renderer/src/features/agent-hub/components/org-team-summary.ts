import type { HubTeam, HubTeamMember } from "@shared/api/radient/types";
import { format, formatDistanceToNowStrict } from "date-fns";

/**
 * The facts the Teams roster prints about a team, derived from one `HubTeam`.
 *
 * ## Why this is a module of its own
 *
 * Every rule here is a decision about what the row may CLAIM, and each one exists
 * because the wire data is unvalidated author text: `org_teams.list` carries no
 * server-side guarantee that a description, a version, an author or a timestamp is
 * present or parseable. The component renders these values; this module decides
 * which of them are honest to render, so the rules can be executed by
 * `scripts/org-team-summary.test.mjs` instead of being read off JSX.
 *
 * The rules are the design consultation's (`docs/evidence/agent-hub-page/README.md`
 * "Teams summary"): omit what is missing rather than inventing a placeholder for
 * it, never print `Invalid Date`, never say "updated" over a creation date, and
 * never turn a future timestamp (clock skew) into "3 days ago".
 */

const LEADING_V = /^v/i;

/** How many members the team declares: the sum of `count`, the manager NOT included. */
export const memberCount = (team: HubTeam): number =>
	team.members.reduce((total, slot) => total + slot.count, 0);

/**
 * One roster slot, spelled the way the document stores it.
 *
 * A slot of one is the common case, which is why `1` is dropped: "screener ×3,
 * analyst" reads as a roster, "screener ×3, analyst ×1" as a spreadsheet.
 */
export const slotLabel = (slot: HubTeamMember): string =>
	slot.count > 1 ? `${slot.role} ×${slot.count}` : slot.role;

/** The member slots as one comma-joined tail: the elastic part of the composition line. */
export const slotList = (team: HubTeam): string =>
	team.members.map(slotLabel).join(", ");

/**
 * The version without its `v`, or null when there is nothing to show.
 *
 * The row prefixes `v` itself, so a document that already stored `v1.2.0` would
 * otherwise print `vv1.2.0`; an empty (or whitespace-only) version prints nothing
 * at all rather than a bare `v`.
 */
export const teamVersion = (team: HubTeam): string | null => {
	const bare = (team.version ?? "").trim().replace(LEADING_V, "").trim();
	return bare === "" ? null : bare;
};

/**
 * The author's NAME, or null. Never the email: this is a roster of an
 * organization's own documents, and the address is not what identifies a team.
 */
export const teamAuthor = (team: HubTeam): string | null => {
	const name = team.account_metadata?.name?.trim();
	return name ? name : null;
};

/** The description, trimmed, or null for absent / whitespace-only. */
export const teamDescription = (team: HubTeam): string | null => {
	const text = (team.description ?? "").trim();
	return text === "" ? null : text;
};

/** A date the way the expanded body and the tooltip both print it. */
export const formatTeamDate = (date: Date): string =>
	format(date, "d MMM yyyy");

const parseDate = (raw: string | undefined): Date | null => {
	if (!raw) return null;
	const date = new Date(raw);
	return Number.isNaN(date.getTime()) ? null : date;
};

/** What the provenance line says about time, and the machine value behind it. */
export type TeamRecency = {
	/** `updated`, or `created` when only the creation date is usable. */
	label: "updated" | "created";
	/** `3 days ago`, `just now`, or the absolute date for a timestamp in the future. */
	when: string;
	/** The ISO value for `<time dateTime>`, so assistive tech and a copy get the machine form. */
	iso: string;
	/** The exact date, for the pointer-only tooltip. */
	exact: string;
};

const recencyOf = (
	label: TeamRecency["label"],
	date: Date,
	now: number,
): TeamRecency => {
	const age = now - date.getTime();
	let when: string;
	if (age < 0) {
		// Clock skew: "X ago" over a timestamp that has not happened yet would be a lie.
		when = formatTeamDate(date);
	} else if (age < 60_000) {
		// A seconds counter is noise on a list that does not tick.
		when = "just now";
	} else {
		when = `${formatDistanceToNowStrict(date)} ago`;
	}
	return {
		label,
		when,
		iso: date.toISOString(),
		exact: formatTeamDate(date),
	};
};

/**
 * The recency the provenance line may state.
 *
 * `updated_at` is the ONLY source for "updated". When it is missing or
 * unparseable the line falls back to `created` from `created_date` with the label
 * changed to say so — never "updated" over a creation date — and when that is
 * unusable too there is no recency at all, so the segment is omitted.
 */
export const teamRecency = (
	team: HubTeam,
	now: number = Date.now(),
): TeamRecency | null => {
	const updated = parseDate(team.updated_at);
	if (updated) return recencyOf("updated", updated, now);
	const created = parseDate(team.created_date);
	if (created) return recencyOf("created", created, now);
	return null;
};

/** The exact created / updated dates for the expanded body; each is null when unusable. */
export const teamDates = (
	team: HubTeam,
): { created: string | null; updated: string | null } => {
	const created = parseDate(team.created_date);
	const updated = parseDate(team.updated_at);
	return {
		created: created ? formatTeamDate(created) : null,
		updated: updated ? formatTeamDate(updated) : null,
	};
};

/** `Role` / `Specialist` for the two kinds the hub defines; anything else is shown as stored. */
export const kindLabel = (kind: string): string => {
	if (kind === "role") return "Role";
	if (kind === "specialist") return "Specialist";
	return kind;
};
