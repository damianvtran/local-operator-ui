import { askPaintableAnswers } from "@features/chat/ask-queue";
import type { Meta, StoryObj } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import type {
	DesktopNotificationDetail,
	DesktopNotificationItem,
} from "../../../../../shared/desktop-control-contract";
import type { PendingAsk } from "../../../../../shared/desktop-session-contract";
import { createNotificationFixture } from "../notifications-fixture";
/**
 * The Notifications page against a scripted bridge (design.md § 5 states, § 18
 * drawer, § 1 sidebar). The fixtures are the mock's own content
 * (`mock-desktop.html`), so a frame can be compared with the designer's PNG
 * beside it, and the bridge answers in the route shapes of contract § 5.2.
 *
 * WHY A SCRIPTED BRIDGE AND NOT A MOCKED HOOK. The page reads through
 * `desktopResult`, so a story that answers `window.api.desktop.request` drives
 * the SHIPPED hooks, query keys and request schema; a hook mock would
 * photograph a component the app never mounts (the projects-stories rule).
 *
 * The clock is pinned (`NOW`) so the time column and the time groups do not
 * churn between captures.
 */
import {
	DrawerTabs,
	DrawerUpdates,
	useSessionUnreadUpdates,
} from "./drawer-updates";
import { FlagLine, FlagLinesProvider } from "./flag-line";
import { OperationProgressLine } from "./operation-progress-line";
import "../../../styles/index.css";
import "../../chat/components/story-electron-shim";
import { AskDrawer } from "@features/chat/components/asks/ask-drawer";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { PanelRailFrame } from "@shared/components/navigation/panel-rail-frame";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { Badge } from "@shared/components/ui";
import { LocaleDirectionProvider } from "@shared/i18n/locale-direction";
import { useDocumentDirection } from "@shared/i18n/use-document-direction";
import { NotificationRow } from "./notification-row";
import { NotificationsPage } from "./notifications-page";

const NOW = new Date(2026, 9, 25, 15, 4, 0).getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let seq = 100;
const item = (
	over: Partial<DesktopNotificationItem> & { id: string; title: string },
): DesktopNotificationItem => {
	seq += 1;
	return {
		source: "notify",
		priority: "normal",
		excerpt: "",
		created_at: NOW - HOUR,
		updated_at: NOW - HOUR,
		seq,
		revision: 1,
		read: false,
		read_via: null,
		dismissed: false,
		repeat_count: 1,
		session: { id: "aaaaaaaaaaa1", title: "radient fraud watch" },
		ask: null,
		...over,
	};
};

const ASK_ID = "ask:aaaaaaaaaaa2:a-7f3c";
const WAITING: DesktopNotificationItem[] = [
	item({
		id: ASK_ID,
		source: "ask",
		priority: "high",
		title: "Which environment should the release go to?",
		updated_at: NOW - 22 * MINUTE,
		created_at: NOW - 22 * MINUTE,
		session: { id: "aaaaaaaaaaa2", title: "Aida" },
		ask: { status: "open", question_count: 2, deadline_at: NOW + 38 * MINUTE },
	}),
];

const FRAUD = item({
	id: "n_fraudwatcheneo",
	priority: "high",
	title: "Chargeback spike on 3 merchants",
	excerpt: "Disputes up 4.1× in the last hour; two share a BIN range.",
	updated_at: NOW - 6 * MINUTE,
	created_at: NOW - 3 * HOUR,
	repeat_count: 6,
	revision: 6,
	anchor_id: "toolu_fraud_6",
	projects: [{ key: "radient-risk", name: "Radient risk", status: "active" }],
});

const POPULATED: DesktopNotificationItem[] = [
	FRAUD,
	item({
		id: "n_prreviewcheckeo",
		title: "External PR needs review: #1410 payload log lines",
		excerpt: "CI is green; the change touches desktop-feed.ts.",
		updated_at: NOW - 41 * MINUTE,
		session: { id: "aaaaaaaaaaa2", title: "Aida" },
	}),
	item({
		id: "n_nightlybuildeo",
		priority: "low",
		title: "Nightly build finished",
		excerpt: "All 59 palettes pass the contrast contract.",
		updated_at: NOW - 2 * HOUR,
		read: true,
		read_via: "watching",
		session: { id: "ccccccccccc3", title: "ci-watch" },
	}),
	item({
		id: "n_quotawarningeo",
		title: "Provider quota at 82%",
		excerpt: "Resets at 00:00 UTC.",
		updated_at: NOW - 3 * HOUR,
		read: true,
		read_via: "in_view",
		session: { id: "ddddddddddd4", title: "ops" },
	}),
	item({
		id: "n_yesterdayseoteo",
		title: "Weekly digest ready",
		excerpt: "12 merged PRs, 3 releases.",
		updated_at: NOW - DAY - 2 * HOUR,
		session: { id: "aaaaaaaaaaa2", title: "Aida" },
	}),
	item({
		id: "n_olderitemeo",
		priority: "low",
		title: "Backup verified",
		updated_at: NOW - 9 * DAY,
		read: true,
		read_via: "explicit",
		session: { id: "ddddddddddd4", title: "ops" },
	}),
];

const ASK: PendingAsk = {
	ask_id: "a-7f3c",
	session_id: "aaaaaaaaaaa2",
	created_at: NOW - 22 * MINUTE,
	expires_at: NOW + 38 * MINUTE,
	timeout_s: 3600,
	urgent: true,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "target",
			question: "Which environment should the release go to?",
			recommended: 0,
			options: [
				{ label: "staging", description: "The shared pre-prod cluster" },
				{ label: "production", description: "Live traffic" },
			],
			multi: false,
		},
	],
} as PendingAsk;

const DETAIL: DesktopNotificationDetail = {
	item: {
		...FRAUD,
		body_md: [
			"Disputes on three merchants rose **4.1×** against the trailing 7-day hour.",
			"",
			"| Merchant | Disputes / h | 7-day avg |",
			"|---|---:|---:|",
			"| m_4821 | 37 | 8 |",
			"| m_1170 | 22 | 6 |",
			"| m_9035 | 14 | 4 |",
			"",
			"Two of the three share BIN range `4147 20`.",
		].join("\n"),
		links: [{ label: "Dashboard", url: "https://example.invalid/risk" }],
	},
	history: [1, 2, 3, 4, 5].map((n) => ({
		revision: 6 - n,
		at: NOW - (6 + n * 25) * MINUTE,
		title: `Chargeback spike on ${n > 2 ? 2 : 3} merchants`,
		excerpt: `Disputes up ${(4.1 - n * 0.4).toFixed(1)}×`,
	})),
	session: {
		id: "aaaaaaaaaaa1",
		title: "radient fraud watch",
		live_state: "idle",
	},
	anchor: {
		id: "toolu_fraud_6",
		excerpt:
			"Flagging this: the spike crossed 4× and two merchants share a BIN range.",
	},
	projects: [{ key: "radient-risk", name: "Radient risk", status: "active" }],
	asks: [],
};

const HIGH_VOLUME: DesktopNotificationItem[] = Array.from(
	{ length: 160 },
	(_, index) =>
		item({
			id: `n_volume${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
			priority: index % 7 === 0 ? "high" : index % 3 === 0 ? "low" : "normal",
			title: `Monitor tick ${index + 1}: queue depth ${120 - index}`,
			excerpt: "Consumer lag within budget.",
			updated_at: NOW - index * 47 * MINUTE,
			read: index % 4 === 0,
			repeat_count: index % 5 === 0 ? 3 : 1,
			session: {
				id: [
					"a1a1a1a1a1a1",
					"b2b2b2b2b2b2",
					"c3c3c3c3c3c3",
					"d4d4d4d4d4d4",
					"e5e5e5e5e5e5",
					"f6f6f6f6f6f6",
				][index % 6],
				title: [
					"queue monitor",
					"fraud watch",
					"ci-watch",
					"ops",
					"Aida",
					"pricing",
				][index % 6],
			},
		}),
);

type Stub = {
	items: DesktopNotificationItem[];
	waiting: DesktopNotificationItem[];
	hang?: boolean;
	failList?: boolean;
	/** First read answers, every later read fails: the stale-list state. */
	failAfterFirst?: boolean;
	detail?: DesktopNotificationDetail | null;
	capability?: boolean;
	/**
	 * The conversation's asks as a STATEFUL list (the ask-pane stories): an accepted
	 * answer flips the row, the detail route then answers 404 for a settled ask (core's
	 * `notifications/items.py::detail` rule) and `asks.list` carries the settled row.
	 */
	asks?: PendingAsk[];
	/** How `sessions.answer` answers: settle (default), hang (sending), or fail (503). */
	answerMode?: "settle" | "hang" | "fail";
	bulkCapability?: boolean;
	/**
	 * One row the store revises AFTER the frozen preview and BEFORE the bulk write,
	 * so the write really refuses it (`stale_revision`) while the rest land.
	 *
	 * This is the only honest way to reach a partial receipt: the counts come out
	 * of the shipped fixture's own revision check, not out of a caption somebody
	 * typed next to a hand-built progress line (design round 1, D2).
	 */
	refuseOnBulkDismiss?: string;
	askReadCapability?: boolean;
};

let stub: Stub = { items: [], waiting: [] };
let listReads = 0;
/*
 * A STATEFUL fixture over the PINNED contract, not a canned success. It owns
 * cursor paging, the through_seq boundary, observed tokens, revision refusals and
 * notify high-water that ask-only changes must NOT disturb (D2/U2/Q7). A story
 * that claims a bulk/Undo outcome is therefore measuring the shipped planner.
 */
let fixture = createNotificationFixture(stub.items, stub.waiting);

/** Index bookkeeping for the answer route, kept out of the JSX-free switch. */
const askIndexMissing = (_stub: Stub, index: number) => index < 0;

const answer = (request: { op: string; [key: string]: unknown }) => {
	if (request.op === "capabilities") {
		return {
			status: 200,
			body: {
				result: {
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					/*
					 * The rail's usual neighbours are advertised in EVERY story, so the
					 * sidebar before/after pair differs in exactly one capability.
					 */
					features: {
						aida: 1,
						projects: 1,
						desktop_feed: 1,
						library: 1,
						...(stub.askReadCapability
							? { notification_bulk_ask_read: 1 }
							: {}),
						...(stub.capability === false
							? {}
							: {
									notifications: 1,
									...(stub.bulkCapability === false
										? {}
										: { notification_bulk_selection: 1 }),
								}),
					},
				},
			},
		};
	}
	switch (request.op) {
		case "notifications.list": {
			if (stub.hang) return new Promise(() => {});
			listReads += 1;
			if (stub.failList || (stub.failAfterFirst && listReads > 1))
				return {
					status: 503,
					body: { detail: "The local server did not answer." },
				};
			return fixture.request(request);
		}
		case "notifications.count":
			return fixture.request(request);
		case "notifications.get": {
			/*
			 * The detail's `item` is the LIVE row, as the route reads it from the same
			 * store: a fixed copy would keep saying "unread" after the page's own
			 * explicit read changed the row (the server never answers that way).
			 */
			const live = [...stub.items, ...stub.waiting].find(
				(row) => row.id === request.id,
			);
			const detail =
				(stub.detail && live
					? { ...stub.detail, item: { ...stub.detail.item, ...live } }
					: stub.detail) ??
				(() => {
					const found = [...stub.items, ...stub.waiting].find(
						(row) => row.id === request.id,
					);
					return found
						? {
								item: found,
								history: [],
								session: found.session,
								anchor: null,
								projects: found.projects ?? [],
								asks:
									found.source === "ask"
										? structuredClone(stub.asks ?? [ASK])
										: [],
							}
						: null;
				})();
			const settledAsk =
				stub.asks !== undefined &&
				String(request.id).startsWith("ask:") &&
				stub.asks.find((row) => String(request.id).endsWith(`:${row.ask_id}`))
					?.status !== "open";
			if (!detail || settledAsk)
				return { status: 404, body: { detail: "no such notification" } };
			return { status: 200, body: { result: detail } };
		}
		case "notifications.read":
		case "notifications.dismiss": {
			/*
			 * THE RACE, REPRODUCED. A dismissal of a frozen snapshot compares each
			 * row's revision and sequence against what the preview saw; a row that moved
			 * in between is refused and counted in `skipped_count`. Moving it here -
			 * after the snapshot was taken, before the store applies the write - is the
			 * window a real user hits when a job updates a row they are dismissing.
			 */
			const refused = stub.refuseOnBulkDismiss;
			const target = request.target as
				| { selectionToken?: string; operationToken?: string }
				| undefined;
			if (
				refused &&
				request.verb === "dismiss" &&
				target?.selectionToken &&
				!target.operationToken
			)
				fixture.revise(refused);
			return fixture.request(request);
		}
		/*
		 * The detail pane's real answer component posts here. Removing the ask is
		 * what makes an "answered ask leaves the reel" claim observable.
		 */
		case "asks.list":
			return {
				status: 200,
				body: { result: { asks: structuredClone(stub.asks ?? []) } },
			};
		case "sessions.answer": {
			if (stub.asks !== undefined) {
				if (stub.answerMode === "hang") return new Promise(() => {});
				if (stub.answerMode === "fail")
					return {
						status: 503,
						body: { detail: "The local server did not answer." },
					};
				const row = stub.asks.find((ask) => ask.ask_id === request.askId);
				if (row) {
					if (request.decline === true) row.status = "declined";
					else if (request.dismiss) {
						row.status = "dismissed";
						row.dismissed_reason = (request.dismiss as { reason?: string })
							.reason as never;
					} else {
						row.status = "answered";
						/*
						 * Stored as core stores it: a secret question's cell becomes its KEY
						 * NAME (`asks/queue.py::_guard_secret_cells`), so the stub never hands
						 * a typed value back for the pane to paint.
						 */
						row.answers = askPaintableAnswers(
							row.questions,
							request.answers as Record<string, string[]>,
						);
					}
				}
			}
			const index = stub.waiting.findIndex((row) =>
				row.id.endsWith(`:${request.askId}`),
			);
			if (askIndexMissing(stub, index))
				return { status: 409, body: { detail: "Ask already settled" } };
			stub.waiting.splice(index, 1);
			fixture.publish();
			return {
				status: 200,
				body: { result: { status: "accepted", ask_id: request.askId } },
			};
		}

		/*
		 * No stored layout: the sidebar draws the DEFAULT layout, which is the
		 * case design § 1.1 calls "anyone who never customised" and the one the
		 * before/after pair is about.
		 */
		case "sidebar_layout.get":
			return { status: 200, body: { result: { layout: null } } };
		default:
			return { status: 404, body: { detail: `story bridge: ${request.op}` } };
	}
};

const install = (next: Stub) => {
	/* A deep copy: a write in one story must not leak into the next one's fixtures. */
	stub = structuredClone(next);
	fixture = createNotificationFixture(stub.items, stub.waiting);
	listReads = 0;
	const page = window as unknown as {
		api?: { desktop?: { request: typeof answer } };
	};
	page.api = page.api ?? {};
	page.api.desktop = { request: answer, feed: fixture.feed } as never;
	try {
		localStorage.removeItem("notifications-read-state");
		localStorage.removeItem("notifications-grouping");
	} catch {
		/* storage is not what these stories are about */
	}
};

/** Drop every cached read so each story starts from its own bridge. */
const FreshCache = ({ children }: { children: ReactNode }) => {
	useDocumentDirection();
	const client = useQueryClient();
	const [ready, setReady] = useState(false);
	useEffect(() => {
		client.clear();
		setReady(true);
	}, [client]);
	return ready ? (
		<LocaleDirectionProvider>{children}</LocaleDirectionProvider>
	) : null;
};

const RouteTo = ({ path, children }: { path: string; children: ReactNode }) => {
	/*
	 * INITIALIZE ONCE. Re-running the redirect on every render reset a click that
	 * navigated to the detail route, which is what made the list-to-detail flow
	 * unreviewable (U2).
	 */
	const navigate = useNavigate();
	const initialized = useRef(false);
	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;
		navigate(path, { replace: true });
	}, [navigate, path]);
	return (
		<Routes>
			<Route path="/notifications/:notificationId" element={children} />
			<Route path="/notifications" element={children} />
			<Route
				path="/chat/:sessionId"
				element={<div data-destination="conversation" />}
			/>
			<Route
				path="/projects/:projectId"
				element={<div data-destination="project" />}
			/>
		</Routes>
	);
};

const page = (
	state: Stub,
	options: {
		path?: string;
		prefs?: Record<string, string>;
		/** Pin the CSS box so a translated toolbar is measured at a real window size. */
		box?: { width: number; height: number };
	} = {},
) => {
	install(state);
	for (const [key, value] of Object.entries(options.prefs ?? {})) {
		try {
			localStorage.setItem(key, value);
		} catch {
			/* see install */
		}
	}
	return (
		<FreshCache>
			<RouteTo path={options.path ?? "/notifications"}>
				<div
					className={
						options.box ? "overflow-hidden bg-canvas" : "h-screen bg-canvas"
					}
					style={options.box}
				>
					<NotificationsPage nowMs={NOW} />
				</div>
			</RouteTo>
		</FreshCache>
	);
};

const meta: Meta = {
	title: "Notifications/Page",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

/** First read in flight: skeleton rows, the toolbar in place. */
export const Loading: Story = {
	render: () => page({ items: [], waiting: [], hang: true }),
};

/** Unread filter with nothing left (design § 5 "All caught up"). */
export const Empty: Story = {
	render: () => page({ items: [], waiting: [] }),
};

/** The first read failed, nothing to keep on screen. */
export const LoadError: Story = {
	render: () => page({ items: [], waiting: [], failList: true }),
};

/** The mock's populated state on the All filter: waiting group, ×6 repeat, provenance. */
export const Populated: Story = {
	/*
	 * This parameter holds a container-default toast, and NOTHING on this page takes
	 * the container default: both receipt paths pass their own lifetime, because an
	 * Undo offer has to outlive exactly its window (design round 1, D2). A receipt
	 * that reports a refusal is held by `receiptDuration` itself, which is what
	 * makes `BulkDismissPartial` below capturable without racing anything.
	 */
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () =>
		page(
			{ items: POPULATED, waiting: WAITING },
			{ prefs: { "notifications-read-state": "all" } },
		),
};

/**
 * A BULK DISMISS THE STORE PARTLY REFUSES - the partial receipt, in the page.
 *
 * WHY THIS STORY EXISTS (design round 1, D2). A partial result is only worth
 * signing off when it is the page's OWN receipt: the shipped composer choosing
 * the words from a real receipt, in the page's own toast lane, at the end of a
 * real bulk dismiss. `OperationStatusPartial` photographs `OperationProgressLine`
 * alone under a sentence the story invents, which proves the component renders
 * and says nothing about what an operator actually gets.
 *
 * So nothing here invents a result. The fixture revises one selected row in the
 * window between the frozen preview and the write - a race a real user hits when
 * a job updates a row they are dismissing - and the store refuses THAT row with
 * `stale_revision` while the rest land. Drive it: select all, press Dismiss, and
 * read the held receipt.
 */
export const BulkDismissPartial: Story = {
	render: () =>
		page(
			{
				items: POPULATED,
				waiting: WAITING,
				refuseOnBulkDismiss: "n_prreviewcheckeo",
			},
			{ prefs: { "notifications-read-state": "all" } },
		),
};

/** Grouped by conversation instead of time. */ export const ByConversation: Story =
	{
		render: () =>
			page(
				{ items: POPULATED, waiting: WAITING },
				{
					prefs: {
						"notifications-read-state": "all",
						"notifications-grouping": "conversation",
					},
				},
			),
	};

/** The detail pane open on the ×6 high item: body table, history, project. */
export const Detail: Story = {
	render: () =>
		page(
			{ items: POPULATED, waiting: WAITING, detail: DETAIL },
			{
				path: `/notifications/${FRAUD.id}`,
				prefs: { "notifications-read-state": "all" },
			},
		),
};

/** The open ask's detail: that conversation's ask answerable in place. */
export const AskDetail: Story = {
	render: () =>
		page(
			{ items: POPULATED, waiting: WAITING },
			{
				path: `/notifications/${encodeURIComponent(ASK_ID)}`,
				prefs: { "notifications-read-state": "all" },
			},
		),
};

/*
 * THE ASK-PANE STATES (the stale-card fix). Two near-identical asks in ONE
 * conversation - the confusion that motivated the settled row's answer line - and a
 * play that drives the REAL panel: pick an option, press the door, hold the shutter
 * until the claimed state is on screen.
 */
const SESSION_TWIN = "aaaaaaaaaaa2";
const twinAsk = (askId: string, question: string): PendingAsk =>
	({
		...ASK,
		ask_id: askId,
		session_id: SESSION_TWIN,
		urgent: false,
		expires_at: NOW + 23 * HOUR,
		questions: [
			{
				id: "rotate",
				question,
				recommended: 0,
				multi: false,
				options: [
					{
						label: "Rotate the edge secret after all three leaks are closed",
						description: "Then rotate, with you approving the exact commands.",
					},
					{ label: "No rotation; closing the leaks is enough" },
				],
			},
		],
	}) as PendingAsk;
const TWIN_A = twinAsk(
	"a-7f3c",
	"RADIENT_EDGE_SECRET was exposed in WAF samples, WAF logs and the Caddy access log. Should the edge secret be rotated once the fixes are live?",
);
const TWIN_B = twinAsk(
	"a-8e21",
	"RADIENT_EDGE_SECRET was exposed in WAF samples, WAF logs and the Caddy access log. Should the edge secret be rotated before the fixes are live?",
);
const twinState = (answerMode?: Stub["answerMode"]): Stub => ({
	items: POPULATED,
	waiting: WAITING,
	asks: [structuredClone(TWIN_A), structuredClone(TWIN_B)],
	answerMode,
});
const ASK_PANE = {
	path: `/notifications/${encodeURIComponent(ASK_ID)}`,
	prefs: { "notifications-read-state": "all" },
};
const waitFor = async (done: () => boolean, budgetMs = 6_000) => {
	const until = Date.now() + budgetMs;
	while (!done() && Date.now() < until)
		await new Promise((resolve) => setTimeout(resolve, 50));
	return done();
};
/** Drive ask A's card through one door, holding the shutter until `claimed` holds. */
const NO_LONGER_NEEDED = /no longer needed/i;
const driveAsk =
	(
		door: "answer" | "secret" | "decline" | "dismiss",
		claimed: (root: Element) => boolean,
	) =>
	async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const root = document.documentElement;
		root.dataset.capturePending = "true";
		const card = () =>
			canvasElement.querySelector(`[data-lo-ask-row="${TWIN_A.ask_id}"]`);
		const button = (label: string, scope: Element | null = card()) =>
			[...(scope?.querySelectorAll("button") ?? [])].find(
				(node) => node.textContent?.trim() === label,
			) as HTMLButtonElement | undefined;
		if (!(await waitFor(() => card() !== null))) {
			root.dataset.captureFailed = "true";
			return;
		}
		if (door === "secret") {
			/*
			 * After the first reads land: a value typed into the field the pane drew from
			 * the detail read alone is lost when the aggregate read re-renders the card.
			 */
			await new Promise((resolve) => setTimeout(resolve, 1_500));
			/*
			 * Typed the way a reader types (the native setter, then `input`), so the
			 * frame shows what the pane paints after an accepted SECRET answer: the
			 * masked key form, never the value (agent review round 1, R1-1).
			 */
			const field = card()?.querySelector<HTMLInputElement>(
				"input[data-ask-secret]",
			);
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			if (field && setter) {
				setter.call(field, "sk-story-not-a-real-value");
				field.dispatchEvent(new Event("input", { bubbles: true }));
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
			button("Send answer")?.click();
		} else if (door === "answer") {
			(
				card()?.querySelector("[data-ask-option]") as HTMLElement | null
			)?.click();
			await new Promise((resolve) => setTimeout(resolve, 50));
			button("Send answer")?.click();
		} else if (door === "decline") button("Decline")?.click();
		else {
			button("Dismiss…")?.click();
			const reason = () =>
				[...(card()?.querySelectorAll("button") ?? [])].find((node) =>
					NO_LONGER_NEEDED.test(node.textContent ?? ""),
				) as HTMLButtonElement | undefined;
			await waitFor(() => reason() !== undefined, 2_000);
			reason()?.click();
		}
		if (await waitFor(() => claimed(canvasElement)))
			delete root.dataset.capturePending;
		else root.dataset.captureFailed = "true";
	};
const settledRow = (root: Element, word: string) =>
	[...root.querySelectorAll("[data-lo-ask-settled] button")].some((node) =>
		node.textContent?.startsWith(word),
	);

/** Two near-identical pending asks in one conversation, both answerable. */
export const AskPanePending: Story = {
	render: () => page(twinState(), ASK_PANE),
};
/** Send answer pressed; the owner has not answered yet: the card says Sending…. */
export const AskPaneSending: Story = {
	render: () => page(twinState("hang"), ASK_PANE),
	play: driveAsk(
		"answer",
		(root) => root.querySelector("[data-lo-ask-sending]") !== null,
	),
};
/** Accepted: the card is Answered — delivering with the chosen option; B stays pending. */
export const AskPaneAnswered: Story = {
	render: () => page(twinState(), ASK_PANE),
	play: driveAsk(
		"answer",
		(root) =>
			root
				.querySelector(`[data-lo-ask-row="${TWIN_A.ask_id}"]`)
				?.getAttribute("data-lo-ask-status") === "answered",
	),
};
/** A SECRET question answered: the card names the key, never the typed value (R1-1). */
export const AskPaneSecretAnswered: Story = {
	render: () =>
		page(
			{
				...twinState(),
				asks: [
					{
						...structuredClone(TWIN_A),
						questions: [
							{
								id: "edge_secret",
								question:
									"Paste the rotated RADIENT_EDGE_SECRET so the worker can update the edge.",
								secret: true,
							},
						],
					},
					structuredClone(TWIN_B),
				],
			},
			ASK_PANE,
		),
	play: driveAsk("secret", (root) => {
		const card = root.querySelector(`[data-lo-ask-row="${TWIN_A.ask_id}"]`);
		return (
			card?.getAttribute("data-lo-ask-status") === "answered" &&
			!card.textContent?.includes("sk-story-not-a-real-value")
		);
	}),
};
/** Delivered: ask A files under Settled, naming its question and its answer. */
export const AskPaneDelivered: Story = {
	/*
	 * The detail read itself carries the delivered row here (an update's detail, or the
	 * aggregate's row merged over the pane's read - the same rows either way), opened
	 * on the still-open twin so the route answers.
	 */
	render: () =>
		page(
			{
				items: POPULATED,
				waiting: WAITING,
				detail: {
					item: WAITING[0],
					history: [],
					session: WAITING[0].session,
					anchor: null,
					projects: [],
					asks: [
						{
							...structuredClone(TWIN_A),
							status: "answered",
							delivered: true,
							answered_at: NOW - 2 * MINUTE,
							answered_by: { surface: "desktop" },
							answers: {
								rotate: [
									"Rotate the edge secret after all three leaks are closed",
								],
							},
						} as PendingAsk,
						structuredClone(TWIN_B),
					],
				},
			},
			ASK_PANE,
		),
};
/** Declined: filed under Settled as Declined; B stays pending. */
export const AskPaneDeclined: Story = {
	render: () => page(twinState(), ASK_PANE),
	play: driveAsk("decline", (root) => settledRow(root, "Declined")),
};
/** Dismissed with a reason: filed under Settled as Dismissed. */
export const AskPaneDismissed: Story = {
	render: () => page(twinState(), ASK_PANE),
	play: driveAsk("dismiss", (root) => settledRow(root, "Dismissed")),
};
/** A transport failure: the sentence and Retry, the chosen option kept. */
export const AskPaneError: Story = {
	render: () => page(twinState("fail"), ASK_PANE),
	play: driveAsk(
		"answer",
		(root) => root.querySelector("[data-lo-ask-refused] button") !== null,
	),
};

/** A body with a 200-character unbroken token and a long fenced command (the overflow fix). */
const LONG = "x".repeat(200);
const longBody = (box?: { width: number; height: number }) =>
	page(
		{
			items: POPULATED,
			waiting: WAITING,
			detail: {
				...DETAIL,
				item: {
					...DETAIL.item,
					title:
						"Cloud node: Slack works remotely now; Datadog and Google still need your sign-in",
					body_md: [
						"**Slack works on the cloud node.** A new remote session read a Slack profile with the key shared at 07:31.",
						"",
						"1. **Datadog:** your sign-in on the Mac has expired. On the Mac, run `lop mcp reauth datadog`. New node sessions pick it up without a restart.",
						"2. **Google Workspace on the node (optional):** sign in now through a tunnel: run `ssh -L 8000:localhost:8000 -i ~/.ssh/lop-mesh-nprod.pem ec2-user@16.52.14.201` and open the sign-in link.",
						"",
						`An unbroken token: ${LONG}`,
						"",
						"```",
						`ssh -L 8000:localhost:8000 -i ~/.ssh/lop-mesh-nprod.pem ec2-user@16.52.14.201 -- ${LONG}`,
						"```",
					].join("\n"),
				},
				/*
				 * The operator's item carried the conversation's asks too: a delivering card
				 * with a long question and a settled history - the cards and the filter row
				 * were among the clipped boxes.
				 */
				asks: [
					{
						...structuredClone(TWIN_A),
						status: "answered",
						delivered: false,
						answered_at: NOW - 2 * MINUTE,
						answers: {
							rotate: [
								`Allow one more run once the guard delta is reviewed ${LONG}`,
							],
						},
					} as PendingAsk,
					...(Array.from({ length: 6 }, (_, n) => ({
						...structuredClone(TWIN_B),
						ask_id: `a-90${n}0`,
						status: "answered",
						delivered: true,
						answered_at: NOW - (10 + n) * MINUTE,
						answers: { rotate: ["No rotation; closing the leaks is enough"] },
					})) as PendingAsk[]),
				],
			},
		},
		{
			path: `/notifications/${FRAUD.id}`,
			prefs: { "notifications-read-state": "all" },
			...(box ? { box } : {}),
		},
	);
export const LongBodyDetail: Story = { render: () => longBody() };
/** The same body at the three evidence widths: wide, the 1024 default and narrow. */
export const LongBodyWide: Story = {
	render: () => longBody({ width: 1600, height: 900 }),
};
export const LongBody1024: Story = {
	render: () => longBody({ width: 1024, height: 900 }),
};
export const LongBodyNarrow: Story = {
	render: () => longBody({ width: 820, height: 900 }),
};

/** A hundred and sixty rows over six conversations: the From menu sorts by volume. */
/**
 * DEEP SCROLL: enough rows that the reel pages past its window (code round 5, R5-1).
 *
 * The page window is five pages of 100, so nothing about the sliding behaviour is
 * visible on a fixture that fits in one or two: this story seeds 700 rows, which is
 * seven fetches, so scrolling to the bottom slides the window, the rows above the
 * viewport leave memory and the back-to-top pill appears with a real count.
 */
const DEEP_VOLUME: DesktopNotificationItem[] = Array.from(
	{ length: 700 },
	(_, index) =>
		item({
			id: `n_deep${String.fromCharCode(97 + Math.floor(index / 676))}${String.fromCharCode(97 + (Math.floor(index / 26) % 26))}${String.fromCharCode(97 + (index % 26))}`,
			priority: index % 11 === 0 ? "high" : "normal",
			title: `Deep scroll row ${index + 1}`,
			excerpt: `Row ${index + 1} of a seven-hundred-row conversation.`,
			seq: 7000 - index,
		}),
);

export const DeepScroll: Story = {
	render: () =>
		page(
			{ items: DEEP_VOLUME, waiting: WAITING },
			{ prefs: { "notifications-read-state": "all" } },
		),
};

export const HighVolume: Story = {
	render: () =>
		page(
			{ items: HIGH_VOLUME, waiting: WAITING },
			{ prefs: { "notifications-read-state": "all" } },
		),
};

/**
 * Refresh failed with a list held: the stale notice, writes paused. The first
 * read answers; the page's refetch then fails (the bridge's `failAfterFirst`).
 */
export const RefreshFailed: Story = {
	render: () =>
		page(
			{ items: POPULATED, waiting: WAITING, failAfterFirst: true },
			{ prefs: { "notifications-read-state": "all" } },
		),
	play: async ({ canvasElement }) => {
		const until = Date.now() + 4_000;
		while (
			!canvasElement.querySelector("[data-notifications-list]") &&
			Date.now() < until
		)
			await new Promise((resolve) => setTimeout(resolve, 50));
		(
			canvasElement.querySelector(
				'[aria-label="Refresh notifications"]',
			) as HTMLElement | null
		)?.click();
	},
};

/**
 * Multi-select with a live ask in the selection: "Dismiss 3" and the note
 * that the ask stays (design § 6). Selection is made by the row checkboxes,
 * the real path a pointer takes.
 */
export const MultiSelect: Story = {
	render: () =>
		page(
			{ items: POPULATED, waiting: WAITING },
			{ prefs: { "notifications-read-state": "all" } },
		),
	play: async ({ canvasElement }) => {
		const until = Date.now() + 4_000;
		while (
			canvasElement.querySelectorAll("[data-notification-row]").length < 4 &&
			Date.now() < until
		)
			await new Promise((resolve) => setTimeout(resolve, 50));
		const rows = [
			...canvasElement.querySelectorAll<HTMLElement>("[data-notification-row]"),
		];
		for (const id of [
			ASK_ID,
			FRAUD.id,
			"n_prreviewcheckeo",
			"n_nightlybuildeo",
		]) {
			const row = rows.find(
				(element) => element.dataset.notificationRow === id,
			);
			row?.querySelector<HTMLElement>('button[role="checkbox"]')?.click();
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
	},
};

/*
 * THE REPORTED NARROW WINDOW, IN BOTH LANGUAGES AT ONE SIZE (U1/Q6).
 *
 * 980x380 is the window UX measured the clipped toolbar in. The box is pinned
 * rather than inherited from the host, because the proof is that ESSENTIAL
 * ACTIONS stay reachable at that size in the LONGER locale, and a host that
 * happened to be wider would photograph the easy case: the pair is same-size
 * control, not two different viewports.
 */
const narrow = () => {
	/*
	 * THE LOCALE COMES FROM THE STORY'S OWN `locale` ARG (design round 2, D3).
	 *
	 * `parameters.locale` is not a channel this Storybook reads — the preview
	 * decorator pins through `context.args.locale`, and it re-asserts the pin
	 * against a bridge stub whose `capabilities` answer carries a fixed
	 * `language`. So a story claiming French in its name used to render in
	 * whatever the host resolved to. The two narrow stories now declare the arg
	 * themselves; opening either by id alone is a real frame in that language,
	 * and `?args=locale:` still overrides it for an ad-hoc capture.
	 */
	const state = { items: POPULATED, waiting: WAITING };
	return (
		<FreshCache>
			<RouteTo path="/notifications">
				<div
					className="overflow-hidden bg-canvas"
					style={{ width: 980, height: 380 }}
					data-narrow-capture=""
				>
					<NotificationsPage nowMs={NOW} />
				</div>
			</RouteTo>
			{(() => {
				install(state);
				return null;
			})()}
		</FreshCache>
	);
};

export const NarrowEnglish: Story = {
	render: () => narrow(),
	args: { locale: "en" },
};

export const NarrowFrench: Story = {
	render: () => narrow(),
	args: { locale: "fr" },
};

/** Below the capability: the page states it and reads nothing. */
export const Unsupported: Story = {
	render: () => page({ items: [], waiting: [], capability: false }),
};

/* --------------------------------------------------- partial-result status */

/*
 * THE PARTIAL RESULT, SEEDED (design round 2, D4).
 *
 * `ui.notifications.operation.progress` only ever appears after a bulk read,
 * dismiss or Undo has actually run, and the state worth signing off is the one
 * that says the operation did NOT fully land: some rows confirmed, some
 * explicitly skipped, some without a conclusive answer. A reviewer cannot
 * summon that by hand — it needs a racing write or a dropped connection — so
 * the line is rendered here from fixed counts, through the same component and
 * the same catalogue key the page uses. Nothing about the fixture decides the
 * wording; the translations do.
 */
const ProgressPanel = ({
	progress,
}: {
	progress: { changed: number; skipped: number; pending: number };
}) => (
	<div className="flex w-[520px] flex-col gap-2 bg-elevated p-4">
		<span className="text-body-sm text-ink-muted">
			{upperBoundLabel(progress)}
		</span>
		<OperationProgressLine progress={progress} />
	</div>
);

/** What the three counts mean, stated in the frame so the numbers cannot be read as a percentage. */
const upperBoundLabel = (progress: {
	changed: number;
	skipped: number;
	pending: number;
}) =>
	`Partial result: ${progress.changed} confirmed, ${progress.skipped} refused by the server, ${progress.pending} without a conclusive answer.`;

/** A bulk Undo that landed partially: this is the state the toast must not call "Restored". */
export const OperationStatusPartial: Story = {
	render: () => (
		<FreshCache>
			<ProgressPanel progress={{ changed: 118, skipped: 2, pending: 3 }} />
		</FreshCache>
	),
};

/** A lost response mid-batch: nothing is claimed about the unanswered rows. */
export const OperationStatusNotConfirmed: Story = {
	render: () => (
		<FreshCache>
			<ProgressPanel progress={{ changed: 40, skipped: 0, pending: 60 }} />
		</FreshCache>
	),
};

/* ------------------------------------------------------------- drawer tab */

const DRAWER_ITEMS: DesktopNotificationItem[] = [
	FRAUD,
	item({
		id: "n_fraudreadeo",
		title: "Merchant m_2290 cleared",
		updated_at: NOW - 70 * MINUTE,
		read: true,
		read_via: "in_view",
		anchor_id: "toolu_fraud_2",
	}),
	item({
		id: "n_fraudreadthreo",
		priority: "low",
		title: "Baseline recomputed",
		updated_at: NOW - 3 * HOUR,
		read: true,
		read_via: "watching",
	}),
];

/*
 * The REAL drawer, mounted with the REAL rail beside it at the width the product
 * uses: the tab strip is judged where it ships, not in a bare panel (D1). The
 * scope selector is its own full-width row, so a long translation cannot squeeze
 * three unrelated labels into one 360px line.
 */
const Drawer = ({
	tab,
	view = "unread",
}: {
	tab: "updates" | "asks";
	view?: "unread" | "read";
}) => {
	/*
	 * THE REAL DIRECTION SEAM, ON THIS STORY TOO (design round 2, D2).
	 *
	 * `dir="auto"` guessed a direction from the first strong character of the
	 * container's text, which is not what the product does and produced an
	 * "RTL" frame of Urdu in an LTR layout. The app resolves direction from the
	 * locale store, so this fixture mounts the same provider and the same
	 * document writer the page stories do: under a pinned `ur` locale the
	 * subtree is RTL because <html dir> is, and nothing here decides it.
	 */
	useDocumentDirection();
	const [current, setCurrent] = useState<"asks" | "updates" | "all">(tab);
	const [rows, setRows] = useState<PendingAsk[]>([ASK]);
	/*
	 * The product's own count (chat-content reads this hook), not a snapshot of the
	 * fixture at render: a snapshot stayed put while a mark-read moved everything
	 * else, which is the drift the drawer's evidence has to show is gone.
	 */
	const updates = useSessionUnreadUpdates("aaaaaaaaaaa1", true);
	return (
		<LocaleDirectionProvider>
			<div className="flex h-[560px] w-[404px] shrink-0 bg-canvas">
				<div className="min-w-0 flex-1">
					<AskDrawer
						frontend={{
							asks: rows,
							asks_open: rows.length,
							asks_truncated: false,
						}}
						scope={current === "all" ? "fleet" : "session"}
						onClose={() => {}}
						onAnswer={(askId) =>
							setRows((list) => list.filter((row) => row.ask_id !== askId))
						}
						onDecline={() => {}}
						onRevise={() => {}}
						nowMs={NOW}
						tabs={{
							strip: (
								<DrawerTabs
									tab={current}
									onTab={setCurrent}
									asks={rows.length}
									unreadUpdates={updates}
									sessionless={false}
								/>
							),
							body:
								current === "updates" ? (
									<DrawerUpdates
										sessionId="aaaaaaaaaaa1"
										nowMs={NOW}
										initialView={view}
									/>
								) : null,
						}}
					/>
				</div>
				<PanelRailFrame
					sessionId="aaaaaaaaaaa1"
					askScope={current === "all" ? "fleet" : "session"}
					askCount={rows.length}
					askUpdates={updates}
				/>
			</div>
		</LocaleDirectionProvider>
	);
};

/** The asks drawer's Updates tab for one conversation (design § 18). */
export const DrawerUpdatesTab: Story = {
	/* Hold the receipt so a reviewer can photograph the toast and its Undo,
	   rather than racing the 6 s window the product deliberately uses. */
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () => {
		install({ items: DRAWER_ITEMS, waiting: [] });
		return (
			<FreshCache>
				<Drawer tab="updates" />
			</FreshCache>
		);
	},
};

/** The Read view: the history a mark-read moves a row into. */
export const DrawerUpdatesRead: Story = {
	render: () => {
		install({ items: DRAWER_ITEMS, waiting: [] });
		return (
			<FreshCache>
				<Drawer tab="updates" view="read" />
			</FreshCache>
		);
	},
};

/** Nothing flagged in this conversation. */
export const DrawerUpdatesEmpty: Story = {
	render: () => {
		install({ items: [], waiting: [] });
		return (
			<FreshCache>
				<Drawer tab="updates" />
			</FreshCache>
		);
	},
};

/* --------------------------------------------------------- flag line */

/** The in-transcript line, unread and seen (design § 17.2). */
export const FlagLines: Story = {
	render: () => {
		install({ items: DRAWER_ITEMS, waiting: [] });
		return (
			<FreshCache>
				<FlagLinesProvider sessionId="aaaaaaaaaaa1">
					<div className="flex w-[640px] flex-col gap-4 bg-canvas p-6">
						<FlagLine item={FRAUD} />
						<FlagLine item={DRAWER_ITEMS[1]} />
					</div>
				</FlagLinesProvider>
			</FreshCache>
		);
	},
};

/* ------------------------------------------------------------- sidebar */

/*
 * The sidebar BEFORE and AFTER the capability (design § 1, decisions D5/D10).
 * Before: an older core, no `features.notifications`, so no row and Schedules
 * still visible. After: the row under Aida carrying the `emphasis` count
 * (3 unread + 1 waiting = 4), Schedules folded into More. Same component, same
 * bridge; only the advertised capability differs.
 */
/* The sidebar needs the shell's frame context (`useSidebarFrame`), so it is
   drawn inside `ChatLayout` exactly as `route-audit.stories.tsx` composes it. */
const Rail = ({ path }: { path: string }) => (
	<div className="relative flex h-screen flex-col overflow-hidden">
		<ChatLayout
			sidebar={<SidebarNavigation />}
			content={
				<main className="panel-top-pad flex min-w-0 grow flex-col overflow-hidden">
					<RouteTo path={path}>
						{path === "/notifications" ? (
							<NotificationsPage nowMs={NOW} />
						) : (
							<div />
						)}
					</RouteTo>
				</main>
			}
		/>
	</div>
);

export const SidebarBefore: Story = {
	render: () => {
		install({ items: POPULATED, waiting: WAITING, capability: false });
		return (
			<FreshCache>
				<Rail path="/chat" />
			</FreshCache>
		);
	},
};

export const SidebarAfter: Story = {
	render: () => {
		install({ items: POPULATED, waiting: WAITING });
		return (
			<FreshCache>
				<Rail path="/notifications" />
			</FreshCache>
		);
	},
};

/**
 * THE BADGE, BEFORE AND AFTER (decisions D5, reversed 2026-10-28 so every
 * sidebar attention count now wears `emphasis`): the old quiet register beside
 * the `emphasis` register, on the four grounds the rail draws a count on. Both pills compose the
 * SHIPPED `badgeVariants` call the rail makes, so this frame cannot drift from
 * the row; the contrast numbers are asserted in `scripts/contrast-contract.mjs`
 * ("rail attention badge (emphasis)").
 */
export const BadgeRegisters: Story = {
	render: () => (
		<div className="flex flex-col gap-3 bg-canvas p-6 text-body-sm text-ink-muted">
			{(
				[
					["canvas", "bg-canvas"],
					["surface", "bg-surface"],
					["row-hover", "bg-row-hover"],
					["row-selected", "bg-row-selected"],
				] as const
			).map(([name, ground]) => (
				<div
					key={name}
					className={`flex w-[320px] items-center justify-between rounded-sm px-3 py-2 ${ground}`}
				>
					<span>{name}</span>
					<span className="flex items-center gap-6">
						<Badge variant="attentionQuiet" shape="pill" size="count">
							4
						</Badge>
						<Badge variant="emphasis" shape="pill" size="count">
							4
						</Badge>
					</span>
				</div>
			))}
		</div>
	),
};

/**
 * Geometry stress, not a second row: render the shipped component, then allow
 * the content to wrap in the last cases. The invariant must survive taller
 * content rather than depending on today's ellipsis hiding the defect.
 * The before run records its failed geometry without stopping the screenshot;
 * the final story fails closed on any >1px first-line drift or <24px target.
 */
export const RowAlignment: Story = {
	render: () => (
		<div className="bg-canvas p-6" data-alignment-cases="">
			<style>{`
				[data-align-wrap] [data-notification-title] { white-space: normal; overflow: visible; }
				[data-align-wrap] [role=gridcell]:nth-child(3) > div { align-items: flex-start; }
				[data-align-wrap] [role=gridcell]:nth-child(3) > div:nth-child(2) { flex-wrap: wrap; }
				[data-align-wrap] [role=gridcell]:nth-child(3) > div:nth-child(2) > span:last-child { white-space: normal; }
			`}</style>
			{[
				{
					name: "one-line",
					width: 600,
					title: "Build finished",
					excerpt: "",
					compact: true,
				},
				{
					name: "two-line",
					width: 600,
					title: "Build finished",
					excerpt: "All checks passed",
					compact: false,
				},
				{
					name: "wrapped-title",
					width: 420,
					title:
						"A longer update title that wraps across three lines in a narrow list",
					excerpt: "All checks passed",
					compact: false,
					wrap: true,
				},
				{
					name: "wrapped-subtitle",
					width: 420,
					title: "Build finished",
					excerpt:
						"The checks completed successfully and the deployment is ready for the next scheduled release window",
					compact: false,
					wrap: true,
				},
				{
					name: "high-badge",
					width: 600,
					title: "Review needed",
					excerpt: "A decision is waiting",
					compact: false,
					high: true,
				},
				{
					name: "compact",
					width: 420,
					title: "Review needed",
					excerpt: "An update in this conversation",
					compact: true,
					high: true,
				},
			].map((example, index) => (
				<div
					key={example.name}
					data-align-case={example.name}
					data-align-wrap={example.wrap ? "" : undefined}
					style={{ width: example.width }}
					className="mb-4 border-b border-hairline"
				>
					<NotificationRow
						item={item({
							id: `align-${index}`,
							title: example.title,
							excerpt: example.excerpt,
							priority: example.high ? "high" : "normal",
						})}
						nowMs={NOW}
						open={false}
						picked={false}
						selecting
						focused={false}
						writesPaused={false}
						hideSource={example.compact}
						onOpen={() => {}}
						onToggleSelect={() => {}}
						onToggleRead={() => {}}
						onDismiss={() => {}}
						onAnswer={() => {}}
						onFocusRow={() => {}}
					/>
				</div>
			))}
		</div>
	),
	play: async ({ canvasElement }) => {
		await document.fonts.ready;
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
		const measurements = [
			...canvasElement.querySelectorAll<HTMLElement>("[data-align-case]"),
		].map((row) => {
			const title = row.querySelector<HTMLElement>("[data-notification-title]");
			const checkbox = row.querySelector<HTMLElement>('[role="checkbox"]');
			if (!title || !checkbox)
				throw new Error("Alignment fixture missing real row controls");
			const box = checkbox.getBoundingClientRect();
			const text = title.getBoundingClientRect();
			const firstLine =
				text.top + Number.parseFloat(getComputedStyle(title).lineHeight) / 2;
			return {
				name: row.dataset.alignCase,
				checkboxCenter: box.top + box.height / 2,
				firstLineCenter: firstLine,
				delta: Math.abs(box.top + box.height / 2 - firstLine),
				width: box.width,
				height: box.height,
			};
		});
		canvasElement.dataset.alignmentMeasurements = JSON.stringify(measurements);
		if (
			measurements.some(
				(row) => row.delta > 1 || row.width < 24 || row.height < 24,
			)
		)
			throw new Error(
				`First-line alignment/target failed: ${JSON.stringify(measurements)}`,
			);
	},
};

/** A bounded shutter latch: async selection must settle before a frame is valid. */
const bulkStory = async (run: () => Promise<void>) => {
	document.documentElement.dataset.capturePending = "notifications-bulk";
	delete document.documentElement.dataset.captureFailed;
	try {
		await run();
		await document.fonts.ready;
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
	} catch (error) {
		document.documentElement.dataset.captureFailed = String(error);
		throw error;
	} finally {
		delete document.documentElement.dataset.capturePending;
	}
};
const waitBulkElement = async (selector: string): Promise<HTMLElement> => {
	const until = Date.now() + 5_000;
	while (Date.now() < until) {
		const node = document.querySelector<HTMLElement>(selector);
		if (node) return node;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Bulk story did not reach ${selector}`);
};

export const BulkAllSelected: Story = {
	render: () =>
		page(
			{ items: POPULATED, waiting: [] },
			{ prefs: { "notifications-read-state": "all" } },
		),
	play: async () =>
		bulkStory(async () => {
			await waitBulkElement("[data-notification-row]");
			(await waitBulkElement("[data-notifications-select-all]")).click();
			await waitBulkElement(
				'[data-notifications-select-all][data-state="checked"]',
			);
		}),
};

export const BulkMixedAsks: Story = {
	render: () =>
		page(
			{ items: POPULATED, waiting: WAITING, askReadCapability: true },
			{ prefs: { "notifications-read-state": "all" } },
		),
	play: async () =>
		bulkStory(async () => {
			await waitBulkElement("[data-notification-row]");
			(await waitBulkElement("[data-notifications-select-all]")).click();
			await waitBulkElement("[data-notifications-asks-stay]");
		}),
};

export const BulkBeyondLoaded: Story = {
	render: () =>
		page(
			{ items: HIGH_VOLUME, waiting: [] },
			{ prefs: { "notifications-read-state": "all" } },
		),
	play: async () =>
		bulkStory(async () => {
			await waitBulkElement("[data-notification-row]");
			(await waitBulkElement("[data-notifications-dismiss-all]")).click();
			await waitBulkElement("[data-notifications-confirm-view]");
		}),
};

export const BulkUndoToast: Story = {
	render: () =>
		page(
			{ items: POPULATED, waiting: [] },
			{ prefs: { "notifications-read-state": "all" } },
		),
	play: async () =>
		bulkStory(async () => {
			await waitBulkElement("[data-notification-row]");
			(await waitBulkElement("[data-notifications-dismiss-all]")).click();
			await waitBulkElement(".Toastify__toast");
			const until = Date.now() + 5_000;
			while (
				document.querySelector("[data-notification-row]") &&
				Date.now() < until
			)
				await new Promise((resolve) => setTimeout(resolve, 20));
			if (document.querySelector("[data-notification-row]"))
				throw new Error("Dismiss did not remove the rows");
		}),
};

export const BulkOlderCore: Story = {
	render: () =>
		page(
			{ items: POPULATED, waiting: WAITING, bulkCapability: false },
			{ prefs: { "notifications-read-state": "all" } },
		),
};
