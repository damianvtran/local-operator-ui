/**
 * S6a's approvals card: pure geometry and the inert controller's lifecycle.
 *
 * What this proves: the formula lands the card at the content rect's inline-end
 * corner, the transparent view is created with `#00000000`, the child is added
 * last, the page is never touched by the controller, tab switches with an
 * unchanged rect keep the card, a resize reapplies the formula, and an empty
 * queue or `presented:false` hides it. It also pins the one product promise of
 * this slice: no `webContents.focus()` call is made anywhere.
 *
 * What it cannot prove: native transparency, the 8px ring's hit routing, or
 * macOS compositing. Those are the probe's rows, not a jsdom claim.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const STUB = `
const state = { views: [], sessions: [], focus: 9 };
const handlers = new WeakMap();
export const constructorOptions = [];
export const focusState = state;
export const session = {
  fromPartition: (name) => {
    const entry = {
      name,
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
      on: () => {},
    };
    state.sessions.push(entry);
    return entry;
  },
};
export const webContents = {
  getFocusedWebContents: () => ({ id: state.focus }),
};
export const nativeTheme = { shouldUseDarkColors: true };
export class WebContentsView {
  constructor(options) {
    constructorOptions.push(options);
    this.bounds = null;
    this.visible = false;
    this.backgroundColor = null;
    this.focusCalls = 0;
    this.destroyed = false;
    this.handlers = new Map();
    this.webContents = {
      id: 70 + state.views.length,
      setWindowOpenHandler: () => {},
      on: (event, cb) => {
        const list = this.handlers.get(event) ?? [];
        list.push(cb);
        this.handlers.set(event, list);
      },
      removeListener: (event, cb) => {
        const list = (this.handlers.get(event) ?? []).filter((entry) => entry !== cb);
        this.handlers.set(event, list);
      },
      loadURL: () => {
        setTimeout(() => {
          for (const cb of this.handlers.get("did-finish-load") ?? []) cb();
        }, 0);
        return Promise.resolve();
      },
      executeJavaScript: (script) =>
        script.includes("approvals-card") ? Promise.resolve(200) : Promise.resolve(0),
      isDestroyed: () => this.destroyed,
      close: () => {
        this.destroyed = true;
      },
      focus: () => {
        this.focusCalls += 1;
        throw new Error("S6a must not focus the card");
      },
    };
    state.views.push(this);
  }
  setBounds(bounds) {
    this.bounds = { ...bounds };
  }
  setVisible(visible) {
    this.visible = visible;
  }
  setBackgroundColor(color) {
    this.backgroundColor = color;
  }
}
`;
const stubPlugin = {
	name: "electron-stub",
	setup(buildApi) {
		buildApi.onResolve({ filter: /^electron$/ }, () => ({
			path: "electron",
			namespace: "stub",
		}));
		buildApi.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
			contents: STUB,
			loader: "js",
		}));
	},
};

const bundle = await build({
	stdin: {
		contents: `
      export * from "./src/main/browser/approvals-overlay";
      export * from "./src/main/browser/approvals-overlay-bounds";
      export * as electron from "electron";
    `,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [stubPlugin],
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const mod = await import(moduleUrl);

const rect = (x, y, width, height) => ({ x, y, width, height });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

test("geometry: wide content anchors the card to the content rect's inline end", () => {
	const bounds = mod.approvalsCardBoundsFor({
		contentRect: rect(0, 0, 1000, 700),
		naturalHeight: 200,
	});
	assert.deepEqual(bounds, {
		view: { x: 632, y: 484, width: 368, height: 216 },
		card: { x: 640, y: 492, width: 352, height: 200 },
		width: 352,
		height: 200,
		pad: 8,
	});
});

test("geometry: 264 content is full-bleed with an 8px ring, 248-wide card", () => {
	const bounds = mod.approvalsCardBoundsFor({
		contentRect: rect(100, 50, 264, 600),
		naturalHeight: 220,
	});
	assert.deepEqual(bounds.view, {
		x: 100,
		y: 50 + 600 - 236,
		width: 264,
		height: 236,
	});
	assert.deepEqual(bounds.card, {
		x: 108,
		y: 58 + 600 - 236,
		width: 248,
		height: 220,
	});
});

test("geometry: the width ceiling and 359/360/420 boundaries are exact", () => {
	const at = (width) =>
		mod.approvalsCardBoundsFor({
			contentRect: rect(0, 0, width, 700),
			naturalHeight: 200,
		});
	assert.equal(at(359).width, 343);
	assert.equal(at(360).width, 344);
	assert.equal(at(420).width, 352);
	assert.equal(at(420).view.x, 52);
	assert.equal(at(420).view.x + at(420).view.width, 420);
});

test("geometry: height clamps to [96, min(480, contentH-16)] and refuses a sliver", () => {
	const tall = mod.approvalsCardBoundsFor({
		contentRect: rect(0, 0, 420, 600),
		naturalHeight: 900,
	});
	assert.equal(tall.height, 480);
	const short = mod.approvalsCardBoundsFor({
		contentRect: rect(0, 0, 420, 600),
		naturalHeight: 10,
	});
	assert.equal(short.height, 96);
	const ceiling = mod.approvalsCardBoundsFor({
		contentRect: rect(0, 0, 420, 200),
		naturalHeight: 200,
	});
	assert.equal(ceiling.height, 184);
	assert.equal(
		mod.approvalsCardBoundsFor({
			contentRect: rect(0, 0, 420, 111),
			naturalHeight: 200,
		}),
		null,
	);
	assert.equal(
		mod.approvalsCardBoundsFor({
			contentRect: rect(0, 0, 15, 600),
			naturalHeight: 200,
		}),
		null,
	);
});

test("geometry: the opaque fallback removes the ring and squares the card", () => {
	const bounds = mod.approvalsCardBoundsFor({
		contentRect: rect(10, 20, 264, 600),
		naturalHeight: 200,
		opaque: true,
	});
	assert.deepEqual(bounds.view, {
		x: 10,
		y: 20 + 600 - 200,
		width: 264,
		height: 200,
	});
	assert.deepEqual(bounds.card, bounds.view);
	assert.equal(bounds.pad, 0);
});

test("controller: auto-presents unfocused, last, transparent, and hides without touching the page", async () => {
	const children = [];
	const destroyed = false;
	const contentView = {
		get children() {
			return children;
		},
		addChildView(view) {
			const index = children.indexOf(view);
			if (index !== -1) children.splice(index, 1);
			children.push(view);
		},
		removeChildView(view) {
			const index = children.indexOf(view);
			if (index !== -1) children.splice(index, 1);
		},
	};
	const window = {
		contentView,
		isDestroyed: () => destroyed,
	};
	const controller = new mod.ApprovalsOverlayController({
		window,
		documentUrl: "https://example.test/browser-approvals-overlay.html",
		theme: "dark",
	});
	const pageRect = rect(0, 0, 1000, 700);
	controller.onLayout({
		activeTabId: 1,
		presented: true,
		contentRect: pageRect,
		revision: 1,
	});
	assert.equal(
		controller.facts().visible,
		false,
		"no card before the queue asks",
	);
	controller.setPending(2);
	await sleep(30);
	const view = children.at(-1);
	assert.ok(view, "the card is attached");
	assert.equal(view.visible, true);
	assert.equal(view.backgroundColor, "#00000000");
	assert.equal(children.at(-1), view, "the card is the last child");
	assert.equal(view.focusCalls, 0, "auto-present must not focus the card");
	assert.deepEqual(view.bounds, { x: 632, y: 484, width: 368, height: 216 });
	assert.equal(controller.facts().presented, true);

	controller.onLayout({
		activeTabId: 2,
		presented: true,
		contentRect: { ...pageRect },
		revision: 2,
	});
	assert.equal(
		view.visible,
		true,
		"a tab switch with the same rect keeps the card",
	);
	assert.equal(
		children.at(-1),
		view,
		"the card remains topmost after a tab switch",
	);

	controller.onLayout({
		activeTabId: 2,
		presented: true,
		contentRect: rect(0, 0, 1200, 700),
		revision: 3,
	});
	assert.deepEqual(view.bounds, { x: 832, y: 484, width: 368, height: 216 });

	controller.onLayout({
		activeTabId: 2,
		presented: false,
		contentRect: null,
		revision: 4,
	});
	assert.equal(view.visible, false, "route loss hides the card");
	assert.equal(children.length, 1, "hiding does not destroy it");
	assert.equal(controller.facts().presented, false);

	controller.onLayout({
		activeTabId: 2,
		presented: true,
		contentRect: rect(0, 0, 1000, 700),
		revision: 5,
	});
	controller.setPending(0);
	assert.equal(view.visible, false, "an empty queue hides the card");
	assert.equal(view.focusCalls, 0);
	controller.dispose("test");
	assert.equal(children.length, 0);
	assert.equal(view.destroyed, true);
});

test("controller: the opaque fallback is a full-bleed opaque view", async () => {
	const children = [];
	const controller = new mod.ApprovalsOverlayController({
		window: {
			contentView: {
				children,
				addChildView: (view) => {
					if (!children.includes(view)) children.push(view);
				},
				removeChildView: (view) => {
					const index = children.indexOf(view);
					if (index !== -1) children.splice(index, 1);
				},
			},
			isDestroyed: () => false,
		},
		documentUrl: "https://example.test/browser-approvals-overlay.html",
		opaque: true,
	});
	controller.onLayout({
		activeTabId: 1,
		presented: true,
		contentRect: rect(0, 0, 264, 600),
		revision: 1,
	});
	controller.setPending(1);
	await sleep(30);
	const view = children.at(-1);
	assert.equal(view.backgroundColor, "#1b1f24");
	assert.deepEqual(view.bounds, { x: 0, y: 400, width: 264, height: 200 });
	controller.dispose("test");
});
