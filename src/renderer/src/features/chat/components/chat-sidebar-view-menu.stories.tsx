/**
 * The surfaces design round 3's D28 found with no rendered frame: the view
 * POPOVER, the page LADDER, the section caps' `Show N more` feet, an expanded
 * entity group, the band's hover tooltips, and the sidebar's own voice on a
 * route where the status strip is not mounted.
 *
 * ## Why a file of its own, beside `chat-sidebar-sections.stories.tsx`
 *
 * That file photographs the SPLIT - the boundary, its collapse controls and the
 * restore row. This one photographs the CONTROLS' results and the states the
 * round named: every story below is a state the operator asked for verbatim
 * ("starts with 10, then 25, then 50", "showing and hiding sections,
 * reordering", "limit how far a collapsible section can expand"), and the
 * design round's finding was that not one of them had a frame to be judged on.
 *
 * ## What each group of stories is, and what it cannot say
 *
 *   - **The popover frames** are DRIVEN, not seeded: the play opens the real
 *     Radix popover with a real press on the band's `View options` button (and,
 *     for the two states, presses the controls inside it), so a frame is the
 *     panel the app draws after a gesture rather than a prop summary. What they
 *     cannot show: the pointer's own hover state on a row (the rig's `hover`
 *     entries exist for that, and the band's are below).
 *   - **The ladder and cap frames** are story states over the sidebar's own
 *     fixtures, with the region scrolled by the capture rig (`scrollToEnd`),
 *     because a scroller's position is browser state no story can set. The
 *     readout beside each panel prints the numbers the frame is read for - the
 *     stored `loads`, the drawn row count and the foot's own copy - read back
 *     from the DOM, so a frame cannot claim a rung the panel is not on.
 *   - **The off-route voice** is R11's route (agent review round 2): the strip
 *     lives in the conversation pane and this sidebar is on every route, so on
 *     a route with no strip mounted the sidebar keeps its own voice. A story
 *     cannot mount the strip at all, and the readout prints the presence flag
 *     the gate actually reads (`chatStatusStripPresent()`), so the claim "the
 *     sidebar speaks where the strip is not" is checkable in the frame instead
 *     of assumed from the story being a sidebar.
 *
 * ## The fixture, and the one state it deliberately does not take
 *
 * The real `ChatSidebar`, its real reads and its real popover. `window.api` is
 * stubbed below: `desktop.request` answers the five reads this surface makes
 * (`capabilities`, `sessions.list`, `profiles.list`, `teams.list`) and refuses
 * anything else BY NAME, and `backend.getStatus` answers a snapshot this file
 * controls - so no story depends on (or probes) a daemon outside the frame, and
 * the offline state is a stated seed rather than a race with a real server.
 */

import { serverHealthQueryKey, useServerHealth } from "@shared/hooks";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent } from "@storybook/test";
import { useQueryClient } from "@tanstack/react-query";
import { type FC, useEffect, useState } from "react";
import type { DaemonStatusSnapshot } from "../../../../../shared/backend-status";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import { DEFAULT_SIDEBAR_VIEW } from "../chat-sidebar-view";
import { chatStatusStripPresent } from "../chat-status-presence";
import { ChatSidebar } from "./chat-sidebar";

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = {
	op: string;
	q?: string;
};

/** One row in `sessions.list`'s own wire field names, as the backend sends it. */
type WireRow = {
	id: string;
	name: string;
	mtime: number;
	preview: string;
	live_state: string;
	pending: string | null;
	active: boolean;
	pinned?: boolean;
	binding: { agent: string | null; team: string | null };
	status: { code: string; label: string };
	status_revision: number;
	status_epoch: string;
	/**
	 * When the conversation was born, in epoch seconds - the second clock on this
	 * row (`SessionCatalogueRow.created_at`). Optional because a backend that
	 * predates the field does not send it; the Created basis reads it.
	 */
	created_at?: number;
};

const EPOCH = "3f2a1b4c5d6e7f8091a2b3c4d5e6f708";

const row = (
	id: string,
	name: string,
	mtime: number,
	over: Partial<WireRow> = {},
): WireRow => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: true,
	binding: { agent: null, team: null },
	status: { code: "idle", label: "Recent" },
	status_revision: 1,
	status_epoch: EPOCH,
	...over,
});

/**
 * `mtime` is the backend's own Python float in SECONDS (`chat-list-sections.ts`
 * carries the mapping), so the ages below are seconds from now.
 */
const NOW_SECONDS = () => Math.floor(Date.now() / 1000);

/**
 * The ladder's roster, sized so each rung's foot names the NEXT rung rather
 * than a remainder: at 10 drawn the step is 15 (toward 25), at 25 it is 25
 * (toward 50), at 50 it is 50 (toward 100) - the operator's contract, "starts
 * with 10, then 25, then 50, and then user can click to load more", with more
 * left than any rung can spend.
 *
 * The first rows are newest (they land in TODAY), a band sits a few days back
 * (THIS WEEK) and the rest run older - so every ladder frame also shows the
 * sections the redesign draws, not one flat list.
 */
const bigRoster = (count: number): WireRow[] =>
	Array.from({ length: count }, (_, index) => {
		const ageSeconds =
			index < 4 ? index * 600 : index < 36 ? index * 7_200 : index * 86_400;
		return row(
			`ladder-${String(index).padStart(4, "0")}`,
			`Conversation ${index + 1}`,
			NOW_SECONDS() - ageSeconds,
			index === 0
				? {
						status: { code: "busy", label: "Working" },
						status_revision: 3,
					}
				: {},
		);
	});

/**
 * The roster an expanded group is photographed on: four conversations bound to
 * `coder`, one to `reviewer`, so the open group has rows of its own and the
 * closed sibling sits beside it for the contrast.
 */
const groupRoster = (): WireRow[] => {
	const rows: WireRow[] = [
		row("group-0001", "Wire the parser to the ledger", NOW_SECONDS() - 900, {
			binding: { agent: "coder", team: null },
		}),
		row("group-0002", "Split the reducer in two", NOW_SECONDS() - 7_200, {
			binding: { agent: "coder", team: null },
		}),
		row("group-0003", "Draft the migration note", NOW_SECONDS() - 86_400, {
			binding: { agent: "coder", team: null },
		}),
		row("group-0004", "Tidy the fixtures again", NOW_SECONDS() - 3 * 86_400, {
			binding: { agent: "coder", team: null },
		}),
		row("group-0005", "Reviewer rollout notes", NOW_SECONDS() - 2_000, {
			binding: { agent: "reviewer", team: null },
		}),
	];
	return rows;
};

const PROFILES = [
	{ name: "coder", kind: "role", source: "installed" },
	{ name: "reviewer", kind: "role", source: "installed" },
	{ name: "architect", kind: "role", source: "installed" },
];

/** Eleven installed agents, so the agents section exceeds its own cap of eight. */
const agentsOverCap = () =>
	Array.from({ length: 11 }, (_, index) => ({
		name: index === 0 ? "coder" : `agent-${index + 1}`,
		kind: "role",
		source: "installed",
	}));

const profile = ({
	name,
	kind,
	source,
}: { name: string; kind: string; source: string }) => ({
	name,
	kind,
	source,
	agent_id: source === "builtin" ? null : `agent-${name}`,
	description: `${name} — reusable instructions for this role.`,
	tools: null,
	effort: null,
	delegate: false,
	seed_origin: source === "installed" ? name : null,
	divergent_fields: [],
});

/**
 * Per-story fixture knobs, reset by every story's `render` so no frame
 * inherits the previous story's answers - the rig shares one profile across a
 * capture run, which is the same leakage the persisted stores have.
 */
let roster: WireRow[] = [];
let profilesList: { name: string; kind: string; source: string }[] = PROFILES;
let teamsList: string[] = ["release-crew", "docs-pod"];
/** `capabilities` answers OK until this flips (the off-route voice story). */
let capabilitiesFail = false;
/** `sessions.list` answers OK until this flips (the off-route voice story). */
let sessionsFail = false;
/** What `backend.getStatus` answers: attached is the healthy default. */
let backendState: "attached" | "detached" = "attached";

const statusSnapshot = (
	state: "attached" | "detached",
): DaemonStatusSnapshot => ({
	state,
	reconnecting: false,
	owned: false,
	url: state === "attached" ? "http://127.0.0.1:1131" : null,
	instanceId: null,
	pid: null,
	version: null,
	prefix: null,
	installKind: null,
	desktopAvailable: state === "attached",
	pairing:
		state === "attached"
			? { available: true, cause: null }
			: { available: false, cause: "unpaired" },
	failures: state === "attached" ? 0 : 3,
	capabilityStatus: null,
	unanswered: 0,
	lastTransportAt: state === "attached" ? Date.now() : null,
	detail:
		state === "attached"
			? "Attached to the daemon this app started with."
			: "The daemon stopped answering.",
	addressSubstitution: null,
	updatedAt: Date.now(),
});

const bridge = () => {
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const handler = async (request: BridgeRequest): Promise<DesktopResponse> => {
		switch (request.op) {
			case "capabilities":
				if (capabilitiesFail)
					throw new Error(
						"The backend could not complete this request. Check its connection and try again.",
					);
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						session_catalogue: 2,
						profile_catalogue: 1,
						team_catalogue: 1,
						session_pins: 1,
					},
				});
			case "sessions.list":
				if (sessionsFail) throw new Error("Failed to fetch");
				return ok({ sessions: roster, truncated: false });
			case "profiles.list":
				return ok({ profiles: profilesList.map(profile) });
			case "teams.list":
				return ok({
					teams: teamsList.map((name) => ({
						id: name,
						name,
						description: "",
						manager: "coder",
						members: [],
					})),
				});
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
			backend?: { getStatus: () => Promise<DaemonStatusSnapshot> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: handler };
	api.backend = { getStatus: async () => statusSnapshot(backendState) };
};

/* ------------------------------------------------------------- the states */

/**
 * Every persisted field a story can move, written on every call - including
 * the ones the state does not use - because both stores persist: a story that
 * set only one field would inherit the previous story's answer for the others.
 */
const view = (over: Partial<typeof DEFAULT_SIDEBAR_VIEW> = {}) => {
	useUiPreferencesStore.setState({
		chatSidebarView: { ...DEFAULT_SIDEBAR_VIEW, ...over },
	});
};

/** The split is held at its shipped shape for every frame in this file. */
const split = () => {
	useUiPreferencesStore.setState({
		chatSidebarRegions: "both",
		chatSidebarListHeight: null,
		chatSidebarOrder: "entities-first",
	});
};

/** The disclosure record the entity region reads at mount (localStorage-backed). */
const disclosures = (open: Record<string, boolean>) => {
	localStorage.setItem("chat-sidebar-disclosures", JSON.stringify(open));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the DOM says what the story is about, rather than for a fixed lag. */
const waitFor = async (predicate: () => boolean, timeoutMs = 8_000) => {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate()) return;
		await sleep(50);
	}
	throw new Error("the fixture never reached the state this story photographs");
};

const chatRows = () =>
	document.querySelectorAll(
		'[data-sidebar-region="chats"] [data-tour-tag="chat-session-row"]',
	).length;

/** The drawn column, top to bottom, as session ids. */
const drawnRowIds = () =>
	[
		...document.querySelectorAll<HTMLElement>(
			'[data-sidebar-region="chats"] [data-session-row]',
		),
	].map((el) => el.dataset.sessionRow ?? "");

const press = async (selector: string) => {
	const element = document.querySelector<HTMLElement>(selector);
	if (!element)
		throw new Error(`no control for \`${selector}\` - the story never drew it`);
	await userEvent.click(element);
};

const panelOpen = () =>
	waitFor(() => {
		const panel = document.querySelector<HTMLElement>(
			"[data-sidebar-view-panel]",
		);
		return Boolean(panel && panel.getBoundingClientRect().height > 0);
	});

/**
 * The kill, as a component because the query client is a hook.
 *
 * `OffRouteVoice` needs the daemon to die MID-SESSION - reads that already
 * answered once, then a failed re-read - and the re-reads are query work, so
 * the flip cannot live in a play function (a plain async function has no
 * access to the client). This installs the gesture the play calls instead: flip
 * the fixture flags, invalidate the capabilities query (its failed refetch is
 * what draws the list-pane paragraph), re-ask the store's catalogue read (what
 * draws the foot line) and invalidate the health probe (so the snapshot the
 * gate reads is the detached one the frame claims). It renders nothing.
 */
const KillSwitch: FC = () => {
	const client = useQueryClient();
	useEffect(() => {
		(globalThis as { __flipToDead?: () => void }).__flipToDead = () => {
			capabilitiesFail = true;
			sessionsFail = true;
			backendState = "detached";
			void client.invalidateQueries({ queryKey: ["desktop", "capabilities"] });
			void client.invalidateQueries({ queryKey: serverHealthQueryKey });
			void useCanonicalSessionsStore.getState().fetchSessions();
		};
	}, [client]);
	return null;
};

/* --------------------------------------------------------------- the page */

/**
 * The readout beside each panel, read back from the DOM every 250ms rather
 * than typed by hand: the stored view, the rows drawn, the feet's own copy,
 * the panel's checks, the strip's presence flag and whether the server reads
 * as offline - the facts a frame in this file is read for. It is a caption
 * for the evidence, in the idiom `chat-sidebar-sections.stories.tsx` uses.
 */
const Readout = () => {
	const stored = useUiPreferencesStore((state) => state.chatSidebarView);
	const health = useServerHealth();
	const [lines, setLines] = useState<string[]>([]);
	useEffect(() => {
		const text = (el?: Element | null) =>
			(el?.textContent ?? "").replace(/\s+/g, " ").trim();
		const sample = () => {
			const pageMore = document.querySelector("[data-sidebar-page-more]");
			const sectionFeet = [
				...document.querySelectorAll<HTMLElement>(
					"[data-sidebar-section-more]",
				),
			].map((el) => `${el.dataset.sidebarSectionMore}: "${text(el)}"`);
			const panel = document.querySelector("[data-sidebar-view-panel]");
			/*
			 * D2's own proof, in the frame: the panel's box measured against the
			 * viewport, and whether its content overflows the box. The defect the
			 * 800x600 capture found was a box running PAST the viewport edge with
			 * nothing scrolling; the remedy is a box that stays inside the window
			 * with the content taller than it - so both numbers are read here
			 * rather than judged from the pixels.
			 */
			const panelGeometry = (el: Element) => {
				const rect = el.getBoundingClientRect();
				const node = el as HTMLElement;
				return `box ${Math.round(rect.width)}x${Math.round(rect.height)} · bottom ${Math.round(rect.bottom)}/${window.innerHeight} · content ${node.scrollHeight}${
					node.scrollHeight > node.clientHeight + 1 ? " (scrolls)" : ""
				}`;
			};
			const checks = [
				...document.querySelectorAll<HTMLElement>(
					"[data-sidebar-view-section]",
				),
			].map(
				(el) =>
					`${el.dataset.sidebarViewSection}=${el.getAttribute("aria-checked")}`,
			);
			const orderNow = [
				...document.querySelectorAll<HTMLElement>(
					"[data-sidebar-view-section]",
				),
			].map((el) => el.dataset.sidebarViewSection);
			const basisChecks = [
				...document.querySelectorAll<HTMLElement>("[data-sidebar-view-basis]"),
			].map(
				(el) =>
					`${el.dataset.sidebarViewBasis}=${el.getAttribute("aria-checked")}`,
			);
			const retryRefresh = [...document.querySelectorAll("button")].filter(
				(el) => text(el) === "Retry refresh",
			).length;
			const next = [
				`Stored view: ${stored.groupBy}/${stored.basis}/${stored.orderBy} · hidden [${stored.hidden.join(", ")}] · loads ${stored.loads}`,
				`Drawn: ${chatRows()} chat row(s)`,
				pageMore ? `Page foot: “${text(pageMore)}”` : "Page foot: (none)",
				sectionFeet.length
					? `Section feet: ${sectionFeet.join(" · ")}`
					: "Section feet: (none)",
				`Strip present: ${chatStatusStripPresent() ? "yes" : "no"} · server online: ${
					health.data ? String(health.data.online) : "(probe pending)"
				}`,
				panel
					? `Panel: OPEN — sections [${orderNow.join(", ")}] · ${checks.join(" ")} · basis [${basisChecks.join(" ")}] · ${panelGeometry(panel)}`
					: "Panel: (not open)",
				`“Retry refresh” controls on screen: ${retryRefresh}`,
			];
			setLines((previous) =>
				previous.length === next.length &&
				previous.every((value, index) => value === next[index])
					? previous
					: next,
			);
		};
		sample();
		const timer = setInterval(sample, 250);
		return () => clearInterval(timer);
	}, [stored, health.data]);
	return (
		<div className="w-[380px] shrink-0 space-y-1 border-l border-hairline p-4 text-meta text-ink-muted">
			<p className="pb-1 text-ink">The sidebar as the frame reads it</p>
			{lines.map((line) => (
				<p key={line}>{line}</p>
			))}
		</div>
	);
};

const Page: FC<{ sidebarWidth?: number }> = ({ sidebarWidth = 360 }) => (
	<div className="flex h-screen overflow-hidden bg-canvas text-ink">
		<div
			className="shrink-0 border-r border-hairline"
			style={{ width: `${sidebarWidth}px` }}
		>
			<ChatSidebar
				selectedConversation={undefined}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
		<Readout />
	</div>
);

/* --------------------------------------------------------------- stories */

const meta = {
	title: "Chat sidebar/View menu",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const resetFixtures = () => {
	roster = [];
	profilesList = PROFILES;
	teamsList = ["release-crew", "docs-pod"];
	capabilitiesFail = false;
	sessionsFail = false;
	backendState = "attached";
	localStorage.removeItem("chat-sidebar-disclosures");
};

const openViewPopover = async () => {
	await waitFor(
		() => document.querySelector("[data-sidebar-view-options]") !== null,
	);
	await press("[data-sidebar-view-options]");
	await panelOpen();
	// One beat past the press so the paint the shutter photographs is the
	// state's, not the previous frame's (the idiom the status-feed stories use).
	await sleep(350);
};

/**
 * The popover, open over the band, default view.
 *
 * THE FRAME D28 NAMED, and it is DRIVEN: the play presses the band's own
 * `View options` control and waits for the real Radix panel, so a frame shows
 * the surface after a gesture rather than a prop summary. What it must show:
 * the four labelled groups ("Group by" / "Time basis" / "Order by" / "Sections"),
 * the check on the active row of each single-choice group, and the seven section
 * rows in their stored order with the move pair on the shown chat sections.
 */
export const PopoverOpen: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		roster = groupRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 3);
		await openViewPopover();
	},
};

/**
 * The same panel in an 800x600 window - the design direction's D2 capture.
 *
 * The new group adds roughly 100px to a panel that was already close to the
 * window floor, so the pair to look at is the SHORT window: all four groups,
 * all seven section rows and the hidden-sections sentence must be reachable
 * (visible, or inside the panel's own scroll), and if Radix's shift does not
 * save them the remedy is `max-height: var(--radix-popover-content-available-height)`
 * with `overflow-y: auto` on the panel. The geometry is declared in the capture
 * rig's STORIES row for this story; the state itself is PopoverOpen's.
 */
export const PopoverOpenShort: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		roster = groupRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 3);
		await openViewPopover();
	},
};

/**
 * The popover with one section switched OFF, driven by its own switch.
 *
 * The press is the switch itself (`data-sidebar-view-section="running"`), so
 * the frame proves the control moves the live view - the stored `hidden` list
 * and the switch's own `aria-checked` both come from the one press, and the
 * "1 section hidden" sentence appears under the list.
 */
export const PopoverHiddenSection: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		roster = groupRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 3);
		await openViewPopover();
		await press('[data-sidebar-view-section="running"]');
		await waitFor(
			() =>
				document
					.querySelector('[data-sidebar-view-section="running"]')
					?.getAttribute("aria-checked") === "false",
		);
		await waitFor(() =>
			document.body.textContent?.includes("1 section hidden"),
		);
		await sleep(350);
	},
};

/**
 * The popover after the move pair reorders a SECTION PAIR, driven by the pair.
 *
 * The press is `Move Today down`, so the frame is the result of the control
 * the operator's request is about: `This week` and `Today` trade places in the
 * panel's list AND in the list behind it, and the readout prints the stored
 * order the press wrote. One frame, one press, both halves of "reordering".
 */
export const PopoverReorderedPair: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		roster = groupRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 3);
		await openViewPopover();
		await press('[data-sidebar-view-move="today:down"]');
		await waitFor(() => {
			const order = [
				...document.querySelectorAll<HTMLElement>(
					"[data-sidebar-view-section]",
				),
			].map((el) => el.dataset.sidebarViewSection);
			return (
				order.indexOf("week") >= 0 &&
				order.indexOf("week") < order.indexOf("today")
			);
		});
		await sleep(350);
	},
};

/**
 * The fixture where the two clocks DISAGREE, plus the two rows every basis must
 * leave where they are.
 *
 * `moved` is the operator's own case: created forty days ago, asked an hour
 * ago. `born` is recent under both clocks and `steady` is old under both. The
 * pinned row and the running row are the invariance claim's subjects - the
 * pinned partition and the RUNNING status partition are not the basis's to
 * move, so they must sit in the same place and carry the same state under
 * either basis, while the today/week/older membership shifts around them.
 */
const basisRoster = (): WireRow[] => {
	const now = NOW_SECONDS();
	return [
		row("basis-moved", "Backdated ledger, asked today", now - 3_600, {
			created_at: now - 40 * 86_400,
		}),
		row("basis-born", "Started this morning", now - 1_800, {
			created_at: now - 7_200,
		}),
		row("basis-pinned", "Pinned and untouched for days", now - 5 * 86_400, {
			pinned: true,
			created_at: now - 20 * 86_400,
		}),
		row("basis-running", "Working right now", now - 300, {
			status: { code: "busy", label: "Working" },
			status_revision: 3,
			created_at: now - 2 * 86_400,
		}),
		row("basis-steady", "Untouched for over a week", now - 9 * 86_400, {
			created_at: now - 30 * 86_400,
		}),
	];
};

/**
 * The two clocks disagreeing, photographed on ONE roster: the default basis and
 * `Created` beside it.
 *
 * The README states the expected membership of each section under each basis
 * (the `moved` row is TODAY "1h" under Last active and OLDER under Created),
 * and both frames carry the popover, so the counts shifting with the membership
 * are in the photograph rather than only in prose.
 */
export const PopoverBasisLastActive: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		roster = basisRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 5);
		await openViewPopover();
		await sleep(350);
	},
};

/**
 * The same roster with `Created` pressed, and the assertion a still cannot make
 * on its own: the LIST ORDER must not change.
 *
 * The design's rule is that the basis moves what the TIME numbers read - the
 * bins and the labels - and is orthogonal to the ordering axes; a frame shows
 * the first half, and the drawn-row ids compared before and after the press are
 * the second.
 */
export const PopoverBasisCreated: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		roster = basisRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 5);
		await openViewPopover();
		await press('[data-sidebar-view-basis="created"]');
		await waitFor(
			() =>
				document
					.querySelector('[data-sidebar-view-basis="created"]')
					?.getAttribute("aria-checked") === "true",
		);
		/*
		 * The design's own claim, asserted rather than left to the eye: the basis
		 * moves WHAT the sections and the labels read, never the ORDER the list is
		 * sorted in. Section MEMBERSHIP is the basis's to change - `basis-moved`
		 * lands under OLDER once Created is pressed, and that is the feature - so
		 * the comparison is each row's position WITHIN its drawn section against
		 * the catalogue's own order: a basis that re-sorted by `created_at` would
		 * put rows in an order the catalogue never sent. (The first version of this
		 * check compared the whole column and failed on the membership change
		 * itself - the rig's own error, kept in the set's history as the reason
		 * this reads the sections separately.)
		 */
		const rosterOrder = [
			"basis-moved",
			"basis-born",
			"basis-pinned",
			"basis-running",
			"basis-steady",
		];
		const sectionOfRow = (id: string) =>
			document
				.querySelector(`[data-session-row="${id}"]`)
				?.closest("[data-chat-section]")
				?.getAttribute("data-chat-section") ?? null;
		for (const section of ["running", "today", "week", "older"]) {
			const drawn = drawnRowIds().filter((id) => sectionOfRow(id) === section);
			const positions = drawn.map((id) => rosterOrder.indexOf(id));
			const sorted = [...positions].sort((a, b) => a - b);
			if (positions.join(",") !== sorted.join(",")) {
				throw new Error(
					`the Created basis re-sorted ${section}: drawn [${drawn.join(", ")}] against the catalogue's own order`,
				);
			}
		}
		await sleep(350);
	},
};

/**
 * The reorder rail after D1, photographed where the old pair lied.
 *
 * Three claims in one frame, because they are one rule: Pinned and the two
 * entity rows draw NO move pair (a press there moved the stored order and this
 * panel while the column stood still); a chat section's arrows are disabled
 * where the adjacent shown section is not another drawn chat section (Running
 * up, against Pinned; Older down, against the entity region); and a legal press
 * still reorders both the panel and the list behind it.
 */
export const ReorderEdges: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		roster = groupRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 3);
		await openViewPopover();
		for (const selector of [
			'[data-sidebar-view-move="pinned:up"]',
			'[data-sidebar-view-move="pinned:down"]',
			'[data-sidebar-view-move="agents:up"]',
			'[data-sidebar-view-move="teams:up"]',
		]) {
			if (document.querySelector(selector)) {
				throw new Error(
					`the panel draws a move pair it cannot honour: \`${selector}\``,
				);
			}
		}
		for (const selector of [
			'[data-sidebar-view-move="running:up"]',
			'[data-sidebar-view-move="older:down"]',
		]) {
			const element = document.querySelector<HTMLButtonElement>(selector);
			if (!element) {
				throw new Error(
					`the expected rail control is missing: \`${selector}\``,
				);
			}
			if (!element.disabled) {
				throw new Error(
					`\`${selector}\` says it can move, and the model's rule says it cannot`,
				);
			}
		}
		await press('[data-sidebar-view-move="today:down"]');
		await waitFor(() => {
			const order = [
				...document.querySelectorAll<HTMLElement>(
					"[data-sidebar-view-section]",
				),
			].map((el) => el.dataset.sidebarViewSection);
			return (
				order.indexOf("week") >= 0 &&
				order.indexOf("week") < order.indexOf("today")
			);
		});
		await sleep(350);
	},
};

/**
 * The ladder's first rung: ten chats drawn, the foot naming the step to 25.
 *
 * The roster is larger than any rung, so the foot's copy is the NEXT RUNG
 * ("Show 15 more chats") rather than a small remainder - the operator's
 * contract, and the state every earlier frame in this repository missed
 * because its list fit or was cut above the foot. The rig scrolls the chats
 * region to its end (`scrollToEnd` on the entry), which is where the foot
 * lives; the readout prints the number drawn and the foot's own copy.
 */
export const PageLadderTen: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view({ loads: 0 });
		roster = bigRoster(180);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 10);
		await sleep(350);
	},
};

/** The second rung: twenty-five drawn, the foot naming the step to 50. */
export const PageLadderTwentyFive: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view({ loads: 1 });
		roster = bigRoster(180);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 25);
		await sleep(350);
	},
};

/** The third rung: fifty drawn, the foot naming the step to 100. */
export const PageLadderFifty: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view({ loads: 2 });
		roster = bigRoster(180);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 50);
		await sleep(350);
	},
};

/**
 * The agents section past its cap: eleven owned agents against a cap of
 * eight, so the section's own foot draws - `Show 3 more` - under the eighth
 * row. The rig parks the entities region at its end, which is where the cap's
 * foot and the section's other controls live.
 */
export const SectionCapAgents: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		profilesList = agentsOverCap();
		teamsList = [];
		roster = groupRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(
			() =>
				document.querySelector('[data-sidebar-section-more="agents"]') !== null,
		);
		await sleep(350);
	},
};

/**
 * The teams section past its cap: twelve teams against a cap of eight, so its
 * foot draws `Show 4 more`. The two cap stories are split rather than merged
 * because each foot sits at its own section's end and one frame cannot hold
 * both at a readable size.
 */
export const SectionCapTeams: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = Array.from({ length: 12 }, (_, index) => `team-${index + 1}`);
		roster = groupRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(
			() =>
				document.querySelector('[data-sidebar-section-more="teams"]') !== null,
		);
		await sleep(350);
	},
};

/**
 * A group (agent) expanded to its chats, on the withdrawn paging path.
 *
 * The disclosure record is seeded before mount - the state is the point, and
 * the press that opens a group is already driven in the driver's own scenes -
 * so the frame is the expanded shape: the four `coder` rows indented under
 * their row, each with its title and relative time, beside the closed
 * `reviewer` sibling.
 */
export const ExpandedAgentGroup: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		disclosures({ "agent:coder": true });
		roster = groupRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(
			() =>
				document.querySelectorAll(
					'[data-sidebar-region="entities"] [data-tour-tag="chat-session-row"]',
				).length >= 4,
		);
		await sleep(350);
	},
};

/**
 * The band at rest, with no popover and no press: the story the band's hover
 * entries are captured from.
 *
 * The three tooltips are browser state (`:hover` on a real pointer), so they
 * cannot come from a play function - the rig's `hover` entries put a real
 * mouse move on each control, one frame each, and this story is the surface.
 */
export const BandResting: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		roster = groupRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => chatRows() >= 3);
		await sleep(350);
	},
};

/**
 * R11's route: the demonstrably-dead server, off `/chat`, with no strip.
 *
 * The two reads that carry the sidebar's own voice fail - `capabilities` (its
 * list-pane paragraph) and the catalogue's own read (its foot line) - while
 * the health snapshot says `detached`, which is the exact condition the
 * stand-down is keyed to. The strip is not mounted in this frame (a story
 * cannot mount it) and the readout prints `chatStatusStripPresent()`'s own
 * answer, so the frame shows what R11 fixed: where the strip is not, the
 * sidebar keeps speaking instead of handing the voice to a surface that is not
 * there.
 *
 * The failures are sequenced rather than seeded: capabilities and the
 * catalogue succeed FIRST (so the structure and last-known rows are mounted,
 * the state the kill produces mid-session), then the flags flip and the two
 * reads are re-triggered - the same order the real daemon death takes.
 */
export const OffRouteVoice: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		roster = groupRoster();
		return (
			<>
				<Page />
				<KillSwitch />
			</>
		);
	},
	play: async () => {
		await waitFor(() => chatRows() >= 3);
		await waitFor(
			() => document.querySelector("[data-sidebar-view-options]") !== null,
		);
		/*
		 * The kill, then the re-reads the app itself performs: the capabilities
		 * query's failed refetch is what draws the list-pane paragraph, the
		 * store's re-read is what draws the foot line, and the health probe's
		 * invalidation makes the snapshot the gate reads the detached one. The
		 * frame must hold BOTH of the voice's sentences and the rows they sit
		 * beside - a state with the voice but no rows would be a screenshot of an
		 * empty column rather than of the sidebar the kill actually produces.
		 */
		(globalThis as { __flipToDead?: () => void }).__flipToDead?.();
		await waitFor(() => document.body.textContent?.includes("Retry refresh"));
		await waitFor(() =>
			document.body.textContent?.includes("Showing the last chats loaded."),
		);
		await sleep(350);
	},
};
