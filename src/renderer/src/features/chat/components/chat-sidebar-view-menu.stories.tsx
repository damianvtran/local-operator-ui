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

/**
 * Wait until consecutive samples of the LAYOUT agree.
 *
 * A predicate that has become true is not the same as a panel that has stopped
 * moving, and this file has a measured instance of the difference: the
 * `search-finds-unloaded` frame came back with a different byte hash on a
 * re-capture of the same tree, with the diff spread across the search box, both
 * entity sections AND the readout column - i.e. the whole column had shifted
 * between two layouts either side of the query's 150ms debounce, not one label
 * changing. So the story waits for the state AND for the layout, which is the
 * same two-part wait `chat-sidebar-sections.stories.tsx` documents at length
 * (its design round 1, D4).
 *
 * The sample is STRUCTURAL - box heights, row counts and the foot's own copy -
 * and never the readout's text, which is a live region on a 250ms timer and
 * would never converge.
 */
const settled = async (samples = 4, gapMs = 120) => {
	const sample = () => {
		const region = document.querySelector<HTMLElement>(
			'[data-sidebar-region="entities"]',
		);
		return [
			region?.scrollHeight ?? 0,
			region?.clientHeight ?? 0,
			groupRowsDrawn(),
			document.querySelector("[data-entity-more]")?.textContent ?? "",
			/*
			 * AND THE NAMES-ONLY NOTICE, which is the term that actually flaked here.
			 * It draws on `query && ready && !searchSupported`, and `ready` is the
			 * CATALOGUE gate - a different query's answer from the one the play is
			 * typing into - so the notice can arrive a beat after the rows do and push
			 * everything below the box down by its own line. Two captures of one tree
			 * differed across the search box, BOTH entity sections and the readout
			 * column: one line, the whole column shifted.
			 */
			document.body.textContent?.includes("Searching chat names only") ?? false,
		].join("|");
	};
	let last = sample();
	for (let i = 0; i < samples; i += 1) {
		await sleep(gapMs);
		const now = sample();
		if (now === last) return;
		last = now;
	}
	throw new Error(
		"the panel never settled: the frame would photograph a layout in motion",
	);
};

const chatRows = () =>
	document.querySelectorAll(
		'[data-sidebar-region="chats"] [data-tour-tag="chat-session-row"]',
	).length;

const groupRowsDrawn = () =>
	document.querySelectorAll(
		'[data-sidebar-region="entities"] [data-tour-tag="chat-session-row"]',
	).length;

/**
 * The gap the operator reported (2026-09-27): "shrink the gap between agents and
 * teams headers when agents is collapsed".
 *
 * Measured between the two SECTIONS' own boxes, and against the distances that
 * make a gap readable as "extra": the heading-to-first-entry distance inside a
 * section, and one entry's own height. A heading's own box is not the section -
 * an EXPANDED section's rows sit between its heading and the next section's, so
 * measuring heading-to-heading would report the rows as gap.
 */
const sectionBox = (key: string) => {
	const button = document.querySelector<HTMLElement>(
		`[data-chat-section="${key}"]`,
	);
	return button?.closest("section")?.getBoundingClientRect() ?? null;
};

const gapReport = () => {
	const agents = sectionBox("agents");
	const teams = sectionBox("teams");
	if (!agents || !teams) return "sections: (not drawn)";
	/*
	 * The Teams heading's own box, for the heading-to-first-entry term: the
	 * section starts with the `h-7` heading wrapper, so the heading's bottom is
	 * the section's top plus its own 28px row.
	 */
	const teamsHeading = document
		.querySelector<HTMLElement>('[data-chat-section="teams"]')
		?.parentElement?.getBoundingClientRect();
	/*
	 * Scoped to the TEAMS section: `[data-entity-name]` matches an agent row too,
	 * and the first one on screen is in the Agents section - which measured
	 * `-172px` before this was scoped, a number that is not a distance at all.
	 */
	const firstEntry = document
		.querySelector<HTMLElement>('[data-chat-section="teams"]')
		?.closest("section")
		?.querySelector<HTMLElement>("[data-entity-name]");
	const entryBox = firstEntry?.parentElement?.getBoundingClientRect();
	return [
		`agents section ${Math.round(agents.height)}px, teams section ${Math.round(teams.height)}px`,
		`gap agents->teams ${(teams.top - agents.bottom).toFixed(1)}px`,
		entryBox && teamsHeading
			? `teams heading->first entry ${(entryBox.top - teamsHeading.bottom).toFixed(1)}px`
			: "teams heading->first entry (none)",
		entryBox
			? `entry height ${Math.round(entryBox.height)}px`
			: "entry height (none)",
	].join(" · ");
};

/**
 * THE ONE SCROLL LAYER, counted rather than assumed.
 *
 * #534 established that this sidebar has exactly one scrollable layer (the
 * entity region, which the chats list is a flow of), and the bound is only
 * allowed to shorten its content - never to introduce a second scroller inside
 * a group. This counts the elements that actually scroll, and prints the
 * scroller's own content-versus-box so a frame can be read for whether the
 * bound traded rows for a scrollbar.
 */
const scrollerReport = () => {
	/*
	 * A scroll LAYER is an element the browser would scroll (`overflow-y` is
	 * `auto` or `scroll`), which is the property #534 is about; whether it is
	 * currently OVERFLOWING is reported beside it, because a second layer that
	 * happens not to overflow is still a second layer waiting for a longer list.
	 */
	const layers = [...document.querySelectorAll<HTMLElement>("*")].filter((el) =>
		["auto", "scroll"].includes(getComputedStyle(el).overflowY),
	);
	const overflowing = layers.filter(
		(el) => el.scrollHeight > el.clientHeight + 1,
	);
	const names = layers.map((el) => {
		const tag =
			el.dataset.sidebarRegion ??
			el.className.toString().split(/\s+/)[0] ??
			el.tagName;
		return `${tag} ${el.scrollHeight}/${el.clientHeight}`;
	});
	return `scroll layers ${layers.length} (overflowing ${overflowing.length}) · ${names.join(" | ")}`;
};

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
			const groupFoot = document.querySelector("[data-entity-more]");
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
			const retryRefresh = [...document.querySelectorAll("button")].filter(
				(el) => text(el) === "Retry refresh",
			).length;
			const next = [
				`Stored view: ${stored.groupBy}/${stored.orderBy} · hidden [${stored.hidden.join(", ")}] · loads ${stored.loads}`,
				`Drawn: ${chatRows()} chat row(s)`,
				pageMore ? `Page foot: “${text(pageMore)}”` : "Page foot: (none)",
				groupFoot ? `Group foot: “${text(groupFoot)}”` : "Group foot: (none)",
				`Group rows drawn: ${groupRowsDrawn()}`,
				`Gap: ${gapReport()}`,
				`Scroller: ${scrollerReport()}`,
				sectionFeet.length
					? `Section feet: ${sectionFeet.join(" · ")}`
					: "Section feet: (none)",
				`Strip present: ${chatStatusStripPresent() ? "yes" : "no"} · server online: ${
					health.data ? String(health.data.online) : "(probe pending)"
				}`,
				panel
					? `Panel: OPEN — sections [${orderNow.join(", ")}] · ${checks.join(" ")}`
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

const Page: FC<{ sidebarWidth?: number; selectedConversation?: string }> = ({
	sidebarWidth = 360,
	selectedConversation,
}) => (
	<div className="flex h-screen overflow-hidden bg-canvas text-ink">
		<div
			className="shrink-0 border-r border-hairline"
			style={{ width: `${sidebarWidth}px` }}
		>
			<ChatSidebar
				selectedConversation={selectedConversation}
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
 * the three labelled groups ("Group by" / "Order by" / "Sections"), the check
 * on the active row of each single-choice group, and the seven section rows in
 * their stored order with the move pair on the shown ones.
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

/* ----------------------------------------- an expanded group's own bound */

/**
 * The roster an expanded TEAM is photographed on: `minervadev` with the
 * operator's own 41 conversations bound to it (his screenshot, 2026-09-27),
 * newest first, plus one conversation bound to another team so the group is a
 * GROUP rather than the whole list.
 */
const TEAM = "minervadev";
const TEAM_ROWS = 41;
const teamRoster = (count = TEAM_ROWS): WireRow[] => [
	...Array.from({ length: count }, (_, index) =>
		row(
			`team-${String(index).padStart(4, "0")}`,
			`Team conversation ${index + 1}`,
			NOW_SECONDS() - (index + 1) * 3_600,
			{ binding: { agent: null, team: TEAM } },
		),
	),
	row("elsewhere-0001", "Docs pod notes", NOW_SECONDS() - 60, {
		binding: { agent: null, team: "content" },
	}),
];

/** The team's disclosure, seeded before mount - the state IS the point here. */
const openTeam = () => disclosures({ [`team:${TEAM}`]: true });
const groupFootSelector = `[data-entity-more="team:${TEAM}"]`;

/**
 * A 41-conversation team expanded: TEN rows drawn, and the foot under them
 * naming the next rung AND the position - `Show 15 more chats · 10 of 41`.
 *
 * This is the operator's report, answered: before this change the same frame
 * drew all 41 rows into a column that also holds every other group and the
 * chats list.
 */
export const GroupBoundTen: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		openTeam();
		roster = teamRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => groupRowsDrawn() === 10);
		await sleep(350);
	},
};

/**
 * The same team after ONE press: twenty-five drawn, the foot naming the step to
 * fifty (`Show 25 more chats · 25 of 41`).
 *
 * DRIVEN, not seeded: the press is a real click on the control the previous
 * frame draws, which is what makes this a frame of the ladder rather than of a
 * state the story set for itself.
 */
export const GroupBoundAfterOne: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		openTeam();
		roster = teamRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => groupRowsDrawn() === 10);
		await press(groupFootSelector);
		await waitFor(() => groupRowsDrawn() === 25);
		await sleep(350);
	},
};

/**
 * And after TWO: the third rung is fifty against forty-one held, so the group
 * is fully drawn and the foot is GONE - which is the other half of the count
 * agreeing with the disclosure: a reader seeing no control is seeing all of it.
 */
export const GroupBoundAfterTwo: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		openTeam();
		roster = teamRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => groupRowsDrawn() === 10);
		await press(groupFootSelector);
		await waitFor(() => groupRowsDrawn() === 25);
		await press(groupFootSelector);
		await waitFor(() => groupRowsDrawn() === TEAM_ROWS);
		await sleep(350);
	},
};

/**
 * The reader is IN a conversation that sorts below the group's bound.
 *
 * `team-0034` is the group's 35th row and the group draws ten, so the bound
 * withheld the very conversation the transcript pane is showing. It is LIFTED
 * to the head of the group rather than admitted in place: admitting it would
 * mean drawing the thirty-four rows between, which is the complaint this change
 * answers. Eleven rows are drawn - the ten-row prefix plus the lifted one - and
 * the foot reads `11 of 41`, because eleven is what the reader is looking at.
 * The `CURRENT CHAT` label above it is `sectionLabel`'s own, the same wording
 * the chats list uses for its lifted row, so the out-of-order row is explained
 * rather than left to read as a broken sort.
 */
export const GroupBoundCurrentLifted: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		openTeam();
		roster = teamRoster();
		return <Page selectedConversation="team-0034" />;
	},
	play: async () => {
		await waitFor(() => groupRowsDrawn() === 11);
		await sleep(350);
	},
};

/**
 * A query that matches a row the bound has NOT loaded.
 *
 * "Team conversation 35" is `team-0034` - the same unloaded row as the frame
 * above. A bound that filtered the answer would return nothing here, which is
 * the defect the operator named ("search should still be able to search and
 * find"); the group draws the match and the foot is gone, because with the
 * query active there is nothing withheld to disclose.
 *
 * NOT CAPTURED AS EVIDENCE, and this note is why rather than a puzzle for the
 * next reader: six captures of this story on one clean tree produced TWO
 * distinct end states, the diff spanning the whole panel rather than one label,
 * and neither a settle-wait on the layout nor an assertion on the story's own
 * facts removed it. The claim it exists for is asserted in
 * `scripts/chat-sidebar-view.test.mjs` instead. Fix the state pinning before
 * adding it to `STORIES` in `scripts/capture-evidence.mjs`.
 */
export const GroupBoundSearchFindsUnloaded: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		openTeam();
		roster = teamRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(() => groupRowsDrawn() === 10);
		const box = document.querySelector<HTMLInputElement>(
			'[aria-label="Search chats and agents"]',
		);
		if (!box) throw new Error("the search box never mounted");
		await userEvent.type(box, "Team conversation 35");
		await waitFor(() => groupRowsDrawn() === 1);
		/*
		 * THE NAMES-ONLY NOTICE IS PART OF THIS FRAME'S STATE, so the story waits for
		 * it rather than racing it. It draws on `query && ready && !searchSupported`,
		 * and this stub advertises no `session_search` - so it WILL draw, but only once
		 * the CATALOGUE gate has answered, which is a different query's answer from
		 * the box the play is typing into. Waiting only for the rows left the two
		 * captures either side of that arrival: one extra line under the box shifts
		 * every section below it, which is the flake measured above.
		 */
		await waitFor(
			() =>
				document.body.textContent?.includes("Searching chat names only") ===
				true,
		);
		/*
		 * AND THE TWO FACTS THE FRAME'S CAPTION CLAIMS ARE ASSERTED HERE, which turns
		 * a flake into a FAILURE rather than a wrong frame: a capture that races the
		 * query's own application writes a picture of a different state under a
		 * caption that says otherwise, which is worse than no frame at all ("a dead
		 * instrument returns a reading, not an error"). Asserted on the DOM facts
		 * this frame is ABOUT - the one matching row under the group, and the notice
		 * that says which search ran - rather than on the input's own `value`, which
		 * is component state two re-renders away and read `""` here even on the runs
		 * that photographed the typed query.
		 */
		if (groupRowsDrawn() !== 1)
			throw new Error(
				`the group draws ${groupRowsDrawn()} rows rather than the one match this frame is of`,
			);
		await settled(8, 150);
		await sleep(350);
	},
};

/* ------------------------------------------- the collapsed section's gap */

/**
 * The operator's exact case (2026-09-27): `Agents` COLLAPSED above `Teams`
 * EXPANDED, with the teams' own rows under it.
 *
 * The gap this frame is read for is between the two headings, and the readout
 * prints it in pixels beside the heading-to-first-entry distance and one
 * entry's height - because a gap is only "extra" relative to something.
 */
export const AgentsCollapsedTeamsExpanded: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		disclosures({ agents: false, teams: true });
		roster = teamRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(
			() =>
				document.querySelector('[data-chat-section="teams"]') !== null &&
				document.querySelector("[data-entity-name]") !== null,
		);
		await sleep(350);
	},
};

/** Both sections collapsed: the spacing a collapsed section leaves behind. */
export const BothSectionsCollapsed: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		disclosures({ agents: false, teams: false });
		roster = teamRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(
			() =>
				document.querySelector('[data-chat-section="teams"]') !== null &&
				document.querySelector("[data-entity-name]") === null,
		);
		await sleep(350);
	},
};

/** Both expanded, so the same pair of headings can be compared with rows under
 * each of them - the case a fix that merely shortened the constant would
 * tighten without anyone asking. */
export const BothSectionsExpanded: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		disclosures({ agents: true, teams: true });
		roster = teamRoster();
		return <Page />;
	},
	play: async () => {
		await waitFor(
			() =>
				document.querySelector('[data-chat-section="teams"]') !== null &&
				document.querySelectorAll("[data-entity-name]").length >= 4,
		);
		await sleep(350);
	},
};
