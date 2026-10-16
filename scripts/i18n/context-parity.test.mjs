import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	applyUpdate,
	catalogueNamespaces,
	checkAllowance,
	main,
	namespaceGap,
} from "./context-parity.mjs";

/**
 * The exported names allowed to WRITE the allowance, pinned by name. This is a
 * NARROW pin, not a general "nothing can add": it catches a writer added under
 * one of these names. The real proof that the allowance cannot be raised is
 * structural - applyUpdate is the only writeFileSync call in the module and it
 * only filters keys out.
 */
const WRITER_NAMES =
	/^(applyUpdate|writeAllowance|addAllowance|setAllowance|raiseAllowance)$/;

/*
 * EXECUTABLE CONTRACT FOR THE CONTEXT-PARITY GUARD.
 *
 * The guard exists because nothing checked `.context.json` coverage and
 * `ui.mesh.approval.*` shipped 8 keys with no translator context. A guard nobody
 * can falsify is worse than none, so these tests build a tiny catalogue tree in
 * a temp dir and pin the four behaviours that matter:
 *
 *  1. a covered key passes;
 *  2. a NEW uncovered key FAILS (the whole point — it must not ride green);
 *  3. a context entry for a key the catalogue lacks FAILS (a rename's orphan);
 *  4. the allowance is SHRINK-ONLY: `--update` removes a now-covered key, and
 *     there is no code path that ADDS one — a raise is refused structurally, so
 *     the number can only fall.
 *
 * The fixture is deliberately tiny and built here rather than read from the real
 * catalogue, so the tests still mean something when every real namespace reaches
 * full coverage and the real allowance is deleted.
 */

let root;
let cataloguesDir;
let allowancePath;

/**
 * A FRESH temp tree per test. Tests run in one process against whatever the
 * previous test left behind unless each one starts clean - a shared directory
 * made a later test fail on a namespace an earlier test had written.
 */
function freshTree() {
	root = mkdtempSync(join(tmpdir(), "context-parity-"));
	cataloguesDir = join(root, "catalogues");
	allowancePath = join(root, "context-allowance.json");
	return { cataloguesDir, allowancePath };
}

function writeCatalogue(ns, keys, contextKeys, { sidecar = true } = {}) {
	mkdirSync(join(cataloguesDir, "en"), { recursive: true });
	writeFileSync(
		join(cataloguesDir, "en", `${ns}.json`),
		`${JSON.stringify(Object.fromEntries(keys.map((k) => [k, `value of ${k}`])), null, "\t")}\n`,
	);
	if (sidecar) {
		writeFileSync(
			join(cataloguesDir, "en", `${ns}.context.json`),
			`${JSON.stringify(
				Object.fromEntries(
					contextKeys.map((k) => [k, { role: "test", note: "test context" }]),
				),
				null,
				"\t",
			)}\n`,
		);
	}
}

function writeAllowance(namespaces) {
	writeFileSync(
		allowancePath,
		`${JSON.stringify({ schema: 1, note: "test", namespaces }, null, "\t")}\n`,
	);
}

after(() => {
	// The temp trees are the OS's; nothing in the repository was touched.
});

test("a fully covered namespace reports no gap", () => {
	freshTree();
	writeCatalogue(
		"ui.alpha",
		["ui.alpha.a", "ui.alpha.b"],
		["ui.alpha.a", "ui.alpha.b"],
	);
	writeAllowance({});
	const gap = namespaceGap("ui.alpha", cataloguesDir);
	assert.deepEqual(gap.uncovered, []);
	assert.deepEqual(gap.orphaned, []);
	assert.equal(main([], { cataloguesDir, allowancePath }), 0);
});

test("a NEW uncovered key fails closed — it may not ride green", () => {
	freshTree();
	// ui.alpha keeps both keys; ui.beta adds a key nobody covered.
	writeCatalogue(
		"ui.alpha",
		["ui.alpha.a", "ui.alpha.b"],
		["ui.alpha.a", "ui.alpha.b"],
	);
	writeCatalogue("ui.beta", ["ui.beta.a", "ui.beta.new"], ["ui.beta.a"]);
	writeAllowance({});
	assert.equal(
		main([], { cataloguesDir, allowancePath }),
		1,
		"an uncovered key with no allowance entry must fail the guard",
	);
	const gap = namespaceGap("ui.beta", cataloguesDir);
	assert.deepEqual(gap.uncovered, ["ui.beta.new"]);
});

test("an allowed key passes, and a namespace with no sidecar needs an allowance row", () => {
	freshTree();
	writeCatalogue("ui.alpha", ["ui.alpha.a"], ["ui.alpha.a"]);
	writeCatalogue("ui.beta", ["ui.beta.a", "ui.beta.b"], ["ui.beta.a"]);
	writeAllowance({
		"ui.beta": { owner: "test lane", reason: "test", keys: ["ui.beta.b"] },
	});
	assert.equal(main([], { cataloguesDir, allowancePath }), 0);

	// The same namespace with NO sidecar at all and no allowance row is a failure.
	writeCatalogue("ui.gamma", ["ui.gamma.a"], [], { sidecar: false });
	assert.equal(main([], { cataloguesDir, allowancePath }), 1);
});

test("context for a key the catalogue lacks fails (a rename's orphan)", () => {
	freshTree();
	writeCatalogue("ui.alpha", ["ui.alpha.a"], ["ui.alpha.a", "ui.alpha.ghost"]);
	writeAllowance({});
	const gap = namespaceGap("ui.alpha", cataloguesDir);
	assert.deepEqual(gap.orphaned, ["ui.alpha.ghost"]);
	assert.equal(main([], { cataloguesDir, allowancePath }), 1);
});

test("the allowance is shrink-only — --update lowers a covered key and CANNOT raise", async () => {
	freshTree();
	// ui.alpha.b is allowed and STILL uncovered; ui.alpha.a is allowed but is now
	// covered in the sidecar — the classic stale-entry case --update must lower.
	writeCatalogue("ui.alpha", ["ui.alpha.a", "ui.alpha.b"], ["ui.alpha.a"]);
	writeAllowance({
		"ui.alpha": {
			owner: "test lane",
			reason: "test",
			keys: ["ui.alpha.a", "ui.alpha.b"],
		},
	});
	assert.equal(applyUpdate({ cataloguesDir, allowancePath }), 0);
	const after = JSON.parse(readFileSync(allowancePath, "utf8"));
	assert.deepEqual(
		after.namespaces["ui.alpha"].keys,
		["ui.alpha.b"],
		"--update removed the now-covered key and left the still-uncovered one",
	);

	// A second --update is a no-op: nothing left to lower.
	assert.equal(applyUpdate({ cataloguesDir, allowancePath }), 0);
	const twice = JSON.parse(readFileSync(allowancePath, "utf8"));
	assert.deepEqual(twice.namespaces["ui.alpha"].keys, ["ui.alpha.b"]);

	// No mode adds a key: the only writer is applyUpdate, and it only filters.
	// Pin the exported WRITE surface by name — a new exported writer must be
	// reviewed here, and the one that exists can only lower.
	const guard = await import("./context-parity.mjs");
	const writeExports = Object.keys(guard).filter((name) =>
		WRITER_NAMES.test(name),
	);
	assert.deepEqual(
		writeExports,
		["applyUpdate"],
		"the only allowance writer is applyUpdate, and it only removes keys",
	);
});

test("an allowance key that names no catalogue key is a PHANTOM and fails", () => {
	freshTree();
	// The key is allowed but exists in NO catalogue — it allows nothing today and
	// would silently pre-allow a future key of that name. It must fail, and it must
	// fail the SAME way whether or not the namespace has a sidecar: the first
	// version only checked phantoms against the sidecar, so a no-sidecar namespace
	// crashed (uncaught ENOENT) instead of reporting it.
	writeCatalogue("ui.alpha", ["ui.alpha.a"], ["ui.alpha.a"]);
	writeCatalogue("ui.delta", ["ui.delta.a"], [], { sidecar: false });
	writeAllowance({
		"ui.alpha": {
			owner: "test",
			reason: "test",
			keys: ["ui.alpha.a", "ui.alpha.ghost"],
		},
		"ui.delta": {
			owner: "test",
			reason: "test",
			keys: ["ui.delta.a", "ui.delta.ghost"],
		},
	});

	// With a sidecar: the phantom is reported, not silently swept.
	const withSidecar = checkAllowance({ cataloguesDir, allowancePath });
	assert.deepEqual(withSidecar.phantoms.sort(), [
		"ui.alpha: ui.alpha.ghost",
		"ui.delta: ui.delta.ghost",
	]);

	// No-sidecar namespace: must NOT throw, and must still name its phantom.
	assert.doesNotThrow(() => main([], { cataloguesDir, allowancePath }));
	assert.equal(main([], { cataloguesDir, allowancePath }), 1);

	// An allowance entry for a namespace with NO catalogue at all is a phantom too.
	writeAllowance({
		"ui.gone": { owner: "test", reason: "test", keys: ["ui.gone.a"] },
	});
	const absent = checkAllowance({ cataloguesDir, allowancePath });
	assert.deepEqual(absent.phantoms, ["ui.gone: ui.gone.a"]);
	assert.equal(main([], { cataloguesDir, allowancePath }), 1);
});

test("a now-covered allowance key is reported as stale and --update drops it, without failing the check", () => {
	freshTree();
	// stale (now covered) is NOT a failure — it is the string-ceiling baseline's
	// "lower it" half: the check stays exit 0 and prints the note, --update removes.
	writeCatalogue("ui.alpha", ["ui.alpha.a", "ui.alpha.b"], ["ui.alpha.a"]);
	writeAllowance({
		"ui.alpha": {
			owner: "test",
			reason: "test",
			keys: ["ui.alpha.a", "ui.alpha.b"],
		},
	});
	const result = checkAllowance({ cataloguesDir, allowancePath });
	assert.deepEqual(result.stale, { "ui.alpha": ["ui.alpha.a"] });
	assert.deepEqual(result.phantoms, []);
	assert.equal(
		main([], { cataloguesDir, allowancePath }),
		0,
		"a stale key does not fail the check",
	);
	assert.equal(applyUpdate({ cataloguesDir, allowancePath }), 0);
	const after = JSON.parse(readFileSync(allowancePath, "utf8"));
	assert.deepEqual(after.namespaces["ui.alpha"].keys, ["ui.alpha.b"]);
});

test("namespace discovery lists source catalogues and never a sidecar", () => {
	freshTree();
	writeCatalogue("ui.alpha", ["ui.alpha.a"], ["ui.alpha.a"]);
	writeCatalogue("ui.delta", ["ui.delta.a"], ["ui.delta.a"]);
	writeAllowance({});
	const namespaces = catalogueNamespaces(cataloguesDir);
	assert.ok(namespaces.includes("ui.alpha"));
	assert.ok(namespaces.includes("ui.delta"));
	assert.ok(
		!namespaces.some((ns) => ns.endsWith(".context")),
		"a sidecar must never be treated as its own namespace",
	);
});
