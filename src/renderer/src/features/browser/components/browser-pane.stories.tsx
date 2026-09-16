import { ChatHeader } from "@features/chat/components/chat-header";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import type { FC, ReactElement, ReactNode } from "react";
import { useEffect, useState } from "react";
import type { BrowserChromeState } from "../hooks/use-browser-chrome";
import type { ApprovalRequestInput } from "../model/approval-queue-model";
import { BrowserPage } from "./browser-page";
import { BrowserPane } from "./browser-pane";

/**
 * The conversation-scoped browser pane, in the states the review has to judge.
 * Design: docs/design/browser-approval-ux.md 7.1-7.4 (the pane, the scope
 * switch, the states it adds), 10.2 (PR 2's state matrix).
 *
 * WHY THESE STORIES STUB THE BRIDGE, WHICH NO OTHER BROWSER STORY DOES.
 *
 * The pane is the first browser surface whose states cannot be expressed as
 * props: it renders `BrowserSurface`, which reads the host's projection through
 * `window.api.browser`, and a story that does not answer that bridge renders
 * "The browser is only available in the desktop app." for every state it means to
 * show. The alternatives were worse. Props would mean a prop path through the
 * surface that exists only for stories — a second way to feed a component whose
 * single input is deliberately the projection. Capturing only from the live app
 * is not available: the pane lives in the chat route, and that route is gated on
 * the backend's `session_catalogue` capability, so a backend-less run (the whole
 * point of an evidence rig) never renders the chat header the pane opens from.
 *
 * So the fixture here is a PROJECTION — the same object main publishes, of the
 * same shape the contract tests drive — installed as a stub before the story
 * renders, exactly as `scripts/browser-chrome.test.mjs` installs one. What that
 * buys and what it does not:
 *
 * - It is the real component: the real `useBrowserChrome`, the real
 *   `ResizeObserver` rect reporter (the caption under each frame is the
 *   rectangle the product's own `measure()` reported, not a number typed here),
 *   the real strip, tray, dock and empty states.
 * - It is NOT a real page. There is no `WebContentsView` in a preview iframe, so
 *   no frame here shows a page; the strip's own grammar and the pane's chrome are
 *   the claim, and the live route's page composition is
 *   `scripts/browser-chrome-proof.mjs`.
 *
 * THE FIXTURE CARRIES TWO CONVERSATIONS ON PURPOSE. Every story has tab and
 * request rows belonging to another conversation, because the claim this feature
 * makes is a NEGATIVE one — "this pane shows this conversation's rows and not the
 * others' " — and a fixture with one conversation in it cannot show a filter
 * working. The `All tabs` and `Route for comparison` stories are the same fixture
 * with the other side of the comparison showing.
 */

const NOW = Date.now();

/** The conversation the pane is scoped to. The stories' chat route carries this
 * id, and it is the app's own spelling (the bare id the routes and the session
 * list use), which is what `chromeState` publishes. */
const THIS_CONVERSATION = "session-1f4c";
const OTHER_CONVERSATION = "session-9ab2";

const REQUEST = (
	entryId: string,
	authority: string,
	requesterSessionId: string | null,
	minutesLeft = 9,
): ApprovalRequestInput => ({
	entryId,
	origin: `https://${authority}`,
	authority,
	broad: { scope: "domain", key: authority.split(".").slice(-2).join(".") },
	expiresAt: NOW + Math.round(minutesLeft * 60_000),
	requesterSessionId,
});

/** Two requests for this conversation and one for another: the pane's tray must
 * show two, and the route's must show three. */
const REQUESTS = [
	REQUEST("this-1", "login.example.com", THIS_CONVERSATION),
	REQUEST("this-2", "docs.example.org", THIS_CONVERSATION, 6),
	REQUEST("other-1", "billing.example.net", OTHER_CONVERSATION, 4),
];

type TabFixture = BrowserChromeState["tabs"][number];

const tab = (
	overrides: Partial<TabFixture> & { tabId: number },
): TabFixture => ({
	title: "Docs",
	url: "https://docs.example.org/guide",
	owner: "agent",
	active: false,
	restored: false,
	handedOver: false,
	failed: false,
	loading: false,
	sessionId: THIS_CONVERSATION,
	...overrides,
});

/** One agent tab of this conversation, parked and loading — the state the pane
 * exists for: an agent is working, in a tab the user is not looking at. */
const AGENT_TAB = tab({
	tabId: 1,
	title: "Reports",
	url: "https://reports.example.com/q3",
	active: true,
	loading: true,
});

/** A user tab, handed to this conversation, so the strip carries the shared
 * marker as well as the agent one. */
const HANDED_TAB = tab({
	tabId: 2,
	title: "Analytics",
	url: "https://analytics.example.com/",
	owner: "user",
	handedOver: true,
});

/** Another conversation's tab, and a restored one that belongs to nobody: both
 * must be absent from the conversation scope and present under All tabs. */
const OTHER_TAB = tab({
	tabId: 3,
	title: "Invoice",
	url: "https://billing.example.net/invoice",
	sessionId: OTHER_CONVERSATION,
});

const RESTORED_TAB = tab({
	tabId: 4,
	title: "Handbook",
	url: "https://handbook.example.com/",
	owner: "user",
	restored: true,
	sessionId: null,
});

const projection = (
	tabs: TabFixture[],
	requests: ApprovalRequestInput[] = [],
): BrowserChromeState => ({
	tabs,
	activeTabId: tabs.find((entry) => entry.active)?.tabId ?? null,
	url: tabs.find((entry) => entry.active)?.url ?? "",
	title: tabs.find((entry) => entry.active)?.title ?? "",
	loading: false,
	canGoBack: false,
	canGoForward: false,
	pendingConsent: requests,
	approvals: [],
	navFailure: null,
});

/*
 * The stub bridge, and the rectangle it records.
 *
 * `rects` is module state rather than a ref so the caption below can read what the
 * surface reported for the frame being photographed: the story's own layout is
 * what the `ResizeObserver` measures, so the number is a measurement by the
 * product's code of the box this frame shows.
 */
const rects: Array<{ x: number; y: number; width: number; height: number }> =
	[];
type BrowserBridgeStub = {
	state: () => Promise<BrowserChromeState>;
	onStateChanged: () => () => void;
	onConsentChanged: () => () => void;
	setContentRect: (rect: unknown) => Promise<unknown>;
	setViewVisible: () => Promise<unknown>;
	[key: string]: unknown;
};

function installBridge(state: BrowserChromeState): void {
	const noop = () => Promise.resolve({});
	const browser: BrowserBridgeStub = {
		state: async () => state,
		onStateChanged: () => () => {},
		onConsentChanged: () => () => {},
		setContentRect: async (rect) => {
			if (rect && typeof rect === "object")
				rects.splice(0, rects.length, rect as (typeof rects)[number]);
			else rects.splice(0, rects.length);
			return {};
		},
		setViewVisible: noop,
		// Every control the surface can call, so a stray click in the preview hits a
		// stub rather than an exception in the iframe.
		newTab: noop,
		closeTab: noop,
		activateTab: noop,
		navigate: noop,
		reload: noop,
		stop: noop,
		history: noop,
		respondToConsent: noop,
		handOver: noop,
		revokeHandOver: noop,
		revokeApproval: noop,
		revokeAllApprovals: noop,
		forgetSite: noop,
		clearData: noop,
		onPopupBlocked: () => () => {},
		onConsentAttention: () => () => {},
	};
	(window as unknown as { api: unknown }).api = { browser };
}

/** The caption under every frame: what the surface reported for the box shown.
 * A frame is evidence about a layout, so the frame carries the number. */
const RectCaption: FC = () => {
	const [reported, setReported] = useState(rects.at(-1) ?? null);
	useEffect(() => {
		const id = setInterval(() => setReported(rects.at(-1) ?? null), 200);
		return () => clearInterval(id);
	}, []);
	return (
		<p className="shrink-0 border-hairline border-t px-3 py-1 font-mono text-ink-muted text-mono-sm">
			reported content rect:{" "}
			{reported
				? `${reported.width}x${reported.height} at ${reported.x},${reported.y}`
				: "none"}
		</p>
	);
};

/** A fixed-size frame around one host, with the caption underneath. The size is a
 * parameter because the pane's whole claim is about a narrower box than the
 * route's — the two stories are photographed at those two widths. */
const frame = (
	width: number,
	height: number,
	story: ReactNode,
): ReactElement => (
	// `layout: "fullscreen"` in the meta, so the viewport IS this box: an evidence
	// frame of a pane should be the pane, not the pane on a larger ground with dead
	// space beside it. `grow` and `min-h-0` on the host's own wrapper are what keep
	// `BrowserSurface`'s full-height chain intact next to the caption.
	<div style={{ width, height }} className="flex flex-col bg-surface">
		<div className="flex min-h-0 grow flex-col">{story}</div>
		<RectCaption />
	</div>
);

const withPane =
	(state: BrowserChromeState, width = 640, height = 460) =>
	(): ReactElement => {
		installBridge(state);
		return frame(
			width,
			height,
			<BrowserPane sessionId={THIS_CONVERSATION} onClose={() => {}} />,
		);
	};

const meta = {
	title: "Browser/Pane",
	component: BrowserPane,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BrowserPane>;
export default meta;
type Story = StoryObj<typeof meta>;

/** This conversation's tabs: an agent tab that is loading and parked, and a user
 * tab handed over to the same conversation. The switch is on `This conversation`,
 * which is what the pane opens on. */
export const ThisConversation: Story = {
	render: withPane(projection([AGENT_TAB, HANDED_TAB])),
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
};

/** The same projection under `All tabs`: the other conversation's tab and the
 * restored one — which belongs to nobody — appear, and the tray's sentence is
 * unchanged, because the switch chooses tabs and not demands (spec 7.2). */
export const AllTabs: Story = {
	render: withPane(
		projection([AGENT_TAB, HANDED_TAB, OTHER_TAB, RESTORED_TAB]),
	),
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
	play: async ({ canvasElement }) => {
		// The REAL press, through the same helper the strip's own stories use: a
		// Radix `TabsTrigger` reacts to a pointer sequence, so a bare `click` event
		// dispatched by hand is a press on nothing and the frame it produced would
		// show the state this story exists to differ from.
		const canvas = within(canvasElement);
		const all = canvas.getByRole("tab", { name: "All tabs" });
		await userEvent.click(all);
	},
};

/** The scope-empty state (spec 7.2): nothing of this conversation is open while
 * three tabs are — one of them another conversation's and one restored — so the
 * copy says what the filter is hiding and `Show all tabs` is the way out. The
 * frame is a claim about the truthfulness of that sentence as much as about its
 * styling. */
export const ScopeEmpty: Story = {
	render: withPane(projection([OTHER_TAB, RESTORED_TAB])),
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
};

/** `Show all tabs` pressed for real: the same projection as `ScopeEmpty` after the
 * empty state's own action, so the frame is the proof that the way out goes
 * somewhere rather than a control that only looks like one. */
export const ShowAllTabs: Story = {
	render: withPane(projection([OTHER_TAB, RESTORED_TAB])),
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const showAll = await canvas.findByRole("button", {
			name: "Show all tabs",
		});
		await userEvent.click(showAll);
	},
};

/** One tab, which is the state a strip is most likely to look broken in: the
 * tab's `grow` and the 50%-of-strip cap are what decide whether a lone tab reads
 * as a tab or as a slab with a dead half beside it (spec 7.4). */
export const OneTab: Story = {
	render: withPane(projection([AGENT_TAB])),
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
};

/** A request this conversation's agent raised, and one another conversation's: the
 * tray's wording ("for this conversation") and the badge's count (1, not 2) are
 * the claim, and the route frame below is the other side of the comparison. */
export const WithApproval: Story = {
	render: withPane(
		projection([AGENT_TAB, HANDED_TAB], [REQUESTS[0], REQUESTS[2]]),
		640,
		// Taller than the state frames on purpose: the band is a card with five
		// choices and their explanations, and at the default height the page area is
		// squeezed to a few pixels — which is what the product does and what a reader
		// would see, so the frame declares the height at which a reviewer can also
		// SEE the page area the band is leaving.
		720,
	),
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
};

/** The pane at the divider's 480px floor (`chat-content.tsx`'s `minWidth`) — the
 * narrowest box the product can produce, where the switch, the strip and the
 * empty state all have to still hold. */
export const NarrowMinimum: Story = {
	render: withPane(projection([OTHER_TAB]), 480),
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
};

/**
 * The OTHER host, for the comparison the whole feature is: the same component at
 * the route's width, showing every tab and every request — three requests to the
 * pane's two, and four tabs to its two. Spec 7.2's "same component, same model,
 * different input", as two frames.
 */
export const RouteForComparison: Story = {
	render: () => {
		installBridge(
			projection([AGENT_TAB, HANDED_TAB, OTHER_TAB, RESTORED_TAB], REQUESTS),
		);
		return frame(1240, 780, <BrowserPage />);
	},
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
};

/**
 * The chat header's trigger, at the three counts it can carry.
 *
 * A story rather than only a live frame because the header needs a conversation
 * to sit in and the count is a prop: `chat-header.tsx` renders it, the badge's
 * grammar is §5.1's, and what has to be judged here is the corner offset and the
 * ring against the header's own ground.
 */
const HeaderStory: FC<{ count: number }> = ({ count }) => (
	<div className="flex h-14 w-[560px] shrink-0 items-center">
		<ChatHeader
			agentName="Reports agent"
			description="Quarterly reporting"
			onOpenOptions={() => {}}
			onOpenBrowser={() => {}}
			browserAttentionCount={count}
		/>
	</div>
);

export const TriggerNoApproval: Story = {
	render: () => <HeaderStory count={0} />,
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
};

export const TriggerOneApproval: Story = {
	render: () => <HeaderStory count={1} />,
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
};

export const TriggerThreeApprovals: Story = {
	render: () => <HeaderStory count={3} />,
	args: { sessionId: THIS_CONVERSATION, onClose: () => {} },
};
