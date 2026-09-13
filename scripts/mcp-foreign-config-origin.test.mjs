import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The Integrations panel's copy of the backend's foreign-config table.
 *
 * `mcp-foreign-config-origin.ts` is a port of `_FOREIGN_MCP_CONFIGS` /
 * `_foreign_config_origin` (`local_operator/mcp/verbs.py`), and a port whose
 * rules are only checked by looking at a rendered row drifts from its source
 * the first time either side is edited. Parity with the Python table cannot be
 * asserted from this repository — the authority is Python, in another repo —
 * but the matching BEHAVIOUR can, and is here: every fragment pair, the
 * `.claude.json` / `.claude/.mcp.json` disambiguation, the near misses that
 * must NOT match, and the Windows-shaped path the shipped `dist:win` build
 * sends.
 *
 * The cases below are the matrix the round-2 review ran by hand (27/27); this
 * file is that matrix with a guard on it.
 */

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/shared/mcp-foreign-config-origin";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { foreignMcpConfigOrigin } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("each foreign config names the tool that owns it", () => {
	/** @type {[string, string][]} */
	const cases = [
		["/Users/damian/.claude.json", "Claude Code"],
		["/Users/damian/.claude/.mcp.json", "Claude Code"],
		["/Users/damian/.cursor/mcp.json", "Cursor"],
		["/Users/damian/.vscode/mcp.json", "VS Code"],
		["/Users/damian/.codex/config.toml", "Codex CLI"],
	];
	for (const [source, origin] of cases) {
		assert.equal(foreignMcpConfigOrigin(source), origin, source);
	}
});

test("the two Claude files are disambiguated by their own fragments", () => {
	// `.claude.json` is a FILE in the home directory; `.claude/.mcp.json` is a
	// file in a directory that happens to share the prefix. A prefix match would
	// confuse them, and the backend compares fragments for this reason.
	assert.equal(
		foreignMcpConfigOrigin("/Users/damian/.claude.json"),
		"Claude Code",
	);
	assert.equal(
		foreignMcpConfigOrigin("/Users/damian/.claude/.mcp.json"),
		"Claude Code",
	);
	assert.equal(foreignMcpConfigOrigin("/Users/damian/.claude/mcp.json"), null);
	// A directory named like the file's stem must not be read as the file.
	assert.equal(
		foreignMcpConfigOrigin("/Users/damian/.claude.json.backup"),
		null,
	);
});

test("near misses match nothing rather than a longer path's owner", () => {
	const unmatched = [
		"/Users/damian/.cursor/mcp.json.bak",
		"/Users/damian/mycursor/mcp.json",
		"/Users/damian/.cursorx/mcp.json",
		"/Users/damian/.codex/config.toml.bak",
		"/Users/damian/.vscode/settings.json",
		// A bare fragment with no directory above it is not a foreign config.
		"config.toml",
		"mcp.json",
		"/Users/damian/.mcp.json",
		"/Users/damian/project/.local-operator/mcp.json",
		"/var/tmp/scratch/config.toml",
	];
	for (const source of unmatched) {
		assert.equal(foreignMcpConfigOrigin(source), null, source);
	}
});

test("separators and shapes the wire can send still match, and name the owner", () => {
	// Asserting the owner, not merely "something matched": a match that returned
	// the WRONG tool would satisfy a non-null check, and on the Windows arm the
	// question is exactly whether the owner survives at all.
	/** @type {[string, string][]} */
	const cases = [
		// Windows: the wire value is `str(Path)`, so the shipped dist:win build
		// sends backslashes while the backend's `Path(source).parts` still
		// matches. A POSIX-only split silently dropped the owner there, which is
		// why normalisation exists and why these cases are pinned to a name.
		["C:\\Users\\damian\\.codex\\config.toml", "Codex CLI"],
		["C:\\Users\\damian\\.claude.json", "Claude Code"],
		["C:\\Users\\damian\\.cursor\\mcp.json", "Cursor"],
		["C:\\Users\\damian\\.vscode\\mcp.json", "VS Code"],
		// macOS resolves a /var home to /private/var, and a home may be a symlink.
		["/private/var/root/.codex/config.toml", "Codex CLI"],
		["/home/someone/.cursor/mcp.json", "Cursor"],
		// A relative cwd reaches the same trailing fragments.
		["project/.cursor/mcp.json", "Cursor"],
		[".codex/config.toml", "Codex CLI"],
		// A trailing separator is not expected from the wire, but must not turn
		// a match into a mismatch.
		["/Users/damian/.codex/config.toml/", "Codex CLI"],
	];
	for (const [source, origin] of cases) {
		assert.equal(foreignMcpConfigOrigin(source), origin, source);
	}
});

test("an unknown or absent source is never given a guessed owner", () => {
	for (const source of [
		null,
		undefined,
		"",
		"/Users/damian/.config/other.json",
	]) {
		assert.equal(foreignMcpConfigOrigin(source), null, String(source));
	}
});
