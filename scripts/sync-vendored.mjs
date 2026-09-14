#!/usr/bin/env node
/**
 * The ONLY writer of `src/main/browser/vendor/`. Design: 12.2.
 *
 * The app and the browser extension must enforce the SAME consent semantics for
 * the same operator, and the modules that decide them are the host-free ones
 * under `extension/src/driver/` in `damianvtran/local-operator`. This script
 * copies them into this repo from a PINNED commit and records, per file, the
 * sha256 of what it wrote, so `check-vendored.mjs` can prove on every CI run
 * that nobody has hand-edited them and that no unlisted file has appeared.
 *
 * WHY A SCRIPT RATHER THAN A SUBMODULE OR A PACKAGE: the UI repo is a
 * standalone public package — a consumer that clones only this repo must build,
 * so it cannot depend on a sibling checkout at build time, and the operator
 * ruled out a second npm publishing pipeline for v1.
 *
 * WHAT IT CANNOT DO, stated because the honest limit is part of the mechanism:
 * it cannot detect drift AGAINST lop. It has no lop checkout on CI, so it
 * proves "this repo's copy is what this repo's manifest says" — never "lop's
 * driver has not moved since". The layer that protects a user from that is the
 * runtime `PROTO_VERSION` check: a mismatched pair gets a typed `proto_mismatch`
 * instead of a mystery timeout (design 12.3).
 *
 * Usage (the pin is always explicit, never "whatever main is now"):
 *
 *   node scripts/sync-vendored.mjs --from <sha|ref> [--repo ~/local-operator] [--force]
 *
 * `--repo` defaults to $LOCAL_OPERATOR_REPO, then to ~/local-operator.
 * `--force` overrides the refusal to run with uncommitted changes in `vendor/`.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = join(ROOT, "src", "main", "browser", "vendor");
const PROVENANCE_PATH = join(VENDOR_DIR, "PROVENANCE.json");
const SOURCE_REPO = "damianvtran/local-operator";

/**
 * The files this repo vendored from `extension/src/driver/`.
 *
 * Each entry names its lop-side path and the vendor-side path it lands at, so
 * a reviewer comparing the two repos has the mapping in one place instead of
 * inferring it from a directory listing.
 */
export const VENDORED_FILES = [
	{ from: "extension/src/driver/access-flow.ts", to: "driver/access-flow.ts" },
	{ from: "extension/src/driver/access-queue.ts", to: "driver/access-queue.ts" },
	{ from: "extension/src/driver/ax-compact.ts", to: "driver/ax-compact.ts" },
	{ from: "extension/src/driver/deadline.ts", to: "driver/deadline.ts" },
	{ from: "extension/src/driver/errors.ts", to: "driver/errors.ts" },
	{
		from: "extension/src/driver/origin-policy.ts",
		to: "driver/origin-policy.ts",
	},
	{
		from: "extension/src/driver/scroll-expressions.ts",
		to: "driver/scroll-expressions.ts",
	},
];

/**
 * Files under `driver/` that this repo does NOT vendor, and why.
 *
 * Recorded rather than left implicit: a reader who lists lop's `driver/` will
 * find `psl.gen.ts` and should be told it is a deliberate omission rather than
 * a forgotten file.
 */
const NOT_VENDORED = [
	{
		file: "extension/src/driver/psl.gen.ts",
		reason:
			"the 157 KB generated public-suffix data. The app does not ship it: a generated blob copied by hand is an artifact with no generator and no check, and this host injects the rules through configurePslRules() instead (fail-closed when absent). See PROVENANCE.patches.",
	},
];

/**
 * The declared adaptations applied to a vendored file.
 *
 * This is the whole deviation surface, and it is data rather than a special
 * case in the copy loop: every hunk is a literal search/replace that must match
 * EXACTLY ONCE, so a re-pin that moves the adapted code fails loudly here
 * instead of silently writing a stale patch. `marker` is asserted by
 * `check-vendored.mjs` so the manifest cannot claim an adaptation the tree does
 * not carry.
 */
export const PATCHES = [
	{
		file: "driver/origin-policy.ts",
		id: "psl-injection",
		marker: "export function configurePslRules(",
		reason:
			"the vendored module imports the full generated PSL (`./psl.gen`), which this host does not ship. The rules are injected once at host start instead, and an absent rule set fails CLOSED: no `domain` option is offered and no stored `domain` grant matches. Exact-origin, loopback-host and one-shot grants are unaffected, and `status.domain_scope` reports which state the host is in.",
		hunks: [
			{
				search: 'import { PSL_RULES } from "./psl.gen";\n',
				replace: `/* ADAPTED — see src/main/browser/vendor/PROVENANCE.json \`patches\`.
 *
 * This file is the vendored copy of \`extension/src/driver/origin-policy.ts\` and
 * differs from it in ONE declared way: the public-suffix rules are injected
 * (configurePslRules) rather than imported from the generated \`psl.gen.ts\`,
 * which this host does not ship. Do not edit it by hand — \`scripts/check-vendored.mjs\`
 * compares it against the manifest and will fail the build. Re-pinning is
 * \`scripts/sync-vendored.mjs --from <ref>\`, which re-applies this adaptation.
 */
`,
			},
			{
				search: `let pslRules: Set<string> | null = null;

/** Parsed lazily: the popup and options bundles never call this, and the
 * worker only needs it on the first broad-grant computation. */
function rules(): Set<string> {
  if (!pslRules) pslRules = new Set(PSL_RULES.split("\\n"));
  return pslRules;
}
`,
				replace: `let pslRules: Set<string> | null = null;

/**
 * ADAPTED: install the public-suffix rules, once, before any approval is read.
 *
 * \`null\` (no rules available) is a supported state and not an error: it removes
 * the \`domain\` option and leaves every exact-origin decision untouched, which is
 * the fail-closed direction. See the file header for why the data is injected.
 */
export function configurePslRules(rules: string | null): void {
  pslRules = rules ? new Set(rules.split("\\n")) : null;
}

/** Whether the \`domain\` scope can be evaluated at all. Surfaced by \`status\` so
 * "why is there no 'all pages on this domain' option" has an answer. */
export function domainScopeAvailable(): boolean {
  return pslRules !== null;
}

/** ADAPTED: no lazy parse and no fallback table. An empty set here means "no
 * rules were configured", which the caller below turns into the fail-closed
 * answer rather than into "every host is a public suffix". */
function rules(): Set<string> {
  return pslRules ?? new Set<string>();
}
`,
			},
			{
				search: `  const table = rules();
  // Public-suffix label count under the best matching rule. Default rule \`*\`
  // makes the last label the suffix.
  let suffixLabels = 1;
`,
				replace: `  const table = rules();
  // ADAPTED: with the rules injected rather than imported, an empty table is the
  // "no PSL data available" case. Falling through would apply the implicit \`*\`
  // rule and offer \`example.com\`-shaped domains as if they were registrable —
  // the opposite of fail-closed. The answer is "no domain option".
  if (table.size === 0) return null;
  // Public-suffix label count under the best matching rule. Default rule \`*\`
  // makes the last label the suffix.
  let suffixLabels = 1;
`,
			},
		],
	},
];

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function git(repo, args) {
	return execFileSync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function parseArgs(argv) {
	const options = { from: "", repo: "", force: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--from") options.from = argv[++index] ?? "";
		else if (arg === "--repo") options.repo = argv[++index] ?? "";
		else if (arg === "--force") options.force = true;
		else throw new Error(`unknown argument '${arg}'`);
	}
	if (!options.from) {
		throw new Error(
			"--from <ref> is required: the pin is a deliberate value, never 'whatever main is now'",
		);
	}
	options.repo =
		options.repo ||
		process.env.LOCAL_OPERATOR_REPO ||
		join(homedir(), "local-operator");
	return options;
}

/** The app's protocol version, read from the file the wire actually uses. */
function appProtoVersion() {
	const source = execFileSync(
		"cat",
		[join(ROOT, "src", "main", "browser", "protocol.ts")],
		{ encoding: "utf8" },
	);
	const found = /export const PROTO_VERSION = (\d+)/.exec(source);
	if (!found) {
		throw new Error(
			"src/main/browser/protocol.ts has no `export const PROTO_VERSION = <n>`",
		);
	}
	return Number(found[1]);
}

/** The vendored file's bytes: lop's blob with this file's declared adaptations. */
export function applyPatches(path, source) {
	const patch = PATCHES.find((candidate) => candidate.file === path);
	if (!patch) return source;
	let text = source;
	for (const [index, hunk] of patch.hunks.entries()) {
		const occurrences = text.split(hunk.search).length - 1;
		if (occurrences !== 1) {
			throw new Error(
				`patch '${patch.id}' hunk ${index + 1} for ${path} matched ${occurrences} times, expected exactly 1 — the upstream code moved, so the adaptation must be re-derived before re-pinning`,
			);
		}
		text = text.replace(hunk.search, hunk.replace);
	}
	if (!text.includes(patch.marker)) {
		throw new Error(
			`patch '${patch.id}' produced no marker in ${path}: the adaptation is not present`,
		);
	}
	return text;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));

	// Refuse to run over uncommitted changes in `vendor/`: a re-pin diff must be
	// reviewable as "the ref moved, and here is exactly what that changed", and a
	// local edit folded into it is invisible in that diff.
	if (!options.force) {
		const dirty = git(ROOT, [
			"status",
			"--porcelain",
			"--untracked-files=all",
			"--",
			"src/main/browser/vendor",
		]).trim();
		if (dirty) {
			throw new Error(
				`src/main/browser/vendor has uncommitted changes; commit or discard them first, or pass --force:\n${dirty}`,
			);
		}
	}

	const sha = git(options.repo, [
		"rev-parse",
		"--verify",
		`${options.from}^{commit}`,
	]).trim();
	const protocolSource = git(options.repo, [
		"show",
		`${sha}:local_operator/browser_bridge/protocol.py`,
	]);
	const protoVersion = /^PROTO_VERSION\s*=\s*(\d+)/m.exec(protocolSource)?.[1];

	const inputs = [sha, "local_operator/browser_bridge/protocol.py", protocolSource];
	const files = {};
	const written = [];
	for (const entry of VENDORED_FILES) {
		const source = git(options.repo, ["show", `${sha}:${entry.from}`]);
		inputs.push(entry.from, source);
		const text = applyPatches(entry.to, source);
		const target = join(VENDOR_DIR, entry.to);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, text);
		files[entry.to] = sha256(text);
		written.push(`${entry.to} (${text.split("\n").length} lines)`);
	}

	// Files that were vendored by an earlier pin and are no longer in the list are
	// removed, so `check-vendored`'s "no unlisted file" rule stays satisfiable
	// instead of failing on a leftover the sync itself left behind.
	const keep = new Set([
		"PROVENANCE.json",
		...VENDORED_FILES.map((entry) => entry.to),
	]);
	for (const entry of execFileSync("find", [VENDOR_DIR, "-type", "f"], {
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean)) {
		const relativePath = relative(VENDOR_DIR, entry);
		if (!keep.has(relativePath)) {
			rmSync(entry);
			console.log(`removed stale vendored file ${relativePath}`);
		}
	}

	const provenance = {
		source_repo: SOURCE_REPO,
		source_ref: sha,
		proto_version: protoVersion ? Number(protoVersion) : null,
		app_proto_version: appProtoVersion(),
		inputs_sha256: sha256(inputs.join("\u0000")),
		generator: "scripts/sync-vendored.mjs",
		patches: PATCHES.map((patch) => ({
			file: patch.file,
			id: patch.id,
			marker: patch.marker,
			reason: patch.reason,
		})),
		not_vendored: NOT_VENDORED,
		files,
	};
	writeFileSync(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`);

	console.log(`vendored ${VENDORED_FILES.length} files from ${sha}`);
	for (const line of written) console.log(`  ${line}`);
	console.log(
		`PROVENANCE.json: proto_version=${provenance.proto_version} inputs_sha256=${provenance.inputs_sha256}`,
	);
	console.log(
		`note: this proves nothing about drift against lop — run scripts/check-vendored.mjs for the in-repo gate.`,
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`sync-vendored failed: ${error.message}`);
		process.exitCode = 1;
	});
}
