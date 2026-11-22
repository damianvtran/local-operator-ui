import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { LAYOUT } from "./bundled-runtime-layout.mjs";
import {
	ELECTRON_FRAMEWORK_BINARY,
	FUSE_WIRE_VERSION,
	REQUIRED_FUSES,
	readFuseWires,
} from "./electron-fuse-policy.mjs";

const inspectorFuse = REQUIRED_FUSES.find(
	({ name }) => name === "EnableNodeCliInspectArguments",
);

// Shared recognition list; the fat spellings need their own field layouts.
const MACH_O_MAGICS = new Set(LAYOUT.machOMagics);
const FAT_ARCH = new Map([
	["cafebabe", { stride: 20, littleEndian: false }],
	["bebafeca", { stride: 20, littleEndian: true }],
	["cafebabf", { stride: 32, littleEndian: false }],
	["bfbafeca", { stride: 32, littleEndian: true }],
]);

const magicOf = (buffer) => buffer.toString("hex", 0, 4);

function isThinMachO(buffer) {
	const magic = magicOf(buffer);
	const headerSize = magic === "cffaedfe" || magic === "feedfacf" ? 32 : 28;
	return (
		MACH_O_MAGICS.has(magic) &&
		!FAT_ARCH.has(magic) &&
		buffer.length >= headerSize
	);
}

function frameworkSlices(binary) {
	const magic = magicOf(binary);
	if (!MACH_O_MAGICS.has(magic)) return null;
	const fat = FAT_ARCH.get(magic);
	if (!fat) return isThinMachO(binary) ? [binary] : null;
	if (binary.length < 8) return null;

	const read32 = fat.littleEndian ? "readUInt32LE" : "readUInt32BE";
	const read64 = fat.littleEndian ? "readBigUInt64LE" : "readBigUInt64BE";
	const wide = fat.stride === 32;
	const count = binary[read32](4);
	const tableEnd = 8 + count * fat.stride;
	if (!count || tableEnd > binary.length) return null;

	// An aggregate wire count could credit two wires from one slice or a
	// wire in padding. Check real, non-overlapping ranges so a read also
	// cannot finish a truncated wire with bytes from the next architecture.
	const ranges = [];
	for (let entry = 8; entry < tableEnd; entry += fat.stride) {
		const offset = wide
			? Number(binary[read64](entry + 8))
			: binary[read32](entry + 8);
		const size = wide
			? Number(binary[read64](entry + 16))
			: binary[read32](entry + 12);
		// A 64-bit value too large for exact Number conversion is necessarily
		// larger than the whole Buffer, so it also fails these bounds.
		if (offset < tableEnd || size === 0 || offset + size > binary.length)
			return null;
		ranges.push({ offset, end: offset + size });
	}
	ranges.sort((a, b) => a.offset - b.offset);
	const slices = [];
	let previousEnd = tableEnd;
	for (const { offset, end } of ranges) {
		if (offset < previousEnd) return null;
		const slice = binary.subarray(offset, end);
		if (!isThinMachO(slice)) return null;
		slices.push(slice);
		previousEnd = end;
	}
	return slices;
}

const unsupported = (state) => ({ supported: false, state });

function readFramework(appPath) {
	const binary = join(appPath, ELECTRON_FRAMEWORK_BINARY);
	try {
		return readFileSync(binary);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		// The release gate reads the canonical framework link. For a layout
		// exposing only Versions/, respect Current if present; otherwise a lone
		// version is unambiguous. Never guess which of several builds would run.
		const versions = join(dirname(binary), "Versions");
		const entries = readdirSync(versions, { withFileTypes: true });
		const directories = entries.filter((entry) => entry.isDirectory());
		if (entries.some(({ name }) => name === "Current"))
			return readFileSync(join(versions, "Current", basename(binary)));
		if (directories.length !== 1) throw error;
		return readFileSync(join(versions, directories[0].name, basename(binary)));
	}
}

/**
 * Read the verified incumbent as data. A hardened build deliberately refuses
 * CLI inspection; waiting for a debugger there would misreport a known harness
 * limitation as a runner timeout. Do not launch or modify the app to learn it.
 * Reuse the release gate's wire decoder, but require evidence in every
 * declared slice. Here only the inspector fuse matters, and it must be on.
 */
export function incumbentInspectorCapability(appPath) {
	let binary;
	try {
		binary = readFramework(appPath);
	} catch {
		// Missing evidence is not a candidate failure. Never carry the IO
		// error (which includes a local path) into the verifier's record.
		return unsupported("framework-unreadable");
	}
	const slices = frameworkSlices(binary);
	if (!slices) return unsupported("mach-o-header-unparseable");
	for (const slice of slices) {
		const wires = readFuseWires(slice);
		if (wires.length === 0)
			return unsupported(
				FAT_ARCH.has(magicOf(binary)) ? "wire-missing-for-slice" : "absent",
			);
		for (const wire of wires) {
			if (wire.truncated) return unsupported("truncated");
			if (wire.version !== FUSE_WIRE_VERSION)
				return unsupported(`wire-version-${wire.version}`);
			const state = wire.states[inspectorFuse.index] ?? "absent";
			if (state !== "on") return unsupported(state);
		}
	}
	return { supported: true, state: "on" };
}

// The verifier validates the exact release tag before reaching this gate. Only
// that tag and the decoded state enter the evidence, never artifact paths or URLs.
export function incumbentInspectorRefusal(tag, { state }) {
	if (
		state === "framework-unreadable" ||
		state === "mach-o-header-unparseable" ||
		state === "wire-missing-for-slice"
	)
		return `INCUP_UPDATE_CONTROL: cannot establish ${inspectorFuse.name} for incumbent ${tag} (${state}); the harness requires CLI inspection. Unsupported incumbent capability — not a candidate verdict.`;
	return `INCUP_UPDATE_CONTROL: incumbent ${tag} carries ${inspectorFuse.name}=${state}; the harness drives the updater through the CLI inspector, which the fuse disables. Unsupported incumbent capability — not a candidate verdict.`;
}
