import type { HubTeam, HubTeamMember } from "@shared/api/radient/types";
import { formatDate, t } from "@shared/i18n";
import { commentAge } from "../comment-age";

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

/**
 * How much of a description the summary ANNOUNCES.
 *
 * The resting row shows two clamped lines (about 220 characters at the roster's
 * measure) but the DOM carries the whole string, so a screen reader read the
 * entire text on focus - measured 3,095 characters on the long fixture row, which
 * is a minute of speech for a list row. The announcement is bounded to roughly
 * what is on screen; the full text is still one expand away, and the expansion is
 * announced in full because opening it is the reader's own request for it.
 */
export const DESCRIPTION_ANNOUNCE_CHARS = 240;

/**
 * How far into the window a word boundary has to be for the cut to back off to it.
 *
 * A description that OPENS with a short token and then runs on - "ID <300 chars of
 * x>", "Sanctions <400 chars of q>" - has its only space within the window at the
 * near edge, and backing off to it announced "ID…" (3 characters) and
 * "Sanctions…" (10). That is worse than a mid-word cut: it hides almost the whole
 * text behind an ellipsis and reads as if the description were empty. Half the
 * bound is the floor, and the character cut is kept below it.
 */
const WORD_BOUNDARY_FLOOR = DESCRIPTION_ANNOUNCE_CHARS / 2;

/**
 * The description as the summary should ANNOUNCE it: bounded at rest, whole once
 * the row is open. See `DESCRIPTION_ANNOUNCE_CHARS`.
 */
export const announcedDescription = (
	description: string,
	expanded: boolean,
): string => {
	if (expanded || description.length <= DESCRIPTION_ANNOUNCE_CHARS) {
		return description;
	}
	/*
	 * Cut at a WORD boundary, not at the character: the first version ended
	 * announcements mid-word ("...adverse med...", "...grouped by regim..."), which
	 * a screen reader reads as a broken word rather than as an abbreviation.
	 *
	 * TWO cases keep the character cut, and neither is an accident:
	 * - No space inside the window at all (a long unbroken token, a URL): there is
	 *   no word boundary to back off to, and a boundary that does not exist cannot
	 *   be used.
	 * - A boundary NEAR THE EDGE (`WORD_BOUNDARY_FLOOR`): a description that opens
	 *   with a short word and then runs on would otherwise announce three or ten
	 *   characters. See that constant.
	 *
	 * Either way the bound is respected - the cut only ever moves earlier or stays
	 * put, never past `DESCRIPTION_ANNOUNCE_CHARS`.
	 */
	const window = description.slice(0, DESCRIPTION_ANNOUNCE_CHARS);
	const boundary = window.lastIndexOf(" ");
	const head =
		boundary >= WORD_BOUNDARY_FLOOR ? window.slice(0, boundary) : window;
	return `${head.trimEnd()}…`;
};

/**
 * A date the way the expanded body and the tooltip both print it: the day, the
 * year, and the month SPELLED IN THE READER'S LANGUAGE.
 *
 * The i18n formatter layer, not date-fns' `format(date, "d MMM yyyy")`. That
 * pattern carries no locale, so date-fns fell back to its own `en-US` data and
 * a French reader saw `10 Oct 2026` beside a catalogue that renders
 * `10 oct. 2026` — an English leak on a localized surface, and the same defect
 * `formatCalendarDate` (`shared/utils/date-utils.ts`) records for
 * `"d MMMM yyyy"`. The layer resolves the active locale itself (the backend's
 * resolved language once it answers, the device tag before that) and caches one
 * formatter per locale, so nothing has to thread a tag through here; both
 * roster cells that print a date already re-render on a language switch through
 * `useI18nLocale()` in `org-teams-list.tsx`, which is what makes the new
 * language visible without a reload.
 *
 * The COMPONENTS are the contract this call site owns — numeric day,
 * abbreviated month, numeric year — so the row keeps its measure in every
 * language. The ORDER is the locale's own (`Intl`'s), not a forced day-first:
 * `en` prints `Oct 10, 2026`, `fr` `10 oct. 2026`, `ru` `10 окт. 2026 г.`.
 * Forcing English's order onto every language is exactly what the old
 * locale-less pattern did, in reverse, and the repository's settled answer to
 * it is the layer (`formatCalendarDate` above), not a per-language table here.
 */
export const formatTeamDate = (date: Date): string =>
	formatDate(date, { day: "numeric", month: "short", year: "numeric" });

const parseDate = (raw: string | undefined): Date | null => {
	if (!raw) return null;
	const date = new Date(raw);
	return Number.isNaN(date.getTime()) ? null : date;
};

/** What the provenance line says about time, and the machine value behind it. */
export type TeamRecency = {
	/** `updated`, or `created` when only the creation date is usable. */
	label: "updated" | "created";
	/**
	 * `3 days ago`, `just now`, or the absolute date for a timestamp in the future
	 * — already in the reader's language (see `recencyOf`), never English.
	 */
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
		// A seconds counter is noise on a list that does not tick. The phrase is the
		// hub surface's own "just now" (shared with the updates check), not a second
		// spelling of it, so it is already translated in every shipped locale.
		when = t("ui.hub.updates.ago.now");
	} else {
		/*
		 * `commentAge(date, now)`, NOT a bare `formatDistanceStrict` with an " ago"
		 * suffix: this line printed English on a translated roster ("3 days ago" on
		 * the French org page), because date-fns renders its own `en-US` wording and
		 * the suffix was a literal. `comment-age.ts` is the repository's settled
		 * answer to exactly this shape - it keeps date-fns' strict rounding and DST
		 * behaviour and resolves a locale whose `formatDistance` reads the
		 * `ui.hub.comments.age.*` ICU messages, so each language owns the whole phrase
		 * (its plural categories, its word order, its "ago") instead of receiving an
		 * English distance with a translated tail bolted on. That key family covers
		 * seconds through years and already ships in all eight locales, so nothing new
		 * had to be keyed here.
		 *
		 * The `now` ARGUMENT is load-bearing and must stay explicit:
		 * `formatDistanceToNowStrict(date)` reads the REAL clock, so `now` governed
		 * only the branch and the label while the distance itself was measured against
		 * wall time. The suite's fixture is a synthetic `now`, so the assertion
		 * `3 days ago` held only until wall time crossed the half-day rounding boundary
		 * (measured: 13/13 at 20:47Z, 12/13 at 20:53Z on 2026-09-30) - a test that fails
		 * by the calendar rather than by a change. With `now` defaulting to
		 * `Date.now()` production behaviour is unchanged by this call.
		 */
		when = commentAge(date, now);
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

/**
 * `Role` / `Specialist` for the two kinds the hub defines; anything else is shown
 * as stored. Read through `t()` at call time so the label follows the locale; the
 * callers re-render on a locale change, which is what makes that visible.
 */
export const kindLabel = (kind: string): string => {
	if (kind === "role") return t("ui.hub.teams.kind.role");
	if (kind === "specialist") return t("ui.hub.teams.kind.specialist");
	return kind;
};
