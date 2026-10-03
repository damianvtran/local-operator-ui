/*
 * The Projects tab: the page's states, its detail, its dialogs and the
 * milestone toggle, on the PRODUCTION components.
 *
 * WHAT STANDS IN FOR THE BACKEND: the desktop bridge
 * (`window.api.desktop.request`) — the same boundary the agent-hub stories
 * stub, for the same reason: every op the page issues is answered from a
 * named fixture, so the real page, the real query layer, the real rows, the
 * real dialogs and the real mutations all run, and a story that starts issuing
 * an op the fixture does not know says so loudly instead of rendering a
 * surface with quietly missing data.
 *
 * EVERY INSTANT IS PINNED around `FIXTURE_NOW_MS`, and the page takes it as a
 * prop (`ProjectsPage`'s `nowMs` — the schedules page's rule): a progress age
 * label is a function of the clock, and a fixture built from "2 hours ago"
 * would make every frame churn on every capture.
 */

import type {
	ReusableProfile,
	ReusableTeam,
} from "@shared/api/local-operator/profile-hooks";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent } from "@storybook/test";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import type {
	DesktopLinkedSession,
	DesktopProject,
	DesktopProjectDetail,
	DesktopProjectMilestone,
	DesktopProjectRequestUpdateResult,
	DesktopProjectUpdate,
	DesktopProjectView,
} from "../../../../../shared/desktop-control-contract";
import "../../../styles/index.css";
import { INLINE_EDIT_CONFLICT_SENTENCE } from "@shared/components/inline-edit";
import {
	type BoardWindow,
	PROJECTS_BOARD_ORDER_STORAGE_KEY,
	PROJECTS_BOARD_WINDOW_STORAGE_KEY,
	writeBoardColumnOrder,
	writeBoardWindow,
} from "../project-model";
import { type SortSpec, writeProjectsSort } from "../project-sort";
import { REQUEST_UPDATE_NEVER_STARTED_DETAIL } from "../request-update";
import { BOARD_WINDOW_HINT } from "./board-window-select";
import { ProjectsPage } from "./projects-page";

/** Sunday 20 September 2026, 2:00 PM local — every label derives from this. */
const FIXTURE_NOW_MS = new Date(2026, 8, 20, 14, 0, 0, 0).getTime();
const HOUR_S = 3600;
const DAY_S = 86_400;

/** One listing row, with the fields a frame or a test does not care about. */
const project = (
	id: string,
	name: string,
	extra: Partial<DesktopProject> = {},
): DesktopProject => ({
	id,
	name,
	description: "",
	owner: null,
	team: null,
	title: null,
	status: "active",
	tags: [],
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: "points",
	milestones_completed: 0,
	milestones_total: 0,
	sessions: 0,
	live_sessions: 0,
	progress_stale: true,
	progress_updated_at: null,
	updated_at: FIXTURE_NOW_MS / 1000,
	...extra,
});

const THREE: DesktopProject[] = [
	project("p1", "payments-migration", {
		description: "Cut the payments API over to the new service",
		/* The team fields ship since the backend slice (`title`/`owner`/`team`);
		 * the three rows cover the three section outcomes — a named team, an
		 * owner-only row (the fallback bucket) and the `No team` bucket — so
		 * every frame of this fixture exercises the grouping rule. */
		owner: "atlas",
		team: "platform",
		tags: ["q4", "payments"],
		start_date: "2026-09-01",
		target_date: "2026-10-15",
		estimate: 13,
		milestones_completed: 2,
		milestones_total: 5,
		/* Four, matching `DETAIL.project.sessions`: the door's count and the
		 * drawer's rows are one fact on two surfaces (design round 2, D11). */
		sessions: 4,
		live_sessions: 2,
		progress_stale: false,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 2 * HOUR_S,
	}),
	project("p2", "q4-hardening", {
		description: "Error budgets, retries and the load shed",
		/* Owner only: no team on this row, so it files under its owner's name. */
		owner: "atlas",
		team: null,
		status: "paused",
		start_date: "2026-09-10",
		target_date: "2026-12-01",
		estimate: 4,
		estimate_unit: "days",
		milestones_completed: 0,
		milestones_total: 2,
		sessions: 1,
		live_sessions: 0,
		progress_stale: true,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 6 * DAY_S,
	}),
	project("p3", "docs-pass", {
		description: "Rewrite the guides against the new CLI",
		/* Neither field: the `No team` bucket. */
		owner: null,
		team: null,
		status: "done",
		completed_at: "2026-09-12",
		milestones_completed: 1,
		milestones_total: 1,
		sessions: 1,
		live_sessions: 0,
		progress_stale: false,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 8 * DAY_S,
	}),
];

/** Twelve rows, for the list under a scrollbar rather than under the fold. */
const MANY: DesktopProject[] = [
	...THREE,
	...Array.from({ length: 9 }, (_, index) =>
		project(`m${index}`, `migration-batch-${index + 1}`, {
			description: `Batch ${index + 1} of the storage migration`,
			/* Cycled across the two teams and the bucket: the twelve-row list
			 * overflows its scroller under three sections, which is the state
			 * the sticky pass photographs. */
			team: (["platform", "atlas", null] as const)[index % 3],
			owner: "atlas",
			target_date: `2026-11-0${(index % 9) + 1}`,
			estimate: index + 1,
			milestones_completed: index % 3,
			milestones_total: 3,
			sessions: index % 4,
			live_sessions: index % 3,
			progress_stale: index % 2 === 0,
			progress_updated_at: FIXTURE_NOW_MS / 1000 - (index + 1) * HOUR_S,
		}),
	),
];

/**
 * Twenty-four rows, for the sticky story alone: with twelve the whole list
 * still fits a 1280x900 frame, so the one state that story exists for — the
 * second section's header reaching the scroller's top — is unreachable, and
 * the play would be asserting a pin that can never happen.
 */
const MANY_LONG: DesktopProject[] = [
	...MANY,
	...Array.from({ length: 12 }, (_, index) =>
		project(`n${index}`, `hardening-batch-${index + 1}`, {
			/* The first row carries a title: the list's title display is
			 * photographed here (title primary, key kept as the addressable
			 * hook), on a fixture this story owns. */
			title: index === 0 ? "Hardening sweep" : null,
			description: `Harden surface ${index + 1} against the new load`,
			team: (["platform", "atlas", null] as const)[index % 3],
			owner: "atlas",
			estimate: index + 1,
			milestones_completed: 0,
			milestones_total: 2,
			sessions: 0,
			live_sessions: 0,
			progress_stale: false,
			progress_updated_at: FIXTURE_NOW_MS / 1000 - (index + 2) * HOUR_S,
		}),
	),
];

/**
 * The board-sticky story's own fixture: twenty active cards over two teams, so
 * the board is two tall bands — taller than the frame, which is what gives
 * the band headers room to travel and pin. The shared board fixtures never
 * fill a band past the frame, and a header that cannot reach its pin offset
 * cannot be measured against it.
 *
 * The FIRST card carries a title: this story's frames are where the title
 * display (title primary, key as the muted subtitle) is photographed and
 * asserted, on a fixture no other frame shares.
 */
const BOARD_LONG: DesktopProject[] = Array.from({ length: 20 }, (_, index) =>
	project(`b${index}`, `load-shed-${index + 1}`, {
		title: index === 0 ? "Load-shed hardening" : null,
		description: `Slice ${index + 1} of the load shed`,
		team: index % 2 === 0 ? "platform" : "atlas",
		status: "active",
		target_date: `2026-11-${String((index % 28) + 1).padStart(2, "0")}`,
		estimate: (index % 8) + 1,
		milestones_completed: index % 3,
		milestones_total: 3,
		sessions: index % 2,
		live_sessions: 0,
		progress_stale: false,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - (index + 1) * HOUR_S,
	}),
);

/**
 * The board-window fixture (feat/board-time-window): six rows whose ages land
 * on the ladder's rungs - 2h, 5d, 12d, 45d, 200d - over two teams, plus the
 * R5 row: updated 1h ago while its PROGRESS line still reads "reported 12d
 * ago", so a 24h frame carries a card that looks stale by its own printed
 * age while the filter - which reads `updated_at` - correctly keeps it.
 *
 * Four statuses (`active`, `planning`, `qa`, `done`) leave `validation` the
 * one fixed column empty in every window, and each rung gains exactly the
 * rows its arithmetic promises: 24h -> 2, 7d -> 3, 30d -> 4, 90d -> 5, all
 * -> 6.
 */
const BOARD_WINDOW_ROWS: DesktopProject[] = [
	project("w1", "cutover-probe", {
		description: "First probe against the cutover gate",
		team: "platform",
		status: "active",
		updated_at: FIXTURE_NOW_MS / 1000 - 2 * HOUR_S,
		progress_stale: false,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 2 * HOUR_S,
		estimate: 5,
		milestones_completed: 1,
		milestones_total: 2,
		sessions: 1,
		live_sessions: 0,
	}),
	project("w2", "queue-tune", {
		description: "Tune the ingest queue's drain rate",
		team: "atlas",
		status: "planning",
		updated_at: FIXTURE_NOW_MS / 1000 - 5 * DAY_S,
		progress_stale: false,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 5 * DAY_S,
		estimate: 3,
		milestones_completed: 0,
		milestones_total: 3,
		sessions: 0,
		live_sessions: 0,
	}),
	project("w3", "schema-deprecation", {
		description: "Retire the v1 schema behind a reader shim",
		team: "platform",
		status: "qa",
		updated_at: FIXTURE_NOW_MS / 1000 - 12 * DAY_S,
		progress_stale: true,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 12 * DAY_S,
		estimate: 8,
		milestones_completed: 2,
		milestones_total: 4,
		sessions: 1,
		live_sessions: 0,
	}),
	project("w4", "fallback-paths", {
		description: "Enumerate the degraded-mode fallbacks",
		team: "atlas",
		status: "done",
		updated_at: FIXTURE_NOW_MS / 1000 - 45 * DAY_S,
		progress_stale: true,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 45 * DAY_S,
		milestones_completed: 1,
		milestones_total: 1,
		sessions: 2,
		live_sessions: 0,
	}),
	project("w5", "vendor-renewal", {
		description: "Renew the data-vendor contract",
		team: "platform",
		status: "done",
		updated_at: FIXTURE_NOW_MS / 1000 - 200 * DAY_S,
		progress_stale: true,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 200 * DAY_S,
		sessions: 0,
		live_sessions: 0,
	}),
	project("w6", "hotfix-drill", {
		/*
		 * THE MISMATCH ROW (R5): updated an hour ago, but its progress line
		 * still reports the drill that ran 12 days before - the card prints
		 * "reported 12d ago" while the 24h window keeps it on screen. A filter
		 * reading the printed age would hide it; this row is the frame that
		 * proves which stamp the filter reads.
		 */
		description: "Rehearse the auth hotfix rollback",
		team: "atlas",
		status: "active",
		updated_at: FIXTURE_NOW_MS / 1000 - 1 * HOUR_S,
		progress_stale: true,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 12 * DAY_S,
		estimate: 2,
		milestones_completed: 0,
		milestones_total: 1,
		sessions: 1,
		live_sessions: 1,
	}),
];

/**
 * Only the rows older than the default 7d window: the fixture the empty-window
 * state and its recovery are photographed on (at 7d all three are excluded;
 * `Show all time` lands them).
 */
const BOARD_WINDOW_AGED: DesktopProject[] = BOARD_WINDOW_ROWS.filter(
	(row) => FIXTURE_NOW_MS / 1000 - row.updated_at > 7 * DAY_S,
);

/**
 * The rows older than NINETY days - the one row `vendor-renewal` at 200d, and
 * nothing else. The 90d rung's empty state needs every row outside the window,
 * which is a different fixture from the 7d one (that one still contains a 12d
 * and a 45d row, inside 90d): the two empty-window frames are the ladder's own
 * proof that the heading's phrase follows the RUNG rather than the state.
 */
const BOARD_WINDOW_ANCIENT: DesktopProject[] = BOARD_WINDOW_ROWS.filter(
	(row) => FIXTURE_NOW_MS / 1000 - row.updated_at > 90 * DAY_S,
);

const LINK = (
	sessionId: string,
	extra: Partial<DesktopLinkedSession> = {},
): DesktopLinkedSession => ({
	session_id: sessionId,
	exists: true,
	title: `Conversation ${sessionId.slice(0, 4)}`,
	created_at: FIXTURE_NOW_MS / 1000 - 10 * DAY_S,
	archived: false,
	runtime: { state: "stopped", busy: null, heartbeat_age_s: null, pid: null },
	subagents: null,
	todos: null,
	...extra,
});

/**
 * The history log, newest LAST (the wire's own order). Spread over three local
 * days so the feed's grouping has two headings and a Today; the markdown is
 * deliberately the shape agents write (headings, lists, inline code, a fence,
 * a link) and the last entry carries both attachment kinds.
 */
const UPDATES: DesktopProjectUpdate[] = [
	{
		at: "2026-09-18T10:15:00Z",
		text: "Cutover dry-run started. Planning notes are in `notes/rollout.md`.",
		by: "operator",
		attachments: [],
	},
	{
		at: "2026-09-19T17:05:00Z",
		text: "## Staging verification\n\n- parity checks pass on `v2/payments`\n- retry budget unchanged at **0.4%**\n\n```text\nparity: 412 passed / 0 failed\n```\n\nThe [runbook](https://example.com/runbook) is updated.",
		by: "a1a1a1a1a1a1",
		attachments: [
			{
				name: "parity.png",
				kind: "image",
				path: "/Users/dana/work/projects/payments/parity.png",
				bytes: 182_400,
				added_at: "2026-09-19T17:05:00Z",
			},
		],
	},
	{
		at: "2026-09-20T17:45:00Z",
		text: "Dashboard cutover is done; API parity holds on staging. Next: flip the read path.",
		by: "4e92693767fa",
		attachments: [
			{
				name: "cutover-report.csv",
				kind: "data",
				path: "/Users/dana/work/projects/payments/cutover-report.csv",
				bytes: 4_096,
				added_at: "2026-09-20T17:45:00Z",
			},
		],
	},
];

const DETAIL: DesktopProjectDetail = {
	project: {
		id: "p1",
		name: "payments-migration",
		title: "Payments migration",
		owner: "atlas",
		team: "platform",
		description:
			"Cut the payments API over to the new service.\n\n**Scope**\n\n- the read path (staging first)\n- the dashboard\n- the retry budget",
		status: "active",
		progress:
			"Dashboard cutover is done; API parity holds on staging. Next: flip the read path.",
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 2 * HOUR_S,
		progress_reported_by: "4e92693767fa",
		progress_stale: false,
		tags: ["q4", "payments"],
		sessions: ["4e92693767fa", "a1a1a1a1a1a1", "b2b2b2b2b2b2", "c3c3c3c3c3c3"],
		created_at: FIXTURE_NOW_MS / 1000 - 30 * DAY_S,
		updated_at: FIXTURE_NOW_MS / 1000 - 2 * HOUR_S,
		start_date: "2026-09-01",
		target_date: "2026-10-15",
		completed_at: null,
		estimate: 13,
		estimate_unit: "points",
		milestones: [
			{
				name: "api parity",
				target_date: "2026-09-10",
				completed_at: "2026-09-09",
				status: "completed",
			},
			{
				name: "beta cut",
				target_date: "2026-10-01",
				completed_at: null,
				status: "upcoming",
			},
			{
				name: "dashboard cutover",
				target_date: "2026-09-15",
				completed_at: null,
				status: "overdue",
			},
		],
		updates: UPDATES,
	},
	links: [
		LINK("4e92693767fa", {
			title: "Payments cutover",
			runtime: {
				state: "live",
				busy: true,
				heartbeat_age_s: 4,
				pid: 4242,
			},
			subagents: { running: 1, settled: 2, names: ["mapper"] },
			todos: { open: 3, total: 7 },
		}),
		LINK("a1a1a1a1a1a1", {
			title: "API parity checks",
			runtime: { state: "live", busy: null, heartbeat_age_s: 32, pid: 4243 },
			subagents: { running: 0, settled: 1, names: ["verifier"] },
			todos: { open: 1, total: 5 },
		}),
		LINK("b2b2b2b2b2b2", { exists: false, title: null }),
		LINK("c3c3c3c3c3c3", { title: "Old cutover notes", archived: true }),
	],
};

/** One listing answer, as the route's envelope: `{result: {projects}}`. */
/**
 * One detail document, composed from a listing row plus its milestones — the
 * shape the timeline's fan-out and a card popover read.
 */
const detailFor = (
	project: DesktopProject,
	milestones: DesktopProjectMilestone[] = [],
	links: DesktopLinkedSession[] = [],
): DesktopProjectDetail => ({
	project: {
		id: project.id,
		name: project.name,
		title: project.title,
		owner: project.owner,
		team: project.team,
		description: project.description,
		status: project.status,
		progress: "",
		progress_updated_at: project.progress_updated_at,
		progress_reported_by: "",
		progress_stale: project.progress_stale,
		tags: project.tags,
		sessions: [],
		created_at: project.updated_at,
		updated_at: project.updated_at,
		start_date: project.start_date,
		target_date: project.target_date,
		completed_at: project.completed_at,
		estimate: project.estimate,
		estimate_unit: project.estimate_unit,
		milestones,
		updates: [],
	},
	links,
});

/** The milestones each fixture project's detail carries, all three states. */
const MILESTONES: Record<string, DesktopProjectMilestone[]> = {
	p1: [
		{
			name: "api parity",
			target_date: "2026-09-10",
			completed_at: "2026-09-09",
			status: "completed",
		},
		{
			name: "dashboard cutover",
			target_date: "2026-09-15",
			completed_at: null,
			status: "overdue",
		},
		{
			name: "beta cut",
			target_date: "2026-10-01",
			completed_at: null,
			status: "upcoming",
		},
	],
	p2: [
		{
			name: "error budget",
			target_date: "2026-11-01",
			completed_at: null,
			status: "upcoming",
		},
	],
	p3: [
		{
			name: "guides shipped",
			target_date: "2026-09-12",
			completed_at: "2026-09-12",
			status: "completed",
		},
	],
};

/** The fan-out's answers for a fixture set: one detail per listing row. */
const detailsFor = (projects: DesktopProject[]) =>
	Object.fromEntries(
		projects.map((project) => [
			project.id,
			detailFor(project, MILESTONES[project.id] ?? []),
		]),
	);

/**
 * How the bridge answers `projects.request_update` in one story: the route's
 * own vocabulary, scripted. `hang` holds the promise open forever - the
 * sending/loading state's only honest shape, because a pending mutation cannot
 * be faked into existence from outside.
 */
type RequestUpdateFixture = {
	state: DesktopProjectRequestUpdateResult["state"];
	/** One row per linked session the batch dialled; counts derive from these. */
	sessions?: DesktopProjectRequestUpdateResult["sessions"];
	cooldown_remaining_s?: number;
	requested_at?: string | null;
	hang?: boolean;
};

type SearchIndexFixture = {
	/** The ids the ranked answer names, in RANK ORDER (the answer's order is the
	 * ranking; the page never re-sorts). */
	ids: string[];
	/** Hold the request open for ever: the in-flight state. */
	hang?: boolean;
	/** Fail the request with this sentence (the fallback's arm). */
	fail?: string;
};

type StubState = {
	projects: DesktopProject[];
	detail: DesktopProjectDetail | null;
	/**
	 * Per-key details, for the surfaces that fan out one `projects.get` per
	 * project (the Timeline's milestone fan-out and a board card's sessions
	 * popover). `detail` above stays the single-document case the detail-screen
	 * stories use.
	 */
	details: Record<string, DesktopProjectDetail> | null;
	/**
	 * The `projects.search` script. `null` is the state every story above is in:
	 * the capability advertises `projects: 1`, no index route exists, and the
	 * client matcher serves — which is exactly what a backend older than the
	 * core slice looks like. An object advertises `projects: 2` and answers the
	 * route from its own ids, so a story can prove the page paints the INDEX's
	 * membership and rank rather than the local matcher's.
	 */
	searchIndex: SearchIndexFixture | null;
	/** The listing read fails with this sentence. */
	failList: string | null;
	/** The listing read never settles: the loading frame's only honest shape. */
	hang: boolean;
	/** `projects.update` fails with this sentence (the follow-up-refusal arm). */
	failPatch: string | null;
	/** The refused patch's status, when the story is about a coded refusal. */
	failPatchStatus?: number;
	/** The refused patch's machine code (`project_name_exists`, say). */
	failPatchCode?: string;
	/** `projects.update` never settles: the inline editor's saving state. */
	hangPatch?: boolean;
	/**
	 * `projects.request_update`'s scripted answer (the check-in states). `null`
	 * means no story configured it: a press without a fixture says so loudly
	 * rather than faking a result.
	 */
	requestUpdate: RequestUpdateFixture | null;
};

let stub: StubState = {
	projects: [],
	detail: null,
	details: null,
	searchIndex: null,
	failList: null,
	hang: false,
	failPatch: null,
	requestUpdate: null,
};

/**
 * Every create/update the bridge answered, in order, for this render. The
 * submit story asserts the two-phase create (route then follow-up patch)
 * against this record rather than against pixels: a closed dialog proves
 * neither op ran, and a toast is not in the tree.
 */
let bridgeOps: { op: string; request: Record<string, unknown> }[] = [];

/** A plain-object test for the stub's field application (no zod in stories). */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/**
 * Apply one `projects.update` fields object to the fixture row, the way the
 * daemon's partial patch would: only the keys present move, and `""` clears
 * the nullable ones. It exists so a story's re-read after a save shows the
 * record the save produced — without it the re-read returns the old fixture
 * and the saved frame would show the value snapping back under its own
 * acknowledgement, an artefact a design round would read as a defect.
 */
const applyFields = (
	project: DesktopProjectView,
	fields: Record<string, unknown>,
): void => {
	const text = (key: string): string | undefined =>
		typeof fields[key] === "string" ? (fields[key] as string) : undefined;
	if (text("name") !== undefined) project.name = text("name") as string;
	if (text("description") !== undefined)
		project.description = text("description") as string;
	// `""` is the wire's clear for owner/team/title/dates (`_edit_date`, and
	// `_short_text_or_none` reading an emptied label as unset).
	const owner = text("owner");
	if (owner !== undefined) project.owner = owner.trim() ? owner : null;
	const team = text("team");
	if (team !== undefined) project.team = team.trim() ? team : null;
	const title = text("title");
	if (title !== undefined) project.title = title.trim() ? title : null;
	if (text("status") !== undefined) project.status = text("status") as string;
	if (Array.isArray(fields.tags))
		project.tags = (fields.tags as unknown[]).map((tag) => String(tag));
	const start = text("start_date");
	if (start !== undefined) project.start_date = start || null;
	const target = text("target_date");
	if (target !== undefined) project.target_date = target || null;
	if (typeof fields.estimate === "number") project.estimate = fields.estimate;
	const unit = text("estimate_unit");
	if (unit !== undefined) project.estimate_unit = unit;
};

const answer = (request: {
	op: string;
	[key: string]: unknown;
}):
	| Promise<{ status: number; body: unknown }>
	| { status: number; body: unknown } => {
	if (request.op === "capabilities") {
		return {
			status: 200,
			body: {
				result: {
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					//
					// The two registries are ADVERTISED here so the start-session picker
					// draws its real options; the plain-only degradation is a different
					// state and has its own story. `projects_request_update` is what
					// MOUNTS the check-in item and button (PR-B) - a backend without it
					// draws neither, which is the fail-closed state tests pin.
					features: {
						projects: stub.searchIndex ? 2 : 1,
						projects_request_update: 1,
						team_catalogue: 1,
						profile_catalogue: 1,
					},
				},
			},
		};
	}
	switch (request.op) {
		case "projects.list":
			if (stub.hang) return new Promise(() => {});
			if (stub.failList)
				return { status: 500, body: { detail: stub.failList } };
			return { status: 200, body: { result: { projects: stub.projects } } };
		case "projects.get": {
			const found = stub.details?.[String(request.key ?? "")] ?? stub.detail;
			if (!found) return { status: 404, body: { detail: "no such project" } };
			return { status: 200, body: { result: found } };
		}
		case "projects.search": {
			/*
			 * The index's answer, scripted rather than computed: this fixture's job is
			 * to be the BACKEND's opinion — an id list in the backend's own rank order —
			 * so a story can name a row the local matcher would never admit (its match
			 * lives in update text) and assert that the page painted the answer rather
			 * than re-deriving one. The echo is the request's own `q`, which is the
			 * contract the hook checks before it applies an answer.
			 */
			const index = stub.searchIndex;
			if (!index) return { status: 404, body: { detail: "no such route" } };
			if (index.hang) return new Promise(() => {});
			if (index.fail) return { status: 500, body: { detail: index.fail } };
			const byId = new Map(stub.projects.map((row) => [row.id, row]));
			const hits = index.ids.flatMap((id) => {
				const row = byId.get(id);
				return row
					? [{ id: row.id, name: row.name, score: 1, fields: ["updates"] }]
					: [];
			});
			return {
				status: 200,
				body: {
					result: {
						projects: hits,
						query: String(request.q ?? ""),
						count: hits.length,
					},
				},
			};
		}
		case "projects.milestone": {
			/*
			 * The toggle, full fidelity enough to be evidence about the UI: the
			 * store's rule is add-or-update by name with `completed` stamping or
			 * clearing the date, and the frame after the press has to come from the
			 * re-read — which is what invalidating on success makes happen.
			 */
			if (!stub.detail)
				return { status: 404, body: { detail: "no such project" } };
			const name = String(request.name ?? "");
			const completed =
				typeof request.completed === "boolean" ? request.completed : undefined;
			const projectView = stub.detail.project;
			projectView.milestones = projectView.milestones.map((milestone) => {
				if (milestone.name !== name) return milestone;
				const done = completed ?? true;
				return {
					...milestone,
					completed_at: done ? "2026-09-20" : null,
					status: done ? "completed" : "upcoming",
				};
			});
			return { status: 200, body: { result: projectView } };
		}
		case "projects.create": {
			bridgeOps.push({ op: request.op, request });
			const name = String(request.name ?? "");
			const created = project(`created-${stub.projects.length}`, name, {
				description: String(request.description ?? ""),
			});
			stub.projects = [...stub.projects, created];
			return { status: 200, body: { result: created } };
		}
		case "projects.update":
			/*
			 * `hangPatch` is the SAVING state's fixture: a write that never
			 * settles is the only honest way a story can hold the spinner, and
			 * it mirrors the real reason that state exists (a daemon under
			 * load). `failPatchStatus`/`failPatchCode` let a refusal carry the
			 * wire's own envelope — a 409 `project_name_exists` is the coded
			 * refusal the key editor maps to its crafted sentence.
			 */
			if (stub.hangPatch) return new Promise(() => {});
			bridgeOps.push({ op: request.op, request });
			if (stub.failPatch)
				return {
					status: stub.failPatchStatus ?? 422,
					body: {
						detail: stub.failPatchCode
							? { code: stub.failPatchCode, message: stub.failPatch }
							: stub.failPatch,
					},
				};
			/*
			 * A LANDED PATCH CHANGES THE RECORD, as the daemon's would: without
			 * this the re-read after a save returns the old fixture and the
			 * saved frame would show the record snapping back while its
			 * acknowledgement says otherwise — an artefact of the stub that a
			 * design round would read as a defect of the editor.
			 */
			if (stub.detail && isRecord(request.fields))
				applyFields(stub.detail.project, request.fields);
			return { status: 200, body: { result: stub.projects[0] ?? null } };
		case "projects.delete":
			return { status: 200, body: { result: { deleted: true } } };
		case "projects.link":
		case "projects.unlink":
			return { status: 200, body: { result: stub.projects[0] ?? null } };
		/*
		 * The two registries the start-session picker reads, and the one write the
		 * quick-send strip's press issues. The message answer is the envelope the
		 * admission path consumes (`admitted` is its receipt field); nothing about
		 * the response body drives the UI beyond arrival, so the fixture is the
		 * shape and not a synthetic conversation.
		 */
		case "teams.list":
			return { status: 200, body: { result: { teams: TEAMS } } };
		case "profiles.list":
			return { status: 200, body: { result: { profiles: AGENT_PROFILES } } };
		case "sessions.message":
			return {
				status: 200,
				body: {
					result: {
						session_id: String(request.sessionId ?? ""),
						admitted: true,
					},
				},
			};
		case "projects.milestone.remove":
			if (stub.detail) {
				const projectView = stub.detail.project;
				projectView.milestones = projectView.milestones.filter(
					(milestone) => milestone.name !== request.name,
				);
				return { status: 200, body: { result: projectView } };
			}
			return { status: 404, body: { detail: "no such project" } };
		/*
		 * The check-in batch (PR-B), answered in the route's own vocabulary. The
		 * counts are derived from the scripted session rows here rather than
		 * written twice, so a fixture cannot contradict itself; `hang` is a
		 * promise that never settles - the only way the sending state exists for
		 * a frame.
		 */
		case "projects.request_update": {
			const fixture = stub.requestUpdate;
			if (!fixture) {
				throw new Error(
					"projects.request_update was pressed without a story fixture",
				);
			}
			bridgeOps.push({ op: request.op, request });
			if (fixture.hang) return new Promise(() => {});
			const sessions = fixture.sessions ?? [];
			const result: DesktopProjectRequestUpdateResult = {
				project: {
					id: String(request.key ?? "p1"),
					key: "payments-migration",
					title: "Payments migration",
				},
				state: fixture.state,
				requested_at: fixture.requested_at ?? null,
				cooldown_remaining_s: fixture.cooldown_remaining_s ?? null,
				counts: {
					total: sessions.length,
					delivered: sessions.filter((s) => s.outcome === "delivered").length,
					unconfirmed: sessions.filter((s) => s.outcome === "unconfirmed")
						.length,
					failed: sessions.filter((s) => s.outcome === "failed").length,
				},
				sessions,
			};
			return { status: 200, body: { result } };
		}
		default:
			throw new Error(`unexpected desktop op in this story: ${request.op}`);
	}
};

/**
 * The two registries the start-session picker reads, shaped like the routes'
 * rows (and typed by the same interfaces the real hook returns, so a fixture
 * that stops matching the wire fails `check-types` rather than a frame).
 */
const TEAMS: ReusableTeam[] = [
	{
		id: "t1",
		name: "atlas",
		label: "Atlas Payments",
		description: "The payments platform team",
		manager: "manager",
		members: [{ role: "coder", count: 2, kind: "agent" }],
	},
	{
		id: "t2",
		name: "ops",
		description: "Infrastructure and releases",
		manager: "manager",
		members: [],
	},
	/*
	 * The team the project fixtures actually name (`team: "platform"`): without
	 * it in the catalogue the D5 frames would show the fallback, not the fix —
	 * the list group heading and the detail's `Managed by` line resolve through
	 * this roster, and a third row here is what makes them resolve at all.
	 */
	{
		id: "t3",
		name: "platform",
		label: "Platform Delivery",
		description: "Ships the platform releases",
		manager: "manager",
		members: [{ role: "reviewer", count: 1, kind: "agent" }],
	},
];

const AGENT_PROFILES: ReusableProfile[] = [
	{
		name: "reviewer",
		kind: "role",
		source: "installed",
		agent_id: "a1",
		description: "Reviews changes for correctness",
		tools: null,
		effort: null,
		delegate: false,
	},
	{
		name: "docs-writer",
		kind: "specialist",
		source: "installed",
		agent_id: "a2",
		description: "Writes and edits documentation",
		tools: null,
		effort: null,
		delegate: false,
	},
];

/** A drawn 320x200 PNG, so the feed's picture is real bytes (no committed asset). */
const pngBytes = (): Uint8Array => {
	const canvas = document.createElement("canvas");
	canvas.width = 320;
	canvas.height = 200;
	const context = canvas.getContext("2d");
	if (!context) return new Uint8Array();
	const gradient = context.createLinearGradient(0, 0, 320, 200);
	gradient.addColorStop(0, "#1f6feb");
	gradient.addColorStop(1, "#7ee787");
	context.fillStyle = gradient;
	context.fillRect(0, 0, 320, 200);
	context.fillStyle = "rgba(255,255,255,0.92)";
	context.font = "16px sans-serif";
	context.fillText("parity.png", 16, 32);
	const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
};

const installBridge = () => {
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: Parameters<typeof answer>[0]) => unknown };
			readFileBytes?: (path: string) => unknown;
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: answer };
	/*
	 * The local-file bridge, for the one image the feed carries. Storybook's
	 * global mock has no `readFileBytes`, so without this the update's picture
	 * would draw its honest "unavailable" sentence in every frame — a story
	 * about a state the desktop app does not have. Bytes are drawn here rather
	 * than committed as an asset (the canvas stories' rule).
	 */
	api.readFileBytes = async (path: string) => {
		if (!path.endsWith(".png")) {
			return { success: false, code: "not-found", error: `No file at ${path}` };
		}
		const bytes = pngBytes();
		return { success: true, data: bytes, sizeBytes: bytes.byteLength };
	};
};
installBridge();

/*
 * The capturer's shutter and its once-per-document play guard, copied from
 * `at-mentions.stories.tsx`'s contract: a play can run more than once per load,
 * and an unguarded one presses a control twice.
 */
const holdShutter = () => {
	document.documentElement.dataset.capturePending = "1";
};
const releaseShutter = () => {
	delete document.documentElement.dataset.capturePending;
};
const played = new Set<string>();

const poll = async (predicate: () => boolean, what: string) => {
	/*
	 * SIXTY SECONDS, not five. The plays race the story's own boot — the route
	 * swap, the stubbed query, and (on a loaded box) the dev server's first
	 * compile of this story — and a five-second budget turned a slow boot into a
	 * thrown play: the sweep stopped at `delete-confirm @ localOperatorDark`
	 * with the dialog on screen and the button about to enable. The loop exits
	 * on the first true answer, so the generous ceiling costs nothing when the
	 * state arrives at its usual speed.
	 */
	for (let attempt = 0; attempt < 1200; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`the story's state never arrived: ${what}`);
};

/**
 * The live colour a role class resolves to, read from a probe in this document.
 *
 * The stories run under every palette, so a band's ground has to be compared
 * against the TOKEN rather than a hex: the probe carries the same class the band
 * carries, in the same document and theme, so the assertion cannot drift from
 * the role it names.
 */
const roleGround = (role: string): string => {
	const probe = document.createElement("div");
	probe.className = role;
	probe.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px";
	document.body.appendChild(probe);
	const ground = getComputedStyle(probe).backgroundColor;
	probe.remove();
	return ground;
};

/**
 * The team band's register, read off the live band (issue #703, RESHAPED on
 * operator direction): the team's OWN name in an `<h3>`, 32px tall, BORDERLESS,
 * on the `surface` rung one lightness step above the rows' `canvas` - and not
 * operable, because a band is a label and the row-style hover it once resembled
 * is what the reporter read as broken.
 *
 * The last clause is the fold's own (#716's team labels, folded in): the band
 * prints the RESOLVED name - `teamLabelFor` wired from the page - and never the
 * raw binding, so a fixture whose label differs from its slug is what makes the
 * integration falsifiable at all. The fixture is main's own catalogue entry
 * (`platform` -> `Platform Delivery`), which is the smallest thing that can
 * exercise it: the same stories, the same lanes, one resolved name.
 *
 * Each clause can fail on its own, and each is the shape the change made:
 * `main` draws a `canvas` span with a `py-1.5` box and no heading, so the height
 * clause and the heading clause fail there; the register the first pass shipped
 * was small caps, which the `text-transform` clause fails; and the ground clause
 * is the change itself. The last two clauses are review round 1's U1/U2: the
 * count's accessible name, and the association between the section's heading and
 * the list it labels - the two places the visual grouping does not reach.
 */
const assertTeamBand = (
	selector: string,
	expectedLabel: string,
	slug: string,
) => {
	const bands = [...document.querySelectorAll<HTMLElement>(selector)];
	if (bands.length === 0) throw new Error(`no team band matches ${selector}`);
	const surface = roleGround("bg-surface");
	const canvas = roleGround("bg-canvas");
	if (surface === canvas) {
		throw new Error(
			"bg-surface and bg-canvas resolve to the same colour in this theme - the band's step is unmeasurable here",
		);
	}
	for (const band of bands) {
		const label = band.querySelector("h3");
		if (!label || (label.textContent ?? "").trim() === "") {
			throw new Error(`${selector}: a team band carries no <h3> label`);
		}
		if (getComputedStyle(label).textTransform !== "none") {
			throw new Error(
				`${selector}: the team label is transformed, so user data is being re-cased`,
			);
		}
		const height = band.getBoundingClientRect().height;
		if (Math.abs(height - 32) > 0.6) {
			throw new Error(`${selector}: a team band is ${height}px tall, not 32`);
		}
		if (Number.parseFloat(getComputedStyle(band).borderBottomWidth) > 0) {
			throw new Error(
				`${selector}: a team band carries a bottom rule; the step is the division`,
			);
		}
		const ground = getComputedStyle(band).backgroundColor;
		if (ground !== surface) {
			throw new Error(
				`${selector}: a team band's ground is ${ground}, not the surface rung (${surface})`,
			);
		}
		if (ground === canvas) {
			throw new Error(
				`${selector}: a team band is still on the rows' canvas ground - no division`,
			);
		}
		if (band.querySelector("button, a, [tabindex]") || band.tabIndex >= 0) {
			throw new Error(`${selector}: a team band became operable`);
		}
		/*
		 * The count is NAMED (UX review round 1, U1). The span sits outside the
		 * `<h3>`, so without an accessible name the reading order says "platform,
		 * 8" and the digit carries no noun; the visible text stays the terse number.
		 */
		const countEl = band.querySelector<HTMLElement>("span[aria-label]");
		if (!countEl) {
			throw new Error(`${selector}: the count carries no accessible name`);
		}
		const said = countEl.getAttribute("aria-label") ?? "";
		const visible = (countEl.textContent ?? "").trim();
		const noun = visible === "1" ? "project" : "projects";
		if (said !== `${visible} ${noun}`) {
			throw new Error(
				`${selector}: the count's accessible name is "${said}" where "${visible} ${noun}" is what it counts`,
			);
		}
		/*
		 * And the section's own list names itself with the heading it belongs to
		 * (UX review round 1, U2) - the association the visual grouping only implied.
		 */
		const headingId = label.id;
		if (!headingId) {
			throw new Error(
				`${selector}: the section heading carries no id for its list to name`,
			);
		}
		if (document.querySelectorAll(`#${CSS.escape(headingId)}`).length !== 1) {
			throw new Error(
				`${selector}: the heading's id "${headingId}" is not unique in the document`,
			);
		}
		const rows = band.parentElement?.querySelector("ul");
		if (!rows) {
			throw new Error(`${selector}: the section draws no list under its band`);
		}
		if (rows.getAttribute("aria-labelledby") !== headingId) {
			throw new Error(
				`${selector}: the section's list names "${rows.getAttribute("aria-labelledby")}" rather than its heading "${headingId}"`,
			);
		}
	}
	const exact = bands.some(
		(band) => (band.querySelector("h3")?.textContent ?? "") === expectedLabel,
	);
	if (!exact) {
		throw new Error(
			`${selector}: no band prints the resolved name "${expectedLabel}" exactly - a register that re-cases user data fails here`,
		);
	}
	/*
	 * AND THE SLUG MUST NOT BE WHAT IS PRINTED (the fold onto main's team labels,
	 * #716). The catalogue in this file resolves `platform` to `Platform
	 * Delivery`, so a band that prints the BINDING rather than the resolved name
	 * is a silent regression to the pre-label behaviour - the failure mode the
	 * integration exists to prevent, and one no colour or geometry clause can see.
	 */
	if (
		bands.some((band) => (band.querySelector("h3")?.textContent ?? "") === slug)
	) {
		throw new Error(
			`${selector}: a band prints the raw slug "${slug}" where the catalogue has a label`,
		);
	}
};

/**
 * The bands, once the story's own boot has drawn them.
 *
 * The plays race the story's boot - the route swap and the stubbed query - so an
 * assertion taken on the first tick reads a List that has not rendered yet and
 * reports it as a missing band (measured: the first version of these plays threw
 * `no team band matches [data-project-team]` at `populated @ localOperatorDark`,
 * and the rig correctly refused the frame). `poll`'s own 60 s ceiling is what
 * makes waiting the cheap option.
 */
const bandsReady = () =>
	poll(
		() => document.querySelectorAll("[data-project-team]").length > 0,
		"the List's team bands",
	);

/** A story's play: hold the shutter, run the gesture, wait, release. */
const playOnce = (key: string, gesture: () => Promise<void>) => async () => {
	if (played.has(key)) return;
	played.add(key);
	holdShutter();
	try {
		await gesture();
	} finally {
		releaseShutter();
	}
};

/** Click one control once it exists, the way a user would. */
const clickWhen = async (selector: string) => {
	await poll(() => document.querySelector(selector) !== null, selector);
	document.querySelector<HTMLElement>(selector)?.click();
};

/**
 * One element, or the play fails with its own sentence — the `clickWhen`
 * contract for elements a play types into rather than clicks (a missing field
 * must read as a missing field, not as a non-null-assertion crash).
 */
const need = <T extends Element>(selector: string): T => {
	const element = document.querySelector<T>(selector);
	if (!element) throw new Error(`the story's element is missing: ${selector}`);
	return element;
};

/**
 * The board's rendered card keys, sorted — the window filter's own claim,
 * read off the live board rather than re-deriving the predicate in the play.
 */
const boardCardKeys = () =>
	[...document.querySelectorAll<HTMLElement>("[data-project-name]")].map(
		(node) => node.dataset.projectName ?? "",
	);

/** Fail the play when the board shows a different set of cards than `expected`. */
const expectBoardKeys = (expected: string[], what: string) => {
	const shown = boardCardKeys().sort();
	const want = [...expected].sort();
	if (shown.join(",") !== want.join(",")) {
		throw new Error(
			`${what}: the board shows [${shown.join(", ")}], not [${want.join(", ")}]`,
		);
	}
};

/**
 * Wait for the DETAIL screen the route-based stories navigate to.
 *
 * The plays race `RouteTo`'s navigation: the story's first render is the
 * unmatched route (nothing mounted), the swap happens in an effect, and the
 * detail's own query settles after that. Every play on a detail screen waits
 * here first, so its first click targets a control that exists. The heading's
 * `data-project-title` is the marker because it only exists on the detail
 * (the header is `project-editors.tsx`'s), unlike text the list also paints.
 */
const waitForDetail = () =>
	poll(
		() => document.querySelector("[data-project-title]") !== null,
		"the detail screen",
	);

/**
 * Walk the story's own router to a route, with the app's OWN route table for
 * this page, so the detail screens render through `useParams` exactly as the
 * app reaches them.
 *
 * WHY THE ROUTES AND NOT JUST THE NAVIGATION: the global `MemoryRouter` the
 * preview provides has no route table of its own, and `useParams` yields
 * nothing unless some `<Route>` matched — so a story that only navigated kept
 * rendering the list under the detail's URL (measured: the detail's own
 * heading never appeared while the frame showed the list's own header). Both
 * routes are declared here, matching `app.tsx`'s pair, and the navigation
 * replaces the entry so the history holds one location, as the app's own
 * entry would.
 */
const RouteTo = ({
	path,
	children,
}: {
	path: string;
	children: ReactNode;
}) => {
	const navigate = useNavigate();
	useEffect(() => {
		navigate(path, { replace: true });
	}, [navigate, path]);
	return (
		<Routes>
			<Route path="/projects/:projectId" element={children} />
			<Route path="/projects" element={children} />
		</Routes>
	);
};

/* ------------------------------------------------------------------ states */

const meta: Meta = {
	title: "Projects/Tab",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The page against one stub, at the app's own row width. */
const page = (
	state: Partial<StubState> & {
		view?: "list" | "board" | "timeline";
		columnOrder?: string[];
		window?: BoardWindow;
		sort?: SortSpec | null;
	},
) => {
	stub = {
		projects: [],
		detail: null,
		details: null,
		failList: null,
		hang: false,
		failPatch: null,
		/* The search index: absent means `projects: 1`, the client matcher's
		 * backend, which is every story that does not say otherwise. */
		searchIndex: null,
		/* Pinned like the defaults above: without it the spread's Optional half
		 * keeps `undefined` in the inferred type, which a required field refuses. */
		requestUpdate: null,
		...state,
	};
	bridgeOps = [];
	/*
	 * The view choice is PERSISTED (the app's layout-choice rule), so each
	 * story states it explicitly and clears it otherwise: without the clear, a
	 * board story would leak its view into the next list story through the
	 * same storage the app reads.
	 */
	try {
		if (state.view) localStorage.setItem("projects-view", state.view);
		else localStorage.removeItem("projects-view");
	} catch {
		/* storage is not what these stories are about */
	}
	/*
	 * The column order is persisted the same way, so every story states it and
	 * clears it otherwise: a stored order leaking into the next board story
	 * would make its frame a picture of the previous story's drag.
	 * `writeBoardColumnOrder` is the page's own guarded writer, so the story
	 * and the app cannot drift on the key.
	 */
	writeBoardColumnOrder(state.columnOrder ?? []);
	/*
	 * The board's window is persisted the same way, so every story states it or
	 * clears it: a 24h story leaking into the next story's default-7d frame is
	 * the same defect the view and the order above guard against. The clear
	 * goes through the model's own key, so a rename cannot leave a stowaway.
	 */
	if (state.window) {
		writeBoardWindow(state.window);
	} else {
		try {
			localStorage.removeItem(PROJECTS_BOARD_WINDOW_STORAGE_KEY);
		} catch {
			/* storage is not what these stories are about */
		}
	}
	/*
	 * The sort is persisted the same way (U2: an explicit column sort persists
	 * across a view switch), so every story states one or clears it: a stored
	 * sort leaking into the next story would order its rows by the previous
	 * story's column — the same defect the view, the order and the window
	 * guard against.
	 */
	writeProjectsSort(state.sort ?? null);
	/*
	 * `h-screen`, the schedules page's rule: in the app this page is a full-height
	 * column, and a story without the height photographs a panel hugging its own
	 * content instead of the panel the app draws.
	 */
	return (
		<div className="h-screen">
			<ProjectsPage nowMs={FIXTURE_NOW_MS} />
		</div>
	);
};

/** Empty: no project anywhere on this machine. */
export const Empty: Story = { render: () => page({ view: "list" }) };

/** Loading: the header stays, so nothing jumps when the rows arrive. */
export const Loading: Story = {
	render: () => (
		<>
			<HoldUntilPresent text="Loading projects" />
			{page({ view: "list", hang: true })}
		</>
	),
};

/** The listing read failed: what happened, and a way back. */
export const LoadError: Story = {
	render: () => (
		<>
			<HoldUntilPresent text="The backend did not answer." />
			{page({ view: "list", failList: "The backend did not answer." })}
		</>
	),
};

/** Three projects: the list's ordinary shape. */
export const Populated: Story = {
	render: () => page({ view: "list", projects: THREE }),
	play: playOnce("populated-band", async () => {
		await bandsReady();
		assertTeamBand("[data-project-team]", "Platform Delivery", "platform");
	}),
};

/**
 * THE DEFAULT VIEW'S FRAME (design item 3, as amended): nothing stored, so the
 * page derives its default — the Board — and this is the only story that
 * states NO view on purpose, which is what makes the derivation visible here
 * and nowhere else. The flip is scoped to a NEVER-CHOSEN value: a reader who
 * picked List or Timeline keeps it, and the stored key's format is unchanged,
 * so no migration runs.
 */
export const DefaultBoard: Story = { render: () => page({ projects: THREE }) };

/**
 * The same listing at the width the 800x600 window floor leaves the list once
 * the rail is open (~33rem of container), where the container queries shed
 * `target`/`estimate` and then `milestones`/`live` (design round 1, D6: the shed
 * was structurally guaranteed but never photographed). This story renders the
 * page alone, so the capture is taken at the window width that leaves the same
 * container — see the entry's own comment in `capture-evidence.mjs`. The rows
 * and the header run the same COLUMNS plan, so this frame is the alignment
 * proof as well as the width proof.
 */
export const NarrowColumns: Story = {
	render: () => page({ view: "list", projects: THREE }),
	play: playOnce("narrow-columns-band", async () => {
		await bandsReady();
		assertTeamBand("[data-project-team]", "Platform Delivery", "platform");
	}),
};

/**
 * U7's fix, measured rather than described: at this width the count is SHED
 * (it is the one item that appears on the first keystroke), so typing cannot
 * wrap the switcher row or move the list — the same invariance U1 holds at
 * wide widths, held at the narrow end where `flex-wrap` used to break it. The
 * play takes both readings around the keystroke — the switcher row's height
 * and the list's top — and fails on any move; it also asserts the shed itself,
 * because a count that stayed visible here is the shape the bug returns in.
 */
export const NarrowSearchActive: Story = {
	render: () => page({ view: "list", projects: MANY }),
	play: playOnce("narrow-search-active", async () => {
		await poll(
			() =>
				document.querySelector('input[aria-label="Search projects"]') !== null,
			"the search field",
		);
		const row = () => document.querySelector("[data-project-search-row]");
		const list = () => document.querySelector('[data-testid="project-list"]');
		const before = {
			row: row()?.getBoundingClientRect().height ?? 0,
			top: list()?.getBoundingClientRect().top ?? 0,
		};
		await userEvent.type(
			need<HTMLInputElement>('input[aria-label="Search projects"]'),
			"migration",
		);
		await poll(
			() => document.querySelectorAll("[data-project-name]").length < 12,
			"the rows to narrow to the matches",
		);
		const count = document.querySelector<HTMLElement>("[data-project-count]");
		if (count !== null && getComputedStyle(count).display !== "none") {
			throw new Error("the count did not shed at this width");
		}
		const after = {
			row: row()?.getBoundingClientRect().height ?? 0,
			top: list()?.getBoundingClientRect().top ?? 0,
		};
		if (Math.abs(before.row - after.row) > 0.5) {
			throw new Error(
				`the switcher row moved on the first keystroke: ${before.row}px -> ${after.row}px`,
			);
		}
		if (Math.abs(before.top - after.top) > 0.5) {
			throw new Error(
				`the list top moved on the first keystroke: ${before.top}px -> ${after.top}px`,
			);
		}
	}),
};

/** Twelve projects: the list under a scrollbar. */
export const Many: Story = {
	render: () => page({ view: "list", projects: MANY }),
	play: playOnce("many-band", async () => {
		await bandsReady();
		assertTeamBand("[data-project-team]", "Platform Delivery", "platform");
	}),
};

/**
 * The search row at rest (U1's state 0): field, Filters with no count, no
 * chips row, no result line — the before half of the no-new-row claim. The
 * pair with `SearchActive` is the frame evidence that the first keystroke
 * changes nothing about the row's height.
 */
export const SearchIdle: Story = {
	render: () => page({ view: "list", projects: MANY }),
};

/**
 * The same row with a query in it (state 1): the result line appears in the
 * switcher row's right cluster (`10 of 12 projects`), the rows narrow to the
 * matches in relevance order, and still no chips row — nothing facet-shaped
 * is set. Compare with `SearchIdle` for the no-new-row claim.
 */
export const SearchActive: Story = {
	render: () => page({ view: "list", projects: MANY }),
	play: playOnce("search-active", async () => {
		/* The field mounts with the page; a play that types into a missing
		 * node reads as a broken story rather than a slow boot. */
		await poll(
			() =>
				document.querySelector('input[aria-label="Search projects"]') !== null,
			"the search field",
		);
		await userEvent.type(
			need<HTMLInputElement>('input[aria-label="Search projects"]'),
			"migration",
		);
		await poll(
			() => document.querySelector("[data-project-count]") !== null,
			"the result count to appear",
		);
	}),
};

/**
 * The Filters popover complete (the toolbar entry point): all nine facets.
 *
 * The play then pins U12's focus handoff, the fact a still cannot show: it
 * sets a facet so the header's Clear all exists, presses it, and fails unless
 * the popover CLOSES with focus landed on the search field (the pre-fix code
 * left the popover open with focus on `<body>`). It re-opens the popover so
 * the frame is still the open panel.
 */
export const FiltersOpen: Story = {
	render: () => page({ view: "list", projects: MANY }),
	play: playOnce("filters-open", async () => {
		await clickWhen("[data-project-filters-button]");
		await poll(
			() => document.querySelector('[role="dialog"]') !== null,
			"the Filters popover to open",
		);
		/* U12's pin, first half: give the popover header something to clear. */
		const option = [
			...document.querySelectorAll<HTMLElement>('[role="dialog"] label'),
		].find((node) => node.textContent?.trim().startsWith("Active"));
		if (!option) throw new Error("the Active option is absent");
		option.click();
		await poll(
			() => document.querySelector("[data-project-chip]") !== null,
			"the chip for the Active facet",
		);
		const headerClear = [
			...document.querySelectorAll<HTMLElement>('[role="dialog"] button'),
		].find((node) => node.textContent?.trim() === "Clear all");
		if (!headerClear) {
			throw new Error("the popover header's Clear all is absent");
		}
		headerClear.click();
		/* U12's pin, second half: the popover closes, the facet clears, and the
		 * handoff lands focus on the search field - each of the three fails on
		 * the code this pin was born against. */
		await poll(
			() => document.querySelector('[role="dialog"]') === null,
			"the popover to close on the header Clear all",
		);
		await poll(
			() => document.querySelectorAll("[data-project-chip]").length === 0,
			"the facet to clear",
		);
		await poll(
			() =>
				document.activeElement?.getAttribute("aria-label") ===
				"Search projects",
			"focus to land on the search field",
		);
		/* Re-open for the frame: the panel with its nine facets, none selected. */
		await clickWhen("[data-project-filters-button]");
		await poll(
			() => document.querySelector('[role="dialog"]') !== null,
			"the Filters popover to re-open",
		);
	}),
};

/**
 * The chips row (state 2): a facet is on, so one chip per facet plus Clear all
 * appears BELOW the switcher row while the result line lives in the row above
 * — the U1 split, photographed in its on state.
 */
export const FilterChips: Story = {
	render: () => page({ view: "list", projects: MANY }),
	play: playOnce("filter-chips", async () => {
		await clickWhen("[data-project-filters-button]");
		await poll(
			() =>
				[...document.querySelectorAll('[role="dialog"] label')].some((node) =>
					node.textContent?.trim().startsWith("Active"),
				),
			"the Active option",
		);
		const option = [
			...document.querySelectorAll<HTMLElement>('[role="dialog"] label'),
		].find((node) => node.textContent?.trim().startsWith("Active"));
		option?.click();
		await userEvent.keyboard("{Escape}");
		await poll(
			() => document.querySelector("[data-project-chip]") !== null,
			"the chip row to appear",
		);
	}),
};

/**
 * D2a's composition, pinned in pixels and in order: a FACET chip and the SORT
 * chip TOGETHER — the chips row's documented shape (`FACET_ORDER`'s chips
 * first, the sort pushed last, one `flex flex-wrap` container). The play reads
 * the rendered order rather than the source's: `Status · Active` first,
 * `Sort: Status` after it.
 */
export const FilterAndSortChips: Story = {
	render: () =>
		page({
			view: "list",
			projects: MANY,
			sort: { key: "status", direction: "asc" },
		}),
	play: playOnce("filter-and-sort-chips", async () => {
		await clickWhen("[data-project-filters-button]");
		await poll(
			() =>
				[...document.querySelectorAll('[role="dialog"] label')].some((node) =>
					node.textContent?.trim().startsWith("Active"),
				),
			"the Active option",
		);
		const option = [
			...document.querySelectorAll<HTMLElement>('[role="dialog"] label'),
		].find((node) => node.textContent?.trim().startsWith("Active"));
		option?.click();
		await userEvent.keyboard("{Escape}");
		await poll(
			() => document.querySelectorAll("[data-project-chip]").length === 2,
			"the facet chip and the sort chip",
		);
		const chips = [...document.querySelectorAll("[data-project-chip]")].map(
			(node) => node.textContent ?? "",
		);
		if (!chips[0]?.startsWith("Status · Active")) {
			throw new Error(`the facet chip is not first: ${chips[0]}`);
		}
		if (!chips[1]?.startsWith("Sort: Status")) {
			throw new Error(`the sort chip is not last: ${chips[1]}`);
		}
	}),
};

/**
 * D7's pin: `Clear all` clears the query, the facets AND the sort. The
 * play sets a facet through the popover (the story's sort is seeded by
 * its own props), presses the chips row's Clear all, and fails unless
 * every chip is gone and the Status header's `aria-sort` is back to
 * `none` — the same end state the sort chip's own removal path reaches
 * (U6), asserted here rather than argued.
 *
 * The play then pins U16 (and R10's composed sentence): a MutationObserver
 * on the page's live region records every sentence it holds, the composed
 * clear is read off that log, and the facet-only clear is made TWICE — a
 * repeat of the SAME sentence, which a region read from its mutations only
 * speaks again if the re-set before it emptied the region instead of
 * leaving the string standing. The end state is the `no chips, the strip at
 * rest` this frame exists to show.
 */
export const ClearAllClearsSort: Story = {
	render: () =>
		page({
			view: "list",
			projects: MANY,
			sort: { key: "status", direction: "asc" },
		}),
	play: playOnce("clear-all-clears-sort", async () => {
		await clickWhen("[data-project-filters-button]");
		await poll(
			() =>
				[...document.querySelectorAll('[role="dialog"] label')].some((node) =>
					node.textContent?.trim().startsWith("Active"),
				),
			"the Active option",
		);
		const option = [
			...document.querySelectorAll<HTMLElement>('[role="dialog"] label'),
		].find((node) => node.textContent?.trim().startsWith("Active"));
		option?.click();
		await userEvent.keyboard("{Escape}");
		await poll(
			() => document.querySelectorAll("[data-project-chip]").length === 2,
			"the facet chip and the sort chip",
		);
		/*
		 * THE ANNOUNCEMENT LOG (U16's pin, and R10's composed sentence): a
		 * MutationObserver records every non-empty sentence the page's live
		 * region holds from here on — assertions about what was SPOKEN are read
		 * off the log rather than off the region "now", because the region is
		 * emptied by design (a dwell) and a play reading it late would race its
		 * own clock.
		 */
		const region = document.querySelector("[data-project-announcement]");
		if (!region) throw new Error("the announcement region is absent");
		const spoken: string[] = [];
		const observer = new MutationObserver(() => {
			const text = (region.textContent ?? "").trim();
			if (text !== "") spoken.push(text);
		});
		observer.observe(region, {
			childList: true,
			characterData: true,
			subtree: true,
		});
		const clearAllButton = () =>
			[...document.querySelectorAll<HTMLElement>("button")].find(
				(node) => node.textContent?.trim() === "Clear all",
			);
		const clear = clearAllButton();
		if (!clear) throw new Error("the chips row's Clear all is absent");
		clear.click();
		await poll(
			() => document.querySelectorAll("[data-project-chip]").length === 0,
			"every chip to clear",
		);
		const header = document.querySelector('[data-project-column="status"]');
		if (header?.closest("th")?.getAttribute("aria-sort") !== "none") {
			throw new Error(
				`Clear all left the sort standing: aria-sort=${header?.closest("th")?.getAttribute("aria-sort")}`,
			);
		}
		/* R10's composed sentence, capitalised (U17): the first clear named the
		 * facet AND the sort, in the doors' own order. */
		await poll(
			() => spoken.includes("Filters and sort cleared."),
			"the composed clear sentence",
		);
		/* U16's pin: the same clear, twice. Each round re-sets the facet - an
		 * action that is not itself announced, so it supersedes the standing
		 * sentence (polled empty below) - and then clears again. The second
		 * `Filters cleared.` only reaches the log if the repeat SPEAKS: the
		 * string it would otherwise re-set is the one already standing, and a
		 * region read from its mutations has nothing to read. */
		for (let round = 0; round < 2; round++) {
			await clickWhen("[data-project-filters-button]");
			await poll(
				() =>
					[...document.querySelectorAll('[role="dialog"] label')].some((node) =>
						node.textContent?.trim().startsWith("Active"),
					),
				"the Active option",
			);
			const setActive = [
				...document.querySelectorAll<HTMLElement>('[role="dialog"] label'),
			].find((node) => node.textContent?.trim().startsWith("Active"));
			if (!setActive) throw new Error("the Active option is absent");
			setActive.click();
			await userEvent.keyboard("{Escape}");
			await poll(
				() => document.querySelectorAll("[data-project-chip]").length === 1,
				"the facet chip",
			);
			await poll(
				() => (region.textContent ?? "").trim() === "",
				"the standing sentence to empty as the re-set supersedes it",
			);
			const again = clearAllButton();
			if (!again) throw new Error("the chips row's Clear all is absent");
			again.click();
			await poll(
				() => document.querySelectorAll("[data-project-chip]").length === 0,
				"every chip to clear",
			);
			await poll(
				() =>
					spoken.filter((line) => line === "Filters cleared.").length >=
					round + 1,
				round === 0
					? "the first facet-only clear"
					: "the REPEAT to speak again",
			);
		}
	}),
};

/**
 * A stored column sort, at rest: the strip's Status header carries the
 * direction glyph and `aria-sort`, and the sort chip names it — the U6 door
 * that stays reachable when the column itself has been shed.
 */
export const SortedStatus: Story = {
	render: () =>
		page({
			view: "list",
			projects: MANY,
			sort: { key: "status", direction: "asc" },
		}),
};

/**
 * Nulls last, asserted as the rendered order rather than argued: one team's
 * section with the Estimate sort DESCENDING, so the whole list is a single
 * sequence — the three rows that carry an estimate lead, in the descending
 * (unit, value) order, and the two that do not sit after them. The play reads
 * the DOM's own row order and fails the story on any other sequence; the
 * ascending half of the same rule is pinned by `scripts/projects-sort.test.mjs`
 * where it costs nothing to run both directions.
 */
export const SortedNullsLast: Story = {
	render: () => {
		const team = "platform";
		const rows = [
			project("e1", "estimate-three", { team, estimate: 3 }),
			project("e2", "estimate-eight", { team, estimate: 8 }),
			project("e3", "estimate-five-days", {
				team,
				estimate: 5,
				estimate_unit: "days",
			}),
			project("n1", "no-estimate-one", { team, estimate: null }),
			project("n2", "no-estimate-two", { team, estimate: null }),
		];
		return page({
			view: "list",
			projects: rows,
			sort: { key: "estimate", direction: "desc" },
		});
	},
	play: playOnce("sorted-nulls-last", async () => {
		const rows = () =>
			[...document.querySelectorAll("[data-project-name]")].map((node) =>
				node.getAttribute("data-project-name"),
			);
		await poll(() => rows().length === 5, "the five rows");
		const expected = [
			"estimate-five-days",
			"estimate-eight",
			"estimate-three",
			"no-estimate-one",
			"no-estimate-two",
		];
		await poll(
			() => rows().join(",") === expected.join(","),
			"the descending (unit, value) order with the nulls last",
		);
		if (rows().join(",") !== expected.join(",")) {
			throw new Error(`the sort landed as: ${rows().join(",")}`);
		}
	}),
};

/**
 * D2b's composition: a sort whose column has been SHED by the narrow width —
 * U6's whole reason for existing. At this width the strip hides Target and
 * Estimate (the container's own shed), so the header itself is unreachable;
 * the sort chip is the only door, and the play asserts both halves: the shed
 * column's button has no layout box, and the chip names the sort it cannot
 * otherwise show.
 */
export const SortedShedColumn: Story = {
	render: () =>
		page({
			view: "list",
			projects: MANY,
			sort: { key: "estimate", direction: "desc" },
		}),
	play: playOnce("sorted-shed-column", async () => {
		await poll(
			() => document.querySelector("[data-project-chip]") !== null,
			"the sort chip",
		);
		const header = document.querySelector<HTMLElement>(
			'[data-project-column="estimate"]',
		);
		if (header === null) {
			throw new Error("the estimate header did not render");
		}
		if (header.offsetParent !== null) {
			throw new Error("the estimate column did not shed at this width");
		}
		const chip = document.querySelector("[data-project-chip]");
		if (!chip?.textContent?.startsWith("Sort: Estimate")) {
			throw new Error(
				`the shed column's chip does not name it: ${chip?.textContent}`,
			);
		}
	}),
};

/**
 * A column's scoped menu, open (the second entry point of the one panel):
 * `Target`'s sort actions above Target's facet options, with the counts the
 * panel derives and the `Default (as listed)` way back to the store's order.
 * The play then takes the sort radio and asserts the LANDING rather than
 * describing it: a date column's first direction is descending (the ux round's
 * folded NIT), so `aria-sort` must read `descending` on the Target header and
 * the sort chip must be present — with the menu still open, which is the
 * frame.
 */
export const ColumnMenuOpen: Story = {
	render: () => page({ view: "list", projects: MANY }),
	play: playOnce("column-menu-open", async () => {
		await clickWhen('[data-project-column="target"]');
		await poll(
			() => document.querySelector('[role="dialog"]') !== null,
			"the column menu to open",
		);
		/* The sort item's own label TH states the direction a press applies. */
		await poll(
			() =>
				[...document.querySelectorAll('[role="dialog"] label')].some((node) =>
					node.textContent?.includes("Sort by Target, latest first"),
				),
			"the Target sort radio",
		);
		const sortItem = [
			...document.querySelectorAll<HTMLElement>('[role="dialog"] label'),
		].find((node) =>
			node.textContent?.includes("Sort by Target, latest first"),
		);
		sortItem?.click();
		await poll(
			() =>
				document
					.querySelector('[data-project-column="target"]')
					?.closest("th")
					?.getAttribute("aria-sort") === "descending",
			"the Target header to report descending",
		);
		await poll(
			() =>
				[...document.querySelectorAll("[data-project-chip]")].some((node) =>
					node.textContent?.startsWith("Sort: Target"),
				),
			"the sort chip",
		);
		/* U11's pin: the flip must be reachable from the KEYS. The checked
		 * radio's own press is the flip, and Space/Enter on a checked radio
		 * fire no click - the fix states the key path on the input. The play
		 * flips twice so the frame's end state (Target, descending, menu
		 * open) is unchanged, and both intermediate polls fail on the code
		 * this pin was born against. */
		const checked = [
			...document.querySelectorAll<HTMLInputElement>(
				'[role="dialog"] input[type="radio"]',
			),
		].find(
			(node) =>
				node.checked &&
				node.closest("label")?.textContent?.includes("Sort by Target"),
		);
		if (!checked) throw new Error("the checked Target sort radio is absent");
		checked.focus();
		await userEvent.keyboard(" ");
		await poll(
			() =>
				document
					.querySelector('[data-project-column="target"]')
					?.closest("th")
					?.getAttribute("aria-sort") === "ascending",
			"the keyboard flip to ascending",
		);
		await userEvent.keyboard("{Enter}");
		await poll(
			() =>
				document
					.querySelector('[data-project-column="target"]')
					?.closest("th")
					?.getAttribute("aria-sort") === "descending",
			"the keyboard flip back to descending",
		);
	}),
};

/**
 * The no-match block: with a search on and zero matches it REPLACES the view
 * (here the List), the field stays above it, and the subline names what a v1
 * query does and does not read — so a word that lives in an update is not
 * mistaken for a project that does not exist.
 *
 * The play walks the block's OTHER door and back (agent review round 7, R10;
 * design round 4, D10): it clears the query, sets the pair of facets whose
 * intersection is empty, and checks the FILTER-only variant — its own heading
 * and recovery sentence, and exactly ONE Clear all on screen. U14's count is
 * the one the chips row cannot pass: with the block up the row keeps its
 * chips and hides its copy, where the screen this pin was born against held
 * two identically labelled buttons. The walk restores the query state so the
 * frame is the variant the directory has always shown.
 */
export const NoMatch: Story = {
	render: () => page({ view: "list", projects: MANY }),
	play: playOnce("no-match", async () => {
		await poll(
			() =>
				document.querySelector('input[aria-label="Search projects"]') !== null,
			"the search field",
		);
		await userEvent.type(
			need<HTMLInputElement>('input[aria-label="Search projects"]'),
			"zzznothing",
		);
		await poll(
			() => (document.body.textContent ?? "").includes("No projects match"),
			"the no-match sentence",
		);
		/* U13's pin: the query case keeps the search facts without the
		 * roadmap word, and the recovery sentence stays (fails on the copy
		 * this pin was born against, which said \"is not searched yet\"). */
		await poll(() => {
			const text = document.body.textContent ?? "";
			return (
				text.includes("Update text is not searched.") &&
				text.includes("Clearing the search and filters restores the list.")
			);
		}, "the search disclaimer and the recovery sentence");
		/* R10/U14's count, query side: the field's own clear is the exit, so
		 * the block carries the only Clear all. */
		const clearAlls = () =>
			[...document.querySelectorAll<HTMLElement>("button")].filter(
				(node) => node.textContent?.trim() === "Clear all",
			);
		await poll(
			() => clearAlls().length === 1,
			"exactly one Clear all in the query no-match state",
		);
		/* D10's walk, door one: clear the query, leaving the list in charge. */
		const bodyClear = clearAlls()[0];
		if (!bodyClear) throw new Error("the block's Clear all is absent");
		bodyClear.click();
		await poll(
			() => !(document.body.textContent ?? "").includes("No projects match"),
			"the block to retire on its own Clear all",
		);
		/* Door two: the facet pair whose intersection is empty (Done rows have no
		 * live sessions), with no query typed — the variant nothing showed. */
		await clickWhen("[data-project-filters-button]");
		await poll(
			() =>
				[...document.querySelectorAll('[role="dialog"] label')].some((node) =>
					node.textContent?.trim().startsWith("Done"),
				),
			"the Done option",
		);
		for (const [index, label] of ["Done", "Has live sessions"].entries()) {
			const option = [
				...document.querySelectorAll<HTMLElement>('[role="dialog"] label'),
			].find((node) => node.textContent?.trim().startsWith(label));
			if (!option) throw new Error(`the ${label} option is absent`);
			option.click();
			/* ONE faceted click per commit: the panel's `onToggle` closes over
			 * the filters of ITS render, so two clicks in one tick write the
			 * second state from the first's absence (this walk measured exactly
			 * that - the pair collapsed to the live facet alone). Waiting for
			 * the chip commits the first press before the second, which is the
			 * pace a reader's own hands give for free. */
			await poll(
				() =>
					document.querySelectorAll("[data-project-chip]").length === index + 1,
				`the ${label} chip`,
			);
		}
		await userEvent.keyboard("{Escape}");
		/* The filter-only heading names no query, and U14's count is what
		 * discriminates — two buttons stood here before the fix. */
		await poll(() => {
			const text = document.body.textContent ?? "";
			return (
				text.includes("No projects match.") &&
				text.includes("Try removing a filter.") &&
				text.includes("Clearing the filters restores the list.")
			);
		}, "the filter-only heading and recovery sentence");
		await poll(
			() => clearAlls().length === 1,
			"exactly one Clear all in the filter-only no-match state",
		);
		/* Restore the query variant the frame exists for. */
		const restoreClear = clearAlls()[0];
		if (!restoreClear) throw new Error("the block's Clear all is absent");
		restoreClear.click();
		await poll(
			() => !(document.body.textContent ?? "").includes("No projects match"),
			"the block to retire",
		);
		await userEvent.type(
			need<HTMLInputElement>('input[aria-label="Search projects"]'),
			"zzznothing",
		);
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					'No projects match "zzznothing".',
				),
			"the query no-match state to return",
		);
	}),
};

/**
 * D10's frame: the FILTER-only no-match state, held for the shutter (design
 * round 4; agent review round 7's R10 added the pin this state lacked).
 *
 * `NoMatch`'s walk passes through this state and deliberately restores the
 * query variant before returning - that directory has always shown the query
 * case - so the state the filter door produces had no frame of its own. This
 * story is the same walk with the restoration dropped: the pair whose
 * intersection is empty, no query typed, the block's filter-only heading and
 * recovery sentence on screen. The assertions are the ones that discriminate
 * the variant (the heading names no query; the sentence names filters; exactly
 * one Clear all, U14's count, which the chip row cannot pass).
 */
export const NoMatchFilter: Story = {
	render: () => page({ view: "list", projects: MANY }),
	play: playOnce("no-match-filter", async () => {
		await poll(
			() =>
				document.querySelector('input[aria-label="Search projects"]') !== null,
			"the search field",
		);
		await clickWhen("[data-project-filters-button]");
		await poll(
			() =>
				[...document.querySelectorAll('[role="dialog"] label')].some((node) =>
					node.textContent?.trim().startsWith("Done"),
				),
			"the Done option",
		);
		for (const [index, label] of ["Done", "Has live sessions"].entries()) {
			const option = [
				...document.querySelectorAll<HTMLElement>('[role="dialog"] label'),
			].find((node) => node.textContent?.trim().startsWith(label));
			if (!option) throw new Error(`the ${label} option is absent`);
			option.click();
			/* ONE faceted click per commit, the pace `NoMatch`'s walk measured:
			 * the panel's `onToggle` closes over the filters of ITS render. */
			await poll(
				() =>
					document.querySelectorAll("[data-project-chip]").length === index + 1,
				`the ${label} chip`,
			);
		}
		await userEvent.keyboard("{Escape}");
		await poll(() => {
			const text = document.body.textContent ?? "";
			return (
				text.includes("No projects match.") &&
				text.includes("Try removing a filter.") &&
				text.includes("Clearing the filters restores the list.")
			);
		}, "the filter-only heading and recovery sentence");
		await poll(
			() =>
				[...document.querySelectorAll<HTMLElement>("button")].filter(
					(node) => node.textContent?.trim() === "Clear all",
				).length === 1,
			"exactly one Clear all in the filter-only no-match state",
		);
	}),
};

/**
 * The two rows the search-index stories are photographed on — and the PAIR is
 * the point of the whole slice.
 *
 * `invoice-run` carries the query word in its own fields, so the CLIENT matcher
 * finds it. `billing-cutover` says nothing about an invoice anywhere the listing
 * carries, and the index finds it because its UPDATE text does — the field that
 * is detail-only on the wire and the largest slice of the store, which is the
 * reason a renderer-side matcher could never find it. One query, two engines,
 * two answers: the index's answer names both, in the index's order.
 */
const SEARCH_ROWS: DesktopProject[] = [
	project("s1", "invoice-run", {
		description: "Nightly invoice run",
		team: "platform",
		status: "active",
		updated_at: FIXTURE_NOW_MS / 1000 - 2 * HOUR_S,
	}),
	project("s2", "billing-cutover", {
		description: "Move the billing cutover to the new gate",
		team: "atlas",
		status: "planning",
		updated_at: FIXTURE_NOW_MS / 1000 - 5 * DAY_S,
	}),
];

/** The query ONE engine can answer: only the index knows the cutover's updates
 * say "invoice". */
const SEARCH_QUERY = "invoice";
/** A query NEITHER engine can answer. */
const SEARCH_NOTHING = "zzznothing";

/** The List's rows in RENDERED order, by key — the page's own `data-project-name`
 * hook, read rather than re-derived: an assertion about rank order has to read
 * the order the reader sees. */
const listRowKeys = () =>
	[...document.querySelectorAll<HTMLElement>("[data-project-name]")].map(
		(node) => node.getAttribute("data-project-name") ?? "",
	);

/** Type a query into the page's own field, once it exists. */
const typeSearch = async (text: string) => {
	await poll(
		() =>
			document.querySelector('input[aria-label="Search projects"]') !== null,
		"the search field",
	);
	await userEvent.type(
		need<HTMLInputElement>('input[aria-label="Search projects"]'),
		text,
	);
};

/**
 * The index SERVES: the page paints the backend's own answer — its membership
 * and its rank order, neither of which the local matcher could produce. The row
 * that discriminates is `billing-cutover`, whose match lives in update text; the
 * poll for it IS the poll for the index having served. The order claim is read
 * off the rendered rows rather than asserted against the fixture, because an
 * answer that arrived and was re-sorted locally would pass a membership check.
 */
export const SearchIndexServed: Story = {
	render: () =>
		page({
			view: "list",
			projects: SEARCH_ROWS,
			searchIndex: { ids: ["s2", "s1"] },
		}),
	play: playOnce("search-index-served", async () => {
		await typeSearch(SEARCH_QUERY);
		await poll(
			() => listRowKeys().includes("billing-cutover"),
			"the index's own hit (a row the local matcher cannot admit)",
		);
		const keys = listRowKeys();
		if (keys.join(",") !== "billing-cutover,invoice-run") {
			throw new Error(
				`the answer's rank order was not painted: ${keys.join(",")}`,
			);
		}
	}),
};

/**
 * The index is OWED an answer, and the fallback engine's row is still drawn:
 * the no-blank-list claim, photographed mid-flight. A page that showed nothing
 * until the index answered would fail the row poll; a page that painted "nothing
 * matches" would fail the second check.
 */
export const SearchIndexPending: Story = {
	render: () =>
		page({
			view: "list",
			projects: SEARCH_ROWS,
			searchIndex: { ids: [], hang: true },
		}),
	play: playOnce("search-index-pending", async () => {
		await typeSearch(SEARCH_QUERY);
		await poll(
			() => listRowKeys().includes("invoice-run"),
			"the fallback engine's row while the index is owed an answer",
		);
		if ((document.body.textContent ?? "").includes("No projects match")) {
			throw new Error(
				"the no-match block claimed a result the index has not answered for",
			);
		}
	}),
};

/**
 * The one state where the index is owed an answer AND the fallback found
 * nothing: the quiet in-flight line, in place of a "nothing matches" the index
 * may be about to contradict. Both polls discriminate — the first fails on a
 * page that shows the no-match block here, the second on one that shows nothing
 * at all.
 */
export const SearchIndexSearching: Story = {
	render: () =>
		page({
			view: "list",
			projects: SEARCH_ROWS,
			searchIndex: { ids: [], hang: true },
		}),
	play: playOnce("search-index-searching", async () => {
		await typeSearch(SEARCH_NOTHING);
		await poll(
			() => (document.body.textContent ?? "").includes("Searching"),
			"the in-flight line",
		);
		if ((document.body.textContent ?? "").includes("No projects match")) {
			throw new Error(
				'"nothing matches" was claimed before the index answered',
			);
		}
		/*
		 * AND THE BODY IS THE LINE ALONE (design round 1, D1; the assertion corrected
		 * in round 3's F2). The claim is that the List is not standing beside this
		 * block, and the first version of this line — "zero row keys" — did NOT test
		 * it: the defect frame had zero rows too, because the defect was a header over
		 * an empty body, so the assertion passed on the very frame it was written to
		 * exclude. What discriminates is the PANEL's absence, which is what the gate's
		 * term actually removes; the geometry is the designer's row-profile
		 * measurement (192-200 against 552-562), not this line.
		 */
		await poll(
			() => document.querySelector('[data-testid="project-list"]') === null,
			"no List panel beside the in-flight line",
		);
	}),
};

/**
 * THE SAME STATE IN THE THIRD VIEW (design round 2, D5, and D4's frame): the
 * in-flight block stands in the Timeline's place too, and the Timeline's panel is
 * the arrangement D1's diagnosis names one view over. The commit that fixed the
 * List left this gate without the term, so the state drew that panel beside the
 * block and its `shrink-0` strip landed where the List's header used to.
 *
 * The assertion is the discriminating one — the PANEL's absence rather than an
 * empty row list, for F2's reason above — so this play fails on the defect the
 * frame exists to disprove, and it is what makes the pair evidence rather than a
 * picture of a claim.
 */
export const SearchIndexSearchingTimeline: Story = {
	render: () =>
		page({
			view: "timeline",
			projects: SEARCH_ROWS,
			searchIndex: { ids: [], hang: true },
		}),
	play: playOnce("search-index-searching-timeline", async () => {
		await typeSearch(SEARCH_NOTHING);
		await poll(
			() => (document.body.textContent ?? "").includes("Searching"),
			"the in-flight line in the Timeline view",
		);
		if ((document.body.textContent ?? "").includes("No projects match")) {
			throw new Error(
				'"nothing matches" was claimed before the index answered',
			);
		}
		await poll(
			() => document.querySelector('[data-testid="project-timeline"]') === null,
			"no Timeline panel beside the in-flight line",
		);
	}),
};

/**
 * The copy this slice reconciled, on the engine that made it false: the index
 * answered zero, and the block carries the INDEX's sentence. The second poll
 * fails on the string this slice replaced ("Update text is not searched"), which
 * is exactly the frame the designer round has to look at.
 */
export const SearchIndexNoMatch: Story = {
	render: () =>
		page({ view: "list", projects: SEARCH_ROWS, searchIndex: { ids: [] } }),
	play: playOnce("search-index-no-match", async () => {
		await typeSearch(SEARCH_NOTHING);
		await poll(
			() => (document.body.textContent ?? "").includes("No projects match"),
			"the no-match sentence",
		);
		await poll(() => {
			const text = document.body.textContent ?? "";
			return (
				text.includes(
					"Searches names, descriptions, tags, owners, teams and update text.",
				) && !text.includes("Update text is not searched.")
			);
		}, "the index's subline, and no claim the index cannot make");
	}),
};

/**
 * The FAILURE arm: the index is broken, the fallback serves, and the sentence is
 * the client matcher's again — which is the whole reason the copy is per engine
 * rather than one string chosen at build time. A page that kept the index's
 * sentence here would be claiming a search it did not get.
 */
export const SearchIndexFailed: Story = {
	render: () =>
		page({
			view: "list",
			projects: SEARCH_ROWS,
			searchIndex: { ids: [], fail: "The index is unavailable." },
		}),
	play: playOnce("search-index-failed", async () => {
		await typeSearch(SEARCH_NOTHING);
		await poll(
			() => (document.body.textContent ?? "").includes("No projects match"),
			"the no-match sentence on the fallback",
		);
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Update text is not searched.",
				),
			"the client matcher's own subline after the index failed",
		);
	}),
};

/**
 * The sticky team headers, mid-scroll: the second section's header pinned at
 * the scroller's top with its rows passing under it and the first section's
 * header pushed out behind it — a state the resting list can never show,
 * because at rest every header sits in its own flow position.
 *
 * THE PLAY SCROLLS BY ITS OWN MEASUREMENT rather than a hard-coded offset:
 * it brings the second header flush to the scroller's top and asserts it
 * pinned there, so the frame is the pinned state whenever the row heights
 * drift or a theme's metrics differ.
 */
export const ListTeamsSticky: Story = {
	render: () => page({ view: "list", projects: MANY_LONG }),
	play: playOnce("list-teams-sticky", async () => {
		const scroller = () =>
			document.querySelector<HTMLElement>('[data-testid="project-list"] ul');
		await poll(() => {
			const element = scroller();
			return (
				element !== null && element.scrollHeight > element.clientHeight + 100
			);
		}, "the list to overflow its scroller");
		const element = scroller();
		if (!element) throw new Error("the list scroller never mounted");
		const headers = document.querySelectorAll<HTMLElement>(
			"[data-project-team]",
		);
		if (headers.length < 2) {
			throw new Error(
				`fewer than two team headers rendered (${headers.length})`,
			);
		}
		assertTeamBand("[data-project-team]", "Platform Delivery", "platform");
		const second = headers[1];
		element.scrollTop +=
			second.getBoundingClientRect().top - element.getBoundingClientRect().top;
		/*
		 * THE BOUNDED OVERSHOOT IS THE MEASUREMENT (review round 1, Q3): at the
		 * flush point a pinned header and a static one sit at the same y, so an
		 * assertion made there passes for `position: static` too — an identity,
		 * not a test. A further 25px can leave the header at the scroller's top
		 * only if it is actually sticky, and the fixture's headroom at 1280x620
		 * is 37.7px, so the overshoot stays inside the range the list has.
		 */
		element.scrollTop += 25;
		await poll(() => {
			const top =
				second.getBoundingClientRect().top -
				element.getBoundingClientRect().top;
			return top >= -1 && top <= 2;
		}, "the second header to pin past the flush point");
	}),
};

/** The one project's detail: progress, milestones in all three states, links. */
export const Detail: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("detail", async () => {
		// The DETAIL screen's own control, not the row name: the list also paints
		// `payments-migration`, so a text predicate would pass before the route
		// swap and photograph the list wearing the detail's name.
		await waitForDetail();
	}),
};

/**
 * A project nothing has happened to yet — every EMPTY state on the screen at
 * once: no description, no progress, no milestones, no links, no to-dos and no
 * history. The frame is what a just-created project looks like.
 */
const EMPTY_ROW = project("p9", "fresh-notes", {
	updated_at: FIXTURE_NOW_MS / 1000 - DAY_S,
	progress_stale: true,
});
const EMPTY_DETAIL = detailFor(EMPTY_ROW);

export const DetailEmpty: Story = {
	render: () => (
		<RouteTo path="/projects/p9">
			{page({ projects: [EMPTY_ROW], detail: EMPTY_DETAIL })}
		</RouteTo>
	),
	play: playOnce("detail-empty", async () => {
		await waitForDetail();
	}),
};

/**
 * The detail read REFUSED: the route's own 404 sentence, drawn as the screen's
 * alert. The state a deleted row's stale URL lands on.
 */
/**
 * The detail load refusal, in the app's own words (design round 1, D2): the
 * daemon's 404 names the row's absence (`no such project`) and the page maps it
 * to a crafted sentence plus the recovery the list pairs with its failures -
 * so the frame is the sentence and the `Try again`, and the play waits for
 * exactly that state (the raw passthrough this state used to assert is no
 * longer what the page draws for a 404).
 */
export const DetailLoadError: Story = {
	render: () => (
		<RouteTo path="/projects/p1">{page({ projects: THREE })}</RouteTo>
	),
	play: playOnce("detail-load-error", async () => {
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"This project could not be found.",
				) && document.querySelector("[data-project-title]") === null,
			"the detail refusal",
		);
	}),
};

/** The quick-send strip with a message typed but not sent. */
export const DetailQuickSend: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("detail-quick-send", async () => {
		await waitForDetail();
		const input = document.querySelector<HTMLInputElement>(
			'[aria-label="Message the selected session"]',
		);
		if (!input) throw new Error("the quick-send input never appeared");
		await userEvent.type(
			input,
			"Status check — reply with the current blocker.",
		);
		await poll(
			() =>
				(document.querySelector<HTMLInputElement>(
					'[aria-label="Message the selected session"]',
				)?.value.length ?? 0) > 0,
			"the typed message",
		);
	}),
};

/**
 * The same strip right after Send: the message left through the chat's own
 * admission path (the stub admits it), and the composer is empty again.
 */
export const DetailQuickSendSent: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("detail-quick-send-sent", async () => {
		await waitForDetail();
		const input = document.querySelector<HTMLInputElement>(
			'[aria-label="Message the selected session"]',
		);
		if (!input) throw new Error("the quick-send input never appeared");
		await userEvent.type(input, "Please post the next progress update.");
		await clickWhen('[data-tour-tag="project-quick-send"]');
		await poll(
			() =>
				(document.querySelector<HTMLInputElement>(
					'[aria-label="Message the selected session"]',
				)?.value.length ?? 0) === 0,
			"the admitted message to clear the composer",
		);
	}),
};

/**
 * The updates feed itself, scrolled into view: the day groups, the markdown an
 * agent writes (heading, list, inline code, fence, link) and both attachment
 * kinds — the picture through the same expandable frame the transcript uses,
 * the data file as a labelled row with its size and actions menu.
 */
export const DetailFeed: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("detail-feed", async () => {
		await waitForDetail();
		/*
		 * Scroll by the section's own heading rather than by a test-only
		 * attribute: the frame is meant to be the reader's own view, and a
		 * selector invented for the harness is one more thing the surface
		 * carries for somebody who is not the user.
		 */
		await poll(() => {
			const heading = [...document.querySelectorAll("h2")].find(
				(node) => node.textContent === "Updates",
			);
			if (!heading) return false;
			heading.scrollIntoView({ block: "start" });
			return true;
		}, "the feed heading");
		/* Let the scroll and any decode settle before the shutter lands. */
		await new Promise((resolve) => setTimeout(resolve, 400));
	}),
};

/**
 * THE LONG TITLE, whose old header ellipsised it (operator, 2026-09-30). The
 * fixture's title outruns the 800px column at the wide viewport and the page
 * width at the narrow one, and its description plus three milestones push the
 * scroller past one screen - so the same two frames carry the wrap AND the
 * scrollbar riding the view's edge rather than the column's.
 *
 * NO LONGER "NO PLAY" (review round 1, R1-2): this paragraph used to say the
 * stories carried none, which stopped being true the same afternoon - the pair
 * ships `longTitlePlay`. The two claims:
 *
 *   the PLAY asserts the header LEADS with the full title (exact
 *   `textContent`) and that it is NOT clipped (`scrollWidth` inside its box -
 *   what the retired `truncate` pushed past). It reaches the heading through
 *   `longTitleHeading`, which finds it by TEXT: this document holds storybook's
 *   hidden `sb-nopreview_heading` placeholder and the shell's own "Projects"
 *   header above this screen's, so a bare `querySelector("h1")` reads a
 *   different element and a poll against it waits out the rig's whole budget
 *   (measured: the frame was never taken).
 *
 *   the CAPTURE ENTRY's `expectSentence` refuses a frame whose rendered text
 *   does not carry the title at all, scoped by the header's own
 *   `data-project-title`.
 */
const LONG_TITLE =
	"Payments migration onto the new reconciliation service and the ledger split";
const LONG_TITLE_ROW = project("p7", "payments-migration-v2", {
	title: LONG_TITLE,
	description:
		"Cut the payments API over to the new service and split the ledger reads.\n\n**Scope**\n\n- the read path (staging first)\n- the dashboard\n- the retry budget\n- the reconciliation worker\n- the ledger split\n- the rollback path\n- the cutover runbook",
	owner: "atlas",
	team: "platform",
	status: "active",
	tags: ["q4", "payments"],
	start_date: "2026-09-01",
	target_date: "2026-10-15",
	estimate: 13,
	milestones_completed: 1,
	milestones_total: 3,
	progress_stale: false,
	progress_updated_at: FIXTURE_NOW_MS / 1000 - 2 * HOUR_S,
	updated_at: FIXTURE_NOW_MS / 1000 - 2 * HOUR_S,
});
const LONG_TITLE_DETAIL = detailFor(LONG_TITLE_ROW, MILESTONES.p1);

/**
 * The story's OWN header, found by text rather than by `querySelector("h1")`
 * (a measured trap): storybook keeps a HIDDEN `<h1 class="sb-nopreview_heading">`
 * first in document order until the story mounts, so a bare `h1` lookup reads
 * the placeholder - `textContent` is "No Preview", `innerText` is empty - and a
 * poll against it never settles.
 */
const longTitleHeading = () =>
	[...document.querySelectorAll("h1")].find((node) =>
		(node.textContent ?? "").startsWith("Payments migration onto"),
	);

/**
 * The play both long-title frames share: the header LEADS with the full title
 * and it is NOT clipped. A wrapping block's `scrollWidth` stays inside its box,
 * while the retired `truncate` pushed it past - so this pair is the claim's own
 * falsifier, read off the live header rather than off the source.
 */
const longTitlePlay = (label: string) =>
	playOnce(label, async () => {
		await waitForDetail();
		await poll(() => longTitleHeading() !== undefined, "the title header");
		const heading = longTitleHeading();
		if (!heading) throw new Error("the title header is missing");
		if ((heading.textContent ?? "").trim() !== LONG_TITLE) {
			throw new Error(
				`the header does not lead with the title: ${JSON.stringify(heading.textContent)}`,
			);
		}
		if (heading.scrollWidth > heading.clientWidth + 1) {
			throw new Error(
				`the title overflows its box instead of wrapping (${heading.scrollWidth} > ${heading.clientWidth})`,
			);
		}
	});

/**
 * The long title at the wide viewport: the heading leads with it, wraps it
 * whole, and the detail's scroller rides the view's edge (operator,
 * 2026-09-30).
 */
export const DetailLongTitle: Story = {
	render: () => (
		<RouteTo path="/projects/p7">
			{page({ projects: [LONG_TITLE_ROW], detail: LONG_TITLE_DETAIL })}
		</RouteTo>
	),
	play: longTitlePlay("detail-long-title"),
};

/**
 * The same frame at the window's narrow floor (800x900, the tab's own
 * minimum): the wrap needs more lines, and the state the operator's own
 * screenshot showed clipped sits in one hole.
 */
export const DetailLongTitleNarrow: Story = {
	render: () => (
		<RouteTo path="/projects/p7">
			{page({ projects: [LONG_TITLE_ROW], detail: LONG_TITLE_DETAIL })}
		</RouteTo>
	),
	play: longTitlePlay("detail-long-title-narrow"),
};

/**
 * The start-session picker, opened from the linked-sessions header with its
 * registry list expanded (teams and agents, from the same two queries the chat
 * sidebar reads).
 */
export const StartSessionDialog: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("start-session-dialog", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-start-session"]');
		await poll(
			() =>
				document.querySelector(
					'[data-tour-tag="project-start-session-dialog"]',
				) !== null,
			"the start-session dialog",
		);
		await clickWhen(
			'[data-tour-tag="project-start-session-dialog"] [role="combobox"]',
		);
		/*
		 * The list is PORTALED to `document.body` by the popover, so it is
		 * NOT inside the dialog's tag — a scoped selector here polls forever
		 * (measured: the play sat pending and the capture timed out at 60 s
		 * with the dialog on screen). Only one combobox list is open at a time
		 * in this story.
		 */
		await poll(
			() => document.querySelector('[role="listbox"]') !== null,
			"the registry list",
		);
	}),
};

/** The create dialog, opened from the page's own button. */
export const CreateDialog: Story = {
	render: () => page({ view: "list", projects: THREE }),
	play: playOnce("create-dialog", async () => {
		await clickWhen('[data-tour-tag="create-project-button"]');
		await poll(
			() =>
				document.querySelector('[data-tour-tag="project-create-dialog"]') !==
				null,
			"the create dialog",
		);
	}),
};

/** The edit dialog, opened from the detail's own button. */
/* ------------------------------------------------------- inline field editing */

/**
 * The title field's affordance REVEALED — the keyboard half of it.
 *
 * A Storybook play cannot paint `:hover` (a synthetic pointer event does not
 * set the browser's own hover state, which is what `group-hover` resolves
 * against), so the reveal this story photographs is `focus-within`'s: the
 * pencil is focused and the frame shows what a keyboard reader sees. The
 * POINTER half is captured in the live driver scene
 * (`--scene project-inline-edit`), where CDP's input pipeline really hovers.
 */
export const InlineEditReveal: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("inline-edit-reveal", async () => {
		await waitForDetail();
		const pencil = need<HTMLElement>(
			'[data-project-field="title"] [data-inline-edit-control="begin"]',
		);
		pencil.focus();
		await poll(
			() =>
				getComputedStyle(
					need(
						'[data-project-field="title"] [data-inline-edit-control="begin"]',
					),
				).opacity === "1",
			"the revealed pencil",
		);
	}),
};

/**
 * The title field OPEN: the h1 has become its own input, the x and the check
 * sit beside it, and the resting text is gone — the frame the operator's
 * "edit is inline" is about.
 */
export const InlineEditOpen: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("inline-edit-open", async () => {
		await waitForDetail();
		await clickWhen(
			'[data-project-field="title"] [data-inline-edit-control="begin"]',
		);
		await poll(
			() =>
				document.querySelector('[data-project-field="title"] input') !== null,
			"the title editor",
		);
	}),
};

/**
 * The title field TYPED over: the draft is visible in the input and the value
 * on screen is the user's, not the record's — the state a save or a revert is
 * answered from.
 */
export const InlineEditTyped: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("inline-edit-typed", async () => {
		await waitForDetail();
		await clickWhen(
			'[data-project-field="title"] [data-inline-edit-control="begin"]',
		);
		const input = need<HTMLInputElement>('[data-project-field="title"] input');
		await userEvent.clear(input);
		await userEvent.type(input, "Payments migration II");
	}),
};

/**
 * The SAVING state, held: `hangPatch` makes `projects.update` a promise that
 * never settles, so the spinner in the check's slot is a real in-flight write
 * rather than a photographed fabrication — the same device the refusal story
 * uses for its `Saving…` arm.
 */
export const InlineEditSaving: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL, hangPatch: true })}
		</RouteTo>
	),
	play: playOnce("inline-edit-saving", async () => {
		await waitForDetail();
		await clickWhen(
			'[data-project-field="title"] [data-inline-edit-control="begin"]',
		);
		const input = need<HTMLInputElement>('[data-project-field="title"] input');
		await userEvent.clear(input);
		await userEvent.type(input, "Payments migration II");
		await clickWhen(
			'[data-project-field="title"] [data-inline-edit-control="accept"]',
		);
		await poll(
			() =>
				document.querySelector(
					'[data-project-field="title"] [data-inline-edit-slot="saving"]',
				) !== null,
			"the saving slot",
		);
	}),
};

/**
 * A save that LANDED, inside its transient window: the record value is back in
 * the read view, the acknowledgement sits beside it, and the panel's one live
 * region carries the same words (note § 2.6). The play races the 1.2s dwell on
 * purpose — a story that missed it would show the resting state and say
 * nothing about the acknowledgement existing.
 */
export const InlineEditSaved: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("inline-edit-saved", async () => {
		await waitForDetail();
		await clickWhen(
			'[data-project-field="title"] [data-inline-edit-control="begin"]',
		);
		const input = need<HTMLInputElement>('[data-project-field="title"] input');
		await userEvent.clear(input);
		await userEvent.type(input, "Payments migration II");
		input.focus();
		await userEvent.keyboard("{Enter}");
		await poll(
			() =>
				document.querySelector('[data-inline-edit-feedback="saved"]') !== null,
			"the saved acknowledgement",
		);
	}),
};

/**
 * A refused save HELD beside the field: the Key row renames to a name the
 * daemon already holds, the stub answers the wire's own 409 envelope
 * (`project_name_exists`), and the field keeps the attempted value with the
 * app's crafted sentence under it and the check re-attempting / x reverting
 * in the slot. The frame is the refusal being IN the field rather than a
 * banner somewhere else — the #704 rule this editor was built to.
 */
export const InlineEditRefused: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({
				projects: THREE,
				detail: DETAIL,
				failPatch: "project 'invoices-rework' already exists",
				failPatchStatus: 409,
				failPatchCode: "project_name_exists",
			})}
		</RouteTo>
	),
	play: playOnce("inline-edit-refused", async () => {
		await waitForDetail();
		await clickWhen(
			'[data-project-field="key"] [data-inline-edit-control="begin"]',
		);
		const input = need<HTMLInputElement>('[data-project-field="key"] input');
		await userEvent.clear(input);
		await userEvent.type(input, "invoices-rework");
		await clickWhen(
			'[data-project-field="key"] [data-inline-edit-control="accept"]',
		);
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"A project with this key already exists.",
				),
			"the in-field refusal",
		);
	}),
};

/**
 * THE ONE THAT MUST NEVER CLOBBER: a Start date is half-typed, the record
 * moves out-of-band (the play mutates the fixture exactly as another window
 * would have written it), and the app's own focus-refetch path delivers the
 * new record while the draft is dirty. The commit is HELD and the choice row
 * is on screen. The wait is the query's own `staleTime` (10s) — a focus
 * refetch only notices a STALE query, and the play waits it out rather than
 * faking the delivery.
 */
export const InlineEditConflict: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("inline-edit-conflict", async () => {
		await waitForDetail();
		await clickWhen(
			'[data-project-field="start"] [data-inline-edit-control="begin"]',
		);
		const input = need<HTMLInputElement>('[data-project-field="start"] input');
		await userEvent.clear(input);
		await userEvent.type(input, "2026-09-05");
		/* The out-of-band write, from the play's own hands. */
		if (stub.detail) stub.detail.project.start_date = "2026-09-03";
		/*
		 * THE DELIVERY IS A FOCUS TRANSITION, not a focus event (review round
		 * 1, M6): React Query 5.73.3's focusManager subscribes to a BUBBLING
		 * `visibilitychange` on `window` and tracks one boolean, so the bare
		 * `focus` dispatch this play used to send was heard by nobody and the
		 * conflict could never appear. Hidden -> visible is the pair a real
		 * window switch delivers; the wait before it is the detail query's own
		 * 10s `staleTime` - a focused query that is not stale is not refetched.
		 * The recipe is `scripts/hub-round-trips.mjs`'s, kept identical so the
		 * two rigs cannot drift.
		 */
		await new Promise((resolve) => setTimeout(resolve, 10_500));
		const vis = window as unknown as {
			__inlineEditVisibility?: string;
			__inlineEditVisibilityPatched?: boolean;
		};
		if (!vis.__inlineEditVisibilityPatched) {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				get: () => vis.__inlineEditVisibility ?? "visible",
			});
			vis.__inlineEditVisibilityPatched = true;
		}
		vis.__inlineEditVisibility = "hidden";
		document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
		vis.__inlineEditVisibility = "visible";
		document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
		window.dispatchEvent(new Event("focus"));
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					INLINE_EDIT_CONFLICT_SENTENCE,
				),
			"the conflict hold",
		);
	}),
};

/**
 * The preview arm of the description editor: the same sheet with `Preview`
 * pressed, so the frame shows the template RENDERED (the `ProjectMarkdown`
 * treatment) rather than the textarea. The play asserts an `h2` inside the
 * preview because a toggle that showed prose it did not parse is exactly the
 * failure this story exists to catch.
 */
export const CreateSheetPreview: Story = {
	render: () => page({ view: "list", projects: THREE }),
	play: playOnce("create-sheet-preview", async () => {
		await clickWhen('[data-tour-tag="create-project-button"]');
		await poll(
			() =>
				document.querySelector('[data-project-description-mode="preview"]') !==
				null,
			"the description mode toggle",
		);
		/*
		 * THE PARITY MEASUREMENT (design round 1, D2): the write textarea and
		 * the preview box must be the same height, so toggling Write|Preview
		 * re-centres nothing. Measured before the toggle, asserted after it —
		 * class names alone cannot promise a rendered box.
		 */
		const writeHeight = need<HTMLTextAreaElement>(
			"[data-project-description]",
		).getBoundingClientRect().height;
		await clickWhen('[data-project-description-mode="preview"]');
		await poll(
			() =>
				document.querySelector("[data-project-description-preview] h2") !==
				null,
			"the rendered description heading",
		);
		const previewHeight = need<HTMLElement>(
			"[data-project-description-preview]",
		).getBoundingClientRect().height;
		if (Math.abs(writeHeight - previewHeight) > 1) {
			throw new Error(
				`write ${writeHeight}px vs preview ${previewHeight}px — the toggle re-centres`,
			);
		}
	}),
};

/**
 * The paste path, exercised the way a clipboard actually delivers it: a
 * `paste` event carrying `text/html` (and its `text/plain` twin) is dispatched
 * at the textarea, and the play asserts the field now holds the CONVERTED
 * markdown — the one thing a plain paste could not produce.
 */
export const CreateSheetPaste: Story = {
	render: () => page({ view: "list", projects: THREE }),
	play: playOnce("create-sheet-paste", async () => {
		await clickWhen('[data-tour-tag="create-project-button"]');
		await poll(
			() =>
				document.querySelector<HTMLTextAreaElement>(
					'[data-tour-tag="project-create-dialog"] textarea',
				) !== null,
			"the description textarea",
		);
		const textarea = document.querySelector<HTMLTextAreaElement>(
			'[data-tour-tag="project-create-dialog"] textarea',
		);
		if (!textarea) throw new Error("the description textarea never mounted");
		textarea.focus();
		/* Replace-all, so the frame shows exactly the converted payload. */
		textarea.setSelectionRange(0, textarea.value.length);
		const clipboard = new DataTransfer();
		clipboard.setData(
			"text/html",
			"<h2>Imported</h2><ul><li>One</li><li>Two</li></ul>",
		);
		clipboard.setData("text/plain", "Imported\nOne\nTwo");
		const paste = new Event("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(paste, "clipboardData", { value: clipboard });
		textarea.dispatchEvent(paste);
		await poll(
			() =>
				textarea.value.includes("## Imported") &&
				textarea.value.includes("- One") &&
				textarea.value.includes("- Two"),
			"the converted paste in the description",
		);
	}),
};

/**
 * The over-limit description (design round 1, D1): the counter turns danger and
 * the field reads invalid WHILE the text is being written — the first cut
 * stayed muted until the submit bounced.
 */
export const CreateSheetOverLimit: Story = {
	render: () => page({ view: "list", projects: THREE }),
	play: playOnce("create-sheet-over-limit", async () => {
		await clickWhen('[data-tour-tag="create-project-button"]');
		await poll(
			() => document.querySelector("[data-project-description]") !== null,
			"the description textarea",
		);
		const textarea = need<HTMLTextAreaElement>("[data-project-description]");
		/*
		 * Filled through the paste path, not `userEvent.type`: 245 controlled
		 * keystrokes outlived the capture's 60s prepare budget on the loaded
		 * fleet, and `userEvent.clear` proved unreliable over the seeded
		 * template (measured: 275 characters landed, template included). A
		 * single `paste` event with `text/html` is the app's own insertion
		 * path — the same one the paste story drives — and lands atomically.
		 */
		const filler = "x".repeat(245);
		const clipboard = new DataTransfer();
		clipboard.setData("text/html", `<p>${filler}</p>`);
		clipboard.setData("text/plain", filler);
		const paste = new Event("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(paste, "clipboardData", { value: clipboard });
		textarea.focus();
		textarea.setSelectionRange(0, textarea.value.length);
		textarea.dispatchEvent(paste);
		await poll(
			() => textarea.value.length === 245,
			"the over-limit text to land",
		);
		await poll(() => {
			const counter = [...document.querySelectorAll("p")].find(
				(node) => node.textContent?.trim() === "245/240",
			);
			return (
				counter?.className.includes("text-danger") === true &&
				textarea.getAttribute("aria-invalid") === "true"
			);
		}, "the danger counter and the invalid field");
	}),
};

/**
 * The follow-up refusal (review round 1, R1-5): the create SUCCEEDS and the
 * PATCH for the extra fields is refused — the project exists, and the toast
 * says exactly that plus the way back in. The play asserts the toast text and
 * the closed dialog; the frame shows both surfaces.
 */
export const CreateSheetFollowUpRefusal: Story = {
	render: () =>
		page({
			view: "list",
			projects: THREE,
			failPatch: "The target date must be a real day.",
		}),
	play: playOnce("create-sheet-follow-up-refusal", async () => {
		await clickWhen('[data-tour-tag="create-project-button"]');
		await poll(
			() => document.querySelector("[data-project-title]") !== null,
			"the title input",
		);
		await userEvent.type(
			need<HTMLInputElement>("[data-project-title]"),
			"Refused extras",
		);
		await userEvent.type(
			need<HTMLInputElement>("[data-project-owner]"),
			"atlas",
		);
		await clickWhen("[data-project-submit]");
		await poll(
			() =>
				document
					.querySelector("[data-sonner-toaster]")
					?.textContent?.includes(
						"was created, but the extra fields were not saved",
					) ?? false,
			"the follow-up refusal toast",
		);
		await poll(
			() =>
				document.querySelector('[data-tour-tag="project-create-dialog"]') ===
				null,
			"the dialog to close",
		);
	}),
};

/**
 * The two-phase create, driven end to end: the create route carries the four
 * fields the backend's frozen contract accepts (`name`, `description`,
 * `status`, `tags`) and the follow-up patch carries the rest (title, owner,
 * target date). The play types a TITLE first (so the key derivation runs on
 * the real form), then asserts BOTH ops reached the bridge — the create with
 * the derived key, the patch with the follow-up fields — plus the closed
 * dialog. A frame alone cannot prove any of that.
 */
export const CreateSheetSubmit: Story = {
	render: () => page({ view: "list", projects: THREE }),
	play: playOnce("create-sheet-submit", async () => {
		/*
		 * Poll for the button before pressing it (the delete confirm's
		 * `waitForDetail` already does this): a `userEvent` click on a missing
		 * element throws instead of waiting.
		 */
		await poll(
			() =>
				document.querySelector('[data-tour-tag="create-project-button"]') !==
				null,
			"the create button",
		);
		await userEvent.click(
			need<HTMLElement>('[data-tour-tag="create-project-button"]'),
		);
		await poll(
			() => document.querySelector("[data-project-title]") !== null,
			"the title input",
		);
		await userEvent.type(
			need<HTMLInputElement>("[data-project-title]"),
			"Incident follow-ups",
		);
		/* The key derived while the field was untouched is the form's promise. */
		await poll(
			() =>
				document.querySelector<HTMLInputElement>("[data-project-key]")
					?.value === "incident-follow-ups",
			"the derived key",
		);
		await userEvent.type(
			need<HTMLInputElement>("[data-project-owner]"),
			"atlas",
		);
		await userEvent.type(
			need<HTMLInputElement>("[data-project-target]"),
			"2026-11-01",
		);
		await clickWhen("[data-project-submit]");
		await poll(
			() => bridgeOps.some((entry) => entry.op === "projects.update"),
			"the follow-up patch",
		);
		const created = bridgeOps.find((entry) => entry.op === "projects.create");
		const patched = bridgeOps.find((entry) => entry.op === "projects.update");
		if (created?.request.name !== "incident-follow-ups") {
			throw new Error(
				`the create carried: ${JSON.stringify(created?.request)}`,
			);
		}
		const fields = (patched?.request.fields ?? {}) as Record<string, unknown>;
		if (
			fields.title !== "Incident follow-ups" ||
			fields.owner !== "atlas" ||
			fields.target_date !== "2026-11-01"
		) {
			throw new Error(`the patch carried: ${JSON.stringify(fields)}`);
		}
		await poll(
			() =>
				document.querySelector('[data-tour-tag="project-create-dialog"]') ===
				null,
			"the dialog to close",
		);
		/*
		 * FOCUS RETURNS TO THE OPENER (UX round 1, U2) — asserted on the sheet;
		 * the delete confirm's play carries the same check.
		 */
		await poll(
			() =>
				document.activeElement ===
				document.querySelector('[data-tour-tag="create-project-button"]'),
			"focus back on the create button",
		);
	}),
};

/**
 * The delete confirm, with the name TYPED.
 *
 * The typed text is the state: the route's contract compares the body against
 * the stored name (case-insensitively), so the frame worth having is the one
 * where the button is enabled and the sentence above it says what it wants.
 */
export const DeleteConfirm: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("delete-confirm", async () => {
		await waitForDetail();
		/*
		 * Open through `userEvent` so the trigger actually takes focus before
		 * the dialog captures its opener — see the Escape cycle below.
		 */
		await userEvent.click(
			need<HTMLElement>('[data-tour-tag="project-delete"]'),
		);
		await poll(
			() =>
				document.querySelector('[data-tour-tag="project-delete-dialog"]') !==
				null,
			"the delete dialog",
		);
		/*
		 * FOCUS RETURNS TO THE OPENER (UX round 1, U2), verified on this dialog
		 * too: Escape closes, focus must be back on the trigger, and the story
		 * reopens so the frame still shows the typed confirm the copy needs.
		 *
		 * The REOPEN is `userEvent`'s, not `.click()`: a programmatic click
		 * never moves focus, so the dialog would capture `body` as the opener
		 * and the assertion would test the rig, not the app — the realistic
		 * pointer sequence is what a person produces.
		 */
		await userEvent.keyboard("{Escape}");
		await poll(
			() => document.querySelector('[role="dialog"]') === null,
			"the delete dialog to close on Escape",
		);
		await poll(
			() =>
				document.activeElement ===
				document.querySelector('[data-tour-tag="project-delete"]'),
			"focus back on the delete trigger",
		);
		await userEvent.click(
			need<HTMLElement>('[data-tour-tag="project-delete"]'),
		);
		await poll(
			() =>
				document.querySelector('[data-tour-tag="project-delete-dialog"]') !==
				null,
			"the delete dialog again",
		);
		const input = document.querySelector<HTMLInputElement>(
			'[data-tour-tag="project-delete-dialog"] input',
		);
		if (!input) throw new Error("the delete dialog has no confirm input");
		/*
		 * TYPED THROUGH `userEvent`, the layer the mention stories drive the composer
		 * with — a bare `input.value = …` never updated React's state (its value
		 * tracker makes the assignment look like no change) and a native-setter
		 * dispatch worked in a hand-driven browser but NOT under the capture rig:
		 * the sweep stopped at `delete-confirm @ localOperatorDark` because the
		 * button never enabled. `userEvent` types the characters as a person does,
		 * so the state the frame shows is the state a keystroke produces.
		 */
		await userEvent.type(input, "payments-migration");
		/*
		 * THE POLL READS THE DIALOG, not `data-tour-tag`: `BaseDialog` puts that tag
		 * on its scrollable BODY, and the footer's buttons are its siblings — so a
		 * scoped query found no button at all and the play failed with the typed
		 * dialog on screen (measured: `buttons: []` while the frame showed Cancel
		 * and an enabled Delete project). `[role="dialog"]` is the panel that
		 * contains both halves.
		 */
		await poll(() => {
			const dialog = document.querySelector('[role="dialog"]');
			return (
				dialog !== null &&
				[...dialog.querySelectorAll("button")].some(
					(button) =>
						!button.disabled && button.textContent?.trim() === "Delete project",
				)
			);
		}, "the delete button to enable");
	}),
};

/**
 * The milestone toggle, AFTER the press.
 *
 * The gesture presses the checkbox on the overdue milestone; the fixture
 * answers the way the store does (stamp today, status completed), so the frame
 * is the settled re-read of a real mutation rather than two adjacent states.
 */
export const MilestoneToggle: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("milestone-toggle", async () => {
		await waitForDetail();
		await clickWhen('[aria-label="Mark dashboard cutover complete"]');
		await poll(
			() =>
				document.querySelector(
					'[aria-label="Mark dashboard cutover not complete"]',
				) !== null,
			"the milestone to flip to complete",
		);
	}),
};

/** A stale progress record: the badge the list exists to raise. */
export const StaleProgress: Story = {
	render: () =>
		page({
			view: "list",
			projects: [
				project("s1", "stale-rollout", {
					description: "One weekly line owed",
					target_date: "2026-10-31",
					estimate: 8,
					milestones_completed: 0,
					milestones_total: 1,
					progress_stale: true,
					progress_updated_at: FIXTURE_NOW_MS / 1000 - 5 * DAY_S,
				}),
			],
		}),
};

/*
 * The two helpers the LOADING and ERROR stories wait on, declared last so the
 * stories above read first. `HoldUntilPresent` is the schedules page's
 * `HoldUntilText` generalised to a selector, for the states whose subject is
 * an ELEMENT (a spinner) rather than a sentence.
 */
function HoldUntilPresent({
	selector,
	text,
}: {
	selector?: string;
	text?: string;
}) {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		const timer = window.setInterval(() => {
			const found = selector
				? document.querySelector(selector) !== null
				: (document.body.textContent ?? "").includes(text ?? "");
			if (found) {
				document.documentElement.removeAttribute("data-capture-pending");
				window.clearInterval(timer);
			}
		}, 50);
		return () => window.clearInterval(timer);
	}, [selector, text]);
	return null;
}

/* ---------------------------------------------------------- board + timeline */

/**
 * The board under a search (U5): the result line reports matches WITHIN the
 * window (`10 of 12 projects` here, at the default week), and the cards that
 * do not match are gone — the board cannot show a row the search excluded.
 */
export const BoardSearchActive: Story = {
	render: () =>
		page({
			view: "board",
			projects: [
				...MANY,
				project("old1", "migration-batch-old", {
					updated_at: FIXTURE_NOW_MS / 1000 - 30 * DAY_S,
				}),
			],
		}),
	play: playOnce("board-search-active", async () => {
		await poll(
			() =>
				document.querySelector('input[aria-label="Search projects"]') !== null,
			"the search field",
		);
		await userEvent.type(
			need<HTMLInputElement>('input[aria-label="Search projects"]'),
			"migration",
		);
		await poll(
			() => document.querySelector("[data-project-count]") !== null,
			"the board's count line",
		);
	}),
};

/**
 * R1's state, pinned rather than argued: on the Board, a search whose matches
 * ALL fall outside the window. The no-match block still wins (U5) — the search
 * DID match — and the window is what hid the matches, so the block carries the
 * window's own recovery, `Show all time`, beneath Clear all. The play asserts
 * the block, both actions, and the count's own words (`0 of 12 in window`,
 * U10): the denominator is the window's population and the sentence says so.
 */
export const BoardSearchOffWindow: Story = {
	render: () =>
		page({
			view: "board",
			projects: [
				...MANY,
				project("old1", "migration-batch-old", {
					updated_at: FIXTURE_NOW_MS / 1000 - 30 * DAY_S,
				}),
			],
		}),
	play: playOnce("board-search-off-window", async () => {
		await poll(
			() =>
				document.querySelector('input[aria-label="Search projects"]') !== null,
			"the search field",
		);
		await userEvent.type(
			need<HTMLInputElement>('input[aria-label="Search projects"]'),
			"batch-old",
		);
		await poll(
			() => (document.body.textContent ?? "").includes("No projects match"),
			"the no-match sentence",
		);
		const count = document.querySelector<HTMLElement>("[data-project-count]");
		if (count?.textContent?.trim() !== "0 of 12 in window") {
			throw new Error(
				`the within-window count reads: ${count?.textContent?.trim() ?? "absent"}`,
			);
		}
		const labels = [...document.querySelectorAll("button")].map((node) =>
			node.textContent?.trim(),
		);
		if (!labels.includes("Show all time")) {
			throw new Error(
				"the within-window no-match block does not offer Show all time",
			);
		}
	}),
};

/** The board with all three columns populated — the ordinary shape. */
export const Board: Story = {
	render: () =>
		page({
			view: "board",
			projects: THREE,
			details: detailsFor(THREE),
		}),
};

/** Twelve cards across the columns: the board under its own scroll. */
export const BoardMany: Story = {
	render: () =>
		page({
			view: "board",
			projects: MANY,
			details: detailsFor(MANY),
		}),
};

/**
 * `archived` joins only when it holds rows, and a status outside the fixed
 * vocabulary gets its own column rather than being dropped (the deliberate
 * delta from the TUI's board).
 */
export const BoardStatuses: Story = {
	render: () =>
		page({
			view: "board",
			projects: [
				...THREE,
				/* One row per lifecycle phase the vocabulary names, plus the two side
				   states and one word this build has never heard of. */
				project("p0", "rfc-scope", { status: "planning" }),
				project("q1", "dash-qa", { status: "qa" }),
				project("v1", "edge-watch", { status: "validation" }),
				project("a1", "payments-v1", { status: "archived" }),
				project("r1", "review-pass", { status: "review" }),
				/* A passed target with the work unfinished: the card's Overdue
				   emphasis, photographed rather than argued. */
				project("o1", "release-prep", {
					target_date: "2026-09-15",
					estimate: 8,
					milestones_completed: 0,
					milestones_total: 1,
				}),
			],
		}),
};

/**
 * EMPTY columns on the banded board: only active and done hold rows, so the
 * other columns render as cells of quiet well ground under a `0` count — the
 * "No projects here." copy retired with the bands rework (spec §4/§7: the
 * count is the signal), and this story keeps the state photographed.
 */
export const BoardEmptyColumns: Story = {
	render: () =>
		page({
			view: "board",
			projects: [THREE[0], THREE[2]],
			details: detailsFor([THREE[0], THREE[2]]),
		}),
};

/**
 * The card's sessions popover, OPEN: the door the card names, drawn (design
 * round 1, D8). `userEvent.click` dispatches the full pointer sequence, which
 * is what a Radix trigger listens for — a bare `.click()` would leave the
 * frame showing a card and no drawer.
 */
export const BoardSessionsPopover: Story = {
	render: () =>
		page({
			view: "board",
			projects: THREE,
			details: { p1: DETAIL },
		}),
	play: playOnce("board-sessions-popover", async () => {
		await poll(
			() => document.querySelector('[data-project-sessions="p1"]') !== null,
			"the sessions trigger",
		);
		const trigger = document.querySelector<HTMLElement>(
			'[data-project-sessions="p1"]',
		);
		if (!trigger) throw new Error("the p1 card has no sessions trigger");
		await userEvent.click(trigger);
		await poll(
			() => (document.body.textContent ?? "").includes("Payments cutover"),
			"the popover to list a linked session",
		);
	}),
};

/** The card menu, open — Open / Set status / Edit / Delete, the no-drag rule. */
export const BoardCardMenu: Story = {
	render: () =>
		page({
			view: "board",
			projects: THREE,
			details: detailsFor(THREE),
		}),
	play: playOnce("board-card-menu", async () => {
		const selector = '[aria-label="Actions for payments-migration"]';
		await poll(() => document.querySelector(selector) !== null, selector);
		const trigger = document.querySelector<HTMLElement>(selector);
		if (!trigger) throw new Error("the p1 card has no menu trigger");
		await userEvent.click(trigger);
		await poll(
			() => (document.body.textContent ?? "").includes("Set status"),
			"the card menu",
		);
		/*
		 * THE STATUS SUBMENU IS OPENED TOO (slice S6d): the frame is the evidence
		 * that the move menu carries the whole lifecycle. The poll counts the
		 * RADIO ITEMS by role rather than searching for words: "Planning" and
		 * "Validation" also name board columns behind the menu, so a text match
		 * would pass before the submenu ever opened.
		 */
		const subTrigger = [
			...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].find((element) => element.textContent?.includes("Set status"));
		if (!subTrigger) throw new Error("the card menu has no Set status row");
		await userEvent.hover(subTrigger);
		await poll(
			() => document.querySelectorAll('[role="menuitemradio"]').length >= 7,
			"the status submenu",
		);
	}),
};

/**
 * A stored column order, applied: the board as the user left it — `QA` moved
 * ahead of `active`, `done` untouched at the end — read from the same store
 * the drag writes (`projects-board-column-order`). This is also the RELOAD
 * half of the persistence claim: the story mounts fresh, and the order is
 * already there.
 */
export const BoardColumnOrderStored: Story = {
	render: () =>
		page({
			view: "board",
			columnOrder: ["planning", "qa", "active", "validation", "done"],
			projects: THREE,
			details: detailsFor(THREE),
		}),
};

/**
 * A column header lifted, mid-drag: the transient the reorder's indicator
 * exists for.
 *
 * THE RIG DRIVES THE GESTURE, NOT THIS STORY (the mesh canvas's rule): the
 * mid-drag state is held by a pointer that is DOWN, and a synthetic sequence
 * from here resolves to the settled board before the shutter. The capture's
 * own `drag` option presses this board's `active` header and holds it over
 * `done`, and the frame's claim — "Moving Active column" — is the board's
 * live-region announcement, present in the document exactly while the gesture
 * is armed.
 */
export const BoardColumnDrag: Story = {
	render: () =>
		page({
			view: "board",
			projects: THREE,
			details: detailsFor(THREE),
		}),
};

/**
 * The keyboard route, after one press: the `QA` column moved right by a
 * focused grip's arrow key — the accessible half of the reorder, driven
 * through the real key handler, with the write and the retained focus
 * asserted so the frame is a state the keyboard can actually reach.
 */
export const BoardColumnKeyboardMove: Story = {
	render: () =>
		page({
			view: "board",
			projects: THREE,
			details: detailsFor(THREE),
		}),
	play: playOnce("board-column-keyboard-move", async () => {
		const grip = '[data-board-column-grip="qa"]';
		await poll(() => document.querySelector(grip) !== null, grip);
		const handle = document.querySelector<HTMLElement>(grip);
		if (!handle) throw new Error("the QA column has no grip");
		handle.focus();
		/*
		 * THE GRIP ANSWERS ITS OWN ACTIVATION KEYS (UX round 1, U3): Enter on a
		 * handle has no action, so it answers with the route itself through the
		 * board's live region - the same sentence the described-by hint carries
		 * for a screen reader. Asserted here because "inert" was the finding.
		 */
		await userEvent.keyboard("{Enter}");
		await poll(
			() =>
				(document.querySelector("[data-board-column-announcement]")
					?.textContent ?? "") ===
				"Drag the header, or press the arrow keys, to move this column.",
			"the grip's Enter answer",
		);
		await userEvent.keyboard("{ArrowRight}");
		await poll(
			() =>
				[...document.querySelectorAll<HTMLElement>("[data-board-column]")]
					.map((section) => section.dataset.boardColumn)
					.join(",") === "planning,active,validation,qa,done,paused",
			"the moved order",
		);
		/*
		 * The write is the claim the reload depends on, and the grip keeps the
		 * focus across the re-render — a reorder that drops the keyboard user
		 * back to the body is a reorder they can only do once.
		 */
		const stored = JSON.parse(
			localStorage.getItem(PROJECTS_BOARD_ORDER_STORAGE_KEY) ?? "[]",
		) as string[];
		if (stored.join(",") !== "planning,active,validation,qa,done,paused") {
			throw new Error(`the move did not persist: ${stored.join(",")}`);
		}
		if (document.activeElement !== handle) {
			throw new Error("the moved column dropped the keyboard focus");
		}
	}),
};

/**
 * The DROP, committed: a full press-move-release through the board's own
 * handlers reorders the columns and writes the order — the half the mid-drag
 * frame cannot show, because the rig holds its button down on purpose.
 *
 * THE PLAY DISPATCHES THE POINTER SEQUENCE ITSELF (`userEvent.pointer`), and
 * that is the measurement rather than a shortcut: a COMMIT is a settled state,
 * so the sequence resolving on the release is exactly what this story claims.
 * The transient frame next door needs the rig precisely because a synthetic
 * sequence cannot HOLD a dragged column in the air.
 */
export const BoardColumnDropCommits: Story = {
	render: () =>
		page({
			view: "board",
			projects: THREE,
			details: detailsFor(THREE),
		}),
	play: playOnce("board-column-drop-commits", async () => {
		const readOrder = () =>
			[...document.querySelectorAll<HTMLElement>("[data-board-column]")]
				.map((section) => section.dataset.boardColumn)
				.join(",");
		const gripSelector = '[data-board-column-grip="active"]';
		await poll(
			() => document.querySelector(gripSelector) !== null,
			gripSelector,
		);
		const handle = document.querySelector<HTMLElement>(gripSelector);
		const header = document.querySelector<HTMLElement>(
			'[data-board-column-handle="active"]',
		);
		const done = document.querySelector<HTMLElement>(
			'[data-board-column="done"]',
		);
		if (!handle || !header || !done)
			throw new Error("the active header or its drop target is missing");
		const regionText = () =>
			document.querySelector("[data-board-column-announcement]")?.textContent ??
			"";
		/*
		 * (a) A NO-OP DROP (review round 1, R1-3; UX round 1, U5): press, pass the
		 * arm threshold, release in the same slot. Nothing may be written - the
		 * on-screen order equals the stored one here, so a write would rewrite
		 * the store for a move nobody made and drop the rank of a dormant column
		 * the user never touched - and nothing may be announced: the region's own
		 * "Moving …" sentence is cleared, not left standing or replaced by a
		 * "Moved" for a move that did not happen.
		 */
		const noopAt = handle.getBoundingClientRect();
		await userEvent.pointer([
			{ keys: "[MouseLeft>]", target: handle },
			{
				target: header,
				coords: {
					x: Math.round(noopAt.left + 30),
					y: Math.round(noopAt.top + 12),
				},
			},
			{
				target: header,
				coords: {
					x: Math.round(noopAt.left + 34),
					y: Math.round(noopAt.top + 12),
				},
			},
			{ keys: "[/MouseLeft]", target: header },
		]);
		if (readOrder() !== "planning,active,qa,validation,done,paused") {
			throw new Error(`the no-op drop moved a column: ${readOrder()}`);
		}
		const afterNoop = JSON.parse(
			localStorage.getItem(PROJECTS_BOARD_ORDER_STORAGE_KEY) ?? "[]",
		) as string[];
		if (afterNoop.length !== 0) {
			throw new Error(`the no-op drop wrote storage: ${afterNoop.join(",")}`);
		}
		if (regionText() !== "") {
			throw new Error(`the no-op drop announced: ${regionText()}`);
		}
		/*
		 * (b) A CANCEL (Escape; QA round 1, Q-2): the gesture abandons silently,
		 * and the region says so instead of keeping "Moving …". The trailing
		 * release is inert by design - the gesture is gone, so its pointerup
		 * settles nothing - and it closes the synthetic pointer sequence.
		 */
		const cancelAt = handle.getBoundingClientRect();
		await userEvent.pointer([
			{ keys: "[MouseLeft>]", target: handle },
			{
				target: header,
				coords: {
					x: Math.round(cancelAt.left + 40),
					y: Math.round(cancelAt.top + 12),
				},
			},
		]);
		await userEvent.keyboard("{Escape}");
		await poll(() => regionText() === "Move cancelled.", "the cancel's copy");
		if (readOrder() !== "planning,active,qa,validation,done,paused") {
			throw new Error(`the cancel moved a column: ${readOrder()}`);
		}
		const afterCancel = JSON.parse(
			localStorage.getItem(PROJECTS_BOARD_ORDER_STORAGE_KEY) ?? "[]",
		) as string[];
		if (afterCancel.length !== 0) {
			throw new Error(`the cancel wrote storage: ${afterCancel.join(",")}`);
		}
		await userEvent.pointer([{ keys: "[/MouseLeft]", target: header }]);
		const start = handle.getBoundingClientRect();
		const landing = done.getBoundingClientRect();
		/*
		 * Aimed inside Done's LEFT half, deliberately: the midpoint boundary that
		 * puts Active in the gap before Done is comfortably inside it, and the
		 * landing stays clear of the strip's right auto-scroll zone - held in that
		 * zone the strip scrolls under the pointer by design (UX round 1, U1)
		 * and the committed index would be measuring the scroll, not the drop.
		 */
		const x = Math.round(landing.left + 40);
		const y = Math.round(landing.top + 12);
		await userEvent.pointer([
			{ keys: "[MouseLeft>]", target: handle },
			{
				target: header,
				coords: {
					x: Math.round(start.left + 30),
					y: Math.round(start.top + 12),
				},
			},
			{ target: header, coords: { x, y } },
			{ keys: "[/MouseLeft]", target: header },
		]);
		/*
		 * The landing is asserted as the full order, and so is the write: the
		 * reload half (`board-column-order-stored`) is only honest if the drop
		 * really persisted what it dropped.
		 */
		await poll(
			() => readOrder() === "planning,qa,validation,active,done,paused",
			"the dropped order",
		);
		if (readOrder() !== "planning,qa,validation,active,done,paused") {
			throw new Error(`the drop landed as: ${readOrder()}`);
		}
		const stored = JSON.parse(
			localStorage.getItem(PROJECTS_BOARD_ORDER_STORAGE_KEY) ?? "[]",
		) as string[];
		if (stored.join(",") !== "planning,qa,validation,active,done,paused") {
			throw new Error(`the drop did not persist: ${stored.join(",")}`);
		}
	}),
};

/**
 * The board's sticky frame, BANDED (the teams rework), held to the mechanics
 * the sticky rounds measured: the column header row pins at 44 (`h-11`), the
 * band headers pin at `top-11` beneath it as a constant `h-8`, the incoming
 * band header PUSHES the outgoing one out (no stacked pair, no dead slot),
 * and every cell of the pinned band is stretched to that band's tallest —
 * numbers asserted before the shutter rather than described.
 */
export const BoardSticky: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_LONG,
			details: detailsFor(BOARD_LONG),
		}),
	play: playOnce("board-sticky", async () => {
		/*
		 * Poll for the mounted board first: a play runs on mount, and the old
		 * per-column play paid this wait for the same reason — a synchronous
		 * query against a not-yet-painted tree reads an empty board.
		 */
		await poll(
			() =>
				document.querySelector("[data-board-strip]") !== null &&
				document.querySelector('[data-board-column-handle="active"]') !==
					null &&
				document.querySelectorAll("[data-board-team]").length >= 2,
			"the banded board (strip, active header, two band headers)",
		);
		const strip = document.querySelector<HTMLElement>("[data-board-strip]");
		const handle = document.querySelector<HTMLElement>(
			'[data-board-column-handle="active"]',
		);
		const bands = [
			...document.querySelectorAll<HTMLElement>("[data-board-team]"),
		];
		if (!strip || !handle || bands.length < 2) {
			throw new Error(
				`the strip, the active header or two band headers are missing (bands ${bands.length})`,
			);
		}
		/* The two offsets the sticky layers are written against: h-11 = 44, top-11 = 44. */
		const headerHeight = handle.getBoundingClientRect().height;
		if (Math.abs(headerHeight - 44) > 0.6) {
			throw new Error(`the column header is ${headerHeight}px tall, not 44`);
		}
		const bandHeaderHeight = bands[0].getBoundingClientRect().height;
		if (Math.abs(bandHeaderHeight - 32) > 0.6) {
			throw new Error(`the band header is ${bandHeaderHeight}px tall, not 32`);
		}
		if (getComputedStyle(bands[0]).top !== "44px") {
			throw new Error(
				`the band header's sticky offset is ${getComputedStyle(bands[0]).top}, not 44px`,
			);
		}
		const rel = (node: HTMLElement) =>
			node.getBoundingClientRect().top - strip.getBoundingClientRect().top;
		/*
		 * Flush, then a bounded overshoot: the pin has to hold past the point
		 * where a static element would also happen to sit at the offset (the
		 * identity the list's round-1 probe called out).
		 */
		strip.scrollTop += rel(bands[1]) - 44;
		strip.scrollTop += 20;
		await poll(
			() => Math.abs(rel(bands[1]) - 44) <= 2,
			"the second band header to pin under the row",
		);
		/*
		 * THE PUSH-OUT: the outgoing band header is fully displaced — its
		 * bottom at or above the incoming header's top — rather than stacked
		 * under it, which is what makes the handoff continuous (bands are
		 * flush, so there is no empty slot between them either).
		 */
		const firstBottom = bands[0].getBoundingClientRect().bottom;
		const secondTop = bands[1].getBoundingClientRect().top;
		if (firstBottom > secondTop + 0.5) {
			throw new Error(
				`the outgoing band header overlaps the incoming one (bottom ${firstBottom.toFixed(2)} > top ${secondTop.toFixed(2)})`,
			);
		}
		/*
		 * THE WELL IS ONE RECTANGLE, CAPPED AT ONE SCREEN (operator refinement):
		 * every cell of the band is the same height (the well's cross-stretch),
		 * every cell is at most one screen minus the pinned row and this band's
		 * header, and a column whose queue does not fit scrolls INSIDE its cell —
		 * asserted per cell rather than eyeballed. The chain itself (wheel over a
		 * non-scrollable column reaching the board) is the two scroll-chain
		 * stories' subject; this is the geometry underneath it.
		 */
		const section = bands[1].closest("section");
		const cells = [
			...(section?.querySelectorAll<HTMLElement>("[data-board-cell]") ?? []),
		];
		if (cells.length === 0) throw new Error("the pinned band has no cells");
		const heights = cells.map((cell) => cell.getBoundingClientRect().height);
		const tallest = Math.max(...heights);
		const shortest = Math.min(...heights);
		if (tallest < 100 || tallest - shortest > 0.5) {
			throw new Error(
				`the band's cells are not equal height: shortest ${shortest.toFixed(2)}, tallest ${tallest.toFixed(2)}`,
			);
		}
		const cap = strip.clientHeight - 92 + 1;
		if (tallest > cap) {
			throw new Error(
				`the band is ${tallest.toFixed(2)} tall, past the one-screen cap ${cap.toFixed(2)}`,
			);
		}
		const scrollable = cells.filter(
			(cell) => cell.scrollHeight > cell.clientHeight + 1,
		);
		const quiet = cells.filter(
			(cell) => cell.scrollHeight <= cell.clientHeight + 1,
		);
		if (scrollable.length === 0 || quiet.length === 0) {
			throw new Error(
				`expected both scrollable and quiet cells (scrollable ${scrollable.length}, quiet ${quiet.length})`,
			);
		}
		/*
		 * THE PIN HOLDS TO THE END OF THE SCROLL (design round 2, D2 = QA round
		 * 1, Q2): the strip's child must stay content-height (`items-start`), or
		 * the column row's sticky containing block ends after one screen and the
		 * row drifts off — measured at −94.3px on the 6289px board. Scroll to
		 * the very end and read the offset back; the row must still be pinned at
		 * the scrollport's own top edge.
		 */
		strip.scrollTop = strip.scrollHeight;
		await poll(
			() => strip.scrollTop >= strip.scrollHeight - strip.clientHeight - 1,
			"the strip at its scroll end",
		);
		const headerTop = document
			.querySelector<HTMLElement>('[data-board-column="active"]')
			?.getBoundingClientRect().top;
		const stripTop = strip.getBoundingClientRect().top;
		if (headerTop === undefined || Math.abs(headerTop - stripTop) > 0.5) {
			throw new Error(
				`the column row lost its pin at the scroll end: offset ${((headerTop ?? 0) - stripTop).toFixed(1)}`,
			);
		}
		/*
		 * THE TITLE DISPLAY, read off the live card: the fixture's titled row
		 * shows its title as the primary line and its key as the muted
		 * subtitle, while `data-project-name` stays the KEY (the addressable
		 * hook) — the swap the finding asked for, asserted here rather than
		 * trusted to the fixture.
		 */
		const titled = document.querySelector<HTMLElement>(
			'[data-project-name="load-shed-1"]',
		);
		if (
			!titled ||
			!titled.textContent.includes("Load-shed hardening") ||
			!titled.textContent.includes("load-shed-1")
		) {
			throw new Error(
				"the titled card does not render title + key (the title display regressed)",
			);
		}
	}),
};

/**
 * THE SCROLL CHAIN, case 1: the wheel sits over a column that CANNOT scroll
 * (its queue fits) and the board must take the gesture — the next team comes
 * into view instead of the wheel being swallowed by the column. The gesture is
 * the rig's `wheel` option (trusted CDP input, the only kind that moves a
 * scroll container); the entry's `expect` asserts the strip advanced before
 * the shutter, so a trapped wheel fails the capture rather than photographing
 * the settled board.
 */
export const BoardScrollChain: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_LONG,
			details: detailsFor(BOARD_LONG),
		}),
};

/**
 * THE SCROLL CHAIN, case 2: the wheel sits over a column that CAN scroll; the
 * cell takes the input until its own edge, then the board continues. The
 * entry's `expect` asserts both readings — the cell at its end AND the strip
 * advanced — before the shutter.
 */
export const BoardScrollEdge: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_LONG,
			details: detailsFor(BOARD_LONG),
		}),
};

/* ---------------------------------------------------------- board window -- */

/**
 * THE BOARD'S TIME WINDOW (feat/board-time-window). The ladder is a model
 * table; these stories are the frames: one rung each, the default, the empty
 * window and its recovery, the open panel, the narrow floor, and the
 * store-empty state the control hides on. Every play asserts the frame's own
 * mechanics - the visible card set, the control's words, the persisted token
 * - against the live page, the way #648's board plays do.
 */

/**
 * The default: nothing stored, the 7d rung, the three rows inside seven days
 * (and not the 12d row).
 */
export const BoardWindowPopulated: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_ROWS,
			details: detailsFor(BOARD_WINDOW_ROWS),
		}),
	play: playOnce("board-window-populated", async () => {
		await poll(
			() =>
				document.querySelector('[data-project-name="cutover-probe"]') !== null,
			"the board's default window",
		);
		const trigger = need<HTMLElement>(
			'[data-tour-tag="projects-board-window"]',
		);
		if (!trigger.textContent?.includes("Last 7 days")) {
			throw new Error(
				`the window control does not read "Last 7 days": ${trigger.textContent ?? "(nothing)"}`,
			);
		}
		expectBoardKeys(
			["cutover-probe", "queue-tune", "hotfix-drill"],
			"the default 7d window",
		);
	}),
};

/**
 * The 24h rung - and the R5 frame: the `hotfix-drill` card is kept by an
 * `updated_at` of one hour while its own PROGRESS line reads "reported 12d
 * ago", so a filter reading the printed age would drop it and this play
 * fails on the absence.
 */
export const BoardWindow24h: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_ROWS,
			details: detailsFor(BOARD_WINDOW_ROWS),
			window: "24h",
		}),
	play: playOnce("board-window-24h", async () => {
		await poll(
			() =>
				document.querySelector('[data-project-name="hotfix-drill"]') !== null,
			"the 24h window",
		);
		expectBoardKeys(["cutover-probe", "hotfix-drill"], "the 24h window");
		/*
		 * THE STORED RUNG IS WHAT THIS FRAME IS A PICTURE OF (UX round 1): the
		 * story sets the token and `page()` clears the key for every story that
		 * does NOT name one, so the two paths are a pair - a stored `24h` reads
		 * back as `24h` here, and a cleared key reads as the 7d default in
		 * `board-window-populated`. Without this half, a regression that ignored
		 * the store would still paint the right board from the story's own prop.
		 */
		if (localStorage.getItem(PROJECTS_BOARD_WINDOW_STORAGE_KEY) !== "24h") {
			throw new Error("the 24h rung was not written to the store");
		}
		const hotfix = need<HTMLElement>('[data-project-name="hotfix-drill"]');
		if (!hotfix.textContent?.includes("reported 12d ago")) {
			throw new Error(
				"the R5 card does not print its 12d-old progress line - the fixture no longer discriminates",
			);
		}
	}),
};

/**
 * The 30d rung: the 12d row arrives (and the 45d row is still out). The
 * four statuses across four columns keep `validation` empty at every rung.
 */
export const BoardWindow30d: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_ROWS,
			details: detailsFor(BOARD_WINDOW_ROWS),
			window: "30d",
		}),
	play: playOnce("board-window-30d", async () => {
		await poll(
			() =>
				document.querySelector('[data-project-name="schema-deprecation"]') !==
				null,
			"the 30d window",
		);
		expectBoardKeys(
			["cutover-probe", "queue-tune", "schema-deprecation", "hotfix-drill"],
			"the 30d window",
		);
	}),
};

/** The 90d rung: the 45d row arrives, the 200d row is still out. */
export const BoardWindow90d: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_ROWS,
			details: detailsFor(BOARD_WINDOW_ROWS),
			window: "90d",
		}),
	play: playOnce("board-window-90d", async () => {
		await poll(
			() =>
				document.querySelector('[data-project-name="fallback-paths"]') !== null,
			"the 90d window",
		);
		expectBoardKeys(
			[
				"cutover-probe",
				"queue-tune",
				"schema-deprecation",
				"fallback-paths",
				"hotfix-drill",
			],
			"the 90d window",
		);
	}),
};

/** The `all` rung: no predicate at all, all six rows, and the control's own words. */
export const BoardWindowAll: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_ROWS,
			details: detailsFor(BOARD_WINDOW_ROWS),
			window: "all",
		}),
	play: playOnce("board-window-all", async () => {
		await poll(
			() =>
				document.querySelector('[data-project-name="vendor-renewal"]') !== null,
			"the all-time board",
		);
		expectBoardKeys(
			[
				"cutover-probe",
				"queue-tune",
				"schema-deprecation",
				"fallback-paths",
				"vendor-renewal",
				"hotfix-drill",
			],
			"the all-time window",
		);
		const trigger = need<HTMLElement>(
			'[data-tour-tag="projects-board-window"]',
		);
		if (!trigger.textContent?.includes("All time")) {
			throw new Error('the control does not read "All time"');
		}
	}),
};

/**
 * The empty window: every row older than the default 7d, so the board's slot
 * carries "Nothing changed in the last 7 days." with the control still above
 * it - the state whose heading names the window through the ladder's own
 * phrase.
 */
export const BoardWindowEmpty: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_AGED,
			details: detailsFor(BOARD_WINDOW_AGED),
		}),
	play: playOnce("board-window-empty", async () => {
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Nothing changed in the last 7 days.",
				),
			"the empty-window heading",
		);
		need('[data-tour-tag="projects-board-window"]');
		if (document.querySelector("[data-project-name]") !== null) {
			throw new Error("a card is on the board under the empty-window state");
		}
		if (
			!(document.body.textContent ?? "").includes(
				"Older projects are hidden by the window.",
			)
		) {
			throw new Error("the empty-window body copy is missing");
		}
		const action = [...document.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Show all time"),
		);
		if (!action) throw new Error("the Show all time action is missing");
	}),
};

/**
 * The empty window at 24h: the same state one rung down, where the heading
 * must read the RUNG's phrase ("Nothing changed in the last 24 hours.") rather
 * than the default's - the frames are the ladder's own proof that the sentence
 * follows the window and not the state.
 */
export const BoardWindowEmpty24h: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_AGED,
			details: detailsFor(BOARD_WINDOW_AGED),
			window: "24h",
		}),
	play: playOnce("board-window-empty-24-h", async () => {
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Nothing changed in the last 24 hours.",
				),
			"the 24h empty-window heading",
		);
		if (document.querySelector("[data-project-name]") !== null) {
			throw new Error("a card is on the board under the 24h empty window");
		}
	}),
};

/**
 * The empty window at 90d: the fixture is the rows older than NINETY days, so
 * the heading reads "…the last 90 days." while the same board at 24h and 7d
 * still holds cards. The two frames together are what makes the phrase's
 * provenance visible.
 */
export const BoardWindowEmpty90d: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_ANCIENT,
			details: detailsFor(BOARD_WINDOW_ANCIENT),
			window: "90d",
		}),
	play: playOnce("board-window-empty-90-d", async () => {
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Nothing changed in the last 90 days.",
				),
			"the 90d empty-window heading",
		);
		if (document.querySelector("[data-project-name]") !== null) {
			throw new Error("a card is on the board under the 90d empty window");
		}
	}),
};

/**
 * THE WINDOW'S OWN DIMENSION, said in words (design round 1, D1). The control
 * carries a tooltip naming what it filters on and that older rows are hidden,
 * and the play opens it BOTH ways - hover for the pointer, focus for the
 * keyboard, which is the state the shutter lands on - and reads the same
 * sentence the component exports, so the frame cannot drift from the copy.
 */
export const BoardWindowHint: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_ROWS,
			details: detailsFor(BOARD_WINDOW_ROWS),
		}),
	play: playOnce("board-window-hint", async () => {
		await poll(
			() =>
				document.querySelector('[data-tour-tag="projects-board-window"]') !==
				null,
			"the window control",
		);
		const trigger = need<HTMLElement>(
			'[data-tour-tag="projects-board-window"]',
		);
		const panelText = () =>
			document.querySelector("[data-lo-tooltip-panel]")?.textContent ?? "";
		/*
		 * BOTH DOORS, in the order a reader meets them: the pointer opens the
		 * hint (hover), it LEAVES WITH THE POINTER (the call site passes
		 * `disableHoverableContent` for the reason QA round 1 recorded - the
		 * primitive's default waits for the pointer to enter a panel that is
		 * `pointer-events: none`, so the panel outlived the gesture by tens of
		 * seconds), and the keyboard opens it again by focusing the control, which
		 * is the state the shutter lands on.
		 */
		await userEvent.hover(trigger);
		await poll(
			() => panelText().includes(BOARD_WINDOW_HINT),
			"the window tooltip on hover",
		);
		await userEvent.unhover(trigger);
		await poll(
			() => !panelText().includes(BOARD_WINDOW_HINT),
			"the window tooltip to close when the pointer leaves",
		);
		trigger.focus();
		await poll(
			() => panelText().includes(BOARD_WINDOW_HINT),
			"the window tooltip on focus",
		);
	}),
};

/**
 * The recovery: the same empty window, and "Show all time" widens and
 * persists `all` - the board fills, the control follows, the store holds the
 * token.
 */
export const BoardWindowWidened: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_AGED,
			details: detailsFor(BOARD_WINDOW_AGED),
		}),
	play: playOnce("board-window-widened", async () => {
		await poll(
			() => (document.body.textContent ?? "").includes("Show all time"),
			"the empty-window action",
		);
		const action = [...document.querySelectorAll("button")].find((button) =>
			button.textContent?.includes("Show all time"),
		);
		if (!action) throw new Error("the Show all time action is missing");
		await userEvent.click(action);
		await poll(
			() =>
				document.querySelector('[data-project-name="vendor-renewal"]') !== null,
			"the board to fill at all time",
		);
		expectBoardKeys(
			["schema-deprecation", "fallback-paths", "vendor-renewal"],
			"the widened board",
		);
		const trigger = need<HTMLElement>(
			'[data-tour-tag="projects-board-window"]',
		);
		if (!trigger.textContent?.includes("All time")) {
			throw new Error("the control did not follow the recovery");
		}
		if (localStorage.getItem(PROJECTS_BOARD_WINDOW_STORAGE_KEY) !== "all") {
			throw new Error("the recovery did not persist the `all` token");
		}
		/*
		 * AND THE HINT IS GONE AT `all` (design round 2, D6/D7): the sentence says
		 * older rows are HIDDEN, and at the full ladder nothing is - the panel was
		 * still claiming a filter the board had stopped applying, on the very
		 * control "Show all time" had just handed the caret back to. Asserted as
		 * the ABSENCE, through both doors, after a wait longer than the
		 * primitive's open delay: an unconditional copy cannot come back unnoticed.
		 */
		const control = need<HTMLElement>(
			'[data-tour-tag="projects-board-window"]',
		);
		const panel = (): string =>
			document.querySelector("[data-lo-tooltip-panel]")?.textContent ?? "";
		await userEvent.hover(control);
		await new Promise((resolve) => setTimeout(resolve, 1200));
		if (panel().includes(BOARD_WINDOW_HINT)) {
			throw new Error("the window hint still claims rows are hidden at `all`");
		}
		control.focus();
		await new Promise((resolve) => setTimeout(resolve, 1200));
		if (panel().includes(BOARD_WINDOW_HINT)) {
			throw new Error(
				"the window hint claims rows are hidden at `all` on focus",
			);
		}
	}),
};

/**
 * The open panel: five rungs, the check on the current one, the shipped
 * Select panel - the frame the design round reads to confirm the ladder's
 * labels land in the order the model owns.
 */
export const BoardWindowMenuOpen: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_ROWS,
			details: detailsFor(BOARD_WINDOW_ROWS),
		}),
	play: playOnce("board-window-menu-open", async () => {
		await poll(
			() =>
				document.querySelector('[data-tour-tag="projects-board-window"]') !==
				null,
			"the window control",
		);
		await userEvent.click(need('[data-tour-tag="projects-board-window"]'));
		await poll(
			() => document.querySelectorAll('[role="option"]').length === 5,
			"the open panel's five rungs",
		);
		const checked = document.querySelector(
			'[role="option"][data-state="checked"]',
		);
		if (!checked?.textContent?.includes("Last 7 days")) {
			throw new Error(
				`the panel does not check the current window: ${checked?.textContent ?? "(none checked)"}`,
			);
		}
		const labels = [...document.querySelectorAll('[role="option"]')].map(
			(option) => option.textContent?.trim(),
		);
		for (const label of [
			"Last 24 hours",
			"Last 7 days",
			"Last 30 days",
			"Last 90 days",
			"All time",
		]) {
			if (!labels.some((text) => text === label)) {
				throw new Error(`the panel is missing "${label}"`);
			}
		}
	}),
};

/**
 * The narrow floor (800x900): the fixed-width trigger neither shrivels nor
 * wraps - it holds the 144px the memo pins (the primitive's base is `w-full`,
 * so this frame is the override's own proof), its label fits untruncated, and
 * it stays on the switcher's own line.
 */
export const BoardWindowNarrow: Story = {
	render: () =>
		page({
			view: "board",
			projects: BOARD_WINDOW_ROWS,
			details: detailsFor(BOARD_WINDOW_ROWS),
		}),
	play: playOnce("board-window-narrow", async () => {
		await poll(
			() =>
				document.querySelector('[data-tour-tag="projects-board-window"]') !==
				null,
			"the window control",
		);
		const trigger = need<HTMLElement>(
			'[data-tour-tag="projects-board-window"]',
		);
		const width = trigger.getBoundingClientRect().width;
		if (Math.abs(width - 144) > 1) {
			throw new Error(
				`the trigger is ${width}px wide, not the fixed 144 (the w-full override regressed)`,
			);
		}
		const label = trigger.querySelector<HTMLElement>("span");
		if (!label) throw new Error("the trigger has no label span");
		if (label.scrollWidth > label.clientWidth + 0.5) {
			throw new Error("the trigger's label is truncated");
		}
		const switcher = need<HTMLElement>(
			'[data-tour-tag="projects-view-switcher"]',
		);
		if (
			Math.abs(
				switcher.getBoundingClientRect().top -
					trigger.getBoundingClientRect().top,
			) > 2
		) {
			throw new Error(
				"the switcher row wrapped: the control left the switcher's line",
			);
		}
	}),
};

/**
 * The store-empty state: "No projects yet." with the window control ABSENT -
 * the visibility rule's other half (a window over nothing has nothing to
 * widen).
 */
export const BoardWindowNoProjects: Story = {
	render: () => page({ view: "board" }),
	play: playOnce("board-window-no-projects", async () => {
		await poll(
			() => (document.body.textContent ?? "").includes("No projects yet."),
			"the store-empty state",
		);
		if (
			document.querySelector('[data-tour-tag="projects-board-window"]') !== null
		) {
			throw new Error(
				"the window control is visible over the store-empty state",
			);
		}
	}),
};

/* --------------------------------------------------------- title tooltip -- */

/**
 * The tooltip fixture: one title that outruns a board column and one that
 * fits, so the story can assert BOTH halves of the rule - the clipped title
 * gets the reveal and the tab stop; the whole one gets neither.
 */
const TITLE_LONG_ROW = project("t1", "gateway-migration", {
	title: "Split the payments gateway onto the new reconciliation service",
	team: "platform",
	updated_at: FIXTURE_NOW_MS / 1000 - 3 * HOUR_S,
	progress_stale: false,
	progress_updated_at: FIXTURE_NOW_MS / 1000 - 3 * HOUR_S,
});
const TITLE_SHORT_ROW = project("t2", "dashboard-qa", {
	title: "Dashboard QA",
	team: "platform",
	updated_at: FIXTURE_NOW_MS / 1000 - 4 * HOUR_S,
	progress_stale: false,
	progress_updated_at: FIXTURE_NOW_MS / 1000 - 4 * HOUR_S,
});

/**
 * A clipped card title reveals its full text - on hover AND on keyboard focus
 * (operator, 2026-09-30). The play proves the state first (the long span is
 * really clipped, the short one is not), then opens the reveal BOTH ways -
 * `userEvent.hover` for the pointer path, then focus for the keyboard path,
 * which is the state the shutter lands on - and checks the short-titled card
 * carries neither the panel nor the extra tab stop.
 */
export const BoardTitleTooltip: Story = {
	render: () =>
		page({
			view: "board",
			projects: [TITLE_LONG_ROW, TITLE_SHORT_ROW],
			details: detailsFor([TITLE_LONG_ROW, TITLE_SHORT_ROW]),
		}),
	play: playOnce("board-title-tooltip", async () => {
		await poll(
			() =>
				document.querySelector('[data-project-title="gateway-migration"]') !==
				null,
			"the long-titled card",
		);
		const long = need<HTMLElement>('[data-project-title="gateway-migration"]');
		const short = need<HTMLElement>('[data-project-title="dashboard-qa"]');
		/* The story photographs the state the feature exists for. */
		if (long.scrollWidth - long.clientWidth <= 0.5) {
			throw new Error(
				"the long title is not clipped - this story would prove nothing",
			);
		}
		if (short.scrollWidth - short.clientWidth > 0.5) {
			throw new Error(
				"the short title is clipped - the fixture no longer discriminates",
			);
		}
		/* The tab stop is REACT state behind the measurement effect, so it can
		 * trail the DOM truth by a frame or two under capture load - measured
		 * 2026-10-01: two sweeps of this family died here, one at `dune` and
		 * one at `localOperatorDark`, while the DOM itself reported the title
		 * clipped both times. Wait for the state instead of failing the story:
		 * the assertion stands (a title that never becomes focusable still
		 * fails), only the race goes. */
		await poll(() => long.tabIndex === 0, "the clipped title's tab stop");
		if (short.hasAttribute("tabindex")) {
			throw new Error("the unclipped title grew a tab stop");
		}
		/* The pointer path: hover the clipped title, the panel appears. */
		await userEvent.hover(long);
		await poll(
			() =>
				(
					document.querySelector("[data-lo-tooltip-panel]")?.textContent ?? ""
				).includes("Split the payments gateway"),
			"the tooltip on hover",
		);
		/*
		 * The keyboard path, which is the state the shutter lands on: focus alone
		 * must open the panel (Radix opens on focus as well as hover).
		 */
		/*
		 * The pointer path, then THE PANEL MUST LEAVE WITH THE POINTER (QA round 1,
		 * Q1): the primitive's default keeps the panel painted after the trigger
		 * is left (measured 12s+, because a close waits for the pointer to enter a
		 * panel that is `pointer-events: none`), which is why this call site
		 * passes `disableHoverableContent`. The frame that proves it is the ABSENCE
		 * of the panel after `unhover`, so it is asserted before the keyboard half
		 * opens it again.
		 */
		await userEvent.hover(long);
		await poll(
			() =>
				(
					document.querySelector("[data-lo-tooltip-panel]")?.textContent ?? ""
				).includes("Split the payments gateway"),
			"the tooltip on hover",
		);
		await userEvent.unhover(long);
		await poll(
			() =>
				!(
					document.querySelector("[data-lo-tooltip-panel]")?.textContent ?? ""
				).includes("Split the payments gateway"),
			"the tooltip to close when the pointer leaves the title",
		);
		/*
		 * The keyboard path, which is the state the shutter lands on: focus alone
		 * must open the panel (Radix opens on focus as well as hover), so the
		 * close-on-leave above did not disable dismissal.
		 */
		long.focus();
		await poll(
			() =>
				(
					document.querySelector("[data-lo-tooltip-panel]")?.textContent ?? ""
				).includes("Split the payments gateway"),
			"the tooltip on focus",
		);
	}),
};

/**
 * The timeline: bars, milestone diamonds in all three states, today marker.
 *
 * ONE ROW CARRIES A TITLE (agent review R1-1): the titled copy is story-local
 * — no other surface's fixture or frame moves with it — and the play asserts
 * the row reads the title while `data-project-name` keeps the key, the same
 * split the board and the list assert on their own titled fixtures.
 */
export const Timeline: Story = {
	render: () => (
		<>
			<HoldUntilPresent text="without dates" />
			{page({
				view: "timeline",
				projects: [
					{ ...THREE[0], title: "Payments migration" },
					THREE[1],
					THREE[2],
				],
				details: detailsFor(THREE),
			})}
		</>
	),
	play: playOnce("timeline", async () => {
		/*
		 * ROWS BIND `project.name` (agent review R1-1, QA round 1, Q1): the row
		 * hook is the project's NAME — `payments-migration` — not its id; the
		 * first cut of this poll looked for `p1`, which no row ever carries, so
		 * the assertion never ran. It polls the name now and reads it back.
		 */
		await poll(
			() =>
				document.querySelector('[data-project-name="payments-migration"]') !==
				null,
			"the titled timeline row",
		);
		const row = document.querySelector<HTMLElement>(
			'[data-project-name="payments-migration"]',
		);
		if (!row || !row.textContent.includes("Payments migration")) {
			throw new Error(
				"the timeline's titled row does not show its title (R1-1's case)",
			);
		}
		if (row.dataset.projectName !== "payments-migration") {
			throw new Error(
				"the timeline row's data-project-name is not the key anymore",
			);
		}
	}),
};

/** No project carries a date: the honest empty axis, not fabricated rows. */
export const TimelineNoDates: Story = {
	render: () => (
		<>
			<HoldUntilPresent text="without dates" />
			{page({
				view: "timeline",
				projects: [
					project("u1", "papercuts", { description: "Small fixes" }),
					project("u2", "onboarding-notes", { status: "paused" }),
				],
				details: {
					u1: detailFor(project("u1", "papercuts")),
					u2: detailFor(project("u2", "onboarding-notes")),
				},
			})}
		</>
	),
};

/**
 * A passed target and an overdue milestone, with one undated project landing
 * in the trailing "no dates" section.
 */
export const TimelineOverdue: Story = {
	render: () => {
		const overdue = project("o1", "release-prep", {
			status: "active",
			start_date: "2026-08-20",
			target_date: "2026-09-15",
			estimate: 8,
			milestones_completed: 0,
			milestones_total: 1,
		});
		const undated = project("u1", "papercuts", { description: "Small fixes" });
		return (
			<>
				<HoldUntilPresent text="without dates" />
				{page({
					view: "timeline",
					projects: [overdue, undated],
					details: {
						o1: detailFor(overdue, [
							{
								name: "cut rc",
								target_date: "2026-09-14",
								completed_at: null,
								status: "overdue",
							},
						]),
						u1: detailFor(undated),
					},
				})}
			</>
		);
	},
};

/* ------------------------------------------------- request update (PR-B) */

/*
 * The check-in states: the board card's new menu item and the detail header's
 * button run ONE flow (one window, one set of sentences), so these frames are
 * raised from the same `projects.request_update` fixture answered in the
 * route's own vocabulary. `hang` is the sending state's honest shape (the
 * promise is held open, exactly as a slow route holds it); every other state
 * resolves with its per-session rows and lets the REAL flow compose the card.
 */

const REQUEST_SESSION = (
	session_id: string,
	title: string | null,
	outcome: DesktopProjectRequestUpdateResult["sessions"][number]["outcome"],
	detail = "",
): DesktopProjectRequestUpdateResult["sessions"][number] => ({
	session_id,
	title,
	outcome,
	detail,
});

/** The three engaged links of `DETAIL`'s fixture, all delivered. */
const REQUEST_DELIVERED: DesktopProjectRequestUpdateResult["sessions"] = [
	REQUEST_SESSION("4e92693767fa", "Payments cutover", "delivered"),
	REQUEST_SESSION("a1a1a1a1a1a1", "API parity checks", "delivered"),
	REQUEST_SESSION("c3c3c3c3c3c3", "Old cutover notes", "delivered"),
];

/** The detail screen at `/projects/p1` with one scripted check-in answer. */
const detailWithRequestUpdate = (
	requestUpdate: RequestUpdateFixture,
	detail: DesktopProjectDetail = DETAIL,
) => (
	<RouteTo path="/projects/p1">
		{page({ projects: THREE, detail, requestUpdate })}
	</RouteTo>
);

const requestUpdateButton = () =>
	document.querySelector<HTMLElement>(
		'[data-tour-tag="project-request-update"]',
	);

/**
 * The press that never answers: the button holds `Requesting…` and the
 * >400 ms loading card appears (and stays, because nothing supersedes it).
 */
export const DetailRequestUpdateSending: Story = {
	render: () => detailWithRequestUpdate({ state: "sent", hang: true }),
	play: playOnce("detail-request-update-sending", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() => (document.body.textContent ?? "").includes("Requesting updates…"),
			"the loading card",
		);
		await poll(
			() => requestUpdateButton()?.getAttribute("aria-busy") === "true",
			"the button to report busy",
		);
	}),
};

/**
 * The window after a delivered batch, the success card already retired: the
 * DURABLE half of the state - the label says the request went out.
 */
export const DetailRequestUpdateCooldown: Story = {
	render: () =>
		detailWithRequestUpdate({ state: "sent", sessions: REQUEST_DELIVERED }),
	play: playOnce("detail-request-update-cooldown", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() => (requestUpdateButton()?.textContent ?? "").trim() === "Requested",
			"the button to hold its Requested label",
		);
		await poll(
			() => document.querySelector("[data-sonner-toast]") === null,
			"the success card to auto-close",
		);
	}),
};

/** The success card, while the batch's window is armed. */
export const RequestUpdateSuccess: Story = {
	render: () =>
		detailWithRequestUpdate({ state: "sent", sessions: REQUEST_DELIVERED }),
	play: playOnce("request-update-success", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Requested updates from 3 sessions on Payments migration.",
				),
			"the success card",
		);
	}),
};

/**
 * A partial batch, both clauses in one card: one refusal ("could not be
 * reached") and one unconfirmed delivery ("could not be confirmed") - the
 * uncertainty the peer layer's own warning keeps, never collapsed into the
 * failure wording (UX freeze condition U1).
 */
export const RequestUpdatePartial: Story = {
	render: () =>
		detailWithRequestUpdate({
			state: "sent",
			sessions: [
				REQUEST_SESSION("4e92693767fa", "Payments cutover", "delivered"),
				REQUEST_SESSION("c3c3c3c3c3c3", "Old cutover notes", "failed", "stale"),
				REQUEST_SESSION(
					"a1a1a1a1a1a1",
					"API parity checks",
					"unconfirmed",
					"delivery could not be confirmed",
				),
			],
		}),
	play: playOnce("request-update-partial", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Old cutover notes could not be reached.",
				) &&
				(document.body.textContent ?? "").includes(
					"Delivery to API parity checks could not be confirmed.",
				),
			"the partial card's failure and uncertainty clauses",
		);
	}),
};

/** Every dial refused: the generic sentence, and no window is armed. */
export const RequestUpdateAllFailed: Story = {
	render: () =>
		detailWithRequestUpdate({
			state: "sent",
			sessions: [
				REQUEST_SESSION("4e92693767fa", "Payments cutover", "failed", "stale"),
				REQUEST_SESSION(
					"a1a1a1a1a1a1",
					"API parity checks",
					"failed",
					"no longer exists",
				),
				REQUEST_SESSION(
					"c3c3c3c3c3c3",
					"Old cutover notes",
					"failed",
					"not started yet",
				),
			],
		}),
	play: playOnce("request-update-all-failed", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Could not reach any of the 3 linked sessions on Payments migration.",
				),
			"the all-failed card",
		);
	}),
};

/**
 * Zero-delivery uncertainty (design round 2, D1): nobody refused and nobody
 * confirmed, so the card asserts nothing about arrival - the longest pure
 * sentence the vocabulary can produce, and one a string assertion cannot
 * settle the wrap of.
 */
export const RequestUpdateAllUnconfirmed: Story = {
	render: () =>
		detailWithRequestUpdate({
			state: "sent",
			sessions: [
				REQUEST_SESSION(
					"a1a1a1a1a1a1",
					"API parity checks",
					"unconfirmed",
					"delivery could not be confirmed",
				),
				REQUEST_SESSION(
					"b2b2b2b2b2b2",
					"Cutover notes",
					"unconfirmed",
					"delivery could not be confirmed",
				),
			],
		}),
	play: playOnce("request-update-all-unconfirmed", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Could not confirm delivery on Payments migration — the requests may still reach its sessions.",
				),
			"the all-unconfirmed card",
		);
	}),
};

/**
 * The mixed zero-delivery end (design round 2, D1): one refusal and one
 * uncertainty, nothing delivered - the other longest title, whose wrap the
 * design asked to settle with a still.
 */
export const RequestUpdateMixedZeroDelivery: Story = {
	render: () =>
		detailWithRequestUpdate({
			state: "sent",
			sessions: [
				REQUEST_SESSION("c3c3c3c3c3c3", "Old cutover notes", "failed", "stale"),
				REQUEST_SESSION(
					"a1a1a1a1a1a1",
					"API parity checks",
					"unconfirmed",
					"delivery could not be confirmed",
				),
			],
		}),
	play: playOnce("request-update-mixed-zero-delivery", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Could not reach 1 of the 2 linked sessions on Payments migration.",
				) &&
				(document.body.textContent ?? "").includes(
					"Delivery to API parity checks could not be confirmed.",
				),
			"the mixed zero-delivery card",
		);
	}),
};

/**
 * A project whose links were never engaged: the batch cannot be delivered to
 * any of them, and the copy names the fix instead of sending the user to a
 * control they already used (UX freeze condition U2).
 */
export const RequestUpdateNeverStarted: Story = {
	render: () =>
		detailWithRequestUpdate({
			state: "sent",
			sessions: [
				REQUEST_SESSION(
					"4e92693767fa",
					"Payments cutover",
					"failed",
					REQUEST_UPDATE_NEVER_STARTED_DETAIL,
				),
				REQUEST_SESSION(
					"a1a1a1a1a1a1",
					"API parity checks",
					"failed",
					REQUEST_UPDATE_NEVER_STARTED_DETAIL,
				),
				REQUEST_SESSION(
					"c3c3c3c3c3c3",
					"Old cutover notes",
					"failed",
					REQUEST_UPDATE_NEVER_STARTED_DETAIL,
				),
			],
		}),
	play: playOnce("request-update-never-started", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"The 3 linked sessions have not started yet",
				),
			"the never-started card",
		);
	}),
};

/** No links at all: the card names the next action, and nothing is dialled. */
export const RequestUpdateEmpty: Story = {
	render: () =>
		detailWithRequestUpdate({ state: "empty" }, { ...DETAIL, links: [] }),
	play: playOnce("request-update-empty", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"No linked sessions to ask. Link a session to Payments migration first.",
				),
			"the empty card",
		);
	}),
};

/**
 * The route's own window: this press dialled nothing (another client asked
 * first), the card says how long is left, and the button arms from the
 * server's numbers so the two doors still agree.
 */
export const RequestUpdateCooldown: Story = {
	render: () =>
		detailWithRequestUpdate({
			state: "cooldown",
			cooldown_remaining_s: 40,
			requested_at: new Date(FIXTURE_NOW_MS - 20_000).toISOString(),
		}),
	play: playOnce("request-update-cooldown", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-request-update"]');
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Update already requested 20 s ago on Payments migration. Try again in 40 s.",
				),
			"the cooldown card",
		);
	}),
};

/**
 * The card menu's KEYBOARD path, end to end: open with Enter, walk to the item
 * by its own highlight, commit it - and assert the focus RETURN while the
 * request is still in flight (U5): the caret must land back on the trigger the
 * moment the menu closes, because a caret on `body` restarts the next Tab at
 * the top of the page. The frame is the select's settled state (menu closed,
 * card focused, the batch's card up).
 */
export const BoardRequestUpdateKeyboard: Story = {
	render: () =>
		page({
			view: "board",
			projects: THREE,
			details: detailsFor(THREE),
			requestUpdate: { state: "sent", sessions: REQUEST_DELIVERED },
		}),
	play: playOnce("board-request-update-keyboard", async () => {
		const selector = '[data-project-menu="p1"]';
		await poll(() => document.querySelector(selector) !== null, selector);
		const trigger = need<HTMLElement>(selector);
		trigger.focus();
		await userEvent.keyboard("{Enter}");
		await poll(
			() => document.querySelectorAll('[role="menuitem"]').length >= 4,
			"the card menu",
		);
		/* Walk to the item by its own highlight rather than by a press count,
		 * so a reordered menu cannot silently retarget the gesture. */
		for (let attempt = 0; attempt < 6; attempt += 1) {
			const highlighted = document.querySelector(
				'[role="menuitem"][data-highlighted]',
			);
			if (highlighted?.textContent?.includes("Request update")) break;
			await userEvent.keyboard("{ArrowDown}");
		}
		await poll(
			() =>
				document
					.querySelector('[role="menuitem"][data-highlighted]')
					?.textContent?.includes("Request update") === true,
			"the Request update item to highlight",
		);
		await userEvent.keyboard("{Enter}");
		await poll(
			() =>
				document.activeElement === trigger &&
				document.querySelectorAll('[role="menuitem"]').length === 0,
			"focus back on the trigger after the select",
		);
		await poll(
			() =>
				(document.body.textContent ?? "").includes(
					"Requested updates from 3 sessions on Payments migration.",
				),
			"the batch to land",
		);
	}),
};
/**
 * The no-dates callout, expanded over a dated chart: the collapsed line
 * (`2 projects without dates`) opens to the two names as buttons that still
 * open their project. The panel is bounded (`max-h-24`, scrolling) because the
 * list it replaces was the unbounded one the design retired.
 */
export const TimelineCalloutExpanded: Story = {
	render: () => {
		const dated = project("d1", "release-prep", {
			start_date: "2026-08-20",
			target_date: "2026-09-15",
		});
		const undated = project("u1", "papercuts", { description: "Small fixes" });
		const other = project("u2", "onboarding-notes", { status: "paused" });
		return (
			<>
				<HoldUntilPresent text="without dates" />
				{page({
					view: "timeline",
					projects: [dated, undated, other],
					details: {
						d1: detailFor(dated),
						u1: detailFor(undated),
						u2: detailFor(other),
					},
				})}
			</>
		);
	},
	play: playOnce("timeline-callout-expanded", async () => {
		await clickWhen("[data-project-undated-callout] button");
		await poll(
			() => (document.body.textContent ?? "").includes("papercuts"),
			"the undated names to appear",
		);
	}),
};
