#!/usr/bin/env node
/**
 * The read-only gate over `src/main/browser/vendor/`. Design: 12.2, 12.3.
 *
 * WHAT IT CATCHES, and this is the realistic failure rather than a hypothetical
 * one: someone edits a vendored consent module to make a test pass. The app and
 * the extension would then enforce DIFFERENT approval semantics for the same
 * operator, silently, in two release lines that are never compared again. So
 * every file the manifest lists is hashed, every extra file is refused, and the
 * declared adaptations must be present in the files they claim.
 *
 * WHAT IT CANNOT CATCH (design 12.3, stated so nobody reads this green tick as
 * more than it is): drift AGAINST lop. There is no lop checkout here, so a
 * driver change that nobody re-pinned leaves both repos' CI green. The layer
 * that protects a user from that is the runtime `PROTO_VERSION` comparison —
 * a mismatched pair gets a typed `proto_mismatch` instead of a mystery timeout
 * — which is why the check below pins the manifest's protocol version to the
 * number this app's wire code imports.
 *
 * Shares its shape with `scripts/generate-theme-css.mjs --check`: a generated
 * artifact must be exactly what its writer would produce.
 *
 * Usage: node scripts/check-vendored.mjs
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The manifest's own name, which is never a vendored file. */
export const PROVENANCE_FILENAME = "PROVENANCE.json";

/** The app's wire protocol version, read from the file the wire actually uses.
 *
 * A regex rather than an import because the module is TypeScript: node cannot
 * load it, and duplicating the number here would be exactly the second source
 * of truth this check exists to prevent. It throws rather than guessing when
 * the line is not found. */
export function readProtoVersion(protocolFile) {
	const source = readFileSync(protocolFile, "utf8");
	const found = /export const PROTO_VERSION = (\d+)/.exec(source);
	if (!found) {
		throw new Error(`${protocolFile} has no \`export const PROTO_VERSION = <n>\``);
	}
	return Number(found[1]);
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function listFiles(dir, prefix = "") {
	const entries = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		const relativePath = prefix ? `${prefix}/${name}` : name;
		if (statSync(path).isDirectory()) entries.push(...listFiles(path, relativePath));
		else entries.push(relativePath);
	}
	return entries;
}

/**
 * Verify the vendored tree against its manifest.
 *
 * Returns `{ problems, provenance }`: an empty `problems` is the gate passing,
 * and the caller decides how to report it (the CLI exits non-zero, the test
 * suite asserts). Every check is collected rather than thrown so one run says
 * everything that is wrong.
 */
export function checkVendored(options = {}) {
	const root = options.root ?? ROOT;
	const vendorDir = options.vendorDir ?? join(root, "src", "main", "browser", "vendor");
	const protocolFile =
		options.protocolFile ?? join(root, "src", "main", "browser", "protocol.ts");
	const problems = [];

	let raw;
	try {
		raw = readFileSync(join(vendorDir, PROVENANCE_FILENAME), "utf8");
	} catch {
		return {
			problems: [
				`${relative(root, join(vendorDir, PROVENANCE_FILENAME))} is missing: run scripts/sync-vendored.mjs --from <ref>`,
			],
			provenance: null,
		};
	}
	const provenance = JSON.parse(raw);

	for (const field of [
		"source_repo",
		"source_ref",
		"proto_version",
		"inputs_sha256",
		"files",
	]) {
		if (provenance[field] === undefined || provenance[field] === null) {
			problems.push(`PROVENANCE.json has no '${field}'`);
		}
	}
	if (problems.length) return { problems, provenance };

	// A branch name here would make the pin move under everyone's feet, which is
	// the one thing the manifest exists to prevent.
	if (!/^[0-9a-f]{40}$/.test(provenance.source_ref)) {
		problems.push(
			`PROVENANCE.json source_ref '${provenance.source_ref}' is not a full commit SHA`,
		);
	}

	const listed = Object.keys(provenance.files);
	const onDisk = listFiles(vendorDir).filter((name) => name !== PROVENANCE_FILENAME);

	for (const name of listed) {
		let text;
		try {
			text = readFileSync(join(vendorDir, name), "utf8");
		} catch {
			problems.push(`${name} is listed in PROVENANCE.json but is not on disk`);
			continue;
		}
		if (sha256(text) !== provenance.files[name]) {
			problems.push(
				`${name} does not match its recorded sha256 — it was edited by hand, and a hand-edited consent module is how this app and the extension start enforcing different rules`,
			);
		}
	}

	for (const name of onDisk) {
		if (!listed.includes(name)) {
			problems.push(
				`${name} is in vendor/ but is not listed in PROVENANCE.json — vendor/ is written only by scripts/sync-vendored.mjs (--force is not available here)`,
			);
		}
	}

	const appProto = readProtoVersion(protocolFile);
	if (provenance.proto_version !== appProto) {
		problems.push(
			`the pin speaks proto ${provenance.proto_version} but this app imports PROTO_VERSION ${appProto}: re-pin with scripts/sync-vendored.mjs --from <ref> and re-derive the wire if the protocol moved`,
		);
	}

	for (const patch of provenance.patches ?? []) {
		if (!listed.includes(patch.file)) {
			problems.push(`adaptation '${patch.id}' names ${patch.file}, which is not vendored`);
			continue;
		}
		let text = "";
		try {
			text = readFileSync(join(vendorDir, patch.file), "utf8");
		} catch {
			continue;
		}
		if (!text.includes(patch.marker)) {
			problems.push(
				`adaptation '${patch.id}' claims ${patch.file} carries '${patch.marker}', which is not in the file`,
			);
		}
	}

	return { problems, provenance };
}

function main() {
	const { problems, provenance } = checkVendored();
	if (problems.length) {
		console.error("check-vendored: FAILED");
		for (const problem of problems) console.error(`  - ${problem}`);
		process.exitCode = 1;
		return;
	}
	const count = Object.keys(provenance.files).length;
	console.log(
		`check-vendored: ${count} vendored file(s) match PROVENANCE.json ` +
			`(pin ${provenance.source_ref.slice(0, 12)}, proto ${provenance.proto_version}, ` +
			`${(provenance.patches ?? []).length} declared adaptation(s))`,
	);
	console.log(
		"note: this cannot detect drift against lop — the runtime PROTO_VERSION check is that layer (design 12.3).",
	);
}

if (isEntryPoint(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(`check-vendored: FAILED to run: ${error.message}`);
		process.exitCode = 1;
	}
}
