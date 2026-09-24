/**
 * The mesh in the chat sidebar, executable: the peer partition, the locality mark,
 * the peer sections, and - the promise this file exists for - that a user WITHOUT
 * a network gets exactly the sidebar they had.
 *
 *     node --test scripts/chat-sidebar-peers.test.mjs
 *
 * WHAT IS REAL AND WHAT IS STUBBED. The shipped `ChatSidebar`, its real store and
 * its real `chat-peers.ts` partition are mounted in jsdom, in the harness
 * `mark-all-read-control.test.mjs` established (same stubs, same reasons: the
 * sidebar reads the router, the capability hook and three catalogue hooks, and
 * this suite has no app shell). The capability answer is a GLOBAL each case sets,
 * so the same bundle renders with `features.peers` absent and present; the peer
 * catalogue is answered through the stubbed transport.
 *
 * WHAT IT CANNOT PROVE: pixels. "Identical DOM" is necessary for "identical
 * pixels" (the CSS is the same stylesheet in both builds, so equal markup under
 * equal classes paints equal frames) but a frame is still the evidence for
 * appearance - the S1 story is the photographed half of this claim.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// React DOM feature-detects at import time, so the document exists first.
/*
 * `pretendToBeVisual` IS LOAD-BEARING: the sidebar's read-acknowledgement notice
 * schedules its work with `requestAnimationFrame`, and a jsdom created without it
 * has no such function - the sidebar threw `ReferenceError:
 * requestAnimationFrame is not defined` on every render and all five cases here
 * failed as an empty panel. The two fallbacks below cover a jsdom that reports
 * the names but defines them as undefined.
 */
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chats",
	pretendToBeVisual: true,
});
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.requestAnimationFrame =
	DOM.window.requestAnimationFrame?.bind(DOM.window) ??
	((callback) => setTimeout(() => callback(Date.now()), 16));
globalThis.cancelAnimationFrame =
	DOM.window.cancelAnimationFrame?.bind(DOM.window) ??
	((handle) => clearTimeout(handle));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
DOM.window.Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/*
 * The capability answer and the transport, both per case. `__features` is read on
 * every render by the stubbed hook, so a case sets it BEFORE mounting.
 */
const BASE_FEATURES = { session_catalogue: 2, session_pins: 1 };
globalThis.__features = { ...BASE_FEATURES };
let requests = [];
let peerAnswer = { peers: [], degraded: [] };
let currentRows = [];
globalThis.__desktop = async (request) => {
	requests.push(request);
	if (request.op === "peers.list") return peerAnswer;
	/*
	 * The sidebar reads the list itself on mount, so the answer IS the case's
	 * rows, in the wire's field names - an empty answer would replace what the
	 * case seeded and every assertion would be about an empty panel.
	 */
	if (request.op === "sessions.list")
		return {
			sessions: currentRows.map(
				({ session_id, title, updated_at, ...rest }) => ({
					...rest,
					id: session_id,
					name: title,
					mtime: updated_at ?? 1_789_400_000,
				}),
			),
			truncated: false,
			degraded: [],
		};
	return {};
};

const STUB_CONTENTS = {
	"@shared/api/local-operator/desktop-api": `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
	)}
export const desktopResult = request => globalThis.__desktop(request);`,
	"@shared/api/local-operator/desktop-hooks": `export {desktopFeatureEnabled, desktopFeatureState, desktopKeys} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-hooks.ts`,
	)}
export const useDesktopCapabilities = () => ({
	data: { desktop_available: true, features: globalThis.__features },
	error: null,
	isLoading: false,
	refetch: async () => undefined,
});`,
	"@shared/api/local-operator/profile-hooks": `export const useProfiles = () => ({ data: [], error: null, isLoading: false, refetch: async () => undefined });
export const useTeams = () => ({ data: [], error: null, isLoading: false, refetch: async () => undefined });`,
	"@shared/api/local-operator/session-search":
		"export const useChatSearch = () => ({ data: undefined, refused: false, isError: false, refetch: async () => undefined });",
	"@shared/hooks/use-desktop-feed":
		"export const useDesktopFeed = () => ({ available: false, connected: true, catalogueRevision: 0 });",
	"@shared/hooks/use-connectivity-status":
		"export const useServerHealth = () => ({ data: { online: true, snapshot: null } });",
	"@shared/api/local-operator/backend-error":
		"export const compatibilityBannerShown = () => false;",
	"react-router-dom": "export const useNavigate = () => () => undefined;",
	"@shared/themes": `export const DEFAULT_THEME = "localOperatorDark";`,
	"@shared/hooks/use-canonical-session": `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const discardPendingEchoes = () => undefined;`,
};
const STUB_PATHS = Object.keys(STUB_CONTENTS);

/*
 * The one regex this file needs at a top level: biome's `useTopLevelRegex` is a
 * request to hoist a literal out of a hot scope, and inside the esbuild plugin it
 * is read once per resolution - so it lives here, named, rather than inline in
 * the resolver.
 */
const ANY_NAMESPACE = /.*/;

const bundle = await build({
	stdin: {
		contents:
			'export { ChatSidebar } from "./src/renderer/src/features/chat/components/chat-sidebar";' +
			' export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";' +
			' export * as peers from "./src/renderer/src/features/chat/chat-peers";' +
			' export { layoutTopology } from "./src/renderer/src/features/network/topology-layout";' +
			' export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";' +
			// The provider has to be THIS bundle's instance of React Query, or the
			// sidebar's `usePeers` reads a different context than the one mounted.
			' export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	jsx: "automatic",
	plugins: [
		{
			name: "sidebar-peers-fixture",
			setup(builder) {
				for (const path of STUB_PATHS) {
					builder.onResolve({ filter: new RegExp(`^${path}$`) }, () => ({
						path,
						namespace: "sidebar-peers-fixture",
					}));
				}
				builder.onLoad(
					{ filter: ANY_NAMESPACE, namespace: "sidebar-peers-fixture" },
					(args) => ({
						contents: STUB_CONTENTS[args.path],
						loader: "js",
						resolveDir: process.cwd(),
					}),
				);
			},
		},
	],
});
const bundlePath = new URL("._chat-sidebar-peers.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const {
	ChatSidebar,
	useCanonicalSessionsStore: store,
	peers,
	layoutTopology,
	desktopEndpoint,
	desktopRequestSchema,
	QueryClient,
	QueryClientProvider,
} = await import(bundlePath.href);
const { createRoot } = await import("react-dom/client");

after(() => {
	DOM.window.close();
});

const IDLE = { code: "idle", label: "Recent" };

/** A catalogue row as a PRE-MESH backend sends it: no locality fields at all. */
const plain = (id, title, over = {}) => ({
	session_id: id,
	title,
	active: false,
	pinned: false,
	archived: false,
	status: IDLE,
	binding: { agent: null, team: null },
	...over,
});

const LAPTOP = "d_9c02aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STUDIO = "d_7e11bbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const peer = (device_id, name, over = {}) => ({
	device_id,
	name,
	kind: "device",
	lifecycle: "active",
	reachable: true,
	rtt_ms: 24,
	role: "drive",
	session_count: 0,
	last_seen_at: 1_789_400_000,
	unreachable_reason: "",
	size_class: "",
	expires_at: null,
	...over,
});

/** Mount the shipped sidebar over `rows`; returns the container and teardown. */
const mount = async (rows) => {
	currentRows = rows;
	store.setState({
		sessions: rows,
		loading: false,
		error: null,
		transfers: {},
		meshNotice: null,
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(ChatSidebar, {
					selectedConversation: undefined,
					onSelectConversation: () => undefined,
					onStageDraft: () => undefined,
				}),
			),
		);
	});
	// Let the peer query settle (it is async even when answered at once).
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	return {
		container,
		html: () => container.innerHTML,
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
			queryClient.clear();
		},
	};
};

const ROSTER = [
	plain("a1b2c3d4e5f6", "Reconcile the supplier ledger", { active: true }),
	plain("b2c3d4e5f6a7", "Quarterly revenue model"),
	plain("c3d4e5f6a7b8", "Draft the incident postmortem"),
];

/* ------------------------------------------------------------ the promise */

test("features.peers absent: the sidebar's DOM is byte-identical whether or not rows carry locality fields", async () => {
	/*
	 * The no-regression claim, stated as the strongest form this harness can
	 * check. The BEFORE is a pre-mesh backend's rows; the AFTER is the same rows
	 * as a mesh-aware backend would send them for a user with no network (every
	 * row local, `reachable: true`). With the gate off, both must render the same
	 * markup - no mark, no section, no group, no attribute - and neither may ask
	 * for the peer catalogue.
	 */
	globalThis.__features = { ...BASE_FEATURES };
	requests = [];
	const before = await mount(ROSTER);
	const beforeHtml = before.html();
	await before.unmount();
	const localised = ROSTER.map((row) => ({
		...row,
		locality: "local",
		owner_device: "",
		owner_device_name: "",
		reachable: true,
		unreachable_reason: "",
		last_synced_at: null,
		placement: null,
		origin: null,
	}));
	const afterMount = await mount(localised);
	const afterHtml = afterMount.html();
	await afterMount.unmount();
	assert.equal(afterHtml, beforeHtml, "the sidebar's DOM changed");
	assert.ok(
		beforeHtml.includes("Reconcile the supplier ledger"),
		"the fixture rendered no rows - an empty panel would make the comparison vacuous",
	);
	for (const marker of [
		"data-remote-mark",
		"data-peer-section",
		"data-peers-group",
		"data-mesh-notice",
	]) {
		assert.ok(!beforeHtml.includes(marker), `${marker} is mounted`);
	}
	assert.equal(
		requests.filter((request) => request.op === "peers.list").length,
		0,
		"the peer catalogue was asked for with the gate off",
	);
});

test("features.peers absent: a REMOTE row is still drawn as a plain row, not dropped", async () => {
	/*
	 * The other half of the gate: a backend that sends remote rows while not
	 * advertising the key (a mismatch, but a possible one mid-upgrade) must not
	 * lose a conversation. The partition is the identity, so the row lands in the
	 * ordinary list with no mark.
	 */
	globalThis.__features = { ...BASE_FEATURES };
	const harness = await mount([
		...ROSTER,
		plain("d4e5f6a7b8c9", "Remote but ungated", {
			active: true,
			locality: "remote",
			owner_device: LAPTOP,
			owner_device_name: "devon-laptop",
		}),
	]);
	try {
		assert.ok(harness.html().includes("Remote but ungated"));
		assert.ok(!harness.html().includes("data-remote-mark"));
	} finally {
		await harness.unmount();
	}
});

/* ---------------------------------------------------------- with a network */

test("features.peers present: remote rows carry the mark, local rows do not, and each peer gets a section", async () => {
	globalThis.__features = { ...BASE_FEATURES, peers: 1 };
	peerAnswer = {
		peers: [
			peer(LAPTOP, "devon-laptop", { session_count: 1 }),
			peer(STUDIO, "studio-mini", {
				reachable: false,
				rtt_ms: null,
				unreachable_reason: "no address of it answered",
			}),
		],
		degraded: [],
	};
	values.set(
		"chat-sidebar-disclosures",
		JSON.stringify({ [`peer:${LAPTOP}`]: true, peers: true }),
	);
	const harness = await mount([
		...ROSTER,
		plain("d4e5f6a7b8c9", "Tune the relay keepalive", {
			active: true,
			locality: "remote",
			owner_device: LAPTOP,
			owner_device_name: "devon-laptop",
			reachable: true,
			unreachable_reason: "",
		}),
	]);
	try {
		const doc = harness.container;
		const marks = doc.querySelectorAll("[data-remote-mark]");
		const rowMarks = [
			...doc.querySelectorAll('[data-tour-tag="chat-session-row"]'),
		].filter((row) => row.querySelector("[data-remote-mark]"));
		assert.equal(rowMarks.length, 1, "exactly the one remote row is marked");
		assert.ok(
			rowMarks[0].textContent.includes("Tune the relay keepalive"),
			"the mark is on the wrong row",
		);
		// The mark is the row's FIRST child: before the status glyph.
		assert.ok(
			rowMarks[0].firstElementChild?.hasAttribute("data-remote-mark"),
			"the mark is not the row's first child",
		);
		assert.ok(marks.length >= 1);
		const sections = [...doc.querySelectorAll("[data-peer-section]")].map(
			(node) => node.getAttribute("data-peer-section"),
		);
		assert.deepEqual(
			sections,
			[LAPTOP, STUDIO],
			"one section per peer, keyed by device id, in catalogue order - the quiet one included",
		);
		const studio = doc.querySelector(`[data-peer-section="${STUDIO}"]`);
		assert.ok(
			studio?.textContent.includes("⇄ studio-mini · unreachable"),
			"the unreachable peer's heading does not say so",
		);
		// The remote row is NOT also drawn in Active chats.
		const active = [...doc.querySelectorAll('[data-chat-section="active"]')];
		assert.equal(active.length, 1);
		const laptop = doc.querySelector(`[data-peer-section="${LAPTOP}"]`);
		assert.ok(laptop?.textContent.includes("Tune the relay keepalive"));
		const group = doc.querySelector("[data-peers-group]");
		assert.ok(group, "the Peers group is not mounted");
		assert.ok(
			group.textContent.includes("unreachable · last seen"),
			"the unreachable peer's row does not lead with its state",
		);
		assert.ok(
			requests.some((request) => request.op === "peers.list"),
			"the peer catalogue was never read",
		);
	} finally {
		values.delete("chat-sidebar-disclosures");
		await harness.unmount();
	}
});

test("features.peers present: the flat All chats list keeps a peer's rows, marked", async () => {
	/*
	 * The flat list has no peer headings, so the mark is the ONLY annotation there
	 * (`mesh-ui.md` §2.3). A partition that also filtered this list would make a
	 * peer's conversation unreachable from `All chats` entirely.
	 */
	globalThis.__features = { ...BASE_FEATURES, peers: 1 };
	peerAnswer = { peers: [peer(LAPTOP, "devon-laptop")], degraded: [] };
	const harness = await mount([
		...ROSTER,
		plain("d4e5f6a7b8c9", "Tune the relay keepalive", {
			locality: "remote",
			owner_device: LAPTOP,
			owner_device_name: "devon-laptop",
			reachable: true,
		}),
	]);
	try {
		const all = harness.container.querySelector(
			'[data-tour-tag="chat-all-chats"]',
		);
		assert.ok(all, "the All chats control is not rendered");
		await act(async () => {
			all.dispatchEvent(new DOM.window.MouseEvent("click", { bubbles: true }));
		});
		const remoteRow = [
			...harness.container.querySelectorAll(
				'[data-tour-tag="chat-session-row"]',
			),
		].find((row) => row.textContent.includes("Tune the relay keepalive"));
		assert.ok(remoteRow, "the peer's row is missing from the flat list");
		assert.ok(
			remoteRow.querySelector("[data-remote-mark]"),
			"the flat list's peer row carries no mark",
		);
	} finally {
		await harness.unmount();
	}
});

test("features.peers present: a local row's markup is the same as with the gate off", async () => {
	/*
	 * The geometry promise for local rows (`mesh-ui.md` §2.1): the mark is
	 * rendered on remote rows ONLY, never reserved. So a local row's own subtree
	 * must be byte-identical with and without the feature.
	 */
	const rowHtml = (container) =>
		[...container.querySelectorAll('[data-tour-tag="chat-session-row"]')]
			.filter((row) =>
				row.textContent.includes("Reconcile the supplier ledger"),
			)
			.map((row) => row.outerHTML)[0];
	globalThis.__features = { ...BASE_FEATURES };
	const off = await mount(ROSTER);
	const offRow = rowHtml(off.container);
	await off.unmount();
	globalThis.__features = { ...BASE_FEATURES, peers: 1 };
	peerAnswer = { peers: [peer(LAPTOP, "devon-laptop")], degraded: [] };
	const on = await mount(
		ROSTER.map((row) => ({ ...row, locality: "local", reachable: true })),
	);
	const onRow = rowHtml(on.container);
	await on.unmount();
	assert.ok(offRow, "the local row was not rendered");
	assert.equal(onRow, offRow, "a local row changed when the mesh is on");
});

/* ------------------------------------------------------------ the partition */

test("the partition is the identity with the gate off", () => {
	const rows = [
		plain("a", "one"),
		plain("b", "two", { locality: "remote", owner_device: LAPTOP }),
	];
	assert.equal(peers.localRows(rows, false), rows, "not the same array");
	assert.deepEqual(peers.peerSections(rows, [peer(LAPTOP, "x")], false), []);
});

test("sections are keyed by device id, so two devices with one name are two sections", () => {
	const twin = "d_1111cccccccccccccccccccccccccccc";
	const sections = peers.peerSections(
		[
			plain("a", "one", { locality: "remote", owner_device: LAPTOP }),
			plain("b", "two", { locality: "remote", owner_device: twin }),
		],
		[peer(LAPTOP, "macbook"), peer(twin, "macbook")],
		true,
	);
	assert.deepEqual(
		sections.map((section) => [section.deviceId, section.rows.length]),
		[
			[LAPTOP, 1],
			[twin, 1],
		],
	);
});

test("a row of a device the catalogue does not list still gets a section (nothing is hidden)", () => {
	const sections = peers.peerSections(
		[
			plain("a", "one", {
				locality: "remote",
				owner_device: STUDIO,
				owner_device_name: "",
				reachable: false,
			}),
		],
		[],
		true,
	);
	assert.equal(sections.length, 1);
	assert.equal(sections[0].heading, "⇄ device …bbbbbb · unreachable");
});

test("the mark and the heading read ONE reachability predicate (S4 agreement)", () => {
	const byId = new Map([
		[LAPTOP, peer(LAPTOP, "devon-laptop", { reachable: false })],
	]);
	// The row still claims reachable from an older list read; the fresher catalogue wins.
	const row = plain("a", "one", {
		locality: "remote",
		owner_device: LAPTOP,
		reachable: true,
	});
	assert.equal(peers.peerReachable(row, byId), false);
	const [section] = peers.peerSections([row], [...byId.values()], true);
	assert.equal(section.reachable, false);
});

test("the Peers row's trailing statement: rtt and count live, state and age when not", () => {
	const now = 1_789_400_240;
	assert.equal(
		peers.peerTrailing(peer(LAPTOP, "x", { session_count: 2 }), now),
		"24ms · 2 chats",
	);
	assert.equal(
		peers.peerTrailing(
			peer(LAPTOP, "x", { rtt_ms: null, session_count: 1 }),
			now,
		),
		"— · 1 chat",
	);
	assert.equal(
		peers.peerTrailing(peer(LAPTOP, "x", { reachable: false }), now),
		"unreachable · last seen 4m ago",
	);
});

/* ------------------------------------------------------------ the topology */

test("a device in two networks is ONE node with TWO edges", () => {
	const member = (device_id, name, over = {}) => ({
		device_id,
		name,
		role: "drive",
		capabilities: ["list", "view"],
		active: true,
		suspect: false,
		endpoints: [],
		last_seen_at: null,
		reachable: true,
		reason: "",
		...over,
	});
	const layout = layoutTopology({
		self_device_id: STUDIO,
		networks: [
			{
				network_id: "n_home",
				name: "home",
				epoch: 3,
				trust: "trusted",
				members: [
					member(LAPTOP, "devon-laptop"),
					member(STUDIO, "studio-mini"),
				],
			},
			{
				network_id: "n_work",
				name: "work",
				epoch: 7,
				trust: "trusted",
				members: [member(LAPTOP, "devon-laptop", { role: "admin" })],
			},
		],
	});
	assert.equal(layout.networks.length, 2);
	assert.deepEqual(
		layout.devices.map((node) => [node.label, node.memberships.length]),
		[
			["devon-laptop", 2],
			["studio-mini", 1],
		],
	);
	assert.equal(
		layout.edges.filter((edge) => edge.deviceId === LAPTOP).length,
		2,
		"the shared device does not have one edge per membership",
	);
	assert.equal(
		layout.devices.find((node) => node.id === STUDIO)?.state,
		"self",
	);
});

/* --------------------------------------------------------------- the wire */

test("the mesh ops reach the routes plan §3.1 names, and pre-mesh requests are unchanged", () => {
	const parse = (request) => {
		const parsed = desktopRequestSchema.safeParse(request);
		assert.ok(parsed.success, `${request.op} was refused by the schema`);
		return desktopEndpoint(parsed.data);
	};
	assert.equal(
		parse({ op: "sessions.list", limit: 10, include_archived: true }).path,
		"/v1/desktop/sessions?limit=10&include_archived=true",
		"a request without include_peers must be the pre-mesh one",
	);
	assert.equal(
		parse({ op: "sessions.list", limit: 10, include_peers: true }).path,
		"/v1/desktop/sessions?limit=10&include_peers=true",
	);
	assert.ok(
		parse({ op: "sessions.search", q: "x", include_peers: true }).path.includes(
			"include_peers=true",
		),
		"the search did not carry include_peers",
	);
	const createBody = (extra) =>
		parse({
			op: "sessions.create",
			requestId: "12345678-1234-1234-1234-123456789abc",
			cwd: "/tmp",
			...extra,
		}).body;
	assert.deepEqual(Object.keys(createBody({})), ["request_id", "cwd"]);
	assert.equal(createBody({ peer: LAPTOP }).peer, LAPTOP);
	assert.deepEqual(parse({ op: "peers.list" }), {
		path: "/v1/desktop/peers",
		method: "GET",
	});
	assert.deepEqual(parse({ op: "networks.list" }), {
		path: "/v1/desktop/networks",
		method: "GET",
	});
	assert.deepEqual(
		parse({
			op: "networks.invite",
			networkId: "n_4a1c",
			role: "drive",
			device: LAPTOP,
		}),
		{
			path: "/v1/desktop/networks/n_4a1c/invite",
			method: "POST",
			body: { role: "drive", device: LAPTOP },
		},
	);
	assert.deepEqual(
		parse({
			op: "networks.member.remove",
			networkId: "n_4a1c",
			deviceId: LAPTOP,
			confirm: "home",
		}),
		{
			path: `/v1/desktop/networks/n_4a1c/members/${LAPTOP}`,
			method: "DELETE",
			body: { confirm: "home" },
		},
	);
	const transfer = parse({
		op: "sessions.transfer",
		sessionId: "a1b2c3d4e5f6",
		requestId: "12345678-1234-1234-1234-123456789abc",
		to: LAPTOP,
	});
	assert.equal(transfer.path, "/v1/desktop/sessions/a1b2c3d4e5f6/transfer");
	assert.equal(transfer.body.to, LAPTOP);
	// Ids are path segments: nothing that could walk out of one is accepted.
	for (const bad of ["../etc", "n/x", "a%2F"]) {
		assert.equal(
			desktopRequestSchema.safeParse({
				op: "networks.member.remove",
				networkId: bad,
				deviceId: LAPTOP,
				confirm: "x",
			}).success,
			false,
			`${bad} was accepted as a network id`,
		);
	}
});
