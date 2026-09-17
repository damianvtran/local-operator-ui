# The settings provider and model fields: one searchable combobox, sourced from the login registry

Implementation brief. Branch `feat/model-provider-combobox`, cut from
`origin/main` `e5e39de55`. This is the UI half of the operator's request; § 7
states which parts of it are honestly not this PR.

Author: architect subagent (local-operator-ui, lopdev team). Every claim below
is read from the tree named in the citation, or measured on this host. Where a
number is an estimate rather than a measurement, it says so and names the
command that would settle it.

Version bumps: **none anywhere in this PR**; `package.json` stays at the
released version and the release is its own PR (see `AGENTS.md`, "Releasing").

---

## 0. The problem as I found it

### 0.1 The complaint is about the *registry* rows, and the page already ships a searchable pair for the same two keys

The registry's `model` section projects `hosting` ("Default provider") and
`model_name` ("Default model") as `Kind.TEXT`
(`~/local-operator/local_operator/settings_io.py:84-118,632-655`), which the
contract ships to the renderer as `kind: "text"`
(`src/shared/desktop-contract.ts:1508-1540`), and `SettingControl` routes to its
`default:` arm — a bare `<Input>` with a `placeholder` the registry does not
send — at `src/renderer/src/features/settings/components/setting-control.tsx:314-324`,
inside a 384px slot (`SLOT.text`, same file, `:45-55`). The committed before-state
is `docs/evidence/settings-backend/arrival@1380/localOperatorDark.webp`: two
empty boxes with no placeholder and no affordance, directly under a section
header whose own help sentence reads "`/model` saved adopts the default here."

Those two keys are, however, **already served by a searchable pair on the same
page**, in a different nav section:
`src/renderer/src/features/settings/components/settings-page.tsx:892-926`
("Model settings", under General) renders `HostingSelect` (`:898`) and
`ModelSelect` (`:909`) → both return
`src/renderer/src/shared/components/hosting/searchable-select.tsx`'s
`SearchableSelect` (`hosting-select.tsx:318-341`, `model-select.tsx:377-405`).

So the defect is not "no component exists". It is three defects stacked:

1. the registry rows were never wired to the component that exists;
2. the component that exists **does not read the centralised login state** — see
   § 0.2 — so wiring the registry rows to it unchanged would ship the wrong
   source;
3. the page now has **three writers** for one pair of keys (registry rows, the
   General section's pair, and onboarding), which is the thing the operator's
   "ONE standardised component" is asking to end.

### 0.2 The existing pair's options do not come from the backend ops

`HostingSelect` reads the desktop provider census — `useDesktopProviders`
(`hosting-select.tsx:98-99`), i.e. op `providers.list` → `GET /v1/auth/providers`
(`src/shared/desktop-contract.ts:1032,2082`) — but the settings page calls it with
`filterByCredentials={true}` (`settings-page.tsx:901`), which narrows the list to
`selectableHostingProviders` (`hosting-select.tsx:131`), i.e. **providers already
signed in**. That is the opposite of the semantics of record (§ 1.3).

`ModelSelect` does not read the desktop ops at all. It reads the legacy store:
`useModels()` (`model-select.tsx:179`) → `useModelsStore` →
`@shared/api/local-operator/models-api` over `apiConfig.baseUrl`, with a static
manifest adapter and a module-level 5-second cache
(`hosting-model-manifest.ts:88-140`; the `cachedProviders`/`lastCacheTime` pair
at `:104-107` is a store read inside a plain getter, so it cannot react to store
changes — which is why the callers also pass `isLoading`).

That is a second source of truth for the same value space, reached over the
legacy HTTP surface rather than the desktop transport, and it is exactly what the
operator's "the options must come from the backend methods so they reflect the
centralised login state" is asking us to leave behind.

### 0.3 The third writer

`src/renderer/src/features/onboarding/components/steps/default-model-step.tsx`
writes the same `hosting`/`model_name` pair through `useUpdateConfig`
(`:78-104`), with the same legacy hooks, as two non-searchable `Select`s whose
provider list is filtered by `credentialsData.keys` (`:60-66`).

### 0.4 The TUI already ships this feature, with a written contract

`~/local-operator/local_operator/tui/widgets/settings_view.py:108-130`
(`_HOSTING_KEY`, `_MODEL_KEY`, `_SUGGEST_KEYS`, `_SUGGEST_ROWS`) plus the
machinery at `:3822-3990`, fed by
`~/local-operator/local_operator/tui/app.py:25125-25166`. Its docstrings are the
design of record for the semantics (§ 1.3), and the UI must not teach a different
one — including on the points where the TUI's choice looks idiosyncratic.

### 0.5 What is *not* wrong

Stated so the coder does not "fix" it:

- **The draft + explicit Save model.** `backend-settings-drafts.ts`'s own header
  records that instant apply was considered and rejected (Primer: never mix save
  patterns in one form). The new control reports a draft upward like every other
  kind; it must not save on pick. This is also why the registry rows cannot
  simply *be* `HostingSelect`, which saves immediately (`hosting-select.tsx:224-252`).
- **The enum rows.** `model_effort` is already an enum `Select`
  (`setting-control.tsx:214-243`).
- **The `/model` picker dialog.** `PickerHost` is a dialog by design
  (`picker-host.tsx`, title/search/footer/result strip), and § 2 says why it is
  not refactored.
- **The registry's own shape.** The wire carries no `placeholder` field
  (`~/local-operator/local_operator/server/routes/settings.py`, `_view`), and that
  is not a gap to fill: see § 8.2's trap.

---

## 1. Ground truth that shapes the design

### 1.1 The row pipeline

`BackendSettingsSection` renders one `BackendSettingRow` per registry row; the
row owns the draft, the dirty mark, `Use default`, `Save`, the failure `Alert`
with its `Retry`, and the `data-setting-control` seam
(`backend-setting-row.tsx:103,230,254-296`). The control itself is
`SettingControl` (`setting-control.tsx:194-324`), a switch on `setting.kind`.

**The deep-link reveal constrains the control's DOM.** The reveal loop focuses
`[data-setting-control] :is(input, textarea, select, button[role="switch"], button)`
(`backend-settings-section.tsx:614-622`). A combobox whose editable part is not a
real `<input>` in that slot silently loses the `/settings?setting=hosting` focus
path — the loop then burns its attempts and, because the scroll sits in the
success branch, does not even scroll to the row (the same failure shape the
`readonly` fix was written for, `:596-613`). Any new control must therefore
contain an `<input>`.

### 1.2 The value shapes, pinned

These are the contract. Each is cited, because the three rows disagree and a
single component must not paper over it.

| Row | Stored shape | Evidence |
| --- | --- | --- |
| `hosting` | a **bare provider id** (`anthropic`) | `settings_view.py:201-204` ("a bare provider id for `hosting`"); the catalogue at `app.py:25125-25148` returns `(definition.id, definition.name)` and the accepted value is `provider_id` |
| `model_name` | a **bare model id** (`claude-opus-5`) — *not* `provider/model` | the same `_Suggestion` docstring, `settings_view.py:201-204` and `:206-216`: `/model default` splits its selector on the first `/` and writes the right-hand side here beside the left in `hosting`; storing a selector "would leave `model_name` holding `anthropic/claude-opus-5` under an `anthropic` hosting and boot a model id no provider owns" |
| `subagents.models.lo\|med\|hi` | a **`provider/model` selector** | `~/local-operator/local_operator/harness/subagent.py:354-397` (`configured_effort_tiers` partitions each value on `/` and drops any value missing a side); the refusal sentence is `effort_tier_rejection` at `:399-435` — `"subagents.models.lo='gpt-5' lacks provider/model"` |
| `retry.fallbackChains` | per chain, a list of `provider/model (effort)` hop **strings** | `settings_io.py` `Kind.CASCADE`; the control's own help (`setting-control.tsx:305-310`) |

The two stored shapes are not interchangeable, and the backend does not
normalise between them: `configure_model(hosting, model_name)` passes
`model_name` through as the provider's model id
(`~/local-operator/local_operator/model/configure.py:2349-2390`), while
`resolve_hosting_model` reads the two keys independently
(`~/local-operator/local_operator/bootstrap.py:64-104`). A combobox that stores
what it displays is wrong for `model_name`; a combobox that stores a bare id is
wrong for `subagents.models.*`.

### 1.3 The TUI contract of record, in its own terms

Quoted because each of these is a decision the UI would otherwise re-make
differently:

1. **Suggestions assist, never constrain.** "Both remain ordinary `Kind.TEXT`
   settings — the suggestions ASSIST, they do not constrain, so a custom
   endpoint id the catalogue has never heard of still coerces and saves exactly
   as before" (`settings_view.py:108-118`). A value matching nothing offers no
   rows and commits as typed (`_suggestions` docstring, `:3839-3860`).
2. **The provider list is the WHOLE login registry**, not the signed-in subset:
   "the Default provider field is where a user names the provider they intend to
   boot on, which may be one they have not logged into yet, so constraining the
   suggestions to current credentials would hide exactly the choice they are
   reaching for" (`app.py:25125-25140`). *Contrast § 0.2.*
3. **The model list is the same rows `/model` shows**, through the same filter —
   usable providers, with the current model rescued in (`app.py:25150-25166`,
   `_catalogue_rows` at `:30401-30470`).
4. **Empty degrades, it never blocks.** A catalogue that fails to load "falls the
   field back to a plain free-text editor" (`app.py:25140-25148`).
5. **Keyboard:** the dropdown owns up/down/`ctrl+p`/`ctrl+n`/PgUp/PgDn while it
   shows; Tab completes into the buffer without saving; Enter accepts the
   highlight and then commits; the first Escape dismisses the list, the second
   cancels the edit; an empty buffer's Enter un-sets rather than storing the
   highlighted top row (`settings_view.py:2791-2880`).
6. **A key→source map, not a new `Kind`.** "Keyed here rather than on a new
   `Kind` because the interaction is 'type freely, with help', which is what TEXT
   already is; a new kind would force `coerce`/`validate`/the CLI to grow a branch
   for a value space that is deliberately open" (`settings_view.py:113-118`,
   `_SUGGEST_KEYS` at `:122`). The manager's decision 1 is this decision, made
   independently; it is right, and it is why no backend change is needed.

### 1.4 What the UI already has

**`SearchableSelect`** (`src/renderer/src/shared/components/hosting/searchable-select.tsx`,
413 lines) is a complete, correct WAI-ARIA combobox: `role="combobox"` on a real
`Input` with `aria-expanded`/`aria-controls`/`aria-autocomplete`/
`aria-activedescendant` (`:274-302`), ArrowUp/Down plus Home/End
(`:189-207`), Enter that prefers an exact name match over free text and otherwise
calls `onCustomSubmit` (`:208-232`), Escape that reverts **and stops
propagation** so a containing dialog does not also close (`:233-241`), blur-to-
revert, `Popover` + hand-rolled listbox, grouped headings (`:149-163`), a
`busy` spinner, and an accent-folding case-insensitive **substring** filter over
`option.name` (`fold` at `:82-88`, `visible` at `:124-133`).

It also already separates *stored* from *shown*: `option.id` is what `onSelect`
receives, `option.name` is what the input displays and what the filter matches
(`SearchableOption`, `:40-51`; `commit` at `:165-172`). That is exactly the
`model_name` requirement (store bare, show `provider/model`) with no change to
the component.

**Two matchers already exist, and they are different things:**

- `scoreCommandTextMatch` (`src/renderer/src/features/chat/components/slash-rank.ts:85-90`):
  exact > prefix > subsequence, with a Python twin (`autocomplete.py`) that the
  TUI's **provider** suggestions use (`settings_view.py:3846-3860`).
- `rank_rows` (`~/local-operator/local_operator/model/ranking.py:107-151`):
  substring matches win outright, subsequence is the fallback, then tiers
  `(connected, aggregated, provider, version)`. There is **no UI twin**, and the
  version key (`_version_key`, `:154-195`) is 40 lines of deliberate heuristics.
- `PickerHost`'s own filter is a third thing: a plain substring over a row's
  `label`/`value`/`description`/`meta`/`keywords` (`picker-host.tsx:658-668`).

### 1.5 The ops, their gates and their costs

| Op | Route | Gate | Cost |
| --- | --- | --- | --- |
| `providers.list` | `GET /v1/auth/providers` (`desktop-contract.ts:2082`) | `desktopFeatureEnabled(caps, "auth")` (`hosting-select.tsx:98`) | one local IPC call; `useDesktopProviders` already exists with `staleTime: 30_000` (`desktop-hooks.ts:276-296`, key at `:21`) |
| `models.catalogue` | `GET /v1/desktop/models?live=…` (`desktop-contract.ts:808,1958`) | `catalogues` (`~/local-operator/local_operator/server/routes/capabilities.py:27`) | **non-live**: `initial_catalogue()`, measured on the backend at 0.21 ms median / 0.77 ms max, I/O-free by contract (`desktop_catalogues.py:78-90`). **live**: a measured **2.33 s** (`destination-pickers.tsx:505-515`) |

`DesktopModelCatalogue` carries `credentials_known`, and the contract says why:
`connected` is also true when the credential store could not be read, which is
the deliberate "show everything rather than claim the user owns no models"
degradation, "so it must not be turned into a badge or a grouping heading"
(`src/shared/desktop-control-contract.ts:41-65`). The picker already honours
this with a third group, "Sign-in state unknown"
(`destination-pickers.tsx:600-643`).

**Payload estimate (estimate, not a measurement).** One `CatalogueEntry`
serialized the way the route does it is **325 bytes** compact (measured on this
host with the repo's own dataclass). The operator's own catalogue is cited at
1450 usable rows in this repo (`model-catalogue-listing.ts` header), so the
non-live answer is roughly **460 KB of JSON** — for a settings page that most
deep links never ask a model question of. Settle it exactly with
`curl -s "$BACKEND/v1/desktop/models" | wc -c` in QA; the decision in § 3.4 does
not turn on the exact figure, but the *order* does.

### 1.6 The picker's pieces the manager asked about

`PickerHost` exports reusable parts: `PickerRow`, `PickerListState` /
`pickerListReducer`, `pickerBodyKind`, `pickerFooterHint`, `pickerPrimaryLabel`
(`picker-host.tsx:250-360,416`), and `picker-feedback.test.mjs` drives them
directly. **The inline combobox shares none of them**, and that is deliberate:

- `PickerListState` models a *dialog's* two lifetimes — the pointer's row and an
  in-flight pick's row (`:250-267`, comment at `:240-249`). An inline field has
  no in-flight pick: it has a draft, which the row owns.
- `pickerBodyKind` / the footer helpers answer "what does this *dialog* show"
  (loading / error / empty / list, plus a footer sentence naming the row Enter
  would take). An inline list's equivalents are "the list, or the typed text, or
  nothing" — three lines of rendering, not a state machine.
- `PickerRow` is a `<div role="option">` inside a dialog body with hover/picked
  marks. `SearchableSelect` already has its own `<li role="option">` row
  (`:360-410`).

Sharing them would mean refactoring `PickerHost` — a 1310-line dialog with a
pointer/scroll/keyboard model of its own — to serve a 384px field. That is the
"second implementation beside the first" trade run in reverse, and it is not
worth it: the duplicated part is *an option row*, not a behaviour.

### 1.7 Evidence gaps this PR inherits

- `SearchableSelect` has a Storybook story
  (`src/renderer/src/shared/components/hosting/searchable-select.stories.tsx`,
  title `Hosting/SearchableSelect`) and **no entry in `capture-evidence.mjs`'s
  `STORIES`** — a grep of that file for `searchable`, `hosting` or `model-select`
  returns nothing, against 953-967 for the settings registry and 1490-1500 for
  the chat picker. So the component the whole feature will be built on has never
  been photographed, in any theme, on any state.
- There is likewise no story for `settings-page.tsx`'s General section, so the
  page's existing duplicate writers (§ 0.1) are outside every committed frame.

---

## 2. The first decision: promote `SearchableSelect`, do not author a second control

**The manager's decision 2 asks for "one standardised searchable single-select
component in `src/renderer/src/shared/components/ui/`". I recommend satisfying
that by *promoting the existing component*, not by writing a new one.**

This is `docs/branding.md` § 9.1 stated as a rule — "Is there an existing
primitive? Use it. A second button implementation is a defect" — and the
existing component is already on the same page, two nav sections up, writing the
same two keys. A second combobox in `ui/` gives the settings page two searchable
single-selects with different filters (§ 1.4), different keyboard behaviour
where they differ, and no shared fix path.

**Mechanically:**

1. Move `searchable-select.tsx` → `src/renderer/src/shared/components/ui/searchable-select.tsx`
   and export it (and its types) from `src/renderer/src/shared/components/ui/index.ts`,
   by name, per that barrel's own `noReExportAll` rule.
2. Leave `shared/components/hosting/searchable-select.tsx` as a one-line
   re-export so `hosting-select.tsx:12` and `model-select.tsx` (and the story)
   do not churn in this PR. Alternatively update two imports — the coder's
   choice; a re-export is what keeps the diff able to say "the component moved".
3. Extend it with four small, additive props (§ 3.1). Nothing in the extension
   changes behaviour for the three existing call sites.
4. Add the story's missing coverage (§ 8) — the component arrives in `ui/` with
   the frames it never had.

**Why the picker is NOT refactored** (asked explicitly): it is a dialog, not an
inline control; its state machine answers dialog questions (§ 1.6); and it is a
verified surface with 11 committed frame states and a driver scene of its own.
Rewriting it to share a row renderer would put a reviewed surface at risk to
deduplicate three lines of markup.

**Two costs, stated:**

- `SearchableSelect` imports `Spinner` from `shared/components/common/spinner`.
  `ui/`'s header says the directory is "the primitive layer"; a spinner is a
  primitive too, so this is a layering wart rather than a violation, and the
  alternative (inlining a spinner) is worse. Say so in the file's header when it
  moves.
- The component's box is the `Input` primitive's (`border-control`, `surface`,
  `rounded-sm`, the md height ramp). That is *already* what the registry row's
  text input renders, so the row's geometry does not change; § 9's control-row
  question is answered by "the `input field` row still covers it" (see § 9.5).

---

## 3. The component API

### 3.1 `ui/searchable-select.tsx` — the extension

Four additive props, each with a call site that needs it:

```ts
export type SearchableSelectProps = {
  options: SearchableOption[];
  selected: SearchableOption | null;   // { id: stored value, name: shown text }
  onSelect: (option: SearchableOption) => void;
  onCustomSubmit?: (text: string) => void;   // the free-text escape hatch
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  busyLabel: string;
  helperText?: string;
  // --- added by this PR ---
  /**
   * The accessible name for the input. Required in the chrome-less variant,
   * where there is no <label> element to name it, and optional otherwise
   * (kept so the three existing call sites' visible <label htmlFor> stays
   * the name).
   */
  ariaLabel?: string;
  /** Extra ids the input describes itself by (the registry row's help). */
  ariaDescribedBy?: string;
  /**
   * Renders the label block, or not. Default true, i.e. today's behaviour.
   * The registry row already renders its own label, warning and help
   * (`backend-setting-row.tsx:119-137,213-216`), so its comboboxes set false
   * and name themselves with `ariaLabel`.
   */
  showLabel?: boolean;
  /** What the list says when the filter matches nothing. */
  emptyText?: string;   // default "No matches"
  label?: string;       // required only when showLabel !== false
  icon?: ReactNode;     //      "          "
  labelTooltip?: ReactNode; //  "          "
};
```

Which parts are **not** added, and why: no `value`/`onChange` controlled text
mode (the control is a picker whose text is the *shown* label, not the stored
value — a controlled mode would be a second way to desync those two); no
`multiple` (nothing here is multi-select; § 7.2 says what happens if one is ever
needed); no virtualisation (the popover is `max-h-72`, ~9 rows; the filter is
the tool).

### 3.2 The typed-value escape hatch

`onCustomSubmit` is it, and it is already the right shape: Enter on text that
matches no option's folded `name` calls `onCustomSubmit(typedText)` verbatim
(`:208-232`). For these rows the wrapper passes it through, so the value written
is exactly what the user typed — bare id, selector, or a string no catalogue has
ever heard of. **This is the whole of § 1.3(1) and it must not be dropped**:
`allowCustom` is not an option on the new wrapper. A field that can only store
what the catalogue knows would make an offline or unlisted provider
un-configurable, and the TUI's own rule is that the value space is deliberately
open.

### 3.3 The wrapper: `setting-combobox.tsx`

`src/renderer/src/features/settings/components/setting-combobox.tsx` — settings-
local, because it is the only consumer and because it encodes the registry's
key→source semantics rather than a general control. It:

- takes `setting: BackendSetting` and `value: string` (the draft) and
  `onValueChange: (value: string) => void`, exactly like `SettingControl`'s other
  arms, so the row's draft/dirty/Save/failure machinery is untouched;
- resolves the row's source from the map in § 3.5;
- builds `SearchableOption[]` from the op payloads (§§ 4.1-4.3);
- renders `SearchableSelect` with `showLabel={false}`,
  `ariaLabel={setting.label}`, `placeholder` from § 4.4, and `emptyText`;
- passes the free text straight to `onValueChange`.

`SettingControl` gains one branch, ordered before the `default:` arm:

```ts
const source = settingComboSource(setting.key);   // § 3.5
if (source) {
  return <SettingCombobox setting={setting} value={value}
                          disabled={disabled} onValueChange={onValueChange} />;
}
```

Note the placement: it keys on the **key**, not on `kind`, because every one of
these rows is `Kind.TEXT` and stays `Kind.TEXT`. The row's own behaviour
(`wideControl`, `controlSlot`, the reveal seam) also stays as it is: `text` keeps
`w-96` (`:36-46`) and the reveal finds the combobox's `<input>` (§ 1.1).

### 3.4 Fetch policy

| Source | When | Key | Why |
| --- | --- | --- | --- |
| `providers.list` | on mount of the rows (i.e. page open, since `hosting` is `core`) | `desktopKeys.providers` — reuse `useDesktopProviders(true)` | one local IPC call; the payload is the registry (tens of rows); the `hosting` row is on screen at arrival, so page open *is* the intent |
| `models.catalogue`, `live: false` | **on first open of a model-bearing list** | `["desktop", "models", false]` | ~460 KB (§ 1.5) of JSON must not ride the page-open path of a page most deep links never ask a model question of |

The two rows above are not the same decision, and the difference is what settles
them. The TUI fetched nothing at all, because its catalogue is built in-process
and synchronously on the page-open path (`app.py:25150-25166`) — there the fetch
*is* the stall. A lazy query does not stall anything: the row paints immediately
as an empty field with its placeholder, and the list arrives when it is opened,
inside the gesture that asked for it. That budget is smaller than the settings
page's own first paint, and it is why **first-open** wins over mount for the
model catalogue and **mount** wins for the provider registry.

**Use the chat picker's own key** `["desktop", "models", false]`
(`destination-pickers.tsx:506-516` uses `["desktop", "models", live]`), so a
session that has already opened the picker and the settings page share one cache
entry rather than fetching the catalogue twice. Match the picker's
`staleTime: 60_000` for the non-live case and `placeholderData: keepPreviousData`.
Do **not** add a `models` entry to `desktopKeys` in this PR unless the picker is
moved onto it in the same commit — a second spelling of the same key is the
defect class this repo has already paid for (`docs/design/mcp-auth-experience.md`
§ 1.1).

Never `live: true` from the settings rows: 2.33 s measured, and the settings
field is a boot preference, not a listing.

### 3.5 The key→source map

`src/renderer/src/features/settings/backend-setting-combos.ts` — a sibling of
`backend-settings-tiers.ts`, which is that directory's precedent for a curated
map that cannot drift in silence (see `backend-settings-tiers.test.mjs`'s
header). Shape:

```ts
export type ComboKind = "provider" | "model" | "provider-model";
export const SETTING_COMBOS: Record<string, ComboKind> = {
  hosting: "provider",
  model_name: "model",
  "subagents.models.lo": "provider-model",
  "subagents.models.med": "provider-model",
  "subagents.models.hi": "provider-model",
};
```

Keyed by key, exactly as `_SUGGEST_KEYS` is keyed by key
(`settings_view.py:113-122`), for the stated reason: the value space is
deliberately open and a new `Kind` would force `coerce`/`validate`/the CLI to
grow a branch. Like the tier map, this one must fail loudly on a registry key
nobody classified — but *not* the way the tier map does: an unclassified key
here degrades to the plain text editor, which is correct, so there is no
completeness assertion to write. What is worth asserting (and § 8.3 does) is the
inverse: every key in the map is a key the wire actually sends, so a rename
cannot leave a stale entry that silently does nothing.

### 3.6 The matcher: `scoreCommandTextMatch`, and why not the other two

**Decision: the new lists filter with `scoreCommandTextMatch`
(`slash-rank.ts:85-90`), for both providers and models.**

- It is the UI's own matcher and it has a Python twin that the TUI uses for
  **provider** suggestions, so provider filtering matches the TUI's behaviour. If
  we used `PickerHost`'s plain substring for providers, the same list would
  filter differently in the composer and in Settings (the manager's own warning,
  and this repo has three matchers already — § 1.4).
- For **models**, `rank_rows` is the TUI's matcher and has no UI twin. Its
  scoring half (substring wins outright, subsequence as fallback) is a real
  behavioural decision with a stated reason (`ranking.py:115-125`: `opus` is a
  subsequence of `claude-sonnet-4`, so ordering it the other way leads the list
  with the wrong model). `scoreCommandTextMatch` expresses the same intent —
  prefix beats subsequence, and its subsequence scorer is the general case of
  substring — without a port. **Do not port `_version_key`**: 40 lines of
  heuristics about which number in an id is the version, whose docstring records
  two wrong versions already (`ranking.py:154-195`). A second implementation
  would drift, and the failure is silent (newest-looking model first is a
  judgement, not a fact).
- `PickerHost`'s substring filter is right for the picker — it filters a
  *haystack* of keywords per row rather than a name — and wrong for a field whose
  whole content is one token.

**Ordering, instead of `rank_rows`'s tiers:** sort the filtered rows by a
documented two-rung comparator — usable before not-usable (mirroring
`(not connected, aggregated)` at `ranking.py:143`), then the effective hosting's
own provider first — and otherwise **preserve the order the backend sent**.
Within one provider that is the listing's own order, which is the best available
signal and is not ours to invent. This comparator is pure, so it gets a
`node --test` module (§ 8.3).

---

## 4. Per-row design

### 4.1 `hosting` ("Default provider")

- **Source:** the whole `providers.list` registry (`DesktopProvider[]`,
  `desktop-contract.ts:1474-1487`), in registry order — `app.py:25125-25148`'s
  "same registry `/login` and `/provider` enumerate, in registry order".
- **Not filtered by credential.** § 1.3(2). The manager's recon note says the
  same thing; `HostingSelect`'s `filterByCredentials={true}` at
  `settings-page.tsx:901` is the existing violation, and § 7.3 is what to do
  about it.
- **Stored value:** `provider.id`. **Shown value:** `provider.name`.
- **Credential state, shown not filtered:** use the shipped classifier
  `providerReadiness` (`provider-labels.ts:72-99`), whose whole docstring is about
  this trap — `configured` is true for the five local providers unconditionally,
  so a "Connected" badge claimed a connection to servers that were not running;
  the labels are now "Signed in" / "No key needed" / "Needs sign-in", in groups
  "Ready to use" / "Needs a running server" / "Needs sign-in". Render the group
  as the row's `group` and the label as the sub-line, so the settings list and the
  providers grid cannot describe one provider two ways.
- **Do not** invent a fourth vocabulary. Note the discrepancy with the model
  list (§ 4.2) rather than smoothing it: "does this provider have a credential"
  and "did this catalogue listing connect" are different questions with different
  unknowns, and the picker's three-state answer exists precisely because
  `connected` is also true when the store is unreadable.
- **Degradation:** `providers.list` disabled or failed → an empty option list,
  which means the field behaves as it does today (free text, no list), plus the
  row's helper text. Never disable the input: a provider registry that cannot be
  read must not lock a user out of a field they can type into
  (`hosting-select.tsx:299-316` records the same reasoning for the same failure).

### 4.2 `model_name` ("Default model")

- **Source:** `models.catalogue` with `live: false` (§ 3.4).
- **Stored:** the bare `model_id`. **Shown:** the `selector`
  (`provider/model_id`) — `_Suggestion`'s own rule, `settings_view.py:197-220`,
  and it is what disambiguates the two catalogue entries that can share one model
  id (a direct provider and an aggregator). `SearchableSelect` already separates
  these (§ 1.4), so this needs no component change.
- **Filtering matches the shown text**, i.e. the selector — so typing
  `openrouter/` narrows by provider while the accepted value stays bare, exactly
  as `rank_rows` does (`settings_view.py:3880-3885`).
- **Scoping by the effective `hosting` (draft-aware).** Decision: **narrow the
  list to rows whose `provider` equals the effective hosting** — the draft's
  `hosting` where the hosting row is dirty, the server's value otherwise — with
  two stated fallbacks:
  1. if the effective hosting matches **no** row's provider (a local server that
     is down, a hosting id the catalogue spells differently, an empty hosting),
     show the **whole** catalogue rather than nothing. An empty list in a
     settings field reads as broken, and "we could not map your hosting" must not
     look like "you own no models";
  2. the **current value is always listed**, synthesised as a row when the
     catalogue does not contain it (§ 4.5), because dropping it would make a
     stored-but-unknown model invisible — `_catalogue_rows`'s "HIDDEN, not
     demoted" reasoning, `app.py:30401-30430`.

  Why narrow at all, when the TUI does not: `bootstrap.py:64-104` reads the two
  keys independently and hands both to `configure_model`, so a model id from a
  provider you are not hosting on is an id that provider does not own — the TUI
  mitigates that by showing the selector in the label, and narrowing is the
  stronger version of the same intent for a field that stores a bare id. Why the
  fallbacks are load-bearing: narrowing is a *mapping* we do not own, and the
  failure mode of a wrong mapping must be a longer list, never an empty one.

  **This is one of the two places I would look at first if the design is
  wrong** — § 11.
- **`credentials_known === false`:** list everything, and **do not** group by
  Signed in / Needs sign-in. Use the picker's third group, "Sign-in state
  unknown" (`destination-pickers.tsx:600-643`), or omit grouping entirely. A
  badge here would be the D5 defect re-shipped on a new surface.
- **Errors:** `errors` is a per-provider partial-failure map that still carries
  `models` (`desktop-control-contract.ts:41-65`). Reuse
  `catalogueListing(...)` (`model-catalogue-listing.ts`), which exists because
  collapsing the two was a measured defect (1450 usable rows replaced by a wall
  of 21 provider names). A partial failure is helper text above/below the field;
  only a thrown query is an error state.

### 4.3 `subagents.models.lo|med|hi`

Stored shape: `provider/model` (§ 1.2). Therefore:

- the option `id` is the **selector** (`provider/model_id`) and the option `name`
  is the same selector — there is no second display form to disambiguate, because
  the stored value already names the provider;
- the group is the provider, and the credential state is carried the same way as
  § 4.2 (a subagent model that cannot run is the thing this row is *for*);
- the row is `advanced` tier (`backend-settings-tiers.ts:140-142`), so it is one
  "Show advanced" click or a settings search away, not part of the arrival
  experience;
- the help sentence already points at the sibling enum ("`empty inherits. See
  subagents.model_choice`"), so the combobox must not add copy that contradicts
  it.

Free text is passed through unchanged, which is what makes `subagents.models.lo: gpt-5`
(a stored value with no provider, which `effort_tier_rejection` refuses with a
named sentence) still visible and still fixable in the field. The control must
not "correct" it.

### 4.4 Placeholder, and where it comes from

The wire sends no `placeholder` (`server/routes/settings.py::_view`) and the
current rows therefore render none. Supply it **client-side from the row's
source**, not from `setting.placeholder`:

- `hosting` → `Search providers`
- `model_name` → `Search models`
- `subagents.models.*` → `Search models`

The chat picker's own field is "Search models" (`chat-model-picker--populated`,
committed frame), so this reuses a phrase rather than inventing one. Do **not**
fall back to `setting.placeholder`: it exists only in the storybook fixture
(§ 8.2).

### 4.5 Free text, and the unknown current value

Two different situations, one rendering rule each:

- **Typing something the catalogue does not match** → `onCustomSubmit` writes it
  verbatim on Enter. The list may show "No matches…" under the field while the
  typed text is committed; the empty state must not be an error and must not
  block. Cite `settings_view.py:113-118` in the code comment.
- **Displaying a stored value the catalogue does not contain** (a model you
  configured before the provider was resynced; `docs`' own configured fixture is
  a live example: `scripts/backend-settings-registry.mjs` writes
  `model_name: "deepseek/deepseek-chat"`, a selector-shaped value the TUI's
  contract says the key does not hold) → the field shows that value as its
  `selected`, synthesised as a row when no catalogue row matches, exactly as
  both existing call sites already do (`hosting-select.tsx:178-192`,
  `model-select.tsx:275-283,354-359`). It must never render as blank: a blank
  field for a set key is a lie the user cannot debug.

### 4.6 Empty state, and `empty_unsets`

`hosting`, `model_name` and all three `subagents.models.*` rows are
`empty_unsets: True` (`settings_io.py`; the row's own projection carries the
flag, `backend-settings-drafts.ts:147-156`). So:

- **clearing the field and saving** writes `null` — "unset", which is a
  legitimate state for all five (empty model = the provider's default model, via
  `default_model_for`, `bootstrap.py:85-104`; empty subagent tier = inherits);
- **typing a value that matches nothing** writes that string — "no match" is not
  "unset" and the two must never collapse.

The component therefore needs an explicit **clear affordance distinct from
emptying the text**, and this is the one piece of *new* interaction in the whole
design:

- give the field a clear button (a small ghost `X` in the input's trailing
  affordance slot, beside the chevron/spinner — the field already reserves
  `pr-8` for it, `searchable-select.tsx:283`), labelled
  `aria-label="Clear <label>"`, which commits the empty value through the row's
  draft path (`onValueChange("")`);
- it is **not** the same as deleting the text by hand, because deleting leaves
  the draft equal to the empty string *only if the user also committed it*, and
  the row's dirty mark must light up for the clear exactly as for a typed value;
- with `empty_unsets`, an empty draft is dirty against a non-empty server value
  (`backend-settings-drafts.ts:100-110`) so the `Save` button appears — good, and
  it must;
- for a key **without** `empty_unsets` the empty string is a *value*, not an
  unset. None of the five target rows is in that state, so the wrapper simply
  passes `""` through and the row's existing `editOutcome` decides — do not add
  a second rule for a case no row has.

The "Use default" button keeps doing what it does: it resets `hosting`/`model_name`
to their shipped default, which is the empty string
(`settings_io.py`: `default: ''` for both), and that is a different action from
the clear button (it also satisfies `is_default`). Both stay.

### 4.7 What must not change

A checklist for the coder, each item with an existing test or frame to keep
green:

1. Draft + explicit Save; no write on pick or blur
   (`backend-settings-drafts.ts` header; `backend-settings--dirty` frame).
2. The failed-save `Alert` and its `Retry` re-submitting the **retained** draft
   (`backend-setting-row.tsx:305-327`; `settings-backend/save-failed`).
3. `Use default` and the `ChangedDot` (`:247-272`; `settings-backend/changed-rows`).
4. The `/settings?setting=hosting` reveal-and-focus landing on the combobox's
   `<input>` and scrolling the row into view (`backend-settings-section.tsx:596-627`;
   `settings-backend/deep-link`).
5. The section's filter, collapse, `Save all`, and the "unsaved changes" count —
   all of which read `SettingDraft`, not the control.
6. The narrow column: at 620px the rows stack
   (`backend-setting-row.tsx:183,230`; `settings-backend/narrow`). A popover
   anchored to a 384px field must not overflow the window — `PopoverContent`
   already sizes to `--radix-popover-trigger-width`, and `collisionPadding`/Radix's
   collision handling is what to check in the narrow frame.

---

## 5. Keyboard and accessibility

Inherited from `SearchableSelect` (nothing to re-decide):

| Key | Behaviour | Cite |
| --- | --- | --- |
| ArrowDown / ArrowUp | open if closed; else move the highlight, wrapping | `:189-200` |
| Home / End | first / last match | `:201-207` |
| Enter | commit the highlighted row; else an exact name match; else free text | `:208-232` |
| Escape | dismiss the list and revert the text; **stops propagation** so a containing dialog does not also close | `:233-241` |
| Tab / Shift+Tab | native — leaves the field. (The TUI's Tab-completes-without-saving has no place here: the field's text *is* its value, and Tab completing would make "save" indistinguishable from "leave".) | — |

Added by this PR:

- `role="combobox"` + `aria-expanded`/`aria-controls`/`aria-autocomplete`/
  `aria-activedescendant` here point at a listbox whose ids are `useId`-derived
  per instance, which is what keeps four comboboxes on one page from sharing an
  option id.
- **The accessible name** is the registry row's label: pass
  `ariaLabel={setting.label}` and, where the row renders help, `ariaDescribedBy`
  pointing at it. Do not wrap the row's `<span>` label in a `<label>`: the row's
  label markup is shared with five other kinds, and the input already carries
  `aria-label={setting.label}` today (`setting-control.tsx:314-324`), so this
  preserves the existing accessible name rather than introducing one.
- The option list keeps `aria-selected` for the current value
  (`searchable-select.tsx:374`), and the list's `role="listbox"` gets
  `aria-label={label}` — for a chrome-less instance, pass `ariaLabel`.
- The clear button (§ 4.6) is a real `<button>` with an `aria-label` naming its
  row, following the `Use default for <label>` precedent
  (`backend-setting-row.tsx:255-257`, which was a UX-round fix for eight
  identical renderings).
- The "No matches" row stays `role="presentation"` so it is not announced as an
  option that cannot be chosen.
- The highlight is `bg-accent-wash` (`:381`), which on `elevated` is exactly the
  pairing the design audit measured as insufficient in `obsidian`
  (`picker-host.tsx:376-411`: ΔE00 0.77 / 1.014:1, and the fix was a 1px
  `outline-control` edge). **The `ui/` move must carry that lesson**: if the
  contrast contract covers `picker row pointer mark` there, it must cover this
  list's mark too (§ 9.5), or the same invisible-highlight defect ships on a new
  surface.

---

## 6. `retry.fallbackChains`: **NO-GO** for this PR

Recommendation: **exclude it**, as a per-hop provider+model combobox, and land
it as its own PR. Argued from the code:

1. **The control is not a field.** `retry.fallbackChains` is `Kind.CASCADE`; the
   renderer paints one `Textarea` per chain and joins/splits on newlines
   (`setting-control.tsx:279-313`), and the row is `wideControl` —
   `flex-1` at `basis-2/5` for the label rather than the text kind's `w-96`
   (`backend-setting-row.tsx:103,183-190`). A per-hop combobox means replacing
   the textarea with a repeatable row list plus add/remove/reorder affordances: a
   new component with its own keyboard model inside a page that already binds
   arrows and Enter for the settings list.
2. **The write shape is a merge, and hops are not pure selectors.** The draft
   carries `cascadeBase` so a save never flattens a concurrent terminal edit or
   stored effort metadata, and the submit is `{...base, [chain]: hops}` with the
   server's chains sent as `base` (`backend-settings-drafts.ts:26-31,133-147`).
   Each hop string is `provider/model (effort)` — an `(effort)` suffix that is
   **not** part of the selector. A combobox that owns a hop must therefore parse
   and re-emit that suffix, or preserve it untouched as free text beside a
   selector, and an empty hop is *meaningful* ("An empty chain moves to the next
   provider", the control's own help at `:305-310`). That is a parser plus a
   second picker, not a component swap.
3. **The design of record did not do it.** The TUI's cascade editor keeps every
   hop a plain text editor (`settings_view.py:1171` builds `kind="hop"` rows;
   `:2191` opens them as `hop:<chain>:<index>`), and `_SUGGEST_KEYS` is exactly
   `{hosting, model_name}` (`:122`). The surface that has shipped this feature
   for months declined to add suggestions here.
4. **It is not what the operator reported.** The cascade is `advanced` tier
   (`backend-settings-tiers.ts`), behind "Show advanced" or a search hit; the
   report is about the two rows on arrival.

**Cost of excluding it:** one deferred finding in the PR thread
(`deferred — separate control shape; see docs/design/model-settings-combobox.md § 6`),
per the operator's rule that deferred findings live in the thread rather than in
a new issue. Nothing else waits on it.

**Cost of including it:** roughly doubling the diff with a second component that
has its own keyboard model and its own evidence set, plus a parse/preserve
problem for the `(effort)` suffix that has no answer in the current write shape —
on top of a change that already moves a component and rewires five rows. Not in
one PR.

---

## 7. The survey: what else needs the same treatment

The operator asked us to survey. The honest answer is **five rows and no more**,
and the tempting extras are each a *different* control:

| Candidate | Rows | Verdict |
| --- | --- | --- |
| `hosting`, `model_name` | 2 | **In.** The reported defect. |
| `subagents.models.lo\|med\|hi` | 3 | **In.** Same value space (`provider/model`), same three sources. |
| `model_effort` | 1 | Already an enum `Select` (`setting-control.tsx:214`). Nothing to do. |
| `web_search.providers` | 1 | **Out.** `Kind.LIST`, comma-separated, and the registry's own comment says order is load-bearing ("the `ordered` strategy runs the list top to bottom"), which "a set of checkboxes cannot express without inventing a second reorder affordance" (`settings_io.py:98-102`). A single-select is the wrong shape; an ordered multi-select is a new component. |
| `providers.<local>.models` | 5 | **Out.** Each is a JSON object (`{"model-id":{"context_window":8192}}`, help text in the registry), i.e. a keyed map with per-entry settings — not a one-of-N choice. A model-id combobox that *adds a key* to a JSON blob is an editor, not this component. |
| `providers.*.base_url`, `web_search.searxng_endpoint` | 6 | **Out.** URLs. There is no catalogue, and free text is the correct interaction. |
| `bash.shell` | 1 | **Out.** A path to an interpreter; typing it is the only way to name one. |
| `retry.fallbackChains` | 1 | **Out of this PR** — § 6. |

### 7.1 One wrinkle worth naming

`hosting` is also offered by the settings **search index**
(`buildSettingKeyItems`, surfaced by the command palette's settings scope, per
`backend-settings-section.tsx`'s reveal path). Nothing here changes that: the
palette deep link focuses the row's `<input>` either way (§ 4.7.4).

### 7.2 If a future row needs multi-select

Not built. `SearchableSelect` is a single-select by construction (its `selected`
is one option). If `web_search.providers` ever wants one, it is a *different*
component — a token list with reorder — and it should reuse `SearchableSelect`'s
option row and matcher rather than grow a `multiple` prop on it.

### 7.3 The duplication this PR leaves standing, named now

Three writers of `hosting`/`model_name` remain after this PR:

1. **the registry rows** — draft + explicit Save, backend-sourced (this PR);
2. **General → "Model settings"** — immediate save, legacy-sourced, signed-in-only
   (§ 0.2). This is also the *settings-internal* duplicate: two controls, two
   behaviours, one pair of keys, one page;
3. **onboarding** — legacy hooks, filtered by credential key names
   (§ 0.3).

I recommend **not** folding 2 and 3 into this PR (they are interaction changes on
verified surfaces, and the operator's request is about the registry rows), but
naming them as the immediate follow-up, in this order, with the same component:

- **2 first**, because it is the one that puts two different controls for one key
  on one page: either retire the General section's pair in favour of the registry
  rows (the registry section is searchable, tiered, and deep-linkable), or
  re-point its pair at the new backend-sourced wrapper. Decide that in that PR,
  not now, because "retire a whole settings section" needs its own frames and its
  own design round.
- **3** can then use the same wrapper, because by then it will be the only
  provider/model control in the app.

---

## 8. Evidence plan

### 8.1 Real-app frames (the before/after pair the operator's rule requires)

The **before** frame is already committed:
`docs/evidence/settings-backend/arrival@1380/localOperatorDark.webp` (and
`@1000`), showing the two bare inputs. Take the measurement twice anyway — once
at the base commit and once on the branch — because a pair from one tree is what
makes a regression visible.

The surface needs a **new scene in `scripts/renderer-driver.mjs`**
(`--scene settings-model`), not just storybook stories, because the whole point
is that the options come from the ops and gated rows cannot be driven without a
backend (the driver's own contract: `docs/agent-driver.md`, "The commands" and
"The verbs"). It must run with `--backend <isolated URL>` **and a renderer built
against that URL** (`VITE_LOCAL_OPERATOR_API_URL=… pnpm build`), plus
`--seed-onboarding-complete`.

Isolation, per `~/local-operator/AGENTS.md` ("Isolating a run"):

- `--user-data-dir` in a scratch tree (the driver already does this), **and**
- a fresh `HOME` per run plus `LOCAL_OPERATOR_CONFIG_DIR` — the config dir alone
  does not redirect the model catalogue's on-disk cache, whose root is derived
  from `HOME`; and two QA rounds have already been lost to a catalogue cache the
  same session wrote into the real home;
- every inherited `CMUX_*` and `LOP_*` variable unset (an inherited
  `CMUX_WORKSPACE_ID` has renamed the operator's real cmux workspaces, and an
  inherited `LOP_MOBILE_CHILD_PROVIDER`/`_MODEL` silently runs a cell on a
  provider the fixture never chose).

States to capture, each as a pair where a before exists:

| State | What it proves |
| --- | --- |
| closed, empty (`hosting` unset) | the placeholder and the affordance that were missing |
| closed, set (`hosting: openrouter`, `model_name: deepseek/deepseek-chat`) | the field shows a *value*, and the value shown is not the shape stored |
| open, unfiltered, `hosting` | the **whole** login registry, including a provider with no credential (this is the operator's "centralised login state" claim) |
| open, filtered, `model_name` | draft-aware scoping: rows obeying the hosting row's draft before it is saved |
| open, no match, then Enter | free text commits — the assist-never-constrain contract |
| closed, unknown current value | a stored model the catalogue does not contain still renders |
| `models.catalogue` failing / partial (`errors` non-empty) | the row degrades to a usable field with a note, not an error wall |
| `credentials_known: false` | everything listed, nothing badged |
| narrow (620px) | the popover does not escape the window |
| keyboard: Arrow, Enter, Escape | the frame of an Arrow-highlighted row and of Escape-after-typing reverting the text |

Plus `pnpm dev`-free verification that `writing` the rows still works: press
`Save`, read the row from `settings.list` again (the driver's `facts()`/scenes
can assert route and state, so assert the row went clean rather than relying on
the pixels).

### 8.2 Storybook surface, and its trap

New stories (following `backend-settings.stories.tsx`'s shape: the shipped
section over `scripts/fixtures/backend-settings-registry*.json`, with a stubbed
`window.api.desktop.request` answering the ops this surface issues — `providers.list`
and `models.catalogue` — and a named refusal for anything else):

- `Settings/Model combobox` — the component alone, in its chrome-less and
  labelled variants, over a hand-built option list (including a row with a
  `group`).
- `Settings/Backend`, new stories on the existing story file for the three states
  the section's own fixtures can produce.

Register every one of them in `scripts/capture-evidence.mjs`'s `STORIES`
(`:152`, the settings rows live at `:953-967`) — the registry asserts that every
id exists before it takes a frame (`:2510-2520`), so a story without a row is a
story nobody photographs, and `check-evidence` derives its counts from that
literal.

**The trap, stated for the coder:** the storybook fixtures carry `placeholder`,
`warning` and `gated_by`, which the *released* `_view` does not project
(`backend-settings-registry.mjs` header says exactly this, "a frame is not
evidence that the shipped wire carries them"). So a placeholder that comes from
`setting.placeholder` would look right in every frame and be absent in the app.
§ 4.4's client-side placeholder is the fix; a frame cannot catch the mistake.

### 8.3 Pure logic, as `node --test` modules under `scripts/`

Following `scripts/backend-settings-tiers.test.mjs` — which builds the **shipped**
module with esbuild (`build({stdin: {contents: 'export * from "./src/…"'}})`) so
a second implementation cannot pass while the product disagrees. Add to that
file's family:

- `scripts/backend-setting-combos.test.mjs` — the key→source map: every key it
  names is a key the registry fixture sends (the drift direction that matters),
  and the three shapes resolve to the right `ComboKind`.
- `scripts/model-setting-options.test.mjs` — the option builders, over a
  hand-built `DesktopModelCatalogue` and `DesktopProvider[]`:
  - `model_name` stores `model_id` and shows `selector`;
  - `subagents.models.*` stores and shows the selector;
  - the hosting-narrowing rule, **including both fallbacks** (§ 4.2: unknown
    hosting → whole list; current value always present) — this is the part most
    likely to be wrong and the cheapest to pin;
  - `credentials_known: false` produces no sign-in grouping;
  - `providerReadiness` is used for provider rows, so a local provider says
    "No key needed" and not "Signed in";
  - the ordering comparator: usable before not-usable, effective hosting first,
    otherwise backend order preserved.
- `scripts/searchable-select.test.mjs` — the moved component's filter/`fold` and
  the exact-name-beats-free-text rule, driven directly rather than through a
  frame.

**And add every new test file to `package.json`'s `test:desktop` list** — that
list is hand-written (`package.json:77`) and CI's "Assert the suite actually ran"
step reads the log, so a test file nobody listed runs nowhere. `searchable-select.test.mjs`
if the filter moves into an exported function; if it does not, say so in the PR
rather than leaving it untested.

### 8.4 Geometry and contrast

- Extend `scripts/backend-settings-geometry.mjs` with a state that puts the new
  controls on screen and re-report the numbers it exists for — rows per screen,
  "how many controls are still full width", and "how many focusables the closed
  default state contributes". The last one is the interesting one: a combobox
  adds no tab stop beyond its `<input>`, and if that number moves, the PR has
  added an affordance it did not intend to.
- `pnpm check-themes` (`scripts/contrast-contract.mjs`). The combobox's own
  boundary is the `Input` primitive, already covered by the `input field` row
  (`:163`). **What is not covered is the option highlight**: `bg-accent-wash` on
  `elevated`. `picker-host.tsx:396-411` measured that pairing as failing in
  `obsidian` and added a 1px `outline-control` edge, and the contract has a
  `picker row pointer mark` row (`:238`) that asserts the **role**, not the class
  string, "because the string stayed green while the role collapsed". If the
  moved component keeps `bg-accent-wash` as its only mark, add its row in the
  same commit — or take the picker's outline edge and reuse its row.

### 8.5 The manifest re-stamp

`docs/evidence/manifest.json`'s `srcTree`/`scriptsTree` are `HEAD:src`/`HEAD:scripts`
hashes, checked by `provenanceFailures` in `scripts/evidence-manifest.test.mjs`
(asserted in `test:desktop`, so this fails CI, not just a local gate). **Any
commit that moves `src/` or `scripts/` invalidates them**, and this PR moves both
(the component's path, and the new scripts). So: re-capture the surface, then
re-stamp, in the same PR — and note that a *re-stamp alone* is legitimate only
where nothing under `src/` moved in the same commit (the manifest's own
`collapseGuardRestampNote` is the worked example).

**This design commit is `docs/`-only, so it costs no re-stamp** — `docs/` is
outside both stamps. That is deliberate: the design lands before the code so the
coder's commit is the only one that has to move the manifest.

---

## 9. Gates

CI (`.github/workflows/ci.yml`) runs: `pnpm lint` (biome over
`src bin scripts/linux-sandbox.test.mjs`) and `pnpm lint:scripts` (the
`scripts/` ratchet — **this PR touches `scripts/`, so the touched files must come
out clean**), `check-types` + `check-edit-diffs`, `test:desktop`, the runtime
dependency allowlist, `pnpm audit`, and the npx pack/run sanity job.

Run locally as well, because CI does **not** run them:

| Gate | Why for this PR |
| --- | --- |
| `pnpm check-themes` | § 8.4; no workflow runs it |
| `pnpm check-evidence` | the manifest stamps and counts, § 8.5 |
| `pnpm build` | no CI job builds the tree standalone; the npx job builds to pack, and a broken renderer entry only shows here |
| `node scripts/capture-evidence.mjs --only=…` | the frames themselves |
| `pnpm test:desktop` (with the new files listed) | includes the evidence-manifest stamp half |
| `pnpm storybook` / `build-storybook` | the new stories must render before they can be captured |

One ordering note the coder will hit: `capture-evidence.mjs` drives Storybook,
and on this tree `.storybook/main.ts` already sets `reactDocgen: "react-docgen"`
(the capture script's header still describes the older, broken pairing) — read
the config, not the header.

---

## 10. Risks to watch during rollout

1. **Narrowing by hosting can blank the list** if a hosting id and a catalogue
   provider id ever disagree (aliases, `noop`→`test` at
   `configure.py:2376-2381`, a local server that lists nothing). The fallback in
   § 4.2 is the mitigation and its test is the one that matters. Watch: the QA
   matrix must include a hosting whose catalogue is empty, and a hosting that is
   not a catalogue provider id at all.
2. **The second control on the page.** After this PR the settings page has four
   provider/model controls (§ 7.3). Watch the design round for a reviewer asking
   why two of them behave differently — the answer is § 7.3's follow-up, and if it
   is not in this PR it must at least be in the PR description.
3. **The unknown-value rescue wearing the wrong badge.** A synthesised row for a
   stored-but-unknown model must not claim a sign-in state, a price, or a
   context window it does not have (`model-select.tsx:275-283` labels it "Custom
   model"; the picker labels a *current* row with `data-current`). Watch: the
   design round on the unknown-value frame.
4. **Accent-wash highlight on `elevated`** (§ 8.4). Watch: `pnpm check-themes`
   plus the `obsidian` frame specifically.
5. **The popover inside a scrolled region.** The settings body is a scroll
   container (`backend-settings-section.tsx`'s placement/scroll model, and
   `settings_view.py:96-104`'s TUI counterpart exists for the same reason). A
   popover that pushes the edited row off-screen, or that is clipped by an
   ancestor's `overflow`, is the failure. Watch: the narrow frame and the
   geometry rig's row-visibility numbers.
6. **A quota of one fetch per page open.** Four combobox rows sharing one query
   key is the design; a wrapper that builds its own key per row would fetch four
   times. Watch: the driver scene's network/state facts, or simply assert the
   key is the picker's.

---

## 11. The riskiest assumption, and the check that would falsify it

**Assumption: that the model list is the right thing to show at all for a key
that stores a bare `model_id`.**

Everything downstream of § 4.2 assumes a `models.catalogue` row's `model_id` is
the same string `hosting` + `model_name` will boot. The TUI's own contract says
so (`bootstrap.py:64-104` reads the two keys independently), and the configured
fixture in this repo holds `model_name: "deepseek/deepseek-chat"` — a
**selector-shaped** value the contract says the key does not hold — which is
either a fixture error or evidence that the key has held both shapes in the wild.

**The check that falsifies it is cheap and should happen before the wrapper is
written:** take the operator's own `config.yml`'s `hosting`/`model_name`, and for
each catalogue row assert that the pair actually boots — or, minimally, that the
stored `model_name` appears as the `model_id` of at least one row **whose
provider is the stored hosting**. If the cross-product is not 1:1, § 4.2's
narrowing is the wrong mental model and the field needs the TUI's
disambiguation-only approach instead (full list, selector in the label). QA is
where that runs; the design does not need it to start, but the coder should not
be surprised by it.

The second-riskiest, for the same reason: **`subagents.models.*` holds
`provider/model` and the model list's rows hold a bare `model_id` with a separate
`provider` field** — so the selector option ids are *assembled*
(`${row.provider}/${row.model_id}`), not read off the wire. The wire does carry a
`selector` (`desktop-control-contract.ts:41-65`), so assemble it from that field
and do not re-derive it with a template literal; a model id containing a `/`
(`anthropic/claude-opus-5` on `openrouter`) is exactly where a naive
`split("/")` and a naive join disagree, and `effort_tier_rejection`'s
`partition("/")` takes the **first** slash as the split
(`subagent.py:392-397`).

---

## 12. Where I think the manager's decisions are wrong

Stated plainly, with the evidence, because a design that agrees with everything
is not doing its job.

1. **"One standardised component in `ui/`" — agreed, but do not author it.** The
   component exists (§ 1.4) and is already on this page writing these keys
   (§ 0.1). Authoring a second one in `ui/` and leaving the first in
   `shared/components/hosting/` is the "second implementation beside the first"
   defect that `docs/branding.md` § 9.1 names, and it would leave two
   searchable single-selects with three different matchers (§ 1.4) in one
   settings page. **Promote and extend; do not write a new control.**
2. **"a thin backend-sourced wrapper that resolves provider/model options from the
   two ops above" — agreed**, with one correction: the wrapper must not be the
   only thing that reads `models.catalogue` lazily, or the chat picker and the
   settings rows fetch the same payload under two keys. Use the picker's own key
   shape (§ 3.4).
3. **"Model options … narrowed by the effective `hosting` value, draft-aware" —
   accepted, with two fallbacks the brief did not name** (§ 4.2), because the
   narrowing is a mapping we do not own and its failure mode must be a longer
   list, never an empty one. I flag this as the decision most worth a second
   opinion in review.
4. **"the UI must not teach a different [semantics]" — agreed, and it is the
   reason for one thing the brief did not ask for:** the free-text commit path
   (the current 5 rows' placeholder-free empty state, § 0.1) must remain
   reachable from a *typed* value, and the clear gesture must be distinct from it
   (§ 4.6). A combobox that can only store what the catalogue knows would be a
   semantics change dressed as an improvement.
5. **Nothing in the brief is wrong about the row targets.** `hosting`,
   `model_name` and `subagents.models.*` is the complete set (§ 7) — but the
   brief's call to "survey the other settings that need the same treatment"
   should be answered with the *negative* result out loud, because three of the
   candidates look like they belong and do not (§ 7's table).

---

## 13. Implementation order, and the two shared files

1. **Probe the evidence surface first** (§ 11's check + one story with the
   popover open, captured). If an open `Popover` cannot be photographed, that
   changes the evidence plan, not the design — but it must be known before
   eleven stories are written against it.
2. **Move `SearchableSelect`** into `ui/` with the re-export shim and the four
   added props; keep `pnpm check-types`, `test:desktop` and the three existing
   call sites green. No stories yet.
3. **Add the stories and their `STORIES` rows, capture, and re-stamp** — one
   commit that takes the frames the component never had, before the settings rows
   depend on it.
4. **The map + the option builders + their `node --test` modules** (§ 3.5,
   § 8.3). Pure, no UI.
5. **The wrapper and the `SettingControl` branch**; wire the five rows.
6. **The driver scene, the geometry state, the frames, `check-themes`, and the
   manifest re-stamp.**
7. **The PR description** carries: the before/after pair, the two deferred items
   (§ 6, § 7.3), and the note that this PR leaves the General section's pair in
   place on purpose.

**The two shared files**, named here so both sides hold them: `ui/index.ts` (the
barrel gets an export) and `package.json` (the `test:desktop` list gets the new
test files). `package.json` is also the release-lock file — **do not touch its
version field** (§ preamble).
