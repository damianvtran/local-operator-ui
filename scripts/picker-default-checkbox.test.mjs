/**
 * The "Also make it the default ... for new sessions" checkbox, executable.
 *
 *     node --test scripts/picker-default-checkbox.test.mjs
 *
 * Operator report (2026-10-15): ticking the box in the Reasoning effort and Model
 * pickers persisted nothing - `config.yml` kept its old `model_effort` /
 * `hosting` / `model_name`, so a new session opened on the old default. The app's
 * own access log had the session commands and no `PATCH /v1/settings/...` at
 * all. The operator's order was "change the effort level, then check the box":
 * the box was read ONLY at the moment of a pick, so a tick after the pick, or a
 * tick on a dialog opened just to make the current level the default, wrote
 * nothing while the label claimed "This pick also sets the default".
 *
 * What this drives is the SHIPPED `EffortPicker` and `ModelPicker` in a real DOM,
 * through their real checkbox and real rows, against a faked TRANSFER
 * (`desktopResult`) and nothing else. The assertion surface is the list of
 * `settings.edit` requests the pickers made, which is exactly what the defect
 * was missing.
 *
 * What this is NOT: evidence that the backend wrote the file. The registry write
 * itself is the daemon's and is covered there; the real-app run against an
 * isolated daemon is in the pull request.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, afterEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chat",
});
/*
 * Assigned through `globalise` rather than declared, because some of these names
 * are getters on modern Node's global object (`navigator` on 26). The set and the
 * stubs below are `reload-picker-close.test.mjs`'s: the same Radix dialog mounted
 * through the same host.
 */
const globalise = (name, value) => {
	try {
		globalThis[name] = value;
	} catch {
		Object.defineProperty(globalThis, name, { value, configurable: true });
	}
};
for (const name of [
	"window",
	"document",
	"navigator",
	"localStorage",
	"HTMLElement",
	"HTMLInputElement",
	"HTMLButtonElement",
	"Element",
	"Node",
	"KeyboardEvent",
	"MouseEvent",
	"Event",
	"CustomEvent",
	"FocusEvent",
	"getComputedStyle",
	"MutationObserver",
]) {
	globalise(name, name === "window" ? DOM.window : DOM.window[name]);
}
globalise("PointerEvent", DOM.window.PointerEvent ?? DOM.window.MouseEvent);
globalise("IS_REACT_ACT_ENVIRONMENT", true);
DOM.window.HTMLCanvasElement.prototype.getContext = () => null;
globalise("requestAnimationFrame", (callback) => setTimeout(callback, 0));
globalise("cancelAnimationFrame", (handle) => clearTimeout(handle));
globalise("matchMedia", (query) => ({
	matches: false,
	media: String(query),
	onchange: null,
	addEventListener: () => {},
	removeEventListener: () => {},
	addListener: () => {},
	removeListener: () => {},
	dispatchEvent: () => false,
}));
globalise(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);
DOM.window.Element.prototype.scrollTo = () => {};
DOM.window.Element.prototype.scrollIntoView = () => {};
after(() => {
	DOM.window.close();
});

const ROOT = process.cwd();
const CACHE = join(ROOT, "node_modules/.cache/picker-default-checkbox");
const ANY_MODULE = /.*/;
// The rows each case picks, hoisted for the tree's `useTopLevelRegex` rule.
const XHIGH_ROW = /^xHigh$/;
const LOW_ROW = /^Low$/;
const SONNET_ROW = /Claude Sonnet 5\.5/;
const SEAM_NAMES =
	/^(@shared\/api\/local-operator\/desktop-api|@shared\/themes)$/;

/*
 * THE TWO SEAMS. `desktopResult` is the transfer - faking it is what lets a case
 * read every request the picker made and choose the owner's answer. The theme
 * barrel reaches modules that import `@mui/material/styles` as a bare directory,
 * which Node's ESM resolver refuses, and no case here asks about themes.
 */
const stubs = {
	"@shared/api/local-operator/desktop-api": `
		export * from "${resolve("src/renderer/src/shared/api/local-operator/desktop-api.ts")}";
		export const desktopResult = (request) => globalThis.__desktopResult(request);
	`,
	"@shared/themes": `
		export const DEFAULT_THEME = "localOperatorDark";
		export const themes = {};
	`,
};

const bundle = await build({
	stdin: {
		contents: `
			export { EffortPicker, ModelPicker } from "./src/renderer/src/features/chat/pickers/destination-pickers";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	// React stays OUT of the bundle so the module under test uses this process's
	// React - the one `createRoot` below is holding.
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": resolve("src/renderer/src/shared"),
		"@features": resolve("src/renderer/src/features"),
		"@renderer": resolve("src/renderer/src"),
	},
	plugins: [
		{
			name: "picker-seams",
			setup(builder) {
				builder.onResolve({ filter: SEAM_NAMES }, (args) => ({
					path: args.path,
					namespace: "picker-seam",
				}));
				builder.onLoad(
					{ filter: ANY_MODULE, namespace: "picker-seam" },
					(args) => ({
						contents: stubs[args.path],
						loader: "js",
						resolveDir: ROOT,
					}),
				);
			},
		},
	],
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, `pickers-${process.pid}.mjs`);
writeFileSync(bundlePath, bundle.outputFiles[0].text);

const { EffortPicker, ModelPicker, QueryClient, QueryClientProvider } =
	await import(pathToFileURL(bundlePath).href);
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");

/* ------------------------------------------------------------------ harness */

const SESSION_MODEL = { provider: "anthropic", model_id: "claude-opus-5-5" };
const catalogueRow = (provider, model_id, label) => ({
	selector: `${provider}/${model_id}`,
	provider,
	model_id,
	label,
	connected: true,
	context_window: 200_000,
	input_price: 3,
	output_price: 15,
	default_context_window: null,
	max_context_window: null,
	aggregated: false,
});
const CATALOGUE = {
	models: [
		catalogueRow("anthropic", "claude-opus-5-5", "Claude Opus 5.5"),
		catalogueRow("anthropic", "claude-sonnet-5-5", "Claude Sonnet 5.5"),
	],
	source: "initial",
	errors: {},
	credentials_known: true,
};

/** Every request the mounted picker made, in order. */
let requests = [];
/** Settles the next owner command; replaced per case to hold it in flight. */
let commandGate = () => Promise.resolve();
/** Settles the next settings write; replaced per case to hold or fail it. */
let settingsGate = () => Promise.resolve();
/** `config.yml` as the faked daemon holds it, updated when a write resolves. */
let config = {};
/**
 * The rung the owner is on. The entity list's `current` answers with it, so a
 * dialog that re-reads the list sees the switch - and one that reads a cached
 * list does not, which is the stale read review round 1 (M1) filed.
 */
let ownerRung = "high";
/**
 * The owner's answer to a command, by default an accepted one. A case replaces
 * it to refuse (a warning notice) or to fail the transport (a throw).
 */
const acceptCommand = (request) => ({
	command: request.command,
	result: {
		kind: "notice",
		style: "info",
		text:
			request.command === "effort"
				? `effort: ${request.args}`
				: `model: anthropic/claude-opus-5-5 → ${request.args} (this session)`,
		data: {},
	},
});
let commandAnswer = acceptCommand;

globalThis.__desktopResult = async (request) => {
	requests.push(request);
	switch (request.op) {
		case "commands.entities":
			return {
				entities: ["low", "medium", "high", "xhigh"].map((value) => ({
					value,
				})),
				current: ownerRung,
			};
		case "models.catalogue":
			return CATALOGUE;
		case "sessions.command": {
			await commandGate();
			const receipt = commandAnswer(request);
			if (request.command === "effort" && receipt.result.style === "info")
				ownerRung = request.args;
			return receipt;
		}
		case "settings.edit":
			await settingsGate(request);
			// The daemon's file, as it stands when each write LANDS.
			config[request.key] = request.value;
			return { key: request.key, value: request.value };
		default:
			return {};
	}
};

/** The `settings.edit` writes, as `key=value` strings. */
const writes = () =>
	requests
		.filter((request) => request.op === "settings.edit")
		.map((request) => `${request.key}=${request.value}`);

const settle = () =>
	act(async () => {
		for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 5));
	});

/** A promise a case releases by hand, to hold a request in flight. */
const held = () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	return { gate: () => gate, release: () => release() };
};

const newClient = () =>
	/*
	 * `gcTime: Infinity` and the `clear()` on unmount: react-query's default
	 * five-minute garbage-collection timer otherwise keeps this process alive for
	 * five minutes after the last case has passed (measured: 302 s for nine
	 * sub-second cases).
	 */
	new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});

/**
 * `client`: pass one to share the query cache across mounts, the way the app
 * shares one across dialog opens. `model`: the session frame's model, which is
 * what the status chip reads.
 */
const mount = async (
	Picker,
	{ client: shared, model = SESSION_MODEL, reset = true } = {},
) => {
	const client = shared ?? newClient();
	document.body.innerHTML = "";
	if (reset) {
		requests = [];
		commandGate = () => Promise.resolve();
		settingsGate = () => Promise.resolve();
		commandAnswer = acceptCommand;
		config = {};
		ownerRung = "high";
	}
	const ownsClient = !shared;
	const notes = [];
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	const render = (frameModel) =>
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(Picker, {
					action: {
						kind: "native_action",
						destination: "session.effort",
						session_id: "session-1",
						args: "",
						fields: [],
						data: {},
					},
					spec: {},
					sessionId: "session-1",
					canonical: {
						frontend: { selected_model: frameModel },
						paintPendingModel: () => {},
						clearPendingModel: () => {},
					},
					commands: [],
					onClose: () => {},
					note: (text, error) => notes.push({ text, error }),
					dispatch: () => {},
					rebind: () => {},
				}),
			),
		);
	await act(async () => render(model));
	await settle();
	const unmount = async () => {
		if (!mounted.has(unmount)) return;
		mounted.delete(unmount);
		await act(async () => root.unmount());
		// A shared client outlives this dialog, as the app's does across opens.
		if (ownsClient) client.clear();
		container.remove();
	};
	mounted.add(unmount);
	/** A new owner frame, as the session stream delivers one. */
	const rerender = async (frameModel) => {
		await act(async () => render(frameModel));
		await settle();
	};
	return { notes, unmount, rerender };
};

/*
 * A FAILING case must not leave its dialog mounted: Radix's focus scope and the
 * query client keep the process alive, and the file then never finishes - the
 * failure is reported as a hang rather than as the assertion that failed.
 */
const mounted = new Set();
afterEach(async () => {
	for (const unmount of [...mounted]) await unmount();
});

/** Click the dialog's default checkbox, the way a pointer does. */
const tick = async () => {
	const box = document.querySelector('[role="dialog"] [role="checkbox"]');
	assert.ok(box, "the dialog offers the default checkbox");
	await act(async () => {
		box.dispatchEvent(new DOM.window.MouseEvent("click", { bubbles: true }));
	});
	await settle();
	return box.getAttribute("data-state");
};

/** Pick the row whose text matches, through the row's own mousedown. */
const pick = async (pattern) => {
	const row = [...document.querySelectorAll('[role="option"]')].find((o) =>
		pattern.test(o.textContent ?? ""),
	);
	assert.ok(row, `a row matching ${pattern} is offered`);
	await act(async () => {
		row.dispatchEvent(
			new DOM.window.MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
	});
	await settle();
};

const dialogSays = (text) =>
	(document.querySelector('[role="dialog"]')?.textContent ?? "").includes(text);

/* -------------------------------------------------------------------- effort */

test("effort: tick then pick saves the picked rung (the path that already worked)", async () => {
	const run = await mount(EffortPicker);
	assert.equal(await tick(), "checked");
	await pick(XHIGH_ROW);
	/*
	 * The LAST write, not the whole list: this order already worked before the
	 * change, and the tick now also saves the rung in force on its own (the case
	 * below), so the claim this case keeps is that the pick's rung is what ends
	 * up saved.
	 */
	assert.equal(
		writes().at(-1),
		"model_effort=xhigh",
		"the pick saves its own rung",
	);
	assert.ok(dialogSays("Default effort for new sessions: xHigh."));
	await run.unmount();
});

test("effort: pick then tick saves the rung just picked", async () => {
	const run = await mount(EffortPicker);
	await pick(XHIGH_ROW);
	assert.deepEqual(writes(), [], "an unticked pick writes no default");
	await tick();
	assert.deepEqual(
		writes(),
		["model_effort=xhigh"],
		"ticking after the switch saves the rung the owner accepted, not the stale cached one",
	);
	assert.ok(dialogSays("Default effort for new sessions: xHigh."));
	await run.unmount();
});

test("effort: a tick with no pick in this open saves the session's current rung", async () => {
	const run = await mount(EffortPicker);
	await tick();
	assert.deepEqual(writes(), ["model_effort=high"]);
	assert.ok(dialogSays("Default effort for new sessions: High."));
	await run.unmount();
});

test("effort: a tick during an in-flight switch saves once, the rung it lands on", async () => {
	const run = await mount(EffortPicker);
	let release;
	commandGate = () =>
		new Promise((r) => {
			release = r;
		});
	await pick(LOW_ROW);
	await tick();
	assert.deepEqual(
		writes(),
		[],
		"nothing is written while the switch is pending",
	);
	await act(async () => release());
	await settle();
	assert.deepEqual(writes(), ["model_effort=low"]);
	await run.unmount();
});

test("effort: unticking writes nothing", async () => {
	const run = await mount(EffortPicker);
	await tick();
	requests = [];
	assert.equal(await tick(), "unchecked");
	assert.deepEqual(writes(), []);
	await run.unmount();
});

/* --------------------------------------------------------------------- model */

test("model: tick then pick saves the picked model (the path that already worked)", async () => {
	const run = await mount(ModelPicker);
	assert.equal(await tick(), "checked");
	await pick(SONNET_ROW);
	// The last pair, for the reason the effort case gives.
	assert.deepEqual(writes().slice(-2), [
		"hosting=anthropic",
		"model_name=claude-sonnet-5-5",
	]);
	assert.ok(
		dialogSays("Default for new sessions: anthropic/claude-sonnet-5-5"),
	);
	await run.unmount();
});

test("model: pick then tick saves the model just picked", async () => {
	const run = await mount(ModelPicker);
	await pick(SONNET_ROW);
	assert.deepEqual(writes(), [], "an unticked pick writes no default");
	await tick();
	assert.deepEqual(writes(), [
		"hosting=anthropic",
		"model_name=claude-sonnet-5-5",
	]);
	assert.ok(
		dialogSays("Default for new sessions: anthropic/claude-sonnet-5-5"),
	);
	await run.unmount();
});

test("model: a tick with no pick in this open saves the session's current model", async () => {
	const run = await mount(ModelPicker);
	await tick();
	assert.deepEqual(writes(), [
		"hosting=anthropic",
		"model_name=claude-opus-5-5",
	]);
	assert.ok(dialogSays("Default for new sessions: anthropic/claude-opus-5-5"));
	await run.unmount();
});

test("model: unticking writes nothing", async () => {
	const run = await mount(ModelPicker);
	await tick();
	requests = [];
	assert.equal(await tick(), "unchecked");
	assert.deepEqual(writes(), []);
	await run.unmount();
});

/* --------------------------------------------- review round 1 remediation */

const withRung = (rung) => ({ ...SESSION_MODEL, reasoning_effort: rung });
const refuseCommand = (request) => ({
	command: request.command,
	result:
		request.command === "effort"
			? {
					kind: "notice",
					style: "warning",
					text: `claude-opus-5-5 does not accept '${request.args}'`,
					data: {},
				}
			: {
					kind: "error",
					style: "error",
					text: `${request.args} is not available`,
					data: {},
				},
});
const failTransport = () => {
	throw new Error("the backend could not complete this request");
};
/** The rows marked as the one in force (the ✓). */
const markedRows = () =>
	[...document.querySelectorAll('[role="option"]')]
		.filter((row) => row.querySelector("svg"))
		.map((row) => row.textContent?.trim());
const checkbox = () =>
	document.querySelector('[role="dialog"] [role="checkbox"]');
const label = () =>
	document.querySelector(`label[for="${checkbox()?.id}"]`)?.textContent ?? "";

/*
 * M1 / U1 / Q1. The app shares ONE query client across dialog opens, and the
 * entity list is cached for 15 s, so a dialog reopened right after a switch read
 * the rung the session had LEFT. The chip reads the session frame; so must the
 * tick.
 */
test("effort: a dialog reopened within the cache window saves the rung the chip shows", async () => {
	const client = newClient();
	const first = await mount(EffortPicker, { client, model: withRung("high") });
	await pick(LOW_ROW);
	assert.deepEqual(writes(), [], "an unticked pick writes no default");
	await first.unmount();
	// The owner's next frame names the rung it switched to: that is the chip.
	const second = await mount(EffortPicker, {
		client,
		model: withRung("low"),
		reset: false,
	});
	// The ✓ and the tick read one answer, so the row marked is the rung saved.
	assert.deepEqual(markedRows(), ["Low"]);
	requests = [];
	await tick();
	assert.deepEqual(writes(), ["model_effort=low"]);
	assert.equal(config.model_effort, "low");
	assert.ok(dialogSays("Default effort for new sessions: Low."));
	await second.unmount();
	client.clear();
});

/*
 * U2. The pick's default is the last write config.yml sees. A pick made while
 * the tick's save is still out is refused by the busy dialog (it does not run a
 * switch behind a pending save), and the pick after it lands last.
 */
test("effort: a tick's save that resolves late cannot land after the pick's", async () => {
	const run = await mount(EffortPicker, { model: withRung("high") });
	const late = held();
	settingsGate = late.gate;
	await tick();
	await pick(XHIGH_ROW);
	assert.equal(
		requests.filter((request) => request.op === "sessions.command").length,
		0,
		"no switch starts while the tick's save is pending",
	);
	settingsGate = () => Promise.resolve();
	await act(async () => late.release());
	await settle();
	assert.equal(config.model_effort, "high");
	await pick(XHIGH_ROW);
	assert.deepEqual(writes(), ["model_effort=high", "model_effort=xhigh"]);
	assert.equal(config.model_effort, "xhigh", "the pick's save lands last");
	assert.ok(dialogSays("Default effort for new sessions: xHigh."));
	assert.ok(!dialogSays("Default effort for new sessions: High."));
	await run.unmount();
});

/* m1 / Q2. The tick DID save a default; the refusal must not deny it. */
test("effort: a refused pick after a tick's save says the default stays", async () => {
	const run = await mount(EffortPicker, { model: withRung("high") });
	await tick();
	commandAnswer = refuseCommand;
	await pick(XHIGH_ROW);
	assert.deepEqual(writes(), ["model_effort=high"]);
	assert.ok(
		dialogSays("Effort not changed. Default for new sessions stays High."),
	);
	assert.ok(!dialogSays("The effort default was not saved"));
	await run.unmount();
});

/* m2. A tick during a switch that then fails is answered, in both pickers. */
test("effort: a tick during a switch whose transport fails says the default was not saved", async () => {
	const run = await mount(EffortPicker, { model: withRung("high") });
	const owner = held();
	commandGate = owner.gate;
	commandAnswer = failTransport;
	await pick(LOW_ROW);
	await tick();
	await act(async () => owner.release());
	await settle();
	assert.deepEqual(writes(), []);
	assert.ok(dialogSays("The effort default was not saved."));
	await run.unmount();
});

test("model: a tick during a switch the owner refuses says the default was not saved", async () => {
	const run = await mount(ModelPicker);
	const owner = held();
	commandGate = owner.gate;
	commandAnswer = refuseCommand;
	await pick(SONNET_ROW);
	await tick();
	await act(async () => owner.release());
	await settle();
	assert.deepEqual(writes(), []);
	assert.ok(dialogSays("The default was not saved."));
	await run.unmount();
});

/* U3. A save is not a switch; a failed save unticks so re-ticking retries. */
test("effort: a tick's save reads as saving, and a failed save unticks the box", async () => {
	const run = await mount(EffortPicker, { model: withRung("high") });
	const save = held();
	settingsGate = save.gate;
	await tick();
	assert.ok(dialogSays("Saving the default…"));
	assert.ok(!dialogSays("Switching the effort…"));
	await act(async () => save.release());
	await settle();
	// Untick, then a tick whose save the daemon refuses.
	await tick();
	settingsGate = () => Promise.reject(new Error("settings refused"));
	requests = [];
	await tick();
	assert.deepEqual(writes(), ["model_effort=high"], "the retry was sent");
	assert.ok(dialogSays("The effort default was not saved"));
	assert.equal(
		checkbox()?.getAttribute("data-state"),
		"unchecked",
		"a failed save leaves the box unticked, so ticking again is the retry",
	);
	await run.unmount();
});

/* U4. An untick writes nothing, and the last save's line goes with it. */
test("effort: an untick clears the success line and writes nothing", async () => {
	const run = await mount(EffortPicker, { model: withRung("high") });
	await tick();
	assert.ok(dialogSays("Default effort for new sessions: High."));
	requests = [];
	assert.equal(await tick(), "unchecked");
	assert.deepEqual(writes(), []);
	assert.ok(!dialogSays("Default effort for new sessions: High."));
	await run.unmount();
});

/* U5. Ticked, the label states what was saved - no pick is implied. */
test("effort and model: the ticked label names the saved default after a tick-only save", async () => {
	const effort = await mount(EffortPicker, { model: withRung("high") });
	await tick();
	assert.match(
		label(),
		/Default effort for new sessions: High\. Picks here update it too\./,
	);
	assert.doesNotMatch(label(), /This pick/);
	await effort.unmount();
	const model = await mount(ModelPicker);
	await tick();
	assert.match(
		label(),
		/Default for new sessions: anthropic\/claude-opus-5-5\. Picks here update it too\./,
	);
	await model.unmount();
});

/*
 * Review n1 / UX U8. Right after a pick, the owner's frame still names the old
 * model; the tick saved the picked one and the button saved the old one.
 */
test("model: 'Set current model as default' saves the same model the tick would", async () => {
	const run = await mount(ModelPicker);
	await pick(SONNET_ROW);
	const button = [...document.querySelectorAll('[role="dialog"] button')].find(
		(candidate) => candidate.textContent === "Set current model as default",
	);
	assert.ok(button, "the dialog offers the button");
	await act(async () => {
		button.dispatchEvent(new DOM.window.MouseEvent("click", { bubbles: true }));
	});
	await settle();
	assert.deepEqual(writes(), [
		"hosting=anthropic",
		"model_name=claude-sonnet-5-5",
	]);
	await run.unmount();
});

/*
 * The ✓ moves with an accepted pick before the owner's next frame arrives, so
 * it marks the rung a tick would save (the remediation's first rig build: the session was on
 * xHigh, the ✓ still sat on Medium).
 */
test("effort: after a pick, the ✓ marks the rung a tick saves", async () => {
	const run = await mount(EffortPicker, { model: withRung("high") });
	await pick(XHIGH_ROW);
	assert.deepEqual(markedRows(), ["xHigh"]);
	await tick();
	assert.deepEqual(writes(), ["model_effort=xhigh"]);
	await run.unmount();
});
