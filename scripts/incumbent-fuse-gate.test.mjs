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
const UNREADABLE_REFUSAL = /^INCUP_UPDATE_CONTROL:.*framework-unreadable/;

const wire = (states, { version = 1, length = states.length } = {}) =>
	Buffer.concat([
		Buffer.from(FUSE_SENTINEL, "ascii"),
		Buffer.from([version, length]),
		Buffer.from(states, "ascii"),
	]);

// Inert Mach-O fixtures: the table defines the exact wire search ranges.
const thin = (bytes) =>
	Buffer.concat([Buffer.from("cffaedfe", "hex"), Buffer.alloc(28), bytes]);

function fat(slices, { wide = false, littleEndian = false } = {}) {
	const magic = wide
		? littleEndian
			? "bfbafeca"
			: "cafebabf"
		: littleEndian
			? "bebafeca"
			: "cafebabe";
	const stride = wide ? 32 : 20;
	const header = Buffer.alloc(8 + slices.length * stride);
	header.write(magic, "hex");
	const write32 = littleEndian ? "writeUInt32LE" : "writeUInt32BE";
	const write64 = littleEndian ? "writeBigUInt64LE" : "writeBigUInt64BE";
	header[write32](slices.length, 4);
	let offset = header.length;
	for (const [i, slice] of slices.entries()) {
		const entry = 8 + i * stride;
		if (wide) {
			header[write64](BigInt(offset), entry + 8);
			header[write64](BigInt(slice.length), entry + 16);
		} else {
			header[write32](offset, entry + 8);
			header[write32](slice.length, entry + 12);
		}
		offset += slice.length;
	}
	return Buffer.concat([header, ...slices]);
}

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
	["thin wire on", wire("0001"), true, "on"],
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
]) {
	test(`incumbent inspector fuse: ${name}`, (t) => {
		const fixture = appFixture(t);
		fixture.write(thin(binary));
		assert.deepEqual(incumbentInspectorCapability(fixture.app), {
			supported,
			state,
		});
	});
}

for (const [name, binary, supported, state] of [
	[
		"all universal wires on",
		fat([thin(wire("0001")), thin(wire("1111"))]),
		true,
		"on",
	],
	[
		"later universal wire off",
		fat([thin(wire("0001")), thin(wire("1110"))]),
		false,
		"off",
	],
	[
		"one wire for two slices",
		fat([thin(wire("0001")), thin(Buffer.alloc(0))]),
		false,
		"wire-missing-for-slice",
	],
	[
		"two wires in one slice cannot cover an empty second slice",
		fat([
			thin(Buffer.concat([wire("0001"), wire("1111")])),
			thin(Buffer.alloc(0)),
		]),
		false,
		"wire-missing-for-slice",
	],
	[
		"truncated at a slice boundary",
		fat([thin(wire("0001", { length: 5 })), thin(wire("1111"))]),
		false,
		"truncated",
	],
	[
		"64-bit fat header",
		fat([thin(wire("0001")), thin(wire("1111"))], { wide: true }),
		true,
		"on",
	],
	[
		"byte-swapped 32-bit fat header",
		fat([thin(wire("0001")), thin(wire("1111"))], { littleEndian: true }),
		true,
		"on",
	],
	[
		"byte-swapped 64-bit fat header",
		fat([thin(wire("0001")), thin(wire("1111"))], {
			wide: true,
			littleEndian: true,
		}),
		true,
		"on",
	],
	[
		"truncated fat header",
		Buffer.from("cafebabe", "hex"),
		false,
		"mach-o-header-unparseable",
	],
	[
		"truncated architecture table",
		Buffer.concat([Buffer.from("cafebabe00000003", "hex"), wire("0001")]),
		false,
		"mach-o-header-unparseable",
	],
	[
		"out-of-bounds slice",
		fat([thin(wire("0001")), thin(wire("1111"))]).subarray(0, -1),
		false,
		"mach-o-header-unparseable",
	],
	[
		"unknown magic with an on wire",
		wire("0001"),
		false,
		"mach-o-header-unparseable",
	],
]) {
	test(`incumbent Mach-O layout: ${name}`, (t) => {
		const fixture = appFixture(t);
		fixture.write(binary);
		assert.deepEqual(incumbentInspectorCapability(fixture.app), {
			supported,
			state,
		});
	});
}

test("overlapping slice entries cannot share one on-wire", (t) => {
	const fixture = appFixture(t);
	const binary = fat([thin(wire("0001")), thin(wire("1111"))]);
	// Point the second 32-bit fat_arch at the first slice's file offset.
	binary.writeUInt32BE(binary.readUInt32BE(16), 36);
	fixture.write(binary);
	assert.deepEqual(incumbentInspectorCapability(fixture.app), {
		supported: false,
		state: "mach-o-header-unparseable",
	});
});

test("unreadable framework returns a sanitized typed refusal", (t) => {
	const fixture = appFixture(t);
	const expected = { supported: false, state: "framework-unreadable" };
	assert.deepEqual(incumbentInspectorCapability(fixture.app), expected);
	// A directory at the file path triggers a read error even with elevated permissions.
	mkdirSync(join(fixture.app, ELECTRON_FRAMEWORK_BINARY), { recursive: true });
	const result = incumbentInspectorCapability(fixture.app);
	assert.deepEqual(result, expected);
	const message = incumbentInspectorRefusal("v1.2.3", result);
	assert.match(message, UNREADABLE_REFUSAL);
	assert.doesNotMatch(message, URL_OR_ABSOLUTE_PATH);
});

test("reads the concrete version when the canonical framework link is absent", (t) => {
	const fixture = appFixture(t);
	fixture.write(thin(wire("0001")), versionedBinary("A"));
	assert.deepEqual(incumbentInspectorCapability(fixture.app), {
		supported: true,
		state: "on",
	});
});

test("honors Current rather than guessing among version directories", (t) => {
	const fixture = appFixture(t);
	fixture.write(thin(wire("0001")), versionedBinary("A"));
	fixture.write(thin(wire("0000")), versionedBinary("B"));
	const versions = dirname(dirname(join(fixture.app, versionedBinary("B"))));
	assert.deepEqual(incumbentInspectorCapability(fixture.app), {
		supported: false,
		state: "framework-unreadable",
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
	fixture.write(thin(wire("0000")));
	const verdict = incumbentInspectorCapability(fixture.app);
	const message = incumbentInspectorRefusal("v0.60.4", verdict);
	assert.equal(
		message,
		"INCUP_UPDATE_CONTROL: incumbent v0.60.4 carries EnableNodeCliInspectArguments=off; the harness drives the updater through the CLI inspector, which the fuse disables. Unsupported incumbent capability — not a candidate verdict.",
	);
	assert.doesNotMatch(message, URL_OR_ABSOLUTE_PATH);
});
