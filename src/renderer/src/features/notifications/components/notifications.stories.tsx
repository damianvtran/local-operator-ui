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
import { DrawerTabs, DrawerUpdates } from "./drawer-updates";
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
						...(stub.capability === false ? {} : { notifications: 1 }),
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
								asks: found.source === "ask" ? [ASK] : [],
							}
						: null;
				})();
			if (!detail)
				return { status: 404, body: { detail: "no such notification" } };
			return { status: 200, body: { result: detail } };
		}
		case "notifications.read":
		case "notifications.dismiss":
			return fixture.request(request);
		/*
		 * The detail pane's real answer component posts here. Removing the ask is
		 * what makes an "answered ask leaves the reel" claim observable.
		 */
		case "sessions.answer": {
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
	/* The local-dismiss receipt must be capturable without racing its 6 s Undo
	   window; this is the stateful fixture a reviewer drives, not a second toast. */
	parameters: { toastDuration: Number.POSITIVE_INFINITY },
	render: () =>
		page(
			{ items: POPULATED, waiting: WAITING },
			{ prefs: { "notifications-read-state": "all" } },
		),
};

/** Grouped by conversation instead of time. */
export const ByConversation: Story = {
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

/** A hundred and sixty rows over six conversations: the From menu sorts by volume. */
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
const Drawer = ({ tab }: { tab: "updates" | "asks" }) => {
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
	const updates = fixture.counts().unread_count;
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
									<DrawerUpdates sessionId="aaaaaaaaaaa1" nowMs={NOW} />
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
 * THE BADGE, BEFORE AND AFTER (decisions D5): the quiet register every other
 * rail row keeps, beside the `emphasis` register the Notifications row now
 * wears, on the four grounds the rail draws a count on. Both pills compose the
 * SHIPPED `badgeVariants` call the rail makes, so this frame cannot drift from
 * the row; the contrast numbers are asserted in `scripts/contrast-contract.mjs`
 * ("rail notifications badge (emphasis)").
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
