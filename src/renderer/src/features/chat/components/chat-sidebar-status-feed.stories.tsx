import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import { useSyncExternalStore } from "react";
import { ChatSidebar } from "./chat-sidebar";

/*
 * The conversation sidebar, with its rows' status delivered by the machine-wide
 * feed rather than by a whole-catalogue read.
 *
 * ## What this replaces, and why a store-level test was not enough
 *
 * A row's status used to arrive only with `sessions.list`, so an answered gate or
 * a completed turn sat unseen until the 30 s safety poll, a window focus, or the
 * chat page's own marker effect on the one row it is showing. The fix is a
 * `session_status` frame carrying the backend's DERIVED `{code, label}` plus a
 * per-session `revision`, which the sidebar's own subscription applies in place.
 *
 * The store's half of that is asserted in `scripts/session-status-feed.test.mjs`,
 * and a green assertion there is not evidence that the SIDEBAR updates: it proves
 * the row's data changed, not that the list repaints with the new icon. That is a
 * claim about pixels, so this story drives the real component tree and the
 * capture under `docs/evidence/chat-sidebar-status-feed/` photographs it.
 *
 * ## The bridge is stubbed; nothing above it is
 *
 * `window.api.desktop.feed` is the app's real subscription surface,
 * `useDesktopFeed` is the real hook, the store is the real store, and the rows
 * are the real `ChatSidebar` - including `ChatSessionStatus`'s glyph, ink and
 * accessible name. What is faked is the transport below the hook: the frames this
 * story delivers travel through the same listener a socket's would, so a frame
 * the hook stopped dispatching would show up here as a row that did not move.
 * Seeding the store directly would photograph a state the app cannot reach on its
 * own, which is the failure mode this file exists to rule out.
 *
 * The list response is stubbed for the same reason and is the other half of the
 * pair: a frame is only interesting against a row that a catalogue read has
 * already stamped, because that stamp is what the merge guard compares. Each
 * story's roster carries its own session ids, since a list response replaces
 * membership wholesale - so no story can inherit another's frame stamps.
 *
 * ## This file is run against the PRE-CHANGE tree as well
 *
 * `docs/evidence/chat-sidebar-status-feed-baseline/` is the same story captured
 * from unmodified `origin/main`, where the frame type is unknown to the renderer
 * and is ignored. That pair is the point: the branch's frame moves the row, and
 * the same frame on main leaves it. It is also why the frames below are plain
 * objects cast once at delivery rather than typed as `DesktopFeedFrame` - the
 * story has to compile on a tree that has no such variant.
 */

/** The feed process's epoch: the term that makes its revisions comparable. */
const FEED_EPOCH = "9f2c1a6b7d3e4051";

type WireRow = {
	id: string;
	name: string;
	mtime: number;
	preview: string;
	live_state: string;
	pending: string | null;
	active: boolean;
	binding: { agent: string | null; team: string | null };
	status: { code: string; label: string };
	status_revision: number;
	status_epoch: string;
};

/** One row in `sessions.list`'s own wire field names, as the backend sends it. */
const wireRow = (
	id: string,
	name: string,
	mtime: number,
	status: { code: string; label: string },
	statusRevision: number,
): WireRow => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: true,
	binding: { agent: null, team: null },
	status,
	status_revision: statusRevision,
	status_epoch: FEED_EPOCH,
});

const BUSY = { code: "busy", label: "Working" };
const APPROVAL = { code: "approval", label: "Approval needed" };
const IDLE = { code: "idle", label: "Recent" };
const COMPLETE = { code: "complete", label: "Complete" };

/* --------------------------------------------------------------- bridge */

/** The connection the stubbed `feed.watchState` reports. */
const feedListeners = new Set<(frame: unknown) => void>();
/** Every frame this page's stories delivered, in order, for the readout. */
const delivered: string[] = [];
const deliveryListeners = new Set<() => void>();
/**
 * A CACHED snapshot, because `useSyncExternalStore` compares with `Object.is`:
 * a getter that built the string on each call would hand React a new value every
 * time and re-render for ever. Kept in step by `deliver` below, which is the
 * only writer.
 */
let deliverySnapshot = "";
const subscribeDeliveries = (listener: () => void) => {
	deliveryListeners.add(listener);
	return () => {
		deliveryListeners.delete(listener);
	};
};

/**
 * Hand one frame to the hook, exactly as the preload relay would.
 *
 * The cast is deliberate and is the single place this file states that its frames
 * are the wire's shape rather than a fixture of one tree's types: a story that
 * typed them would be unpublishable against the pre-change tree, which is half
 * the evidence.
 *
 * THE READOUT IS NOTIFIED BEFORE THE FRAME IS DISPATCHED, and that order was a
 * real defect in the first version of this harness rather than a preference. The
 * caption read a module variable, so it only repainted when something else caused
 * a render - and on the PRE-CHANGE tree nothing did, because an ignored frame
 * changes no store state. The "before" frames therefore showed a row that had not
 * moved (correct) beside a caption claiming no frame had been delivered (false),
 * which is the one thing a caption in an evidence frame may not be. A snapshot
 * every reader subscribes to cannot drift from what was sent.
 */
const deliver = (frame: Record<string, unknown>) => {
	delivered.push(
		`${frame.type as string} ${frame.session_id as string} ${JSON.stringify(frame.payload)}`,
	);
	deliverySnapshot = delivered.join(" | ");
	for (const listener of [...deliveryListeners]) listener();
	for (const listener of [...feedListeners]) listener(frame);
};

const statusFrame = (
	sessionId: string,
	status: { code: string; label: string },
	revision: number,
	seq: number,
) => ({
	epoch: FEED_EPOCH,
	seq,
	type: "session_status",
	session_id: sessionId,
	payload: { code: status.code, label: status.label, revision },
});

/** The completion mark, which rides the type the feed has always carried. */
const attentionFrame = (sessionId: string, unseen: boolean, seq: number) => ({
	epoch: FEED_EPOCH,
	seq,
	type: "attention",
	session_id: sessionId,
	payload: {
		conversation_id: `session/${sessionId}`,
		completion_token: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		anchor_id: "row-1",
		kind: "complete",
		unseen,
		revision: [1, 1],
	},
});

let roster: WireRow[] = [];

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (request: { op: string }) => Promise<unknown>;
				feed: {
					subscribe: (onFrame: (frame: unknown) => void) => () => void;
					watchState: (
						onState: (state: { connected: boolean }) => void,
					) => () => void;
				};
			};
		};
	};
	const api = (page.api ?? {}) as NonNullable<typeof page.api>;
	const desktop = (api.desktop ?? {}) as NonNullable<
		NonNullable<typeof page.api>["desktop"]
	>;
	const ok = (result: unknown) => ({ status: 200, body: { result } });

	/*
	 * Only the two operations this surface reads, and anything else is refused BY
	 * NAME - a story that starts issuing a third call fails loudly instead of
	 * hanging on a promise nothing answers.
	 *
	 * `features.desktop_feed` is what gates the hook (`useDesktopFeed`), and
	 * `session_catalogue` 2 is what gates the sidebar itself; `profile_catalogue`,
	 * `team_catalogue` and `session_search` are deliberately absent, which is how
	 * this fixture keeps the entity pickers and the conversation search out of a
	 * frame about the row's status.
	 */
	desktop.request = async (request: { op: string }) => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { desktop_feed: 1, session_catalogue: 2 },
				});
			case "sessions.list":
				return ok({ sessions: roster, truncated: false });
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	desktop.feed = {
		subscribe: (onFrame) => {
			feedListeners.add(onFrame);
			return () => {
				feedListeners.delete(onFrame);
			};
		},
		// The real preload reports the current state after mount; the stub answers
		// immediately, because a story has no reconnect to wait for and the
		// sidebar's "reconnecting" line is not what this frame is about.
		watchState: (onState) => {
			onState({ connected: true });
			return () => undefined;
		},
	};
	api.desktop = desktop;
	page.api = api;
}

/* --------------------------------------------------------------- the page */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until the catalogue read this story's list response answers has landed. */
const catalogueSettled = async (rows: number, timeoutMs = 4_000) => {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (useCanonicalSessionsStore.getState().sessions.length >= rows) return;
		await sleep(50);
	}
};

/**
 * What the sidebar is reading, in words.
 *
 * A 16px glyph is small in a frame and the stamp has no pixels at all, so the
 * panel beside the sidebar states the value the rows are drawn from - read from
 * the SAME store the rows read, never typed by hand - plus the frames this story
 * delivered. It is a caption for the evidence, in the idiom
 * `chat-session-status.stories.tsx`'s own labelled specimens use, and it is
 * rendered from the store so a frame cannot claim a state the app does not hold.
 */
const Readout: FC<{ rows?: number }> = ({ rows }) => {
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	// Subscribed rather than read: see `deliver`'s note on why a caption that
	// only repaints when the store moves lies on the tree where it does not.
	const frames = useSyncExternalStore(
		subscribeDeliveries,
		() => deliverySnapshot,
	);
	/*
	 * `rows` bounds the caption for the one story whose subject is the LIST rather
	 * than the row.
	 *
	 * The caption renders a line per session, and a session's line is two lines
	 * tall at this width even for a short title (the status, the revision and the
	 * epoch do not fit on one). So a roster long enough to overflow the panel - the
	 * only state in which the container has a viewport to hold or to drag - makes
	 * the caption taller than the app, and `capture-evidence.mjs` grows the frame to
	 * the content: the taller the caption, the taller the frame, the taller the
	 * `max-h-[45%]` panel inside it, and the SMALLER the overflow the story exists
	 * to produce. Bounding the caption is what stops that column deciding, for the
	 * frame, how much of the list is off screen.
	 *
	 * It states what it left out rather than ending silently, so a caption can
	 * never read as a complete list it is not.
	 */
	const shown = rows === undefined ? sessions : sessions.slice(0, rows);
	return (
		<div className="w-[420px] shrink-0 space-y-3 border-l border-hairline p-4 text-meta text-ink-muted">
			<p className="text-ink">Row status as the sidebar reads it</p>
			{shown.map((row) => (
				<p key={row.session_id} data-readout-row>
					{row.title}: {row.status?.code ?? "(none)"} / “{row.status?.label}”
					{typeof row.status_revision === "number"
						? ` · revision ${row.status_revision} · epoch ${row.status_epoch ?? "(none)"}`
						: " · no feed stamp"}
					{row.attention?.unseen ? " · unread" : ""}
				</p>
			))}
			{rows !== undefined && sessions.length > shown.length && (
				<p data-readout-more>
					…and {sessions.length - shown.length} more rows, in the list beside.
				</p>
			)}
			<p data-readout-frames className="pt-2">
				Frames delivered: {frames.length ? frames : "none"}
			</p>
		</div>
	);
};

const Page: FC<{ readoutRows?: number }> = ({ readoutRows }) => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
		<div className="w-[360px] shrink-0 border-r border-hairline">
			<ChatSidebar
				selectedConversation={undefined}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
		<Readout rows={readoutRows} />
	</div>
);

/* --------------------------------------------------------------- stories */

const meta = {
	title: "Chat/Sidebar status feed",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/**
 * A gate answer, on a row the operator is NOT looking at.
 *
 * This is the transition with no event path at all before the frame existed: the
 * list said `approval` / "Approval needed", the gate was answered, and the only
 * thing that could have told the sidebar was a whole-catalogue read up to 30 s
 * later (or a window focus). The frame carries the post-answer code, so the row's
 * glyph moves from the warning triangle to the spinner in the interval between
 * two polls.
 */
const RECONCILE = "0f1e2d3c4b5a";
const QUARTERLY = "1a2b3c4d5e6f";
const MIGRATE = "2b3c4d5e6f70";

export const GateAnswered: Story = {
	render: () => {
		/*
		 * The row this story moves is FIRST, and every roster below does the same:
		 * the sidebar draws its list top-down, so a row third in the array can sit
		 * below the fold of a frame sized to the panel - and a frame that does not
		 * contain the row the claim is about is not evidence about that row. The
		 * mtimes descend with the order for the same reason.
		 */
		roster = [
			wireRow(QUARTERLY, "Quarterly revenue model", 1_760_000_300, APPROVAL, 2),
			wireRow(
				RECONCILE,
				"Reconcile the supplier ledger",
				1_760_000_200,
				BUSY,
				4,
			),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_000_100, IDLE, 1),
		];
		return <Page />;
	},
	play: async () => {
		await catalogueSettled(3);
		deliver(statusFrame(QUARTERLY, BUSY, 3, 41));
		// The paint the capture photographs, not merely the write: React's render
		// is on the frame after the store's, and a capture taken between them is a
		// frame of the previous status.
		await sleep(300);
	},
};

/**
 * A gate parking, on the row the operator is not on.
 *
 * The mirror of the story above and the same claim from the other direction: a
 * row that was working turns into "Approval needed" without the user opening it.
 * Before the frame, an unattended session could park on a gate and look busy
 * until the safety poll.
 */
export const GateParked: Story = {
	render: () => {
		roster = [
			wireRow(
				RECONCILE,
				"Reconcile the supplier ledger",
				1_760_001_300,
				BUSY,
				5,
			),
			wireRow(QUARTERLY, "Quarterly revenue model", 1_760_001_200, BUSY, 3),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_001_100, IDLE, 1),
		];
		return <Page />;
	},
	play: async () => {
		await catalogueSettled(3);
		deliver(statusFrame(RECONCILE, APPROVAL, 6, 51));
		await sleep(300);
	},
};

/**
 * A finished turn that has not been read: TWO frames, and both matter.
 *
 * The completion is two facts with two carriers. The `session_status` frame moves
 * the code to `complete`, and the `attention` frame carries the `unseen` mark -
 * the mark alone would leave the row's own status behind (which is exactly what
 * the pre-change tree does with this pair, and what the committed baseline frame
 * shows). The glyph is the check in the success ink, the accessible name reads
 * "Complete, unread", and the row's tooltip carries the same words for a pointer
 * user.
 */
export const CompletionUnseen: Story = {
	render: () => {
		roster = [
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_002_300, BUSY, 2),
			wireRow(
				RECONCILE,
				"Reconcile the supplier ledger",
				1_760_002_200,
				BUSY,
				7,
			),
			wireRow(QUARTERLY, "Quarterly revenue model", 1_760_002_100, BUSY, 8),
		];
		return <Page />;
	},
	play: async () => {
		await catalogueSettled(3);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 61));
		deliver(attentionFrame(MIGRATE, true, 62));
		await sleep(300);
	},
};

/**
 * The catalogue invalidation: "the list you are holding is stale, read it again".
 *
 * The client acts on the REVISION, not on this payload's content - the sidebar's
 * effect is keyed on `feed.catalogueRevision` and re-runs `fetchSessions` once
 * per bump (chat-sidebar.tsx's own note on why the dependency is a trigger and
 * not a read). So a story that wants to photograph a refetch only has to deliver
 * this frame after arranging what the next `sessions.list` will answer.
 *
 * This frame is also the whole of the backend half this surface is paired with
 * (local-operator #1224). It used to be published only when a row changed
 * SECTION, and a row that reorders INSIDE "Active chats" is `active` on both
 * sides of the move - so the completion painted and the position followed on the
 * safety poll instead, which is the operator's report. Delivering it here is what
 * lets a story photograph the row landing where the next list read puts it.
 */
const catalogueFrame = (revision: number, seq: number) => ({
	epoch: FEED_EPOCH,
	seq,
	type: "catalogue",
	payload: { revision },
});

/* ------------------------------------------------- a row that re-files itself */

/**
 * Hold the shutter until the state this story is about is on screen.
 *
 * The capturer polls `documentElement.dataset.capturePending` before it opens the
 * shutter (see `scripts/capture-evidence.mjs`), and a story that sets it on mount
 * keeps the frame on the far side of its own play. These five stories all END on a
 * rendered result DELIVERED PART-WAY THROUGH the play, so without the latch the
 * shutter races the last two steps and the same story photographs the completion
 * in one theme and the re-file in the next. That is not hypothetical here: the
 * first capture of `CompletionReorderedOffscreen` came back holding the pre-order
 * roster with only the status and attention frames delivered, which is a frame of
 * the state BEFORE the subject, filed under a name that claims the subject.
 *
 * The capturer's own readiness probe is satisfied by rows simply existing, which
 * is why this has to be the story's own statement rather than something inferred
 * from the DOM.
 */
const holdShutter = () => {
	document.documentElement.dataset.capturePending = "1";
};

/** Let it go, once the frame is worth taking. */
const releaseShutter = () => {
	delete document.documentElement.dataset.capturePending;
};

/**
 * The roster the re-filing stories start from, in the order the backend sends it.
 *
 * A session's slot is its `CatalogEntry.rank` - (category, wake band, birth, id) -
 * and the CATEGORY is what the operator's report is about: 0 pending gate, 1
 * unseen completion, 2 unseen error, 3 unseen interruption, 4 busy, 5 live idle,
 * 6 cold. The working rows sort newest-first by birth, so `MIGRATE` - the oldest
 * of them, and the one that finishes - starts BELOW the two that keep working.
 * Two frames of this one roster are then a single transition: the check painting
 * while the row is still third (the operator's screen), and the row leading the
 * list once the catalogue read has landed.
 *
 * `AUDIT` is the idle row, and it is here so the list shows where the working
 * band ends: without a row below all of them, "first" and "above every other
 * row" would be indistinguishable in a four-row frame.
 */
const AUDIT = "3c4d5e6f7081";

/** Working rows first, newest birth first, then the completer, then the idle row. */
const resortBefore = (): WireRow[] => [
	wireRow(QUARTERLY, "Quarterly revenue model", 1_760_010_300, BUSY, 8),
	wireRow(RECONCILE, "Reconcile the supplier ledger", 1_760_010_200, BUSY, 7),
	wireRow(MIGRATE, "Migrate the deploy script", 1_760_010_100, BUSY, 2),
	wireRow(AUDIT, "Audit the vendor list", 1_760_010_000, IDLE, 1),
];

/**
 * The same four rows in the order the backend answers AFTER the completion:
 * category 1 leads, and everything below keeps its previous relative order.
 *
 * Names, mtimes, ids, bindings and the status pair are identical on both sides -
 * only the SEQUENCE differs, so the story isolates POSITION. The pair staying at
 * `BUSY` revision 2 is deliberate rather than an oversight: a stale list cannot
 * clobber the `complete` pair the frame already applied (the store's own
 * revision guard, asserted in `scripts/session-status-feed.test.mjs`), which is
 * what leaves the row's ink out of this story's claim.
 */
const resortAfter = (): WireRow[] => [
	wireRow(MIGRATE, "Migrate the deploy script", 1_760_010_100, BUSY, 2),
	wireRow(QUARTERLY, "Quarterly revenue model", 1_760_010_300, BUSY, 8),
	wireRow(RECONCILE, "Reconcile the supplier ledger", 1_760_010_200, BUSY, 7),
	wireRow(AUDIT, "Audit the vendor list", 1_760_010_000, IDLE, 1),
];

/**
 * THE OPERATOR'S SCREEN: the completion has painted and nothing has moved.
 *
 * This is what the sidebar showed for the five to ten seconds the report names.
 * The two frames that carry a completion - `session_status` for the code and
 * `attention` for the unread mark - both arrive on their own event path and
 * neither carries the list, so the row's checkmark and its ink land here while
 * its index stays 2 (third row, under two working sessions).
 *
 * It is not a broken state and it is not subtle: the row reads as "finished",
 * and the thing the operator came to the sidebar for - reviewing what finished -
 * is a scan of the list for a row that is still where it was ten minutes ago.
 * Keep this roster fixed while judging it: `CompletionReordered` below differs
 * from this story in ONE frame and one list response, and nothing else.
 */
export const CompletionInPlace: Story = {
	render: () => {
		roster = resortBefore();
		return <Page />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(4);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 71));
		deliver(attentionFrame(MIGRATE, true, 72));
		await sleep(300);
		releaseShutter();
	},
};

/**
 * The same completion with the invalidation the fix adds: the row leads the list.
 *
 * The only difference from `CompletionInPlace` is the last two steps - the
 * backend's `catalogue` frame, which the pre-fix feed never published for an
 * intra-section move because it compared section membership rather than the
 * order key, and the reordered list the client's refetch then gets back. That is
 * the whole user-visible claim, photographed: the checkmark and the position
 * arrive together instead of five to ten seconds apart.
 *
 * The reorder is applied to the stub BEFORE the frame is delivered, which is the
 * order the real system runs in - the invalidation is what causes the read, so
 * the read's answer is necessarily the post-completion order.
 */
export const CompletionReordered: Story = {
	render: () => {
		roster = resortBefore();
		return <Page />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(4);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 71));
		deliver(attentionFrame(MIGRATE, true, 72));
		await sleep(300);
		releaseShutter();
		roster = resortAfter();
		deliver(catalogueFrame(2, 73));
		await sleep(300);
	},
};

/**
 * The same resort with a completed block that is already TWO rows deep.
 *
 * The pair above lands the completion at index 0, which is where it goes when it
 * is the only unread one - and a band of one row is not a band. Here `QUARTERLY`
 * is already sitting unread above the completer, so the row lands SECOND, and
 * this is the frame that answers whether the completed block reads as a group or
 * as two unrelated rows that happen to be adjacent.
 *
 * It is also the honest reading of where a completion lands in general: the
 * category is only the FIRST term of the order key, and the terms after it are
 * birth and id - not completion time. So a newly finished row joins the block
 * where its CREATION puts it, which is below an older session that finished
 * earlier and above a newer one that has not finished yet. Both rows and both
 * positions are unchanged by this work; only the promptness of the re-file is.
 */
export const CompletionSecondInBand: Story = {
	render: () => {
		roster = [
			wireRow(QUARTERLY, "Quarterly revenue model", 1_760_010_400, COMPLETE, 9),
			wireRow(
				RECONCILE,
				"Reconcile the supplier ledger",
				1_760_010_200,
				BUSY,
				7,
			),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_010_100, BUSY, 2),
			wireRow(AUDIT, "Audit the vendor list", 1_760_010_000, IDLE, 1),
		];
		return <Page />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(4);
		// The unread mark on the row that is already finished: the attention frame
		// is what makes its status read "unread" rather than merely "complete", and
		// it is the term the completed block's own ink depends on.
		deliver(attentionFrame(QUARTERLY, true, 81));
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 82));
		deliver(attentionFrame(MIGRATE, true, 83));
		await sleep(300);
		releaseShutter();
		roster = [
			wireRow(QUARTERLY, "Quarterly revenue model", 1_760_010_400, COMPLETE, 9),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_010_100, COMPLETE, 3),
			wireRow(
				RECONCILE,
				"Reconcile the supplier ledger",
				1_760_010_200,
				BUSY,
				7,
			),
			wireRow(AUDIT, "Audit the vendor list", 1_760_010_000, IDLE, 1),
		];
		deliver(catalogueFrame(2, 84));
		await sleep(300);
	},
};

/**
 * THE SECOND MOVE: the row that just re-filed to the head leaves again when the
 * completion is READ.
 *
 * A row's life has two order events under this fix, not one. The completion is
 * category 4 -> 1 (the reported bug, above); acknowledging it is category 1 -> 5,
 * and `active` is True on both sides of that one too - so the same missing
 * comparison also moved a read completion into the resting band late, for the
 * same reason.
 *
 * It is here because it is the only order of frames that can show whether the
 * two moves read as a bounce. They do not: they are seconds apart (the second
 * one happens while the operator is looking at the CONVERSATION they just
 * opened, not at the sidebar), each is one flip with no intermediate geometry -
 * `scripts/sidebar-resort-geometry.mjs` samples the DOM every 25 ms and reports
 * no row in any position other than the before and after ones - and the row's
 * ground is `surface` in every band, so the check's ink is unchanged by either.
 */
export const CompletionAcknowledged: Story = {
	render: () => {
		roster = resortBefore();
		return <Page />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(4);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 71));
		deliver(attentionFrame(MIGRATE, true, 72));
		await sleep(300);
		releaseShutter();
		roster = resortAfter();
		deliver(catalogueFrame(2, 73));
		await sleep(300);
		// The read receipt: the mark rests, the row keeps its status, and the
		// backend re-files it with the resting band (category 1 -> 5).
		deliver(attentionFrame(MIGRATE, false, 74));
		roster = [
			wireRow(QUARTERLY, "Quarterly revenue model", 1_760_010_300, BUSY, 8),
			wireRow(
				RECONCILE,
				"Reconcile the supplier ledger",
				1_760_010_200,
				BUSY,
				7,
			),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_010_100, COMPLETE, 3),
			wireRow(AUDIT, "Audit the vendor list", 1_760_010_000, IDLE, 1),
		];
		deliver(catalogueFrame(3, 75));
		await sleep(300);
	},
};

/* ---------------------------------------- a re-file in a list that overflows */

/**
 * The roster the overflowing story starts from: three working sessions, then the
 * one that has finished, then the resting band.
 *
 * The rows above the completer are what make the re-file a MOVE rather than a
 * one-step swap, and they are also what the operator is looking at when it
 * happens: the panel is nine rows tall, so a reader who scrolled into the
 * resting band has the working rows - and the completer - above the fold.
 *
 * The names are fixtures, and they are deliberately distinct enough to tell
 * apart in a frame; `Rename the fixtures` is the row the story scrolls to, so it
 * has to be in the roster at both ends of the transition (a row that vanished
 * from the list would leave the scroll target unmatchable on the second pass).
 */
const RESORT_WORKING = [
	["b1c2d3e4f501", "Ship the pricing page", 1_760_020_600],
	["b1c2d3e4f502", "Fix the webhook retry", 1_760_020_500],
	["b1c2d3e4f503", "Draft the Q3 summary", 1_760_020_400],
] as const;

const RESORT_RESTING = [
	["c1d2e3f40501", "Note on the vendor call", 1_760_019_900],
	["c1d2e3f40502", "Old migration notes", 1_760_019_800],
	["c1d2e3f40503", "Scratch: regex help", 1_760_019_700],
	["c1d2e3f40504", "Summarise the RFC", 1_760_019_600],
	["c1d2e3f40505", "Check the deploy log", 1_760_019_500],
	["c1d2e3f40506", "Rename the fixtures", 1_760_019_400],
	["c1d2e3f40507", "Trace a slow query", 1_760_019_300],
	["c1d2e3f40508", "Archive the old runs", 1_760_019_200],
	["c1d2e3f40509", "Rewrite the changelog", 1_760_019_100],
	["c1d2e3f40510", "Review the pricing note", 1_760_019_000],
	["c1d2e3f40511", "Plan the schema move", 1_760_018_900],
	["c1d2e3f40512", "Audit the vendor list", 1_760_018_800],
	["c1d2e3f40513", "Draft the incident note", 1_760_018_700],
	["c1d2e3f40514", "Check the CDN rules", 1_760_018_600],
	["c1d2e3f40515", "Sort the inbox", 1_760_018_500],
	["c1d2e3f40516", "Sketch the new panel", 1_760_018_400],
	["c1d2e3f40517", "Read the migration guide", 1_760_018_300],
	["c1d2e3f40518", "Tidy the fixtures", 1_760_018_200],
] as const;

const restingRows = (): WireRow[] =>
	RESORT_RESTING.map(([id, name, mtime], index) =>
		wireRow(id, name, mtime, IDLE, 1 + index),
	);

/** Working rows newest-first, the completer oldest of them, then the resting band. */
const overflowingBefore = (): WireRow[] => [
	...RESORT_WORKING.map(([id, name, mtime], index) =>
		wireRow(id, name, mtime, BUSY, 20 + index),
	),
	wireRow(MIGRATE, "Migrate the deploy script", 1_760_020_100, BUSY, 2),
	...restingRows(),
];

/** The same roster with the completer leading, which is where the next read files it. */
const overflowingAfter = (): WireRow[] => [
	wireRow(MIGRATE, "Migrate the deploy script", 1_760_020_100, BUSY, 2),
	...RESORT_WORKING.map(([id, name, mtime], index) =>
		wireRow(id, name, mtime, BUSY, 20 + index),
	),
	...restingRows(),
];

/**
 * Scroll the chat list so the named row sits just ABOVE the panel's head.
 *
 * Anchored on a SESSION row by title, and walked to the nearest ancestor that
 * actually scrolls - the sidebar has two of them, the entity region above and
 * the list panel here, and the report is about the list. The `overflow-y` test
 * is not decoration: the outer `h-screen overflow-hidden` frame reports
 * `scrollHeight > clientHeight` too, so a walk that tested only the metrics
 * would stop there and set a `scrollTop` nothing renders.
 *
 * A ROW rather than the bottom, because the state the report names is "the
 * re-filing row is above the fold", and the bottom is the one offset where the
 * question cannot be asked: a container already at the end of its content has no
 * room to be dragged further, so the anchoring it is being asked about could not
 * move it whatever the tree does. Scrolling to a row also keeps the position
 * reproducible - the roster decides it, not the panel's height.
 */
const scrollToRow = (title: string, lead = 8) => {
	const row = [...document.querySelectorAll("[data-chat-row]")].find((node) =>
		(node.textContent ?? "").trim().includes(title),
	);
	if (!row) throw new Error(`no row titled ${title} to scroll to`);
	let node = row.parentElement;
	while (node && node !== document.body) {
		const scrolls = ["auto", "scroll"].includes(
			getComputedStyle(node).overflowY,
		);
		if (scrolls && node.scrollHeight > node.clientHeight + 8) {
			/* The row's offset INSIDE the content, derived from the live geometry
			   rather than from `offsetTop`, whose origin is the nearest positioned
			   ancestor and not this container. `lead` past it puts the row above the
			   head by exactly that much. */
			const offset =
				row.getBoundingClientRect().top -
				node.getBoundingClientRect().top +
				node.scrollTop;
			node.scrollTop = offset + lead;
			return;
		}
		node = node.parentElement;
	}
	throw new Error(`${title} is not inside a scrolling container`);
};
/**
 * THE OVERFLOWING CASE: the list is taller than its panel, the reader is scrolled
 * into the resting band, and the completer re-files three rows above the fold.
 *
 * This is the state the operator's sidebar is in most of the day, and the one
 * the other four stories cannot show: with four rows in a panel that holds them
 * all, the re-file is visible in full and nothing has to be decided about the
 * viewport. Here the panel is a window onto a longer list, so the rows below the
 * insertion move, and the scroll container has a choice about what to do with
 * them - which is what `chat-sidebar.tsx`'s `overflow-anchor` rule settles and
 * what `scripts/sidebar-resort-geometry.mjs --assert` measures.
 *
 * Read the frame against `docs/evidence/chat-sidebar-status-feed/`'s swept twin
 * rather than alone: the claim is a DIFFERENCE, and the difference is the
 * viewport's own position, which is the one thing a frame carries and a
 * directory listing does not.
 */
export const CompletionReorderedOffscreen: Story = {
	render: () => {
		roster = overflowingBefore();
		return <Page readoutRows={8} />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(22);
		/* Two paints, not one: `catalogueSettled` waits for the STORE, and the rows
		   have to be in the document before the walk below can find the panel that
		   scrolls them. */
		await sleep(250);
		scrollToRow("Migrate the deploy script");
		await sleep(250);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 91));
		deliver(attentionFrame(MIGRATE, true, 92));
		await sleep(300);
		roster = overflowingAfter();
		deliver(catalogueFrame(2, 93));
		await sleep(400);
		releaseShutter();
	},
};
