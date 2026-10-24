# Page context menu: Undo and Redo (U8)

Real-app evidence for the editable-target menu. `matrix.md` and `facts.json` are
one run's output; `rig.mjs` is the run that produced them.

## What was exercised

The built app was booted in the shipped `headless` window mode against a scratch
HOME/config/log/profile, with notifications and telemetry off, and a real browser
tab was opened on a local fixture. A real right-click was dispatched through CDP
into the driven page's `WebContentsView`, so the app's own `context-menu` handler
ran and its `buildPageContextMenuItems` result became the native menu template.

The only replacement is `Menu.popup`, suppressed so the run does not raise a
native menu on the operator's desktop. The template — labels, order, enabled
state — is recorded from the real handler, and each template's own `click`
callback is invoked afterwards, so `contents.undo()`/`contents.redo()` execute
against the real page and the resulting field value is read back.

The non-editable row uses a plain paragraph; the contenteditable row proves the
same edit group follows Chromium's `isEditable`, not an input-element check.

## Rows

`matrix.md` records every row with its actual output. All six passed:

- Undo, Redo, separator, Cut: Undo and Redo lead the edit group.
- Empty field: Undo and Redo disabled (`canUndo`/`canRedo` false).
- Real insertion: Undo enabled, Redo disabled; Undo's own action clears the field.
- After Undo: Redo enabled; its own action restores the text.
- Non-editable page: no Undo/Redo/Cut/Copy/Paste/Select all; navigation items only.
- Contenteditable: the same edit group, no navigation items.

## Reproduce

From the repository root, at this head:

```sh
pnpm build
node docs/pr-evidence/browser-menu-undo-redo/rig.mjs
```

The rig rewrites `matrix.md`/`facts.json` in this directory and keeps its scratch
tree under `run/` (ignored by git). It exits non-zero if any row fails.

Build identity of the run recorded here: head `b58c2864776b6668c7ea760ffb804539c6f95444`,
`out/main/index.jsc` sha256 `f794a085aa9c9c0c63590ea3b765d42d1025e447a66050446dcb00ae66295685`.

## Not measured

Native NSMenu painting and a physical click on a menu row. Both are OS-level and
belong to independent QA or a human. The rig asserts the template the app hands
the OS and the actions behind it, never that macOS drew the row a particular way.
