import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * `/tag`'s LIVE ORDER LIFECYCLE, driven through the real hook.
 *
 * `slash-tags.test.mjs` pins the pure partition and `slash-tags-popup.test.mjs`
 * pins the rendered list, but neither owns the freeze's LIFETIME: the order is
 * held still while the list is up (round 1, F1) and must be recomputed when the
 * list is closed and reopened (round 2, F6). That rule lives in
 * `useSlashCompletion`'s open latch rather than in either of those halves, so
 * this file mounts the hook itself with the real tag store and the real
 * assignment hook behind it, and drives the user's actual sequence:
 *
 *     open `/tag` -> toggle Beta -> Escape -> reopen -> the applied-first
 *     partition is recomputed, and the marker is still on the row it was on.
 *
 * The second case is the F4 residual: a conversation switch that lands while a
 * write is pending must retire the old conversation's receipt instead of
 * leaving it over the new list until the next toggle.
 */

const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{ url: "http://localhost/", pretendToBeVisual: true },
);
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* jsdom context-bound accessors */
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
if (!globalThis.CSS)
	globalThis.CSS = {
		escape: (value) => String(value).replace(/[^\w-]/g, (c) => `\\${c}`),
	};

const require = createRequire(import.meta.url);
const SHARED_PACKAGES = /^(react|react-dom|@tanstack\/react-query)(\/.*)?$/;

/*
 * One React and one react-query per process: the component tree is rendered by
 * THIS file, and the hook's provider gate reads `QueryClientContext` from the
 * copy the bundle resolves. A second bundled copy would make the provider
 * invisible to the hook and silently switch the tag surface off.
 */
const bundle = await build({
	stdin: {
		contents: [
			'export { useSlashCompletion } from "./src/renderer/src/features/chat/components/slash-commands";',
			'export { useSessionTagsStore } from "./src/renderer/src/shared/store/session-tags-store";',
			'export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	mainFields: ["module", "main"],
	loader: { ".css": "empty" },
	alias: {
		"@features": resolve("src/renderer/src/features"),
		"@shared": resolve("src/renderer/src/shared"),
	},
	plugins: [
		{
			name: "react-singleton",
			setup(builder) {
				builder.onResolve({ filter: SHARED_PACKAGES }, (args) => ({
					path: pathToFileURL(require.resolve(args.path)).href,
					external: true,
				}));
			},
		},
	],
});
const {
	useSlashCompletion,
	useSessionTagsStore,
	useCanonicalSessionsStore,
	QueryClient,
	QueryClientProvider,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const registry = () => [
	{ id: "t-a", name: "Alpha", order: 0, conversations: 1 },
	{ id: "t-b", name: "Beta", order: 1, conversations: 0 },
	{ id: "t-c", name: "Gamma", order: 2, conversations: 0 },
];

let categories;
let requests;
let hold;
let releaseHold;
let revision;

beforeEach(() => {
	categories = registry();
	requests = [];
	hold = null;
	releaseHold = null;
	revision = 1;
	useSessionTagsStore.setState({
		categories,
		loading: false,
		error: null,
	});
	useCanonicalSessionsStore.setState({
		sessions: [
			{
				session_id: "s-1",
				name: "One",
				mtime: 1,
				tags: [],
				primary: null,
				tags_revision: "rev-1",
			},
			{
				session_id: "s-2",
				name: "Two",
				mtime: 2,
				tags: [],
				primary: null,
				tags_revision: "rev-2",
			},
		],
		fetchSessions: async () => {},
	});
	window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				const answer = (result) => ({ status: 200, body: { result } });
				if (request.op === "capabilities")
					return answer({
						desktop_available: true,
						features: { commands: 1, session_tags: 1 },
					});
				if (request.op === "commands.list") return answer({ commands: [] });
				if (request.op === "tags.list") return answer({ tags: categories });
				if (request.op === "sessions.tags") {
					if (hold) await hold;
					const refs = request.tags.flatMap((id) => {
						const tag = categories.find((entry) => entry.id === id);
						return tag ? [{ id: tag.id, name: tag.name }] : [];
					});
					return answer({
						tags: refs,
						primary: request.primary,
						tags_revision: `rev-${++revision}`,
					});
				}
				throw new Error(`unarmed op ${request.op}`);
			},
		},
	};
});

const client = new QueryClient({
	defaultOptions: {
		queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
	},
});

/*
 * Three macrotask turns, each inside `act`: the assignment hook's success path
 * schedules its registry refetch with `void`, so the store update that follows
 * it lands a turn or two after the write's own promise settles.
 */
const flush = async () => {
	for (let turn = 0; turn < 3; turn += 1)
		await act(async () => {
			await new Promise((done) => setTimeout(done, 0));
		});
};

const Probe = ({ input, sessionId, onState }) => {
	onState(
		useSlashCompletion({
			inputValue: input,
			selectionStart: input.length,
			sessionId,
			cwd: "/tmp",
			activeProfile: undefined,
			activeModel: null,
			activeSpec: null,
			paneHasSession: true,
		}),
	);
	return null;
};

const mounted = [];

const mount = async (input, sessionId) => {
	let latest = null;
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = require("react-dom/client").createRoot(container);
	const frame = {
		latest: () => latest,
		render: async (nextInput, nextSessionId) => {
			await act(async () => {
				root.render(
					React.createElement(
						QueryClientProvider,
						{ client },
						React.createElement(Probe, {
							input: nextInput,
							sessionId: nextSessionId,
							onState: (state) => {
								latest = state;
							},
						}),
					),
				);
			});
			await flush();
		},
	};
	mounted.push({ root, container });
	await frame.render(input, sessionId);
	return frame;
};

/*
 * One tree per case. The stores are module singletons, so a tree left mounted
 * while `beforeEach` reseeds them re-renders OUTSIDE `act` and warns; unmounting
 * also keeps one case's pending writes out of the next one's readings.
 */
afterEach(async () => {
	for (const { root, container } of mounted.splice(0)) {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	}
});

const tagIds = (frame) =>
	frame
		.latest()
		.argumentList.rows.map((row) => row.tagId)
		.filter(Boolean);

test("a toggle, Escape and reopen recompute applied-first and keep the marker's row", async () => {
	const frame = await mount("/tag ", "s-1");
	assert.ok(
		requests.some((request) => request.op === "capabilities"),
		"the capability census was consulted, so the tag surface is gated on rather than absent",
	);
	assert.equal(frame.latest().inline?.source, "session-tags");
	assert.deepEqual(
		tagIds(frame),
		["t-a", "t-b", "t-c"],
		"the list opens in registry order with nothing applied",
	);
	// The marker starts at the top; the toggle below must not move it (F1), so
	// this is also the row the reopen has to find again after the reorder.
	const marker = frame.latest().matches[frame.latest().active];
	assert.equal(marker.row.tagId, "t-a");

	const beta = frame
		.latest()
		.argumentList.rows.find((row) => row.tagId === "t-b");
	await act(async () => {
		await frame.latest().actOnTagRow(beta);
	});
	await flush();

	assert.deepEqual(
		tagIds(frame),
		["t-a", "t-b", "t-c"],
		"the order is frozen while the list is up (round 1, F1)",
	);
	assert.equal(frame.latest().matches[frame.latest().active].row.tagId, "t-a");

	// Escape: the list closes on the pre-toggle partition, and the freeze is
	// retired on that render.
	await act(async () => {
		frame.latest().close();
	});
	assert.equal(frame.latest().open, false);

	// Enter on the dismissed `/tag ` reopens the same list (F3's path).
	await act(async () => {
		frame.latest().reopen();
	});
	await flush();

	assert.deepEqual(
		tagIds(frame),
		["t-b", "t-a", "t-c"],
		"the reopen recomputes applied-first from the post-toggle selection (F6)",
	);
	assert.equal(frame.latest().open, true);
	assert.equal(
		frame.latest().matches[frame.latest().active].row.tagId,
		"t-a",
		"the marker follows its row across the reorder instead of the old index",
	);
});

test("a switch during a pending write retires the old conversation's receipt", async () => {
	const frame = await mount("/tag ", "s-1");
	const gamma = frame
		.latest()
		.argumentList.rows.find((row) => row.tagId === "t-c");

	hold = new Promise((done) => {
		releaseHold = done;
	});
	let toggle;
	await act(async () => {
		toggle = frame.latest().actOnTagRow(gamma);
	});
	assert.notEqual(
		frame.latest().tagNotice,
		"",
		"the optimistic receipt is on screen before the switch",
	);
	assert.equal(frame.latest().tagPending, true);

	// The user switches conversation while the write is still in flight.
	await frame.render("/tag ", "s-2");

	await act(async () => {
		releaseHold();
		await toggle;
	});
	await flush();

	assert.equal(
		frame.latest().tagNotice,
		"",
		"the old conversation's receipt does not survive the switch",
	);
	assert.equal(frame.latest().tagPending, false);
});
