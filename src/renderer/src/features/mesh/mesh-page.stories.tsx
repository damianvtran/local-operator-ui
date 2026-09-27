/**
 * The Mesh tab, in the states its reads can put it in.
 *
 * ## What is stubbed, and what is not
 *
 * `window.api.desktop.request` is the preload bridge `desktop-api.desktopRequest`
 * prefers, so the bridge below is the same seam the app itself uses. Everything
 * above it is real: the real `MeshPage`, its real capability gate, the real
 * `peers.list`/`networks.list` queries and their normalisers, the real canvas with
 * its pan/zoom and pinned slots, the real list and its sorts, and the real four
 * states. The payloads are fixtures shaped like `GET /v1/desktop/peers` and
 * `GET /v1/desktop/networks` - the shapes are the wire's, read from
 * `local_operator/server/models/desktop_mesh.py`; the values in them are invented.
 *
 * ## What a frame here does NOT prove
 *
 * That a live relay answers these payloads, that a real mesh has these devices, or
 * that the tab behaves this way against a backend that is slow, half-up or older
 * than `features.peers`. It also cannot show the two things the tab's own claims
 * rest on and a still cannot carry: that a poll moves nothing (asserted by identity
 * in `scripts/mesh-tab.test.mjs`), and that a wheel-zoom keeps the world point under
 * the pointer invariant (asserted numerically there too). The live path - a scratch
 * config root, a real `lop network init`, the real route answering - is QA's and
 * the driver's evidence, not this file's.
 *
 * ## Why the S=1 state is the first story
 *
 * It is the state the tab is actually met with on a machine that has just created
 * its first network: one device, no edges, and a node that says which device the
 * reader is looking at. A canvas that only looks right on a five-node mesh is a
 * canvas whose empty half nobody has seen.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent, waitFor } from "@storybook/test";
import type { DesktopResponse } from "../../../../shared/desktop-contract";
import { MeshPage } from "./mesh-page";

type BridgeRequest = { op: string };

/** The desktop plane's answer envelope, as the preload bridge hands it to the API. */
const ok = <T,>(result: T): DesktopResponse => ({
	status: 200,
	body: { result },
});

const DEVICE_SELF = `d_${"a".repeat(32)}`;
const DEVICE_PEER = `d_${"b".repeat(32)}`;
const DEVICE_THIRD = `d_${"c".repeat(32)}`;
const DEVICE_FOURTH = `d_${"d".repeat(32)}`;
const DEVICE_FIFTH = `d_${"e".repeat(32)}`;
const NET_HOME = `n_${"1".repeat(24)}`;
const NET_LAB = `n_${"2".repeat(24)}`;

const member = (
	device_id: string,
	fields: Partial<{
		name: string;
		role: string;
		active: boolean;
		suspect: boolean;
		reachable: boolean;
		reason: string;
		last_seen_at: number | null;
		endpoints: string[];
	}> = {},
) => ({
	device_id,
	name: "",
	role: "drive",
	capabilities: ["sessions", "transfer"],
	active: true,
	suspect: false,
	endpoints: ["10.0.0.4:4097"],
	last_seen_at: null,
	reachable: true,
	reason: "",
	...fields,
});

const network = (
	network_id: string,
	name: string,
	members: unknown[],
	epoch = 3,
) => ({ network_id, name, epoch, trust: "active", members });

const peer = (
	device_id: string,
	fields: Partial<{
		name: string;
		reachable: boolean;
		unreachable_reason: string;
		last_seen_at: number | null;
		session_count: number;
	}> = {},
) => ({
	device_id,
	name: "",
	reachable: true,
	unreachable_reason: "",
	last_seen_at: null,
	session_count: 0,
	rtt_ms: null,
	...fields,
});

/**
 * A "last seen" stamp RELATIVE to the run, so the frame says what the shape means.
 *
 * A literal epoch is a trap the first capture of this set fell into: the healthy
 * peer's node read "seen 398d ago" because the fixture's stamp was written months
 * before the frame, which makes a HEALTHY mesh look abandoned and turns the one
 * sentence the node exists to carry into a lie about the fixture. Four minutes is the
 * shape a peer that is answering right now has, and it is the same sentence on every
 * capture because it is computed at render time.
 */
const seenMinutesAgo = (minutes: number) =>
	Math.floor(Date.now() / 1000) - minutes * 60;

type Fixture = {
	networks: unknown;
	peers: unknown;
	/** The conversations read (`sessions.list?include_peers`). */
	sessions?: unknown[];
	/** Both reads refuse, with the relay's own sentence. */
	failReads?: boolean;
	/** Both reads never settle: the first paint, over nothing. */
	holdReads?: boolean;
	/** What a transfer answers: a receipt, or a refusal. */
	transfer?: unknown;
	/** What an invite answers. */
	invite?: unknown;
	/** Whether the sessions read refuses too. */
	failSessions?: boolean;
};

/**
 * The bridge, installed on the app's own preload seam.
 *
 * A refusal carries the shape the desktop plane uses for a mesh refusal
 * (`{code, message}` under `detail`), because the page renders THAT sentence rather
 * than composing one - the whole point of the error state is that the backend's
 * words reach the reader.
 */
function installBridge(fixture: Fixture) {
	const answer = (result: unknown): DesktopResponse => ok(result);
	const bridge = async (request: BridgeRequest): Promise<DesktopResponse> => {
		if (request.op === "capabilities") {
			return answer({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				// Both keys are advertised UNCONDITIONALLY by the backend, including on a
				// machine in no network (`routes/capabilities.py`), so a story that withheld
				// `session_transfer` would be photographing a backend nobody ships.
				features: { peers: 1, session_transfer: 1 },
			});
		}
		if (request.op === "sessions.list") {
			if (fixture.holdReads) return await new Promise(() => {});
			if (fixture.failSessions) {
				return {
					status: 503,
					body: {
						detail: {
							code: "relay_unavailable",
							message:
								"The peer listing did not answer, so only this device's conversations are shown.",
						},
					},
				};
			}
			return answer({
				sessions: fixture.sessions ?? [],
				degraded: [],
				truncated: false,
			});
		}
		if (request.op === "sessions.transfer") {
			if (fixture.transfer) return answer(fixture.transfer);
			return answer({
				locality: "remote",
				owner_device: DEVICE_PEER,
				source_retired: true,
				session_id: "0".repeat(12),
				new_session_id: "0".repeat(12),
				mode: "move",
				phases: [],
			});
		}
		if (request.op === "networks.invite") {
			return answer(
				fixture.invite ?? {
					token_path:
						"/Users/you/.local-operator/network/invites/devon-laptop.token",
					expires_at: Math.floor(Date.now() / 1000) + 3600,
				},
			);
		}
		if (request.op === "peers.list" || request.op === "networks.list") {
			if (fixture.holdReads) return await new Promise(() => {});
			if (fixture.failReads) {
				return {
					status: 503,
					body: {
						detail: {
							code: "relay_unavailable",
							message:
								"This device's relay is not running, so no peer could be asked. Start it with `lop network serve`.",
						},
					},
				};
			}
			return answer(
				request.op === "peers.list" ? fixture.peers : fixture.networks,
			);
		}
		// A story that starts issuing a third read fails loudly here rather than
		// hanging on a promise nothing resolves.
		throw new Error(`unexpected desktop op in this story: ${request.op}`);
	};
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
}

const meta: Meta = {
	title: "Mesh/Tab",
	parameters: { layout: "fullscreen" },
	/*
	 * NO ROUTER HERE. The preview already wraps every story in a `MemoryRouter`, and
	 * a second one is a hard error ("You cannot render a <Router> inside another
	 * <Router>") rather than a nested one - which is how the first capture of this set
	 * photographed Storybook's error display instead of the tab.
	 *
	 * The padding and the ground are this surface's own: the tab is a fullscreen
	 * route, and it reads the page's `canvas` with its own header rather than sitting
	 * inside a card, so the frame has to give it the page to be a frame of the tab as
	 * it ships.
	 */
	decorators: [
		(Story) => (
			<div className="flex h-screen flex-col bg-canvas p-6">
				<Story />
			</div>
		),
	],
};

export default meta;

type Story = StoryObj;

/** This device alone in one network: the state a first `lop network init` gives. */
export const SingleDevice: Story = {
	render: () => {
		installBridge({
			networks: {
				self_device_id: DEVICE_SELF,
				networks: [
					network(NET_HOME, "damian-mesh", [
						member(DEVICE_SELF, { name: "damians-MacBook-Pro", role: "admin" }),
					]),
				],
			},
			peers: { self_device_id: DEVICE_SELF, peers: [], degraded: [] },
		});
		return <MeshPage />;
	},
};

/** Two devices in one network: one edge, two nodes, and the join's own counts. */
export const TwoDevices: Story = {
	render: () => {
		installBridge({
			networks: {
				self_device_id: DEVICE_SELF,
				networks: [
					network(NET_HOME, "damian-mesh", [
						member(DEVICE_SELF, { name: "damians-MacBook-Pro", role: "admin" }),
						member(DEVICE_PEER, {
							name: "cloud-node-1",
							last_seen_at: seenMinutesAgo(4),
						}),
					]),
				],
			},
			peers: {
				self_device_id: DEVICE_SELF,
				peers: [
					peer(DEVICE_PEER, {
						name: "cloud-node-1",
						session_count: 4,
						last_seen_at: seenMinutesAgo(4),
					}),
				],
				degraded: [],
			},
		});
		return <MeshPage />;
	},
};

/**
 * THE PLAN'S MEASURED TOPOLOGY: five devices, two networks, one device in both.
 *
 * It is the frame that separates "one node with two edges" from "the same laptop
 * drawn twice", which is the decision the model exists to carry.
 */
export const OverlappingNetworks: Story = {
	render: () => {
		installBridge({
			networks: {
				self_device_id: DEVICE_SELF,
				networks: [
					network(NET_HOME, "damian-mesh", [
						member(DEVICE_SELF, { name: "damians-MacBook-Pro", role: "admin" }),
						member(DEVICE_PEER, { name: "cloud-node-1", role: "drive" }),
						member(DEVICE_THIRD, { name: "workshop-mini", role: "read" }),
					]),
					network(NET_LAB, "lab-mesh", [
						member(DEVICE_SELF, { name: "damians-MacBook-Pro", role: "admin" }),
						member(DEVICE_FOURTH, { name: "render-box", role: "drive" }),
						member(DEVICE_FIFTH, { name: "backup-nas", role: "read" }),
					]),
				],
			},
			peers: {
				self_device_id: DEVICE_SELF,
				peers: [
					peer(DEVICE_PEER, { name: "cloud-node-1", session_count: 4 }),
					peer(DEVICE_THIRD, { name: "workshop-mini", session_count: 1 }),
					peer(DEVICE_FOURTH, { name: "render-box", session_count: 9 }),
					peer(DEVICE_FIFTH, { name: "backup-nas", session_count: 0 }),
				],
				degraded: [],
			},
		});
		return <MeshPage />;
	},
};

/**
 * Every named state at once: a suspected identity, an unreachable device carrying
 * the backend's own reason, and a REVOKED membership drawn as a dashed edge.
 *
 * The two devices that take a hue are the ones a reader has to find, which is what
 * the tab's first sentence promises ("where is the odd one out").
 */
export const Misconfigured: Story = {
	render: () => {
		installBridge({
			networks: {
				self_device_id: DEVICE_SELF,
				networks: [
					network(NET_HOME, "damian-mesh", [
						member(DEVICE_SELF, { name: "damians-MacBook-Pro", role: "admin" }),
						// A suspected identity: a duplicate key on the member record, which
						// outranks reachability because it is a security fact rather than a
						// transport one.
						member(DEVICE_PEER, { name: "cloud-node-1", suspect: true }),
						member(DEVICE_THIRD, {
							name: "workshop-mini",
							reachable: false,
							reason: "no route to it",
						}),
						member(DEVICE_FOURTH, {
							name: "old-laptop",
							active: false,
							role: "read",
						}),
					]),
				],
			},
			peers: {
				self_device_id: DEVICE_SELF,
				peers: [
					peer(DEVICE_PEER, { name: "cloud-node-1", session_count: 2 }),
					peer(DEVICE_THIRD, {
						name: "workshop-mini",
						reachable: false,
						unreachable_reason: "no route to it",
						session_count: 1,
					}),
				],
				// The `degraded` vocabulary the contract publishes and this backend
				// has never had to use: a partial read, said as such rather than as a
				// zero.
				degraded: ["peer_sessions_unavailable"],
			},
		});
		return <MeshPage />;
	},
};

/** No network at all: the state a fresh install is met with, with the way out. */
export const VirginDevice: Story = {
	render: () => {
		installBridge({
			networks: { self_device_id: null, networks: [] },
			peers: { self_device_id: null, peers: [], degraded: [] },
		});
		return <MeshPage />;
	},
};

/** The first paint, before either read has answered. */
export const Loading: Story = {
	render: () => {
		installBridge({
			networks: { self_device_id: null, networks: [] },
			peers: { self_device_id: null, peers: [], degraded: [] },
			holdReads: true,
		});
		return <MeshPage />;
	},
};

/**
 * Both reads refused: the relay's own sentence, and the control that asks again.
 *
 * The sentence is the RELAY's ("`lop network serve`"), not one this app composed -
 * that is the behaviour the error state exists for, and a fixture with a generic
 * message would photograph a surface the app never shows.
 */
export const ReadsFailed: Story = {
	render: () => {
		installBridge({
			networks: { self_device_id: null, networks: [] },
			peers: { self_device_id: null, peers: [], degraded: [] },
			failReads: true,
		});
		return <MeshPage />;
	},
};

/** The same mesh in the LIST presentation: sortable, and readable at any width. */
export const ListView: Story = {
	render: () => {
		installBridge({
			networks: {
				self_device_id: DEVICE_SELF,
				networks: [
					network(NET_HOME, "damian-mesh", [
						member(DEVICE_SELF, { name: "damians-MacBook-Pro", role: "admin" }),
						member(DEVICE_PEER, { name: "cloud-node-1", role: "drive" }),
						member(DEVICE_THIRD, {
							name: "workshop-mini",
							role: "read",
							reachable: false,
							reason: "no route to it",
						}),
					]),
				],
			},
			peers: {
				self_device_id: DEVICE_SELF,
				peers: [
					peer(DEVICE_PEER, { name: "cloud-node-1", session_count: 4 }),
					peer(DEVICE_THIRD, {
						name: "workshop-mini",
						reachable: false,
						unreachable_reason: "no route to it",
						session_count: 1,
					}),
				],
				degraded: [],
			},
		});
		return <MeshPage />;
	},
	play: async () => {
		/*
		 * The List tab pressed through the DOM rather than counted as rendered: the
		 * story's subject is the SECOND presentation, and a frame of the canvas
		 * relabelled as the list would be evidence about nothing. The press waits for
		 * the read to have landed first, because the toggle only exists in the ready
		 * state.
		 */
		await screen.findByText(/networks? · /i);
		(await screen.findByRole("button", { name: "List" })).click();
		// The sort control is the list's own first child, so waiting for it is what
		// makes this frame the list rather than the click's first paint.
		await screen.findByText("Sort devices by");
	},
};

/* ----------------------------------------------------------- slice 2: the actions */

/**
 * One conversation row, as `sessions.list?include_peers` answers it.
 *
 * THE FLAT LOCALITY FIELDS ARE THE POINT of this fixture: `locality` is the only
 * field that says which device holds the row (`peer` is `null` on every row this
 * shape describes), and `live_state` is what decides whether a move is offered at
 * all - `busy` refuses rather than interrupting, and the panel and the canvas both
 * say so before anything is asked.
 */
const sessionRow = (
	id: string,
	name: string,
	fields: Partial<{
		locality: "local" | "remote";
		owner_device: string;
		owner_device_name: string;
		live_state: string;
		reachable: boolean;
		unreachable_reason: string;
	}> = {},
) => ({
	id,
	name,
	mtime: Math.floor(Date.now() / 1000) - 120,
	preview: "",
	pinned: false,
	archived: false,
	live_state: "idle" as string,
	locality: "local" as "local" | "remote",
	owner_device: "",
	owner_device_name: "",
	reachable: true,
	unreachable_reason: "",
	placement: null,
	origin: null,
	last_synced_at: null,
	...fields,
});

/** The two-device topology the action stories share, with conversations on both. */
function actionFixture() {
	return {
		networks: {
			self_device_id: DEVICE_SELF,
			networks: [
				network(NET_HOME, "damian-mesh", [
					member(DEVICE_SELF, {
						name: "damians-MacBook-Pro",
						role: "admin",
						last_seen_at: seenMinutesAgo(4),
					}),
					member(DEVICE_PEER, {
						name: "cloud-node-1",
						role: "drive",
						last_seen_at: seenMinutesAgo(9),
					}),
				]),
			],
		},
		peers: {
			self_device_id: DEVICE_SELF,
			peers: [
				peer(DEVICE_PEER, {
					name: "cloud-node-1",
					last_seen_at: seenMinutesAgo(9),
					session_count: 3,
				}),
			],
			degraded: [],
		},
		sessions: [
			sessionRow("0123456789ab", "Sweep 001"),
			sessionRow("0123456789cd", "Resume the roadmap", {
				live_state: "attached",
			}),
			sessionRow("0123456789ef", "Rewrite the importer", {
				locality: "remote",
				owner_device: DEVICE_PEER,
				owner_device_name: "cloud-node-1",
			}),
			sessionRow("0123456789f0", "Nightly retention job", {
				locality: "remote",
				owner_device: DEVICE_PEER,
				owner_device_name: "cloud-node-1",
			}),
		],
	};
}

/**
 * Dispatch one pointer event at an element, as a real drag would arrive.
 *
 * A SYNTHETIC `PointerEvent` RATHER THAN `userEvent.pointer`, and the reason is the
 * snapshot: this drag has to be photographed MID-FLIGHT, and `userEvent` completes a
 * gesture (press, move, release) rather than stopping in the middle of one. The
 * events carry real client coordinates because the drop target resolves through the
 * BROWSER's hit-testing (`closest()` from `elementFromPoint`) - a synthetic move at
 * (0,0) would resolve to nothing, which is the failure mode a coordinate-free
 * dispatch would hide.
 */
function dispatchPointer(target: Element, type: string, x: number, y: number) {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX: x,
			clientY: y,
			pointerId: 1,
			pointerType: "mouse",
			button: 0,
			buttons: type === "pointerup" ? 0 : 1,
			isPrimary: true,
		}),
	);
}

const centreOf = (element: Element) => {
	const rect = element.getBoundingClientRect();
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

/** Press a chip and drag it to a node's centre, WITHOUT releasing it. */
async function dragChipTo(chipId: string, deviceId: string) {
	await screen.findByText(/networks? · /i);
	const chip = document.querySelector(`[data-mesh-session="${chipId}"]`);
	const node = document.querySelector(`[data-mesh-device="${deviceId}"]`);
	const canvas = document.querySelector("[data-mesh-canvas]");
	if (!chip || !node || !canvas)
		throw new Error("the drag's actors are not mounted");
	const from = centreOf(chip);
	dispatchPointer(chip, "pointerdown", from.x, from.y);
	const to = centreOf(node);
	dispatchPointer(canvas, "pointermove", to.x, to.y);
	/*
	 * A LONG TIMEOUT ON PURPOSE. This is the one moment in the set where the frame is
	 * a TRANSIENT state, and the commit that paints the ghost rides on the next React
	 * render - which on a loaded machine (this capture runs beside twenty-five other
	 * sessions) can be well past the default one second. The sweep failed on exactly
	 * that with `the ghost has not painted yet` on the dark pass of
	 * `drag-refused-over-network` while the light pass had taken the same frame
	 * moments earlier, which is a timing failure rather than a state that does not
	 * exist.
	 */
	await waitFor(
		() => {
			if (!document.querySelector("[data-mesh-ghost]"))
				throw new Error("the ghost has not painted yet");
		},
		{ timeout: 15_000 },
	);
}

/** Click the `⋯` menu on a session row and choose one of its items. */
async function chooseFromSessionMenu(sessionId: string, label: string) {
	const user = userEvent.setup();
	/*
	 * ADDRESSED BY THE SESSION IT BELONGS TO, through the trigger's own data
	 * attribute: a device with two conversations has two `⋯` buttons whose names
	 * differ only in the conversation they name, and a role query would be ambiguous
	 * the moment that number changes.
	 */
	const trigger = await waitFor(() => {
		const found = document.querySelector(
			`[data-mesh-session-menu="${sessionId}"]`,
		);
		if (!found) throw new Error("the row's menu is not mounted yet");
		return found;
	});
	await user.click(trigger as Element);
	await user.click(await screen.findByRole("menuitem", { name: label }));
}

/** Open a device's panel by pressing its node. */
async function openPanel(deviceId: string) {
	await screen.findByText(/networks? · /i);
	const open = document.querySelector(`[data-mesh-device-open="${deviceId}"]`);
	if (!open) throw new Error("the node's own button is not mounted");
	(open as HTMLElement).click();
	await screen.findByText("Memberships");
}

/** Two devices, each holding conversations: the panel's open state. */
export const DevicePanel: Story = {
	render: () => {
		installBridge(actionFixture());
		return <MeshPage />;
	},
	play: async () => {
		await openPanel(DEVICE_PEER);
		await screen.findByText("Sweep 001", { exact: false });
		await screen.findByText(/Conversations/);
	},
};

/** A chip in the air over a VALID target: the transient state, mid-drag. */
export const DragToDevice: Story = {
	render: () => {
		installBridge(actionFixture());
		return <MeshPage />;
	},
	play: async () => {
		await dragChipTo("0123456789ab", DEVICE_PEER);
		await screen.findByText("Move to cloud-node-1");
	},
};

/** A chip over a network lane: the drop the client refuses, says so, and names why. */
export const DragRefusedOverNetwork: Story = {
	render: () => {
		installBridge(actionFixture());
		return <MeshPage />;
	},
	play: async () => {
		await dragChipTo("0123456789ab", DEVICE_PEER);
		const lane = document.querySelector(`[data-mesh-network="${NET_HOME}"]`);
		const canvas = document.querySelector("[data-mesh-canvas]");
		if (!lane || !canvas) throw new Error("the lane is not mounted");
		const to = centreOf(lane);
		dispatchPointer(canvas, "pointermove", to.x, to.y);
		await screen.findByText(
			/Drop will be refused: A conversation lives on a device/,
		);
	},
};

/** The drop's question: the operation named, the loss stated, the copy offered. */
export const MoveConfirm: Story = {
	render: () => {
		installBridge(actionFixture());
		return <MeshPage />;
	},
	play: async () => {
		await openPanel(DEVICE_PEER);
		await chooseFromSessionMenu("0123456789ef", "Recall to this device");
		await screen.findByRole("dialog");
	},
};

/**
 * A session with a turn in flight: REFUSED before anything is sent, with the route's
 * vocabulary and the one action that is honest - wait for the turn to finish.
 */
export const MoveRefusedBusy: Story = {
	render: () => {
		installBridge({
			...actionFixture(),
			sessions: [
				sessionRow("0123456789ab", "Sweep 001", { live_state: "busy" }),
				sessionRow("0123456789ef", "Rewrite the importer", {
					locality: "remote",
					owner_device: DEVICE_PEER,
					owner_device_name: "cloud-node-1",
				}),
			],
		});
		return <MeshPage />;
	},
	play: async () => {
		await openPanel(DEVICE_PEER);
		await chooseFromSessionMenu("0123456789ef", "Recall to this device");
		// A busy session is refused by the CLIENT's own verdict, so no dialog opens:
		// the notice carries the code, the sentence and the wait.
		await screen.findByText(/Wait for the turn to finish/);
	},
};

/** The reversible half, and the undo it leaves: a `--keep` copy that can be erased. */
export const MoveCopyWithUndo: Story = {
	render: () => {
		installBridge({
			...actionFixture(),
			transfer: {
				locality: "remote",
				owner_device: DEVICE_PEER,
				source_retired: false,
				session_id: "0123456789ef",
				new_session_id: "0123456789f1",
				mode: "keep",
				phases: [],
			},
		});
		return <MeshPage />;
	},
	play: async () => {
		await openPanel(DEVICE_PEER);
		await chooseFromSessionMenu("0123456789ef", "Copy here, leave it there");
		const user = userEvent.setup();
		await user.click(
			await screen.findByRole("button", { name: "Copy here, leave it there" }),
		);
		await screen.findByText("Erase the copy");
	},
};

/** Admission is two-sided: the invite mints a token, and the receipt says where. */
export const InviteReceipt: Story = {
	render: () => {
		installBridge(actionFixture());
		return <MeshPage />;
	},
	play: async () => {
		await openPanel(DEVICE_PEER);
		const user = userEvent.setup();
		await user.click(
			await screen.findByRole("button", { name: "Invite to a network…" }),
		);
		await user.click(
			await screen.findByRole("button", { name: "Mint the token" }),
		);
		await screen.findByText(/the device appears once it redeems this/);
	},
};
