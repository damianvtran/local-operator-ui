import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import {
	ELECTRON_FRAMEWORK_BINARY,
	FUSE_SENTINEL,
} from "./electron-fuse-policy.mjs";
import {
	incumbentInspectorCapability,
	incumbentInspectorRefusal,
} from "./incumbent-fuse-gate.mjs";

const URL_OR_ABSOLUTE_PATH = /:\/\/|(?:^|[\s"'])(?:\/[^\s]|[A-Za-z]:\\)/;

const wire = (states, { version = 1, length = states.length } = {}) =>
	Buffer.concat([
		Buffer.from(FUSE_SENTINEL, "ascii"),
		Buffer.from([version, length]),
		Buffer.from(states, "ascii"),
	]);

const versionedBinary = (version) =>
	join(
		dirname(ELECTRON_FRAMEWORK_BINARY),
		"Versions",
		version,
		basename(ELECTRON_FRAMEWORK_BINARY),
	);

function appFixture(t) {
	// These are just bytes in a bundle-shaped scratch fixture, never executable.
	const root = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "incumbent-fuses-"),
	);
	t.after(() => rmSync(root, { recursive: true }));
	const app = join(root, "Local Operator.app");
	return {
		app,
		write(binary, path = ELECTRON_FRAMEWORK_BINARY) {
			const destination = join(app, path);
			mkdirSync(dirname(destination), { recursive: true });
			writeFileSync(destination, binary);
		},
	};
}

for (const [name, binary, supported, state] of [
	["on", wire("0001"), true, "on"],
	["off", wire("0000"), false, "off"],
	["removed", wire("000r"), false, "removed"],
	["unknown byte", wire("000?"), false, "0x3f"],
	["no sentinel", Buffer.from("not a fuse wire", "ascii"), false, "absent"],
	["no inspector index", wire("000"), false, "absent"],
	[
		"truncated despite an on byte",
		wire("0001", { length: 5 }),
		false,
		"truncated",
	],
	[
		"unknown version despite an on byte",
		wire("0001", { version: 2 }),
		false,
		"wire-version-2",
	],
	[
		"all universal wires on",
		Buffer.concat([wire("0001"), wire("1111")]),
		true,
		"on",
	],
	[
		"later universal wire off",
		Buffer.concat([wire("0001"), wire("1110")]),
		false,
		"off",
	],
]) {
	test(`incumbent inspector fuse: ${name}`, (t) => {
		const fixture = appFixture(t);
		fixture.write(binary);
		assert.deepEqual(incumbentInspectorCapability(fixture.app), {
			supported,
			state,
		});
	});
}

test("reads the concrete version when the canonical framework link is absent", (t) => {
	const fixture = appFixture(t);
	fixture.write(wire("0001"), versionedBinary("A"));
	assert.deepEqual(incumbentInspectorCapability(fixture.app), {
		supported: true,
		state: "on",
	});
});

test("honors Current rather than guessing among version directories", (t) => {
	const fixture = appFixture(t);
	fixture.write(wire("0001"), versionedBinary("A"));
	fixture.write(wire("0000"), versionedBinary("B"));
	const versions = dirname(dirname(join(fixture.app, versionedBinary("B"))));
	assert.throws(() => incumbentInspectorCapability(fixture.app), {
		code: "ENOENT",
	});
	symlinkSync("B", join(versions, "Current"));
	assert.deepEqual(incumbentInspectorCapability(fixture.app), {
		supported: false,
		state: "off",
	});
	// The standard top-level symlink must read the same active version.
	symlinkSync(
		join("Versions", "Current", basename(ELECTRON_FRAMEWORK_BINARY)),
		join(fixture.app, ELECTRON_FRAMEWORK_BINARY),
	);
	assert.deepEqual(incumbentInspectorCapability(fixture.app), {
		supported: false,
		state: "off",
	});
});

test("hardened incumbent refusal names the observed state without a path or URL", (t) => {
	const fixture = appFixture(t);
	fixture.write(wire("0000"));
	const verdict = incumbentInspectorCapability(fixture.app);
	const message = incumbentInspectorRefusal("v0.60.4", verdict);
	assert.equal(
		message,
		"INCUP_UPDATE_CONTROL: incumbent v0.60.4 carries EnableNodeCliInspectArguments=off; the harness drives the updater through the CLI inspector, which the fuse disables. Unsupported incumbent capability — not a candidate verdict.",
	);
	assert.doesNotMatch(message, URL_OR_ABSOLUTE_PATH);
});
