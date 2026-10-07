/**
 * The asks DRAWER: the queue, its chrome bar, its scroller and its card bodies.
 *
 * These render the PRODUCTION component from real `PendingAsk` fixtures — the
 * shape the backend publishes on the frontend state — so what is judged is what
 * ships. A live queue is worse than slow to photograph: the states that matter
 * most here are the ones a session produces least often. A queue of three with
 * one timed out, a multi-select question, a secret question, a truncated list
 * and an answered-late row are all ordinary in the backend's fold and rare on
 * anyone's screen at the moment a camera is pointed at it.
 *
 * ## What this file is now, and what it was
 *
 * The component was a column mounted on the composer's band, and the stories were
 * accordingly a bare panel at 617px with no chrome around it. It is now a SIDE
 * CANVAS (the design note's §2 decision), so the frames carry what that decision
 * bought: a 40px chrome bar with a scope line and a dismiss, a scroller the queue
 * can actually overflow into, and the family's own width (560px is the dock cap the
 * decorator pins). The minimized bar's stories left this file long ago — the
 * affordance is an ITEM in the composer's status row, photographed beside the other
 * chips in `composer-status-row.stories.tsx`.
 *
 * What to look for, since these frames are the design review (design
 * `docs/design/ask-nonblocking.md` §5.0, §5.2; `~/workspace/ask-panel-design-1004/ask-panel-design-note.md`):
 *
 * - **The accent is spent exactly once per surface.** Inside the drawer it is the
 *   status glyph and the primary control, and nowhere else — § 2's budget is
 *   about three accent spends a screen.
 * - **QUEUED and TIMED-OUT do not look alike.** The copy contract's sentences
 *   are the difference, and the timeout keeps its answer controls live: a
 *   timed-out ask is still answerable (that is the `late` path), so it must not
 *   be drawn as a closed state. THAT IS WHY IT IS NOT IN THE SETTLED SECTION: the
 *   section is history, and a row whose answer still reaches the agent is not
 *   history - not even a one-line one. The section's own rows keep their
 *   distinction on the status WORD instead (`Answered` beside `Answered late`),
 *   which is the only half of the sentence a one-line row can hold.
 * - **Pending first, always complete; settled collapsed** (the note's §4.5/D3):
 *   history must not drive the drawer's length.
 * - **Disabled changes colour, never opacity.** An incomplete draft's Submit is
 *   a colour step on its own ground, not a wash toward it.
 * - **The secret question is a masked field**, and it is the only place a
 *   credential is ever typed. Its value never reaches a draft that drives a
 *   render.
 * - **Many overflows the LIST, never the page** (the note's D1): with twelve queued
 *   asks the chrome bar holds its place and the transcript beside it does not move.
 *   The two rows after them timed out and are STILL ANSWERABLE, so they are pending
 *   cards too: fourteen outstanding, and no settled section in that frame.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type {
	CanonicalFrontendState,
	PendingAsk,
} from "../../../../../../shared/desktop-session-contract";
import "../../../../styles/index.css";
import { AskDrawer } from "./ask-drawer";

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
			/*
			 * THE RECOMMENDATION IS THE QUESTION'S INDEX, not a flag on the option, and
			 * that is the wire's shape rather than a preference (agent review round 1,
			 * R1-1): the core's `AskOption` is `{label, description}` with
			 * `extra="forbid"`, `asks/queue.py`'s `_question_shape` writes
			 * `recommended` beside `options`, and the harness has already rotated the
			 * recommended option to index 0 (`AskQuestion._shape`). A fixture that put
			 * a flag on the option modelled a payload no producer sends, which is how
			 * the drawer's dead mark passed a green suite.
			 */
			recommended: 0,
			options: [
				{ label: "staging", description: "The shared pre-prod cluster" },
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
		ask_id: "a-late",
		status: "late",
		answered_at: TS + 4 * MINUTE,
		delivered: true,
		answers: { target: ["production"] },
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
	/*
	 * The wire's OUTSTANDING tally — `open` OR `timed_out` — not "waiting", which
	 * is the split the rows carry. See `ask-queue.ts`'s `AskQueueView.open`.
	 */
	asks_open: asks
		? asks.filter((row) => row.status === "open" || row.status === "timed_out")
				.length
		: null,
});

const meta = {
	title: "Chat/Asks/Queued asks",
	component: AskDrawer,
	parameters: {
		layout: "padded",
	},
	/*
	 * THE DRAWER'S OWN BOX, and the sizes are the family's rather than decorative: a
	 * 560px column with a fixed height is what the pane docks at when the row can
	 * afford it (`CANVAS_PANE_MAX_PX`), and the height is what makes the middle
	 * region's scroller a fact a frame can show - the D1 defect was a panel with no
	 * scroll owner, so a frame that gave it unlimited height could not show the fix.
	 */
	decorators: [
		(Story, context) => (
			/*
			 * A COLUMN, so the drawer stretches to the box's width: the app mounts it in
			 * `PaneSlot`, which sets the width inline, and a row-flex decorator left it at
			 * its content width (measured 390px of a 560px box) - a frame that would have
			 * shown a narrower drawer than the family ever draws.
			 *
			 * THE WIDTH IS A PARAMETER since the 2026-10-04 fold (`drawerWidth`,
			 * defaulting to the family's 560px cap). The full-text case has to be judged at
			 * BOTH ends of the family's arithmetic, and the 400px floor is the end where a
			 * wrapped question competes hardest with its own option rows: the `min(560,
			 * row - 480)` rule bottoms out there (`CANVAS_PANE_MIN_PX`), so a frame at 560
			 * alone cannot answer "does the card hold with real text". The inline style
			 * rather than a `w-[560px]` class is what makes one decorator serve both.
			 */
			<div
				className="flex h-[640px] flex-col bg-canvas"
				style={{
					width: (context.parameters.drawerWidth as number | undefined) ?? 560,
				}}
			>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AskDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

/** One open ask, expanded: the form that answers it whole. */
export const ExpandedSingle: Story = {
	args: {
		frontend: frontend([ONE]),
		scope: "session",
		onClose: noop,
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
	args: {
		frontend: frontend(THREE),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** A credential question: the masked field is the whole answer path. */
export const SecretQuestion: Story = {
	args: {
		frontend: frontend([SECRET]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A truncated frame. The wire caps the list, so the panel states the backend's
 * own outstanding tally rather than letting a prefix pass for the whole queue —
 * the reading the status-row item's clause takes from the same field.
 */
export const Truncated: Story = {
	args: {
		frontend: { asks: [ONE], asks_open: 12, asks_truncated: true },
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A published queue with nothing in it, EXPANDED: the panel mounts and states the
 * empty reading (`No asks outstanding. The agent is not waiting on anything.`).
 *
 * WHAT THIS FRAME IS AND IS NOT (QA round 1, Q-2: the note here used to say the
 * panel "is not even mounted", which its own `expanded: true` contradicts). This
 * story is the PANEL's mount, so the zero-queue fact it carries is the empty
 * sentence the panel draws when a caller pins it open. It is NOT the evidence that
 * the affordance is absent at zero: that is the status-row ITEM's own gate
 * (`rows.length > 0` on its view; remediation round 1, R3/Q1 dropped the retired
 * `sessionAsks !== null` clause beside it, which the row test already implied),
 * which this file does not render and `scripts/composer-tabs.test.mjs` pins on the
 * row. `CollapsedDrawsNothing` beside it is the third state - a collapsed mount
 * draws nothing at all.
 */
export const Empty: Story = {
	args: {
		frontend: { asks: [], asks_open: 0, asks_truncated: false },
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE WIRE FIX'S OWN EMPTY FRAME, and the one the stuck-slot defect was reported on: a
 * live queued engine with nothing outstanding publishes `asks` ABSENT with
 * `asks_open: 0` present - so the capability is there and the rows are not.
 *
 * WHY IT IS A STORY OF ITS OWN BESIDE `Empty`. The two frames differ in exactly the
 * field the lane used to read as capability, and they rendered DIFFERENTLY: `asks: []`
 * drew the panel and its empty sentence, while this one drew NOTHING at all - no bar,
 * no dismiss - because the old gate read the absent array as "this backend does not
 * publish queued asks". Switching conversations with the drawer open landed on this
 * frame, and the surface kept its 560px of the window with no way out of it. A reader
 * comparing this story with `Empty` is checking the two are now the same surface.
 *
 * (Its `onClose` is a no-op like every story's, so the frame below is what a mount
 * draws; in the app this mount also CLOSES itself - see the next story - unless the
 * user's own door is under focus.)
 */
export const EmptyWireFrame: Story = {
	args: {
		frontend: { asks: null, asks_open: 0, asks_truncated: false },
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE UNREAD FRAME (`frontend === null`): the fleet pane's first commits before its
 * route answers, or a session frame that has not landed.
 *
 * WHAT THIS FRAME PROVES, since it is the shape the fix is most tempted to get wrong:
 * an unresolved frame closes NOTHING (the read has not answered, so there is no fact to
 * act on) and TRAPS NOTHING (the bar above carries the dismiss and Escape closes the
 * surface). It states what the surface is doing rather than a count - `All asks settled`
 * over a queue nobody has read would be the verdict the lane's copy contract forbids -
 * and it is deliberately not the panel's own empty sentence, which makes a claim about
 * the agent's state that an unanswered frame cannot substantiate.
 *
 * THE BAR CARRIES NO CLAUSE HERE (design round 1, D5): the body already names the fact,
 * and saying it twice 30 px apart read as one two-line paragraph rather than as chrome
 * plus body. So the bar reads `This conversation` alone (`askScopeLine` drops the
 * separator with the clause) and the body states what the surface is doing.
 *
 * THE CLOSE IS THE OTHER HALF AND THE APP DELIVERS IT: this frame's `onClose` is a
 * no-op here, but a mount over it is NOT closed by the auto-close - and the moment the
 * frame lands with nothing in it, that effect closes the surface (or, if the user's own
 * door is under focus, shows `EmptyWireFrame` above instead).
 */
export const UnreadFrame: Story = {
	args: {
		frontend: null,
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE WIRE BOUND'S OWN FRAME (remediation round 1, R1): the runtime drops the whole row
 * list while deliberately keeping the tally - `_bound_asks_in_place` pops `asks` and
 * `asks_truncated` and leaves `asks_open` - so a frame can arrive with four outstanding
 * asks and no rows at all.
 *
 * WHAT IT PROVES. The rows say nothing here and the TALLY is the statement of record, so
 * the surface must not read the empty list as an empty queue: the bar counts four and the
 * panel states the count it cannot draw, in the chip's own words, rather than denying it
 * with `No asks outstanding` 190 px below. It also does NOT auto-close - closing over a
 * rowless frame that stands for four answerable asks would release the slot and leave
 * them unreachable, which is the reported defect with the sign flipped. (In the app this
 * mount is reached without a door only by a switch, and a door is not what opens it; the
 * story pins `onClose` to a no-op, so the frame below is what a mount draws.)
 *
 * `ClippedRows` uses the truncation flag the frame itself carries, which the null branch
 * of `askQueueView` used to hard-code to `false` - so before that fix this frame and the
 * untruncated one were indistinguishable to every reader of `view.truncated`.
 */
export const ClippedRowsFrame: Story = {
	args: {
		frontend: { asks: null, asks_open: 4, asks_truncated: true },
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A backend that predates queued asks. This frame is IDENTICAL to `UnreadFrame`'s on
 * screen and that is a defect the design round filed (design round 1, D1): the two
 * rendered byte-for-byte the same, so a runtime that can never answer wore the in-flight
 * copy forever - `Reading the asks…` is a progress claim that can never complete here,
 * which the copy contract forbids (a claim is checkable or it is cut). The frames are no
 * longer identical: the bar states the capability the runtime lacks and the body says
 * what that means, while `UnreadFrame` keeps the progress line.
 *
 * WHAT THE SURFACE DOES WITH IT (the stuck-slot fix). It draws its chrome, its own
 * unavailable state, and it CLOSES ITSELF on mount: the app never opens this drawer on
 * such a runtime (both doors are capability-gated to `published`, so nothing offers it),
 * and a mount that found itself here - an open flag inherited from a runtime that does
 * publish asks - would be a claimed slot with no close control if it drew nothing at all.
 * Storybook cannot run that close (`onClose` is a no-op), so the frame below is the
 * transient state a reader would see for the instant before it lands. Note the clause
 * reads `Asks unavailable` rather than `All asks settled`: a frame that publishes no
 * tally substantiates no count, and the settled verdict is not this frame's to wear.
 */
export const UnsupportedBackend: Story = {
	args: {
		frontend: { asks: null, asks_open: null, asks_truncated: null },
		scope: "session",
		onClose: noop,
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
		 * The state is "the row that was pressed shows the backend's refusal", and
		 * the row is in the panel — which is why the design round could not review
		 * it from any frame that did not open one (design round 2, D15).
		 */
		scope: "session",
		onClose: noop,
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
		scope: "session",
		onClose: noop,
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

/**
 * MANY: the queue long enough that the drawer's own scroller is the thing on
 * trial (the design note's D1).
 *
 * Twelve queued asks in a 640px-tall drawer cannot all fit, so this frame is the
 * evidence that the overflow is the LIST's (`min-h-0 flex-1 overflow-y-auto`) and
 * not the page's: the chrome bar stays pinned at the top, the drawer does not
 * grow, and no page-level scroller appears.
 *
 * FOURTEEN OUTSTANDING, NO SETTLED SECTION (agent review round 1, M1; the row's own
 * README says the same). The two `timedOutAsk` rows are the backend's outstanding
 * set again - a timed-out ask stays answerable - so they are the last two pending
 * CARDS, not two settled one-liners, and the queue in this frame holds nothing for
 * the disclosure to collapse. The earlier note here claimed the opposite and the
 * README's row followed it; both now state the state the frame actually holds.
 */
export const ManyOverflow: Story = {
	args: {
		frontend: frontend([
			...Array.from({ length: 12 }, (_, index) =>
				ask({
					ask_id: `a-many-${index}`,
					questions: [
						{
							id: "target",
							question: `Which environment should I deploy change ${index + 1} to?`,
							options: [
								{
									label: "staging",
									description: "The shared pre-prod cluster",
								},
								{ label: "production", description: "Live traffic" },
							],
						},
					],
				}),
			),
			timedOutAsk("a-settled-1"),
			timedOutAsk("a-settled-2"),
		]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE SETTLED SECTION, OPENED: the pending cards first and complete, then one
 * section header whose body is one line per settled ask.
 *
 * THE PAIR THAT HAD TO BE TOLD APART IS THE PAIR THE SECTION HOLDS (agent review
 * round 1, M1 = UX U1 = design D1). A `timed_out` ask cannot be in here at all - the
 * backend's outstanding set folds it in, so it stays a pending card with its answer
 * controls (see `timedOutAsk`) - and this note used to claim this frame photographed
 * that pair, which the frame itself contradicts. What the section DOES hold is the
 * shipped look-alike pair: `Answered` and `Answered late`, which differ only in the
 * word a one-line row can carry, and that is the pair this frame now photographs.
 */
export const SettledSection: Story = {
	args: {
		frontend: frontend([
			ONE,
			timedOutAsk("a-settled-1"),
			answeredAsk(),
			answeredLateAsk(),
			declinedAsk(),
		]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * A `timed_out` ask: STILL ANSWERABLE through the `late` path, so it is a PENDING
 * card rather than a settled row.
 *
 * The name is the claim (agent review round 1, M1): this fixture used to be called
 * `optionallySettled`, which described a state the backend does not produce - the
 * outstanding set folds `timed_out` in, so `presentAsk` marks the row `open`.
 */
function timedOutAsk(id: string): PendingAsk {
	return ask({
		ask_id: id,
		expires_at: TS - MINUTE,
		status: "timed_out",
		questions: [
			{
				id: "files",
				question: "Which files should the cleanup script touch?",
				options: [{ label: "logs only" }, { label: "logs and caches" }],
			},
		],
	});
}

/** An answer that reached the model before the deadline: SETTLED, and quiet. */
function answeredAsk(): PendingAsk {
	return ask({
		ask_id: "a-answered",
		status: "answered",
		answered_at: TS + 4 * MINUTE,
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
}

/** THE SECTION'S OTHER HALF OF THE PAIR: the same answer, delivered after the ask gave up. */
function answeredLateAsk(): PendingAsk {
	return ask({
		ask_id: "a-answered-late",
		status: "late",
		expires_at: TS - 30 * MINUTE,
		answered_at: TS + 20 * MINUTE,
		delivered: true,
		answers: { target: ["production"] },
		answered_by: { surface: "mobile" },
		questions: [
			{
				id: "target",
				question: "Which environment should I deploy this to?",
				options: [{ label: "staging" }, { label: "production" }],
			},
		],
	});
}

/**
 * THE OTHER DOOR'S FREE-FORM ANSWER, DRAWN (design round 1, D2's addendum).
 *
 * The composer's Enter is routed to the ask (design §5.0), and `sendToAsk` writes the
 * RAW TYPED TEXT into the first unanswered question's draft - so a value the option
 * list never offered reaches this card as a plain string. Before this round the card
 * drew NOTHING for it: every radio empty beside a question that was already answered,
 * which made an answer that did not come from the list indistinguishable from no
 * answer at all. The marked row under the two options is the fix, and this frame is
 * what it looks like.
 */
export const OtherAnswer: Story = {
	args: {
		frontend: frontend([ONE]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		/* The state the composer's door produces: `prod` is not a label of `ONE`'s
		 * staging/production question, so it arrives as the free-form value. */
		drafts: { "a-7f3c": { target: ["prod"] } },
		onDraftChange: noop,
		onAnswer: noop,
		onDecline: noop,
	},
};

/** Refused, and the agent was told: settled, and the one-liner says which word. */
function declinedAsk(): PendingAsk {
	return ask({
		ask_id: "a-declined",
		status: "declined",
		questions: [
			{
				id: "target",
				question: "Should I also rotate the deploy token while I am here?",
				options: [{ label: "yes" }, { label: "no" }],
			},
		],
	});
}

/*
 * ---------------------------------------------------------------------------
 * THE RECOMMENDATION AND THE SELECTION, AS TWO STATES (operator ask, 2026-10-04)
 * ---------------------------------------------------------------------------
 *
 * The operator's report: the recommended option was marked only by the word
 * `Recommended` in the same weight as everything around it, and nothing told a
 * recommendation apart from a SELECTION. The second half is the requirement that
 * decides the design - the tool hoists the recommended option to index 0, so the
 * two coincide until the user clicks something else, and if the only signal is
 * "this one is selected" then clicking anything else ERASES the advice he is
 * choosing against.
 *
 * So the pair below is not decoration: `RecommendedSelected` is the state the
 * card opens in, and `RecommendedPassedOver` is the state the ACT creates - the
 * recommended row keeps its badge while the radio sits on the other option. The
 * drawer card is the surface that carries a persistent selection (the dock's is
 * a roving cursor), which is why the pair lives here.
 */
export const RecommendedSelected: Story = {
	args: {
		frontend: frontend([ONE]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		/* The recommended option (`staging`) is the one ticked. */
		drafts: { "a-7f3c": { target: ["staging"] } },
		onDraftChange: noop,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE SAME CARD ONE CLICK LATER: `production` is selected and `staging` is still
 * marked as the recommendation.
 *
 * This is the frame the operator's requirement is judged on. If the badge were
 * the selection mark's twin, the advice would be gone from this state - and the
 * user would be choosing against a recommendation he can no longer see.
 */
export const RecommendedPassedOver: Story = {
	args: {
		frontend: frontend([ONE]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		/* The recommendation is `staging`; the answer drafted is the other one. */
		drafts: { "a-7f3c": { target: ["production"] } },
		onDraftChange: noop,
		onAnswer: noop,
		onDecline: noop,
	},
};

/*
 * ---------------------------------------------------------------------------
 * THE CARD AT FULL TEXT (the wire stopped clipping, so the layout has to hold)
 * ---------------------------------------------------------------------------
 *
 * The truncation the operator reported was a CORE wire bound (`ASK_QUESTION_WIRE
 * _CHARS = 200`, `ASK_OPTION_DESC_WIRE_CHARS = 80`) and it is gone: the core now
 * sends the question, the labels and the descriptions whole. The design round
 * measured this card's content box at 512px/352px and found nothing truncating,
 * but it had no fixture with text long enough to reach the wrap - every story's
 * strings were one line - so the claim rested on prose rather than on a frame.
 *
 * These are the strings the claim needs, at the lengths the wire used to cut:
 * a 452-character question, a 65-character label and a 320-character
 * description, which is the operator's own ask `a-1647` before it was clipped.
 * (QA round 1, Q-1's nit: the note here used to say 389 and 338, which were not
 * the strings' lengths - the fixture is measured, not estimated, and the correct
 * figures are these.)
 * The question must WRAP (never elide), the labels must stay scannable with the
 * recommendation beside them, and the descriptions must be fully visible - the
 * drawer owns a scroller (`ask-drawer.tsx`: `min-h-0 flex-1 overflow-y-auto`), so
 * a tall card is a card the user scrolls, not a card that cuts a sentence.
 *
 * TWO WIDTHS, and both are the family's own: 560 is `CANVAS_PANE_MAX_PX` and 400
 * is `CANVAS_PANE_MIN_PX`. The floor is where the wrapped question competes
 * hardest with its option rows, and it is the one the design round asked to
 * check rather than assume.
 */
const LONG_QUESTION =
	"The rollout window for the billing migration collides with the audit freeze, and the question is which of the two should move: if I move the migration the finance close slips a week and the reconciliation report has to be rebuilt on top of partially migrated rows, and if I move the freeze the auditors see a schema change mid-window — either way one of them needs a decision from you before Thursday, and I would rather not guess which one is cheaper.";

const LONG_LABEL_A =
	"Amend the clause: grade on client latency, record depth beside it";
const LONG_LABEL_B =
	"Keep the clause as written and add a waiver footnote for this release";
const LONG_LABEL_C =
	"Escalate the conflict to the platform team and hold the migration";

const LONG_DESCRIPTION_A =
	"The clause is the one the client's own counsel drafted, and amending it now means the change rides the same revision the auditors are already reading, so the record stays in one place; the cost is that the waiver footnote has to be re-issued and the client sees a second version of a document they already signed off on.";
const LONG_DESCRIPTION_B =
	"The client is served better this way: nothing they have already approved changes, and the footnote is the smallest artefact that states the exception without reopening the clause. The risk is that a footnote is easier for a future reader to miss than a clause, and the exception then reads as the rule.";
const LONG_DESCRIPTION_C =
	"Escalating is the honest answer when the two constraints are genuinely in conflict, and the platform team owns both sides of it; the cost is that the decision moves off your desk and into a queue you do not control, which is the outcome the deadline makes expensive.";

const LONG_TEXT_ASK: PendingAsk = ask({
	ask_id: "a-1647",
	questions: [
		{
			id: "rollout",
			question: LONG_QUESTION,
			recommended: 0,
			options: [
				{ label: LONG_LABEL_A, description: LONG_DESCRIPTION_A },
				{ label: LONG_LABEL_B, description: LONG_DESCRIPTION_B },
				{ label: LONG_LABEL_C, description: LONG_DESCRIPTION_C },
			],
			multi: false,
		},
	],
});

/** Full text at the family's 560px cap: the question wraps, nothing elides. */
export const FullTextAtWidth: Story = {
	args: {
		frontend: frontend([LONG_TEXT_ASK]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE SAME CARD AT THE FAMILY'S 400px FLOOR, which is the width the design round
 * asked to be checked rather than assumed: every line here wraps harder, the
 * recommended option's badge has to sit beside a 65-character label, and the
 * question's own wrapped lines compete with the rows beneath it.
 */
export const FullTextAtFloor: Story = {
	parameters: { drawerWidth: 400 },
	args: {
		frontend: frontend([LONG_TEXT_ASK]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
	},
};

/**
 * THE CHANGE-BACK WINDOW (design §10, #1936)
 * ------------------------------------------
 *
 * Between the answer landing in the log and the response row existing, the agent
 * has been told NOTHING — so the answer is still the user's to change, and the
 * card says so with a control of its own. The window closes on delivery, which is
 * why the control is gated on the WIRE's `delivered` flag and on nothing else:
 * §10 forbids inferring a revision from the values (equal values are not a retry
 * marker, different values are not a revision), so the client states the intent by
 * sending the op and this surface never guesses it.
 *
 * `Changeable`, `ChangeableLate` and `ChangeRefused` are the three states §10's
 * evidence asks for: the affordance while the window is open for an `answered`
 * answer, the same affordance for a `late` one (the half the first fixture set
 * missed — see `lateUndeliveredAsk`), and the owner's own refusal
 * (`already delivered — send a new message`) rendered IN PLACE on the same row,
 * because a silent no-op would be the worse failure. `RevisedAfterChange` is what
 * the wire publishes once a revision is accepted: the same answer frame, carrying
 * the LATEST `revised` event's map (the fold reads the effective answers from it,
 * and the status, stamp and attribution stay the FIRST answer's) — plus this
 * surface's own receipt, because the wire has no marker for an accepted change.
 *
 * The form itself is not a story: it is one press away (`Change answer`), and the
 * PR's frames show it clicked rather than a fixture that skips the press.
 */
function changeableAsk(): PendingAsk {
	return ask({
		ask_id: "a-change",
		status: "answered",
		/*
		 * THE FLAG THE CONTROL READS, and the whole reason this fixture is not
		 * `answeredAsk()`: delivered `true` is history and offers nothing, which is
		 * asserted as its own negative in `scripts/ask-revise.test.mjs`.
		 */
		delivered: false,
		answered_at: TS + 4 * MINUTE,
		answered_by: { surface: "desktop" },
		answers: { target: ["staging"], confirm: ["yes"] },
		questions: [
			{
				id: "target",
				question: "Which environment should I deploy this to?",
				recommended: 0,
				options: [
					{ label: "staging", description: "The shared pre-prod cluster" },
					{ label: "production", description: "Live traffic" },
				],
				multi: false,
			},
			{
				id: "confirm",
				question: "Should I run the migration first?",
				options: [{ label: "yes" }, { label: "no" }],
				multi: false,
			},
		],
	});
}

/** The same ask after an accepted revision: the latest map, still undelivered. */
function revisedAsk(): PendingAsk {
	return ask({
		...changeableAsk(),
		answers: { target: ["production"], confirm: ["yes"] },
	});
}

/**
 * §10's LATE half, which the first cut of this pair did not cover (design round 1,
 * D2 = agent review round 1's MAJOR).
 *
 * A `late` answer IS a recorded answer: the deadline went by, the answer arrived
 * afterwards, and the engine admits a revision for it exactly as it does for
 * `answered` — `asks/queue.py`'s `_revision_decision` reads "an ask that already
 * carries an answer (`answered`/`late`) with no `ask-response-<ask_id>` row yet",
 * and its `revise` docstring calls the late case "the one revision that is still
 * free to make". The fixture matters because the two `late` states are
 * indistinguishable without it: `late` + `delivered: false` is inside the window,
 * `late` + `delivered: true` is behind it, and only a rendered card shows which one
 * draws a door.
 *
 * The `late` residual is RESOLVED UPSTREAM (engine PR #1983, merged 2026-10-04: the
 * revision window closes on the response row's DURABLE APPEND, not on handoff). A
 * `late` ask whose TIMEOUT notice has gone out now reads `delivered: false` until its
 * answer row lands, so `delivered: false` is exactly the window and this fixture is a
 * state a running core can produce. What the client still cannot do is read the row
 * bound DIRECTLY — it reads the wire's `delivered` and nothing else, per §10's
 * no-inference rule — which is `AskPresentation.delivering`'s own note, not a gap this
 * fixture has to fake.
 */
function lateUndeliveredAsk(): PendingAsk {
	return ask({
		...changeableAsk(),
		ask_id: "a-late-undelivered",
		status: "late",
		/*
		 * The two halves of the state, made explicit because they are what the card
		 * reads: the deadline is behind us (`answered_at` after `expires_at`), and the
		 * wire says nothing has been delivered yet.
		 */
		expires_at: TS + 2 * MINUTE,
		answered_at: TS + 6 * MINUTE,
		delivered: false,
	});
}

export const Changeable: Story = {
	args: {
		frontend: frontend([changeableAsk()]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
		onRevise: noop,
	},
};

export const ChangeRefused: Story = {
	args: {
		frontend: frontend([changeableAsk()]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
		onRevise: noop,
		/*
		 * THE OWNER'S OWN SENTENCE, byte for byte what the runtime emits once the
		 * response row exists (`asks/render.REVISED_ALREADY_DELIVERED`). The row is
		 * still drawn from a frame that predates the delivery, which is exactly the
		 * reachable path §10 says must be rendered rather than swallowed.
		 *
		 * `refusedByOwner` is what makes it a VERDICT and not just a sentence about the
		 * press (agent review round 2's minor): it is the flag that withdraws the door and
		 * drops the row from the chrome's count, and a refusal that never reached the
		 * backend deliberately leaves it false.
		 */
		outcomes: {
			"a-change": {
				sending: false,
				refused: "already delivered — send a new message",
				refusedByOwner: true,
			},
		},
	},
};

export const ChangeableLate: Story = {
	args: {
		frontend: frontend([lateUndeliveredAsk()]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
		onRevise: noop,
	},
};

export const RevisedAfterChange: Story = {
	args: {
		frontend: frontend([revisedAsk()]),
		scope: "session",
		onClose: noop,
		nowMs: NOW,
		onAnswer: noop,
		onDecline: noop,
		onRevise: noop,
		/*
		 * THE RECEIPT (design round 1, D3; UX round 1, U3). The wire cannot mark an
		 * accepted change — the fold keeps the FIRST `answered`'s status, stamp and
		 * attribution and requires no marker — so the frame that carries a changed map
		 * is a first-answer frame, indistinguishable from the answer it replaced. The
		 * accepted revision is this surface's own record, and it is what the card's
		 * receipt line draws from.
		 */
		outcomes: {
			"a-change": { sending: false, refused: null, changed: true },
		},
	},
};
