/**
 * Renderer-path proof, not native filesystem proof: the actual adoption component,
 * pull hook, desktop envelope decoder and request schema run against a controlled
 * IPC boundary. Failure controls prevent a guessed fixture from becoming a pass.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const dom = new JSDOM("<main id='root'></main>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
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
			'export * from "./src/renderer/src/features/agent-hub/components/hub-skill-adoption"; export * from "./src/renderer/src/shared/api/local-operator/hub-skill-adoption"; export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract"; export { useAdoptionFixtureDocumentDirection } from "./src/renderer/src/features/agent-hub/hub-skill-adoption.fixtures"; export { setLocale } from "./src/i18n";',
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
							: 'export const useServerHealth=()=>{throw new Error("unexpected health hook");};',
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
const {
	HubSkillAdoption,
	adoptionFileActionKey,
	useAdoptionFixtureDocumentDirection,
	setLocale,
	skillAdoptionPreviewSchema,
	skillPullDidWrite,
	desktopRequestSchema,
	desktopEndpoint,
} = mod.exports;
const source = {
	requestId: "12345678-1234-4123-8123-123456789abc",
	remoteId: "skill-release-checklist",
	scope: {
		visibility: "org",
		tenantId: "tenant-minerva",
		organization: "Minerva",
	},
	alias: "release-checklist",
	subscribe: true,
	autoPush: false,
	consent: false,
};
const preview = {
	reports: [{ outcome: "needs-review", applied: false }],
	link: null,
	links: { links: [], unresolved: [] },
	adoption: {
		state: "ready",
		strategy: "merge",
		model: null,
		warnings: [],
		files: [
			{
				path: "SKILL.md",
				local_path: "SKILL.md",
				action: "merged",
				proposed: "FULL PROPOSED CONTENT\nLAST LINE PRESERVED",
				diff_vs_local: "LOCAL DIFF\n+HUB ADDITION",
				diff_vs_hub: "HUB DIFF\n+LOCAL GUARDRAIL",
				kept: {
					local: ["Local safety"],
					hub: ["Hub verification"],
					combined: ["Heading"],
					unresolved: [],
				},
			},
		],
	},
	adoption_receipt: "receipt-123456789012345678901234",
	snapshot: {
		path: "/fixture/backup/release-checklist",
		tree_hash: "raw-tree-hash",
		manifest: [],
	},
	confirmation_required: true,
	dry_run: true,
};
const applied = {
	...preview,
	dry_run: false,
	confirmation_required: false,
	reports: [{ outcome: "merged", applied: true }],
	link: { link_id: "new-link" },
	links: { links: [{ link_id: "new-link" }], unresolved: [] },
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
const text = () => document.body.textContent;
const button = (name) =>
	[...document.querySelectorAll("button")].find(
		(node) => node.textContent === name,
	);
async function press(name) {
	const target = button(name);
	assert.ok(target, `missing button ${name}: ${text()}`);
	assert.equal(target.disabled, false, `disabled ${name}`);
	await act(async () => {
		target.click();
		await pause();
	});
}
async function scene(response) {
	const requests = [];
	window.api = {
		desktop: {
			request: async (input) => {
				requests.push(input);
				if (input.op !== "hub.skillPull")
					throw new Error(`unexpected operation ${input.op}`);
				return response(input);
			},
		},
	};
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
	client.setQueryData(["desktop", "capabilities"], {
		desktop_available: true,
		features: { hub_skills: 1 },
	});
	const errors = [];
	client.getMutationCache().subscribe((event) => {
		if (event.type === "updated" && event.mutation.state.error)
			errors.push(event.mutation.state.error.message);
	});
	const inventory = {
		links: [{ link_id: "existing-unrelated" }],
		unresolved: [],
	};
	client.setQueryData(["desktop", "hub-links"], inventory);
	const mount = createRoot(document.getElementById("root"));
	let closed = false;
	await act(async () => {
		mount.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(HubSkillAdoption, {
					input: source,
					onClose: () => {
						closed = true;
					},
				}),
			),
		);
		await pause();
	});
	return {
		requests,
		errors,
		client,
		inventory,
		closed: () => closed,
		cleanup: async () => {
			await act(async () => mount.unmount());
			client.clear();
		},
	};
}
const ok = (result) => ({ status: 200, body: { result } });

test("adoption fields validate and map additively; normal pull remains unchanged", () => {
	const base = {
		op: "hub.skillPull",
		requestId: source.requestId,
		hubId: source.remoteId,
		hubSource: "http://localhost:8127/v1",
		visibility: "org",
		tenantId: "tenant-minerva",
		localAlias: source.alias,
		subscribe: true,
		autoPush: false,
		confirmPublicEgress: false,
	};
	const ordinary = desktopEndpoint(desktopRequestSchema.parse(base));
	assert.equal("dry_run" in ordinary.body, false);
	for (const strategy of ["merge", "keep-local", "take-hub"]) {
		const mapped = desktopEndpoint(
			desktopRequestSchema.parse({
				...base,
				dryRun: false,
				confirm: true,
				adoptionStrategy: strategy,
				adoptionReceipt: preview.adoption_receipt,
				allowLlm: false,
			}),
		);
		assert.equal(mapped.body.adoption_strategy, strategy);
		assert.equal(mapped.body.adoption_receipt, preview.adoption_receipt);
		assert.equal(mapped.body.confirm, true);
		assert.equal(mapped.body.allow_llm, false);
	}
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, adoptionStrategy: "guess" })
			.success,
		false,
	);
	assert.equal(
		desktopRequestSchema.safeParse({ ...base, adoptionReceipt: "short" })
			.success,
		false,
	);
	assert.equal(
		skillAdoptionPreviewSchema.safeParse({ ...preview, snapshot: null })
			.success,
		false,
	);
	assert.equal(skillPullDidWrite(preview), false);
	assert.equal(skillPullDidWrite(applied, true), false);
	assert.equal(skillPullDidWrite(applied), true);
});

test("full two-sided review precedes receipt-bound confirm, and preview never seeds inventory", async () => {
	const s = await scene((input) => ok(input.dryRun ? preview : applied));
	try {
		assert.equal(
			s.requests.length,
			0,
			"opening review does not dispatch a model or a write",
		);
		await press("Create preview");
		assert.deepEqual(
			s.errors,
			[],
			"mutation setup must succeed before transport assertions",
		);
		assert.equal(
			s.requests[0].allowLlm,
			false,
			"model egress requires affirmative checkbox",
		);
		assert.ok(text().includes("LAST LINE PRESERVED"));
		assert.ok(text().includes("LOCAL DIFF"));
		assert.ok(text().includes("HUB DIFF"));
		assert.ok(text().includes("Local safety"));
		assert.ok(text().includes("/fixture/backup/release-checklist"));
		assert.deepEqual(
			s.client.getQueryData(["desktop", "hub-links"]),
			s.inventory,
		);
		assert.equal(
			s.client.getQueryState(["desktop", "hub-links"]).isInvalidated,
			false,
		);
		await press("Confirm reviewed adoption");
		const confirm = s.requests[1];
		assert.equal(confirm.adoptionReceipt, preview.adoption_receipt);
		assert.equal(confirm.adoptionStrategy, "merge");
		for (const field of [
			"hubId",
			"visibility",
			"tenantId",
			"localAlias",
			"subscribe",
			"autoPush",
			"confirmPublicEgress",
		])
			assert.deepEqual(confirm[field], s.requests[0][field]);
		assert.equal(confirm.confirm, true);
		assert.equal(confirm.dryRun, false);
		assert.equal("proposed" in confirm, false);
		assert.ok(text().includes("Skill adopted"));
	} finally {
		await s.cleanup();
	}
});

test("needs-choice disables confirmation and keep-local requires a new reviewed receipt", async () => {
	const conflict = {
		...preview,
		adoption: { ...preview.adoption, state: "needs-choice" },
	};
	const local = {
		...preview,
		adoption_receipt: "local-receipt-12345678901234567",
		adoption: {
			...preview.adoption,
			strategy: "keep-local",
			files: [
				{
					...preview.adoption.files[0],
					action: "kept-local",
					proposed: "EXACT RAW LOCAL",
				},
			],
		},
	};
	const s = await scene((input) =>
		ok(
			input.dryRun
				? input.adoptionStrategy === "keep-local"
					? local
					: conflict
				: applied,
		),
	);
	try {
		await press("Create preview");
		assert.equal(button("Confirm reviewed adoption").disabled, true);
		await press("Preview keeping local");
		assert.ok(text().includes("EXACT RAW LOCAL"));
		assert.equal(s.requests.length, 2);
		await press("Confirm reviewed adoption");
		assert.equal(s.requests[2].adoptionReceipt, local.adoption_receipt);
		assert.equal(s.requests[2].adoptionStrategy, "keep-local");
	} finally {
		await s.cleanup();
	}
});

test("stale confirmation fails closed and offers re-preview; cancellation never dispatches confirm", async () => {
	const s = await scene((input) =>
		input.dryRun
			? ok(preview)
			: {
					status: 409,
					body: {
						detail: { code: "adoption-preview-changed", message: "changed" },
					},
				},
	);
	try {
		await press("Create preview");
		await press("Confirm reviewed adoption");
		assert.ok(text().includes("Create a new preview before confirming"));
		assert.equal(button("Confirm reviewed adoption").disabled, true);
		await press("Create new preview");
		assert.equal(s.requests.length, 3);
		await press("Cancel");
		assert.equal(s.closed(), true);
		assert.equal(s.requests.length, 3);
		assert.deepEqual(
			s.client.getQueryData(["desktop", "hub-links"]),
			s.inventory,
		);
	} finally {
		await s.cleanup();
	}
});

test("older-core failure and malformed previews cannot enable confirmation", async () => {
	const s = await scene(() =>
		ok({ reports: [], link: null, links: { links: [], unresolved: [] } }),
	);
	try {
		await press("Create preview");
		assert.ok(text().includes("No adoption is confirmed"));
		assert.equal(button("Confirm reviewed adoption"), undefined);
	} finally {
		await s.cleanup();
	}
});

test("actual core not-installed, relocated and carried actions render distinct dispositions", async () => {
	const cases = {
		"not-installed": "ui.hub.adoption.file_not_adopted",
		relocated: "ui.hub.adoption.file_relocated",
		carried: "ui.hub.adoption.file_carried",
		"set-aside": "ui.hub.adoption.file_aside",
	};
	for (const [action, key] of Object.entries(cases))
		assert.equal(adoptionFileActionKey(action), key);
	assert.equal(
		adoptionFileActionKey("future-action"),
		"ui.hub.adoption.file_review",
	);
	const actualActions = {
		...preview,
		adoption: {
			...preview.adoption,
			files: Object.keys(cases).map((action, index) => ({
				...preview.adoption.files[0],
				path: `references/disposition-${index}.md`,
				action,
				local_path: action === "relocated" ? "references/original.md" : null,
			})),
		},
	};
	const s = await scene(() => ok(actualActions));
	try {
		await press("Create preview");
		for (const label of [
			"Hub file not adopted",
			"Move local guidance to this path",
			"Carry original local bytes unchanged",
			"Not installed; preserved in snapshot only",
		])
			assert.ok(text().includes(label), label);
		assert.ok(text().includes("references/original.md"));
		assert.equal(text().includes("Review file disposition"), false);
	} finally {
		await s.cleanup();
	}
});

test("adoption fixtures mirror shipping document direction and restore prior attributes", async () => {
	const html = document.documentElement;
	const previous = {
		dir: html.getAttribute("dir"),
		lang: html.getAttribute("lang"),
	};
	html.setAttribute("dir", "ltr");
	html.setAttribute("lang", "fixture-origin");
	const mount = createRoot(document.getElementById("root"));
	function DirectionProbe() {
		useAdoptionFixtureDocumentDirection();
		return null;
	}
	try {
		setLocale("ur");
		await act(async () => {
			mount.render(React.createElement(DirectionProbe));
		});
		assert.equal(html.getAttribute("dir"), "rtl");
		assert.equal(html.getAttribute("lang"), "ur");
		await act(async () => {
			setLocale("fr");
		});
		assert.equal(html.getAttribute("dir"), "ltr");
		assert.equal(html.getAttribute("lang"), "fr");
	} finally {
		await act(async () => mount.unmount());
		assert.equal(html.getAttribute("dir"), "ltr");
		assert.equal(html.getAttribute("lang"), "fixture-origin");
		setLocale("en");
		for (const key of ["dir", "lang"]) {
			if (previous[key] === null) html.removeAttribute(key);
			else html.setAttribute(key, previous[key]);
		}
	}
});
