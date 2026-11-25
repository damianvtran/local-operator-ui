import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Link, useLocation, useNavigate } from "react-router-dom";

const PORT_MODULES =
	/^(react(?:\/jsx-runtime)?|react-router-dom|@shared\/store\/canonical-sessions-store)$/;
const ALL_PORTS = /.*/;

// Use the shipped adapter, shortcut listener and focus guard with actual
// HashRouter and DOM focus. Stub the daemon-backed selection and composer.
const appPath = "src/renderer/src/app.tsx";
const app = readFileSync(appPath, "utf8");
const shortcutEffect = app.match(
	/const onKeyDown = \(event: KeyboardEvent\) => \{[\s\S]*?return \(\) => document\.removeEventListener\("keydown", onKeyDown\);/,
);
assert.ok(shortcutEffect, `New Chat document listener missing from ${appPath}`);
const { outputFiles } = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/shared/components/navigation/desktop-navigation-router";
			import { desktopHistoryKeepsFocus } from "./src/renderer/src/shared/components/navigation/desktop-navigation-focus";
			import { shouldStartNewChat, shouldStartTemporaryChat } from "./src/renderer/src/features/chat/new-chat-shortcut";
			export { desktopHistoryKeepsFocus };
			export function bindNewChat(navigate, useCanonicalSessionsStore, HTMLElement) {
				const isOnboardingActive = false, catalogueReady = true, temporaryChats = false;
				${shortcutEffect[0]}
			}
		`,
		resolveDir: process.cwd(),
		loader: "ts",
	},
	alias: { "@shared": "./src/renderer/src/shared" },
	bundle: true,
	format: "esm",
	jsx: "automatic",
	write: false,
	plugins: [
		{
			name: "ports",
			setup(builder) {
				builder.onResolve(
					{
						filter: PORT_MODULES,
					},
					({ path }) => ({ path, namespace: "ports" }),
				);
				builder.onLoad(
					{ filter: ALL_PORTS, namespace: "ports" },
					({ path }) => ({
						contents: `const port = globalThis.navigationTestPorts[${JSON.stringify(path)}]; export const { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, jsx, UNSAFE_NavigationContext, useCanonicalSessionsStore } = port;`,
					}),
				);
			},
		},
	],
});
const listeners = new Set();
let selection;
function select(activeDraftKey, activeSessionId) {
	const prev = selection;
	selection = { ...prev, activeDraftKey, activeSessionId };
	for (const listener of listeners) listener(selection, prev);
}
globalThis.navigationTestPorts = {
	react: React,
	"react/jsx-runtime": await import("react/jsx-runtime"),
	"react-router-dom": await import("react-router-dom"),
	"@shared/store/canonical-sessions-store": {
		useCanonicalSessionsStore: {
			getState: () => selection,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
	},
};
const {
	bindNewChat,
	desktopHistoryKeepsFocus,
	DesktopNavigationRouter,
	useDesktopNavigationAvailability,
} = await import(
	`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

async function withRouter(run, restored = "saved-a", focusScene = false) {
	const dom = new JSDOM('<div id="root"></div>', {
		url: "https://test.invalid/#/chat",
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	selection = {
		activeSessionId: restored,
		activeDraftKey: null,
		drafts: {
			"draft-one": { request: "one" },
			"draft-two": { request: "two" },
		},
		openDraft: (id) => select(id, null),
		openSession: async (id) => select(null, id),
		setActiveSession: (id) => select(null, id),
	};
	let navigate;
	let location;
	let availability;
	function App() {
		navigate = useNavigate();
		location = useLocation();
		availability = useDesktopNavigationAvailability();
		if (focusScene)
			return React.createElement(FocusScene, { navigate, location });
		return React.createElement(
			Link,
			{ to: "/settings?section=radient" },
			"Sign in",
		);
	}
	function FocusScene({ navigate, location }) {
		const composer = React.useRef(null);
		React.useEffect(
			() =>
				bindNewChat(
					navigate,
					{
						getState: () => ({
							stageDraft: () => select(`new-${window.history.state.idx}`, null),
						}),
					},
					dom.window.HTMLElement,
				),
			[navigate],
		);
		// The real composer and draft arrival both yield to this shipped guard.
		React.useEffect(() => {
			if (
				location.pathname.startsWith("/chat") &&
				!desktopHistoryKeepsFocus(document.activeElement)
			)
				composer.current.focus();
		}, [location]);
		return React.createElement(
			React.Fragment,
			null,
			React.createElement(
				"button",
				{
					type: "button",
					"data-desktop-back": "",
					onClick: () => navigate(-1),
				},
				"Back",
			),
			React.createElement(
				"button",
				{
					type: "button",
					"data-desktop-forward": "",
					onClick: () => navigate(1),
				},
				"Forward",
			),
			React.createElement(
				"button",
				{ type: "button", onClick: () => navigate("/chat/saved-c") },
				"Open saved chat",
			),
			// This port only models focus, not the editor's text input events.
			React.createElement("div", {
				role: "textbox",
				"aria-label": "Message",
				tabIndex: -1,
				ref: composer,
			}),
		);
	}
	const root = createRoot(document.querySelector("#root"));
	const doAct = (fn) =>
		act(async () => {
			fn();
		});
	try {
		await doAct(() =>
			root.render(
				React.createElement(
					HashRouter,
					{
						future: { v7_startTransition: true, v7_relativeSplatPath: true },
					},
					React.createElement(
						DesktopNavigationRouter,
						null,
						React.createElement(App),
					),
				),
			),
		);
		const pop = async (delta, gesture = () => navigate(delta)) => {
			await act(async () => {
				const POP = new Promise((resolve, reject) => {
					const timeout = setTimeout(
						() => reject(new Error("expected POP")),
						500,
					);
					window.addEventListener(
						"popstate",
						() => {
							clearTimeout(timeout);
							resolve();
						},
						{ once: true },
					);
				});
				gesture();
				await POP;
			});
		};
		await run({
			doAct,
			pop,
			push: (path) => navigate(path),
			step: (delta) => navigate(delta),
			read: () => ({
				path: location.pathname + location.search,
				idx: window.history.state.idx,
				draft: selection.activeDraftKey,
				saved: selection.activeSessionId,
				...availability,
			}),
		});
	} finally {
		await doAct(() => root.unmount());
		dom.window.close();
	}
}

test("internal sign-in link is an indexed route; Back returns to its owner", async () =>
	withRouter(async ({ doAct, pop, push, read }) => {
		await doAct(() => push("/team-bridge"));
		await doAct(() => document.querySelector("a").click());
		assert.equal(read().path, "/settings?section=radient");
		assert.equal(read().idx, 2);
		await pop(-1);
		assert.equal(read().path, "/team-bridge");
	}));

test("POP restores distinct same-hash drafts and the first restored session without reminting", async () =>
	withRouter(async ({ doAct, pop, push, read }) => {
		const drafts = selection.drafts;
		await doAct(() => {
			select("draft-one", null);
			push("/chat");
		});
		await doAct(() => {
			select("draft-two", null);
			push("/chat");
		});
		await doAct(() => {
			select(null, "saved-b");
			push("/chat/saved-b");
		});
		assert.equal(read().idx, 3);
		assert.equal(read().saved, "saved-b");
		await pop(-1);
		assert.equal(read().draft, "draft-two");
		await pop(-1);
		assert.equal(read().draft, "draft-one");
		await doAct(() => push("/chat"));
		assert.equal(read().idx, 1);
		assert.equal(read().canForward, true);
		await pop(-1);
		assert.equal(read().saved, "saved-a");
		assert.equal(read().draft, null);
		await pop(1);
		assert.equal(read().draft, "draft-one");
		assert.equal(selection.drafts, drafts);
	}));

test("history retains Back and Forward focus, but New Chat takes the caret even on the same hash", async () =>
	withRouter(
		async ({ doAct, pop, push, read }) => {
			await doAct(() => {
				select("draft-one", null);
				push("/chat");
				select(null, "saved-b");
				push("/chat/saved-b");
			});
			const [back, forward, saved] = document.querySelectorAll("button");
			const message = document.querySelector('[role="textbox"]');
			const traverse = async (button, delta, index) => {
				// jsdom does not synthesize the native Enter-to-click default action.
				assert.equal(document.activeElement, button);
				await pop(delta, () => button.click());
				assert.equal(read().idx, index);
				assert.equal(document.activeElement, button);
			};
			back.focus();
			await traverse(back, -1, 1);
			assert.equal(read().draft, "draft-one");
			await traverse(back, -1, 0);
			assert.equal(read().saved, "saved-a");
			forward.focus();
			await traverse(forward, 1, 1);
			await traverse(forward, 1, 2);
			const newChat = async (button, modifier, index) => {
				button.focus();
				const chord = new window.KeyboardEvent("keydown", {
					key: "n",
					[modifier]: true,
					bubbles: true,
					cancelable: true,
				});
				await doAct(() => button.dispatchEvent(chord));
				assert.equal(chord.defaultPrevented, true);
				assert.equal(read().path, "/chat");
				assert.equal(read().idx, index);
				assert.equal(read().draft, `new-${index - 1}`);
				assert.equal(
					document.activeElement.getAttribute("aria-label"),
					"Message",
					`${modifier} New Chat owns the caret`,
				);
			};
			await newChat(forward, "metaKey", 3);
			await newChat(back, "ctrlKey", 4);
			saved.focus();
			await doAct(() => saved.click());
			assert.equal(read().path, "/chat/saved-c");
			assert.equal(document.activeElement, message);
		},
		"saved-a",
		true,
	));

test("POP to unselected Chat clears a later selection instead of retaining it", async () =>
	withRouter(async ({ doAct, pop, push, read }) => {
		await doAct(() => {
			select("draft-one", null);
			push("/chat");
		});
		await pop(-1);
		assert.equal(read().path, "/chat");
		assert.equal(read().draft, null);
		assert.equal(read().saved, null);
	}, null));

test("the winning PUSH retires a pending traversal and its queued steps", async () =>
	withRouter(async ({ doAct, pop, push, read, step }) => {
		await doAct(() => push("/chat/saved-b"));
		await doAct(() => push("/settings"));
		let pops = 0;
		window.addEventListener("popstate", () => {
			pops += 1;
		});
		await doAct(() => {
			step(-1);
			step(-1);
			push("/library");
		});
		await act(() => new Promise((resolve) => setTimeout(resolve, 25)));
		assert.equal(pops, 0, "the winning write must exercise the no-POP case");
		assert.equal(read().path, "/library");
		await pop(-1);
		assert.equal(read().path, "/settings");
		assert.equal(pops, 1, "queued presses from the old entry were canceled");
	}));
