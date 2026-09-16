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
const Readout: FC = () => {
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	// Subscribed rather than read: see `deliver`'s note on why a caption that
	// only repaints when the store moves lies on the tree where it does not.
	const frames = useSyncExternalStore(
		subscribeDeliveries,
		() => deliverySnapshot,
	);
	return (
		<div className="w-[420px] shrink-0 space-y-3 border-l border-hairline p-4 text-meta text-ink-muted">
			<p className="text-ink">Row status as the sidebar reads it</p>
			{sessions.map((row) => (
				<p key={row.session_id} data-readout-row>
					{row.title}: {row.status?.code ?? "(none)"} / “{row.status?.label}”
					{typeof row.status_revision === "number"
						? ` · revision ${row.status_revision} · epoch ${row.status_epoch ?? "(none)"}`
						: " · no feed stamp"}
					{row.attention?.unseen ? " · unread" : ""}
				</p>
			))}
			<p data-readout-frames className="pt-2">
				Frames delivered: {frames.length ? frames : "none"}
			</p>
		</div>
	);
};

const Page: FC = () => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
		<div className="w-[360px] shrink-0 border-r border-hairline">
			<ChatSidebar
				selectedConversation={undefined}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
		<Readout />
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
