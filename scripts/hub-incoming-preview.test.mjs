/**
 * The hub panel's INCOMING preview, mounted through the real component.
 *
 *     node --test scripts/hub-incoming-preview.test.mjs
 *
 * WHAT FAILED BEFORE THIS FILE, and why the fixture looks the way it does:
 * round 2's MAJOR-1. The panel read the incoming preview from
 * "response.preview?.direction === \"pull\"", but core's dry-run apply answers
 * `{reports, status}` only - no `preview` member at all (`desktop_hub.py`,
 * `HubApply` -> `apply_items(..., dry_run=True)`; each row is
 * `report.py` `ItemMergeReport.to_json`). The dialog therefore never opened and
 * "Pull now" could not be reached. This file feeds the answer core really sends
 * through "HubLinkGroup" and asserts what a person sees and what leaves.
 *
 * The canned answer below is a captured real one (core "origin/main"
 * "55d43bc7b31", skill/agent dry-run), trimmed to the fields the panel reads.
 * Nothing here invents a `preview` or a `link_id`: a fixture that carried either
 * would hide the very bug under test.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { JSDOM } = require("jsdom");
let contract = null;

const LOCAL_ID = "7201853c-6a54-4b6e-9d62-3c0f1b9a6a11";
const LINK_ID = "synthetic-link-1";

/** The English words the panel asks for, by key (t() is stubbed below). */
const LABELS = {
	"ui.hub.links.preview_pull": "Preview incoming changes",
	"ui.hub.links.preview_recomputed":
		"Core recomputes this merge when you apply",
	"ui.hub.links.outcome_would_merge": "would merge",
	"ui.hub.links.outcome_needs_review": "needs review",
	"ui.hub.links.outcome_up_to_date": "up to date",
	"ui.hub.links.outcome_unchanged": "unchanged",
	"ui.hub.links.outcome_failed": "failed",
	"ui.hub.links.outcome_skipped": "skipped",
	"ui.hub.links.outcome_unavailable": "unavailable",
	"ui.hub.links.incoming_outcome": "Preview for {item}: {outcome}.",
	/*
	 * Design D10: the two sentences that still ran core's `ItemOutcome` token
	 * straight into the copy. Both interpolate the WORD for the class, which the
	 * `outcome_*` keys above supply.
	 */
	"ui.hub.links.action_result": "{direction} for {item} at {source}: {outcome}",
	"ui.hub.links.incoming_failed": "The preview could not finish ({outcome}).",
	"ui.hub.links.incoming_nothing": "Nothing to pull: this item is {outcome}.",
	"ui.hub.subscriptions.pull": "Pull now",
	"ui.hub.subscriptions.check": "Check now",
	"ui.hub.links.retry": "Retry",
	"ui.hub.subscriptions.cancel": "Cancel",
	"ui.hub.links.prefer_local": "Keep local",
	"ui.hub.links.prefer_remote": "Take remote",
	"ui.hub.links.acknowledge_baseline": "Acknowledge the unknown baseline",
	"ui.hub.links.direction_pull": "Incoming",
	"ui.hub.links.direction_push": "Outgoing",
};

const interpolate = (template, params) =>
	template.replace(/\{(\w+)\}/g, (whole, key) =>
		params && key in params ? String(params[key]) : whole,
	);

/** Core's real dry-run answer for this one row (see the header). */
const DRY_RUN_ANSWER = {
	reports: [
		{
			kind: "agent",
			local_id: LOCAL_ID,
			name: "Coder",
			hub_id: "h-upper",
			outcome: "would-merge",
			fields: [{ field: "instructions", outcome: "remote-wins" }],
			applied: false,
			backup: null,
			error_class: null,
			message: "1 field would change.",
			warnings: [],
			replaced: {},
			classification: "remote-only",
			skipped_reason: null,
		},
		/* Another row's report rides the same answer when a name arm matched it;
		 * it must never be shown or applied under this row. */
		{
			kind: "agent",
			local_id: "11111111-2222-4333-8444-555555555555",
			name: "coder",
			hub_id: "h-lower",
			outcome: "would-merge",
			fields: [],
			applied: false,
			backup: null,
			error_class: null,
			message: "",
			warnings: [],
			replaced: {},
			classification: "remote-only",
			skipped_reason: null,
		},
	],
	status: { items: [], credential: "ok" },
};

const STATUS = {
	state: "available",
	classification: "remote-only",
	enabled: true,
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

/* A link row exactly as core sends an AGENT: "name" is the registry UUID, the
 * display name arrives separately. The pull state is "available" so the panel
 * draws its Preview control. */
const link = {
	link_id: LINK_ID,
	kind: "agent",
	local_id: LOCAL_ID,
	name: LOCAL_ID,
	hub_id: "h-upper",
	hub_source: "https://hub.invalid/api/v1",
	visibility: "public",
	tenant_id: null,
	tenant_name: null,
	remote_revision: "rev-7",
	baseline_state: "known",
	content_state: "present",
	policy: { revision: "p-1", subscribe: false, auto_push: false },
	eligibility: { can_auto_push: true, reason: null },
	pull: { ...STATUS, state: "available" },
	push: { ...STATUS, state: "idle", classification: null },
	auto_will_apply: false,
	auto_will_push: false,
};

let app;

async function mount() {
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "http://localhost/",
	});
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	globalThis.HTMLElement = dom.window.HTMLElement;
	globalThis.Node = dom.window.Node;
	globalThis.Event = dom.window.Event;
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	globalThis.__hubPreviewTest = { records: [], answer: DRY_RUN_ANSWER };

	const built = await build({
		stdin: {
			contents:
				'export { HubLinkGroup } from "./src/renderer/src/features/agents/components/hub-links-panel.tsx";',
			resolveDir: process.cwd(),
			loader: "tsx",
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		packages: "external",
		external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
		jsx: "automatic",
		alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
		loader: { ".tsx": "tsx", ".ts": "ts" },
		/* `apiConfig` reads `import.meta.env`, which a CJS bundle drops. The
		 * panel's compose path reads no env value, so an empty object is the
		 * honest fixture (the server address comes from the transport stub). */
		define: { "import.meta.env": "{}" },
		plugins: [
			{
				name: "stub-the-shell",
				setup(b) {
					/*
					 * The transport is a recorder: this test's subject is the body
					 * the real hook composes and what the real component renders.
					 */
					b.onResolve({ filter: /^\.\/desktop-api$/ }, (args) =>
						/hub-link-actions\.ts$/.test(args.importer)
							? { path: "transport", namespace: "preview-fixture" }
							: undefined,
					);
					b.onResolve({ filter: /^\.\/hub-mutation-safety$/ }, () => ({
						path: "safety",
						namespace: "preview-fixture",
					}));
					b.onResolve({ filter: /^@shared\/components\/ui\/(.*)$/ }, (a) => ({
						path: a.path,
						namespace: "preview-fixture",
					}));
					b.onResolve(
						{
							filter:
								/^@shared\/(i18n|i18n\/use-locale|config\/api-config|lib\/utils|hooks\/use-radient-auth|utils\/toast-manager)$/,
						},
						(a) => ({
							path: a.path,
							namespace: "preview-fixture",
						}),
					);
					b.onResolve(
						{
							filter:
								/^@features\/agent-hub\/(hooks\/use-memberships-query|org-access)$/,
						},
						(a) => ({
							path: a.path,
							namespace: "preview-fixture",
						}),
					);
					b.onResolve(
						{ filter: /^@shared\/api\/local-operator\/hub-link-hooks$/ },
						(a) => ({
							path: a.path,
							namespace: "preview-fixture",
						}),
					);
					b.onResolve({ filter: /^\.\/hub-link-policy-controls$/ }, () => ({
						path: "policy-controls",
						namespace: "preview-fixture",
					}));
					b.onResolve({ filter: /^react-router-dom$/ }, () => ({
						path: "router",
						namespace: "preview-fixture",
					}));
					b.onResolve({ filter: /^lucide-react$/ }, () => ({
						path: "icons",
						namespace: "preview-fixture",
					}));
					b.onLoad({ filter: /.*/, namespace: "preview-fixture" }, (args) => {
						const el = "React.createElement";
						const contents =
							args.path === "transport"
								? `export class DesktopControlError extends Error {}
								   export async function desktopResult(request) {
								     globalThis.__hubPreviewTest.records.push(request);
								     return globalThis.__hubPreviewTest.answer;
								   }`
								: args.path === "safety"
									? `export const guardHubMutation = async (work) => work();
									   export const useHubMutationSafety = () => ({ canWrite: true, snapshot: null });`
									: args.path.endsWith("/button")
										? `import { createElement } from "react";
										   export const Button = ({ variant, size, ...rest }) => createElement("button", rest, rest.children);`
										: args.path.endsWith("/dialog")
											? `import { createElement } from "react";
											   export const Dialog = ({ open, children }) =>
											     open ? createElement("div", { "data-dialog": "open" }, children) : null;
											   export const DialogContent = (p) => createElement("div", p, p.children);
											   export const DialogHeader = (p) => createElement("div", null, p.children);
											   export const DialogTitle = (p) => createElement("h2", null, p.children);
											   export const DialogDescription = (p) => createElement("p", { "data-description": "" }, p.children);
											   export const DialogFooter = (p) => createElement("div", null, p.children);`
											: args.path.endsWith("/checkbox")
												? `import { createElement } from "react";
											   export const Checkbox = (p) => createElement("input", { type: "checkbox" });`
												: args.path.endsWith("/alert")
													? `import { createElement } from "react";
												   export const Alert = (p) => createElement("div", null, p.children);
												   export const AlertTitle = (p) => createElement("div", null, p.children);`
													: args.path.endsWith("/disclosure")
														? `import { createElement } from "react";
												   export const Disclosure = (p) => createElement("div", null, p.children);`
														: args.path === "policy-controls"
															? `export const HubLinkPolicyControls = () => null;
												   export const hubLinkSourceName = (link) => link.hub_source;`
															: args.path === "@shared/i18n"
																? `const LABELS = ${JSON.stringify(LABELS)};
												   export const t = (key, params) => {
												     /* Design D10: which key a sentence asked for is the observable
												        difference between the class's word and the raw token. */
												     (globalThis.__hubAskedKeys ??= []).push(key);
												     /* globalThis.__hubTranslations stands in for another locale's catalogue
												        (see the D10 test); unset means these English words. */
												     const overrides = globalThis.__hubTranslations;
												     const template = (overrides && overrides[key]) || LABELS[key] || key;
												     return template.replace(/\\{(\\w+)\\}/g, (w, k) => (params && k in params ? String(params[k]) : w));
												   };
												   export const formatDateTime = () => "";`
																: args.path === "@shared/i18n/use-locale"
																	? 'export const useI18nLocale = () => "en";'
																	: args.path === "@shared/config/api-config"
																		? "export const apiConfig = {};"
																		: args.path === "@shared/lib/utils"
																			? 'export const cn = (...parts) => parts.filter(Boolean).join(" ");'
																			: args.path ===
																					"@shared/hooks/use-radient-auth"
																				? 'export const useRadientAuth = () => ({ state: "signed-out", user: null });'
																				: args.path ===
																						"@shared/utils/toast-manager"
																					? "export const showSuccessToast = () => {};"
																					: args.path ===
																							"@features/agent-hub/hooks/use-memberships-query"
																						? "export const useMembershipsQuery = () => ({ data: [] });"
																						: args.path ===
																								"@features/agent-hub/org-access"
																							? "export const usableOrgs = () => [];"
																							: args.path ===
																									"@shared/api/local-operator/hub-link-hooks"
																								? 'export const useHubLinks = () => ({}); export const hubLinksKey = ["hub", "links"];'
																								: args.path === "router"
																									? "export const useNavigate = () => () => {}; export const useSearchParams = () => [new URLSearchParams(), () => {}];"
																									: args.path === "icons"
																										? `import { createElement } from "react";
												   export default new Proxy({}, { get: () => () => createElement("span", null) });
												   export const Check = () => null; export const CircleAlert = () => null;
												   export const CircleArrowDown = () => null; export const CircleHelp = () => null;
												   export const Link2 = () => null; export const LoaderCircle = () => null;
												   export const TriangleAlert = () => null;`
																										: "export {};";
						return { contents, loader: "js" };
					});
				},
			},
		],
	});
	const module = { exports: {} };
	new Function("module", "exports", "require", built.outputFiles[0].text)(
		module,
		module.exports,
		require,
	);
	app = module.exports;

	/*
	 * The contract composes the WIRE body. Loading the real one (not a copy)
	 * means a change to the op -> request mapping cannot pass this test by
	 * agreeing with a fixture.
	 */
	const contractFile = readdirSync("src/shared").find(
		(name) =>
			name.endsWith("-contract.ts") &&
			!name.includes("control") &&
			!name.includes("session") &&
			readFileSync(`src/shared/${name}`, "utf8").includes("hub.check"),
	);
	assert.ok(contractFile, "the desktop contract module is present");
	const contractBuilt = await build({
		stdin: {
			contents: `export { desktopEndpoint, desktopRequestSchema } from "./src/shared/${contractFile}";`,
			resolveDir: process.cwd(),
			loader: "tsx",
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		packages: "external",
		jsx: "automatic",
		alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
		loader: { ".tsx": "tsx", ".ts": "ts" },
		/* The contract may touch "apiConfig", whose loader reads
		 * "import.meta.env" - absent in a CJS bundle. The compose path itself
		 * reads no env, so an empty object is the honest fixture. */
		define: { "import.meta.env": "{}" },
	});
	const contractModule = { exports: {} };
	new Function(
		"module",
		"exports",
		"require",
		contractBuilt.outputFiles[0].text,
	)(contractModule, contractModule.exports, require);
	contract = contractModule.exports;
}

/** The bytes the app would put on the wire for one recorded op. */
const wire = (record) =>
	contract.desktopEndpoint(contract.desktopRequestSchema.parse(record)).body;

const actAsync = async (work) => {
	await act(async () => {
		await work();
	});
};

/** React Query resolves a mutation in a microtask; give it one macrotask. */
const settle = () => actAsync(() => new Promise((r) => setTimeout(r, 0)));

test("the dialog opens from core's dry-run reports and Pull sends the real apply", async () => {
	await mount();
	const host = document.createElement("div");
	document.body.appendChild(host);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(host);
	await actAsync(() => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(app.HubLinkGroup, {
					link,
					displayName: "Coder",
					itemsById: true,
				}),
			),
		);
	});

	const button = (label) =>
		[...document.querySelectorAll("button")].find(
			(node) => node.textContent.trim() === label,
		);
	assert.ok(button("Preview incoming changes"), "the preview control renders");
	await actAsync(() => button("Preview incoming changes").click());
	await settle();

	/* 1. The body is the one core accepts: the row's id, no link_id, dry run. */
	const previewBody = wire(globalThis.__hubPreviewTest.records[0]);
	assert.deepEqual(Object.keys(previewBody).sort(), [
		"dry_run",
		"kind",
		"local_id",
		"request_id",
	]);
	assert.equal(previewBody.kind, "agent");
	assert.equal(previewBody.local_id, LOCAL_ID);
	assert.equal(previewBody.dry_run, true);

	/* 2. The dialog opens, and it shows THIS row's report only. */
	assert.ok(document.querySelector('[data-dialog="open"]'), "the dialog opens");
	const text = document.body.textContent;
	/* Design D1: the state word, and a sentence that ends - the raw enum token
	 * ran straight into the report's own message before this. */
	assert.match(text, /Preview for Coder: would merge\./);
	assert.match(text, /Core recomputes this merge/);
	assert.doesNotMatch(
		text,
		/11111111-2222/,
		"another row's report is never shown",
	);

	/* 3. Pull now sends the real apply for the same one item. */
	assert.ok(button("Pull now"), "Pull now is reachable");
	await actAsync(() => button("Pull now").click());
	await settle();
	const applyBody = wire(globalThis.__hubPreviewTest.records[1]);
	assert.deepEqual(Object.keys(applyBody).sort(), [
		"kind",
		"local_id",
		"request_id",
	]);
	assert.equal(applyBody.kind, "agent");
	assert.equal(applyBody.local_id, LOCAL_ID);
	/* The wire carries no receipt and no direction: core's HubApply accepts
	 * neither, and its dry-run answer never produced one. */
	assert.equal("preview_receipt" in applyBody, false);
	assert.equal("confirm_apply" in applyBody, false);
	assert.equal("link_id" in applyBody, false);
	assert.equal("direction" in applyBody, false);
});

test("a dry run with nothing to merge is stated inline, with no dialog", async () => {
	await mount();
	globalThis.__hubPreviewTest.answer = {
		reports: [
			{ ...DRY_RUN_ANSWER.reports[0], outcome: "up-to-date", message: "" },
		],
		status: { items: [], credential: "ok" },
	};
	const host = document.createElement("div");
	document.body.appendChild(host);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(host);
	await actAsync(() => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(app.HubLinkGroup, {
					link,
					displayName: "Coder",
					itemsById: true,
				}),
			),
		);
	});
	const preview = [...document.querySelectorAll("button")].find(
		(node) => node.textContent.trim() === "Preview incoming changes",
	);
	await actAsync(() => preview.click());
	await settle();
	assert.equal(document.querySelector('[data-dialog="open"]'), null);
	/* Design D1: the state is a translated word, not core's enum token. */
	assert.match(
		document.body.textContent,
		/Nothing to pull: this item is up to date\./,
	);
});

test("the pull result and the failed preview name the class, never core's token (design D10)", async () => {
	/*
	 * Design D10 (round 1): D1 humanised the dialog's headline and left two
	 * sentences in the same surface interpolating core's `ItemOutcome` enum raw -
	 * the pull result ("Incoming for Coder at …: would-merge") and the failed
	 * preview ("The preview could not finish (needs-review)"). A reader had to
	 * parse a hyphenated machine token, and in any locale those words stayed
	 * English because the token never reached the catalogue.
	 *
	 * Both halves are asserted where each defect is observable:
	 * - the pull line, on the RENDERED sentence: `would-merge` must appear as the
	 *   class's word "would merge" and the raw token must be gone;
	 * - the failed line, on a CATALOGUE VALUE that differs from the token: a
	 *   failure class's English word reads the same as its token today
	 *   (`outcome_failed` = "failed"), so English alone could not tell the two
	 *   apart. The Spanish catalogue's word for that class (`fallido`, straight
	 *   from `src/i18n/catalogues/es/ui.hub.json`) is what the sentence must
	 *   carry once the class is translated - and it only appears if the sentence
	 *   asks the catalogue at all. Raw interpolation renders "(failed)".
	 */
	await mount();
	const host = document.createElement("div");
	document.body.appendChild(host);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(host);
	await actAsync(() => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(app.HubLinkGroup, {
					link,
					displayName: "Coder",
					itemsById: true,
				}),
			),
		);
	});
	const button = (label) =>
		[...document.querySelectorAll("button")].find(
			(node) => node.textContent.trim() === label,
		);

	/* 1. A preview that failed, in a language that translates the class. */
	globalThis.__hubAskedKeys = [];
	globalThis.__hubTranslations = { "ui.hub.links.outcome_failed": "fallido" };
	globalThis.__hubPreviewTest.answer = {
		reports: [
			{
				...DRY_RUN_ANSWER.reports[0],
				outcome: "failed",
				error_class: "transport",
				message: "hub unreachable at https://hub.invalid/api/v1 (502)",
			},
		],
		status: { items: [], credential: "ok" },
	};
	await actAsync(() => button("Preview incoming changes").click());
	await settle();
	assert.match(
		document.body.textContent,
		/The preview could not finish \(fallido\)\./,
		"the failure sentence carries the catalogue's word for the class",
	);
	assert.ok(
		globalThis.__hubAskedKeys.includes("ui.hub.links.outcome_failed"),
		"the failure sentence asks the catalogue for the class's word",
	);

	/* 2. A pull that lands a directional report, so the result line renders. */
	globalThis.__hubTranslations = null;
	globalThis.__hubPreviewTest.answer = DRY_RUN_ANSWER;
	await actAsync(() => button("Preview incoming changes").click());
	await settle();
	assert.ok(document.querySelector('[data-dialog="open"]'), "the dialog opens");
	globalThis.__hubPreviewTest.answer = {
		reports: [
			{
				...DRY_RUN_ANSWER.reports[0],
				link_id: LINK_ID,
				direction: "pull",
				operation_id: "op-1",
				remote_revision: "rev-7",
				model_used: null,
				outcome: "would-merge",
			},
		],
		status: { items: [], credential: "ok" },
	};
	await actAsync(() => button("Pull now").click());
	await settle();
	const text = document.body.textContent;
	assert.match(
		text,
		/: would merge$/,
		"the pull result states the class's word, and ends on it",
	);
	assert.doesNotMatch(
		text,
		/would-merge/,
		"no raw ItemOutcome token reaches the reader",
	);
});

test("the call sites pass the capability and the display name (round-1's UUID bug)", () => {
	/*
	 * Round 1's MAJOR was a "name" that was really a UUID. The hook is right only
	 * if its callers hand it the display name and the live capability; both were
	 * unpinned (round 2 MINOR-2), and a revert of either passed the whole suite.
	 */
	const page = readFileSync(
		"src/renderer/src/features/agents/components/agents-page.tsx",
		"utf8",
	);
	assert.match(
		page,
		/itemsById=\{desktopFeatureEnabled\(\s*capabilities\.data,\s*"hub_items_by_id",?\s*\)\}/,
	);
	const sidebar = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	/*
	 * The mark's address prop is `itemName` (the row's REGISTRY name); the branch
	 * under review split main's single `displayName` into the wire address and the
	 * readable label, so this pin follows the prop that now carries the address.
	 */
	assert.match(sidebar, /itemName=\{name\}/);
	assert.match(sidebar, /itemsById=\{hubItemsById\}/);
});
