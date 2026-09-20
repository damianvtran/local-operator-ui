/**
 * The chat sidebar's SPLIT: the boundary between the entity lists and the chats
 * list, the two collapse controls that live on it, the order control beside
 * them, and the restore row a hidden region leaves behind.
 *
 * ## What this story proves, and what it cannot
 *
 * These are the RESTING states, photographed with the split already resolved:
 * a stored height renders where it says, a collapsed region leaves a named row
 * behind, a query brings both regions back over a collapse that is still
 * persisted, and a window too short to host both floors clamps the render
 * without rewriting the preference.
 *
 * What a frame here does NOT prove, stated rather than implied:
 *
 *   - **It is not a drag.** The height is set through the store, so the frame
 *     is a resolved layout rather than a gesture. The drag itself is the
 *     driver's (`--scene sidebar-split`, `scripts/renderer-driver.mjs`), which
 *     enters Chromium's own input pipeline.
 *   - **It is not the reveal.** The cluster is revealed on `:hover`, and a
 *     story cannot enter a pseudo-class: `userEvent.hover` dispatches events,
 *     it does not hover. The revealed cluster is a driver frame for that
 *     reason, which is the same split of labour the class list beside this file
 *     already makes.
 *   - **It is not focus-dependent rendering.** A hidden window has no focus,
 *     so `:focus-visible` rings are not photographed here.
 *   - **It is not the restart.** That the values survive a second boot of the
 *     built app is the acceptance criterion, and only the driver's restart step
 *     can say it.
 *
 * ## What is stubbed, and what is not
 *
 * The real `ChatSidebar`, its real catalogue reads and its real split module.
 * Below them, `window.api.desktop.request` answers the four reads this surface
 * makes - `capabilities`, `sessions.list`, `profiles.list`, `teams.list` - plus
 * `sessions.search`, which the query state needs and which is answered with the
 * rows whose names contain the query. Anything else is refused BY NAME, so a
 * story that starts issuing a sixth call fails loudly instead of hanging on a
 * promise nothing answers.
 *
 * The readout beside the panel is a caption for the evidence, in the idiom
 * `chat-sidebar-status-feed.stories.tsx` uses: it prints the numbers the panel
 * is DRAWN from - the regions that exist, the separator's own `aria-valuenow`
 * and bounds, and the drawn height - read out of the DOM rather than typed by
 * hand, so a frame cannot claim a state the app does not hold.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import { type FC, useEffect, useState } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type { SidebarOrder, SidebarRegions } from "../sidebar-split";
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
 * Five conversations, newest first - the list draws top-down, so a row third in
 * the array can sit below the fold of a frame sized to the panel, and a frame
 * that does not contain the row a claim is about is not evidence about it.
 *
 * One is PINNED and one carries an UNREAD COMPLETION, which are the two marks
 * the list has an opinion about; the rest are the plain case.
 */
const roster = (): WireRow[] => [
	row("7c1f2e3d4a5b", "Quarterly revenue model", 1_760_000_500, {
		pinned: true,
	}),
	row("1a2b3c4d5e6f", "Reconcile the supplier ledger", 1_760_000_400, {
		status: { code: "busy", label: "Working" },
		status_revision: 3,
	}),
	row("2b3c4d5e6f70", "Migrate the deploy script", 1_760_000_300, {
		status: { code: "complete", label: "Complete" },
		status_revision: 4,
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
	}),
	/*
	 * A conversation the query state's word is IN, so that state's frame shows a
	 * match in BOTH regions rather than an empty list beside a matching agent -
	 * which is the claim, since a search that quietly stops looking in one of
	 * them is the thing the override exists to prevent.
	 */
	row("5e6f708192a3", "Reviewer rollout notes", 1_760_000_150, {
		status: { code: "idle", label: "Recent" },
		status_revision: 1,
	}),
	row("4d5e6f708192", "Tidy the migration fixtures", 1_760_000_100, {
		status: { code: "idle", label: "Recent" },
		status_revision: 1,
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

const TEAMS = ["release-crew", "docs-pod"];

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
					teams: TEAMS.map((name) => ({
						id: name,
						name,
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

type SplitState = {
	regions?: SidebarRegions;
	listHeight?: number | null;
	order?: SidebarOrder;
};

/**
 * The persisted split, written BEFORE the panel mounts so the frame is a
 * resolved layout rather than a transition.
 *
 * All three fields are written on every call, including the ones a state does
 * not use: this store persists, so a story that set only one of them would
 * inherit the previous story's answer for the others - which is the same
 * leakage the committed split has to survive, and not something a frame should
 * silently depend on.
 */
const split = ({
	regions = "both",
	listHeight = null,
	order = "entities-first",
}: SplitState = {}) => {
	useUiPreferencesStore.setState({
		chatSidebarRegions: regions,
		chatSidebarListHeight: listHeight,
		chatSidebarOrder: order,
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

/**
 * What a frame must have ON SCREEN before it is photographed.
 *
 * The plays state the claim rather than waiting a fixed lag, and each one names
 * its own state's shape: the entity rows by NAME, and the other region either by
 * a row count or as `"absent"` - which is the strongest form of a collapse
 * claim, since it says the region was UNMOUNTED rather than merely covered.
 */
/**
 * The panel's geometry, unchanged across consecutive polls.
 *
 * `readoutSettled` above only says the caption and the DOM AGREE - they can agree
 * on a layout that is still moving, which is how the light half of
 * `resting-default` came back describing a capacity 31px smaller than the dark
 * half's while both captions matched their own pixels (design round 1, D4). What
 * a captured frame needs is the state the story ENDS in, so this waits for three
 * consecutive samples to be identical before the shutter opens.
 */
const layoutSettled = () =>
	waitFor(
		() => {
			const sample = () => {
				const panel = document.querySelector<HTMLElement>(
					'[data-sidebar-region="chats"]',
				);
				const entities = document.querySelector<HTMLElement>(
					'[data-sidebar-region="entities"]',
				);
				const separator = document.querySelector<HTMLElement>(
					'[data-sidebar-split] [role="separator"]',
				);
				return [
					panel ? Math.round(panel.getBoundingClientRect().height) : -1,
					entities ? Math.round(entities.getBoundingClientRect().height) : -1,
					separator?.getAttribute("aria-valuenow") ?? "none",
				].join("/");
			};
			(globalThis as { __sidebarSamples?: string[] }).__sidebarSamples = [
				...((globalThis as { __sidebarSamples?: string[] }).__sidebarSamples ?? []),
				sample(),
			].slice(-3);
			const samples = (globalThis as { __sidebarSamples?: string[] })
				.__sidebarSamples as string[];
			return samples.length === 3 && new Set(samples).size === 1;
		},
		4_000,
	);

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
 * is about what is DRAWN: the separator's `aria-valuenow` is the height the
 * region is rendered at, and a stored value that disagrees with it is exactly
 * the defect the split's contract exists to prevent. The stored half is read
 * from the store for the same reason - so a frame that clamps a stored height
 * can show both numbers and let a reviewer see them differ.
 */
const Readout = () => {
	const regions = useUiPreferencesStore((state) => state.chatSidebarRegions);
	const storedHeight = useUiPreferencesStore(
		(state) => state.chatSidebarListHeight,
	);
	const order = useUiPreferencesStore((state) => state.chatSidebarOrder);
	const [drawn, setDrawn] = useState<string[]>([]);
	/*
	 * The two numbers a play function waits to agree with, carried as attributes
	 * so the wait is a comparison rather than a parse: this panel is a 200ms
	 * SAMPLE of the DOM, so a frame can otherwise be one poll behind the panel
	 * it captions - which is a caption that lies about a layout that is fine.
	 */
	const [agreed, setAgreed] = useState({ drawn: "none", now: "none" });
	useEffect(() => {
		const measure = () => {
			const separator = document.querySelector<HTMLElement>(
				'[data-sidebar-split] [role="separator"]',
			);
			const list = document.querySelector<HTMLElement>(
				'[data-sidebar-region="chats"]',
			);
			const restore = document.querySelector<HTMLElement>(
				"[data-sidebar-restore]",
			);
			const cluster = document.querySelector<HTMLElement>(
				"[data-sidebar-cluster]",
			);
			const drawnRegions = [
				...document.querySelectorAll<HTMLElement>("[data-sidebar-region]"),
			].map((node) => node.dataset.sidebarRegion ?? "?");
			const next = [
				`Regions drawn: ${
					drawnRegions.length === 0 ? "(none)" : drawnRegions.join(", ")
				}`,
				separator
					? `Separator: ${separator.getAttribute("aria-orientation")}, now ${separator.getAttribute("aria-valuenow")}, min ${separator.getAttribute("aria-valuemin")}, max ${separator.getAttribute("aria-valuemax")}`
					: "Separator: (no boundary)",
				`Chats region drawn at: ${
					list
						? `${Math.round(list.getBoundingClientRect().height)}px`
						: "(not mounted)"
				}`,
				`Restore row: ${
					restore
						? `${restore.dataset.sidebarRestore} — “${restore.textContent?.trim()}”`
						: "(none)"
				}`,
				`Cluster: ${cluster ? "mounted, hidden until hover" : "(none)"}`,
			];
			setDrawn((previous) =>
				previous.length === next.length &&
				previous.every((value, index) => value === next[index])
					? previous
					: next,
			);
			const values = {
				drawn: list
					? String(Math.round(list.getBoundingClientRect().height))
					: "none",
				now: separator?.getAttribute("aria-valuenow") ?? "none",
			};
			setAgreed((previous) =>
				previous.drawn === values.drawn && previous.now === values.now
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
			<p className="text-ink">The split as the app resolves it</p>
			{drawn.map((line) => (
				<p
					key={line}
					data-readout-drawn={
						line.startsWith("Chats region drawn at:") ? agreed.drawn : undefined
					}
					data-readout-now={
						line.startsWith("Separator:") ? agreed.now : undefined
					}
				>
					{line}
				</p>
			))}
			<p className="pt-2">
				Stored: {regions} ·{" "}
				{storedHeight === null ? "auto" : `${storedHeight}px`} · {order}
			</p>
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
 * claim. This waits for the sampled value to equal the live one.
 */
const readoutSettled = () =>
	waitFor(() => {
		const drawnLine = document.querySelector<HTMLElement>(
			"[data-readout-drawn]",
		);
		const nowLine = document.querySelector<HTMLElement>("[data-readout-now]");
		const panel = document.querySelector<HTMLElement>(
			'[data-sidebar-region="chats"]',
		);
		const separator = document.querySelector<HTMLElement>(
			'[data-sidebar-split] [role="separator"]',
		);
		const liveDrawn = panel
			? String(Math.round(panel.getBoundingClientRect().height))
			: "none";
		const liveNow = separator?.getAttribute("aria-valuenow") ?? "none";
		return (
			drawnLine?.dataset.readoutDrawn === liveDrawn &&
			nowLine?.dataset.readoutNow === liveNow
		);
	});

const meta = {
	title: "Chat sidebar/Sections",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/**
 * No stored split: the panel exactly as it ships.
 *
 * This is the frame the parity claim is judged on. With `listHeight` at `null`
 * the region is drawn at its content's height under the same cap it always
 * had, both regions are drawn, and the boundary is a hairline with nothing
 * revealed over it - which is what an upgrading user sees on their first
 * launch, and what every committed sidebar frame already photographs.
 */
export const RestingDefault: Story = {
	render: () => {
		bridge();
		split();
		return <Page />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
	},
};

/**
 * A split the user dragged: a stored pixel height, drawn at that height.
 *
 * The readout is the check - `now 320, min 72, max <capacity - 72>` and "Chats
 * region drawn at: 320px" are the same number, which is what "the separator
 * announces what the pane renders" means in practice.
 */
export const DraggedSplit: Story = {
	render: () => {
		bridge();
		split({ listHeight: 320 });
		return <Page />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
	},
};

/**
 * The chats list hidden: the entity region fills the column and a row at the
 * bottom names what is missing, with the count the list's own `All chats` row
 * carries - so the collapsed state tells the truth about how many chats there
 * are instead of hiding the panel's main signal.
 */
export const EntitiesOnly: Story = {
	render: () => {
		bridge();
		split({ regions: "entities" });
		return <Page />;
	},
	play: async () => {
		await settled({
			entities: ["coder", "reviewer", "architect"],
			chats: "absent",
		});
		await readoutSettled();
		await layoutSettled();
	},
};

/**
 * The mirror: the entity lists hidden, the restore row directly under the
 * search field, and the chats list filling the column.
 */
export const ChatsOnly: Story = {
	render: () => {
		bridge();
		split({ regions: "chats" });
		return <Page />;
	},
	play: async () => {
		await settled({ entities: "absent", chats: 3 });
		await readoutSettled();
		await layoutSettled();
	},
};

/**
 * A stored height the window cannot honour: the render clamps, the preference
 * survives.
 *
 * The frame carries both numbers on purpose - `Stored: … 900px` against a
 * `now` and a drawn height of `capacity - 72` - because the claim is precisely
 * that they DIFFER here and that the difference is not written back. Resize the
 * window tall again and the stored 900 is what renders, which is what a stored
 * pixel value is for.
 */
export const ShortWindow: Story = {
	render: () => {
		bridge();
		split({ listHeight: 900 });
		return <Page />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
	},
};

/**
 * The panel at the width clamp, where the boundary, the cluster's control
 * positions and the restore row have the least room they ever get.
 */
export const Narrow240: Story = {
	render: () => {
		bridge();
		split();
		return <Page sidebarWidth={240} />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
	},
};

/**
 * The swap: the chats list above, the entity lists below.
 *
 * This is the state design round 1's D2 found unphotographed while S9 still
 * declared reorder deferred, and it is the one layout in this change where more
 * than a number changes: the regions trade their `flex-1`/`shrink-0` roles, the
 * boundary moves to the other edge of the list region (`side="bottom"`), the
 * restore row would follow the hidden region, and the rule above the lower
 * region moves from the list to the entities. The readout prints the order and
 * the separator's `side` for exactly that reason - the frame has to say which
 * of the two orders it is, because the pixels alone do not.
 */
export const ChatsFirst: Story = {
	render: () => {
		bridge();
		split({ order: "chats-first" });
		return <Page />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
	},
};

/**
 * The same swap at the panel's width clamp, where the three cluster controls and
 * the entity rows have the least room they ever get.
 */
export const ChatsFirstNarrow: Story = {
	render: () => {
		bridge();
		split({ order: "chats-first" });
		return <Page sidebarWidth={240} />;
	},
	play: async () => {
		await settled({ entities: ["coder", "reviewer", "architect"], chats: 3 });
		await readoutSettled();
		await layoutSettled();
	},
};

/**
 * S7: a query renders BOTH regions over a collapse, and leaves the collapse
 * persisted.
 *
 * The chats list is hidden and the query is in the entity region's half - the
 * state that would otherwise leave `Search chats and agents` a promise the
 * panel cannot keep. The readout still says `Stored: entities`, which is the
 * half a frame can show: the collapse is not rewritten by the query, so
 * clearing it restores exactly what the user chose.
 */
export const QueryWhileCollapsed: Story = {
	render: () => {
		bridge();
		split({ regions: "entities" });
		return <Page />;
	},
	play: async () => {
		await settled({
			entities: ["coder", "reviewer", "architect"],
			chats: "absent",
		});
		await userEvent.type(
			screen.getByLabelText("Search chats and agents"),
			"reviewer",
		);
		// The box debounces at 150ms and the frame is of the ANSWERED state, so
		// this waits for the one agent AND the one conversation the word matches
		// to be on screen together, rather than for a duration.
		await waitFor(
			() =>
				entityRows().length === 1 &&
				entityRows()[0] === "reviewer" &&
				chatRows() === 1,
		);
		await readoutSettled();
		await layoutSettled();
	},
};
