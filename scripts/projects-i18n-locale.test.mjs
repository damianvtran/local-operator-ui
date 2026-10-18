import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * R1-1: mount the production components, not a probe that copies their pattern.
 * Equal project rows must not keep a facet model's old-language labels cached,
 * and the view switcher must repaint from its own subscription without a parent
 * render. The UI primitives alone are inert DOM adapters: neither subscribe to
 * locale nor schedule a parent repaint, which would hide a missing subscription.
 * The real t/store/hook/model are shared in each bundle. Using the core i18n
 * entry avoids importing unrelated renderer transport polling into this test.
 *
 * Native negative runs use PROJECTS_I18N_CONTROL=no-subscription or facet-memo.
 * They sabotage only the named production seam and run the SAME positive
 * assertions, exiting nonzero. Default CI also checks those controls explicitly.
 */
const I18N_ENTRY = /^@shared\/i18n$/;
const UI_ENTRY = /^@shared\/components\/ui$/;
const VIRTUAL_FILE = /.*/;
const VIEW_SOURCE = /projects-view-switcher\.tsx$/;
const SUBSCRIPTION_CALL = /\buseI18nLocale\(\);/g;
const FACET_SOURCE = /project-filters-panel\.tsx$/;
const FACET_DERIVATION =
	/const sections =\s*([\s\S]*?);\n\tconst anythingActive/;
const EN_VIEW = /ListBoardTimeline/;
const EN_FACET = /No owner/;
const FR_VIEW = /ListeTableauChronologie/;
const FR_FACET = /Sans propriétaire/;

const control = process.env.PROJECTS_I18N_CONTROL;
assert.ok(
	control === undefined || ["no-subscription", "facet-memo"].includes(control),
	"unknown PROJECTS_I18N_CONTROL",
);
const beforeHandles = new Set(process._getActiveHandles?.() ?? []);
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const originalGlobals = new Map();
for (const name of [
	"window",
	"document",
	"navigator",
	"HTMLElement",
	"Element",
	"Node",
	"MutationObserver",
	"Event",
	"CustomEvent",
	"getComputedStyle",
]) {
	originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	Object.defineProperty(globalThis, name, {
		value:
			name === "getComputedStyle"
				? dom.window.getComputedStyle.bind(dom.window)
				: dom.window[name],
		configurable: true,
		writable: true,
	});
}
originalGlobals.set(
	"IS_REACT_ACT_ENVIRONMENT",
	Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.Element.prototype.scrollIntoView = () => {};

const ui = `
import * as React from "react";
export const Tabs = ({ children }) => React.createElement("div", null, children);
export const TabsList = ({ children, ...props }) => React.createElement("div", props, children);
export const TabsTrigger = ({ children, value }) => React.createElement("button", { type: "button", "data-value": value }, children);
export const Button = ({ children, variant, size, ...props }) => React.createElement("button", props, children);
export const Label = ({ children, ...props }) => React.createElement("label", props, children);
export const Checkbox = React.forwardRef(({ checked, onCheckedChange, ...props }, ref) => React.createElement("button", { ...props, ref, type: "button", role: "checkbox", "aria-checked": checked }));
`;
const modules = new Map();
async function load(mutation) {
	if (modules.has(mutation)) return modules.get(mutation);
	const result = await build({
		stdin: {
			contents: [
				'export * as React from "react";',
				'export { createRoot } from "react-dom/client";',
				'export { ProjectsViewSwitcher } from "./src/renderer/src/features/projects/components/projects-view-switcher";',
				'export { ProjectFiltersPanel } from "./src/renderer/src/features/projects/components/project-filters-panel";',
				'export * as i18n from "./src/i18n";',
			].join("\n"),
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "browser",
		jsx: "automatic",
		write: false,
		alias: { "@shared": resolve("src/renderer/src/shared") },
		plugins: [
			{
				name: "projects-locale-seams",
				setup(builder) {
					builder.onResolve({ filter: I18N_ENTRY }, () => ({
						path: resolve("src/i18n/index.ts"),
					}));
					builder.onResolve({ filter: UI_ENTRY }, () => ({
						path: "primitives",
						namespace: "projects-locale-ui",
					}));
					builder.onLoad(
						{ filter: VIRTUAL_FILE, namespace: "projects-locale-ui" },
						() => ({ contents: ui, loader: "js", resolveDir: process.cwd() }),
					);
					if (mutation === "no-subscription") {
						builder.onLoad({ filter: VIEW_SOURCE }, (args) => {
							const source = readFileSync(args.path, "utf8");
							assert.equal((source.match(SUBSCRIPTION_CALL) ?? []).length, 1);
							return {
								contents: source.replace("useI18nLocale();", ""),
								loader: "tsx",
							};
						});
					}
					if (mutation === "facet-memo") {
						builder.onLoad({ filter: FACET_SOURCE }, (args) => {
							let source = readFileSync(args.path, "utf8");
							const section = FACET_DERIVATION;
							assert.match(
								source,
								section,
								"the mutation must target the actual facet derivation",
							);
							source = source.replace(
								section,
								"const sections = useMemo(() => ($1), [scope, projects, state, todayMs]);\n\tconst anythingActive",
							);
							return {
								contents: `import { useMemo } from "react";\n${source}`,
								loader: "tsx",
							};
						});
					}
				},
			},
		],
	});
	const module = await import(
		`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
	);
	modules.set(mutation, module);
	return module;
}

async function probe(mutation, surface) {
	const { React, createRoot, i18n, ...components } = await load(mutation);
	i18n.clearRegisteredCatalogues();
	i18n.setLocale("en");
	i18n.registerCatalogue("fr", {
		"ui.projects.projects_view_switcher.list": "Liste",
		"ui.projects.projects_view_switcher.board": "Tableau",
		"ui.projects.projects_view_switcher.timeline": "Chronologie",
		"ui.projects.project_filters.owner": "Propriétaire",
		"ui.projects.project_filters.no_owner": "Sans propriétaire",
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const props =
		surface === "view"
			? { value: "list", onChange() {} }
			: {
					projects: [
						{ id: "synthetic-project", name: "synthetic", owner: null },
					],
					state: Object.fromEntries(
						[
							"status",
							"team",
							"owner",
							"tags",
							"progress",
							"target",
							"estimate",
							"milestones",
							"live",
						].map((key) => [key, []]),
					),
					query: "",
					todayMs: Date.UTC(2026, 9, 14),
					scope: "owner",
					onToggle() {},
					onClearAll() {},
				};
	try {
		await React.act(async () =>
			root.render(
				React.createElement(
					surface === "view"
						? components.ProjectsViewSwitcher
						: components.ProjectFiltersPanel,
					props,
				),
			),
		);
		const english = container.textContent;
		assert.match(english, surface === "view" ? EN_VIEW : EN_FACET);
		// No root.render, prop replacement or unrelated state update after this.
		await React.act(async () => i18n.setLocale("fr"));
		const french = container.textContent;
		await React.act(async () => i18n.setLocale("en"));
		assert.equal(
			container.textContent,
			english,
			"the same mounted tree returns to English",
		);
		return { english, french };
	} finally {
		await React.act(async () => root.unmount());
		container.remove();
		i18n.clearRegisteredCatalogues();
	}
}
function assertRepaint(surface, text) {
	assert.match(text, surface === "view" ? FR_VIEW : FR_FACET);
	assert.doesNotMatch(text, surface === "view" ? EN_VIEW : EN_FACET);
}
test("mounted ProjectsViewSwitcher repaints from the locale store without remount", async () => {
	const { french } = await probe(control, "view");
	assertRepaint("view", french);
	console.log(`mounted view: ${french}`);
});
test("mounted facet options repaint with identical rows and props (no locale-blind memo)", async () => {
	const { french } = await probe(control, "facet");
	assertRepaint("facet", french);
	console.log(`mounted facet: ${french}`);
});
if (!control) {
	test("negative control: removing only the view subscription defeats the repaint assertion", async () => {
		const { french } = await probe("no-subscription", "view");
		assert.match(french, EN_VIEW);
		assert.throws(() => assertRepaint("view", french), assert.AssertionError);
	});
	test("negative control: a rows-only facet memo defeats the repaint assertion", async () => {
		const { french } = await probe("facet-memo", "facet");
		assert.match(french, EN_FACET);
		assert.throws(() => assertRepaint("facet", french), assert.AssertionError);
	});
}
after(() => {
	dom.window.close();
	// Follow locale-reactivity.test.mjs: browser React's scheduler leaves ref'd
	// ports in Node. Close only ports created by our bundles, after all roots
	// unmounted and all assertions completed; never force-exit or close the
	// runner's pre-existing transport handles to manufacture a green result.
	for (const handle of process._getActiveHandles?.() ?? []) {
		if (
			!beforeHandles.has(handle) &&
			handle?.constructor?.name === "MessagePort"
		)
			handle.close();
	}
	for (const [name, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else delete globalThis[name];
	}
});
