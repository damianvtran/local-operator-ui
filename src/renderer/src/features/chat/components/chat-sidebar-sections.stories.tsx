/**
 * The chat sidebar's SECTIONS, as the merged panel draws them (operator report,
 * 2026-09-26): one scroller, the entity sections and the chats list as its flow.
 *
 * ## What this story proves, and what it cannot
 *
 * These are the RESTING states of the merged panel: the default as it ships, the
 * panel at its own width clamp, and a query that renders the one agent and the
 * one conversation it matches. THE SPLIT'S OWN STATES ARE RETIRED with the
 * split: the boundary, the collapse cluster, the stored list height and the
 * order swap are not drawn anywhere any more, so no honest frame of them exists
 * - `docs/evidence/chat-sidebar-sections/README.md` carries each one's record
 * and `scripts/capture-evidence.mjs` names the six retired rows.
 *
 * What a frame here does NOT prove, stated rather than implied:
 *
 *   - **It is not a gesture.** The split's drag had nothing left to size; the
 *     states here are resolved layouts, and the panel's own interactions (the
 *     view popover, the ladder) are the view-menu set's frames.
 *   - **It is not a claim about the ring's PIXELS.** The frames here are taken in
 *     a window without focus, and the app's `:focus-visible` styling is what the
 *     focus frame's ring is read from anyway: design round 1 (D2) measured the
 *     mark's ring off `sidebar-team-mark-focus`, and the defect it caught was a
 *     28x28 square drawn around what was then a 20px circle - fixed with
 *     `rounded-full`, and since 2026-10-02 the ring traces the mark's own pill
 *     (16px tall, `rounded-full` from the badge's `shape="pill"`), so the ring
 *     IS in that frame. What no frame here shows is a ring on any OTHER control.
 *
 * ## What is stubbed, and what is not
 *
 * The real `ChatSidebar`, its real catalogue reads and its real view module.
 * Below them, `window.api.desktop.request` answers the four reads this surface
 * makes - `capabilities`, `sessions.list`, `profiles.list`, `teams.list` - plus
 * `sessions.search`, which the query state needs and which is answered with the
 * rows whose names contain the query. Anything else is refused BY NAME, so a
 * story that starts issuing a sixth call fails loudly instead of hanging on a
 * promise nothing answers.
 *
 * The readout beside the panel is a caption for the evidence, in the idiom
 * `chat-sidebar-status-feed.stories.tsx` uses: it prints the numbers the panel
 * is DRAWN from - the regions that are mounted, the scroller's own content and
 * box, and the list's drawn height and row counts - read out of the DOM rather
 * than typed by hand, so a frame cannot claim a state the app does not hold.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useEffect, useState } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
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
	/**
	 * The agent that opened this conversation, when one did. PRESENCE is the fact
	 * (`SessionOpenedBy` may hold three nulls), and it is what selects the row's
	 * `team` trailing statement - the bubble's OTHER branch - rather than the flat
	 * `binding` one. Declared here because this story has to photograph both.
	 */
	opened_by?: {
		agent: string | null;
		label: string | null;
		session: string | null;
	} | null;
	status: { code: string; label: string };
	status_revision: number;
	status_epoch: string;
	attention?: Record<string, unknown>;
};

const EPOCH = "3f2a1b4c5d6e7f8091a2b3c4d5e6f708";

/**
 * A completion token, shaped like the backend's own `RequestID`.
 *
 * Per conversation and deterministic, because a token NAMES one completion: a
 * fixture that reused one row's token for another's conversation would
 * photograph a wire the app can never see.
 */
const unseenToken = (sessionId: string) =>
	`${sessionId.slice(0, 8)}-0000-4000-8000-${sessionId}`;

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
 * Eight conversations, newest first - the list draws top-down, so a row later in
 * the array can sit below the fold of a frame sized to the panel, and a frame
 * that does not contain the row a claim is about is not evidence about it. The
 * roster's SHAPE is this change's requirement: a team bound in BOTH list
 * sections, one AGENT-opened row (the `team` trailing statement) beside the flat
 * bindings (the `binding` one), one agent BINDING (which keeps its drawn name),
 * a long realistic title at each width, and one row per fixture team so every
 * mark this story draws is a mark a row names.
 *
 * Two are PINNED and one carries an UNREAD COMPLETION, which are the two marks
 * the list has an opinion about; the rest are the plain case.
 */
const roster = (): WireRow[] => [
	row(
		"7c1f2e3d4a5b",
		"Install the pinned uv on Windows arm64 via the bootstrap script",
		1_760_000_500,
		{
			pinned: true,
			binding: { agent: null, team: "data-quality" },
		},
	),
	row("9a0b1c2d3e4f", "Ship the session-avatar round", 1_760_000_450, {
		pinned: true,
		binding: { agent: null, team: "lopdev" },
	}),
	row("1a2b3c4d5e6f", "Reconcile the supplier ledger", 1_760_000_400, {
		status: { code: "busy", label: "Working" },
		status_revision: 3,
		binding: { agent: null, team: "delphi-quality" },
		/* AGENT-OPENED: the `team` trailing statement, the bubble's other branch. */
		opened_by: {
			agent: "coder",
			label: "Reconcile the supplier ledger",
			session: "session/1a2b3c4d5e6f",
		},
	}),
	row("2b3c4d5e6f70", "Migrate the deploy script", 1_760_000_300, {
		status: { code: "complete", label: "Complete" },
		status_revision: 4,
		binding: { agent: null, team: "hyperplane" },
		attention: {
			conversation_id: "session/2b3c4d5e6f70",
			completion_token: unseenToken("2b3c4d5e6f70"),
			anchor_id: "result-1",
			kind: "complete",
			unseen: true,
			revision: [4, 3],
		},
	}),
	row("3c4d5e6f7081", "Draft the incident postmortem", 1_760_000_200, {
		status: { code: "idle", label: "Recent" },
		status_revision: 2,
		binding: { agent: null, team: "content" },
	}),
	/*
	 * The query state's row, deliberately BOUND TO A TEAM: `helpdesk` carries no
	 * label, so the word finds it through its own slug and the row draws the
	 * bubble in the search-results path (a local match, never a conversation hit -
	 * a conversation match takes the `in conversation` statement instead).
	 */
	row("5e6f708192a3", "Reviewer rollout notes", 1_760_000_150, {
		status: { code: "idle", label: "Recent" },
		status_revision: 1,
		binding: { agent: null, team: "helpdesk" },
	}),
	row("4d5e6f708192", "Tidy the migration fixtures", 1_760_000_100, {
		status: { code: "idle", label: "Recent" },
		status_revision: 1,
		binding: { agent: null, team: "radient" },
	}),
	/*
	 * AN AGENT BINDING, which keeps its drawn name: no bubble is defined for an
	 * agent, and this is the row that shows the slot's two treatments side by side.
	 */
	row("6f708192a3b4", "Quarterly revenue model", 1_760_000_050, {
		status: { code: "idle", label: "Recent" },
		status_revision: 1,
		binding: { agent: "reviewer", team: null },
	}),
];

/**
 * Three roles and two teams, so both entity sections draw a real row.
 *
 * `source: "installed"` on all three, deliberately: a `builtin` profile is not
 * drawn as a row at all - the section groups the packaged ones behind a
 * "N built-in agents available" shortcut - so a fixture built out of builtins
 * would photograph an EMPTY entity region and quietly make every entity claim
 * in this file vacuous. The rule is the one `chat-sidebar-agents.stories.tsx`
 * documents at length.
 */
const PROFILES = [
	{ name: "coder", kind: "role", source: "installed" },
	{ name: "reviewer", kind: "role", source: "installed" },
	{ name: "architect", kind: "role", source: "installed" },
];

/**
 * The Teams section's roster, and the fixture the initials marks are read on.
 *
 * SEVEN TEAMS, CHOSEN SO A SINGLE FRAME CARRIES EVERY CASE THE MARK HAS: two
 * words (`Local Operator Development`), a labelled team whose letters come from
 * the LABEL (`Radient Development`), the operator's own list's spelling question
 * (`Hyperplane Development`, which this rule draws `HD` for - see the pull
 * request body), a single-word label (`Content` -> `CO`), a single-word SLUG with
 * no label at all (`helpdesk` -> `HE`, the fallback every backend that predates
 * labels produces), and one deliberate COLLISION: `data-quality` and
 * `delphi-quality` both draw `DQ`, which is the only case the tooltip exists to
 * settle and the only one a frame cannot show without two of them on screen.
 *
 * The rows below bind to six of the seven, in BOTH list sections, so no frame
 * about this change can claim a mark on a row it did not photograph.
 */
const TEAMS = [
	{ name: "lopdev", label: "Local Operator Development" },
	{ name: "radient", label: "Radient Development" },
	{ name: "hyperplane", label: "Hyperplane Development" },
	{ name: "data-quality", label: "Data Quality" },
	{ name: "delphi-quality", label: "Delphi Quality" },
	{ name: "content", label: "Content" },
	{ name: "helpdesk" },
];

const profile = ({ name, kind, source }: (typeof PROFILES)[number]) => ({
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

const bridge = () => {
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const rows = roster();
	const handler = async (request: BridgeRequest): Promise<DesktopResponse> => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						session_catalogue: 2,
						profile_catalogue: 1,
						team_catalogue: 1,
						session_pins: 1,
						session_search: 1,
					},
				});
			case "sessions.list":
				return ok({ sessions: rows, truncated: false });
			case "sessions.search": {
				/*
				 * Answered from the same fixture, by the rule the sidebar's own
				 * box applies: a hit is a row whose NAME contains the query. No
				 * `limit` games - the answer is what this fixture holds.
				 */
				const q = (request.q ?? "").toLocaleLowerCase();
				return ok({
					query: request.q ?? "",
					limit: 100,
					sessions: rows.filter((entry) =>
						entry.name.toLocaleLowerCase().includes(q),
					),
				});
			}
			case "profiles.list":
				return ok({ profiles: PROFILES.map(profile) });
			case "teams.list":
				return ok({
					teams: TEAMS.map(({ name, label }) => ({
						id: name,
						name,
						label,
						description: "",
						manager: PROFILES[2].name,
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
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: handler };
};

/* ------------------------------------------------------------ the fixture */

/**
 * The persisted preferences, reset BEFORE the panel mounts.
 *
 * The three legacy fields stopped deciding anything when the split was removed
 * (`sidebar-split.ts` is kept as its record); they are still reset here because
 * the store persists across stories in one session, so a reset is what keeps a
 * frame from silently inheriting another story's answer - the same leakage the
 * committed split had to survive.
 */
const resetPreferences = () => {
	useUiPreferencesStore.setState({
		chatSidebarRegions: "both",
		chatSidebarListHeight: null,
		chatSidebarOrder: "entities-first",
	});
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the DOM says what the story is about, rather than for a fixed lag. */
const waitFor = async (predicate: () => boolean, timeoutMs = 6_000) => {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate()) return;
		await sleep(50);
	}
	throw new Error("the fixture never reached the state this story photographs");
};

const entityRows = () =>
	[
		...document.querySelectorAll<HTMLElement>(
			'[data-sidebar-region="entities"] [data-entity-name]',
		),
	].map((node) => node.textContent?.trim() ?? "");

/*
 * `[data-tour-tag="chat-session-row"]` rather than `[data-chat-row]`, because
 * the latter is on the `All chats` control too - and a predicate that counted
 * that row would go on passing with no conversations on screen at all.
 */
const chatRows = () =>
	document.querySelectorAll(
		'[data-sidebar-region="chats"] [data-tour-tag="chat-session-row"]',
	).length;

/*
 * The team marks the rows are drawn with. Counted from the DOM for the same
 * reason the rows are: the caption is a claim about what is DRAWN, and on a tree
 * without the bubble this reads 0 while the rows are still drawn - which is
 * exactly the number a before frame should carry.
 */
const teamMarks = () =>
	document.querySelectorAll('[data-sidebar-region="chats"] [data-team-bubble]')
		.length;

/*
 * THE TWO NUMBERS THIS CHANGE IS PRICED ON (operator ask, 2026-10-01), read from
 * the DOM like every other line here: the FIRST chat row's title clip box, which
 * is the width the row gives its title (the pinned row in the resting states,
 * the matching row in the query state - the first drawn row either way, and the
 * one carrying the long realistic title where there is one), and the first row's
 * own height, which must not move. A frame pair shows the truncation; these lines
 * say what the box the truncation happens in measured, so the pair is a
 * measurement rather than an impression.
 */
const firstChatRow = () =>
	document.querySelector<HTMLElement>(
		'[data-sidebar-region="chats"] [data-tour-tag="chat-session-row"]',
	);
const firstTitleClip = () =>
	document.querySelector<HTMLElement>(
		'[data-sidebar-region="chats"] [data-session-title]',
	);

/** A drawn box's width, in whole pixels, or `none` when the element is not
 * drawn - the shape every line above uses for an absent region. */
const boxWidth = (node: HTMLElement | null) =>
	node === null
		? "none"
		: `${Math.round(node.getBoundingClientRect().width)}px`;
/** The same, for the height: the first row's box is the row height this change
 * must not move. */
const boxHeight = (node: HTMLElement | null) =>
	node === null
		? "none"
		: `${Math.round(node.getBoundingClientRect().height)}px`;

/**
 * The panel's geometry, unchanged across consecutive polls.
 *
 * A caption and the DOM can AGREE on a layout that is still moving - the light
 * half of `resting-default` came back describing a capacity 31px smaller than
 * the dark half's while both captions matched their own pixels (design round 1,
 * D4) - so what a captured frame needs is the state the story ENDS in: three
 * consecutive identical samples of the scroller's content and box, the list's
 * drawn height, and the READOUT's own two attributes. The caption is a 200ms
 * sample of a DOM this harness resizes after it, so agreeing with it as well
 * makes "the caption is stable" a check rather than a hope (agent review round
 * 2, M-1; design round 2, D4).
 */
const layoutSettled = () =>
	waitFor(() => {
		const sample = () => {
			const scroller = document.querySelector<HTMLElement>(
				'[data-sidebar-region="scroller"]',
			);
			const list = document.querySelector<HTMLElement>(
				'[data-sidebar-region="chats"]',
			);
			const scrollerLine = document.querySelector<HTMLElement>(
				"[data-readout-scroller]",
			);
			const listLine = document.querySelector<HTMLElement>(
				"[data-readout-list]",
			);
			return [
				scroller ? `${scroller.scrollHeight}/${scroller.clientHeight}` : "none",
				list ? Math.round(list.getBoundingClientRect().height) : -1,
				scrollerLine?.dataset.readoutScroller ?? "none",
				listLine?.dataset.readoutList ?? "none",
			].join("/");
		};
		(globalThis as { __sidebarSamples?: string[] }).__sidebarSamples = [
			...((globalThis as { __sidebarSamples?: string[] }).__sidebarSamples ??
				[]),
			sample(),
		].slice(-3);
		const samples = (globalThis as { __sidebarSamples?: string[] })
			.__sidebarSamples as string[];
		return samples.length === 3 && new Set(samples).size === 1;
	}, 4_000);

/**
 * What a frame must have ON SCREEN before it is photographed.
 *
 * The plays state the claim rather than waiting a fixed lag, and each one names
 * its own state's shape: the entity rows by NAME, and the chats list either by
 * a row count or as `"absent"` - which is the strongest form of a claim, since
 * it says the region was UNMOUNTED rather than merely covered. `"absent"` is
 * reachable for the chats list only (it unmounts when the catalogue gate
 * withdraws); the entity region renders unconditionally in the merged panel, so
 * the branch kept for it is an instrument nothing can fire - stated here so no
 * future play leans on it.
 */
type SettleSpec = {
	entities?: string[] | "absent";
	chats?: number | "absent";
};

const settled = ({ entities, chats }: SettleSpec) =>
	waitFor(() => {
		const entityRegion = document.querySelector(
			'[data-sidebar-region="entities"]',
		);
		const chatRegion = document.querySelector('[data-sidebar-region="chats"]');
		if (entities === "absent" && entityRegion !== null) return false;
		if (Array.isArray(entities)) {
			const names = entityRows();
			if (!entities.every((name) => names.includes(name))) return false;
		}
		if (chats === "absent" && chatRegion !== null) return false;
		if (typeof chats === "number") {
			if (chatRegion === null) return false;
			if (chatRows() < chats) return false;
		}
		return true;
	});

/* --------------------------------------------------------------- the page */

/**
 * The drawn panel, in numbers.
 *
 * Read from the DOM every 200ms rather than from the store, because the claim
 * is about what is DRAWN. The scroller and list lines carry
 * `data-readout-scroller` / `data-readout-list`, and every play waits for those
 * attributes to equal the live DOM, so a frame cannot be one poll behind the
 * panel it captions.
 */
const Readout = () => {
	const [drawn, setDrawn] = useState<string[]>([]);
	const [agreed, setAgreed] = useState({
		scroller: "none",
		list: "none",
		team: "none",
		title: "none",
		row: "none",
	});
	useEffect(() => {
		const measure = () => {
			const scroller = document.querySelector<HTMLElement>(
				'[data-sidebar-region="scroller"]',
			);
			const list = document.querySelector<HTMLElement>(
				'[data-sidebar-region="chats"]',
			);
			const regions = [
				...document.querySelectorAll<HTMLElement>("[data-sidebar-region]"),
			].map((node) => node.dataset.sidebarRegion ?? "?");
			const next = [
				`Regions drawn: ${
					regions.length === 0 ? "(none)" : regions.join(", ")
				}`,
				scroller
					? `Scroller: content ${scroller.scrollHeight}, box ${scroller.clientHeight}`
					: "Scroller: (not mounted)",
				`Chats list drawn at: ${
					list
						? `${Math.round(list.getBoundingClientRect().height)}px`
						: "(not mounted)"
				}`,
				`Rows drawn: ${entityRows().length} entity · ${chatRows()} chats`,
				`Team marks drawn: ${teamMarks()}`,
				`First title clip: ${boxWidth(firstTitleClip())}`,
				`First row box: ${boxHeight(firstChatRow())}`,
			];
			setDrawn((previous) =>
				previous.length === next.length &&
				previous.every((value, index) => value === next[index])
					? previous
					: next,
			);
			const values = {
				scroller: scroller
					? `${scroller.scrollHeight}/${scroller.clientHeight}`
					: "none",
				list: list
					? String(Math.round(list.getBoundingClientRect().height))
					: "none",
				team: String(teamMarks()),
				title: boxWidth(firstTitleClip()),
				row: boxHeight(firstChatRow()),
			};
			setAgreed((previous) =>
				previous.scroller === values.scroller &&
				previous.list === values.list &&
				previous.team === values.team &&
				previous.title === values.title &&
				previous.row === values.row
					? previous
					: values,
			);
		};
		measure();
		const timer = setInterval(measure, 200);
		return () => clearInterval(timer);
	}, []);
	return (
		<div className="w-[380px] shrink-0 space-y-2 border-l border-hairline p-4 text-meta text-ink-muted">
			<p className="text-ink">The panel as the app resolves it</p>
			{drawn.map((line) => (
				<p
					key={line}
					data-readout-scroller={
						line.startsWith("Scroller:") ? agreed.scroller : undefined
					}
					data-readout-list={
						line.startsWith("Chats list drawn at:") ? agreed.list : undefined
					}
					data-readout-team={
						line.startsWith("Team marks drawn:") ? agreed.team : undefined
					}
					data-readout-title={
						line.startsWith("First title clip:") ? agreed.title : undefined
					}
					data-readout-row={
						line.startsWith("First row box:") ? agreed.row : undefined
					}
				>
					{line}
				</p>
			))}
		</div>
	);
};

const Page: FC<{ sidebarWidth?: number }> = ({ sidebarWidth = 360 }) => (
	<div className="flex h-screen overflow-hidden bg-canvas text-ink">
		{/* The width is a parameter because the panel is resizable between the
		    app's own clamps, and the restore row, the cluster and the boundary
		    are all laid out against it. */}
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

/**
 * The readout's own numbers, in agreement with the DOM.
 *
 * Every play ends here. The readout samples the DOM every 200ms, so a capture
 * that lands between two samples files a frame whose caption is one poll old -
 * and a caption that disagrees with the panel is worse than no caption, because
 * the whole point of this surface's evidence is that the two numbers ARE the
 * claim. This waits for the sampled values to equal the live ones.
 */
const readoutSettled = () =>
	waitFor(() => {
		const scrollerLine = document.querySelector<HTMLElement>(
			"[data-readout-scroller]",
		);
		const listLine = document.querySelector<HTMLElement>("[data-readout-list]");
		const teamLine = document.querySelector<HTMLElement>("[data-readout-team]");
		const titleLine = document.querySelector<HTMLElement>(
			"[data-readout-title]",
		);
		const rowLine = document.querySelector<HTMLElement>("[data-readout-row]");
		const scroller = document.querySelector<HTMLElement>(
			'[data-sidebar-region="scroller"]',
		);
		const list = document.querySelector<HTMLElement>(
			'[data-sidebar-region="chats"]',
		);
		const liveScroller = scroller
			? `${scroller.scrollHeight}/${scroller.clientHeight}`
			: "none";
		const liveList = list
			? String(Math.round(list.getBoundingClientRect().height))
			: "none";
		return (
			scrollerLine?.dataset.readoutScroller === liveScroller &&
			listLine?.dataset.readoutList === liveList &&
			teamLine?.dataset.readoutTeam === String(teamMarks()) &&
			titleLine?.dataset.readoutTitle === boxWidth(firstTitleClip()) &&
			rowLine?.dataset.readoutRow === boxHeight(firstChatRow())
		);
	});

const meta = {
	title: "Chat sidebar/Sections",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/**
 * No stored state: the panel exactly as it ships.
 *
 * This is the frame the parity claim is judged on: both regions drawn inside
 * the one scroller, the entity sections above the chats list, nothing collapsed
 * and nothing stored - what an upgrading user sees on their first launch, and
 * what every committed sidebar frame already photographs.
 */
export const RestingDefault: Story = {
	render: () => {
		bridge();
		resetPreferences();
		return <Page />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
		/*
		 * And the readout AGAIN, after the layout has settled: the first pass
		 * asserts the caption agrees with the DOM, the second asserts it still
		 * agrees once the DOM has stopped moving. The harness resizes the
		 * content height after the last sample, so a caption checked only
		 * before the stability wait is a caption checked against a viewport
		 * that is about to change (agent review round 2, M-1).
		 */
		await readoutSettled();
	},
};

/**
 * The panel at its own width clamp, where the rows wrap hardest. (The clamp is the
 * panel's own `chatSidebarWidth`; the boundary and the restore row the old copy
 * named went with the split - this frame is about the width alone.)
 *
 * 240, not the clamp: this state predates this change and its frames are
 * committed evidence, so it is left exactly as it was and the clamp gets its own
 * state below.
 */
export const Narrow240: Story = {
	render: () => {
		bridge();
		resetPreferences();
		return <Page sidebarWidth={240} />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
		/*
		 * And the readout AGAIN, after the layout has settled: the first pass
		 * asserts the caption agrees with the DOM, the second asserts it still
		 * agrees once the DOM has stopped moving. The harness resizes the
		 * content height after the last sample, so a caption checked only
		 * before the stability wait is a caption checked against a viewport
		 * that is about to change (agent review round 2, M-1).
		 */
		await readoutSettled();
	},
};

/**
 * The panel at the app's TRUE minimum width.
 *
 * `SIDEBAR_MIN_WIDTH` is 220 (`chat-sidebar-layout.ts`), and `Narrow240` above
 * frames 240 - a width the panel can be dragged to, not the floor it is clamped
 * to. The bubble's own claim is about the space a row has LEFT for its title, so
 * the frame that has to exist is the one where the row has the least: 220. Both
 * are kept, because the 240 frame is committed evidence about the older change
 * and re-using it for this one would silently re-point a claim.
 */
export const NarrowMin220: Story = {
	render: () => {
		bridge();
		resetPreferences();
		return <Page sidebarWidth={220} />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
		await readoutSettled();
	},
};

/**
 * A query that renders both regions: the word finds one team and the one
 * conversation bound to it, and both draw.
 *
 * `Search chats and agents` is a promise the merged panel keeps - the word
 * narrows the entity sections and the chats list together. (The state used to
 * be photographed over the split's persisted collapse; the collapse is gone,
 * and the query's own claim is what is left.)
 *
 * THE QUERY IS DRIVEN BY THE CAPTURE ENTRY (`scripts/capture-evidence.mjs`), not
 * by this play: two play-driven mechanisms were measured against the rig —
 * `@storybook/test`'s `userEvent` (press the control, then type into the field)
 * and a direct native-setter plus `input` dispatch on the same field — and neither
 * reached the filtered state (the frame came back at 18642 bytes with ten entity
 * rows and no field drawn). The entry presses the control, waits out the field's
 * own mount-and-focus frame (`pressSettleMs: 400`), types through the real input
 * pipeline, and asserts the D4 fact at the shutter: the row the query matched
 * draws `[data-team-bubble]`. Opened by hand, this story therefore shows the
 * resting panel; the FILTERED panel is the one the entry photographs, and the
 * `QueryWhileCollapsed` frames in `evidence/team-avatar-1001/` are of that state.
 *
 * THE WORD IS A TEAM'S, not an agent's: this change replaces the drawn team name
 * in the results with a mark, and the state that has to exist is the one where a
 * TEAM-BOUND row is drawn by a SEARCH. `helpdesk` carries no label, so the row is
 * found by its own slug through the panel's local arm - a label match, never a
 * conversation hit - which is also what keeps this row on the `binding`
 * statement rather than the `in conversation` one: a conversation match replaces
 * the slot entirely and would photograph the mark's absence, not its presence.
 */
export const QueryWhileCollapsed: Story = {
	render: () => {
		bridge();
		resetPreferences();
		return <Page />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
		await readoutSettled();
	},
};
