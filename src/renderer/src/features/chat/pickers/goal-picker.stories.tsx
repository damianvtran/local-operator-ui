/**
 * `/goal` — the desktop goal picker, in the four states its copy and its gates live in.
 *
 * WHY THIS FILE EXISTS (design review round 2, the sweep workstream's D1). The
 * judged-goals change rewrote four things inside this dialog — the settled sentence,
 * the `Judge` row's gate, the `stalled — send a message to continue` line and the
 * struck settled readout — and photographed none of them. The surface was raised as
 * MAJOR rather than as a nit because the round could not sign off what it could not
 * see, and because the amended settled sentence is LONGER than the version round 1
 * read: it gained *", or find it in the canvas's Goals view."*, in a panel whose
 * wrapping nobody had measured.
 *
 * THE PREVIEW MOCK WAS NOT THE BLOCKER THE ROUND ASSUMED. That round recorded that
 * the preview's `window.api` declares no `desktop`, which is the seam the row's press
 * goes through — true, and unchanged — but rendering this dialog needs no press, and
 * the one transport it can touch is stubbed the way the sibling `model-picker.stories`
 * already stubs it (`window.api.desktop.request`). What the frames are evidence ABOUT
 * is therefore the renderer: the real `GoalPicker`, its real `PickerHost`, its real
 * `PickerField`s, its real action buttons and its real description strings. They are
 * NOT evidence that the commands those buttons run reach a backend — nothing here
 * presses them, and the driven render assertions in `scripts/composer-tabs.test.mjs`
 * remain the half that pins the wire.
 *
 * THE FOUR STATES, and what each one is for:
 *
 *   - `Settled` — `goal_status` `done`: the amended sentence, the struck value, the
 *     `Judge` row reading `done`, and NO `Mark done` (a settled goal cannot be settled
 *     twice). Top of the palette list because it is the state D1 was raised about.
 *   - `Stalled` — an active goal whose judge ran out of continuations: the one sentence
 *     UX round 2's U4 is about, rendered where a user meets it, beside `Mark done`.
 *   - `NoGoal` — a capable backend, no goal: the `Judge` row is ABSENT (design review
 *     round 1's D5), which is the half of the gate a still of the stalled state cannot
 *     show, and the description is the invitation rather than the standing-goal line.
 *   - `LegacyBackend` — a frontend carrying none of the four lifecycle fields: no judge
 *     row and no `Mark done`, so `/goal done` can never reach a build that would store
 *     the literal word as the user's goal (the capability rule the chip follows too).
 *
 * The 300-character goal is the app's own long fixture in this set, so the settled band
 * measures the wrap of the sentence the round flagged rather than of a short string.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import "../../../styles/index.css";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type { NativeDesktopAction } from "../../../../../shared/desktop-control-contract";
import type { SlashCommandMeta } from "../components/slash-commands";
import { GoalPicker, type PickerContext } from "./destination-pickers";

const noop = () => {};

/** The fixture's long goal, the one the composer's own frames use at 1956px of scroll. */
const LONG_GOAL =
	"Reconcile the March invoices against the ledger, chase the three suppliers whose statements disagree, and close the month once every line is accounted for with a note naming who resolved it and when.";

const SHORT_GOAL = "Reconcile the March invoices";

const GOAL_SPEC: SlashCommandMeta = {
	name: "goal",
	description: "Set the session's standing goal",
	aliases: [],
	arguments: "optional",
	echo: false,
	consumes_prompt: false,
	destination: "session.goal",
	execution: "owner",
};

const GOAL_ACTION: NativeDesktopAction = {
	kind: "native_action",
	destination: "session.goal",
	session_id: "sess",
	args: "",
	fields: [],
	data: {},
};

/* --------------------------------------------------------------- bridge */

type BridgeRequest = {
	op: string;
	live?: boolean;
	command?: string;
	args?: string;
};

/**
 * The desktop transport, stubbed — the sibling picker story's own pattern.
 *
 * `desktop-api.desktopRequest` prefers `window.api.desktop.request` and falls back to
 * `fetch("/__desktop")`, which Storybook's dev server does not serve; without a bridge
 * any state that touches it would photograph a transport error instead of the dialog.
 * Nothing in these four states presses a control, so the bridge only has to answer the
 * ops a mount can issue: `sessions.command` and `commands.entities` are given ordinary
 * envelopes, and anything else is refused BY NAME so a frame that ever needs more says
 * so rather than silently photographing a 30s deadline.
 */
const installBridge = () => {
	if (typeof window === "undefined") return;
	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (r: BridgeRequest) => Promise<DesktopResponse | undefined>;
			};
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		request: async (request: BridgeRequest): Promise<DesktopResponse> => {
			if (request.op === "sessions.command") {
				return {
					status: 200,
					body: {
						result: {
							kind: "notice",
							text: "Goal set",
							style: "info",
							data: {},
						},
					},
				};
			}
			if (request.op === "commands.entities") {
				return {
					status: 200,
					body: { result: { entities: [], current: null } },
				};
			}
			return {
				status: 400,
				body: { detail: `goal-picker story: unexpected ${request.op}` },
			};
		},
	};
};

/* --------------------------------------------------------------- fixtures */

type Frontend = {
	goal: string;
	goal_status?: string;
	goal_judge?: {
		state: string;
		run?: number;
		verdict?: string;
		reason?: string;
	} | null;
	loop?: unknown;
};

/**
 * One frame: installs the transport, then renders the PRODUCTION `GoalPicker`.
 *
 * `PickerContext` carries more fields than this dialog reads (`sessionId`, `canonical`,
 * `onClose`, and the two command hooks' `commands`); the dispatcher's own are filled
 * with no-ops rather than pretended into meaningful values.
 */
const Frame: FC<{ frontend: Frontend }> = ({ frontend }) => {
	installBridge();
	const ctx: PickerContext = {
		action: GOAL_ACTION,
		spec: GOAL_SPEC,
		sessionId: "sess",
		canonical: {
			frontend,
		} as unknown as CanonicalSessionHandle,
		commands: [GOAL_SPEC],
		onClose: noop,
		note: noop,
		dispatch: noop,
		rebind: noop,
	};
	return <GoalPicker {...ctx} />;
};

const meta: Meta = {
	title: "Chat/GoalPicker",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * The settled goal: the amended sentence, the struck value, and `Judge: done`.
 *
 * Band 1 is the state the sweep's D1 was raised about — the sentence that gained the
 * `Goals view` clause, wrapping in the panel's own measure — and it is deliberately the
 * LONG goal, because the wrap is the claim. The actions are `Clear goal` alone: `Mark
 * done` is absent while the goal is settled, which is the gate a user would otherwise
 * meet as a second, pointless press.
 */
export const GoalPickerSettled: Story = {
	render: () => (
		<Frame
			frontend={{
				goal: LONG_GOAL,
				goal_status: "done",
				goal_judge: { state: "waiting" },
			}}
		/>
	),
};

/**
 * A stalled goal: the sentence the cap produces, in the row where a user reads it.
 *
 * `stalled — send a message to continue` is UX round 2's U4 — the word `continuations`
 * is the mechanism's and the record keeps it byte-identical to the backend's
 * `STALLED_CAP_NOTICE` — so the frame is the surface that argument is about. `Mark
 * done` is present because the goal is still active, which is the pair the settled band
 * is read against.
 */
export const GoalPickerStalled: Story = {
	render: () => (
		<Frame
			frontend={{
				goal: SHORT_GOAL,
				goal_status: "active",
				goal_judge: { state: "stalled", run: 12 },
			}}
		/>
	),
};

/**
 * A capable backend with NO goal: the `Judge` row is absent, and the invite is the copy.
 *
 * This is design review round 1's D5 as a frame. `capable` alone is true on any new
 * backend *including one whose goal is the empty string*, so a `Judge` row gated on the
 * capability printed `Judge: idle` about a goal that does not exist; the gate is the
 * capability AND a goal, which is the rule the pane's own empty state now shares (round
 * 2's D2). Beside the stalled band this is what makes the absence legible as an absence
 * rather than as a missing element.
 */
export const GoalPickerNoGoal: Story = {
	render: () => (
		<Frame frontend={{ goal: "", goal_status: "active", goal_judge: null }} />
	),
};

/**
 * A backend that predates the lifecycle: no `Judge` row, and no `Mark done`.
 *
 * The capability gate's picker half (design review round 1's F4). The frontend carries
 * only `goal`/`loop` — the row's whole input until the judge existed — so this band IS
 * the pre-change dialog rather than an imitation of it, and the `Done` control's absence
 * is the property that keeps `/goal done` from ever reaching a backend that would store
 * the literal word as the user's standing goal.
 */
export const GoalPickerLegacyBackend: Story = {
	render: () => <Frame frontend={{ goal: SHORT_GOAL, loop: null }} />,
};
