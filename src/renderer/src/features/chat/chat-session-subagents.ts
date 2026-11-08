/**
 * The sidebar row's background-work fact: whether a session still has work
 * running (subagents, jobs, waits), and the one sentence that says so.
 *
 * WHY THIS EXISTS (the operator's report, 2026-09-29): a session "not displaying
 * the icon where they're done but they still have running subagents, so it just
 * looks like they're inactive in the sidebar". The frame that came with it is the
 * shape of the defect - session 8f304a321926 selected, its own pane reading "1
 * subagent running", its sidebar row wearing nothing but a quiet `MessageSquare`.
 *
 * THE CAUSE IS PRECEDENCE, not a missing field. The catalogue serves
 * `subagents_running` / `subagents_queued` on every row, and its status ladder
 * ranks a live turn, a wedged beat, an unseen completion, an attached session and
 * an armed wake ABOVE `delegating` - so `delegating` is the code a row carries
 * only when nothing louder is true, and it is the one code whose `status.label`
 * the backend folds the counts INTO. Every louder rung therefore draws a mark of
 * its own and said nothing at all about the children still at work: a busy
 * session running eight of them drew one spinner, and a session that had finished
 * its own turn while its children worked drew one green check and read as done.
 *
 * THE SECOND REPORT (2026-11-07) widened the fact from "children" to "any work
 * still running" and moved it from a code-gated mark to core's own
 * `background_work` flag - see `hasBackgroundWork`.
 *
 * WHAT THIS IS: one predicate and one sentence, both pure, so the rules can be
 * driven by `scripts/*.test.mjs` without a renderer. The pixels (the running
 * lane) belong to `components/chat-session-status.tsx`.
 */

import { currentLocale, t } from "@shared/i18n";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";

/**
 * The one code whose `status.label` the backend already folds the counts into.
 *
 * Core's `delegating_label` composes it from these very numbers ("2 subagents
 * running · 1 queued"), the status span renders that label into the accessible
 * name, and the row's tooltip reads it too. So on a `delegating` row the counts
 * are already announced, and the clause below must stay empty there rather than
 * say the same numbers a second time.
 *
 * The test is on the CODE rather than on a re-derivation of the label string:
 * whether a given label happens to contain a count is the backend's spelling, and
 * parsing it here would make this module fail open into a repeat announcement the
 * day that label is reworded.
 */
const COUNTS_RIDE_THE_LABEL = "delegating";

/**
 * A count as this module reads it: a number greater than zero, or nothing.
 *
 * `null` is the wire's "this build does not report" and is deliberately NOT zero
 * - the contract (`shared/desktop-session-contract.ts`) is explicit that a
 * session nobody could ask must never be drawn as one with no subagents, and the
 * store's own note is written against exactly the fold this refuses. Both answers
 * land on "no mark" here, and that is the same failure direction rather than a
 * fold: a mark is drawn only from a count that POSITIVELY says the work exists.
 *
 * The check is `typeof === "number" && Number.isFinite(value) && value > 0`, which
 * is the treatment spec's rule plus the one refinement it cannot state on its own:
 * `Number.isFinite` refuses `Infinity`, which passes a bare `> 0` while being
 * nonsense as a count. A fractional value (0.5) DOES draw, and that is the
 * spec's rule read literally - a count that is not a whole number is a defect
 * upstream, and the safe direction for one is to show the work rather than to
 * hide it. `whole` below keeps the sentence from reading "0 subagents running"
 * about a mark that is on the screen.
 */
export const hasWork = (value: number | null | undefined): boolean =>
	typeof value === "number" && Number.isFinite(value) && value > 0;

/** The counts as the sentence spells them, and never as a zero while a mark is drawn. */
const whole = (value: number): number => Math.max(1, Math.floor(value));

/**
 * Whether this row's own `status.label` already spells the counts.
 *
 * True on `delegating` and nowhere else: the sentence omits the subagent counts
 * there, because the label already says them.
 */
const speaksForItself = (code: string | undefined): boolean =>
	code === COUNTS_RIDE_THE_LABEL;

/**
 * Whether a row's counts are too stale to draw from.
 *
 * A remote row whose link is down (`WifiOff`) or whose peer's reach is not yet
 * known (`HelpCircle`) carries the counts of the LAST list read that reached
 * the owner, which may be minutes old. Drawing "still at work" from them would
 * keep a session in Running that may have finished long ago, and the row's own
 * glyph already says the honest thing: we cannot see it. So both the lane and
 * the Running arm stand down there (design spec "running lane", remote rows).
 * The reach test is restated rather than imported from `mesh/peer-presence`
 * because that module's reader composes copy; this one only needs the fact.
 */
const countsAreStale = (
	row: Pick<CanonicalSessionRow, "locality" | "link_down" | "peer_reach">,
): boolean =>
	(row.locality === "remote" && row.link_down === true) ||
	row.peer_reach === "not-attempted" ||
	row.peer_reach === "unknown";

/**
 * Whether the session still has work running after (or beside) its own turn:
 * a subagent running or queued, a background job, or an armed wait.
 *
 * WHY THIS EXISTS (operator report, 2026-11-07): a session whose turn had ended
 * but which still owned a subagent and a background job filed under Today with
 * an idle glyph, because Running membership keyed on `status.code` alone and
 * the code there was `idle` - a build drain had suppressed `delegating` in
 * core. The backend now publishes `background_work` on every list row and
 * every `session_status` frame, derived from the same counts, independent of
 * the code and NOT suppressed by a drain. This is its one reader: the Running
 * section (`isRunningRow`), the lane under the status cell and the clause in
 * the tooltip all ask here, so they cannot disagree about the same row.
 *
 * THE FLAG, NOT A RE-SUM OF THE COUNTS. Core owns which counts mean "work"
 * (a `null` jobs count is "unknown", a wait may or may not count), and summing
 * them here would be a second derivation that drifts the day core adds a kind
 * of work. The counts are for the sentence only.
 *
 * OLDER BACKEND (no `background_work` on the wire): fall back to the previous
 * code-only behaviour, where `delegating` was the one code that implied
 * children at work - so that row still draws the lane its trio used to stand
 * for, and no other row changes section on an upgrade of this client alone.
 */
export function hasBackgroundWork(
	row: Pick<
		CanonicalSessionRow,
		"status" | "background_work" | "locality" | "link_down" | "peer_reach"
	>,
): boolean {
	if (countsAreStale(row)) return false;
	if (typeof row.background_work === "boolean") return row.background_work;
	return row.status?.code === COUNTS_RIDE_THE_LABEL;
}

/*
 * `Intl.ListFormat` is ES2021 and this renderer's `lib` is ES2020, so the one
 * constructor used here is typed locally rather than widening `lib` for the
 * whole app. Every runtime this code runs in (Electron's Chromium, Node >= 13
 * for the tests) ships it.
 */
type ListFormatter = { format(items: string[]): string };
const ListFormat = (
	Intl as unknown as {
		ListFormat: new (
			tag: string,
			options: { type: "unit"; style: "short" },
		) => ListFormatter;
	}
).ListFormat;

/** The current locale's list joiner, cached per tag ("1 subagent, 1 job"). */
let listFormat: { tag: string; format: ListFormatter } | null = null;
const joinItems = (items: string[]): string => {
	const tag = currentLocale();
	if (listFormat?.tag !== tag) {
		listFormat = {
			tag,
			format: new ListFormat(tag, { type: "unit", style: "short" }),
		};
	}
	return listFormat.format.format(items);
};

/**
 * The background-work clause a reader hears - appended once to the row's
 * tooltip and its `sr-only` sentence - or `""` when there is nothing to say.
 *
 * ```
 * 1 subagent, 1 job running
 * 2 subagents running · 1 queued
 * 2 subagents queued
 * Waiting on background work          (only when the wait is the sole fact)
 * ```
 *
 * The `·` is the wire label's own separator ("2 subagents running · 1
 * queued"), and the running kinds are joined by `Intl.ListFormat` so each
 * locale gets its own list punctuation rather than an English comma.
 *
 * ON `delegating` THE SUBAGENT PARTS ARE OMITTED: core's `delegating_label`
 * already spells those counts into `status.label`, which the tooltip and the
 * accessible name carry verbatim, so saying them again would announce the same
 * numbers twice. Jobs and waits are not in that label, so they still speak.
 *
 * Drawn from the COUNTS, gated by the same staleness rule as the lane: a count
 * read from a link that is down is not a fact worth announcing.
 */
export function backgroundWorkClause(
	row: Pick<
		CanonicalSessionRow,
		| "status"
		| "subagents_running"
		| "subagents_queued"
		| "jobs_running"
		| "waiting_on"
		| "locality"
		| "link_down"
		| "peer_reach"
	>,
): string {
	if (countsAreStale(row)) return "";
	const subagentsSpoken = !speaksForItself(row.status?.code);
	const running: string[] = [];
	if (subagentsSpoken && hasWork(row.subagents_running)) {
		running.push(
			t("ui.chat.sidebar.row.bg.subagents", {
				count: whole(row.subagents_running as number),
			}),
		);
	}
	if (hasWork(row.jobs_running)) {
		running.push(
			t("ui.chat.sidebar.row.bg.jobs", {
				count: whole(row.jobs_running as number),
			}),
		);
	}
	const clauses: string[] = [];
	if (running.length > 0) {
		clauses.push(
			t("ui.chat.sidebar.row.bg.running", { items: joinItems(running) }),
		);
	}
	if (subagentsSpoken && hasWork(row.subagents_queued)) {
		const count = whole(row.subagents_queued as number);
		/*
		 * The queued clause elides its noun only after a running clause that
		 * already named the work, exactly as the wire label does; alone, "2
		 * queued" is a fragment, so it names the subagents.
		 */
		clauses.push(
			running.length > 0
				? t("ui.chat.sidebar.row.bg.queued", { count })
				: t("ui.chat.sidebar.row.bg.subagents_queued", { count }),
		);
	}
	if (clauses.length === 0 && hasWork(row.waiting_on)) {
		clauses.push(t("ui.chat.sidebar.row.bg.waiting"));
	}
	return clauses.join(" · ");
}
