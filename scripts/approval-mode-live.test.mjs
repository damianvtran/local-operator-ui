import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * The approval card and the composer's approvals picker read ONE live mode
 * (design round 1, D1 / QA Q1; agent review M1). Mounted for real in jsdom with
 * the shipped `ApprovalEscape` and `ApprovalModePicker` under one QueryClient,
 * against a stubbed desktop route whose `approvals` entity row the test moves.
 * Pinned: opening the picker sends nothing (operator report 2026-11-25: a press
 * used to switch the mode outright), each row takes its own route, a picker
 * choice flips the card's mode line and links, a refused choice says why inside
 * the popover, and an unknown mode still renders the trigger.
 *
 * Rig trimmed from `approvals-slash-pick.test.mjs` (globals before the bundle
 * import, because stores read `localStorage` at module scope).
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
const { window } = dom;
const realSetTimeout = globalThis.setTimeout;
for (const [key, value] of Object.entries({
	window,
	document: window.document,
	localStorage: window.localStorage,
	sessionStorage: window.sessionStorage,
	HTMLElement: window.HTMLElement,
	HTMLButtonElement: window.HTMLButtonElement,
	Element: window.Element,
	Node: window.Node,
	Event: window.Event,
	MouseEvent: window.MouseEvent,
	getComputedStyle: window.getComputedStyle.bind(window),
	IS_REACT_ACT_ENVIRONMENT: true,
	MutationObserver: window.MutationObserver,
	// Radix's popper measures its anchor; jsdom has no layout, so a no-op
	// observer is the whole contract it needs here.
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	DOMRect: window.DOMRect,
	// Radix dispatches its own focus/dismiss events on the document; they must be
	// jsdom's classes, not Node's globals.
	CustomEvent: window.CustomEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	requestAnimationFrame: (callback) => realSetTimeout(() => callback(0), 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
})) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
/*
 * `:modal` IS A JSDOM LANDMINE (same fix as `browser-approvals-route.test.mjs`):
 * floating-ui's top-layer probe calls `matches(":modal")`, which jsdom 26.1.0
 * answers by recursing through its own selector engine (measured here: ~20 s of
 * CPU per popover open). A browser without `:modal` throws a SyntaxError, which
 * floating-ui's own try/catch is written for, so the probe answers that way.
 */
const nativeMatches = window.Element.prototype.matches;
window.Element.prototype.matches = function matches(selector) {
	if (String(selector).includes(":modal")) {
		throw new window.DOMException(
			":modal is not supported here",
			"SyntaxError",
		);
	}
	return nativeMatches.call(this, selector);
};
window.Element.prototype.scrollIntoView = () => {};
window.matchMedia = (media) => ({
	matches: false,
	media,
	addListener() {},
	removeListener() {},
	addEventListener() {},
	removeEventListener() {},
});
window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener() {},
		send() {},
		invoke: async () => ({}),
	},
};

const SESSION = "abcdef123456";
const OTHER_SESSION = "123456abcdef";
const PARTIAL_RECEIPT =
	"tool approvals: auto — every tool runs without asking (this session) — applied for this session but NOT saved for resume (PermissionError)";
const world = {};
const answer = async (request) => {
	if (request.op === "commands.entities") {
		world.reads += 1;
		if (world.readWait) await world.readWait;
		return {
			entities: [{ value: "auto" }, { value: "ask" }],
			current: world.mode,
		};
	}
	if (request.op === "settings.list")
		return {
			settings: [{ key: "tool_approval_mode", value: world.defaultMode }],
		};
	if (request.op === "settings.edit") {
		world.edits.push(`${request.key}=${request.value}`);
		if (world.ignoreDefaultEdit)
			return { key: request.key, value: world.defaultMode };
		world.defaultMode = request.value;
		return { key: request.key, value: request.value };
	}
	if (request.op === "sessions.command") {
		world.commands.push(`${request.command} ${request.args}`);
		if (world.commandWait) await world.commandWait;
		if (world.refuse) return { result: { kind: "block", text: world.refuse } };
		world.mode = request.args;
		return {
			result: world.partial
				? {
						kind: "notice",
						text: PARTIAL_RECEIPT,
						data: { ok: true, approval_saved_for_resume: false },
					}
				: { kind: "notice", text: `Approvals: ${request.args}` },
		};
	}
	return {};
};
const reset = (over = {}) => {
	Object.assign(world, {
		mode: "ask",
		defaultMode: "ask",
		refuse: null,
		partial: false,
		ignoreDefaultEdit: false,
		commandWait: null,
		readWait: null,
		commands: [],
		edits: [],
		reads: 0,
		...over,
	});
};
globalThis.fetch = async (_url, init) => {
	const request = JSON.parse(init?.body ?? "{}");
	return {
		ok: true,
		status: 200,
		json: async () => ({
			status: 200,
			body: { result: await answer(request) },
		}),
	};
};

const bundle = await build({
	stdin: {
		contents: [
			'export { ApprovalEscape } from "./src/renderer/src/features/chat/components/trace/approval-escape";',
			'export { ApprovalModePicker } from "./src/renderer/src/features/chat/session-status/approval-mode";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
			'export { TooltipProvider } from "./src/renderer/src/shared/components/ui/tooltip";',
			'export { PickerHost } from "./src/renderer/src/features/chat/pickers/picker-host";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	write: false,
});
const bundlePath = new URL(
	`./_approval-live-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	ApprovalEscape,
	ApprovalModePicker,
	PickerHost,
	QueryClient,
	QueryClientProvider,
	TooltipProvider,
} = await import(bundlePath.href);
await unlink(bundlePath);
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { act } = React;
const h = React.createElement;

let root;
let client;
after(async () => {
	await unmount();
	dom.window.close();
});
const unmount = async () => {
	await act(async () => {
		root?.unmount();
		client?.clear();
	});
};
const settle = async () => {
	for (let pass = 0; pass < 12; pass++) {
		await act(async () => {
			await new Promise((resolve) => realSetTimeout(resolve, 0));
			await new Promise((resolve) => setImmediate(resolve));
		});
	}
};
const $ = (selector) => window.document.querySelector(selector);
const policyLine = () => $("[data-approval-policy-line]")?.textContent ?? "";
const click = async (element) => {
	assert.ok(element, "the control is mounted");
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await settle();
};

/** The card as the dock mounts it: gate stamped "ask, session" at raise time. */
async function mount() {
	await unmount();
	client = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
	});
	root = createRoot(window.document.getElementById("root"));
	await renderSession(SESSION);
}

async function renderSession(sessionId) {
	await act(async () => {
		root.render(
			h(
				QueryClientProvider,
				{ client },
				h(
					TooltipProvider,
					null,
					h(ApprovalModePicker, { sessionId }),
					h("button", { "data-outside-control": "" }, "Outside"),
					h(ApprovalEscape, {
						sessionId: SESSION,
						approvalMode: "ask",
						approvalProvenance: "session",
					}),
				),
			),
		);
	});
	await settle();
}

const trigger = () => $("[data-approval-mode-trigger]");
const popover = () => $("[data-approval-mode-popover]");
const choice = (key) => $(`[data-approval-choice="${key}"]`);
const receipt = (scope) => $(`[data-approval-mode-notice="${scope}"]`);
const status = () => $("[data-approval-mode-status]");
const current = (key) => choice(key).getAttribute("aria-pressed");
const pressEscape = async () => {
	await act(async () => {
		window.document.activeElement.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
	await settle();
};
/** Open the popover the way a person does: one click on the trigger. */
const openPicker = async () => {
	await click(trigger());
	assert.ok(popover(), "the popover is open");
};

test("opening the picker sends no command and re-reads the mode in the background", async () => {
	reset();
	await mount();
	const readsBefore = world.reads;
	await openPicker();
	assert.deepEqual(world.commands, [], "a click on the trigger never switches");
	assert.deepEqual(world.edits, []);
	assert.equal(trigger().getAttribute("aria-expanded"), "true");
	assert.ok(
		world.reads > readsBefore,
		"opening re-reads the entity row so a stale null catches up",
	);
	// Both scopes, both modes, the current ones checked.
	assert.equal(current("session:ask"), "true");
	assert.equal(current("session:auto"), "false");
	assert.equal(current("all:ask"), "true");
	assert.equal(choice("session:ask").tagName, "BUTTON");
	assert.equal(
		popover().querySelector('[role="radio"], [role="radiogroup"]'),
		null,
	);
	assert.match(popover().textContent, /dangerous-delete review still apply/);
	assert.equal(window.document.activeElement, choice("session:ask"));
	await pressEscape();
	assert.equal(popover(), null);
	assert.equal(
		window.document.activeElement,
		trigger(),
		"Escape returns to the real trigger",
	);
	assert.deepEqual(world.commands, []);
	assert.deepEqual(world.edits, []);
});

test("D1/Q1: a session choice takes the live-gate route and flips the card's mode line", async () => {
	reset();
	await mount();
	assert.match(policyLine(), /Approvals: Ask — session override/);
	assert.equal(
		$("[data-approval-escape-ask]"),
		null,
		"no way back while asking",
	);
	assert.equal(trigger().dataset.mode, "ask");

	await openPicker();
	await click(choice("session:auto"));
	assert.deepEqual(world.commands, ["approvals auto"]);
	assert.deepEqual(world.edits, [], "this session never writes the default");
	assert.equal(trigger().dataset.mode, "auto");
	assert.equal(popover(), null, "a saved choice closes the popover");
	assert.equal(
		window.document.activeElement,
		trigger(),
		"success returns to the real trigger",
	);
	assert.equal(
		status().textContent,
		"",
		"an older receipt does not imply failed persistence",
	);
	assert.match(policyLine(), /Approvals: Auto — session override/);
	const back = $("[data-approval-escape-ask]");
	assert.ok(back, "Always ask appears once the live mode is auto");
	assert.equal(back.getAttribute("title"), "This session only");

	await openPicker();
	await click(choice("session:ask"));
	assert.deepEqual(world.commands, ["approvals auto", "approvals ask"]);
	assert.match(policyLine(), /Approvals: Ask — session override/);
	assert.equal($("[data-approval-escape-ask]"), null);
});

test("all-sessions choices write only the default in both directions", async () => {
	reset();
	await mount();
	await openPicker();
	await click(choice("all:auto"));
	assert.deepEqual(world.edits, ["tool_approval_mode=auto"]);
	assert.deepEqual(world.commands, [], "no session override was sent");
	assert.equal(trigger().dataset.mode, "ask", "the pinned session stays Ask");

	await openPicker();
	assert.equal(current("all:auto"), "true");
	assert.equal(current("session:ask"), "true");
	assert.doesNotMatch(
		popover().textContent,
		/session override/i,
		"the picker displays values, not inferred provenance",
	);
	await click(choice("all:ask"));
	assert.deepEqual(world.edits, [
		"tool_approval_mode=auto",
		"tool_approval_mode=ask",
	]);
	assert.deepEqual(world.commands, []);
	assert.equal(trigger().dataset.mode, "ask");
});

test("M1: explicit Ask reaches the owner while a held refresh leaves cached Ask checked", async () => {
	reset();
	await mount();
	world.mode = "auto";
	const refresh = Promise.withResolvers();
	world.readWait = refresh.promise;
	try {
		await openPicker();
		assert.equal(current("session:ask"), "true", "the open read is still held");
		assert.deepEqual(world.commands, [], "open does not write");
		await click(choice("session:ask"));
		assert.deepEqual(world.commands, ["approvals ask"]);
		assert.equal(world.mode, "ask", "the owner actually re-armed");
		assert.deepEqual(world.edits, []);
		assert.equal(popover(), null);
	} finally {
		world.readWait = null;
		refresh.resolve();
		await settle();
	}
	await openPicker();
	await click(choice("all:ask"));
	assert.deepEqual(
		world.edits,
		["tool_approval_mode=ask"],
		"a checked default does not swallow an explicit edit either",
	);
	assert.deepEqual(world.commands, ["approvals ask"]);
});

test("D1: the card's confirmation clears when the picker moves the mode away from it", async () => {
	reset();
	await mount();
	await click($("[data-approval-escape-session]"));
	assert.match(
		$("[data-approval-escape-status]").textContent,
		/Auto for this session/,
	);
	assert.equal($("[data-approval-escape-session]").dataset.state, "done");

	await openPicker();
	await click(choice("session:ask"));
	assert.equal(world.mode, "ask");
	assert.equal($("[data-approval-escape-status]").textContent, "");
	assert.equal($("[data-approval-escape-session]").dataset.state, "idle");
	assert.match(policyLine(), /Approvals: Ask/);
});

test("U4: pending and refusal keep the acted-on row focused and block a second write", async () => {
	const reply = Promise.withResolvers();
	reset({
		commandWait: reply.promise,
		refuse: "this conversation holds a teammate's message",
	});
	await mount();
	await openPicker();
	const row = choice("session:auto");
	try {
		await act(async () => row.focus());
		await click(row);
		assert.equal(row.getAttribute("aria-disabled"), "true");
		assert.equal(row.getAttribute("aria-busy"), "true");
		assert.equal(window.document.activeElement, row);
		await click(choice("all:auto"));
		assert.deepEqual(world.commands, ["approvals auto"]);
		assert.deepEqual(world.edits, []);
	} finally {
		reply.resolve();
		await settle();
	}
	assert.equal(window.document.activeElement, row);
	assert.equal(row.hasAttribute("aria-disabled"), false);
	assert.equal(trigger().dataset.mode, "ask");
	assert.ok(popover(), "a refusal keeps the popover open");
	assert.match(
		receipt("session").textContent,
		/Unchanged: this conversation holds a teammate's message/,
	);
	assert.equal(receipt("all"), null);
	assert.match(
		policyLine(),
		/Approvals: Ask/,
		"the card never claims the refused mode",
	);
});

for (const partial of [false, true]) {
	test(`Q2/U2: dismissed ${partial ? "partial live save" : "refusal"} is announced and survives reopen`, async () => {
		const reply = Promise.withResolvers();
		reset({
			commandWait: reply.promise,
			partial,
			refuse: partial ? null : "operator consent required",
		});
		await mount();
		await openPicker();
		try {
			await click(choice("session:auto"));
			assert.equal(choice("session:auto").getAttribute("aria-busy"), "true");
			await pressEscape();
			assert.equal(popover(), null, "a pending press never traps the user");
			assert.equal(window.document.activeElement, trigger());
			assert.equal(
				status().textContent,
				"",
				"there is no receipt before the reply",
			);
		} finally {
			reply.resolve();
			await settle();
		}
		assert.equal(popover(), null);
		assert.equal(
			trigger().dataset.mode,
			partial ? "auto" : "ask",
			"the expected live re-read has landed",
		);
		assert.ok(
			trigger().querySelector(".lucide-shield-alert"),
			"a closed picker marks the result",
		);
		assert.equal(trigger().getAttribute("aria-describedby"), status().id);
		const expected = partial
			? PARTIAL_RECEIPT
			: "Unchanged: operator consent required";
		assert.equal(status().textContent, `This session: ${expected}`);
		await openPicker();
		assert.equal(receipt("session").textContent, expected);
		assert.equal(receipt("all"), null);
		await pressEscape();
		await openPicker();
		assert.equal(
			receipt("session").textContent,
			expected,
			"repeated dismissal does not consume the receipt",
		);
		world.partial = false;
		world.refuse = null;
		await click(choice("session:ask"));
		assert.equal(status().textContent, "", "a deliberate new choice clears it");
	});
}

test("session switches discard a stale in-flight result", async () => {
	const reply = Promise.withResolvers();
	reset({ commandWait: reply.promise, refuse: "old session refusal" });
	await mount();
	await openPicker();
	try {
		await click(choice("session:auto"));
		await renderSession(OTHER_SESSION);
		assert.equal(popover(), null);
		assert.equal(trigger().hasAttribute("aria-busy"), false);
	} finally {
		reply.resolve();
		await settle();
	}
	await openPicker();
	assert.equal(status().textContent, "");
	assert.equal(receipt("session"), null);
});

test("M3: a nonmatching typed setting receipt is not presented as a save", async () => {
	reset({ ignoreDefaultEdit: true });
	await mount();
	await openPicker();
	await click(choice("all:auto"));
	assert.deepEqual(world.edits, ["tool_approval_mode=auto"]);
	assert.deepEqual(world.commands, []);
	assert.equal(current("all:ask"), "true");
	assert.equal(receipt("all").textContent, "The default was not saved");
	assert.equal(receipt("session"), null);
});

test("M4: the card's combined write refreshes the mounted picker's default cache", async () => {
	reset({ refuse: "operator consent required" });
	await mount();
	const key = ["desktop", "settings", "tool_approval_mode"];
	assert.equal(client.getQueryData(key).value, "ask");
	await click($("[data-approval-escape-all]"));
	assert.deepEqual(world.edits, ["tool_approval_mode=auto"]);
	assert.deepEqual(world.commands, ["approvals auto"]);
	assert.equal(
		client.getQueryData(key).value,
		"auto",
		"the cache moved without opening the picker",
	);
	assert.match(
		$("[data-approval-escape-status]").textContent,
		/session part did not apply/,
	);
});

test("an unknown mode still renders the trigger, and it still opens", async () => {
	reset({ mode: null });
	await mount();
	assert.ok(
		trigger(),
		"the trigger does not disappear when the mode is unknown",
	);
	assert.equal(trigger().dataset.mode, "unknown");
	assert.match(trigger().textContent, /Approvals/);
	await openPicker();
	assert.equal(current("session:ask"), "false");
	assert.equal(current("session:auto"), "false");
	assert.match(
		choice("session:ask").closest("fieldset").textContent,
		/Unknown/,
	);
	assert.equal(window.document.activeElement, choice("session:ask"));
	assert.deepEqual(world.commands, []);
});

test("the separately owned approvals trigger dismisses an anchored effort picker in the same flex group", async () => {
	reset();
	await mount();
	function Rail() {
		const [anchor, setAnchor] = React.useState(null);
		const [effortOpen, setEffortOpen] = React.useState(true);
		const attach = React.useCallback((node) => {
			// A connected, visible origin takes PickerHost's anchored path.
			if (node)
				node.getClientRects = () => [new window.DOMRect(10, 40, 30, 25)];
			setAnchor(node);
		}, []);
		return h(
			"div",
			{ className: "composer-dock-pickers" },
			h(
				"div",
				{ className: "composer-dock-picker-host" },
				h(
					"button",
					{ ref: attach, "data-composer-picker": "effort" },
					"Effort",
				),
			),
			h(ApprovalModePicker, { sessionId: SESSION }),
			anchor &&
				h(PickerHost, {
					open: effortOpen,
					onClose: () => setEffortOpen(false),
					quick: { kind: "effort", anchor },
					title: "Effort",
					options: [{ value: "low", label: "Low" }],
				}),
		);
	}
	await act(async () =>
		root.render(h(QueryClientProvider, { client }, h(Rail))),
	);
	await settle();
	assert.equal($("[data-quick-picker]").dataset.pickerPlacement, "anchored");
	await act(async () => {
		trigger().dispatchEvent(
			new window.MouseEvent("pointerdown", { bubbles: true }),
		);
	});
	await openPicker();
	assert.equal(
		$("[data-quick-picker]"),
		null,
		"both pickers must not stay open",
	);
	assert.deepEqual(world.commands, []);
	assert.deepEqual(world.edits, []);
});

test("outside dismissal leaves focus on the control the user moved to", async () => {
	reset();
	await mount();
	await openPicker();
	const outside = $("[data-outside-control]");
	await act(async () => {
		outside.dispatchEvent(
			new window.MouseEvent("pointerdown", { bubbles: true }),
		);
		outside.focus();
	});
	// Radix defers primary-button outside dismissal until the click completes.
	await click(outside);
	assert.ok(!popover(), "the outside interaction dismisses the dialog");
	assert.ok(
		window.document.activeElement === outside,
		`outside focus was replaced with ${window.document.activeElement?.outerHTML.slice(0, 140)}`,
	);
	assert.deepEqual(world.commands, []);
	assert.deepEqual(world.edits, []);
});
