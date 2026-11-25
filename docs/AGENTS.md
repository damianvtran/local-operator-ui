# Agent notes — workspace layout and chrome

Use this checklist alongside the [branding contract](branding.md), which owns
geometry, material and interaction rationale.

## Primary workspace and rails

- **One rounded, unbordered [Shared inset](branding.md#shared-inset-for-primary-pages).**
  Use `WorkspaceFrame` across route states. Chat, Agent Hub, Library, Projects
  and Notifications share that boundary, not a common layout. Settings and
  Agents frame only their content, with even gutters beside their edge-to-edge
  secondary rails. Do not nest frames, add canvas backing, outline layout
  regions or turn columns into a card grid.
- **Keep the app sidebar full height.** At an edge-to-edge rail, the box that
  paints the ground also owns title-bar clearance, outside the scroller. Use
  the shared rail top cue (`data-lo-sidebar-edge-cues` in the app sidebar),
  not an inset band or a border. A legacy flush join may have one `PanelEdge`;
  no seam where an inset gutter already separates the grounds. Library's
  filter rail is local to its frame, not window-edge chrome.
- **Fade the inner scroll edges, not the frame.** Use `data-lo-pane-edge-cues`
  for the paired cues where content can scroll further; use the bottom-only
  variant for a pinned top header and keep controls out of the mask. Chat uses
  its own transcript cue and keeps the composer outside the scroller. When the
  Library detail cannot fit beside its list, replace the list instead of
  floating the dock over it.

## Title bar, sidebar rows and composer

- **Tabs above Chat's inset controls.** Integrated chrome keeps native drag
  space and reserves `no-drag` for full interactive hit areas. Test mouse and
  keyboard separately. Native Browser owns its tab/address chrome; don't add
  the Chat strip to other routes. Keep editable conversation context where
  supported and trim redundant route headings, not meaningful titles.
- **Quiet, visible states.** Workspace selectors and icon buttons rest without
  paper or stroke. Keep hover and focus visible without moving rows or controls.
  The [Chat tab rule](branding.md#shared-inset-chat-workspace) describes the
  selected-only fill and no-rail target tracked in #2109; don't apply the
  nested glass-pane tab rule to the title bar. Preserve separate pinned and
  regular lanes, bounded overflow, keyboard moves and safe tab cleanup.
- **Align sidebar sections.** Teams and Agents share `SidebarSectionHeading`,
  label inset and spacing with Today and Running. Uppercase only the visual
  group label. Align leading content and trailing hover/focus actions without
  reflow, and keep launcher actions separate from history/manage actions. The
  [conversation row target](branding.md#shared-inset-chat-workspace) calls for
  one persistent selection fill, brighter dark hover and independent focus;
  the sidebar follow-up is separate from #2109.
- **Keep the [Nested dock](branding.md#composer-the-nested-dock) matte in Chat.**
  Status above; context shelf and writing well in one dock; staged files and
  draft actions in the editor. Frost/gloss is subtle and must not change the
  glass coverage or add a resting or focus frame. Keep visible caret and
  control focus.

For public asset reuse, follow the [signature helix](branding.md#signature-helix-optional-brand-motion)
contract: optional decorative motion with a complete static fallback.
