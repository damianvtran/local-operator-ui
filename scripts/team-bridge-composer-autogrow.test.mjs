import assert from "node:assert/strict";
import Module from "node:module";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * The Team Bridge composer's auto-grow, exercised against the REAL hook.
 *
 * WHY A HARNESS RATHER THAN THE PAGE. Auto-grow is a measurement contract - how
 * tall the field becomes for N lines, where it caps, when it scrolls - and the
 * page buries that under a mount of the whole feature. A harness renders the
 * hook the page uses and nothing else, so a failure names the rule.
 *
 * JSDOM HAS NO LAYOUT, so the two numbers the hook reads are modelled here and
 * nothing else is: `scrollHeight` counts wrapped lines from the field's own
 * value, and `getComputedStyle` reports the line height. Everything else - the
 * cap arithmetic, the overflow switch, the empty-draft fast path, the repin
 * rule - is the shipped code.
 */
const LINE_PX = 20;
const CHARS_PER_LINE = 20;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const name of ["HTMLElement", "Element", "Node", "Event", "MouseEvent"])
	globalThis[name] = dom.window[name];
globalThis.getComputedStyle = () => ({ lineHeight: `${LINE_PX}px` });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => dom.window.close());

/** How many times the hook asked for `scrollHeight` - a reflow, in the browser. */
let measurements = 0;
Object.defineProperty(
	dom.window.HTMLTextAreaElement.prototype,
	"scrollHeight",
	{
		configurable: true,
		get() {
			measurements += 1;
			const lines = Math.max(1, Math.ceil(this.value.length / CHARS_PER_LINE));
			return lines * LINE_PX;
		},
	},
);

/** `lines * CHARS_PER_LINE` characters is exactly that many wrapped lines. */
const text = (lines) => "x".repeat(lines * CHARS_PER_LINE);

/*
 * THE HOUSE SHIM: bundle to CJS with React left EXTERNAL, then evaluate it as a
 * module in this directory so `require("react")` resolves to the project's own
 * copy. Bundling React in instead gave a second scheduler whose timers kept the
 * process alive after the last test (measured: the file sat until the runner's
 * timeout with every case green).
 */
const bundle = await build({
	stdin: {
		contents: `
			export * as React from "react";
			export { act } from "react";
			export { createRoot } from "react-dom/client";
			export { useComposerAutoGrow } from "./src/renderer/src/features/team-bridge/use-composer-autogrow";
			export { useStickToBottom } from "./src/renderer/src/features/team-bridge/use-stick-to-bottom";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
	external: ["react", "react-dom", "react-dom/client"],
	loader: { ".css": "empty" },
	tsconfig: "tsconfig.app.json",
});
const compiled = new Module(
	`${process.cwd()}/scripts/composer-autogrow-runtime.cjs`,
);
compiled.filename = `${process.cwd()}/scripts/composer-autogrow-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const ui = compiled.exports;
const { React, act, createRoot } = ui;

const mount = async (element) => {
	const host = dom.window.document.createElement("div");
	dom.window.document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(element));
	return {
		host,
		unmount: async () => {
			await act(async () => root.unmount());
			host.remove();
		},
	};
};

/** Type into the field the way a person does: one input event, one value. */
const type = async (field, value) => {
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			dom.window.HTMLTextAreaElement.prototype,
			"value",
		).set.call(field, value);
		field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
};

const Composer = ({ onGrow }) => {
	const [value, setValue] = React.useState("");
	const ref = React.useRef(null);
	ui.useComposerAutoGrow(ref, value, { minPx: 40, onGrow });
	return React.createElement("textarea", {
		ref,
		value,
		onChange: (event) => setValue(event.target.value),
	});
};

const heightOf = (field) => Number.parseInt(field.style.height, 10);
const overflowOf = (field) => field.style.overflowY;

const mountComposer = async () => {
	const app = await mount(React.createElement(Composer));
	const field = app.host.querySelector("textarea");
	return { ...app, field };
};

test("the height tracks the content, and the resting height is a floor", async () => {
	const app = await mountComposer();
	const { field } = app;
	try {
		// One wrapped line is shorter than the resting box, so the floor holds.
		await type(field, text(1));
		assert.equal(heightOf(field), 40, "one line rests at the minimum");
		await type(field, text(4));
		assert.equal(
			heightOf(field),
			4 * LINE_PX,
			"four lines are four lines tall",
		);
		await type(field, text(10));
		assert.equal(heightOf(field), 10 * LINE_PX, "ten lines fit under the cap");
		assert.equal(
			overflowOf(field),
			"hidden",
			"no scrollbar while it still grows",
		);
	} finally {
		await app.unmount();
	}
});

test("the cap is the SMALLER of ten lines and 40% of the window", async () => {
	const app = await mountComposer();
	const { field } = app;
	try {
		// A tall window: ten lines (200px) is the binding term, not 40% (307px).
		Object.defineProperty(dom.window, "innerHeight", {
			configurable: true,
			value: 768,
		});
		await type(field, text(20));
		assert.equal(
			heightOf(field),
			10 * LINE_PX,
			"ten lines wins in a tall window",
		);
		assert.equal(
			overflowOf(field),
			"auto",
			"past the cap the composer scrolls",
		);

		/*
		 * A short window: 40% (160px) is smaller than ten lines, so it binds.
		 * The value has to CHANGE for the effect to re-run - a controlled field
		 * that receives the same string does not re-render, which is correct
		 * behaviour and would have hidden a broken cap behind a green test.
		 */
		Object.defineProperty(dom.window, "innerHeight", {
			configurable: true,
			value: 400,
		});
		await type(field, text(21));
		assert.equal(
			heightOf(field),
			Math.round(400 * 0.4),
			"40% of the window wins in a short one",
		);
		assert.equal(overflowOf(field), "auto");
	} finally {
		await app.unmount();
	}
});

test("it shrinks when lines are deleted, and the scrollbar goes away", async () => {
	const app = await mountComposer();
	const { field } = app;
	try {
		Object.defineProperty(dom.window, "innerHeight", {
			configurable: true,
			value: 768,
		});
		await type(field, text(14));
		assert.equal(overflowOf(field), "auto");
		await type(field, text(3));
		assert.equal(
			heightOf(field),
			3 * LINE_PX,
			"deleting lines shrinks the box",
		);
		assert.equal(
			overflowOf(field),
			"hidden",
			"and takes the scrollbar with it",
		);
	} finally {
		await app.unmount();
	}
});

test("an empty draft returns to rest without measuring", async () => {
	const app = await mountComposer();
	const { field } = app;
	try {
		await type(field, text(6));
		const before = measurements;
		// Send clears the draft; nothing about the box needs asking twice.
		await type(field, "");
		assert.equal(heightOf(field), 40, "the box is back to one row");
		assert.equal(
			measurements,
			before,
			"an empty draft must not force a reflow to know its height",
		);
	} finally {
		await app.unmount();
	}
});

test("a multiline paste grows in ONE step", async () => {
	const app = await mountComposer();
	const { field } = app;
	try {
		const before = measurements;
		await type(field, text(9));
		assert.equal(
			measurements - before,
			1,
			"one input event is one measurement, however many lines arrive",
		);
		assert.equal(heightOf(field), 9 * LINE_PX);
	} finally {
		await app.unmount();
	}
});

test("growth is reported so the timeline can stay at the bottom", async () => {
	const grown = [];
	const app = await mount(
		React.createElement(Composer, { onGrow: () => grown.push(1) }),
	);
	const field = app.host.querySelector("textarea");
	try {
		/* The mount IS a height change - an empty field has no inline height yet,
		 * so the resting one is written and reported. The timeline is pinned at
		 * that moment anyway, so reporting it costs nothing; count from here. */
		const atMount = grown.length;
		await type(field, text(1)); // one short line rests at the floor
		assert.equal(
			grown.length,
			atMount,
			"a text change that does not resize the box is not growth",
		);
		await type(field, text(5));
		assert.equal(
			grown.length,
			atMount + 1,
			"a real height change is reported once",
		);
	} finally {
		await app.unmount();
	}
});

/* ------------------------------ stick to bottom ---------------------------- */

const StickHarness = ({ onApi }) => {
	const { rootRef, repin, hold, pin } = ui.useStickToBottom({
		resetKey: "one",
		contentKey: "one",
	});
	onApi({ repin, hold, pin });
	return React.createElement(
		"div",
		{ ref: rootRef },
		React.createElement("div", { "data-radix-scroll-area-viewport": true }),
	);
};

const VIEWPORT_HEIGHT = 300;
const CONTENT_HEIGHT = 1000;

test("repin follows the bottom only when the reader was already there", async () => {
	let api = null;
	const keep = (next) => {
		api = next;
	};
	const app = await mount(React.createElement(StickHarness, { onApi: keep }));
	const viewport = app.host.querySelector("[data-radix-scroll-area-viewport]");
	try {
		Object.defineProperty(viewport, "scrollHeight", {
			configurable: true,
			value: CONTENT_HEIGHT,
		});
		Object.defineProperty(viewport, "clientHeight", {
			configurable: true,
			value: VIEWPORT_HEIGHT,
		});

		// A reader who scrolled up: the hook's own listener marks them unpinned.
		viewport.scrollTop = 0;
		await act(async () => {
			viewport.dispatchEvent(new dom.window.Event("scroll"));
		});
		api.repin();
		assert.equal(
			viewport.scrollTop,
			0,
			"growing must not yank a scrolled-up reader",
		);

		// The same reader at the bottom: following it is exactly what they want.
		api.pin();
		assert.equal(
			viewport.scrollTop,
			CONTENT_HEIGHT,
			"pin() jumps to the newest",
		);
		viewport.scrollTop = CONTENT_HEIGHT - 10;
		await act(async () => {
			viewport.dispatchEvent(new dom.window.Event("scroll"));
		});
		api.repin();
		assert.equal(
			viewport.scrollTop,
			CONTENT_HEIGHT,
			"a near-bottom reader is re-followed",
		);

		// hold() unmounts the following without moving anyone.
		viewport.scrollTop = 40;
		await act(async () => {
			viewport.dispatchEvent(new dom.window.Event("scroll"));
		});
		api.hold();
		api.repin();
		assert.equal(
			viewport.scrollTop,
			40,
			"hold() keeps a reader where they are",
		);
	} finally {
		await app.unmount();
	}
});
