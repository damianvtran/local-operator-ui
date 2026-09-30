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
	DesktopProjectUpdate,
} from "../../../../../shared/desktop-control-contract";
import "../../../styles/index.css";
import {
	PROJECTS_BOARD_ORDER_STORAGE_KEY,
	writeBoardColumnOrder,
} from "../project-model";
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
	/** The listing read fails with this sentence. */
	failList: string | null;
	/** The listing read never settles: the loading frame's only honest shape. */
	hang: boolean;
	/** `projects.update` fails with this sentence (the follow-up-refusal arm). */
	failPatch: string | null;
};

let stub: StubState = {
	projects: [],
	detail: null,
	details: null,
	failList: null,
	hang: false,
	failPatch: null,
};

/**
 * Every create/update the bridge answered, in order, for this render. The
 * submit story asserts the two-phase create (route then follow-up patch)
 * against this record rather than against pixels: a closed dialog proves
 * neither op ran, and a toast is not in the tree.
 */
let bridgeOps: { op: string; request: Record<string, unknown> }[] = [];

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
					// state and has its own story.
					features: { projects: 1, team_catalogue: 1, profile_catalogue: 1 },
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
			bridgeOps.push({ op: request.op, request });
			if (stub.failPatch)
				return { status: 422, body: { detail: stub.failPatch } };
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
 * Wait for the DETAIL screen the route-based stories navigate to.
 *
 * The plays race `RouteTo`'s navigation: the story's first render is the
 * unmatched route (nothing mounted), the swap happens in an effect, and the
 * detail's own query settles after that. Every play on a detail screen waits
 * here first, so its first click targets a control that exists.
 */
const waitForDetail = () =>
	poll(
		() => document.querySelector('[data-tour-tag="project-edit"]') !== null,
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
 * rendering the list under the detail's URL (measured: `project-edit` never
 * appeared while the frame showed the list's own header). Both routes are
 * declared here, matching `app.tsx`'s pair, and the navigation replaces the
 * entry so the history holds one location, as the app's own entry would.
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
	},
) => {
	stub = {
		projects: [],
		detail: null,
		details: null,
		failList: null,
		hang: false,
		failPatch: null,
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
export const Empty: Story = { render: () => page({}) };

/** Loading: the header stays, so nothing jumps when the rows arrive. */
export const Loading: Story = {
	render: () => (
		<>
			<HoldUntilPresent text="Loading projects" />
			{page({ hang: true })}
		</>
	),
};

/** The listing read failed: what happened, and a way back. */
export const LoadError: Story = {
	render: () => (
		<>
			<HoldUntilPresent text="The backend did not answer." />
			{page({ failList: "The backend did not answer." })}
		</>
	),
};

/** Three projects: the list's ordinary shape. */
export const Populated: Story = { render: () => page({ projects: THREE }) };

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
export const NarrowColumns: Story = { render: () => page({ projects: THREE }) };

/** Twelve projects: the list under a scrollbar. */
export const Many: Story = { render: () => page({ projects: MANY }) };

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
	render: () => page({ projects: MANY_LONG }),
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
		await poll(
			() => document.querySelector('[data-tour-tag="project-edit"]') !== null,
			"the detail to render",
		);
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
				) && document.querySelector('[data-tour-tag="project-edit"]') === null,
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
	render: () => page({ projects: THREE }),
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
export const EditDialog: Story = {
	render: () => (
		<RouteTo path="/projects/p1">
			{page({ projects: THREE, detail: DETAIL })}
		</RouteTo>
	),
	play: playOnce("edit-dialog", async () => {
		await waitForDetail();
		await clickWhen('[data-tour-tag="project-edit"]');
		await poll(
			() =>
				document.querySelector('[data-tour-tag="project-edit-dialog"]') !==
				null,
			"the edit dialog",
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
	render: () => page({ projects: THREE }),
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
	render: () => page({ projects: THREE }),
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
	render: () => page({ projects: THREE }),
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
		page({ projects: THREE, failPatch: "The target date must be a real day." }),
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
	render: () => page({ projects: THREE }),
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
