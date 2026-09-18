import {
	DEFAULT_SETTINGS_SECTIONS,
	SettingsSidebar,
} from "@features/settings/components/settings-sidebar";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { ChatSidebar } from "./chat-sidebar";

/*
 * The chat sidebar with a row that is CURRENT, and with the New chat row current —
 * plus the settings rail's current section, the other panel that paints the same
 * role.
 *
 * Two states one change touched, photographed on the panel's own ground in every
 * theme — plus the two arrangements where the mark is drawn on an ink the other
 * three never reach (a `· lopdev` binding inside a current row, and a nested row
 * under its agent). `chat-sidebar-status-feed.stories.tsx` renders this same
 * component for the frame-delivered row status, and this file exists for the same
 * reason it does: the sidebar cannot be rendered in isolation — it reads the
 * router, the canonical sessions store and the desktop capability hooks — and a
 * claim about which GROUND a row paints is a claim about pixels, not about a
 * class string. `scripts/chat-sidebar-selection.test.mjs` resolves the class
 * expressions, and a green assertion there proves the merge, not that the panel
 * looks right.
 *
 * The settings rail is in this file for the reason the set exists: both panels
 * take ONE role decision from ONE palette value and mark it with one two-part
 * mark, so a second set would be two instruments for one fact. It was a stated
 * gap before — the shipped `settings-appearance` story sets `capturePending` and
 * never clears it offline, which aborts a sweep before it reaches the rail — and
 * rendering the component directly closes it.
 *
 * ## What is stubbed, and how little
 *
 * Only the desktop transport: `capabilities` (which is what puts the New chat row
 * on screen at all — `ready` is `session_catalogue` 2 over an answered list) and
 * `sessions.list`. The rows, the store, the component and every Tailwind role
 * utility are the app's own, and the ground under them is whatever the theme says
 * `surface` and `highlight` are. The roster is a fixture because a story has no
 * backend; nothing about its content is under test.
 *
 * ## Why BOTH states are here rather than one
 *
 * They are the two places the change is visible in this panel: a conversation row
 * wearing `highlight`, and the New chat row wearing it while its caps sit on top
 * of it. The second was a special case until this change — the caps carried the
 * same `sunken` fill the row's ground was, so on this one row they needed a
 * caller-supplied outline to be visible at all — and the pair is what shows the
 * special case is gone.
 *
 * The rest of the panel is deliberately not re-shot here: the All chats filter,
 * the entity rows and the hover states are the same role at the same call sites
 * (`docs/evidence/chat-sidebar-selection/` carries them, with its own note on
 * where its frames stop describing the shipped ground). The two states added in
 * round 2's remediation are exceptions to that rule rather than a widening of
 * it: a BOUND row and a NESTED row are the only places this panel draws the
 * mark's own trailing ink and its inset geometry, and neither was reachable in
 * any frame when the round-1 streams looked.
 */

/** The `sessions.list` wire row, in the fields the sidebar reads. */
const wireRow = (
	id: string,
	name: string,
	mtime: number,
	binding: { agent: string | null; team: string | null } = {
		agent: null,
		team: null,
	},
	active = true,
) => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active,
	binding,
	status: { code: "idle", label: "Recent" },
});

const REVENUE = "0f1e2d3c4b5a";
const LEDGER = "1a2b3c4d5e6f";
const DEPLOY = "2b3c4d5e6f70";
const BOUND = "3c4d5e6f7081";
const NESTED = "4d5e6f708192";

/*
 * The roster is MUTABLE because the states differ in more than which row is
 * selected: two of them need a row that carries a binding (`· lopdev`), and one
 * needs a child row that belongs to an agent's own list rather than to the flat
 * global partition. The stub below reads it at call time, which is after the
 * story's `render` has set it and before the component mounts.
 */
const DEFAULT_ROSTER = [
	wireRow(LEDGER, "Reconcile the supplier ledger", 1_760_000_300),
	wireRow(DEPLOY, "Migrate the deploy script", 1_760_000_200),
	wireRow(REVENUE, "Quarterly revenue model", 1_760_000_100),
];
let roster = DEFAULT_ROSTER;

/*
 * The TEAM catalogue the entity lists are built from, empty unless a story needs
 * a team row — the same arrangement, and the same reason, as `agentCatalogue`
 * below: an entity row nobody can reach is a surface nobody has looked at.
 */
let teamCatalogue: unknown[] = [];

/* The agent an agent-bound conversation is bound to. Named because the binding
   label, the entity row's name and the profile fixture all have to agree. */
const LOPDEV = "lopdev";

/*
 * A roster whose third row carries a binding, so the current row draws the
 * `· lopdev` half of its trailing statement INSIDE the mark: `ink-muted` on
 * `highlight`, which is the pair the ink floors are measured for, and the case
 * the operator's own screenshot shows. Kept third for the same reason the
 * default roster's current row is third — a row above it is what a hover
 * comparison needs.
 */
const BOUND_ROSTER = [
	wireRow(LEDGER, "Reconcile the supplier ledger", 1_760_000_300),
	wireRow(DEPLOY, "Migrate the deploy script", 1_760_000_200),
	wireRow(BOUND, "Quarterly revenue model", 1_760_000_100, {
		agent: LOPDEV,
		team: null,
	}),
];

/*
 * A roster with a CHILD row — a conversation bound to an agent — and it is
 * INACTIVE on purpose: the flat Active chats partition only draws active rows,
 * so an inactive one appears under its agent's entity row and nowhere else, and
 * the frame is a picture of one marked row rather than two.
 */
const NESTED_ROSTER = [
	wireRow(LEDGER, "Reconcile the supplier ledger", 1_760_000_300),
	wireRow(DEPLOY, "Migrate the deploy script", 1_760_000_200),
	wireRow(
		NESTED,
		"Quarterly revenue model",
		1_760_000_100,
		{
			agent: LOPDEV,
			team: null,
		},
		false,
	),
];

/* The agent catalogue the entity list is built from. Empty unless a story needs
   an entity row, because an entity the story does not render against is a row
   that moves every other row in the frame. */
let agentCatalogue: unknown[] = [];
const LOPDEV_PROFILE = {
	name: LOPDEV,
	kind: "role" as const,
	source: "installed" as const,
	agent_id: null,
	description: "",
	tools: null,
	effort: null,
	delegate: false,
};

/* The `teams.list` wire row, in the fields the entity list reads. */
const team = (name: string) => ({
	id: name,
	name,
	description: "",
	manager: "manager",
	members: [],
});

/*
 * The teams the entity list is built from, with the operator's own four rows:
 * the report this pair of states exists for is a screenshot of THIS list, and a
 * fixture team nobody has rendered is a row that cannot be compared with it.
 *
 * The counts are not fixtures — an entity row draws `children(kind, name).length`,
 * so a team's number is however many chats `roster` binds to it.
 */
const TEAM_ROSTER = [
	team(LOPDEV),
	team("data-investigations"),
	team("data-quality"),
	team("minervadev"),
];

/*
 * The roster the two entity-row states below render against: the default three
 * chats, plus one row bound to each of three teams and one bound to the agent.
 *
 * THE BOUND ROWS ARE INACTIVE, and that is what keeps each drawn once. The flat
 * Active chats partition draws every active row, entity children included, so an
 * active bound row appears in two lists at the same time — the arrangement
 * `NestedRowCurrent` states for itself.
 */
const ENTITY_ROSTER = [
	wireRow(REVENUE, "Quarterly revenue model", 1_760_000_300),
	wireRow(LEDGER, "Reconcile the supplier ledger", 1_760_000_200),
	wireRow(DEPLOY, "Migrate the deploy script", 1_760_000_100),
	wireRow(
		"5e6f708192a3",
		"Rank the investigation queue",
		1_760_000_050,
		{ agent: null, team: "data-investigations" },
		false,
	),
	wireRow(
		"6f708192a3b4",
		"Audit the quality rules",
		1_760_000_040,
		{ agent: null, team: "data-quality" },
		false,
	),
	wireRow(
		"708192a3b4c5",
		"Spec the topology rename",
		1_760_000_030,
		{ agent: null, team: LOPDEV },
		false,
	),
	wireRow(
		"8192a3b4c5d6",
		"Draft the migration note",
		1_760_000_020,
		{ agent: LOPDEV, team: null },
		false,
	),
];

/** Which conversation is marked current, per story. */
let selected: string | undefined = REVENUE;

/**
 * Whether a draft is staged against the New chat row itself.
 *
 * `activeDraftKey` with NO entry in `drafts` is the shape the app reaches through
 * the `⌘N` chord: the key is the row's own mark (`Boolean(activeDraftKey) &&
 * !draft?.target`), and a draft carrying a target belongs to an ENTITY row
 * instead, which would mark a different row than this story is about.
 */
let draftKey: string | null = null;

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (request: { op: string }) => Promise<unknown>;
			};
		};
	};
	const api = (page.api ?? {}) as NonNullable<typeof page.api>;
	const desktop = (api.desktop ?? {}) as NonNullable<
		NonNullable<typeof page.api>["desktop"]
	>;
	const ok = (result: unknown) => ({ status: 200, body: { result } });
	/*
	 * Anything else is refused BY NAME rather than left to hang: a story that
	 * starts issuing a third call fails loudly instead of photographing a spinner.
	 */
	desktop.request = async (request: { op: string }) => {
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
					},
				});
			case "sessions.list":
				return ok({ sessions: roster, truncated: false });
			/*
			 * The agent and team catalogues, which the entity lists are built from.
			 * Stubbed rather than left to fail because one of the states here is a
			 * NESTED row — a conversation bound to an agent renders under that agent's
			 * own row, not in the flat partition — and an entity list nobody can reach
			 * is a surface nobody has looked at. `agentCatalogue` is []; unless a story
			 * fills it, the lists render empty and nothing else in the frame moves.
			 */
			case "profiles.list":
				return ok({ profiles: agentCatalogue });
			case "teams.list":
				return ok({ teams: teamCatalogue });
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	api.desktop = desktop;
	page.api = api;
}

/** Wait for the catalogue read to land, so the frame is not a picture of "loading". */
const catalogueSettled = async (rows: number, timeoutMs = 4_000) => {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (useCanonicalSessionsStore.getState().sessions.length >= rows) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stage a draft against an ENTITY, which is the whole of the state the two
 * states below are about.
 *
 * `staged` in the component is `draft?.target?.kind === kind &&
 * draft.target.name === name`, so an entity row is marked current by a draft
 * that CARRIES that target — it is not a selection the row can hold by itself.
 * `@-picker` and `slash-commands` mark the row Enter will apply the same way.
 *
 * Written straight to the store rather than through `onStageDraft`, which is a
 * no-op in this harness: the panel's own `onStageDraft` is the app's, and what
 * this state needs is the store field it reads.
 */
const stageEntityDraft = (target: { kind: "agent" | "team"; name: string }) => {
	const key = `draft-${target.kind}-${target.name}`;
	useCanonicalSessionsStore.setState({
		activeDraftKey: key,
		drafts: {
			[key]: {
				key,
				target,
				createRequestId: `story-${key}`,
				admissionRequestId: `story-${key}`,
			},
		},
	});
};

/**
 * The panel at the width the app gives it, plus a caption.
 *
 * The caption names the state and the roles in play rather than describing the
 * palette, because the palette is the theme's business: what a reader checks here
 * is WHICH ground the row and the caps are drawn on, and the caption is what makes
 * that checkable by eye across twelve themes.
 */
const Page: FC<{ note: string }> = ({ note }) => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
		<div className="w-[280px] shrink-0 border-hairline border-r">
			<ChatSidebar
				selectedConversation={selected}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
		<div className="w-[420px] shrink-0 space-y-3 p-4 text-meta text-ink-muted">
			<p className="text-ink">{note}</p>
			<p>
				The current row is drawn on{" "}
				<code className="font-mono">rowSelected</code> — a tint of the theme's
				own <code className="font-mono">accent</code> hue, though on the
				monochrome theme it is a neutral step instead — off the panel's{" "}
				<code className="font-mono">surface</code>, plus 2px of{" "}
				<code className="font-mono">accent</code> on the leading edge and{" "}
				<code className="font-mono">font-medium</code>. The pointer state the
				rows around it carry is <code className="font-mono">rowHover</code>: the
				two fills are one hue at two strengths, so the bar and the weight are
				what rank them. The caps carry no fill and no border on any of them.
			</p>
			<p>
				{selected
					? `selectedConversation = ${selected}`
					: "selectedConversation = (none)"}
				{` · activeDraftKey = ${draftKey ?? "(none)"}`}
			</p>
		</div>
	</div>
);

const meta = {
	title: "Chat/Sidebar current row",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** A conversation row is the current one, and the pointer is somewhere else. */
export const SelectedRow: Story = {
	render: () => {
		roster = DEFAULT_ROSTER;
		agentCatalogue = [];
		selected = REVENUE;
		draftKey = null;
		return <Page note="A conversation row is current" />;
	},
	play: async () => {
		await catalogueSettled(3);
		useCanonicalSessionsStore.setState({ activeDraftKey: null });
		/*
		 * The paint the capture photographs, not the store write: React renders on
		 * the frame after the store's, and a capture taken between them is a frame
		 * of the previous state.
		 */
		await sleep(300);
	},
};

/**
 * The New chat row is current, with its chord beside it.
 *
 * This is the state the chord itself creates, and the one where the caps used to
 * need an edge to stay visible.
 */
export const NewChatRowCurrent: Story = {
	render: () => {
		roster = DEFAULT_ROSTER;
		agentCatalogue = [];
		selected = undefined;
		draftKey = "draft-untargeted";
		return (
			<Page note="The New chat row is current, staging an untargeted draft" />
		);
	},
	play: async () => {
		await catalogueSettled(3);
		useCanonicalSessionsStore.setState({
			activeDraftKey: draftKey,
			drafts: {},
		});
		await sleep(300);
	},
};

/*
 * The THIRD row of the default roster. Named rather than inlined so the caption
 * and the component cannot disagree about which row is marked, and NOT the first
 * (`general`) deliberately: a current row with a row above it is the arrangement a
 * hover comparison needs.
 */
const RAIL_ACTIVE = "integrations";

/**
 * The settings rail's current section — the OTHER `surface` panel that paints the
 * same role with the same mark.
 *
 * WHY IT IS IN THIS FILE RATHER THAN A SET OF ITS OWN. It is one role decision on
 * one ground, taken from one palette value and marked with one class string in two
 * files, so a second set would be two instruments for one fact — the same reason
 * `scripts/chat-sidebar-selection.test.mjs` covers both rails. What it is NOT is a
 * duplicate surface: this rail is a menu, its rows are shorter, and its current row
 * carries a 16px accent-coloured glyph where the chat panel's carries a status dot,
 * so whether the mark reads against those is a question only a frame answers.
 *
 * `docs/evidence/chat-sidebar-current-row/README.md` records that this surface was
 * a stated GAP for two rounds — the `settings-appearance` story sets
 * `capturePending` and never clears it offline, which aborts a sweep before it
 * reaches the rail. Rendering the rail directly is what closes it: the component
 * takes `activeSection`, `sections` and a callback, reads no store, and needs no
 * desktop bridge, so nothing about it has to be stubbed or faked.
 *
 * The width matters and is why this story is registered at 1280 rather than the 780
 * its siblings use: `SettingsSidebar` switches between its labelled and its 48px
 * icon-only layouts at `(min-width: 1040px)`, and the labelled one is the surface
 * the current row's ground has to carry text on.
 */
export const SettingsRail: Story = {
	render: () => (
		<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
			<div className="w-[280px] shrink-0 border-hairline border-r">
				<SettingsSidebar
					activeSection={RAIL_ACTIVE}
					onSelectSection={() => undefined}
					sections={DEFAULT_SETTINGS_SECTIONS}
				/>
			</div>
			<div className="w-[420px] shrink-0 space-y-3 p-4 text-meta text-ink-muted">
				<p className="text-ink">The settings rail's current section</p>
				<p>
					A menu row on the SAME <code className="font-mono">surface</code>{" "}
					ground as the chat panel, carrying the same{" "}
					<code className="font-mono">rowSelected</code> ground, the same 2px{" "}
					<code className="font-mono">accent</code> bar and the same{" "}
					<code className="font-mono">font-medium</code> weight.
				</p>
				<p>{`activeSection = ${RAIL_ACTIVE}`}</p>
			</div>
		</div>
	),
	play: async () => {
		await sleep(300);
	},
};

/**
 * A conversation BOUND to an agent is the current row, so the frame draws the
 * `· lopdev` binding INSIDE the mark.
 *
 * WHY THIS STATE EXISTS (design round 1, D5 and QA's N6). Every fixture row in
 * this set carried `binding: { agent: null, team: null }`, so the binding half of
 * the mark — `ink-muted` on `highlight`, one of the two inks the floors on this
 * ground are measured for — was an assertion in `pnpm check-themes` and in no
 * frame at all, while it is plainly visible in the operator's own screenshot.
 * A flat row is the way to reach it: the binding renders in the row's trailing
 * slot, and the row is in the Active chats partition because it is active —
 * which is also what keeps its agent's entity row out of this frame
 * (`agentCatalogue` is empty here, so no entity list renders at all).
 */
export const BoundRowCurrent: Story = {
	render: () => {
		roster = BOUND_ROSTER;
		agentCatalogue = [];
		selected = BOUND;
		draftKey = null;
		return (
			<Page note="A row bound to an agent is current, drawing · lopdev inside the mark" />
		);
	},
	play: async () => {
		await catalogueSettled(3);
		useCanonicalSessionsStore.setState({ activeDraftKey: null });
		await sleep(300);
	},
};

/**
 * A NESTED row is the current one: a conversation bound to an agent, drawn under
 * that agent's own entity row rather than in the flat partition.
 *
 * WHY IT IS A SEPARATE FRAME FROM `BoundRowCurrent`. A nested row is the one
 * arrangement where the mark sits at the row's own inset (`pl-7`) inside a
 * disclosure, next to the entity row that stages a draft against the same agent —
 * and it is the case both review streams recorded as unreachable (design D5,
 * QA N3). It is reachable in a story: the child row is INACTIVE, so the flat
 * Active chats partition does not draw it, and the agent's own disclosure is
 * clicked open because it starts collapsed. The click is the only way to open it
 * without a query, and a query would be a different surface (a filtered list).
 */
export const NestedRowCurrent: Story = {
	render: () => {
		roster = NESTED_ROSTER;
		agentCatalogue = [LOPDEV_PROFILE];
		selected = NESTED;
		draftKey = null;
		return <Page note="A nested row under its agent is current" />;
	},
	play: async () => {
		await catalogueSettled(3);
		useCanonicalSessionsStore.setState({ activeDraftKey: null });
		/*
		 * The disclosure starts COLLAPSED (`expanded` is empty state here), so the
		 * nested row this state is about is not on screen until it is opened. A
		 * real click rather than a store write, because the open state is the
		 * component's own.
		 *
		 * TWO THINGS THIS LOOP HAS TO GET RIGHT, both measured rather than assumed:
		 *
		 *   1. WAIT for the row to exist. The disclosure renders from the profile
		 *      catalogue's answer, and `catalogueSettled` above is about the SESSION
		 *      list. A click dispatched before that answer lands is a `null` click —
		 *      the first capture of this state produced six frames with the agent
		 *      collapsed and six with it open, split by palette.
		 *   2. CLICK ONLY IF IT IS SHUT. `expanded` persists in
		 *      `localStorage['chat-sidebar-disclosures']`, so a sweep of twelve
		 *      themes leaves it open for the next one, and an unconditional click
		 *      closes what the previous frame opened — which is how the same run
		 *      alternated open/collapsed frame by frame.
		 */
		for (let attempt = 0; attempt < 50; attempt += 1) {
			const disclosure =
				document.querySelector<HTMLButtonElement>("[data-disclosure]");
			if (disclosure) {
				if (disclosure.getAttribute("aria-expanded") === "false") {
					disclosure.click();
				}
				break;
			}
			await sleep(100);
		}
		await sleep(300);
	},
};

/**
 * A TEAM's entity row is the current one — the row a staged draft has TARGETED.
 * `AgentRowCurrent` below is the same state one list down.
 *
 * WHY THESE TWO STATES NEEDED A FRAME. Every other current-row state in this file
 * marks ONE element, and the two entity rows are the ones a draft marks across
 * TWO: the wrapper paints the ground over the row's own box (the gaps and the
 * rounded corners the 24px controls do not cover) and the name button paints it
 * again, because `rowStyle`'s own `hover:` step is what would otherwise paint over
 * the wrapper's ground under the pointer. That pair is deliberate — the guard in
 * `scripts/chat-sidebar-selection.test.mjs` asserts both halves of it — and it is
 * also the only arrangement in the panel where the role's leading-edge bar has two
 * DIFFERENT left edges to land on: the wrapper's and the name button's, which the
 * disclosure control's 24px push apart. What the pair of frames shows is therefore
 * a fact about pixels that no class assertion can state: whether the row carries
 * ONE mark or two.
 *
 * The teams are the operator's own four rows, because the report is a screenshot
 * of this list and a fixture nobody has rendered is a row that cannot be compared
 * with it. The counts are derived, not written: an entity row draws the number of
 * chats bound to it, and `ENTITY_ROSTER` binds one to each of three teams and one
 * to the agent.
 */
export const TeamRowCurrent: Story = {
	render: () => {
		roster = ENTITY_ROSTER;
		agentCatalogue = [LOPDEV_PROFILE];
		teamCatalogue = TEAM_ROSTER;
		selected = undefined;
		draftKey = "draft-team-lopdev";
		return (
			<Page note="A team's entity row is current — the draft is staged against it" />
		);
	},
	play: async () => {
		await catalogueSettled(ENTITY_ROSTER.length);
		stageEntityDraft({ kind: "team", name: LOPDEV });
		await sleep(300);
	},
};

/**
 * An AGENT's entity row is the current one.
 *
 * The operator's own guess — "presumably the same issue would be there when
 * selecting an agent" — is not a fact about the agent list until it is a frame:
 * the two lists share `entity()`, so they share whatever it draws, and a fix that
 * only ever looked at the team list would be a fix nobody checked. Same roster,
 * same catalogues, same two elements; only the draft's target kind moves.
 */
export const AgentRowCurrent: Story = {
	render: () => {
		roster = ENTITY_ROSTER;
		agentCatalogue = [LOPDEV_PROFILE];
		teamCatalogue = TEAM_ROSTER;
		selected = undefined;
		draftKey = "draft-agent-lopdev";
		return (
			<Page note="An agent's entity row is current — the draft is staged against it" />
		);
	},
	play: async () => {
		await catalogueSettled(ENTITY_ROSTER.length);
		stageEntityDraft({ kind: "agent", name: LOPDEV });
		await sleep(300);
	},
};

/**
 * The current row UNDER KEYBOARD FOCUS — the one arrangement where two outline
 * rules meet on one box, and a state no frame in this set has ever held.
 *
 * The row's own class list carries `focus-visible:outline focus-visible:outline-2
 * focus-visible:outline-accent focus-visible:outline-offset-2`, so a focused
 * current row is the `highlight` ground plus an `accent` ring at a 2px offset
 * drawn AROUND it. Every other frame in the set shows the ground alone, and the
 * question this one exists for is whether the two marks read as one state or as
 * a mark fighting its own outline (design round 2, N3; round 3, N4).
 *
 * Focus is moved to the row itself rather than to a store field, because the ring
 * is `:focus-visible`'s and only the browser's own focus state produces it. A
 * scripted `.focus()` matches `:focus-visible` in a fresh page whose last
 * interaction was not a pointer, which is the state a capture starts in — the
 * rig's pointer states are separate entries for exactly this reason.
 */
export const FocusedRowCurrent: Story = {
	render: () => {
		roster = DEFAULT_ROSTER;
		agentCatalogue = [];
		selected = REVENUE;
		draftKey = null;
		return (
			<Page note="A conversation row is current, with the keyboard on it" />
		);
	},
	play: async () => {
		await catalogueSettled(3);
		useCanonicalSessionsStore.setState({ activeDraftKey: null });
		await sleep(300);
		/*
		 * NO focus call here on purpose. The ring this state is about is
		 * `:focus-visible`'s, which is BROWSER state: a programmatic `element.focus()`
		 * does not match it in Blink unless the last interaction was the keyboard, so
		 * a story that focused a control itself would photograph the resting state and
		 * file it under a ring. The rig presses the real Tab key instead (`{ tabTo }`
		 * on this set's own row in `capture-evidence.mjs`) and throws rather than
		 * shooting the unfocused state if it never lands. The first cut of this story
		 * called `.focus()` from here and the frame came back with the ground and no
		 * ring — measured, not assumed.
		 */
		await sleep(200);
	},
};

/**
 * A COLOUR-ONLY frame, and it says so in the picture.
 *
 * The pair this shows is `rowSelected` — the ground of the row the reader is ON —
 * beside `accentWash`, which is now the TRANSIENT idiom only: pointer hover, and a
 * keyboard-focused option in a list that is open. The two roles have to be told
 * apart by a reader, and the row-state pass changed what the second one is for:
 * four nav surfaces used the wash for a PERSISTENT selection until this pass moved
 * them onto `rowSelected`, and on 6 of the 41 dark themes the wash was a weaker
 * mark than the hover beside it (`obsidian` 2.02 against 3.42). The ΔE00 between
 * the two is still the whole of the claim this frame settles, and the field floor
 * it is held to is the contract's own.
 *
 * WHY A SWATCH AND NOT A SCREEN. The surfaces that paint `accentWash` are in a
 * different panel from this one — the `@` picker and the slash list, the browser
 * tab strip, the mention chip, the spreadsheet's selected row — and this rig's
 * seven states photograph the chat sidebar and the settings rail, so no state in
 * it can hold a current row and a wash element in one view. Rather than imply a screen was found, the frame draws
 * the two grounds at the size they are painted and labels itself: what it settles
 * is the ΔE00 between the two colours, which is the whole of the claim, and the
 * README says the same thing where a reader meets the frames.
 */
export const WashSwatches: Story = {
	render: () => (
		<div className={cn("flex h-screen flex-col gap-6 bg-canvas p-8 text-ink")}>
			<p className="text-body">
				COLOUR-ONLY FRAME — this is not a screen. It shows the current row's
				ground beside the app's transient wash, at the size a row is painted,
				because no state in this set can hold both in one view.
			</p>
			<div className="flex gap-6">
				<div className="flex flex-col gap-2">
					<div className="h-24 w-[320px] rounded-md bg-row-selected" />
					<p className="font-mono text-meta text-ink-muted">
						bg-row-selected — the current row's ground
					</p>
				</div>
				<div className="flex flex-col gap-2">
					<div className="h-24 w-[320px] rounded-md bg-accent-wash" />
					<p className="font-mono text-meta text-ink-muted">
						bg-accent-wash — the transient hover/option tint
					</p>
				</div>
			</div>
			<p className="text-meta text-ink-muted">
				A reader judges the pair by whether the two blocks read as two grounds;
				the contract asserts the same distance numerically.
			</p>
		</div>
	),
};
