# Rendered width evidence — Hindi and Vietnamese tag repair

Frames for the copy this pair of repairs changed, captured on the combined head
`cb39abf98a` (before the evidence commit). The tag surfaces are the real
`ChatSidebar` from `src/renderer/src/features/chat/components/chat-sidebar-tags.stories.tsx`;
the Library rail is the real `LibraryPage` from
`src/renderer/src/features/library/components/library.stories.tsx`. No mock
components were written for this evidence.

## Renderer

- Storybook 8.6.12 (react-vite), preview iframe measured at **1280×720 CSS**
  (the move dialog centres at x=640 and the rail is 720 tall), devicePixelRatio
  2, so the captures are 2560×1440 PNGs, committed as WebP.
- Frames were taken in the operator's own browser through the `browser` tool —
  no second browser engine, no Playwright/Puppeteer.
- Locale is the preview's own `locale` arg (`?args=locale:hi` / `locale:vi`),
  which writes through the renderer locale store's `setLocale` seam.
- Sidebar width is the story's `width` arg: 220 (the narrow case). Storybook's
  own control permits 220/260/320; 600 is the application viewport floor, so
  that case is rendered in a 600×720 iframe wrapping the same story.

## Commands / story ids

| Frame | Story id | Args |
|---|---|---|
| `hi-tag-menu-220.webp` | `chat-sidebar-tags--tag-actions-menu` | `locale:hi;width:220` |
| `hi-tag-menu-600.webp` | same story in a 600×720 iframe (scratch harness) | `locale:hi;width:220` |
| `hi-tag-picker-220.webp` | `chat-sidebar-tags--move-picker` | `locale:hi;width:220` |
| `hi-clear-toast-220.webp` | `chat-sidebar-tags--tag-actions-menu`, Clear all pressed | `locale:hi;width:220` |
| `hi-conflict-alert-220.webp` | `chat-sidebar-tags--move-conflict`, Concept pressed | `locale:hi;width:220` |
| `vi-tag-menu-220.webp` | `chat-sidebar-tags--tag-actions-menu` | `locale:vi;width:220` |
| `vi-tag-picker-220.webp` | `chat-sidebar-tags--move-picker` | `locale:vi;width:220` |
| `vi-clear-toast-220.webp` | `chat-sidebar-tags--tag-actions-menu`, Clear all pressed | `locale:vi;width:220` |
| `vi-conflict-alert-220.webp` | `chat-sidebar-tags--move-conflict`, Concept pressed | `locale:vi;width:220` |
| `hi-library-scope-rail-192.webp` | `library-tab--scope` | `locale:hi` |

## Measured geometry (live DOM, `browser` tool `styles`)

| Surface | Rect (CSS px) | Notes |
|---|---|---|
| Tag context menu, 220 sidebar | **296.22 × 342** at x=2 | Portalled overlay, `overflow-x: hidden`, `overflow-y: auto`; it is wider than the 220 sidebar by design and is not clipped by it. |
| Tag context menu, 600 viewport | **296.22 × 342** | Fully inside the 600×720 viewport; right edge ≈ 298. The menu is content-width, so it does not shrink with the viewport. |
| Move picker dialog | **420 × 317.4**, `max-width: 512` | Centred at 1280; at 600 it centres at 300 with 90px each side. |
| Clear-all toast | **356 × 50**, 12px type | Right-aligned with 24px inset; fits 600 with 244px to spare. |
| Library filter rail | **191 × 720** (`w-48` = 192 incl. 1px border) | `overflow-y: auto`; the Scope section shows `दायरा`, `अंतिम एसेट`, `सभी शामिल एसेट` with the count, no ellipsis. |
| 600-floor menu proof | story `chat-sidebar-tags--tag-actions-menu-600` | Its own assertion: 220px sidebar, 600px viewport floor, 10 rows, max-height 300px, scroll 298/340, ≥32px targets, End/Home reach all items. |

## Verdicts

- **Hindi: PASS.** `टैग…`, `सभी टैग हटाएँ (2)`, `टैग में ले जाएँ…`, the picker title
  and description, `सभी टैग हटा दिए गए` + `पूर्ववत करें`, and `टैग कहीं और बदले गए`
  all render whole. No ellipsis, no wrap break, no clipped button or row; the
  picker text wraps naturally to two lines; the toast stays on one line.
- **Vietnamese: PASS.** `Nhãn…`, `Gỡ hết nhãn (2)`, `Chuyển sang nhãn…`, the picker
  title (wraps to two lines) and description, `Đã gỡ hết nhãn` + `Hoàn tác`, and
  `Nhãn đã được thay đổi ở nơi khác` all render whole with diacritics intact.
  No clipping or overflow.
- **Library rail: PASS.** At 191px the three new scope labels are fully legible;
  the rail scrolls vertically as before.

### Gap, stated rather than implied

The picker and toast are photographed at the 220px sidebar width and measured at
420px and 356px wide respectively, so at the 600px floor they fit with 180px and
244px of margin; their **600px frames were not captured**. The story play
functions query English labels, so the localized picker/toast cannot be opened
from a nested 600px iframe without a story change. The 600px *menu* frame is
real; the picker/toast 600px claim is geometry, not a photograph.

## Source hashes (the audit premise)

The receipt `i18n/receipts/f290d34143fb.json` names the bytes this branch
carries, not an earlier draft:

| File | f290 receipt | Actual blob on `cb39abf98a` |
|---|---|---|
| `hi/ui.chat.tags.json` | `d080a7a26f02b412ab00642049c54391280d91afbfb5dcaf2fdc611724463101` | same |
| `hi/ui.library.json` | `e30da1148f9d927bd0dd088de9229c338b4835512e83a3b5591efa951a2cb956` | same |

The frozen `477486a95c36…` frame belongs to the **tags lane's pre-#1217 draft**
(`origin/fix/loh-11-hi-tag-delta`), which this branch does not carry. So
`f290d34143fb` does cover the current Hindi bytes; the discrepancy is between
two Hindi drafts, not between the receipt and the branch.
