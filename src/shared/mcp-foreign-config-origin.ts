/**
 * Which tool owns a foreign MCP config file, for the Integrations panel.
 *
 * `load_all_mcp_configs` merges eight sources and only two of them are
 * local-operator's to write, so a server the panel cannot remove needs its row
 * to say WHO owns it. "Remove it there" is a dead end while the reader is still
 * hunting for what writes the file; naming the tool makes it an instruction.
 *
 * **The authority is the backend, not this table.** `mcp/verbs.py`'s
 * `_FOREIGN_MCP_CONFIGS` already maps these same trailing fragments to these
 * same origins for the TUI's `/mcp remove` refusal, and its docstring states
 * the principle this file exists to honour. This is a copy, kept because
 * `DesktopMcpState` carries no origin field and the sentence has to be
 * rendered today.
 *
 * The wire is the right home for it, and it is deliberately not in this
 * change: adding `source_origin` (plus the `~`-relative form the sentence
 * needs) is a `local-operator` backend change that must ship and be released
 * before this repository can read it, while this panel's copy is already
 * broken. The duplication, and the fact that nothing here is asserted against
 * the backend's list, are the price of not blocking a shipped bug on a backend
 * release; both go away when the field does. A parity assertion is not
 * available to this repository — the authority is Python, in another repo.
 *
 * An unmatched source returns `null`, and the caller falls back to the honest
 * sentence rather than guessing a tool from a path this table does not know.
 */

/**
 * Trailing path fragments of the configs this app reads but must not write,
 * to the tool that owns each. Same order and same owners as
 * `local_operator/mcp/verbs.py`, minus its `.mcp.json` entry: that one's owner
 * is the project rather than a tool, so it falls through to the caller's
 * tool-less sentence instead of being named here.
 */
const FOREIGN_MCP_CONFIG_ORIGINS: readonly (readonly [
	readonly string[],
	string,
])[] = [
	[[".claude.json"], "Claude Code"],
	[[".claude", ".mcp.json"], "Claude Code"],
	[[".cursor", "mcp.json"], "Cursor"],
	[[".vscode", "mcp.json"], "VS Code"],
	[[".codex", "config.toml"], "Codex CLI"],
];

/**
 * The tool that owns `source`, or `null` when this table does not know it.
 *
 * Suffix matching rather than prefix or whole-path equality: the same file is
 * reached through a symlinked home, a resolved `/private/var` prefix, or a
 * relative session cwd, and the trailing fragments are the only part that is
 * the same on every machine — the backend compares fragments for the same
 * reason.
 */
export function foreignMcpConfigOrigin(
	source: string | null | undefined,
): string | null {
	if (!source) return null;
	const parts = source.split("/").filter(Boolean);
	for (const [fragment, origin] of FOREIGN_MCP_CONFIG_ORIGINS) {
		if (parts.length < fragment.length) continue;
		if (parts.slice(-fragment.length).join("/") === fragment.join("/"))
			return origin;
	}
	return null;
}
