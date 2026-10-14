import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// This is a DOM lifecycle contract, not native pixel/performance evidence.
// Rects deliberately model the same chronological column in a reversed parent.
const SHARED_REACT_RE = /^react(?:-dom)?(?:\/.*)?$/;
const dom = new JSDOM("<!doctype html><body></body>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
for (const name of [
	"window",
	"document",
	"HTMLElement",
	"Element",
	"Event",
	"MutationObserver",
])
	globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
	observe() {}
	disconnect() {}
};
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(
	join(
		process.env.LOCAL_OPERATOR_SCRATCHPAD ?? process.cwd(),
		"dom-window-contract-",
	),
);
after(async () => {
	dom.window.close();
	await rm(scratch, { recursive: true });
});
const result = await build({
	stdin: {
		contents: `
import React, { useRef } from 'react';
import { useTranscriptDomWindow } from './src/renderer/src/features/chat/canonical/use-transcript-dom-window';
export { createScrollLayoutCoordinator } from './src/renderer/src/features/chat/canonical/transcript-scroll-layout';
export function Harness({ entries, layout, requested, report }) {
 const region = useRef(null), area = useRef(null);
 const window = useTranscriptDomWindow({entries,layout,requested,regionRef:region,entriesRef:area,sessionKey:'synthetic'});
 report(window);
 return React.createElement('div',{ref:region,'data-region':true},React.createElement('div',{ref:area,'data-area':true},window.pieces.map(piece=>piece.kind==='entry' ? React.createElement('div',{key:entries[piece.index].key,'data-lo-entry-key':entries[piece.index].key,'data-record-id':entries[piece.index].recordIds[0]}) : React.createElement('div',{key:'spacer:'+piece.start,'data-spacer':true,style:{height:piece.height}}))));
}`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	write: false,
	platform: "node",
	format: "esm",
	plugins: [
		{
			name: "shared-react",
			setup(builder) {
				builder.onResolve({ filter: SHARED_REACT_RE }, (args) => ({
					path: require.resolve(args.path),
					external: true,
				}));
			},
		},
	],
});
const bundle = join(scratch, "harness.mjs");
await writeFile(bundle, result.outputFiles[0].text);
const { Harness, createScrollLayoutCoordinator } = await import(
	pathToFileURL(bundle).href
);
const entries = Array.from({ length: 60 }, (_, index) => ({
	key: `e${index}`,
	recordIds: [`r${index}`],
	signature: "1",
	estimate: 20,
}));
let reads = 0;
Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
	get: () => 100,
});
Object.defineProperty(dom.window.HTMLElement.prototype, "scrollHeight", {
	get: () => 1200,
});
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
	reads += 1;
	const region = document.querySelector("[data-region]");
	const areaTop = 100 - 1200 - (region?.scrollTop ?? 0);
	const index = this.dataset.loEntryKey
		? Number(this.dataset.loEntryKey.slice(1))
		: null;
	const top = this.hasAttribute("data-area")
		? areaTop
		: index !== null
			? areaTop + index * 20
			: 0;
	const height =
		index !== null ? 20 : this.hasAttribute("data-area") ? 1200 : 100;
	return {
		top,
		bottom: top + height,
		left: 0,
		right: 600,
		width: 600,
		height,
		x: 0,
		y: top,
	};
};
async function mounted(
	requested,
	chosenLayout = null,
	chosenEntries = entries,
) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let current;
	const layout = chosenLayout ?? {
		begin() {},
		commit() {
			return true;
		},
		heldId() {
			return "r40";
		},
		cancel() {},
		retainNavigation() {
			return () => {};
		},
	};
	await act(async () =>
		root.render(
			React.createElement(Harness, {
				entries: chosenEntries,
				requested,
				layout,
				report: (value) => {
					current = value;
				},
			}),
		),
	);
	return {
		host,
		root,
		get: () => current,
		close: async () => {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

test("flag off mounts all entries without window measurement or coordinator transactions", async () => {
	reads = 0;
	const calls = [];
	const offEntries = entries.map((entry) =>
		entry.key === "e40"
			? { ...entry, collapsed: true, recordIds: ["parent", "r40"] }
			: entry,
	);
	const view = await mounted(
		false,
		{
			begin: () => calls.push("begin"),
			commit: () => {
				calls.push("commit");
				document.querySelector("[data-region]").scrollTop = 5;
				calls.push("write");
				return true;
			},
			heldId: () => "r40",
			retarget: () => calls.push("retarget"),
			cancel() {},
		},
		offEntries,
	);
	try {
		assert.equal(view.host.querySelectorAll("[data-lo-entry-key]").length, 60);
		assert.equal(reads, 0);
		assert.equal(view.get().enabled, false);
		assert.deepEqual(calls, []);
		assert.equal(view.host.querySelector("[data-region]").scrollTop, 0);
	} finally {
		await view.close();
	}
});

test("a successful later commit recovers a transient missing-held-node fallback", async () => {
	let healthy = false;
	const layout = {
		begin() {},
		commit: () => healthy,
		heldId: () => null,
		cancel() {},
	};
	const view = await mounted(true, layout);
	try {
		assert.equal(view.get().reason, "missing-held-node");
		healthy = true;
		await act(async () =>
			view.root.render(
				React.createElement(Harness, {
					entries: [...entries],
					requested: true,
					layout,
					report: () => {},
				}),
			),
		);
		assert.equal(
			view.host.querySelectorAll("[data-lo-entry-key]").length < 60,
			true,
		);
	} finally {
		await view.close();
	}
});

test("late font loadingdone preserves omitted prefix extents while remeasuring mounted entries", async () => {
	const fonts = new dom.window.EventTarget();
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: fonts,
	});
	const view = await mounted(
		true,
		null,
		entries.map((entry) => ({ ...entry, estimate: 13 })),
	);
	try {
		assert.equal(view.get().enabled, true);
		assert.equal(view.host.querySelector('[data-lo-entry-key="e0"]'), null);
		const before = [...view.get().prefix];
		assert.equal(before[1], 20);
		await act(async () =>
			fonts.dispatchEvent(new dom.window.Event("loadingdone")),
		);
		assert.deepEqual(
			view.get().prefix,
			before,
			"font exactness invalidation must not cold-estimate unmounted history",
		);
		assert.equal(view.get().reason, "windowed");
	} finally {
		await view.close();
		Reflect.deleteProperty(document, "fonts");
	}
});

test("a newly captured non-pager transaction anchor is included before DOM projection", async () => {
	const sample = { id: "r0", viewportOffset: 0, extent: 1200 };
	const layout = createScrollLayoutCoordinator({
		held: () => null,
		sample: () => sample,
		measure: () =>
			document.querySelector('[data-record-id="r0"]') ? sample : null,
		inputRevision: () => 1,
		following: () => false,
		write() {},
	});
	const view = await mounted(true, layout);
	try {
		assert.equal(
			view.get().enabled,
			true,
			"a lost lease fallback is not a virtualization pass",
		);
		assert.ok(view.host.querySelector('[data-record-id="r0"]'));
		assert.ok(view.host.querySelectorAll("[data-lo-entry-key]").length < 20);
	} finally {
		await view.close();
	}
});

test("viewport plus held/navigation leases stay disjoint; model-held target mounts locally", async () => {
	const view = await mounted(true);
	try {
		assert.equal(view.get().enabled, true);
		assert.ok(view.host.querySelectorAll("[data-lo-entry-key]").length < 20);
		assert.ok(
			view.host.querySelector('[data-record-id="r40"]'),
			"held paging node must never be removed",
		);
		assert.equal(view.host.querySelector('[data-record-id="r0"]'), null);
		let release;
		await act(async () => {
			release = view.get().acquire("r0");
		});
		assert.ok(
			view.host.querySelector('[data-record-id="r0"]'),
			"navigation mount must precede DOM reachability/history decisions",
		);
		assert.ok(
			view.host.querySelectorAll("[data-lo-entry-key]").length < 20,
			"distant lease must not mount its whole intervening history",
		);
		await act(async () => release());
		assert.equal(view.host.querySelector('[data-record-id="r0"]'), null);
	} finally {
		await view.close();
	}
});

test("one incompatible code/media/open entry leases an island rather than disabling the viewport", async () => {
	const view = await mounted(
		true,
		null,
		entries.map((entry, index) => ({ ...entry, unsafe: index < 2 })),
	);
	try {
		assert.equal(view.get().reason, "windowed");
		assert.ok(view.host.querySelector('[data-lo-entry-key="e0"]'));
		assert.ok(view.host.querySelector('[data-lo-entry-key="e1"]'));
		assert.ok(view.host.querySelectorAll("[data-lo-entry-key]").length < 20);
	} finally {
		await view.close();
	}
});

test("a majority of unmigrated state degrades explicitly instead of promising a bounded DOM", async () => {
	const view = await mounted(
		true,
		null,
		entries.map((entry, index) => ({ ...entry, unsafe: index < 40 })),
	);
	try {
		assert.equal(view.get().enabled, false);
		assert.equal(view.get().reason, "pinned-state-density");
		assert.equal(view.host.querySelectorAll("[data-lo-entry-key]").length, 60);
	} finally {
		await view.close();
	}
});
