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
 * S18d: THE ENGLISH THAT WAS NEVER A KEY. Three surfaces painted English in
 * every language for the same reason — the words lived in CODE, where no
 * catalogue could reach them:
 *
 *   agent-reasoning.tsx   the row's default label `Reasoning`, held in a DEFAULT
 *                         PARAMETER: evaluated per call, but from a literal
 *   message-item/index     `is ${previewFailureReason(code).toLowerCase()}`,
 *                         glued to the file name by the card — an English copula
 *                         plus an English case transform inside a sentence the
 *                         catalogue owns
 *   agent-detail.tsx      the create/duplicate form's heading, its four
 *                         validation sentences and its refusal fallback
 *
 * Two properties, for two different readers:
 *
 * 1. ENGLISH IS BYTE-IDENTICAL to what the code printed before the keys existed
 *    (`origin/main` e612221450), through the repo's own render path: `t()` ->
 *    IntlMessageFormat, and for the components the real markup.
 * 2. A REGISTERED PROBE LOCALE REACHES EACH SURFACE, switching LIVE on a mounted
 *    tree. That is the difference between "keyed" and "still English in fr": the
 *    probes are markers, not translations (those live in
 *    `src/i18n/catalogues/<locale>/`), and each assertion looks for a character
 *    that cannot appear in the English sentence, so a surface that silently kept
 *    its literal fails rather than passes.
 *
 * WHY CLIENT MOUNTS, NOT `renderToStaticMarkup` (as S18b's file uses for
 * stateless components): `AgentCreate` reads `useUiPreferencesStore`, and on a
 * server render zustand answers from `getServerSnapshot` — the INITIAL state —
 * so the reasoning row is hidden no matter what the store holds and the form's
 * probes would test the wrong thing. The tree's own jsdom + `createRoot` harness
 * (`agent-avatar-write-hold.test.mjs`) is the honest path, and it buys a real
 * submit: `save()` refuses before it touches the wire, so no bridge is stubbed.
 *
 * THE CONTROL IS REAL: `S18D_CONTROL_BASE=<sha> node --test <this file>` loads
 * the four components from that commit instead of the working tree. On
 * `origin/main`, which reads no key for any of these strings, the probe-locale
 * assertions FAIL and the English pins still pass — proving the pins describe
 * the old output and the probe assertions discriminate.
 */

const ROOT = process.cwd();
const controlBase = process.env.S18D_CONTROL_BASE;
const FEATURES = "src/renderer/src/features";
const COMPONENTS = [
	`${FEATURES}/chat/components/trace/agent-reasoning.tsx`,
	`${FEATURES}/chat/components/message-item/invalid-attachment.tsx`,
	`${FEATURES}/chat/components/message-item/index.tsx`,
	`${FEATURES}/agents/components/agent-detail.tsx`,
];

const baseSource = (path) =>
	execFileSync("git", ["show", `${controlBase}:${path}`], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

/* Hoisted: biome's `useTopLevelRegex`, and the control hook's filter is
 * consulted per module esbuild loads. */
const TSX_FILE = /\.tsx$/;
const BIDI_ISOLATE = /[\u2066-\u2069\u200e\u200f]/u;
const ENGLISH_COPULA_SURGERY =
	/`is \$\{previewFailureReason\(code\)\?\.toLowerCase\(\)\}`/;

const controlPlugin = {
	name: "pre-fix-components-control",
	setup(builder) {
		builder.onLoad({ filter: TSX_FILE }, ({ path }) => {
			const rel = relative(ROOT, path);
			if (!COMPONENTS.includes(rel)) return undefined;
			return {
				contents: baseSource(rel),
				loader: "tsx",
				resolveDir: dirname(path),
			};
		});
	},
};

/*
 * jsdom before the bundle is imported: the shared modules under test touch
 * `window` at import time, and the DOM CONSTRUCTORS are needed too — an edit
 * form in this tree asks `element instanceof HTMLFormElement`, a name that does
 * not exist under Node. Copying the window's own constructors keeps
 * `instanceof` true in both directions; a hand-made stub would not.
 */
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
/*
 * jsdom ships no `ResizeObserver`, and the create form's searchable selects
 * observe their trigger. A no-op stub is the honest stand-in here: nothing in
 * this slice measures geometry, and a rig that DID measure would need a real
 * layout engine, not a bigger fake.
 */
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
/* Radix reads these through the global, not through `window`. */
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
		contents: `export { AgentReasoning } from "./${COMPONENTS[0]}";
export { InvalidAttachment } from "./${COMPONENTS[1]}";
export { AgentCreate } from "./${COMPONENTS[3]}";
export { useI18nLocale } from "./src/renderer/src/shared/i18n/use-locale";
export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
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
	// One copy of react/react-query shared with the mounts below.
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
	"./_s18d-english-source-copy.bundle.mjs",
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
	AgentReasoning,
	InvalidAttachment,
	AgentCreate,
	useUiPreferencesStore,
	MemoryRouter,
	useI18nLocale,
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

/* key -> [namespace, ICU args, the English the code printed before]. */
const KEYS = {
	"ui.chat.trace.reasoning.label": ["ui.chat.trace", {}, "Reasoning"],
	"ui.chat.trace.reasoning.with_duration": [
		"ui.chat.trace",
		{ label: "Reasoning", duration: "12s" },
		"Reasoning for 12s",
	],
	"ui.chat.attachments.not_viewable_too_large": [
		"ui.chat.attachments",
		{ name: "clip.mp4" },
		"clip.mp4 is too large to preview",
	],
	"ui.agents.detail.create.title_new": ["ui.agents.detail", {}, "New agent"],
	"ui.agents.detail.create.title_duplicate": [
		"ui.agents.detail",
		{},
		"Duplicate as a new agent",
	],
	"ui.agents.detail.create.error_name_required": [
		"ui.agents.detail",
		{},
		"Give the agent a name.",
	],
	"ui.agents.detail.create.error_name_grammar": [
		"ui.agents.detail",
		{},
		"Names cannot contain spaces or slashes.",
	],
	"ui.agents.detail.create.error_name_taken": [
		"ui.agents.detail",
		{ name: "taken" },
		"An agent called “taken” already exists. Choose another name, or open the existing one to change it.",
	],
	"ui.agents.detail.create.error_instructions_required": [
		"ui.agents.detail",
		{},
		"Give the agent instructions.",
	],
	"ui.agents.detail.create.error_generic": [
		"ui.agents.detail",
		{},
		"The agent could not be created.",
	],
};

test("the ten S18d keys exist, each with a context entry, and render today's English", () => {
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

/*
 * The RTL argument isolation is the catalogue runtime's job, not the call site's,
 * so an agent name typed in a right-to-left script is not forced LTR by this
 * message. Asserted where the runtime guarantees it: the name comes back
 * wrapped, and still verbatim.
 */
test("the taken-name sentence isolates its argument in a right-to-left locale", () => {
	const key = "ui.agents.detail.create.error_name_taken";
	registerCatalogue("ur", { [key]: "FR[{name}]" });
	setLocale("ur");
	try {
		const out = t(key, { name: "_aida_" });
		assert.match(out, BIDI_ISOLATE, "the argument carries an isolate");
		assert.ok(out.includes("_aida_"), "the name survives verbatim");
	} finally {
		clearRegisteredCatalogues();
		setLocale("en");
	}
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Mount a tree in jsdom — the client path, where a zustand selector is live. */
async function mount(element) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(element);
		await flush();
	});
	return {
		root,
		host,
		text: () => host.textContent ?? "",
		async unmount() {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

const PROBE = {
	...Object.fromEntries(
		Object.keys(KEYS).map((k) => [k, `FR[${k.split(".").slice(-1)}]`]),
	),
	"ui.chat.trace.reasoning.with_duration":
		"FR[with_duration]{label}/{duration}",
	"ui.chat.attachments.not_viewable_too_large":
		"FR[not_viewable_too_large]{name}",
};

/** Switch the mounted tree to the probe locale and let React commit it. */
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

const reasoningElement = ({ label, durationS } = {}) =>
	React.createElement(AgentReasoning, {
		content: "considering the options",
		...(label === undefined ? {} : { label }),
		...(durationS === undefined ? {} : { durationS }),
	});

/*
 * The too-large card at the call site's shape: `message-item/index.tsx` asks the
 * catalogue for the sentence while rendering, so a language switch recomputes it.
 * Composing the string in a test constant instead would freeze English in the
 * mounted prop and test the wrong thing.
 */
const TooLargeMedia = () => {
	useI18nLocale();
	return React.createElement(InvalidAttachment, {
		file: "/tmp/dir/clip.mp4",
		reason: t("ui.chat.attachments.not_viewable_too_large", {
			name: "clip.mp4",
		}),
		onOpen: () => {},
	});
};

/* surface -> [element, the English it must print, the probe marker]. */
const SURFACES = {
	"reasoning: default label": [
		() => reasoningElement(),
		"Reasoning",
		"FR[label]",
	],
	"reasoning: call-site label kept": [
		() => reasoningElement({ label: "Thinking" }),
		"Thinking",
		"Thinking",
	],
	"reasoning: with duration": [
		() => reasoningElement({ label: "Reasoning", durationS: 12 }),
		"Reasoning for 12s",
		"FR[with_duration]Reasoning/12s",
	],
	"attachment: too large": [
		() => React.createElement(TooLargeMedia),
		"clip.mp4 is too large to preview",
		"FR[not_viewable_too_large]clip.mp4",
		/* The old card glued the name to a fragment the caller had already glued
		 * the name to, so at `origin/main` this row prints it twice. */
		"clip.mp4 clip.mp4",
	],
};

for (const [name, [element, english, marker, absent]] of Object.entries(
	SURFACES,
)) {
	test(`${name} prints today's English and repaints on a live language switch`, async () => {
		useUiPreferencesStore.setState({ showAgentReasoning: true });
		setLocale("en");
		const mounted = await mount(element());
		try {
			assert.ok(
				mounted.text().includes(english),
				`${name}: expected ${english} in ${mounted.text()}`,
			);
			if (absent) {
				assert.ok(
					!mounted.text().includes(absent),
					`${name}: the name is printed once, not twice (${absent})`,
				);
			}
			await switchToProbe();
			/* The marker carries the placeholder's value where the message does, so a
			 * wrong placeholder shows up as a missing name rather than passing. */
			assert.ok(
				mounted.text().includes(marker),
				`${name}: expected ${marker} in ${mounted.text()}`,
			);
		} finally {
			await mounted.unmount();
			await backToEnglish();
		}
	});
}

/*
 * `UnavailableMedia` is not exported, so the site that USED to build the sentence
 * (`is ${reason.toLowerCase()}`) cannot be mounted from here. This is a WIRING
 * pin, not a render: it fails if the English surgery comes back, and the render
 * above proves the message it now passes through is the catalogue's.
 */
test("the too-large sentence is composed by the catalogue, not by string surgery", () => {
	const source = readFileSync(
		join(ROOT, `${FEATURES}/chat/components/message-item/index.tsx`),
		"utf8",
	);
	assert.ok(
		source.includes(`t("ui.chat.attachments.not_viewable_too_large"`),
		"the card asks the catalogue for its sentence",
	);
	assert.ok(
		!ENGLISH_COPULA_SURGERY.test(source),
		"the English copula and case transform are gone",
	);
});

/* One row per refusal: how to reach it, the English it must print. */
const REFUSALS = [
	["no name", {}, {}, "Give the agent a name.", "FR[error_name_required]"],
	[
		"name with a space",
		{ "#agent-create-name": "two words" },
		{},
		"Names cannot contain spaces or slashes.",
		"FR[error_name_grammar]",
	],
	[
		"taken name",
		{ "#agent-create-name": "taken" },
		{ takenNames: ["taken"] },
		"An agent called “taken” already exists. Choose another name, or open the existing one to change it.",
		"FR[error_name_taken]",
	],
	[
		"no instructions",
		{ "#agent-create-name": "aida" },
		{},
		"Give the agent instructions.",
		"FR[error_instructions_required]",
	],
];

async function mountCreate(props = {}) {
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
						...props,
					}),
				),
			),
		);
		await flush();
	});
	return {
		root,
		host,
		text: () => host.textContent ?? "",
		heading: () => host.querySelector("h2")?.textContent ?? "",
		async setValue(selector, value) {
			const field = host.querySelector(selector);
			assert.ok(field, `${selector} is on the form`);
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

for (const [name, fields, props, english, marker] of REFUSALS) {
	test(`create form refuses "${name}" in today's English, then in the active language`, async () => {
		setLocale("en");
		const mounted = await mountCreate(props);
		try {
			for (const [selector, value] of Object.entries(fields)) {
				await mounted.setValue(selector, value);
			}
			await mounted.submit();
			assert.ok(
				mounted.text().includes(english),
				`expected ${english} in ${mounted.text()}`,
			);
		} finally {
			await mounted.unmount();
		}

		/* The refusal is STATE, not a render-time read: the form has to REFUSE
		 * again under the probe, which is what a reader whose language is not
		 * English sees when the form next refuses them. */
		const probed = await mountCreate(props);
		try {
			await switchToProbe();
			for (const [selector, value] of Object.entries(fields)) {
				await probed.setValue(selector, value);
			}
			await probed.submit();
			assert.ok(
				probed.text().includes(marker),
				`expected ${marker} in ${probed.text()}`,
			);
		} finally {
			await probed.unmount();
			await backToEnglish();
		}
	});
}

test("create form headings print today's English and follow the active language", async () => {
	for (const [props, english, marker] of [
		[{}, "New agent", "FR[title_new]"],
		[
			{
				initial: {
					name: "Aida",
					kind: "role",
					description: "",
					instructions: "",
				},
			},
			"Duplicate as a new agent",
			"FR[title_duplicate]",
		],
	]) {
		setLocale("en");
		const mounted = await mountCreate(props);
		try {
			assert.equal(
				mounted.heading(),
				english,
				`heading for ${JSON.stringify(props)}`,
			);
			await switchToProbe();
			assert.equal(
				mounted.heading(),
				marker,
				`probe heading for ${JSON.stringify(props)}`,
			);
		} finally {
			await mounted.unmount();
			await backToEnglish();
		}
	}
});
