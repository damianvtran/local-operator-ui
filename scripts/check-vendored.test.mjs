import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PROVENANCE_FILENAME, checkVendored } from "./check-vendored.mjs";

/**
 * The vendoring gate's own cases.
 *
 * Why these exist: the gate is the ONLY thing that catches a hand-edit of a
 * vendored consent module — the app and the extension would otherwise start
 * enforcing different approval rules for the same operator, silently, in two
 * release lines nobody compares again. Its failure mode is silent in both
 * directions: a gate that reads the wrong path, or that passes over an empty
 * manifest, looks exactly like a gate that passes. So each rule is pinned here
 * in the direction that should fail, plus the repository's own tree, which is
 * what CI asserts on every pull request.
 *
 * `check-vendored.mjs` cannot detect drift AGAINST lop (design 12.3): there is
 * no lop checkout here. That limit is stated in its own header and repeated in
 * the PR body rather than hidden — the runtime `PROTO_VERSION` check is the
 * layer that protects a user.
 */

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const DRIVER = 'export const shared = "one";\n';

/** A temp repo root with a manifest, one vendored file and a protocol.ts. */
function fixture({ protoVersion = 1, provenance, files = { "driver/x.ts": DRIVER } } = {}) {
	const root = mkdtempSync(join(tmpdir(), "lo-vendored-"));
	const vendorDir = join(root, "src", "main", "browser", "vendor");
	mkdirSync(join(vendorDir, "driver"), { recursive: true });
	for (const [name, text] of Object.entries(files)) {
		writeFileSync(join(vendorDir, name), text);
	}
	writeFileSync(
		join(vendorDir, PROVENANCE_FILENAME),
		JSON.stringify(
			provenance ?? {
				source_repo: "damianvtran/local-operator",
				source_ref: "a".repeat(40),
				proto_version: protoVersion,
				inputs_sha256: sha256("inputs"),
				files: { "driver/x.ts": sha256(DRIVER) },
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(root, "src", "main", "browser", "protocol.ts"),
		`export const PROTO_VERSION = ${protoVersion};\n`,
	);
	return root;
}

function check(root) {
	return checkVendored({ root }).problems;
}

test("the repository's own vendored tree matches its manifest", () => {
	const { problems, provenance } = checkVendored();
	assert.deepEqual(problems, []);
	// The pin is a COMMIT, and every file it claims is one this repo actually
	// imports — an empty or partial manifest would otherwise pass silently.
	assert.match(provenance.source_ref, /^[0-9a-f]{40}$/);
	assert.equal(provenance.proto_version, 1);
	assert.ok(
		Object.keys(provenance.files).length >= 6,
		`expected the shared driver modules to be vendored, saw ${Object.keys(provenance.files).join(", ")}`,
	);
	for (const name of Object.keys(provenance.files)) {
		assert.ok(name.startsWith("driver/"), `${name} is not under driver/`);
	}
});

test("a hand-edited vendored file fails the gate", () => {
	const root = fixture();
	assert.deepEqual(check(root), []);
	writeFileSync(join(root, "src/main/browser/vendor/driver/x.ts"), `${DRIVER}// a hand-edit\n`);
	const problems = check(root);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /driver\/x\.ts does not match its recorded sha256/);
	rmSync(root, { recursive: true, force: true });
});

test("a listed file that is missing fails the gate", () => {
	const root = fixture();
	rmSync(join(root, "src/main/browser/vendor/driver/x.ts"));
	assert.match(check(root)[0], /listed in PROVENANCE.json but is not on disk/);
	rmSync(root, { recursive: true, force: true });
});

test("a file nobody listed fails the gate", () => {
	const root = fixture();
	writeFileSync(
		join(root, "src/main/browser/vendor/driver/sneaky.ts"),
		"export const sneaky = 1;\n",
	);
	assert.match(check(root)[0], /driver\/sneaky\.ts is in vendor\/ but is not listed/);
	rmSync(root, { recursive: true, force: true });
});

test("a pin that is not a commit fails the gate", () => {
	const root = fixture({
		provenance: {
			source_repo: "damianvtran/local-operator",
			source_ref: "main",
			proto_version: 1,
			inputs_sha256: sha256("inputs"),
			files: { "driver/x.ts": sha256(DRIVER) },
		},
	});
	assert.match(check(root)[0], /is not a full commit SHA/);
	rmSync(root, { recursive: true, force: true });
});

test("a pin whose protocol version disagrees with the app fails the gate", () => {
	const root = fixture({
		protoVersion: 2,
		provenance: {
			source_repo: "damianvtran/local-operator",
			source_ref: "a".repeat(40),
			proto_version: 1,
			inputs_sha256: sha256("inputs"),
			files: { "driver/x.ts": sha256(DRIVER) },
		},
	});
	const problems = check(root);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /re-pin with scripts\/sync-vendored\.mjs/);
	rmSync(root, { recursive: true, force: true });
});

test("a manifest claiming an adaptation the file does not carry fails the gate", () => {
	const root = fixture({
		provenance: {
			source_repo: "damianvtran/local-operator",
			source_ref: "a".repeat(40),
			proto_version: 1,
			inputs_sha256: sha256("inputs"),
			files: { "driver/x.ts": sha256(DRIVER) },
			patches: [
				{ file: "driver/x.ts", id: "injection", marker: "configureInjected(" },
			],
		},
	});
	assert.match(check(root)[0], /claims driver\/x\.ts carries 'configureInjected\(', which is not in the file/);
	rmSync(root, { recursive: true, force: true });
});

test("a missing manifest is reported rather than passed", () => {
	const root = fixture();
	rmSync(join(root, "src/main/browser/vendor", PROVENANCE_FILENAME));
	assert.match(check(root)[0], /PROVENANCE\.json is missing: run scripts\/sync-vendored\.mjs/);
	rmSync(root, { recursive: true, force: true });
});
