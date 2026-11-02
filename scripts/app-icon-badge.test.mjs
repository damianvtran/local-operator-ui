import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// CI runs Node 22 (packaging pins 22.13.1, which includes this API). These
// dependency-free modules need only type erasure: loading actual source avoids
// a stale build and does not require another/mismatched dependency tree.
// This is port/bitmap evidence only, never native Dock/taskbar output evidence.
async function loadSource(name) {
	const source = readFileSync(new URL(`../src/main/${name}.ts`, import.meta.url), "utf8");
	const javascript = stripTypeScriptTypes(source);
	return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}
const { createAppIconBadge } = await loadSource("app-icon-badge");
const { appIconBadgeBitmap } = await loadSource("app-icon-badge-bitmap");
const state = (unreadCount, pending = false) => ({ unreadCount, pending });
// Synthetic description proves the exact inputs reach the localization port.
const describe = ({ unreadCount, pending }) => JSON.stringify({ unreadCount, pending });

test("macOS caps, deduplicates, preserves read-pending and clears disabled/reset", () => {
	const writes = [];
	const badge = createAppIconBadge({ platform: "darwin", setDockBadge: (text) => writes.push(text), describe });
	for (const count of [0, 1, 9, 10, 99, 100, 101]) badge.update(state(count));
	assert.deepEqual(writes, ["", "1", "9", "10", "99", "99+"]);
	badge.update(state(1, true));
	badge.update(state(0, true)); // Reading is not answering an outstanding ask.
	badge.update(state(0, true));
	badge.update(state(0));
	assert.deepEqual(writes.slice(-3), ["1", "•", ""]);
	badge.update(state(7)); // Missing preference retains the shipped helpful default.
	badge.update(state(7), false);
	badge.update(state(7), true);
	badge.reset();
	assert.deepEqual(writes.slice(-4), ["7", "", "7", ""]);
});

test("Windows uses images/null, retains exact description and bounds visual cache", () => {
	const created = [];
	const writes = [];
	const badge = createAppIconBadge({
		platform: "win32", describe,
		createOverlayImage: (label) => { const image = { label }; created.push(image); return image; },
		setOverlayIcon: (image, description) => writes.push({ image, description }),
	});
	for (let count = 1; count <= 1000; count++) badge.update(state(count));
	assert.equal(created.length, 10);
	assert.equal(writes.at(-1).image.label, "9+");
	assert.equal(writes.at(-1).description, describe(state(1000)));
	badge.update(state(1000));
	assert.equal(writes.length, 1000);
	badge.update(state(1000, true));
	assert.equal(writes.at(-1).description, describe(state(1000, true)));
	badge.update(state(0, true));
	assert.equal(writes.at(-1).image.label, "•");
	assert.equal(created.length, 11);
	badge.update(state(0));
	assert.deepEqual(writes.at(-1), { image: null, description: "" });
	badge.update(state(2));
	badge.update(state(2), false);
	assert.equal(writes.at(-1).image, null);
	badge.reset();
	badge.update(state(2));
	assert.equal(created.length, 12, "identity reset discards cached image ownership");
});

test("Linux uses exact integers, reports capability and never fabricates pending=1", () => {
	const writes = [];
	let supported = true;
	const badge = createAppIconBadge({ platform: "linux", linuxDesktopIdentity: true, describe,
		setBadgeCount: (count) => { writes.push(count); return supported; },
	});
	assert.equal(badge.update(state(123456)), "applied");
	assert.equal(badge.update(state(0, true)), "pending-unsupported");
	assert.equal(badge.update(state(0)), "applied");
	assert.deepEqual(writes, [123456, 0]);
	supported = false;
	assert.equal(badge.update(state(2)), "unavailable");
	supported = true;
	assert.equal(badge.update(state(2)), "applied");
	assert.deepEqual(writes.slice(-2), [2, 2], "failed native write must be retried");
	badge.update(state(2), false);
	assert.equal(writes.at(-1), 0);
	const noIdentity = createAppIconBadge({ platform: "linux", linuxDesktopIdentity: false, describe,
		setBadgeCount: () => assert.fail("must not write under an unverified desktop identity"),
	});
	assert.equal(noIdentity.update(state(1)), "unavailable");
});

test("unavailable native ports/errors are honest, and error does not poison dedupe", () => {
	for (const platform of ["darwin", "win32", "linux", "unknown"]) {
		assert.equal(createAppIconBadge({ platform, describe }).update(state(1)), "unavailable");
	}
	let fail = true;
	let attempts = 0;
	const badge = createAppIconBadge({ platform: "darwin", describe,
		setDockBadge: () => { attempts++; if (fail) throw new Error("native unavailable"); },
	});
	assert.equal(badge.update(state(1)), "unavailable");
	fail = false;
	assert.equal(badge.update(state(1)), "applied");
	assert.equal(attempts, 2);
});

test("malformed count clears rather than inventing authority", () => {
	const writes = [];
	const badge = createAppIconBadge({ platform: "darwin", describe, setDockBadge: (text) => writes.push(text) });
	for (const count of [-1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		badge.update(state(8));
		badge.update(state(count, true));
		assert.equal(writes.at(-1), "");
	}
});

test("Windows bitmap is deterministic 16x16 BGRA with alpha and visible label differences", () => {
	const images = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "9+", "•"].map((label) => {
		const image = appIconBadgeBitmap(label);
		assert.equal(image.length, 16 * 16 * 4);
		assert.equal(image[3], 0, "corner outside the disc is transparent");
		assert.ok(image.some((value, i) => i % 4 === 3 && value === 255));
		assert.deepEqual(image, appIconBadgeBitmap(label));
		return image.toString("hex");
	});
	assert.equal(new Set(images).size, 11);
	assert.throws(() => appIconBadgeBitmap("10"), /Unsupported/);
});


test("replacement taskbar target invalidates only Windows without a clear flash", () => {
	for (const platform of ["darwin", "win32"]) {
		const writes = [];
		const badge = createAppIconBadge({ platform, describe,
			setDockBadge: (label) => writes.push(label),
			createOverlayImage: (label) => ({ label }),
			setOverlayIcon: (image) => writes.push(image?.label ?? ""),
		});
		badge.update(state(5));
		badge.invalidateOverlayTarget();
		badge.update(state(5));
		assert.deepEqual(writes, platform === "darwin" ? ["5"] : ["5", "5"]);
	}
});
