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

import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import type {
	DesktopLinkedSession,
	DesktopProject,
	DesktopProjectDetail,
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
		target_date: "2026-10-15",
		estimate: 13,
		milestones_completed: 2,
		milestones_total: 5,
		sessions: 3,
		live_sessions: 2,
		progress_stale: false,
		progress_updated_at: FIXTURE_NOW_MS / 1000 - 2 * HOUR_S,
	}),
	project("p2", "q4-hardening", {
		description: "Error budgets, retries and the load shed",
		status: "paused",
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

const DETAIL: DesktopProjectDetail = {
	project: {
		id: "p1",
		name: "payments-migration",
		description: "Cut the payments API over to the new service",
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
		LINK("a1a1a1a1a1a1", { title: "API parity checks" }),
		LINK("b2b2b2b2b2b2", { exists: false, title: null }),
		LINK("c3c3c3c3c3c3", { title: "Old cutover notes", archived: true }),
	],
};

/** One listing answer, as the route's envelope: `{result: {projects}}`. */
type StubState = {
	projects: DesktopProject[];
	detail: DesktopProjectDetail | null;
	/** The listing read fails with this sentence. */
	failList: string | null;
	/** The listing read never settles: the loading frame's only honest shape. */
	hang: boolean;
};

let stub: StubState = {
	projects: [],
	detail: null,
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
					features: { projects: 1 },
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
		case "projects.get":
			if (!stub.detail)
				return { status: 404, body: { detail: "no such project" } };
			return { status: 200, body: { result: stub.detail } };
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

const installBridge = () => {
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: Parameters<typeof answer>[0]) => unknown };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: answer };
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
	for (let attempt = 0; attempt < 100; attempt++) {
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
const page = (state: Partial<StubState>) => {
	stub = {
		projects: [],
		detail: null,
		failList: null,
		hang: false,
		...state,
	};
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
		 * THE NATIVE SETTER, not `input.value = …`. React installs its own value
		 * tracker on the element, so a plain assignment makes the tracker and the
		 * property agree and React therefore sees NO change — the state never
		 * updates and the frame photographs a typed-looking field with the button
		 * still disabled. Measured: the first capture of this state showed exactly
		 * that. The prototype setter moves the value past the tracker, and the
		 * bubbling `input` event is the one React listens for.
		 */
		const setter = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set;
		setter?.call(input, "payments-migration");
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await poll(
			() =>
				[
					...document.querySelectorAll<HTMLButtonElement>(
						'[data-tour-tag="project-delete-dialog"] button',
					),
				].some(
					(button) =>
						!button.disabled &&
						button.textContent?.includes("Delete project") === true,
				),
			"the delete button to enable",
		);
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
