import "../../../styles/index.css";
// The live composer reads `window.electron` from a mount effect (the platform it
// renders the send chord for); the shim has to exist before it renders, which
// is why it is a side-effect import and not a wrapper.
import "../../chat/components/story-electron-shim";
import { AgentsPage } from "@features/agents/components/agents-page";
import type { ReusableTeam } from "@shared/api/local-operator/profile-hooks";
import type { Meta, StoryObj } from "@storybook/react";
import {
	type FC,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import {
	CAPABILITIES,
	HoldShutterUntil,
	RouteTo,
	type WorldProfile,
	installBridge,
	makeProfile,
} from "./agent-class.stories";

/**
 * The Agents and Teams page as an operator with a real catalogue sees it:
 * seventeen agents, eleven teams, a long team brief, and a LIVE docked composer.
 *
 * WHY THIS FILE EXISTS. `agent-class.stories.tsx` photographs one control on a
 * three-agent, zero-team world with the composer switched off, which is the
 * wrong world to judge the page's layout in: the operator's report is about the
 * Teams tab at ~1024x725 with a long Collaboration brief and the composer
 * docked under the detail, and none of those exist there. This file is the
 * measuring rig for that report — the same real `AgentsPage`, the same stubbed
 * `window.api.desktop.request` bridge (imported from the class stories, not
 * forked), a catalogue big enough to overflow every scroller, and the
 * capabilities that turn the composer on.
 *
 * REAL HERE: `AgentsPage`, the roster, `TeamDetail`/`AgentDetail`, the docked
 * `ConfigComposer` and the desktop transport. STAND-IN: the backend. The
 * catalogue is read-only — nothing in these frames writes — so the world is
 * plain data rather than the class stories' mutable one.
 *
 * THE PRESS FOR EDIT BELONGS TO THE STORY, unlike the class stories' switch.
 * The class stories leave their press to `capture-evidence.mjs` because the
 * pressed control stays on screen and a script click would leave a focus ring
 * on it. Team `Edit` unmounts the moment it is pressed (the form's footer
 * replaces it), so there is no control left to carry a ring, and the story can
 * press it itself and hold the shutter until the form is up. That also keeps
 * the frame reachable from any rig, not only one that knows this selector.
 */

/* ------------------------------------------------------------- the world -- */

const agent = (
	name: string,
	description: string,
	over: Partial<WorldProfile> = {},
) => makeProfile({ name, description, ...over });

/**
 * Seventeen agents, mixed on every axis the roster draws: the three source
 * words (Built-in, Installed, Custom), the proactive badge, a role and a
 * specialist, and descriptions from one clause to two sentences so row heights
 * are not uniform by accident of the fixture.
 */
const AGENTS: WorldProfile[] = [
	agent(
		"aida",
		"Your chief of staff: orchestrates agents and teams on your behalf, keeps an eye on everything in flight, and reports back.",
		{ source: "builtin", agent_id: null, action_class: "proactive" },
	),
	agent("manager", "Plans the work, delegates it, and merges the results.", {
		source: "builtin",
		agent_id: null,
		delegate: true,
	}),
	agent(
		"reviewer",
		"Reviews a diff for correctness, contract drift and missing evidence.",
		{ source: "builtin", agent_id: null },
	),
	agent("coder", "Implements one bounded slice and reports what changed.", {
		source: "builtin",
		agent_id: null,
	}),
	agent("architect", "Weighs structural trade-offs before anyone codes.", {
		source: "builtin",
		agent_id: null,
		kind: "specialist",
	}),
	agent("designer", "Judges rendered UI against the design contract.", {
		source: "installed",
	}),
	agent("qa-tester", "Exercises a change end to end on a clean checkout.", {
		source: "installed",
	}),
	agent(
		"scout",
		"Reads a codebase or a topic and reports what is there, not what to do.",
		{ source: "installed" },
	),
	agent(
		"trend-scout",
		"Watches a handful of sources and writes a short brief on what moved.",
		{ source: "custom", agent_id: null, action_class: "proactive" },
	),
	agent(
		"post-analyst",
		"Reads how recent posts performed and says which angle earned the attention.",
		{ source: "custom", agent_id: null },
	),
	agent(
		"content-writer",
		"Drafts a post from a brief, in the voice the brand guide describes, and flags every claim it could not source.",
		{ source: "custom", agent_id: null },
	),
	agent(
		"content-designer",
		"Turns a draft into a layout and the image requests that go with it.",
		{ source: "custom", agent_id: null },
	),
	agent("copy-reviewer", "Edits copy for clarity, tone and house style.", {
		source: "custom",
		agent_id: null,
	}),
	agent(
		"data-analyst",
		"Profiles a dataset, finds what is wrong with it, and writes the query that shows it.",
		{ source: "installed" },
	),
	agent(
		"researcher",
		"Collects primary sources on a person or company and cites each one.",
		{ source: "installed" },
	),
	agent(
		"support-triage",
		"Sorts an inbound ticket and drafts the first reply.",
		{
			source: "installed",
			action_class: "proactive",
		},
	),
	agent("release-notes", "", { source: "custom", agent_id: null }),
];

const member = (role: string) => ({ role, count: 1, kind: "agent" as const });

const team = (
	name: string,
	description: string,
	manager: string,
	members: string[],
	over: Partial<ReusableTeam> = {},
): ReusableTeam => ({
	id: `team-${name}`,
	name,
	description,
	manager,
	members: members.map(member),
	instructions: "",
	...over,
});

/**
 * The Content team's brief, as an operator writes one: several paragraphs, a
 * numbered hand-off, and a closing rule — long enough that the read view's
 * `max-h-64` bound is exceeded at every width these frames use, so the nested
 * scroller is on screen rather than assumed.
 */
const CONTENT_INSTRUCTIONS = `Content is a small editorial line. The manager owns the calendar and the final call; the five members each own one stage and nothing outside it. Work moves left to right through the stages below, and a stage never reaches back to redo the one before it: if its input is not good enough, it says so and sends it back with a reason.

1. trend-scout runs first and runs on its own schedule. It reads the sources listed in the brief, ranks what moved by how far it moved and how close it is to what the audience already cares about, and hands over at most five topics. It does not propose angles and it does not write copy.
2. post-analyst reads how the last thirty days of posts performed and answers one question per topic: which angle earned attention before, and which did not. It reports numbers with their denominators, and says "not enough data" rather than rounding a guess up.
3. content-writer takes one topic and the analyst's note and writes the draft. Every factual claim carries a source in a trailing list; a claim the writer could not source is marked, not softened. The draft stays inside the length the brief gives.
4. content-designer receives the draft and returns a layout and the list of image requests. It does not change the words; if a line cannot be laid out, it names the line and says why.
5. copy-reviewer reads last. It edits for clarity, tone and house style, and returns a diff rather than a rewrite so the writer can see what moved.

The manager decides what ships. Before it does, it checks three things: that every topic traces back to the scout's list, that the analyst's note is cited in the draft's framing, and that the reviewer's diff was applied. A draft that fails any of the three goes back to the stage that owns the miss, with the missing item named.

Handling disagreement: when the analyst's note and the writer's instinct disagree, the draft follows the note and the writer records the disagreement in a line at the end for the manager to read. When two members disagree on a fact, neither edits the other's section; both attach their source and the manager picks.

Tone of every hand-off: short, specific, no praise and no apology. Say what was done, what was not, and what the next stage needs. If a stage finishes with nothing to hand over, it says that in one sentence instead of producing filler.

Never publish. This team prepares drafts and layouts and stops. Publishing, scheduling and anything that touches an account the team does not own stays with the operator.`;

const TEAMS: ReusableTeam[] = [
	team(
		"content",
		"Turns what is moving in the market into reviewed posts, from the first signal to the finished layout.",
		"manager",
		[
			"trend-scout",
			"post-analyst",
			"content-writer",
			"content-designer",
			"copy-reviewer",
		],
		{ label: "Content", instructions: CONTENT_INSTRUCTIONS },
	),
	team(
		"data-investigations",
		"Looks into a dataset or an entity until the question has a sourced answer.",
		"manager",
		["researcher", "data-analyst", "scout", "reviewer"],
		{ label: "Data Investigations" },
	),
	team(
		"data-quality",
		"Finds and fixes what is wrong with a dataset before anyone builds on it.",
		"manager",
		["data-analyst", "qa-tester", "reviewer"],
		{ label: "Data Quality" },
	),
	team(
		"helpdesk",
		"Answers inbound questions and escalates the ones that need a person.",
		"support-triage",
		["support-triage", "scout", "reviewer"],
	),
	team(
		"hyperplane-development",
		"Builds and ships changes to the Hyperplane codebase.",
		"manager",
		["architect", "coder", "reviewer", "qa-tester", "designer"],
		{ label: "Hyperplane Development" },
	),
	team(
		"local-operator-development",
		"Builds and ships changes to the Local Operator harness and its desktop app.",
		"manager",
		[
			"architect",
			"coder",
			"reviewer",
			"qa-tester",
			"designer",
			"scout",
			"release-notes",
		],
		{ label: "Local Operator Development" },
	),
	team(
		"minerva-development",
		"Builds and ships changes to the Minerva services and dashboards.",
		"manager",
		[
			"architect",
			"coder",
			"reviewer",
			"qa-tester",
			"designer",
			"scout",
			"data-analyst",
			"release-notes",
		],
		{ label: "Minerva Development" },
	),
	team(
		"pergamon-research",
		"Researches people and companies for the Pergamon watchlists and cites every source.",
		"manager",
		["researcher", "scout", "data-analyst", "reviewer"],
		{ label: "Pergamon Research" },
	),
	team("radient-net", "", "manager", ["coder", "reviewer", "qa-tester"], {
		label: "Radient Net",
	}),
	team(
		"radient-development",
		"Builds and ships changes to the Radient apps.",
		"manager",
		["architect", "coder", "reviewer", "qa-tester", "designer"],
		{ label: "Radient Development" },
	),
	team(
		"support-desk",
		"Triages the support queue and drafts replies in the house voice.",
		"support-triage",
		["support-triage", "scout", "copy-reviewer", "reviewer"],
		{ label: "Support Desk" },
	),
];

/**
 * The capability answer with the composer's two gates on.
 *
 * `agents_config` and `session_interrupt` are what `configRunEnabled` reads
 * beyond the two catalogue keys; the class stories leave them off (their subject
 * is the switch), so their composer prints the "needs a newer backend" sentence.
 * The operator's screen has the live composer, and the box under review is that
 * one.
 */
const LIVE_CAPABILITIES = {
	...CAPABILITIES,
	features: {
		...CAPABILITIES.features,
		agents_config: 1,
		session_interrupt: 1,
	},
};

/* --------------------------------------------------------------- the rig -- */

/**
 * The page's own shell and world.
 *
 * A `h-screen` flex COLUMN, which is what the app's own outlet is
 * (`<main className="flex grow flex-col overflow-hidden">` in `app.tsx`): the
 * page's root has `h-full` and no width, so it is the column's STRETCH that gives
 * it the window's width. The class stories' `Scene` is a row, which shrink-wraps
 * the root to its content - harmless for a populated pane, but the empty hero's
 * content is narrow, so under a row it collapsed to 48px (measured) and the frame
 * was a picture of the rig rather than the page. Over the catalogue above. Built once per mount for the same reason theirs is: a
 * capture sweep re-renders the story once per theme.
 */
const Scene: FC<{ at: string; children?: ReactNode }> = ({ at, children }) => {
	const rows = useRef<WorldProfile[] | null>(null);
	rows.current ??= AGENTS.map((row) => ({ ...row }));
	// A LAYOUT effect so the bridge exists before any query effect reads it.
	useLayoutEffect(() => {
		installBridge(rows.current as WorldProfile[], {
			teams: TEAMS,
			capabilities: LIVE_CAPABILITIES,
		});
	}, []);
	return (
		<div className="flex h-screen flex-col overflow-hidden bg-canvas">
			<RouteTo path={at}>
				<AgentsPage />
			</RouteTo>
			{children}
		</div>
	);
};

/**
 * Press the team's `Edit` button once it exists, then hold the shutter until the
 * form (its pinned footer) is on screen.
 *
 * Found by its words because the button has no test id and this file does not
 * change product code; the observer re-runs the lookup on every mutation since
 * the detail arrives after two reads.
 */
const PressEdit: FC = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let pressed = false;
		const settle = () => {
			if (!pressed) {
				const edit = Array.from(
					document.querySelectorAll<HTMLButtonElement>(
						"[data-agents-pane] header button",
					),
				).find((button) => button.textContent?.trim() === "Edit");
				if (edit) {
					pressed = true;
					edit.click();
				}
			}
			if (document.querySelector('[data-testid="edit-footer"]'))
				document.documentElement.removeAttribute("data-capture-pending");
		};
		const observer = new MutationObserver(settle);
		observer.observe(document.body, { childList: true, subtree: true });
		settle();
		return () => {
			observer.disconnect();
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
	return null;
};

const meta: Meta = {
	title: "Agents/Teams page",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The shutter waits for the thing each frame is ABOUT, so a frame is never the
 * skeleton or a half-read roster.
 */
const paneSays = (text: string) => () =>
	Boolean(
		document.querySelector("[data-agents-pane]")?.textContent?.includes(text),
	);
const rowExists = (name: string) => () =>
	Boolean(document.querySelector(`[data-testid="roster-row-${name}"]`));

/** TEAM SELECTED: Content, five members, the long brief. The operator's screen. */
export const TeamSelected: Story = {
	render: () => (
		<Scene at="/agents?kind=team&name=content">
			<HoldShutterUntil done={paneSays("Collaboration instructions")} />
		</Scene>
	),
};

/** TEAMS TAB, nothing selected: the hero that leads with the composer. */
export const TeamsEmptyHero: Story = {
	render: () => (
		<Scene at="/agents?kind=team">
			<HoldShutterUntil done={rowExists("content")} />
		</Scene>
	),
};

/** AGENT SELECTED: a custom, proactive agent. */
export const AgentSelected: Story = {
	render: () => (
		<Scene at="/agents?kind=agent&name=trend-scout">
			<HoldShutterUntil done={paneSays("Watches a handful of sources")} />
		</Scene>
	),
};

/** AGENTS TAB, nothing selected. */
export const AgentsEmptyHero: Story = {
	render: () => (
		<Scene at="/agents?kind=agent">
			<HoldShutterUntil done={rowExists("aida")} />
		</Scene>
	),
};

/** TEAM EDITING: Content, after `Edit` — the form and its pinned footer. */
export const TeamEditing: Story = {
	render: () => (
		<Scene at="/agents?kind=team&name=content">
			<PressEdit />
		</Scene>
	),
};

/** TEAM CREATE: the blank form behind "Add team manually". */
export const TeamCreate: Story = {
	render: () => (
		<Scene at="/agents?create=team">
			<HoldShutterUntil
				done={() =>
					Boolean(document.querySelector('[data-testid="team-name-input"]'))
				}
			/>
		</Scene>
	),
};
