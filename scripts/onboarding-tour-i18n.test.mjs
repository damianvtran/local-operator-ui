/**
 * The onboarding walkthrough's copy contract, with the features that
 * screenshots could not carry.
 *
 * WHY THIS SUITE EXISTS. The first keying round moved the tour's copy into the
 * catalogue but left two defects a translator would hit and a user could see:
 * step titles and footer buttons were interpolated into Shepherd's `innerHTML`
 * unescaped (bodies were escaped), and an open tour never followed a locale
 * change because `createTourSteps()` is only called when the tour starts. It
 * also left eight stale English screenshots in the body; the two that survive
 * as structural figures must stay wordless so there is nothing to translate or
 * go out of date.
 *
 * WHAT IT PROVES, LAYER BY LAYER:
 *  1. source shape - no raster import, image block or `<img>`, and the context
 *     corrections the translation rounds rely on (script-aware separators,
 *     prose rather than control-label quotes, two cleaned English values);
 *  2. rendered figure shape - each figure has exactly one `role="img"`, its
 *     localized label, and no text nodes or image elements;
 *  3. HTML sinks - a planted `<`, `>`, `&`, quotes and apostrophes render as
 *     text, never as an element, while the close label stays raw for
 *     `setAttribute`;
 *  4. live tour - the REAL Shepherd instance follows a negotiated locale with
 *     fixtures for French, a pseudo-locale and Urdu, keeping the current step,
 *     the step list and keyboard focus;
 *  5. skin rules - the declarations whose absence is silent in every other
 *     check (RTL panel anchoring, inline `<code>` direction, the close
 *     control's target-size floor, the vendor out-specifying colour, the
 *     horizontal-overflow clip, the step-7 width cap) are still on the rule
 *     that must carry them;
 *  6. step 7's shape - the tour keeps the panel and the palette in step, and
 *     re-decides the shape for the window the step is shown in;
 *  7. the hop state machine - a tour cancelled during a hop's 500 ms wait stays
 *     closed, ending a tour releases only the palette it opened, and a window
 *     resized across the breakpoint mid-tour is honoured at show time (review
 *     round 3, R3-1 to R3-3);
 *  8. palette ownership when the user moves the palette - a palette the user
 *     closed and replaced, or already had open before the hop, is neither
 *     claimed nor closed, and the close-side hop keeps its cancel guard (review
 *     round 4, R4-1 and R4-2).
 *
 * WHAT IT CANNOT PROVE: the rendered pixels (the design round and QA own those),
 * a real browser's layout under RTL, or production translations. The non-English
 * catalogues here are TEST DATA, not shipped copy.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const repo = process.cwd();

/*
 * Fixed assertions, hoisted: Biome's `useTopLevelRegex` applies to every regex
 * literal it can see, and these run once per test rather than in a render loop.
 */
const RE = {
	tourAssetImport: /@assets\/images\/tour/,
	imageKind: /kind: "image"/,
	imageTag: /<img\b/,
	rasterRef: /<img\b|@assets\/images/,
	physicalSide: /\b(?:left|right)\s*:/,
	physicalMargin: /margin-(?:left|right)/,
	motion: /box-shadow|animation|transition/,
	inlineMargin: /margin-inline/,
	inlineBorder: /border-inline/,
	screenReader: /screen reader/i,
	cancelsOrCloses: /cancels|closes|exits/i,
	cjkOmit: /CJK may omit/,
	hindiUrdu: /Hindi and Urdu/,
	exactSpaces: /exactly as written/,
	latin: /Latin/,
	controlLabel: /must match the control label/,
	notUiLabel: /not (?:a )?UI control label/,
	newline: /\n/,
	trailingWhitespace: /\s$/,
	rightAuto: /^[ \t]*right:[ \t]*auto;/m,
	codeDirectionLtr: /^[ \t]*direction:[ \t]*ltr;/m,
	codeBidiIsolate: /^[ \t]*unicode-bidi:[ \t]*isolate;/m,
	minWidth24: /^[ \t]*min-width:[ \t]*24px;/m,
	pointerEventsAuto: /^[ \t]*pointer-events:[ \t]*auto;/m,
	overflowXClip: /^[ \t]*overflow-x:[ \t]*clip;/m,
	panelMaxWidth340: /^[ \t]*max-width:[ \t]*340px;/m,
	inkMuted: /^[ \t]*color:[ \t]*var\(--color-ink-muted\);/m,
	ink: /^[ \t]*color:[ \t]*var\(--color-ink\);/m,
	accentWash: /^[ \t]*background-color:[ \t]*var\(--color-accent-wash\);/m,
	cancelHoverRule:
		/\.shepherd-element\.shepherd-has-title[\s\S]{0,160}?\.shepherd-cancel-icon:is\(:hover, :focus-visible\)\s*\{/,
};

/* ---------------------------------------------------------------------------
 * 1. A DOM before the bundle loads.
 *
 * Shepherd's `isServerSide` is decided at module load, so the globals have to
 * exist before the dynamic import. This copy is the locale-reactivity suite's:
 * jsdom's element constructors and events land on the global, Node's own
 * read-only `navigator` is left alone, and a map-backed `localStorage` keeps
 * the preferences store's persist middleware from touching a real profile.
 * ------------------------------------------------------------------------- */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
	"MutationObserver",
	"ResizeObserver",
];
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors that refuse to leave their context; the tour needs none.
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CSS = { escape: (value) => String(value) };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.Element.prototype.scrollIntoView = () => {};
const storage = new Map();
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: (key) => storage.delete(key),
	},
});

/* ---------------------------------------------------------------------------
 * 2. Bundle the shipped tour modules and the real Shepherd.
 * ------------------------------------------------------------------------- */

const built = await build({
	stdin: {
		contents: [
			'export { createTourSteps, applyTourLocale, tourCancelIcon, STEP_BESIDE_PALETTE_CLASS, STEP_BESIDE_PALETTE_MIN_WIDTH } from "./src/renderer/src/features/onboarding/tour/tour-steps";',
			'export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { renderTourBody, TOUR_BODIES, tourLabel } from "./src/renderer/src/features/onboarding/tour/tour-copy";',
			'export { applyCapabilities, clearRegisteredCatalogues, registerCatalogue, setLocale, t } from "./src/i18n";',
			'export { textDirectionFor } from "./src/i18n/direction";',
			'export { default as Shepherd } from "shepherd.js";',
			'export * as React from "react";',
			'export { act } from "react";',
			'export { createRoot } from "react-dom/client";',
			'export { MemoryRouter } from "react-router-dom";',
			'export { ShepherdJourneyContext } from "react-shepherd";',
			'export { useOnboardingTour } from "./src/renderer/src/features/onboarding/hooks/use-onboarding-tour";',
		].join("\n"),
		resolveDir: repo,
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
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
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

const CATALOGUE = JSON.parse(
	readFileSync(
		join(repo, "src/i18n/catalogues/en/ui.onboarding.tour.json"),
		"utf8",
	),
);
const CONTEXT = JSON.parse(
	readFileSync(
		join(repo, "src/i18n/catalogues/en/ui.onboarding.tour.context.json"),
		"utf8",
	),
);
const COPY_SOURCE = readFileSync(
	join(repo, "src/renderer/src/features/onboarding/tour/tour-copy.ts"),
	"utf8",
);
const TOUR_CSS = readFileSync(
	join(repo, "src/renderer/src/features/onboarding/onboarding-tour.css"),
	"utf8",
);

const WELCOME_ALT = "ui.onboarding.tour.welcome.image.1.alt";
const CAPABILITIES_ALT = "ui.onboarding.tour.agent_capabilities.image.1.alt";
const REMOVED_ALTS = [
	"ui.onboarding.tour.chat_input.image.1.alt",
	"ui.onboarding.tour.attachments.image.1.alt",
	"ui.onboarding.tour.canvas_feature.image.1.alt",
	"ui.onboarding.tour.canvas_documents_view.image.1.alt",
	"ui.onboarding.tour.canvas_documents_view.image.2.alt",
	"ui.onboarding.tour.canvas_variables_view.image.1.alt",
];
const SPLIT_KEYS = [
	"ui.onboarding.tour.pre_command_palette_open_canvas.body.1.1",
	"ui.onboarding.tour.pre_command_palette_open_canvas.body.1.3",
	"ui.onboarding.tour.pre_command_palette_open_canvas.body.1.4",
	"ui.onboarding.tour.pre_command_palette_open_canvas.body.1.5",
	"ui.onboarding.tour.pre_command_palette_open_canvas.body.1.6",
	"ui.onboarding.tour.pre_command_palette_open_canvas.body.1.7",
	"ui.onboarding.tour.pre_command_palette_open_canvas.body.2.1",
	"ui.onboarding.tour.pre_command_palette_open_canvas.body.2.3",
	"ui.onboarding.tour.pre_command_palette_open_canvas.body.2.5",
	"ui.onboarding.tour.pre_command_palette_open_canvas.connector.on_mac_and",
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/*
 * RELEASE THE SCHEDULER'S MESSAGE PORTS. React's scheduler keeps its
 * MessagePort handles ref'd, so the runner would print a passing summary and
 * then hold the process open forever. This is teardown, not a forced green:
 * every assertion has already run; it closes only MessagePorts and the jsdom
 * window.
 */
after(() => {
	for (const handle of process._getActiveHandles?.() ?? []) {
		try {
			if (handle?.constructor?.name === "MessagePort") handle.close();
		} catch {
			// A handle that refuses to close is not this suite's to force.
		}
	}
	dom.window.close();
});

/*
 * THE SELECTOR ENGINE MUST ANSWER SHEPHERD'S TOP-LAYER PROBE IN ONE CALL.
 *
 * Every time the live-tour tests below position a step, Shepherd's bundled
 * Floating UI asks `element.matches(":popover-open")` and `":modal"` of each
 * ancestor (`isTopLayer`). jsdom answers through nwsapi, and nwsapi 2.2.27
 * resolves `:modal` by calling the NATIVE `matches` it captured - which in jsdom
 * is jsdom's own wrapper around nwsapi - so each probe re-enters itself until
 * the stack overflows (measured: ~1.49 million nested calls, depth ~3,450, a
 * swallowed RangeError, 1-6 s of synchronous CPU per probe in one local sample).
 * Local runs took 10-100x their sleep budgets and could hit a 240s bound with
 * "Promise resolution is still pending"; the pass/cancelled counts vary with
 * host load. This explains the measured local slowdown, not every CI timeout:
 * a pinned CI shard still cancelled, and ordered TAP alone cannot identify the
 * remaining worker or a descendant holding its output pipe. nwsapi 2.2.28 no
 * longer falls back to `node.matches` (the decisive change under jsdom, where
 * NATIVE_MATCHES is null), and also adds a `matchingNative` re-entry guard.
 * The lockfile pins that version.
 *
 * This counts calls rather than timing them, so it is deterministic on a loaded
 * host, and it runs first: a regressed engine fails here in milliseconds and
 * names the cause instead of hanging the shard.
 */
test("jsdom answers Shepherd's top-layer selectors without re-entering itself", () => {
	const probe = document.createElement("div");
	document.body.appendChild(probe);
	const native = window.Element.prototype.matches;
	let calls = 0;
	window.Element.prototype.matches = function countedMatches(selector) {
		calls += 1;
		// Past this the engine is recursing; stop it instead of burning seconds.
		if (calls > 50) throw new RangeError("matches re-entered itself");
		return native.call(this, selector);
	};
	try {
		for (const selector of [":popover-open", ":modal"]) {
			calls = 0;
			let answer;
			try {
				answer = probe.matches(selector);
			} catch {
				// Floating UI swallows this too; the call count is the verdict.
			}
			assert.ok(
				calls <= 2,
				`${selector} took ${calls} nested matches() calls - the selector engine is re-entering itself`,
			);
			assert.equal(answer, false, `${selector} must be false for a plain div`);
		}
	} finally {
		window.Element.prototype.matches = native;
		probe.remove();
	}
});

/* ---------------------------------------------------------------------------
 * 3. Source and catalogue shape.
 * ------------------------------------------------------------------------- */

test("the tour carries no raster screenshot references", () => {
	assert.doesNotMatch(COPY_SOURCE, RE.tourAssetImport);
	assert.ok(!COPY_SOURCE.includes("<img"));
	assert.doesNotMatch(COPY_SOURCE, RE.imageKind);
	for (const key of REMOVED_ALTS) {
		assert.ok(!(key in CATALOGUE), `${key} must be removed`);
		assert.ok(!(key in CONTEXT), `${key} context must be removed`);
	}
	assert.ok(WELCOME_ALT in CATALOGUE);
	assert.ok(CAPABILITIES_ALT in CATALOGUE);
	assert.ok(WELCOME_ALT in CONTEXT);
	assert.ok(CAPABILITIES_ALT in CONTEXT);
});

test("the two structural figures are wordless and carry localized labels", () => {
	for (const [name, altKey] of [
		["welcome", WELCOME_ALT],
		["agent_capabilities", CAPABILITIES_ALT],
	]) {
		const html = mod.renderTourBody(mod.TOUR_BODIES[name]);
		assert.doesNotMatch(html, RE.imageTag, `${name} must not render an image`);
		const container = document.createElement("div");
		container.innerHTML = html;
		const figures = container.querySelectorAll('[role="img"]');
		assert.equal(figures.length, 1, `${name} must have one figure`);
		const figure = figures[0];
		assert.equal(figure.getAttribute("aria-label"), CATALOGUE[altKey]);
		assert.equal(figure.textContent, "", `${name} figure must have no text`);
		assert.equal(
			figure.querySelectorAll("img, svg, text, foreignObject").length,
			0,
			`${name} figure must be shapes only`,
		);
	}
	for (const [name, body] of Object.entries(mod.TOUR_BODIES)) {
		assert.doesNotMatch(
			mod.renderTourBody(body),
			RE.rasterRef,
			`${name} still references a raster`,
		);
	}
});

test("figure layout uses logical properties so RTL mirrors it", () => {
	const start = TOUR_CSS.indexOf("Tour figures: two wordless");
	assert.ok(start !== -1, "figure CSS section is missing");
	const section = TOUR_CSS.slice(start);
	assert.match(section, RE.inlineMargin);
	assert.match(section, RE.inlineBorder);
	assert.doesNotMatch(section, RE.physicalSide);
	assert.doesNotMatch(section, RE.physicalMargin);
	assert.doesNotMatch(section, RE.motion);
});

/**
 * One rule's declaration block, by exact selector.
 *
 * WHY THE BLOCK AND NOT THE FILE. Each declaration pinned below is invisible
 * when missing - a lost `right: auto` only shows up as an off-centre panel in
 * one script - so the assertion has to name the rule that must carry it. A
 * whole-file regex would let the same declaration in an unrelated rule keep the
 * test green while the tour regressed, which is the exact failure this guards.
 */
const ruleBlock = (selector) => {
	const at = TOUR_CSS.indexOf(`${selector} {`);
	assert.ok(at !== -1, `${selector} rule is missing`);
	const open = TOUR_CSS.indexOf("{", at);
	const close = TOUR_CSS.indexOf("}", open);
	assert.ok(close !== -1, `${selector} rule is unterminated`);
	return TOUR_CSS.slice(open + 1, close);
};

/*
 * Three rules a later edit could drop without any visible local failure:
 *
 *  - `right: auto` on the panel. Every step is a `<dialog>`, whose UA rule
 *    parks the inline edges at 0 while Shepherd centres with a physical
 *    `left: 50%`; under `rtl` that leaves the panel flush to the viewport's
 *    right edge instead of its Popper position. Proven live in QA round 1.
 *  - `direction: ltr; unicode-bidi: isolate` on inline `<code>` under an
 *    RTL document: inherited `rtl` paints `⌘P` as `P⌘`. The `[dir="rtl"]`
 *    scope is part of the pin - unscoped, `isolate` re-wrapped a Chinese line.
 *  - the close control's 24px width floor (WCAG 2.2 2.5.8); the glyph plus
 *    padding measures 22.69px without it.
 */
test("the tour skin keeps its RTL and target-size rules", () => {
	assert.match(ruleBlock(".shepherd-element"), RE.rightAuto);
	const code = ruleBlock('[dir="rtl"] .shepherd-text code');
	assert.match(code, RE.codeDirectionLtr);
	assert.match(code, RE.codeBidiIsolate);
	assert.match(ruleBlock(".shepherd-cancel-icon"), RE.minWidth24);
});

test("the close label is keyed and described for translators", () => {
	const key = "ui.onboarding.tour.action.close";
	assert.equal(CATALOGUE[key], "Close tour");
	assert.ok(CONTEXT[key]);
	assert.match(CONTEXT[key].note, RE.screenReader);
	assert.match(CONTEXT[key].note, RE.cancelsOrCloses);
});

test("split code-span context is script-aware, not a blanket space rule", () => {
	for (const key of SPLIT_KEYS) {
		const note = CONTEXT[key]?.note ?? "";
		assert.match(note, RE.cjkOmit, key);
		assert.match(note, RE.hindiUrdu, key);
		assert.doesNotMatch(note, RE.exactSpaces, key);
		assert.match(note, RE.latin, key);
	}
});

test("prose quotations are not held to control-label wording", () => {
	for (const key of [
		"ui.onboarding.tour.agent_capabilities.body.1",
		"ui.onboarding.tour.agent_naming_guidelines.body.1",
		"ui.onboarding.tour.canvas_variables_view.body.1",
	]) {
		const note = CONTEXT[key]?.note ?? "";
		assert.doesNotMatch(note, RE.controlLabel, key);
		assert.match(note, RE.notUiLabel, key);
	}
});

test("the two cleaned English values carry no incidental whitespace", () => {
	for (const [key, expectedLength] of [
		["ui.onboarding.tour.agent_naming_guidelines.body.1", 329],
		["ui.onboarding.tour.canvas_documents_view.body.3", 128],
	]) {
		const value = CATALOGUE[key];
		assert.equal(value.length, expectedLength, key);
		assert.doesNotMatch(value, RE.newline, `${key} still has a newline`);
		assert.doesNotMatch(
			value,
			RE.trailingWhitespace,
			`${key} still ends in whitespace`,
		);
		assert.match(
			CONTEXT[key].length,
			new RegExp(`English is ${expectedLength} characters`),
			`${key} context length is stale`,
		);
	}
});

/* ---------------------------------------------------------------------------
 * 4. HTML sinks. Synthetic French here is TEST DATA, not a translation.
 * ------------------------------------------------------------------------- */

const ESCAPED_TEXT = "Tom 'n' Jerry <b> & <script> & \"q\"";
const ESCAPED_HTML = "Tom 'n' Jerry &lt;b&gt; &amp; &lt;script&gt; &amp; \"q\"";
const ESCAPED_BUTTON_TEXT = "<b> Next";
const ESCAPED_BUTTON_HTML = "&lt;b&gt; Next";

test("titles and buttons are escaped before Shepherd's innerHTML", () => {
	mod.clearRegisteredCatalogues();
	mod.registerCatalogue("fr", {
		// ICU quoting emits literal angle brackets; the point is that the sink,
		// not the catalogue, decides markup.
		"ui.onboarding.tour.welcome.title":
			"Tom ''n'' Jerry '<b>' & '<script>' & \"q\"",
		"ui.onboarding.tour.action.next": "'<b>' Next",
	});
	mod.setLocale("fr");
	assert.equal(mod.tourLabel("ui.onboarding.tour.welcome.title"), ESCAPED_HTML);
	const steps = mod.createTourSteps();
	assert.equal(steps[0].title, ESCAPED_HTML);
	assert.equal(steps[0].buttons[0].text, ESCAPED_BUTTON_HTML);

	const container = document.createElement("div");
	container.innerHTML = steps[0].title;
	assert.equal(container.querySelector("b, script"), null);
	assert.equal(container.textContent, ESCAPED_TEXT);
	container.innerHTML = steps[0].buttons[0].text;
	assert.equal(container.querySelector("b"), null);
	assert.equal(container.textContent, ESCAPED_BUTTON_TEXT);
});

test("the close label stays raw for setAttribute", () => {
	mod.clearRegisteredCatalogues();
	mod.registerCatalogue("fr", {
		"ui.onboarding.tour.action.close": "Fermer & quitter",
	});
	mod.setLocale("fr");
	assert.equal(mod.tourCancelIcon().label, "Fermer & quitter");
});

/* ---------------------------------------------------------------------------
 * 5. A negotiated locale while the tour is open. The French, pseudo and Urdu
 *    strings are TEST DATA written for this suite, not shipped translations.
 * ------------------------------------------------------------------------- */

const FIXTURES = {
	fr: {
		"ui.onboarding.tour.welcome.title": "Bienvenue",
		"ui.onboarding.tour.agent_list.title": "Vos agents",
		"ui.onboarding.tour.action.next": "Suivant",
		"ui.onboarding.tour.action.close": "Fermer la visite",
	},
	"en-XA": {
		"ui.onboarding.tour.welcome.title": "⟦Welcome⟧",
		"ui.onboarding.tour.agent_list.title": "⟦Your agents⟧",
		"ui.onboarding.tour.action.next": "⟦Next⟧",
		"ui.onboarding.tour.action.close": "⟦Close tour⟧",
	},
	ur: {
		"ui.onboarding.tour.welcome.title": "خوش آمدید",
		"ui.onboarding.tour.agent_list.title": "آپ کے ایجنٹ",
		"ui.onboarding.tour.action.next": "اگلا",
		"ui.onboarding.tour.action.close": "بند کریں",
	},
};

test("an open tour follows locale changes without restarting or losing focus", async () => {
	mod.clearRegisteredCatalogues();
	for (const [locale, messages] of Object.entries(FIXTURES)) {
		mod.registerCatalogue(locale, messages);
	}
	mod.setLocale("en");

	const enSteps = mod.createTourSteps();
	const tour = new mod.Shepherd.Tour({
		useModalOverlay: true,
		defaultStepOptions: { cancelIcon: mod.tourCancelIcon() },
	});
	tour.addStep(enSteps[0]);
	tour.addStep(enSteps[1]);
	let restarts = 0;
	const realAddSteps = tour.addSteps.bind(tour);
	const realRemoveStep = tour.removeStep.bind(tour);
	tour.addSteps = (...args) => {
		restarts += 1;
		return realAddSteps(...args);
	};
	tour.removeStep = (...args) => {
		restarts += 1;
		return realRemoveStep(...args);
	};
	tour.start();
	await tick();

	const dialog = document.querySelector(".shepherd-element");
	assert.ok(dialog, "the tour must render its dialog");
	const title = dialog.querySelector(".shepherd-title");
	const button = dialog.querySelector(".shepherd-button-primary");
	const close = dialog.querySelector(".shepherd-cancel-icon");
	assert.ok(
		title && button && close,
		"welcome step must render title, button, close",
	);
	assert.equal(title.textContent, "Welcome to Local Operator");
	button.focus();
	assert.equal(document.activeElement, button);

	const firstStep = tour.getCurrentStep();
	const stepsArray = tour.steps;
	const stepIndex = tour.steps.indexOf(firstStep);

	for (const [locale, titleText, buttonText, closeText] of [
		["fr", "Bienvenue", "Suivant", "Fermer la visite"],
		["en-XA", "⟦Welcome⟧", "⟦Next⟧", "⟦Close tour⟧"],
		["ur", "خوش آمدید", "اگلا", "بند کریں"],
	]) {
		/*
		 * The capabilities answer is the production seam: `useI18nLocaleSync`
		 * feeds every window's store from it, and the hook's `useI18nLocale`
		 * subscription is what repaints an open tour.
		 */
		mod.applyCapabilities({ features: { i18n: 1 }, language: locale });
		mod.applyTourLocale(tour, locale);
		await tick();

		assert.equal(tour.getCurrentStep(), firstStep, `${locale}: step changed`);
		assert.equal(
			tour.steps.indexOf(firstStep),
			stepIndex,
			`${locale}: progress moved`,
		);
		assert.equal(tour.steps, stepsArray, `${locale}: step list was rebuilt`);
		assert.equal(restarts, 0, `${locale}: tour restarted`);
		assert.equal(title.textContent, titleText, `${locale}: title`);
		assert.equal(button.textContent, buttonText, `${locale}: button`);
		assert.equal(
			close.getAttribute("aria-label"),
			closeText,
			`${locale}: close label`,
		);
		assert.equal(
			tour.steps[1].options.title,
			mod.t("ui.onboarding.tour.agent_list.title"),
		);
		assert.equal(
			document.activeElement,
			button,
			`${locale}: keyboard focus moved`,
		);
		assert.equal(document.querySelector(".shepherd-button-primary"), button);
	}

	assert.equal(mod.textDirectionFor("ur"), "rtl");
	tour.cancel();
});

/* ---------------------------------------------------------------------------
 * 6. The ACTUAL hook: a locale change through the capabilities seam must
 *    repaint the open tour. This is the reviewer's finding in executable form -
 *    the previous round only rebuilt steps in `startTour`, so an already-open
 *    tour stayed in the language it opened with.
 * ------------------------------------------------------------------------- */

const waitFor = async (predicate, timeoutMs = 3000) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = predicate();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return predicate();
};

test("the hook's locale subscription repaints an open tour through capabilities", async () => {
	mod.clearRegisteredCatalogues();
	mod.registerCatalogue("fr", {
		"ui.onboarding.tour.welcome.title": "Bienvenue",
		"ui.onboarding.tour.action.next": "Suivant",
		"ui.onboarding.tour.action.close": "Fermer la visite",
	});
	mod.setLocale("en");

	const tour = new mod.Shepherd.Tour({
		useModalOverlay: true,
		defaultStepOptions: { cancelIcon: mod.tourCancelIcon() },
	});
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = mod.createRoot(container);

	const Harness = () => {
		const { startTour } = mod.useOnboardingTour();
		mod.React.useEffect(() => {
			startTour({ forceModalCompleted: true });
		}, []);
		return null;
	};

	await mod.act(async () => {
		root.render(
			mod.React.createElement(
				mod.MemoryRouter,
				{ future: { v7_startTransition: true, v7_relativeSplatPath: true } },
				mod.React.createElement(
					mod.ShepherdJourneyContext.Provider,
					{ value: { tour, Shepherd: mod.Shepherd } },
					mod.React.createElement(Harness),
				),
			),
		);
	});
	const dialog = await mod.act(async () =>
		waitFor(() => document.querySelector(".shepherd-element")),
	);
	assert.ok(dialog, "the hook must start the real tour");
	const title = dialog.querySelector(".shepherd-title");
	const button = dialog.querySelector(".shepherd-button-primary");
	const close = dialog.querySelector(".shepherd-cancel-icon");
	assert.equal(title.textContent, "Welcome to Local Operator");
	button.focus();
	const step = tour.getCurrentStep();
	const stepCount = tour.steps.length;

	await mod.act(async () => {
		mod.applyCapabilities({ features: { i18n: 1 }, language: "fr" });
	});
	await mod.act(async () => {
		await waitFor(() => title.textContent === "Bienvenue");
	});

	assert.equal(title.textContent, "Bienvenue");
	assert.equal(button.textContent, "Suivant");
	assert.equal(close.getAttribute("aria-label"), "Fermer la visite");
	assert.equal(tour.getCurrentStep(), step, "current step changed");
	assert.equal(tour.steps.length, stepCount, "step list rebuilt");
	assert.equal(document.activeElement, button, "keyboard focus moved");

	await mod.act(async () => {
		root.unmount();
	});
	container.remove();
	tour.cancel();
});

/* ---------------------------------------------------------------------------
 * 7. Step 7's shape, and the palette hops that belong to it.
 *
 * WHY THIS EXISTS. Step 7 used to pin a 500 px panel beside a 640 px palette at
 * every width, which covered the focused search field the step tells the user
 * to type into (design round 1, D1). The fix is a shape decision taken when the
 * steps are built: narrow and attached above the breakpoint, centred with no
 * palette below it. The neighbouring steps open and close that palette, so the
 * assertions here run the REAL Shepherd tour at both widths and read the store
 * its buttons drive - a source pin would not catch a hop that disagrees with
 * the shape.
 * ------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const paletteOpen = () =>
	mod.useUiPreferencesStore.getState().isCommandPaletteOpen;

const stepSevenOf = (steps) =>
	steps.find((step) => step.id === "pre-command-palette-open-canvas");

/** The element Shepherd is currently showing; earlier steps stay in the DOM, hidden. */
const shownStepElement = () => {
	const elements = [...document.querySelectorAll(".shepherd-element")].filter(
		(element) =>
			!element.hidden && getComputedStyle(element).display !== "none",
	);
	return elements[elements.length - 1] ?? null;
};

/**
 * Stand in for the command palette's dialog.
 *
 * Step 7's beside shape asserts "there is a palette to sit beside": the `show`
 * listener demotes the shape when the anchor is missing, because Shepherd cannot
 * resolve an `attachTo` whose element is not in the DOM and centres the step
 * while the 340 px cap stays on it (design round 4, D9). This harness has no
 * `CommandPalette` component, so the cases that expect the beside shape provide
 * the anchor the app's own palette would, and remove it again.
 */
const paletteAnchorStub = () => {
	const stub = document.createElement("div");
	stub.setAttribute("data-tour-tag", "command-palette-dialog");
	document.body.appendChild(stub);
	return () => stub.remove();
};

const ruleBlockMatching = (pattern) => {
	const match = pattern.exec(TOUR_CSS);
	assert.ok(match, `no rule matching ${pattern}`);
	const open = TOUR_CSS.indexOf("{", match.index);
	const close = TOUR_CSS.indexOf("}", open);
	assert.ok(open !== -1 && close !== -1, `unterminated rule for ${pattern}`);
	return TOUR_CSS.slice(open + 1, close);
};

test("the tour skin pins step 7's shapes and the close control's colour", () => {
	const panel = ruleBlock(".shepherd-element");
	/*
	 * Both are invisible when missing in a jsdom run: the wheel does not turn
	 * under a Radix modal, and a lost clip only shows as a scrollbar in one
	 * script. They are pinned beside the declarations they replace.
	 */
	assert.match(panel, RE.pointerEventsAuto);
	assert.match(panel, RE.overflowXClip);
	assert.match(
		ruleBlock(".shepherd-element.tour-beside-palette"),
		RE.panelMaxWidth340,
	);
	assert.match(
		ruleBlock(
			".shepherd-element.shepherd-has-title .shepherd-content .shepherd-cancel-icon",
		),
		RE.inkMuted,
	);
	const hover = ruleBlockMatching(RE.cancelHoverRule);
	assert.match(hover, RE.accentWash);
	assert.match(hover, RE.ink);
});

test("step 7 narrows beside the palette above the breakpoint and centres below it", () => {
	const original = window.innerWidth;
	try {
		window.innerWidth = 1380;
		const wide = stepSevenOf(mod.createTourSteps());
		assert.equal(
			wide.attachTo?.element,
			'[data-tour-tag="command-palette-dialog"]',
		);
		assert.equal(wide.attachTo?.on, "right");
		assert.ok(
			wide.classes?.split(" ").includes(mod.STEP_BESIDE_PALETTE_CLASS),
			"the beside shape must carry the width-cap class",
		);

		// The threshold itself must still fit beside the palette.
		window.innerWidth = mod.STEP_BESIDE_PALETTE_MIN_WIDTH;
		assert.ok(
			stepSevenOf(mod.createTourSteps())?.attachTo,
			"the breakpoint must be the first width that fits",
		);

		window.innerWidth = mod.STEP_BESIDE_PALETTE_MIN_WIDTH - 1;
		const narrow = stepSevenOf(mod.createTourSteps());
		assert.equal(narrow.attachTo, undefined, "below the breakpoint, no anchor");
		assert.equal(narrow.classes, undefined, "and no width cap");
		// Same step, same copy, same footer: only the shape differs.
		assert.equal(narrow.title, wide.title);
		assert.equal(narrow.text, wide.text);
		assert.equal(narrow.buttons.length, wide.buttons.length);
		assert.equal(narrow.buttons[0].text, wide.buttons[0].text);
		assert.equal(narrow.buttons[1].text, wide.buttons[1].text);
	} finally {
		window.innerWidth = original;
	}
});

/** Walk step 6 -> step 7 -> back -> step 7 -> step 8 -> back, recording both axes. */
async function walkStepSeven(width) {
	window.innerWidth = width;
	mod.useUiPreferencesStore.getState().closeCommandPalette();
	const tour = new mod.Shepherd.Tour({
		useModalOverlay: true,
		defaultStepOptions: { cancelIcon: mod.tourCancelIcon() },
	});
	tour.addSteps(mod.createTourSteps());
	tour.start();
	await sleep(80);
	const press = async (variant) => {
		const element = shownStepElement()?.querySelector(
			`.shepherd-footer .shepherd-button-${variant}`,
		);
		assert.ok(
			element,
			`step ${tour.getCurrentStep()?.id} has no ${variant} button`,
		);
		element.click();
		// The actions wait 500 ms for the palette; that has to have elapsed.
		await sleep(760);
	};
	tour.show("agent-capabilities");
	await sleep(80);
	assert.equal(tour.getCurrentStep()?.id, "agent-capabilities");

	await press("primary");
	const arrived = { step: tour.getCurrentStep()?.id, palette: paletteOpen() };
	await press("secondary");
	const back = { step: tour.getCurrentStep()?.id, palette: paletteOpen() };
	await press("primary");
	const again = { step: tour.getCurrentStep()?.id, palette: paletteOpen() };
	await press("primary");
	const forward = { step: tour.getCurrentStep()?.id, palette: paletteOpen() };
	await press("secondary");
	const fromEight = { step: tour.getCurrentStep()?.id, palette: paletteOpen() };

	tour.cancel();
	await sleep(80);
	for (const element of document.querySelectorAll(".shepherd-element")) {
		element.remove();
	}
	return { arrived, back, again, forward, fromEight };
}

test("step 7 keeps the palette in step with the shape it was built in", async () => {
	const original = window.innerWidth;
	try {
		const wide = await walkStepSeven(mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40);
		assert.deepEqual(wide, {
			arrived: { step: "pre-command-palette-open-canvas", palette: true },
			back: { step: "agent-capabilities", palette: false },
			again: { step: "pre-command-palette-open-canvas", palette: true },
			forward: { step: "canvas-open-button", palette: false },
			fromEight: { step: "pre-command-palette-open-canvas", palette: true },
		});

		const narrow = await walkStepSeven(900);
		assert.deepEqual(narrow, {
			arrived: { step: "pre-command-palette-open-canvas", palette: false },
			back: { step: "agent-capabilities", palette: false },
			again: { step: "pre-command-palette-open-canvas", palette: false },
			forward: { step: "canvas-open-button", palette: false },
			fromEight: { step: "pre-command-palette-open-canvas", palette: false },
		});
	} finally {
		window.innerWidth = original;
		mod.useUiPreferencesStore.getState().closeCommandPalette();
	}
});

/* ---------------------------------------------------------------------------
 * 8. The hop state machine (review round 3).
 *
 * R8-1 to R8-3 all live in the 500 ms between a hop's button press and the
 * `next()`/`back()` it defers, which is why the tests here run the REAL tour and
 * press its REAL buttons: a source read cannot see a timer that outlives the
 * tour that scheduled it.
 * ------------------------------------------------------------------------- */

/**
 * A real tour started through the hook, the way the onboarding provider does it.
 *
 * The hook owns two listeners these tests are about - the end-of-tour palette
 * release and the step-7 show sync - so a bare `new Tour(...)` would exercise
 * neither. `walkStepSeven` above keeps its own inline button press so that test
 * stays byte-identical to the round it was approved in.
 */
async function startTourThroughHook(width, { closePalette = true } = {}) {
	window.innerWidth = width;
	if (closePalette) mod.useUiPreferencesStore.getState().closeCommandPalette();
	const tour = new mod.Shepherd.Tour({
		useModalOverlay: true,
		defaultStepOptions: { cancelIcon: mod.tourCancelIcon() },
	});
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = mod.createRoot(container);
	const Harness = () => {
		const { startTour } = mod.useOnboardingTour();
		mod.React.useEffect(() => {
			startTour({ forceModalCompleted: true });
		}, []);
		return null;
	};
	await mod.act(async () => {
		root.render(
			mod.React.createElement(
				mod.MemoryRouter,
				{ future: { v7_startTransition: true, v7_relativeSplatPath: true } },
				mod.React.createElement(
					mod.ShepherdJourneyContext.Provider,
					{ value: { tour, Shepherd: mod.Shepherd } },
					mod.React.createElement(Harness),
				),
			),
		);
	});
	const started = await mod.act(async () => waitFor(() => shownStepElement()));
	assert.ok(started, "the hook must start the real tour");
	return {
		tour,
		async stop() {
			await mod.act(async () => {
				root.unmount();
			});
			container.remove();
			// After unmount the tour keeps the listeners it registered, so this
			// still runs the release path the tests exercise.
			if (tour.isActive()) tour.cancel();
			await sleep(60);
			for (const element of document.querySelectorAll(".shepherd-element")) {
				element.remove();
			}
			mod.useUiPreferencesStore.getState().closeCommandPalette();
		},
	};
}

/** Press the shown step's footer button and let the hop's 500 ms wait elapse. */
async function hop(tour, variant, waitMs = 760) {
	const button = shownStepElement()?.querySelector(
		`.shepherd-footer .shepherd-button-${variant}`,
	);
	assert.ok(
		button,
		`step ${tour.getCurrentStep()?.id} has no ${variant} button`,
	);
	/*
	 * The store update a hop's palette open/close triggers repaints the mounted
	 * hook, so it has to flush inside `act` or React reports the update as the
	 * test's fault.
	 */
	await mod.act(async () => {
		button.click();
		await sleep(waitMs);
	});
}

/** Advance a hook-started tour from step 1 to step 6, where the hop begins. */
async function walkToStepSix(tour) {
	tour.show("agent-capabilities");
	await sleep(80);
	assert.equal(tour.getCurrentStep()?.id, "agent-capabilities");
}

test("a hop's deferred show cannot restart a tour cancelled during its wait", async () => {
	const original = window.innerWidth;
	try {
		window.innerWidth = mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40;
		mod.useUiPreferencesStore.getState().closeCommandPalette();
		const tour = new mod.Shepherd.Tour({
			useModalOverlay: true,
			defaultStepOptions: { cancelIcon: mod.tourCancelIcon() },
		});
		tour.addSteps(mod.createTourSteps());
		tour.start();
		await sleep(80);
		await walkToStepSix(tour);

		// Step 6 -> Next opens the palette and defers step 7 by 500 ms.
		shownStepElement()
			?.querySelector(".shepherd-footer .shepherd-button-primary")
			?.click();
		await sleep(120);
		assert.equal(paletteOpen(), true, "the hop must open the palette first");
		tour.cancel();
		assert.equal(tour.isActive(), false, "cancel must end the tour");
		await sleep(700);

		assert.equal(
			tour.isActive(),
			false,
			"the deferred next() may not resume it",
		);
		assert.equal(
			tour.getCurrentStep()?.id,
			"agent-capabilities",
			"the cancelled tour must stay where it was cancelled",
		);
		assert.equal(
			document.querySelectorAll(".shepherd-element").length,
			0,
			"no panel may be rendered for the cancelled tour",
		);
	} finally {
		window.innerWidth = original;
		for (const element of document.querySelectorAll(".shepherd-element")) {
			element.remove();
		}
		mod.useUiPreferencesStore.getState().closeCommandPalette();
	}
});

test("the close control during a hop's wait cancels for good", async () => {
	const original = window.innerWidth;
	try {
		window.innerWidth = mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40;
		mod.useUiPreferencesStore.getState().closeCommandPalette();
		const tour = new mod.Shepherd.Tour({
			useModalOverlay: true,
			defaultStepOptions: { cancelIcon: mod.tourCancelIcon() },
		});
		tour.addSteps(mod.createTourSteps());
		tour.start();
		await sleep(80);
		await walkToStepSix(tour);

		shownStepElement()
			?.querySelector(".shepherd-footer .shepherd-button-primary")
			?.click();
		await sleep(120);
		/*
		 * The panel re-admitted pointer events (onboarding-tour.css), so the X is
		 * a live target during the wait - which is why this path is reachable at
		 * all (review round 3, R3-1).
		 */
		const close = shownStepElement()?.querySelector(".shepherd-cancel-icon");
		assert.ok(close, "the shown step must carry the close control");
		close.click();
		await sleep(40);
		assert.equal(tour.isActive(), false, "the close control must cancel");
		await sleep(700);
		assert.equal(tour.isActive(), false, "and the hop must not undo it");
		assert.equal(
			document.querySelectorAll(".shepherd-element").length,
			0,
			"no panel may be rendered for the cancelled tour",
		);
	} finally {
		window.innerWidth = original;
		for (const element of document.querySelectorAll(".shepherd-element")) {
			element.remove();
		}
		mod.useUiPreferencesStore.getState().closeCommandPalette();
	}
});

test("ending the tour at step 7 closes the palette it opened", async () => {
	const original = window.innerWidth;
	const started = await startTourThroughHook(
		mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40,
	);
	try {
		await walkToStepSix(started.tour);
		await hop(started.tour, "primary");
		assert.equal(
			started.tour.getCurrentStep()?.id,
			"pre-command-palette-open-canvas",
		);
		assert.equal(
			paletteOpen(),
			true,
			"step 7 opens the palette it sits beside",
		);

		const close = shownStepElement()?.querySelector(".shepherd-cancel-icon");
		assert.ok(close, "step 7 must carry the close control");
		await mod.act(async () => {
			close.click();
			await sleep(80);
		});

		assert.equal(started.tour.isActive(), false, "the tour ended");
		assert.equal(
			paletteOpen(),
			false,
			"the palette the tour opened must not outlive it",
		);
	} finally {
		await started.stop();
		window.innerWidth = original;
	}
});

test("completing at step 7 closes the palette it opened", async () => {
	const original = window.innerWidth;
	const started = await startTourThroughHook(
		mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40,
	);
	try {
		await walkToStepSix(started.tour);
		await hop(started.tour, "primary");
		assert.equal(
			paletteOpen(),
			true,
			"step 7 opens the palette it sits beside",
		);

		// The last step is reachable without step 7's Next, so completion has to
		// release the palette on its own rather than rely on that ordering.
		await mod.act(async () => {
			started.tour.complete();
			await sleep(80);
		});

		assert.equal(started.tour.isActive(), false, "the tour completed");
		assert.equal(
			paletteOpen(),
			false,
			"completion must release the palette the tour opened",
		);
	} finally {
		await started.stop();
		window.innerWidth = original;
	}
});

test("a palette the user opened survives a tour that never opened one", async () => {
	const original = window.innerWidth;
	mod.useUiPreferencesStore.getState().openCommandPalette();
	const started = await startTourThroughHook(900, { closePalette: false });
	try {
		assert.equal(paletteOpen(), true, "the user's palette is up");
		await mod.act(async () => {
			started.tour.cancel();
			await sleep(80);
		});

		assert.equal(started.tour.isActive(), false, "the tour ended");
		assert.equal(
			paletteOpen(),
			true,
			"a palette the tour never opened is the user's to close",
		);
	} finally {
		await started.stop();
		window.innerWidth = original;
	}
});

test("a palette the user re-opens after the hop survives completion", async () => {
	const original = window.innerWidth;
	const started = await startTourThroughHook(
		mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40,
	);
	try {
		await walkToStepSix(started.tour);
		await hop(started.tour, "primary");
		await hop(started.tour, "primary");
		assert.equal(
			started.tour.getCurrentStep()?.id,
			"canvas-open-button",
			"step 7's Next lands on step 8",
		);
		assert.equal(paletteOpen(), false, "the hop closed the palette it opened");

		// Ownership is spent: the tour closed its palette, so a later palette is
		// the user's again.
		mod.useUiPreferencesStore.getState().openCommandPalette();
		await mod.act(async () => {
			started.tour.complete();
			await sleep(80);
		});

		assert.equal(
			paletteOpen(),
			true,
			"a palette opened after the tour released its own must survive",
		);
	} finally {
		await started.stop();
		window.innerWidth = original;
	}
});

test("a hop resized across the breakpoint takes the shape of the window it lands in", async () => {
	const original = window.innerWidth;
	const cleanup = () => {
		for (const element of document.querySelectorAll(".shepherd-element")) {
			element.remove();
		}
		mod.useUiPreferencesStore.getState().closeCommandPalette();
	};
	try {
		// Built above the breakpoint, resized below it mid-tour: the beside shape
		// must not survive into a window that cannot hold it (R3-3).
		window.innerWidth = mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 60;
		const wideBuild = new mod.Shepherd.Tour({
			useModalOverlay: true,
			defaultStepOptions: { cancelIcon: mod.tourCancelIcon() },
		});
		wideBuild.addSteps(mod.createTourSteps());
		wideBuild.start();
		await sleep(80);
		await walkToStepSix(wideBuild);
		window.innerWidth = 900;
		await hop(wideBuild, "primary");

		const narrowed = stepSevenOf(wideBuild.steps);
		assert.equal(
			wideBuild.getCurrentStep()?.id,
			"pre-command-palette-open-canvas",
		);
		assert.equal(
			narrowed.options.attachTo,
			undefined,
			"a window that cannot hold the beside shape must not keep its anchor",
		);
		assert.equal(narrowed.options.classes, undefined, "nor its width cap");
		assert.equal(paletteOpen(), false, "nor the palette it opened");
		wideBuild.cancel();

		// The reverse: built narrow, widened mid-tour, so the hop must take the
		// beside shape rather than leave a centred panel over nothing.
		window.innerWidth = 900;
		const narrowBuild = new mod.Shepherd.Tour({
			useModalOverlay: true,
			defaultStepOptions: { cancelIcon: mod.tourCancelIcon() },
		});
		narrowBuild.addSteps(mod.createTourSteps());
		narrowBuild.start();
		await sleep(80);
		await walkToStepSix(narrowBuild);
		window.innerWidth = mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 60;
		await hop(narrowBuild, "primary");

		const widened = stepSevenOf(narrowBuild.steps);
		assert.equal(widened.options.attachTo?.on, "right");
		assert.ok(
			widened.options.classes
				?.split(" ")
				.includes(mod.STEP_BESIDE_PALETTE_CLASS),
			"the widened hop must apply the beside shape",
		);
		assert.equal(paletteOpen(), true, "and open the palette it sits beside");
		narrowBuild.cancel();
	} finally {
		cleanup();
		window.innerWidth = original;
	}
});

test("step 7's shape follows a resize even when the tour shows it directly", async () => {
	const original = window.innerWidth;
	const started = await startTourThroughHook(900);
	const dropPalette = paletteAnchorStub();
	try {
		// No hop: `tour.show` bypasses the hop helpers, so only the hook's `show`
		// listener can re-decide the shape for this window.
		window.innerWidth = mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 60;
		started.tour.show("pre-command-palette-open-canvas");
		await sleep(80);

		const step = stepSevenOf(started.tour.steps);
		assert.equal(
			started.tour.getCurrentStep()?.id,
			"pre-command-palette-open-canvas",
		);
		assert.equal(step.options.attachTo?.on, "right");
		assert.ok(
			step.options.classes?.split(" ").includes(mod.STEP_BESIDE_PALETTE_CLASS),
			"a direct show must still apply the shape of the window it renders in",
		);
	} finally {
		dropPalette();
		await started.stop();
		window.innerWidth = original;
	}
});

/*
 * The shape is not a fact about the WINDOW alone (design round 4, D9).
 *
 * Shepherd resolves `attachTo` when the step is shown, and a target that is not
 * in the DOM is not a placement: it warns, drops the attachment and centres the
 * panel - with the 340 px cap still on it, so the result is a narrow column in
 * the middle of the window whose arrow points at nothing. That is reachable in
 * the shipped app too: the hop opens the palette and waits a fixed 500 ms, and a
 * `Cmd+K` in between closes it again, so the step is shown with no palette up.
 */
test("step 7 drops the beside shape when no palette is on screen", async () => {
	const original = window.innerWidth;
	const started = await startTourThroughHook(
		mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40,
	);
	try {
		started.tour.show("pre-command-palette-open-canvas");
		await sleep(80);

		const step = stepSevenOf(started.tour.steps);
		assert.equal(
			started.tour.getCurrentStep()?.id,
			"pre-command-palette-open-canvas",
		);
		assert.equal(
			step.options.attachTo,
			undefined,
			"no palette, no attachment to make",
		);
		assert.equal(
			step.options.classes,
			undefined,
			"no palette, no 340 px cap either",
		);
	} finally {
		await started.stop();
		window.innerWidth = original;
	}
});

/*
 * Attached sides are PHYSICAL in Shepherd (design round 4, D6).
 *
 * `attachTo.on` goes to Floating UI as a placement, so `right` means the right of
 * the SCREEN - while the app's own layout is logical and mirrors under
 * `dir="rtl"`. Without the mirror, every attached step in `ur` put its panel
 * over the RTL sidebar's icon column instead of the free side. The direction is
 * read from the shipped manifest (`textDirectionFor`), so this test changes the
 * locale the way production does and reads the sides back off the built steps.
 */
test("a right-to-left language attaches its panels on the free side", async () => {
	const original = window.innerWidth;
	try {
		window.innerWidth = 1380;
		mod.applyCapabilities({ features: { i18n: 1 }, language: "en" });
		const ltr = mod.createTourSteps();
		assert.equal(
			stepSevenOf(ltr)?.attachTo?.on,
			"right",
			"an LTR window keeps the palette's right side",
		);

		mod.applyCapabilities({ features: { i18n: 1 }, language: "ur" });
		const rtl = mod.createTourSteps();
		assert.equal(
			stepSevenOf(rtl)?.attachTo?.on,
			"left",
			"an RTL window puts the palette's copy on its free left side",
		);
		/*
		 * Both directions, not just step 7: a panel Shepherd placed on a target's
		 * left mirrors the same way, and the vertical sides must not move at all.
		 */
		const mirrored = rtl.filter(
			(step) => step.attachTo?.on === "left" || step.attachTo?.on === "right",
		);
		assert.ok(mirrored.length > 1, "more than one attached step must mirror");
		const ltrSides = ltr
			.filter((step) => step.attachTo?.on === "left")
			.map((step) => step.id);
		for (const id of ltrSides) {
			assert.equal(
				rtl.find((step) => step.id === id)?.attachTo?.on,
				"right",
				`${id}: a target's-left panel must take the right in RTL`,
			);
		}
		assert.equal(
			rtl.filter((step) => step.attachTo?.on === "top").length,
			ltr.filter((step) => step.attachTo?.on === "top").length,
			"the vertical sides are not the direction's business",
		);
	} finally {
		mod.applyCapabilities({ features: { i18n: 1 }, language: "en" });
		window.innerWidth = original;
	}
});

/* ---------------------------------------------------------------------------
 * 9. Palette ownership when the user moves the palette (review round 4).
 *
 * The claim `releaseTourCommandPalette` keeps is about "the palette this tour
 * opened", and the three tests here are the cases where that is not the same as
 * "the palette on screen": a palette the user replaced, a palette the user
 * already had up before the hop, and the close-side wait those two paths run
 * through. All three drive the REAL tour and the REAL store, because both
 * defects live in state that no source read can replay - a claim that outlives
 * a close, and a timer that outlives a cancel.
 * ------------------------------------------------------------------------- */

/**
 * Press a footer button and wait for the step it defers, rather than trusting
 * the fixed sleep inside `hop` to outlast a loaded machine.
 */
async function hopTo(tour, variant, stepId) {
	await hop(tour, variant);
	await mod.act(async () => {
		await waitFor(() => tour.getCurrentStep()?.id === stepId);
	});
}

test("a palette the user replaced after closing the tour's survives the hop out", async () => {
	const original = window.innerWidth;
	const started = await startTourThroughHook(
		mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40,
	);
	try {
		await walkToStepSix(started.tour);
		await hopTo(started.tour, "primary", "pre-command-palette-open-canvas");
		assert.equal(
			paletteOpen(),
			true,
			"step 7 opens the palette it sits beside",
		);

		/*
		 * What `Cmd+K` does twice: shut the palette the tour opened, then open the
		 * user's own. The shortcut is a window-level listener, so the tour never
		 * sees either transition - the store flag is the only witness (R4-1).
		 */
		mod.useUiPreferencesStore.getState().toggleCommandPalette();
		mod.useUiPreferencesStore.getState().toggleCommandPalette();
		assert.equal(
			paletteOpen(),
			true,
			"the user's palette is the one on screen",
		);

		const next = shownStepElement()?.querySelector(
			".shepherd-footer .shepherd-button-primary",
		);
		assert.ok(next, "step 7 must carry its footer");
		await mod.act(async () => {
			next.click();
			await sleep(200);
		});

		assert.equal(
			paletteOpen(),
			true,
			"the tour must not close a palette it did not open",
		);
		/*
		 * And it must not wait for the palette's unmount either: nothing of the
		 * tour's was closed, so the step advances at once rather than on the
		 * 500 ms timer.
		 */
		assert.equal(
			started.tour.getCurrentStep()?.id,
			"canvas-open-button",
			"a hop with no palette of its own has nothing to wait for",
		);
	} finally {
		await started.stop();
		window.innerWidth = original;
	}
});

test("a palette the user already had open is neither opened nor claimed", async () => {
	const original = window.innerWidth;
	/*
	 * `closePalette: false` keeps the palette the user opened before the tour
	 * started. Claiming it would make the tour close a dialog that was never its
	 * own on the way out (R4-2b).
	 */
	mod.useUiPreferencesStore.getState().openCommandPalette();
	const started = await startTourThroughHook(
		mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40,
		{ closePalette: false },
	);
	try {
		assert.equal(paletteOpen(), true, "the user's palette predates the tour");
		await walkToStepSix(started.tour);
		await hopTo(started.tour, "primary", "pre-command-palette-open-canvas");
		assert.equal(
			started.tour.getCurrentStep()?.id,
			"pre-command-palette-open-canvas",
		);
		assert.equal(
			paletteOpen(),
			true,
			"the hop must leave a palette it did not open alone",
		);

		await hop(started.tour, "primary");
		assert.equal(
			paletteOpen(),
			true,
			"and the hop out must not close what it never claimed",
		);
	} finally {
		await started.stop();
		window.innerWidth = original;
	}
});

test("cancelling during the step 7 -> 8 wait keeps the tour closed", async () => {
	const original = window.innerWidth;
	const started = await startTourThroughHook(
		mod.STEP_BESIDE_PALETTE_MIN_WIDTH + 40,
	);
	try {
		await walkToStepSix(started.tour);
		await hopTo(started.tour, "primary", "pre-command-palette-open-canvas");

		// Next closes the tour's palette first, then defers step 8 by 500 ms.
		const next = shownStepElement()?.querySelector(
			".shepherd-footer .shepherd-button-primary",
		);
		assert.ok(next, "step 7 must carry its footer");
		/*
		 * Pressed the way the round-3 tests press a live button: a plain click and a
		 * short sleep, so `act` cannot flush the pending 500 ms hop before the close
		 * control is clicked.
		 */
		next.click();
		await sleep(120);
		assert.equal(paletteOpen(), false, "the close side runs before the wait");

		const close = shownStepElement()?.querySelector(".shepherd-cancel-icon");
		assert.ok(close, "the panel is still up during the close-side wait");
		close.click();
		assert.equal(
			started.tour.isActive(),
			false,
			"the close control must cancel",
		);

		await mod.act(async () => {
			await sleep(700);
		});
		assert.equal(
			started.tour.isActive(),
			false,
			"the close-side wait may not resume a cancelled tour",
		);
		assert.equal(
			started.tour.getCurrentStep()?.id,
			"pre-command-palette-open-canvas",
			"the cancelled tour must stay where it was cancelled",
		);
		assert.equal(
			document.querySelectorAll(".shepherd-element").length,
			0,
			"no panel may be rendered for the cancelled tour",
		);
	} finally {
		await started.stop();
		window.innerWidth = original;
	}
});
