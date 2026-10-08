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
 *   - **The mixed catalogue** (`TimeOrderMixed`, 2026-10-08) is the ORDER
 *     frames' fixture: a Running section whose three clocks disagree and a
 *     This-week section that only reads in order once the arrangement sorts by
 *     the basis clock. Its before half lives beside it in the evidence set; the
 *     rule it photographs is asserted without a browser in
 *     `scripts/chat-sidebar-time-order.test.mjs`.
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
import { DEFAULT_SIDEBAR_VIEW, type SidebarView } from "../chat-sidebar-view";
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
	/**
	 * The time of the last USER message, in epoch seconds - the clock a RUNNING
	 * row's order reads (`CanonicalSessionRow.last_user_at`). Core does not
	 * publish it yet, so no other story here sets it; `TimeOrderMixed` does,
	 * because the running band's stability is that story's whole claim.
	 */
	last_user_at?: number;
	/**
	 * `remote` marks a row as owned by another device - the flat locality fields
	 * a peers-inclusive listing carries (`SessionCatalogueRow`'s mesh half). The
	 * plain page omits `locality` entirely, which reads as "no claim" rather than
	 * "local", so a story that wants a remote row states it.
	 */
	locality?: "local" | "remote";
	owner_device?: string;
	owner_device_name?: string;
	reachable?: boolean;
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
			const groupFoot = document.querySelector("[data-entity-more]");

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
 * The panel in the shape the APP can actually reach with a short window.
 *
 * The 800x600 capture is the design contract's floor (`WINDOW_MIN_WIDTH/HEIGHT`),
 * but the popover it photographs is not reachable there in the product: below
 * ~1024px the nav rail collapses and the chat column, and so the View options
 * trigger, is not drawn (round 1's Q-2, reproduced independently by QA: no
 * `[data-sidebar-view-options]` in ten seconds at 800x600). The reachable worst
 * case is a DOCKED width with a short height, so this state is that pair:
 * 1100x600, the same panel and the same bottom inset the short capture shows.
 * The geometry is declared in the capture rig's STORIES row for this story.
 */
export const PopoverOpenNarrow: Story = {
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
		await settle(
			() =>
				!entityDrawn("agents") &&
				switchState("agents") === "false" &&
				hiddenSentence() === "1 section hidden",
		);
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
 * on its own: the list RE-ORDERS on the clock the basis names.
 *
 * THE CONTRACT THIS PINS WAS REVERSED ON 2026-10-08, and the reversal is the
 * story's own subject: it used to assert that the basis "moves WHAT the sections
 * and the labels read, never the ORDER the list is sorted in" (the operator's
 * 2026-09-28 "orthogonal" claim). His later report - the rows did not sort
 * within a section by the basis he had chosen, and "in that case it should show
 * what we have selected/expect" - made the clock the order's key too
 * (`chat-sidebar-view.ts`'s `pageOrder` carries the rule). So the frame and the
 * assertion now check ONE claim: every drawn section's rows follow the basis's
 * clock, newest first, and the columns that show ids rather than timestamps
 * (the readout beside the panel) are where the membership shift is read.
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
		/*
		 * THE CAPTURE-PENDING LATCH (design review round 1, B1): the rig's shutter
		 * waits on this flag, and without it the dark frame of this state
		 * photographed the panel BEFORE the press landed - byte-identical to
		 * `popover-basis-last-active`'s frame, readout and all - while the light
		 * frame happened to catch it after. Same idiom as the audit stories:
		 * empty string, not `delete`.
		 */
		document.documentElement.dataset.capturePending = "1";
		try {
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
			 * The 2026-10-08 claim, asserted rather than left to the eye: the basis moves
			 * WHAT the sections and the labels read AND the order the list is drawn in.
			 * Section MEMBERSHIP is the basis's to change - `basis-moved` lands under
			 * OLDER once Created is pressed, and that is the feature - so the comparison
			 * is each row's position WITHIN its drawn section against the clock the basis
			 * names: `created_at`, newest first, with no clock sorting last. (The
			 * previous revision of this check asserted the opposite - that the position
			 * within a section never moved - which is the contract the operator reversed;
			 * it is recorded in the set's history beside the first version's own error,
			 * a whole-column comparison that failed on the membership change itself.)
			 */
			const clocks = new Map(
				basisRoster().map((entry) => [entry.id, entry.created_at ?? 0]),
			);
			const sectionOfRow = (id: string) =>
				document
					.querySelector(`[data-session-row="${id}"]`)
					?.closest("[data-chat-section]")
					?.getAttribute("data-chat-section") ?? null;
			for (const section of ["running", "today", "week", "older"]) {
				const drawn = drawnRowIds().filter(
					(id) => sectionOfRow(id) === section,
				);
				const keys = drawn.map((id) => clocks.get(id) ?? 0);
				const sorted = [...keys].sort((a, b) => b - a);
				if (keys.join(",") !== sorted.join(",")) {
					throw new Error(
						`the Created basis did not order ${section} by created_at: drawn [${drawn.join(", ")}] with clocks [${keys.join(", ")}]`,
					);
				}
			}
			await sleep(350);
		} finally {
			/* Empty string, not `delete`: the probe reads the value's truthiness. */
			document.documentElement.dataset.capturePending = "";
		}
	},
};

/**
 * THE MIXED CATALOGUE (2026-10-08): one small roster whose Running and This-week
 * sections order differently under the clock the labels print, so the before and
 * after frames differ in what a reader reads first rather than in colour or
 * spacing.
 *
 * WHAT EACH PART IS FOR:
 *
 *   - THE RUNNING SECTION'S THREE CLOCKS DISAGREE. `mix-run-heartbeat` was born
 *     thirty days ago, has a five-minute-old heartbeat and was last asked
 *     something three hours ago; `mix-run-message` was born two days ago and was
 *     told something ten minutes ago; `mix-run-stopped` is an approval waiting
 *     on the reader. The order is that story's whole subject: a response must
 *     move nothing, a user message moves exactly its row, and a turn stopped on
 *     the reader leads both;
 *   - THIS WEEK MIXES the row kinds the operator's own sidebar showed together:
 *     an idle chat revived this morning (`mix-week-revived`, born twenty days
 *     ago), a quietly ageing one (`mix-week-quiet`), a stopped one wearing the
 *     pause glyph (`mix-week-stopped`), a scheduled one wearing the clock glyph
 *     (`mix-week-scheduled`), a dormant one (`mix-week-dormant`), and two remote
 *     rows - one with a real last-active stamp, one whose stamp is the wire's
 *     zero (`mix-remote-nostamp`, core's "no claim");
 *   - the ladder is held at its third rung (`loads: 2`, the 50-row page) so
 *     every row draws and the frames are fourteen rows of ORDER rather than a
 *     cut that hides the tail.
 *
 * WHAT THE PAIR SHOWS, columns read off the frames themselves (design review
 * round 1, B2 - the prose quoted columns no section drew). Before
 * (`origin/main`): TODAY `2h 12h 1h 3h`, THIS WEEK `1d 6d 4d 5d` - the arrival
 * order under activity labels - and OLDER `5w 7w 56y`, the zero-stamp remote
 * row printing `56y` (1970 is the CAUSE, the label is what the frame carries);
 * the running triple reads heartbeat, message, stopped.
 * After: TODAY `1h 2h 3h 12h`, THIS WEEK `1d 4d 5d 6d`, OLDER `5w 7w` and the
 * zero-stamp row unlabelled at the end; the stopped row leads the running trio,
 * then the ten-minute message, then the heartbeat. The frames are
 * `docs/evidence/chat-sidebar-view-menu/time-order-mixed/` (this branch) and
 * `time-order-mixed-before/` (unmodified `origin/main` at `15a7a4ed522`, the
 * same story and fixtures staged into a detached worktree of it).
 */
const timeOrderRoster = (): WireRow[] => {
	const now = NOW_SECONDS();
	return [
		row("mix-run-heartbeat", "Heartbeat five minutes ago", now - 300, {
			status: { code: "busy", label: "Working" },
			status_revision: 3,
			created_at: now - 30 * 86_400,
			last_user_at: now - 3 * 3_600,
		}),
		row("mix-run-message", "Last message ten minutes ago", now - 120, {
			status: { code: "busy", label: "Working" },
			status_revision: 4,
			created_at: now - 2 * 86_400,
			last_user_at: now - 600,
		}),
		row("mix-run-stopped", "Waiting on you", now - 2_400, {
			status: { code: "approval", label: "Needs approval" },
			status_revision: 5,
			created_at: now - 6 * 3_600,
			last_user_at: now - 6 * 3_600,
		}),
		row("mix-week-revived", "Revived this morning", now - 2 * 3_600, {
			created_at: now - 20 * 86_400,
		}),
		row("mix-week-quiet", "Quiet since last week", now - 6 * 86_400, {
			created_at: now - 86_400,
		}),
		row("mix-week-stopped", "Stopped mid-turn", now - 4 * 86_400, {
			status: { code: "interrupted", label: "Interrupted" },
			created_at: now - 3 * 86_400,
		}),
		row("mix-week-scheduled", "Wakes at nine", now - 12 * 3_600, {
			status: { code: "scheduled", label: "Scheduled" },
			created_at: now - 5 * 86_400,
		}),
		row("mix-week-dormant", "Dormant since Tuesday", now - 5 * 86_400, {
			status: { code: "dormant", label: "Dormant" },
			created_at: now - 4 * 86_400,
		}),
		row("mix-today-1", "Asked an hour ago", now - 3_600, {
			created_at: now - 2 * 3_600,
		}),
		row("mix-today-2", "Asked three hours ago", now - 3 * 3_600, {
			created_at: now - 26 * 3_600,
		}),
		row("mix-older-1", "Last month's thread", now - 35 * 86_400, {
			created_at: now - 40 * 86_400,
		}),
		row("mix-older-2", "Stopped a month ago", now - 50 * 86_400, {
			status: { code: "dormant", label: "Dormant" },
			created_at: now - 60 * 86_400,
		}),
		row(
			"mix-remote-fresh",
			"On the other Mac, active yesterday",
			now - 86_400,
			{
				locality: "remote",
				owner_device: "d_9c4e21ab77",
				owner_device_name: "mac-studio",
				reachable: true,
			},
		),
		row("mix-remote-nostamp", "On the other Mac, no claim", 0, {
			locality: "remote",
			owner_device: "d_9c4e21ab77",
			owner_device_name: "mac-studio",
			reachable: true,
		}),
	];
};

/**
 * The mixed catalogue, photographed whole (see `timeOrderRoster`).
 *
 * The frame is the claim, and the columns below are read off the frame, not
 * predicted from the roster (B2): the AFTER frame reads TODAY `1h 2h 3h 12h`,
 * THIS WEEK `1d 4d 5d 6d`, OLDER `5w 7w` + one unlabelled row, and its Running
 * section leads with the turn stopped on the reader. The BEFORE frame, the same
 * fixture on `origin/main`, reads TODAY `2h 12h 1h 3h`, THIS WEEK `1d 6d 4d 5d`
 * and OLDER `5w 7w 56y`. The play only waits for the rows - the assertions that
 * pin the rule live in `scripts/chat-sidebar-time-order.test.mjs`, where the
 * pipeline is driven with no browser in the way.
 */
export const TimeOrderMixed: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view({ loads: 2 });
		roster = timeOrderRoster();
		return <Page />;
	},
	play: async () => {
		/*
		 * THE LATCH (the repository's own idiom, `chat-sidebar-status-feed.stories
		 * .tsx` carries the argument): the shutter is held until the frame is worth
		 * taking. Two waits are needed rather than one, and the second is what the
		 * latch exists for here: the readout's samples ride a 250 ms interval that a
		 * HIDDEN page's timers throttle, so a frame taken the moment the rows paint
		 * can carry `Drawn: 0` beside fourteen rows - which is exactly what this
		 * story's first capture came back with, twice. The state the frame claims is
		 * the READOUT's agreement with the DOM it describes.
		 */
		document.documentElement.dataset.capturePending = "1";
		try {
			await waitFor(() => chatRows() >= 14);
			await waitFor(() =>
				(document.body.textContent ?? "").includes("Drawn: 14 chat row(s)"),
			);
			await settled();
			await sleep(350);
		} finally {
			/* Empty string, not `delete`: the probe reads the value's truthiness. */
			document.documentElement.dataset.capturePending = "";
		}
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
			/*
			 * AND THE EMPTY-SECTION CASES (round 1's m1/U1), which this roster holds in
			 * both directions: `running` has no loaded rows, so its own down-press is a
			 * source that draws nothing, and Today's up-neighbour IS that empty
			 * running, so its press would move nothing the reader sees. Both are
			 * disabled rather than offered - the dead-control read the round-1 finding
			 * measured on a store whose only row sat in Today.
			 */
			'[data-sidebar-view-move="running:down"]',
			'[data-sidebar-view-move="today:up"]',
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
		await settled();
		await sleep(350);
	},
};

/**
 * The same team after ONE press: twenty-five drawn, and the foot states what
 * the next press will ADD rather than the ladder's nominal step - sixteen
 * remain of the forty-one held, so it reads `Show 16 more chats · 25 of 41`.
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
		await settled();
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
		await settled();
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
 * rather than left to read as a broken sort. The row itself wears the panel's
 * `rowCurrent` fill and weight too - WHICH row is current and WHY it leads are
 * both stated - and the render seeds the store below so the mark the shipped
 * app paints is the mark the frame photographs (design round 1, D1).
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
		/*
		 * THE STORE MUST AGREE WITH THE PROP, or the row is lifted but NOT MARKED.
		 * The sidebar paints the current row's ground on `selectedConversation ===
		 * row.session_id && !activeDraftKey` (`chat-sidebar.tsx`), and the canonical
		 * store seeds an `activeDraftKey` when nothing is active - so a story that
		 * passes only the prop renders the label over a row wearing nothing (design
		 * round 1, D1: 0 px of `row-selected` anywhere in the 360px sidebar).
		 * Clearing the key and naming the session is the state the app reaches by
		 * opening the conversation; without the pair, this story misrepresents the
		 * shipped row.
		 */
		useCanonicalSessionsStore.setState({
			activeDraftKey: null,
			activeSessionId: "team-0034",
		});
		return <Page selectedConversation="team-0034" />;
	},
	play: async () => {
		await waitFor(() => groupRowsDrawn() === 11);
		await settled();
		await sleep(350);
	},
};

/**
 * The OTHER END of `current-lifted`'s movement, and the pair D6 asked for: two
 * stills are what "consecutive frames" can be here.
 *
 * DRIVEN, not seeded: two real presses on the foot the frames above draw (ten
 * rows to twenty-five, then to fifty against forty-one held), after which the
 * ladder has drawn past the viewed row - so the lift and its `CURRENT CHAT`
 * label are gone and `team-0034` settles where the catalogue sorts it.
 */
export const GroupBoundCurrentSettled: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		openTeam();
		roster = teamRoster();
		useCanonicalSessionsStore.setState({
			activeDraftKey: null,
			activeSessionId: "team-0034",
		});
		return <Page selectedConversation="team-0034" />;
	},
	play: async () => {
		await waitFor(() => groupRowsDrawn() === 11);
		await press(groupFootSelector);
		await waitFor(() => groupRowsDrawn() === 26);
		await press(groupFootSelector);
		await waitFor(() => groupRowsDrawn() === TEAM_ROWS);
		/* The lift is gone: the viewed row is inside the drawn prefix now. */
		await waitFor(
			() =>
				!(
					document.querySelector('[data-sidebar-region="entities"]')
						?.textContent ?? ""
				).includes("Current chat"),
		);
		await settled();
		await sleep(350);
	},
};

/**
 * The running-row exemption, framed: `team-0034` - the row the bound withholds
 * in `ten` and lifts in `current-lifted` - is BUSY, and a live row costs no
 * quota (`entityRows`' exemption), so eleven rows are drawn: the ten-row prefix
 * plus the busy one, kept in catalogue order. The foot counts it (`· 11 of 41`
 * where the plain case reads `· 10 of 41`), which is the pair the safety rule
 * needs a frame for - the bound may never hide live work, and the count has to
 * stay truthful when the bound steps aside (design round 1, D4).
 */
export const GroupBoundRunningExempt: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		view();
		teamsList = [TEAM, "content"];
		openTeam();
		roster = teamRoster().map((entry) =>
			entry.id === "team-0034"
				? { ...entry, status: { code: "busy", label: "Working" } }
				: entry,
		);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => groupRowsDrawn() === 11);
		await settled();
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
		await settled();
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
		await settled();
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
		await settled();
		await sleep(350);
	},
};

/* ------------------------------------------------------------- the audit */

/**
 * THE VIEW-SETTINGS AUDIT (operator, 2026-09-27), as frames and not as prose.
 *
 * The report that opened it: "I unchecked the Agents section from the view
 * settings and that section still seems to be there, can you double check that
 * all view settings work as expected." One broken promise makes the other six
 * untrustworthy, so every control in the panel is driven here by its own press
 * and the result is read back out of the DOM - a section hidden and restored, a
 * regression and a flattening, the two orderings against each other - rather
 * than argued from the source.
 *
 * WHY ITS OWN READOUT, and not the one the states above share. That readout is
 * the caption of frames that are already committed, and extending it would
 * quietly restate every one of them: a still is evidence about the code that
 * produced it, so the audit's lines live beside the audit's states. This one
 * prints BOTH SIDES of the claim - what the panel's switches say and what the
 * two regions actually draw - because the defect was the two disagreeing inside
 * one frame, and a caption that could only see one of them could not show it.
 *
 * WHAT A FRAME HERE CANNOT SAY: that a setting survives a relaunch. A play
 * function drives one mounted page and Storybook never reloads it, so the
 * persistence half is asserted where it belongs - the store's own round trip
 * through `localStorage` in `scripts/chat-sidebar-view.test.mjs`, which writes
 * the view the way the popover does, parses the bytes back the way a launch
 * does, and reads the result through `parseSidebarView`.
 */

/**
 * The roster the audit frames are read over.
 *
 * FOUR PROPERTIES, each there for one control. Two rows are PINNED, one of them
 * outside today's section, so a grouping that dropped them is visible; one row
 * is ACTIVE (a live turn) carrying no clock the arrangement can key it by - no
 * last-user time, no birth - so it sorts after every row that has one, past the
 * ten-row rung (fourteen rows below `Pinned`, four more than the rung holds):
 * under `Most recent` the window draws it anyway, in place at the list's end,
 * while `Active first` lifts it into the band; and the rest are spread over
 * today / this week / older, with the three agent bindings so `Agent and team`
 * has real groups to draw, `Ungrouped` among them.
 */
const auditRoster = (): WireRow[] => {
	const now = NOW_SECONDS();
	return [
		row("audit-pinned-new", "Pinned · release checklist", now - 600, {
			pinned: true,
			binding: { agent: "coder", team: null },
		}),
		row("audit-pinned-old", "Pinned · vendor follow-up", now - 3 * 86_400, {
			pinned: true,
			binding: { agent: null, team: "docs-pod" },
		}),
		row("audit-today-1", "Split the reducer", now - 1_200),
		row("audit-today-2", "Trace the loader", now - 3_600, {
			binding: { agent: "coder", team: null },
		}),
		row("audit-week-1", "Migration note", now - 2 * 86_400, {
			binding: { agent: null, team: "release-crew" },
		}),
		row("audit-week-2", "Fixture tidy-up", now - 4 * 86_400, {
			binding: { agent: "reviewer", team: null },
		}),
		row("audit-older-1", "Vendor questionnaire", now - 12 * 86_400),
		row("audit-older-2", "Old hand-off", now - 30 * 86_400, {
			binding: { agent: "coder", team: null },
		}),
		row("audit-older-3", "Archived thread", now - 60 * 86_400),
		row("audit-older-4", "First draft", now - 90 * 86_400),
		row("audit-older-5", "Older still", now - 120 * 86_400),
		/*
		 * FOUR MORE THAN THE PAGE HOLDS, and that is the point of them: the roster
		 * outruns the ten-row rung (fourteen rows below `Pinned`) so the live turn
		 * at the END of it sits past the page's cut under `Most recent` - drawn
		 * there anyway, in place, because the window never withholds a live row,
		 * and lifted into the band under `Active first`: the pair photographs the
		 * POSITION one live row takes under the two orderings, not its presence
		 * (round 2).
		 */
		row("audit-older-6", "Quarterly review", now - 150 * 86_400),
		row("audit-older-7", "Backlog triage", now - 180 * 86_400),
		row("audit-older-8", "Onboarding notes", now - 210 * 86_400),
		row("audit-older-9", "Very first thread", now - 240 * 86_400),
		row("audit-busy-old", "Nine-day migration", now - 9 * 86_400, {
			status: { code: "busy", label: "Working" },
			binding: { agent: "reviewer", team: null },
		}),
	];
};

/** The section keys a region draws, in the order it draws them. */
const regionSections = (region: string) =>
	[
		...document.querySelectorAll<HTMLElement>(
			`[data-sidebar-region="${region}"] [data-chat-section]`,
		),
	].map((el) => el.dataset.chatSection ?? "?");

/**
 * Wait for an audit claim, and for NOTHING else.
 *
 * THE PLAY MUST BE SHORT, and this is measured rather than stylistic: the rig
 * navigates, sleeps 900ms, waits for the theme, settles animations and then
 * reads the DOM - it never waits for a play to finish. A play that runs longer
 * than that budget races the shutter, and the frame records whichever state the
 * page happened to be in (the first passes of this set "failed" their own
 * expectations on a different story and palette each time for exactly that
 * reason: a 600ms stability window and a 350ms beat on top of the presses cost
 * more than the rig waits). So the play presses, waits for the claim once, and
 * stops; the rig's own `expect*` options are what make a wrong frame impossible
 * rather than unlikely.
 */
const settle = (predicate: () => boolean) => waitFor(predicate, 6_000);

/**
 * Open the panel with the audit's own beat.
 *
 * `openViewPopover` above is the states' helper and waits 350ms after the press
 * ("one beat past the press so the paint the shutter photographs is the
 * state's"). The audit cannot afford it: its plays have to fit the rig's own
 * wait (see `settle`), and the panel is already asserted open by `panelOpen()`.
 */
const openAuditPopover = async () => {
	await waitFor(
		() => document.querySelector("[data-sidebar-view-options]") !== null,
	);
	await press("[data-sidebar-view-options]");
	await panelOpen();
};
/** One switch's own state, read from the panel. */
const switchState = (key: string) =>
	document
		.querySelector(`[data-sidebar-view-section="${key}"]`)
		?.getAttribute("aria-checked");

/** Whether a region currently draws a section - the row, or its disclosure row. */
const entityDrawn = (key: string) =>
	document.querySelector(
		`[data-sidebar-region="entities"] [data-chat-section="${key}"]`,
	) !== null;

/** The same question of the chats region. */
const chatsSectionDrawn = (key: string) =>
	document.querySelector(
		`[data-sidebar-region="chats"] [data-chat-section="${key}"]`,
	) !== null;

/** Whether a conversation is on screen at all, in either region. */
const rowDrawn = (id: string) =>
	document.querySelector(`[data-session-row="${id}"]`) !== null;

/** The session ids a region draws, in document order. */
const regionRows = (region: string) =>
	[
		...document.querySelectorAll<HTMLElement>(
			`[data-sidebar-region="${region}"] [data-session-row]`,
		),
	].map((el) => el.getAttribute("data-session-row") ?? "?");

/** The panel's seven switches: each one's own state and the count it prints. */
const panelSwitches = () =>
	[
		...document.querySelectorAll<HTMLElement>("[data-sidebar-view-section]"),
	].map((el) => {
		const key = el.dataset.sidebarViewSection ?? "?";
		const count = el.querySelector("span.font-mono")?.textContent?.trim();
		return `${key}=${el.getAttribute("aria-checked")}${count ? `(${count})` : ""}`;
	});

/**
 * The rows each drawn section holds, per region - the panel's counts, checked.
 *
 * TWO ATTRIBUTES, because the panel draws two kinds of row: a chats section
 * holds `[data-session-row]` conversations, while an entity section holds
 * `[data-entity]` rows (the agent and team disclosures - their own children are
 * conversations nested INSIDE those, so counting `[data-session-row]` there
 * would count a group's contents rather than the rows the panel's count badges).
 *
 * THE CONTAINER IS RESOLVED, not assumed: a chat section and a grouped section
 * ARE the `[data-chat-section]` element, while an entity row puts the key on the
 * disclosure BUTTON and keeps its rows in the `<section>` around it.
 */
const sectionCounts = (region: string) =>
	[
		...document.querySelectorAll<HTMLElement>(
			`[data-sidebar-region="${region}"] [data-chat-section]`,
		),
	].map((el) => {
		const holder =
			el.tagName === "SECTION" ? el : (el.closest("section") ?? el);
		const rows = holder.querySelectorAll("[data-session-row]").length;
		const entities = holder.querySelectorAll("[data-entity]").length;
		return `${el.dataset.chatSection}:${entities > 0 ? entities : rows}`;
	});

/** The panel's own sentence about how many sections it believes it hid. */
/*
 * The panel's own sentence, read from its OWN element rather than from
 * `document.body`'s concatenation: the sentence has no data attribute, and the
 * panel's last count runs into its first digit in that text - the first capture
 * of these frames read "teams 2" + "1 section hidden" back as "21 section
 * hidden". An element whose whole text IS the sentence cannot be mis-joined.
 */
const HIDDEN_SENTENCE = /^\d+ sections? hidden$/;
const hiddenSentence = () => {
	for (const el of document.querySelectorAll("p")) {
		const text = (el.textContent ?? "").trim();
		if (HIDDEN_SENTENCE.test(text)) return text;
	}
	return "(none)";
};

/**
 * The caption of the audit frames: both sides of every claim, read from the DOM
 * on a 250ms tick so a still cannot describe a state the page is not in.
 */
const AuditReadout: FC = () => {
	const stored = useUiPreferencesStore((state) => state.chatSidebarView);
	const [lines, setLines] = useState<string[]>([]);
	useEffect(() => {
		const sample = () => {
			const entity = regionSections("entities");
			const chats = regionSections("chats");
			const panel = document.querySelector("[data-sidebar-view-panel]");
			const rows = regionRows("chats");
			const saysHidden = stored.hidden.includes("agents");
			const drawsAgents = entity.includes("agents");
			const next = [
				`stored: groupBy=${stored.groupBy} · orderBy=${stored.orderBy} · loads ${stored.loads}`,
				`stored: hidden [${stored.hidden.join(", ")}] · order [${stored.order.join(", ")}]`,
				`panel open: ${panel ? "yes" : "no"} · switches ${panelSwitches().join(" ")}`,
				`panel says: "${hiddenSentence()}"`,
				`entities region draws: [${entity.join(", ")}]`,
				`chats region draws: [${chats.join(", ")}]`,
				`chat rows drawn: ${rows.length}`,
				`section rows drawn: [${sectionCounts("chats").join(" ")}] · entities [${sectionCounts("entities").join(" ")}]`,
				`chat row order: [${rows.join(", ")}]`,
				`Agents: panel hidden=${saysHidden} · row drawn=${drawsAgents} → ${
					saysHidden && drawsAgents
						? "DISAGREE (the operator's report)"
						: "agree"
				}`,
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
	}, [stored]);
	return (
		<div className="w-[380px] shrink-0 space-y-1 border-l border-hairline p-4 text-meta text-ink-muted">
			<p className="pb-1 text-ink">The audit, as the frame reads it</p>
			{lines.map((line) => (
				<p key={line}>{line}</p>
			))}
		</div>
	);
};

/** The sidebar and the audit's own caption, at the widths the set already uses. */
const AuditPage: FC = () => (
	<div className="flex h-screen overflow-hidden bg-canvas text-ink">
		<div
			className="shrink-0 border-r border-hairline"
			style={{ width: "360px" }}
		>
			<ChatSidebar
				selectedConversation={undefined}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
		<AuditReadout />
	</div>
);

/**
 * Every audit state below starts from this fixture, driven, with the panel open.
 *
 * THE VIEW FIXTURE IS APPLIED HERE, not in the story's `render` body and not in
 * a child's mount effect, and the difference was measured rather than argued:
 * both of those write the DEFAULT view at a moment that can land AFTER the play
 * has pressed the switch (the `render` body is re-invoked when Storybook's
 * interactions addon books a finished play, and a passive mount effect can be
 * deferred past the play's first acts under load). Either one puts the tick
 * back and the section on screen for the frame that claims the opposite - the
 * first two passes of this set produced exactly that, on a different story and
 * palette each time. Writing the fixture here makes it the last store write
 * before the press, and the press the last write before the shutter.
 */
const auditScene = async (seed: Partial<SidebarView> = {}) => {
	await waitFor(
		() => document.querySelector('[data-sidebar-region="chats"]') !== null,
	);
	await waitFor(() => chatRows() >= 3);
	useUiPreferencesStore.setState({
		chatSidebarView: { ...DEFAULT_SIDEBAR_VIEW, ...seed },
	});
};

/**
 * The panel's own press, and the checkbox state it lands in.
 *
 * IT CONVERGES RATHER THAN PRESSING ONCE, and the reason is measured: a single
 * press into a page that is still settling is a press the next render can drop
 * (the first story of a cold capture pass photographed a panel with its tick
 * restored and an empty `hidden` list, while the same story driven alone
 * flipped correctly). The state is re-read before every attempt, so the loop
 * can only ever press toward `checked`, never past it, and it FAILS LOUDLY -
 * a wrong frame is worse than a missing one.
 */
const pressSection = async (key: string, checked: boolean) => {
	const selector = `[data-sidebar-view-section="${key}"]`;
	const state = () =>
		document.querySelector(selector)?.getAttribute("aria-checked");
	for (let attempt = 0; attempt < 4; attempt += 1) {
		if (state() === String(checked)) return;
		await press(selector);
		await sleep(200);
	}
	throw new Error(`the ${key} switch never reached ${checked}`);
};

/**
 * The same, for the two single-choice groups - and with the same convergence,
 * for the same reason. `choose` is the row's key; the press is a real pointer
 * click on the row the reader would press.
 */
const pressGroupBy = async (key: string) => {
	const selector = `[data-sidebar-view-choice="${key}"]`;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		if (
			document.querySelector(selector)?.getAttribute("aria-checked") === "true"
		)
			return;
		await press(selector);
		await sleep(200);
	}
	throw new Error(`the ${key} choice never became the active one`);
};

/**
 * THE REPORTED BUG, driven: the popover's `Agents` switch is pressed off.
 *
 * The play waits only for the POPOVER's own state - the switch's
 * `aria-checked` and the sentence under the list - because that is the half
 * that always worked: the press reached the store, the tick went out, and the
 * panel's own count said one section was hidden. Whether the region below obeys
 * it is what the caption prints (`Agents: panel hidden=… · row drawn=… → …`),
 * and on `origin/main` it reads `DISAGREE`, which is the operator's screenshot
 * reproduced as a frame.
 */
export const AuditEntityHidden: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		roster = auditRoster();
		return <AuditPage />;
	},
	play: async () => {
		await auditScene();
		await openAuditPopover();
		await pressSection("agents", false);
		await waitFor(() =>
			document.body.textContent?.includes("1 section hidden"),
		);
		await sleep(350);
	},
};

/**
 * The same switch pressed back ON, from the state the switch itself left behind
 * (the fixture seeds `hidden: ["agents"]`, which is what the store holds after
 * the frame above).
 *
 * ONE PRESS, and the seeded start is deliberate rather than convenient: the
 * first revision drove BOTH presses in one play and photographed the pair, and
 * a press into a panel that is still settling is a press the next render can
 * drop - the frame that existed was the one the LAST press produced, so the
 * state at the shutter was one press behind what the play believed. A frame
 * whose subject is "the switch puts the section back" needs exactly that press
 * and nothing else in flight, and the caption's own `Agents:` line is what says
 * the two halves agreed.
 */
export const AuditEntityRestored: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		roster = auditRoster();
		return <AuditPage />;
	},
	play: async () => {
		await auditScene({ hidden: ["agents"] });
		await openAuditPopover();
		await pressSection("agents", true);
		await settle(
			() => entityDrawn("agents") && switchState("agents") === "true",
		);
	},
};

/**
 * A CHAT section through the same control - the half that already worked, and
 * the control the audit's other rows are read against: `This week` is switched
 * off and the section leaves the chats region while the panel keeps drawing its
 * own row and tick.
 */
export const AuditChatSectionHidden: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		roster = auditRoster();
		return <AuditPage />;
	},
	play: async () => {
		await auditScene();
		await openAuditPopover();
		await pressSection("week", false);
		await settle(
			() => !chatsSectionDrawn("week") && switchState("week") === "false",
		);
	},
};

/**
 * `Pinned` through its own control - the THIRD call site of the same question.
 *
 * The chats list asks `pinnedShown` for this one and `drawnSections` for the
 * time sections below it, which is why the audit drives a frame of each rather
 * than trusting that one call site speaks for the other: the defect this pass
 * fixed was exactly a call site that did not ask at all.
 */
export const AuditPinnedHidden: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		roster = auditRoster();
		return <AuditPage />;
	},
	play: async () => {
		await auditScene();
		await openAuditPopover();
		await pressSection("pinned", false);
		await settle(
			() =>
				!chatsSectionDrawn("pinned") &&
				!rowDrawn("audit-pinned-new") &&
				switchState("pinned") === "false",
		);
	},
};

/**
 * `Teams` through the same gate as `Agents`, driven separately so the pair is
 * two photographs rather than one claim: the fix gates both entity sections, and
 * a frame of each is what says so.
 */
export const AuditTeamsHidden: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		roster = auditRoster();
		return <AuditPage />;
	},
	play: async () => {
		await auditScene();
		await openAuditPopover();
		await pressSection("teams", false);
		await settle(
			() =>
				!entityDrawn("teams") &&
				entityDrawn("agents") &&
				switchState("teams") === "false",
		);
	},
};

/** `Group by: Agent and team` - the list regroups under the bindings. */
export const AuditGroupAgent: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		roster = auditRoster();
		return <AuditPage />;
	},
	play: async () => {
		await auditScene();
		await openAuditPopover();
		await pressGroupBy("agent");
		await settle(
			() => chatsSectionDrawn("coder") && !chatsSectionDrawn("running"),
		);
	},
};

/**
 * `Group by: In one list` - one unlabelled group over the same rows.
 *
 * The PINNED rows are part of it, and the caption prints that: a grouping is an
 * arrangement, not a filter, so the two pinned conversations lead the flat list
 * here instead of vanishing with the `Pinned` section that the section
 * arrangement draws them in. On `origin/main` the caption's row order starts at
 * `audit-today-1` and neither pinned id appears.
 */
export const AuditGroupFlat: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		roster = auditRoster();
		return <AuditPage />;
	},
	play: async () => {
		await auditScene();
		await openAuditPopover();
		await pressGroupBy("flat");
		await settle(
			() =>
				chatsSectionDrawn("all") &&
				rowDrawn("audit-pinned-new") &&
				rowDrawn("audit-pinned-old"),
		);
	},
};

/**
 * `Order by: Most recent`, over the flat list so the order is directly readable.
 *
 * The live turn (`audit-busy-old`) carries no clock this arrangement can key it
 * by - no last-user time, no birth - so `Most recent` puts it after every row
 * that has one: the list's last place, past the ten-row page's cut. IT IS DRAWN
 * ANYWAY, at that position: since agent review round 1 the page is a window of
 * the arrangement PLUS every live row beyond it, and a disclosure must not hide
 * live work. The pair with `AuditOrderActiveFirst` is the point - both frames
 * DRAW the turn and differ by its POSITION (lifted into the band there, in place
 * at the end here), not by its presence; the round-2 re-shoot replaced the old
 * `expectGone`/`!rowDrawn` claim, which this head can never settle.
 */
export const AuditOrderMostRecent: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		roster = auditRoster();
		return <AuditPage />;
	},
	play: async () => {
		/*
		 * THE SHUTTER IS HELD (the repository's own latch): the rig's readiness
		 * probe is satisfied by the story's ELEMENTS, and this state is reached
		 * through four real presses - so without the latch the frame can be taken
		 * before the presses land. Round 2 kept the latch and rewrote the settle:
		 * the old predicate waited on the live row's ABSENCE under `Most recent`,
		 * which the window rule (A1) makes unreachable - the wait is now for the
		 * row DRAWN, in place, as the list's last row, which is the claim the
		 * frame carries.
		 */
		document.documentElement.dataset.capturePending = "1";
		try {
			await auditScene();
			await openAuditPopover();
			await pressGroupBy("flat");
			await pressGroupBy("recent");
			await settle(() => {
				const ids = drawnRowIds();
				return (
					rowDrawn("audit-busy-old") &&
					ids.indexOf("audit-busy-old") === ids.length - 1
				);
			});
		} finally {
			document.documentElement.dataset.capturePending = "";
		}
	},
};

/**
 * `Order by: Active first`, the same list one press later.
 *
 * The live turn is lifted into the running band, so it draws third - after the
 * two pinned rows, at the head of the page. THE TWO FRAMES DIFFER BY ITS
 * POSITION AND NOT BY ITS PRESENCE (reversed by round 2, the same day the
 * window rule landed): `Most recent` draws it too, in place as the last row,
 * because a live row is never withheld by the page's cut - what `Active first`
 * changes is WHERE it draws, which is what makes this pair evidence that the
 * two options are two comparators rather than one control writing the same
 * order twice.
 */
export const AuditOrderActiveFirst: Story = {
	render: () => {
		resetFixtures();
		bridge();
		split();
		roster = auditRoster();
		return <AuditPage />;
	},
	play: async () => {
		/* The latch, for the reason the story above states. */
		document.documentElement.dataset.capturePending = "1";
		try {
			await auditScene();
			await openAuditPopover();
			await pressGroupBy("flat");
			await pressGroupBy("recent");
			await pressGroupBy("active-first");
			/* Drawn INSIDE the ten-row window: the lift's own claim, as against the
			   story above, where the same row draws last. */
			await settle(
				() =>
					rowDrawn("audit-busy-old") &&
					drawnRowIds().indexOf("audit-busy-old") < 10,
			);
		} finally {
			document.documentElement.dataset.capturePending = "";
		}
	},
};
