import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import { type FC, useEffect, useState, useSyncExternalStore } from "react";
import { unreadAckableCount, unreadMarkKind } from "../mark-all-read";
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
	/**
	 * The catalogue's own `attention` column, which is what a row's completion
	 * mark is read from. It is a WIRE row's field (`sessions.list` publishes each
	 * conversation's store state here), so a story that shows unread marks has to
	 * seed them at the source rather than paint them into the store.
	 */
	attention?: Record<string, unknown>;
	/**
	 * The record's own two readings, which `sessions.list` projects onto the row:
	 * how many subagents the session owns that are running, and how many are
	 * waiting for capacity.
	 *
	 * `null` is "this build does not report", and it is a different answer from
	 * `0` - a runtime older than the fields omits them or sends `null`, and a
	 * fixture that folded either into `0` would photograph "no subagents" about a
	 * session nobody could ask.
	 *
	 * THE ROWS BELOW THAT CARRY THEM ARE NOT DECORATION, and this note replaces
	 * the one that said the opposite ("a row renders the same with and without
	 * them"): the sidebar reads these two fields directly now
	 * (`features/chat/chat-session-subagents.ts`), because `status.label` carries
	 * the counts on the `delegating` rung alone and the rungs above it - a live
	 * turn, an unseen completion, an attached session, an armed wake - had no way
	 * to say that children were still at work. `subagent-rows-*` exists to
	 * photograph exactly those rows.
	 */
	subagents_running?: number | null;
	subagents_queued?: number | null;
	/**
	 * The catalogue's archive flag, which the row's leading mark reads. Declared
	 * here because the acceptance list needs one cell with BOTH conditional marks
	 * on it (the leading `Archive` mark and the post-title indicator), and a
	 * fixture that could not say `archived` could not photograph that pair.
	 */
	archived?: boolean;
};

/** One row in `sessions.list`'s own wire field names, as the backend sends it. */
const wireRow = (
	id: string,
	name: string,
	mtime: number,
	status: { code: string; label: string },
	statusRevision: number,
	/*
	 * The binding, because a SESSION ROW IS DRAWN IN TWO PLACES: once in the list
	 * and once, nested, under the agent or team it is bound to. `children()` reads
	 * the same `matching` array for both, which is what makes a completion re-file
	 * a nested row on the same event as a list one - the finding this parameter
	 * exists to be able to photograph (round 1, R1).
	 */
	binding: { agent: string | null; team: string | null } = {
		agent: null,
		team: null,
	},
	attention?: Record<string, unknown>,
	/*
	 * The row's LIVE state, for the one story whose point is that it disagrees with
	 * the mark the wire still carries. Every other roster leaves it at the default:
	 * a row draws from `status`, and a fixture that needed a second field to say
	 * what it is doing would be a fixture the client does not read.
	 */
	state: Partial<WireRow> = {},
): WireRow => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: true,
	binding,
	status,
	status_revision: statusRevision,
	status_epoch: FEED_EPOCH,
	...(attention ? { attention } : {}),
	...state,
});

const BUSY = { code: "busy", label: "Working" };
const APPROVAL = { code: "approval", label: "Approval needed" };
const WEDGED = { code: "wedged", label: "Not answering · process alive" };
/*
 * The same state with the age the catalogue actually measures, which is what
 * `WedgedOwner` needs and the shorter constant deliberately does not carry: the
 * sentence the app shows is `WEDGED_STATUS` plus a `(last heartbeat … ago)`
 * clause whenever the record has an age, and a frame shot from the bare constant
 * would show a row the wire does not produce. Kept as a second constant rather
 * than widening `WEDGED`, because `MarkAllReadUnseenWithoutMark` is already
 * committed off that one and its frames are not part of this change.
 */
const WEDGED_SILENT = {
	code: "wedged",
	label: "Not answering · process alive (last heartbeat 4m ago)",
};
const IDLE = { code: "idle", label: "Recent" };
const COMPLETE = { code: "complete", label: "Complete" };
/*
 * The two FAILURE pairs, and they are the reason this file needs its own rows for
 * them: `status_code` publishes `error`/`interrupted` where the runtime's own mark
 * wins, and the label it publishes then reads "Unseen error" / "Unseen
 * interruption" (the runtime's `CatalogEntry.status`, the same sentence the row's
 * tooltip and its accessible name carry). No other story in this file stages one,
 * which left the only class the bulk count KEEPS without a frame (design D3).
 */
const FAILED = { code: "error", label: "Unseen error" };
const STOPPED = { code: "interrupted", label: "Unseen interruption" };

/**
 * A conversation's completion token, shaped like the backend's own `RequestID`.
 *
 * Per conversation and deterministic, because a token NAMES one completion: a
 * receipt that carried one row's token for another row's conversation is not a
 * state the backend can produce, and a fixture that did that would photograph a
 * wire the app can never see.
 */
const unseenToken = (sessionId: string) =>
	`${sessionId.slice(0, 8)}-0000-4000-8000-${sessionId}`;

/**
 * A finished, UNREAD completion as a catalogue row carries it: the check the
 * sidebar paints, with the token that makes it ackable.
 */
const unseenAt = (sessionId: string, published = 4) => ({
	conversation_id: `session/${sessionId}`,
	completion_token: unseenToken(sessionId),
	anchor_id: "result-1",
	kind: "complete",
	unseen: true,
	revision: [published, published - 1],
});

/** The same conversation, read: what the receipt's `read` bucket carries back. */
const readAt = (sessionId: string, published = 4) => ({
	...unseenAt(sessionId, published),
	unseen: false,
	revision: [published, published],
});

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

/**
 * The entity catalogues this page answers, or null for a story that has none.
 *
 * ONE FIXTURE GAP MADE A FINDING INVISIBLE, and this is the plug. `profiles.list`
 * and `teams.list` are gated on the `profile_catalogue`/`team_catalogue`
 * capabilities, and the fixture below answered neither, so no story rendered an
 * entity - and the entity region draws `sessionRow(row, true)` children off the
 * same catalogue array the list does, which means a nested row's slot is the same
 * backend order key a completion invalidates. The claim that nothing above the
 * list re-files could therefore be neither confirmed nor refuted on this rig
 * (round 1, R1). `CompletionReorderedNested` is the story that measures it.
 *
 * It is a MODULE variable rather than a constant for the same reason `roster` is:
 * every other story must keep answering no catalogue, or the frames that predate
 * this one would gain two sections and stop being the states they were shot in.
 */
let entities: { agents: string[]; teams: string[] } | null = null;
/*
 * Per-story fixture state, reset by every story's `render` below.
 *
 * These live outside the story bodies because they are read by the transport
 * stub at CALL time, which is what makes a story's frames a real request and
 * answer rather than a pre-baked DOM state.
 */
/** The bulk receipt's capability, per story: an old backend does not have it. */
let features: Record<string, number> = { completion_ack_bulk: 1 };
/** What `attention.seen` answers with. */
let ackReceipt: { read: unknown[]; superseded: string[]; unknown: string[] } = {
	read: [],
	superseded: [],
	unknown: [],
};
/** How the catalogue read behaves: the loading and error states are its two. */
let listState: "ready" | "pending" | "failed" = "ready";
/**
 * How `attention.seen` behaves, beyond its body: the in-flight and refused states
 * are the two the control is otherwise never photographed in.
 */
let ackState: "answering" | "never" | "refusing" = "answering";

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
	 * The two operations this surface reads, plus the two catalogues the ENTITY
	 * story needs, and anything else is refused BY NAME - a story that starts
	 * issuing an unknown call fails loudly instead of hanging on a promise nothing
	 * answers.
	 *
	 * `features.desktop_feed` is what gates the hook (`useDesktopFeed`), and
	 * `session_catalogue` 2 is what gates the sidebar itself; `session_search` is
	 * deliberately absent, which is how this fixture keeps the conversation search
	 * out of a frame about the row's status. `profile_catalogue` and
	 * `team_catalogue` are answered ONLY while `entities` is set, so the five
	 * stories that predate the entity one keep rendering exactly the panel they
	 * were shot in while the sixth renders the region above it (round 1, R1).
	 * Only the operations this surface reads, and anything else is refused BY
	 * NAME - a story that starts issuing a third call fails loudly instead of
	 * hanging on a promise nothing answers.
	 *
	 * `features.desktop_feed` is what gates the hook (`useDesktopFeed`), and
	 * `session_catalogue` 2 is what gates the sidebar itself; `profile_catalogue`,
	 * `team_catalogue` and `session_search` are deliberately absent, which is how
	 * this fixture keeps the entity pickers and the conversation search out of a
	 * frame about the row's status. `completion_ack_bulk` is the bulk read
	 * receipt's own key, and it is per-story state below rather than a constant:
	 * the whole point of one story here is a backend that does NOT advertise it.
	 *
	 * The two events this file is about are both present: a `sessions.list` read
	 * that CAN be pending or failed (the states where the control has no subject),
	 * and an `attention.seen` answer the story decides.
	 */
	desktop.request = async (request: { op: string }) => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						desktop_feed: 1,
						session_catalogue: 2,
						...features,
						...(entities ? { profile_catalogue: 1, team_catalogue: 1 } : {}),
					},
				});
			case "sessions.list":
				if (listState === "pending") return new Promise(() => undefined);
				if (listState === "failed")
					throw new Error("the backend stopped answering");
				return ok({ sessions: roster, truncated: false });
			case "profiles.list":
				return ok({
					profiles: (entities?.agents ?? []).map((name) => ({
						name,
						kind: "role",
						source: "builtin",
						agent_id: null,
						description: "",
						tools: null,
						effort: null,
						delegate: false,
					})),
				});
			case "teams.list":
				return ok({
					teams: (entities?.teams ?? []).map((name) => ({
						id: name,
						name,
						description: "",
						manager: name,
						members: [],
					})),
				});
			case "attention.seen":
				// The answer the story staged. Never generated from `roster`, because
				// the interesting cases are the answers that do NOT match what was sent
				// (a superseded token, a conversation the store never had) and the point
				// of the frames is what the sidebar does with them.
				if (ackState === "never") return new Promise(() => undefined);
				// A transport failure, not a refusal: the real `desktopRequest` wraps a
				// throw into the app's own "could not reach the backend process"
				// sentence, which is what the failure receipt has to answer.
				if (ackState === "refusing") throw new Error("Failed to fetch");
				return ok(ackReceipt);
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
const Readout: FC<{ rows?: number; tooltips?: boolean }> = ({
	rows,
	tooltips = false,
}) => {
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
	 * `max-h-[60%]` panel inside it, and the SMALLER the overflow the story exists
	 * to produce. Bounding the caption is what stops that column deciding, for the
	 * frame, how much of the list is off screen.
	 *
	 * It states what it left out rather than ending silently, so a caption can
	 * never read as a complete list it is not.
	 */
	const shown = rows === undefined ? sessions : sessions.slice(0, rows);
	/*
	 * The control, read off the DOM rather than re-derived from the same inputs the
	 * component used.
	 *
	 * A caption that re-implemented the gate could agree with itself while
	 * disagreeing with the screen, which is the one thing a caption in an evidence
	 * frame may not do. This asks the document for the element the control stamps
	 * itself with, so "absent" in a frame means the button is not there. It is
	 * measured in an effect rather than during render because the sidebar commits
	 * in the same pass: a render-time query would read the PREVIOUS document, and
	 * on a capability-absent story it would read an empty one that is about to
	 * have the sidebar in it.
	 */
	const [control, setControl] = useState("absent");
	/*
	 * The rows' COMPOSED tooltips, read off the document.
	 *
	 * A native `title` is not photographable, and the row tooltip is where this
	 * change puts the remedy clause — so without a surface for it the wording half
	 * of the change has no evidence in the app at all. Read from the DOM rather
	 * than rebuilt from the store for the reason the control line above gives: a
	 * caption that re-implemented the expression could agree with itself while
	 * disagreeing with the screen, and this caption exists precisely to be the
	 * thing that cannot.
	 *
	 * Every row button is read, in document order, because the composed string is
	 * per-row and its order is the list's: a caption naming only the fifth row's
	 * tooltip would say nothing about the four above it.
	 */
	const [rowTitles, setRowTitles] = useState<string[]>([]);
	/*
	 * The shed span's TREE MEMBERSHIP, which `textContent` cannot answer — the fact
	 * agent review round 2's R2-1 turned on. `display: none` text still reads
	 * through `textContent`, so a caption built on it reports the label present in a
	 * frame where no assistive technology can see it, and it read exactly the same
	 * before and after the shed became `sr-only`. This asks the sheet instead: the
	 * span carrying the label is out of the accessibility tree precisely when the
	 * document stops laying it out.
	 */
	const [labelTree, setLabelTree] = useState("no control");
	/*
	 * POLLED, not rendered-once. The sidebar's search field holds its query in its
	 * own state, so typing into it commits a new document WITHOUT re-rendering
	 * this sibling — and a readout that only re-measured when it rendered would
	 * keep saying "present" over a frame that has no control in it. The interval
	 * is the rig's, not the app's: nothing about the sidebar depends on it, and it
	 * exists so the caption cannot outlive the document it describes.
	 */
	useEffect(() => {
		const measure = () => {
			const element = document.querySelector('[data-tour-tag="mark-all-read"]');
			const next = element
				? `present ("${(element.textContent ?? "").trim()}"${element.getAttribute("aria-disabled") === "true" ? ", in flight" : ""})`
				: "absent";
			setControl((previous) => (previous === next ? previous : next));
			const label = element
				? [...element.querySelectorAll("span")].find((span) =>
						(span.textContent ?? "").startsWith("Mark all"),
					)
				: undefined;
			const tree = !element
				? "no control"
				: !label
					? "no label span"
					: getComputedStyle(label).display === "none"
						? "OUT of the accessibility tree (display:none)"
						: "in the accessibility tree";
			setLabelTree((previous) => (previous === tree ? previous : tree));
			/*
			 * THE TITLE READOUT IS OPT-IN, and that is a decision about the committed
			 * FRAMES rather than about this component.
			 *
			 * It exists because the remedy clause this change adds lives only in a native
			 * `title`, which is not photographable — so the surface needs a readout or the
			 * wording half of the change has no evidence at all. Printing it in EVERY feed
			 * story would grow every one of those captions by a line, and a caption taller
			 * than the frame its entry declares is clipped: nineteen story directories
			 * across twelve themes would have to be re-taken so that eighteen of them could
			 * show a line about a clause none of them is about. The story whose subject the
			 * tooltip is asks for it (`WedgedOwner`), and the rest keep the bytes they were
			 * reviewed at.
			 */
			if (tooltips) {
				/*
				 * `[data-chat-row]` narrowed to the elements that CARRY a composed title:
				 * the stamp is on every row-shaped control in the panel (`chat-sidebar.tsx`
				 * puts it on the bulk-read control and the catalogue rows too), and the
				 * subject here is the tooltip, which only a session row has.
				 */
				const titles = [...document.querySelectorAll("[data-chat-row]")]
					.filter((row) => row.hasAttribute("title"))
					.map((row) => row.getAttribute("title") ?? "(no title)");
				setRowTitles((previous) =>
					previous.length === titles.length &&
					previous.every((value, index) => value === titles[index])
						? previous
						: titles,
				);
			}
		};
		measure();
		const timer = setInterval(measure, 200);
		return () => clearInterval(timer);
		/*
		 * `tooltips` IS A DEPENDENCY because the effect reads it, and the interval is
		 * re-armed if it ever changes. It does not change within a story — it is a
		 * prop the story passes once — so the only thing the dependency buys is the
		 * rule holding rather than an exemption being carved for it.
		 */
	}, [tooltips]);
	return (
		<div className="w-[420px] shrink-0 space-y-3 border-l border-hairline p-4 text-meta text-ink-muted">
			<p className="text-ink">Row status as the sidebar reads it</p>
			{shown.map((row) => (
				<p key={row.session_id} data-readout-row>
					{row.title}: {row.status?.code ?? "(none)"} / “{row.status?.label}”
					{typeof row.status_revision === "number"
						? ` · revision ${row.status_revision} · epoch ${row.status_epoch ?? "(none)"}`
						: " · no feed stamp"}
					{/*
					 * `unread` means A MARK IS DRAWN, asked of the same predicate the row's
					 * glyph and the control's count ask. A row can carry the unseen LEVEL
					 * with nothing on screen to show for it — that is the state the
					 * absence-of-control frame is about — and it says so in its own words
					 * rather than leaving a reviewer to infer it from a missing mark.
					 */}
					{row.attention?.unseen
						? unreadMarkKind(row) !== null
							? " · unread"
							: " · unseen, no mark drawn"
						: ""}
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
			<p data-readout-control>
				Bulk read receipt: {control} · {unreadAckableCount(sessions)} unread
				row(s) it would name
			</p>
			<p data-readout-label>Action label: {labelTree}</p>
			{/*
			 * The composed row tooltips: the clause this change adds is only ever in a
			 * native `title`, so this line is what puts it in the frame. Opt-in — see
			 * the note in the measure effect.
			 */}
			{tooltips ? (
				<p data-readout-titles>
					Row tooltips:{" "}
					{rowTitles.length === 0
						? "(none on screen)"
						: rowTitles.map((title) => `“${title}”`).join(" · ")}
				</p>
			) : null}
		</div>
	);
};

const Page: FC<{
	readoutRows?: number;
	sidebarWidth?: number;
	tooltips?: boolean;
	/**
	 * The selected conversation, for the frames that must photograph a row on the
	 * `rowSelected` ground. It is the row's own id prefixed the way the sidebar's
	 * caller spells it (`session/<id>`), because that is what the row compares -
	 * a story that passed the bare id would select nothing and the frame would
	 * silently be a picture of the unselected state.
	 */
	selected?: string;
}> = ({ readoutRows, sidebarWidth = 360, tooltips = false, selected }) => (
	<div className={cn("flex h-screen overflow-hidden bg-canvas text-ink")}>
		{/*
		 * The width is a parameter because the panel is resizable between the app's
		 * own clamps (`chat-layout.tsx`), and the control's own shed fires on the
		 * WIDTH OF ITS ROW: a set captured only at 360px — the clamp's maximum — is
		 * structurally unable to photograph the state design round 1's blocker (D1)
		 * is about.
		 */}
		<div
			className="shrink-0 border-r border-hairline"
			style={{ width: `${sidebarWidth}px` }}
		>
			<ChatSidebar
				selectedConversation={selected}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
		<Readout rows={readoutRows} tooltips={tooltips} />
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
/** The session `WedgedOwner` photographs: a live pid whose beat stopped landing. */
const SILENT = "4d5e6f708192";

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
 * A runtime that is running but not answering, in the list that has to say so.
 *
 * THE ROW THIS FILE COULD NOT DRAW. `WEDGED` has been a fixture here since the
 * bulk receipt landed, but only as one row inside `MarkAllReadUnseenWithoutMark`,
 * where it is third of three and the story's subject is the absent control — so
 * the state the operator reported had no frame of its own anywhere in the app's
 * review set, while `error` had one in every roster that stages a failure.
 *
 * THE NEIGHBOUR IS THE POINT. The failed row sits directly under it, and before
 * this change the two drew the SAME mark in the SAME ink: `CircleAlert` in
 * `text-danger` for `wedged` and for `error` alike (`chat-session-status.tsx`),
 * which is what made an owner that had merely stopped reporting indistinguishable
 * from a turn that had actually broken. The pair is now separable without colour
 * — two horizontal waves against a ring with a bar and a dot.
 *
 * The label is the catalogue's own sentence, age and all, because the state's
 * words are the backend's (`session/catalog.py`'s `status`) and a fixture that
 * shortened them would photograph copy the app never shows (design D9).
 */
export const WedgedOwner: Story = {
	render: () => {
		fixtures();
		/*
		 * The subject FIRST and the mtimes descending with the order, like every
		 * roster here: the sidebar draws top-down, and a frame that does not contain
		 * the row the claim is about is not evidence about that row. `live_state`
		 * agrees with the code each row publishes, as the wire does — the row's mark
		 * is read from `status`, and a fixture whose two fields disagreed would be
		 * photographing a row the backend cannot produce.
		 */
		roster = [
			wireRow(
				SILENT,
				"Quiet owner (stale beat)",
				1_760_004_300,
				WEDGED_SILENT,
				3,
				undefined,
				undefined,
				{ live_state: "wedged" },
			),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_004_200, FAILED, 3),
			wireRow(
				RECONCILE,
				"Reconcile the supplier ledger",
				1_760_004_100,
				BUSY,
				2,
			),
		];
		/*
		 * The readout is asked for the tooltips HERE and in no other story: this is the
		 * one whose subject is the composed row tooltip, and its caption grows a line
		 * for it (see the note in the measure effect for why that is opt-in).
		 */
		return <Page tooltips />;
	},
	play: async () => {
		await catalogueSettled(3);
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
/* ------------------------------------------------------ mark all as read */

/*
 * The bulk read receipt, in the states a reviewer has to be able to tell apart.
 *
 * This is the same real tree the stories above drive — the real `ChatSidebar`,
 * carrying the real `ChatSessionStatus` and the real store — and the only thing
 * stubbed is the transport, so the control under test is the shipped one and its
 * click is a real click on a real button.
 *
 * The pile the operator reported is `MarkAllReadPile`: rows whose turn finished
 * while he was elsewhere, each with the green check the sidebar paints for an
 * unacknowledged completion.
 *
 * `MarkAllReadPartlyRead` is the state the receipt exists for. The backend
 * decides PER ITEM inside one transaction, and a conversation that completed
 * again between the render and the click is `superseded`: refused, nothing
 * written, still unread. A UI that cleared all three and said "all read" would
 * have silently acknowledged a result nobody saw, so this frame pairs the one
 * remaining check with the sentence that names it.
 *
 * `MarkAllReadCleared` is the pile with nothing left to clear, which is also the
 * state in which the control is GONE — an action with no subject.
 *
 * The three negatives are the states the control must not offer itself in: a
 * backend that does not advertise `completion_ack_bulk` (the pile is still
 * there, and the app is exactly as capable as the backend lets it be), a
 * catalogue read that failed, and an empty list. All three are ABSENCE frames,
 * which is why each carries the readout line that says so in words.
 *
 * Holding the shutter: the two click-driven stories set
 * `documentElement.dataset.capturePending` before the tree mounts and clear it
 * once the receipt is on screen, exactly as `canvas.stories.tsx` does, because
 * the capturer polls that flag. Without it a click-driven story is a race
 * between a request, a store commit, a toast and the shutter, and a frame taken
 * mid-flight is a picture of a state the user never sees (that file records both
 * halves of that failure).
 */

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
 *
 * THE SHUTTER OPENS AFTER THE LAST STEP, and that is the guarantee rather than a
 * detail: it used to open before the pair that produces the reorder this story is
 * NAMED for, so what the frame carried was the capturer's 200 ms poll happening
 * to land after the re-render rather than the latch doing its job (round 1, R4).
 * Two of the five stories already released last; this and the two below now do.
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
		roster = resortAfter();
		deliver(catalogueFrame(2, 73));
		await sleep(300);
		releaseShutter();
	},
};

/* ---------------------------------------- a completion that moves the TIME BIN */

/** `mtime` fixtures for the bin story are relative to the capture's own clock. */
const binNowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * The three rows the bin story starts from, in the order the backend sends
 * them: a TODAY row, the SUBJECT five days back (THIS WEEK, "5d") and one old
 * row - so all three time sections are on screen and the move is visible
 * against its neighbours.
 */
const binBefore = (): WireRow[] => {
	const now = binNowSeconds();
	return [
		wireRow(QUARTERLY, "Quarterly revenue model", now - 3_600, IDLE, 1),
		wireRow(MIGRATE, "Migrate the deploy script", now - 5 * 86_400, IDLE, 1),
		wireRow(AUDIT, "Audit the vendor list", now - 20 * 86_400, IDLE, 1),
	];
};

/**
 * The same three rows as the next `sessions.list` answers AFTER the turn: the
 * subject's activity clock is now, and every other field is byte-identical, so
 * this story isolates the BIN the way `CompletionReordered` isolates POSITION.
 */
const binAfter = (): WireRow[] => {
	const now = binNowSeconds();
	return [
		wireRow(QUARTERLY, "Quarterly revenue model", now - 3_600, IDLE, 1),
		wireRow(MIGRATE, "Migrate the deploy script", now - 60, IDLE, 1),
		wireRow(AUDIT, "Audit the vendor list", now - 20 * 86_400, IDLE, 1),
	];
};

/**
 * THE TIME BINS UNDER A COMPLETION (2026-09-28): the operator's own report, as
 * a feed story.
 *
 * The report: "even if I've asked an older session something today, once it
 * completes I can't see it within the today bin". The bins and the row labels
 * read the transcript's ACTIVITY clock (`updated_at`, the wire's `mtime`), and
 * a finished turn advances that clock - but no frame carries it: only a
 * `sessions.list` read does. The backend publishes a `catalogue` invalidation
 * when a completion moves the row's ORDER KEY, which covers the common case;
 * it CANNOT fire for one that moves no key (the subject already in its
 * completion band with the busy band missed), and there the row sat in its old
 * bin until the 30 s safety poll - measured live, 26.3 s after the completion,
 * on the installed runtime (this directory's README carries the readings).
 *
 * So the frames a finished turn ALWAYS publishes - the status edge and the
 * attention mark - are the ones this story delivers, and NO `catalogue` frame
 * is delivered at all: the next `sessions.list` answer is arranged BEFORE the
 * frames, the order the real system runs in. On this branch the sidebar
 * re-reads on the completion's own frames and the row lands under TODAY "now";
 * on the tree this branch was cut from the same frames leave it under THIS WEEK
 * "5d" until the poll - that half is what the live readings measure, since a
 * still cannot carry a latency.
 */
export const CompletionMovesBin: Story = {
	render: () => {
		roster = binBefore();
		return <Page />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(3);
		// The turn as the feed reports it: busy first, then the completion and its
		// mark. Neither is a `catalogue` frame, which is the point of the story.
		deliver(statusFrame(MIGRATE, BUSY, 4, 91));
		await sleep(200);
		roster = binAfter();
		deliver(statusFrame(MIGRATE, COMPLETE, 5, 92));
		deliver(attentionFrame(MIGRATE, true, 93));
		// Settle on the refile where the branch produces one, without failing the
		// capture where it does not: the base tree's frame is the defect state.
		//
		// BY THE FILE'S OWN ROW CONVENTION (design round 1, D2; corrected round 2,
		// R2-1): rows carry `[data-chat-row]` - a marker, not an id - and the
		// subject is found by its TEXT, the shape `scrollToRow` / `focusRow` use. The
		// first form of this lookup matched on a native `title`, which no session row
		// has carried since the row-space change (design D7), so it could never
		// break early and would not have noticed a regressed refile - the one thing
		// this story exists to observe.
		const sectionOfSubject = () =>
			[...document.querySelectorAll("[data-chat-row]")]
				.find((row) =>
					(row.textContent ?? "").trim().includes("Migrate the deploy script"),
				)
				?.closest("[data-chat-section]")
				?.getAttribute("data-chat-section") ?? null;
		for (let waited = 0; waited < 2_000; waited += 50) {
			if (sectionOfSubject() === "today") break;
			await sleep(50);
		}
		await sleep(200);
		releaseShutter();
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
		// The band of two, not the band of one before it: the shutter opens on the
		// state this story is named for (round 1, R4).
		releaseShutter();
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
		// Both moves are behind the shutter: this story's subject is the SETTLED
		// state of the round trip, and releasing after the first move photographed a
		// state the story is not named for (round 1, R4).
		releaseShutter();
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

/* ---------------------------------------- the region above the list, measured */

/**
 * Scroll the container that holds a row so the row sits `below` px below its
 * upper edge - the state a reader is in when the row they are on moves UP out of
 * the panel, which is the state every measurement below needs and the reason the
 * walk in the rig reports the room it had.
 *
 * The mirror of `scrollToRow`, which puts a row above the head: choosing the
 * offset rather than the bottom is what makes the ROOM a property of the roster
 * instead of of the panel's height, and the room is the one thing a geometry
 * claim has to state before its number means anything.
 */
const scrollRowBelowHead = (title: string, below: number) => {
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
			const offset =
				row.getBoundingClientRect().top -
				node.getBoundingClientRect().top +
				node.scrollTop;
			node.scrollTop = Math.max(0, offset - below);
			return;
		}
		node = node.parentElement;
	}
	throw new Error(`${title} is not inside a scrolling container`);
};

/**
 * Leave a row's box `over` px past the container's LOWER clip edge.
 *
 * The mirror of `scrollRowBelowHead`, which chooses an offset measured from the
 * container's head: this one chooses the row's distance past the FOOT, so a row at
 * the END of the content can be left partly visible rather than flush at the
 * container's maximum. That is the resting position U6/D3 filed, and the one the
 * browser's own focus scroll lands whenever the row pitch and the panel height
 * disagree by a fraction.
 *
 * The box is computed against the container's PADDING box, which is the box a
 * scroll container clips at - the same correction `clipBox` makes in the app.
 */
const scrollRowPastFoot = (title: string, over: number) => {
	const row = [...document.querySelectorAll("[data-chat-row]")].find((node) =>
		(node.textContent ?? "").trim().includes(title),
	);
	if (!row) throw new Error(`no row titled ${title} to scroll past the foot`);
	let node = row.parentElement;
	while (node && node !== document.body) {
		const scrolls = ["auto", "scroll"].includes(
			getComputedStyle(node).overflowY,
		);
		if (scrolls && node.scrollHeight > node.clientHeight + 8) {
			const top =
				row.getBoundingClientRect().top -
				node.getBoundingClientRect().top -
				node.clientTop +
				node.scrollTop;
			const height = row.getBoundingClientRect().height;
			node.scrollTop = Math.min(
				Math.max(top + height - node.clientHeight - over, 0),
				node.scrollHeight - node.clientHeight,
			);
			return;
		}
		node = node.parentElement;
	}
	throw new Error(`${title} is not inside a scrolling container`);
};

/** Put keyboard focus on a row, and fail loudly if it did not land. */
const focusRow = (title: string) => {
	const row = [...document.querySelectorAll("[data-chat-row]")].find((node) =>
		(node.textContent ?? "").trim().includes(title),
	);
	if (!row) throw new Error(`no row titled ${title} to focus`);
	if (typeof (row as HTMLElement).focus !== "function")
		throw new Error(`${title} is not a focusable row`);
	(row as HTMLElement).focus();
	/*
	 * Asserted at the source, because the stories that use this are ABOUT the
	 * cursor: one that believed it had focused a row and had not would measure a
	 * container with no cursor in it, and pass.
	 */
	if (document.activeElement !== row)
		throw new Error(`focus did not land on ${title}`);
};

/**
 * Wait for a condition rather than for a clock, so a story depends on the thing
 * it needs having arrived. The profiles and the sessions land on two separate
 * queries, and a click that fires before the second one has rendered throws a
 * message that reads like a bad selector rather than like a race.
 */
const until = async (what: string, ready: () => boolean, ms = 4000) => {
	const started = Date.now();
	while (Date.now() - started < ms) {
		if (ready()) return;
		await sleep(50);
	}
	throw new Error(`timed out waiting for ${what}`);
};

/**
 * Open an entity's disclosure, through the entity's own control.
 *
 * The lookup reads the row's NAME span rather than its `textContent`, and that is
 * not tidiness: the row draws its own child count in a sibling span, so the
 * button's text content is "coder16" for an entity with sixteen chats - which is
 * what a `textContent` comparison was silently comparing against until this story
 * said `no entity named coder` over a row that was on screen.
 */
const expandEntity = (name: string) => {
	const row = [...document.querySelectorAll("[data-entity-name]")].find(
		(node) =>
			(node.querySelector("span.min-w-0")?.textContent ?? "").trim() === name,
	);
	if (!row) throw new Error(`no entity named ${name} to expand`);
	const disclosure = row.parentElement?.querySelector("[data-disclosure]");
	if (!(disclosure instanceof HTMLElement))
		throw new Error(`the ${name} row has no disclosure control`);
	disclosure.click();
};

/** A group of nested rows: names and ids generated, so the roster stays readable. */
const nestedGroup = (
	prefix: string,
	label: string,
	count: number,
	base: number,
	binding: { agent: string | null; team: string | null },
): WireRow[] =>
	Array.from({ length: count }, (_, index) =>
		wireRow(
			`${prefix}${String(index + 1).padStart(3, "0")}`,
			`${label} ${index + 1}`,
			base - index * 100,
			BUSY,
			60 + index,
			binding,
		),
	);

const NESTED_AGENT = "scout";

/**
 * THE REGION ABOVE THE LIST, MEASURED RATHER THAN ASSUMED (review round 1, R1).
 *
 * The first pass said this region "needs nothing" because nothing in it re-files
 * on a catalogue event, and that is false: an entity's CHILDREN are session rows
 * (`sessionRow(row, true)` over `children()`), drawn from the same `matching`
 * array as the list, so a completion moves a nested row's slot on exactly the
 * same order-key change - inside a container that kept `overflow-anchor: auto`.
 * The finding was a code-level one because no story rendered an entity at all
 * (the fixture answered neither catalogue), so the measurement is what this
 * story exists to produce; it is not swept, because it is a fixture for a
 * number rather than a state a frame should carry.
 *
 * The roster is shaped for the measurement rather than for a picture: groups
 * BEFORE the completer's so its slot has room above it, and a group AFTER so the
 * region still has content below, because a drag can only be seen where the
 * container had the room to be dragged (see the rig's BLIND rule).
 */
const nestedBefore = (): WireRow[] => [
	...nestedGroup("f1a203", "Size the search index", 8, 1_760_050_900, {
		agent: NESTED_AGENT,
		team: null,
	}),
	wireRow(MIGRATE, "Migrate the deploy script", 1_760_050_000, BUSY, 2, {
		agent: NESTED_AGENT,
		team: null,
	}),
	...nestedGroup("f2b304", "Sketch the migration", 6, 1_760_049_700, {
		agent: "architect",
		team: null,
	}),
	...nestedGroup("f3c405", "Trace the slow endpoint", 8, 1_760_048_900, {
		agent: "coder",
		team: null,
	}),
	...nestedGroup("f4d506", "Check the vendor list", 21, 1_760_047_500, {
		agent: null,
		team: "quality",
	}),
];

/** The same rows with the completer leading its OWN group, which is where the
 *  next read files it - the entity's children are that entity's rows, in the
 *  catalogue's order, so the row moves to the head of the group it belongs to. */
const nestedAfter = (): WireRow[] => [
	wireRow(MIGRATE, "Migrate the deploy script", 1_760_050_000, BUSY, 2, {
		agent: NESTED_AGENT,
		team: null,
	}),
	...nestedGroup("f1a203", "Size the search index", 8, 1_760_050_900, {
		agent: NESTED_AGENT,
		team: null,
	}),
	...nestedGroup("f2b304", "Sketch the migration", 6, 1_760_049_700, {
		agent: "architect",
		team: null,
	}),
	...nestedGroup("f3c405", "Trace the slow endpoint", 8, 1_760_048_900, {
		agent: "coder",
		team: null,
	}),
	...nestedGroup("f4d506", "Check the vendor list", 21, 1_760_047_500, {
		agent: null,
		team: "quality",
	}),
];

export const CompletionReorderedNested: Story = {
	render: () => {
		entities = {
			agents: [NESTED_AGENT, "architect", "coder"],
			teams: ["quality"],
		};
		roster = nestedBefore();
		return <Page readoutRows={4} />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(44);
		/* Two waits, not one: the profiles arrive on their own query, and the
		   entity's children only exist once its disclosure has opened. */
		await until(
			"the three entities",
			() => document.querySelectorAll("[data-entity-name]").length >= 3,
		);
		/*
		 * EVERY group is opened, not just the completer's. The entity region only
		 * scrolls when its content exceeds it, and a measurement of what a scroll
		 * container does needs one that can scroll at all - so the fixture opens
		 * the four groups the roster fills, which is also the state the region is
		 * in when a reader has been through their agents.
		 */
		for (const name of [NESTED_AGENT, "architect", "coder", "quality"])
			expandEntity(name);
		await until(
			"every group's children",
			() => document.querySelectorAll("[data-child]").length >= 43,
		);
		/* An offset with room on both sides of the re-filing row: the measurement
		   below is only a measurement while the container could have been dragged
		   by the row's travel (the rig's BLIND rule). */
		/*
		 * The completer just ABOVE the region's head, with room on both sides of it,
		 * which is the shape the operator's own report reproduced in the list panel
		 * (and the one `CompletionReorderedOffscreen` uses there). Positioned
		 * relative to the row rather than to a fraction of the overflow, because the
		 * measured drag is a property of where the MOVING ROW sits against the
		 * viewport: QA's sweep found the drag at one scroll position and none at
		 * five others, and a fixture at an arbitrary offset would measure the
		 * absence and call it the container.
		 *
		 * Re-applied after a beat, because the rig resizes the viewport to the height
		 * the frame would be shot at and this region's overflow is a function of that
		 * height: a single application raced the resize and left the region at the
		 * offset the 660 px layout implies.
		 */
		scrollToRow("Migrate the deploy script");
		await sleep(500);
		scrollToRow("Migrate the deploy script");
		await sleep(250);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 101));
		deliver(attentionFrame(MIGRATE, true, 102));
		await sleep(300);
		roster = nestedAfter();
		deliver(catalogueFrame(2, 103));
		await sleep(400);
		releaseShutter();
	},
};

/* ------------------------------------ a second move in the same container */

/**
 * TWO MOVES, IN A CONTAINER WITH THE ROOM TO SHOW BOTH (review round 1, R2).
 *
 * The committed `completion-acknowledged` story is the round trip on a list that
 * FITS its panel, so neither move can move a viewport and the assertion has
 * nothing to see - while the rig's first version reported the pair as "0 px
 * against null px of row travel", because it compared the pre-move sample with
 * the settled one and the two moves cancelled. This story is the same round trip
 * in the overflowing roster, where both moves have the room to drag: it is what
 * turns "the instrument cannot see a two-move story" into a FAIL on a stashed
 * rule rather than a comfortable zero. Not swept: the pair it belongs to is
 * already framed, and this one is a measurement.
 */
export const CompletionAcknowledgedOffscreen: Story = {
	render: () => {
		roster = overflowingBefore();
		return <Page readoutRows={8} />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(22);
		await sleep(250);
		scrollToRow("Migrate the deploy script");
		await sleep(250);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 91));
		deliver(attentionFrame(MIGRATE, true, 92));
		await sleep(300);
		roster = overflowingAfter();
		deliver(catalogueFrame(2, 93));
		await sleep(400);
		/* The read receipt: the mark rests, and the backend re-files the row into
		   the resting band - the second move, downwards, on the same container. */
		deliver(attentionFrame(MIGRATE, false, 94));
		roster = [
			...RESORT_WORKING.map(([id, name, mtime], index) =>
				wireRow(id, name, mtime, BUSY, 20 + index),
			),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_020_100, COMPLETE, 3),
			...restingRows(),
		];
		deliver(catalogueFrame(3, 95));
		await sleep(400);
		releaseShutter();
	},
};

/* ------------------------------------------- the cursor on the row that moves */

/**
 * THE KEYBOARD CASE (review round 1, U1): the cursor is ON the row that re-files.
 *
 * With the container holding its position, the row the cursor is on can leave the
 * panel - and the next arrow press then focuses the neighbouring row and lets the
 * browser's own scroll-into-view pay for the distance, which measured as a 386 px
 * jump to the top of the band. The fix is that the container follows the row the
 * CURSOR is on, by the minimum, and this story is the replay: the completer's
 * whole group is below it, so its re-file is a long move out of the panel.
 *
 * The rig presses ArrowDown on its own once it has seen the re-file (see its
 * `KEY_AFTER_REFILE_MS`), because the press is the thing being measured and a
 * story that pressed it itself would be reporting its own arithmetic.
 */
export const CompletionKeyboardRefile: Story = {
	render: () => {
		roster = [
			...RESORT_WORKING.map(([id, name, mtime], index) =>
				wireRow(id, name, mtime, BUSY, 20 + index),
			),
			...restingRows(),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_020_100, BUSY, 2),
		];
		return <Page readoutRows={8} />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(22);
		await sleep(250);
		/* The cursor at the BOTTOM of a long band: the state the report is about,
		   and the one where the row's own travel is longer than the panel. */
		scrollRowBelowHead("Migrate the deploy script", 360);
		await sleep(250);
		focusRow("Migrate the deploy script");
		await sleep(150);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 91));
		deliver(attentionFrame(MIGRATE, true, 92));
		await sleep(300);
		roster = [
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_020_100, BUSY, 2),
			...RESORT_WORKING.map(([id, name, mtime], index) =>
				wireRow(id, name, mtime, BUSY, 20 + index),
			),
			...restingRows(),
		];
		deliver(catalogueFrame(2, 93));
		/* The rig presses the arrow inside this window; the shutter stays closed
		   until it has, so the same story can be swept later without a change. */
		await sleep(1200);
		releaseShutter();
	},
};

/* ------------------------------------------- the gate's two edges, as rig cells */

/**
 * THE GATE'S NEGATIVE, LIVING IN THE SAME FIXTURE AS THE POSITIVE (round 3).
 *
 * `completion-reordered-offscreen` measures the reader who is somewhere else in
 * the list with NO cursor in the panel, which cannot separate the two mechanisms
 * that hold it: the `overflow-anchor: none` declaration, and the focus rule's gate
 * refusing to follow a row the reader scrolled away. This story puts a CURSOR on
 * the row that re-files and then takes the reader's own scroll past it, so the
 * gate is asked the question it exists for - the record says the row was already
 * off screen before the change landed, so the container must not move.
 *
 * Its twin is `completion-cursor-partly-clipped` immediately below: same roster,
 * same re-file, same cursor, and the only difference is whether the cursor's row
 * was still PARTLY on screen when the change landed. The pair is what states the
 * rule's three states in a browser rather than in prose, and the rig asserts each
 * one on its own claim (`scripts/sidebar-resort-geometry.mjs`).
 */
export const CompletionReaderScrolledAway: Story = {
	render: () => {
		roster = overflowingBefore();
		return <Page readoutRows={8} />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(22);
		await sleep(250);
		focusRow("Migrate the deploy script");
		await sleep(150);
		/* The reader's own move, and it is a SCROLL rather than a keypress: the panel
		   is taken past the cursor's row, so that row is above the head - the position
		   a completion must leave alone. It fires a real `scroll`, which is the input
		   the record is refreshed on.

		   The 40 px is chosen rather than arbitrary: the rig reports a move BLIND
		   when the room above or below the viewport is smaller than the row's travel,
		   because a drag could then have been clamped away and a zero would prove
		   nothing. A row 40 px above the head still leaves both rooms (240 px above,
		   111 px below) larger than the mover's 96 px, so a correction here would have
		   been visible had the gate fired. */
		scrollToRow("Migrate the deploy script", 40);
		await sleep(300);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 91));
		deliver(attentionFrame(MIGRATE, true, 92));
		await sleep(300);
		roster = overflowingAfter();
		deliver(catalogueFrame(2, 93));
		await sleep(400);
		releaseShutter();
	},
};

/**
 * THE STATE U6 AND D3 FILED (round 3): the cursor's row is PARTLY past the panel's
 * lower edge when the re-file takes it the rest of the way out.
 *
 * This is the app's own resting position rather than a contrived one: the
 * browser's focus scroll lands a row flush with the clip edge whenever the row
 * pitch and the panel height disagree by a fraction, and the UX stream's census
 * found 2 of 19 landings strictly outside by 0.5 px. Under a two-state record that
 * row read as `outside` before the change, so the correction refused and the
 * reader was left with a focused row 185 px above the panel - a cursor they could
 * not see, on the same panel the U1 guarantee is about.
 *
 * The roster and the re-file are `completion-keyboard-refile`'s, deliberately:
 * the ONLY difference is where the reader left the panel, so a difference in the
 * two measurements is the rule's own.
 */
export const CompletionCursorPartlyClipped: Story = {
	render: () => {
		roster = [
			...RESORT_WORKING.map(([id, name, mtime], index) =>
				wireRow(id, name, mtime, BUSY, 20 + index),
			),
			...restingRows(),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_020_100, BUSY, 2),
		];
		return <Page readoutRows={8} />;
	},
	play: async () => {
		holdShutter();
		await catalogueSettled(22);
		await sleep(250);
		scrollRowBelowHead("Migrate the deploy script", 360);
		await sleep(150);
		focusRow("Migrate the deploy script");
		await sleep(150);
		/* The reader's own nudge, and it is the exact shape U6/D3 filed: the cursor's
		   row is left 19 px past the lower clip edge - on screen, partly - which is the
		   state the record has to carry as `partly` for the arrival to be followed. */
		scrollRowPastFoot("Migrate the deploy script", 19);
		await sleep(300);
		deliver(statusFrame(MIGRATE, COMPLETE, 3, 91));
		deliver(attentionFrame(MIGRATE, true, 92));
		await sleep(300);
		roster = [
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_020_100, BUSY, 2),
			...RESORT_WORKING.map(([id, name, mtime], index) =>
				wireRow(id, name, mtime, BUSY, 20 + index),
			),
			...restingRows(),
		];
		deliver(catalogueFrame(2, 93));
		await sleep(1200);
		releaseShutter();
	},
};

/* ----------------------------- a title long enough to reach the row's end */

/**
 * THE ROW'S TITLE BOX, ON A TITLE THAT ACTUALLY REACHES IT.
 *
 * The operator's reason for removing the per-row browser control was the space
 * it held (`docs/evidence/chat-sidebar-browser-mark-baseline/README.md`), and the
 * only artifact that ever stated that cost was the deleted
 * `browser-conversation-mark--slot-cost` specimen: a caption reading "title 240px
 * without the mark, 212px with it". The three states the baseline set re-captured
 * cannot stand in for it - their titles end at x 180-207 while the slot begins at
 * x 332, so the reserved 28px is invisible in them and the claim lived in prose
 * (design round 1, D1).
 *
 * This state is that measurement in pixels: one row whose title is long enough to
 * TRUNCATE at this panel's own width, so the `truncate` ellipsis sits where the
 * box ends and the box's own edge is the thing the frame is about. Before/after
 * are the same story on two trees (the before half is in
 * `chat-sidebar-browser-mark-baseline/truncating-title/`, this half in the live
 * set), which is the pair the deletion's width claim is judged on - and the
 * difference between the two ellipsis positions IS the reclaimed width.
 *
 * It lives in THIS file because on the tree the before half is captured from,
 * this is the only story file whose page passes the summary map the mark reads
 * (`browserSummaries={markFixtures}`, an empty `Map` by default, which the base
 * tree's `browserMarkFor` still draws a quiet Globe from). The other states here
 * photograph the feed's transitions; this one photographs the row's geometry,
 * and the two are the same component at the same width.
 */
const LEDGER_LONG = "5e6f708192a3";

/** Long enough to truncate in BOTH halves, so what the frame compares is where
    the ellipsis lands rather than whether there is one. */
const LEDGER_LONG_TITLE =
	"Reconcile the supplier ledger against the quarterly revenue model and the regional forecast";

export const TruncatingTitle: Story = {
	render: () => {
		roster = [
			wireRow(LEDGER_LONG, LEDGER_LONG_TITLE, 1_760_030_300, BUSY, 8),
			wireRow(
				RECONCILE,
				"Reconcile the supplier ledger",
				1_760_030_200,
				BUSY,
				7,
			),
			wireRow(MIGRATE, "Migrate the deploy script", 1_760_030_100, IDLE, 1),
		];
		return <Page />;
	},
	play: async () => {
		/* The list is the subject, so the shutter waits only for it: no frame is
		   delivered, and the rows keep the catalogue's own stamps. */
		await catalogueSettled(3);
		await sleep(300);
	},
};
/**
 * Wait for a condition on the real store, with the same budget the catalogue
 * wait above uses: a fixed sleep is a bet on how busy the host is, and this file
 * is run on a laptop alongside other agent sessions.
 */
const waitFor = async (
	predicate: () => boolean,
	timeoutMs = 4_000,
): Promise<boolean> => {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate()) return true;
		await sleep(50);
	}
	return predicate();
};

/** The rows this surface's pile is made of, newest first. */
const PILE = [
	["a1b2c3d4e5f6", "Reconcile the supplier ledger"],
	["b2c3d4e5f6a7", "Quarterly revenue model"],
	["c3d4e5f6a7b8", "Migrate the deploy script"],
] as const;

/**
 * The operator's pile: three finished turns, none of them acknowledged.
 *
 * `COMPLETE` with `unseen` is the green check the report is about — the row's
 * status is still "Complete" once the mark rests, which is why
 * `ChatSessionStatus` keys its glyph on `complete && unseen` rather than on the
 * code alone.
 */
const pileRoster = () =>
	PILE.map(([id, name], index) =>
		wireRow(
			id,
			name,
			1_760_000_300 - index * 100,
			COMPLETE,
			2,
			undefined,
			unseenAt(id),
		),
	);

/**
 * The pile the operator described, deep enough to scroll — his own sidebar reads
 * "Active chats 38", and the header row's reachability is a claim about a list
 * longer than the box that holds it.
 */
const pileRows = Array.from({ length: 14 }, (_, index) => ({
	id: `${(index + 1).toString(16).padStart(2, "0")}b2c3d4e5f6`,
	name: `Finished turn ${index + 1}`,
}));

/** The control, as a real click on the real button. */
const clickMarkAllRead = () => {
	const control = document.querySelector<HTMLButtonElement>(
		'[data-tour-tag="mark-all-read"]',
	);
	if (!control)
		throw new Error("the mark-all-as-read control is not on screen");
	control.click();
};

/** Reset every per-story fixture knob, so a page load cannot inherit one. */
const fixtures = (
	over: Partial<{
		features: Record<string, number>;
		receipt: { read: unknown[]; superseded: string[]; unknown: string[] };
		list: "ready" | "pending" | "failed";
		ack: "answering" | "never" | "refusing";
	}> = {},
) => {
	features = over.features ?? { completion_ack_bulk: 1 };
	ackReceipt = over.receipt ?? { read: [], superseded: [], unknown: [] };
	listState = over.list ?? "ready";
	ackState = over.ack ?? "answering";
};

export const MarkAllReadPile: Story = {
	render: () => {
		/*
		 * A READ-FOR-ALL answer, so the frame a reviewer is most likely to click
		 * behaves like the pile it depicts: the shipped fixture answered an empty
		 * receipt, which produced the warning toast "Nothing was cleared." while the
		 * three checks stayed green and read as a defect (UX round 1, N1). A frame is
		 * not a printout only.
		 */
		fixtures({
			receipt: {
				read: [
					readAt("a1b2c3d4e5f6"),
					readAt("b2c3d4e5f6a7"),
					readAt("c3d4e5f6a7b8"),
				],
				superseded: [],
				unknown: [],
			},
		});
		roster = pileRoster();
		return <Page />;
	},
	play: async () => {
		await catalogueSettled(PILE.length);
		// The readout measures the DOM in an effect, so the frame is only honest
		// once that effect has run and the rows have painted their checks.
		await sleep(300);
	},
};

/*
 * THE REPORTED DEFECT, photographed: rows carrying `unseen` that draw NO mark.
 *
 * A session whose turn finished and is now waiting on its subagents, one parked
 * on an approval, and one whose runtime stopped answering all still carry the
 * completion LEVEL — `unseen` is cleared by an acknowledgement and by nothing
 * else, and resuming a session does not acknowledge it — while the runtime
 * publishes `busy` / `approval` / `wedged` for them, because a mark must never be
 * painted over what a row is doing NOW.
 *
 * The claim in this frame is an ABSENCE, so the readout beside the sidebar states
 * the control's own state in words: no control beside the group heading, and
 * `0 unread row(s) it would name`, with each row's `unseen` printed next to the
 * `no mark drawn` note that explains why the two disagree. Before this change the
 * same roster offered `Mark all 3 read` over three rows with nothing to read —
 * and a click acknowledged completions the reader was never shown, which no
 * later state can undo, because an acknowledgement is the only thing that clears
 * `unseen`.
 */
export const MarkAllReadUnseenWithoutMark: Story = {
	render: () => {
		fixtures();
		roster = [
			wireRow(
				"b1c2d3e4f5a6",
				"Reconcile the supplier ledger",
				1_760_000_500,
				BUSY,
				3,
				undefined,
				unseenAt("b1c2d3e4f5a6"),
				{ live_state: "busy" },
			),
			wireRow(
				"c2d3e4f5a6b7",
				"Migrate the deploy script",
				1_760_000_400,
				APPROVAL,
				3,
				undefined,
				unseenAt("c2d3e4f5a6b7"),
				{ pending: "approval" },
			),
			wireRow(
				"d3e4f5a6b7c8",
				"Quarterly revenue model",
				1_760_000_300,
				WEDGED,
				3,
				undefined,
				unseenAt("d3e4f5a6b7c8"),
				{ live_state: "wedged" },
			),
		];
		return <Page />;
	},
	play: async () => {
		await catalogueSettled(3);
		/*
		 * The absence is ASSERTED rather than eyeballed. A frame of a sidebar with no
		 * control beside it is evidence only if the control could have been there —
		 * which is what this roster is: every row carries `unseen` AND a token, the
		 * exact state the count used to read, so a predicate that had not changed
		 * would draw the control here.
		 */
		const unseen = useCanonicalSessionsStore
			.getState()
			.sessions.filter((row) => row.attention?.unseen === true);
		if (unseen.length !== 3)
			throw new Error(
				`the roster carries ${unseen.length} unseen rows, so the frame is about nothing`,
			);
		if (document.querySelector('[data-tour-tag="mark-all-read"]') !== null)
			throw new Error(
				"the bulk control is on screen over rows that draw no mark",
			);
		const stated = await waitFor(() =>
			Boolean(
				document
					.querySelector("[data-readout-control]")
					?.textContent?.includes("absent · 0 unread row(s) it would name"),
			),
		);
		if (!stated)
			throw new Error(
				"the readout never reported the absent control and its zero count",
			);
		// The readout measures the DOM in an effect, so the frame is only honest
		// once that effect has run and the rows have painted their spinners.
		await sleep(300);
	},
};

/*
 * THE MARKS THE COUNT KEEPS, and the one class no other frame in this set shows.
 *
 * `unreadMarkKind` counts `complete`, `error` and `interrupted` — the three codes
 * the runtime publishes while an unread completion stands — and the failure pair
 * is the half a reader is least able to check afterwards: an `error` row draws the
 * alert glyph and its danger ink whether it is unread or acknowledged, so clearing
 * it moves no pixel OF THE ROW; what moves is the section it sits in (the wire's
 * `active` is `pending || unseen || live_state`) and the label behind the tooltip
 * ("Unseen error" -> "Error"). This frame is where that trade is visible, and it
 * is why the story exists rather than the sentence alone (design D3): three rows
 * drawing marks the control counts, and a busy row carrying the SAME unread state
 * that it must not count.
 */
export const MarkAllReadMixedMarks: Story = {
	render: () => {
		fixtures({
			/*
			 * A READ-FOR-ALL answer, so the frame a reviewer is most likely to click
			 * behaves like the state it depicts: the three marks the label names are the
			 * three the receipt clears, and the busy row is neither counted nor sent.
			 */
			receipt: {
				read: [readAt(RECONCILE), readAt(QUARTERLY), readAt(MIGRATE)],
				superseded: [],
				unknown: [],
			},
		});
		roster = [
			wireRow(
				RECONCILE,
				"Reconcile the supplier ledger",
				1_760_001_400,
				COMPLETE,
				3,
				undefined,
				unseenAt(RECONCILE),
			),
			wireRow(
				QUARTERLY,
				"Quarterly revenue model",
				1_760_001_300,
				FAILED,
				3,
				undefined,
				{ ...unseenAt(QUARTERLY), kind: "error" },
			),
			wireRow(
				MIGRATE,
				"Migrate the deploy script",
				1_760_001_200,
				STOPPED,
				3,
				undefined,
				{ ...unseenAt(MIGRATE), kind: "interrupted" },
			),
			wireRow(
				AUDIT,
				"Audit the deploy script",
				1_760_001_100,
				BUSY,
				3,
				undefined,
				unseenAt(AUDIT),
				{ live_state: "busy" },
			),
		];
		return <Page />;
	},
	play: async () => {
		await catalogueSettled(4);
		/*
		 * The three claims the frame makes, asserted against the store rather than
		 * described in a caption: the control counts exactly the three rows that draw a
		 * mark, the busy row carries the unread state the state is ABOUT, and it is not
		 * drawing a mark. A fixture that dropped the attention state would photograph
		 * something much easier than this state.
		 */
		const sessions = useCanonicalSessionsStore.getState().sessions;
		const counted = unreadAckableCount(sessions);
		if (counted !== 3)
			throw new Error(
				`the control counts ${counted} rows, not the three that draw a mark`,
			);
		const busy = sessions.find((row) => row.session_id === AUDIT);
		if (busy?.attention?.unseen !== true)
			throw new Error(
				"the busy row does not carry the unread state this frame is about",
			);
		if (unreadMarkKind(busy) !== null)
			throw new Error(
				"the busy row is drawing a mark, so the frame is not the exclusion it claims",
			);
		const stated = await waitFor(() =>
			Boolean(
				document
					.querySelector("[data-readout-control]")
					?.textContent?.includes('present ("Mark all 3 read")'),
			),
		);
		if (!stated)
			throw new Error(
				"the readout never reported the control and the three rows it would name",
			);
		// The readout measures the DOM in an effect, so the frame is only honest once
		// that effect has run and the rows have painted their marks.
		await sleep(300);
	},
};

/*
 * The two widths the app's own clamps make reachable, and the state the click
 * spends its time in.
 *
 * `chat-layout.tsx` clamps the chat list at 240/288/360 with 280 as the default
 * preference, and the header row is 17px narrower than the panel
 * (240/288/360 -> 223/271/343). The control's label sheds on the ROW's width, so
 * these three are the whole shed story: full at 280 and 360, glyph-only at 240.
 * The in-flight state is the one a click passes through on every use and the one
 * an irreversible write most needs to be honest in.
 */
export const MarkAllReadScrolled: Story = {
	render: () => {
		/*
		 * The operator's own shape: a pile deep enough to scroll, at the far end of
		 * which the control used to be 632px ABOVE the marks it clears (design D2).
		 * The header row is sticky inside the group's scroll box now, so the control
		 * travels with the pile rather than waiting at the top of it — which is a
		 * claim only a scrolled frame can make.
		 */
		holdShutter();
		fixtures({
			receipt: {
				read: pileRows.map((row) => readAt(row.id)),
				superseded: [],
				unknown: [],
			},
		});
		roster = pileRows.map((row, index) =>
			wireRow(
				row.id,
				row.name,
				1_760_000_300 - index * 100,
				COMPLETE,
				2,
				undefined,
				unseenAt(row.id),
			),
		);
		return <Page />;
	},
	play: async () => {
		try {
			await catalogueSettled(pileRows.length);
			const scroller = document.querySelector<HTMLElement>(
				"div.max-h-\\[45\\%\\]",
			);
			if (!scroller) throw new Error("the group scroll box is not on screen");
			scroller.scrollTop = scroller.scrollHeight;
			await sleep(300);
			if (scroller.scrollTop === 0)
				throw new Error("the pile did not scroll, so the frame proves nothing");
		} catch (error) {
			releaseShutter();
			throw error;
		}
		releaseShutter();
	},
};

export const MarkAllReadNarrowDefault: Story = {
	render: () => {
		fixtures();
		roster = pileRoster();
		return <Page sidebarWidth={280} />;
	},
	play: async () => {
		await catalogueSettled(PILE.length);
		await sleep(300);
	},
};

export const MarkAllReadNarrowMinimum: Story = {
	render: () => {
		fixtures();
		roster = pileRoster();
		return <Page sidebarWidth={240} />;
	},
	play: async () => {
		await catalogueSettled(PILE.length);
		await sleep(300);
	},
};

export const MarkAllReadFiltered: Story = {
	render: () => {
		/*
		 * R4's case, photographed: a filter is typed, one unread row is left on
		 * screen, and the control is ABSENT. The set it clears is the store's, so
		 * under a filter it would move marks the reader cannot see — an irreversible
		 * write whose extent is invisible is not offered at all.
		 */
		holdShutter();
		fixtures();
		roster = pileRoster();
		return <Page />;
	},
	play: async () => {
		try {
			await catalogueSettled(PILE.length);
			const field = document.querySelector<HTMLInputElement>(
				'input[placeholder*="Search"]',
			);
			if (!field) throw new Error("the search field is not on screen");
			/*
			 * The value goes in through the prototype's own setter so React's own
			 * change tracking sees it, which is the same route a real keystroke takes.
			 */
			const setValue = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setValue?.call(field, "ledger");
			field.dispatchEvent(new Event("input", { bubbles: true }));
			await sleep(400);
			if (document.querySelector('[data-tour-tag="mark-all-read"]') !== null)
				throw new Error("the control is offered under a filter");
			const rows = document.querySelectorAll("[data-chat-row]");
			if (rows.length === 0) throw new Error("the filter left no rows");
			/*
			 * The frame's own caption has to agree with its pixels. A readout still saying
			 * "present" would put a contradiction INSIDE the evidence, which is worse than
			 * having no caption at all — so the story fails rather than shipping it.
			 */
			const agreed = await waitFor(() =>
				(
					document.querySelector("[data-readout-control]")?.textContent ?? ""
				).includes("absent"),
			);
			if (!agreed)
				throw new Error("the readout still claims the control is present");
		} catch (error) {
			releaseShutter();
			throw error;
		}
		releaseShutter();
	},
};

export const MarkAllReadInFlight: Story = {
	render: () => {
		/*
		 * The answer never arrives. The shutter is held from the RENDER, as the
		 * click-driven stories hold it, and released once the control has announced
		 * itself unavailable — so the frame is the state between the click and the
		 * receipt, which is a real request rather than a race.
		 */
		holdShutter();
		fixtures({
			ack: "never",
			receipt: {
				read: [
					readAt("a1b2c3d4e5f6"),
					readAt("b2c3d4e5f6a7"),
					readAt("c3d4e5f6a7b8"),
				],
				superseded: [],
				unknown: [],
			},
		});
		roster = pileRoster();
		return <Page />;
	},
	play: async () => {
		try {
			await catalogueSettled(PILE.length);
			clickMarkAllRead();
			// The announcement is the state: `aria-disabled` lands in the same commit
			// as the spinner, and the promise behind it never settles by design.
			await screen.findByRole(
				"button",
				{ name: /Mark all/ },
				{ timeout: 4_000 },
			);
			const disabled = await waitFor(
				() =>
					document
						.querySelector('[data-tour-tag="mark-all-read"]')
						?.getAttribute("aria-disabled") === "true",
			);
			if (!disabled) throw new Error("the in-flight state was never entered");
			// And the caption says so too, rather than describing the rest state.
			const captioned = await waitFor(() =>
				(
					document.querySelector("[data-readout-control]")?.textContent ?? ""
				).includes("in flight"),
			);
			if (!captioned)
				throw new Error("the readout does not show the in-flight state");
		} catch (error) {
			releaseShutter();
			throw error;
		}
		releaseShutter();
	},
};

export const MarkAllReadRefused: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => {
		/*
		 * The transport fails: the app's own "could not reach the backend process"
		 * sentence, and the second clause this change adds — that the unread marks
		 * were NOT cleared. Both facts, because the reader's question after an
		 * irreversible action is "did it happen?" rather than "what is the backend
		 * doing?" (UX round 1, U5). Every check is still on screen behind the toast.
		 */
		holdShutter();
		fixtures({ ack: "refusing" });
		roster = pileRoster();
		return <Page />;
	},
	play: async () => {
		try {
			await catalogueSettled(PILE.length);
			clickMarkAllRead();
			await screen.findByText(
				"Desktop controls could not reach the backend process. The unread marks were not cleared.",
				{},
				{ timeout: 4_000 },
			);
			await waitFor(
				() =>
					document
						.querySelector('[data-tour-tag="mark-all-read"]')
						?.getAttribute("aria-disabled") !== "true",
			);
		} catch (error) {
			releaseShutter();
			throw error;
		}
		releaseShutter();
	},
};

export const MarkAllReadPartlyRead: Story = {
	// Hold the receipt for this story's lifetime: the sentence and the remaining
	// check are the frame, and a toast that auto-closed mid-capture would leave a
	// reviewer looking at the cleared half of a partial success.
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => {
		holdShutter();
		fixtures({
			receipt: {
				read: [readAt("a1b2c3d4e5f6"), readAt("b2c3d4e5f6a7")],
				// A completion that landed after this client rendered: the token it
				// holds is real but no longer current, so the row stays unread.
				superseded: ["c3d4e5f6a7b8"],
				unknown: [],
			},
		});
		roster = pileRoster();
		return <Page />;
	},
	play: async () => {
		try {
			await catalogueSettled(PILE.length);
			clickMarkAllRead();
			/*
			 * The settlement is asserted, not slept through: the unread count falling
			 * to one proves the answer was applied, and finding the sentence proves
			 * the receipt was rendered. A story that photographed before both would be
			 * the pile frame with a caption claiming a partial clear.
			 */
			await waitFor(
				() =>
					useCanonicalSessionsStore
						.getState()
						.sessions.filter((row) => row.attention?.unseen).length === 1,
			);
			await screen.findByText(
				"Marked 2 chats as read. 1 has a newer result and stays unread.",
				{},
				{ timeout: 4_000 },
			);
		} catch (error) {
			// A failed play must not hold the shutter: that turns any failure into a
			// silent hang with no frame and no reason.
			releaseShutter();
			throw error;
		}
		releaseShutter();
	},
};

export const MarkAllReadCleared: Story = {
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => {
		holdShutter();
		fixtures({
			receipt: {
				read: [
					readAt("a1b2c3d4e5f6"),
					readAt("b2c3d4e5f6a7"),
					readAt("c3d4e5f6a7b8"),
				],
				superseded: [],
				unknown: [],
			},
		});
		roster = pileRoster();
		return <Page />;
	},
	play: async () => {
		try {
			await catalogueSettled(PILE.length);
			clickMarkAllRead();
			await waitFor(() =>
				useCanonicalSessionsStore
					.getState()
					.sessions.every((row) => !row.attention?.unseen),
			);
			await screen.findByText(
				"Marked 3 chats as read.",
				{},
				{ timeout: 4_000 },
			);
		} catch (error) {
			releaseShutter();
			throw error;
		}
		releaseShutter();
	},
};

export const MarkAllReadUnsupported: Story = {
	render: () => {
		/*
		 * An older backend: the pile is real and the marks are real, and the key
		 * that would let this client clear them is simply not advertised. The frame
		 * is the ABSENCE — no control beside the group heading — because that is
		 * what a renderer must do against a backend it cannot ask: offering the
		 * button and answering the click with a 404 is the broken control this
		 * gating exists to prevent.
		 */
		fixtures({ features: {} });
		roster = pileRoster();
		return <Page />;
	},
	play: async () => {
		await catalogueSettled(PILE.length);
		await sleep(300);
	},
};

export const MarkAllReadLoading: Story = {
	render: () => {
		// The catalogue read never answers. Nothing is known about any row, so there
		// is no count to act on and no control — the marks this story cannot know
		// about are exactly what the control must not guess at.
		fixtures({ list: "pending" });
		roster = [];
		return <Page />;
	},
	play: async () => {
		await waitFor(() => useCanonicalSessionsStore.getState().loading);
		await sleep(300);
	},
};

export const MarkAllReadFailed: Story = {
	render: () => {
		fixtures({ list: "failed" });
		roster = [];
		return <Page />;
	},
	play: async () => {
		await waitFor(() => Boolean(useCanonicalSessionsStore.getState().error));
		await sleep(300);
	},
};

export const MarkAllReadEmpty: Story = {
	render: () => {
		// No conversations at all. The sidebar says so; the control has no subject.
		fixtures();
		roster = [];
		return <Page />;
	},
	play: async () => {
		await waitFor(() => !useCanonicalSessionsStore.getState().loading);
		await sleep(300);
	},
};

/*
 * ------------------------------------------------------------ the delegating
 *                                                                        row
 *
 * THE ARM'S OWN SURFACE, which the `Neighbours` matrix cannot draw. That story
 * is a column of glyph-and-label pairs, so it answers "which mark" and nothing
 * about a ROW: a truncated title, the trailing statement's slot, the mark
 * column's fixed position, or the sidebar's own 240px clamp. The arm is about a
 * row, so the row has to be photographed (design round 1, D4).
 *
 * TWO WIDTHS, ONE ROSTER. The width is the component's own parameter here as it
 * is in `chat-layout.tsx`'s clamps, and `DelegatingRowMinimum`'s 240px is
 * `ui-preferences-store.ts`'s `Math.min(360, Math.max(240, width))` floor - the
 * one width at which the longest title on screen is truncated hardest, which is
 * the state a reader could mistake for the mark having moved.
 *
 * WHAT IS DELIBERATELY NEIGHBOURED, and why each one is here rather than in a
 * separate frame: `busy` sits directly under a delegating row because those two
 * wear the SAME `accent` in the SAME 16px slot and the arc against the three
 * nodes is the whole difference between them; the unread completion sits between
 * them because its check is `success`, the ink `accent` collapses onto in some
 * palettes (design D2); and an `attached` row is the rung a delegating row is
 * placed BELOW, so the two must be distinguishable at a glance in one picture.
 */
const DELEGATING = {
	code: "delegating",
	label: "2 subagents running · 1 queued",
};
const DELEGATING_QUEUED = { code: "delegating", label: "2 subagents queued" };
const OPEN = { code: "attached", label: "Open" };

/** The sessions this pair of stories draws: one per row of the roster below. */
const LEDGER = "6f7081a2b3c4";
const VENDOR = "7081a2b3c4d5";
const SPINNER = "81a2b3c4d5e6";
const FINISHED = "92b3c4d5e6f7";
const OPENED = "a3c4d5e6f708";

/**
 * The roster BOTH widths draw, built in one place.
 *
 * The pair is a comparison, so the only thing allowed to differ between the two
 * frames is the viewport; a second copy of this array would be free to drift and
 * the pair would stop answering anything.
 *
 * The counts ride the wire rows as `sessions.list` sends them, because a fixture
 * that omitted a field the backend now publishes would be photographic of a wire
 * the app cannot receive - but they are not what draws the count: it reaches the
 * screen inside `status.label`, which is why the rows would render identically
 * without them. Two delegating rows rather than one, because the label's own
 * spellings differ by what is running versus queued and both are the state.
 */
const delegatingRoster = (): WireRow[] => [
	wireRow(
		LEDGER,
		"Reconcile the supplier ledger against the quarterly revenue model",
		1_760_003_600,
		DELEGATING,
		6,
		{ agent: null, team: null },
		undefined,
		{ subagents_running: 2, subagents_queued: 1 },
	),
	wireRow(
		VENDOR,
		"Audit the vendor list",
		1_760_003_500,
		DELEGATING_QUEUED,
		3,
		{ agent: "quarterly-revenue-auditor", team: null },
		undefined,
		{ subagents_running: 0, subagents_queued: 2 },
	),
	wireRow(SPINNER, "Migrate the deploy script", 1_760_003_400, BUSY, 4),
	wireRow(
		FINISHED,
		"Quarterly revenue model",
		1_760_003_300,
		COMPLETE,
		2,
		undefined,
		unseenAt(FINISHED),
	),
	wireRow(OPENED, "Draft the migration runbook", 1_760_003_200, OPEN, 1),
];

export const DelegatingRowDefault: Story = {
	render: () => {
		fixtures();
		roster = delegatingRoster();
		return <Page sidebarWidth={280} />;
	},
	play: async () => {
		await catalogueSettled(5);
		await sleep(300);
	},
};

/*
 * ------------------------------------------ rows that OWN subagents while the
 *                                                   primary mark says something
 *                                                                      else
 *
 * THE OPERATOR'S REPORT (2026-09-29): a session "not displaying the icon where
 * they're done but they still have running subagents, so it just looks like
 * they're inactive in the sidebar".
 *
 * The delegation pair above cannot draw it. Both of its rows carry the
 * `delegating` code, which is the ONE rung whose label already spells the counts
 * - so it is the one rung where the presence was never invisible. Every rung
 * ABOVE it (a live turn, an unseen completion, an attached session, an armed
 * wake) draws a mark of its own and, until this change, said nothing at all
 * about the children still at work. That is what these rosters photograph.
 *
 * The counts ride the wire rows exactly as `sessions.list` sends them.
 */
const SCHEDULED = { code: "scheduled", label: "Wake scheduled" };
/** The session ids these rosters draw, one per cell of the spec's own list. */
const CELL_BUSY_BOTH = "a10000000001";
const CELL_BUSY = "a10000000002";
const CELL_DONE = "a10000000003";
const CELL_OPEN = "a10000000004";
const CELL_QUEUE = "a10000000005";
const CELL_IDLE = "a10000000006";
const CELL_FAILED = "a10000000007";
const CELL_WEDGED = "a10000000008";
const CELL_DELEG_BOTH = "a10000000009";
const CELL_DELEG_RUNNING = "a10000000010";
const CELL_DELEG_QUEUED = "a10000000011";
const CELL_NULL = "a10000000012";
const CELL_ZERO_BUSY = "a10000000016";
const CELL_NULL_IDLE = "a10000000017";
const CELL_ZERO = "a10000000013";
const CELL_NESTED = "a10000000015";
/** The agent the nested cell is filed under. */
const CELL_NESTED_AGENT = "quarterly-revenue-auditor";

/**
 * The roster the LIVE rungs draw, built once so the width pair differs by
 * viewport only.
 *
 * WHY TWO ROSTERS RATHER THAN ONE. The sidebar draws a PAGE of chats - ten, then
 * twenty-five, then fifty (`chat-sidebar-view.ts`'s ladder) - with a "Show N more
 * chats" control under it. One roster carrying every acceptance cell would put
 * five of them behind that control, and the five it hides are the quietest ones,
 * which is exactly where a reviewer would look hardest. Splitting by the ladder's
 * own partition keeps every cell on screen with no interaction, and it happens to
 * be the honest partition anyway: the rungs the catalogue ranks above
 * `delegating` all carry a RUNNING code, and the resting ones do not.
 *
 * The titles are the delegating pair's own lengths rather than new filler: the
 * 240px frame's job is to show the longest title truncated hardest BESIDE the
 * indicator, and a shorter title in the comparison frame would be a comparison of
 * two things.
 */
const subagentRunningRoster = (): WireRow[] => [
	// S2 - the worst case the width debate is about: three glyphs and a queue.
	wireRow(
		CELL_BUSY_BOTH,
		"Reconcile the supplier ledger against the quarterly revenue model",
		1_760_003_900,
		BUSY,
		15,
		{ agent: null, team: null },
		undefined,
		{ subagents_running: 2, subagents_queued: 1 },
	),
	// S1 - a working row: spinner plus the accent mark.
	wireRow(
		CELL_BUSY,
		"Migrate the deploy script",
		1_760_003_800,
		BUSY,
		14,
		{ agent: null, team: null },
		undefined,
		{ subagents_running: 2, subagents_queued: 0 },
	),
	// S7b - the amber wedged primary, same rule: it keeps its hue and the mark
	// sits beside it.
	wireRow(
		CELL_WEDGED,
		"Backfill the metrics table",
		1_760_003_500,
		WEDGED_SILENT,
		11,
		undefined,
		undefined,
		{ subagents_running: 1, subagents_queued: 0 },
	),
	// S8 - no double draw: the primary running mark (the filled dot,
	// `SubagentRunningMark`) plus the queued glyph, and NOTHING of the running
	// half.
	wireRow(
		CELL_DELEG_BOTH,
		"Audit the vendor list",
		1_760_003_100,
		DELEGATING,
		7,
		undefined,
		undefined,
		{ subagents_running: 2, subagents_queued: 1 },
	),
	// S9 - THE REGRESSION CELL: a delegating row with nothing queued must render
	// exactly as it does today. Compare against the committed
	// `delegating-row-default/` frames: one filled dot in the accent, 8px inside
	// the slot's 16px box, no second glyph and no added clause. (Those committed
	// frames pre-date issue #840 and still draw the removed `Share2`; the story's
	// claim is about the SHAPE of the state, and the frames were re-captured in
	// the same round that changed the mark - see `subagent-rows-running/`.)
	wireRow(
		CELL_DELEG_RUNNING,
		"Reconcile the supplier ledger",
		1_760_003_000,
		{ code: "delegating", label: "1 subagent running" },
		6,
		undefined,
		undefined,
		{ subagents_running: 1, subagents_queued: 0 },
	),
	// S10 - the existing queued-only delegating spelling, now with its glyph.
	wireRow(
		CELL_DELEG_QUEUED,
		"Backfill the metrics table by hand",
		1_760_002_900,
		DELEGATING_QUEUED,
		5,
		undefined,
		undefined,
		{ subagents_running: 0, subagents_queued: 2 },
	),
	// S11a - `null` is "this build does not report", not zero: no mark, no
	// clause, byte-identical to today.
	wireRow(
		CELL_NULL,
		"Untitled migration scratchpad",
		1_760_002_800,
		BUSY,
		4,
		undefined,
		undefined,
		{ subagents_running: null, subagents_queued: null },
	),
	// S11b - the OTHER half of the same cell: a REPORTED zero on a working row,
	// which must render identically to the null above. Both are here because the
	// acceptance list asks for the pair on a busy row AND on an idle one, and the
	// two answers have to agree on both rungs (review MINOR 2).
	wireRow(
		CELL_ZERO_BUSY,
		"Scratch notes on the vendor schema",
		1_760_002_750,
		BUSY,
		3,
		undefined,
		undefined,
		{ subagents_running: 0, subagents_queued: 0 },
	),
];

export const SubagentRowsRunning: Story = {
	render: () => {
		/*
		 * The archived cell (S13) needs the archive capability, and it is on in
		 * every story here rather than only in the one that draws the mark: a
		 * fixture whose capability differs between the two halves of a width pair
		 * would make the pair a comparison of two builds.
		 */
		fixtures({ features: { completion_ack_bulk: 1, session_archive: 1 } });
		entities = null;
		roster = subagentRunningRoster();
		return <Page sidebarWidth={280} readoutRows={8} />;
	},
	play: async () => {
		await catalogueSettled(8);
		await sleep(400);
	},
};

export const SubagentRowsRunningMinimum: Story = {
	render: () => {
		fixtures({ features: { completion_ack_bulk: 1, session_archive: 1 } });
		entities = null;
		roster = subagentRunningRoster();
		return <Page sidebarWidth={240} readoutRows={8} />;
	},
	play: async () => {
		await catalogueSettled(8);
		await sleep(400);
	},
};

/**
 * The roster the RESTING rungs draw: every code the catalogue ranks above
 * `delegating` that is not itself a running code, which is the whole defect -
 * these rows drew their own quiet mark and said nothing about the children still
 * at work.
 */
const subagentRestingRoster = (): WireRow[] => [
	// S4 - the operator's letter case: the turn finished and its check stands,
	// while the children it started are still working.
	wireRow(
		CELL_DONE,
		"Quarterly revenue model",
		1_760_003_700,
		COMPLETE,
		13,
		undefined,
		unseenAt(CELL_DONE),
		{ subagents_running: 1, subagents_queued: 0 },
	),
	// S3 - a resting `ink-dim` primary beside a loud indicator.
	wireRow(
		CELL_OPEN,
		"Draft the migration runbook",
		1_760_003_600,
		OPEN,
		12,
		undefined,
		undefined,
		{ subagents_running: 1, subagents_queued: 0 },
	),
	// S5 - queued-only, non-delegating: the "must not read as idle" case. Nothing
	// is running, so the glyph is the only thing on the row saying work is owed.
	wireRow(
		CELL_QUEUE,
		"Sweep the vendor list overnight",
		1_760_003_400,
		SCHEDULED,
		10,
		undefined,
		undefined,
		{ subagents_running: 0, subagents_queued: 2 },
	),
	// S6 - the resting ring plus the accent mark.
	wireRow(
		CELL_IDLE,
		"Archive the launch checklist",
		1_760_003_300,
		IDLE,
		9,
		undefined,
		undefined,
		{ subagents_running: 1, subagents_queued: 0 },
	),
	// S7a - a loud failure primary keeps its hue with the indicator beside it.
	wireRow(
		CELL_FAILED,
		"Regenerate the vendor import",
		1_760_003_200,
		FAILED,
		8,
		undefined,
		unseenAt(CELL_FAILED),
		{ subagents_running: 1, subagents_queued: 0 },
	),
	// S11c - a reported zero on a RESTING row, the fourth quarter of the compat
	// cell; S11d below is the same row with counts this build cannot read.
	wireRow(
		CELL_ZERO,
		"Notes on the vendor schema",
		1_760_002_700,
		IDLE,
		3,
		undefined,
		undefined,
		{ subagents_running: 0, subagents_queued: 0 },
	),
	// S11d - `null` on a resting row. Nothing about the mark is a function of the
	// code, so this pair is what says so in pixels rather than in prose.
	wireRow(
		CELL_NULL_IDLE,
		"Vendor schema, second pass",
		1_760_002_650,
		IDLE,
		2,
		undefined,
		undefined,
		{ subagents_running: null, subagents_queued: null },
	),
	// S15 - a nested row: the indicator is a state of the SESSION, so a row filed
	// under its agent carries it too, at the section's own indent.
	wireRow(
		CELL_NESTED,
		"Quarterly vendor reconciliation",
		1_760_002_500,
		OPEN,
		1,
		{ agent: CELL_NESTED_AGENT, team: null },
		undefined,
		{ subagents_running: 1, subagents_queued: 0 },
	),
];

const RESTING_ROSTER_ROWS = 8;

export const SubagentRowsResting: Story = {
	render: () => {
		fixtures({ features: { completion_ack_bulk: 1, session_archive: 1 } });
		/*
		 * NO ENTITY CATALOGUE, and that is a measured limit of this fixture rather
		 * than an oversight: with `entities` set the sidebar's Agents section still
		 * renders its EMPTY state (the offer line names the profile, so the read
		 * landed - the section lists installed agents and this fixture's catalogue
		 * has none), which is the state the committed `completion-reordered`
		 * frames show too. So the nested cell below renders as the FLAT row the
		 * list draws, and the nested under-an-agent frame is recorded as a gap in
		 * the PR rather than faked here.
		 */
		entities = null;
		roster = subagentRestingRoster();
		return <Page sidebarWidth={280} readoutRows={RESTING_ROSTER_ROWS} />;
	},
	play: async () => {
		await catalogueSettled(RESTING_ROSTER_ROWS);
		await sleep(400);
	},
};

export const SubagentRowsRestingMinimum: Story = {
	render: () => {
		fixtures({ features: { completion_ack_bulk: 1, session_archive: 1 } });
		/*
		 * NO ENTITY CATALOGUE, and that is a measured limit of this fixture rather
		 * than an oversight: with `entities` set the sidebar's Agents section still
		 * renders its EMPTY state (the offer line names the profile, so the read
		 * landed - the section lists installed agents and this fixture's catalogue
		 * has none), which is the state the committed `completion-reordered`
		 * frames show too. So the nested cell below renders as the FLAT row the
		 * list draws, and the nested under-an-agent frame is recorded as a gap in
		 * the PR rather than faked here.
		 */
		entities = null;
		roster = subagentRestingRoster();
		return <Page sidebarWidth={240} readoutRows={RESTING_ROSTER_ROWS} />;
	},
	play: async () => {
		await catalogueSettled(RESTING_ROSTER_ROWS);
		await sleep(400);
	},
};

/*
 * S12 - THE OPERATOR'S EXACT CASE: the row is SELECTED (they had opened it), it
 * owns two running subagents, and it must not read as inactive while its own
 * pane works. The unselected twin beside it is what makes the pair readable: the
 * accent mark is measured on `rowSelected` here, the ground the operator's own
 * screenshot is on, and the twin says the mark is not an artefact of that ground.
 */
const CELL_SELECTED = "b20000000001";
const CELL_TWIN = "b20000000002";

export const SubagentSelectedRow: Story = {
	render: () => {
		fixtures();
		/*
		 * NO DRAFT IS STAGED, and that has to be SAID rather than assumed. The
		 * canonical store persists `activeDraftKey` (`partialize` names it), so a
		 * profile that staged a draft in any earlier story hydrates the key here -
		 * and the row's own definition of current is
		 * `selectedConversation === row.session_id && !activeDraftKey`
		 * (`chat-sidebar.tsx`). An inherited key therefore suppresses the
		 * `rowSelected` ground this frame exists to photograph, while the frame
		 * still claims "the operator's own selected row": MEASURED, with a hydrated
		 * `draft:<uuid>` both rows painted resting and this entry's own guard
		 * (`[data-chat-row][aria-current="page"]`) refused to write the frame.
		 * Stated in the story rather than fixed in the rig because the app's own
		 * rule is the thing under test, and a story that needs "no draft" has to
		 * establish it the way the app does.
		 */
		useCanonicalSessionsStore.setState({ activeDraftKey: null });
		entities = null;
		roster = [
			wireRow(
				CELL_SELECTED,
				"Migrating MUI dashboard to Tailwind and shadcn",
				1_760_003_900,
				BUSY,
				2,
				undefined,
				undefined,
				{ subagents_running: 2, subagents_queued: 0 },
			),
			wireRow(
				CELL_TWIN,
				"Reconcile the supplier ledger against the quarterly revenue model",
				1_760_003_800,
				BUSY,
				1,
				undefined,
				undefined,
				{ subagents_running: 2, subagents_queued: 0 },
			),
		];
		return <Page sidebarWidth={280} readoutRows={2} selected={CELL_SELECTED} />;
	},
	play: async () => {
		await catalogueSettled(2);
		await sleep(500);
	},
};

/*
 * S13 - the archived row, which needs the search block to be widened to exist on
 * screen at all: `chat-archived.ts`'s `visibleRows` FILTERS archived rows out of
 * the at-rest list whenever the capability is on (the panel deliberately has no
 * Archived section - the docstring there says why), so the only way a reader ever
 * sees one is the search block's own `Include archived` control over a query.
 * That is the path this story walks, through the real controls: type a query,
 * then tick the box.
 *
 * The cell exists because the row carries TWO CONDITIONAL MARKS in different
 * slots - the leading `Archive` glyph and the post-title indicator - and a change
 * that adds the second should show that neither displaces the other. The
 * unarchived twin below it is the control: same query, same row shape, one mark.
 */
const CELL_ARCHIVED = "b30000000001";
const CELL_ARCHIVED_TWIN = "b30000000002";

export const SubagentArchivedRow: Story = {
	render: () => {
		fixtures({ features: { completion_ack_bulk: 1, session_archive: 1 } });
		entities = null;
		roster = [
			wireRow(
				CELL_ARCHIVED,
				"Old supplier ledger reconciliation",
				1_760_003_900,
				OPEN,
				2,
				undefined,
				undefined,
				{ archived: true, subagents_running: 2, subagents_queued: 0 },
			),
			wireRow(
				CELL_ARCHIVED_TWIN,
				"Reconcile the supplier ledger",
				1_760_003_800,
				OPEN,
				1,
				undefined,
				undefined,
				{ subagents_running: 1, subagents_queued: 0 },
			),
		];
		return <Page sidebarWidth={280} readoutRows={2} />;
	},
	play: async () => {
		await catalogueSettled(2);
		/*
		 * THE BAND'S BUTTON AND THE FIELD SHARE ONE ACCESSIBLE NAME, and a
		 * `findByLabelText` cannot see past that: the search control opens the field
		 * and the field is itself labelled "Search chats and agents", so the lookup
		 * matched two elements and the play died before a character was typed - which
		 * is why the first version of this story photographed the unarchived twin and
		 * nothing else (QA round 1, Q-1, and design D1 on the same frame).
		 *
		 * ROLES separate them, and they are the surface's own: the band control is a
		 * BUTTON that opens the field, the field is a TEXTBOX. The order is the
		 * reader's - open the search, type the query, then tick the control the query
		 * reveals (the checkbox is not rendered until there is a query to scope it
		 * to).
		 */
		await userEvent.click(
			await screen.findByRole("button", { name: "Search chats and agents" }),
		);
		const box = await screen.findByRole("textbox", {
			name: "Search chats and agents",
		});
		await userEvent.type(box, "ledger");
		await userEvent.click(
			await screen.findByRole("checkbox", { name: "Include archived" }),
		);
		/*
		 * AND THE STORY FAILS LOUDLY IF THE ROW NEVER ARRIVES. The capture entry for
		 * this story carries `expectPresent: '[data-session-archived="true"]'`, so
		 * the rig refuses to write a frame without an archived row in it - the
		 * guard that turns this whole class of silent no-op into a failed run rather
		 * than a picture of the wrong state.
		 */
		await until("the archived row", () =>
			Boolean(document.querySelector('[data-session-archived="true"]')),
		);
		await sleep(400);
	},
};

export const DelegatingRowMinimum: Story = {
	render: () => {
		fixtures();
		roster = delegatingRoster();
		return <Page sidebarWidth={240} />;
	},
	play: async () => {
		await catalogueSettled(5);
		await sleep(300);
	},
};
