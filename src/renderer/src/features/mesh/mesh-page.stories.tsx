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

type BridgeRequest = { op: string; approvalId?: string };

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
		scope: string;
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
	// No backend sends a declared scope yet: `""` is every real install's value, and the
	// `declared` tier needs one to render at all (`mesh-scope.ts`).
	scope: "",
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
 * One onboarding approval record, in the frozen §3.5 read shape (`badge_row`).
 *
 * The window is RELATIVE to the run, the same reason the peer stamps below are:
 * a literal epoch written when this fixture was authored would make a live
 * request read "expired" months later and photograph the wrong state.
 */
const approvalRecord = (
	fields: Partial<{
		approval_id: string;
		state: string;
		name: string;
		host: string;
		user: string;
	}> = {},
) => ({
	approval_id: fields.approval_id ?? "ap_2v9k4m0q7r1s",
	state: fields.state ?? "requested",
	what: {
		connect: true,
		install: true,
		anchor: {
			key_id: "op_3f8a",
			spki_fp: "SHA256:q1…",
			statement_digest: "sha256:7c…",
		},
		unattended: true,
		grant: ["approve"],
		network_id: NET_HOME,
		role: "drive",
	},
	requested_by: {
		surface: "cli",
		session_id: "0123456789ef",
		device_id: DEVICE_PEER,
	},
	expires_at: Math.floor(Date.now() / 1000) + 42 * 60,
	device: {
		device_id: DEVICE_PEER,
		name: fields.name ?? "devon-laptop",
		host: fields.host ?? "devon-laptop.local",
		user: fields.user ?? "damian",
		transport: "ssh",
		host_key_fp: "SHA256:9f3cQm2p…",
	},
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
	/**
	 * Run BEFORE a transfer is answered, so the reads that follow it see the world the receipt
	 * claims. A fixture that keeps answering the pre-move world photographs a receipt the app has
	 * already contradicted (`MoveBusyWaited`'s own case, design review round 3, D13).
	 */
	afterTransfer?: (fixture: Fixture) => void;
	/** Whether the sessions read refuses too. */
	failSessions?: boolean;
	/** The approval records the badge read answers (`approvals.list`). */
	approvals?: unknown[];
	/** The approvals read refuses, with the transport's own sentence. */
	failApprovals?: boolean;
	/**
	 * What a DECISION answers instead of deciding (agent review round 1, finding
	 * 1): a refusal body (`{code, message}`), the store's own shape. The world is
	 * left exactly as it was - a refused decision changes nothing - so the
	 * sentence is the whole answer, which is the state the card must carry.
	 */
	decisionRefusal?: { code: string; message: string } | null;
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
				// All three keys are advertised UNCONDITIONALLY by the backend, including
				// on a machine in no network (`routes/capabilities.py`), so a story that
				// withheld one would be photographing a backend nobody ships.
				features: { peers: 1, session_transfer: 1, approvals: 1 },
			});
		}
		if (request.op === "approvals.list") {
			if (fixture.holdReads) return await new Promise(() => {});
			if (fixture.failApprovals) {
				return {
					status: 503,
					body: {
						detail: {
							code: "relay_unavailable",
							message:
								"The approvals could not be read, so the badge may be out of date.",
						},
					},
				};
			}
			return answer({ approvals: fixture.approvals ?? [] });
		}
		if (request.op === "approvals.approve" || request.op === "approvals.deny") {
			if (fixture.decisionRefusal) {
				return {
					status: 409,
					body: { detail: fixture.decisionRefusal },
				};
			}
			/*
			 * A DECISION CHANGES THE WORLD, and the fixture has to say so before it answers
			 * (the transfer handler's own rule): the settle invalidates the approvals read, so
			 * a static fixture would re-answer the record the decision just contradicted and
			 * the chip would snap back to `requested`.
			 */
			const nextState =
				request.op === "approvals.approve" ? "approved" : "denied";
			fixture.approvals = (fixture.approvals ?? []).map((row) =>
				typeof row === "object" &&
				row !== null &&
				(row as { approval_id?: unknown }).approval_id === request.approvalId
					? { ...(row as Record<string, unknown>), state: nextState }
					: row,
			);
			return answer({
				approval_id: request.approvalId ?? "",
				state: nextState,
				signature: {
					key_id: request.op === "approvals.approve" ? "op_synthetic" : "",
				},
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
			/*
			 * A TRANSFER CHANGES THE WORLD, and the fixture has to say so (design review round 3,
			 * D13). The page invalidates `sessions` and `peers` on success (`mesh-store.ts`), so a
			 * static fixture re-answers the world the receipt just contradicted - the frame showed
			 * "the copy here is gone" over a canvas that still drew the moved session under
			 * `Conversations (2)`. `afterTransfer` rewrites the fixture to the world the receipt
			 * claims, BEFORE the answer, which is the order the real backend has anyway.
			 */
			fixture.afterTransfer?.(fixture);
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

/**
 * The S=1 fixture, shared by the canvas frame and the panel's null-stamp frame.
 *
 * `member()` leaves `last_seen_at` at `null`, which is what the panel's `Last status
 * frame` reads as `never` - a state the wire produces (a device whose rotation stamp
 * has never been written) and that no committed frame carried until the panel pass
 * below asked for it (design review round 1, D6).
 */
function singleDeviceFixture() {
	return {
		networks: {
			self_device_id: DEVICE_SELF,
			networks: [
				network(NET_HOME, "damian-mesh", [
					member(DEVICE_SELF, { name: "damians-MacBook-Pro", role: "admin" }),
				]),
			],
		},
		peers: { self_device_id: DEVICE_SELF, peers: [], degraded: [] },
	};
}

/** This device alone in one network: the state a first `lop network init` gives. */
export const SingleDevice: Story = {
	render: () => {
		installBridge(singleDeviceFixture());
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

/**
 * THE PANEL'S `never`, PHOTOGRAPHED (design review round 1, D6).
 *
 * The panel's `Last status frame` row has a null case - `never` rather than a date
 * computed from zero - and it appeared in NO committed frame, because every fixture
 * that opened a panel carried a stamp. This is `singleDeviceFixture()` (its self
 * member was never seen by a rotation frame) with the panel open, so the frame carries
 * `Last status frame / never` beside a null conversation count. Nothing else about
 * the state is staged: `openPanel` presses the node's own button.
 */
export const SingleDevicePanel: Story = {
	render: () => {
		installBridge(singleDeviceFixture());
		return <MeshPage />;
	},
	play: async () => {
		await openPanel(DEVICE_SELF);
		await screen.findByText("Last status frame");
		await screen.findByText("never");
	},
};

/**
 * THE FIVE REACH STATES ON ONE CANVAS, plus the one device that is working.
 *
 * THIS STORY EXISTS BECAUSE NO SHIPPED FIXTURE CAN PRODUCE THREE OF ITS SIX DEVICES, and
 * that is a measurement rather than an oversight: the shipped bridge is all-or-nothing, so
 * `NOT_ATTEMPTED_REASON` had never been on screen; no fixture had `live_state: "busy"` on a
 * remote row, so `working` had never been rendered; and no fixture left a drawn device
 * unnamed by the peer catalogue, so `conversations not reported` had never been rendered
 * either. The sentences below are the relay's own - the not-attempted one copied from
 * `relay.NOT_ATTEMPTED_REASON` through `resume.peer_reason_words`, which is what a member
 * row actually carries - and NOT invented for the frame.
 *
 * What the frame is for: `build-box` was the defect this redesign exists to fix. Its stripe
 * used to be the amber of `unreachable` while its words said `not asked`, because the relay
 * flattens "we never dialled it" and "it did not answer" into one boolean. The stripe is
 * keyed on reach now, and this is the frame where the two channels agree.
 *
 * THE LIST PASS SHARES THIS FIXTURE (agent review round 1, M1/D1/U1/U2): the
 * `list-view` story's members could produce neither half of the list-ink defect (no
 * not-attempted member, no suspect member), while this fixture's `build-box`
 * (not-attempted) and `old-laptop` (suspect) are exactly those two devices.
 * `ReachStatesList` below is this canvas, one press on `List`, so both are visible on
 * the list presentation in a committed frame.
 */
function reachStatesFixture() {
	return {
		networks: {
			self_device_id: DEVICE_SELF,
			networks: [
				network(NET_HOME, "damian-mesh", [
					member(DEVICE_SELF, {
						name: "damians-MacBook-Pro",
						role: "admin",
						endpoints: ["192.168.1.10:4097"],
					}),
					member(DEVICE_PEER, {
						name: "build-box",
						endpoints: ["10.88.0.7:4097"],
						reachable: false,
						reason: "the listing budget ran out before this member was probed",
					}),
					member(DEVICE_THIRD, {
						name: "cloud-node-1",
						endpoints: ["10.88.0.4:4097"],
						last_seen_at: seenMinutesAgo(9),
					}),
					/*
					 * NO READ NAMED THIS DEVICE: a membership with an empty reason and no peer
					 * row is `unknown`, and the node says so rather than drawing a zero.
					 */
					member(DEVICE_FOURTH, {
						name: "ghost",
						endpoints: [],
						reachable: false,
						reason: "",
					}),
					member(DEVICE_FIFTH, {
						name: "old-laptop",
						endpoints: ["192.168.1.40:4097"],
						suspect: true,
						reachable: false,
						reason: "no route to it",
					}),
					member(`d_${"f".repeat(32)}`, {
						name: "workshop-mini",
						endpoints: ["203.0.113.9:4097"],
						reachable: false,
						reason: "it did not answer",
					}),
				]),
			],
		},
		peers: {
			self_device_id: DEVICE_SELF,
			peers: [
				peer(DEVICE_PEER, {
					name: "build-box",
					reachable: false,
					unreachable_reason:
						"the listing budget ran out before this member was probed",
					session_count: 3,
				}),
				peer(DEVICE_THIRD, {
					name: "cloud-node-1",
					session_count: 4,
					last_seen_at: seenMinutesAgo(9),
				}),
				peer(DEVICE_FIFTH, {
					name: "old-laptop",
					reachable: false,
					unreachable_reason: "no route to it",
					session_count: 2,
					last_seen_at: seenMinutesAgo(9),
				}),
				peer(`d_${"f".repeat(32)}`, {
					name: "workshop-mini",
					reachable: false,
					unreachable_reason: "it did not answer",
					session_count: 1,
				}),
			],
			degraded: [],
		},
		sessions: [
			/*
			 * THE ONE POSITIVE-LOUD STATE. `busy` is the backend's own word for a turn in
			 * flight, and it is the only activity this wire can report: there is no heartbeat,
			 * which is why `last_seen_at` is a rotation stamp and is labelled as one.
			 */
			sessionRow(`s_${"1".repeat(12)}`, "Sweep 011", {
				locality: "remote",
				owner_device: DEVICE_PEER,
				owner_device_name: "build-box",
				live_state: "busy",
			}),
		],
	};
}

export const ReachStates: Story = {
	render: () => {
		installBridge(reachStatesFixture());
		return <MeshPage />;
	},
};

/**
 * THE SAME REACH FIXTURE, READ IN THE LIST: the frame the list-ink fix asked for.
 *
 * Both faces of the round's M1/D1 finding live here and ONLY here: `build-box` (a
 * device nothing dialled) must read `not asked` with NO hue, and `old-laptop` (suspect)
 * must read its reach word with the `ShieldAlert` and the badge beside it - where the
 * list used to paint the first in the failure amber and the second as a bare
 * `identity suspect` in colour alone. The press is the real toggle, the same one
 * `list-view` drives.
 */
export const ReachStatesList: Story = {
	render: () => {
		installBridge(reachStatesFixture());
		return <MeshPage />;
	},
	play: async () => {
		await screen.findByText(/networks? · /i);
		(await screen.findByRole("button", { name: "List" })).click();
		await screen.findByText("Sort devices by");
	},
};

/**
 * THE THREE DRAWN TIERS OF THE SCOPE LAYER, and the two that are not drawn at all.
 *
 * `aws-node-1` and `aws-node-2` share `10.88.0.0/24`, which is WIREGUARD'S DEFAULT and
 * collides across unrelated installs - so they get the DASHED enclosure and the words
 * `same prefix`, which name the test rather than claiming a path. `backup-nas` shares
 * `192.168.1.0/24` with THIS device, which is a statement about the machine the reader is
 * sitting at, so it gets the SOLID one. `cold-storage` and `edge-proxy` get nothing: the
 * first publishes an address the classifier refuses to group, the second a public address
 * that shares a prefix with nobody here - and the internet is not a container to draw.
 *
 * THE ADDRESSES ARE ALSO IN THE PANEL, which is what keeps the drawing checkable: the
 * canvas's boundaries are arithmetic on the strings the panel lists in full.
 */
export const Scopes: Story = {
	render: () => {
		installBridge({
			networks: {
				self_device_id: DEVICE_SELF,
				networks: [
					network(NET_HOME, "damian-mesh", [
						member(DEVICE_SELF, {
							name: "damians-MacBook-Pro",
							role: "admin",
							endpoints: ["192.168.1.10:4097"],
						}),
						member(DEVICE_PEER, {
							name: "aws-node-1",
							endpoints: ["10.88.0.7:4097"],
						}),
						member(DEVICE_THIRD, {
							name: "aws-node-2",
							endpoints: ["10.88.0.4:4097"],
						}),
						member(DEVICE_FOURTH, {
							name: "backup-nas",
							endpoints: ["192.168.1.40:4097"],
						}),
						member(DEVICE_FIFTH, {
							name: "cold-storage",
							endpoints: ["0.0.0.0:4097"],
						}),
						member(`d_${"f".repeat(32)}`, {
							name: "edge-proxy",
							endpoints: ["203.0.113.9:4097"],
						}),
					]),
				],
			},
			peers: {
				self_device_id: DEVICE_SELF,
				peers: [
					peer(DEVICE_PEER, { name: "aws-node-1", session_count: 4 }),
					peer(DEVICE_THIRD, { name: "aws-node-2", session_count: 2 }),
					peer(DEVICE_FOURTH, { name: "backup-nas", session_count: 0 }),
					peer(DEVICE_FIFTH, { name: "cold-storage", session_count: 0 }),
					peer(`d_${"f".repeat(32)}`, {
						name: "edge-proxy",
						session_count: 7,
					}),
				],
				degraded: [],
			},
		});
		return <MeshPage />;
	},
};

/**
 * THE DECLARED TIER, PHOTOGRAPHED (design review round 1, D6) - AND WHAT THIS FRAME
 * CANNOT PROVE, stated before a reader asks.
 *
 * `declared` is the third drawn tier, and NO BACKEND SENDS IT YET: the field is read
 * client-side (`mesh-scope.ts`'s `declaredScope`, off a membership's `scope`), so no
 * live install can render this boundary - the design round's judgment of it could not
 * be checked against any frame. This story sets the field the client half reads, which
 * is the same instrument the tier's own unit test uses, so the SHIPPED STYLING (a
 * solid frame, the operator's word and `· declared` in the label, and its difference
 * from the dashed probable tier beside it) is verifiable; whether an install shows it
 * is the backend's question, and the set's README carries that caveat.
 */
export const ScopesDeclared: Story = {
	render: () => {
		installBridge({
			networks: {
				self_device_id: DEVICE_SELF,
				networks: [
					network(NET_HOME, "damian-mesh", [
						member(DEVICE_SELF, {
							name: "damians-MacBook-Pro",
							role: "admin",
							endpoints: ["192.168.1.10:4097"],
						}),
						member(DEVICE_PEER, {
							name: "rack-node",
							endpoints: ["10.44.0.9:4097"],
							scope: "sim-lab",
						}),
						member(DEVICE_THIRD, {
							name: "lab-a",
							endpoints: ["10.88.0.5:4097"],
						}),
						member(DEVICE_FOURTH, {
							name: "lab-b",
							endpoints: ["10.88.0.6:4097"],
						}),
					]),
				],
			},
			peers: {
				self_device_id: DEVICE_SELF,
				peers: [
					peer(DEVICE_PEER, { name: "rack-node", session_count: 0 }),
					peer(DEVICE_THIRD, { name: "lab-a", session_count: 2 }),
					peer(DEVICE_FOURTH, { name: "lab-b", session_count: 1 }),
				],
				degraded: [],
			},
		});
		return <MeshPage />;
	},
};

/**
 * TWO ENCLOSURES SHARING THEIR TOPMOST DEVICE (agent review round 2, M4): the frame the
 * collision case never had.
 *
 * `build-box` publishes a tunnel address (`10.88.0.5`) AND a LAN one (`192.168.1.40`),
 * so it sits in TWO groups - the dashed probable one with `lab-a` and the solid shared
 * one with `lab-b` - and it is TOPMOST in both. Before the nesting rule both frames'
 * tops landed on one anchor and their labels overprinted at one point (the reviewer's
 * repro measured both at (428, 140) - no frame showed it). This frame is where the
 * staircase can be checked: two rings 26 px apart, the shared frame (reaching further
 * down, to `lab-b`) the outer one, labels one pitch apart and never on top of each
 * other.
 */
export const ScopesSharedTop: Story = {
	render: () => {
		installBridge({
			networks: {
				self_device_id: DEVICE_SELF,
				networks: [
					network(NET_HOME, "damian-mesh", [
						member(DEVICE_SELF, {
							name: "damians-MacBook-Pro",
							role: "admin",
							endpoints: ["192.168.1.10:4097"],
						}),
						member(DEVICE_PEER, {
							name: "build-box",
							endpoints: ["10.88.0.5:4097", "192.168.1.40:4097"],
						}),
						member(DEVICE_THIRD, {
							name: "lab-a",
							endpoints: ["10.88.0.6:4097"],
						}),
						member(DEVICE_FOURTH, {
							name: "lab-b",
							endpoints: ["192.168.1.41:4097"],
						}),
					]),
				],
			},
			peers: {
				self_device_id: DEVICE_SELF,
				peers: [
					peer(DEVICE_PEER, { name: "build-box", session_count: 3 }),
					peer(DEVICE_THIRD, { name: "lab-a", session_count: 1 }),
					peer(DEVICE_FOURTH, { name: "lab-b", session_count: 0 }),
				],
				degraded: [],
			},
		});
		return <MeshPage />;
	},
};

/**
 * THREE LEVELS ON ONE OPENER (the design ruling's "n = 3 if cheap"): three INFERRED
 * groups hanging off one row.
 *
 * `build-box` publishes three addresses on three prefixes - a LAN one (`192.168.1.40`,
 * shared with this device) and two tunnel ones (`10.88.0.5` with `lab-a`, `10.44.0.9`
 * with `lab-c`) - and it is topmost in all three, so the staircase draws at its full
 * pitch: three labels 26 px apart, each frame 4 px wider than the one inside it, the
 * layout clearing 84 px above the row. The order is the ruling's larger-bottom rule
 * rather than a special case: `lab-c` reaches furthest down, so its probable frame is
 * outermost.
 *
 * THE DECLARED TIER CANNOT APPEAR IN A STACK, which is why this story uses a third
 * inferred prefix where an earlier draft put a `scope`: `prefixGroups` excludes a
 * device with an authored scope from the prefix arithmetic entirely ("one machine is
 * never inside two boundaries that disagree about why it is there"), so a declared
 * group never shares an opener with an inferred one. `ScopesDeclared` stays the
 * declared tier's own frame; this one is the stack at depth three.
 */
export const ScopesNested: Story = {
	render: () => {
		installBridge({
			networks: {
				self_device_id: DEVICE_SELF,
				networks: [
					network(NET_HOME, "damian-mesh", [
						member(DEVICE_SELF, {
							name: "damians-MacBook-Pro",
							role: "admin",
							endpoints: ["192.168.1.10:4097"],
						}),
						member(DEVICE_PEER, {
							name: "build-box",
							endpoints: [
								"10.88.0.5:4097",
								"192.168.1.40:4097",
								"10.44.0.9:4097",
							],
						}),
						member(DEVICE_THIRD, {
							name: "lab-a",
							endpoints: ["10.88.0.6:4097"],
						}),
						member(DEVICE_FOURTH, {
							name: "lab-b",
							endpoints: ["192.168.1.41:4097"],
						}),
						member(DEVICE_FIFTH, {
							name: "lab-c",
							endpoints: ["10.44.0.7:4097"],
						}),
					]),
				],
			},
			peers: {
				self_device_id: DEVICE_SELF,
				peers: [
					peer(DEVICE_PEER, { name: "build-box", session_count: 3 }),
					peer(DEVICE_THIRD, { name: "lab-a", session_count: 1 }),
					peer(DEVICE_FOURTH, { name: "lab-b", session_count: 0 }),
					peer(DEVICE_FIFTH, { name: "lab-c", session_count: 2 }),
				],
				degraded: [],
			},
		});
		return <MeshPage />;
	},
};

/**
 * A chip in the air over a VALID target: the transient state, mid-drag.
 *
 * THE GESTURE IS DRIVEN BY THE RIG, NOT BY THIS STORY, and that is a measurement rather
 * than a preference. A `PointerEvent` dispatched from here has no ACTIVE pointer behind
 * it, and the state this frame exists to show is held by a pointer that is DOWN: the
 * synthetic sequence resolves and paints the SETTLED canvas, which the capture's own
 * `expectSentence` guard then reports as "the frame's claimed sentence is not on the
 * screen". The rig presses, moves with the button held and interpolates through the real
 * input pipeline (`Input.dispatchMouseEvent`, the mechanism the canvas bench drives the
 * shipped app with), so the row carries `drag` and the claim, and this story only mounts
 * the fixtures. A story that asserts a transient it cannot produce is worse than one that
 * does not assert it.
 */
export const DragToDevice: Story = {
	render: () => {
		installBridge(actionFixture());
		return <MeshPage />;
	},
	play: async () => {
		await screen.findByText(/networks? · /i);
	},
};

/**
 * A chip over a network lane: the drop the client refuses, says so, and names why.
 *
 * Same rule as `DragToDevice`: the refusal is stated DURING the gesture, the rig drives
 * the gesture, and the row's claim is what says the refusal was on the screen when the
 * shutter fired.
 */
export const DragRefusedOverNetwork: Story = {
	render: () => {
		installBridge(actionFixture());
		return <MeshPage />;
	},
	play: async () => {
		await screen.findByText(/networks? · /i);
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
 * The cap, with four conversations on ONE peer: what the row does when it runs out.
 *
 * THIS STORY EXISTS BECAUSE NOTHING SHOWED THE CASE (design review round 2, D8). Every
 * other story in this file puts at most two conversations on a device, so the overflow
 * control was never drawn in a frame and the cap could only be judged from the two-row
 * case - which is how round 1 shipped with two chips reading `Swe…` and `Res…`.
 *
 * THE TITLES ARE DELIBERATE: four conversations named in series, differing only in their
 * last characters, which is the shape this app's own fixtures use and the shape an
 * end-truncation renders as four identical chips. The chip truncates from the LEFT
 * (`mesh-node.tsx`), so what survives is the part that tells them apart.
 */
export const CapAtFour: Story = {
	render: () => {
		const base = actionFixture();
		installBridge({
			...base,
			peers: {
				...base.peers,
				peers: [
					peer(DEVICE_PEER, {
						name: "cloud-node-1",
						last_seen_at: seenMinutesAgo(9),
						session_count: 4,
					}),
				],
			},
			sessions: [
				sessionRow("0123456789ab", "Sweep 001"),
				sessionRow("0123456789cd", "Resume the roadmap", {
					live_state: "attached",
				}),
				...["011", "012", "013", "014"].map((tail) =>
					sessionRow(`0123456789${tail}`, `Sweep ${tail}`, {
						locality: "remote",
						owner_device: DEVICE_PEER,
						owner_device_name: "cloud-node-1",
					}),
				),
			],
		});
		return <MeshPage />;
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
		/*
		 * THE BUSY SESSION IS THE SUBJECT, and the first version of this story got that wrong
		 * in a way nothing could see (design review round 1, D3): it opened the panel on the
		 * PEER and recalled the peer's own conversation, so the busy refinement never arrived,
		 * no notice was drawn, and the frame showed the confirm dialog with no refusal in it at
		 * all. The row now carries `expectSentence` ("Wait for the turn to finish"), which is
		 * what turned that into a failing capture rather than a frame a later round would have
		 * read as the refusal it is not.
		 */
		await openPanel(DEVICE_SELF);
		await chooseFromSessionMenu("0123456789ab", "Move to cloud-node-1");
		// A busy session is refused by the CLIENT's own verdict, so no dialog opens: the
		// notice carries the code, the sentence and the wait.
		await screen.findByText(/Wait for the turn to finish/);
	},
};

/**
 * The `busy` remedy EXECUTED, and the request it sends (agent review round 2, F2).
 *
 * WHY THIS IS A STORY OF ITS OWN, and why it is not the story above. Round 1 fixed the
 * inert button and round 2 measured that nothing in the tree had ever pressed it: the
 * read path that makes it work (`moveReport.plan` -> `run(plan, WAIT_FOR_IDLE_S)`) was
 * unpinned, and `MoveRefusedBusy`'s own play stops at `findByText` - it cannot press the
 * button, because pressing it replaces the notice with the outcome and that row's
 * `expectSentence` claim is the refusal. This story is the same setup one step further,
 * with the `play` doing the thing a reader does and asserting what went on the wire.
 *
 * THE ASSERTION IS ON THE APP'S OWN SEAM. The bridge this file installs is wrapped for the
 * duration of the play, so what is recorded is exactly what the page asked for - and the
 * fact asserted is `waitS`, the renderer-side spelling of the route's `wait_s` ceiling
 * (`desktop-contract.ts` maps it at the transport). Round 1's defect was that the button
 * did nothing; a `waitS` other than 300 would mean it re-issued the move WITHOUT waiting,
 * which is the one thing the remedy must not do - it would be refused again.
 */
export const MoveBusyWaited: Story = {
	render: () => {
		installBridge({
			...actionFixture(),
			/*
			 * THE BUSY ROW IS THE SUBJECT, exactly as it is in `MoveRefusedBusy`: without it the
			 * gesture reaches the ordinary move-confirm dialog, there is no refusal, and therefore no
			 * `Wait for the turn to finish` to press. The first version of this story omitted it and
			 * the capture failed on the frame's own claim - which is the claim doing its job.
			 */
			sessions: [
				sessionRow("0123456789ab", "Sweep 001", { live_state: "busy" }),
				sessionRow("0123456789cd", "Resume the roadmap", {
					live_state: "attached",
				}),
				sessionRow("0123456789ef", "Rewrite the importer", {
					locality: "remote",
					owner_device: DEVICE_PEER,
					owner_device_name: "cloud-node-1",
				}),
			],
			/*
			 * AND THE WORLD IT ANSWERS AFTERWARDS AGREES WITH ITS OWN RECEIPT (design review round 3,
			 * D13 - wired into THIS story in round 4, D18, because round 3's edit landed in
			 * `MoveCopyWithUndo` and left the story the hook was written for unwired, so the frame kept
			 * showing the pre-move canvas while the play's own waits waited for this). The receipt says
			 * "the copy here is gone"; the page re-reads both lists on success, so this is what those
			 * reads must return - this device holds one conversation and the peer holds two - or the
			 * frame contradicts itself in three places at once (the canvas, the panel and the peer's
			 * own count).
			 */
			afterTransfer: (world) => {
				world.sessions = [
					sessionRow("0123456789cd", "Resume the roadmap", {
						live_state: "attached",
					}),
					sessionRow("0123456789ef", "Rewrite the importer", {
						locality: "remote",
						owner_device: DEVICE_PEER,
						owner_device_name: "cloud-node-1",
					}),
					sessionRow("0123456789ab", "Sweep 001", {
						locality: "remote",
						owner_device: DEVICE_PEER,
						owner_device_name: "cloud-node-1",
					}),
				];
				world.peers = {
					self_device_id: DEVICE_SELF,
					peers: [
						peer(DEVICE_PEER, {
							name: "cloud-node-1",
							last_seen_at: seenMinutesAgo(9),
							session_count: 2,
						}),
					],
					degraded: [],
				};
			},
			transfer: {
				locality: "remote",
				owner_device: DEVICE_PEER,
				source_retired: true,
				session_id: "0123456789ab",
				new_session_id: "0".repeat(12),
				mode: "move",
				phases: [],
			},
		});
		return <MeshPage />;
	},
	play: async () => {
		const sent: Array<BridgeRequest & { waitS?: number }> = [];
		const page = window as unknown as {
			api?: {
				desktop?: {
					request: (
						r: BridgeRequest & { waitS?: number },
					) => Promise<DesktopResponse>;
				};
			};
		};
		const installed = page.api?.desktop?.request;
		const desktop = page.api?.desktop;
		if (!installed || !desktop)
			throw new Error("the story's bridge is not installed");
		desktop.request = (request) => {
			sent.push(request);
			return installed(request);
		};

		await openPanel(DEVICE_SELF);
		await chooseFromSessionMenu("0123456789ab", "Move to cloud-node-1");
		const user = userEvent.setup();
		await user.click(
			await screen.findByRole("button", {
				name: "Wait for the turn to finish",
			}),
		);
		await screen.findByText("Moved");
		/*
		 * THEN THE ASSERTION, SYNCHRONOUSLY (agent review round 3, the MAJOR). The first version of
		 * this play asserted INSIDE `waitFor`, and a retrying `waitFor` only rejects when its own
		 * budget runs out - by which time the capture rig has already read the console for play
		 * failures and written the frame. Measured: with the wait dropped at the call site (the wire
		 * carrying `waitS: 0`), the rig reported success and committed the frame anyway, so the pin
		 * could not fail where it matters.
		 *
		 * So the wait is for the OUTCOME (the notice the re-issued move produces) and the checks run
		 * once, synchronously: a wrong `waitS` throws on the spot, naming the value it saw, which is
		 * the shape the reviewer's own copy of this condition had.
		 */
		const transfers = sent.filter((r) => r.op === "sessions.transfer");
		if (transfers.length !== 1)
			throw new Error(
				`the busy refusal sends nothing, and the remedy sends ONE move: saw ${transfers.length}`,
			);
		if (transfers[0].waitS !== 300)
			throw new Error(
				`the re-issued move must carry the route's own wait ceiling, not ${transfers[0].waitS}`,
			);
		/*
		 * AND THE WORLD IT PAINTS IS WAITED FOR, not assumed (design review round 3, D13). The page
		 * invalidates `sessions` and `peers` on success, and that refetch settles AFTER the notice -
		 * so a capture gated only on "Moved" photographs the pre-move canvas beside a receipt saying
		 * the source is gone, which is exactly what the round measured on the first re-shot frame.
		 * The panel's own count is the reading: this device holds one conversation once the re-read
		 * has landed, and two until then.
		 */
		await screen.findByText("Conversations (1)");
		/*
		 * AND THE CANVAS AGREES WITH THE PANEL, checked synchronously (design review round 3, D13).
		 * The panel's count and the canvas are two renderings of the same rows, so if one says one
		 * conversation and the other draws two, the frame is a claim about a world that never existed.
		 * This is the reading that decides whether the receipt's sentence is backed by the pixels next
		 * to it, and it names the number it saw.
		 */
		const drawn = document.querySelectorAll(
			`[data-mesh-device="${DEVICE_SELF}"] [data-mesh-session]`,
		).length;
		if (drawn !== 1)
			throw new Error(
				`the receipt says this device's copy is gone, so the canvas must draw ONE conversation; it drew ${drawn}`,
			);
	},
};

/** The reversible half, and the undo it leaves: a `--keep` copy that can be erased. */
export const MoveCopyWithUndo: Story = {
	render: () => {
		/*
		 * THE UNDO ANSWERS WITH ITS OWN WORLD AND ITS OWN RECEIPT (agent review round 1,
		 * Q2). The chain was provable before this - the button, the confirm dialog, the
		 * `sessions.transfer` and both re-reads - but EVERY transfer answered the same
		 * keep-mode payload, so the recall the undo sends produced byte-identical words
		 * and a later round could not photograph it. `afterTransfer` runs before each
		 * answer, so the first call rewrites the world AND the next answer: the copy
		 * lands on the peer (this device keeps the original), and the undo's own recall
		 * answers with `mode: "move"` back to this device, the shape the page renders as
		 * its own receipt. The committed frame still photographs the COPY receipt + the
		 * undo affordance; the chain's second half is now renderable rather than fixed.
		 */
		let transfers = 0;
		const base = actionFixture();
		installBridge({
			...base,
			transfer: {
				locality: "remote",
				owner_device: DEVICE_PEER,
				source_retired: false,
				session_id: "0123456789ef",
				new_session_id: "0123456789f1",
				mode: "keep",
				phases: [],
			},
			afterTransfer: (world) => {
				transfers += 1;
				if (transfers === 1) {
					/*
					 * The reads that follow the copy show the world the notice CLAIMS: cloud-node-1
					 * holds the new id beside the original's row, and its count moves with it.
					 * A static fixture here would re-answer the pre-copy world under a receipt
					 * that says a copy exists - design review round 3's D13, one story along.
					 */
					world.sessions = [
						...base.sessions,
						sessionRow("0123456789f1", "Rewrite the importer", {
							locality: "remote",
							owner_device: DEVICE_PEER,
							owner_device_name: "cloud-node-1",
						}),
					];
					world.peers = {
						self_device_id: DEVICE_SELF,
						peers: [
							peer(DEVICE_PEER, {
								name: "cloud-node-1",
								last_seen_at: seenMinutesAgo(9),
								session_count: 4,
							}),
						],
						degraded: [],
					};
					/* And the NEXT transfer - the undo's recall - is not a copy: it moves the
					 * copy back to this device, which the page renders as a move receipt. */
					world.transfer = {
						locality: "local",
						owner_device: DEVICE_SELF,
						source_retired: true,
						session_id: "0123456789f1",
						new_session_id: "0123456789ef",
						mode: "move",
						phases: [],
					};
					return;
				}
				/* The recall landed: the peer's copy is gone and the original is back alone. */
				world.sessions = base.sessions;
				world.peers = base.peers;
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
		await screen.findByText(/Bring the copy back from/);
	},
};

/** Admission is two-sided: the invite mints a token, and the receipt says where. */
export const InviteReceipt: Story = {
	render: () => {
		const base = actionFixture();
		installBridge({
			...base,
			networks: {
				...base.networks,
				/*
				 * A SECOND NETWORK THE INVITED DEVICE IS NOT IN, which is what the dialog needs to
				 * offer anything at all (design review round 1, D3). `inviteOptions` excludes the
				 * networks a device is already an active member of, so inviting the fixture's own
				 * peer against `actionFixture()` alone opened a dialog with NOTHING to choose:
				 * `chosen` was null, `Mint the token` was disabled, the story's click did nothing,
				 * and the row named `invite-receipt` photographed an un-minted dialog. With two
				 * networks the peer is a member of one and eligible for the other, and the dialog
				 * pre-selects it.
				 */
				networks: [
					...base.networks.networks,
					network(NET_LAB, "lab-mesh", [
						member(DEVICE_SELF, {
							name: "damians-MacBook-Pro",
							role: "admin",
						}),
					]),
				],
			},
		});
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

/**
 * The approvals tray with one record WAITING on the operator: the prompt the
 * live panel exists for, and nothing else on it. The settled registers live in
 * `ApprovalsRecords`/`ApprovalsRecordsOpen` below, because a spent approval is
 * a record, not a prompt (operator round, 2026-10-03).
 *
 * NO `play`, ON PURPOSE (design round 1). It used to press Approve on render, so
 * the frame this story is named for - the ASKING card - was never the one it
 * photographed: a reader comparing `approvals-waiting` against the surface saw
 * the post-decision registers and had no still of the state the whole surface
 * exists for. The write path is proven by `ApprovalsDecisionWrites` beside this
 * one, where the story's own name says that is what it drives.
 */
export const ApprovalsWaiting: Story = {
	render: () => {
		installBridge({
			...singleDeviceFixture(),
			approvals: [approvalRecord({})],
		});
		return <MeshPage />;
	},
};

/**
 * None waiting, several decided: the records section at rest - the header with
 * no count, and the one-line toggle holding everything the read still carries
 * (a decision made, a run in flight, a completed connect).
 */
export const ApprovalsRecords: Story = {
	render: () => {
		installBridge({
			...singleDeviceFixture(),
			approvals: [
				approvalRecord({
					approval_id: "ap_7q0w5n2x9k4m",
					state: "approved",
					name: "studio-mini",
					host: "studio-mini.local",
					user: "builder",
				}),
				approvalRecord({
					approval_id: "ap_3m8c1v6b0n2x",
					state: "connecting",
					name: "lab-node",
					host: "lab-node.local",
					user: "ops",
				}),
				approvalRecord({
					approval_id: "ap_9z5t4r7k1m3w",
					state: "connected",
					name: "field-kit",
					host: "field-kit.local",
					user: "damian",
				}),
			],
		});
		return <MeshPage />;
	},
};

/**
 * The same several records with the section OPEN - the expanded state, driven by
 * a real press on the toggle so the frame and the control's own state agree.
 */
export const ApprovalsRecordsOpen: Story = {
	render: () => {
		installBridge({
			...singleDeviceFixture(),
			approvals: [
				approvalRecord({
					approval_id: "ap_7q0w5n2x9k4m",
					state: "approved",
					name: "studio-mini",
					host: "studio-mini.local",
					user: "builder",
				}),
				approvalRecord({
					approval_id: "ap_3m8c1v6b0n2x",
					state: "connecting",
					name: "lab-node",
					host: "lab-node.local",
					user: "ops",
				}),
				approvalRecord({
					approval_id: "ap_9z5t4r7k1m3w",
					state: "connected",
					name: "field-kit",
					host: "field-kit.local",
					user: "damian",
				}),
			],
		});
		return <MeshPage />;
	},
	play: async () => {
		const user = userEvent.setup();
		await user.click(
			await screen.findByRole("button", { name: /^Records \(/ }),
		);
	},
};

/**
 * A stopped runner: `failed` is the one record state the store says "a person
 * should not miss", so the section opens itself while one is inside, and the
 * record's remaining write wears its consequence - "Abandon", never "Deny".
 */
export const ApprovalsStopped: Story = {
	render: () => {
		installBridge({
			...singleDeviceFixture(),
			approvals: [
				approvalRecord({
					approval_id: "ap_f4i1l2e3d4x",
					state: "failed",
					name: "lab-node",
					host: "lab-node.local",
					user: "ops",
				}),
			],
		});
		return <MeshPage />;
	},
};

/**
 * The decision path the badge exists for, driven: approve, then watch the record
 * settle to `approved` through the invalidation refetch - and open the records
 * section it collapsed into. A still cannot show that the button writes, the
 * read moves, and the settled state leaves the live panel; this story's `play`
 * walks all three.
 */
export const ApprovalsDecisionWrites: Story = {
	render: () => {
		installBridge({
			...singleDeviceFixture(),
			approvals: [approvalRecord({})],
		});
		return <MeshPage />;
	},
	play: async () => {
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Approve" }));
		/* The record LEFT the panel: no waiting count, one record in the section. */
		await user.click(
			await screen.findByRole("button", { name: /^Records \(/ }),
		);
		await screen.findByText("Approved");
	},
};

/**
 * A decision the store REFUSED, and the sentence it answered with (agent review
 * round 1, finding 1): without this render path the operator sees the button
 * re-enable and cannot tell a refusal from a dead click. The sentence here is
 * the shape core answers a host with no signing surface with; the code rides
 * beside it, the way the move refusals carry theirs.
 */
export const ApprovalRefused: Story = {
	render: () => {
		installBridge({
			...singleDeviceFixture(),
			approvals: [approvalRecord({})],
			decisionRefusal: {
				code: "approval_signing_unavailable",
				message:
					"This machine has no operator key to sign with; ask Local Operator to set up operator authority here first.",
			},
		});
		return <MeshPage />;
	},
	play: async () => {
		const user = userEvent.setup();
		await user.click(await screen.findByRole("button", { name: "Approve" }));
		await screen.findByText(/no operator key to sign with/);
	},
};
