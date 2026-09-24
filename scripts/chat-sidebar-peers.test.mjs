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
	 * A MOVE, per case (M4): the case sets either the reply or the error the
	 * transport raises, so the two outcomes - refused, and unconfirmed - are driven
	 * through the STORE rather than painted by a story's `setState`.
	 */
	if (request.op === "sessions.transfer") {
		if (globalThis.__transferError) throw globalThis.__transferError;
		return (
			globalThis.__transferReply ?? {
				locality: "remote",
				owner_device: request.to,
				source_retired: true,
			}
		);
	}
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
			// The search's own partition, for the duplicate-hit case (QA round 1, Q1).
			' export { searchChats } from "./src/renderer/src/features/chat/chat-search";' +
			' export { desktopEndpoint, desktopRequestSchema, desktopRequestBoundS, desktopRequestDeadlineMs } from "./src/shared/desktop-contract";' +
			// The boundary the mesh answers are read through, and the error class the
			// store distinguishes a refusal from a deadline by (M3/M4).
			' export * as mesh from "./src/shared/mesh-shapes";' +
			' export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";' +
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
	searchChats,
	desktopEndpoint,
	desktopRequestSchema,
	desktopRequestBoundS,
	desktopRequestDeadlineMs,
	mesh,
	DesktopControlError,
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

/*
 * A catalogue row in the shape the CONTRACT froze (addendum 2, A: device_id, name,
 * reachable, unreachable_reason, last_seen_at, session_count, rtt_ms). It used to
 * carry `kind`/`lifecycle`/`role`/`size_class`/`expires_at` and `rtt_ms: 24` -
 * values no producer sends (addendum 3: nothing measures latency), which made an
 * assertion about the dash pass for the wrong reason.
 */
const peer = (device_id, name, over = {}) => ({
	device_id,
	name,
	reachable: true,
	rtt_ms: null,
	session_count: 0,
	last_seen_at: 1_789_400_000,
	unreachable_reason: "",
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
		// The at-most-once journal this round added (Q3): a case that starts a move
		// must not inherit another case's request id.
		transferRequestIds: {},
		// And the pane holds nothing to begin with: from this round a move of the
		// conversation the pane has OPEN is refused here rather than at the route
		// (Q4a), so a case that does not set this would test that refusal instead of
		// the move.
		activeSessionId: null,
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

/**
 * D1's failure mode, spelled as a scan: a latency clause (`24ms`, or the `—` the
 * old code fell back to when nothing measured one). Module scope because biome's
 * `useTopLevelRegex` asks a regex literal not to be rebuilt inside a function.
 */
const LATENCY_CLAIM = /(\d+ms|— ·)/;

test("features.peers present: remote rows carry the mark, local rows do not, and each peer gets a section", async () => {
	globalThis.__features = { ...BASE_FEATURES, peers: 1 };
	peerAnswer = {
		peers: [
			/*
			 * `session_count: 7` against ONE cached row on purpose (D1): the two
			 * sources disagree, so the count the row prints says which one it read.
			 */
			peer(LAPTOP, "devon-laptop", { session_count: 7 }),
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
		/*
		 * D5: `studio-mini` has no cached chats, so it has NO section - a section for
		 * a zero-row peer drew an expanded chevron over nothing, because `heading()`
		 * draws no badge for a count of 0. It is described by the `Peers` group below,
		 * which is the one list of devices.
		 */
		assert.deepEqual(sections, [LAPTOP], "only peers WITH chats get a section");
		assert.equal(
			doc.querySelector(`[data-peer-section="${STUDIO}"]`),
			null,
			"the quiet peer still has an empty section (D5)",
		);
		/*
		 * D2: the heading carries no glyph of its own any more - the motif is drawn by
		 * `RemoteGlyph` in both the heading and the rows - so its text is the name and
		 * the state, and the drawing is asserted through `data-remote-glyph`.
		 */
		const laptop = doc.querySelector(`[data-peer-section="${LAPTOP}"]`);
		assert.ok(laptop, "the peer with chats has no section");
		assert.ok(
			laptop.textContent.includes("devon-laptop"),
			"the section does not name its device",
		);
		assert.equal(
			laptop
				.querySelector("[data-chat-section] [data-remote-glyph]")
				?.getAttribute("data-remote-glyph"),
			"reachable",
			"the heading does not carry the rows' own drawing (D2)",
		);
		assert.equal(
			laptop
				.querySelector('[data-tour-tag="chat-session-row"] [data-remote-glyph]')
				?.getAttribute("data-remote-glyph"),
			"reachable",
			"the row's mark is not the paired arrows",
		);
		// The remote row is NOT also drawn in Active chats.
		const active = [...doc.querySelectorAll('[data-chat-section="active"]')];
		assert.equal(active.length, 1);
		assert.ok(laptop.textContent.includes("Tune the relay keepalive"));
		const group = doc.querySelector("[data-peers-group]");
		assert.ok(group, "the Peers group is not mounted");
		assert.ok(
			group.textContent.includes("unreachable ·"),
			"the unreachable peer's row does not lead with its state",
		);
		/*
		 * D6: an unreachable device is drawn as a DIFFERENT SHAPE, not only dimmer
		 * ink - the flat list has no heading, so a 1.38:1 lightness step was the only
		 * thing telling a live peer from a cached one, i.e. colour alone (§2.5).
		 */
		const studioRow = doc.querySelector(`[data-peer-row="${STUDIO}"]`);
		assert.equal(
			studioRow
				?.querySelector("[data-remote-glyph]")
				?.getAttribute("data-remote-glyph"),
			"unreachable",
			"an unreachable device is drawn with the same shape as a live one (D6)",
		);
		/*
		 * D1: ONE SOURCE for the chat count - the rows the sidebar grouped, which is
		 * what the peer's own heading counts. The catalogue claims 7 chats and the
		 * sidebar grouped 1 row, so `1 chat` here proves the row read the grouping and
		 * not `peer.session_count`; before the fix this frame said `24ms · 7 chats`
		 * beside a heading that said 1.
		 */
		const laptopRow = doc.querySelector(`[data-peer-row="${LAPTOP}"]`);
		assert.ok(
			laptopRow?.textContent.includes("1 chat"),
			`the Peers row's count is not the grouped number: "${laptopRow?.textContent}"`,
		);
		assert.ok(
			!group.textContent.includes("7 chats"),
			"the Peers row still prints the catalogue's own count (D1)",
		);
		assert.ok(
			laptop.querySelector("[data-chat-section]")?.textContent?.includes("1"),
			"the section's heading does not carry the grouped count",
		);
		/* D1: no latency clause anywhere - nothing measures it yet. */
		assert.ok(
			!LATENCY_CLAIM.test(group.textContent),
			"the Peers group still prints a latency it cannot measure (D1)",
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
	// No glyph in the text: `RemoteGlyph` draws it, so heading and rows cannot
	// drift into two drawings of one motif (D2).
	assert.equal(sections[0].heading, "device …bbbbbb · unreachable");
	assert.equal(sections[0].suffix, " · unreachable");
});

test("a peer with no cached chats gets no section (D5)", () => {
	const sections = peers.peerSections(
		[plain("a", "one", { locality: "remote", owner_device: LAPTOP })],
		[peer(LAPTOP, "devon-laptop"), peer(STUDIO, "studio-mini")],
		true,
	);
	assert.deepEqual(
		sections.map((section) => section.deviceId),
		[LAPTOP],
		"a quiet peer's section is an expanded chevron over nothing",
	);
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

test("the Peers row's trailing statement: the grouped count when live, state and age when not", () => {
	const now = 1_789_400_240;
	/*
	 * D1: the count is an ARGUMENT, because the sidebar passes the number its own
	 * grouping produced - the same number the peer's section heading shows. The
	 * catalogue's `session_count` is deliberately NOT read here: two counts of one
	 * fact, read from two sources (peer.session_count in the row, group.rows.length
	 * in the heading), disagreed on one screen.
	 */
	assert.equal(peers.peerTrailing(peer(LAPTOP, "x"), 2, now), "2 chats");
	assert.equal(peers.peerTrailing(peer(LAPTOP, "x"), 1, now), "1 chat");
	assert.equal(peers.peerTrailing(peer(LAPTOP, "x"), 0, now), "0 chats");
	/* D1: no latency clause, whatever the catalogue claims to have measured. */
	assert.equal(
		peers.peerTrailing(peer(LAPTOP, "x", { rtt_ms: 24 }), 2, now),
		"2 chats",
	);
	/* D4: the unreachable trailing is SHORT, because it competes with the name. */
	assert.equal(
		peers.peerTrailing(peer(LAPTOP, "x", { reachable: false }), 0, now),
		"unreachable · 4m",
	);
	assert.equal(
		peers.peerTrailing(
			peer(LAPTOP, "x", { reachable: false, last_seen_at: null }),
			0,
			now,
		),
		"unreachable · never seen",
	);
	/* The full sentence is the row's `title`, so nothing is lost to the shortening. */
	assert.equal(
		peers.peerTrailingTitle(peer(LAPTOP, "x", { reachable: false }), 0, now),
		"unreachable · last seen 4m ago",
	);
	/*
	 * D19: and no dash HERE either. Round 1 moved the em dash off the row and into
	 * this sentence on the argument that a hover is where a measurement is read in
	 * context - but there is no measurement and there will not be one, so every hover
	 * on every peer, forever, advertised a feature the product does not have. The
	 * clause returns with the producer; until then the number in the field reaches no
	 * surface at all.
	 */
	assert.equal(
		peers.peerTrailingTitle(peer(LAPTOP, "x"), 2, now),
		"2 chats on x",
	);
	assert.equal(
		peers.peerTrailingTitle(peer(LAPTOP, "x", { rtt_ms: 24 }), 2, now),
		"2 chats on x",
		"a number in a field nothing produces does not reach the title",
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

/* ---------------------------------------- the boundary (round-1 review, M1-M3) */

/*
 * The shapes below are the ones the producers ACTUALLY emit, taken from the
 * round-1 review: `relay.peer_status` answers one entry per (network, member), and
 * a row can arrive with a field missing. Every case here is a reproduction the
 * reviewer ran against the renderer, kept as a regression.
 */

test("M1: the catalogue dedupes by device id, so a device in two networks is ONE row", () => {
	const twice = [
		peer(LAPTOP, "devon-laptop", { session_count: 2 }),
		peer(LAPTOP, "devon-laptop", { session_count: 2 }),
	];
	const { peers: rows } = mesh.peerList({ peers: twice });
	assert.equal(rows.length, 1, "one device, one row");
	// Nothing is merged INTO the row: the duplicate is the join's artefact, not a
	// second fact, so a count is not doubled.
	assert.equal(rows[0].session_count, 2);
	assert.equal(
		mesh.peerList({ peers: [LAPTOP, STUDIO].map((id) => peer(id, id)) }).peers
			.length,
		2,
		"two devices are two rows",
	);
});

test("M3: a sparse peer row degrades or is dropped, and NEVER throws", () => {
	const { peers: rows } = mesh.peerList({
		peers: [
			// No identity: it could not be a section key, so it is dropped.
			{ name: "ghost", reachable: true },
			// No reachability answer: every reader of that field makes a claim with
			// it, and neither value is "I do not know", so it is dropped too.
			{ device_id: LAPTOP, name: "devon-laptop" },
			// Everything else missing: kept, with the empty answer for each type.
			{ device_id: STUDIO, reachable: false },
			// Wrong types, not absences: the same rule applies.
			{
				device_id: "d_cccccccccccccccccccccccccccccccc",
				name: 7,
				reachable: true,
				session_count: -3,
				rtt_ms: "fast",
			},
		],
	});
	assert.deepEqual(
		rows.map((row) => row.device_id),
		[STUDIO, "d_cccccccccccccccccccccccccccccccc"],
		"a row with no id, or no reachability answer, is not drawable",
	);
	assert.equal(rows[0].name, "", "a missing name is the empty string");
	assert.equal(rows[0].unreachable_reason, null);
	assert.equal(rows[0].last_seen_at, null);
	assert.equal(rows[0].session_count, 0);
	// The label falls back to the id's tail rather than rendering `undefined`.
	assert.equal(
		peers.ownerLabel({ owner_device: STUDIO }, new Map()),
		"device …bbbbbb",
	);
	assert.equal(rows[1].session_count, 0, "a negative count is not a count");
	assert.equal(rows[1].rtt_ms, null, "a string latency is not a measurement");
});

test("M3: a sparse TOPOLOGY neither normalises nor throws - layout survives raw input", () => {
	// The reviewer's reproduction, verbatim: these members have no `name` and no
	// `reason`, and `layoutTopology` used to throw on `.trim()` while the graph
	// rendered, taking the whole window with it.
	const raw = {
		self_device_id: LAPTOP,
		networks: [
			{
				network_id: "n_1",
				name: "home",
				members: [
					{ device_id: LAPTOP },
					{ name: "nameless" },
					{ device_id: STUDIO, reason: 7 },
				],
			},
		],
	};
	const layout = layoutTopology(raw);
	assert.deepEqual(
		layout.devices.map((node) => node.id),
		[LAPTOP, STUDIO],
		"a member with no id is not a node (the two that are left sort by label)",
	);
	const normalised = mesh.networkTopology(raw);
	assert.equal(normalised.networks.length, 1);
	assert.equal(normalised.networks[0].members.length, 2);
	assert.equal(normalised.networks[0].members[1].reason, "");
	assert.deepEqual(normalised.networks[0].members[1].capabilities, []);
	assert.equal(
		normalised.networks[0].members[1].active,
		true,
		"a member is a member",
	);
	// And the normalised answer lays out the same way.
	assert.deepEqual(
		layoutTopology(normalised).devices.map((node) => node.id),
		[LAPTOP, STUDIO],
	);
});

test("M2: a remote row with no owner opens NO section, and is not hidden either", () => {
	const orphans = [
		plain("a", "one", { locality: "remote", owner_device: null }),
		plain("b", "two", { locality: "remote", owner_device: "" }),
	];
	assert.deepEqual(
		peers.peerSections(orphans, [peer(LAPTOP, "devon-laptop")], true),
		[],
		"two devices' rows collapsed into one `device …` section",
	);
	// The row is still a remote row (the mark is drawn) - it is only unfiled.
	assert.ok(orphans.every((row) => peers.isRemoteRow(row)));
	assert.ok(orphans.every((row) => !peers.isFileableRemoteRow(row)));
	assert.equal(
		peers.isFileableRemoteRow(
			plain("c", "three", { locality: "remote", owner_device: LAPTOP }),
		),
		true,
	);
});

test("M4: the move's budget follows its own wait, and no other op's does", () => {
	/*
	 * THE ROUTE'S OWN BOUND, BY SHAPE, from ONE helper (backend PR #1540 and its
	 * review). A move that keeps nothing behind is `wait_s + 30`; one that KEEPS a
	 * copy is `wait_s + 300`, which is 255 s more - the gap a client that ignored
	 * `keep` would fall through, still reporting an unconfirmed move 4 minutes early.
	 */
	assert.equal(
		desktopRequestBoundS({ op: "sessions.transfer", wait_s: 30, to: "d_abc" }),
		60,
	);
	assert.equal(
		desktopRequestBoundS({
			op: "sessions.transfer",
			wait_s: 30,
			to: "d_abc",
			keep: true,
		}),
		330,
	);
	// The schema's ceiling is 300 s, and a request past it is clamped rather than
	// believed.
	assert.equal(
		desktopRequestBoundS({
			op: "sessions.transfer",
			wait_s: 9_000,
			to: "d_abc",
		}),
		330,
	);
	/*
	 * A RECALL IS NOT A MOVE: `to: "local"` is bounded by the DESTINATION's own
	 * retire-and-record deadline plus the copy, which no `wait_s` describes - so it
	 * takes a standing ceiling rather than a derived number, and its outcome is always
	 * the unconfirmed one.
	 */
	assert.equal(
		desktopRequestBoundS({ op: "sessions.transfer", wait_s: 30, to: "local" }),
		180,
	);
	assert.equal(desktopRequestBoundS({ op: "sessions.transfer" }), null);
	assert.equal(desktopRequestBoundS({ op: "sessions.list" }), null);
	/*
	 * 30 s of waiting plus the route's own margin, which must exceed the wait it
	 * asked for - a budget BELOW `wait_s` is the defect this test exists for. The
	 * margin is 45 s, not the 15 s round 1 chose: the route's overhead ABOVE
	 * `wait_s` was measured at ~30 s against a real peer (`wait_s: 0` answered after
	 * 30.5 s, `wait_s: 30` after 60.3 s), so a 15 s margin made THIS layer the one
	 * that gave up first and the route's precise answer never reached the reader
	 * (QA round 1, Q4a).
	 */
	assert.equal(desktopRequestDeadlineMs("sessions.transfer", 60), 105_000);
	assert.equal(desktopRequestDeadlineMs("sessions.transfer", 330), 375_000);
	assert.equal(desktopRequestDeadlineMs("sessions.transfer", 180), 225_000);
	// An op without a bound keeps the standing budgets.
	assert.equal(desktopRequestDeadlineMs("sessions.transfer"), 20_000);
	assert.equal(desktopRequestDeadlineMs("sessions.list"), 20_000);
	assert.equal(desktopRequestDeadlineMs("usage.get"), 90_000);
	/*
	 * Q4b: a create ON A PEER is not a control call. The route's own budget is
	 * `create_on_peer`'s 120 s and it measured 15.9 s and 22.1 s on loopback, so the
	 * generic 20 s made this app the layer that gave up - and the sidebar then filed
	 * the timeout as "the peer refused". A LOCAL create keeps the standing budget:
	 * there is no second device in it.
	 */
	assert.equal(
		desktopRequestBoundS({ op: "sessions.create", peer: "d_abc" }),
		120,
	);
	assert.equal(desktopRequestBoundS({ op: "sessions.create" }), null);
	assert.equal(
		desktopRequestBoundS({ op: "sessions.create", peer: null }),
		null,
	);
	assert.equal(desktopRequestDeadlineMs("sessions.create", 120), 165_000);
	assert.equal(desktopRequestDeadlineMs("sessions.create", null), 20_000);
});

test("M4: a timed-out move says the outcome is UNKNOWN, and a refusal says nothing changed", async () => {
	const row = plain("a", "Migrate the deploy script", {
		locality: "remote",
		owner_device: LAPTOP,
		owner_device_name: "devon-laptop",
		reachable: true,
	});
	// The notice renders only with the gate on, which is also what makes the move
	// reachable in the product.
	globalThis.__features = { ...BASE_FEATURES, peers: 1, session_transfer: 1 };
	const harness = await mount([row]);
	try {
		// A deadline carries NO status: the request never produced one.
		globalThis.__transferError = new DesktopControlError(
			null,
			"the renderer gave up",
		);
		let settled;
		await act(async () => {
			settled = await store
				.getState()
				.transferSession("a", STUDIO, "Migrate the deploy script");
		});
		assert.equal(settled, false, "a timed-out move is not a success");
		const timedOut = harness.container.querySelector(
			'[data-mesh-notice="move-unconfirmed"]',
		);
		assert.ok(timedOut, "the unconfirmed move has no notice of its own");
		assert.match(timedOut.textContent, /may already be there/);
		/*
		 * THE ASSERTION THIS TEST EXISTS FOR: the old copy appended "Nothing
		 * changed." to every failure, and a deadline cannot establish that - the
		 * move may have completed. An invitation to repeat the move is exactly what
		 * a move must not say.
		 */
		assert.doesNotMatch(
			timedOut.textContent,
			/Nothing changed/,
			"a timed-out move claims nothing changed",
		);
		/*
		 * AND IT NAMES THE DEVICE RATHER THAN "the other device" (design round 2,
		 * D16): the store knows the target's id and the sidebar knows its label, and
		 * "the other device" is ambiguous the moment a user has two peers.
		 */
		assert.match(timedOut.textContent, /check that device first/);

		// A refusal IS an answer: the route looked and said no.
		globalThis.__transferError = new DesktopControlError(
			409,
			"a turn is still running there; stop it or wait for it",
		);
		await act(async () => {
			settled = await store
				.getState()
				.transferSession("a", STUDIO, "Migrate the deploy script");
		});
		assert.equal(settled, false);
		const refused = harness.container.querySelector(
			'[data-mesh-notice="move-failed"]',
		);
		assert.ok(refused, "a refused move lost its own notice");
		assert.match(refused.textContent, /a turn is still running there/);
		assert.match(
			refused.textContent,
			/stop it or wait for it\. Nothing changed\./,
			"S7's approved copy, with the route's own sentence in front of it",
		);
		assert.doesNotMatch(refused.textContent, /may have happened/);
	} finally {
		globalThis.__transferError = undefined;
		globalThis.__features = { ...BASE_FEATURES };
		await harness.unmount();
	}
});

test("Q3: one move per conversation at a time - a second press reaches no route", async () => {
	globalThis.__features = { ...BASE_FEATURES, peers: 1, session_transfer: 1 };
	const row = plain("a", "Migrate the deploy script", {
		locality: "remote",
		owner_device: LAPTOP,
		owner_device_name: "devon-laptop",
		reachable: true,
	});
	const harness = await mount([row]);
	try {
		/*
		 * IN FLIGHT, as the first press leaves it. Every press used to mint a FRESH
		 * `request_id`, which is the key the route's at-most-once guard uses, so a
		 * second press on a conversation already moving was not recognisable as the
		 * same move: the peer's relay logged two pulls 3 ms apart for one gesture, and
		 * one menu entry (the conversation being moved) stayed enabled while it was
		 * running (QA round 1, Q3).
		 */
		store.setState({ transfers: { a: STUDIO } });
		requests = [];
		let settled;
		await act(async () => {
			settled = await store
				.getState()
				.transferSession("a", STUDIO, "Migrate the deploy script");
		});
		assert.equal(settled, false, "a second move was started");
		assert.equal(
			requests.filter((request) => request.op === "sessions.transfer").length,
			0,
			"a second press reached the route",
		);
		assert.equal(
			store.getState().transfers.a,
			STUDIO,
			"the guard cancelled the move already running",
		);
	} finally {
		globalThis.__features = { ...BASE_FEATURES };
		await harness.unmount();
	}
});

test("Q4a: moving the conversation this pane has OPEN says why, and sends nothing", async () => {
	globalThis.__features = { ...BASE_FEATURES, peers: 1, session_transfer: 1 };
	const row = plain("a", "Migrate the deploy script", {
		locality: "remote",
		owner_device: LAPTOP,
		owner_device_name: "devon-laptop",
		reachable: true,
	});
	const harness = await mount([row]);
	try {
		/*
		 * THE BLOCKER IS THE DESKTOP'S OWN VIEW. The source runtime refuses a move
		 * while ANY other viewer is attached - the app's own pane counts - and that
		 * refusal reaches the peer's log rather than the caller, so the app waited out
		 * its deadline and then told the user the outcome was unconfirmed. Measured:
		 * nine futile attempts with the conversation on screen, and the same move in
		 * 2.1 s once the pane was on another chat (QA round 1, Q4a).
		 */
		store.setState({ activeSessionId: "a" });
		requests = [];
		let settled;
		await act(async () => {
			settled = await store
				.getState()
				.transferSession("a", STUDIO, "Migrate the deploy script");
		});
		assert.equal(settled, false);
		assert.equal(
			requests.filter((request) => request.op === "sessions.transfer").length,
			0,
			"a move the backend cannot accept was still sent",
		);
		const blocked = harness.container.querySelector(
			'[data-mesh-notice="move-blocked"]',
		);
		assert.ok(blocked, "nothing told the user why the move did not start");
		assert.match(blocked.textContent, /open here/);
		assert.match(blocked.textContent, /Switch to another chat/);
		// Nothing was sent, so "Nothing changed" is a true claim here - unlike a
		// deadline, which may have applied the move (round-1 review, M4).
		assert.match(blocked.textContent, /Nothing changed/);
	} finally {
		globalThis.__features = { ...BASE_FEATURES };
		await harness.unmount();
	}
});

test("Q6: a phase's progress is a RATIO, and the receipt carries the move's own id", () => {
	const receipt = mesh.transferReceipt({
		locality: "remote",
		owner_device: LAPTOP,
		source_retired: true,
		phases: [{ phase: "copy", peer: LAPTOP, progress: 0.75 }],
		new_session_id: "b2c3d4e5f6a7",
		mode: "move",
	});
	assert.ok(receipt);
	// `count()` floored this to 0, so a bar driven by it sat empty through the move.
	assert.equal(receipt.phases[0].progress, 0.75);
	assert.equal(receipt.new_session_id, "b2c3d4e5f6a7");
	assert.equal(receipt.mode, "move");
	// Out of range is clamped rather than painted past the end of its track.
	assert.equal(
		mesh.transferReceipt({
			locality: "local",
			phases: [{ phase: "copy", progress: 9 }],
		}).phases[0].progress,
		1,
	);
	assert.equal(
		mesh.transferReceipt({
			locality: "local",
			phases: [{ phase: "copy", progress: "half" }],
		}).phases[0].progress,
		0,
	);
	// A receipt without the new id does not invent one.
	assert.equal(
		mesh.transferReceipt({ locality: "local", owner_device: "" })
			.new_session_id,
		undefined,
	);
});

test("Q1: two hits for ONE conversation synthesize ONE row", () => {
	/*
	 * A DEVICE IN TWO NETWORKS DOUBLES EVERY ROW IT OWNS. The producer answers one
	 * row per (network, member), and the renderer's list and count survived it -
	 * they key by session id - while the SEARCH did not: `seen` held only the rows the
	 * client was already showing, so two hits for one conversation both synthesized
	 * and the peer's section listed the same chat twice (QA round 1, Q1). The
	 * backend's own dedupe is #1348's; this is the half that belongs here, and it
	 * holds for any producer that repeats a row.
	 */
	const hit = {
		id: "c7c74407768f",
		name: "qa498-remote-one",
		mtime: 1_789_400_000,
		rank: 0,
		body_match: false,
		archived: false,
		pinned: false,
		preview: "",
		locality: "remote",
		owner_device: LAPTOP,
		owner_device_name: "devon-laptop",
		reachable: true,
	};
	const once = searchChats([], "qa498", [hit]);
	const twice = searchChats([], "qa498", [hit, { ...hit }]);
	assert.equal(once.rows.length, 1, "one hit drew nothing");
	assert.equal(
		twice.rows.length,
		once.rows.length,
		"the second hit drew a second row",
	);
	assert.equal(twice.synthesized.size, 1);
	// And the row it drew is the remote one it claims to be, not a local ghost.
	const drawn = twice.rows[0];
	assert.equal(drawn.session_id, "c7c74407768f");
	assert.equal(drawn.owner_device, LAPTOP);
});

test("Q3: a retried move REPLAYS its request id, and a confirmed one spends it", async () => {
	globalThis.__features = { ...BASE_FEATURES, peers: 1, session_transfer: 1 };
	const row = plain("a", "Migrate the deploy script", {
		locality: "remote",
		owner_device: LAPTOP,
		owner_device_name: "devon-laptop",
		reachable: true,
	});
	const harness = await mount([row]);
	try {
		/*
		 * THE ROUTE JOURNALS THE ID (backend PR #1540): repeating one replays the
		 * recorded outcome instead of starting a second move. A fresh uuid per press
		 * is what let one gesture reach the peer's relay twice 3 ms apart, so a retry
		 * after a failure must carry the SAME id.
		 */
		requests = [];
		globalThis.__transferError = new DesktopControlError(
			null,
			"the app gave up",
		);
		await act(async () => {
			await store
				.getState()
				.transferSession("a", STUDIO, "Migrate the deploy script");
		});
		await act(async () => {
			await store
				.getState()
				.transferSession("a", STUDIO, "Migrate the deploy script");
		});
		const ids = requests
			.filter((request) => request.op === "sessions.transfer")
			.map((request) => request.requestId);
		assert.equal(ids.length, 2, "the retry did not reach the route");
		assert.equal(ids[0], ids[1], "the retry minted a second request id");
		// A move to a DIFFERENT device is a different move, and gets its own id.
		await act(async () => {
			await store
				.getState()
				.transferSession("a", LAPTOP, "Migrate the deploy script");
		});
		const toLaptop = requests.filter(
			(request) => request.op === "sessions.transfer" && request.to === LAPTOP,
		);
		assert.notEqual(
			toLaptop.at(-1).requestId,
			ids[0],
			"a different target reused the id",
		);
		// And a CONFIRMED move spends the id: the next move of that conversation is new.
		globalThis.__transferError = undefined;
		await act(async () => {
			await store
				.getState()
				.transferSession("a", STUDIO, "Migrate the deploy script");
		});
		requests = [];
		await act(async () => {
			await store
				.getState()
				.transferSession("a", STUDIO, "Migrate the deploy script");
		});
		const afterSuccess = requests.find(
			(request) => request.op === "sessions.transfer",
		);
		assert.ok(afterSuccess, "the move after a success did not reach the route");
		assert.notEqual(
			afterSuccess.requestId,
			ids[0],
			"a confirmed move replayed its id on the next, different move",
		);
	} finally {
		globalThis.__transferError = undefined;
		globalThis.__features = { ...BASE_FEATURES };
		await harness.unmount();
	}
});

test("Q10: the peer name cell carries its own full value at the clamp", async () => {
	globalThis.__features = { ...BASE_FEATURES, peers: 1, session_transfer: 1 };
	peerAnswer = {
		peers: [peer(LAPTOP, "damians-mac-studio-in-the-back-office-rack-2")],
		degraded: [],
	};
	/*
	 * The `Peers` group is collapsed by default - zero pins renders nothing, and its
	 * rows mount only when it is open - so the case opens it the way the app does,
	 * through the same disclosure store the framework persists.
	 */
	localStorage.setItem(
		"chat-sidebar-disclosures",
		JSON.stringify({ previous: true, peers: true }),
	);
	const harness = await mount([]);
	try {
		const name = harness.container.querySelector("[data-peer-row-name]");
		assert.ok(name, "no peer row");
		// The CELL is what truncates, so the cell is what must carry the value: the
		// trailing's title and the sr-only text are elsewhere on the row (QA round 1,
		// Q10).
		assert.equal(
			name.getAttribute("title"),
			"damians-mac-studio-in-the-back-office-rack-2",
		);
	} finally {
		localStorage.removeItem("chat-sidebar-disclosures");
		globalThis.__features = { ...BASE_FEATURES };
		await harness.unmount();
	}
});
