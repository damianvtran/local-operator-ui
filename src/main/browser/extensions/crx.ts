import { createHash, createPublicKey, verify } from "node:crypto";

/** The official 1Password extension id: kept as a named constant because the
 * migration from the earlier single-vendor layout and the tests reference it. */
export const ONEPASSWORD_EXTENSION_ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
// Chromium components/crx_file/crx_verifier.cc: production Web Store publisher key.
const STORE_KEY_HASH =
	"61f7f2a6bfcf74cd0bc1fe2497cc9b04254c658f79f2145392867ea8366367cf";

/** Minimal protobuf reader: CRX3 has bytes fields, with unknown fields skipped.
 * Lengths are checked against the actual buffer, never trusted for allocation. */
function fields(bytes: Buffer): Map<number, Buffer[]> {
	let offset = 0;
	const result = new Map<number, Buffer[]>();
	const integer = (): number => {
		let value = 0;
		let scale = 1;
		for (let index = 0; index < 8 && offset < bytes.length; index++) {
			const byte = bytes[offset++];
			value += (byte & 127) * scale;
			if (!Number.isSafeInteger(value)) throw new Error("Invalid CRX integer");
			if (!(byte & 128)) return value;
			scale *= 128;
		}
		throw new Error("Truncated CRX integer");
	};
	while (offset < bytes.length) {
		const tag = integer();
		const number = Math.floor(tag / 8);
		const wire = tag % 8;
		if (!number) throw new Error("Invalid CRX field");
		if (wire === 0) {
			integer();
			continue;
		}
		const length =
			wire === 2 ? integer() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
		if (length < 0 || length > bytes.length - offset)
			throw new Error("Truncated or unsupported CRX field");
		if (wire === 2) {
			const values = result.get(number) ?? [];
			values.push(bytes.subarray(offset, offset + length));
			result.set(number, values);
		}
		offset += length;
	}
	return result;
}

function required(fields: Map<number, Buffer[]>, field: number): Buffer {
	const values = fields.get(field);
	if (values?.length !== 1) throw new Error("Missing or duplicate CRX field");
	return values[0];
}

/** Verify BOTH the expected developer identity and Chrome Web Store publisher
 * before exposing ZIP bytes to an extractor.
 *
 * WHY our own verifier rather than electron-chrome-web-store's installer: that
 * library picks a proof by key hash and never calls crypto.verify, accepts CRX2,
 * and writes manifest.key from the unverified header (design §1 row 1). Here the
 * Web Store publisher proof is MANDATORY, so only packages the store signed can
 * load: no sideloaded or self-signed CRX, no CRX2, and `expectedId` binds the
 * package to the listing the user chose (a store page cannot swap packages). A manifest key/name is not proof:
 * anybody can copy it. Signatures cover the exact signed header AND archive,
 * matching Chromium's CRX3 verifier (RSA PKCS1 SHA256 or ECDSA SHA256).
 * No extension code executes here; this function never reads a browser profile. */
export function verifyStoreCrx(
	crx: Buffer,
	expectedId: string,
): {
	archive: Buffer;
	publicKey: string;
} {
	if (
		crx.length < 12 ||
		crx.toString("ascii", 0, 4) !== "Cr24" ||
		crx.readUInt32LE(4) !== 3
	)
		throw new Error("Expected a CRX3 package");
	const headerSize = crx.readUInt32LE(8);
	if (headerSize > crx.length - 12) throw new Error("Truncated CRX header");
	const header = fields(crx.subarray(12, 12 + headerSize));
	const signed = required(header, 10000);
	const id = required(fields(signed), 1);
	const extensionId = [...id]
		.map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
		.join("");
	if (id.length !== 16 || extensionId !== expectedId)
		throw new Error("Package id does not match the requested extension");
	const archive = crx.subarray(12 + headerSize);
	const size = Buffer.alloc(4);
	size.writeUInt32LE(signed.length);
	const payload = Buffer.concat([
		Buffer.from("CRX3 SignedData\0"),
		size,
		signed,
		archive,
	]);
	let developerKey: Buffer | undefined;
	let publisher = false;
	for (const type of [2, 3]) {
		for (const proof of header.get(type) ?? []) {
			const values = fields(proof);
			const key = required(values, 1);
			const signature = required(values, 2);
			const publicKey = createPublicKey({ key, format: "der", type: "spki" });
			if (
				publicKey.asymmetricKeyType !== (type === 2 ? "rsa" : "ec") ||
				!verify("sha256", payload, publicKey, signature)
			)
				throw new Error("Invalid CRX signature");
			const hash = createHash("sha256").update(key).digest();
			if (hash.subarray(0, 16).equals(id)) developerKey = key;
			if (hash.toString("hex") === STORE_KEY_HASH) publisher = true;
		}
	}
	if (!developerKey || !publisher)
		throw new Error("Missing official developer or Web Store proof");
	return { archive, publicKey: developerKey.toString("base64") };
}
