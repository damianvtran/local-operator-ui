import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/#/chat",
});
for (const [key, value] of Object.entries({
	window: dom.window,
	document: dom.window.document,
	localStorage: dom.window.localStorage,
	IS_REACT_ACT_ENVIRONMENT: true,
})) {
	Object.defineProperty(globalThis, key, { value, configurable: true });
}
after(() => dom.window.close());
const require = createRequire(import.meta.url);
const { createElement, act, startTransition } = require("react");
const { createRoot } = require("react-dom/client");

// Use the same store actions and navigation rule as the renderer. Only the
// transport and the route's React subscription are replaced by fixture inputs.
const bundle = await build({
	stdin: {
		contents: `
			export {useWorkspaceTabs} from './src/renderer/src/features/chat/components/use-workspace-tabs';
			export {openConversation} from './src/renderer/src/features/chat/open-conversation';
			export {useCanonicalSessionsStore} from './src/renderer/src/shared/store/canonical-sessions-store';
			export {useConversationInputStore} from './src/renderer/src/shared/store/conversation-input-store';
			export {useUiPreferencesStore} from './src/renderer/src/shared/store/ui-preferences-store';
			export {WORKSPACE_INACTIVE_MS} from './src/renderer/src/features/chat/workspace-tab-cleanup';
			export {desktopEndpoint, desktopRequestSchema} from './src/shared/desktop-contract';
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	tsconfig: "tsconfig.app.json",
	define: { "import.meta.env": "{}" },
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	require,
	module,
	module.exports,
);
const {
	useWorkspaceTabs,
	openConversation,
	useCanonicalSessionsStore: canonical,
	useConversationInputStore: composer,
	useUiPreferencesStore: preferences,
	WORKSPACE_INACTIVE_MS,
	desktopEndpoint,
	desktopRequestSchema,
} = module.exports;
const A = "000000aaaaaa";
const B = "000000bbbbbb";
const C = "000000cccccc";
const navigate = (path) => {
	// replaceState also makes the URL visible inside the same action and emits no
	// browser event on its own, like a same-document router write.
	dom.window.history.replaceState({}, "", `#${path}`);
};
let current;
/*
 * `realDraft` swaps the no-op draft start for the page's own (`stage(undefined,
 * true)` in chat-page.tsx: stage a fresh draft, then route to /chat), for the
 * tests that assert the no-survivor fallback lands on a real draft.
 */
const pageStartDraft = () => {
	const key = canonical.getState().stageDraft(undefined, true);
	navigate("/chat");
	return key;
};
function Fixture({ feedAvailable, realDraft }) {
	current = useWorkspaceTabs(
		navigate,
		realDraft ? pageStartDraft : () => {},
		feedAvailable,
	);
	return createElement(
		"output",
		{},
		current.tabs.map((tab) => tab.target.id).join(","),
	);
}
const ids = () => current.tabs.map((tab) => tab.target.id);
const find = (id) => current.tabs.find((tab) => tab.target.id === id);
const tabSnapshot = () => {
	const key = preferences.persist.getOptions().name;
	const saved = JSON.parse(dom.window.localStorage.getItem(key)).state
		.workspaceTabs;
	assert.deepEqual(saved, preferences.getState().workspaceTabs);
	return {
		rendered: dom.window.document
			.querySelector("output")
			.textContent.split(","),
		saved: saved.map(({ id }) => id),
	};
};

async function mount(
	t,
	{
		feedAvailable = false,
		ids: open = [A, B],
		rows = [],
		drafts = {},
		input = {},
		pins = [],
		realDraft = false,
	} = {},
) {
	canonical.setState({
		sessions: rows,
		forgotten: {},
		drafts,
		statusUnavailable: [],
		placementFacts: {},
	});
	canonical.getState().setActiveSession(A);
	composer.setState({ inputByConversation: input });
	preferences.setState({
		workspaceTabs: open.map((id) => ({ id, pinned: pins.includes(id) })),
		workspaceAutoClose: false,
	});
	navigate(`/chat/${A}`);
	const root = createRoot(dom.window.document.getElementById("root"));
	t.after(() => act(() => root.unmount()));
	await act(() =>
		root.render(createElement(Fixture, { feedAvailable, realDraft })),
	);
}

test("active close waits for its own candidate's positive snapshot", async (t) => {
	await mount(t);
	await act(() => current.close(find(A)));
	assert.equal(dom.window.location.hash, `#/chat/${B}`);
	assert.equal(canonical.getState().validatingSessionId, B);
	assert.deepEqual(ids(), [A, B]);
	await act(() => canonical.getState().confirmSessionLive(A));
	assert.deepEqual(ids(), [A, B]);
	await act(() => canonical.getState().confirmSessionLive(B));
	assert.deepEqual(ids(), [B]);
});

test("a same-target native selection cancels the close, even before it writes the URL", async (t) => {
	await mount(t);
	await act(() => current.close(find(A)));
	await act(() => canonical.getState().setActiveSession(B));
	assert.equal(canonical.getState().validatingSessionId, null);
	assert.deepEqual(ids(), [A, B]);
	await act(() => canonical.getState().confirmSessionLive(B));
	assert.deepEqual(ids(), [A, B]);
});

test("late confirmation after a replacement switch, a route departure, or a 404 does not close the outgoing tab", async (t) => {
	await mount(t, { ids: [A, B, C] });
	await act(() => current.close(find(A)));
	await act(() => openConversation(navigate, C));
	await act(() => openConversation(navigate, B));
	await act(() => canonical.getState().confirmSessionLive(B));
	assert.deepEqual(ids(), [A, B, C]);

	await act(() => openConversation(navigate, A));
	await act(() => current.close(find(A)));
	await act(() => {
		navigate("/settings");
		dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
		navigate(`/chat/${B}`);
		canonical.getState().confirmSessionLive(B);
	});
	assert.deepEqual(ids(), [A, B, C]);

	await act(() => openConversation(navigate, A));
	await act(() => current.close(find(A)));
	await act(() => canonical.getState().confirmSessionMissing(B));
	assert.ok(canonical.getState().forgotten[B] !== undefined);
	assert.ok(find(A));
});

/*
 * A BULK CLOSE THAT INCLUDES THE ACTIVE TAB (review round 1, R1). The strip's
 * guard reads `closeMany`'s source; this drives it. The non-active tabs in the
 * set leave at once; the active one goes through the ordinary close, handed to a
 * neighbour among the SURVIVORS (never a tab closing in the same gesture), and
 * when nothing survives the workspace starts a fresh draft instead.
 */
test("closeMany hands an active tab in the set to a surviving neighbour", async (t) => {
	await mount(t, { ids: [A, B, C] });
	await act(() => current.closeMany([find(A).key, find(B).key]));
	// B (the active tab's own neighbour) is closing too, so the handoff skips it.
	assert.equal(dom.window.location.hash, `#/chat/${C}`);
	assert.deepEqual(ids(), [A, C]);
	await act(() => canonical.getState().confirmSessionLive(C));
	assert.deepEqual(ids(), [C]);
});

test("closeMany over every tab, active included, lands on a new draft", async (t) => {
	await mount(t, { ids: [A, B, C], realDraft: true });
	await act(() => current.closeMany(current.tabs.map((tab) => tab.key)));
	assert.equal(dom.window.location.hash, "#/chat");
	assert.deepEqual(
		current.tabs.map((tab) => tab.target.kind),
		["draft"],
	);
});

// Match the cold HTTP evidence at Core 9ab8d79dae: complete at baseline
// revision zero, no catalogue status stamps, and a null live jobs count.
const cold = {
	locality: "local",
	status: { code: "complete" },
	active: false,
	background_work: false,
	waiting_on: 0,
	jobs_running: null,
	pending: null,
};
const epoch = "42d4fbfe827e788f";
const armRevision =
	"218cad26a12c3cb947823b0c2f0708687c61485e9de20cad94a2935167b5b066";
const leaseRevision =
	"5f701f84bb191f7883a26fc5714fad2abd25172c08f7af668d5d9217871757ff";
const receipt = (revision = armRevision) => ({ version: 1, epoch, revision });
const wireRow = (id, workspace_rest = receipt()) => ({
	...cold,
	id,
	name: "fixture",
	mtime: 100,
	workspace_rest,
});
const result = (sessions) => ({ status: 200, body: { result: { sessions } } });
const rowsFor = (sessionIds) =>
	sessionIds.map((session_id) => ({ ...cold, session_id }));
const D = "000000dddddd";
const E = "000000eeeeee";
const F = "000000ffffff";
const G = "000000111111";
const pending = {
	pendingText: "unadopted text",
	currentInput: "",
	attachments: [],
	replies: [],
};

function installTransport(
	t,
	{
		answer = (requested) => result(requested.map((id) => wireRow(id))),
		startEpoch = epoch,
		consoleState = () => ({ available: true, surfaces: [] }),
	} = {},
) {
	const consoleListeners = new Set();
	const consoleCalls = [];
	const listeners = new Set();
	const states = new Set();
	const calls = [];
	const errors = [];
	let initialWatch = 0;
	dom.window.api = {
		console: {
			state: (id) => {
				consoleCalls.push(id);
				return consoleState(consoleCalls.length);
			},
			onStateChanged: (f) => {
				consoleListeners.add(f);
				return () => consoleListeners.delete(f);
			},
		},
		desktop: {
			request: (request) => {
				// The native bridge validates this schema and uses this endpoint
				// mapper. Exercise both, then substitute only the HTTP reply.
				try {
					const { path, method, body } = desktopEndpoint(
						desktopRequestSchema.parse(request),
					);
					const url = new URL(path, "http://127.0.0.1:9");
					assert.equal(method, "GET");
					assert.equal(body, undefined);
					assert.equal(url.pathname, "/v1/desktop/sessions");
					const requested = url.searchParams.getAll("workspace_rest_id");
					assert.deepEqual(
						[...url.searchParams],
						[
							["limit", "500"],
							...requested.map((id) => ["workspace_rest_id", id]),
						],
					);
					calls.push(requested);
					return answer(requested, calls.length);
				} catch (error) {
					errors.push(error);
					throw error;
				}
			},
			feed: {
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				watchState: (listener, includeWorkspaceEpoch) => {
					states.add(listener);
					initialWatch++;
					listener({
						connected: true,
						workspaceEpoch: includeWorkspaceEpoch ? startEpoch : undefined,
					});
					return () => states.delete(listener);
				},
			},
		},
	};
	t.after(() => {
		dom.window.api = undefined;
		assert.deepEqual(errors, []);
	});
	const frame = (value) => {
		for (const f of listeners) f({ epoch, ...value });
	};
	return {
		calls,
		consoleCalls,
		consoleChanged: () => {
			for (const f of consoleListeners) f();
		},
		watches: () => initialWatch,
		subscriptions: () => listeners.size + states.size,
		disconnect: () => {
			for (const f of states) f({ connected: false });
		},
		connect: (workspaceEpoch) => {
			for (const f of states) f({ connected: true, workspaceEpoch });
		},
		open: () =>
			frame({
				type: "open",
				seq: 1,
				payload: {
					attention_status: {
						[`session/${B}`]: { revision: 0, code: "complete" },
					},
				},
			}),
		gap: () => frame({ type: "gap", seq: 2 }),
		status: (code) =>
			frame({
				type: "session_status",
				seq: 2,
				session_id: B,
				payload: { code, revision: 1 },
			}),
	};
}
function withClock(t) {
	let now = 0;
	t.mock.method(performance, "now", () => now);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	return (ms) =>
		act(() => {
			now += ms;
			t.mock.timers.tick(ms);
		});
}

const enable = () =>
	act(() => preferences.getState().setWorkspaceAutoClose(true));

test("workspace IDs use the existing page limit without changing ordinary catalogue bytes", () => {
	const request = { op: "sessions.list", limit: 500 };
	assert.equal(
		desktopEndpoint(desktopRequestSchema.parse(request)).path,
		"/v1/desktop/sessions?limit=500",
	);
	const valid = Array.from({ length: 500 }, (_, index) =>
		index.toString(16).padStart(12, "0"),
	);
	const safe = (workspace_rest_id) =>
		desktopRequestSchema.safeParse({ ...request, workspace_rest_id }).success;
	assert.equal(safe(valid), true);
	assert.equal(safe([...valid, B]), false);
	assert.equal(safe(["not-a-session"]), false);
});

test("cold proof arms without new frames; one fresh batch drops only untouched local tabs at 30 min", async (t) => {
	const H = "000000222222";
	const I = "000000333333";
	const J = "000000444444";
	const K = "000000555555";
	const L = "000000666666";
	const M = "000000777777";
	const open = [A, B, C, D, E, F, G, H, I, J, K, L, M];
	const rows = rowsFor(open).filter((row) => row.session_id !== I);
	Object.assign(
		rows.find((row) => row.session_id === H),
		{ background_work: true },
	);
	Object.assign(
		rows.find((row) => row.session_id === J),
		{ locality: "remote" },
	);
	const feed = installTransport(t, {
		// I remains off-page: it can be requested but Core cannot decorate it.
		answer: (requested) =>
			result(requested.filter((id) => id !== I).map((id) => wireRow(id))),
	});
	await mount(t, {
		feedAvailable: true,
		ids: open,
		rows,
		pins: [K],
		input: { [C]: pending, [`send:${D}`]: pending },
		drafts: {
			[E]: { key: E },
			[`send:${F}`]: { key: `send:${F}` },
			staged: { key: "staged", sessionId: G },
		},
	});
	const tick = withClock(t);
	await tick(WORKSPACE_INACTIVE_MS);
	assert.equal(feed.watches(), 0);
	assert.equal(feed.subscriptions(), 0);
	assert.deepEqual(feed.calls, []);
	assert.deepEqual(tabSnapshot(), { rendered: open, saved: open });
	await enable();
	assert.equal(feed.watches(), 1);
	assert.deepEqual(feed.calls, [[I, L, M, B]]);
	await act(() => current.move(find(G).key, find(C).key));
	const reordered = ids();
	assert.notDeepEqual(reordered, open);
	await tick(WORKSPACE_INACTIVE_MS - 1);
	assert.deepEqual(feed.calls, [[I, L, M, B]]);
	assert.deepEqual(ids(), reordered);
	await tick(1);
	assert.deepEqual(feed.calls, [
		[I, L, M, B],
		[I, L, M, B],
	]);
	const kept = reordered.filter((id) => ![B, L, M].includes(id));
	assert.deepEqual(tabSnapshot(), { rendered: kept, saved: kept });
	assert.ok(find(K).pinned);
	assert.equal(
		canonical.getState().sessions,
		rows,
		"probe and drop do not edit catalogue rows",
	);
	assert.equal(canonical.getState().activeSessionId, A);
});

test("a page miss retries on the next interval and must earn two fresh matching receipts", async (t) => {
	const feed = installTransport(t, {
		answer: (_requested, count) =>
			count === 2 ? result([wireRow(A)]) : result([wireRow(B)]),
	});
	await mount(t, { feedAvailable: true, rows: rowsFor([A, B]) });
	const tick = withClock(t);
	await enable();
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(feed.calls, [[B], [B]]);
	assert.ok(find(B));
	await tick(WORKSPACE_INACTIVE_MS - 1);
	assert.deepEqual(feed.calls, [[B], [B]]);
	await tick(1);
	assert.deepEqual(feed.calls, [[B], [B], [B]]);
	assert.ok(find(B), "a miss breaks the chain even when the revision returns");
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(feed.calls, [[B], [B], [B], [B]]);
	assert.deepEqual(tabSnapshot(), { rendered: [A], saved: [A] });
	await tick(WORKSPACE_INACTIVE_MS);
	assert.equal(feed.calls.length, 4, "closed tabs no longer need probes");
});

test("a full batch of page misses cannot starve the 501st background tab's two receipts", async (t) => {
	const offPage = Array.from({ length: 500 }, (_, index) =>
		index.toString(16).padStart(12, "0"),
	);
	const feed = installTransport(t, {
		answer: (requested) => result(requested.includes(B) ? [wireRow(B)] : []),
	});
	await mount(t, {
		feedAvailable: true,
		ids: [A, ...offPage, B],
		rows: rowsFor([A, B]),
	});
	const tick = withClock(t);
	const requests = () => feed.calls.map((ids) => [ids.length, ids.includes(B)]);
	await enable();
	assert.deepEqual(requests(), [
		[500, false],
		[1, true],
	]);
	assert.deepEqual(feed.calls[0], offPage);
	assert.deepEqual(feed.calls[1], [B]);
	assert.ok(find(B), "one receipt does not close the tab");
	await tick(WORKSPACE_INACTIVE_MS - 1);
	assert.equal(feed.calls.length, 2, "page misses do not retry early");
	assert.ok(find(B));
	await tick(1);
	assert.deepEqual(feed.calls, [offPage, [B], offPage, [B]]);
	const kept = [A, ...offPage];
	assert.deepEqual(tabSnapshot(), { rendered: kept, saved: kept });
});

test("a tab not in the cached catalogue can age only on fresh Core receipts", async (t) => {
	const feed = installTransport(t);
	await mount(t, { feedAvailable: true, rows: rowsFor([A]) });
	const tick = withClock(t);
	await enable();
	assert.deepEqual(feed.calls, [[B]]);
	assert.ok(find(B));
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(feed.calls, [[B], [B]]);
	assert.deepEqual(tabSnapshot(), { rendered: [A], saved: [A] });
});

test("an empty background draft ages out of the strip without discarding its canonical row", async (t) => {
	const feed = installTransport(t);
	await mount(t, { feedAvailable: true, ids: [A] });
	const tick = withClock(t);
	let draft;
	await act(() => {
		draft = pageStartDraft();
	});
	await act(() => {
		canonical.getState().setActiveSession(A);
		navigate(`/chat/${A}`);
	});
	assert.ok(find(draft));
	await tick(WORKSPACE_INACTIVE_MS);
	assert.ok(find(draft), "opt-in is still required");
	await enable();
	await tick(WORKSPACE_INACTIVE_MS - 1);
	assert.ok(find(draft));
	const row = canonical.getState().drafts[draft];
	await tick(1);
	assert.deepEqual(tabSnapshot(), { rendered: [A], saved: [A] });
	assert.equal(canonical.getState().drafts[draft], row);
	assert.deepEqual(
		feed.calls,
		[],
		"drafts are local strip state, not Core IDs",
	);
	assert.deepEqual(feed.consoleCalls, ["draft:local-console"]);
	await act(() => canonical.getState().openDraft(draft));
	assert.ok(find(draft), "the same canonical draft can be reopened");
});

test("draft reconciliation preserves selected, pinned, text, attachments and admission work", async (t) => {
	const feed = installTransport(t);
	await mount(t, {
		feedAvailable: true,
		ids: [A],
		rows: [{ ...cold, session_id: A, active: true }],
	});
	const tick = withClock(t);
	const stage = async () => {
		let key;
		await act(() => {
			key = pageStartDraft();
		});
		return key;
	};
	const empty = await stage();
	const pinned = await stage();
	await act(() => current.pin(find(pinned).key));
	const text = await stage();
	await act(() => composer.getState().setCurrentInput(text, "still composing"));
	const attachments = await stage();
	await act(() =>
		composer.getState().addAttachment(attachments, {
			id: "chip",
			path: "/fixture.txt",
			name: "fixture.txt",
		}),
	);
	const sending = await stage();
	const uncertain = await stage();
	await act(() =>
		canonical.setState((state) => ({
			drafts: {
				...state.drafts,
				[sending]: { ...state.drafts[sending], pending: true },
				[uncertain]: { ...state.drafts[uncertain], admissionAttempted: true },
			},
		})),
	);
	const active = await stage();
	await enable();
	const draftRows = canonical.getState().drafts;
	const inputRows = composer.getState().inputByConversation;
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(ids(), [
		A,
		pinned,
		text,
		attachments,
		sending,
		uncertain,
		active,
	]);
	assert.equal(find(empty), undefined);
	assert.equal(canonical.getState().drafts, draftRows);
	assert.equal(canonical.getState().activeDraftKey, active);
	assert.equal(composer.getState().inputByConversation, inputRows);
	assert.deepEqual(
		feed.consoleCalls,
		["draft:local-console"],
		"one scoped listing covers every expired draft",
	);
});

test("pending console surfaces and intervening console changes keep background drafts", async (t) => {
	const late = Promise.withResolvers();
	const emptyListing = { available: true, surfaces: [] };
	const feed = installTransport(t, {
		consoleState: (count) =>
			count === 1
				? { available: true, surfaces: [{ surface: "con:1:fixture" }] }
				: count === 2
					? late.promise
					: emptyListing,
	});
	await mount(t, { feedAvailable: true, ids: [A] });
	const tick = withClock(t);
	let draft;
	await act(() => {
		draft = pageStartDraft();
	});
	await act(() => canonical.getState().setActiveSession(A));
	await enable();
	await tick(WORKSPACE_INACTIVE_MS);
	assert.ok(find(draft), "a pending console surface is shared by every draft");
	await tick(WORKSPACE_INACTIVE_MS);
	await act(() => {
		feed.consoleChanged();
		late.resolve(emptyListing);
	});
	assert.ok(
		find(draft),
		"an empty listing from before a console transition is stale",
	);
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(ids(), [A]);
	assert.equal(feed.consoleCalls.length, 3);
});

test("a transient composer edit during the console read restarts the draft clock", async (t) => {
	const late = Promise.withResolvers();
	const listing = { available: true, surfaces: [] };
	const feed = installTransport(t, {
		consoleState: (count) => (count === 1 ? late.promise : listing),
	});
	await mount(t, { feedAvailable: true, ids: [A] });
	const tick = withClock(t);
	let draft;
	await act(() => {
		draft = pageStartDraft();
	});
	await act(() => canonical.getState().setActiveSession(A));
	await enable();
	await tick(WORKSPACE_INACTIVE_MS);
	await act(() => {
		composer.getState().setCurrentInput(draft, "brief work");
		composer.getState().setCurrentInput(draft, "");
		late.resolve(listing);
	});
	assert.ok(find(draft));
	assert.equal(feed.consoleCalls.length, 1);
	await tick(WORKSPACE_INACTIVE_MS - 1);
	assert.ok(find(draft));
	await tick(1);
	assert.deepEqual(ids(), [A]);
});

test("off-cache remote placement vetoes a matching in-flight receipt", async (t) => {
	const late = Promise.withResolvers();
	const feed = installTransport(t, {
		answer: (_requested, count) =>
			count === 1 ? result([wireRow(B)]) : late.promise,
	});
	await mount(t, { feedAvailable: true, rows: rowsFor([A]) });
	const tick = withClock(t);
	await enable();
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(feed.calls, [[B], [B]]);
	await act(() => {
		canonical.setState({ placementFacts: { [B]: { locality: "remote" } } });
		late.resolve(result([wireRow(B)]));
	});
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(tabSnapshot(), { rendered: [A, B], saved: [A, B] });
	assert.deepEqual(feed.calls, [[B], [B]]);
});

test("old Core stays inert even with a ready-looking headline and an unstamped cold row", async (t) => {
	const feed = installTransport(t, {
		answer: () =>
			result([
				{
					...cold,
					id: B,
					status_revision: 0,
					status_epoch: epoch,
					jobs_running: 0,
					asks_open: 0,
				},
			]),
	});
	await mount(t, { feedAvailable: true, rows: rowsFor([A, B]) });
	const tick = withClock(t);
	await enable();
	await tick(WORKSPACE_INACTIVE_MS - 1);
	assert.deepEqual(feed.calls, [[B]], "omission does not retry immediately");
	await tick(1);
	assert.deepEqual(ids(), [A, B]);
	assert.deepEqual(
		feed.calls,
		[[B], [B]],
		"old Core remains safe after a bounded retry",
	);
});

test("a changed cold revision at expiry starts a new full interval before repeated proof can drop", async (t) => {
	const feed = installTransport(t, {
		answer: (_requested, count) =>
			result([wireRow(B, receipt(count === 1 ? armRevision : leaseRevision))]),
	});
	await mount(t, { feedAvailable: true, rows: rowsFor([A, B]) });
	const tick = withClock(t);
	await enable();
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(ids(), [A, B]);
	assert.deepEqual(feed.calls, [[B], [B]]);
	await tick(WORKSPACE_INACTIVE_MS - 1);
	assert.deepEqual(ids(), [A, B]);
	assert.deepEqual(feed.calls, [[B], [B]]);
	await tick(1);
	assert.deepEqual(ids(), [A]);
	assert.deepEqual(feed.calls, [[B], [B], [B]]);
});

for (const [kind, latest] of Object.entries({
	"old/unknown receipt": () => result([{ ...cold, id: B }]),
	"wire failure": () => ({ status: 422, body: { detail: "unknown field" } }),
	"IPC failure": () => Promise.reject(new Error("fixture transport failed")),
	"wrong epoch": () => result([wireRow(B, { ...receipt(), epoch: "old" })]),
	"new version": () => result([wireRow(B, { ...receipt(), version: 2 })]),
	"malformed receipt": () =>
		result([wireRow(B, { ...receipt(), revision: 0 })]),
	"off-page candidate": () => ({
		status: 200,
		body: { result: { next_cursor: "more", sessions: [wireRow(A)] } },
	}),
})) {
	test(`fresh ${kind} keeps the tab and waits a full interval to retry`, async (t) => {
		const feed = installTransport(t, {
			answer: (_requested, count) =>
				count === 1 ? result([wireRow(B)]) : latest(),
		});
		await mount(t, { feedAvailable: true, rows: rowsFor([A, B]) });
		const tick = withClock(t);
		await enable();
		await tick(WORKSPACE_INACTIVE_MS);
		await act(() => canonical.setState({ sessions: rowsFor([A, B]) }));
		await tick(WORKSPACE_INACTIVE_MS - 1);
		assert.deepEqual(ids(), [A, B]);
		assert.deepEqual(feed.calls, [[B], [B]]);
		await tick(1);
		assert.deepEqual(ids(), [A, B]);
		assert.deepEqual(feed.calls, [[B], [B], [B]]);
	});
}

for (const [kind, interrupt] of Object.entries({
	"same-epoch new open": (feed) => act(() => feed.open()),
	"gap and same-process reattach": (feed) =>
		act(() => {
			feed.gap();
			feed.disconnect();
			feed.connect(epoch);
			feed.open();
		}),
	"session activity": (feed) => act(() => feed.status("working")),
	"pin then unpin": async () => {
		await act(() => current.pin(find(B).key));
		await act(() => current.pin(find(B).key));
	},
	"transient queued input": () =>
		act(() => {
			composer.setState({ inputByConversation: { [`send:${B}`]: pending } });
			composer.setState({ inputByConversation: {} });
		}),
	"local validation": () =>
		act(() => {
			canonical.setState({ validatingSessionId: B });
			canonical.setState({ validatingSessionId: null });
		}),
})) {
	test(`${kind} discards an in-flight expiry even if the safe-looking set comes back`, async (t) => {
		const delayed = Promise.withResolvers();
		const feed = installTransport(t, {
			answer: (_requested, count) =>
				count === 2 ? delayed.promise : result([wireRow(B)]),
		});
		await mount(t, { feedAvailable: true, rows: rowsFor([A, B]) });
		const tick = withClock(t);
		await enable();
		await tick(WORKSPACE_INACTIVE_MS);
		assert.deepEqual(feed.calls, [[B], [B]]);
		await interrupt(feed);
		assert.deepEqual(feed.calls, [[B], [B]], "only one batch may be pending");
		await act(() => delayed.resolve(result([wireRow(B)])));
		assert.deepEqual(ids(), [A, B]);
		assert.deepEqual(feed.calls, [[B], [B], [B]]);
		await tick(WORKSPACE_INACTIVE_MS);
		assert.deepEqual(ids(), [A]);
		assert.deepEqual(feed.calls, [[B], [B], [B], [B]]);
	});
}

function resolveAtExpiryDecision(delayed) {
	const boundary = Promise.withResolvers();
	const row = wireRow(B);
	const proof = row.workspace_rest;
	Object.defineProperty(row, "workspace_rest", {
		get() {
			// Signal from the real receipt reader. The awaiting test resumes after
			// the expiry continuation, before act drains any merely queued render.
			boundary.resolve();
			return proof;
		},
	});
	delayed.resolve(result([row]));
	return boundary.promise;
}

for (const [kind, interrupt] of Object.entries({
	"unsent input": () =>
		composer.setState({ inputByConversation: { [`send:${B}`]: pending } }),
	"feed gap": (feed) => feed.gap(),
	"opt-out": () => preferences.getState().setWorkspaceAutoClose(false),
})) {
	for (const when of ["before", "after"]) {
		test(`${kind} ${when} the expiry decision respects its commit boundary`, async (t) => {
			const delayed = Promise.withResolvers();
			const feed = installTransport(t, {
				answer: (_requested, count) =>
					count === 2 ? delayed.promise : result([wireRow(B)]),
			});
			await mount(t, { feedAvailable: true, rows: rowsFor([A, B]) });
			t.after(() => assert.equal(feed.subscriptions(), 0));
			const tick = withClock(t);
			await enable();
			await tick(WORKSPACE_INACTIVE_MS);
			assert.deepEqual(feed.calls, [[B], [B]]);
			// Drain unrelated React work before testing the eager updater path.
			await act(() => current.focusHandled());
			await act(() => current.focusHandled());
			const open = { rendered: [A, B], saved: [A, B] };
			assert.deepEqual(tabSnapshot(), open);
			let atOverride;
			await act(async () => {
				if (when === "after") await resolveAtExpiryDecision(delayed);
				atOverride = tabSnapshot();
				interrupt(feed);
				if (when === "before") delayed.resolve(result([wireRow(B)]));
			});
			assert.deepEqual(
				tabSnapshot(),
				atOverride,
				"a veto must not be followed by a stale render or preference write",
			);
			assert.deepEqual(
				atOverride,
				when === "before" ? open : { rendered: [A], saved: [A] },
			);
			assert.deepEqual(feed.calls, [[B], [B]]);
			assert.equal(canonical.getState().activeSessionId, A);
			assert.equal(dom.window.location.hash, `#/chat/${A}`);
			assert.equal(current.focusRequested, false);
		});
	}
}

test("a deferred sibling reorder replays without resurrecting an expired tab", async (t) => {
	const delayed = Promise.withResolvers();
	const feed = installTransport(t, {
		answer: (_requested, count) =>
			count === 2 ? delayed.promise : result([wireRow(B)]),
	});
	await mount(t, {
		feedAvailable: true,
		ids: [A, B, C],
		rows: [...rowsFor([A, B]), { ...cold, session_id: C, pinned: true }],
	});
	const tick = withClock(t);
	await enable();
	await tick(WORKSPACE_INACTIVE_MS);
	await act(async () => {
		// An older, lower-priority tab action can be replayed after the sync
		// removal, as with reordering from a continuous drag event.
		startTransition(() => current.move(find(C).key, find(A).key));
		await resolveAtExpiryDecision(delayed);
		assert.deepEqual(tabSnapshot(), { rendered: [A, C], saved: [A, C] });
	});
	assert.deepEqual(tabSnapshot(), { rendered: [C, A], saved: [C, A] });
	assert.deepEqual(feed.calls, [[B], [B]]);
	assert.equal(current.focusRequested, false);
});

test("only open can establish an epoch after a gap or disconnect, not an old watch snapshot", async (t) => {
	const feed = installTransport(t, { startEpoch: null });
	await mount(t, { feedAvailable: true, rows: rowsFor([A, B]) });
	const tick = withClock(t);
	await enable();
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(feed.calls, [], "a connected socket alone is not an epoch");
	await act(() => feed.open());
	await tick(WORKSPACE_INACTIVE_MS - 1);
	await act(() => {
		feed.gap();
		feed.connect(epoch);
	});
	await tick(1);
	assert.deepEqual(ids(), [A, B]);
	assert.deepEqual(feed.calls, [[B]], "gap alone invalidates the open");
	await act(() => feed.open());
	await tick(WORKSPACE_INACTIVE_MS - 1);
	await act(() => {
		feed.disconnect();
		feed.connect();
	});
	await tick(1);
	assert.deepEqual(ids(), [A, B]);
	assert.deepEqual(
		feed.calls,
		[[B], [B]],
		"disconnect alone invalidates the open",
	);
});

test("turning off the opt-in discards a pending close", async (t) => {
	const delayed = Promise.withResolvers();
	const feed = installTransport(t, {
		answer: (_requested, count) =>
			count === 2 ? delayed.promise : result([wireRow(B)]),
	});
	await mount(t, { feedAvailable: true, rows: rowsFor([A, B]) });
	const tick = withClock(t);
	await enable();
	await tick(WORKSPACE_INACTIVE_MS);
	await act(() => preferences.getState().setWorkspaceAutoClose(false));
	await act(() => delayed.resolve(result([wireRow(B)])));
	assert.deepEqual(ids(), [A, B]);
	assert.deepEqual(feed.calls, [[B], [B]]);
});
