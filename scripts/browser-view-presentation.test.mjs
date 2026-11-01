import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents:
			'export * from "./src/main/browser/registry"; export * from "./src/main/browser/view-presentation";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { TabRegistry, setBrowserViewPresented } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function parentOf(...children) {
	const calls = [];
	return {
		children,
		calls,
		addChildView(view) {
			calls.push(["add", view]);
			children.push(view);
		},
		removeChildView(view) {
			calls.push(["remove", view]);
			const i = children.indexOf(view);
			if (i >= 0) children.splice(i, 1);
		},
	};
}

test("unpresented views leave the native parent, and repeated passes never reorder siblings", () => {
	const view = { id: 1 };
	const overlay = { id: 2 };
	const parent = parentOf(view, overlay);
	setBrowserViewPresented(parent, view, true);
	assert.deepEqual(
		parent.children,
		[view, overlay],
		"presentation does not re-add an attached page over its overlay",
	);
	assert.equal(parent.calls.length, 0);
	setBrowserViewPresented(parent, view, false);
	assert.deepEqual(
		parent.children,
		[overlay],
		"hidden page cannot remain a native sibling that navigation can focus",
	);
	setBrowserViewPresented(parent, view, false);
	assert.equal(parent.calls.length, 1);
	setBrowserViewPresented(parent, view, true);
	assert.equal(
		parent.children.at(-1),
		view,
		"explicit presentation reuses the same view",
	);
	assert.equal(parent.calls.length, 2);
});

test("the shipped window callback cannot interrupt multi-tab teardown after window destruction", async () => {
	// Execute the REAL index.ts binding, not a copied callback that could stay
	// green while the production closure still reads a destroyed native object.
	const source = readFileSync("src/main/browser/index.ts", "utf8");
	const registryStart = source.indexOf("const registry = new TabRegistry(");
	const start = source.indexOf("\t\t\t(view, presented) => {", registryStart);
	const end = source.indexOf("\n\t\t);", start);
	assert.ok(
		registryStart >= 0 && start > registryStart && end > start,
		"native presentation binding exists",
	);
	const callback = source.slice(start, end).trim();
	assert.equal(callback.at(-1), ",");
	const binding = await build({
		stdin: {
			contents: `export const bind=(options,setBrowserViewPresented)=>(${callback.slice(0, -1)});`,
			loader: "ts",
			resolveDir: process.cwd(),
		},
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
	});
	const { bind } = await import(
		`data:text/javascript;base64,${Buffer.from(binding.outputFiles[0].text).toString("base64")}`
	);
	const parent = parentOf();
	let destroyed = false;
	let next = 1;
	const released = [];
	const window = {
		isDestroyed: () => destroyed,
		get contentView() {
			if (destroyed) throw Error("Object has been destroyed");
			return parent;
		},
	};
	const registry = new TabRegistry(
		() => ({
			webContents: {
				id: next++,
				isDestroyed: () => false,
				getURL: () => "about:blank",
				getTitle: () => "",
				close() {},
			},
			setBounds() {},
			setVisible() {},
		}),
		(_id, wc) => released.push(wc),
		() => {},
		() => {},
		bind({ window }, setBrowserViewPresented),
	);
	registry.create({ owner: "user" });
	registry.create({ owner: "user" });
	registry.setContentRect({ x: 0, y: 0, width: 800, height: 600 });
	destroyed = true;
	assert.doesNotThrow(() => registry.destroyAll());
	assert.equal(registry.count(), 0);
	assert.equal(
		released.length,
		2,
		"every WebContents release survives a destroyed native window",
	);
});

test("real registry presentation controls parent membership across tabs, overlays and route exit", () => {
	const parent = parentOf();
	let next = 1;
	const registry = new TabRegistry(
		() => {
			const view = {
				webContents: {
					id: next++,
					isDestroyed: () => false,
					getURL: () => "about:blank",
					getTitle: () => "",
					close() {},
				},
				setBounds(bounds) {
					this.bounds = bounds;
				},
				setVisible(visible) {
					this.visible = visible;
				},
			};
			// Factory's required first-size/first-hide sequence is independent of the
			// registry's later layout callback; mimic the real sized then detached view.
			parent.addChildView(view);
			view.setBounds({ x: 0, y: 0, width: 1280, height: 720 });
			view.setVisible(false);
			setBrowserViewPresented(parent, view, false);
			return view;
		},
		(_id, wc) => {
			const view = parent.children.find((v) => v.webContents.id === wc);
			if (view) setBrowserViewPresented(parent, view, false);
		},
		() => {},
		() => {},
		(view, presented) => setBrowserViewPresented(parent, view, presented),
	);
	const user = registry.create({ owner: "user" });
	registry.setContentRect({ x: 10, y: 20, width: 800, height: 600 });
	assert.deepEqual(
		parent.children,
		[user.view],
		"visible active tab attaches through shipped registry callback",
	);
	const background = registry.create({
		owner: "agent",
		sessionId: "focus-test",
	});
	assert.deepEqual(
		parent.children,
		[user.view],
		"agent creation never adds a hidden native sibling",
	);
	registry.setViewVisible(false);
	assert.deepEqual(
		parent.children,
		[],
		"an application overlay parks every page",
	);
	registry.setViewVisible(true);
	assert.deepEqual(parent.children, [user.view]);
	registry.activate(background.tabId);
	assert.deepEqual(parent.children, [background.view]);
	registry.setContentRect(null);
	assert.deepEqual(
		parent.children,
		[],
		"route exit detaches the active tab too",
	);
	assert.deepEqual(background.view.bounds, {
		x: 0,
		y: 0,
		width: 1280,
		height: 720,
	});
	registry.setContentRect({ x: 0, y: 0, width: 900, height: 700 });
	assert.deepEqual(
		parent.children,
		[background.view],
		"returning to browser reuses same view/WebContents",
	);
	registry.destroyAll();
	assert.deepEqual(parent.children, []);
});
