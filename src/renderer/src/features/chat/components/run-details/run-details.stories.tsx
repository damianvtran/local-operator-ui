/**
 * The run panel, in the states `docs/run-sidebar.md` § 11.3 names.
 *
 * These render the REAL surfaces — the production `ChatHeader` with its own
 * action cluster and gates, the production `RunPanel` with its own chrome bar and
 * lineage walk, the real `ResizableDivider` and the real pane wrapper — inside a
 * realistic chat column, because what is photographed has to be the product
 * rather than a reproduction of it. The retired set made the same choice for the
 * popover it photographed, and the reason the composition is spelled out here
 * instead of importing `ChatContent` everywhere is that a pane's STILL is a
 * question about the pane: the two swap stories and the narrow frame do use the
 * real `ChatContent`, because only it can prove the width floors and the swap.
 *
 * ## Before/after pairs
 *
 * Several states owe a pair, and a pair is two stories because the capture rig
 * takes one frame per story per theme:
 *
 * - `roster-capped` / `roster-capped-expanded` — the disclosure before and after.
 * - `swap-canvas-open` / `swap-run-open` — the same slot with each pane.
 * - `mcp-auth-required-closed` / `mcp-auth-required` — the dot, then the list that
 *   clears it.
 * - `todos-phased` is the CONTROL for `todos-implicit-phase`: the two frames
 *   differ only in whether the plan's leading phase is named. The retired
 *   rendering of the implicit-phase defect cannot be re-photographed — the fold
 *   that produced it is deleted — so the pair that exists is (fold) against
 *   (every phase named), and `docs/evidence/chat-run-panel/README.md` says so.
 *
 * Two states are interactive rather than pre-opened, and both click the real
 * control and hold the shutter with `data-capture-pending` — the convention the
 * retired set used and `chat-trace--conversation-reasoning-open` still does,
 * because a frame of the wrong state passes every guard the rig has.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import "../../../../styles/index.css";
import { ResizableDivider } from "@shared/components/common/resizable-divider";
import type { DesktopChildTranscriptPage } from "../../../../../../shared/desktop-session-contract";
import type { Message } from "../../types/message";
import { ChatHeader } from "../chat-header";
import { MessageItem } from "../message-item";
import { TraceGroup, TraceLine } from "../trace";
import {
	type RunDetailsInput,
	deriveMcpServers,
	deriveRunDetails,
} from "./run-detail-model";
import * as fixtures from "./run-details.fixtures";
import { RunPanel } from "./run-panel";

const at = (iso: string) => new Date(iso);

const userMessage: Message = {
	id: "rd-user-1",
	role: "user",
	timestamp: at("2026-03-14T10:21:07Z"),
	execution_type: "user_input",
	conversation_id: "run-panel",
	message:
		"Which customers still owe money this month, and what are the totals? Treat anything not marked paid as outstanding.",
};

const assistantMessage: Message = {
	id: "rd-assistant-1",
	role: "assistant",
	timestamp: at("2026-03-14T10:25:02Z"),
	execution_type: "response",
	task_classification: "continue",
	conversation_id: "run-panel",
	is_complete: true,
	message:
		"Two customers are still outstanding. I am re-checking the pending rows against the ledger before I total them — two of them need a decision.",
};

/**
 * The transcript ground: real messages and real trace lines, quiet enough that
 * the pane stays the subject and dense enough that the frame is a picture of a
 * conversation rather than of a background colour.
 */
const TranscriptGround = () => (
	<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-4 py-5">
		<MessageItem
			message={userMessage}
			conversationId="run-panel"
			isLastMessage={false}
			isTurnStart={true}
			isSmallView={false}
		/>
		<TraceGroup>
			<TraceLine action="READ" filePath="invoices/march.csv" />
			<TraceLine action="CODE" narration="Totalling the unpaid rows" />
		</TraceGroup>
		<MessageItem
			message={assistantMessage}
			conversationId="run-panel"
			isLastMessage={false}
			isTurnStart={true}
			isSmallView={false}
		/>
		<TraceGroup>
			<TraceLine action="EDIT" filePath="reports/unpaid-march.md" />
			<TraceLine
				action="DELEGATE"
				narration="Asking a verifier to re-check the totals"
			/>
		</TraceGroup>
	</div>
);

/**
 * The pane, exactly as `chat-content.tsx` mounts it: a pinned-width wrapper with
 * the `border-l` seam, the shared divider (with its own label), and the real
 * `RunPanel` inside.
 */
const RunPane = ({
	details,
	mcpServers = [],
	childrenOpenable = true,
	readerChildId = null,
	previewPage = null,
	width = 420,
	pulses = {},
}: {
	details: ReturnType<typeof deriveRunDetails>;
	mcpServers?: readonly Record<string, unknown>[];
	childrenOpenable?: boolean;
	readerChildId?: string | null;
	previewPage?: DesktopChildTranscriptPage | null;
	width?: number;
	pulses?: Record<string, number>;
}) => (
	<>
		<ResizableDivider
			sidebarWidth={width}
			onSidebarWidthChange={() => undefined}
			minWidth={320}
			maxWidth={640}
			side="left"
			label="Resize run details"
		/>
		<div
			style={{ minWidth: width, width }}
			className="relative h-full overflow-hidden border-l border-hairline"
		>
			<RunPanel
				details={details}
				mcpServers={deriveMcpServers(mcpServers)}
				sessionId={
					(details.subagents.find((row) => row.childSessionId)
						?.childSessionId as string | undefined) ?? "a1b2c3d4e5f6"
				}
				pulses={pulses}
				childrenOpenable={childrenOpenable}
				paneWidth={width}
				readerChildId={readerChildId}
				previewPage={previewPage}
				onReaderChildChange={() => undefined}
				onClose={() => undefined}
			/>
		</div>
	</>
);

/** The chat column with the real header, optionally with the pane beside it. */
const ChatColumn = ({
	details,
	mcpServers = [],
	childrenOpenable = true,
	openPanel = false,
	readerChildId = null,
	previewPage = null,
	pulses = {},
	width = 420,
}: {
	details: ReturnType<typeof deriveRunDetails>;
	mcpServers?: readonly Record<string, unknown>[];
	childrenOpenable?: boolean;
	openPanel?: boolean;
	readerChildId?: string | null;
	previewPage?: DesktopChildTranscriptPage | null;
	pulses?: Record<string, number>;
	width?: number;
}) => {
	const rows = deriveMcpServers(mcpServers);
	/*
	 * The pane's open state lives in the STORE, not in this prop: the prop decides
	 * whether the pane is drawn, and the store is what the trigger's pressed state,
	 * its label and its dot rule read. A story that drew the pane without setting
	 * the store would photograph a pressed-state-free button over an open pane —
	 * which is a frame of a state the app cannot reach.
	 */
	useEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: openPanel,
			isCanvasOpen: false,
		});
	}, [openPanel]);
	return (
		<div className="flex h-screen overflow-hidden bg-canvas">
			<div className="flex min-w-0 flex-1 flex-col">
				<ChatHeader
					agentName="Core"
					description="Invoices workspace · on this machine"
					onOpenOptions={() => undefined}
					runDetails={details}
					mcpServers={rows}
					listOnScreen={openPanel && readerChildId === null}
					readerChildId={readerChildId}
				/>
				<TranscriptGround />
			</div>
			{/*
			 * The pane is mounted only when the pane shape is being photographed, and
			 * the header still receives `listOnScreen` when it is not: that is what
			 * makes the dot's rule visible in a CLOSED-panel frame.
			 */}
			{openPanel && (
				<RunPane
					details={details}
					mcpServers={mcpServers}
					childrenOpenable={childrenOpenable}
					readerChildId={readerChildId}
					previewPage={previewPage}
					width={width}
					pulses={pulses}
				/>
			)}
		</div>
	);
};

/**
 * The swap's own ground: the real chat column, with the store in the swap state
 * being photographed.
 *
 * **The canvas pane is not drawn in the `canvas-open` frame, and that is a
 * deliberate limit rather than an omission.** `ChatContent`'s canvas branch
 * mounts the real editor against a conversation's document set, and a story that
 * leaves that set unseeded hangs before it paints (`canvas.stories.tsx` supplies
 * the set explicitly for exactly that reason); the canvas pane's own pixels are
 * `canvas-workspace`'s evidence set, not this one's. What this PR changed about
 * the canvas is the TRIGGER's rule — the retired `!isCanvasOpen` gate is gone —
 * so the frame that owes a picture is the chat column with the canvas open and
 * the run trigger present and unpressed, which is what it shows.
 */
const SwapGround = ({
	canvasOpen,
	runOpen,
	input,
	panelWidth = 420,
}: {
	canvasOpen: boolean;
	runOpen: boolean;
	input: RunDetailsInput;
	panelWidth?: number;
}) => {
	const details = deriveRunDetails(input);
	useEffect(() => {
		useUiPreferencesStore.setState({
			isCanvasOpen: canvasOpen,
			isRunPanelOpen: runOpen,
		});
	}, [canvasOpen, runOpen]);
	return (
		<div className="flex h-screen overflow-hidden bg-canvas">
			<div className="flex min-w-0 flex-1 flex-col">
				<ChatHeader
					agentName="Core"
					description="Invoices workspace · on this machine"
					onOpenOptions={() => undefined}
					runDetails={details}
					mcpServers={[]}
					listOnScreen={runOpen}
					readerChildId={null}
				/>
				<TranscriptGround />
			</div>
			{runOpen && <RunPane details={details} width={panelWidth} />}
		</div>
	);
};

/**
 * The canvas is closed in every one of these frames, which is what the trigger's
 * own swap rules require of it. Set explicitly rather than assumed: the
 * preference is persisted, so a viewer who opened the canvas in another story
 * would otherwise find the pane's state missing for a reason nothing on screen
 * explains.
 */
const withCanvasClosed = (Story: () => ReactNode) => {
	useEffect(() => {
		useUiPreferencesStore.setState({ isCanvasOpen: false });
	}, []);
	return <Story />;
};

/**
 * Click a control and hold the shutter until the state it produces is on screen.
 *
 * The poll is on the DOM rather than on a timeout because the state arrives a
 * frame after the click, and a fixed sleep is a race that would only ever be won
 * by luck.
 */
const useClickAndWait = (selector: string, settleSelector: string) => {
	useEffect(() => {
		const button = document.querySelector<HTMLButtonElement>(selector);
		if (!button) return;
		document.documentElement.dataset.capturePending = "1";
		button.click();
		const poll = window.setInterval(() => {
			if (!document.querySelector(settleSelector)) return;
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, [selector, settleSelector]);
};

/**
 * Poll the DOM for the state the previous step was supposed to produce, then run
 * the next step.
 *
 * A frame budget rather than a clock: the state arrives one paint after the step
 * that causes it, and a fixed sleep would be a race that only ever gets won by
 * luck. On exhaustion nothing is released, which leaves `data-capture-pending`
 * set and makes the rig THROW on this story rather than photograph whatever
 * happened to be on screen — a frame of the wrong state is indistinguishable
 * from one of the right state in a directory listing.
 */
/**
 * The trigger's attention dot. It carries a `data-` hook for the same reason the
 * trigger does: a rig that cannot find an element photographs the wrong state,
 * and a frame of a state with no dot is indistinguishable from a frame of the
 * state where the dot rule broke.
 */
const DOT = "[data-run-panel-dot]";

const whenState = (
	present: boolean,
	selector: string,
	done: () => void,
): (() => void) => {
	let frame = 0;
	let cancelled = false;
	const tick = () => {
		if (cancelled) return;
		const found = document.querySelector(selector) !== null;
		if (found === present) {
			done();
			return;
		}
		if (frame++ > 600) return;
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return () => {
		cancelled = true;
	};
};

/**
 * The MCP ledger's whole discipline, against the REAL trigger (§ 3.4, § 7.3).
 *
 * The rule this frame set exists for is `seen' = seen ∩ problems`: a server
 * acknowledged while broken and later repaired must be able to announce itself
 * AGAIN, because the set prunes before it unions. That is a sequence rather than
 * a state, and the ORDER matters more than it looks:
 *
 *   0. closed, one server broken              → dot ON  (unseen problem)
 *   1. the list on screen                     → dot OFF (acknowledged while shown)
 *   2. the same server HEALS while the list is shown → the ledger PRUNES it
 *   3. the panel closes                       → dot OFF (nothing outstanding)
 *   4. it breaks again, panel shut            → dot ON AGAIN (the re-arm)
 *
 * The heal has to happen while the list is ON SCREEN, because that is when the
 * trigger evaluates the ledger — pruning is part of "showing the list", not an
 * event of its own. A sequence that healed while the panel was shut would leave
 * the server in `seen` forever and the re-arm could never be photographed, which
 * is exactly what the first cut of this story did (it timed out, loudly, because
 * the shutter is held until the final state arrives).
 *
 * `stop` chooses which end of it is photographed. Nothing here is simulated: it
 * is the production `ChatHeader` (and therefore the production trigger and its
 * two ledgers) with the same props `chat-page.tsx` passes, and the rows and their
 * words come from the same fixtures the single-state frames use.
 */
const DotAckGround = ({ stop }: { stop: "acknowledged" | "rearmed" }) => {
	const details = useMemo(() => deriveRunDetails(fixtures.bothInFlight()), []);
	const [raw, setRaw] = useState(() => fixtures.mcpAuthRequired());
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState(0);
	// One source for both the header's ledger and the pane's rows, so the panel
	// cannot be showing one state while the dot answers another.
	const rows = useMemo(() => deriveMcpServers(raw), [raw]);

	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		return () => {
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);

	useEffect(() => {
		const release = () =>
			document.documentElement.removeAttribute("data-capture-pending");
		switch (step) {
			case 0:
				// Closed on a broken server: an unseen problem, so the dot is up.
				// The step only advances once the dot is actually on screen.
				return whenState(true, DOT, () => {
					setOpen(true);
					setStep(1);
				});
			case 1:
				// The list is on screen now, so the ledger acknowledges the problem
				// while it is shown. `acknowledged` stops here (with the pane shut
				// again); `rearmed` heals the server WITH the list still shown,
				// which is the only moment the prune can run.
				return whenState(false, DOT, () => {
					if (stop === "acknowledged") {
						setOpen(false);
						setStep(2);
						return;
					}
					setRaw(fixtures.mcpAllConnected());
					setStep(3);
				});
			case 2:
				// Closed, still broken, dot off: the acknowledgement HOLDS.
				return whenState(false, DOT, release);
			case 3:
				// Every row reads `connected` with the list shown, so the ledger
				// prunes the server it had acknowledged.
				return whenState(false, DOT, () => {
					setOpen(false);
					setStep(4);
				});
			case 4:
				return whenState(false, DOT, () => {
					setRaw(fixtures.mcpAuthRequired());
					setStep(5);
				});
			default:
				// Broken again with the panel shut: the dot is BACK, because the
				// ledger no longer holds this server. This is the re-arm.
				return whenState(true, DOT, release);
		}
	}, [step, stop]);

	useEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: open,
			isCanvasOpen: false,
		});
	}, [open]);

	return (
		<div className="flex h-screen overflow-hidden bg-canvas">
			<div className="flex min-w-0 flex-1 flex-col">
				<ChatHeader
					agentName="Core"
					description="Invoices workspace · on this machine"
					onOpenOptions={() => undefined}
					runDetails={details}
					mcpServers={rows}
					listOnScreen={open}
					readerChildId={null}
				/>
				<TranscriptGround />
			</div>
			{open && <RunPane details={details} mcpServers={raw} />}
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Run panel",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/* ------------------------------------------------------------------ */
/* The trigger, and an empty panel                                     */
/* ------------------------------------------------------------------ */

/**
 * The icon on screen with NOTHING in flight and nothing open.
 *
 * The old design's "no button" state, inverted: its trigger was gated on
 * `hasRunDetails`, so this was the frame in which the surface did not exist.
 */
export const TriggerIdle: Story = {
	render: () => <ChatColumn details={deriveRunDetails(fixtures.idle())} />,
	decorators: [withCanvasClosed],
};

/**
 * The panel open with nothing to show: one quiet line, no skeleton and no
 * placeholder rows. Unreachable through the retired popover, whose trigger did
 * not exist on a session with no work.
 */
export const PanelEmpty: Story = {
	render: () => (
		<ChatColumn details={deriveRunDetails(fixtures.idle())} openPanel={true} />
	),
	decorators: [withCanvasClosed],
};

/** A finished run: the roster is history and the plan contributes no open work. */
export const SettledHistory: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.settledHistory())}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/* ------------------------------------------------------------------ */
/* The roster and the plan                                             */
/* ------------------------------------------------------------------ */

export const RosterOnly: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.subagentsOnly())}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

export const TodosOnly: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.todosFlat())}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

export const BothInFlight: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/** Nine children: the roster's disclosure, closed. */
export const RosterCapped: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.crowded())}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The same roster AFTER its disclosure is used.
 *
 * The click is real: `+N more` is a control now, so this frame proves every child
 * is reachable rather than that a cap exists.
 */
export const RosterCappedExpanded: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.crowded())}
			openPanel={true}
		/>
	),
	decorators: [
		withCanvasClosed,
		(Story) => {
			/*
			 * The disclosure is clicked, and the shutter is held until it has gone
			 * from the DOM — which is the state being photographed, not the click.
			 */
			useClickAndWait(
				"[data-run-panel-disclosure]",
				"body:not(:has([data-run-panel-disclosure]))",
			);
			return <Story />;
		},
	],
};

/** Phases as headers, items indented, done struck, blocked with its reason. */
export const TodosPhased: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.todosOnly())}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * § 6.2's finding (2): an implicit phase beside a named one.
 *
 * The control is `todos-phased`, where every phase is named; this frame is the
 * one where the implicit half renders headerless and its items join the list.
 */
export const TodosImplicitPhase: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.mixedImplicitPhase())}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/* ------------------------------------------------------------------ */
/* The swap, in both directions                                        */
/* ------------------------------------------------------------------ */

/**
 * The slot with the CANVAS in it: the canvas button present and UNPRESSED, the run
 * trigger unpressed beside it, and no run pane anywhere.
 *
 * The claim is deliberately narrower than "the canvas button pressed": that
 * button has no pressed rendering at all (`chat-header.tsx` hides it whenever
 * the canvas is open), so no frame could contain one. What this PR changed about
 * the canvas is the run TRIGGER's rule — the retired `!isCanvasOpen` gate is gone
 * — and that is what the pair shows: the trigger present with the canvas open,
 * then the run pane holding the slot alone.
 */
export const SwapCanvasOpen: Story = {
	render: () => (
		<SwapGround
			canvasOpen={true}
			input={fixtures.bothInFlight()}
			runOpen={false}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * And the mirror: the run trigger pressed with the run pane open, the canvas
 * gone. Exactly one pane in each frame is the claim.
 */
export const SwapRunOpen: Story = {
	render: () => (
		<SwapGround
			canvasOpen={false}
			input={fixtures.bothInFlight()}
			runOpen={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/* ------------------------------------------------------------------ */
/* The reader                                                          */
/* ------------------------------------------------------------------ */

/** A running child's reader, on a fixture page. */
export const ReaderLive: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [fixtures.readerChild()],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-reader"
			previewPage={fixtures.childPage({ includeTool: true })}
			pulses={{ "job-reader": 4 }}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The same child settled: the outcome block carries the final text, the settled
 * clock, and no pulse.
 */
export const ReaderSettled: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [
					fixtures.readerChild({
						status: "done",
						settledSecondsAgo: 12,
						progress: undefined,
						result:
							"Four of 412 March invoices are unpaid: Northwind (2), Contoso (1) and Fabrikam (1). Totals: $18,420 outstanding across the four, against $1,204,880 invoiced.",
					}),
				],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-reader"
			previewPage={fixtures.childPage()}
		/>
	),
	decorators: [withCanvasClosed],
};

/** A failure: the verbatim exception in the outcome block, `danger` on the icon. */
export const ReaderFailed: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [
					fixtures.readerChild({
						status: "failed",
						settledSecondsAgo: 8,
						progress: undefined,
						error:
							"FileNotFoundError: [Errno 2] No such file or directory: 'ledger/q1.csv'\n  raised while reading the ledger export",
					}),
				],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-reader"
			previewPage={fixtures.childPage({ includeTool: true })}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * A grandchild's reader: the breadcrumb carries two levels and the chrome bar
 * grows a back control. A reader replaces the pane's body wholesale, so this is
 * also the frame that shows the roster is not on screen behind it.
 */
export const ReaderNested: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [
					fixtures.readerChild(),
					{
						...fixtures.readerChild({
							id: "job-grandchild",
							label: "Verify the totals",
						}),
						parent_job_id: "job-reader",
						session_id: "fedcba987654",
						launch_message_id: "",
						launch_prompts: {},
					},
				],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-grandchild"
			previewPage={fixtures.childPage({ includeTool: true })}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * § 10.1's `pending`: the child has a directory and no transcript yet.
 *
 * The copy that document fixes, and the state that breaks nothing else: the body
 * states the fact in one quiet line and the reader re-probes on the next pulse
 * rather than treating it as final.
 */
export const ReaderPending: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [fixtures.readerChild()],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-reader"
			previewPage={fixtures.childPage({ state: "pending" })}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * § 10.1's `gone`: the child's transcript is no longer on disk.
 *
 * The other absence, and the terminal one — the line says so rather than offering
 * a retry that cannot succeed.
 */
export const ReaderGone: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [fixtures.readerChild()],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-reader"
			previewPage={fixtures.childPage({ state: "gone" })}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The brief, and the case that makes it render: a child whose transcript does NOT
 * already carry its instruction.
 *
 * The ordinary reader reconciles the durable launch row to the concise prompt, so
 * the instruction is on the page already and the brief block would be the same
 * sentence twice (`reader-resumed` is that frame). Here the launch row is absent —
 * a record that predates `launch_message_id`, which is the case
 * `reconcileLaunchTurns` documents — so the brief is the only copy, folded to six
 * of its nine lines with the remaining three stated on the control.
 */
export const ReaderBrief: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [fixtures.readerChild()],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-reader"
			previewPage={fixtures.childPage()}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The row the wire left unaddressable: `session_id` is null, so there is no
 * conversation to address.
 *
 * This is the reader's own terminal state for that case — the roster does not
 * offer the row as a control at all (`childOpenable`), but the breadcrumb and the
 * sibling stepper walk the wire's lineage and can land on it, so the page says
 * what is true instead of sitting on a load that was never issued. Before the fix
 * it sat on `Loading…` for as long as it was open.
 */
export const ReaderUnaddressed: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [fixtures.readerChild({ sessionId: null })],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-reader"
		/>
	),
	decorators: [withCanvasClosed],
};

/** A RESUMED child: the durable launch turn reconciled to its concise prompt. */
export const ReaderResumed: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [fixtures.readerChild()],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-reader"
			previewPage={fixtures.childPage({ launchTurn: true })}
		/>
	),
	decorators: [withCanvasClosed],
};

/* ------------------------------------------------------------------ */
/* MCP servers                                                         */
/* ------------------------------------------------------------------ */

export const McpAllConnected: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAllConnected()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/** The dot with the panel SHUT: nothing has been looked at yet. */
export const McpAuthRequiredClosed: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAuthRequired()}
		/>
	),
	decorators: [withCanvasClosed],
};

/** The same session with the panel OPEN on the list: the dot is cleared. */
export const McpAuthRequired: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAuthRequired()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The ledger's step 2: the panel SHUT again with the server still broken and the
 * dot OFF.
 *
 * This is the frame a still can carry for "acknowledged": `mcp-auth-required`
 * proves the dot clears while the list is on screen, and this proves it STAYS
 * clear once the pane closes — which is the half a careless implementation gets
 * wrong by re-deriving "unseen" from the rows on every render.
 */
export const McpDotAckAcknowledged: Story = {
	render: () => <DotAckGround stop="acknowledged" />,
};

/**
 * The ledger's steps 3-4: the same server heals, is pruned from the ledger, and
 * breaks again while the panel is shut — and the dot is ON again.
 *
 * `seen' = seen ∩ problems` is the rule; without the prune this event would be
 * permanently silent, which is the failure it was written to prevent (a server
 * that broke, was seen, recovered and broke again would never announce itself).
 * See `DotAckGround` for the sequence it runs to get here.
 */
export const McpDotAck: Story = {
	render: () => <DotAckGround stop="rearmed" />,
};

/** The transport state beside the auth state: two words, two remedies. */
export const McpDisconnected: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpDisconnected()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/** A word this build was not taught: verbatim, quiet, and still taking attention. */
export const McpUnknownStatus: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpUnknownStatus()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/** The cold payload: one line in place of the tally, no per-row word, no dot. */
export const McpCold: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.idle())}
			mcpServers={fixtures.mcpCold()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/** A server coming up is not a problem: no dot, and a word that says so. */
export const McpConnecting: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpConnecting()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/* ------------------------------------------------------------------ */
/* The floor, the gate and motion                                      */
/* ------------------------------------------------------------------ */

/**
 * The window floor: 800px, the panel at its 320px minimum, the chat column at
 * its own floor.
 *
 * Captured through the real `ChatContent`, because the widths are a claim about
 * the two panes' floors rather than about either one.
 */
export const Narrow800: Story = {
	render: () => (
		<SwapGround
			canvasOpen={false}
			runOpen={true}
			input={fixtures.crowded()}
			/* The panel's own floor, which is the number this frame exists for. */
			panelWidth={320}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * An older backend: the one degraded state, with BOTH gated surfaces in it.
 *
 * The reader's rows are visible and deliberately not openable — no hover ground,
 * no pointer, no button — with the panel's one update line naming the situation;
 * and there is no MCP section at all beside them, because a backend without the
 * `mcp` capability issues no read and a second near-identical line for the second
 * capability is the chrome that rule refuses.
 */
export const CapabilityAbsent: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.subagentsOnly())}
			childrenOpenable={false}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * Reduced motion, for the pane's two animated glyphs: the running child's
 * spinner and the MCP `connecting` mark.
 *
 * Captured with `--reduced-motion`, which sets the CDP media feature rather than
 * restyling the story — the app's own cap is a `prefers-reduced-motion` block in
 * `styles/index.css`, and a frame that faked the state would be evidence about
 * the fake.
 */
export const ReducedMotion: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpConnecting()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};
