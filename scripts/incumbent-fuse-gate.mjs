import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	ELECTRON_FRAMEWORK_BINARY,
	FUSE_WIRE_VERSION,
	REQUIRED_FUSES,
	readFuseWires,
} from "./electron-fuse-policy.mjs";

const inspectorFuse = REQUIRED_FUSES.find(
	({ name }) => name === "EnableNodeCliInspectArguments",
);

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
 * Like the release fuse gate, require a complete V1 wire in every slice, not
 * just the first one. Here only the inspector fuse matters, and it must be on.
 */
export function incumbentInspectorCapability(appPath) {
	const wires = readFuseWires(readFramework(appPath));
	if (wires.length === 0) return { supported: false, state: "absent" };
	for (const wire of wires) {
		if (wire.truncated) return { supported: false, state: "truncated" };
		if (wire.version !== FUSE_WIRE_VERSION)
			return { supported: false, state: `wire-version-${wire.version}` };
		const state = wire.states[inspectorFuse.index] ?? "absent";
		if (state !== "on") return { supported: false, state };
	}
	return { supported: true, state: "on" };
}

// The verifier validates the exact release tag before reaching this gate. Only
// that tag and the decoded state enter the evidence, never artifact paths or URLs.
export function incumbentInspectorRefusal(tag, { state }) {
	return `INCUP_UPDATE_CONTROL: incumbent ${tag} carries ${inspectorFuse.name}=${state}; the harness drives the updater through the CLI inspector, which the fuse disables. Unsupported incumbent capability — not a candidate verdict.`;
}
