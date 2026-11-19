/**
 * THE APPLICATION MENU SPEAKS THE APP'S LANGUAGE, and it does so from the
 * catalogue rather than from thirteen literals.
 *
 * WHY THIS FILE EXISTS (i18n wave C1). The menu is built in the main process,
 * outside any window: a label there is the one piece of product copy a renderer
 * reload cannot fix, and before this change the menu was English in every
 * locale while the window beside it was not. Keying it is only half of the
 * promise, so both halves are pinned:
 *
 *   1. `applicationMenuLabels()` resolves every label through `t()` — proven by
 *      registering a marker locale (`XX <key>`, a shape no English sentence has)
 *      and watching all thirteen change, rather than by reading the source and
 *      believing it;
 *   2. `index.ts` builds its template FROM those labels (`label: labels.view`)
 *      and rebuilds the menu when the locale store moves — read as source pins,
 *      because that module has top-level Electron side effects and cannot be
 *      imported under `node --test`.
 *
 * The English assertions are exact sentences, so an accidental edit to the
 * catalogue fails here rather than shipping: the keying was meant to be
 * byte-identical to the labels it replaced.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export { applicationMenuLabels } from "./src/main/application-menu-labels";
			export { clearRegisteredCatalogues, registerCatalogue } from "./src/i18n/messages";
			export { setLocale } from "./src/i18n/locale";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	applicationMenuLabels,
	clearRegisteredCatalogues,
	registerCatalogue,
	setLocale,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const ENGLISH = {
	file: "File",
	edit: "Edit",
	view: "View",
	window: "Window",
	newBrowserTab: "New Browser Tab",
	reload: "Reload",
	forceReload: "Force Reload",
	actualSize: "Actual Size",
	zoomIn: "Zoom In",
	zoomOut: "Zoom Out",
	closeTabOrWindow: "Close Tab or Window",
	learnMore: "Learn More",
};

/** Marker values: deliberately not translations, so a missed key is visible. */
function markerCatalogue() {
	return Object.fromEntries(
		[
			"file",
			"edit",
			"view",
			"window",
			"new_browser_tab",
			"reload",
			"force_reload",
			"actual_size",
			"zoom_in",
			"zoom_out",
			"close_tab_or_window",
			"learn_more",
			"about",
		].map((name) => [
			`ui.shell.menubar.${name}`,
			name === "about" ? "XX about {name}" : `XX ${name}`,
		]),
	);
}

test("every menu label is its catalogue sentence, not a copy of it", () => {
	clearRegisteredCatalogues();
	setLocale("en");
	const labels = applicationMenuLabels();
	for (const [field, sentence] of Object.entries(ENGLISH)) {
		assert.equal(labels[field], sentence, `${field} left the catalogue`);
	}
});

test("the whole menu follows a language change", () => {
	clearRegisteredCatalogues();
	registerCatalogue("xx", markerCatalogue());
	setLocale("xx");
	const labels = applicationMenuLabels();
	for (const field of Object.keys(ENGLISH)) {
		assert.match(
			labels[field],
			/^XX /,
			`${field} did not render from the active locale`,
		);
	}
});

test("About keeps the product name verbatim, and only the word around it moves", () => {
	clearRegisteredCatalogues();
	setLocale("en");
	assert.equal(
		applicationMenuLabels().about("Local Operator"),
		"About Local Operator",
	);

	registerCatalogue("xx", markerCatalogue());
	setLocale("xx");
	// The name is `app.name`, never a translated token: a locale that renamed the
	// product would be naming something else.
	const named = applicationMenuLabels().about("Local Operator");
	assert.equal(named, "XX about Local Operator");
	assert.match(named, /Local Operator$/);
	clearRegisteredCatalogues();
	setLocale("en");
});

test("the template is built from the labels, and rebuilt when the locale moves", async () => {
	const source = await readFile("src/main/index.ts", "utf8");
	assert.match(
		source,
		/import \{ applicationMenuLabels \} from "\.\/application-menu-labels";/,
	);
	assert.match(source, /const labels = applicationMenuLabels\(\);/);
	// Every keyed label reaches the template through the resolver.
	for (const field of Object.keys(ENGLISH)) {
		assert.match(
			source,
			new RegExp(`label: labels\\.${field},`),
			`the template does not read labels.${field}`,
		);
	}
	// The dev-mode lookup compares against the RESOLVED label: a literal there
	// would stop matching as soon as the locale changed and silently drop the
	// DevTools item.
	assert.match(source, /menu\.label === labels\.view/);
	assert.doesNotMatch(source, /menu\.label === "View"/);
	// The rebuild path, which is the only thing that can move an installed menu.
	// The callback IS the builder: `subscribeLocale(createApplicationMenu)` keeps
	// one install call site (`about-panel.test.mjs` pins that count), and it
	// carries the same guarantee — a locale change rebuilds the template.
	assert.match(source, /subscribeLocale\(createApplicationMenu\);/);
});

test("no menu label survives as a literal in the template", async () => {
	const source = await readFile("src/main/index.ts", "utf8");
	// The menu's own copy. `app.name` and Electron's role labels are excluded by
	// design (see application-menu-labels.ts): they are not this catalogue's.
	for (const literal of [
		'label: "File"',
		'label: "Edit"',
		'label: "View"',
		'label: "Window"',
		'label: "New Browser Tab"',
		'label: "Reload"',
		'label: "Force Reload"',
		'label: "Actual Size"',
		'label: "Zoom In"',
		'label: "Zoom Out"',
		'label: "Close Tab or Window"',
		'label: "Learn More"',
	]) {
		assert.ok(!source.includes(literal), `${literal} is still a literal`);
	}
	assert.ok(
		!source.includes("label: `About ${app.name}`"),
		"the About label is still composed in the template",
	);
});
