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
import "../../../../styles/index.css";
import { EMPTY_DRAFTS, askQueueView } from "../../ask-queue";
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
