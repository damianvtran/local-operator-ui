/**
 * The queued-ask surfaces: the minimized bar, and the panel it expands into.
 *
 * These render the PRODUCTION components from real `PendingAsk` fixtures — the
 * shape the backend publishes on the frontend state — so what is judged is what
 * ships. A live queue is worse than slow to photograph: the states that matter
 * most here are the ones a session produces least often. A queue of three with
 * one timed out, a multi-select question, a secret question, a truncated list
 * and an answered-late row are all ordinary in the backend's fold and rare on
 * anyone's screen at the moment a camera is pointed at it.
 *
 * What to look for, since these frames are the design review (design
 * `docs/design/ask-nonblocking.md` §5.0, §5.2):
 *
 * - **The bar reads as a chip, not a banner.** One line, the composer status
 *   chip's own triple (`surface` fill, `border-control` edge, `ink` copy), one
 *   persistent accent on the mark. Nothing animates: a pulse would be the
 *   focus-steal this whole design exists to avoid, expressed in colour.
 * - **The accent is spent exactly once per surface.** On the bar it is the
 *   mark; inside the panel it is the status glyph and the primary control, and
 *   nowhere else — § 2's budget is about three accent spends a screen.
 * - **QUEUED and TIMED-OUT do not look alike.** The copy contract's sentences
 *   are the difference, and the timeout keeps its answer controls live: a
 *   timed-out ask is still answerable (that is the `late` path), so it must not
 *   be drawn as a closed state.
 * - **Disabled changes colour, never opacity.** An incomplete draft's Submit is
 *   a colour step on its own ground, not a wash toward it.
 * - **The secret question is a masked field**, and it is the only place a
 *   credential is ever typed. Its value never reaches a draft that drives a
 *   render.
 * - **Zero asks draws nothing at all**, and a backend that does not publish
 *   `asks` draws nothing either — those are different states with the same
 *   frame, which is why both are stories.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type {
	CanonicalFrontendState,
	PendingAsk,
} from "../../../../../../shared/desktop-session-contract";
import { cn } from "@shared/lib/utils";
import "../../../../styles/index.css";
import { EMPTY_DRAFTS, askQueueView } from "../../ask-queue";
import { ComposerStatusRow } from "../composer-status-row";
import { deriveRunDetails } from "../run-details";
import { AskPanel } from "./ask-panel";
import { AskSurfaces } from "./ask-surfaces";

const TS = 1_760_000_000_000;
const MINUTE = 60_000;

/** The clock every frame is pinned to, so the countdown reads the same twice. */
const NOW = TS + 12 * MINUTE;

const ask = (over: Partial<PendingAsk> & { ask_id: string }): PendingAsk => ({
	created_at: TS,
	expires_at: TS + 60 * MINUTE,
	timeout_s: 3600,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [],
	...over,
});

const ONE: PendingAsk = ask({
	ask_id: "a-7f3c",
	questions: [
		{
			id: "target",
			question: "Which environment should I deploy this to?",
			options: [
				{
					label: "staging",
					description: "The shared pre-prod cluster",
					recommended: true,
				},
				{ label: "production", description: "Live traffic" },
			],
			multi: false,
		},
	],
});

const THREE: PendingAsk[] = [
	ONE,
	ask({
		ask_id: "a-91be",
		timeout_s: 900,
		urgent: true,
		expires_at: TS - MINUTE,
		status: "timed_out",
		questions: [
			{
				id: "files",
				question: "Which files should the cleanup script touch?",
				options: [
					{ label: "logs only" },
					{ label: "logs and caches" },
					{ label: "everything under tmp" },
				],
				multi: true,
			},
		],
	}),
	ask({
		ask_id: "a-c204",
		status: "late",
		answered_at: TS + 8 * MINUTE,
		delivered: true,
		answers: { target: ["staging"] },
		answered_by: { surface: "phone" },
		questions: [
			{
				id: "target",
				question: "Which environment should I deploy this to?",
				options: [{ label: "staging" }, { label: "production" }],
			},
		],
	}),
];

const SECRET: PendingAsk = ask({
	ask_id: "a-sec1",
	questions: [
		{
			id: "DEPLOY_TOKEN",
			question: "Paste the deploy token for the staging cluster.",
			options: [],
			secret: true,
			persist: true,
		},
	],
});

const frontend = (
	asks: PendingAsk[] | null,
): Pick<CanonicalFrontendState, "asks" | "asks_open" | "asks_truncated"> => ({
	asks,
	asks_open: asks ? asks.filter((row) => row.status === "open").length : null,
});

const meta = {
	title: "Chat/Asks/Queued asks",
	component: AskSurfaces,
	parameters: {
		layout: "padded",
	},
	decorators: [
		(Story) => (
			<div className="w-[617px] bg-canvas p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AskSurfaces>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

/** The default a fresh ask lands in: one line, collapsed, nothing stolen. */
export const MinimizedOne: Story = {
	args: {
		frontend: frontend([ONE]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** Three asks, one already timed out: the bar counts only what is still open. */
export const MinimizedSeveral: Story = {
	args: {
		frontend: frontend(THREE),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/*
 * The three expanded stories render the PANEL directly rather than trying to
 * drive the bar's own chevron: the expand flag is client-local state inside
 * `AskSurfaces`, and a story that reached in to flip it would be testing its own
 * harness instead of the component. The rows still come from production code —
 * `askQueueView`, the same fold every mount reads — so the classification, the
 * ordering and the counts under review are the shipped ones.
 */
const panelView = (asks: PendingAsk[]) => askQueueView(frontend(asks));

const Expanded = ({ asks }: { asks: PendingAsk[] }) => (
	<AskPanel
		view={panelView(asks)}
		nowMs={NOW}
		// The story owns no draft: a frame is a still, and a still with a
		// half-filled form would photograph a transient rather than a state.
		drafts={EMPTY_DRAFTS}
		onDraftChange={noop}
		onAnswer={noop}
		onDecline={noop}
	/>
);

/** One open ask, expanded: the form that answers it whole. */
export const ExpandedSingle: Story = {
	render: () => <Expanded asks={[ONE]} />,
	args: {
		frontend: frontend([ONE]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * The queue at its honest worst: an open ask, a timed-out one that is still
 * answerable, and a late answer already delivered by another surface.
 */
export const ExpandedSeveral: Story = {
	render: () => <Expanded asks={THREE} />,
	args: {
		frontend: frontend(THREE),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** A credential question: the masked field is the whole answer path. */
export const SecretQuestion: Story = {
	render: () => <Expanded asks={[SECRET]} />,
	args: {
		frontend: frontend([SECRET]),
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A truncated frame. The wire caps the list, so the bar says what it is showing
 * rather than letting a prefix pass for the whole queue.
 */
export const Truncated: Story = {
	args: {
		frontend: { asks: [ONE], asks_open: 12, asks_truncated: true },
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** A published queue with nothing in it: the affordance is absent at zero. */
export const Empty: Story = {
	args: {
		frontend: { asks: [], asks_open: 0, asks_truncated: false },
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A backend that predates queued asks. This frame is IDENTICAL to `Empty`'s by
 * design — the capability is field presence, and absence means "not supported"
 * rather than "none right now" — which is exactly why it is worth a frame of its
 * own: a reader comparing them is checking that the app does not invent an
 * affordance it cannot satisfy.
 */
export const UnsupportedBackend: Story = {
	args: {
		frontend: { asks: null, asks_open: null, asks_truncated: null },
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** The refusal a settled ask comes back with, on the row that was pressed. */
export const Refused: Story = {
	args: {
		frontend: frontend([ONE]),
		/*
		 * EXPANDED, or the story photographs the wrong surface: without it the panel
		 * never mounts and the refusal sentence it exists for is not painted at all
		 * - which is why the design round could not review the refused row from any
		 * frame in the set (design round 2, D15). The state is "the row that was
		 * pressed shows the backend's refusal", and the row is in the panel.
		 */
		expanded: true,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
		outcomes: {
			"a-7f3c": {
				sending: false,
				refused:
					"That question was already settled, so your answer was not sent.",
			},
		},
	},
};

/**
 * THE ANSWERABLE STATE (design round 2, D15): a complete draft, so the primary
 * action is ENABLED.
 *
 * The designer could not reach it from any story - `Expanded` deliberately owns no
 * draft - and an enabled control is exactly the state a disabled-state frame cannot
 * vouch for: the two differ by ground AND, since D7, by edge, so a reader comparing
 * the pair is checking a real difference rather than one frame twice.
 */
export const AnswerReady: Story = {
	args: {
		frontend: frontend([ONE]),
		/* The panel opens on the same door the app uses. */
		expanded: true,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
		/*
		 * A COMPLETE draft for the ask's only question: `askAnswerMap` returns a body
		 * for exactly this shape, which is the condition `Send answer` enables on.
		 */
		drafts: { "a-7f3c": { target: ["staging"] } },
	},
};

/* ------------------------------------------------------------------ */
/* TEMPORARY base fixtures, for the ask-status-row BEFORE capture       */
/* ------------------------------------------------------------------ */

/*
 * These stories exist for ONE purpose and are superseded by the change they
 * document: the queued-ask affordance moved out of this file's surface (the bar
 * above the composer) into the composer status row, so the BEFORE half of
 * `docs/evidence/ask-status-row/` has to photograph the OLD surface in all four
 * of its states. Two of those states had no story on `main` - a settled-only
 * queue and a moved-on-only one - so they are written here against the shipped
 * components, as close to the after set's fixtures as the old surface allows.
 *
 * They are deleted by the commit that moves the affordance. The set's README
 * records exactly which of them was added and which already existed.
 */

/** A settled ask: answered and delivered, with the answer the panel must show. */
const ANSWERED: PendingAsk = ask({
	ask_id: "a-answered",
	status: "answered",
	answered_at: TS + 8 * MINUTE,
	delivered: true,
	answers: { target: ["staging"] },
	answered_by: { surface: "desktop" },
	questions: [
		{
			id: "target",
			question: "Which environment should I deploy this to?",
			options: [{ label: "staging" }, { label: "production" }],
		},
	],
});

/** A moved-on ask: the deadline passed, the agent walked past it, still answerable. */
const MOVED_ON: PendingAsk = ask({
	ask_id: "a-moved-on",
	expires_at: TS - MINUTE,
	status: "timed_out",
	questions: [
		{
			id: "target",
			question: "Which environment should I deploy this to?",
			options: [{ label: "staging" }, { label: "production" }],
		},
	],
});

/** Two asks the agent is still waiting on: the `N` form. */
const TWO_WAITING: PendingAsk[] = [
	ONE,
	ask({
		ask_id: "a-second",
		created_at: TS + 2 * MINUTE,
		questions: [
			{
				id: "files",
				question: "Which files should the cleanup script touch?",
				options: [{ label: "logs only" }, { label: "logs and caches" }],
			},
		],
	}),
];

/**
 * The published counts, as the WIRE defines them.
 *
 * The file's own `frontend()` helper above counts `status === "open"` only, which
 * is right for the bar stories that predate the fold and WRONG for these: the
 * backend's `asks_open` is its OUTSTANDING set - `open` OR `timed_out`
 * (`asks/store.py`'s `OUTSTANDING_STATUSES`), because a late answer still reaches
 * the agent. The difference is the whole of the moved-on state: with the helper's
 * count a timed-out ask publishes zero outstanding and the base bar reads "1
 * settled", which is a fixture artifact rather than the product. These fixtures
 * therefore publish the count the product's own wire carries, so the before frames
 * show what the shipped bar actually renders for these queues.
 */
const wireFrontend = (asks: PendingAsk[]) => ({
	asks,
	asks_open: asks.filter(
		(row) => row.status === "open" || row.status === "timed_out",
	).length,
});

const argsOf = (asks: PendingAsk[]) => ({
	frontend: wireFrontend(asks),
	nowMs: NOW,
	onAnswer: noop,
	onDecline: noop,
});

/** A settled-only queue: the bar reads the settled count. */
export const MinimizedSettledOnly: Story = { args: argsOf([ANSWERED]) };

/** A moved-on-only queue: the base bar has no moved-on reading of its own. */
export const MinimizedMovedOnOnly: Story = { args: argsOf([MOVED_ON]) };

/** Two waits: the `N` form the status-row item also renders. */
export const MinimizedTwoWaiting: Story = { args: argsOf(TWO_WAITING) };

/** The expanded settle: the question as asked and the answer as given. */
export const ExpandedSettled: Story = {
	args: { ...argsOf([ANSWERED]), expanded: true },
};

/** The expanded moved-on queue: row still answerable, reading distinct from settled. */
export const ExpandedMovedOn: Story = {
	args: { ...argsOf([MOVED_ON]), expanded: true },
};

/**
 * The ask element beside its neighbours, BEFORE the move: the bar sits in its own
 * strip above the composer status row, whose chips are the register it is about to
 * join. The pane's own width (617px minus the decorator's 16px of padding) is the
 * measure both halves are captured at.
 */
const NEIGHBOUR_DETAILS = deriveRunDetails({
	jobs: [],
	todos: [
		{
			name: "Plan",
			items: [
				{ text: "Reconcile the March invoices", status: "pending" },
				{ text: "Draft the unpaid summary", status: "done" },
			],
		},
	],
	wakes: [
		{
			id: "w1",
			message: "Stand-up reminder",
			next_due_at: NOW + 12 * MINUTE,
			created_at: NOW - MINUTE,
			every_ms: null,
			remaining: null,
			limit: null,
			fired_count: 0,
		},
		{
			id: "w2",
			message: "Sweep the ingest queue",
			next_due_at: NOW + 90 * MINUTE,
			created_at: NOW - MINUTE,
			every_ms: 90 * MINUTE,
			remaining: null,
			limit: null,
			fired_count: 0,
		},
	],
	monitors: [
		{
			id: "m1",
			name: "loom-pr-1710",
			tool: "bash",
			arguments: {},
			every_ms: 60_000,
			until_at: null,
			description: "",
			created_at: NOW - MINUTE,
			next_due_at: NOW + MINUTE,
			last_check_at: NOW - MINUTE,
			checks: 3,
			deliveries: 0,
			consecutive_failures: 0,
			disabled: false,
			disabled_reason: "",
		},
	],
	nowMs: NOW,
});

const NEIGHBOUR_FRONTEND = {
	goal: "Reconcile the March invoices",
	loop: null,
	asks: [ONE],
	asks_open: 1,
	asks_truncated: false,
} as unknown as CanonicalFrontendState;

const NeighbourBand = ({ width }: { width: number }) => (
	<div className={cn("@container/chatcol flex flex-col")} style={{ width }}>
		<AskSurfaces
			frontend={wireFrontend([ONE])}
			nowMs={NOW}
			onAnswer={noop}
			onDecline={noop}
			className="pt-2"
		/>
		<ComposerStatusRow
			frontend={NEIGHBOUR_FRONTEND}
			runDetails={NEIGHBOUR_DETAILS}
			isSmallView={width <= 550}
		/>
	</div>
);

/** The ask element in its old strip, beside the status row it is about to join. */
export const Neighbours: Story = {
	render: () => <NeighbourBand width={585} />,
	args: argsOf([ONE]),
};

/** The same pair at the narrow band the after set also carries. */
export const NeighboursNarrow: Story = {
	render: () => <NeighbourBand width={393} />,
	args: argsOf([ONE]),
};
