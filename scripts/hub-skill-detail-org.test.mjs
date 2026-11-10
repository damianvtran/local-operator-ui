/**
 * Regression for the Agent Hub → Skills crash (v0.53.2): clicking a card in a
 * private organization hub took the whole window to the global ErrorBoundary.
 *
 * The real `HubSkillsLibrary` renders against a controlled IPC boundary whose
 * answers are REAL SHAPES (`fixtures/hub-skill-detail-org-responses.json`,
 * captured from a private hub and the installed backend, every value
 * synthetic). The fixture carries both skill forms the hub serves: a DOCUMENT
 * skill (`files[]`) and a BUNDLE skill (`bundle{}` and no `files` at all). The
 * bundle detail is what read `detail.data.files.length` and threw
 * `TypeError: Cannot read properties of undefined (reading 'length')`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const fixture = JSON.parse(
	readFileSync(
		new URL("./fixtures/hub-skill-detail-org-responses.json", import.meta.url),
		"utf8",
	),
);

const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const dom = new JSDOM("<main id='root'></main>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
// The real Dialog/portal path needs browser DOM constructors in this Node host.
for (const name of [
	"Element",
	"Node",
	"NodeFilter",
	"DocumentFragment",
	"MutationObserver",
	"CustomEvent",
	"HTMLInputElement",
	"HTMLTextAreaElement",
	"HTMLFormElement",
])
	globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
Object.defineProperty(globalThis, "navigator", {
	value: dom.window.navigator,
	configurable: true,
});
Object.defineProperty(globalThis, "localStorage", {
	value: dom.window.localStorage,
	configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const CONFIG_MODULE = /^@shared\/config$/;
const HEALTH_MODULE = /^@shared\/hooks\/use-connectivity-status$/;
const ANY_MODULE = /.*/;
const built = await build({
	stdin: {
		contents:
			'export { HubSkillsLibrary } from "./src/renderer/src/features/agent-hub/components/hub-skills-library"; export { normalizeHubSkillDetail } from "./src/renderer/src/shared/api/radient/skills-api"; export { setLocale } from "./src/i18n";',
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	packages: "external",
	write: false,
	logLevel: "silent",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	plugins: [
		{
			name: "isolate-config-and-health",
			setup(b) {
				b.onResolve({ filter: CONFIG_MODULE }, () => ({
					path: "config",
					namespace: "fixture",
				}));
				b.onResolve({ filter: HEALTH_MODULE }, () => ({
					path: "health",
					namespace: "fixture",
				}));
				b.onLoad({ filter: ANY_MODULE, namespace: "fixture" }, ({ path }) => ({
					contents:
						path === "config"
							? 'export const apiConfig={radientBaseUrl:"http://localhost:8127"};'
							: "export const useServerHealth=()=>({data:{online:false,snapshot:null},isError:true,isPlaceholderData:false});",
					loader: "js",
				}));
			},
		},
	],
});
const mod = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(
	require,
	mod,
	mod.exports,
);
const { HubSkillsLibrary, normalizeHubSkillDetail, setLocale } = mod.exports;
setLocale("en");

const ok = (result) => ({ status: 200, body: { result } });
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
const text = () => document.body.textContent;
const scope = {
	visibility: "org",
	tenantId: "tenant-minerva",
	organization: "Minerva",
};
const docDetail = fixture.orgSkillDetails.find((d) => Array.isArray(d.files));
const bundleDetail = fixture.orgSkillDetails.find((d) => d.bundle);
// Negative control: the fixture must keep the shape that crashed, or a passing
// run proves nothing.
assert.ok(docDetail && bundleDetail, "fixture carries both skill forms");
assert.equal("files" in bundleDetail, false, "bundle detail has no files");

/**
 * Mount the library, open one card, and report what the window shows. React
 * reports an uncaught render error through `console.error` and unmounts the
 * tree; both are captured so the assertion names the real error.
 */
async function openCard(
	skillId,
	details = fixture.orgSkillDetails,
	list = fixture.orgSkillList,
) {
	const caps = {
		desktop_contract: 1,
		desktop_available: true,
		desktop_auth: "bearer",
		features: { hub_skills: 1, hub_links: 1, radient_org: 1 },
	};
	const requests = [];
	window.api = {
		desktop: {
			request: async (input) => {
				requests.push(input);
				if (input.op === "capabilities") return ok(caps);
				if (input.op === "hub.links") return ok(fixture.links);
				if (input.op === "hub.updates") return ok(fixture.updates);
				if (input.op === "radient.request") {
					const operation = input.control.operation;
					if (operation === "org_skills.list")
						return ok({ data: { result: list } });
					if (operation === "org_skill.get")
						return ok({
							data: {
								result: details.find((d) => d.id === input.control.skill_id),
							},
						});
				}
				throw new Error(`unexpected read ${input.op}`);
			},
		},
	};
	const errors = [];
	const original = console.error;
	console.error = (...args) => {
		errors.push(args.map(String).join(" "));
	};
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
	client.setQueryData(["desktop", "capabilities"], caps);
	const root = document.getElementById("root");
	const mount = createRoot(root, {
		onUncaughtError: (error) =>
			errors.push(`uncaught: ${error?.stack ?? error}`),
	});
	try {
		await act(async () => {
			mount.render(
				React.createElement(
					QueryClientProvider,
					{ client },
					React.createElement(HubSkillsLibrary, { scope, signedIn: true }),
				),
			);
			await pause();
		});
		await act(async () => {
			await pause();
		});
		const card = document.querySelector(
			`[data-testid="hub-skill-open"][data-skill-id="${skillId}"]`,
		);
		assert.ok(card, `card ${skillId} rendered: ${text()}`);
		await act(async () => {
			card.click();
			await pause();
		});
		await act(async () => {
			await pause();
		});
		return {
			errors,
			requests,
			libraryMounted: Boolean(
				document.querySelector("[data-hub-skills-library]"),
			),
			detailName: document.querySelector(
				'[data-testid="hub-skill-detail-name"]',
			)?.textContent,
			detailError: Boolean(
				document.querySelector('[data-testid="hub-skill-detail-error"]'),
			),
			cardErrors: document.querySelectorAll(
				'[data-testid="hub-skill-card-error"]',
			).length,
			body: text(),
		};
	} finally {
		console.error = original;
		await act(async () => mount.unmount());
		client.clear();
	}
}

test("opening a subscribed+downloaded BUNDLE skill from a private hub renders its detail", async () => {
	const result = await openCard(bundleDetail.id);
	const uncaught = result.errors.filter((e) => e.startsWith("uncaught"));
	assert.deepEqual(uncaught, [], `no uncaught render error: ${uncaught[0]}`);
	assert.equal(result.libraryMounted, true, "the Hub surface stays mounted");
	assert.equal(result.detailName, bundleDetail.name);
	// The bundle's declared inventory is the honest count, not "0 files".
	assert.match(
		result.body,
		new RegExp(`${bundleDetail.bundle.file_count} files`),
	);
});

test("opening a DOCUMENT skill from the same private hub still lists its files", async () => {
	const result = await openCard(docDetail.id);
	const uncaught = result.errors.filter((e) => e.startsWith("uncaught"));
	assert.deepEqual(uncaught, []);
	assert.equal(result.detailName, docDetail.name);
	for (const file of docDetail.files)
		assert.ok(result.body.includes(file.path));
	assert.match(result.body, new RegExp(`${docDetail.files.length} files`));
});

test("the detail normalizer gives consumers total arrays for every served form", () => {
	const bundle = normalizeHubSkillDetail(bundleDetail);
	assert.deepEqual(bundle.files, []);
	assert.equal(bundle.file_count, bundleDetail.bundle.file_count);
	const doc = normalizeHubSkillDetail(docDetail);
	assert.equal(doc.files.length, docDetail.files.length);
	assert.equal(doc.file_count, docDetail.files.length);
	// A malformed answer (files not an array, junk rows) cannot reintroduce the
	// crash through a different field.
	const junk = normalizeHubSkillDetail({
		...docDetail,
		files: [null, { path: "a.md" }, { path: "b.md", content: "x" }],
	});
	assert.deepEqual(
		junk.files.map((f) => f.path),
		["a.md", "b.md"],
	);
	assert.equal(junk.files[0].content, "");
	assert.deepEqual(
		normalizeHubSkillDetail({ ...docDetail, files: "x" }).files,
		[],
	);
});

/*
 * Containment, independent of the fix above: a detail or card body that still
 * cannot render (here a malformed `description` object, which React refuses as
 * a child) must cost only that skill's surface. Before the scoped boundary the
 * same throw reached the route ErrorBoundary and replaced the window.
 */
test("a detail body that throws shows the inline alert while the Hub stays mounted", async () => {
	const broken = { ...docDetail, description: { not: "renderable" } };
	const result = await openCard(
		docDetail.id,
		fixture.orgSkillDetails.map((d) => (d.id === docDetail.id ? broken : d)),
	);
	const uncaught = result.errors.filter((e) => e.startsWith("uncaught"));
	assert.deepEqual(uncaught, [], "the throw never reaches the root");
	assert.equal(result.libraryMounted, true, "the Hub surface stays mounted");
	assert.equal(result.detailName, docDetail.name, "the header still renders");
	assert.ok(
		result.detailError,
		`the detail shows the inline alert: ${result.body}`,
	);
	assert.equal(result.cardErrors, 0, "no card is affected");
});

test("a card that throws shows its own inline alert and leaves the other cards", async () => {
	const rows = fixture.orgSkillList.skills.map((row) =>
		row.id === docDetail.id
			? { ...row, description: { not: "renderable" } }
			: row,
	);
	const result = await openCard(bundleDetail.id, fixture.orgSkillDetails, {
		...fixture.orgSkillList,
		skills: rows,
	});
	const uncaught = result.errors.filter((e) => e.startsWith("uncaught"));
	assert.deepEqual(uncaught, []);
	assert.equal(result.libraryMounted, true);
	assert.equal(result.cardErrors, 1, "exactly the broken card is replaced");
	assert.equal(result.detailName, bundleDetail.name, "other cards still open");
});
