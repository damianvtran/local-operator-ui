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
import { McpKeyDialog } from "./mcp-key-dialog";
import {
	type RunDetailsInput,
	deriveMcpServers,
	deriveRunDetails,
} from "./run-detail-model";
import { mcpGrantInFlight } from "./run-detail-model";
import * as fixtures from "./run-details.fixtures";
import { RunPanel } from "./run-panel";
import type { McpRemedyControls } from "./use-mcp-remedy";

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
 * The pane's remedy controls, as the app passes them.
 *
 * A still cannot carry a press, so every photographed story leaves these as
 * no-ops — EXCEPT where the frame is about the control's own state, and there the
 * state comes from the FIXTURE's `operations` rather than from a handler: the
 * row's grant line is derived from the read, which is exactly the property those
 * frames exist to show. `presses` is recorded so a play can assert that the
 * confirm ran the operation rather than only opening.
 */
const presses: string[] = [];
const mcpRemedy = (
	overrides: Partial<McpRemedyControls> = {},
): McpRemedyControls => ({
	press: (row) => presses.push(row.name),
	pressKey: async (row, values) => {
		presses.push(`${row.name}:${Object.keys(values).sort().join(",")}`);
		return true;
	},
	cancel: (operationId) => presses.push(`cancel:${operationId}`),
	reload: async (row) => {
		presses.push(`reload:${row.name}`);
		return true;
	},
	pendingName: null,
	failureFor: () => null,
	clearFailure: () => undefined,
	refusalFor: () => null,
	...overrides,
});

/**
 * The pane, exactly as `chat-content.tsx` mounts it: a pinned-width wrapper with
 * the `border-l` seam, the shared divider (with its own label), and the real
 * `RunPanel` inside.
 */
const RunPane = ({
	details,
	mcpServers = [],
	mcpErrors = {},
	mcpOperations = [],
	remedy = mcpRemedy(),
	childrenOpenable = true,
	readerChildId = null,
	previewPage = null,
	width = 420,
	pulses = {},
	onReaderChildChange = () => undefined,
	onClose = () => undefined,
}: {
	details: ReturnType<typeof deriveRunDetails>;
	mcpServers?: readonly Record<string, unknown>[];
	mcpErrors?: Readonly<Record<string, string>>;
	/** The read's own `operations`, which is where a row's grant state comes from. */
	mcpOperations?: readonly Record<string, unknown>[];
	remedy?: McpRemedyControls;
	childrenOpenable?: boolean;
	readerChildId?: string | null;
	previewPage?: DesktopChildTranscriptPage | null;
	width?: number;
	pulses?: Record<string, number>;
	/**
	 * Real callbacks, for the one harness story that walks the keys. Every
	 * photographed story leaves them as no-ops: a still cannot carry a key press,
	 * so a frame proves nothing either way about the ladder.
	 */
	onReaderChildChange?: (id: string | null) => void;
	onClose?: () => void;
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
				mcpServers={deriveMcpServers(mcpServers, mcpErrors, mcpOperations)}
				mcpGrantRunning={mcpGrantInFlight(mcpOperations)}
				mcpRemedy={remedy}
				sessionId={
					(details.subagents.find((row) => row.childSessionId)
						?.childSessionId as string | undefined) ?? "a1b2c3d4e5f6"
				}
				pulses={pulses}
				childrenOpenable={childrenOpenable}
				paneWidth={width}
				readerChildId={readerChildId}
				previewPage={previewPage}
				onReaderChildChange={onReaderChildChange}
				onClose={onClose}
			/>
		</div>
	</>
);

/** The chat column with the real header, optionally with the pane beside it. */
const ChatColumn = ({
	details,
	mcpServers = [],
	mcpErrors = {},
	mcpOperations = [],
	remedy = mcpRemedy(),
	childrenOpenable = true,
	openPanel = false,
	readerChildId = null,
	previewPage = null,
	pulses = {},
	width = 420,
}: {
	details: ReturnType<typeof deriveRunDetails>;
	mcpServers?: readonly Record<string, unknown>[];
	/**
	 * The canonical projection's failure text per server, which is the only place
	 * the runtime states WHY one is down (`McpServerRow.errorText`; round 1,
	 * U1-8). Optional, like the field itself: a story that supplies none frames
	 * the remedy line.
	 */
	mcpErrors?: Readonly<Record<string, string>>;
	/** The read's own `operations`, which is where a row's grant state comes from. */
	mcpOperations?: readonly Record<string, unknown>[];
	remedy?: McpRemedyControls;
	childrenOpenable?: boolean;
	openPanel?: boolean;
	readerChildId?: string | null;
	previewPage?: DesktopChildTranscriptPage | null;
	pulses?: Record<string, number>;
	width?: number;
}) => {
	const rows = deriveMcpServers(mcpServers, mcpErrors, mcpOperations);
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
					mcpErrors={mcpErrors}
					mcpOperations={mcpOperations}
					remedy={remedy}
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

/*
 * A real, tiny PNG (72x44, 425 bytes) for the child-scoped attachment story.
 *
 * Deliberately NOT a `data:` URI in the fixture page: the claim this frame has to
 * carry is that the READER resolves a durable digest through the child-scoped
 * relay, and an inline image would bypass the relay entirely and prove nothing
 * about it. Real bytes also mean the picture is a picture rather than a solid
 * swatch, so a reader can tell "the image rendered" from "the box rendered".
 */
const CHILD_IMAGE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAEgAAAAsCAIAAABJ6mlcAAABcElEQVR42sWZwW3DMBRD3zwdoFNljJ47VYcpkEtHaAoHQlDb0rdlksC/RSD0HIjgB/m+/wzn7fNjma/b++Y8fqrotMPraVJ1nc1rtKFOtQc2T9WUi195SPU4xiTV0W8sonpVXk5SpNpTnKdalOsvokLVA7ucqvN3TVI15dfzVKg2FS+hKr7P4SNf6+Ch2gPTeTJDqrVihOqoJ2Og2gS7hKpzH/pU/xRTVCfci3YbEdVa2UD1BBsGgizVOffCmd9sVE8wW347QXXavXDmNxvVH5gzvx2lmnEvnPmtc5vLPRlnfjtENeleOPObc6fGmd+cOzXO/ObcqTEnHdtOTZBKulNjTjq2nZoUlXqnxpx0bDs1ESrDTo0zvzl3apz5zblT48xvzp2abCei82SynYjOk8l2IjpPJtuJ6DyZbCei82SynYjOk8l2IjpPJtuJ6DyZbCei82SynYjOk8l2IjpPJtuJ6DyZbCei82SynYjOk38Bx1I58CGSeMgAAAAASUVORK5CYII=";

const CHILD_IMAGE_PNG_BYTES = Uint8Array.from(
	atob(CHILD_IMAGE_PNG_BASE64),
	(character) => character.charCodeAt(0),
);

/**
 * Answer the reader's child-scoped attachment fetch with real bytes.
 *
 * WHY A STUB IS THE HONEST INSTRUMENT HERE. A Storybook frame has no backend, so
 * a durable digest can only ever render the unavailable note — which is exactly
 * what the set used to show and what R2-1 was about. The relay is the seam the
 * renderer owns: `useAttachmentUrl` builds the op and main owns the URL, so
 * answering that op with bytes proves the RENDERER's half (the scope reaches
 * `desktopMedia`, the op is the child-scoped one, the bytes paint) and says
 * nothing about the backend route, whose mapping is pinned in
 * `scripts/desktop-contract.test.mjs` and exercised against a running server by
 * the QA round.
 *
 * It answers ONLY the fixture's digest and op; anything else gets a 404, so a
 * scope regression shows up as the unavailable note in the frame rather than as
 * a picture borrowed from a stub that answered everything.
 *
 * Installed during the decorator's RENDER rather than in an effect, and that is
 * load-bearing: React runs a child's effects before its parent's, so an effect
 * here would land after the reader's own fetch had already gone out. Each
 * captured frame is a fresh document, so the stub does not outlive it.
 */
const installChildImageRelay = () => {
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	const api = (window as any).api ?? {};
	api.desktop = {
		...api.desktop,
		media: async (request: { op?: string; digest?: string }) =>
			request.op === "subagents.attachment" &&
			request.digest === "0f1e2d3c4b5a69788796a5b4c3d2e1f0"
				? {
						status: 200,
						kind: "bytes",
						mimeType: "image/png",
						data: CHILD_IMAGE_PNG_BYTES,
					}
				: { status: 404, kind: "error", detail: "Not in this story." },
	};
	// biome-ignore lint/suspicious/noExplicitAny: the preload bridge is a mock here.
	(window as any).api = api;
};

/**
 * Hold the shutter until the story's picture has DECODED.
 *
 * `ImageAttachment` keeps the frame reserved and `opacity-0` until the image
 * decodes, so a frame taken between mount and decode is an empty box — the same
 * failure mode as Storybook's own spinner, and just as indistinguishable from a
 * real frame in a directory listing. On exhaustion nothing is released, which
 * makes the rig throw on this story rather than photograph the wrong state
 * (`useClickAndWait`'s rule).
 */
const useWaitForPaintedImage = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		const poll = window.setInterval(() => {
			/* The attachment's own blob URL, not "any image on the page": the header
			   carries glyphs too, and waiting on the first `img` would release the
			   shutter without the attachment having decoded at all. */
			const image = [
				...document.querySelectorAll<HTMLImageElement>("img"),
			].find((element) => element.src.startsWith("blob:"));
			if (!image || !image.complete || image.naturalWidth === 0) return;
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		}, 40);
		return () => {
			window.clearInterval(poll);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
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
 * The trigger's two HOVER grounds (design review round 2, D2-1).
 *
 * A pointer cannot be photographed from a story, so the rig dispatches a real
 * `Input.dispatchMouseEvent` at `[data-run-panel-trigger]` before the shutter
 * (`capture-evidence.mjs`'s tuple option, the same CDP the scroll-paging
 * harness uses). The pair either side of these two is `trigger-idle` (closed at
 * rest) and `panel-empty` (open at rest), so the four states are four frames:
 * `canvas` / `elevated` / `accent-wash` / `accent-wash`.
 *
 * The OPEN one is the frame the round was about: before the fix, hovering the
 * already-open trigger replaced its pressed ground with the hover ground, and
 * this frame is the proof that the wash survives the pointer.
 */
export const TriggerHover: Story = {
	render: () => <ChatColumn details={deriveRunDetails(fixtures.idle())} />,
	decorators: [withCanvasClosed],
};

export const TriggerOpenHover: Story = {
	render: () => (
		<ChatColumn details={deriveRunDetails(fixtures.idle())} openPanel={true} />
	),
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

/**
 * The roster's MEMBERSHIP, on the wire that produces the question (`§ 4`).
 *
 * The payload carries five rows and only two of them are roster members: a
 * running child's OWN `bash` job and the root session's own `bash` job (both
 * `type: "bash"` — the only word the wire has for a tool row — with `agent_role`
 * null and `session_id` null), and a `task` row
 * whose `parent_job_id` is a child on the same list — a grandchild. The frame
 * must show exactly the two members, tally them as the only work in flight, and
 * carry no row for the tool calls or for the grandchild, which belongs to
 * `job-audit`'s own `1 child` control (`reader-child-controls` is that half).
 *
 * Why this story exists rather than a real-child frame: the defect (round 1,
 * Q1/U1-4/Q2) is a DERIVATION rule, and a fixture can put the three shapes on
 * one list at once — the live run could only produce the tool rows while the
 * parent turn was streaming, and the nested row at all only from a real nested
 * delegation.
 */
export const RosterMembers: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.rosterMembers())}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The pane with REAL callbacks and real state, for a keyboard walk. Deliberately
 * NOT a frame, and deliberately not in `scripts/capture-evidence.mjs`'s STORIES.
 *
 * Every photographed story leaves `onReaderChildChange` and `onClose` as no-ops,
 * because a still cannot carry a key press: a frame is identical whether or not
 * Back pops a level, and whether or not focus landed anywhere. The rules round 1
 * settled are keyboard-visible ONLY — focus entering a reader as it opens,
 * `Escape` fired from the TRIGGER (which lives outside the pane), Back popping
 * one level and leaving the pane at the first — so what they need is a pane whose
 * callbacks move real state, and a driver that presses the keys. This is that
 * pane: the same `RunPanel`, mounted the way `chat-content.tsx` mounts it, with
 * `readerChildId` and the store's open flag as state.
 *
 * A photograph of it would be a picture of the harness (whatever the walk last
 * pressed), so it contributes no frame and is absent from the sweep on purpose.
 */
const InteractiveGround = () => {
	/*
	 * The pane's open state is the STORE's, exactly as `chat-content.tsx` keeps
	 * it, and not local state: the trigger toggles that flag directly, and a
	 * harness that owned a second copy would photograph a pane that stayed open
	 * while the store said closed — the one thing a keyboard walk must not be
	 * confused by, since closing the pane is half of what it presses keys at.
	 */
	const open = useUiPreferencesStore((state) => state.isRunPanelOpen);
	const setRunPanelOpen = useUiPreferencesStore(
		(state) => state.setRunPanelOpen,
	);
	const [readerChildId, setReaderChildId] = useState<string | null>(null);
	const details = useMemo(() => deriveRunDetails(fixtures.rosterMembers()), []);
	const page = useMemo(() => fixtures.childPage({ includeTool: true }), []);
	useEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: true,
			isCanvasOpen: false,
		});
	}, []);
	// The pane's reader belongs to one session's lineage: closing the pane drops
	// it, which is `chat-content.tsx`'s own rule.
	useEffect(() => {
		if (!open) setReaderChildId(null);
	}, [open]);
	return (
		<div className="flex h-screen overflow-hidden bg-canvas">
			<div className="flex min-w-0 flex-1 flex-col">
				<ChatHeader
					agentName="Core"
					description="Invoices workspace · on this machine"
					onOpenOptions={() => undefined}
					runDetails={details}
					mcpServers={[]}
					listOnScreen={open && readerChildId === null}
					readerChildId={readerChildId}
				/>
				<TranscriptGround />
			</div>
			{open && (
				<RunPane
					details={details}
					readerChildId={readerChildId}
					previewPage={page}
					onReaderChildChange={setReaderChildId}
					onClose={() => setRunPanelOpen(false)}
				/>
			)}
		</div>
	);
};

export const InteractivePane: Story = {
	render: () => <InteractiveGround />,
};

/**
 * The same pane with a page that arrives LATE, and a control outside it that the
 * operator could be using meanwhile. Round 3's R3-4 is a claim about who owns the
 * caret when that page lands — a claim no still can carry and no fixture can hold
 * in one frame — so the state is driven here and read by a driver: the story
 * opens on the child's `pending` line and swaps in a readable page after a beat,
 * which leaves a window for a driver to put focus on the stand-in composer
 * outside the pane and check that the arrival leaves it there. Not in STORIES.
 */
const LatePageGround = () => {
	const [page, setPage] = useState(() =>
		fixtures.childPage({ state: "pending" }),
	);
	const details = useMemo(() => deriveRunDetails(fixtures.rosterMembers()), []);
	useEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: true,
			isCanvasOpen: false,
		});
		/*
		 * 2.5 s: long enough for a driver to take focus deliberately, short enough
		 * that the walk is not waiting on the clock.
		 */
		const timer = setTimeout(
			() => setPage(fixtures.childPage({ includeTool: true })),
			2500,
		);
		return () => clearTimeout(timer);
	}, []);
	return (
		<div className="flex h-screen overflow-hidden bg-canvas">
			<div className="flex min-w-0 flex-1 flex-col">
				<ChatHeader
					agentName="Core"
					description="Invoices workspace · on this machine"
					onOpenOptions={() => undefined}
					runDetails={details}
					mcpServers={[]}
					listOnScreen={false}
					readerChildId="job-audit"
				/>
				{/* The one thing the story adds: somewhere else to be typing. */}
				<button
					type="button"
					data-harness-composer=""
					className="w-40 text-left text-ink-muted"
				>
					Composer stand-in
				</button>
				<TranscriptGround />
			</div>
			<RunPane details={details} readerChildId="job-audit" previewPage={page} />
		</div>
	);
};

export const InteractiveLatePage: Story = {
	render: () => <LatePageGround />,
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
/**
 * The unnamed group AFTER a named phase, which is the shape `§ 6.2`'s fold has
 * to be honest about: the plan's own boundary is the rule above the group, since
 * the group has no name to carry one (round 1, Q9/U1-5).
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
		<SwapGround canvasOpen={true} input={fixtures.swapSlot()} runOpen={false} />
	),
	decorators: [withCanvasClosed],
};

/**
 * And the mirror: the run trigger pressed with the run pane open, the canvas
 * gone. Exactly one pane in each frame is the claim.
 */
export const SwapRunOpen: Story = {
	render: () => (
		<SwapGround canvasOpen={false} input={fixtures.swapSlot()} runOpen={true} />
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
 * A member's own page, with the controls its CHILDREN put in the chrome bar
 * (`§ 5.5`; round 1, Q2/Q8/U1-6).
 *
 * The roster is `fixtures.rosterMembers()`, so `job-audit` has one child on the
 * wire — the grandchild the roster deliberately does NOT list — and this is the
 * frame that shows it is reachable rather than lost: the header carries the
 * `1 child` control, whose accessible name says the action (`Open 1 child
 * subagent`), and the two steppers flank it because this child has one peer.
 *
 * The singular is the point of the frame. The control's label used to be
 * hard-coded `1 children` with no name at all (`run-panel.tsx:437`), which is a
 * state only a one-child lineage can produce — every other frame in this set
 * shows a child with no children, where the control is absent.
 */
export const ReaderChildControls: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.rosterMembers())}
			openPanel={true}
			readerChildId="job-audit"
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
 * § 10.1's `gone`: the child's session DIRECTORY is no longer on disk.
 *
 * The other absence, and the terminal one — the line says so rather than offering
 * a retry that cannot succeed. `pending` above is the transcript FILE missing;
 * only a missing directory is final, because a file that has been moved aside
 * leaves the same two facts on disk as one that was never written (round 1,
 * Q10).
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
 * of its eight lines with the remaining two stated on the control.
 */
export const ReaderBrief: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [
					{
						...fixtures.readerChild(),
						/*
						 * The launch map is EMPTY and `launch_message_id` is blank, which is
						 * the record that predates the field — so the brief falls back to the
						 * child's own `prompt`, and that prompt is the multi-line one. Both
						 * halves matter: with the map carrying the concise prompt (what
						 * `readerChild()` sets) `row.brief` is a single line, `foldBrief`
						 * withholds nothing, and `BriefBlock`'s expander — gated on
						 * `folded.hidden > 0` — never renders. The frame the design record
						 * cites as "the folded brief and its expander" then photographed a
						 * brief with neither (review round 2, R2-4).
						 */
						launch_message_id: "",
						launch_prompts: {},
					},
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

/**
 * The row the wire left unaddressable: `session_id` is null, so there is no
 * conversation to address.
 *
 * The fixture is the shape that actually produces it — a COLD conversation's
 * restored row (`§ 10.1`): the durable graph's own status word and no session
 * id at all, because `restored_job_row` copies neither `session_id` nor
 * `session_dir` (`session/restored_rows.py:136-190`). The first cut of this
 * story paired the null id with a RUNNING child, a combination the wire is not
 * documented to produce (review round 2, R2-2), which made the copy's wrong
 * cause look plausible.
 *
 * The copy states the fact rather than a cause for the same reason: on this
 * shape the child usually DOES have a conversation on disk, so "the run has not
 * given it a session yet" was wrong in the ordinary case.
 */
export const ReaderUnaddressed: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [
					fixtures.readerChild({
						sessionId: null,
						status: "paused",
						progress: undefined,
						startedSecondsAgo: undefined,
					}),
				],
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

/**
 * A child whose transcript carries a PICTURE.
 *
 * The frame R2-1 asked for: before the attachment wiring, every image in a
 * child's page rendered the unavailable note, because the only route the renderer
 * knew was the parent's and it refuses a child's digests. Here the reader hands
 * `CanonicalTranscript` an `attachmentScope` naming the child, the row's digest is
 * fetched over `subagents.attachment`, and the picture paints.
 *
 * The relay is stubbed in-story (see `installChildImageRelay`) because Storybook
 * has no backend: what this frame proves is the renderer's half — the op, the
 * scope, and the painted result — while the route's own mapping is pinned in
 * `scripts/desktop-contract.test.mjs`. The README says which is which rather than
 * letting the picture imply the whole path.
 */
export const ReaderImage: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails({
				nowMs: fixtures.FIXTURE_NOW_MS,
				jobs: [fixtures.readerChild()],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-reader"
			previewPage={fixtures.childPage({ includeImage: true })}
		/>
	),
	decorators: [
		withCanvasClosed,
		(Story) => {
			installChildImageRelay();
			useWaitForPaintedImage();
			return <Story />;
		},
	],
};

/**
 * A lineage of DEPTH 3 at the pane's 320px floor.
 *
 * Review round 2 left this open: the ancestors are capped at `max-w-32` each
 * (`§5.2`), so a lineage deep enough can consume the whole 40px chrome bar and
 * leave the current node — the reader's title — at no width at all, and
 * `reader-nested` only proves depth 2. The fix (ancestors allowed to shrink, a
 * width floor on the current node) needs a picture at the depth it is for, not a
 * claim about flex: this is the frame.
 */
export const ReaderDeepFloor: Story = {
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
					{
						...fixtures.readerChild({
							id: "job-great-grandchild",
							label: "Check the March totals against the ledger",
						}),
						parent_job_id: "job-grandchild",
						session_id: "0123456789ab",
						launch_message_id: "",
						launch_prompts: {},
					},
				],
				todos: [],
			})}
			openPanel={true}
			readerChildId="job-great-grandchild"
			previewPage={fixtures.childPage({ includeTool: true })}
			/* The pane's own floor, which is the width the risk is about. */
			width={320}
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

/** The transport state beside the auth state, with its own remedy. */
export const McpDisconnected: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpDisconnected()}
			/*
			 * The canonical projection's own failure text for this server, which is
			 * the only place the runtime says WHY it is down: `mcp.list` carries
			 * status, tool count and config and no reason at all (`§ 7.2`; round 1,
			 * U1-8). QA's dead command produced exactly this string, and the row
			 * offered `Reconnect this server in Settings` — a remedy that cannot fix
			 * a command that does not exist.
			 */
			mcpErrors={{
				playwright:
					"[Errno 2] No such file or directory: '/nonexistent/definitely-not-a-binary'",
			}}
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

/**
 * The grant is under way: the row says what it is waiting on, and offers the one
 * thing this surface can usefully do while it waits.
 *
 * The state comes from the FIXTURE's `operations`, not from a handler, and that
 * is the property this frame exists to carry: the row is derived from the read the
 * panel already polls, so a grant started in the TUI or another conversation
 * renders here too. `Waiting for your browser` is a statement rather than a
 * spinner because the runtime opens the browser itself.
 */
export const McpGrantRunning: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAuthRequired()}
			mcpOperations={fixtures.mcpGrantRunning()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/** The grant came back failed: the row states it and offers the retry. */
export const McpGrantFailed: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAuthRequired()}
			mcpOperations={fixtures.mcpGrantFailed()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * Cancelled, and the credential went with it.
 *
 * The one copy in this change worth a frame of its own: `credential_removed` is
 * the only thing that distinguishes "cancelled, try again" from "cancelled, and
 * your credential is gone" (`grants.py:168-175`), and getting it wrong sends the
 * reader to a server that cannot connect.
 */
export const McpGrantCancelledRemoved: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAuthRequired()}
			mcpOperations={fixtures.mcpGrantCancelledRemoved()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * One grant per session, so the OTHER problem row's control is disabled.
 *
 * Colour, not opacity (`branding.md` § 6). The lock is derived from the read's own
 * `operations`, which is why a grant started elsewhere disables these controls too
 * — the alternative is a live control whose every press refuses with the opaque
 * 409 of `§ 3.3-2`.
 */
export const McpGrantLocked: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpTwoProblems()}
			mcpOperations={fixtures.mcpGrantRunning()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The grant confirmation, reached by pressing the row's own grant link.
 *
 * Interactive rather than pre-opened, and the shutter is held with
 * `data-capture-pending` until the dialog is on screen: a frame of a modal the
 * story opened by hand would be a frame of a state the app reaches by a
 * different route.
 *
 * **The confirmation is the SHARED flow as of the integration round**
 * (`mcp-auth-dialog.tsx`), not a modal this section owns. That is the point of
 * the change rather than a detail of it: the button that reaches this state is
 * the row's own control, and the decision about WHICH transition to start is
 * made by one owner that re-probes the named server, so a stale derived remedy
 * can no longer start a browser grant for a server whose answer is a key
 * (review R2-6). The frame therefore shows that flow's own confirmation step —
 * the same one `/mcp reauth <name>` and Settings open — and the grant facts it
 * states (the browser opens; a stored credential is replaced) are the reasons
 * it still confirms at all.
 */
const GrantConfirmGround = () => {
	useClickAndWait('[data-mcp-remedy="grant"]', '[role="dialog"]');
	/*
	 * The dialog resolves the transition from a live `probe`, so this story needs
	 * the desktop bridge the capture environment provides — the same requirement
	 * its sibling frames already have. In Storybook without a backend the dialog
	 * honestly shows its "could not check this server" state, which is itself a
	 * state worth seeing rather than one to fake.
	 */
	return (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAuthRequired()}
			openPanel={true}
		/>
	);
};

export const McpGrantConfirm: Story = {
	render: () => <GrantConfirmGround />,
	decorators: [withCanvasClosed],
};

/**
 * The key remedy: three rows, one per decision the payload makes.
 *
 * `google-workspace` (stdio, `env` name) and `slack` (http, header name, OAuth
 * refused) both offer `Enter API key`; `legacy-stdio` declares nothing and keeps
 * the sentence naming the surface that owns its configuration. The grant is not
 * offered on ANY of them, which is the decision this frame carries: a transport
 * that cannot complete a browser sign-in must not be given a browser control.
 */
export const McpKeyAuth: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpKeyAuth()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The key popout, reached by pressing the row's own `Enter API key` link.
 *
 * The fields are the payload's OWN declared names — one password input per name,
 * seeded from `environment_keys`/`header_keys` — so the frame is about the form a
 * real config produces rather than about a form this story invented. Interactive
 * for the same reason the confirm frame is: the dialog is opened by the real
 * control.
 */
const KeyPopoutGround = () => {
	useClickAndWait('[data-mcp-remedy="key"]', '[role="dialog"]');
	return (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpKeyAuth()}
			openPanel={true}
		/>
	);
};

export const McpKeyPopout: Story = {
	render: () => <KeyPopoutGround />,
	decorators: [withCanvasClosed],
};

/**
 * An operation the backend FINISHED earlier in this session, beside a server that
 * is a problem again.
 *
 * This is the frame for the settled-op path, which is where a remedy can vanish:
 * `hubspot`'s credential expired after a successful grant and `slack`'s transport
 * dropped after a successful connect, and both rows keep their control and show no
 * grant line (code review round 1, finding 1). The backend holds settled
 * operations for the rest of the session, so this — a grant that worked earlier
 * and a server that is broken now — is the ordinary state, not a corner.
 */
export const McpGrantSettled: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpProblemAgain()}
			mcpOperations={fixtures.mcpGrantSettled()}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The 64px case: a grant line and the runtime's own diagnosis under it.
 *
 * § 8 budgets "up to 80px with the diagnosis" and no other frame paints that
 * height — `mcp-grant-failed` carries no `errorText`, so it is the 48px two-line
 * shape (design review round 1, D9). The diagnosis is the canonical projection's
 * sentence for a server the RENDERED read already calls a problem, which is the
 * only place the runtime states why.
 */
export const McpGrantFailedDiagnosis: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAuthRequired()}
			mcpOperations={fixtures.mcpGrantFailed()}
			mcpErrors={{
				notion:
					"[Errno 13] Permission denied: '/Users/o/.config/notion/token.json'",
			}}
			openPanel={true}
		/>
	),
	decorators: [withCanvasClosed],
};

/**
 * The remedy link's hover ground, which the rig produces by moving a real pointer
 * at it (`scripts/capture-evidence.mjs`'s `{ hover: selector }`, the same CDP
 * input the trigger's hover frames use).
 */
export const McpRemedyHover: Story = {
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
 * The remedy link with the keyboard's focus ring on it.
 *
 * `focus({ focusVisible: true })` rather than a bare `focus()`: a programmatic
 * focus is not treated as keyboard focus by Chromium's heuristic, and the frame
 * this story exists for is the `:focus-visible` ring (design review round 1, D6 —
 * the reviewer could judge the ring from the CSS and from two sibling surfaces but
 * not from a frame).
 */
const RemedyFocusGround = () => {
	useEffect(() => {
		document
			.querySelector<HTMLButtonElement>('[data-mcp-remedy="grant"]')
			?.focus({ focusVisible: true });
	}, []);
	return (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAuthRequired()}
			openPanel={true}
		/>
	);
};

export const McpRemedyFocus: Story = {
	render: () => <RemedyFocusGround />,
	decorators: [withCanvasClosed],
};

/**
 * The key dialog while the write is in flight.
 *
 * Mounted directly rather than opened by a press, because `saving` is the state
 * between the press and its answer and a story cannot hold a real credential write
 * open. The dialog is the production component with the production props (design
 * review round 1, D6's un-evidenced states).
 */
export const McpKeySaving: Story = {
	render: () => (
		<DialogGround>
			<McpKeyDialog
				open={true}
				target={{
					name: "google-workspace",
					keyNames: ["GOOGLE_CLIENT_SECRET"],
				}}
				saving={true}
				failure={null}
				onCancel={() => undefined}
				onOpenSettings={() => undefined}
				onSave={() => undefined}
			/>
		</DialogGround>
	),
};

/**
 * The key dialog after the reconnect came back without the credential taking.
 *
 * The sentence is the outcome `pressKey` derives from the returned snapshot rather
 * than from the request's status — `manager.reconnect_server` swallows failures, so
 * a 2xx `connect` proves only that the request was accepted (code review round 1,
 * finding 3).
 */
export const McpKeyError: Story = {
	render: () => (
		<DialogGround>
			<McpKeyDialog
				open={true}
				target={{
					name: "google-workspace",
					keyNames: ["GOOGLE_CLIENT_SECRET"],
				}}
				saving={false}
				failure={{
					cause: "unknown",
					detail: null,
					message: "The key was saved, but the server still needs sign-in.",
					phase: "reconnect",
				}}
				onCancel={() => undefined}
				onOpenSettings={() => undefined}
				onSave={() => undefined}
			/>
		</DialogGround>
	),
};

/** The ground the two dialog frames stand on: the app's own canvas, so the frame
 * is a picture of the dialog in its window rather than on the preview's default
 * white. */
const DialogGround = ({ children }: { children: ReactNode }) => (
	<div className="flex min-h-screen items-center justify-center bg-canvas p-6">
		{children}
	</div>
);

/**
 * The pane's 320px floor, with the longest action line it can hold.
 *
 * Round 1's D5 measured `Sign-in cancelled` + `The stored credential was removed.`
 * + `Try again` at 369px inside the 375px column a 420px pane gives, so the floor
 * is where the line has to do something — and the arithmetic said it would
 * ellipsise two sentences beside a live control. The grant line wraps instead, and
 * this frame is the evidence rather than the argument.
 */
export const McpFloor320: Story = {
	render: () => (
		<ChatColumn
			details={deriveRunDetails(fixtures.bothInFlight())}
			mcpServers={fixtures.mcpAuthRequired()}
			mcpOperations={fixtures.mcpGrantCancelledRemoved()}
			mcpErrors={{
				notion:
					"[Errno 13] Permission denied: '/Users/o/.config/notion/token.json'",
			}}
			width={320}
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
