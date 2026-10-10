import type {
	DesktopCodeRequestLane,
	DesktopCodeRequestRow,
	DesktopCodeRequestsList,
} from "../../../../shared/desktop-contract";

/**
 * The code review pane's fixtures: row shapes from the frozen contract (§D.6),
 * deliberately covering every rung the pane can render.
 *
 * ONE CLOCK FOR THE WHOLE SET. `updated 12 min ago` is a function of the render
 * clock, and a fixture that read `Date.now()` would photograph a different
 * number each capture. `FIXTURE_NOW_MS` is a fixed instant and every stamp
 * below is an offset from it, so every frame in the set is reproducible because
 * the stories pin the pane's `nowMs` to the same number.
 *
 * THE SHAPES ARE THE REAL FORGE SHAPES, trimmed: the comment counts, CI totals
 * and round numbers are the sizes the live PRs in `damianvtran/local-operator`
 * actually carry (design record §C.6's fixture candidates), and the titles are
 * trimmed from that repository's own PRs because it is public.
 */

/** The set's one clock: 2026-10-09T12:00:00Z, milliseconds. */
export const FIXTURE_NOW_MS = Date.UTC(2026, 9, 9, 12, 0, 0);

const seconds = (ms: number): number => Math.floor(ms / 1000);

const at = (minutesAgo: number): number =>
	seconds(FIXTURE_NOW_MS - minutesAgo * 60_000);

const lane = (
	partial: Partial<DesktopCodeRequestLane> &
		Pick<DesktopCodeRequestLane, "lane" | "round" | "state">,
): DesktopCodeRequestLane => ({
	qualifier: null,
	freshness: "fresh",
	reviewed_head: null,
	reviewer: null,
	verdict: null,
	...partial,
});

const row = (
	partial: Partial<DesktopCodeRequestRow> &
		Pick<DesktopCodeRequestRow, "key" | "number" | "relation" | "summary">,
): DesktopCodeRequestRow => ({
	url: `https://github.com/damianvtran/local-operator/pull/${partial.number}`,
	forge: "github",
	project: "damianvtran/local-operator",
	via: null,
	acted: [],
	mention: { sources: ["tool_create"], count: 1, last_at: at(40) },
	link_only: false,
	lanes: [],
	fetched_at: at(1),
	stale: false,
	refresh_error: null,
	/*
	 * fetch_state defaults to the POPULATED state: a fixture row with data and
	 * no recorded failure is `ready`, and the sets that model other states
	 * override it (link-only -> unauthenticated/untracked, could-not-refresh
	 * -> stale, the pending set -> pending/cooling/failed). Every fixture row
	 * carries the field so no frame exercises the legacy branch by accident.
	 */
	fetch_state: "ready",
	...partial,
});

/**
 * The populated set: mixed lanes and states, the frame a review judges first.
 *
 * Every rung worth seeing is here once - awaiting review, findings open with
 * CI failing (the attention dot's row), a draft with CI pending, a merged
 * round-2 terminal lane, an acted mention, a via-subagent open, an unknown, an
 * inherited row, and a stale lane - because the alternative is five
 * single-state frames that each prove one thing and a composite frame that
 * proves the LAYOUT, which is what actually regresses.
 */
export const populatedRows = (): DesktopCodeRequestRow[] => [
	row({
		key: "gh:1904",
		number: 1904,
		relation: "opened",
		summary: {
			state: "open",
			draft: false,
			title: "feat(code-review): the session's request ledger, in its own pane",
			head_sha: "9d29452c1100",
			ci: { status: "success", total: 23, passed: 23, failed: 0, pending: 0 },
			updated_at: at(12),
			comments: 6,
		},
		lanes: [
			lane({
				lane: "agent",
				round: 2,
				state: "remediation_posted",
				reviewed_head: "3f2a91b7",
				reviewer: "reviewer (a model)",
			}),
			lane({ lane: "qa", round: 1, state: "clean", reviewed_head: "3f2a91b7" }),
		],
	}),
	row({
		/*
		 * THE GITLAB SHAPE (QA round 1, Q-1 / design D2 / agent review F1): a
		 * real pipeline answer carries NO job counts (`passed`/`failed`/`pending`/
		 * `total` all null) and an `!N` identity (D6); the lane carries NO round
		 * (F2's absent-round shape). One row proves both clauses.
		 */
		key: "gl:57",
		number: 57,
		relation: "mentioned",
		forge: "gitlab",
		project: "minervaai/minerva-skills",
		url: "https://gitlab.com/minervaai/minerva-skills/-/merge_requests/57",
		mention: { sources: ["assistant"], count: 1, last_at: at(30) },
		summary: {
			state: "merged",
			draft: false,
			title: "feat(skills): the code review skill",
			head_sha: "7c4a1e9f22",
			ci: {
				status: "success",
				passed: null,
				failed: null,
				pending: null,
				total: null,
				url: "https://gitlab.com/minervaai/minerva-skills/-/pipelines/2924686797",
			},
			updated_at: at(50),
			comments: null,
		},
		lanes: [
			lane({
				lane: "agent",
				round: null,
				state: "clean",
				reviewed_head: "7c4a1e9f22",
			}),
		],
	}),
	row({
		key: "gh:2091",
		number: 2091,
		relation: "opened",
		summary: {
			state: "open",
			draft: false,
			title: "fix(daemon): reap the observation stamp when a session reloads",
			head_sha: "b41c07aa93",
			ci: { status: "failure", total: 24, passed: 22, failed: 2, pending: 0 },
			updated_at: at(3),
			comments: 12,
		},
		lanes: [
			lane({
				lane: "agent",
				round: 1,
				state: "findings_open",
				reviewed_head: "b41c07aa93",
			}),
		],
	}),
	row({
		key: "gh:2103",
		number: 2103,
		relation: "opened",
		summary: {
			state: "open",
			draft: true,
			title: "docs(network): the connect to fully capable walkthrough",
			head_sha: "77d1e0f2aa",
			ci: { status: "pending", total: 0, passed: 0, failed: 0, pending: 3 },
			updated_at: at(55),
			comments: null,
		},
		lanes: [],
	}),
	row({
		key: "gh:1776",
		number: 1776,
		relation: "opened",
		summary: {
			state: "merged",
			draft: false,
			title: "feat(tui): sidebar affordances for the panel rail",
			head_sha: "e4a90c13d2",
			ci: { status: "success", total: 23, passed: 23, failed: 0, pending: 0 },
			updated_at: at(300),
			comments: 9,
		},
		lanes: [
			lane({
				lane: "agent",
				round: 2,
				state: "terminal",
				reviewed_head: "e4a90c13d2",
			}),
			lane({
				lane: "design",
				round: 1,
				state: "clean",
				reviewed_head: "e4a90c13d2",
			}),
		],
	}),
	row({
		key: "gh:1965",
		number: 1965,
		relation: "mentioned",
		acted: ["comment"],
		mention: { sources: ["user", "assistant"], count: 3, last_at: at(20) },
		summary: {
			state: "open",
			draft: false,
			title: "feat(approvals): requester withdrawal, plus follow-ups",
			head_sha: "0c55aa12b9",
			ci: { status: "success", total: 23, passed: 23, failed: 0, pending: 0 },
			updated_at: at(20),
			comments: 4,
		},
		lanes: [],
	}),
	row({
		key: "gh:2007",
		number: 2007,
		relation: "opened",
		via: { agent_role: "coder", path: ["coder", "reviewer"] },
		summary: {
			state: "open",
			draft: false,
			title: "refactor(scripts): one scope gate for the changed tree",
			head_sha: "5b2f77e0c4",
			ci: { status: "success", total: 23, passed: 23, failed: 0, pending: 0 },
			updated_at: at(90),
			comments: 7,
		},
		lanes: [
			lane({
				lane: "agent",
				round: 1,
				state: "unstated",
				reviewed_head: "5b2f77e0c4",
			}),
		],
	}),
	row({
		key: "gh:1999",
		number: 1999,
		relation: "unknown",
		summary: null,
	}),
	row({
		key: "gh:1500",
		number: 1500,
		relation: "inherited",
		summary: {
			state: "closed",
			draft: false,
			title: "chore(deps): bump the types toolchain one minor",
			head_sha: "c9d1a4b7e8",
			ci: { status: "none", total: 0, passed: 0, failed: 0, pending: 0 },
			updated_at: at(1440),
			comments: 2,
		},
		lanes: [],
	}),
	row({
		key: "gh:2044",
		number: 2044,
		relation: "mentioned",
		mention: { sources: ["assistant"], count: 1, last_at: at(70) },
		summary: {
			state: "open",
			draft: false,
			title: "fix(providers): recover a stalled upstream instead of zeroing",
			head_sha: "9d29452c11",
			ci: { status: "success", total: 23, passed: 23, failed: 0, pending: 0 },
			updated_at: at(70),
			comments: 5,
		},
		lanes: [
			lane({
				lane: "agent",
				round: 2,
				state: "clean",
				freshness: "stale",
				reviewed_head: "a3ffd2b6",
			}),
		],
	}),
];

/**
 * THE WORST-CASE RELATION TAG (design round 2, D9): the depth-2 `via subagent
 * coder > reviewer` row in both pill variants - Open and Merged - as the two
 * LEADING rows of the narrow frame. `acted` makes the pair sort first inside
 * the opened group (rank, then acts, then recency - `groupRows`), because the
 * frame's whole point is that a wide tag and the `#N` coexist at the 320px
 * floor: before the D9 fix the number spilled out of its wrapper and printed
 * over the tag.
 */
export const viaRows = (): DesktopCodeRequestRow[] => [
	row({
		key: "gh:2007",
		number: 2007,
		relation: "opened",
		acted: ["merge"],
		via: { agent_role: "coder", path: ["coder", "reviewer"] },
		summary: {
			state: "open",
			draft: false,
			title: "refactor(scripts): one scope gate for the changed tree",
			head_sha: "5b2f77e0c4",
			ci: { status: "success", total: 23, passed: 23, failed: 0, pending: 0 },
			updated_at: at(90),
			comments: 7,
		},
		lanes: [
			lane({
				lane: "agent",
				round: 1,
				state: "unstated",
				reviewed_head: "5b2f77e0c4",
			}),
		],
	}),
	row({
		key: "gh:2009",
		number: 2009,
		relation: "opened",
		acted: ["merge"],
		via: { agent_role: "coder", path: ["coder", "reviewer"] },
		summary: {
			state: "merged",
			draft: false,
			title: "fix(rail): the sixth door keeps its order",
			head_sha: "77c9ee10ab",
			ci: { status: "success", total: 23, passed: 23, failed: 0, pending: 0 },
			updated_at: at(50),
			comments: 3,
		},
		lanes: [
			lane({
				lane: "agent",
				round: 1,
				state: "clean",
				reviewed_head: "77c9ee10ab",
			}),
		],
	}),
];

/** The store's own list envelope, minus the rows the caller overrides. */
export const list = (
	rows: DesktopCodeRequestRow[],
	extra: Partial<DesktopCodeRequestsList> = {},
): DesktopCodeRequestsList => ({
	revision: 7,
	rows,
	tool_output_only_count: 0,
	tool_output_truncated: false,
	cooling: {},
	scan_state: "ready",
	...extra,
});

/** Empty: the design's sentence is the whole frame (§6). */
export const emptyList = (): DesktopCodeRequestsList => list([]);

/**
 * Link-only: no summary and no lanes - the two lines and the caption (§1),
 * now driven by `fetch_state` (design §4): the github/gitlab rows are
 * resolved no-login outcomes (`unauthenticated`), the gitea row is a host
 * this build cannot track (`untracked`).
 */
export const linkOnlyList = (): DesktopCodeRequestsList =>
	list([
		row({
			key: "gl:8812",
			number: 8812,
			relation: "mentioned",
			forge: "gitlab",
			project: "minervaai/minerva",
			url: "https://gitlab.com/minervaai/minerva/-/merge_requests/8812",
			link_only: true,
			fetch_state: "unauthenticated",
			link_only_hint:
				"Link only — sign in with the glab CLI to track this one.",
			summary: null,
			mention: { sources: ["assistant"], count: 1, last_at: at(5) },
		}),
		row({
			/*
			 * THE UNTRACKED-HOST SHAPE (link-only_hint's own third branch): a host
			 * no adapter reaches gets the backend's "isn't tracked yet" sentence,
			 * never a CLI that cannot help it (agent review F8 / design D8 / UX U5).
			 */
			key: "codeberg:88",
			number: 88,
			relation: "mentioned",
			forge: "gitea",
			project: "somebody/notes",
			url: "https://codeberg.org/somebody/notes/pulls/88",
			link_only: true,
			fetch_state: "untracked",
			link_only_hint: "Link only — this host isn't tracked yet.",
			summary: null,
			mention: { sources: ["assistant"], count: 1, last_at: at(12) },
		}),
		row({
			key: "gh:2090",
			number: 2090,
			relation: "mentioned",
			link_only: true,
			fetch_state: "unauthenticated",
			link_only_hint: "Link only — sign in with the gh CLI to track this one.",
			summary: null,
			mention: { sources: ["user"], count: 1, last_at: at(30) },
		}),
	]);

/** Rate-limited: the pane-level cooling line, once per host (§5). */
export const rateLimitedList = (): DesktopCodeRequestsList =>
	list(
		[
			row({
				key: "gh:2091",
				number: 2091,
				relation: "opened",
				summary: {
					state: "open",
					draft: false,
					title:
						"fix(daemon): reap the observation stamp when a session reloads",
					head_sha: "b41c07aa93",
					ci: { status: "pending", total: 0, passed: 0, failed: 0, pending: 3 },
					updated_at: at(9),
					comments: 12,
				},
				lanes: [
					lane({
						lane: "agent",
						round: 1,
						state: "findings_open",
						reviewed_head: "b41c07aa93",
					}),
				],
			}),
		],
		{ cooling: { "github.com": seconds(FIXTURE_NOW_MS + 2 * 3_600_000) } },
	);

/** Stale: the reviewed head is behind the row's own (§3's freshness rule). */
export const staleList = (): DesktopCodeRequestsList =>
	list([
		row({
			key: "gh:2044",
			number: 2044,
			relation: "opened",
			summary: {
				state: "open",
				draft: false,
				title: "fix(providers): recover a stalled upstream instead of zeroing",
				head_sha: "9d29452c11",
				ci: { status: "success", total: 23, passed: 23, failed: 0, pending: 0 },
				updated_at: at(70),
				comments: 5,
			},
			lanes: [
				lane({
					lane: "agent",
					round: 2,
					state: "clean",
					freshness: "stale",
					reviewed_head: "a3ffd2b6",
				}),
			],
		}),
	]);

/** Could-not-refresh: last-known rows, each with its own caption (§6). */
export const couldNotRefreshList = (): DesktopCodeRequestsList =>
	list(
		populatedRows()
			.slice(0, 3)
			.map((entry) => ({
				...entry,
				stale: true,
				/*
				 * `stale` on the wire (design §4): last-known data under a failed
				 * revalidation. The notice leads with the state's own words
				 * (`Stale — last known, not current:`) and keeps the backend's
				 * sentence verbatim after that lead.
				 */
				fetch_state: "stale",
				/*
				 * The backend's own sentence, verbatim (UX round 1, U5): QA's real
				 * bad-token run produced exactly this string, and the row renders it
				 * behind the stale lead rather than paraphrasing the cause.
				 */
				refresh_error:
					"credential rejected — sign in again with gh/glab, then refresh.",
			})),
	);

/**
 * Pending: a fetch that has not resolved yet (design §4/§5) - the states the
 * pane must render WITHOUT the sign-in remedy. The first row is the defect's
 * own case: a fetchable row whose first read is still in flight, with no
 * `link_only_hint` on the wire (the core suppresses it while pending). The
 * second is a never-fetched row on a cooling host; the third resolved as a
 * non-credential failure. Each carries its own sentence, or none.
 */
export const pendingList = (): DesktopCodeRequestsList =>
	list([
		row({
			key: "gh:2110",
			number: 2110,
			relation: "opened",
			link_only: true,
			fetch_state: "pending",
			summary: null,
			mention: { sources: ["tool_create"], count: 1, last_at: at(2) },
		}),
		row({
			key: "gl:9021",
			number: 9021,
			relation: "opened",
			forge: "gitlab",
			project: "minervaai/minerva",
			url: "https://gitlab.com/minervaai/minerva/-/merge_requests/9021",
			link_only: true,
			fetch_state: "cooling",
			/* The same instant the reason sentence names (FIXTURE_NOW_MS + 2h). */
			cooling_until: seconds(FIXTURE_NOW_MS + 2 * 3_600_000),
			reason:
				"cooling — this host is rate-limited until 2026-10-09T14:00:00Z; nothing was fetched yet",
			summary: null,
			mention: { sources: ["user"], count: 1, last_at: at(6) },
		}),
		row({
			key: "gh:2112",
			number: 2112,
			relation: "opened",
			link_only: true,
			fetch_state: "failed",
			reason: "refresh failed (server 503); keeping the last known data",
			refresh_error: "refresh failed (server 503); keeping the last known data",
			summary: null,
			mention: { sources: ["assistant"], count: 1, last_at: at(9) },
		}),
	]);
