import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, beforeEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// DOM/event plumbing only: jsdom has no layout, so rendered geometry belongs to
// the browser/Storybook evidence, never to these assertions.
const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{
		url: "http://localhost/",
		pretendToBeVisual: true,
	},
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
if (!globalThis.CSS)
	globalThis.CSS = {
		escape: (value) => String(value).replace(/[^\w-]/g, (c) => `\\${c}`),
	};
globalThis.toasts = [];
/*
 * jsdom HAS NO TOP LAYER, AND ASKING IT IS THE WHOLE COST OF THIS FILE. The v3
 * Tags popover is a Radix Popover positioned by floating-ui, whose `isTopLayer`
 * calls `element.matches(":popover-open")` and `":modal"` on ancestors at every
 * position update. nwsapi answers `:modal` by recursing through its
 * `isFullscreen` check, which a CPU profile of one popover test measured at 87%
 * of samples (37 s for a single click). No element can be in a top layer here,
 * so those two selectors answer `false`; every other selector goes to jsdom
 * unchanged.
 */
{
	const matches = dom.window.Element.prototype.matches;
	dom.window.Element.prototype.matches = function (selector) {
		if (selector === ":popover-open" || selector === ":modal") return false;
		return matches.call(this, selector);
	};
}

const require = createRequire(import.meta.url);

/**
 * Fixtures the bundle needs: one React instance, the canonical store, the toast
 * sink and the locale hook. The factory returns esbuild's `setup` callback, so
 * it must be CALLED at the plugin site: passing the factory itself registers
 * nothing, which bundles React a second time and makes every hook in the tree an
 * invalid hook call.
 */
function tagDialogFixtures() {
	return (builder) => {
		// One React instance: the component tree is rendered by this file.
		builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({
			path: pathToFileURL(require.resolve(args.path)).href,
			external: true,
		}));
		const fixture = (name, contents) => {
			builder.onResolve({ filter: new RegExp(`${name}$`) }, () => ({
				path: name,
				namespace: "tag-fixture",
			}));
			builder.onLoad(
				{ filter: new RegExp(`^${name}$`), namespace: "tag-fixture" },
				() => ({ contents, loader: "js" }),
			);
		};
		fixture(
			"canonical-sessions-store",
			`
const state = { sessions: [], fetchSessions: async () => {} };
export const useCanonicalSessionsStore = Object.assign(() => state, {
  getState: () => state,
  setState: (next) => Object.assign(state, typeof next === "function" ? next(state) : next),
});
export const setCanonicalSessions = (sessions) => { state.sessions = sessions; };
`,
		);
		fixture(
			"toast-manager",
			"export const showSuccessToast = (message) => globalThis.toasts.push(message); export const showWarningToast = (message) => globalThis.toasts.push(message);",
		);
		fixture("use-locale", 'export const useI18nLocale = () => "en";');
	};
}

const tagBundle = (contents) =>
	build({
		stdin: { contents, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		jsx: "automatic",
		mainFields: ["module", "main"],
		alias: {
			"@features": resolve("src/renderer/src/features"),
			"@shared": resolve("src/renderer/src/shared"),
		},
		plugins: [{ name: "tag-dialog-fixtures", setup: tagDialogFixtures() }],
	});

const loadBundle = (result, name) =>
	import(
		`data:text/javascript;base64,${Buffer.from(`${result.outputFiles[0].text}\n//# sourceURL=${name}`).toString("base64")}`
	);

const api = await loadBundle(
	await tagBundle(
		'export {ChatTagHeader, ChatTagFooter} from "./src/renderer/src/features/chat/components/chat-tag-header"; export {ChatTagPopover} from "./src/renderer/src/features/chat/components/chat-tag-popover"; export {useSessionTagsStore} from "./src/renderer/src/shared/store/session-tags-store"; export {useCanonicalSessionsStore} from "./src/renderer/src/shared/store/canonical-sessions-store";',
	),
	"chat-tag-dialogs-fixture.mjs",
);

const { createRoot } = await import("react-dom/client");
const root = createRoot(document.getElementById("root"));

const categories = () => [
	{ id: "a", name: "Alpha", order: 0, conversations: 2 },
	{ id: "b", name: "Beta", order: 1, conversations: 0 },
];
let registry;
let requests;
let toggleFailure;
let replaceFailure;
let replaceGate;
let authoritative;
let closed;

beforeEach(async () => {
	// React reconciles the same component type into this root and would carry the
	// previous test's query, listOpen and editing state into the next one, which
	// reads as a passing or failing behaviour the current test never exercised.
	await act(() => root.render(null));
	registry = categories();
	requests = [];
	toggleFailure = null;
	replaceFailure = null;
	replaceGate = null;
	// The canonical row another client would have written. Set in a test that
	// needs the server to refuse a stale revision; fetchSessions then publishes
	// it, which is what the real store awaits on a conflict.
	authoritative = null;
	api.useCanonicalSessionsStore.setState({
		sessions: [],
		fetchSessions: async () => {
			if (!authoritative) return;
			api.useCanonicalSessionsStore.setState({ sessions: [authoritative] });
		},
	});
	closed = 0;
	globalThis.toasts = [];
	api.useSessionTagsStore.setState({
		categories: registry,
		loading: false,
		error: null,
	});
	window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				if (request.op === "tags.list")
					return { status: 200, body: { result: { tags: registry } } };
				if (request.op === "tags.replace") {
					if (replaceGate) await replaceGate();
					if (replaceFailure) return replaceFailure;
					registry = request.tags.map((tag, index) => ({
						id: tag.id ?? `new-${index}-${tag.name}`,
						name: tag.name,
						order: index,
						conversations: 0,
					}));
					return { status: 200, body: { result: { tags: registry } } };
				}
				if (request.op === "sessions.tags") {
					if (toggleFailure) return toggleFailure;
					// A second client wrote this assignment: refuse any revision other
					// than the one now held, the way the real server's 409 does.
					if (
						authoritative &&
						request.expected_revision !== authoritative.tags_revision
					)
						return {
							status: 409,
							body: {
								detail: {
									code: "tags_conflict",
									message: "Tags changed elsewhere",
								},
							},
						};
					const refs = request.tags.flatMap((id) => {
						const tag = registry.find((entry) => entry.id === id);
						return tag ? [{ id: tag.id, name: tag.name }] : [];
					});
					return {
						status: 200,
						body: {
							result: {
								tags: refs,
								primary: request.primary,
								tags_revision: "revision-2",
							},
						},
					};
				}
				if (request.op === "sessions.list")
					return {
						status: 200,
						body: {
							result: {
								sessions: [
									{
										id: "s1",
										name: "Chat",
										mtime: 1,
										tags: [],
										primary: null,
									},
								],
								truncated: false,
							},
						},
					};
				throw new Error(`unarmed op ${request.op}`);
			},
		},
	};
});
after(async () => {
	await act(() => root.render(null));
	dom.window.close();
});

const settle = async () => {
	await act(async () => {
		await new Promise((done) => setTimeout(done, 0));
	});
};
// Two label shapes: buttons whose visible text IS the label, and icon-only
// controls whose label lives in aria-label (the reorder arrows).
const button = (label) =>
	[...document.querySelectorAll("button")].find(
		(node) => node.textContent.trim() === label,
	);
const _labelled = (label) =>
	[...document.querySelectorAll("button")].find(
		(node) => node.getAttribute("aria-label") === label,
	);
// Create is the popover listbox's last OPTION in v3 (spec D1), not a button.
const buttonStartingWith = (label) =>
	[...document.querySelectorAll("[data-tag-create]")].find((node) =>
		node.textContent.trim().startsWith(label),
	);
const footerLine = () =>
	document.querySelector("[data-chat-tag-popover]").textContent;
const _form = (node) => node.closest("form");
const setValue = async (input, value) => {
	await act(() => {
		Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype,
			"value",
		).set.call(input, value);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};
const _submit = async (node) => {
	await act(() => {
		node.dispatchEvent(
			new window.Event("submit", { bubbles: true, cancelable: true }),
		);
	});
	await settle();
};
const _pressEscape = async () => {
	await act(() => {
		document.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Escape",
				code: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
};
const render = async (element) => {
	await act(() => root.render(element));
	await settle();
};
let announced = [];
/*
 * The v3 management surface (spec D2/D3): Alpha's group header (it carries two
 * conversations, so delete asks first) above Beta's, plus the tag footer with
 * Beta as an unused tag. No dialog is mounted for any of it.
 */
const manage = (withPicker = false) => {
	announced = [];
	const announce = (sentence) => announced.push(sentence);
	return render(
		React.createElement(
			"div",
			null,
			React.createElement(api.ChatTagHeader, {
				id: "a",
				name: "Alpha",
				count: 2,
				above: null,
				below: "b",
				announce,
			}),
			React.createElement(api.ChatTagHeader, {
				id: "b",
				name: "Beta",
				count: 1,
				above: "a",
				below: null,
				announce,
			}),
			React.createElement(api.ChatTagFooter, {
				unused: [],
				total: 2,
				dragArmed: false,
				announce,
				chord: "⌘⇧L",
			}),
			withPicker &&
				React.createElement(api.ChatTagPopover, {
					grouped: true,
					onShowGroups: () => {},
					row: {
						session_id: "s1",
						title: "Chat",
						tags: [],
						primary: null,
						tags_revision: "revision-1",
					},
					onClose: () => {},
					returnFocus: () => {},
				}),
		),
	);
};
const dblclick = async (node) => {
	await act(() => {
		node.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
	});
	await settle();
};
const keyOn = async (node, key, options = {}) => {
	await act(() => {
		node.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
				...options,
			}),
		);
	});
	await settle();
};
const headerStop = (id) =>
	document.querySelector(`[data-chat-tag-header="${id}"]`);

test("+ New tag creates in place, stays open for the next one, and needs no Apply", async () => {
	await manage();
	assert.equal(document.querySelector('[role="dialog"]'), null, "no dialog");
	await act(() => document.querySelector("[data-tag-new]").click());
	await settle();
	const field = document.querySelector('[aria-label="New tag name"]');
	assert.ok(field, "the row became a field in place");
	await setValue(field, "Gamma");
	await keyOn(field, "Enter");
	assert.equal(requests.filter((r) => r.op === "tags.replace").length, 1);
	assert.deepEqual(
		requests.find((r) => r.op === "tags.replace").tags.map((tag) => tag.name),
		["Alpha", "Beta", "Gamma"],
	);
	assert.deepEqual(announced, ["Created “Gamma”"]);
	const again = document.querySelector('[aria-label="New tag name"]');
	assert.ok(again, "the field stays open for the next tag");
	assert.equal(again.value, "");
});

test("a duplicate new tag is refused in place with no write", async () => {
	await manage();
	await act(() => document.querySelector("[data-tag-new]").click());
	await settle();
	const field = document.querySelector('[aria-label="New tag name"]');
	await setValue(field, "alpha");
	await keyOn(field, "Enter");
	assert.equal(
		requests.some((r) => r.op === "tags.replace"),
		false,
	);
	assert.equal(field.getAttribute("aria-invalid"), "true");
	assert.match(
		document.querySelector('[role="alert"]').textContent,
		/already exists/,
	);
});

test("double-click renames in place; Enter commits with no Apply step", async () => {
	await manage();
	await dblclick(document.querySelector('[title="Alpha"]'));
	const field = document.querySelector('[aria-label="Rename Alpha"]');
	assert.ok(field, "the name became an input in the header");
	await setValue(field, "Renamed");
	await keyOn(field, "Enter");
	assert.deepEqual(requests.find((r) => r.op === "tags.replace").tags, [
		{ id: "a", name: "Renamed" },
		{ id: "b", name: "Beta" },
	]);
	assert.deepEqual(announced, ["Renamed to “Renamed”"]);
});

test("F2 renames and Escape cancels without writing", async () => {
	await manage();
	await keyOn(headerStop("a"), "F2");
	const field = document.querySelector('[aria-label="Rename Alpha"]');
	assert.ok(field);
	await setValue(field, "Nope");
	await keyOn(field, "Escape");
	assert.equal(document.querySelector('[aria-label="Rename Alpha"]'), null);
	assert.equal(
		requests.some((r) => r.op === "tags.replace"),
		false,
	);
});

test("a refused rename keeps the field open and says why", async () => {
	replaceFailure = { status: 500, body: { detail: { message: "nope" } } };
	await manage();
	await keyOn(headerStop("a"), "F2");
	const field = document.querySelector('[aria-label="Rename Alpha"]');
	await setValue(field, "Renamed");
	await keyOn(field, "Enter");
	assert.ok(document.querySelector('[aria-label="Rename Alpha"]'));
	assert.match(
		document.querySelector('[role="alert"]').textContent,
		/not saved/,
	);
});

test("two headers serialize delayed whole-registry edits without losing an acknowledged rename (C1)", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	replaceGate = () => gate;
	await manage();
	try {
		await keyOn(headerStop("a"), "F2");
		const alpha = document.querySelector('[aria-label="Rename Alpha"]');
		await setValue(alpha, "Alpha2");
		await keyOn(alpha, "Enter");
		await keyOn(headerStop("b"), "F2");
		const beta = document.querySelector('[aria-label="Rename Beta"]');
		await setValue(beta, "Beta2");
		await keyOn(beta, "Enter");
		assert.equal(
			requests.filter((r) => r.op === "tags.replace").length,
			1,
			"the second editor queues an intent, not a stale transport snapshot",
		);
	} finally {
		replaceGate = null;
		await act(async () => {
			release();
			await gate;
		});
		await settle();
	}
	const writes = requests.filter((r) => r.op === "tags.replace");
	assert.deepEqual(
		writes.map((r) => r.tags.map((tag) => tag.name)),
		[
			["Alpha2", "Beta"],
			["Alpha2", "Beta2"],
		],
	);
	assert.deepEqual(
		registry.map((tag) => tag.name),
		["Alpha2", "Beta2"],
	);
	assert.deepEqual(announced, ["Renamed to “Alpha2”", "Renamed to “Beta2”"]);
});

test("picker creation shares header registry ownership and preserves a pending rename (C1)", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	replaceGate = () => gate;
	await manage(true);
	try {
		await keyOn(headerStop("a"), "F2");
		const alpha = document.querySelector('[aria-label="Rename Alpha"]');
		await setValue(alpha, "Alpha2");
		await keyOn(alpha, "Enter");
		const input = document.querySelector('[aria-label="Search tags"]');
		await setValue(input, "Gamma");
		await keyOn(input, "Enter");
		assert.equal(requests.filter((r) => r.op === "tags.replace").length, 1);
	} finally {
		replaceGate = null;
		await act(async () => {
			release();
			await gate;
		});
		await settle();
	}
	const writes = requests.filter((r) => r.op === "tags.replace");
	assert.deepEqual(
		writes.map((r) => r.tags.map((tag) => tag.name)),
		[
			["Alpha2", "Beta"],
			["Alpha2", "Beta", "Gamma"],
		],
	);
	assert.deepEqual(
		registry.map((tag) => tag.name),
		["Alpha2", "Beta", "Gamma"],
	);
	assert.equal(requests.filter((r) => r.op === "sessions.tags").length, 1);
});

test("an older catalogue read cannot overwrite an acknowledged registry edit before the next intent (C1)", async () => {
	let resolveList;
	const old = categories();
	const transport = window.api.desktop.request;
	window.api.desktop.request = async (request) =>
		request.op === "tags.list"
			? new Promise((resolve) => {
					resolveList = () =>
						resolve({ status: 200, body: { result: { tags: old } } });
				})
			: transport(request);
	const listing = api.useSessionTagsStore.getState().fetchCategories();
	await api.useSessionTagsStore.getState().replaceCategories((current) =>
		current.map((tag) => ({
			id: tag.id,
			name: tag.id === "a" ? "Alpha2" : tag.name,
		})),
	);
	resolveList();
	await listing;
	await api.useSessionTagsStore.getState().replaceCategories((current) =>
		current.map((tag) => ({
			id: tag.id,
			name: tag.id === "b" ? "Beta2" : tag.name,
		})),
	);
	assert.deepEqual(
		registry.map((tag) => tag.name),
		["Alpha2", "Beta2"],
	);
});

test("failed blur-save retains the typed rename, alert, retry and focus (C2)", async () => {
	replaceFailure = { status: 500, body: { detail: { message: "nope" } } };
	await manage();
	await keyOn(headerStop("a"), "F2");
	const field = document.querySelector('[aria-label="Rename Alpha"]');
	await setValue(field, "Alpha2");
	await act(() => headerStop("b").focus());
	await settle();
	assert.equal(requests.filter((r) => r.op === "tags.replace").length, 1);
	assert.equal(document.querySelector('[aria-label="Rename Alpha"]'), field);
	assert.equal(field.value, "Alpha2");
	assert.equal(document.activeElement, field);
	assert.ok(document.querySelector('[role="alert"]'));
	assert.ok(button("Retry"), "the save failure stays retryable, not cancelled");
	assert.deepEqual(
		registry.map((tag) => tag.name),
		["Alpha", "Beta"],
	);
	replaceFailure = null;
	await act(() => button("Retry").click());
	await settle();
	assert.deepEqual(
		registry.map((tag) => tag.name),
		["Alpha2", "Beta"],
	);
});

test("Alt+Arrow moves a tag past its visible neighbour; the boundary is a sentence", async () => {
	await manage();
	await keyOn(headerStop("b"), "ArrowUp", { altKey: true });
	assert.deepEqual(
		requests.find((r) => r.op === "tags.replace").tags.map((tag) => tag.id),
		["b", "a"],
	);
	assert.deepEqual(announced, ["Moved “Beta”"]);
	requests = [];
	announced.length = 0;
	await manage();
	await keyOn(headerStop("a"), "ArrowUp", { altKey: true });
	assert.equal(
		requests.some((r) => r.op === "tags.replace"),
		false,
	);
	assert.deepEqual(announced, ["“Alpha” is already the first tag here"]);
});

test("a tag click assigns immediately and keeps the dialog open", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [],
		primary: null,
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	const options = [...document.querySelectorAll('[role="option"]')];
	assert.equal(options.length, 2);
	await act(() => options[0].click());
	await settle();
	const write = requests.find((r) => r.op === "sessions.tags");
	assert.equal(write.tags.length, 1);
	assert.equal(write.primary, "a");
	assert.equal(write.expected_revision, "revision-1");
	assert.equal(closed, 0, "the popover stays open");
	assert.equal(button("Apply"), undefined, "there is no Apply action");
	assert.equal(button("Close"), undefined, "a popover has no Close button");
	assert.equal(
		document.querySelector("[data-chat-tag-popover]").getAttribute("role"),
		"region",
		"the picker is an anchored region, not a modal dialog",
	);
	assert.equal(
		document
			.querySelector("[data-chat-tag-popover]")
			.getAttribute("aria-modal"),
		null,
	);
	assert.match(footerLine(), /Shown under Alpha/);
	assert.deepEqual(globalThis.toasts, [], "no toast: the footer line says it");
});

test("creating a tag from the picker creates AND assigns it, and it appears in the list", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [{ id: "a", name: "Alpha" }],
		primary: "a",
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	await setValue(document.querySelector('[aria-label="Search tags"]'), "Gamma");
	const create = buttonStartingWith("Create “Gamma”");
	assert.ok(create, "the create action is offered from the search field");
	await act(() => create.click());
	await settle();
	const ops = requests.filter((r) => r.op !== "tags.list").map((r) => r.op);
	assert.deepEqual(ops, ["tags.replace", "sessions.tags"]);
	const write = requests.find((r) => r.op === "sessions.tags");
	assert.equal(write.tags.length, 2);
	assert.equal(write.primary, "a", "the existing primary is not displaced");
	const created = registry.find((tag) => tag.name === "Gamma");
	assert.ok(created);
	assert.ok(write.tags.includes(created.id), "the new tag is assigned");
	assert.ok(
		[...document.querySelectorAll('[role="option"]')].some((node) =>
			node.textContent.includes("Gamma"),
		),
		"the new tag is available without reopening the dialog",
	);
	assert.equal(closed, 0);
});

test("a refused assignment restores the previous selection and reports the failure", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [{ id: "a", name: "Alpha" }],
		primary: "a",
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	toggleFailure = {
		status: 500,
		body: { detail: { message: "nope" } },
	};
	const beta = [...document.querySelectorAll('[role="option"]')].find((node) =>
		node.textContent.includes("Beta"),
	);
	await act(() => beta.click());
	await settle();
	assert.equal(
		beta.getAttribute("aria-selected"),
		"false",
		"the optimistic selection is rolled back",
	);
	const alert = document.querySelector('[role="alert"]');
	assert.ok(alert, "the failure is announced");
	assert.match(alert.textContent, /not saved/);
	assert.equal(
		document.querySelector('output[aria-live="polite"]').textContent.trim(),
		"",
		"the optimistic announcement is withdrawn with the rollback",
	);
});

test("a 409 reconciles the authoritative assignment and revision before the next press", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [],
		primary: null,
		tags_revision: "revision-1",
	};
	authoritative = {
		session_id: "s1",
		title: "Chat",
		tags: [{ id: "b", name: "Beta" }],
		primary: "b",
		tags_revision: "revision-2",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	const option = (name) =>
		[...document.querySelectorAll('[role="option"]')].find((node) =>
			node.textContent.includes(name),
		);
	await act(() => option("Alpha").click());
	await settle();
	const refused = requests.filter((request) => request.op === "sessions.tags");
	assert.equal(refused.length, 1);
	assert.equal(refused[0].expected_revision, "revision-1");
	assert.equal(
		option("Alpha").getAttribute("aria-selected"),
		"false",
		"the refused selection is not left showing as applied",
	);
	assert.equal(
		option("Beta").getAttribute("aria-selected"),
		"true",
		"the refreshed assignment replaces the stale selection",
	);
	assert.match(
		document.querySelector('[role="alert"]').textContent,
		/changed elsewhere/i,
	);
	await act(() => option("Alpha").click());
	await settle();
	const writes = requests.filter((request) => request.op === "sessions.tags");
	assert.equal(writes.length, 2);
	assert.equal(
		writes[1].expected_revision,
		"revision-2",
		"the retry carries the refreshed revision, not the stale one",
	);
	assert.deepEqual(writes[1].tags, ["b", "a"]);
	assert.equal(closed, 0, "the picker stays open for the deliberate retry");
});

test("creating the first tag on an untagged conversation confirms that tag, not Untagged", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [],
		primary: null,
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	await setValue(document.querySelector('[aria-label="Search tags"]'), "Gamma");
	await act(() => buttonStartingWith("Create “Gamma”").click());
	await settle();
	assert.match(footerLine(), /Shown under Gamma/);
});

test("the selection cap refuses a ninth tag without writing", async () => {
	registry = Array.from({ length: 9 }, (_, index) => ({
		id: `t${index}`,
		name: `Tag ${index}`,
		order: index,
		conversations: 0,
	}));
	api.useSessionTagsStore.setState({ categories: registry });
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: registry.slice(0, 8).map(({ id, name }) => ({ id, name })),
		primary: "t0",
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	const ninth = [...document.querySelectorAll('[role="option"]')].find((node) =>
		node.textContent.includes("Tag 8"),
	);
	await act(() => ninth.click());
	await settle();
	assert.equal(
		requests.filter((request) => request.op === "sessions.tags").length,
		0,
		"the cap refuses before any write",
	);
	assert.equal(
		ninth.getAttribute("aria-selected"),
		"false",
		"the refused tag is not left showing as applied",
	);
});

test("Show under makes a checked tag primary in one write (replaces the radios)", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [
			{ id: "a", name: "Alpha" },
			{ id: "b", name: "Beta" },
		],
		primary: "a",
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	assert.equal(document.querySelectorAll('input[type="radio"]').length, 0);
	const promote = document.querySelectorAll("[data-tag-show-under]");
	assert.equal(promote.length, 1, "only the non-primary checked tag offers it");
	await act(() => promote[0].click());
	await settle();
	const write = requests.find((request) => request.op === "sessions.tags");
	assert.deepEqual(write.tags, ["a", "b"]);
	assert.equal(write.primary, "b");
	assert.match(footerLine(), /Shown under Beta/);
});

test("Shift+Enter on an unchecked tag adds it AND makes it primary in one write", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [{ id: "a", name: "Alpha" }],
		primary: "a",
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {},
			returnFocus: () => {},
		}),
	);
	const input = document.querySelector('[aria-label="Search tags"]');
	await setValue(input, "Beta");
	await keyOn(input, "Enter", { shiftKey: true });
	const writes = requests.filter((request) => request.op === "sessions.tags");
	assert.equal(writes.length, 1);
	assert.deepEqual(writes[0].tags, ["a", "b"]);
	assert.equal(writes[0].primary, "b");
});

test("Enter on an unmatched name creates and assigns from the keyboard", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [],
		primary: null,
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {},
			returnFocus: () => {},
		}),
	);
	const input = document.querySelector('[aria-label="Search tags"]');
	await setValue(input, "Gamma");
	await keyOn(input, "Enter");
	const ops = requests.filter((r) => r.op !== "tags.list").map((r) => r.op);
	assert.deepEqual(ops, ["tags.replace", "sessions.tags"]);
	assert.equal(input.value, "");
});

test("with grouping off the footer bridges to Show groups", async () => {
	let shown = 0;
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: false,
			onShowGroups: () => {
				shown++;
			},
			row: {
				session_id: "s1",
				title: "Chat",
				tags: [],
				primary: null,
				tags_revision: "revision-1",
			},
			onClose: () => {},
			returnFocus: () => {},
		}),
	);
	assert.match(footerLine(), /Tags are hidden\./);
	await act(() => button("Show groups").click());
	assert.equal(shown, 1);
});

test("a failed create keeps the typed name for correction", async () => {
	replaceFailure = { status: 500, body: { detail: { message: "nope" } } };
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [],
		primary: null,
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatTagPopover, {
			grouped: true,
			onShowGroups: () => {},
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	await setValue(document.querySelector('[aria-label="Search tags"]'), "Gamma");
	await act(() => buttonStartingWith("Create “Gamma”").click());
	await settle();
	assert.equal(
		document.querySelector('[aria-label="Search tags"]').value,
		"Gamma",
		"a failed create leaves the name in place to correct or retry",
	);
	assert.match(
		document.querySelector('[role="alert"]').textContent,
		/not created/i,
	);
});
