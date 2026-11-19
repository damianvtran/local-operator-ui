/*
 * Pins the Storybook cache prune policy (scripts/storybook-cache-prune.mjs) against
 * scratch fixtures: nothing here touches a real cache, and `rm` is only ever pointed at
 * paths inside a tmpdir this file made.
 */
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
	pruneOptionsFromEnv,
	pruneStorybookCache,
	refusalFor,
} from "./storybook-cache-prune.mjs";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const scratch = mkdtempSync(join(tmpdir(), "sb-prune-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
/** A fresh `<scratch>/n/.cache/storybook` root, the shape Storybook resolves to. */
function makeRoot() {
	counter += 1;
	const root = join(scratch, String(counter), ".cache", "storybook");
	mkdirSync(root, { recursive: true });
	return root;
}
const key = (n) => n.toString(16).padStart(64, "0");
/** An entry aged `hoursOld`; the age is set on every node the prune may read. */
function entry(root, name, hoursOld) {
	const dir = join(root, name);
	mkdirSync(join(dir, "sb-vite", "deps"), { recursive: true });
	writeFileSync(join(dir, "public.txt"), "x".repeat(100));
	const when = new Date(NOW - hoursOld * HOUR);
	for (const path of [
		join(dir, "public.txt"),
		join(dir, "sb-vite", "deps"),
		join(dir, "sb-vite"),
		dir,
	]) {
		utimesSync(path, when, when);
	}
	return dir;
}
const names = (root) => readdirSync(root).sort();

describe("age cut-off", () => {
	test("removes entries older than 48 h, keeps younger ones", () => {
		const root = makeRoot();
		entry(root, key(1), 49);
		entry(root, key(2), 47);
		const result = pruneStorybookCache({ root, now: NOW, env: {} });
		assert.deepEqual(result.removed, [key(1)]);
		assert.deepEqual(result.kept, [key(2)]);
		assert.deepEqual(names(root), [key(2)]);
		assert.ok(result.bytesEstimate >= 100);
	});

	test("age is the NEWEST mtime inside the entry, so a live deps dir keeps it", () => {
		const root = makeRoot();
		const dir = entry(root, key(1), 100);
		const recent = new Date(NOW - HOUR);
		utimesSync(join(dir, "sb-vite", "deps"), recent, recent);
		const result = pruneStorybookCache({ root, now: NOW, env: {} });
		assert.deepEqual(result.removed, []);
		assert.ok(existsSync(dir));
	});

	test("protectKey is never removed, however old", () => {
		const root = makeRoot();
		entry(root, key(1), 500);
		entry(root, key(2), 500);
		const result = pruneStorybookCache({
			root,
			now: NOW,
			protectKey: key(1),
			env: {},
		});
		assert.deepEqual(result.removed, [key(2)]);
		assert.deepEqual(names(root), [key(1)]);
	});

	test("the current run's entry is stamped fresh, but not on a dry run", () => {
		const root = makeRoot();
		const dir = entry(root, key(1), 500);
		pruneStorybookCache({
			root,
			now: NOW,
			protectKey: key(1),
			dryRun: true,
			env: {},
		});
		assert.equal(statSync(dir).mtimeMs, NOW - 500 * HOUR);
		pruneStorybookCache({ root, now: NOW, protectKey: key(1), env: {} });
		assert.equal(statSync(dir).mtimeMs, NOW);
	});
});

describe("entry cap", () => {
	test("trims oldest-first down to the cap", () => {
		const root = makeRoot();
		for (let i = 1; i <= 6; i += 1) entry(root, key(i), 10 + i); // 11..16 h old
		const result = pruneStorybookCache({
			root,
			now: NOW,
			maxEntries: 4,
			env: {},
		});
		assert.deepEqual(result.removed.sort(), [key(5), key(6)]);
		assert.equal(names(root).length, 4);
	});

	test("never removes an entry touched within the keep window, even over the cap", () => {
		const root = makeRoot();
		for (let i = 1; i <= 5; i += 1) entry(root, key(i), i); // 1..5 h old: all < 6 h
		const result = pruneStorybookCache({
			root,
			now: NOW,
			maxEntries: 2,
			env: {},
		});
		assert.deepEqual(result.removed, []);
		assert.equal(names(root).length, 5);
	});

	test("spares the fresh ones and trims only the old ones that exceed the cap", () => {
		const root = makeRoot();
		entry(root, key(1), 1);
		entry(root, key(2), 2);
		entry(root, key(3), 8);
		entry(root, key(4), 9);
		const result = pruneStorybookCache({
			root,
			now: NOW,
			maxEntries: 1,
			env: {},
		});
		assert.deepEqual(result.removed.sort(), [key(3), key(4)]);
		assert.deepEqual(names(root), [key(1), key(2)]);
	});
});

describe("what it will not touch", () => {
	test("non-hex names, files and symlinks are left alone", () => {
		const root = makeRoot();
		entry(root, key(1), 100);
		entry(root, "default", 100); // Storybook's own sibling dir, not a cache key
		entry(root, key(10).toUpperCase(), 100); // not lowercase hex
		entry(root, `${key(3)}0`, 100); // 65 chars
		writeFileSync(join(root, key(4)), "a file named like a key");
		const outside = join(scratch, "symlink-target");
		mkdirSync(outside);
		writeFileSync(join(outside, "precious"), "keep");
		symlinkSync(outside, join(root, key(5)));
		const result = pruneStorybookCache({ root, now: NOW, env: {} });
		assert.deepEqual(result.removed, [key(1)]);
		assert.ok(existsSync(join(outside, "precious")));
		assert.deepEqual(
			names(root),
			[key(10).toUpperCase(), `${key(3)}0`, key(4), key(5), "default"].sort(),
		);
	});

	test("dryRun reports what would go and deletes nothing", () => {
		const root = makeRoot();
		entry(root, key(1), 100);
		const result = pruneStorybookCache({
			root,
			now: NOW,
			dryRun: true,
			env: {},
		});
		assert.deepEqual(result.removed, [key(1)]);
		assert.deepEqual(names(root), [key(1)]);
	});
});

describe("root validation", () => {
	test("refuses a root that is not a storybook cache", () => {
		const bad = join(scratch, "elsewhere");
		mkdirSync(bad);
		entry(bad, key(1), 100);
		const result = pruneStorybookCache({ root: bad, now: NOW, env: {} });
		assert.ok(result.refused);
		assert.deepEqual(names(bad), [key(1)]);

		const wrongParent = join(scratch, "x", "cache", "storybook");
		mkdirSync(wrongParent, { recursive: true });
		entry(wrongParent, key(1), 100);
		assert.ok(refusalFor(wrongParent, {}));
		assert.deepEqual(names(wrongParent), [key(1)]);
	});

	test("accepts <CACHE_DIR>/storybook, but only for the CACHE_DIR in force", () => {
		const cacheDir = join(scratch, "cachedir");
		const root = join(cacheDir, "storybook");
		mkdirSync(root, { recursive: true });
		assert.equal(refusalFor(root, { CACHE_DIR: cacheDir }), null);
		assert.ok(
			refusalFor(root, {}),
			"without CACHE_DIR it is not a .cache/storybook",
		);
		assert.ok(refusalFor(root, { CACHE_DIR: join(scratch, "other") }));
		assert.ok(
			refusalFor(root, { CACHE_DIR: "true" }),
			"a flag value is not a path",
		);
	});

	test("refuses a symlinked root and a missing root", () => {
		const real = makeRoot();
		entry(real, key(1), 100);
		const link = join(scratch, "linkparent", ".cache", "storybook");
		mkdirSync(join(scratch, "linkparent", ".cache"), { recursive: true });
		symlinkSync(real, link);
		assert.match(refusalFor(link, {}), /symlink/);
		assert.ok(refusalFor(join(scratch, "nope", ".cache", "storybook"), {}));
		assert.deepEqual(names(real), [key(1)]);
	});
});

describe("fails open", () => {
	test("a failing rm is reported, kept, and does not stop the rest", () => {
		const root = makeRoot();
		entry(root, key(1), 100);
		entry(root, key(2), 100);
		const logged = [];
		const result = pruneStorybookCache({
			root,
			now: NOW,
			env: {},
			log: (line) => logged.push(line),
			rm: (path) => {
				if (path.endsWith(key(1))) throw new Error("EACCES");
				rmSync(path, { recursive: true, force: true });
			},
		});
		assert.deepEqual(result.failed, [key(1)]);
		assert.deepEqual(result.removed, [key(2)]);
		assert.ok(result.kept.includes(key(1)));
		assert.match(logged.join("\n"), /1 failed/);
	});

	test("a hostile root argument returns instead of throwing", () => {
		for (const root of [undefined, null, 42, "", "\0"]) {
			const result = pruneStorybookCache({ root, env: {} });
			assert.ok(result.refused || result.error);
		}
	});
});

describe("env options", () => {
	test("STORYBOOK_CACHE_PRUNE=off disables; thresholds are overridable", () => {
		assert.equal(pruneOptionsFromEnv({ STORYBOOK_CACHE_PRUNE: "off" }), null);
		assert.deepEqual(pruneOptionsFromEnv({}), {
			maxAgeMs: 48 * HOUR,
			maxEntries: 40,
			minKeepAgeMs: 6 * HOUR,
		});
		assert.deepEqual(
			pruneOptionsFromEnv({
				STORYBOOK_CACHE_MAX_AGE_HOURS: "12",
				STORYBOOK_CACHE_MAX_ENTRIES: "5",
				STORYBOOK_CACHE_MIN_KEEP_HOURS: "junk",
			}),
			{ maxAgeMs: 12 * HOUR, maxEntries: 5, minKeepAgeMs: 6 * HOUR },
		);
	});
});
