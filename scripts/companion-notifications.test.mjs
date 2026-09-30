import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><body></body>", {
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const motion = new dom.window.EventTarget();
motion.matches = false;
window.matchMedia = () => motion;
let now = 0;
let timerId = 0;
const timers = new Map();
window.performance.now = () => now;
window.setTimeout = (callback, delay) => {
	timers.set(++timerId, { callback, due: now + delay });
	return timerId;
};
window.clearTimeout = (id) => timers.delete(id);
const advance = async (ms) =>
	act(async () => {
		const end = now + ms;
		while (true) {
			const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
			if (!next || next[1].due > end) break;
			now = next[1].due;
			timers.delete(next[0]);
			next[1].callback();
		}
		now = end;
	});
const { createRoot } = await import("react-dom/client");
const bundle = await build({
	entryPoints: ["src/renderer/src/companion-notifications.ts"],
	bundle: true,
	packages: "external",
	platform: "node",
	format: "esm",
	write: false,
});
const path = new URL(
	`./_companion-notifications-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(path, bundle.outputFiles[0].text);
const { useCompanionNotifications } = await import(path.href);
await unlink(path);
after(() => {
	dom.window.close();
	for (const key of ["window", "document", "IS_REACT_ACT_ENVIRONMENT"])
		delete globalThis[key];
});

const notice = (key, kind = "approval") => ({
	key,
	kind,
	sessionId: key,
	title: "Private task title",
	label: "Needs you",
});

async function fixture(callback, reduced = false) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let notifications = [];
	let engaged = false;
	let available = true;
	let attention;
	let mounted = true;
	motion.matches = reduced;
	function Probe() {
		attention = useCompanionNotifications(notifications, engaged, available);
		return null;
	}
	const render = () => act(async () => root.render(React.createElement(Probe)));
	const call = (callback) => act(async () => callback());
	await render();
	try {
		await callback({
			get attention() {
				return attention;
			},
			update: async (next) => {
				notifications = next;
				await render();
			},
			engage: async (next) => {
				engaged = next;
				await render();
			},
			available: async (next) => {
				available = next;
				await render();
			},
			acknowledge: () => call(() => attention.acknowledge()),
			reduceMotion: (matches) =>
				call(() => {
					motion.matches = matches;
					motion.dispatchEvent(new dom.window.Event("change"));
				}),
			hidden: (hidden) =>
				call(() => {
					Object.defineProperty(document, "hidden", {
						configurable: true,
						value: hidden,
					});
					document.dispatchEvent(new dom.window.Event("visibilitychange"));
				}),
			unmount: async () => {
				await act(async () => root.unmount());
				mounted = false;
			},
		});
	} finally {
		if (mounted) await act(async () => root.unmount());
		assert.equal(timers.size, 0);
		motion.matches = false;
		Reflect.deleteProperty(document, "hidden");
		host.remove();
	}
}

test("requests nudge briefly and get only one silent follow-up", async () => {
	await fixture(async (f) => {
		await f.update([notice("one")]);
		assert.equal(f.attention.nudging, true);
		assert.equal(f.attention.announcement, "1 new task notification.");
		await advance(1399);
		assert.equal(f.attention.nudging, true);
		await advance(1);
		assert.equal(f.attention.nudging, false);
		assert.equal(f.attention.announcement, "");
		await advance(88_600);
		assert.equal(f.attention.nudging, true);
		assert.equal(f.attention.announcement, "");
		await advance(1400);
		assert.equal(f.attention.nudging, false);
		await advance(300_000);
		assert.equal(timers.size, 0);
	});
});

test("polling, title changes, and reconnects cannot repeat handled notices", async () => {
	await fixture(async (f) => {
		const first = notice("one");
		const second = notice("two", "answer");
		await f.update([first, second]);
		assert.equal(f.attention.announcement, "2 new task notifications.");
		await advance(1000);
		await f.update([{ ...second, title: "Renamed" }, first]);
		await advance(400);
		assert.equal(f.attention.nudging, false);
		await f.available(false);
		await f.update([]);
		assert.equal(timers.size, 0);
		await advance(100_000);
		await f.update([first, second]);
		await f.available(true);
		assert.equal(f.attention.nudging, false);
		assert.equal(f.attention.announcement, "");
		assert.equal(timers.size, 0);
	});
});

test("arrivals coalesce with at least twenty seconds between attention cues", async () => {
	await fixture(async (f) => {
		await f.update([notice("one")]);
		await advance(1400);
		await f.update([notice("one"), notice("two", "error")]);
		await advance(10_000);
		await f.update([
			notice("one"),
			notice("two", "error"),
			notice("three", "interrupted"),
		]);
		await advance(8599);
		assert.equal(f.attention.nudging, false);
		await advance(1);
		assert.equal(f.attention.nudging, true);
		assert.equal(f.attention.announcement, "2 new task notifications.");
	});
});

test("typing, playing, and hidden windows defer cues without running timers", async () => {
	await fixture(async (f) => {
		await f.engage(true);
		await f.update([notice("one")]);
		assert.equal(f.attention.nudging, false);
		assert.equal(timers.size, 0);
		await advance(120_000);
		await f.hidden(true);
		await f.engage(false);
		assert.equal(timers.size, 0);
		await f.hidden(false);
		assert.equal(f.attention.nudging, true);
		await f.hidden(true);
		assert.equal(f.attention.nudging, false);
		assert.equal(f.attention.announcement, "");
		assert.equal(timers.size, 0);
		await f.hidden(false);
		assert.equal(f.attention.nudging, false);
	});
});

test("opening notices quiets current keys but permits a later new request", async () => {
	await fixture(async (f) => {
		await f.update([notice("one")]);
		await f.acknowledge();
		assert.equal(f.attention.nudging, false);
		assert.equal(timers.size, 0);
		await advance(100_000);
		await f.update([notice("one")]);
		assert.equal(f.attention.announcement, "");
		await f.update([notice("one"), notice("new-request")]);
		assert.equal(f.attention.nudging, true);
		assert.equal(f.attention.announcement, "1 new task notification.");
	});
});

test("a resolved legacy request may ask again while completed receipts stay quiet", async () => {
	await fixture(async (f) => {
		const question = notice("same-session");
		const completed = notice("receipt", "complete");
		await f.update([question, completed]);
		await f.update([]);
		await advance(20_000);
		await f.update([question, completed]);
		assert.equal(f.attention.nudging, true);
		assert.equal(f.attention.announcement, "1 new task notification.");
	});
});

test("completed work and reduced motion remain static without reminder speech", async () => {
	await fixture(async (f) => {
		await f.update([notice("done", "complete")]);
		assert.equal(f.attention.nudging, false);
		assert.equal(f.attention.announcement, "");
		assert.equal(timers.size, 0);
		await f.update([notice("request", "wedged")]);
		assert.equal(f.attention.nudging, true);
		await f.update([notice("done", "complete")]);
		assert.equal(f.attention.nudging, false);
		assert.equal(timers.size, 0);
		await advance(20_000);
		await f.update([notice("request", "wedged")]);
		assert.equal(f.attention.nudging, true);
		await f.reduceMotion(true);
		assert.equal(f.attention.nudging, false);
		await advance(100_000);
		assert.equal(timers.size, 0);
		await f.reduceMotion(false);
		assert.equal(f.attention.nudging, false);
	});
	await fixture(async (f) => {
		await f.update([notice("one")]);
		assert.equal(f.attention.nudging, false);
		assert.equal(f.attention.announcement, "1 new task notification.");
		await advance(100_000);
		assert.equal(f.attention.announcement, "");
		assert.equal(timers.size, 0);
	}, true);
});

test("large active catalogues stay deduplicated and retain recent handled keys", async () => {
	await fixture(async (f) => {
		const notices = Array.from({ length: 180 }, (_, i) => notice(String(i)));
		await f.update(notices);
		await f.acknowledge();
		await advance(100_000);
		await f.update([...notices].reverse());
		assert.equal(f.attention.nudging, false);
		assert.equal(f.attention.announcement, "");
		await f.available(false);
		await f.update([]);
		await f.update([notices.at(-1)]);
		await f.available(true);
		assert.equal(f.attention.nudging, false);
		assert.equal(timers.size, 0);
	});
});

test("resolved notices and unmount remove every pending cue", async () => {
	await fixture(async (f) => {
		await f.update([notice("one")]);
		await f.update([]);
		assert.equal(f.attention.nudging, false);
		assert.equal(timers.size, 0);
		await f.update([notice("two")]);
		assert.equal(timers.size, 1);
		await f.unmount();
		assert.equal(timers.size, 0);
		await advance(100_000);
	});
});
