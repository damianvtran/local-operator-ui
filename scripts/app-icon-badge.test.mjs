import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import {
	missingScenePrerequisites,
	mutationPython,
} from "./app-icon-badge-scene.mjs";

// CI runs Node 22 (packaging pins 22.13.1, which includes this API). These
// dependency-free modules need only type erasure: loading actual source avoids
// a stale build and does not require another/mismatched dependency tree.
// This is port/bitmap evidence only, never native Dock/taskbar output evidence.
async function loadSource(name) {
	const source = readFileSync(
		new URL(`../src/main/${name}.ts`, import.meta.url),
		"utf8",
	);
	const javascript = stripTypeScriptTypes(source);
	return import(
		`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
	);
}
const { createAppIconBadge } = await loadSource("app-icon-badge");
const { appIconBadgeBitmap } = await loadSource("app-icon-badge-bitmap");
const state = (unreadCount, pending = false) => ({ unreadCount, pending });
// Synthetic description proves the exact inputs reach the localization port.
const describe = ({ unreadCount, pending }) =>
	JSON.stringify({ unreadCount, pending });

test("macOS caps, deduplicates, preserves read-pending and clears disabled/reset", () => {
	const writes = [];
	const badge = createAppIconBadge({
		platform: "darwin",
		setDockBadge: (text) => writes.push(text),
		describe,
	});
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

test("scene readback retains exact localized projection and cannot mutate it", () => {
	const writes = [];
	const badge = createAppIconBadge({
		platform: "darwin",
		setDockBadge: (label) => writes.push(label),
		describe,
	});
	badge.update(state(100));
	const view = badge.readForScene();
	assert.deepEqual(view, {
		unreadCount: 100,
		pending: false,
		lastDescription: describe(state(100)),
		lastResult: "applied",
	});
	view.unreadCount = 7;
	assert.equal(badge.readForScene().unreadCount, 100);
	assert.deepEqual(writes, ["99+"]);
	badge.update(state(0, true));
	assert.equal(badge.readForScene().lastDescription, describe(state(0, true)));
	badge.update(state(0, true), false);
	assert.equal(badge.readForScene().lastDescription, "");
	assert.equal(badge.readForScene().pending, false);
});

test("native CI scene refuses other hosts before resolving Electron", () => {
	const env = {
		CI: "true",
		GITHUB_ACTIONS: "true",
		RUNNER_ENVIRONMENT: "github-hosted",
		RUNNER_TEMP: "/synthetic",
		LOCAL_OPERATOR_CORE_BIN: "/synthetic/core",
		LOCAL_OPERATOR_CORE_PYTHON: "/synthetic/python",
		LOCAL_OPERATOR_CORE_REF: "a".repeat(40),
	};
	assert.deepEqual(missingScenePrerequisites(env, "darwin"), []);
	assert.ok(missingScenePrerequisites({}, "darwin").length > 0);
	assert.ok(
		missingScenePrerequisites(
			{ ...env, RUNNER_ENVIRONMENT: "self-hosted" },
			"darwin",
		).length > 0,
	);
	assert.ok(missingScenePrerequisites(env, "linux").length > 0);
	const source = mutationPython({
		config: "/synthetic/config",
		action: "read_ask",
	});
	assert.match(source, /store\.mark_refs/);
	assert.match(source, /A\.create_request/);
	assert.match(source, /A\.deny/);
	assert.doesNotMatch(source, /sqlite3|UPDATE |INSERT INTO|A\.approve/);
});

test("actual main scene predicate excludes packaged apps and shown windows", () => {
	const main = readFileSync(
		new URL("../src/main/index.ts", import.meta.url),
		"utf8",
	);
	const start = main.indexOf(
		"process.env.LOCAL_OPERATOR_UI_APP_ICON_BADGE_SCENE",
	);
	assert.ok(start >= 0);
	const condition = main.slice(start, main.indexOf(") {", start)).trim();
	// Execute only the production guard expression with synthetic ports, never
	// Electron or the application body. This catches a missing packaging gate.
	const gate = new Function(
		"process",
		"app",
		"windowLaunch",
		`return (${condition});`,
	);
	const process = {
		platform: "darwin",
		env: {
			LOCAL_OPERATOR_UI_APP_ICON_BADGE_SCENE: "1",
			CI: "true",
			GITHUB_ACTIONS: "true",
			RUNNER_ENVIRONMENT: "github-hosted",
		},
	};
	assert.equal(gate(process, { isPackaged: false }, { show: "never" }), true);
	assert.equal(gate(process, { isPackaged: true }, { show: "never" }), false);
	assert.equal(gate(process, { isPackaged: false }, { show: "normal" }), false);
});

test("description failure cannot suppress macOS or Linux native badge writes", () => {
	for (const platform of ["darwin", "linux"]) {
		const writes = [];
		const badge = createAppIconBadge({
			platform,
			linuxDesktopIdentity: true,
			setDockBadge: (label) => writes.push(label),
			setBadgeCount: (count) => {
				writes.push(count);
				return true;
			},
			describe: () => {
				throw new Error("synthetic localization failure");
			},
		});
		assert.equal(badge.update(state(12)), "applied");
		assert.deepEqual(writes, [platform === "darwin" ? "12" : 12]);
		assert.equal(badge.readForScene().lastDescription, "");
		badge.reset();
		assert.equal(writes.at(-1), platform === "darwin" ? "" : 0);
	}
});

test("Windows uses images/null, retains exact description and bounds visual cache", () => {
	const created = [];
	const writes = [];
	const badge = createAppIconBadge({
		platform: "win32",
		describe,
		createOverlayImage: (label) => {
			const image = { label };
			created.push(image);
			return image;
		},
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
	assert.equal(
		created.length,
		12,
		"identity reset discards cached image ownership",
	);
});

test("Linux uses exact integers, reports capability and never fabricates pending=1", () => {
	const writes = [];
	let supported = true;
	const badge = createAppIconBadge({
		platform: "linux",
		linuxDesktopIdentity: true,
		describe,
		setBadgeCount: (count) => {
			writes.push(count);
			return supported;
		},
	});
	assert.equal(badge.update(state(123456)), "applied");
	assert.equal(badge.update(state(0, true)), "pending-unsupported");
	assert.equal(badge.update(state(0)), "applied");
	assert.deepEqual(writes, [123456, 0]);
	supported = false;
	assert.equal(badge.update(state(2)), "unavailable");
	supported = true;
	assert.equal(badge.update(state(2)), "applied");
	assert.deepEqual(
		writes.slice(-2),
		[2, 2],
		"failed native write must be retried",
	);
	badge.update(state(2), false);
	assert.equal(writes.at(-1), 0);
	const noIdentity = createAppIconBadge({
		platform: "linux",
		linuxDesktopIdentity: false,
		describe,
		setBadgeCount: () =>
			assert.fail("must not write under an unverified desktop identity"),
	});
	assert.equal(noIdentity.update(state(1)), "unavailable");
});

test("unavailable native ports/errors are honest, and error does not poison dedupe", () => {
	for (const platform of ["darwin", "win32", "linux", "unknown"]) {
		assert.equal(
			createAppIconBadge({ platform, describe }).update(state(1)),
			"unavailable",
		);
	}
	let fail = true;
	let attempts = 0;
	const badge = createAppIconBadge({
		platform: "darwin",
		describe,
		setDockBadge: () => {
			attempts++;
			if (fail) throw new Error("native unavailable");
		},
	});
	assert.equal(badge.update(state(1)), "unavailable");
	fail = false;
	assert.equal(badge.update(state(1)), "applied");
	assert.equal(attempts, 2);
});

test("malformed count clears rather than inventing authority", () => {
	const writes = [];
	const badge = createAppIconBadge({
		platform: "darwin",
		describe,
		setDockBadge: (text) => writes.push(text),
	});
	for (const count of [
		-1,
		1.2,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		badge.update(state(8));
		badge.update(state(count, true));
		assert.equal(writes.at(-1), "");
	}
});

test("every Windows label has zero four-adjacent ink/rim contacts", () => {
	for (const label of [..."123456789", "9+", "•"]) {
		const bitmap = appIconBadgeBitmap(label);
		let contacts = 0;
		for (let y = 0; y < 16; y++) {
			for (let x = 0; x < 16; x++) {
				const distance = (x - 7.5) ** 2 + (y - 7.5) ** 2;
				if (distance > 42.25 || bitmap[(y * 16 + x) * 4] !== 255) continue;
				for (const [dx, dy] of [
					[-1, 0],
					[1, 0],
					[0, -1],
					[0, 1],
				]) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx > 15 || ny < 0 || ny > 15) continue;
					const neighborDistance = (nx - 7.5) ** 2 + (ny - 7.5) ** 2;
					if (
						neighborDistance > 42.25 &&
						bitmap[(ny * 16 + nx) * 4 + 3] === 255
					)
						contacts++;
				}
			}
		}
		assert.equal(
			contacts,
			0,
			`${label}: glyph must remain separated from the white rim`,
		);
	}
});

test("Windows pending indicator is a rounded 6px dot, not a square", () => {
	const bitmap = appIconBadgeBitmap("•");
	const ink = [];
	for (let y = 0; y < 16; y++) {
		for (let x = 0; x < 16; x++) {
			if (
				(x - 7.5) ** 2 + (y - 7.5) ** 2 <= 42.25 &&
				bitmap[(y * 16 + x) * 4] === 255
			)
				ink.push([x, y]);
		}
	}
	assert.equal(ink.length, 32);
	assert.equal(Math.min(...ink.map(([x]) => x)), 5);
	assert.equal(Math.max(...ink.map(([x]) => x)), 10);
	assert.equal(Math.min(...ink.map(([, y]) => y)), 5);
	assert.equal(Math.max(...ink.map(([, y]) => y)), 10);
	for (const [x, y] of [
		[5, 5],
		[5, 10],
		[10, 5],
		[10, 10],
	])
		assert.equal(bitmap[(y * 16 + x) * 4], 0, "rounded corners stay black");
});

test("Windows bitmap is deterministic 16x16 BGRA with alpha and visible label differences", () => {
	const images = [..."123456789", "9+", "•"].map((label) => {
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
		const badge = createAppIconBadge({
			platform,
			describe,
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
