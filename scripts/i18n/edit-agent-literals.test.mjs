import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE EDIT-EXISTING-AGENT SURFACE'S ENGLISH THAT WAS NEVER A KEY.
 *
 * `agent-detail.tsx` printed seven English sentences from CODE (seven call
 * sites: five newly keyed, two on reused keys), in every language, and the
 * string ratchet could not see them because each one is an EXPRESSION ARGUMENT (`setError("...")`, a ternary arm, a call argument),
 * not JSX text or an attribute:
 *
 *   specialist meta fact   `kind === "specialist" ? "Specialist" : null`
 *   tool name grammar      `setEntryError("Tool names are letters, ...")`
 *   duplicate tool         `setEntryError("That tool is already listed.")`
 *   empty instructions     `setError("Give the agent instructions.")` (the EDIT
 *                          save; the create form already had a key for it)
 *   save fallback          `... : "The agent could not be saved."`
 *   install fallback       `... : "The agent could not be installed."`
 *   ask-for-a-change text  `` `Change the agent ${profile.name}: ` `` pre-filled
 *                          into the chat composer
 *
 * Two properties, for two readers (same contract as
 * `s18d-english-source-copy.test.mjs`, whose harness this follows):
 *
 * 1. ENGLISH IS BYTE-IDENTICAL to what the code printed before the keys
 *    existed. The expected strings below are LITERALS copied from the old
 *    source, never read back from the catalogue, so a catalogue edit cannot
 *    quietly move the pin.
 * 2. A REGISTERED PROBE LOCALE REACHES EACH SURFACE, switching LIVE on a tree
 *    that was mounted and driven in English. The probes are markers, not
 *    translations (translations live in `src/i18n/catalogues/<locale>/`).
 *
 * THE CONTROL IS REAL: `EDIT_AGENT_CONTROL_BASE=<sha> node --test <this file>`
 * loads `agent-detail.tsx` from that commit instead of the working tree. On the
 * parent of the keying commit the English pins PASS and every probe assertion
 * FAILS, which proves the pins describe the old output and the probes
 * discriminate.
 *
 * SCOPE NOTE: the two "could not be saved/installed" fallbacks are reached with
 * `onSaved` throwing a non-Error value AFTER a successful write: every failure
 * `desktopResult` itself raises is an Error carrying its own message, so the
 * fallback only runs for a thrown non-Error. That is the honest way to execute
 * the very `caught instanceof Error ? ... : <fallback>` arm.
 */

const ROOT = process.cwd();
const controlBase = process.env.EDIT_AGENT_CONTROL_BASE;
const DETAIL = "src/renderer/src/features/agents/components/agent-detail.tsx";

const baseSource = (path) =>
	execFileSync("git", ["show", `${controlBase}:${path}`], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

/* Hoisted: biome's `useTopLevelRegex`. */
const TSX_FILE = /\.tsx$/;

const controlPlugin = {
	name: "pre-fix-agent-detail-control",
	setup(builder) {
		builder.onLoad({ filter: TSX_FILE }, ({ path }) => {
			if (relative(ROOT, path) !== DETAIL) return undefined;
			return {
				contents: baseSource(DETAIL),
				loader: "tsx",
				resolveDir: dirname(path),
			};
		});
	},
};

/* jsdom BEFORE the bundle is imported: shared modules touch `window` at import. */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
for (const name of [
	"Element",
	"Node",
	"Event",
	"CustomEvent",
	"KeyboardEvent",
	"MouseEvent",
	"HTMLElement",
	"HTMLFormElement",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"HTMLButtonElement",
	"SVGElement",
	"DocumentFragment",
	"MutationObserver",
	"ResizeObserver",
	"requestAnimationFrame",
	"cancelAnimationFrame",
]) {
	globalThis[name] = dom.window[name];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.matchMedia ??= (query) => ({
	matches: false,
	media: query,
	onchange: null,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
});
const { createRoot } = await import("react-dom/client");
after(() => {
	dom.window.close();
	for (const name of ["window", "document", "localStorage"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const bundle = await build({
	stdin: {
		contents: `export { AgentDetail, AgentCreate } from "./${DETAIL}";
export { toast } from "sonner";
export { MemoryRouter } from "react-router-dom";
export { setLocale, registerCatalogue, clearRegisteredCatalogues, t } from "./src/i18n";`,
		resolveDir: ROOT,
	},
	plugins: controlBase ? [controlPlugin] : [],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
});
// A FILE, not a data: URL: `react` stays external and a data: module cannot
// resolve a bare specifier.
const bundlePath = new URL(
	"./_edit-agent-literals.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let mod;
try {
	mod = await import(bundlePath.href);
} finally {
	await unlink(bundlePath);
}
const {
	AgentDetail,
	AgentCreate,
	toast,
	MemoryRouter,
	setLocale,
	registerCatalogue,
	clearRegisteredCatalogues,
	t,
} = mod;

const catalogue = (ns) =>
	JSON.parse(
		readFileSync(join(ROOT, `src/i18n/catalogues/en/${ns}.json`), "utf8"),
	);
const sidecar = (ns) =>
	JSON.parse(
		readFileSync(
			join(ROOT, `src/i18n/catalogues/en/${ns}.context.json`),
			"utf8",
		),
	);

/* key -> [namespace file, params, the English the OLD code printed]. */
const KEYS = {
	"ui.agents.detail.edit.error_generic": [
		"ui.agents.detail",
		{},
		"The agent could not be saved.",
	],
	"ui.agents.detail.install.error_generic": [
		"ui.agents.detail.install",
		{},
		"The agent could not be installed.",
	],
	"ui.agents.detail.tools.error_grammar": [
		"ui.agents.detail",
		{},
		"Tool names are letters, digits, dot, underscore, dash or colon.",
	],
	"ui.agents.detail.tools.error_duplicate": [
		"ui.agents.detail",
		{},
		"That tool is already listed.",
	],
	"ui.agents.detail.ask_change_prefill": [
		"ui.agents.detail",
		{ name: "coder" },
		"Change the agent coder: ",
	],
	/* REUSED, not new: the create form's sentence now also serves the edit save. */
	"ui.agents.detail.create.error_instructions_required": [
		"ui.agents.detail",
		{},
		"Give the agent instructions.",
	],
	"ui.hub.teams.kind.specialist": ["ui.hub.teams", {}, "Specialist"],
};

test("every key edit-agent reads exists, has a context entry, and renders the old English", () => {
	setLocale("en");
	for (const [key, [ns, args, english]] of Object.entries(KEYS)) {
		assert.ok(key in catalogue(ns), `${key} is in ${ns}.json`);
		const context = sidecar(ns)[key];
		assert.ok(context, `${key} has a context entry`);
		assert.deepEqual(
			Object.keys(context.placeholders ?? {}).sort(),
			Object.keys(args).sort(),
			`${key}'s sidecar documents exactly its placeholders`,
		);
		assert.equal(t(key, args), english, key);
	}
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/* Markers, not translations: each carries the key's last segment so a surface
 * wired to the WRONG key fails, and the placeholder value so a dropped
 * argument fails. */
const PROBE = {
	...Object.fromEntries(
		Object.keys(KEYS).map((k) => [k, `FR[${k.split(".").slice(-1)}]`]),
	),
	"ui.agents.detail.ask_change_prefill": "FR[ask_change_prefill]{name}",
};

async function switchToProbe() {
	await act(async () => {
		registerCatalogue("fr", PROBE);
		setLocale("fr");
		await flush();
	});
}

async function backToEnglish() {
	await act(async () => {
		clearRegisteredCatalogues();
		setLocale("en");
		await flush();
	});
}

const PROFILE = {
	name: "coder",
	kind: "role",
	source: "custom",
	/* null: the picture field mounts only for a profile with an id, and it
	 * brings its own queries, which this slice does not exercise. */
	agent_id: null,
	description: "Writes code.",
	instructions: "Write the code.",
	tools: ["shell"],
	effort: null,
	delegate: false,
};

async function mountDetail(profile, props = {}) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{
					client: new QueryClient({
						defaultOptions: { queries: { retry: false } },
					}),
				},
				React.createElement(
					MemoryRouter,
					null,
					React.createElement(AgentDetail, {
						profile,
						displayedName: profile.name,
						classNotice: null,
						onClassNotice: () => {},
						teams: [],
						effortTiers: [],
						askEnabled: false,
						onSaved: () => {},
						onDuplicate: () => {},
						onOpenTeam: () => {},
						onAskAgent: () => {},
						...props,
					}),
				),
			),
		);
		await flush();
	});
	const buttonByText = (label) => {
		const found = [...host.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === label,
		);
		assert.ok(found, `a "${label}" button is on screen`);
		return found;
	};
	const fieldFor = (labelText) => {
		const label = [...host.querySelectorAll("label")].find((l) =>
			l.textContent?.trim().startsWith(labelText),
		);
		assert.ok(label?.htmlFor, `a "${labelText}" label is on screen`);
		return document.getElementById(label.htmlFor);
	};
	return {
		host,
		text: () => host.textContent ?? "",
		buttonByText,
		fieldFor,
		async click(element) {
			await act(async () => {
				element.dispatchEvent(
					new window.MouseEvent("click", { bubbles: true, cancelable: true }),
				);
				await flush();
			});
		},
		async setValue(field, value) {
			const proto =
				field.tagName === "TEXTAREA"
					? window.HTMLTextAreaElement.prototype
					: window.HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
			await act(async () => {
				field.dispatchEvent(new window.Event("input", { bubbles: true }));
				await flush();
			});
		},
		async pressEnter(field) {
			await act(async () => {
				field.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
				await flush();
			});
		},
		async submit() {
			const form = host.querySelector("form");
			assert.ok(form, "the form is on screen");
			await act(async () => {
				form.dispatchEvent(
					new window.Event("submit", { bubbles: true, cancelable: true }),
				);
				await flush();
			});
		},
		async unmount() {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

/* A write the backend accepts; the fallbacks run when what follows throws a
 * non-Error (see SCOPE NOTE). */
const acceptWrites = (profile) => {
	dom.window.api = {
		desktop: {
			request: async () => ({ status: 200, body: { result: profile } }),
		},
	};
};
const throwsAString = () => {
	throw "not an Error";
};

/*
 * One scenario per surface. `drive(mounted, ctx)` runs in ENGLISH, on the live
 * tree, up to the moment before the sentence is produced and returns the step
 * that produces it; the harness then (for the probe run) switches the language
 * on that same mounted tree and fires the step, so what is read is what a
 * reader in the active language sees the next time the surface speaks.
 */
const SCENARIOS = [
	{
		name: "specialist meta fact",
		profile: { ...PROFILE, kind: "specialist" },
		english: "Custom · Specialist",
		marker: "FR[specialist]",
		/* A render-time read: the switch alone repaints it. */
		async drive() {
			return async () => {};
		},
	},
	{
		name: "ask-for-a-change composer text",
		props: () => {
			const sent = [];
			return {
				props: { askEnabled: true, onAskAgent: (p) => sent.push(p) },
				sent,
			};
		},
		english: "Change the agent coder: ",
		marker: "FR[ask_change_prefill]coder",
		async drive(m) {
			const ask = m.buttonByText("Ask for a change");
			return async () => m.click(ask);
		},
		observe: (_m, ctx) => ctx.sent.at(-1) ?? "",
	},
	{
		name: "edit save with empty instructions",
		english: "Give the agent instructions.",
		marker: "FR[error_instructions_required]",
		async drive(m) {
			await m.click(m.buttonByText("Edit"));
			await m.setValue(m.fieldFor("Instructions"), "");
			return async () => m.submit();
		},
	},
	{
		name: "edit save fallback",
		english: "The agent could not be saved.",
		marker: "FR[error_generic]",
		props: () => ({ props: { onSaved: throwsAString } }),
		async drive(m) {
			acceptWrites(PROFILE);
			await m.click(m.buttonByText("Edit"));
			await m.setValue(
				m.fieldFor("When to use this agent"),
				"Writes code well.",
			);
			return async () => m.submit();
		},
	},
	{
		name: "install fallback",
		profile: { ...PROFILE, source: "builtin" },
		english: "The agent could not be installed.",
		marker: "FR[error_generic]",
		props: () => ({ props: { onSaved: throwsAString } }),
		async drive(m) {
			acceptWrites({ ...PROFILE, source: "installed" });
			const install = m.buttonByText("Install to edit");
			return async () => m.click(install);
		},
	},
	{
		name: "tool name grammar",
		english: "Tool names are letters, digits, dot, underscore, dash or colon.",
		marker: "FR[error_grammar]",
		async drive(m) {
			await m.click(m.buttonByText("Edit"));
			const input = m.host.querySelector("input[placeholder='Tool name']");
			assert.ok(input, "the tool-name input is on screen");
			await m.setValue(input, "bad name!");
			return async () => m.pressEnter(input);
		},
	},
	{
		name: "duplicate tool",
		english: "That tool is already listed.",
		marker: "FR[error_duplicate]",
		async drive(m) {
			await m.click(m.buttonByText("Edit"));
			const input = m.host.querySelector("input[placeholder='Tool name']");
			assert.ok(input, "the tool-name input is on screen");
			await m.setValue(input, "shell");
			return async () => m.pressEnter(input);
		},
	},
];

for (const scenario of SCENARIOS) {
	for (const probed of [false, true]) {
		test(`${scenario.name}: ${probed ? "follows a live language switch" : "prints the old English"}`, async () => {
			setLocale("en");
			const ctx = scenario.props?.() ?? { props: {} };
			const profile = scenario.profile ?? PROFILE;
			const mounted = await mountDetail(profile, ctx.props);
			try {
				const fire = await scenario.drive(mounted);
				if (probed) await switchToProbe();
				await fire();
				const seen = scenario.observe
					? scenario.observe(mounted, ctx)
					: mounted.text();
				const expected = probed ? scenario.marker : scenario.english;
				assert.ok(
					seen.includes(expected),
					`${scenario.name}: expected ${JSON.stringify(expected)} in ${JSON.stringify(seen.slice(0, 600))}`,
				);
				/* The probe must REPLACE the English, not sit beside it. */
				if (probed) {
					assert.ok(
						!seen.includes(scenario.english),
						`${scenario.name}: ${JSON.stringify(scenario.english)} must be gone in the probe locale`,
					);
				}
			} finally {
				Reflect.deleteProperty(dom.window, "api");
				await mounted.unmount();
				await backToEnglish();
			}
		});
	}
}

/*
 * THE COMPOSER TEXT IS DATA, NOT DISPLAY (ur audit finding, 2026-11-17).
 *
 * `ask_change_prefill` is pre-filled into the chat composer and the operator
 * SENDS it to the assistant ("Change the agent <name>: ..."). `translate()`
 * wraps a Latin-led argument in FSI...PDI (U+2068/U+2069) for an RTL catalogue
 * (`src/i18n/bidi.ts`), so in Urdu the agent name would reach the assistant with
 * invisible controls around it and could stop it matching the agent by name.
 * Text that leaves the UI as data asks for `translateRaw` (messages.ts).
 *
 * The VALUE under test is the REAL ur catalogue string, not a marker: the
 * defect is in what the real value does to the argument, and a marker with no
 * RTL text would not select the isolating path in a way that reflects shipping
 * copy. English is unaffected (an LTR answer is never isolated) and is pinned
 * by the scenario above.
 *
 * CONTROL: `EDIT_AGENT_CONTROL_BASE=<sha>` loads the pre-fix `agent-detail.tsx`;
 * on the commit that keyed the string (which called `t()`), the isolate
 * assertion FAILS and the `t()` sanity assertion (that the hazard is real) still
 * PASSES.
 */
const BIDI_ISOLATE = /[\u2066-\u2069]/;

test("ask-for-a-change composer text carries no bidi isolates in an RTL language", async () => {
	const ur = JSON.parse(
		readFileSync(
			join(ROOT, "src/i18n/catalogues/ur/ui.agents.detail.json"),
			"utf8",
		),
	);
	const key = "ui.agents.detail.ask_change_prefill";
	assert.ok(ur[key], "the ur catalogue has the prefill");

	const sent = [];
	const mounted = await mountDetail(PROFILE, {
		askEnabled: true,
		onAskAgent: (p) => sent.push(p),
	});
	try {
		const ask = mounted.buttonByText("Ask for a change");
		await act(async () => {
			registerCatalogue("ur", { [key]: ur[key] });
			setLocale("ur");
			await flush();
		});
		/* The hazard is real: the DISPLAY path isolates the name in ur. */
		assert.match(
			t(key, { name: "coder" }),
			BIDI_ISOLATE,
			"sanity: t() isolates a Latin name in an RTL catalogue",
		);
		await mounted.click(ask);
		const text = sent.at(-1) ?? "";
		assert.ok(text.includes("coder"), `the name is in ${JSON.stringify(text)}`);
		assert.ok(
			!BIDI_ISOLATE.test(text),
			`no U+2066-2069 may travel to the assistant: ${JSON.stringify(text)}`,
		);
		assert.equal(text, ur[key].replace("{name}", "coder"));
	} finally {
		await mounted.unmount();
		await backToEnglish();
	}
});

/*
 * THE BACKEND-UNREACHABLE FAILURE (QA round 1, Q1).
 *
 * The seven sentences above are the PROMPT-side English. The failure side had
 * one more: when the backend cannot be reached main answers with its own
 * transport sentence ("The backend could not complete this request. Check its
 * connection and try again."), and the save alert, the install alert, the
 * install toast and the create form's alert printed it verbatim in EVERY
 * language. `agent-detail.tsx` now words that refusal with the catalogue's
 * `ui.common.errors.desktop_transport_failed` (the key the read-state pane
 * already uses) and routes every other desktop error through
 * `userFacingMessage`.
 *
 * Three properties, on the REAL failure path (a `window.api.desktop.request`
 * answering the shapes main and the dev proxy produce, through the real
 * `desktopResult` -> `DesktopControlError` -> `refusalCopy` chain):
 *   1. English is unchanged: the transport sentence reads as it did.
 *   2. A registered probe locale and the REAL ur value replace it, on a tree
 *      that was mounted in English and then switched live.
 *   3. An authored backend refusal still comes out exactly as before: the
 *      known name-taken shape is recognised and a sentence nobody mapped is
 *      passed through unchanged.
 * CONTROL: `EDIT_AGENT_CONTROL_BASE=<sha>` loads the pre-fix `agent-detail.tsx`;
 * on any parent of this fix the English and authored-refusal rows PASS and every
 * translated row FAILS, which is what makes the rows discriminate.
 */
const TRANSPORT_ENGLISH =
	"The backend could not complete this request. Check its connection and try again.";
const TRANSPORT_KEY = "ui.common.errors.desktop_transport_failed";
const TAKEN_BODY = "role 'coder' already exists; use op='update' to change it.";
const AUTHORED_BODY = "The backend refused this change for its own reasons.";
const ur = JSON.parse(
	readFileSync(
		join(ROOT, "src/i18n/catalogues/ur/ui.common.errors.json"),
		"utf8",
	),
);

/* The shapes the transport can answer with. `declared`: main's own relay
 * (`detail` carries `transport.failed` and the sentence). `bare`: the dev proxy,
 * which forwards the sentence without declaring a code. */
const answers = {
	declared: {
		status: 503,
		body: {
			detail: { code: "transport.failed", message: TRANSPORT_ENGLISH },
		},
	},
	bare: { status: 503, body: { detail: TRANSPORT_ENGLISH } },
	taken: { status: 409, body: { detail: TAKEN_BODY } },
	authored: { status: 400, body: { detail: AUTHORED_BODY } },
};
const answerWith = (answer) => {
	dom.window.api = {
		desktop: { request: async () => answer },
	};
};

/* Record what the install path hands the toast. `toast.error` is the leaf under
 * `showErrorToast`; the manager's own dedup means each distinct sentence is shown
 * once per run, which every row below respects by speaking a different one. */
const toasts = [];
const realToastError = toast.error;
toast.error = (message, ...rest) => {
	toasts.push(String(message));
	return realToastError.call(toast, message, ...rest);
};

async function mountCreateForm() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{
					client: new QueryClient({
						defaultOptions: { queries: { retry: false } },
					}),
				},
				React.createElement(
					MemoryRouter,
					null,
					React.createElement(AgentCreate, {
						takenNames: [],
						effortTiers: [],
						onSaved: () => {},
						onCancel: () => {},
					}),
				),
			),
		);
		await flush();
	});
	const fill = async (target, value) => {
		const field =
			typeof target === "string" ? host.querySelector(target) : target;
		assert.ok(field, `${String(target)} is on the form`);
		const proto =
			field.tagName === "TEXTAREA"
				? window.HTMLTextAreaElement.prototype
				: window.HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
		await act(async () => {
			field.dispatchEvent(new window.Event("input", { bubbles: true }));
			await flush();
		});
	};
	return {
		text: () => host.textContent ?? "",
		async fillValid() {
			await fill("#agent-create-name", "aida");
			const instructions = [...host.querySelectorAll("textarea")].at(-1);
			assert.ok(instructions, "an instructions textarea is on the form");
			await fill(instructions, "Help with sums.");
		},
		async submit() {
			const form = host.querySelector("form");
			assert.ok(form, "the form is on screen");
			await act(async () => {
				form.dispatchEvent(
					new window.Event("submit", { bubbles: true, cancelable: true }),
				);
				await flush();
			});
		},
		async unmount() {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

/* surface -> how to reach the failing write, and where the sentence lands. */
const WRITE_SURFACES = {
	"edit save": {
		async open(answer) {
			const m = await mountDetail(PROFILE);
			answerWith(answer);
			await m.click(m.buttonByText("Edit"));
			await m.setValue(
				m.fieldFor("When to use this agent"),
				"Writes code well.",
			);
			return { m, fire: () => m.submit(), read: () => m.text() };
		},
	},
	"install alert": {
		async open(answer) {
			const m = await mountDetail({ ...PROFILE, source: "builtin" });
			answerWith(answer);
			const install = m.buttonByText("Install to edit");
			const before = toasts.length;
			return {
				m,
				fire: () => m.click(install),
				read: () => m.text(),
				/* The same failure also raises a toast (`showErrorToast(copy.message)`).
				 * `toast-manager` shows one toast per distinct sentence per period, so
				 * only the rows that speak a sentence for the first time assert it. */
				toast: () => toasts.slice(before).join(" | "),
			};
		},
	},
	"create alert": {
		async open(answer) {
			const m = await mountCreateForm();
			answerWith(answer);
			await m.fillValid();
			return { m, fire: () => m.submit(), read: () => m.text() };
		},
	},
};

const switchTo = async (locale, values) => {
	await act(async () => {
		registerCatalogue(locale, values);
		setLocale(locale);
		await flush();
	});
};

for (const [surface, { open }] of Object.entries(WRITE_SURFACES)) {
	for (const shape of ["declared", "bare"]) {
		test(`${surface}: backend unreachable (${shape}) reads as it did in English`, async () => {
			setLocale("en");
			const { m, fire, read, toast: toastText } = await open(answers[shape]);
			try {
				await fire();
				assert.ok(
					read().includes(TRANSPORT_ENGLISH),
					`${surface}: ${JSON.stringify(read().slice(0, 500))}`,
				);
				if (toastText && shape === "declared")
					assert.ok(
						toastText().includes(TRANSPORT_ENGLISH),
						`${surface} toast: ${JSON.stringify(toastText())}`,
					);
			} finally {
				Reflect.deleteProperty(dom.window, "api");
				await m.unmount();
				await backToEnglish();
			}
		});

		test(`${surface}: backend unreachable (${shape}) follows a live switch to a probe locale`, async () => {
			setLocale("en");
			const { m, fire, read, toast: toastText } = await open(answers[shape]);
			try {
				await switchTo("fr", {
					[TRANSPORT_KEY]: "FR[desktop_transport_failed]",
				});
				await fire();
				const seen = read();
				assert.ok(
					seen.includes("FR[desktop_transport_failed]"),
					`${surface}: ${JSON.stringify(seen.slice(0, 500))}`,
				);
				assert.ok(
					!seen.includes(TRANSPORT_ENGLISH),
					`${surface}: the English transport sentence must be gone`,
				);
				if (toastText && shape === "declared")
					assert.equal(
						toastText(),
						"FR[desktop_transport_failed]",
						`${surface} toast`,
					);
			} finally {
				Reflect.deleteProperty(dom.window, "api");
				await m.unmount();
				await backToEnglish();
			}
		});
	}

	test(`${surface}: backend unreachable says the REAL Urdu sentence, no English`, async () => {
		setLocale("en");
		const { m, fire, read, toast: toastText } = await open(answers.declared);
		try {
			await switchTo("ur", { [TRANSPORT_KEY]: ur[TRANSPORT_KEY] });
			await fire();
			const seen = read();
			assert.ok(ur[TRANSPORT_KEY], "the ur catalogue has the sentence");
			/* The isolating wrapper does not apply (no placeholder), so the value
			 * appears as-is. */
			assert.ok(
				seen.includes(ur[TRANSPORT_KEY]),
				`${surface}: ${JSON.stringify(seen.slice(0, 500))}`,
			);
			assert.ok(
				!seen.includes(TRANSPORT_ENGLISH),
				`${surface}: the English transport sentence must be gone`,
			);
			if (toastText)
				assert.equal(toastText(), ur[TRANSPORT_KEY], `${surface} toast`);
		} finally {
			Reflect.deleteProperty(dom.window, "api");
			await m.unmount();
			await backToEnglish();
		}
	});
}

/* AUTHORED REFUSALS ARE NOT SWALLOWED. The edit save and the create form
 * accept the backend's own sentences: a known shape is routed by
 * `backend-copy.ts` (name taken -> its catalogue sentence), anything else is
 * shown as the backend wrote it. Both are unchanged by this fix. */
for (const surface of ["edit save", "create alert"]) {
	test(`${surface}: an authored backend refusal still passes through unchanged`, async () => {
		setLocale("en");
		{
			const { m, fire, read } = await WRITE_SURFACES[surface].open(
				answers.authored,
			);
			try {
				await fire();
				assert.ok(
					read().includes(AUTHORED_BODY),
					`${surface}: ${JSON.stringify(read().slice(0, 500))}`,
				);
			} finally {
				Reflect.deleteProperty(dom.window, "api");
				await m.unmount();
			}
		}
		/* A name refusal belongs to a field only the create form has: the edit
		 * form cannot rename, so its pane carries no name field to show it beside. */
		if (surface !== "create alert") return;
		const { m, fire, read } = await WRITE_SURFACES[surface].open(answers.taken);
		try {
			await fire();
			const seen = read();
			assert.ok(
				seen.includes("An agent called “coder” already exists."),
				`${surface}: ${JSON.stringify(seen.slice(0, 500))}`,
			);
			assert.ok(
				!seen.includes("op='update'"),
				`${surface}: the tool's own vocabulary stays out`,
			);
		} finally {
			Reflect.deleteProperty(dom.window, "api");
			await m.unmount();
			await backToEnglish();
		}
	});
}
