/**
 * The pending gate, across the states that decide whether its options are
 * answerable: an `ask` carrying the model's own options, and an `approval`,
 * whose two options are the client's own (`APPROVAL_OPTIONS`) — the wire sends
 * none for that kind, and it is answered with a strict boolean.
 *
 * These render the PRODUCTION `CanonicalTranscript` from real
 * `PendingDesktopGate` fixtures, so what is judged is what ships — not a
 * hand-built card with the same class names. A live gate is slow and awkward
 * to hold open for a photograph (it needs a model that asks, and it ends the
 * moment anyone answers), and the states that matter most here are the ones a
 * live session produces least often: eight options, a label that wraps, a
 * multi-question ask, a secret ask with no options at all.
 *
 * What to look for, since these frames are the design review:
 *
 * - **The options read as controls.** The previous version of this card was
 *   inert muted text numbered `1.`, `2.`, `3.` — indistinguishable from prose,
 *   and the whole defect. Each option now has its own fill and edge, so the
 *   card says "press one" without a sentence having to say it.
 * - **The options are OUTSIDE the accent wash, and that is deliberate.** The
 *   callout keeps the accent and owns the question; the buttons sit beneath it
 *   on the transcript's own ground. `border-control` on `accent-wash` measures
 *   2.69:1 at its worst (cyberpunk; 2.89:1 on iceberg) — under the 3:1
 * structural floor — so a bordered control inside the wash is not a thing that
 * can exist in any theme. They still read as one unit, by proximity and a
 * shared left rail.
 * - **The recommended option says the word.** Not a colour difference and not
 *   a bare glyph: the terminal card learned in its own design round that a
 *   marker styled like the prose around it cannot be found in a rendered frame
 *   without searching for it.
 * - **The ordinals survive.** They are the shortcut the terminal teaches, and
 *   typing one now resolves to that option's label rather than sending "1" —
 *   so the numerals are no longer a promise the app breaks.
 * - **The in-flight state disables by COLOUR, never opacity**, so the disabled
 *   card is legible on its own ground rather than washed toward it.
 * - **An approval wears the same band as an ask**, from the same component
 *   rather than a forked one — the operator asked for exactly that
 *   ("approvals need to show options like that too ... and show context about
 *   the requested command/action"), and one component for both kinds is what
 *   keeps the contrast triple, the ordinals, the focus handling and the busy
 *   semantics from drifting apart between them.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import type { Meta, StoryObj } from "@storybook/react";
import { useRef, useState } from "react";
import type { PendingDesktopGate } from "../../../../../shared/desktop-session-contract";
import "../../../styles/index.css";
import { answerUnconfirmedMessage } from "../ask-answer";
import {
	QuestionDock,
	type QuestionDockProps,
} from "../components/trace/question-dock";
import { CanonicalTranscript } from "./canonical-transcript";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const TS = 1_760_000_000_000;

/*
 * Every frame carries the user turn that provoked the question.
 *
 * Not decoration, and not merely realism: `CanonicalTranscript` COLLAPSES
 * itself to `h-0 overflow-hidden` when it holds no records, so the composer
 * band below can grow into the column instead of sitting under an empty void.
 * A gate rendered against an empty transcript therefore paints nothing at all
 * — the state is unreachable in the app, where a gate always follows the turn
 * that asked, and a story that fixtured it photographed a blank frame.
 */
function transcriptWith(text: string): TranscriptState {
	const records: TranscriptRecord[] = [
		{ kind: "user", id: "user:1", ts: TS, text, images: [] },
	];
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		// No pass in flight: the working line's `compacting` rung reads this, and
		// every story here is a settled or answering state, never a compaction.
		compacting: false,
		compactingSince: 0,
		viewEpoch: 0,
		oldestId: null,
		oldestTs: 0,
		hasMore: false,
		argsByCall: new Map(),
	};
}

const gate = (over: Partial<PendingDesktopGate> = {}): PendingDesktopGate => ({
	request_id: REQUEST,
	kind: "ask",
	title: "Is the extension popup open?",
	detail: "",
	options: [],
	secret: false,
	question_index: 0,
	question_total: 1,
	...over,
});

const Frame = ({
	pending,
	asked,
	height = 320,
	width = "100%",
	answering = false,
	answer = null,
	onAnswerSecret,
}: {
	pending: PendingDesktopGate;
	/** The user turn the question is an answer to. See `transcriptWith`. */
	asked: string;
	height?: number;
	width?: string;
	/** An answer is in flight: every option is disabled. */
	answering?: boolean;
	/**
	 * This pane's record of the gate it answered — what `chat-page.tsx` hands the
	 * dock once an outcome landed. A refused answer renders the held card; the
	 * secret stories reach that state the way a reader does (see
	 * `SecretAnswerHeldFrame`).
	 */
	answer?: QuestionDockProps["answer"];
	/**
	 * The secret field's door. Absent (the default) renders the field READ-ONLY,
	 * which is what a surface that cannot address an owner gets — the secret
	 * stories pass a no-op so the field photographs as the app wires it.
	 */
	onAnswerSecret?: (value: string) => void;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		/*
		 * A FLEX column of a fixed height, not a plain scroller.
		 *
		 * `CanonicalTranscript` is the app's scroll container and expects to be the
		 * flex child that absorbs the pane's leftover height (`min-h-0 grow`).
		 * Wrapped in a plain `overflow-y-auto` div it was instead free to grow to
		 * its own content height inside that div, which is how a story twice the
		 * pane's height photographed as the TOP of a document: the frame showed the
		 * callout and clipped the hint, which is not a state the app can be in. It
		 * is the pane's behaviour that matters for a height question, and the app
		 * pins the pane to its newest content — so the story has to be the pane.
		 */
		<div
			className="flex flex-col overflow-hidden p-6"
			ref={containerRef}
			style={{ width, height }}
		>
			<CanonicalTranscript
				transcript={transcriptWith(asked)}
				gate={pending}
				waiting={false}
				/*
				 * A story cannot admit a send, so the wait line is not in play here: the
				 * branch this file's frame is about is the pending question, which
				 * outranks the wait line anyway (`working-line-model.ts`).
				 */
				starting={false}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={false}
				status="live"
				onReconnect={() => {}}
				failure={null}
				awaitingHydration={false}
			/>
			{/*
			 * The question is DOCKED under the transcript, where the pane mounts it
			 * above the composer (§F1) - so the story composes the two the way
			 * `chat-content.tsx` does rather than asking the transcript for a card it
			 * no longer draws. `onAnswer` is a no-op: a story has no session, and the
			 * click path is asserted in `scripts/ask-options.test.mjs`.
			 */}
			<QuestionDock
				gate={pending}
				answering={answering}
				answer={answer}
				onAnswer={() => {}}
				onAnswerSecret={onAnswerSecret}
				className="pt-2"
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Ask options",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The common case: three options, the first one recommended. */
export const Options: Story = {
	render: () => (
		<Frame
			asked="Pair the browser extension so you can drive my browser."
			height={470}
			pending={gate({
				options: [
					{
						label: "Popup is open — generate the pairing code",
						description: "I will read the code back to you.",
					},
					{
						label: "Popup is not open",
						description: "Walk me through opening it first.",
					},
					{ label: "Something else" },
				],
				// Index 0, because `AskQuestion._shape` hoists the recommended
				// option to the top before the wire ever sees it.
				recommended: 0,
			})}
		/>
	),
};

/**
 * One option, which is the shape that most tempts a card into looking broken:
 * a single button under a question reads as a confirmation dialog unless the
 * free-text hint below it stays honest.
 *
 * NOT A PRODUCTION STATE, kept as defensive coverage. `AskQuestion._shape` in
 * the harness (`local_operator/harness/types.py`) rejects a non-secret ask with
 * fewer than two options — "at least two answers to pick from" — so a real `ask`
 * gate never arrives holding one. The frame is still worth having because the
 * component is what decides whether it degrades honestly if a future wire does
 * carry one; it is not evidence about a state a user can reach (code review
 * round 1, R-NIT).
 */
export const SingleOption: Story = {
	render: () => (
		<Frame
			asked="Cut the 0.18.0 release when the pipeline is green."
			height={380}
			pending={gate({
				title: "Ready to publish the release?",
				options: [
					{
						label: "Publish it",
						description: "Tags v0.18.0 and pushes to PyPI.",
					},
				],
			})}
		/>
	),
};

/**
 * Eight options — the density at which the ordinals earn their keep and at
 * which the option band has to cap itself.
 *
 * Captured at a 620px pane on purpose, which is the app's own default window
 * (1380x900 leaves the transcript about 617px once the header and the composer
 * band are taken out). Before the band had a ceiling this state pushed the
 * callout, the eyebrow and the question out of the top of the pane — the
 * options stayed visible and the question they answer did not (design round 1,
 * D1). At 620 the frame IS the failure mode the fix addresses, so a regression
 * shows up here rather than only at a window nobody runs.
 */
export const ManyOptions: Story = {
	render: () => (
		<Frame
			asked="Start the design pass on the desktop app."
			height={620}
			pending={gate({
				title: "Which surface should I start with?",
				options: [
					{ label: "Transcript", description: "The chat column itself." },
					{ label: "Composer", description: "Input, attachments, slash." },
					{ label: "Sidebar", description: "Session list and search." },
					{ label: "Settings", description: "Providers and credentials." },
					{ label: "Usage dialog", description: "Quota and spend." },
					{ label: "Update flow", description: "Download, verify, install." },
					{ label: "Notifications", description: "Toasts and banners." },
					{ label: "None of these", description: "I will describe it." },
				],
				recommended: 0,
			})}
		/>
	),
};

/**
 * Nine options, EVERY description wrapping — the state issue #762 is about.
 *
 * Nine because that is where the ordinals stop (`ask-options.tsx`: digits 1-9
 * are the shortcut), so it is the densest list the card can actually present,
 * and every description here is long enough to take a second line at the 1024
 * column. Before the fix the row's box did not include the wrapped
 * description, so each row's ordinal and label landed on the description above
 * it and the collisions cascaded down the list — with few or short options the
 * panel renders correctly, which is why no existing story caught it.
 *
 * This story is the REGRESSION PIN: `scripts/ask-options-geometry.mjs`
 * measures the rendered rows from this state and exits non-zero when any two
 * row boxes intersect or a row does not contain its own label column. It fails
 * on the pre-fix component (the failing run rides with the PR) and passes
 * after, and its capture entry in `scripts/capture-evidence.mjs` pairs the
 * before/after frames.
 */
export const WrappedDensity: Story = {
	render: () => (
		<Frame
			asked="The March statement drop arrived from the bank an hour ago."
			height={620}
			pending={gate({
				title: "Which import path should I take for the March statement drop?",
				options: [
					{
						label: "Run the finance-import playbook end to end",
						description:
							"Starts from the nightly import skill, waits for its reconciliation report before anything is posted, and files a summary row instead of paging anyone while a soft failure is still being retried.",
					},
					{
						label: "Replay only the rows that failed validation",
						description:
							"Picks up from the rejection file and re-runs those rows through the normalizer, which is usually faster than the full import but leaves the row counts in the summary slightly stale until the next sweep.",
					},
					{
						label: "Reconcile the delta against the ledger first",
						description:
							"Reads both sides before writing anything at all, so the import can be cancelled with no cleanup if the counts disagree by more than the tolerance the treasury team set for this account.",
					},
					{
						label: "Load it into the staging tables for review",
						description:
							"Writes the whole drop into the review schema and stops there, which means nothing touches production until someone promotes it by hand the following morning.",
					},
					{
						label: "Ask the vendor for a corrected export",
						description:
							"Rejects this drop entirely and asks the counterparty to regenerate it from their side, which preserves the audit trail but adds at least a working day before anything lands.",
					},
					{
						label: "Split the drop by account and load in batches",
						description:
							"Runs the normalizer once per account cluster, which isolates a bad slice to its own batch but multiplies the summary rows and the notifications the finance channel receives.",
					},
					{
						label: "Dry-run the import and print the plan",
						description:
							"Shows every row the load would touch and the journal entries it would create without writing anything, which is the safest way to check the mapping changes from last week.",
					},
					{
						label: "Hold it until the FX rates are re-published",
						description:
							"Skips this run because the rate table predates the fixing window; the drop stays queued and the scheduler picks the same path up as soon as the new rates are live.",
					},
					{
						label: "None of these — walk me through the options",
						description:
							"Answers nothing and asks for a walkthrough instead, so the conversation continues with the relevant playbook and the tool contracts quoted in the order I would run them.",
					},
				],
				recommended: 0,
			})}
		/>
	),
};

/**
 * Long labels and long consequence lines, both wrapping.
 *
 * The label and its description must stay distinguishable after they wrap, and
 * the ordinal must stay pinned to the first line rather than centring itself
 * against a three-line block.
 *
 * Captured at two widths. At the 1024 column the label does not wrap at all, so
 * the property this story exists for was never in any committed frame (design
 * round 1, D5); at 760 it still did not — the label box measured one 19.5px line
 * and the only thing that wrapped was the `Recommended` mark, so the frame this
 * story was read for showed the ordinal pinned against a wrapped MARK (design
 * round 2, D9). It is captured at 560 now, where the button's interior is
 * narrower than the label's own ~581px single-line measure and the label itself
 * has to wrap. Both widths ship because the difference between them is the point:
 * 1024 is "the label fits, everything on one line", 560 is "the label wraps and
 * the ordinal stays with its first line".
 */
export const WrappingLabels: Story = {
	render: () => (
		<Frame
			asked="The staging migration failed halfway through."
			height={620}
			pending={gate({
				title: "How should I handle the failing migration?",
				detail:
					"The migration is halfway applied on staging and the rollback script has never been exercised.",
				options: [
					{
						label:
							"Roll forward with a corrective migration that backfills the null column and re-runs the constraint",
						description:
							"Keeps the partial state and repairs it in place. Nothing is dropped, but the constraint stays unenforced until the backfill finishes, which on the current row count is roughly forty minutes.",
					},
					{
						label: "Roll back to the previous revision and re-plan",
						description:
							"Exercises the untested rollback path on staging, which is where you would rather discover it does not work.",
					},
				],
				recommended: 0,
			})}
		/>
	),
};

/**
 * A multi-question ask: the "Question 1 of 3." prefix has to survive beside
 * the new "Choose an option" hint, because knowing more questions follow is
 * what stops the first answer feeling like the last.
 */
export const MultiQuestion: Story = {
	render: () => (
		<Frame
			asked="Deploy the new enrichment worker."
			height={450}
			pending={gate({
				title: "Which environment am I deploying to?",
				options: [
					{ label: "Staging", description: "Safe to break." },
					{ label: "Production", description: "Customer traffic." },
				],
				question_index: 0,
				question_total: 3,
				recommended: 0,
			})}
		/>
	),
};

/**
 * An answer is in flight.
 *
 * Every option is disabled so a second press — or a typed send racing a click
 * — cannot post a second answer for one question, and the callout's eyebrow
 * says what is happening: "Sending your answer…", because with the eyebrow
 * static this state is indistinguishable from a press that never registered
 * (design round 1, D3; UX round 1, U2, measured at 9.1s of no feedback at all).
 * Disabled changes COLOUR and never opacity, which is what keeps this frame
 * legible rather than faded.
 */
export const AnswerInFlight: Story = {
	render: () => (
		<Frame
			asked="Pair the browser extension so you can drive my browser."
			height={470}
			answering={true}
			pending={gate({
				options: [
					{
						label: "Popup is open — generate the pairing code",
						description: "I will read the code back to you.",
					},
					{
						label: "Popup is not open",
						description: "Walk me through opening it first.",
					},
					{ label: "Something else" },
				],
				recommended: 0,
			})}
		/>
	),
};

/**
 * A `secret` ask, which arrives with EMPTY options.
 *
 * The state the FIELD exists for, and this file is where it is photographed:
 * no backend this rig can boot will park a secret ask (the mock provider
 * cannot ask at all — see `renderer-driver.mjs`'s `question-dock` scene, which
 * carries the same limitation for option asks), so the card's own rendering is
 * the evidence, and the live half — the composer closure, the masked
 * attributes, the wire body — is pinned by the desktop suite and driven on the
 * PR's frames.
 *
 * What a reviewer should look for: a PASSWORD field (masked, not a clear-text
 * value), the reassurance line above it, a Send control disabled while the
 * field is empty, and a hint that names the field rather than the composer.
 * The composer is NOT in this frame — the story renders the dock the way
 * `chat-content.tsx` mounts it; the closure of the box under it is the
 * composer's own suite's business.
 */
export const SecretAsk: Story = {
	render: () => (
		<Frame
			asked="Set up the GitHub integration."
			height={360}
			onAnswerSecret={() => {}}
			pending={gate({
				title: "Paste the GitHub token",
				detail: "It is stored in the credential store, not in the transcript.",
				secret: true,
				options: [],
			})}
		/>
	),
};

/**
 * A secret answer in flight, WITH THE TYPED VALUE UNDER THE MASK.
 *
 * The field and its Send control refuse input while the one-answer lock is
 * held, and the eyebrow says what is happening — "Sending your answer…", the
 * same in-flight reading the option states carry, from the same card. The value
 * the user handed over stays in the masked field until the outcome is known; it
 * clears only once the answer was SENT (`SecretAnswer`'s own rule), so the
 * reading this state exists to show is the DOTS STILL PRESENT mid-submit.
 *
 * THE FRAME IS REACHED THE WAY A READER REACHES IT (design round 1, D2; agent
 * review round 1, MINOR-1). The story renders the idle field; the sweep row
 * types a fixture into it through the real input pipeline (`insertText`) and
 * presses Enter through the real key pipeline, and the submit the form receives
 * flips this story's own `answering` — there is no way to seed a value into the
 * shipped field from props, and an untyped field made the retention claim
 * unfalsifiable: an empty field is equally what a premature clear looks like
 * (which is what this story shipped first, and the round 1 review caught).
 */
export const SecretAnswerInFlight: Story = {
	render: () => <SecretAnswerInFlightFrame />,
};

const SecretAnswerInFlightFrame = () => {
	const [answering, setAnswering] = useState(false);
	return (
		<Frame
			asked="Set up the GitHub integration."
			height={360}
			answering={answering}
			onAnswerSecret={() => setAnswering(true)}
			pending={gate({
				title: "Paste the GitHub token",
				detail: "It is stored in the credential store, not in the transcript.",
				secret: true,
				options: [],
			})}
		/>
	);
};

/**
 * A secret answer HELD: the outcome is unknown, so nothing can send again.
 *
 * The one state the round 1 reviews converged on (design D1; UX U1; QA Q-1):
 * after an UNKNOWABLE outcome the field and Send are disabled with the typed
 * value kept — a retry could send the answer twice — and the hint swaps to a
 * sentence that names no dead control. A DEFINITE not-sent refusal does NOT
 * hold (its field is released for a retry) and this story shows the arm that
 * does.
 *
 * REACHED THE WAY THE IN-FLIGHT FRAME IS: the sweep types a value and presses
 * Enter, and the submit flips this story's answer to the held outcome — the
 * same shape `chat-page.tsx` produces from the transport arm of
 * `answerReport`. The sentence is the shipped one
 * (`answerUnconfirmedMessage`), not a fixture literal, so the frame cannot
 * drift from the copy the app renders.
 */
export const SecretAnswerHeld: Story = {
	render: () => <SecretAnswerHeldFrame />,
};

const SecretAnswerHeldFrame = () => {
	const [answer, setAnswer] = useState<QuestionDockProps["answer"]>(null);
	return (
		<Frame
			asked="Set up the GitHub integration."
			height={360}
			answer={answer}
			onAnswerSecret={() =>
				setAnswer({
					sending: false,
					refused: answerUnconfirmedMessage(
						new DesktopControlError(
							null,
							"Desktop controls could not reach the backend process.",
						),
					),
					// The unknowable arm holds; a definite refusal would carry `true`
					// and release the field (round 1's D1/U1/Q-1 split).
					retryable: false,
				})
			}
			pending={gate({
				title: "Paste the GitHub token",
				detail: "It is stored in the credential store, not in the transcript.",
				secret: true,
				options: [],
			})}
		/>
	);
};

/**
 * An approval gate, which now shows the same options affordance as an ask.
 *
 * The wire carries no options for an approval — the title is the tool's name
 * and the detail the action it wants — so Approve and Deny are the CLIENT's
 * labels (`APPROVAL_OPTIONS`), and pressing one posts the strict boolean the
 * answer route takes. This replaced `ApprovalUnchanged`, which photographed the
 * old yes/no-only card precisely so this change could not go unnoticed.
 */
export const Approval: Story = {
	render: () => (
		<Frame
			asked="Clean the build output before rebuilding."
			height={360}
			pending={gate({
				kind: "approval",
				// The live wire's own shape for a shell call: the tool's name as
				// the title, and the tool's own approval describer as the detail
				// (`_describe_shell_approval` in the backend: "run: <command>").
				title: "bash",
				detail: "run: rm -rf ./dist",
				options: [],
			})}
		/>
	),
};

/**
 * An approval mid-answer.
 *
 * The eyebrow says "Sending your answer…" and both options are disabled — the
 * same in-flight semantics as an ask, from the same component — because the
 * window between the press and the gate moving is exactly when a second press
 * (or a typed send racing the click) would post a second answer to a one-shot
 * gate. The live half of this pair is in `docs/evidence/approval-options-live/`.
 */
export const ApprovalAnswerInFlight: Story = {
	render: () => (
		<Frame
			asked="Clean the build output before rebuilding."
			height={360}
			answering={true}
			pending={gate({
				kind: "approval",
				title: "bash",
				detail: "run: rm -rf ./dist",
				options: [],
			})}
		/>
	),
};
