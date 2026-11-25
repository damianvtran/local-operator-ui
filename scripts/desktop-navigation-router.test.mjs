import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Link, useLocation, useNavigate } from "react-router-dom";

const PORT_MODULES =
	/^(react(?:\/jsx-runtime)?|react-router-dom|@shared\/store\/canonical-sessions-store)$/;
const ALL_PORTS = /.*/;

// Use the shipped adapter and actual React Router/native history. Only the
// chat store is a port here: no daemon is needed to prove which identity the
// router restores, or that a route write can win without sending a POP.
const { outputFiles } = await build({
	entryPoints: [
		"src/renderer/src/shared/components/navigation/desktop-navigation-router.tsx",
	],
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
const { DesktopNavigationRouter, useDesktopNavigationAvailability } =
	await import(
		`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
	);

async function withRouter(run, restored = "saved-a") {
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
		return React.createElement(
			Link,
			{ to: "/settings?section=radient" },
			"Sign in",
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
		const pop = async (delta) => {
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
				navigate(delta);
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
