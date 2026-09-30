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
	Columns3,
	Download,
	FilePen,
	FileText,
	FolderOpen,
	Globe,
	Inbox,
	ListChecks,
	type LucideIcon,
	MailQuestion,
	Mailbox,
	Monitor,
	PictureInPicture2,
	Plug,
	Search,
	Send,
	Tag,
	Terminal,
	Trash2,
	Users,
	Wrench,
	X,
} from "lucide-react";

const MCP_PREFIX = "mcp__";

/**
 * The table, in the TUI's own order so the two can be diffed by eye.
 *
 * `eval`, `hub`, `ask`, `team`, `lsp`, `wait`, `jobs`, `secret`, `network`,
 * `web_read` and `team_delete` are deliberately absent from the
 * TUI's table and take its default wrench; they are absent here for the same
 * reason. Giving them an icon would be a divergence rather than an
 * improvement — the operator's own screenshot shows a wrench beside `team`.
 * The one entry this table had fallen behind on is `console`, which the TUI
 * DOES map (`glyphs.py`: nf-fa-desktop, deliberately a different noun from
 * `bash`'s terminal - a terminal running inside the app rather than the shell
 * this process runs), so it is mirrored here as the desktop-shaped `Monitor`.
 *
 * `project` and `project_delete` were on the absent list by the same rule,
 * and they leave it WITH the TUI rather than ahead of it (review round 1,
 * D2/D4 — the first cut of this pair took `FolderKanban` alone, and the
 * sibling's own rationale retired it): the sibling coder's
 * `feat/tui-project-line-15c4` branch in `damianvtran/local-operator` adds
 * BOTH marks to `local_operator/tui/glyphs.py` in commit `4ce339597`. The
 * project line takes nf-fa-columns — "Deliberately not a folder: `glob`'s
 * folder is a location on disk, and a project is the workstream" — and
 * `project_delete` takes nf-fa-trash_o, "its removal is irreversible ..., so
 * it must not ride a quiet read/update glyph". This table mirrors both
 * meanings with the lucide marks of the same nouns: `Columns3` (a board of
 * tracks — not `FolderOpen`, `glob`'s folder, and not `ListChecks`, `todo`'s
 * list) and `Trash2` (the irreversible removal the TUI's rationale names).
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
	console: Monitor,
	project: Columns3,
	project_delete: Trash2,
	web_search: Globe,
	web_fetch: Download,
	task: Users,
	agent: Users,
	send: Send,
	peer: Inbox,
	/*
	 * `sessions` mirrors the TUI's `nf-fa-window_restore` (a SECOND window
	 * opened beside this one - the noun for a PARALLEL SESSION, which is what
	 * the sessions tool opens and manages) in this repo's own vocabulary,
	 * never the same codepoint by force. `PictureInPicture2` is the one lucide
	 * mark that draws two windows, one beside the other; `AppWindow` was the
	 * alternate and it shows a single window (and already means "opens in its
	 * own app" at `link-toolkit.tsx`'s `open-default`), while `Copy` and
	 * `SquareStack` are the copy/stack shapes the sibling's own rationale
	 * retired for `nf-fa-clone` - a spawned workstream is its own run, not a
	 * copy of this one. Deliberately not `Users` (`task`/`agent` hand work to a
	 * CHILD; a peer session is a window of its own that this session watches
	 * rather than owns) and not `Send` (a note to a peer). The TUI counterpart
	 * (`damianvtran/local-operator` PR #1825) renders its own pick for a design
	 * round; a design round on these frames owns the last word here too.
	 */
	sessions: PictureInPicture2,
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
 *
 * ## The two `send` delivery marks, and why they are not the tick or the cross
 *
 * A `send` can settle in two ways that are neither: the message landed but the
 * wake got no answer (`mailbox`), or nothing confirmed that it landed at all
 * (`unconfirmed`). Both are non-errors, so painting them `✗` would be the false
 * non-delivery claim the core stopped making; both are not successes, so `✓`
 * would claim an answered wake the sender never got.
 *
 * They take a SHAPE of their own so the two read apart with the colour off,
 * which is the same reason the pair above is three shapes and not three tints:
 * `Mailbox` is the noun the state is named for (the message is sitting in the
 * recipient's tray), and `MailQuestion` is a message carrying a question - "we do
 * not know where this one is" - chosen over the dashed circle the fourth state
 * first drew, which is the app's BUSY silhouette (`chat-session-status.tsx`'s and
 * `chat-status-strip.tsx`'s spinning loader circle) and so said "still working"
 * on a settled row (UX round 1, U5). Neither is `Inbox` (`peer`'s own tool glyph)
 * nor `Send` (`send`'s), so a row's mark and its tool glyph cannot be read as each
 * other.
 */
export const SuccessGlyph = Check;
export const ErrorGlyph = X;
export const InterruptedGlyph = CircleSlash;
export const MailboxGlyph = Mailbox;
export const DeliveryUnconfirmedGlyph = MailQuestion;
