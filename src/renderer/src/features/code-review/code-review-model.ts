/**
 * The Code review pane's copy and its derivations, as pure functions.
 *
 * WHY THIS FILE EXISTS. The pane, the composer chip and the rail item all read
 * one ledger, and each carries the same figures in a different register (a
 * clause, a tooltip, an announced name). The design's rule for this surface is
 * the app's own: one derived string per fact, so the chip and the panel it opens
 * cannot state one number two ways. Everything here is a pure function over the
 * WIRE ROWS (`DesktopCodeRequestRow`) so the stories, the components and any
 * later test drive one implementation.
 *
 * WHAT IS NEVER DONE HERE. The relation is the BACKEND's vocabulary and is
 * never re-derived: `unknown` stays "possibly opened by this session" and is
 * never upgraded to `opened` (a script that merely printed a PR URL is
 * indistinguishable from one that created it without the forge's record, design
 * record §A.4). A failed refresh keeps the last known data; `refresh_error` is
 * the only thing that says so, and `stale` alone is never rendered as a failure
 * - "Couldn't refresh" is a claim about an ATTEMPT and is spent only where an
 * attempt was recorded as failing.
 */

import type {
	DesktopCodeRequestCi,
	DesktopCodeRequestLane,
	DesktopCodeRequestRow,
	DesktopCodeRequestVia,
} from "../../../../shared/desktop-contract";

/** The wire row, re-named for the feature's own call sites. */
export type CodeRequestRow = DesktopCodeRequestRow;
export type CodeRequestLane = DesktopCodeRequestLane;
export type CodeRequestCi = DesktopCodeRequestCi;

/**
 * Lane display order: Code, Design, QA, UX (§2), then anything a newer backend
 * serves, in wire order, so an unknown lane is shown after the known four
 * rather than dropped.
 */
const LANE_ORDER = ["agent", "design", "qa", "ux"] as const;

/**
 * The lane's displayed name: the `agent` lane is the session's own work and the
 * design names it **Code** (§2). Every other known lane is its capitalised
 * name; an unknown one renders raw, because a name this build has never heard
 * of is still the name of a review that happened.
 */
export function laneDisplayName(lane: string): string {
	switch (lane) {
		case "agent":
			return "Code";
		case "design":
			return "Design";
		case "qa":
			return "QA";
		case "ux":
			return "UX";
		default:
			return lane;
	}
}

/** The states §C.5's machine names, for exhaustiveness in the clause builder. */
type LaneState =
	| "findings_open"
	| "remediation_posted"
	| "clean"
	| "terminal"
	| "unstated";

const LANE_STATE_WORDS: Record<LaneState, string> = {
	findings_open: "findings open",
	remediation_posted: "remediation posted",
	clean: "clean",
	terminal: "terminal",
	unstated: "reviewed — verdict not stated",
};

/**
 * One lane's clause: `Round 2 · remediation posted`, and for a lane with no
 * parsed state `No agent review yet` (the DESIGN-UI §11 string; §C.5 names the
 * state `awaiting review` and fixes its copy to this one).
 *
 * A state this build has never seen prints the RAW value after the round ("one
 * fact, one mark" refuses to guess a word for it, and dropping the lane would
 * hide a review that happened) — the same direction `DesktopProject.status`
 * takes for an unknown status.
 */
export function laneStateClause(lane: {
	state: string;
	round: number;
}): string {
	const word = LANE_STATE_WORDS[lane.state as LaneState] ?? lane.state.trim();
	if (lane.state === "awaiting_review") return "No agent review yet";
	return `Round ${lane.round} · ${word}`;
}

/**
 * The freshness tail: `stale — reviewed a3ffd2b, head 9d29452` (§3), or null
 * for `fresh` and for an unknown head — fresh is the default and unmarked, and
 * `unknown` claims nothing (§C.5: an absent SHA is never guessed).
 *
 * Both SHAs are shortened to the 7-character prefix the copy uses; the caller
 * keeps the full sentence in the element's `title` where the clause truncates.
 */
export function laneFreshnessClause(
	lane: {
		freshness: string;
		reviewed_head: string | null;
	},
	headSha: string | null | undefined,
): string | null {
	if (lane.freshness !== "stale") return null;
	const reviewed = lane.reviewed_head?.slice(0, 7) ?? "";
	const head = headSha?.slice(0, 7) ?? "";
	if (reviewed && head) return `stale — reviewed ${reviewed}, head ${head}`;
	if (reviewed) return `stale — reviewed ${reviewed}`;
	return "stale";
}

/** One rendered lane row: the name, its segment strip, and the joined clause. */
export type LaneLine = {
	key: string;
	name: string;
	/** One segment per round, in the tone the round's state maps to (§2). */
	segments: ReadonlyArray<{ key: string; tone: LaneSegmentTone }>;
	/** The clause the row prints: `Round 2 · remediation posted · stale — …`. */
	clause: string;
	/** The full untruncated sentence for `title` (the clause truncates in CSS). */
	title: string;
};

export type LaneSegmentTone = "warning" | "muted" | "success" | "outline";

/**
 * The tone a round's state maps to, by role and never by hex (§2's table):
 * findings open → warning, remediation posted → muted, clean/terminal →
 * success, verdict not stated → outline only (the segment is drawn as a border
 * with no fill). An `awaiting_review` lane and a state this build has never
 * seen take the outline treatment for the same reason the clause prints raw:
 * the mark states "there is a round here" and claims nothing beyond it.
 */
export function laneSegmentTone(state: string): LaneSegmentTone {
	switch (state) {
		case "findings_open":
			return "warning";
		case "remediation_posted":
			return "muted";
		case "clean":
		case "terminal":
			return "success";
		default:
			return "outline";
	}
}

/**
 * The lane lines for one row: every lane the wire carries, ordered Code,
 * Design, QA, UX, then the rest in wire order.
 *
 * THE CODE LINE IS ALWAYS PRESENT WHILE THE REQUEST IS OPEN OR A DRAFT (§C.5:
 * the code lane's no-comment state is `awaiting review`, copy "No agent review
 * yet"), so a PR with only a design lane still shows its own line. A
 * merged/closed request with NO lanes omits the strip entirely (design-UI §1);
 * one that has lanes keeps them, because a finished review history is worth the
 * two lines it takes.
 */
export function laneLines(row: CodeRequestRow): LaneLine[] {
	const state = row.summary?.state ?? null;
	const lanes = [...(row.lanes ?? [])].sort(
		(a, b) => laneRank(a.lane) - laneRank(b.lane),
	);
	const hasCode = lanes.some((lane) => lane.lane === "agent");
	const order: CodeRequestLane[] =
		!hasCode && (state === "open" || state === "draft")
			? [
					{
						lane: "agent",
						round: 0,
						qualifier: null,
						state: "awaiting_review",
						freshness: "unknown",
						reviewed_head: null,
						reviewer: null,
						verdict: null,
						open_findings: null,
					},
					...lanes,
				]
			: lanes;

	return order.map((lane, index) => {
		const name = laneDisplayName(lane.lane);
		const freshness = laneFreshnessClause(lane, row.summary?.head_sha);
		const clause = [laneStateClause(lane), freshness]
			.filter(Boolean)
			.join(" · ");
		return {
			key: `${lane.lane}-${index}`,
			name,
			segments: roundSegments(lane),
			clause,
			title: `${name} — ${clause}`,
		};
	});
}

const laneRank = (lane: string): number => {
	const index = (LANE_ORDER as readonly string[]).indexOf(lane);
	return index === -1 ? LANE_ORDER.length : index;
};

/**
 * The segments for one lane: one per round up to the lane's latest, in the
 * latest round's tone, with earlier rounds' tones unknown the wire does not
 * carry.
 *
 * THE WIRE PARSES ONE STATE PER LANE - the latest convention comment's - so
 * earlier segments take the same latest-event tone by necessity rather than
 * choice: `lanes` carries one entry per lane, not one per round. The count is
 * the marker of progress (round N means N rounds ran); the tone is the
 * question the operator is asking. When a later version carries per-round
 * rows, this is the function that stops approximating.
 */
function roundSegments(lane: CodeRequestLane): LaneLine["segments"] {
	const count = Math.max(0, Math.floor(lane.round));
	const tone = laneSegmentTone(lane.state);
	return Array.from({ length: count }, (_, index) => ({
		key: `${lane.lane}-round-${index}`,
		tone,
	}));
}

/**
 * The row partition: `Opened` = relations opened/inherited/unknown (each
 * disambiguated by its line-A tag); `Mentioned` = mentioned (§4).
 *
 * The order inside each group is ONE comparator for both, the design record's
 * own ("opened → acted → most recent mention", §A.5): a real open first, then
 * the possibles, then anything this session acted on, then the freshest
 * mentions - and the latest mention breaks every remaining tie.
 */
export function groupRows(rows: readonly CodeRequestRow[]): {
	opened: CodeRequestRow[];
	mentioned: CodeRequestRow[];
} {
	const sorted = [...rows].sort((a, b) => {
		const rank = relationRank(a) - relationRank(b);
		if (rank !== 0) return rank;
		const acted = b.acted.length - a.acted.length;
		if (acted !== 0) return acted;
		return b.mention.last_at - a.mention.last_at;
	});
	return {
		opened: sorted.filter((row) => row.relation !== "mentioned"),
		mentioned: sorted.filter((row) => row.relation === "mentioned"),
	};
}

const relationRank = (row: CodeRequestRow): number => {
	switch (row.relation) {
		case "opened":
			return 0;
		case "unknown":
			return 1;
		case "inherited":
			return 2;
		default:
			return 3;
	}
};

/**
 * The state pill for a row's fetched summary, or null when there is none
 * (link-only rows render no pill).
 *
 * The variants are the app's own badge vocabulary (§1) mapped from the forge's
 * state; `draft` wins over `open` because a draft PR is the state the operator
 * must not confuse with one that can merge - and the forge reports
 * `state: "open"` for it. An unknown state takes `neutral` with the raw word,
 * the `DesktopProject.status` direction.
 */
export function statePill(row: CodeRequestRow): {
	label: string;
	variant: "info" | "outline" | "success" | "neutral";
} | null {
	const summary = row.summary;
	if (!summary) return null;
	if (summary.draft) return { label: "Draft", variant: "outline" };
	switch (summary.state) {
		case "open":
			return { label: "Open", variant: "info" };
		case "merged":
			return { label: "Merged", variant: "success" };
		case "closed":
			return { label: "Closed", variant: "neutral" };
		default:
			return {
				label: summary.state.trim() === "" ? "Unknown" : summary.state.trim(),
				variant: "neutral",
			};
	}
}

/**
 * The CI clause and its ink: `23/23 passed` / `2 failing` / `pending` /
 * `No checks yet` (§1).
 *
 * `failed > 0` outranks the status word because a run can be `pending` overall
 * while carrying failures the operator would want first; `total === 0` is "No
 * checks yet" rather than a `0/0` fraction. The tone is the caller's class
 * (`danger`/`muted`/default) rather than a class string here, so the model
 * stays free of rendering vocabulary - the same split `laneSegmentTone` keeps.
 */
export function ciClause(
	ci: CodeRequestCi,
): { text: string; tone: "danger" | "muted" | "plain" } | null {
	if (ci.failed > 0) {
		return {
			text: `${ci.failed} failing`,
			tone: "danger",
		};
	}
	if (ci.total === 0 || ci.status === "none") {
		return { text: "No checks yet", tone: "muted" };
	}
	if (ci.pending > 0 || ci.status === "pending") {
		return { text: "pending", tone: "muted" };
	}
	if (ci.status === "unknown") {
		return { text: "No checks yet", tone: "muted" };
	}
	if (ci.total > 0 && ci.passed === ci.total) {
		return { text: `${ci.passed}/${ci.total} passed`, tone: "plain" };
	}
	/* A settled run the counts do not add up for: state what was counted. */
	return {
		text: `${ci.passed}/${ci.total} passed`,
		tone: ci.status === "failure" ? "danger" : "plain",
	};
}

/** `1 comment` / `6 comments`, or null at 0 (the clause is omitted, §1). */
export function commentClause(count: number | null | undefined): string | null {
	if (count === null || count === undefined || count <= 0) return null;
	return count === 1 ? "1 comment" : `${count} comments`;
}

/**
 * The row's updated tail: `updated 2 min ago` (§11).
 *
 * The register follows the string the design fixes (`2 min ago`, minute grain,
 * "just now" under a minute); a future timestamp - a clock skewed ahead of the
 * backend's - reads `just now` rather than a negative age.
 */
export function updatedClause(updatedAtSec: number, nowMs: number): string {
	const seconds = Math.max(0, Math.floor(nowMs / 1000 - updatedAtSec));
	if (seconds < 60) return "updated just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `updated ${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `updated ${hours} h ago`;
	return `updated ${Math.floor(hours / 24)} d ago`;
}

/**
 * The line-A relation tag, only where a row needs disambiguating (§5).
 *
 * `opened` is the plain case and returns null; `mentioned` likewise (its
 * group header says it). "via subagent coder › reviewer" names the
 * propagation path, falling back through `agent_role` and `label` for an
 * event that predates the path. `unknown` carries the design's exact words.
 * `inherited` renders as the bare word: the frozen row shape carries no parent
 * identity, and naming an invented one would be the guess `unknown` exists to
 * refuse - the full sentence is on the element's title.
 */
export function relationTag(row: CodeRequestRow): string | null {
	switch (row.relation) {
		case "opened":
			return row.via ? viaTag(row.via) : null;
		case "mentioned":
			return null;
		case "unknown":
			return viaTag(row.via) ?? "unknown — possibly opened";
		case "inherited":
			return "inherited";
		default:
			return null;
	}
}

/** `via subagent coder` / `via subagent coder › reviewer` (§5), or null. */
export function viaTag(
	via: DesktopCodeRequestVia | null | undefined,
): string | null {
	if (!via) return null;
	if (rowViaPath(via).length > 0) {
		return `via subagent ${rowViaPath(via).join(" › ")}`;
	}
	const fallback = via.agent_role ?? via.label;
	return fallback ? `via subagent ${fallback}` : "via subagent";
}

/** The propagation chain, tolerating an event that carried only the flat fields. */
function rowViaPath(via: DesktopCodeRequestVia): string[] {
	if (Array.isArray(via.path) && via.path.length > 0) {
		return via.path.filter(
			(entry): entry is string => typeof entry === "string" && entry !== "",
		);
	}
	const flat = via.agent_role ?? via.label;
	return flat ? [flat] : [];
}

/**
 * The acts this session performed on the ref, as one trailing tag (§5):
 * "you commented" / "you merged", with the relation, never replacing it.
 *
 * The act words are the backend's (`comment`, `merge`, `review`, `push`,
 * `edit`, `close`, `ready`); an unknown word is shown raw inside the same
 * sentence rather than dropped, because the row must not claim nothing happened
 * when something did.
 */
export function actedTag(row: CodeRequestRow): string | null {
	if (row.acted.length === 0) return null;
	const words = row.acted.map(actWord);
	return `you ${words.join(", ")}`;
}

const ACT_WORDS: Record<string, string> = {
	comment: "commented",
	merge: "merged",
	review: "reviewed",
	push: "pushed",
	edit: "edited",
	close: "closed",
	ready: "marked ready",
};

const actWord = (act: string): string => ACT_WORDS[act] ?? act;

/**
 * Whether any REAL open row is in a state the operator must look at: a lane
 * with findings open, or CI failing (§G.2's attention dot).
 *
 * "opened" is the relation, not the group: a mentioned or inherited row is not
 * this session's work and does not raise the mark.
 */
export function needsAttention(rows: readonly CodeRequestRow[]): boolean {
	return rows.some(
		(row) =>
			row.relation === "opened" &&
			((row.lanes ?? []).some((lane) => lane.state === "findings_open") ||
				row.summary?.ci.status === "failure" ||
				(row.summary?.ci.failed ?? 0) > 0),
	);
}

/** The row-level failure caption (§3), or null. See the module header. */
export function refreshCaption(row: CodeRequestRow): string | null {
	return row.refresh_error ? "Couldn't refresh — showing last known" : null;
}

/**
 * The pane-level cooling lines, one per host, in list order (§5): `GitHub
 * rate-limited until 14:05.`
 *
 * A host whose window has already opened is not printed (the map is a snapshot
 * and the pane may render after the reset). The host word is the forge's own
 * display name where the host is one this app recognises, else the raw host,
 * because a self-hosted GitLab's own name would be lost by a lookup table.
 */
export function coolingClauses(
	cooling: Record<string, number> | undefined,
	nowMs: number,
): string[] {
	if (!cooling) return [];
	return Object.entries(cooling)
		.filter(([, until]) => until * 1000 > nowMs)
		.map(([host, until]) => {
			const at = new Date(until * 1000);
			const time = `${String(at.getHours()).padStart(2, "0")}:${String(
				at.getMinutes(),
			).padStart(2, "0")}`;
			return `${forgeDisplayName(host)} rate-limited until ${time}.`;
		});
}

/** `github.com` → `GitHub`, `gitlab.com` → `GitLab`, anything else raw. */
export function forgeDisplayName(host: string): string {
	if (host.startsWith("github")) return "GitHub";
	if (host.startsWith("gitlab")) return "GitLab";
	return host;
}

/**
 * The composer chip's visible clause: `1 code request` / `3 code requests`
 * (§7), singular spelled by the function rather than a hand-written plural.
 */
export function chipClause(count: number): string {
	return count === 1 ? "1 code request" : `${count} code requests`;
}

/**
 * The chip's tooltip and accessible name, one derived string (§7):
 * `Open code review — 3 code requests, 2 opened · 1 mentioned`, with `,
 * findings open` when any open row needs attention. A zero half is dropped -
 * "0 mentioned" states a count of nothing beside a count of everything.
 */
export function chipLabel(
	count: number,
	opened: number,
	mentioned: number,
	attention: boolean,
): string {
	const halves = [
		opened > 0 ? `${opened} opened` : null,
		mentioned > 0 ? `${mentioned} mentioned` : null,
	].filter((half): half is string => half !== null);
	const details = halves.length > 0 ? `, ${halves.join(" · ")}` : "";
	const mark = attention ? ", findings open" : "";
	return `Open code review — ${chipClause(count)}${details}${mark}`;
}

/** How many rows the chip and the rail count: every row the list renders. */
export function visibleRowCount(rows: readonly CodeRequestRow[]): number {
	return rows.length;
}
