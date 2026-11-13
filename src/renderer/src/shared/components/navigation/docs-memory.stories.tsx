/**
 * Memory, as the marketing site's "Teach it once" figure shows it: one
 * conversation where a preference is taught, and a later one where it is
 * recalled. Rendered from the REAL desktop components - `CanonicalTranscript` (its ordinary tool rows), the docked `QuestionDock`
 * approval card and `MessageInput` - over sample records, never a redrawn copy.
 *
 * WHY THIS FILE EXISTS. The site's section showed an old agent form; memory is
 * the product's actual "teach it once" surface, and no story rendered a memory
 * save or recall. Memory has no bespoke UI: a `memory` call is an ordinary tool
 * row and a recall is an ordinary `read` of a `memory://` entry, so the scenes
 * below stage exactly those rows rather than inventing a memory card.
 *
 * WHAT IS PRODUCT TRUTH AND WHAT IS SAMPLE (core `local_operator` @ ba3fccc1d604):
 * - The approval card's title is the tool's name and its detail is the tool's
 *   own approval describer (`session/runtime/serving.py` `PendingRequest(
 *   kind="approval", title=tool_name, detail=description)`). For a global store
 *   `tools/memory_tools.py::_approval_text` returns the literal
 *   `GLOBAL_STORE_APPROVAL` below; keep it byte-identical to core.
 * - A store needs write-level approval; a recall is read-level
 *   (`call_approval_tier`). The default scope is the conversation; `global` is
 *   for durable personal facts and preferences (`guides/memory/GUIDE.md`).
 * - The store receipt is the store's own result plus `uri` and `lifetime`
 *   (`execute_fact_memory`; `memory.py` write result and `_quota_view`); the
 *   global cap is `GLOBAL_TOKENS` = 16000. Ids are UUIDv7 (`memory.py`).
 * - On a later turn up to 3 matching titles are suggested to the agent
 *   (`memory_capture.py` suggestion block, which is prompt-side and never
 *   rendered); the agent reads the full entry with `read memory://global/<id>`,
 *   whose result is `MemoryStore.show`'s shape. Recall is per relevant request,
 *   not applied to every turn - so scene B is a matching request.
 * - Everything else - the user's words, the agent's prose and intents, the
 *   repository, branch and PR - is sample text in the docs library's world.
 *
 * CAPTURE. The marketing set's size: a 1280x720 viewport at
 * `deviceScaleFactor: 2`, once per theme via
 * `&args=theme:localOperatorLight|localOperatorDark`. The approval card is
 * docked synchronously, but the receipt scenes open a row's disclosure after
 * mount, so they hold the shutter (`data-capture-pending`) until the expanded
 * detail is painted and refuse the frame (`data-capture-failed`) if it never is
 * - the latch the capture rigs already honour.
 */

import "../../../styles/index.css";
import type { PendingDesktopGate } from "../../../../../shared/desktop-session-contract";
// The shim installs window.api for every story here.
import "@features/chat/components/story-electron-shim";
import { CanonicalTranscript } from "@features/chat/canonical/canonical-transcript";
import type {
	TranscriptRecord,
	TranscriptState,
} from "@features/chat/canonical/transcript-reducer";
import {
	CHAT_COLUMN_CONTAINER,
	CHAT_COLUMN_INSET,
	CHAT_MEASURE,
} from "@features/chat/chat-measure";
import { QuestionDock } from "@features/chat/components/trace/question-dock";
import type { Message } from "@features/chat/types/message";
import { MessageInput } from "@shared/components/composer/message-input";
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useEffect, useRef } from "react";
import { marketingGlass } from "./docs-glass-backdrop";

/* ---------------------------------------------------------------- the world */

/** Two sessions: the memory has to cross from one to the other to be a recall. */
const TAUGHT_SESSION = "session/7b21c0e94f3a";
const RECALLED_SESSION = "session/c48e5d1a2b90";

/**
 * FIXED WALL CLOCKS, one per scene. The transcript prints a clock, and anchoring
 * it to load time made every capture read differently (taught 11:03 light,
 * 11:04 dark) and put the recall minutes after the teaching (design round 2 D1,
 * QA F1). The recall is the point of the figure, so it reads DAYS later: the
 * fact is taught three days back at 10:12 and recalled today at 09:40, both
 * local, whatever day the capture runs.
 */
const sceneClock = (daysAgo: number, hour: number, minute: number) => {
	const date = new Date();
	date.setDate(date.getDate() - daysAgo);
	date.setHours(hour, minute, 0, 0);
	return date.getTime();
};
const TAUGHT_AT = sceneClock(3, 10, 12);
const RECALLED_AT = sceneClock(0, 9, 40);
/** `minutesAgo` before a scene's own clock. */
const taughtAt = (minutesAgo: number) => TAUGHT_AT - minutesAgo * 60_000;
const recalledAt = (minutesAgo: number) => RECALLED_AT - minutesAgo * 60_000;

/** Core's literal approval line for `memory op=store scope=global`. */
const GLOBAL_STORE_APPROVAL =
	"Store durable personal fact in global memory (across sessions)";

/**
 * Under core's 100-char title budget (`_TITLE_CHARS`), so `_derived_title`
 * keeps the whole line and the stored title equals the text.
 */
const PREFERENCE =
	"PR descriptions: only what changed and how it was verified. No background essay, no file list.";

/** A UUIDv7-shaped sample id; one fact, referenced by both scenes. */
const FACT_ID = "019a6f3e-7c41-7d2a-9b1e-5f0c2a8d4e61";
const FACT_VERSION = "019a6f3e-7c42-7f10-8c3d-1e9b7a4f2c05";
const FACT_URI = `memory://global/${FACT_ID}`;

const user = (id: string, text: string, ts: number): TranscriptRecord => ({
	kind: "user",
	id,
	ts,
	text,
	images: [],
});

const assistant = (id: string, text: string, ts: number): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts,
	text,
	streaming: false,
	stopReason: null,
	error: false,
	complete: true,
});

type ToolRecord = Extract<TranscriptRecord, { kind: "tool" }>;

/** The docs library's tool-row defaults (`docs-library.stories.tsx`). */
const tool = (over: Partial<ToolRecord> & { id: string }): ToolRecord => ({
	kind: "tool",
	ts: RECALLED_AT,
	toolCallId: over.id,
	toolName: "bash",
	intent: null,
	args: null,
	phase: "done",
	argumentBytes: 0,
	output: "ok",
	isError: false,
	notRunReason: null,
	notRunKind: null,
	neverSent: false,
	durationS: 0.4,
	startedAt: null,
	endedAt: null,
	images: [],
	added: 0,
	removed: 0,
	diff: null,
	stopped: false,
	...over,
});

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		compacting: false,
		compactingSince: 0,
		viewEpoch: 0,
		oldestId: null,
		oldestTs: 0,
		hasMore: false,
		argsByCall: new Map(),
	};
}

const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

/* ---------------------------------------------------------------- the frame */

/**
 * The chat pane as `chat-content.tsx` composes it: header, transcript, the
 * docked gate (when one is pending) and the composer. No sidebar: the figure is
 * two conversations side by side, and the shell would halve each frame.
 */
const MemoryPane: FC<{
	sessionId: string;
	records: TranscriptRecord[];
	gate?: PendingDesktopGate | null;
}> = ({ sessionId, records, gate = null }) => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		/* `canvas-backing` as `app.tsx` marks its `<main>`: under the marketing
		   glass this paints the column's canvas at the shipped alpha; with glass
		   off no rule matches and `bg-background` holds. */
		<main
			data-glass-region="canvas-backing"
			className="flex h-screen min-h-0 w-full flex-col overflow-hidden bg-background"
		>
			{/*
			 * No `ChatHeader`: at the marketing set's 720px height the docked
			 * approval card plus the composer leave the transcript ~75px, and the
			 * header's row was what scrolled the taught ask out of frame A. The
			 * frames drop it together so the pair reads as one surface.
			 */}
			<div className="flex min-h-0 grow flex-col px-6 pt-4">
				<CanonicalTranscript
					transcript={transcriptOf(records)}
					frontend={null}
					gate={gate}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					failure={null}
					awaitingHydration={false}
					conversationId={sessionId}
					onReconnect={() => {}}
				/>
			</div>
			{gate && (
				// The wrapper and measure `chat-content.tsx` mounts the dock in, so the
				// card takes the chat column's width rather than the pane's.
				<div
					className={cn(
						CHAT_COLUMN_CONTAINER,
						CHAT_COLUMN_INSET,
						"w-full shrink-0 pt-2",
					)}
				>
					{/* No session behind a story: answering is a no-op. */}
					<QuestionDock
						className={CHAT_MEASURE}
						gate={gate}
						answering={false}
						answer={null}
						onAnswer={() => {}}
						sessionId={sessionId}
					/>
				</div>
			)}
			<div className="shrink-0 px-6 pb-6 pt-0">
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId={sessionId}
					onSendMessage={async () => true}
				/>
			</div>
		</main>
	);
};

/**
 * Bring one tool row on screen by a marker in its text, the way a reader
 * does (the turn's summary bar and the row's own button are the only
 * controls), and hold the shutter until it is there. `open: "row"` also opens
 * the row's receipt; `open: "turn"` stops at the visible collapsed row, for a
 * frame whose point is the whole turn rather than one receipt. Same latch as the docs library's `ExpandReceipt` / `HubHold`: an
 * expired hold sets `data-capture-failed` so a rig refuses the frame instead of
 * exporting a collapsed row as if it were the claimed state.
 */
const ExpandRow = ({
	marker,
	open,
}: {
	marker: string;
	open: "row" | "turn";
}) => {
	useEffect(() => {
		const root = document.documentElement;
		root.dataset.capturePending = "1";
		delete root.dataset.captureFailed;
		const started = Date.now();
		const rowWith = (expanded: "true" | "false") =>
			Array.from(
				document.querySelectorAll<HTMLButtonElement>(
					`[data-record-kind="tool"] button[aria-expanded="${expanded}"]`,
				),
			).find((trigger) =>
				(
					trigger.closest('[data-record-kind="tool"]')?.textContent ?? ""
				).includes(marker),
			);
		const timer = window.setInterval(() => {
			if (rowWith("true") || (open === "turn" && rowWith("false"))) {
				root.removeAttribute("data-capture-pending");
				window.clearInterval(timer);
				return;
			}
			if (Date.now() - started > 20_000) {
				root.dataset.captureFailed = "memory-row-not-expanded";
				root.removeAttribute("data-capture-pending");
				window.clearInterval(timer);
				return;
			}
			const row = rowWith("false");
			if (row) row.click();
			// A settled turn condenses its calls under one summary bar
			// (`turn-collapse-model.ts`), so the row only exists once a reader
			// has opened that bar - open it the same way, then the row.
			else
				document
					.querySelector<HTMLButtonElement>(
						'[data-turn-summary] button[aria-expanded="false"]',
					)
					?.click();
		}, 100);
		return () => {
			window.clearInterval(timer);
			root.removeAttribute("data-capture-pending");
		};
	}, [marker, open]);
	return null;
};

/* ------------------------------------------------------------------- scenes */

const meta: Meta = {
	title: "Docs/Memory",
	/* The shipped glass over a stand-in desktop, like the other marketing
	   scenes (design round 2 D8, QA F4); the seam is shared with #1825. */
	...marketingGlass,
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

const TAUGHT_ASK = user(
	"taught-user",
	// One line on purpose: the docked approval card takes most of a 720px
	// frame, and a wrapped ask scrolls its own first line out of view.
	"From now on, keep PR descriptions to what changed and how it was verified.",
	taughtAt(6),
);

/* -- A. Taught: the save, parked on its approval --------------------------- */

/**
 * The moment of teaching: the agent has called `memory` with `scope: global`
 * and the approval card names where the fact lands, in core's own words. A
 * store is a write-tier call, so with approvals on it parks here until the
 * operator answers; this frame does not claim every memory write is gated
 * (auto-approve modes and background capture exist).
 */
export const Taught: Story = {
	render: () => (
		<MemoryPane
			sessionId={TAUGHT_SESSION}
			records={[TAUGHT_ASK]}
			gate={{
				request_id: "4f1c9a07e2b85d36",
				kind: "approval",
				title: "memory",
				detail: GLOBAL_STORE_APPROVAL,
				options: [],
				secret: false,
				question_index: 0,
				question_total: 1,
			}}
		/>
	),
};

/* -- B. Recalled: a later session reads the fact and follows it ------------ */

/**
 * A different conversation, days later, with a request the fact matches. The
 * agent was offered the title, reads the full entry (a real `read` row of a
 * `memory://global/<id>` path) and the PR it opens follows the rule.
 */
export const Recalled: Story = {
	render: () => (
		<>
			{/*
			 * The turn, not the receipt: the request, the `memory://global/<id>`
			 * read row and the reply must share one 720px frame, and the open
			 * receipt alone is taller than the transcript's share of it.
			 */}
			<ExpandRow marker={FACT_URI} open="turn" />
			<MemoryPane
				sessionId={RECALLED_SESSION}
				records={[
					user(
						"recalled-user",
						"The date-format fix for the invoice export is on `fix/export-dates` and the tests pass. Open the PR.",
						recalledAt(4),
					),
					tool({
						id: "recalled-read",
						ts: recalledAt(4),
						toolName: "read",
						intent: "Reading the saved PR-description preference",
						args: { path: FACT_URI },
						output: JSON.stringify(
							{
								id: FACT_ID,
								version: FACT_VERSION,
								scope: "global",
								owner: "operator",
								status: "active",
								fact: { title: PREFERENCE, body: PREFERENCE },
								conflicts: [],
							},
							null,
							2,
						),
						durationS: 0.02,
					}),
					tool({
						id: "recalled-pr",
						ts: recalledAt(3),
						toolName: "bash",
						intent: "Opening the pull request",
						args: {
							command:
								'gh pr create --base main --title "fix(export): write invoice dates as ISO 8601" --body-file pr-body.md',
						},
						output: "https://github.com/northwind/invoices/pull/214",
						durationS: 1.8,
					}),
					assistant(
						"recalled-reply",
						"Opened [#214](https://github.com/northwind/invoices/pull/214). Description, per your saved rule:\n\n**What changed** — the March export writes invoice dates as ISO 8601 (`2026-03-05`) instead of the locale format, so the ledger import stops reading 05/03 as May.\n\n**How it was verified** — `pytest tests/test_export.py` (12 passed) and a re-run of the March export, which the ledger imported with no date warnings.",
						recalledAt(3),
					),
				]}
			/>
		</>
	),
};
