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
};

let stub: StubState = {
	projects: [],
	detail: null,
	details: null,
	failList: null,
	hang: false,
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
			const name = String(request.name ?? "");
			const created = project(`created-${stub.projects.length}`, name, {
				description: String(request.description ?? ""),
			});
			stub.projects = [...stub.projects, created];
			return { status: 200, body: { result: created } };
		}
		case "projects.update":
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
	state: Partial<StubState> & { view?: "list" | "board" | "timeline" },
) => {
	stub = {
		projects: [],
		detail: null,
		details: null,
		failList: null,
		hang: false,
		...state,
	};
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
		await clickWhen('[data-tour-tag="project-delete"]');
		await poll(
			() =>
				document.querySelector('[data-tour-tag="project-delete-dialog"]') !==
				null,
			"the delete dialog",
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
 * An EMPTY column: only active and done hold rows, so the board draws its own
 * "No projects here." line — the state no populated story photographs (design
 * round 1, D8).
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

/** The timeline: bars, milestone diamonds in all three states, today marker. */
export const Timeline: Story = {
	render: () => (
		<>
			<HoldUntilPresent text="without dates" />
			{page({
				view: "timeline",
				projects: THREE,
				details: detailsFor(THREE),
			})}
		</>
	),
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
