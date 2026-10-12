/**
 * The onboarding copy contract, in four executable layers.
 *
 * WHY IT IS SHAPED THIS WAY (rounds R1-1 and R2): candidate copies of this
 * contract used whole-file substring searches, proximity look-backs and
 * placeholder checks against their own expected string - none of them BIND.
 * A comment can satisfy a substring; a moved or reversed branch can satisfy
 * proximity; a parameter object can be absent while its key is present. Each
 * such counterexample passed that shape, so this file uses the shapes that
 * kill them:
 *
 *   1. VALUE PINS - all 45 committed English sentences, stated inline, never
 *      read from the catalogue as their own oracle. The key set is closed.
 *   2. AST BINDING - the repository's own TypeScript 7 surface (the same
 *      `typescript/unstable/*` API `scripts/i18n/check-strings.mjs` uses):
 *      every key must be the literal argument of a REAL `t()` call in its
 *      wiring file (comments cannot appear in an AST), plain messages take
 *      no second argument, parameterised messages bind the exact producer
 *      expressions, the greeting branches bind to the `oweGreeting`
 *      conditional's two arms, the acquisition call sits inside the element
 *      whose live `href` is `credential.url`, the modal's titles flow through
 *      the `stepTitles` table, and the plan's block reasons sit in the
 *      `catalogueHasModels` / `catalogue.ready` branches.
 *   3. LIVE RENDER - the shipped components, bundled with the repo's own
 *      esbuild and rendered with the real React server renderer (the pattern
 *      QA's independent probe established): the full committed sentences come
 *      out of the actual render, with no extra fragments; the anchor's `href`
 *      attribute and caption come off the rendered markup; the summary names
 *      the brand its producer computes; parameters render as escaped text,
 *      never markup.
 *
 * WHAT IT CANNOT PROVE: geometry, interaction, non-English locales, or the
 * full app around these components (SSR of the components in a fixture, not
 * the App). Those remain the render suites', QA's and the design round's.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import { openSnapshot } from "./i18n/check-strings.mjs";

const CATALOGUE = "src/i18n/catalogues/en/ui.onboarding.json";
const BASE = "src/renderer/src/features/onboarding/components/";

/** key -> [committed English (byte-exact), wiring file]. */
const CONTRACT = [
	[
		"ui.onboarding.connect.intro",
		"Local Operator needs an AI account to work. Radient is the easiest: one browser sign-in and nothing to paste. Already pay for ChatGPT or Claude? Sign in with that instead. Anything else is under More providers.",
		"steps/connect-provider-step.tsx",
	],
	[
		"ui.onboarding.default_model.block.loading_models",
		"Loading the model list…",
		"steps/default-model-plan.ts",
	],
	[
		"ui.onboarding.default_model.block.pick_a_model",
		"Pick a model to continue.",
		"steps/default-model-plan.ts",
	],
	[
		"ui.onboarding.default_model.change",
		"Change",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.connected_pick",
		"{brand} is connected. Pick the model new chats should use.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.empty_helper",
		"No providers are connected yet. Go back a step to connect one.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.fallback_name",
		"{brand}'s default model",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.intro",
		"New chats use this model. Every agent can pick a different one later.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.loading",
		"Loading your models",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.none_connected",
		"No provider is connected yet. Go back to connect one, or skip setup and connect one later from the chat.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.nothing_saved",
		"Nothing will be saved: your Local Operator can't list {brand} models yet, so setup finishes without a default model. Pick one in Settings before your first message.",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.provider_fallback",
		"this provider's",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.tag.applied",
		"your default",
		"steps/default-model-step.tsx",
	],
	[
		"ui.onboarding.default_model.tag.suggested",
		"suggested for your account",
		"steps/default-model-step.tsx",
	],
	["ui.onboarding.dialog.setup", "Setup", "onboarding-dialog.tsx"],
	[
		"ui.onboarding.extras.greeting_done",
		"{name} is your chief of staff. Her conversation is where you pick up with her, and it is one keystroke away in the sidebar. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
	],
	[
		"ui.onboarding.extras.greeting_owed",
		"{name} is your chief of staff. She will say hello first, ask what to call you and what you would like help with, and show you around. You can also skip straight to a new chat.",
		"steps/extras-step.tsx",
	],
	[
		"ui.onboarding.extras.next_meet",
		"Next: meet {name}",
		"steps/extras-step.tsx",
	],
	["ui.onboarding.modal.action.back", "Back", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.continue", "Continue", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.finish", "Finish", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.meet", "Meet {name}", "onboarding-modal.tsx"],
	["ui.onboarding.modal.action.skip", "Skip", "onboarding-modal.tsx"],
	[
		"ui.onboarding.modal.action.skip_for_now",
		"Skip for now",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.action.skip_to_chat",
		"Skip to chat",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.error.aida_open_failed",
		"{name}'s conversation could not be opened, so you are in a new chat instead.",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.connect_provider",
		"Connect an AI account",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.default_model",
		"Your default model",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.extras",
		"Web search (optional)",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.extras_with_name",
		"Web search, then meet {name}",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.modal.title.fallback",
		"First-time setup",
		"onboarding-modal.tsx",
	],
	[
		"ui.onboarding.search.each_key_saved",
		"Each key is saved on your device as soon as you leave its field.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.intro",
		"Agents can look things up while they work — today's prices, this week's news — instead of relying on what the model already knows.",
		"steps/search-api-step.tsx",
	],
	["ui.onboarding.search.mode.free", "Free", "steps/search-api-step.tsx"],
	[
		"ui.onboarding.search.mode.free_detail",
		"Uses a rotating pool of free providers — DuckDuckGo, Tavily's free tier, Exa and Parallel. No key needed; the pool is shared, so searches can be slower at busy times.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.keys",
		"Add API keys",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.keys_detail",
		"Bring your own keys for the search providers you use.",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.mode.label",
		"Search setup",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.recommended",
		"Recommended",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.get_your",
		"Get your {name}",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.not_saved",
		"Not saved — {message}",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.placeholder",
		"Paste your API key",
		"steps/search-api-step.tsx",
	],
	[
		"ui.onboarding.search.row.save_failed",
		"The key could not be saved.",
		"steps/search-api-step.tsx",
	],
	["ui.onboarding.search.row.saved", "Saved", "steps/search-api-step.tsx"],
	[
		"ui.onboarding.search.row.saving",
		"Saving {name}",
		"steps/search-api-step.tsx",
	],
];

/**
 * key -> [[parameter name, exact producer expression source]] for the 12
 * parameterised messages. The expressions are the committed call-site
 * producers, compared as AST slices with whitespace normalised: a comment
 * decoy cannot satisfy a node, and a same-shape wrong producer (a different
 * `brandOf(...)` argument) is a different node.
 */
const PARAM_SITES = [
	["ui.onboarding.modal.title.extras_with_name", [["name", "aidaName"]]],
	["ui.onboarding.modal.action.meet", [["name", "aidaName"]]],
	["ui.onboarding.modal.error.aida_open_failed", [["name", "aidaName"]]],
	["ui.onboarding.extras.next_meet", [["name", "aidaName"]]],
	["ui.onboarding.extras.greeting_owed", [["name", "aidaName"]]],
	["ui.onboarding.extras.greeting_done", [["name", "aidaName"]]],
	[
		"ui.onboarding.default_model.connected_pick",
		[["brand", "brandOf(choice.provider)"]],
	],
	[
		"ui.onboarding.default_model.fallback_name",
		[["brand", "choice.provider ? brandOf(choice.provider) : choice.hosting"]],
	],
	[
		"ui.onboarding.default_model.nothing_saved",
		[
			[
				"brand",
				'shownRow ? brandOf(shownRow) : t("ui.onboarding.default_model.provider_fallback")',
			],
		],
	],
	["ui.onboarding.search.row.not_saved", [["message", "message"]]],
	["ui.onboarding.search.row.saving", [["name", "credential.name"]]],
	["ui.onboarding.search.row.get_your", [["name", "credential.name"]]],
];

/** The three titles that flow through the modal's `stepTitles` table. */
const TABLE_KEYS = [
	"ui.onboarding.modal.title.connect_provider",
	"ui.onboarding.modal.title.default_model",
	"ui.onboarding.modal.title.extras",
];

const PLAN_KEYS = {
	"ui.onboarding.default_model.block.pick_a_model": "PICK_A_MODEL_KEY",
	"ui.onboarding.default_model.block.loading_models": "LOADING_MODELS_KEY",
};

const value = (key) => CONTRACT.find(([k]) => k === key)[1];
const slug = (s) => s.replace(/\s+/g, "").replace(/,}/g, "}");

// ---------------------------------------------------------------------------
// The AST surface: the repository's own TypeScript 7 parse pipeline.
// ---------------------------------------------------------------------------

const repo = process.cwd();
const astFiles = [...new Set(CONTRACT.map(([, , file]) => file))];
const { api, snapshot } = openSnapshot(
	repo,
	astFiles.map((file) => join(repo, BASE, file)),
);

const sfOf = (file) => {
	const abs = join(repo, BASE, file);
	return snapshot.getDefaultProjectForFile(abs)?.program.getSourceFile(abs);
};

const slice = (sf, node) => sf.text.slice(node.getStart(sf), node.getEnd());

function walk(node, visit) {
	if (!node) return;
	visit(node);
	node.forEachChild((child) => walk(child, visit));
}

/** Every real `t("key", …)` call in a file: `{ key, call, args }`. */
function tCalls(sf) {
	const calls = [];
	walk(sf, (node) => {
		if (
			node.kind === SyntaxKind.CallExpression &&
			node.expression?.kind === SyntaxKind.Identifier &&
			node.expression.text === "t" &&
			node.arguments?.[0]?.kind === SyntaxKind.StringLiteral
		) {
			calls.push({ key: node.arguments[0].text, call: node });
		}
	});
	return calls;
}

test.after(() => api.close());

// ---------------------------------------------------------------------------
// 1. Value pins (preserved from R1-1; independently stated, closed set)
// ---------------------------------------------------------------------------

test("every key's committed English is byte-exact in the catalogue, and the set is closed", () => {
	const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8"));
	assert.deepEqual(
		Object.keys(catalogue).sort(),
		CONTRACT.map(([key]) => key),
		"the catalogue's key set moved from the committed 45",
	);
	for (const [key, expected] of CONTRACT) {
		assert.equal(
			catalogue[key],
			expected,
			`${key} drifted from the committed sentence`,
		);
	}
});

// ---------------------------------------------------------------------------
// 2. AST binding: call sites, producers, branches, the live anchor, tables
// ---------------------------------------------------------------------------

test("every key is the literal argument of a real t() call (comments cannot satisfy this)", () => {
	for (const file of astFiles) {
		const sf = sfOf(file);
		assert.ok(sf, `${file}: not parsed by the snapshot`);
		const live = new Set(tCalls(sf).map(({ key }) => key));
		const expected = CONTRACT.filter(
			([key, , f]) =>
				f === file && !(key in PLAN_KEYS) && !TABLE_KEYS.includes(key),
		).map(([key]) => key);
		assert.deepEqual(
			[...live].sort(),
			expected.slice().sort(),
			`${file}: the live t() key set moved (a key moved into a comment, or an untracked call appeared)`,
		);
	}
});

test("plain messages take no second argument; parameterised messages bind exact producers", () => {
	const byFile = new Map();
	for (const [key, expected, file] of CONTRACT) {
		if (key in PLAN_KEYS || TABLE_KEYS.includes(key)) continue;
		if (!byFile.has(file)) byFile.set(file, sfOf(file));
		const call = tCalls(byFile.get(file)).find((c) => c.key === key);
		assert.ok(call, `${key}: no live t() call`);
		const params = PARAM_SITES.find(([k]) => k === key);
		if (!params) {
			assert.equal(
				call.call.arguments.length,
				1,
				`${key}: a plain message grew a second argument`,
			);
			assert.ok(
				/^\{\w+\}/.test(expected) === false && !expected.includes("{"),
				`${key}: a plain expected sentence must not carry placeholders`,
			);
			continue;
		}
		const second = call.call.arguments[1];
		assert.ok(second, `${key}: the parameter object is missing`);
		assert.equal(
			second.kind,
			SyntaxKind.ObjectLiteralExpression,
			`${key}: the second argument is not an object literal`,
		);
		const sf = byFile.get(file);
		const names = second.properties.map((p) => p.name?.text);
		assert.deepEqual(
			names.slice().sort(),
			params[1].map(([name]) => name).sort(),
			`${key}: the parameter names moved`,
		);
		for (const [name, expectedExpr] of params[1]) {
			const prop = second.properties.find((p) => p.name?.text === name);
			const actual = slug(slice(sf, prop.initializer ?? prop.name));
			assert.equal(
				actual,
				slug(expectedExpr),
				`${key}: ${name} is no longer produced by ${expectedExpr}`,
			);
		}
	}
});

test("the modal's titles flow through the stepTitles table and the plan's blocks through its branches", () => {
	// stepTitles: the table's values ARE the three committed keys.
	const modal = sfOf("onboarding-modal.tsx");
	let table = null;
	walk(modal, (node) => {
		if (
			node.kind === SyntaxKind.VariableDeclaration &&
			node.name?.text === "stepTitles"
		) {
			let init = node.initializer;
			for (
				let i = 0;
				i < 3 &&
				init &&
				init.kind !== SyntaxKind.ObjectLiteralExpression &&
				init.expression;
				i += 1
			)
				init = init.expression;
			table = init;
		}
	});
	assert.ok(table, "the stepTitles table is gone");
	assert.deepEqual(
		table.properties.map((p) => p.initializer?.text).sort(),
		TABLE_KEYS.slice().sort(),
		"the stepTitles table no longer carries the committed keys",
	);
	assert.ok(
		tCalls(modal).length >= 10,
		"the modal's live t() calls thinned out",
	);
	let consumes = false;
	walk(modal, (node) => {
		if (
			node.kind === SyntaxKind.CallExpression &&
			node.expression?.kind === SyntaxKind.Identifier &&
			node.expression.text === "t" &&
			node.arguments?.[0]?.kind !== SyntaxKind.StringLiteral &&
			slug(slice(modal, node.arguments?.[0] ?? node)) === "stepTitles[step]"
		)
			consumes = true;
	});
	assert.ok(
		consumes,
		"the modal stopped rendering titles through t(stepTitles[step])",
	);

	// The plan: constant initialisers + branch-scoped consumption.
	const plan = sfOf("steps/default-model-plan.ts");
	assert.ok(plan, "the plan source did not resolve in the snapshot");
	const consts = new Map();
	walk(plan, (node) => {
		if (
			node.kind !== SyntaxKind.VariableDeclaration ||
			!node.name?.text?.endsWith("_KEY")
		)
			return;
		/*
		 * The initialisers are `"key" as const`: unwrap the assertion - the
		 * committed identity is the STRING, and `as const` is why the value can
		 * flow into `t()` with its literals intact.
		 */
		let init = node.initializer;
		while (
			init &&
			(init.kind === SyntaxKind.AsExpression ||
				init.kind === SyntaxKind.SatisfiesExpression)
		)
			init = init.expression;
		if (init?.kind === SyntaxKind.StringLiteral)
			consts.set(node.name.text, init.text);
	});
	for (const [key, constName] of Object.entries(PLAN_KEYS)) {
		assert.equal(
			consts.get(constName),
			key,
			`${constName} no longer names ${key}`,
		);
	}
	let pickInBranch = false;
	let loadingInBranch = false;
	walk(plan, (node) => {
		if (
			node.kind === SyntaxKind.ConditionalExpression &&
			node.condition?.kind === SyntaxKind.Identifier &&
			node.condition.text === "catalogueHasModels"
		) {
			node.whenTrue &&
				walk(node.whenTrue, (n) => {
					if (
						n.kind === SyntaxKind.CallExpression &&
						n.expression?.text === "t" &&
						n.arguments?.[0]?.kind === SyntaxKind.Identifier &&
						n.arguments[0].text === "PICK_A_MODEL_KEY"
					)
						pickInBranch = true;
				});
			node.whenFalse &&
				walk(node.whenFalse, (n) => {
					if (
						n.kind === SyntaxKind.ConditionalExpression &&
						n.condition?.kind === SyntaxKind.PropertyAccessExpression &&
						slug(slice(plan, n.condition)) === "catalogue.ready"
					)
						n.whenFalse &&
							walk(n.whenFalse, (m) => {
								if (
									m.kind === SyntaxKind.CallExpression &&
									m.expression?.text === "t" &&
									m.arguments?.[0]?.kind === SyntaxKind.Identifier &&
									m.arguments[0].text === "LOADING_MODELS_KEY"
								)
									loadingInBranch = true;
							});
				});
		}
	});
	assert.ok(
		pickInBranch,
		"PICK_A_MODEL_KEY left the catalogueHasModels branch",
	);
	assert.ok(loadingInBranch, "LOADING_MODELS_KEY left the not-ready branch");

	// The greeting branches: owed in the conditional's true arm, done in false.
	const extras = sfOf("steps/extras-step.tsx");
	let owedTrue = false;
	let doneFalse = false;
	walk(extras, (node) => {
		if (
			node.kind === SyntaxKind.ConditionalExpression &&
			node.condition?.kind === SyntaxKind.Identifier &&
			node.condition.text === "oweGreeting"
		) {
			owedTrue = tCallsIn(node.whenTrue).includes(
				"ui.onboarding.extras.greeting_owed",
			);
			doneFalse = tCallsIn(node.whenFalse).includes(
				"ui.onboarding.extras.greeting_done",
			);
		}
	});
	assert.ok(owedTrue, "the owed greeting left the oweGreeting true arm");
	assert.ok(doneFalse, "the delivered greeting left the oweGreeting false arm");

	// The acquisition call sits inside the element whose href is credential.url.
	const search = sfOf("steps/search-api-step.tsx");
	let anchorBound = false;
	walk(search, (node) => {
		if (
			node.kind !== SyntaxKind.JsxElement ||
			!node.openingElement?.attributes?.properties
		)
			return;
		const href = node.openingElement.attributes.properties.find(
			(a) => a.kind === SyntaxKind.JsxAttribute && a.name?.text === "href",
		);
		if (!href) return;
		const expr = href.initializer?.expression;
		if (!expr || slug(slice(search, expr)) !== "credential.url") return;
		let inside = false;
		walk(node, (n) => {
			if (
				n.kind === SyntaxKind.CallExpression &&
				n.expression?.text === "t" &&
				n.arguments?.[0]?.text === "ui.onboarding.search.row.get_your"
			)
				inside = true;
		});
		if (inside) anchorBound = true;
	});
	assert.ok(
		anchorBound,
		"the get-your call is no longer inside an element whose live href is credential.url",
	);
});

/** The t() keys appearing within a node's subtree. */
function tCallsIn(node) {
	const keys = [];
	walk(node, (n) => {
		if (
			n.kind === SyntaxKind.CallExpression &&
			n.expression?.kind === SyntaxKind.Identifier &&
			n.expression.text === "t" &&
			n.arguments?.[0]?.kind === SyntaxKind.StringLiteral
		)
			keys.push(n.arguments[0].text);
	});
	return keys;
}

// ---------------------------------------------------------------------------
// 3. Live render: the shipped components through the real React SSR.
// ---------------------------------------------------------------------------

const require_ = createRequire(join(repo, "package.json"));
const esbuild = require_("esbuild");
const React = require_("react");
const { renderToStaticMarkup } = require_("react-dom/server");

globalThis.__CONTRACT_REQUIRE__ = (specifier) =>
	require_(
		specifier.startsWith("file:") ? fileURLToPath(specifier) : specifier,
	);

const storage = new Map();
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, val) => storage.set(key, String(val)),
		removeItem: (key) => storage.delete(key),
	},
});

const bundle = await esbuild.build({
	stdin: {
		contents: `
export { ConnectProviderStep } from './src/renderer/src/features/onboarding/components/steps/connect-provider-step';
export { DefaultModelSummary } from './src/renderer/src/features/onboarding/components/steps/default-model-step';
export { SearchKeyRow } from './src/renderer/src/features/onboarding/components/steps/search-api-step';
export { ExtrasStep } from './src/renderer/src/features/onboarding/components/steps/extras-step';
export { QueryClient, QueryClientProvider } from '@tanstack/react-query';
export { MemoryRouter } from 'react-router-dom';
`,
		resolveDir: repo,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	banner: { js: "var require = globalThis.__CONTRACT_REQUIRE__;" },
	write: false,
	jsx: "automatic",
	alias: {
		"@shared": join(repo, "src/renderer/src/shared"),
		"@features": join(repo, "src/renderer/src/features"),
		"@renderer": join(repo, "src/renderer/src"),
		"@assets": join(repo, "src/renderer/src/assets"),
	},
	loader: {
		".css": "empty",
		".svg": "empty",
		".png": "empty",
		".webp": "empty",
	},
	define: {
		"import.meta.env": JSON.stringify({
			VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1",
			VITE_RADIENT_SERVER_BASE_URL: "https://example.invalid",
			VITE_RADIENT_CLIENT_ID: "fixture",
			VITE_GOOGLE_CLIENT_ID: "fixture",
			VITE_MICROSOFT_CLIENT_ID: "fixture",
			VITE_MICROSOFT_TENANT_ID: "common",
			VITE_PUBLIC_POSTHOG_KEY: "",
			VITE_PUBLIC_POSTHOG_HOST: "http://127.0.0.1:9",
			VITE_LOG_LEVEL: "error",
		}),
	},
	plugins: [
		{
			name: "contract-search-key-row-export",
			setup(build) {
				build.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
					const text = readFileSync(args.path, "utf8");
					const patched = args.path.endsWith("/steps/search-api-step.tsx")
						? `${text}\nexport { SearchKeyRow };\n`
						: text;
					return {
						contents: patched,
						loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
					};
				});
				build.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
					path: pathToFileURL(require_.resolve(args.path)).href,
					external: true,
				}));
			},
		},
	],
});

const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const client = new mod.QueryClient({
	defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

const wrap = (element) =>
	React.createElement(
		mod.QueryClientProvider,
		{ client },
		React.createElement(mod.MemoryRouter, null, element),
	);
const render = (element) => renderToStaticMarkup(wrap(element));
const strip = (html) =>
	html
		.replace(/<[^>]*>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");

/** The first paragraph whose text starts with `prefix`, from raw markup. */
function findP(markup, prefix) {
	/*
	 * Paragraphs AND spans: the free-pool detail is a span's children in
	 * `ModeOption`, the greetings are paragraphs - both are "the element whose
	 * rendered text is this committed sentence", which is what the contract
	 * means by full-sentence equality.
	 */
	for (const match of markup.matchAll(/<(p|span)[^>]*>([\s\S]*?)<\/\1>/g)) {
		const text = strip(match[2]);
		if (text.startsWith(prefix)) return { text };
	}
	return null;
}

test("the connect intro renders its full committed sentence, with no extra fragments", () => {
	const markup = render(React.createElement(mod.ConnectProviderStep));
	const intro = findP(markup, "Local Operator needs an AI account");
	assert.ok(intro, "the intro paragraph is missing from the render");
	assert.equal(intro.text, value("ui.onboarding.connect.intro"));
});

test("the free-pool detail renders its exact committed sentence (appended or prefixed text fails)", () => {
	const markup = render(
		React.createElement(mod.ExtrasStep, { aidaName: "Ada", oweGreeting: true }),
	);
	const freeDetail = findP(markup, "Uses a rotating pool of free");
	assert.ok(
		freeDetail,
		"the free-pool detail paragraph is missing from the render",
	);
	assert.equal(freeDetail.text, value("ui.onboarding.search.mode.free_detail"));
});

test("both chief-of-staff branches render their exact sentence for the oweGreeting they are given", () => {
	const owed = render(
		React.createElement(mod.ExtrasStep, { aidaName: "Ada", oweGreeting: true }),
	);
	const owedP = findP(owed, "Ada is your chief of staff");
	assert.ok(owedP, "the owed greeting paragraph is missing");
	assert.equal(
		owedP.text,
		value("ui.onboarding.extras.greeting_owed").replace("{name}", "Ada"),
	);
	assert.match(owed, /<h3[^>]*>Next: meet Ada<\/h3>/);

	const delivered = render(
		React.createElement(mod.ExtrasStep, {
			aidaName: "Ada",
			oweGreeting: false,
		}),
	);
	const doneP = findP(delivered, "Ada is your chief of staff");
	assert.ok(doneP, "the delivered greeting paragraph is missing");
	assert.equal(
		doneP.text,
		value("ui.onboarding.extras.greeting_done").replace("{name}", "Ada"),
	);
});

test("the acquisition link renders the live href and caption; the placeholder is the committed one", () => {
	const markup = renderToStaticMarkup(
		React.createElement(mod.SearchKeyRow, {
			credential: {
				name: "Tavily API key",
				key: "TAVILY_API_KEY",
				url: "https://example.invalid/",
				description: "fixture",
			},
			showDescription: false,
			isStored: false,
			save: async () => {
				throw new Error("SSR never writes");
			},
		}),
	);
	const anchor = markup.match(/<a\b[^>]*>/)?.[0];
	assert.ok(anchor, "the anchor is missing from the render");
	const href = anchor.match(/href="([^"]*)"/)?.[1];
	assert.equal(
		href,
		"https://example.invalid/",
		"the live anchor href is not the credential url",
	);
	const caption = markup.match(/<a\b[^>]*>([\s\S]*?)<\/a>/)?.[1];
	assert.ok(caption, "the anchor has no caption");
	assert.equal(strip(caption), "Get your Tavily API key");
	const placeholder = markup.match(/placeholder="([^"]*)"/)?.[1];
	assert.equal(placeholder, "Paste your API key");
});

test("the model summary names the brand its producer computes, and its states render their sentences", () => {
	const google = {
		id: "google",
		name: "Google",
		local: false,
		has_credential: true,
	};
	const choose = renderToStaticMarkup(
		React.createElement(mod.DefaultModelSummary, {
			choice: { kind: "choose", provider: google },
			onChange: () => {},
		}),
	);
	assert.equal(
		strip(choose),
		value("ui.onboarding.default_model.connected_pick").replace(
			"{brand}",
			"Google",
		),
	);

	const none = renderToStaticMarkup(
		React.createElement(mod.DefaultModelSummary, {
			choice: { kind: "none" },
			onChange: () => {},
		}),
	);
	assert.equal(
		strip(none),
		value("ui.onboarding.default_model.none_connected"),
	);

	const proposed = renderToStaticMarkup(
		React.createElement(mod.DefaultModelSummary, {
			choice: {
				kind: "proposed",
				provider: google,
				model: { name: "Gemini 2.5 Pro" },
			},
			onChange: () => {},
		}),
	);
	assert.ok(
		strip(proposed).includes("Gemini 2.5 Pro"),
		"the proposed model name is missing",
	);
	assert.ok(
		strip(proposed).includes("Google · suggested for your account"),
		"the suggested tag did not name the connected brand",
	);
});

test("parameters render as escaped text, never markup", () => {
	const markup = render(
		React.createElement(mod.ExtrasStep, {
			aidaName: "<strong>Ada</strong>",
			oweGreeting: true,
		}),
	);
	assert.ok(
		markup.includes("&lt;strong&gt;Ada&lt;/strong&gt; is your chief of staff"),
		"the parameter was not escaped into text",
	);
	assert.ok(
		!markup.includes("<strong>Ada</strong>"),
		"the parameter became live markup",
	);
});

test.after(() => client.clear());
