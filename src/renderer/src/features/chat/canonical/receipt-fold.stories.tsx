/**
 * THE RECEIPT FOLD, in the frames a reader meets it in.
 *
 * `scripts/receipt-fold-behaviour.test.mjs` asserts the behaviour through the
 * shipped reducer and transcript (jsdom): one group for a run's stretch, the
 * header's counts equal to the rows it reveals, the receipts unmounted while
 * condensed, and the final answer outside the fold. jsdom has no layout
 * engine, so none of that is geometry evidence — these stories are: the same
 * production `CanonicalTranscript`, the same pages, rendered in the two columns
 * the app gives the chat (the standard 760px sheet and the 640px window) with
 * the fold shut and opened by a real press on its own trigger.
 *
 * THE FIXTURES GO THROUGH `applyHistoryPage`, exactly as
 * `canonical-notice.stories.tsx` does. Hand-built `TranscriptRecord[]` would
 * skip the half that decides a `custom/job_result` row is a receipt at all, so
 * a story could paint a fold the app never builds from the journal it reads.
 *
 * THE PAGE IS `scripts/receipt-fold-behaviour.test.mjs`'s `syntheticPage`:
 * one user row; thirteen `bash` calls with their results, the eighth failing;
 * four job results, eight hub messages and four peer messages interleaved after
 * the calls the way a real journal carries them; then the agent's answer. The
 * entry builders are copied rather than imported because the test lives under
 * `scripts/`, outside the renderer's tsconfig — importing it would make the
 * typecheck only pass if that file were pulled into the app's program.
 *
 * THE STAMPS ARE FIXED (`TS` below), never `Date.now()`-relative: a frame that
 * changes its own numbers on every capture is a frame no two rounds compare.
 *
 * WHY THE TURN TIER IS PRESSED IN ONE STORY. `ShortMixed` is a small settled
 * turn (one call, two trailing receipts), so the transcript may present it
 * behind its own turn-summary bar — existing behaviour, separate from the
 * fold's. The bar is opened the way a reader opens it, so the frame shows the
 * fold the reader then sees rather than a "Show more" line.
 */

import { __resetTurnCollapseOpen } from "@shared/store/turn-collapse-open";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef } from "react";
import "../../../styles/index.css";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { CanonicalTranscript } from "./canonical-transcript";
import { EMPTY_TRANSCRIPT, applyHistoryPage } from "./transcript-reducer";

/** One instant for every frame; the per-row second offsets live in `at`. */
const TS = 1_792_000_000;

type Entry = DesktopHistoryPage["entries"][number];

let sequence = 0;
const id = (prefix: string) => `${prefix}-${sequence++}`;
const at = () => TS + sequence;

const entry = (payload: Record<string, unknown>): Entry => {
	const next = id("entry");
	return { id: next, ts: at(), type: "message", payload };
};

const userEntry = (): Entry =>
	entry({
		kind: "message",
		role: "user",
		content: [{ text: "Fix the transcript fold tier." }],
	});
/**
 * One call, with the arguments on the ASSISTANT row - the only place
 * `applyHistoryPage` carries them from (`argsByCall`); a fixture that put them
 * on the tool row would paint a transcript the backend cannot produce.
 *
 * The name and arguments are parameters rather than pinned to `bash` because
 * `LongInventory` needs eight distinct kinds on ONE run, which is the whole
 * point of that frame: the count line's cap only exists for a run this wide.
 */
const callEntry = (
	callId: string,
	name = "bash",
	args: Record<string, unknown> = { command: "pnpm test" },
	intent = "Running the tests",
): Entry =>
	entry({
		kind: "message",
		role: "assistant",
		tool_calls: [{ id: callId, name, arguments: { ...args, i: intent } }],
		stop_reason: "toolUse",
	});
const resultEntry = (
	callId: string,
	error = false,
	toolName = "bash",
	text = error
		? "exit code: 1\n--- stdout ---\nfailed"
		: "exit code: 0\n--- stdout ---\nok",
): Entry =>
	entry({
		kind: "message",
		role: "tool",
		tool_call_id: callId,
		tool_name: toolName,
		content: [{ text }],
		is_error: error,
	});
/**
 * `index === 3` is the failed state: a `job_result` headline the runtime writes
 * when a background job dies on a provider fault, so the fold's receipt family
 * is painted beside a failure rather than only beside successes.
 */
const jobEntry = (index: number, pinned = true): Entry =>
	entry({
		kind: "custom",
		custom_type: "job_result",
		attribution: "user",
		details: {
			job_id: `job-${index}`,
			text:
				index === 3
					? "background job 'worker-3' failed: Provider connection failed. Retry the job."
					: pinned
						? `background job 'worker-${index}' completed (pinned anthropic/claude-sonnet-5-5, ran on openai/gpt-6.1-sol):\nReviewed the change.`
						: `background job 'worker-${index}' completed:\nReviewed the change.`,
		},
	});
const hubEntry = (label: string): Entry =>
	entry({
		kind: "custom",
		custom_type: "hub_message",
		attribution: "user",
		details: {
			direction: "to_parent",
			job_id: "job-hub",
			label,
			body: `A note from ${label}.`,
			text: `<subagent-message label='${label}' job='job-hub'>\nA note from ${label}.\n</subagent-message>`,
		},
	});
const peerEntry = (): Entry =>
	entry({
		kind: "custom",
		custom_type: "peer_message",
		details: {
			text: "<peer-session-message from_pid='1' conversation='sibling'>\nA note from a sibling session.\n</peer-session-message>",
			sender: { pid: "1", conversation_name: "sibling", model_label: "test" },
		},
	});
const answerEntry = (): Entry =>
	entry({
		kind: "message",
		role: "assistant",
		content: [{ text: "The fold tier now counts internal receipts honestly." }],
		stop_reason: "stop",
	});

/**
 * The operator's page: one call per receipt interleaved, exactly the shape
 * `[bash, job_result, bash, job_result, ...]` that used to leave one standalone
 * `job result` row per chevron.
 *
 * `sequence = 0` restarts the ids and stamps, so every render of a story builds
 * the same page byte for byte. The store reset is here, not in an effect, for
 * the same reason: Storybook keeps one module instance across story switches,
 * and a turn bar a reader expanded in a previous frame must not decide whether
 * THIS frame arrives collapsed.
 */
function syntheticPage(): Entry[] {
	sequence = 0;
	__resetTurnCollapseOpen();
	const entries: Entry[] = [userEntry()];
	for (let index = 0; index < 13; index++) {
		const callId = `call-${index}`;
		entries.push(callEntry(callId), resultEntry(callId, index === 7));
		if (index < 4) entries.push(jobEntry(index, index !== 3));
		if (index < 8) entries.push(hubEntry(`worker-${index}`));
		if (index < 4) entries.push(peerEntry());
	}
	entries.push(answerEntry());
	return entries;
}

/** A receipt-only run: the user's ask and nothing but `job_result` rows. */
function receiptOnlyPage(): Entry[] {
	sequence = 0;
	__resetTurnCollapseOpen();
	return [userEntry(), jobEntry(0), jobEntry(1)];
}

/**
 * THE CAPPED COUNT LINE, on one run wide enough to force it.
 *
 * Eight action kinds over ten calls (`bash` x2, `read` x2, `grep`,
 * `search_the_web`, `edit`, `task`, `hub`, `wait`) so `foldCountUnits` has more
 * than its five units to keep: the first five by the line's own order survive
 * (`3 files` - the two `read`s plus `grep`, which the class table files under
 * `files`, not `searches`; `1 web search`; `2 shell`; `1 edit`; `1 task`) and
 * the two remaining calls (`hub` as `subagent`, `wait`) become ONE
 * `and 2 other actions` unit. Three adjacent `job_result` rows then close the
 * run, so the receipt family's `3 job results` has to share the same line.
 *
 * The header is not written into the fixture: it is what the shipped
 * `foldCounts` + `receiptFoldUnits` produce from these rows, and the reason the
 * frame exists is to see that the production line holds together on ONE line at
 * the 640px column without breaking inside a unit - and that a longer unit count
 * wraps at the ` · ` separators rather than inside a phrase (design round 1, D1).
 *
 * The arguments are the rows' own words (`summaryFromArgs`), realistic per
 * kind, so a future renderer that starts reading one of them cannot crash on
 * an argument set no real call has.
 */
function longInventoryPage(): Entry[] {
	sequence = 0;
	__resetTurnCollapseOpen();
	const entries: Entry[] = [userEntry()];
	const call = (
		callId: string,
		name: string,
		args: Record<string, unknown>,
		intent: string,
		text: string,
	) => {
		entries.push(callEntry(callId, name, args, intent));
		entries.push(resultEntry(callId, false, name, text));
	};
	call(
		"call-bash-compile",
		"bash",
		{ command: "pnpm build" },
		"Building the app",
		"exit code: 0\n--- stdout ---\nbuilt",
	);
	call(
		"call-bash-test",
		"bash",
		{ command: "pnpm test:desktop" },
		"Running the desktop tests",
		"exit code: 0\n--- stdout ---\nok",
	);
	call(
		"call-read-transport",
		"read",
		{ path: "src/main/desktop-transport.ts" },
		"Reading the transport",
		"…the reconnect handling…",
	);
	call(
		"call-read-session",
		"read",
		{ path: "src/main/desktop-session.ts" },
		"Reading the session",
		"…the snapshot contract…",
	);
	call(
		"call-grep",
		"grep",
		{ pattern: "after_seq", path: "src/main" },
		"Searching the cursor",
		"desktop-transport.ts:412",
	);
	call(
		"call-web",
		"search_the_web",
		{ query: "electron background throttling" },
		"Searching the web",
		"…one result…",
	);
	call(
		"call-edit",
		"edit",
		{ path: "src/main/desktop-transport.ts", old_string: "a", new_string: "b" },
		"Editing the transport",
		"Updated 1 file",
	);
	call(
		"call-task",
		"task",
		{ agent: "reviewer", prompt: "Review the fold change" },
		"Delegating the review",
		"Review started.",
	);
	call(
		"call-hub",
		"hub",
		{ op: "list" },
		"Checking subagents",
		"No subagents running.",
	);
	call(
		"call-wait",
		"wait",
		{ job_id: "job-0" },
		"Waiting for the job",
		"job-0 completed.",
	);
	entries.push(jobEntry(0), jobEntry(1), jobEntry(2));
	return entries;
}

/** The trailing pair: one bash call, then two adjacent `job_result` rows. */
function shortMixedPage(): Entry[] {
	sequence = 0;
	__resetTurnCollapseOpen();
	const callId = "call-tail";
	return [
		userEntry(),
		callEntry(callId),
		resultEntry(callId),
		jobEntry(0),
		jobEntry(1),
	];
}

/** The records the production reducer makes of a page. */
const transcriptOf = (entries: Entry[]) =>
	applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries,
		has_more: false,
		cursor_missing: false,
	});

const Frame = ({
	entries,
	width = "column",
	openFold = false,
	openTurn = false,
}: {
	entries: Entry[];
	/** `column` is the shipped 760px sheet; `window` is the 640px chat window. */
	width?: "column" | "window";
	/**
	 * Press the fold's own trigger after mount, the way a reader opens it.
	 *
	 * `CanonicalTranscript` takes no "start open" prop, so the expanded state is
	 * reached through the affordance a reader has: if the trigger stopped
	 * reaching the body, this frame comes back collapsed and the story fails to
	 * show what it claims.
	 */
	openFold?: boolean;
	/**
	 * Open the turn-summary bar first when the small settled turn carries one,
	 * so `ShortMixed` shows the fold rather than the bar's own collapsed state.
	 */
	openTurn?: boolean;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!openFold && !openTurn) return;
		if (openTurn) {
			containerRef.current
				?.querySelector<HTMLButtonElement>(
					"[data-turn-summary] button[aria-expanded='false']",
				)
				?.click();
		}
		if (openFold) {
			/* The capture rig asks whether the story rendered, and a transcript
			   with every row shut answers yes - so the shutter is held until the
			   state under test is in the DOM, exactly as `canonical-notice`'s
			   `Frame` and `chat-trace--conversation-reasoning-open` do. */
			document.documentElement.dataset.capturePending = "1";
			containerRef.current
				?.querySelector<HTMLElement>("[data-fold-summary]")
				?.closest<HTMLButtonElement>("button")
				?.click();
			document.documentElement.removeAttribute("data-capture-pending");
		}
	}, [openFold, openTurn]);
	return (
		<div
			className="overflow-y-auto p-6"
			style={{ height: 600 }}
			ref={containerRef}
		>
			<div className={width === "window" ? "w-[640px]" : "max-w-[760px]"}>
				<CanonicalTranscript
					transcript={transcriptOf(entries)}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					failure={null}
					/* A read conversation with rows: nothing is owed, and the hold
					   cannot fire because every frame here has records. */
					awaitingHydration={false}
					onReconnect={() => {}}
				/>
			</div>
		</div>
	);
};

const meta: Meta = {
	title: "Chat/Receipt fold",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** The full run in the standard column, every fold shut: the fold's headline. */
export const Collapsed: Story = {
	name: "Collapsed — the full run, standard column",
	render: () => <Frame entries={syntheticPage()} />,
};

/** The same run with the fold opened by its own trigger, as a reader opens it. */
export const Expanded: Story = {
	name: "Expanded — the full run, fold opened",
	render: () => <Frame entries={syntheticPage()} openFold={true} />,
};

/** The 640px chat window: the column the count line has to survive. */
export const NarrowCollapsed: Story = {
	name: "Narrow collapsed — 640px window, fold shut",
	render: () => <Frame entries={syntheticPage()} width="window" />,
};

/** The narrow window with the fold opened, so the count line is read at width. */
export const NarrowExpanded: Story = {
	name: "Narrow expanded — 640px window, fold opened",
	render: () => (
		<Frame entries={syntheticPage()} width="window" openFold={true} />
	),
};

/**
 * The capped line at the 640px column: eight kinds and three receipts on one
 * header, which is the frame design D1's residual asks for.
 *
 * THE TURN BAR IS PRESSED FIRST, for the reason `ShortMixed` states: a settled
 * turn is presented behind its own summary bar before the fold is reachable,
 * and an unopened bar would photograph the bar instead of the count line this
 * story exists to show. The header the frame lands on is production's, not the
 * fixture's: with `grep` filed under `files` (its action class) the line reads
 * `3 files · 1 web search · 2 shell · 1 edit · 1 task · and 2 other actions ·
 * 3 job results`, and the last two clauses are the cap and the receipt family
 * sharing one line.
 */
export const LongInventory: Story = {
	name: "Long inventory — 640px window, capped count line over receipts",
	render: () => (
		<Frame entries={longInventoryPage()} width="window" openTurn={true} />
	),
};

/** The same header in the shipped 760px sheet, so the pair shows both column widths. */
export const LongInventoryWide: Story = {
	name: "Long inventory — standard column",
	render: () => <Frame entries={longInventoryPage()} openTurn={true} />,
};

/** A run of receipts and nothing else: the receipt-only fold. */
export const ReceiptOnly: Story = {
	name: "Receipt only — two job results, no calls",
	render: () => <Frame entries={receiptOnlyPage()} />,
};

/** The trailing-stretch case: one call, then two adjacent `job_result` rows. */
export const ShortMixed: Story = {
	name: "Short mixed — one call, a trailing job-result pair",
	render: () => <Frame entries={shortMixedPage()} openTurn={true} />,
};
