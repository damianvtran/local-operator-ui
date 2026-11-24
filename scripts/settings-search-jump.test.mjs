import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * LANDING ON A SETTINGS ROW.
 *
 * `settings-search-jump.ts` is two decisions and one loop, and all three are
 * asserted here against a real jsdom document rather than a browser: which
 * element a jump focuses, how long it waits for it, and that the wash is painted
 * on the ROW (the thing the reader arrived at) even when the CONTROL inside it
 * took focus.
 *
 * jsdom owns `requestAnimationFrame` only when it is visual, so the DOM is
 * created with `pretendToBeVisual: true` — the same flag the repository's other
 * DOM-driven suites pass. `scrollIntoView` is not implemented there and is
 * stubbed; the assertions are about the CALL, not about pixels (pixel claims
 * belong to the committed frames).
 */
const dom = new JSDOM(
	`<!doctype html><html><body>
		<div data-settings-content>
			<div data-search-section="appearance" data-search-section-label="Appearance">
				<div data-search-row="appearance.theme">
					<span>Theme</span>
					<div data-search-control><button type="button">Local Operator Dark</button></div>
				</div>
				<div data-search-row="appearance.reasoning">
					<span>Show agent reasoning</span>
					<button type="button" data-search-control>Toggle</button>
				</div>
			</div>
			<div data-search-section="hidden-section" hidden>
				<div data-search-row="hidden.row"><span>Hidden</span></div>
			</div>
		</div>
	</body></html>`,
	{ pretendToBeVisual: true },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
	dom.window,
);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
	dom.window,
);
globalThis.CSS = { escape: (value) => String(value) };
/** The calls the module makes, recorded rather than performed. */
const scrolled = [];
dom.window.Element.prototype.scrollIntoView = function scrollIntoView(options) {
	scrolled.push({ element: this, options });
};

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/settings/search/settings-search-jump";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
});
const module = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	SEARCH_JUMP_SETTLE_FRAMES,
	findSearchRow,
	findSearchSectionRoot,
	jumpToSearchRow,
	jumpToSearchSection,
	jumpToSearchSectionSettled,
	scrollPanelTo,
	searchControlOf,
} = module;

const root = dom.window.document.querySelector("[data-settings-content]");

/** Await a stable number of painted frames. */
const frames = (count) =>
	new Promise((resolve) => {
		let left = count;
		const step = () => {
			left -= 1;
			if (left <= 0) resolve();
			else dom.window.requestAnimationFrame(step);
		};
		dom.window.requestAnimationFrame(step);
	});

test("row lookup finds the row by its stable id, dots and all", () => {
	assert.equal(
		findSearchRow(root, "appearance.theme")?.getAttribute("data-search-row"),
		"appearance.theme",
	);
	assert.equal(findSearchRow(root, "nope.missing"), null);
});

test("the focus target is the row's control, and the row when there is none", () => {
	const withControl = findSearchRow(root, "appearance.reasoning");
	assert.equal(
		searchControlOf(withControl)?.getAttribute("data-search-control"),
		"",
	);
	const bare = dom.window.document.createElement("div");
	bare.innerHTML = "<span>No control here</span>";
	assert.equal(searchControlOf(bare), bare);
});

test("a row that carries the control mark ITSELF focuses the control inside it (QA round 1, Q4)", () => {
	/*
	 * The shared row components (`ToggleSetting`, `EditableField`, transcript
	 * mode, window glass) put `data-search-control` on the ROW ROOT, where the
	 * element is a wrapper and the thing that takes the caret is the switch or
	 * the field inside it. `row.querySelector` searches only DESCENDANTS, so that
	 * mark was invisible and the jump focused the wrapper div — measured in the
	 * app as `activeElement` = the row with `tabindex="-1"`, the switch one Tab
	 * away (QA round 1, Q4).
	 */
	const row = dom.window.document.createElement("div");
	row.setAttribute("data-search-row", "appearance.glass");
	row.setAttribute("data-search-control", "");
	row.innerHTML =
		'<div><span>Translucent window</span><button type="button" role="switch">On</button></div>';
	const resolved = searchControlOf(row);
	assert.equal(
		resolved.getAttribute("role"),
		"switch",
		"a self-marked row hands focus to the switch inside it",
	);
});

test("a jump scrolls the control to the centre, focuses it, and washes the ROW", async () => {
	const painted = [];
	const outcome = await jumpToSearchRow(root, "appearance.theme", {
		paint: (element) => painted.push(element),
	});
	assert.equal(outcome, "landed");
	const button = findSearchRow(root, "appearance.theme").querySelector(
		"button",
	);
	// Identity compared as a boolean for the reason the component test states:
	// an element diff on failure is a memory event, not a message.
	assert.ok(
		dom.window.document.activeElement === button,
		"focus is on the control",
	);
	/*
	 * The landing sets the PANEL's own scrollTop, never `scrollIntoView`: that
	 * call also moved the `panel-flush` column above the panel (design round 1,
	 * D1). The fixture has no layout, so the arithmetic test below owns the
	 * numbers; here the claim is the mechanism.
	 */
	assert.equal(
		scrolled.filter((call) => call.element === button).length,
		0,
		"the control was not scrolled by an ancestor walk",
	);
	assert.deepEqual(
		painted.map((element) => element.getAttribute("data-search-row")),
		["appearance.theme"],
		"the wash lands on the row, not on the control",
	);
});

test("a row behind [hidden] is not a landing: the jump waits, then reports missing", async () => {
	const painted = [];
	const outcome = await jumpToSearchRow(root, "hidden.row", {
		paint: (element) => painted.push(element),
	});
	assert.equal(outcome, "missing");
	assert.deepEqual(painted, []);
});

test("a row that does not exist resolves missing within the frame budget", async () => {
	const start = Date.now();
	const outcome = await jumpToSearchRow(root, "not.here", {
		paint: () => {},
	});
	assert.equal(outcome, "missing");
	assert.ok(Date.now() - start < 5000, "bounded, not a hang");
	assert.equal(SEARCH_JUMP_SETTLE_FRAMES > 0, true);
});

test("the settle is bounded: a row mounted during the wait is landed on", async () => {
	const pending = jumpToSearchRow(root, "late.row", { paint: () => {} });
	await frames(2);
	const section = dom.window.document.createElement("div");
	section.setAttribute("data-search-section", "late");
	section.setAttribute("tabindex", "-1");
	section.innerHTML = '<div data-search-row="late.row"><span>Late</span></div>';
	root.append(section);
	assert.equal(await pending, "landed");
});

test("a section jump makes the root focusable, then focuses it", () => {
	/*
	 * The app's section roots are plain `<div>`s without a `tabindex`
	 * attribute, so `HTMLElement.tabIndex` READS -1 and the old
	 * `if (element.tabIndex < 0) element.focus()` focused nothing. The fixture
	 * deliberately has no `tabindex` for the same reason (review round 1, M1).
	 */
	const painted = [];
	const section = root.querySelector('[data-search-section="appearance"]');
	assert.equal(
		section.hasAttribute("tabindex"),
		false,
		"the fixture starts as the app renders it",
	);
	const outcome = jumpToSearchSection(root, "appearance", {
		paint: (element) => painted.push(element),
	});
	assert.equal(outcome, "landed");
	assert.equal(section.getAttribute("tabindex"), "-1", "and becomes focusable");
	assert.ok(dom.window.document.activeElement === section);
	assert.equal(
		scrolled.filter((call) => call.element === section).length,
		0,
		"the section was reached by the panel's scrollTop, not an ancestor walk",
	);
	assert.equal(painted[0], section);
});

test("a row inside a hidden TAB lands only once the tab commit reveals the panel", async () => {
	/*
	 * This is the tab change's own case: every panel stays mounted, so a row in
	 * another tab is findable from the first frame and `[hidden]` on its panel is
	 * what says "not yet". The settle covers the commit that reveals it.
	 */
	const section = root.querySelector('[data-search-section="hidden-section"]');
	assert.equal(
		section.hasAttribute("hidden"),
		true,
		"the fixture starts hidden",
	);
	const pending = jumpToSearchRow(root, "hidden.row", { paint: () => {} });
	await frames(2);
	section.removeAttribute("hidden");
	assert.equal(await pending, "landed");
});

test("a section in another tab: the sync answer is missing, the settled one lands", async () => {
	const holder = dom.window.document.createElement("section");
	holder.setAttribute("hidden", "");
	holder.setAttribute("data-settings-panel", "deep");
	holder.innerHTML = '<div data-search-section="deep"></div>';
	root.append(holder);
	// A hidden section is in the document (that is how the page knows which tab
	// to reveal), so the raw lookup finds it and the reachable one does not.
	assert.notEqual(findSearchSectionRoot(root, "deep"), null);
	assert.equal(
		jumpToSearchSection(root, "deep", { paint: () => {} }),
		"missing",
	);
	const pending = jumpToSearchSectionSettled(root, "deep", { paint: () => {} });
	await frames(2);
	holder.removeAttribute("hidden");
	assert.equal(await pending, "landed");
	assert.equal(
		root.querySelector('[data-search-section="deep"]').getAttribute("tabindex"),
		"-1",
	);
});

test("the settled section jump is bounded: a target that never appears is missing", async () => {
	const start = Date.now();
	assert.equal(
		await jumpToSearchSectionSettled(root, "never", { paint: () => {} }),
		"missing",
	);
	assert.ok(Date.now() - start < 5000, "bounded, not a hang");
});

test("a landing sets the panel's scrollTop: centre for a row, start for a section", () => {
	/*
	 * The arithmetic that replaced `scrollIntoView({block})`. It is asserted on
	 * geometry a browser would report, on a document of its own, because the
	 * shared fixture has no layout — and the point of the change is that the
	 * ONLY scroller moved is `[data-settings-content]`; the column above it (the
	 * `panel-flush` wrapper, which also reports overflow) must stay at 0.
	 */
	const { document } = dom.window;
	const outer = document.createElement("div");
	outer.setAttribute("data-glass-region", "canvas-content");
	const scroller = document.createElement("div");
	scroller.setAttribute("data-settings-content", "");
	const row = document.createElement("div");
	row.setAttribute("data-search-row", "probe.row");
	const control = document.createElement("button");
	control.setAttribute("data-search-control", "");
	control.type = "button";
	row.appendChild(control);
	scroller.appendChild(row);
	outer.appendChild(scroller);
	document.body.appendChild(outer);

	Object.defineProperty(scroller, "clientHeight", { value: 600 });
	scroller.scrollTop = 100;
	scroller.getBoundingClientRect = () => ({ top: 32, height: 600 });
	row.getBoundingClientRect = () => ({ top: 432, height: 40 });
	control.getBoundingClientRect = () => ({ top: 432, height: 40 });
	let walked = 0;
	control.scrollIntoView = () => {
		walked += 1;
	};

	assert.equal(
		scrollPanelTo(scroller, control, "center"),
		true,
		"the panel is the scroller",
	);
	// offset = 432 - 32 + 100 = 500; centre = 500 - (600 - 40) / 2 = 220.
	assert.equal(
		scroller.scrollTop,
		220,
		"a row lands in the middle of the panel",
	);
	assert.equal(outer.scrollTop, 0, "the column above the panel did not move");
	assert.equal(walked, 0, "no ancestor walk");

	scroller.scrollTop = 100;
	assert.equal(scrollPanelTo(scroller, row, "start"), true);
	assert.equal(scroller.scrollTop, 500, "a section lands at the panel's top");
	assert.equal(outer.scrollTop, 0);
	assert.equal(walked, 0);

	// A root that is not the page's scroller and does not contain one: say so,
	// so the caller can fall back rather than silently do nothing.
	assert.equal(scrollPanelTo(row, control, "center"), false);
	outer.remove();
});
