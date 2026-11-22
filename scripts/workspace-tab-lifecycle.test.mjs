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
const { createElement, act } = require("react");
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
			export {DesktopFeedStatusProjection} from './src/shared/desktop-feed-status';
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
	DesktopFeedStatusProjection,
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
function Fixture({ feedAvailable }) {
	current = useWorkspaceTabs(navigate, () => {}, feedAvailable);
	return createElement(
		"output",
		{},
		current.tabs.map((tab) => tab.target.id).join(","),
	);
}
const ids = () => current.tabs.map((tab) => tab.target.id);
const find = (id) => current.tabs.find((tab) => tab.target.id === id);

async function mount(
	t,
	{
		feedAvailable = false,
		ids: open = [A, B],
		rows = [],
		drafts = {},
		input = {},
	} = {},
) {
	canonical.setState({
		sessions: rows,
		forgotten: {},
		drafts,
		statusUnavailable: [],
	});
	canonical.getState().setActiveSession(A);
	composer.setState({ inputByConversation: input });
	preferences.setState({
		workspaceTabs: open.map((id) => ({ id, pinned: false })),
		workspaceAutoClose: false,
	});
	navigate(`/chat/${A}`);
	const root = createRoot(dom.window.document.getElementById("root"));
	t.after(() => act(() => root.unmount()));
	await act(() => root.render(createElement(Fixture, { feedAvailable })));
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

const resting = {
	locality: "local",
	status_epoch: "live",
	status_revision: 7,
	status: { code: "idle" },
	active: false,
	background_work: false,
	waiting_on: 0,
	jobs_running: 0,
	pending: null,
	asks_open: 0,
};
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

function installFeed(t, ids) {
	const live = new DesktopFeedStatusProjection();
	live.observe({
		type: "open",
		epoch: "live",
		seq: 1,
		payload: {
			attention_status: Object.fromEntries(
				ids.map((id) => [`session/${id}`, { revision: 7, code: "idle" }]),
			),
		},
	});
	const listeners = new Set();
	const states = new Set();
	let initialWatch = 0;
	dom.window.api = {
		desktop: {
			feed: {
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				watchState: (listener, includeSessionStatus) => {
					states.add(listener);
					initialWatch++;
					listener({
						connected: true,
						sessionStatus: includeSessionStatus ? live.snapshot() : undefined,
					});
					return () => states.delete(listener);
				},
			},
		},
	};
	t.after(() => {
		dom.window.api = undefined;
	});
	return {
		watches: () => initialWatch,
		disconnect: () => {
			live.clear();
			for (const f of states) f({ connected: false });
		},
		reconnectWithoutOpen: () => {
			for (const f of states) f({ connected: true });
		},
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

test("opt-in measures a healthy feed baseline with no new frames; queued and key-owned rows stay", async (t) => {
	const open = [A, B, C, D, E, F, G];
	const feed = installFeed(t, open);
	await mount(t, {
		feedAvailable: true,
		ids: open,
		rows: open.map((session_id) => ({ ...resting, session_id })),
		input: { [C]: pending, [`send:${D}`]: pending },
		drafts: {
			[E]: { key: E },
			[`send:${F}`]: { key: `send:${F}` },
			staged: { key: "staged", sessionId: G },
		},
	});
	const tick = withClock(t);
	assert.equal(feed.watches(), 0);
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(ids(), open);
	await act(() => preferences.getState().setWorkspaceAutoClose(true));
	assert.equal(feed.watches(), 1);
	await tick(WORKSPACE_INACTIVE_MS - 1);
	assert.deepEqual(ids(), open);
	await tick(1);
	assert.deepEqual(ids(), [A, C, D, E, F, G]);
});

test("disconnect erases baseline evidence; a bare reconnect never arms from catalogue alone", async (t) => {
	const feed = installFeed(t, [A, B]);
	await mount(t, {
		feedAvailable: true,
		rows: [A, B].map((session_id) => ({ ...resting, session_id })),
	});
	const tick = withClock(t);
	await act(() => preferences.getState().setWorkspaceAutoClose(true));
	await tick(WORKSPACE_INACTIVE_MS - 1);
	await act(() => {
		feed.disconnect();
		feed.reconnectWithoutOpen();
	});
	await tick(WORKSPACE_INACTIVE_MS);
	assert.deepEqual(ids(), [A, B]);
});
