import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
const require = createRequire(import.meta.url);

const bundle = await build({
	entryPoints: ["src/main/browser/extensions/crx.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { verifyStoreCrx, ONEPASSWORD_EXTENSION_ID } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const WRONG_EXTENSION = /does not match the requested extension/;
// The manager verifies against the id the user chose on the store page.
const verifyOnePasswordCrx = (buffer) =>
	verifyStoreCrx(buffer, ONEPASSWORD_EXTENSION_ID);
const INVALID_FIELD = /Missing or duplicate/;
const MISSING_PROOF = /Missing official developer or Web Store proof/;
const INVALID_SIGNATURE = /Invalid CRX signature/;
const varint = (input) => {
	let value = input;
	const bytes = [];
	do {
		bytes.push((value & 127) | (value > 127 ? 128 : 0));
		value = Math.floor(value / 128);
	} while (value);
	return Buffer.from(bytes);
};
const field = (number, value) =>
	Buffer.concat([varint(number * 8 + 2), varint(value.length), value]);
const uint32 = (value) => {
	const result = Buffer.alloc(4);
	result.writeUInt32LE(value);
	return result;
};
const crx = (header, archive = Buffer.from("PK fixture")) =>
	Buffer.concat([
		Buffer.from("Cr24"),
		uint32(3),
		uint32(header.length),
		header,
		archive,
	]);
const officialId = Buffer.from(
	[...ONEPASSWORD_EXTENSION_ID]
		.map((char) => (char.charCodeAt(0) - 97).toString(16))
		.join(""),
	"hex",
);

test("rejects malformed CRX envelopes and protobuf lengths", () => {
	for (const buffer of [
		Buffer.alloc(0),
		Buffer.from("Cr24"),
		Buffer.concat([Buffer.from("Cr24"), uint32(2), uint32(0)]),
		Buffer.concat([Buffer.from("Cr24"), uint32(3), uint32(100)]),
		crx(Buffer.from([0])),
		crx(Buffer.from([0x82, 0x80])),
		crx(Buffer.from([10, 100])),
		crx(Buffer.from([0x0b])),
	])
		assert.throws(() => verifyOnePasswordCrx(buffer));
});

test("rejects a different extension and missing or duplicate signed identity", () => {
	assert.throws(
		() => verifyOnePasswordCrx(crx(field(10000, field(1, Buffer.alloc(16))))),
		WRONG_EXTENSION,
	);
	assert.throws(
		() => verifyOnePasswordCrx(crx(Buffer.alloc(0))),
		INVALID_FIELD,
	);
	const signed = field(10000, field(1, officialId));
	assert.throws(
		() => verifyOnePasswordCrx(crx(Buffer.concat([signed, signed]))),
		INVALID_FIELD,
	);
	assert.throws(() => verifyOnePasswordCrx(crx(signed)), MISSING_PROOF);
});

test("a signed attacker package cannot impersonate the official developer", () => {
	const { publicKey, privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	const signed = field(1, officialId);
	const archive = Buffer.from("PK attacker");
	const payload = Buffer.concat([
		Buffer.from("CRX3 SignedData\0"),
		uint32(signed.length),
		signed,
		archive,
	]);
	const proof = Buffer.concat([
		field(1, publicKey.export({ format: "der", type: "spki" })),
		field(2, sign("sha256", payload, privateKey)),
	]);
	assert.throws(
		() =>
			verifyOnePasswordCrx(
				crx(Buffer.concat([field(2, proof), field(10000, signed)]), archive),
			),
		MISSING_PROOF,
	);
});

// Optional real-package lane: obtain from the fixed Google update endpoint,
// never a profile, vault, fixture pretending to be the vendor, or credential store.
test(
	"official Web Store package verifies; tampering its archive fails",
	{
		skip: !process.env.EXTENSION_CRX,
	},
	() => {
		const original = readFileSync(process.env.EXTENSION_CRX);
		const verified = verifyOnePasswordCrx(original);
		assert.equal(verified.archive.subarray(0, 2).toString(), "PK");
		assert.ok(verified.publicKey.length > 0);
		const tampered = Buffer.from(original);
		tampered[tampered.length - 1] ^= 1;
		assert.throws(() => verifyOnePasswordCrx(tampered), INVALID_SIGNATURE);
		// A genuine store package is still refused for a DIFFERENT listing id:
		// a store page cannot substitute one extension's package for another's.
		assert.throws(
			() => verifyStoreCrx(original, "a".repeat(32)),
			WRONG_EXTENSION,
		);
	},
);

test("a developer-signed package WITHOUT the Web Store publisher proof is refused", () => {
	// Self-consistent developer key whose hash IS the package id: a perfectly
	// valid sideload in Chrome's developer mode, but never store-published.
	const { publicKey, privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	const der = publicKey.export({ format: "der", type: "spki" });
	const { createHash } = require("node:crypto");
	const id = createHash("sha256").update(der).digest().subarray(0, 16);
	const expected = [...id]
		.map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15)))
		.join("");
	const signed = field(1, id);
	const archive = Buffer.from("PK sideload");
	const payload = Buffer.concat([
		Buffer.from("CRX3 SignedData\0"),
		uint32(signed.length),
		signed,
		archive,
	]);
	const proof = Buffer.concat([
		field(1, der),
		field(2, sign("sha256", payload, privateKey)),
	]);
	assert.throws(
		() =>
			verifyStoreCrx(
				crx(Buffer.concat([field(2, proof), field(10000, signed)]), archive),
				expected,
			),
		MISSING_PROOF,
	);
});
