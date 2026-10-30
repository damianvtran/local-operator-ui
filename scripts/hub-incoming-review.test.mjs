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

let app = null;

const LOCAL_ID = "7201853c-6a54-4b6e-9d62-3c0f1b9a6a11";
const LINK_ID = "synthetic-link-1";

/** The English words the panel asks for, by key (t() is stubbed below). */
const LABELS = {
	"ui.hub.links.preview_pull": "Preview incoming changes",
	"ui.hub.links.unknown_baseline": "The baseline is unknown.",
	"ui.hub.links.incoming_needs_review":
		"The hub and your copy both changed this item. Choose which side to keep, then pull again.",
	"ui.hub.links.incoming_unknown_baseline":
		"No baseline was recorded for this copy, so every field counts as changed. Tick the acknowledgement.",
	"ui.hub.status.other_error": "Something else went wrong.",
	"ui.hub.status.transport_error": "Could not reach the hub.",
	"ui.hub.links.incoming_failed": "The preview could not finish ({outcome}).",
	"ui.hub.links.name_ambiguous": "Another item has the same name.",
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
				'export { HubLinkGroup } from "./src/renderer/src/features/agents/components/hub-links-panel.tsx";\nexport { HubLinkSidebarMark } from "./src/renderer/src/features/chat/components/hub-link-sidebar-mark.tsx";',
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
		alias: {
			"@shared": `${process.cwd()}/src/renderer/src/shared`,
			"@features": `${process.cwd()}/src/renderer/src/features`,
		},
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
					b.onResolve(
						{
							filter:
								/^@features\/agents\/components\/hub-link-policy-controls$/,
						},
						() => ({
							path: "policy-controls",
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
								     return globalThis.__hubPreviewTest.answer(request);
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
											   export const Checkbox = (p) => createElement("input", { type: "checkbox", checked: p.checked, onChange: (e) => p.onCheckedChange && p.onCheckedChange(e.target.checked) });`
												: args.path.endsWith("/alert")
													? `import { createElement } from "react";
												   export const Alert = (p) => createElement("div", null, p.children);
												   export const AlertTitle = (p) => createElement("div", null, p.children);`
													: args.path.endsWith("/popover")
														? 'import { createElement } from "react"; export const Popover = (p) => createElement("div", { "data-popover-open": p.open ? "yes" : "no" }, p.children); export const PopoverAnchor = (p) => createElement("div", null, p.children); export const PopoverContent = (p) => createElement("div", { "data-popover-content": "" }, p.children);'
														: args.path.endsWith("/tooltip")
															? 'import { createElement } from "react"; export const Tooltip = (p) => createElement("span", null, p.children);'
															: args.path.endsWith("/disclosure")
																? `import { createElement } from "react";
												   export const Disclosure = (p) => createElement("div", null, p.children);`
																: args.path === "policy-controls"
																	? `export const HubLinkPolicyControls = () => null;
												   export const hubLinkSourceName = (link) => link.hub_source;`
																	: args.path === "@shared/i18n"
																		? `const LABELS = ${JSON.stringify(LABELS)};
												   export const t = (key, params) => {
												     const template = LABELS[key] ?? key;
												     return template.replace(/\\{(\\w+)\\}/g, (w, k) => (params && k in params ? String(params[k]) : w));
												   };
												   export const formatDateTime = () => "";`
																		: args.path === "@shared/i18n/use-locale"
																			? 'export const useI18nLocale = () => "en";'
																			: args.path ===
																					"@shared/config/api-config"
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

const baseLink = {
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
	content_state: "present",
	policy: { revision: "p-1", subscribe: false, auto_push: false },
	eligibility: { can_auto_push: true, reason: null },
	pull: { ...STATUS },
	push: { ...STATUS, state: "idle", classification: null },
	auto_will_apply: false,
	auto_will_push: false,
};
const link = { ...baseLink, baseline_state: "known" };
/** A legacy link: core records no baseline, so every dry run is needs-review. */
const unknownLink = { ...baseLink, baseline_state: "adopt-unknown" };

/** One `ItemMergeReport.to_json()` row, core's exact member set. */
const report = (over) => ({
	kind: "agent",
	local_id: LOCAL_ID,
	name: "Coder",
	hub_id: "h-upper",
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
	...over,
});

const answerOf = (rows) => ({
	reports: rows,
	status: { items: [], credential: "ok" },
});

/*
 * CORE'S OWN DRY-RUN ROWS, transcribed from review round 3's wire probe (and
 * `merge.py`: an unknown baseline without the acknowledgement is `needs-review`,
 * never `would-merge`).
 */
const CONFLICT = report({
	outcome: "needs-review",
	error_class: "merge-refused",
	message: "the hub and your copy both changed the same text",
});
const UNKNOWN_BASELINE = report({
	outcome: "needs-review",
	error_class: "model-unavailable",
	message:
		"the baseline is unknown (no record). Re-run with --accept-unknown-baseline to merge anyway",
});
const UNAVAILABLE = report({
	outcome: "unavailable",
	error_class: "hub-item-missing",
	message: "the hub no longer lists this item",
});

const isDryRun = (request) => request.dryRun === true;

const mountPanel = async (component, props) => {
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
				React.createElement(component, props),
			),
		);
	});
	return root;
};

const button = (label) =>
	[...document.querySelectorAll("button")].find(
		(node) => node.textContent.trim() === label,
	);

test("a conflict opens the dialog, Take remote re-previews, and Pull applies that choice", async () => {
	await mount();
	globalThis.__hubPreviewTest.answer = (request) => {
		if (!isDryRun(request)) {
			return answerOf([report({ outcome: "merged", applied: true })]);
		}
		/* Core settles a conflict only with a preference. */
		return answerOf([request.prefer === "remote" ? report({}) : CONFLICT]);
	};
	await mountPanel(app.HubLinkGroup, {
		link,
		displayName: "Coder",
		itemsById: true,
	});

	await actAsync(() => button("Preview incoming changes").click());
	await settle();

	/* There IS something to pull: the dialog opens and says what is owed. */
	assert.ok(document.querySelector('[data-dialog="open"]'), "the dialog opens");
	assert.match(
		document.body.textContent,
		/The hub and your copy both changed this item/,
		"the needs-review heading is shown",
	);
	assert.match(
		document.body.textContent,
		/the hub and your copy both changed the same text/,
		"core's own message is shown",
	);
	assert.ok(button("Take remote"), "the preference choices are reachable");
	assert.ok(
		button("Pull now").disabled,
		"Pull waits for a preview that would merge",
	);

	await actAsync(() => button("Take remote").click());
	await settle();
	const repreview = wire(globalThis.__hubPreviewTest.records.at(-1));
	assert.equal(repreview.dry_run, true);
	assert.equal(repreview.prefer, "remote");
	assert.equal(
		button("Pull now").disabled,
		false,
		"Pull is enabled once it would merge",
	);

	await actAsync(() => button("Pull now").click());
	await settle();
	const applyBody = wire(globalThis.__hubPreviewTest.records.at(-1));
	assert.deepEqual(Object.keys(applyBody).sort(), [
		"kind",
		"local_id",
		"prefer",
		"request_id",
	]);
	assert.equal(applyBody.kind, "agent");
	assert.equal(applyBody.local_id, LOCAL_ID);
	assert.equal(applyBody.prefer, "remote");
	for (const absent of [
		"link_id",
		"direction",
		"preview_receipt",
		"confirm_apply",
	])
		assert.equal(absent in applyBody, false, `${absent} is never sent`);
});

test("an unknown baseline opens the dialog, the acknowledgement re-previews, and Pull sends it", async () => {
	await mount();
	globalThis.__hubPreviewTest.answer = (request) => {
		if (!isDryRun(request)) {
			return answerOf([report({ outcome: "merged", applied: true })]);
		}
		return answerOf([
			request.acknowledgeUnknownBaseline === true
				? report({})
				: UNKNOWN_BASELINE,
		]);
	};
	await mountPanel(app.HubLinkGroup, {
		link: unknownLink,
		displayName: "Coder",
		itemsById: true,
	});

	await actAsync(() => button("Preview incoming changes").click());
	await settle();

	assert.ok(document.querySelector('[data-dialog="open"]'), "the dialog opens");
	/* Core's message names a CLI flag; the window shows the control instead. */
	assert.doesNotMatch(document.body.textContent, /--accept-unknown-baseline/);
	assert.match(
		document.body.textContent,
		/No baseline was recorded for this copy/,
	);
	const checkbox = document.querySelector('input[type="checkbox"]');
	assert.ok(checkbox, "the acknowledgement is reachable");
	assert.ok(button("Pull now").disabled);

	await actAsync(() => {
		checkbox.click();
	});
	await settle();
	const repreview = wire(globalThis.__hubPreviewTest.records.at(-1));
	assert.equal(repreview.dry_run, true);
	assert.equal(repreview.acknowledge_unknown_baseline, true);
	assert.equal(button("Pull now").disabled, false);

	await actAsync(() => button("Pull now").click());
	await settle();
	const applyBody = wire(globalThis.__hubPreviewTest.records.at(-1));
	assert.equal(applyBody.acknowledge_unknown_baseline, true);
	assert.equal(applyBody.dry_run, undefined);
});

test("an unavailable row is stated as a failure with a keyed reason, not as nothing to pull", async () => {
	await mount();
	globalThis.__hubPreviewTest.answer = () => answerOf([UNAVAILABLE]);
	await mountPanel(app.HubLinkGroup, {
		link,
		displayName: "Coder",
		itemsById: true,
	});

	await actAsync(() => button("Preview incoming changes").click());
	await settle();

	assert.equal(document.querySelector('[data-dialog="open"]'), null);
	const text = document.body.textContent;
	assert.match(text, /The preview could not finish \(unavailable\)/);
	assert.match(text, /Something else went wrong\./);
	/* QA round 3, Q9: the raw message is developer detail (endpoint URL and
	 * response body on a hub outage) and never reaches the panel. */
	assert.doesNotMatch(text, /the hub no longer lists this item/);
	assert.doesNotMatch(text, /http:\/\//);
	assert.doesNotMatch(text, /Response Body/);
});

test("an ambiguous display name refuses a direct sidebar write on an older core", async () => {
	await mount();
	globalThis.__hubPreviewTest.answer = () => answerOf([report({})]);
	await mountPanel(app.HubLinkSidebarMark, {
		link,
		displayName: "Coder",
		itemsById: false,
		nameAmbiguous: true,
		staged: false,
		onDetail: () => {},
	});

	const mark = () =>
		[...document.querySelectorAll("button")].find((node) =>
			/Preview incoming|Pull|Retry|Apply|Update/.test(
				node.getAttribute("aria-label") ?? "",
			),
		) ?? document.querySelector("[data-hub-mark]");
	const pressed = mark();
	assert.ok(pressed, "the mark renders");
	await actAsync(() => pressed.click());
	await settle();
	assert.equal(
		globalThis.__hubPreviewTest.records.length,
		0,
		"no write left for an address that would hit two rows",
	);
	assert.match(document.body.textContent, /Another item has the same name/);
});

test("an unambiguous name still writes directly (the guard is narrow)", async () => {
	await mount();
	globalThis.__hubPreviewTest.answer = () => answerOf([report({})]);
	await mountPanel(app.HubLinkSidebarMark, {
		link,
		/* `itemName` is the wire address on a core without `hub_items_by_id`, so an
		 * "unambiguous name" case must supply one - without it the guard fails
		 * closed by design (the mark would otherwise address by link id). */
		itemName: "coder",
		displayName: "Coder",
		itemsById: false,
		nameAmbiguous: false,
		staged: false,
		onDetail: () => {},
	});
	const writable = [...document.querySelectorAll("button")].find(
		(node) =>
			node.getAttribute("data-hub-mark") !== null &&
			node.getAttribute("data-hub-mark") !== "busy",
	);
	await actAsync(() => writable.click());
	await settle();
	assert.equal(
		globalThis.__hubPreviewTest.records.length,
		1,
		"an unambiguous name still writes directly",
	);
});

test("an unacknowledged unknown baseline never shows core's CLI sentence (Q7 T1)", async () => {
	await mount();
	/* Core's inverse case: unknown baseline, NO conflict, answered as
	 * `merge-refused` — the class-based swap missed exactly this. */
	globalThis.__hubPreviewTest.answer = () =>
		answerOf([
			report({
				outcome: "needs-review",
				error_class: "merge-refused",
				message:
					"the baseline is unknown (no record). Re-run with --accept-unknown-baseline to merge anyway",
			}),
		]);
	await mountPanel(app.HubLinkGroup, {
		link: unknownLink,
		displayName: "Coder",
		itemsById: true,
	});
	await actAsync(() => button("Preview incoming changes").click());
	await settle();
	const text = document.body.textContent;
	assert.match(text, /No baseline was recorded for this copy/);
	assert.doesNotMatch(text, /--accept-unknown-baseline/);
});

test("after the acknowledgement a real conflict keeps core's message (Q7 T5)", async () => {
	await mount();
	globalThis.__hubPreviewTest.answer = (request) => {
		if (!isDryRun(request)) return answerOf([report({ outcome: "merged" })]);
		/* Core keeps `model-unavailable` even for a conflict once the tick is on. */
		return answerOf([
			request.acknowledgeUnknownBaseline === true
				? report({
						outcome: "needs-review",
						error_class: "model-unavailable",
						message: "the hub and your copy both changed the same text",
					})
				: UNKNOWN_BASELINE,
		]);
	};
	await mountPanel(app.HubLinkGroup, {
		link: unknownLink,
		displayName: "Coder",
		itemsById: true,
	});
	await actAsync(() => button("Preview incoming changes").click());
	await settle();
	await actAsync(() =>
		document.querySelector('input[type="checkbox"]').click(),
	);
	await settle();
	const text = document.body.textContent;
	assert.match(text, /the hub and your copy both changed the same text/);
	/* The checkbox is ticked, so the sentence telling the reader to tick it
	 * would be false. */
	assert.doesNotMatch(text, /Tick the acknowledgement/);
	assert.ok(button("Pull now").disabled, "a conflict still blocks Pull");
});

test("a preview refused by HTTP clears the previous inline result (Q8)", async () => {
	await mount();
	let call = 0;
	globalThis.__hubPreviewTest.answer = () => {
		call += 1;
		if (call === 1) return answerOf([UNAVAILABLE]);
		throw new Error("backend refused the preview");
	};
	await mountPanel(app.HubLinkGroup, {
		link,
		displayName: "Coder",
		itemsById: true,
	});
	await actAsync(() => button("Preview incoming changes").click());
	await settle();
	assert.match(document.body.textContent, /The preview could not finish/);

	await actAsync(() => button("Preview incoming changes").click());
	await settle();
	const text = document.body.textContent;
	assert.doesNotMatch(text, /The preview could not finish/);
	assert.ok(
		document.querySelector('[role="alert"]'),
		"only the new alert states the refusal",
	);
});
