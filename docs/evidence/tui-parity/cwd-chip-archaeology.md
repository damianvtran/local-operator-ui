# Working-directory chip — archaeology and port plan

Scout finding, v0.16.0. Written up from the read-only audit so the implementing
agent does not have to re-derive it.

## Headline

**The chip was never removed.** `directory-indicator.tsx` is a complete,
correctly themed Tailwind/shadcn chip and it is still mounted in the composer.
It is gated so it can never render.

`message-input.tsx:667`:

```tsx
{conversationId && !canonicalStop && (
    <DirectoryIndicator agentId={conversationId} currentWorkingDirectory={agentData?.current_working_directory} />
)}
```

`chat-page.tsx:417` passes `canonical={{ view, busy, admitting, onStop }}`
**unconditionally**, and `chat-content.tsx:351` forwards it as `canonicalStop`
whenever `canonical` is set. In the canonical chat — the only chat there is —
`canonicalStop` is always truthy, so `!canonicalStop` is always false.

Confirmed against tags: `v0.14.0`, `v0.15.0` and `v0.15.2` all have
`{conversationId && (`. `v0.16.0` has `{conversationId && !canonicalStop && (`.
The regression landed in v0.16.0.

Its only live render site today is `canvas/create-file-dialog.tsx:213`, which is
why the file never showed up as unused.

## Flipping the gate is not enough

Two further breaks, both fatal:

- `chat-page.tsx` never passes `agentData` to `ChatContent`, so
  `currentWorkingDirectory` is `undefined` and the chip would render its
  "No working directory set" empty state forever.
- `agentId={conversationId}` is `identity` = `draftKey ?? sessionId`, a 12-hex
  session id (`SESSION_ID = /^[a-f0-9]{12}$/`, chat-page.tsx:24) or a draft key
  — **not an agent UUID**. `handleSelectDirectory` calls `useUpdateAgent` →
  `client.agents.updateAgent(agentId, {...})`, i.e. it would PATCH the legacy
  agents REST API with a session id.

The right sources already exist:

- display: `canonical.frontend.cwd` (`desktop-session-contract.ts:82`,
  populated by the backend at `frontend_state.py:1523`/`3031`)
- draft writes: the store's `cwd` / `setCwd`
  (`canonical-sessions-store.ts:192-193`, `260-261`)

## Mid-session cwd change is backend work, not a UI port

- The TUI has `/move` (`slash_commands.py:133-148`,
  `desktop_destination="session.move"`), backed by
  `RemoteSession.set_working_directory` (remote.py:1503 — cold = field assign,
  bound = retire-and-rebind, busy = refuse).
- The UI's `DESTINATIONS` map (`picker-registry.tsx:59-107`) has no
  `session.move` key, so `/move` dead-ends at `slash-dispatch.ts:239-250` on
  "not available in the desktop app yet".
- `move` is in `_FRONTEND_LOCAL_SLASHES` (`frontend_state.py:671`) and absent
  from `OWNER_COMMANDS` (`desktop_commands.py:17-31`): `sessions.command`
  returns a bare `native_action` and never executes. **No HTTP route calls
  `set_working_directory`.**
- `sessions.create` is the only cwd write path that exists
  (`desktop_sessions.py:73`, `229`, `484-487`).

Scope accordingly: the chip **sets** cwd on draft sessions (`setCwd` →
`admitChatDraft` → `createSession(cwd)` → `sessions.create`), and **displays**
read-only `canonical.frontend.cwd` on live ones. A live `/move` is a separate
ticket.

## The chip, faithfully

**MUI era (v0.12.8)** — what the operator remembers visually: `borderRadius: 8px`,
`height: 32px`, `maxWidth: 260px`, `padding: 0 12px`, label `0.85rem` with
`letterSpacing: 0.01em` and ellipsis, fill `alpha(primary.main, 0.06)` → hover
`0.10`, ink `text.secondary` → hover `text.primary`, leading `faFolderOpen` at
`alpha(text.primary, 0.6)`.

Two details that must **not** be ported: `transform: translateY(-1px)` on hover
and `transition: all 0.15s`. branding.md:254 — "Nothing lifts, scales, or
translates on hover. Hover is a colour step."

**Current Tailwind version** is the correct base and needs no restyling:
`Button variant="ghost"` (`text-ink-muted` → `hover:bg-accent-wash
hover:text-ink`, button.tsx:167-172) at `size="md"` = `h-8 rounded-sm px-3` —
32px tall, 6px radius, matching branding.md:232's control rule — with
`max-w-65 justify-start`, `PATH_TYPE = "font-mono text-mono-sm"` (12px, machine
voice per branding.md:193), a `FolderOpen` leading glyph and a `truncate` span.

**Label**: `formatDirectory` (lines 290-316) renders `~`, `~/rel/path`, or the
absolute path, normalising `\` → `/`, using `window.api.getHomeDirectory()`
fetched on mount. Matches the TUI's `format_label` (`move_targets.py:107`),
including the documented divergence — the home dir renders `~` here and `~/.`
on the TUI band.

**Click**: a `DropdownMenu` with four tiers —

1. Custom directory → `Enter custom path...` (`Pencil`, swaps the chip for an
   inline `Input`; Enter commits, Escape reverts, blur commits) and
   `Browse for directory...` (`FolderTree`, `window.api.selectDirectory()`)
2. Recent directories (`Clock`, from `recent-directories-store.ts`, max 5,
   localStorage-persisted, tooltip past 42 chars)
3. Default directories (OS-conditional: `~`/Downloads/Documents/Desktop/
   Pictures/Music/Videos plus per-platform extras, each with a right-aligned
   `text-ink-dim` path)

Tooltip "Click to change working directory", `side="right"`. Position: inside
`COMPOSER_BOX`, in the toolbar's left group immediately after the Paperclip
attach button — exactly where the operator remembers it.

Worth stealing later: the TUI's `suggest_targets` tier order
(`move_targets.py:320-404`) is a better recents model than the current store —
current dir first, then live session dirs / wake-armed / remembered, then home
and `/tmp`, then parent and children, deduped on `os.path.realpath`.

## The fix, concretely

1. `message-input.tsx:667` — drop `&& !canonicalStop`; gate on having a cwd
   source instead.
2. Add a `cwd` / `onChangeCwd` prop pair through `chat-page.tsx` →
   `chat-content.tsx` → `message-input.tsx`, sourced from
   `canonical.frontend?.cwd` and the store's `setCwd`. Stop passing `agentId`
   for a REST PATCH that cannot work.
3. `chat-page.tsx:285-296` — delete the `<label>Working directory <input/></label>`
   bar; the chip replaces it.
4. Keep the existing ghost-button colour step; do not revive the MUI
   `transform`/`transition: all` hover.
5. Editable while `draftKey` is set; read-only with an explanatory tooltip on a
   live session until a backend move endpoint exists.

Every `className` goes through `cn` from `@shared/lib/utils` (AGENTS.md:66-70);
the existing file already complies. User-visible, so it needs a design round.
