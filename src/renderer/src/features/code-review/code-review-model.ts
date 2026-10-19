// Derivations stay React-free while sharing the renderer's catalogue runtime.
import { t } from "../../../../i18n/messages";
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
			return t("ui.code_review.code_review_model.code");
		case "design":
			return t("ui.code_review.code_review_model.design");
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
	get findings_open() {
		return t("ui.code_review.lane.state.findings_open");
	},
	get remediation_posted() {
		return t("ui.code_review.lane.state.remediation_posted");
	},
	get clean() {
		return t("ui.code_review.lane.state.clean");
	},
	get terminal() {
		return t("ui.code_review.lane.state.terminal");
	},
	get unstated() {
		return t("ui.code_review.lane.state.unstated");
	},
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
	round?: number | null;
}): string {
	if (lane.state === "awaiting_review")
		return t("ui.code_review.code_review_model.no_agent_review_yet");
	const word = LANE_STATE_WORDS[lane.state as LaneState] ?? lane.state.trim();
	/*
	 * `remediation posted` alone does not say what is being waited on (design
	 * round 1, D4 / UX U7): §C.5's own wording is "awaiting round N+1 /
	 * re-review", and the clause carries it so the row reads at a glance.
	 */
	const state =
		lane.state === "remediation_posted"
			? t("ui.code_review.lane.awaiting_rereview", { state: word })
			: word;
	/*
	 * A lane whose latest comment carried no placeable round prints the state
	 * WITHOUT a number. "Round undefined" was the defect F2 caught: the wire
	 * omits `round` when the parser cannot place one, and a claim about how far
	 * along a review is must never be guessed from an absence.
	 */
	const round = lane.round;
	if (typeof round === "number" && Number.isFinite(round)) {
		return t("ui.code_review.lane.round", { round: String(round), state });
	}
	return state;
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
		reviewed_head?: string | null;
	},
	headSha: string | null | undefined,
): string | null {
	if (lane.freshness !== "stale") return null;
	const reviewed = lane.reviewed_head?.slice(0, 7) ?? "";
	const head = headSha?.slice(0, 7) ?? "";
	if (reviewed && head)
		return t("ui.code_review.lane.stale_head", { reviewed, head });
	if (reviewed) return t("ui.code_review.lane.stale_reviewed", { reviewed });
	return t("ui.code_review.lane.stale");
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
						/*
						 * NO ROUND NUMBER: "no agent review yet" has no round to place, and
						 * the segment strip derives its count from this field - a synthetic
						 * `0` produced zero segments while claiming a round existed.
						 */
						round: null,
						state: "awaiting_review",
						freshness: "unknown",
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
 * The segments for one lane: one per KNOWN round, chronological.
 *
 * THE WIRE PARSES ONE STATE PER LANE - the latest convention comment's - so
 * the latest segment carries the state's tone and earlier ones are NEUTRAL
 * (`muted`), never the latest tone repeated: painting round 1 in round 2's
 * "clean" overstated a history the wire does not carry, and painting it in
 * round 2's "findings open" understated it (design round 1, D4). When a later
 * version carries per-round rows, this is the function that stops
 * approximating.
 *
 * A STALE SUCCESS IS NOT SUCCESS: a `clean` round reviewed against a head the
 * branch has since moved past is painted `muted` - "a stale clean is not clean
 * now" (D4/U7) - with the stale caption beside it naming both SHAs.
 *
 * NO ROUND NUMBER, NO SEGMENTS: a segment count is a claim about how many
 * rounds ran (F2); the clause beside the strip still carries the state word.
 */
export function roundSegments(lane: CodeRequestLane): LaneLine["segments"] {
	const round = lane.round;
	if (typeof round !== "number" || !Number.isFinite(round) || round < 1) {
		return [];
	}
	const count = Math.floor(round);
	const latestTone = laneSegmentTone(lane.state);
	const settledStale = lane.freshness === "stale" && latestTone === "success";
	return Array.from({ length: count }, (_, index) => ({
		key: `${lane.lane}-round-${index}`,
		tone: index === count - 1 ? (settledStale ? "muted" : latestTone) : "muted",
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
		return (b.mention.last_at ?? 0) - (a.mention.last_at ?? 0);
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
	if (summary.draft)
		return {
			label: t("ui.code_review.code_review_model.draft"),
			variant: "outline",
		};
	switch (summary.state) {
		case "open":
			return {
				label: t("ui.code_review.code_review_model.open"),
				variant: "info",
			};
		case "merged":
			return {
				label: t("ui.code_review.code_review_model.merged"),
				variant: "success",
			};
		case "closed":
			return {
				label: t("ui.code_review.code_review_model.closed"),
				variant: "neutral",
			};
		default:
			return {
				label:
					summary.state.trim() === ""
						? t("ui.code_review.code_review_model.unknown")
						: summary.state.trim(),
				variant: "neutral",
			};
	}
}

/**
 * The CI clause and its ink: `23/23 passed` / `2 failing` / `CI failing` /
 * `CI pending` / `CI running` / `No checks yet` (§1).
 *
 * NULL COUNTS ARE A HOST'S ANSWER, NOT A MISSING ONE (agent review F1, design
 * D2, QA Q-1): GitLab pipeline state carries no job counts at all, so every
 * clause falls back to the STATUS word when a count is not a finite number -
 * `null/null passed` and a red pipeline read as passing were the two defects.
 * `failed > 0` still outranks the status word (a run can be `pending` overall
 * while carrying failures), and `total === 0` with `status: "none"` is "No
 * checks yet" rather than a `0/0` fraction.
 *
 * The tone is the caller's class (`danger`/`muted`/default) rather than a
 * class string here, so the model stays free of rendering vocabulary - the
 * same split `laneSegmentTone` keeps.
 */
export function ciClause(
	ci: DesktopCodeRequestCi | null | undefined,
): { text: string; tone: "danger" | "muted" | "plain" } | null {
	if (!ci) return null;
	const failed = finite(ci.failed);
	const pending = finite(ci.pending);
	const passed = finite(ci.passed);
	const total = finite(ci.total);
	if (failed !== null && failed > 0) {
		return {
			text: t("ui.code_review.ci.failing", {
				count: failed,
				countText: String(failed),
			}),
			tone: "danger",
		};
	}
	if (ci.status === "failure") {
		return {
			text: t("ui.code_review.code_review_model.ci_failing"),
			tone: "danger",
		};
	}
	if (ci.status === "none" || (total !== null && total === 0)) {
		return {
			text: t("ui.code_review.code_review_model.no_checks_yet"),
			tone: "muted",
		};
	}
	if (pending !== null && pending > 0) {
		return {
			text: t("ui.code_review.code_review_model.ci_running"),
			tone: "muted",
		};
	}
	if (ci.status === "pending") {
		return {
			text: t("ui.code_review.code_review_model.ci_pending"),
			tone: "muted",
		};
	}
	if (ci.status === "unknown") {
		return {
			text: t("ui.code_review.code_review_model.no_checks_yet"),
			tone: "muted",
		};
	}
	if (total !== null && total > 0 && passed !== null) {
		return {
			text: t("ui.code_review.ci.passed", {
				passed: String(passed),
				total: String(total),
			}),
			tone: "plain",
		};
	}
	if (ci.status === "success") {
		return {
			text: t("ui.code_review.code_review_model.ci_passed"),
			tone: "plain",
		};
	}
	/* A settled run this build cannot classify: claim nothing. */
	return null;
}

const finite = (value: number | null | undefined): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Whether a row's CI is still in flight - the poll gate's second term (§D.5).
 * A `pending` status or a positive pending count is the answer; everything
 * settled (success, failure, none) costs nothing.
 */
export function rowHasPendingCi(row: CodeRequestRow): boolean {
	const ci = row.summary?.ci;
	if (!ci) return false;
	return (finite(ci.pending) ?? 0) > 0 || ci.status === "pending";
}

/** `1 comment` / `6 comments`, or null at 0 (the clause is omitted, §1). */
export function commentClause(count: number | null | undefined): string | null {
	if (count === null || count === undefined || count <= 0) return null;
	return t("ui.code_review.comments.count", {
		count,
		countText: String(count),
	});
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
	if (seconds < 60) return t("ui.code_review.age.just_now");
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60)
		return t("ui.code_review.age.minutes", {
			amount: minutes,
			amountText: String(minutes),
		});
	const hours = Math.floor(minutes / 60);
	if (hours < 24)
		return t("ui.code_review.age.hours", {
			amount: hours,
			amountText: String(hours),
		});
	return t("ui.code_review.age.days", {
		amount: Math.floor(hours / 24),
		amountText: String(Math.floor(hours / 24)),
	});
}

/**
 * The row's MARKER LINE: the relation tag, then what this session did to the
 * ref, `·`-seamed - one string, derived once (the model file's own rule: one
 * derived string per fact).
 *
 * WHY IT IS A DERIVATION AND NOT A JOIN IN THE COMPONENT. The row draws it
 * and the row's ACCESSIBLE NAME says it (see `rowAriaLabel`), and two
 * separate joins would be two chances to state the same fact two ways.
 */
export function rowTag(row: CodeRequestRow): string | null {
	const parts = [relationTag(row), actedTag(row)].filter(
		(tag): tag is string => tag !== null,
	);
	return parts.length > 0 ? parts.join(" · ") : null;
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
			return viaTag(row.via) ?? t("ui.code_review.relation.unknown");
		case "inherited":
			return t("ui.code_review.relation.inherited");
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
		return t("ui.code_review.relation.subagent_path", {
			path: rowViaPath(via).join(" › "),
		});
	}
	const fallback = via.agent_role ?? via.label;
	return fallback
		? t("ui.code_review.relation.subagent_fallback", { name: fallback })
		: t("ui.code_review.relation.subagent");
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
	return t("ui.code_review.activity.you", { acts: words.join(", ") });
}

const ACT_WORDS: Record<string, string> = {
	get comment() {
		return t("ui.code_review.activity.comment");
	},
	get merge() {
		return t("ui.code_review.activity.merge");
	},
	get review() {
		return t("ui.code_review.activity.review");
	},
	get push() {
		return t("ui.code_review.activity.push");
	},
	get edit() {
		return t("ui.code_review.activity.edit");
	},
	get close() {
		return t("ui.code_review.activity.close");
	},
	get ready() {
		return t("ui.code_review.activity.ready");
	},
};

const actWord = (act: string): string => ACT_WORDS[act] ?? act;

/**
 * The attention CAUSE, or null (§G.2): findings open in a lane, checks
 * failing, or both - named so the chip and the rail state what is actually
 * wrong (design round 1, D5 / UX U6: "findings open" was conflated with a red
 * pipeline).
 */
export function attentionCause(rows: readonly CodeRequestRow[]): string | null {
	const opened = rows.filter((row) => row.relation === "opened");
	const findings = opened.some((row) =>
		(row.lanes ?? []).some((lane) => lane.state === "findings_open"),
	);
	const checks = opened.some((row) => {
		const ci = row.summary?.ci;
		if (!ci) return false;
		return ci.status === "failure" || (finite(ci.failed) ?? 0) > 0;
	});
	const causes = [
		findings ? t("ui.code_review.attention.findings") : null,
		checks ? t("ui.code_review.attention.checks") : null,
	].filter((cause): cause is string => cause !== null);
	return causes.length > 0 ? causes.join(" · ") : null;
}

/**
 * Whether any REAL open row is in a state the operator must look at (§G.2's
 * attention dot). "opened" is the relation, not the group: a mentioned or
 * inherited row is not this session's work and does not raise the mark.
 */
export function needsAttention(rows: readonly CodeRequestRow[]): boolean {
	return attentionCause(rows) !== null;
}

/** The row-level failure caption (§3), or null. See the module header. */
/**
 * The per-row refresh-failure caption: the backend's `refresh_error` text
 * VERBATIM (UX round 1, U5: "use the backend's `refresh_error` text when
 * present" - a generic sentence left the user unable to tell a credential
 * refusal from a rate limit from a network drop, and the backend's sentence
 * already names the remedy). The join is a COLON rather than the house em-dash
 * because the backend's sentence carries an em-dash of its own in the
 * credential case (`credential rejected — sign in again ...`), and two in one
 * line read as a run-on (design round 2, N1 / UX round 2, U20). Null when the
 * field is absent.
 */
export function refreshCaption(row: CodeRequestRow): string | null {
	return row.refresh_error
		? t("ui.code_review.row.refresh_error", { error: row.refresh_error })
		: null;
}

/**
 * How far a row's FORGE read has got - the wire's `fetch_state` (design §1).
 * `pending` is the one state that renders as a LOADING line, not as copy: the
 * wire states the FACT (no resolved attempt), the pane states the word.
 */
export type FetchState =
	| "pending"
	| "ready"
	| "stale"
	| "unauthenticated"
	| "cooling"
	| "failed"
	| "untracked";

/** The vocabulary above as a value list, for the one membership check. */
const FETCH_STATES: readonly FetchState[] = [
	"pending",
	"ready",
	"stale",
	"unauthenticated",
	"cooling",
	"failed",
	"untracked",
];

/**
 * The row's fetch state, or null when the field is absent or carries a word
 * this build does not know. Both cases mean "render as if the field did not
 * exist": absent is an older backend, and an unrecognised word is a newer
 * one - the legacy path claims nothing either way.
 */
export function fetchStateOf(row: CodeRequestRow): FetchState | null {
	const value = row.fetch_state;
	return typeof value === "string" &&
		(FETCH_STATES as readonly string[]).includes(value)
		? (value as FetchState)
		: null;
}

/**
 * Whether the row's first state read has not resolved yet. The row renders
 * the loading line for exactly this state (design §4).
 */
export function rowIsLoading(row: CodeRequestRow): boolean {
	return fetchStateOf(row) === "pending";
}

/**
 * How long a row must be continuously pending before its loading line paints
 * - §4's no-flicker mechanism: a fetch that resolves under this delay never
 * paints anything, so no flash. Constant by design: the design round may tune
 * this value, never the mechanism, and stories pin the REVEALED frame with 0.
 */
export const PENDING_REVEAL_MS = 500;

/**
 * The row's ONE quiet line under the meta figures.
 *
 * WITH `fetch_state` ON THE WIRE (design §4) this is a switch on it: a
 * `pending` row returns null - the row renders the loading line instead, and
 * a remedy must never be claimed while the first read is in flight; `stale`
 * leads with its own state word so a failed revalidation is not read as a
 * failed ATTEMPT; only `unauthenticated`/`untracked`/`cooling` may carry the
 * sign-in or "not tracked" remedy, and each reads the backend's own sentence
 * (`reason`) first. Nothing here derives a CLI or a cause.
 *
 * ABSENT `fetch_state` (an older backend) keeps today's exact legacy logic
 * byte-for-byte - the QA round 2 Q-11 pins run on this branch:
 *
 * - a LINK-ONLY row shows its `reason` when the backend sent one (a cold row
 *   on a cooling host reads `cooling — this host is rate-limited until ...;
 *   nothing was fetched yet` instead of a sign-in remedy the reader cannot
 *   act on), else the per-forge `link_only_hint`;
 * - a tracked row shows its `refresh_error` (prefixed) when the last attempt
 *   failed, else the bare `reason` when the backend attached one.
 */
export function rowNotice(row: CodeRequestRow): string | null {
	const state = fetchStateOf(row);
	if (state === null) {
		if (row.link_only) return row.reason ?? linkOnlyRemedy(row);
		if (row.refresh_error) return refreshCaption(row);
		return row.reason ?? null;
	}
	switch (state) {
		case "pending":
			/* The row renders a loading line instead (§4); never a remedy. */
			return null;
		case "ready":
			return row.refresh_error ? refreshCaption(row) : (row.reason ?? null);
		case "stale":
			return row.refresh_error
				? t("ui.code_review.row.stale_error", { error: row.refresh_error })
				: t(
						"ui.code_review.code_review_model.stale_last_known_state_not_current",
					);
		case "unauthenticated":
			/* The resolved no-login outcome - the remedy lives here. */
			return row.reason ?? linkOnlyRemedy(row);
		case "cooling":
			return (
				row.reason ??
				t(
					"ui.code_review.code_review_model.cooling_this_host_is_rate_limited_nothing_was_fetched_yet",
				)
			);
		case "failed":
			return (
				row.reason ??
				refreshCaption(row) ??
				t(
					"ui.code_review.code_review_model.couldn_t_fetch_this_pass_will_retry",
				)
			);
		case "untracked":
			/* The hint is a genuine "not tracked" signal here. */
			return row.reason ?? linkOnlyRemedy(row);
	}
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
			return t("ui.code_review.host.cooling", {
				host: forgeDisplayName(host),
				time,
			});
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
	return t("ui.code_review.chip.count", { count, countText: String(count) });
}

/**
 * The chip's tooltip and accessible name, one derived string (§7):
 * `Open code review — 3 code requests, 2 opened · 1 mentioned, checks
 * failing`, with the attention CAUSE named (never a generic "findings open"
 * when the cause is checks - design round 1, D5 / UX U6). A zero half is
 * dropped - "0 mentioned" states a count of nothing beside a count of
 * everything.
 */
export function chipLabel(
	count: number,
	opened: number,
	mentioned: number,
	cause: string | null,
	open = false,
): string {
	const halves = [
		opened > 0
			? t("ui.code_review.chip.opened", {
					count: opened,
					countText: String(opened),
				})
			: null,
		mentioned > 0
			? t("ui.code_review.chip.mentioned", {
					count: mentioned,
					countText: String(mentioned),
				})
			: null,
	].filter((half): half is string => half !== null);
	const details = halves.length > 0 ? `, ${halves.join(" · ")}` : "";
	const mark = cause ? `, ${cause}` : "";
	/*
	 * THE LEAD FLIPS WITH THE PANE (UX round 2, U18): the chip's tooltip and
	 * announced name read `Open code review — ...` while the pane was already
	 * showing, which is the one fact a sighted reader can check against the
	 * screen. The rail item relabels itself the same way; the press still
	 * never closes, so this is a state statement, not a toggle's label.
	 */
	const lead = open
		? t("ui.code_review.code_review_model.code_review_is_showing")
		: t("ui.code_review.code_review_model.open_code_review");
	return `${lead} — ${chipClause(count)}${details}${mark}`;
}

/**
 * The link-only row's one visible line: the backend's own per-forge remedy
 * sentence, VERBATIM (agent review F8 / design D8 / UX U5). The old
 * derivation - "sign in with gh" for everything but gitlab - taught a remedy
 * that cannot work for a host with no adapter; the sentence's lead is itself
 * `Link only`, so the caption and the remedy are one line.
 */
export function linkOnlyRemedy(row: CodeRequestRow): string {
	const hint = row.link_only_hint?.trim();
	return hint && hint !== ""
		? hint
		: t("ui.code_review.code_review_model.link_only");
}

/**
 * The collapsed tool-output note (§4): `2 more seen in tool output`, with a
 * `+` when the count is CAPPED - a truncated list must not present its bound
 * as exact (agent review F8).
 */
export function toolOutputNote(count: number, truncated: boolean): string {
	return t("ui.code_review.tool.more", {
		count: count,
		countText: String(count),
		capped: truncated ? "+" : "",
	});
}

/**
 * The identity sigil the host's own UI uses: `!N` for a GitLab merge request,
 * `#N` for everything else (design round 1, D6 - on GitLab `#N` is an issue,
 * and this operator writes `minerva-skills!57`).
 */
export function forgeSigil(row: Pick<CodeRequestRow, "forge">): string {
	return row.forge === "gitlab" ? "!" : "#";
}

/** `damianvtran/local-operator #927` / `minervaai/minerva-skills !57`. */
export function identityLabel(
	row: Pick<CodeRequestRow, "forge" | "project" | "number">,
): string {
	return `${row.project} ${forgeSigil(row)}${row.number}`;
}

/**
 * The trailing separators of a project path, stripped before the last segment
 * is taken: a path that ends in `/` names nothing after it.
 */
const TRAILING_SEPARATORS = /\/+$/;

/**
 * The REPO NAME: the last path segment of the forge's project path.
 *
 * WHY THE NAME IS DERIVED AND NOT STORED. The wire row carries one field,
 * `project`, and its shape is the FORGE's, not the app's: `owner/repo` on
 * GitHub and Gitea, `group/subgroup/project` on GitLab, `org/project/_git/repo`
 * on Azure DevOps, a bare name on Gerrit. The operator reads a row by the
 * repository it belongs to, and the PATH alone does not say it - a path
 * truncated to `minervai/services/cor` reads as a directory, not as a repo,
 * so the name was cut off exactly where the identity began.
 *
 * WHY THE LAST SEGMENT. A name is the shortest thing that identifies the
 * repository to a human, and every one of those shapes ends in it: the GitHub
 * repo, the GitLab project, the Azure repo, the Gerrit project. Splitting on
 * the final `/` rather than assuming a fixed depth is what makes ONE rule
 * cover four forges, and it is why a trailing separator is trimmed first
 * (a path that ends in `/` names nothing after it).
 *
 * WHAT THIS IS NOT. The name is a DISPLAY derivation, never a substitute for
 * the path: the accessible name and the identity's `title` keep the full
 * `project`, because "which repository" and "which full path" are different
 * questions and a screen reader is owed the whole of the second.
 */
export function repoName(project: string): string {
	const trimmed = project.trim();
	if (trimmed === "") return "";
	const withoutTrailingSlash = trimmed.replace(TRAILING_SEPARATORS, "");
	const lastSlash = withoutTrailingSlash.lastIndexOf("/");
	return lastSlash === -1
		? withoutTrailingSlash
		: withoutTrailingSlash.slice(lastSlash + 1);
}

/**
 * The FULL PATH for the line BELOW the identity, or null when there is
 * nothing to put there.
 *
 * WHY A NULL AND NOT AN EMPTY STRING. The second line exists to carry the
 * full path next to the name that identifies the repository, and a project
 * with no separator IS its own name - so the line would repeat the name
 * above it and say nothing. `null` is the absence of the line, and the row
 * draws the line when this is a string.
 *
 * WHY IT LIVES HERE, BESIDE `repoName` (agent review round 1, R1-5): the
 * model file's own header says "one derived string per fact ... so the
 * stories, the components and any later test drive one implementation", and
 * the predicate that decides whether the second line is drawn AT ALL is a
 * derivation about the same project path as the name above it. A predicate
 * in the component is a second implementation of a fact the model owns.
 */
export function pathLineFor(project: string): string | null {
	const trimmed = project.trim();
	if (trimmed === "") return null;
	if (trimmed === repoName(project)) return null;
	return project;
}

/**
 * The row's ACCESSIBLE NAME (agent review round 1, N4 / UX U4):
 * `<project> <#N>: <title>, <state>, <relation>, <lane clauses>, opens in your
 * browser`.
 *
 * The `<relation>` part is the marker line the row DRAWS, carried here so a
 * screen reader never loses the one word that keeps a row from claiming to
 * be opened when the backend never said so (QA round 2, Q-3). It is absent
 * when the row carries no marker, and it comes from the same derivation the
 * row draws (`rowTag`), so the two can never state the relation two ways.
 *
 * One derived string rather than the concatenated row text, because the
 * concatenation read lane clauses in visual order with no punctuation and
 * never said the press leaves the app (the press opens the SYSTEM browser).
 *
 * A PENDING row's clause is `fetching its current state` (design §4): the
 * state is announced immediately - never delayed like the visual line - and
 * never in the remedy's words, because the sign-in sentence must not be heard
 * for a row whose first read has not resolved.
 */
export function rowAriaLabel(row: CodeRequestRow): string {
	const title = row.summary?.title ?? row.url;
	const parts = [`${identityLabel(row)}: ${title}`];
	const pill = statePill(row);
	if (pill) parts.push(pill.label.toLowerCase());
	/*
	 * THE RELATION IS PART OF THE ROW'S NAME (QA round 2, Q-3). The marker
	 * line is a VISUAL line - it yields where the row is tight - so a screen
	 * reader that only had the identity, the state and the title could not
	 * hear the one word that keeps a row from claiming to be opened when the
	 * backend never said so (`unknown`). The marker is carried here, in the
	 * same words the row draws, so the two can never disagree.
	 */
	const tag = rowTag(row);
	if (tag) parts.push(tag);
	const clauses = laneLines(row).map((line) => line.clause);
	if (clauses.length > 0) {
		parts.push(clauses.join("; "));
	} else if (rowIsLoading(row)) {
		parts.push(t("ui.code_review.row.fetching"));
	} else if (row.link_only) {
		parts.push(linkOnlyRemedy(row));
	}
	parts.push(t("ui.code_review.row.opens_browser"));
	return parts.join(", ");
}
