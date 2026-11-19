/**
 * The Electron fuse wire the shipped app must carry, and a reader for it.
 *
 * WHY THIS EXISTS (F2: card answers verified by the app's code signature). The
 * runtime is going to trust a card answer as the operator's when the process
 * that attests it is the genuine signed app. A code signature only says who
 * BUILT the process, not what it is running, so every switch that lets a
 * same-uid caller run its own code inside the signed binary has to be off:
 *
 * - RunAsNode: `ELECTRON_RUN_AS_NODE=1 <exe> -e <js>` ran arbitrary JS in the
 *   genuine signed process and passed the app's designated requirement (F2
 *   spike, measured on 0.57.8).
 * - EnableNodeOptionsEnvironmentVariable: defence in depth. A packaged app's
 *   browser process already refuses most `NODE_OPTIONS` (measured on an
 *   unfused packaged Electron 44.3.0: `--require x.js` printed "Most
 *   NODE_OPTIONs are not supported in packaged apps" and never ran), so this
 *   closes what that runtime filter still lets through rather than an
 *   observed `--require` injection.
 * - EnableNodeCliInspectArguments: `--inspect` hands a debugger to any caller.
 * - EnableEmbeddedAsarIntegrityValidation + OnlyLoadAppFromAsar: without both,
 *   the JS the signed binary runs is not the JS that was signed (a swapped
 *   `app.asar`, or an `app/` directory beside it, is loaded silently).
 * - EnableCookieEncryption: the in-app browser's logged-in cookies stop being
 *   plaintext on disk. ONE-WAY: turning it off later makes the encrypted store
 *   unreadable, so it is gated too, to stop a config edit from quietly undoing it.
 *
 * GrantFileProtocolExtraPrivileges stays ON and is deliberately NOT gated: the
 * renderer loads `file://…/renderer/index.html` with Vite's module scripts,
 * which an unprivileged opaque `file://` origin CORS-blocks. Turning it off
 * needs a custom `app://` protocol first; it is outside this threat model and
 * deferred (F2 design note, fuse table). LoadBrowserProcessSpecificV8Snapshot
 * and WasmTrapHandlers are defaults unrelated to it.
 *
 * WHO FLIPS THEM: electron-builder, from `build.electronFuses` in package.json,
 * immediately before signing. `resetAdHocDarwinSignature: true` sits beside
 * them because flipping rewrites bytes inside `Electron Framework`, whose
 * npm-dist signature is only ad-hoc linker-signed: an UNSIGNED local arm64
 * package (`CSC_IDENTITY_AUTO_DISCOVERY=false … --dir --arm64`, the AGENTS.md
 * recipe) would otherwise refuse to launch with a code-signature error
 * (`@electron/fuses` README, "Apple Silicon"). It re-signs ad hoc only; on the
 * release path electron-builder re-signs every Mach-O with the Developer ID
 * right after, so it changes nothing there. This module is what the release gate
 * (`scripts/verify-macos-artifacts.mjs`, `app-electron-fuses`) reads the result
 * back with - the config says what was asked for, the wire says what shipped -
 * and the unit test holds the two to one table so they cannot drift.
 *
 * WHY A READER OF OUR OWN rather than `@electron/fuses`: that package is only a
 * transitive dependency of electron-builder (not resolvable from this repo
 * under pnpm's strict layout), and adding it would change the lockfile. The wire
 * format is small and stable: the 32-byte sentinel below, one version byte
 * (1), one length byte, then one ASCII byte per fuse ('0' off, '1' on, 'r'
 * removed). A universal binary carries one wire per slice; every wire is read.
 * The fuses are indexed by position and only the ones listed below are
 * required, so a newer Electron with a longer wire still passes.
 */

/** The marker `@electron/fuses` searches for (its `SENTINEL` constant). */
export const FUSE_SENTINEL = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";

/** The only wire version this reader understands (`FuseVersion.V1`). */
export const FUSE_WIRE_VERSION = 1;

const STATE_BY_BYTE = { 48: "off", 49: "on", 114: "removed" };

/**
 * The required state of each gated fuse, by its V1 wire index
 * (`@electron/fuses` `FuseV1Options`), and the `build.electronFuses` key that
 * asks electron-builder for it.
 */
export const REQUIRED_FUSES = Object.freeze([
	{ index: 0, name: "RunAsNode", configKey: "runAsNode", state: "off" },
	{
		index: 1,
		name: "EnableCookieEncryption",
		configKey: "enableCookieEncryption",
		state: "on",
	},
	{
		index: 2,
		name: "EnableNodeOptionsEnvironmentVariable",
		configKey: "enableNodeOptionsEnvironmentVariable",
		state: "off",
	},
	{
		index: 3,
		name: "EnableNodeCliInspectArguments",
		configKey: "enableNodeCliInspectArguments",
		state: "off",
	},
	{
		index: 4,
		name: "EnableEmbeddedAsarIntegrityValidation",
		configKey: "enableEmbeddedAsarIntegrityValidation",
		state: "on",
	},
	{
		index: 5,
		name: "OnlyLoadAppFromAsar",
		configKey: "onlyLoadAppFromAsar",
		state: "on",
	},
]);

/** Where the wire lives in a macOS app bundle. */
export const ELECTRON_FRAMEWORK_BINARY =
	"Contents/Frameworks/Electron Framework.framework/Electron Framework";

/**
 * Every fuse wire in a binary, one per architecture slice.
 *
 * Returns `[{ offset, version, states: ["off"|"on"|"removed"|"0x.."] }]`; an
 * empty array means no sentinel (not an Electron >= 12 binary). A wire whose
 * declared length runs past the end of the buffer is reported truncated rather
 * than read short, so a damaged binary cannot pass on the fuses it still has.
 */
export function readFuseWires(buffer) {
	const sentinel = Buffer.from(FUSE_SENTINEL, "latin1");
	const wires = [];
	let from = 0;
	for (;;) {
		const at = buffer.indexOf(sentinel, from);
		if (at === -1) break;
		const position = at + sentinel.length;
		const version = buffer[position];
		const length = buffer[position + 1];
		const truncated =
			length === undefined || position + 2 + length > buffer.length;
		const states = [];
		if (!truncated) {
			for (let i = 0; i < length; i++) {
				const byte = buffer[position + 2 + i];
				states.push(
					STATE_BY_BYTE[byte] ?? `0x${byte.toString(16).padStart(2, "0")}`,
				);
			}
		}
		wires.push({ offset: at, version, length: length ?? 0, truncated, states });
		from = position;
	}
	return wires;
}

/**
 * Why a binary's fuses do not meet `REQUIRED_FUSES`, as human-readable lines.
 * Empty means every wire in it is hardened.
 */
export function fuseViolations(buffer) {
	const wires = readFuseWires(buffer);
	if (wires.length === 0)
		return [
			"no Electron fuse wire (sentinel) in the binary, so none of its fuses can be shown to be set",
		];
	const problems = [];
	for (const wire of wires) {
		const where = `wire at byte ${wire.offset}`;
		if (wire.version !== FUSE_WIRE_VERSION) {
			problems.push(
				`${where}: version ${wire.version}, this gate reads only version ${FUSE_WIRE_VERSION}`,
			);
			continue;
		}
		if (wire.truncated) {
			problems.push(`${where}: truncated (declared ${wire.length} fuses)`);
			continue;
		}
		for (const fuse of REQUIRED_FUSES) {
			const actual = wire.states[fuse.index] ?? "absent";
			if (actual !== fuse.state)
				problems.push(
					`${where}: ${fuse.name} is ${actual}, must be ${fuse.state}`,
				);
		}
	}
	return problems;
}

/** One line per wire, `RunAsNode=off …`, for the gate's report. */
export function describeFuseWires(buffer) {
	return readFuseWires(buffer)
		.map((wire) =>
			wire.truncated
				? `wire@${wire.offset} truncated`
				: `wire@${wire.offset} v${wire.version} [${wire.states
						.map((state) => ({ off: "0", on: "1", removed: "r" })[state] ?? "?")
						.join("")}] ${REQUIRED_FUSES.map(
						(fuse) => `${fuse.name}=${wire.states[fuse.index] ?? "absent"}`,
					).join(" ")}`,
		)
		.join(" | ");
}

/**
 * The `Info.plist` key a hardened build carries, and the value.
 *
 * WHY: the runtime's verifier pins it in its code requirement
 * (`info[LOAttestationEpoch] = "1"`) as the DOWNGRADE LOCK. Every released
 * build signed before this change is genuine, same team, same identifier - and
 * has RunAsNode on and the DYLD entitlement, so it can be driven by any same-uid
 * caller. Without a key only hardened builds carry, an attacker could download
 * an old signed release and attest with it. Bump the value only together with
 * the runtime's requirement, when a later hardening must also lock out this one.
 * Written by `build.mac.extendInfo` in package.json.
 */
export const ATTESTATION_EPOCH_KEY = "LOAttestationEpoch";
export const ATTESTATION_EPOCH_VALUE = "1";

/** The epoch an `Info.plist` (XML text) declares, or null. */
export function attestationEpochFromInfoPlist(plistText) {
	const match = String(plistText ?? "").match(
		new RegExp(
			`<key>${ATTESTATION_EPOCH_KEY}</key>\\s*<string>([^<]*)</string>`,
		),
	);
	return match ? match[1] : null;
}
