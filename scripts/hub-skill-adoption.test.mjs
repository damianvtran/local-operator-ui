/**
 * Renderer-path proof, not native filesystem proof: the actual adoption component,
 * pull hook, desktop envelope decoder and request schema run against a controlled
 * IPC boundary. Failure controls prevent a guessed fixture from becoming a pass.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// These six full envelopes came from actual core HTTP requests, not a second
// frontend interpretation of which state/strategy combinations should exist.
const coreResponseTable = JSON.parse(
	readFileSync(
		new URL(
			"./fixtures/hub-skill-adoption-core-responses.json",
			import.meta.url,
		),
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
// The real Dialog/portal path needs browser DOM constructors in this Node host;
// these are jsdom objects, not a separate browser or native UI claim.
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
			'export * from "./src/renderer/src/features/agent-hub/components/hub-skill-adoption"; export * from "./src/renderer/src/shared/api/local-operator/hub-skill-adoption"; export { desktopRequestSchema, desktopEndpoint } from "./src/shared/desktop-contract"; export { useAdoptionFixtureDocumentDirection } from "./src/renderer/src/features/agent-hub/hub-skill-adoption.fixtures"; export { setLocale } from "./src/i18n"; export { HubSkillsLibrary } from "./src/renderer/src/features/agent-hub/components/hub-skills-library";',
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
const {
	HubSkillAdoption,
	HubSkillsLibrary,
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

async function productionSubscribeScene({
	override,
	secondCandidate = false,
} = {}) {
	const requests = [];
	let installed = false;
	const row = {
		id: source.remoteId,
		name: source.alias,
		description: "Fixture skill",
		visibility: "org",
		tenant_id: source.scope.tenantId,
		document_version: 1,
		content_revision: 1,
		revision: "fixture-revision",
		sync_contract: { revision_cas: 1, skills: 1 },
		files: [{ path: "SKILL.md", content: "# Hub guidance\n" }],
	};
	const rows = secondCandidate
		? [row, { ...row, id: "skill-second-candidate", name: "second-candidate" }]
		: [row];
	const direction = {
		state: "up-to-date",
		classification: null,
		enabled: false,
		last_checked_at: null,
		last_success_at: null,
		attempts: 0,
		next_retry_at: null,
		error_class: null,
		error_subclass: null,
		safe_message: null,
		operation_id: null,
		model_used: null,
		summary: null,
		backup_receipt: null,
	};
	const link = {
		link_id: "subscribe-adoption-link",
		kind: "skill",
		local_id: source.alias,
		name: source.alias,
		hub_id: source.remoteId,
		hub_source: "http://localhost:8127/v1",
		visibility: "org",
		tenant_id: source.scope.tenantId,
		tenant_name: "Minerva",
		policy: {
			subscribe: true,
			auto_push: false,
			revision: "policy-after-adoption",
		},
		eligibility: { can_auto_push: true, reason: null },
		baseline_state: "pulled",
		remote_revision: row.revision,
		content_state: "present",
		local_path: "/fixture/managed/release-checklist",
		auto_will_apply: false,
		auto_will_push: false,
		pull: direction,
		push: direction,
	};
	const inventory = () => ({ links: installed ? [link] : [], unresolved: [] });
	const caps = {
		desktop_contract: 1,
		desktop_available: true,
		desktop_auth: "bearer",
		features: { hub_skills: 1, hub_links: 1, radient_org: 1 },
	};
	window.api = {
		desktop: {
			request: async (input) => {
				requests.push(input);
				const overridden = override?.(input);
				if (overridden !== undefined) return overridden;
				if (input.op === "capabilities") return ok(caps);
				if (input.op === "hub.links") return ok(inventory());
				if (input.op === "radient.request") {
					const operation = input.control.operation;
					if (operation === "org_skills.list")
						return ok({
							data: {
								result: { skills: rows, sync_contract: row.sync_contract },
							},
						});
					if (operation === "org_skill.get")
						return ok({
							data: {
								result:
									rows.find(
										(candidate) => candidate.id === input.control.skill_id,
									) ?? row,
							},
						});
				}
				if (input.op === "hub.skillSubscribe")
					return {
						status: 409,
						body: {
							detail: {
								code: "alias-occupied",
								message: "Review this authored folder before subscribing.",
							},
						},
					};
				if (input.op === "hub.skillPull" && !input.dryRun && !input.confirm)
					return {
						status: 409,
						body: {
							detail: {
								code: "alias-occupied",
								message: "Review this authored folder before downloading.",
							},
						},
					};
				if (input.op === "hub.skillPull" && input.dryRun)
					return ok({ ...preview, links: inventory() });
				if (
					input.op === "hub.skillPull" &&
					input.confirm &&
					input.adoptionReceipt === preview.adoption_receipt
				) {
					installed = true;
					return ok({ ...applied, link, links: inventory() });
				}
				throw new Error(
					`Unexpected production Subscribe fixture operation: ${input.op}`,
				);
			},
		},
	};
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false },
		},
	});
	client.setQueryData(["desktop", "capabilities"], caps);
	const mount = createRoot(document.getElementById("root"));
	await act(async () => {
		mount.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(HubSkillsLibrary, {
					scope: source.scope,
					signedIn: true,
				}),
			),
		);
		await pause();
	});
	await act(async () => {
		await pause();
	});
	const clickTestId = async (id) => {
		const node = document.querySelector(`[data-testid="${id}"]`);
		assert.ok(node, `missing ${id}: ${text()}`);
		assert.notEqual(node.disabled, true, `disabled ${id}`);
		await act(async () => {
			node.click();
			await pause();
		});
		await act(async () => {
			await pause();
		});
	};
	return {
		requests,
		client,
		clickTestId,
		writes: () =>
			requests.filter(
				(r) => r.op === "hub.skillSubscribe" || r.op === "hub.skillPull",
			),
		cleanup: async () => {
			await act(async () => mount.unmount());
			client.clear();
		},
	};
}

test("production direct Subscribe collision retains membership intent through reviewed adoption", async () => {
	const s = await productionSubscribeScene();
	try {
		await s.clickTestId("hub-skill-open");
		assert.equal(
			s.writes().length,
			0,
			"opening the production detail never mutates membership/content",
		);
		await s.clickTestId("hub-skill-subscribe");
		assert.equal(s.writes().length, 1);
		assert.equal(s.writes()[0].op, "hub.skillSubscribe");
		assert.ok(
			document.querySelector('[data-testid="hub-skill-subscribe-failed"]'),
		);
		await press("Review and merge");
		assert.equal(
			s.writes().length,
			1,
			"opening review never silently downloads or previews",
		);
		assert.equal(
			document.querySelector('[data-testid="hub-skill-subscribe-failed"]'),
			null,
			"stale subscription refusal is hidden during review",
		);
		await press("Create preview");
		await press("Confirm reviewed adoption");
		const writes = s.writes();
		assert.equal(writes.length, 3);
		for (const request of writes.slice(1)) {
			assert.equal(request.op, "hub.skillPull");
			assert.equal(
				request.subscribe,
				true,
				"Subscribe recovery must not become Download-only",
			);
			assert.equal(request.autoPush, false);
			assert.equal(request.confirmPublicEgress, false);
			assert.equal(request.hubId, source.remoteId);
			assert.equal(request.tenantId, source.scope.tenantId);
			assert.equal(request.localAlias, source.alias);
		}
		assert.equal(writes[1].dryRun, true);
		assert.equal(writes[1].allowLlm, false);
		assert.equal(writes[2].confirm, true);
		assert.equal(writes[2].adoptionReceipt, preview.adoption_receipt);
		assert.equal(writes[2].adoptionStrategy, writes[1].adoptionStrategy);
		assert.ok(text().includes("Skill adopted"));
		await press("Done");
		assert.equal(
			document.querySelector('[data-testid="hub-skill-subscribe-failed"]'),
			null,
		);
		assert.equal(
			button("Review and merge"),
			undefined,
			"completed adoption cannot reopen a stale Subscribe refusal",
		);
	} finally {
		await s.cleanup();
	}
});

test("production Subscribe collision review can cancel without a preview or membership write", async () => {
	const s = await productionSubscribeScene();
	try {
		await s.clickTestId("hub-skill-open");
		await s.clickTestId("hub-skill-subscribe");
		await press("Review and merge");
		await press("Cancel");
		assert.equal(
			s.writes().length,
			1,
			"cancel must leave only the original refused Subscribe",
		);
		assert.equal(s.writes()[0].op, "hub.skillSubscribe");
		assert.equal(
			document.querySelector('[data-testid="hub-skill-subscribe-failed"]'),
			null,
		);
		assert.equal(
			button("Review and merge"),
			undefined,
			"cancel clears stale recovery state",
		);
		assert.deepEqual(s.client.getQueryData(["desktop", "hub-links"]), {
			links: [],
			unresolved: [],
		});
	} finally {
		await s.cleanup();
	}
});

for (const { first, latest, subscribed } of [
	{
		first: "hub-skill-subscribe",
		latest: "hub-skill-download",
		subscribed: false,
	},
	{
		first: "hub-skill-download",
		latest: "hub-skill-subscribe",
		subscribed: true,
	},
]) {
	test(`production ${first} then ${latest} reviews and confirms only the latest intent`, async () => {
		const s = await productionSubscribeScene();
		try {
			await s.clickTestId("hub-skill-open");
			await s.clickTestId(first);
			await s.clickTestId(latest);
			const refusals = s.writes();
			assert.equal(
				refusals.length,
				2,
				"both direct actions must actually refuse before recovery",
			);
			assert.equal(
				refusals[0].op,
				first === "hub-skill-subscribe"
					? "hub.skillSubscribe"
					: "hub.skillPull",
			);
			assert.equal(
				refusals[1].op,
				latest === "hub-skill-subscribe"
					? "hub.skillSubscribe"
					: "hub.skillPull",
			);
			await press("Review and merge");
			assert.equal(
				s.writes().length,
				2,
				"review must not silently apply either intent",
			);
			await press("Create preview");
			await press("Confirm reviewed adoption");
			const writes = s.writes();
			assert.equal(writes.length, 4);
			for (const request of writes.slice(2)) {
				assert.equal(request.op, "hub.skillPull");
				assert.equal(
					request.subscribe,
					subscribed,
					"stale opposite-action refusal must not change reviewed membership intent",
				);
				assert.equal(request.autoPush, false);
				assert.equal(request.confirmPublicEgress, false);
				assert.equal(request.hubId, source.remoteId);
				assert.equal(request.tenantId, source.scope.tenantId);
				assert.equal(request.localAlias, source.alias);
			}
			assert.equal(writes[2].dryRun, true);
			assert.equal(writes[3].confirm, true);
			assert.equal(writes[3].adoptionReceipt, preview.adoption_receipt);
			assert.equal(writes[3].adoptionStrategy, writes[2].adoptionStrategy);
			assert.ok(text().includes("Skill adopted"));
		} finally {
			await s.cleanup();
		}
	});
}

function deferredResponse() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const occupiedResponse = {
	status: 409,
	body: {
		detail: { code: "alias-occupied", message: "Occupied authored skill." },
	},
};

for (const { first, latest, subscribed } of [
	{
		first: "hub-skill-subscribe",
		latest: "hub-skill-download",
		subscribed: false,
	},
	{
		first: "hub-skill-download",
		latest: "hub-skill-subscribe",
		subscribed: true,
	},
]) {
	test(`late old ${first} response cannot replace current ${latest} review intent`, async () => {
		const delayed = deferredResponse();
		const firstOp =
			first === "hub-skill-subscribe" ? "hub.skillSubscribe" : "hub.skillPull";
		let held = false;
		const s = await productionSubscribeScene({
			override: (input) => {
				if (!held && input.op === firstOp) {
					held = true;
					return delayed.promise;
				}
			},
		});
		try {
			await s.clickTestId("hub-skill-open");
			await s.clickTestId(first);
			await s.clickTestId(latest);
			assert.equal(s.writes().length, 2);
			await act(async () => {
				delayed.resolve(occupiedResponse);
				await pause();
			});
			await press("Review and merge");
			await press("Create preview");
			await press("Confirm reviewed adoption");
			for (const request of s.writes().slice(2)) {
				assert.equal(
					request.subscribe,
					subscribed,
					"detached old mutation must not regain review priority",
				);
				assert.equal(request.autoPush, false);
			}
			assert.equal(s.writes()[3].adoptionReceipt, preview.adoption_receipt);
		} finally {
			delayed.resolve(occupiedResponse);
			await s.cleanup();
		}
	});
}

test("closing an old pending preview then opening a different candidate cannot reuse its receipt", async () => {
	const delayed = deferredResponse();
	let held = false;
	const s = await productionSubscribeScene({
		secondCandidate: true,
		override: (input) => {
			if (!held && input.op === "hub.skillPull" && input.dryRun) {
				held = true;
				return delayed.promise;
			}
		},
	});
	try {
		await s.clickTestId("hub-skill-open");
		await s.clickTestId("hub-skill-subscribe");
		await press("Review and merge");
		await press("Create preview");
		const close = document.querySelector(
			'[role="dialog"] button[aria-label="Close"]',
		);
		assert.ok(
			close,
			"shipping dialog must permit closing a pending non-mutating preview",
		);
		await act(async () => {
			close.click();
			await pause();
		});
		const second = document.querySelector(
			'[data-skill-id="skill-second-candidate"]',
		);
		assert.ok(second);
		await act(async () => {
			second.click();
			await pause();
		});
		await act(async () => {
			await pause();
		});
		await s.clickTestId("hub-skill-download");
		await press("Review and merge");
		await act(async () => {
			delayed.resolve(
				ok({ ...preview, adoption_receipt: "obsolete-first-preview-receipt" }),
			);
			await pause();
		});
		assert.equal(
			button("Confirm reviewed adoption"),
			undefined,
			"late old preview cannot populate a fresh candidate review",
		);
		await press("Create preview");
		await press("Confirm reviewed adoption");
		const confirm = s.writes().at(-1);
		assert.equal(confirm.hubId, "skill-second-candidate");
		assert.equal(confirm.localAlias, "second-candidate");
		assert.equal(confirm.subscribe, false);
		assert.equal(confirm.autoPush, false);
		assert.equal(
			confirm.adoptionReceipt,
			preview.adoption_receipt,
			"confirmation cannot attach a prior candidate/action receipt",
		);
	} finally {
		delayed.resolve(ok(preview));
		await s.cleanup();
	}
});

test("cancel then reopen the same candidate under the opposite action cannot retain the previous receipt", async () => {
	let previews = 0;
	const s = await productionSubscribeScene({
		override: (input) => {
			if (input.op === "hub.skillPull" && input.dryRun) {
				previews += 1;
				return ok({
					...preview,
					adoption_receipt:
						previews === 1
							? "cancelled-subscribe-preview-receipt"
							: preview.adoption_receipt,
				});
			}
		},
	});
	try {
		await s.clickTestId("hub-skill-open");
		await s.clickTestId("hub-skill-subscribe");
		await press("Review and merge");
		await press("Create preview");
		await press("Cancel");
		await s.clickTestId("hub-skill-download");
		await press("Review and merge");
		assert.equal(button("Confirm reviewed adoption"), undefined);
		await press("Create preview");
		await press("Confirm reviewed adoption");
		const writes = s.writes();
		assert.equal(writes.length, 5);
		assert.equal(writes[1].subscribe, true);
		assert.equal(writes[3].subscribe, false);
		assert.equal(writes[4].subscribe, false);
		assert.equal(writes[4].adoptionReceipt, preview.adoption_receipt);
		assert.notEqual(
			writes[1].requestId,
			writes[3].requestId,
			"each action review owns its own request identity",
		);
		assert.notEqual(
			writes[3].requestId,
			writes[4].requestId,
			"confirmation is a separate receipt-bound request",
		);
	} finally {
		await s.cleanup();
	}
});

test("production exact core equal preview can re-preview and confirm using only the requested merge strategy", async () => {
	const equalCase = coreResponseTable.cases.find(
		(entry) => entry.name === "equal/equal",
	);
	const equalPreview = equalCase.response.result;
	const content = equalPreview.adoption.files[0].proposed;
	assert.equal(
		skillAdoptionPreviewSchema.safeParse(equalPreview).success,
		true,
	);
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "hub.skillPull",
			requestId: source.requestId,
			hubId: source.remoteId,
			hubSource: "http://localhost:8127/v1",
			visibility: "org",
			tenantId: source.scope.tenantId,
			localAlias: source.alias,
			adoptionStrategy: "equal",
		}).success,
		false,
		"response equality must not extend the request policy enum",
	);
	const s = await productionSubscribeScene({
		override: (input) => {
			if (input.op === "hub.skillPull" && input.dryRun)
				return { status: equalCase.http_status, body: equalCase.response };
			if (
				input.op === "hub.skillPull" &&
				input.confirm &&
				input.adoptionReceipt === equalPreview.adoption_receipt
			)
				return ok(applied);
		},
	});
	try {
		await s.clickTestId("hub-skill-open");
		await s.clickTestId("hub-skill-download");
		await press("Review and merge");
		await press("Create preview");
		assert.equal(
			button("Confirm reviewed adoption").disabled,
			false,
			"valid HTTP200 equal preview must enable explicit confirmation",
		);
		assert.ok(text().includes(content));
		assert.equal(text().includes("No adoption is confirmed"), false);
		assert.equal(
			s.writes().length,
			2,
			"equal preview itself must not confirm or apply",
		);
		assert.deepEqual(s.client.getQueryData(["desktop", "hub-links"]), {
			links: [],
			unresolved: [],
		});
		await press("Create new preview");
		assert.equal(button("Confirm reviewed adoption").disabled, false);
		await press("Confirm reviewed adoption");
		const writes = s.writes();
		assert.equal(writes.length, 4);
		for (const request of writes.slice(1)) {
			assert.equal(
				request.adoptionStrategy,
				"merge",
				"response-only equal is never sent as a request strategy",
			);
			assert.equal(request.subscribe, false);
			assert.equal(request.autoPush, false);
		}
		assert.equal(writes[1].dryRun, true);
		assert.equal(writes[2].dryRun, true);
		assert.equal(writes[3].confirm, true);
		assert.equal(writes[3].adoptionReceipt, equalPreview.adoption_receipt);
		assert.ok(text().includes("Skill adopted"));
	} finally {
		await s.cleanup();
	}
});

for (const entry of coreResponseTable.cases) {
	test(`actual serialized core boundary: ${entry.name} HTTP ${entry.http_status}`, async () => {
		assert.equal(
			entry.core_head,
			coreResponseTable.capture_provenance.core_head,
		);
		const result = entry.response.result;
		const parsed = skillAdoptionPreviewSchema.safeParse(result);
		assert.equal(
			parsed.success,
			entry.http_status === 200,
			"only actual successful preview envelopes qualify for confirmation",
		);
		const s = await scene(() => ({
			status: entry.http_status,
			body: entry.response,
		}));
		try {
			await press("Create preview");
			if (entry.http_status !== 200) {
				assert.equal(button("Confirm reviewed adoption"), undefined);
				assert.ok(text().includes("No adoption is confirmed"));
			} else {
				assert.equal(parsed.data.adoption.state, result.adoption.state);
				assert.equal(parsed.data.adoption.strategy, result.adoption.strategy);
				assert.equal(
					button("Confirm reviewed adoption").disabled,
					result.adoption.state === "needs-choice",
				);
				for (const file of result.adoption.files)
					if (file.proposed) assert.ok(text().includes(file.proposed));
				if (result.adoption.state === "needs-choice") {
					assert.equal(result.adoption.strategy, null);
					assert.ok(button("Preview keeping local"));
					assert.ok(button("Preview using Hub"));
				}
			}
			assert.equal(
				s.requests.length,
				1,
				"a response must not automatically trigger confirmation",
			);
		} finally {
			await s.cleanup();
		}
	});
}

for (const invalid of [
	{ field: "state", value: "unsupported-state" },
	{ field: "strategy", value: "unsupported-strategy" },
]) {
	test(`unsupported response ${invalid.field} fails closed at the actual-core boundary`, async () => {
		const captured = coreResponseTable.cases.find(
			(entry) => entry.name === "equal/equal",
		).response.result;
		const result = {
			...captured,
			adoption: { ...captured.adoption, [invalid.field]: invalid.value },
		};
		assert.equal(skillAdoptionPreviewSchema.safeParse(result).success, false);
		const s = await scene(() => ok(result));
		try {
			await press("Create preview");
			assert.equal(button("Confirm reviewed adoption"), undefined);
			assert.ok(text().includes("No adoption is confirmed"));
		} finally {
			await s.cleanup();
		}
	});
}
