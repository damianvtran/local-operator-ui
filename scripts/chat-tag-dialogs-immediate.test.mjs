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

const require = createRequire(import.meta.url);
const bundled = await build({
	stdin: {
		contents:
			'export {ManageTagsDialog} from "./src/renderer/src/features/chat/components/manage-tags-dialog"; export {ChatSessionTagsDialog} from "./src/renderer/src/features/chat/components/chat-session-tags-dialog"; export {useSessionTagsStore} from "./src/renderer/src/shared/store/session-tags-store"; export {useCanonicalSessionsStore} from "./src/renderer/src/shared/store/canonical-sessions-store";',
		resolveDir: process.cwd(),
	},
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
	plugins: [
		{
			name: "tag-dialog-fixtures",
			setup(builder) {
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
			},
		},
	],
});
const api = await import(
	`data:text/javascript;base64,${Buffer.from(`${bundled.outputFiles[0].text}\n//# sourceURL=chat-tag-dialogs-fixture.mjs`).toString("base64")}`
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
const labelled = (label) =>
	[...document.querySelectorAll("button")].find(
		(node) => node.getAttribute("aria-label") === label,
	);
const buttonStartingWith = (label) =>
	[...document.querySelectorAll("button")].find((node) =>
		node.textContent.trim().startsWith(label),
	);
const form = (node) => node.closest("form");
const setValue = async (input, value) => {
	await act(() => {
		Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype,
			"value",
		).set.call(input, value);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};
const submit = async (node) => {
	await act(() => {
		node.dispatchEvent(
			new window.Event("submit", { bubbles: true, cancelable: true }),
		);
	});
	await settle();
};
const pressEscape = async () => {
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
const manage = () =>
	render(
		React.createElement(api.ManageTagsDialog, {
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);

test("manage creates on the Add action and the new tag is in the list immediately", async () => {
	await manage();
	assert.equal(button("Apply"), undefined, "no Apply action");
	assert.equal(button("Cancel"), undefined, "no dialog-wide Cancel");
	await setValue(
		document.querySelector('[aria-label="New tag name"]'),
		"Gamma",
	);
	await submit(form(button("Add")));
	assert.equal(requests.filter((r) => r.op === "tags.replace").length, 1);
	assert.deepEqual(
		requests.find((r) => r.op === "tags.replace").tags.map((tag) => tag.name),
		["Alpha", "Beta", "Gamma"],
	);
	assert.ok(
		[...document.querySelectorAll("li")].some((node) =>
			node.textContent.includes("Gamma"),
		),
		"the committed tag renders without a second action",
	);
});

test("manage rename persists on Save with no Apply step", async () => {
	await manage();
	await act(() => button("Rename").click());
	await setValue(
		document.querySelector('[aria-label="Rename Alpha"]'),
		"Renamed",
	);
	await submit(form(button("Save")));
	assert.deepEqual(requests.find((r) => r.op === "tags.replace").tags, [
		{ id: "a", name: "Renamed" },
		{ id: "b", name: "Beta" },
	]);
});

test("manage delete is guarded per action, and Escape dismisses the guard without writing", async () => {
	await manage();
	await act(() => button("Delete").click());
	await settle();
	assert.equal(
		requests.some((r) => r.op === "tags.replace"),
		false,
	);
	assert.ok(button("Delete tag"), "the confirmation is scoped to this tag");
	await pressEscape();
	assert.equal(button("Delete tag"), undefined, "Escape closes the guard");
	assert.equal(
		requests.some((r) => r.op === "tags.replace"),
		false,
	);
	assert.equal(closed, 0, "Escape in a sub-action does not close the dialog");
	await act(() => button("Delete").click());
	await settle();
	await act(() => button("Delete tag").click());
	await settle();
	assert.deepEqual(requests.find((r) => r.op === "tags.replace").tags, [
		{ id: "b", name: "Beta" },
	]);
});

test("manage reorder writes the new order immediately", async () => {
	await manage();
	await act(() => labelled("Move Beta up").click());
	await settle();
	assert.deepEqual(
		requests.find((r) => r.op === "tags.replace").tags.map((tag) => tag.id),
		["b", "a"],
	);
});

test("manage Escape closes without writing or reverting", async () => {
	await manage();
	await pressEscape();
	assert.equal(closed, 1);
	assert.equal(
		requests.some((r) => r.op === "tags.replace"),
		false,
	);
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
		React.createElement(api.ChatSessionTagsDialog, {
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
	assert.equal(closed, 0, "the picker stays open");
	assert.equal(button("Apply"), undefined, "there is no Apply action");
	assert.ok(button("Close"));
	assert.deepEqual(
		globalThis.toasts,
		["Tags updated. Grouped under Alpha."],
		"the confirmation names the group the write returned",
	);
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
		React.createElement(api.ChatSessionTagsDialog, {
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
		React.createElement(api.ChatSessionTagsDialog, {
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
		React.createElement(api.ChatSessionTagsDialog, {
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
		React.createElement(api.ChatSessionTagsDialog, {
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
	assert.deepEqual(globalThis.toasts, ["Tags updated. Grouped under Gamma."]);
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
		React.createElement(api.ChatSessionTagsDialog, {
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

test("choosing a different primary writes it immediately", async () => {
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
		React.createElement(api.ChatSessionTagsDialog, {
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	const radios = [...document.querySelectorAll('input[type="radio"]')];
	assert.equal(radios.length, 2, "one radio per selected tag");
	await act(() => radios[1].click());
	await settle();
	const write = requests.find((request) => request.op === "sessions.tags");
	assert.deepEqual(write.tags, ["a", "b"]);
	assert.equal(write.primary, "b");
});

test("Clear removes every assignment in one write", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [{ id: "a", name: "Alpha" }],
		primary: "a",
		tags_revision: "revision-1",
	};
	await render(
		React.createElement(api.ChatSessionTagsDialog, {
			row,
			onClose: () => {
				closed++;
			},
			returnFocus: () => {},
		}),
	);
	await act(() => button("Clear tags").click());
	await settle();
	const write = requests.find((request) => request.op === "sessions.tags");
	assert.deepEqual(write.tags, []);
	assert.equal(write.primary, null);
	assert.deepEqual(globalThis.toasts, ["Tags updated. Shown under Untagged."]);
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
		React.createElement(api.ChatSessionTagsDialog, {
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

test("Escape collapses the picker list, then closes the dialog, without writing", async () => {
	const row = {
		session_id: "s1",
		title: "Chat",
		tags: [{ id: "a", name: "Alpha" }],
		primary: "a",
		tags_revision: "revision-1",
	};
	const seen = [];
	/*
	 * THE SIDEBAR'S OWN SHAPE, and it is load-bearing: `tagRow` becomes null when
	 * the dialog asks to close, so a dismissed dialog unmounts instead of lingering
	 * mounted with `open` still true. That is also what ends Radix's focus scope;
	 * a dialog that asked to close but stays mounted keeps re-trapping focus, and
	 * driving that state twice was the case that ran away in an earlier harness.
	 */
	const Picker = () => {
		const [open, setOpen] = React.useState(true);
		if (!open) return null;
		return React.createElement(api.ChatSessionTagsDialog, {
			row,
			onClose: () => {
				seen.push("closed");
				setOpen(false);
			},
			returnFocus: () => {},
		});
	};
	await render(React.createElement(Picker));
	const alpha = () =>
		[...document.querySelectorAll('[role="option"]')].find((node) =>
			node.textContent.includes("Alpha"),
		);
	assert.equal(alpha().getAttribute("aria-selected"), "true");
	assert.equal(
		document
			.querySelector('[aria-label="Search tags"]')
			.getAttribute("aria-expanded"),
		"true",
		"the suggestion list starts open",
	);

	await pressEscape();
	assert.equal(
		document.querySelector('[role="option"]'),
		null,
		"the first Escape only collapses the list",
	);
	assert.ok(document.querySelector('[role="dialog"]'), "the dialog stays open");
	assert.equal(seen.length, 0, "and asks for no close");
	assert.ok(
		document.querySelector('[title="Alpha"]'),
		"the committed selection is untouched",
	);

	await pressEscape();
	assert.deepEqual(seen, ["closed"], "the second Escape asks to close");
	assert.equal(
		document.querySelector('[role="dialog"]'),
		null,
		"and the dialog unmounts",
	);
	assert.equal(
		requests.filter((request) => request.op === "sessions.tags").length,
		0,
		"neither Escape writes an assignment",
	);
});
