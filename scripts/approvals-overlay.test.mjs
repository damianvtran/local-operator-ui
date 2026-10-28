/**
 * S6a's approvals card: pure geometry and the inert controller's lifecycle.
 *
 * What this proves: the formula lands the card at the content rect's bottom-right
 * corner (S6a is LTR-only; RTL placement is S6b), the transparent view is created with `#00000000`, the child is added
 * last, the page is never touched by the controller, tab switches with an
 * unchanged rect keep the card, a content-rect resize rebuilds the child at the
 * new size (Electron 44.3.0 leaves the replacement viewport at the old size),
 * and an empty queue or `presented:false` hides it. It also pins the one product
 * promise of this slice: no focus call is made anywhere.
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
export const ipcListeners = new Map();
export const ipcMain = {
  on: (channel, listener) => {
    const list = ipcListeners.get(channel) ?? [];
    list.push(listener);
    ipcListeners.set(channel, list);
  },
  removeListener: (channel, listener) => {
    const list = (ipcListeners.get(channel) ?? []).filter((entry) => entry !== listener);
    ipcListeners.set(channel, list);
  },
};
export function emitIpc(channel, event, payload) {
  for (const listener of ipcListeners.get(channel) ?? []) listener(event, payload);
}
export function listenerCount(channel) {
  return (ipcListeners.get(channel) ?? []).length;
}
export function resetIpc() {
  ipcListeners.clear();
}
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
    this.mainFrame = { url: "file:///tmp/browser-approvals-overlay.html" };
    this.webContents = {
      id: 70 + state.views.length,
      mainFrame: this.mainFrame,
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
      // Auto-present must never call this; explicit open uses the host's gated
      // focusTarget, not webContents.focus(), so the stub still has no path.
      focus: () => {
        this.focusCalls += 1;
        throw new Error("the controller must not call webContents.focus()");
      },
    };
    state.views.push(this);
  }
  setBounds(bounds) {
    this.bounds = { ...bounds };
  }
  getBounds() {
    return this.bounds ? { ...this.bounds } : { x: 0, y: 0, width: 0, height: 0 };
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
      export * from "./src/main/browser/approvals-overlay-model";
      export * from "./src/shared/browser-approvals-overlay";
      export * as electron from "electron";
      export { emitIpc, listenerCount, resetIpc } from "electron";
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
/** One live queue entry per index; the controller's builder does the rest. */
const entries = (n) =>
	Array.from({ length: n }, (_, index) => ({
		entryId: `entry-${index}`,
		origin: `https://example${index}.test`,
		displayAuthority: `Agent ${index}`,
		expiresAt: Date.now() + 600_000,
	}));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Wait for a condition instead of sleeping a fixed number of milliseconds.
 * A show and a rebuild are two document loads plus a measurement, so a fixed
 * 30 ms wait is a race on a loaded machine; the evidence tests must pick the
 * settled child, not whichever load happened to finish.
 */
async function waitFor(
	predicate,
	label,
	timeout = 4000,
	snapshot = () => null,
) {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		if (predicate()) return;
		await sleep(10);
	}
	throw new Error(
		`timed out waiting for ${label}: ${JSON.stringify(snapshot())}`,
	);
}

test("geometry: wide content anchors the card to the content rect's bottom-right corner", () => {
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

test("geometry: a fractional measured card rounds up, not down to the floor", () => {
	const bounds = mod.approvalsCardBoundsFor({
		contentRect: rect(0, 0, 264, 600),
		naturalHeight: 99.594,
	});
	assert.equal(bounds.height, 100);
	assert.equal(bounds.view.height, 116);
	assert.equal(bounds.view.y + 8, bounds.card.y);
});

test("controller: the card is on by default; only the disable switch turns it off", () => {
	assert.equal(mod.approvalsOverlayEnabled({}), true);
	assert.equal(
		mod.approvalsOverlayEnabled({ [mod.APPROVALS_OVERLAY_DISABLE_ENV]: "0" }),
		true,
	);
	assert.equal(
		mod.approvalsOverlayEnabled({
			[mod.APPROVALS_OVERLAY_DISABLE_ENV]: "true",
		}),
		true,
	);
	assert.equal(
		mod.approvalsOverlayEnabled({ [mod.APPROVALS_OVERLAY_DISABLE_ENV]: "1" }),
		false,
	);
});

test("expiry: scheduling follows the earliest live entry", () => {
	assert.equal(mod.approvalsExpiryDelay([], 1000), null);
	assert.equal(
		mod.approvalsExpiryDelay([{ expiresAt: 1500 }, { expiresAt: 1200 }], 1000),
		200,
	);
	assert.equal(mod.approvalsExpiryDelay([{ expiresAt: 900 }], 1000), 0);
});

test("document: the count is a first-paint fallback, and zero is omitted", () => {
	const at = (count) =>
		new URL(
			mod.approvalsDocumentUrl(
				"file:///app/out/renderer/browser-approvals-overlay.html",
				count,
				"dark",
				false,
			),
		);
	assert.equal(at(0).searchParams.get("count"), null);
	assert.equal(at(2).searchParams.get("count"), "2");
	const light = new URL(
		mod.approvalsDocumentUrl("file:///x.html", 1, "light", true),
	);
	assert.equal(light.searchParams.get("theme"), "light");
	assert.equal(light.searchParams.get("opaque"), "1");
});

test("geometry: resize rebuild keeps the card at the new width", async () => {
	const children = [];
	const contentView = {
		get children() {
			return children;
		},
		addChildView(view) {
			const i = children.indexOf(view);
			if (i !== -1) children.splice(i, 1);
			children.push(view);
		},
		removeChildView(view) {
			const i = children.indexOf(view);
			if (i !== -1) children.splice(i, 1);
		},
	};
	const window = { contentView, isDestroyed: () => false };
	const controller = new mod.ApprovalsOverlayController({
		window,
		documentUrl: "https://example.test/browser-approvals-overlay.html",
		theme: "dark",
	});
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 264, 600),
		revision: 1,
	});
	controller.setModel({ entries: entries(2) });
	await waitFor(
		() =>
			controller.facts().ready &&
			controller.facts().visible &&
			children.at(-1)?.bounds.width === 264,
		"the first show at 264",
	);
	const first = children.at(-1);
	assert.equal(first.bounds.width, 264);
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 900, 600),
		revision: 2,
	});
	await waitFor(
		() =>
			controller.facts().ready &&
			controller.facts().visible &&
			children.at(-1)?.bounds.width === 368,
		"the resize to 900",
	);
	const second = children.at(-1);
	assert.notEqual(second, first, "the resize must create a fresh child");
	assert.equal(second.bounds.width, 368);
	assert.equal(second.bounds.x, 532);
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 264, 600),
		revision: 3,
	});
	await waitFor(
		() =>
			controller.facts().ready &&
			controller.facts().visible &&
			children.at(-1)?.bounds.width === 264,
		"the resize back to 264",
	);
	const third = children.at(-1);
	assert.notEqual(third, second, "the way back is a rebuild too");
	assert.equal(third.bounds.width, 264);
	assert.equal(third.bounds.x, 0);
});

test("controller: a zero-width load is not measured as the card height", async () => {
	const children = [];
	const contentView = {
		get children() {
			return children;
		},
		addChildView(view) {
			const i = children.indexOf(view);
			if (i !== -1) children.splice(i, 1);
			children.push(view);
		},
		removeChildView(view) {
			const i = children.indexOf(view);
			if (i !== -1) children.splice(i, 1);
		},
	};
	const controller = new mod.ApprovalsOverlayController({
		window: { contentView, isDestroyed: () => false },
		documentUrl: "https://example.test/browser-approvals-overlay.html",
		theme: "dark",
	});
	// The construction-time document loads into a 0x0 view and must not pin the
	// 200 DIP the stub measures there.
	await waitFor(
		() => controller.facts().ready,
		"the zero-width construction load",
	);
	assert.equal(controller.facts().bounds, null, "no bounds before a layout");
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 1000, 700),
		revision: 1,
	});
	controller.setModel({ entries: entries(2) });
	assert.equal(
		children.at(-1).bounds.height,
		112,
		"first show rebuilds at the 96 DIP floor, not the 0-width measurement",
	);
	await waitFor(
		() => controller.facts().bounds?.view?.height === 216,
		"the re-measure at a usable width",
		4000,
		() => ({
			facts: controller.facts(),
			children: children.map((view) => view.bounds),
		}),
	);
	assert.equal(
		children.at(-1).bounds.height,
		216,
		"the re-measure at a usable width drives the final bounds",
	);
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
		presented: true,
		contentRect: pageRect,
		revision: 1,
	});
	assert.equal(
		controller.facts().visible,
		false,
		"no card before the queue asks",
	);
	controller.setModel({ entries: entries(2) });
	await waitFor(
		() =>
			controller.facts().ready &&
			controller.facts().visible &&
			controller.facts().bounds?.view?.height === 216,
		"the auto-presented card",
	);
	const view = children.at(-1);
	assert.ok(view, "the card is attached");
	assert.equal(view.visible, true);
	assert.equal(view.backgroundColor, "#00000000");
	assert.equal(children.at(-1), view, "the card is the last child");
	assert.equal(view.focusCalls, 0, "auto-present must not focus the card");
	assert.deepEqual(view.bounds, { x: 632, y: 484, width: 368, height: 216 });
	assert.equal(controller.facts().presented, true);

	controller.onLayout({
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
		presented: true,
		contentRect: rect(0, 0, 1200, 700),
		revision: 3,
	});
	assert.deepEqual(view.bounds, { x: 832, y: 484, width: 368, height: 216 });

	controller.onLayout({
		presented: false,
		contentRect: null,
		revision: 4,
	});
	assert.equal(view.visible, false, "route loss hides the card");
	assert.equal(children.length, 1, "hiding does not destroy it");
	assert.equal(controller.facts().presented, false);

	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 1000, 700),
		revision: 5,
	});
	controller.setModel({ entries: [] });
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
		presented: true,
		contentRect: rect(0, 0, 264, 600),
		revision: 1,
	});
	controller.setModel({ entries: entries(1) });
	await waitFor(
		() => controller.facts().ready && controller.facts().visible,
		"the opaque card",
	);
	const view = children.at(-1);
	assert.equal(view.backgroundColor, "#1b1f24");
	assert.deepEqual(view.bounds, { x: 0, y: 400, width: 264, height: 200 });
	controller.dispose("test");
});

test("geometry: RTL anchors the card's inline end to the content rect's left edge", () => {
	const ltr = mod.approvalsCardBoundsFor({
		contentRect: rect(0, 0, 900, 600),
		naturalHeight: 200,
		dir: "ltr",
	});
	const rtl = mod.approvalsCardBoundsFor({
		contentRect: rect(0, 0, 900, 600),
		naturalHeight: 200,
		dir: "rtl",
	});
	assert.equal(ltr.view.x, 900 - 368);
	assert.equal(
		rtl.view.x,
		0,
		"the view's left edge is the content's left edge",
	);
	assert.equal(rtl.card.x, 8, "the card keeps the same 8 DIP inset");
	assert.equal(rtl.view.y, ltr.view.y, "the vertical anchor is unchanged");
	assert.equal(rtl.view.width, ltr.view.width);
});

test("model: hostile fields are rebuilt from the allow-list, never forwarded", () => {
	const model = mod.sanitizeApprovalsCardModel({
		v: 1,
		seq: 7,
		locale: "fr-FR",
		dir: "rtl",
		theme: "purple",
		view: "evil",
		focus: "yes",
		count: 99,
		busy: 1,
		error: "boom",
		request: {
			entryId: "e1",
			origin: "https://example.test/path",
			requester: "x".repeat(100_000),
			expiresAt: 123,
		},
		pending: [{ entryId: "e1", origin: "javascript:alert(1)", requester: "" }],
	});
	assert.equal(model.seq, 7);
	assert.equal(model.dir, "rtl");
	assert.equal(model.theme, "dark", "an unknown theme is not passed through");
	assert.equal(model.view, "request");
	assert.equal(model.focus, false, "only the literal true focuses");
	assert.equal(model.error, null, "an unknown error code is dropped");
	assert.equal(
		model.request.origin,
		"https://example.test",
		"the origin is normalised",
	);
	assert.equal(model.request.requester.length, 256, "the requester is capped");
	assert.equal(model.pending.length, 0, "a non-http origin cannot be painted");
});

test("model: the production queue names the requester, never the site", () => {
	const model = mod.approvalsCardModelFrom({
		seq: 1,
		entries: [
			{
				entryId: "e1",
				origin: "https://example.test",
				displayAuthority: "example.test",
				requester: "session:session-a",
				requesterSessionId: "session-a",
				expiresAt: Date.now() + 60_000,
				broad: { scope: "domain", key: "example.test" },
			},
			{
				entryId: "e2",
				origin: "https://example.test",
				displayAuthority: "example.test",
				requester: "session:session-b",
				requesterSessionId: "session-b",
				expiresAt: Date.now() + 60_000,
			},
		],
		requesterLabels: {
			"session-a": "Fix the login flow",
			"session-b": "Draft a release note",
		},
		locale: "en",
		dir: "ltr",
		theme: "dark",
	});
	assert.equal(model.request.requester, "Fix the login flow");
	assert.notEqual(model.request.requester, "example.test");
	assert.equal(model.pending[1].requester, "Draft a release note");
});

test("model: the app's exact palette survives sanitisation, junk does not", () => {
	const parsed = (palette) =>
		mod.sanitizeApprovalsCardModel({
			v: 1,
			seq: 1,
			locale: "fr",
			dir: "ltr",
			theme: "light",
			palette,
			view: "request",
			focus: false,
			count: 0,
			busy: false,
			request: null,
			pending: [],
			error: null,
		})?.palette ?? null;
	assert.equal(parsed("catppuccinLatte"), "catppuccinLatte");
	assert.equal(parsed("</style><script>"), null);
});

test("model: a non-session requester is not rendered from the site", () => {
	const model = mod.approvalsCardModelFrom({
		seq: 1,
		entries: [
			{
				entryId: "e1",
				origin: "https://example.test",
				displayAuthority: "example.test",
				expiresAt: Date.now() + 60_000,
				broad: { scope: "domain", key: "example.test" },
			},
		],
		locale: "en",
		dir: "ltr",
		theme: "dark",
	});
	// The document falls back to its localized "An agent"; main never invents a
	// label from the requested host (F2).
	assert.equal(model.request.requester, "");
	assert.equal(model.request.broadKey, "example.test");
});

test("model: the pending list is capped and the request skips dismissed entries", () => {
	const many = Array.from({ length: 40 }, (_, index) => ({
		entryId: `e${index}`,
		origin: `https://e${index}.test`,
		displayAuthority: `Agent ${index}`,
		expiresAt: Date.now() + 60_000,
	}));
	const model = mod.approvalsCardModelFrom({
		seq: 1,
		entries: many,
		locale: "en",
		dir: "ltr",
		theme: "dark",
		dismissed: new Set(["e0"]),
	});
	assert.equal(model.pending.length, 20);
	assert.equal(model.count, 20);
	assert.equal(model.request.entryId, "e1", "the dismissed entry is skipped");
});

test("controller: explicit open focuses the card through the gated helper; close returns the page", async () => {
	const children = [];
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
	const window = { contentView, isDestroyed: () => false };
	const focused = [];
	let pageFocused = 0;
	const page = {
		isDestroyed: () => false,
		focus: () => {
			pageFocused += 1;
		},
	};
	const controller = new mod.ApprovalsOverlayController({
		window,
		documentUrl: "file:///tmp/browser-approvals-overlay.html",
		pageWebContents: () => page,
		focusTarget: (target) => {
			focused.push(target);
		},
	});
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 600, 500),
		revision: 1,
	});
	controller.setModel({ entries: entries(1), locale: "fr-FR", dir: "rtl" });
	await waitFor(
		() => controller.facts().ready && controller.facts().visible,
		"the auto-presented card",
	);
	assert.equal(focused.length, 0, "auto-present takes no focus");
	assert.equal(pageFocused, 0);
	const view = children.at(-1);
	assert.equal(view.bounds.x, 0, "the RTL model mirrors the native view");
	assert.equal(controller.facts().explicitOpen, false);

	controller.open({ focus: true });
	await waitFor(() => focused.length > 0, "the explicit open's focus");
	assert.equal(focused.at(-1), view.webContents);
	assert.equal(controller.facts().explicitOpen, true);

	controller.close("test");
	assert.equal(
		focused.at(-1),
		page,
		"close hands the page to the gated focus helper",
	);
	assert.equal(controller.facts().visible, false);
});

test("controller: the two card channels are sender-pinned, seq-checked and route decisions once", async () => {
	const children = [];
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
	const window = { contentView, isDestroyed: () => false };
	const responded = [];
	const controller = new mod.ApprovalsOverlayController({
		window,
		documentUrl: "file:///tmp/browser-approvals-overlay.html",
		respond: (entryId, decision) => {
			responded.push([entryId, decision]);
			return { ok: true };
		},
	});
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 600, 500),
		revision: 1,
	});
	controller.setModel({ entries: entries(2) });
	await waitFor(
		() => controller.facts().ready && controller.facts().visible,
		"the auto-presented card",
	);
	const view = children.at(-1);
	const event = { sender: view.webContents, senderFrame: view.mainFrame };
	const seq = controller.facts().seq;
	const entryId = controller.facts().requestEntryId;
	assert.ok(entryId);

	// A forged sender, a stale seq and an unknown entry all drop without acting.
	mod.emitIpc(
		mod.APPROVALS_CARD_DISMISS_CHANNEL,
		{
			sender: {},
			senderFrame: null,
		},
		{ seq, entryId },
	);
	mod.emitIpc(mod.APPROVALS_CARD_DISMISS_CHANNEL, event, {
		seq: seq - 1,
		entryId,
	});
	mod.emitIpc("browser-approvals-card-decide", event, {
		seq,
		entryId: "not-live",
		decision: "once",
	});
	assert.equal(controller.facts().actions.dropped, 3);
	assert.equal(responded.length, 0);
	assert.equal(controller.facts().visible, true);

	// The live entry decides, through the one `respond` callback. The dropped
	// actions above repainted the card with a fresh seq, so the live action uses
	// the seq the document now carries (the same rule a real card follows).
	mod.emitIpc("browser-approvals-card-decide", event, {
		seq: controller.facts().seq,
		entryId,
		decision: "once",
	});
	assert.deepEqual(responded, [[entryId, "once"]]);
	assert.equal(controller.facts().actions.decided, 1);

	// Dismiss closes the card without deciding and drops the count.
	const nextSeq = controller.facts().seq;
	mod.emitIpc("browser-approvals-card-dismiss", event, {
		seq: nextSeq,
		entryId: controller.facts().requestEntryId,
	});
	assert.equal(controller.facts().actions.dismissed, 1);
	assert.equal(responded.length, 1, "dismiss never decides");
	controller.dispose("test");
});

test("controller: dispose detaches both card channels", () => {
	const controller = new mod.ApprovalsOverlayController({
		window: { contentView: { children: [] }, isDestroyed: () => false },
		documentUrl: "file:///tmp/browser-approvals-overlay.html",
	});
	mod.resetIpc();
	controller.dispose("test");
	assert.equal(mod.listenerCount("browser-approvals-card-dismiss"), 0);
	assert.equal(mod.listenerCount("browser-approvals-card-decide"), 0);
});

test("controller: auto-present is not an explicit open, and the latch clears on empty", async () => {
	const children = [];
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
	const controller = new mod.ApprovalsOverlayController({
		window: { contentView, isDestroyed: () => false },
		documentUrl: "file:///tmp/browser-approvals-overlay.html",
	});
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 900, 600),
		revision: 1,
	});
	controller.setModel({ entries: entries(1) });
	await waitFor(
		() => controller.facts().ready && controller.facts().visible,
		"auto-present",
	);
	// M1: the shield must not read an auto-presented card as "open" — the first
	// click would close it instead of opening/focusing.
	assert.equal(controller.state().open, false);
	assert.equal(controller.state().visible, true);
	controller.open({ focus: true });
	assert.equal(controller.state().open, true);
	controller.close("test");
	assert.equal(controller.state().open, false);
	controller.setModel({ entries: [] });
	assert.equal(controller.state().open, false);
	assert.equal(controller.state().visible, false);
	controller.dispose("test");
});

test("controller: an open with an empty queue arms nothing (M3)", async () => {
	const children = [];
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
	const focused = [];
	const controller = new mod.ApprovalsOverlayController({
		window: { contentView, isDestroyed: () => false },
		documentUrl: "file:///tmp/browser-approvals-overlay.html",
		focusTarget: (target) => focused.push(target),
	});
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 900, 600),
		revision: 1,
	});
	controller.setModel({ entries: [] });
	controller.open({ focus: true });
	assert.equal(controller.state().open, false, "an empty open arms nothing");
	controller.setModel({ entries: entries(1) });
	await waitFor(
		() => controller.facts().ready && controller.facts().visible,
		"arrival",
	);
	assert.equal(focused.length, 0, "the next arrival must not be focused");
	assert.equal(controller.state().open, false);
	controller.dispose("test");
});

test("controller: a fully dismissed queue is recallable from the shield (U3)", async () => {
	const children = [];
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
	let changed = 0;
	const controller = new mod.ApprovalsOverlayController({
		window: { contentView, isDestroyed: () => false },
		documentUrl: "file:///tmp/browser-approvals-overlay.html",
		onChanged: () => {
			changed += 1;
		},
	});
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 900, 600),
		revision: 1,
	});
	controller.setModel({ entries: entries(1) });
	await waitFor(
		() => controller.facts().ready && controller.facts().visible,
		"auto-present",
	);
	const view = children.at(-1);
	const event = { sender: view.webContents, senderFrame: view.mainFrame };
	mod.emitIpc("browser-approvals-card-dismiss", event, {
		seq: controller.facts().seq,
		entryId: controller.facts().requestEntryId,
	});
	await waitFor(() => !controller.facts().visible, "dismissed");
	assert.equal(controller.facts().pending, 1, "still pending and counted");
	// F1: the card's own dismissal must push the projection and clear the
	// explicit latch; otherwise the shield's first press is a stale no-op.
	assert.ok(changed > 0, "a card dismissal pushed the projection");
	assert.equal(controller.state().open, false);
	controller.open({ focus: true });
	await waitFor(() => controller.facts().visible, "recalled");
	assert.equal(controller.facts().visible, true);
	assert.equal(controller.state().open, true);
	controller.dispose("test");
});

test("controller: a selected pending entry may be decided, not only the oldest (D9)", async () => {
	const children = [];
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
	const responded = [];
	const controller = new mod.ApprovalsOverlayController({
		window: { contentView, isDestroyed: () => false },
		documentUrl: "file:///tmp/browser-approvals-overlay.html",
		respond: (entryId, decision) => responded.push([entryId, decision]),
	});
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 900, 600),
		revision: 1,
	});
	controller.setModel({ entries: entries(2) });
	await waitFor(
		() => controller.facts().ready && controller.facts().visible,
		"auto-present",
	);
	const view = children.at(-1);
	mod.emitIpc(
		"browser-approvals-card-decide",
		{
			sender: view.webContents,
			senderFrame: view.mainFrame,
		},
		{
			seq: controller.facts().seq,
			entryId: "entry-1",
			decision: "site",
		},
	);
	assert.deepEqual(responded, [["entry-1", "site"]]);
	controller.dispose("test");
});

test("controller: setContext re-pushes the locale and mirrors the view (U5)", async () => {
	const children = [];
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
	const controller = new mod.ApprovalsOverlayController({
		window: { contentView, isDestroyed: () => false },
		documentUrl: "file:///tmp/browser-approvals-overlay.html",
	});
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 900, 600),
		revision: 1,
	});
	controller.setModel({ entries: entries(1), locale: "en", dir: "ltr" });
	await waitFor(
		() => controller.facts().ready && controller.facts().visible,
		"auto-present",
	);
	const before = controller.facts().seq;
	controller.setContext({ locale: "fr", dir: "rtl" });
	await waitFor(
		() => controller.facts().bounds?.view?.x === 0,
		"the RTL layout pass",
	);
	assert.ok(controller.facts().seq > before, "the model was re-pushed");
	controller.dispose("test");
});

/** A controller over the stub window, auto-presented, with a recorded `onChanged`. */
async function presentedController(extra = {}) {
	const children = [];
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
	let changed = 0;
	const controller = new mod.ApprovalsOverlayController({
		window: { contentView, isDestroyed: () => false },
		documentUrl: "file:///tmp/browser-approvals-overlay.html",
		onChanged: () => {
			changed += 1;
		},
		...extra,
	});
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 900, 600),
		revision: 1,
	});
	controller.setModel({ entries: entries(1) });
	await waitFor(
		() => controller.facts().ready && controller.facts().visible,
		"the auto-presented card",
	);
	return { controller, children, changes: () => changed };
}

test("M1: a did-fail-load after construction latches the card off and pushes the projection", async () => {
	const { controller, children, changes } = await presentedController();
	assert.equal(controller.state().available, true);
	const view = children.at(-1);
	const before = changes();
	for (const cb of view.handlers.get("did-fail-load") ?? []) {
		cb({}, -6, "ERR_FILE_NOT_FOUND");
	}
	// `available: false` is what the renderer reads to mount the dock and band
	// again; the push is what makes it read it now rather than on the next
	// unrelated projection tick.
	assert.equal(controller.state().available, false);
	assert.equal(controller.state().visible, false);
	assert.ok(changes() > before, "the host is told the card is gone");
	assert.ok(controller.facts().failedReason.startsWith("load_failed:-6:"));
	assert.equal(children.includes(view), false, "the dead child is detached");
	assert.equal(mod.listenerCount(mod.APPROVALS_CARD_DECIDE_CHANNEL), 0);
});

test("M1: a render-process-gone child fails the card the same way", async () => {
	const { controller, children, changes } = await presentedController();
	const view = children.at(-1);
	const before = changes();
	for (const cb of view.handlers.get("render-process-gone") ?? []) {
		cb({}, { reason: "crashed" });
	}
	assert.equal(controller.state().available, false);
	assert.ok(changes() > before);
	assert.equal(controller.facts().failedReason, "render_process_gone:crashed");
});

test("D1: a stale-action error line is measured again, not only pushed", async () => {
	const { controller, children } = await presentedController();
	const view = children.at(-1);
	const reads = [];
	const original = view.webContents.executeJavaScript;
	view.webContents.executeJavaScript = (script) => {
		reads.push(script);
		return original(script);
	};
	// A decision for an entry that is not live drops with the stale line.
	mod.emitIpc(
		mod.APPROVALS_CARD_DISMISS_CHANNEL,
		{ sender: view.webContents, senderFrame: view.mainFrame },
		{
			seq: controller.facts().seq,
			entryId: "not-a-live-entry",
		},
	);
	const measured = reads.filter(
		(script) =>
			script.includes("getBoundingClientRect") &&
			script.includes("setModel") &&
			script.includes('"error":"stale"'),
	);
	assert.equal(
		measured.length,
		1,
		"the stale model is applied and the painted height read in the SAME script",
	);
	assert.ok(
		measured[0].includes("setTimeout(read, 0)"),
		"the read is a timer task after the apply, so the error line has painted",
	);
	controller.dispose("test");
});

test("D1: the unavailable error line is measured again as well", async () => {
	const { controller, children } = await presentedController({
		respond: () => {
			throw new Error("browser_unavailable");
		},
	});
	const view = children.at(-1);
	const reads = [];
	const original = view.webContents.executeJavaScript;
	view.webContents.executeJavaScript = (script) => {
		reads.push(script);
		return original(script);
	};
	const seq = controller.facts().seq;
	mod.emitIpc(
		mod.APPROVALS_CARD_DECIDE_CHANNEL,
		{ sender: view.webContents, senderFrame: view.mainFrame },
		{ seq, entryId: controller.facts().requestEntryId, decision: "once" },
	);
	assert.equal(
		reads.filter(
			(script) =>
				script.includes("getBoundingClientRect") &&
				script.includes('"error":"unavailable"'),
		).length,
		1,
	);
	controller.dispose("test");
});

test("D1: a height growth that the child's viewport did not follow rebuilds the child at the new bounds", async () => {
	const { controller, children } = await presentedController();
	const first = children.at(-1);
	// The document reports the OLD viewport after the view grew: what Electron
	// 44.3.0 did in the hidden-window probe (innerHeight 414 against 436).
	first.webContents.executeJavaScript = (script) =>
		script.includes("approvals-card")
			? Promise.resolve(260)
			: script === "window.innerHeight"
				? Promise.resolve(200)
				: Promise.resolve(0);
	controller.onLayout({
		presented: true,
		contentRect: rect(0, 0, 900, 600),
		revision: 2,
	});
	controller.setModel({ entries: entries(2) });
	await waitFor(
		() => children.at(-1) !== first && controller.facts().visible,
		"the rebuilt child",
		4000,
		() => controller.facts(),
	);
	assert.equal(first.destroyed, true, "the stale-viewport child is closed");
	assert.equal(
		controller.state().available,
		true,
		"a rebuild is not a failure",
	);
	controller.dispose("test");
});
