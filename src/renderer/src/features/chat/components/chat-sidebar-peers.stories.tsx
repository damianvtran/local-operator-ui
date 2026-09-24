/**
 * The chat sidebar with PEERS: the state matrix of `mesh-ui.md` §2.5 (S1-S7),
 * plus the narrow case that proves a long peer name never overflows.
 *
 * ## What is real and what is stubbed
 *
 * The real `ChatSidebar`, its real store and its real partition
 * (`chat-peers.ts`). Below them, `window.api.desktop.request` answers the reads
 * this surface makes - `capabilities`, `sessions.list`, `peers.list`,
 * `profiles.list`, `teams.list` - from the fixtures here, in the backend's own
 * wire field names (the `SessionRow`/`PeerList` shapes of plan §3.1). Anything
 * else is refused BY NAME, so a story that starts issuing a new call fails loudly
 * instead of hanging.
 *
 * ## What a frame here does NOT prove
 *
 *   - **Not a move.** S6 and S7 are the two ends of a transfer, photographed at
 *     rest: S6 holds a transfer open (its request never answers), S7 is the store
 *     after a refusal. The motion between them is the driver's, not a story's.
 *   - **Not the hover flyout.** The row's "on devon-laptop - unreachable: ..."
 *     clause is a tooltip; a story cannot enter `:hover`.
 *   - **Not the backend's words.** Every reason string here is a FIXTURE of the
 *     backend's gloss (`network_panel.peer_reason_words`); this app renders the
 *     string it is given and invents none.
 */

import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type { PeerRow } from "../../../../../shared/desktop-session-contract";
import { ChatSidebar } from "./chat-sidebar";

/* ------------------------------------------------------------ the fixture */

type BridgeRequest = { op: string; sessionId?: string };

const EPOCH = "3f2a1b4c5d6e7f8091a2b3c4d5e6f708";
const LAPTOP = "d_9c02f1e4a7b3c6d5e8f9a0b1c2d3e4f5";
const STUDIO = "d_7e11a2b3c4d5e6f708192a3b4c5d6e7f";
const RADIENT = "d_31aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c";
const NOW = 1_789_400_240;

type WireRow = Record<string, unknown> & { id: string; name: string };

/** A catalogue row in the backend's wire names. `mesh` false = a pre-mesh row. */
const row = (
	id: string,
	name: string,
	mtime: number,
	over: Record<string, unknown> = {},
	mesh = true,
): WireRow => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: false,
	pinned: false,
	archived: false,
	binding: { agent: null, team: null },
	status: { code: "idle", label: "Recent" },
	status_revision: 1,
	status_epoch: EPOCH,
	...(mesh
		? {
				locality: "local",
				owner_device: "",
				owner_device_name: "",
				reachable: true,
				unreachable_reason: "",
				last_synced_at: null,
				placement: null,
				origin: null,
			}
		: {}),
	...over,
});

const remote = (
	device: string,
	deviceName: string,
	over: Record<string, unknown> = {},
) => ({
	locality: "remote",
	owner_device: device,
	owner_device_name: deviceName,
	reachable: true,
	unreachable_reason: "",
	placement: {
		mode: "peer",
		network_id: "n_4a1c00000000000000000000",
		home_device: device,
		policy: "pinned",
	},
	...over,
});

/** This device's own conversations: the same four in every state. */
const localRows = (mesh = true): WireRow[] => [
	row(
		"1a2b3c4d5e6f",
		"Reconcile the supplier ledger",
		1_760_000_400,
		{ active: true, status: { code: "busy", label: "Working" } },
		mesh,
	),
	row("2b3c4d5e6f70", "Migrate the deploy script", 1_760_000_300, {}, mesh),
	row("3c4d5e6f7081", "Draft the incident postmortem", 1_760_000_200, {}, mesh),
	row("4d5e6f708192", "Tidy the migration fixtures", 1_760_000_100, {}, mesh),
];

const peer = (
	device_id: string,
	name: string,
	over: Partial<PeerRow> = {},
): PeerRow => ({
	device_id,
	name,
	reachable: true,
	/*
	 * NULL, NOT A NUMBER (design round 1, D1). The transport publishes no producer for
	 * `rtt_ms`, and the backend slice has been told to send null unless it can measure
	 * latency truthfully - so a fixture carrying `24`/`61`/`140` was evidence of a UI
	 * that cannot exist, and the frames taken from it showed a value the product will
	 * never render. The field stays in the wire type; the sidebar no longer reads it
	 * (`peerTrailing`), so nothing here can put a latency on a row.
	 */
	rtt_ms: null,
	session_count: 0,
	last_seen_at: NOW - 12,
	unreachable_reason: "",
	...over,
});

type Scenario = {
	features: Record<string, number>;
	rows: WireRow[];
	peers: PeerRow[];
	/** `sessions.transfer` never answers: S6's in-flight state. */
	holdTransfer?: boolean;
	/**
	 * How `sessions.transfer` FAILS, when the story is about a failure. The two
	 * carry different HTTP realities and therefore different copy: `timeout` is a
	 * request that was sent and never answered (`status: null`), `refused` is the
	 * route's own 409.
	 */
	transferFailure?: "timeout" | "refused";
	/** The peer catalogue read fails, so the group's data is the LAST known set. */
	peersFailure?: boolean;
};

const bridge = ({
	features,
	rows,
	peers,
	holdTransfer,
	transferFailure,
	peersFailure,
}: Scenario) => {
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const handler = async (request: BridgeRequest): Promise<DesktopResponse> => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features,
				});
			case "sessions.list":
				return ok({ sessions: rows, truncated: false, degraded: [] });
			case "peers.list":
				if (peersFailure)
					throw new DesktopControlError(500, "the relay did not answer");
				return ok({ peers, degraded: [] });
			case "profiles.list":
				return ok({ profiles: [] });
			case "teams.list":
				return ok({ teams: [] });
			case "sessions.transfer":
				if (holdTransfer) return new Promise(() => undefined);
				if (transferFailure === "timeout")
					// A deadline: the transport gave up, and NO status exists to report.
					throw new DesktopControlError(
						null,
						"Desktop controls could not reach the backend process.",
					);
				if (transferFailure === "refused")
					throw new DesktopControlError(
						409,
						"a turn is still running there; stop it or wait for it",
					);
				throw new Error("unexpected transfer in this story");
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: handler };
};

/**
 * The disclosures open for the frame: `Previous chats`, each peer's section and
 * the `Peers` group are collapsed by default, and a frame of closed headings
 * would photograph none of the rows the states are about.
 */
const openSections = (deviceIds: string[]) => {
	localStorage.setItem(
		"chat-sidebar-disclosures",
		JSON.stringify({
			previous: true,
			peers: true,
			agents: false,
			teams: false,
			...Object.fromEntries(deviceIds.map((id) => [`peer:${id}`, true])),
		}),
	);
	useUiPreferencesStore.setState({
		chatSidebarRegions: "both",
		chatSidebarListHeight: null,
		chatSidebarOrder: "chats-first",
	});
	useCanonicalSessionsStore.setState({
		transfers: {},
		meshNotice: null,
	});
};

const MESH = {
	session_catalogue: 2,
	profile_catalogue: 1,
	team_catalogue: 1,
	session_pins: 1,
	peers: 1,
	session_transfer: 1,
};
const PRE_MESH = {
	session_catalogue: 2,
	profile_catalogue: 1,
	team_catalogue: 1,
	session_pins: 1,
};

const Page: FC<{ width?: number }> = ({ width = 280 }) => (
	<div className="flex h-screen overflow-hidden bg-canvas text-ink">
		{/* 280 is the app's default sidebar width, and 240 its lower clamp: the
		    two widths the title budget (179 px at 280) is argued at. */}
		<div
			data-sidebar-frame
			className="shrink-0 border-r border-hairline"
			style={{ width: `${width}px` }}
		>
			<ChatSidebar
				selectedConversation={undefined}
				onSelectConversation={() => undefined}
				onStageDraft={() => undefined}
			/>
		</div>
	</div>
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate: () => boolean, timeoutMs = 6_000) => {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate()) return;
		await sleep(50);
	}
	throw new Error("the fixture never reached the state this story photographs");
};
const rows = (selector: string) => document.querySelectorAll(selector).length;

/**
 * Bring a selector into view inside the list region, then let it settle.
 *
 * WHY A PLAY SCROLLS, rather than only waiting. In the split layout the chats
 * region is capped at 45% of the panel, so the peer sections below `Previous
 * chats` sit under its scroll fold in a 900px frame - the DOM holds them and the
 * PHOTOGRAPH does not, which is a frame that cannot evidence the state it names.
 * Scrolling to the subject is what the user does to see it, so the frame is the
 * state as it is actually read. Measured on the pre-fix S4 capture: the section
 * was in the DOM (asserted by the wait) and absent from the pixels.
 */
const scrollTo = async (selector: string) => {
	const node = document.querySelector<HTMLElement>(selector);
	if (!node) throw new Error(`nothing matches ${selector}`);
	node.scrollIntoView({ block: "center" });
	await sleep(300);
};

const meta = {
	title: "Chat sidebar/Peers",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

/**
 * S1 - zero peers: a PRE-MESH backend (no `features.peers`, no locality fields).
 * This is exactly today's sidebar, and it is the BEFORE frame for every other
 * state here.
 */
export const S1ZeroPeers: Story = {
	render: () => {
		bridge({ features: PRE_MESH, rows: localRows(false), peers: [] });
		openSections([]);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => rows('[data-tour-tag="chat-session-row"]') >= 4);
	},
};

/** S2 - one peer, live, with two conversations. */
export const S2OnePeer: Story = {
	render: () => {
		bridge({
			features: MESH,
			rows: [
				...localRows(),
				row("5e6f708192a3", "Tune the relay keepalive", 1_760_000_500, {
					active: true,
					...remote(LAPTOP, "devon-laptop"),
				}),
				row("6f708192a3b4", "Benchmark the sync debounce", 1_760_000_050, {
					...remote(LAPTOP, "devon-laptop"),
				}),
			],
			peers: [peer(LAPTOP, "devon-laptop", { session_count: 2 })],
		});
		openSections([LAPTOP]);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => rows("[data-remote-mark]") >= 2);
		await scrollTo(`[data-peer-section="${LAPTOP}"] [data-remote-mark]`);
	},
};

const severalPeers = (overStudio: Partial<PeerRow> = {}) => ({
	rows: [
		...localRows(),
		row("5e6f708192a3", "Tune the relay keepalive", 1_760_000_500, {
			active: true,
			...remote(LAPTOP, "devon-laptop"),
		}),
		row("6f708192a3b4", "Benchmark the sync debounce", 1_760_000_050, {
			...remote(LAPTOP, "devon-laptop"),
		}),
		row("708192a3b4c5", "Render the quarterly charts", 1_760_000_020, {
			...remote(
				STUDIO,
				"studio-mini",
				overStudio.reachable === false
					? {
							reachable: false,
							unreachable_reason: overStudio.unreachable_reason,
						}
					: {},
			),
		}),
	],
	peers: [
		peer(LAPTOP, "devon-laptop", { session_count: 2 }),
		peer(STUDIO, "studio-mini", {
			session_count: 1,
			...overStudio,
		}),
		peer(RADIENT, "radient-m-4h", { session_count: 0 }),
	],
});

/**
 * S3 - several peers, one of them quiet.
 *
 * THE QUIET PEER HAS NO SECTION (design round 1, D5): a section for a peer with no
 * cached chats drew an expanded chevron over nothing, because `heading()` renders
 * no badge for a count of 0. It appears in `Peers` instead, where a row can say its
 * state, its last-seen and `0 chats` - so this frame proves `radient-m-4h` is
 * present exactly once, in the group, and that the two sections are the two peers
 * that actually have chats.
 */
export const S3SeveralPeers: Story = {
	render: () => {
		bridge({ features: MESH, ...severalPeers() });
		openSections([LAPTOP, STUDIO]);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => rows("[data-peer-section]") >= 2);
		await waitFor(() => rows("[data-peer-row]") >= 3);
		const sections = document.querySelectorAll("[data-peer-section]");
		if (sections.length !== 2)
			throw new Error(
				`expected the two peers that have chats, got ${sections.length} section(s)`,
			);
		if (document.querySelector(`[data-peer-section="${RADIENT}"]`))
			throw new Error("the quiet peer still has an empty section (D5)");
		const quiet = document.querySelector<HTMLElement>(
			`[data-peer-row="${RADIENT}"]`,
		);
		if (!quiet?.textContent?.includes("0 chats"))
			throw new Error("the quiet peer's row does not say 0 chats");
		await scrollTo("[data-peers-group]");
	},
};

/**
 * S4 - a peer unreachable, its rows cached. The heading and the row mark agree
 * (both read `peerReachable`); the row's status glyph keeps its own ink.
 */
export const S4PeerUnreachable: Story = {
	render: () => {
		bridge({
			features: MESH,
			...severalPeers({
				reachable: false,
				last_seen_at: NOW - 4 * 60,
				unreachable_reason: "no address of it answered",
			}),
		});
		openSections([LAPTOP, STUDIO]);
		return <Page />;
	},
	play: async () => {
		await waitFor(() =>
			Boolean(
				document
					.querySelector(`[data-peer-section="${STUDIO}"]`)
					?.textContent?.includes("unreachable"),
			),
		);
		/*
		 * D4's other half: at the DEFAULT width the trailing must fit WHOLE. It used
		 * to cut the one fact that differs between unreachable peers (`last see…`),
		 * so the state and the age both have to be readable here.
		 */
		const trailing = document.querySelector("[data-peer-row-trailing]");
		if (!trailing) throw new Error("no peer row trailing cell");
		if (trailing.scrollWidth > trailing.clientWidth + 1)
			throw new Error(
				`the trailing is truncated at 280px: "${trailing.textContent}"`,
			);
		// The unreachable peer's own section: the state this story is named for.
		await scrollTo(`[data-peer-section="${STUDIO}"]`);
	},
};

/** S5 - a peer refused a create: rows unchanged, an alert in the peer's own words. */
export const S5PeerRefuses: Story = {
	render: () => {
		bridge({ features: MESH, ...severalPeers() });
		openSections([LAPTOP]);
		useCanonicalSessionsStore.setState({
			meshNotice: {
				kind: "refused",
				peer: LAPTOP,
				reason: "not permitted to open sessions",
			},
		});
		return <Page />;
	},
	play: async () => {
		await waitFor(() => rows('[data-mesh-notice="refused"]') === 1);
		await scrollTo(`[data-peer-section="${LAPTOP}"]`);
	},
};

/**
 * S6 - a conversation moving to devon-laptop: the row stays IN PLACE, busy and
 * dimmed by ink (never opacity), until the transfer answers. The transfer here
 * never answers, so the frame is the in-flight state.
 */
export const S6SessionMoving: Story = {
	render: () => {
		bridge({ features: MESH, ...severalPeers(), holdTransfer: true });
		openSections([LAPTOP]);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => rows('[data-tour-tag="chat-session-row"]') >= 4);
		void useCanonicalSessionsStore
			.getState()
			.transferSession("2b3c4d5e6f70", LAPTOP, "Migrate the deploy script");
		await waitFor(() => rows('[data-session-moving="true"]') === 1);
		await scrollTo('[data-session-moving="true"]');
	},
};

/** S7 - the move failed: the row is back to normal in place; the alert says why. */
export const S7MoveFailed: Story = {
	render: () => {
		bridge({ features: MESH, ...severalPeers() });
		openSections([LAPTOP]);
		useCanonicalSessionsStore.setState({
			meshNotice: {
				kind: "move-failed",
				title: "Migrate the deploy script",
				reason: "a turn is still running there; stop it or wait for it",
			},
		});
		return <Page />;
	},
	play: async () => {
		await waitFor(() => rows('[data-mesh-notice="move-failed"]') === 1);
		await scrollTo('[data-mesh-notice="move-failed"]');
	},
};

/**
 * A LONG peer name at the 240 px clamp: the heading, the row marks and the
 * `Peers` row must truncate inside the panel, never widen it. The play asserts
 * it in numbers - no element under the sidebar is wider than the frame.
 */
export const LongPeerNameNarrow: Story = {
	render: () => {
		const long = "damians-mac-studio-in-the-back-office-rack-2";
		bridge({
			features: MESH,
			rows: [
				...localRows(),
				row(
					"5e6f708192a3",
					"A conversation with a long title on that peer",
					1_760_000_500,
					{
						active: true,
						...remote(LAPTOP, long),
					},
				),
			],
			peers: [
				peer(LAPTOP, long, {
					session_count: 1,
					reachable: false,
					last_seen_at: NOW - 3 * 3600,
					unreachable_reason: "no address of it answered",
				}),
			],
		});
		openSections([LAPTOP]);
		return <Page width={240} />;
	},
	play: async () => {
		await waitFor(() => rows("[data-remote-mark]") >= 1);
		await scrollTo(`[data-peer-section="${LAPTOP}"]`);
		/*
		 * D4, IN NUMBERS. At the clamp the DEVICE NAME must survive: 14 `ch` of the
		 * row's own font is the floor the fix exists to hold, and the trailing gives
		 * way to it (its age is in the title). Measured on the element, not read off
		 * the code, because the whole finding was that the two cells settled the
		 * other way round.
		 */
		const name = document.querySelector("[data-peer-row-name]");
		if (!name) throw new Error("no peer row name cell");
		if (name.clientWidth < 88)
			throw new Error(
				`the device name is cut to ${name.clientWidth}px (D4 wants ~14 characters)`,
			);
		const frame = document.querySelector<HTMLElement>("[data-sidebar-frame]");
		if (!frame) throw new Error("no sidebar frame");
		const limit = frame.getBoundingClientRect().right + 0.5;
		const over = [...frame.querySelectorAll<HTMLElement>("*")].filter(
			(node) => node.getBoundingClientRect().right > limit,
		);
		if (frame.scrollWidth > frame.clientWidth + 0.5 || over.length > 0)
			throw new Error(
				`the sidebar overflows at 240px: ${over.length} element(s) past its edge`,
			);
	},
};

/**
 * S8 - a move whose OUTCOME IS UNKNOWN: the request was sent and the transport
 * gave up before the route answered. The row is back to normal in place, and the
 * sentence claims only what is known (round-1 agent review, M4).
 *
 * DRIVEN THROUGH THE STORE, not injected: the play calls the real
 * `transferSession` against a transport that raises a deadline, so the frame shows
 * the state the CLASSIFICATION produces - the reviewer's point that a `setState`
 * frame proves only that the notice renders.
 */
export const S8MoveUnconfirmed: Story = {
	render: () => {
		bridge({ features: MESH, ...severalPeers(), transferFailure: "timeout" });
		openSections([LAPTOP]);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => rows('[data-tour-tag="chat-session-row"]') >= 4);
		/*
		 * The store action is awaited DIRECTLY, not wrapped in `act`: a play runs in
		 * a real browser (Storybook's own build has no `IS_REACT_ACT_ENVIRONMENT`),
		 * and React's `act` refuses outside a test environment. The frame does not
		 * need it - the store's subscribers repaint, which is what `waitFor` waits
		 * for.
		 */
		await useCanonicalSessionsStore
			.getState()
			.transferSession("2b3c4d5e6f70", STUDIO, "Migrate the deploy script");
		await waitFor(() => rows('[data-mesh-notice="move-unconfirmed"]') === 1);
		const notice = document.querySelector(
			'[data-mesh-notice="move-unconfirmed"]',
		);
		if (notice?.textContent?.includes("Nothing changed"))
			throw new Error("an unconfirmed move claims nothing changed (M4)");
		await scrollTo('[data-mesh-notice="move-unconfirmed"]');
	},
};

/**
 * S9 - the peer catalogue READ FAILS while the flag is on: the sidebar keeps the
 * conversations it has, still filed under the device each one lives on.
 *
 * The sections come from the ROWS (`owner_device`/`owner_device_name`), not from
 * the catalogue, which is why a failed catalogue read costs the `Peers` group - the
 * one surface with nothing to show without it - and nothing else: the chats are
 * listed, marked and grouped, and no error state replaces them.
 *
 * Why a frame for this (round-1 review, m1): a failing mesh read is what a user
 * meets when the relay is down, and no story covered it. Read the frame for what it
 * is - the degraded state, not a blank one.
 */
export const S9PeersReadFails: Story = {
	render: () => {
		bridge({ features: MESH, ...severalPeers(), peersFailure: true });
		openSections([LAPTOP, STUDIO]);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => rows("[data-peer-section]") >= 2);
		if (rows('[data-tour-tag="chat-session-row"]') < 4)
			throw new Error("a failed catalogue read took the rows with it");
		/*
		 * The group renders from the CATALOGUE and the catalogue failed, so it is NOT
		 * mounted - the honest answer rather than a claim: a device list with no device
		 * in it would say the mesh is empty. Everything the ROWS carry is still here,
		 * which is what this frame is for (round-1 review, m1).
		 */
		if (document.querySelector("[data-peers-group]"))
			throw new Error("the Peers group renders with no catalogue data");
		await scrollTo(`[data-peer-section="${LAPTOP}"]`);
	},
};

/**
 * S1 (as `mesh-ui` §2.5 defines it) - ONE device, the flag ON: the renderer asks
 * for the catalogue, gets no peers, and draws exactly the sidebar it draws without
 * a mesh. `S1ZeroPeers` above is the PRE-MESH backend; this is the mesh with
 * nothing in it, and the two are different requests.
 */
export const S1bFlagOnNoPeers: Story = {
	render: () => {
		bridge({ features: MESH, rows: localRows(), peers: [] });
		openSections([]);
		return <Page />;
	},
	play: async () => {
		await waitFor(() => rows('[data-tour-tag="chat-session-row"]') >= 1);
		for (const selector of [
			"[data-peers-group]",
			"[data-peer-section]",
			"[data-remote-mark]",
		]) {
			if (document.querySelector(selector))
				throw new Error(`${selector} is mounted with zero peers`);
		}
	},
};
