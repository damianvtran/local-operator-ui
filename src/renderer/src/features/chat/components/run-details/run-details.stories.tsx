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
import { type ReactNode, useEffect } from "react";
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
			details={deriveRunDetails(fixtures.todosOnly())}
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
 * The slot with the CANVAS in it: the canvas button pressed, the run trigger
 * unpressed and present, and no run pane anywhere.
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

/** The same child settled: outcome block, settled clock, no pulse. */
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
