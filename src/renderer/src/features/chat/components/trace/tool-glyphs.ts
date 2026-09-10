/**
 * One glyph per tool name, carried across from the TUI's two icon tables.
 *
 * The TUI ships a nerd-font table and a plain-ASCII one (`tui/glyphs.py`), and
 * neither ports literally: a `\uf120` is a font artefact and a `$` is a
 * terminal drawing a picture with the characters it has. What ports is the
 * MEANING each one carries, and the grouping — read, mutate, exec, meta — that
 * lets a run of rows be scanned by shape rather than read word by word. So each
 * name maps to the lucide icon of the same meaning, at the system's one stroke
 * weight (docs/branding.md § 5: the weight is never written down).
 *
 * Two fallbacks stay distinct, exactly as the TUI keeps them distinct: an
 * unknown tool is a WRENCH and an `mcp__*` tool is a PLUG. They answer
 * different questions — "I do not know this tool" versus "this came from a
 * server you connected" — and collapsing them costs the second, which is the
 * one a user can act on.
 *
 * Lookup is case-insensitive because a tool name is MODEL-controlled: a
 * provider that echoes `Bash` back must not silently drop to the wrench.
 */

import {
	Check,
	CircleSlash,
	Clock,
	Download,
	FilePen,
	FileText,
	FolderOpen,
	Globe,
	Inbox,
	ListChecks,
	type LucideIcon,
	Plug,
	Search,
	Send,
	Tag,
	Terminal,
	Users,
	Wrench,
	X,
} from "lucide-react";

const MCP_PREFIX = "mcp__";

/**
 * The table, in the TUI's own order so the two can be diffed by eye.
 *
 * `eval`, `hub`, `ask` and `team` are deliberately absent from the TUI's table
 * and take its default wrench; they are absent here for the same reason. Giving
 * them an icon would be a divergence rather than an improvement — the
 * operator's own screenshot shows a wrench beside `team`.
 */
const TOOL_ICONS: Record<string, LucideIcon> = {
	bash: Terminal,
	read: FileText,
	write: FilePen,
	edit: FilePen,
	glob: FolderOpen,
	grep: Search,
	todo: ListChecks,
	wake: Clock,
	list_variables: Tag,
	read_variable: Tag,
	browser: Globe,
	web_search: Globe,
	web_fetch: Download,
	task: Users,
	agent: Users,
	send: Send,
	peer: Inbox,
};

export function toolIcon(toolName: string): LucideIcon {
	const name = toolName.trim().toLowerCase();
	const icon = TOOL_ICONS[name];
	if (icon) return icon;
	return name.startsWith(MCP_PREFIX) ? Plug : Wrench;
}

/**
 * The outcome glyphs.
 *
 * `ICON_SUCCESS`/`ICON_ERROR`/`ICON_INTERRUPTED` (tool_card.py:122-128) are
 * `✓`, `✗` and `⊘`. They render as icons rather than as literal characters so
 * they sit on the app's own icon ramp beside the tool glyph, but the contract
 * is unchanged and it is the load-bearing one: **the three must be
 * distinguishable with no colour at all**. A tick, a cross and a slashed circle
 * differ in SHAPE; tint is a second channel and never the only one.
 *
 * There is deliberately no fourth entry for a running row. A running row shows
 * NO outcome glyph — the empty status column is what says "still running" — and
 * a glyph invented for it would be the one thing that breaks that rule.
 */
export const SuccessGlyph = Check;
export const ErrorGlyph = X;
export const InterruptedGlyph = CircleSlash;
