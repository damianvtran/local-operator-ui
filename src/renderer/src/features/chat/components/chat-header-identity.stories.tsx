/**
 * The chat header's identity controls, as surfaces of their own.
 *
 * WHY THIS FILE EXISTS. The operator's request (2026-09-26) is a change to the
 * bar everybody looks at forty times an hour, and the claim - "the team and the
 * agent are now menus you can switch from the header" - is a claim about
 * pixels, hover, and what a menu holds when it opens. The real `ChatHeader`
 * needs a live session for any of it, and Storybook is the instrument here
 * that can supply one with no backend: the bridge below answers the same ops
 * the app's transport answers (`teams.list`, `commands.entities`,
 * `sessions.command`), so a reviewer can CLICK a control in these stories and
 * watch the real menus open.
 *
 * WHAT EACH STORY IS FOR:
 *
 * - `TeamBound` is the operator's own case ("typically would be 'manager'"):
 *   a team bound with no /agent, so the agent control reads the team's
 *   manager and the team control reads the team.
 * - `NoTeamNoAgent` is the assign affordance both controls fall to - subdued
 *   copy, a chevron, and a menu that can set either.
 * - `AgentAndTeam` is both bound: two independent controls, agent first, the
 *   order the joined description string had.
 * - `Before` renders TODAY's string (`description`, no identity): the half a
 *   before/after pair needs, and the one this file can render on both trees
 *   unchanged, because it uses nothing this branch adds.
 * - `Wide` is the same TeamBound arrangement at 1380, the width the operator's
 *   own screenshot was taken at.
 * - `TeamMenuEmpty` and `TeamMenuRefused` are the menu's two honest states:
 *   the catalogue answering with no rows, and the registry refusing in its own
 *   words - the latter behind the settle latch below, because a shutter can
 *   otherwise catch the retry window and photograph `Loading teams…`.
 * - `TeamMenuBusy` holds the receipt for six seconds so the trigger's busy
 *   spinner is photographable; `NarrowFold` is the operator's own 49-char
 *   title at the 560 band, where the identity folds onto the clipped line.
 * - `LongLabel` and `LongLabelMinWidth` are the width BOUND's two frames
 *   (design round 1, D1): a team whose label sits at the eighty-character
 *   ceiling the core contract allows, at the 560 band and at the app's own
 *   800 minimum, so the chip's cap - truncating, with the whole label and the
 *   slug in the tooltip - is photographed at both ends of the row's budget.
 *
 * The bridge is installed from `render`, synchronously, before the header
 * mounts - the pattern `session-archive.stories.tsx` documents - because a
 * mount effect runs after the header's first query and a capability answer
 * cached from a previous story would otherwise be the one this frame is
 * built from.
 */

import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import "../../../styles/index.css";
import { ChatHeader } from "./chat-header";
import type { HeaderIdentityData } from "./chat-header-identity";

const meta = {
	title: "Chat/Header identity",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

/**
 * The roster the long stories answer with: the operator's own twenty-odd
 * profiles, plus generated ones up to 150.
 *
 * WHY GENERATED. What the frames have to show is the BOUND - a list taller than
 * the panel, with a footer that says so and a filter that makes it short again -
 * and the roster is the operator's own machine's, which holds twenty-odd profiles
 * today and keeps growing. A hundred and fifty is the number the panel's
 * arithmetic is priced against, so the frame uses it rather than a roster sized
 * to look tidy. Two thirds are machine-named on purpose: a reader asked to review
 * real-looking names would review the names instead of the bound.
 */
/**
 * The profiles whose `delegate` flag is true, by name.
 *
 * WHY ONLY THREE (issue #861). The agent slot's constraint accepts the team's
 * manager and delegating profiles; the frames have to show BOTH accepted
 * classes and the refused one, so the fixture needs a coordinating profile
 * that is NOT the manager and that is visible near the top of the open panel -
 * `architect` is the first name in the roster, so the constrained frame's
 * first settable non-manager row is a photograph rather than a scroll away.
 * `manager` is the implicit seat this story's chip already reads, and
 * `pergamon-orchestrator` keeps the flag from looking like a two-name special
 * case.
 */
const LONG_AGENT_DELEGATES = new Set([
	"architect",
	"manager",
	"pergamon-orchestrator",
]);

const LONG_AGENTS = [
	"architect",
	"coder",
	"content-designer",
	"content-writer",
	"copy-reviewer",
	"cpp-parity-auditor",
	"data-entry",
	"designer",
	"manager",
	"pergamon-orchestrator",
	"post-analyst",
	"qa-tester",
	"readme-reader",
	"regulatory-review",
	"reviewer",
	"scout",
	"security-reviewer",
	"trend-scout",
	"tui-designer",
].map((name) => ({
	value: name,
	name,
	kind: "role",
	description: `The ${name} profile.`,
	delegate: LONG_AGENT_DELEGATES.has(name),
}));

for (let index = 0; index < 131; index += 1) {
	const name = `pergamon-enrichment-${String(index).padStart(3, "0")}`;
	LONG_AGENTS.push({
		value: name,
		name,
		kind: "specialist",
		description: "A Pergamon enrichment specialist.",
		delegate: false,
	});
}

/**
 * The two recents rings a story declares, so no frame depends on what a previous
 * run left in `localStorage`.
 *
 * Stable module constants rather than literals at the call sites: `Band` seeds
the store in a layout effect keyed on this object, and a fresh literal each
render would re-run that effect on every render.
 */
const NO_RECENTS = { agent: [] as string[], team: [] as string[] };
const SEEDED_RECENTS = {
	agent: ["reviewer", "coder", "qa-tester"],
	team: ["lopdev", "minerva"],
};

const SESSION = "2d5ad5da0025";

/**
 * One LABELLED team and one plain slug, so the frames cover the control's
 * label-first reading and the fallback a label-less backend produces. Rows the
 * gate resolves: `teams.list` and the same catalogue over `commands.entities`
 * (the menu), both carrying `label` where there is one.
 */
const TEAMS = [
	{
		name: "lopdev",
		label: "Local Operator Dev",
		manager: "manager",
		description: "Builds and ships local-operator itself.",
	},
	{
		name: "minerva",
		manager: "ops-lead",
		description: "The Minerva platform's own roster.",
	},
];

/**
 * A label at the OUTER EDGE of what the core contract allows: exactly eighty
 * characters.
 *
 * WHY THIS ROSTER EXISTS (design round 1, D1). The chip's box is `shrink-0`,
 * and before the cap an eighty-character label beside the agent chip pushed
 * the identity past the header block's clip - a control present but not
 * painted. The two `LongLabel` stories render this roster at the 560 band and
 * at the app's own 800 minimum so the remedy (truncation here, the whole
 * label and the slug in the tooltip) has frames at both widths rather than an
 * argument.
 */
const LONG_LABEL =
	"Data Quality, Sanctions Screening and Regulatory Reporting (Global Markets Desk)";

const LONG_LABEL_TEAMS = [
	{
		name: "data-quality",
		label: LONG_LABEL,
		manager: "manager",
		description: "Sanctions and regulatory data work.",
	},
	...TEAMS,
];

const AGENTS = [
	{
		value: "coder",
		name: "coder",
		kind: "role",
		description: "Implements one bounded slice.",
		/* A leaf: the near-miss row the constraint lists disabled, with the
		 * reason - and the explicit agent the `IncompatiblePair` stories put in
		 * the seat (issue #861). */
		delegate: false,
	},
	{
		value: "manager",
		name: "manager",
		kind: "role",
		description: "Orchestrates a team.",
		/* The team's manager: always settable, and this story's implicit seat
		 * (the model's own tests pin the name-over-flag half). */
		delegate: true,
	},
	{
		value: "ops-lead",
		name: "ops-lead",
		kind: "specialist",
		description: "The Minerva operations lead.",
		/* A coordinating profile beside the manager: the second accepted class,
		 * present so a constrained frame shows it settable. */
		delegate: true,
	},
	{
		value: "reviewer",
		name: "reviewer",
		kind: "role",
		description: "Reviews every diff.",
		delegate: false,
	},
];

type BridgeOptions = {
	/**
	 * Whether the catalogue answers rows at all, or refuses/empties/pends
	 * instead. `pending` holds `commands.entities` open FOREVER (a promise that
	 * never settles): the state a story needs when its claim is about the
	 * absence of a roster answer - the agent slot's cue must not be computed
	 * while the rows have not arrived (issue #861), and the panel's loading line
	 * is a real state - rather than about a refusal or an empty answer.
	 */
	entities?: "rows" | "empty" | "refused" | "pending";
	/**
	 * The agent roster this story's bridge answers with. Defaults to the small
	 * fixture; the long-roster stories pass `LONG_AGENTS` so the bound has
	 * something to bind against.
	 */
	agents?: typeof AGENTS;
	/**
	 * The team roster this story's bridge answers with, the same contract as
	 * `agents` above: the long-label stories pass `LONG_LABEL_TEAMS` so an
	 * eighty-character label is what the chip resolves.
	 */
	teams?: typeof TEAMS;
	/**
	 * How long `sessions.command` stays in flight. The busy state the rig
	 * photographs needs the receipt UNSETTLED at shutter time, and the story
	 * owes the frame that rather than a promise that races it.
	 */
	holdCommandMs?: number;
	/**
	 * The rename story's stand-in for the canonical stream: called with the name
	 * `sessions.command` `rename` carried, never before it - which is the
	 * no-optimistic-label rule the header documents, rendered as this story's own
	 * state so the save frame's title IS the submitted value.
	 */
	onRename?: (name: string) => void;
};

/**
 * The bridge, standing where the preload's `desktop.request` stands.
 *
 * One function rather than the app's transport, because these stories have no
 * app - but the ENVELOPE is the shipped one ({status, body:{result}}), so the
 * components' own `desktopResult` path is what unwraps these answers and
 * nothing about the read path is stubbed out.
 */
const installBridge = ({
	entities = "rows",
	holdCommandMs = 0,
	agents = AGENTS,
	teams = TEAMS,
	onRename,
}: BridgeOptions = {}) => {
	const ok = <T,>(result: T) => ({ status: 200, body: { result } });
	const bridge = async (request: {
		op: string;
		command?: string;
		args?: string;
	}) => {
		switch (request.op) {
			case "teams.list":
				return ok({ teams });
			case "commands.entities":
				if (entities === "refused") {
					return {
						status: 503,
						body: { detail: "The profile registry is unavailable." },
					};
				}
				/*
				 * The never-answering roster (`pending`): a promise that never settles,
				 * so "still loading" is a fact of the story rather than of the
				 * shutter's timing - a hold that expired mid-capture would be the
				 * design-D1 flake class (a frame filed under a state the run had
				 * left). The `teams.list` answer above stays real, because the cue's
				 * silence must come from the MISSING roster and not from a missing
				 * manager.
				 */
				if (entities === "pending") {
					return new Promise<{ status: number; body: unknown }>(() => {});
				}
				return ok({
					command: request.command ?? "team",
					entities:
						entities === "rows"
							? request.command === "agent"
								? agents
								: teams.map((team) => ({ ...team, value: team.name }))
							: [],
					current: null,
				});
			case "sessions.command":
				/*
				 * `holdCommandMs` is the busy frame's fixture: the receipt is held
				 * long enough that the trigger is still `aria-busy` when the shutter
				 * fires, and the entry's own claim reads that attribute from the DOM
				 * rather than trusting the timing (see the rig's busy entry).
				 */
				if (holdCommandMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, holdCommandMs));
				}
				/*
				 * The rename repaint: the story's own state moves ON THE RECEIPT,
				 * the same moment the canonical stream would repaint the title in
				 * the app.
				 */
				if (request.command === "rename" && onRename) {
					onRename(request.args ?? "");
				}
				return ok({
					command: request.command ?? "",
					result: {
						kind: "notice",
						text: "the pick was received",
						style: "info",
						data: {},
					},
				});
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};

	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (r: {
					op: string;
					command?: string;
					args?: string;
				}) => Promise<{ status: number; body: unknown }>;
			};
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

/**
 * The band the header's own frames use: the production component on the ground
 * it really sits on, deliberately not narrowed further - the identity controls
 * are a width question, and a frame at a width the app does not have would
 * price them against a bar nobody uses.
 */
const Band = ({
	width = 560,
	rings = NO_RECENTS,
	children,
}: {
	width?: number;
	/**
	 * The recents rings this frame is rendered against.
	 *
	 * SEEDED HERE rather than left to the browser: the ring is persisted
	 * (`localStorage`), so a frame that did not declare it would show whatever a
	 * previous story - or a previous run of the sweep - happened to leave behind,
	 * and a reviewed "no recents band" frame could quietly acquire one. Default
	 * empty, which is the fresh-install state every existing frame is about.
	 */
	rings?: { agent: string[]; team: string[] };
	children: ReactNode;
}) => {
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({ profileRecents: rings });
	}, [rings]);
	return (
		<div
			/* An inert hook, for the measurement pass rather than any frame: it is
			   what a driver grabs to re-price the same band at the app's own widths
			   (the 220px pane-open header, the 560 band) without a second story. */
			data-header-band=""
			className={cn("flex h-[84px] shrink-0 flex-col bg-canvas")}
			style={{ width }}
		>
			{children}
		</div>
	);
};

const identity = (over: Partial<HeaderIdentityData>): HeaderIdentityData => ({
	sessionId: SESSION,
	activeAgent: null,
	activeTeam: null,
	boundAgent: null,
	boundTeam: null,
	...over,
});

export const TeamBound: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

export const NoTeamNoAgent: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="~"
					identity={identity({})}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

export const AgentAndTeam: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="ops-lead · lopdev"
					identity={identity({ activeAgent: "ops-lead", activeTeam: "lopdev" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The legacy, incompatible pair (issue #861's second half): an explicit agent
 * the team's constraint does not accept, under a team it does not run.
 *
 * WHAT THE FRAMES ARE. `conflict-chip` is the cue at rest - the persona still
 * visible, because it is in the prompt, with the warning mark that says the
 * pair needs resolving - and `conflict-agent-open` is the panel where one
 * normal pick resolves it: the manager and the delegating profiles are
 * settable, the current (refused) row is listed disabled with its reason, and
 * the rule is stated above the list.
 *
 * WHY `coder`, AND WHY BESIDE `AgentAndTeam`. `coder` is a leaf
 * (`delegate: false`), which is exactly what makes the pair incompatible; the
 * delegating profile in the same seat is LEGAL and is the story next door -
 * the two together are the case a name-inequality test gets wrong, and the
 * rig's claims on the pair (`agent-and-team` asserts the cue is GONE) keep the
 * two apart.
 */
export const IncompatiblePair: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="coder · lopdev"
					identity={identity({ activeAgent: "coder", activeTeam: "lopdev" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The same pair with the roster STILL ANSWERING: `commands.entities` never
 * settles, so no row - and no `delegate` datum - has arrived.
 *
 * THE TWO CLAIMS THIS STORY CARRIES ARE BOTH NEGATIVE ONES. The chip must not
 * grow the cue from the names alone while the data is missing
 * (`conflict-chip-loading` asserts the cue is GONE), and the open panel must
 * show its honest `Loading agents…` line with NO constraint caption
 * (`agent-menu-loading` asserts the loading hook is present and the caption
 * hook is absent) - a rule stated before its roster has answered would be a
 * claim about a team made from data this app does not have.
 */
export const IncompatiblePairLoading: Story = {
	render: () => {
		installBridge({ entities: "pending" });
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="coder · lopdev"
					identity={identity({ activeAgent: "coder", activeTeam: "lopdev" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/** The half a pair needs: today's plain string, with nothing this branch adds. */
export const Before: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/** The operator's own width, same arrangement as `TeamBound`. */
export const Wide: Story = {
	render: () => {
		installBridge();
		return (
			<Band width={1380}>
				<ChatHeader
					agentName="Redesign local-operator-ui installer loading panel"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/** The team menu's honest empty state, for a catalogue with no teams. */
export const TeamMenuEmpty: Story = {
	render: () => {
		installBridge({ entities: "empty" });
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * Holds the shutter until the REFUSED row has settled.
 *
 * WHY THIS EXISTS (design D1 / agent review round 1's finding 2). The story's
 * bridge answers `commands.entities` with a 503, and the app's own query
 * policy retries once after its default delay - so for about a second after
 * the menu opens, the row reads `Loading teams…`; the first sweep's shutter
 * fired in that window and committed a loading row under the refusal's name.
 * The fix is not a longer sleep but a SETTLE CONDITION: this component sets
 * the rig's `capturePending` latch on mount (layout effect, so it is on the
 * document before the readiness probe can conclude) and clears it only when
 * the refusal row itself - `[data-header-identity-error]`, the hook the
 * component puts on that label - is in the DOM. The rig waits on the latch
 * before any shutter (capture-evidence.mjs), so the frame cannot be taken
 * mid-fetch by construction, and the entry's `expectPresent` on the same hook
 * makes a regression fail the run rather than photograph the wrong state.
 */
const RefusedSettleLatch = () => {
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const poll = () => {
			if (cancelled) return;
			if (document.querySelector("[data-header-identity-error]")) {
				delete document.documentElement.dataset.capturePending;
				return;
			}
			window.setTimeout(poll, 100);
		};
		window.setTimeout(poll, 100);
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, []);
	return null;
};

/**
 * The team menu's honest failure state: the owner's own refusal text.
 *
 * The latch beside it is load-bearing: without it the shutter can fire while
 * the query is still retrying and file `Loading teams…` under this story's
 * name - the defect that made this frame's first capture wrong while the
 * component itself was right (design round 1, D1).
 */
export const TeamMenuRefused: Story = {
	render: () => {
		installBridge({ entities: "refused" });
		return (
			<Band>
				<RefusedSettleLatch />
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The switch IN FLIGHT: the trigger's own busy state, photographed rather than
 * argued. The bridge holds the receipt for six seconds and the entry drives
 * the pick keyboard-first, so the frame carries the spinner in the chevron's
 * slot while `aria-busy` is true - the state design round 1's D4 called
 * unframed, and the one whose docblock claims a switch never moves the box.
 */
export const TeamMenuBusy: Story = {
	render: () => {
		installBridge({ entities: "rows", holdCommandMs: 6000 });
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The operator's own title length at the 560 band - the frame UX round 1's U2
 * was measured on.
 *
 * Design round 1's D3 asked for this boundary frame, and it used to record the
 * fold: the identity line wrapped onto the clipped second line there - the
 * controls PRESENT but not visible, the keyboard their only path. U2 then
 * measured what that cost the pointer (`elementFromPoint` at the chip's own
 * centre hit the band and a press opened nothing - a control that is not
 * painted cannot be pressed), so the block no longer wraps while the controls
 * are its second half (see `chat-header.tsx`): the title yields and truncates,
 * the chip keeps its room, and this frame shows the chips ON the painted line.
 */
export const NarrowFold: Story = {
	render: () => {
		installBridge();
		return (
			<Band>
				<ChatHeader
					agentName="Redesign local-operator-ui installer loading panel"
					description="manager · lopdev"
					identity={identity({ activeTeam: "lopdev" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The eighty-character label at the 560 band, the width the header's frames
 * are priced against (design round 1, D1).
 *
 * WHAT THE FRAME IS FOR: the chip's cap does the truncating while the title
 * carries the whole label and the slug, and the row keeps the agent chip and
 * the controls painted - the state the uncapped chip broke at this width.
 */
export const LongLabel: Story = {
	render: () => {
		installBridge({ teams: LONG_LABEL_TEAMS });
		return (
			<Band>
				<ChatHeader
					agentName="Redesign local-operator-ui installer loading panel"
					description="manager · data-quality"
					identity={identity({ activeTeam: "data-quality" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The same eighty-character label at the app's own 800 minimum width (D1):
 * the wider budget the cap must still leave the title and the controls.
 */
export const LongLabelMinWidth: Story = {
	render: () => {
		installBridge({ teams: LONG_LABEL_TEAMS });
		return (
			<Band width={800}>
				<ChatHeader
					agentName="Redesign local-operator-ui installer loading panel"
					description="manager · data-quality"
					identity={identity({ activeTeam: "data-quality" })}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * A hundred and fifty agents, and the panel the operator asked for.
 *
 * WHAT THIS FRAME IS FOR (operator, 2026-09-26, second report): "the height is
 * unbounded and goes past the height of the screen, make sure there's a
 * reasonable height bound and it might be good to add a search filter to each".
 * So this story answers a roster nobody can read a screen at a time, and the
 * arms that photograph it are:
 *
 * - the panel OPEN (the agent trigger pressed), which shows the bound: a panel
 *   that stops short of the window's edge, a scrollable list inside it, and a
 *   footer naming the roster's full size - the difference between a bound and a
 *   truncation, photographed;
 * - the same panel in a SHORT window, where the ceiling is no longer the binding
 *   term and Radix's available height is - the case a fixed `max-height` gets
 *   wrong;
 * - the panel with a filter typed into it, and with a filter that matches
 *   NOTHING, which is the state most likely to be ugly and the one no still can
 *   be argued about.
 *
 * The agent and team controls are the same component with different nouns, so the
 * team panel is photographed on this same roster shape by `RecentsBelow` and the
 * existing `team-menu-open` arm; a reviewer should not have to take the two
 * agreeing on trust.
 */
export const LongRoster: Story = {
	render: () => {
		installBridge({ agents: LONG_AGENTS });
		return (
			<Band>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({
						activeTeam: "lopdev",
						activeAgent: "architect",
					})}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The same roster on a band pinned to the BOTTOM of the viewport.
 *
 * WHY A SECOND STORY FOR GEOMETRY. The operator's third ask is about a menu
 * opened where there is no room under it ("a menu opened near the bottom of the
 * screen has to cope with that, not overflow off-screen"). Every other story puts
 * the band at the top, which is where the header really lives - so the only way
 * to photograph the flip and the shrink is to move the band, and the story says
 * so rather than pretending the app's header can be at the bottom of the window.
 * The panel must open UPWARD here, bounded by the room above the chip.
 */
export const LongRosterAtTheBottom: Story = {
	render: () => {
		installBridge({ agents: LONG_AGENTS });
		return (
			<div className="flex min-h-screen w-full flex-col justify-end bg-canvas">
				<Band>
					<ChatHeader
						agentName="Install the pinned uv on Windows"
						description="manager · lopdev"
						identity={identity({
							activeTeam: "lopdev",
							activeAgent: "architect",
						})}
						renameSessionId={SESSION}
						onOpenOptions={() => undefined}
					/>
				</Band>
			</div>
		);
	},
};

/**
 * A ring that has history: the recents band above the roster, in both menus.
 *
 * The other half of the pair is every other story in this file - a fresh install,
 * where the ring is empty and the panel must render NO band and NO heading rather
 * than an empty `Recent agents` strip. Both halves are captured, because "empty
 * recents is not a defect, it is the first-run state" is a claim about pixels.
 *
 * The rings are seeded by `Band` (see its `rings` prop) rather than by a
 * localStorage fixture, so the frame cannot inherit whatever a previous story
 * left behind.
 */
export const Recents: Story = {
	render: () => {
		installBridge({ agents: LONG_AGENTS });
		return (
			<Band rings={SEEDED_RECENTS}>
				<ChatHeader
					agentName="Install the pinned uv on Windows"
					description="manager · lopdev"
					identity={identity({
						activeTeam: "lopdev",
						activeAgent: "architect",
					})}
					renameSessionId={SESSION}
					onOpenOptions={() => undefined}
				/>
			</Band>
		);
	},
};

/**
 * The INLINE RENAME as a state a reviewer can drive (the operator's report,
 * 2026-09-26): the pencil opens an editor in the title's own slot - the name
 * selected, the pencil become an X - and a save submits `sessions.command`
 * `rename` through the same hook the picker runs.
 *
 * The bridge's `onRename` is the canonical-stream stand-in this story has no
 * socket for: it repaints the title with the name the command CARRIED, on the
 * receipt - never before it, which is the header's no-optimistic-label rule
 * rendered as the story's own state. The save frame's title is therefore the
 * submitted value, and the two cancel entries' titles are the old one.
 *
 * The state is a component rather than an inline `render` body because it is
 * stateful: `useState` + a bridge callback is exactly the pair the app's stream
 * subscription is, at story scale.
 */
const RenameInlineBand = () => {
	const [name, setName] = useState("Install the pinned uv on Windows");
	installBridge({ onRename: setName });
	return (
		<Band>
			<ChatHeader
				agentName={name}
				description="manager · lopdev"
				identity={identity({ activeTeam: "lopdev" })}
				renameSessionId={SESSION}
				onOpenOptions={() => undefined}
			/>
		</Band>
	);
};

export const RenameInline: Story = {
	render: () => <RenameInlineBand />,
};

/**
 * The save IN FLIGHT, the state whose absence UX round 1's U2/U3 named: the
 * bridge holds the receipt for six seconds, so a shutter can catch the editor
 * mid-save - the slot showing the busy spinner in the X's place, `aria-busy`
 * on the control, and the field carrying `[readonly]` (the two halves of the
 * committed-save rule: a late Esc or X click no-ops, and typing cannot land in
 * a field the write already ignores).
 */
const RenameInlineSavingBand = () => {
	installBridge({ holdCommandMs: 6000 });
	return (
		<Band>
			<ChatHeader
				agentName="Install the pinned uv on Windows"
				description="manager · lopdev"
				identity={identity({ activeTeam: "lopdev" })}
				renameSessionId={SESSION}
				onOpenOptions={() => undefined}
			/>
		</Band>
	);
};

export const RenameInlineSaving: Story = {
	render: () => <RenameInlineSavingBand />,
};
