# The row states: a backdrop-relative fill, and the accent bar's removal

Design direction for the operator's ask:

> "The hover colors in the themes in local-operator-ui and selection colors all
> look quite ugly and need to be refined with design. Generally I think hovers and
> selection highlights should be colored and more should be a brightening against
> the backdrop of whatever the item is on dark themes and darkening against the
> backdrop on light mode. When making it colored, you run this risk of looking
> really off-color and ugly. Also remove the left accent bars, they don't look
> really good in the chat sidebar, and restore the left rounding."

Author: designer subagent (local-operator-ui, lopdev team). Every measurement
below is either read from a file in this tree or computed from the fifty-nine
palettes in `src/renderer/src/styles/themes.generated.css` by the readers named
where they are used. § 7 says which half of each rendered frame is a captured
build and which is a proposal render. § 13 lists the four places my re-derivation
disagrees with the brief I was given.

Status: **design direction, implementation not included.** The coder implements
against this document in the next round. `src/` and `scripts/` are untouched by
this change; the only tree it moves is `docs/`.

Read with: `docs/branding.md` (§ 2 colour, § 3 the floors, § 5 radii),
`src/renderer/src/shared/themes/palette-contract.ts` (the two row-role docs),
`scripts/contrast-contract.mjs` (the executable authority), `AGENTS.md`
(environment, evidence, window modes). Line citations are against this
checkout's tree; this branch is cut from `origin/main` at **`3922738d3`**, and
`git diff --stat origin/main...HEAD -- src/ scripts/` is empty for the files
this document is about, so the "before" half of every frame is `origin/main`'s
own state.

**The one-sentence direction.** *A row state is the panel's own colour, lifted;
the hover lifts it and quietens its cast, the selection lifts it further and
enriches the cast — and nothing else about it moves.*

---

## 1. What is there now, measured

The two roles, as shipped, on all fifty-nine palettes. Every number here is
re-derived with `python3 ~/scratchpad/row_state_audit.py` and
`~/scratchpad/row_state_headroom.py` (both readers, no writers) and cross-checked
against `scripts/contrast-contract.mjs`'s own metric, CIE Lab D65 +
CIEDE2000 (kL=kC=kH=1).

| Thing | Measured | Source |
| --- | --- | --- |
| `rowHover`'s `L*` step off `surface`, dark | **1.50 – 2.07** (median 1.61), `obsidian` alone at 4.99 | `row_state_audit.py` |
| `rowHover`'s `L*` step off `surface`, light | **1.50 – 1.92** (median 1.60) | same |
| `rowSelected`'s `L*` step off `surface`, dark | **2.77 – 5.72** (median 4.70) | same |
| The hover's share of its own available `L*` headroom | **30%** (median over 59) | `row_state_headroom.py` |
| Hue gap, `accent` vs `surface`, > 45° | **25 of 59** | § 13.1 — the brief says 26 |
| `C*(rowHover) − C*(surface)` | **−22.19 … +6.74** (median −3.60) | `row_state_audit.py` |
| ΔE00(`rowHover`, `surface`) | **4.00 – 20.42** (median 6.50) | same |
| ΔE00(`rowSelected`, `surface`) | **4.22 – 27.51** (median 10.95) | same |
| ΔE00(`rowSelected`, `rowHover`) | **2.69 – 11.52** (median 6.78) | same |
| `ink-dim` on the selected fill | **5.00 – 6.24** (median 5.09) | same; the selection sits on its own ink floor |
| Available `L*` headroom before `ink-dim` hits 5.0:1 | dark **2.95 / 4.85 / 7.40**, light **4.35 / 7.35 / 12.90** (min/median/max) | `row_state_headroom.py` |

### 1.1 Why the fills are ugly, in one number per palette

The band that makes the mark findable — ΔE00 4.0 or better off `surface`, which
`docs/branding.md:141-143` and `scripts/contrast-contract.mjs:2781-2782` both
state — **cannot be bought on lightness.** I measured it: for a fill at the
panel's own hue and chroma, at the largest step the ink floors allow, the band
off `surface` reaches **4.0 on only 40 of the 59 palettes** and is as low as
**2.08** (`catppuccinMacchiato`); the median is 3.4. Seven palettes could not
reach ΔE00 4.0 with *any* panel-faithful lift inside a 5.0 `L*` ceiling.

So the band is bought on the other two axes, and both of them are visible:

- **the hue axis**, which is why `docs/branding.md:136-138` says the two roles
  are "tints of the palette's own `accent` hue": 25 of the 59 palettes carry an
  accent whose hue (as this contract measures it, Lab `atan2(b, a)`) is more
  than 45° off the panel it is painted on. The measured worst are
  `kanagawaLotus` **176°**, `solarizedLight` **168°**, `arcade` **158°**,
  `cyberpunk` **155°** and `alucard` **154°** — and the shipped values really are
  at those hues, not near the panel's:
  `synth` panel h310 → hover h3 / selected h7; `cyberpunk` panel h305 → hover
  h102 / selected h100; `outrun` panel h294 → hover h20 / selected h14;
  `localOperatorDark` panel h83 → hover h150 / selected h148.
- **the chroma axis**, and it runs in both directions: the hover sits as much as
  **22 chroma below its own panel** (`tokyoNight` C\* 4.79 against a panel of
  13.44, which is the desaturation `fix/row-state-cast-floor` was written about)
  and as much as **6.7 above** it, while `tokyoNightStorm`'s shipped hover is
  **C\* 22.4 on a panel of C\* 16.3** — 6.1 points *louder* than the surface it
  is a state of.

That is the operator's clause 1 with numbers on it: the fill is not a brightening
of the backdrop, it is a **hue-rotated, sometimes desaturated, sometimes louder
plane** laid on top of it. § 7's frames show it: on `localOperatorDark`'s warm
brown panel a green plane with a green leading bar; on `synth`'s violet a maroon
one; on `cyberpunk`'s violet-black an olive one.

---

## 2. The reference, and what I could not see

**The two Slack images are quoted here as a description of record.** I did not
receive them and cannot read them; what follows is the brief's account of them,
and no finding below rests on anything about those pixels that is not also
visible in a frame I did capture (§ 7).

As described: Slack's new dark sidebar, two selected rows on a near-black ground —
"Drafts & sent" a **medium grey fill, clearly a brightening of that ground**,
essentially no hue, fully rounded corners (~8px), no accent bar, no border, label
at full brightness; "# alerts-prod" the **same shape and step**, its fill carrying
a **faint cool cast** over the same near-black ground. Beside them, two
local-operator-ui screenshots showing today's state: a hue-saturated fill with a
bright 2px leading edge bar, and a hover row reading as a muted grey-green plane.

**What the reference asks for and what the operator's words ask for pull in
opposite directions, and the reconciliation is the whole direction:**

- the reference says **step, and a whisper of colour**: both its fills are the
  ground *lifted*, and one of them is lifted with no hue at all;
- the operator's words say **"colored"**.

The reconciliation is that the brightening is the **carrier** and the colour is a
**whisper riding on it** — and the only place a whisper comes from that cannot be
off-colour is **the backdrop itself**. That is the rule in § 4. It is also why
the *amount* of colour is specified as a fraction of the panel's own cast rather
than as an absolute chroma: the reference's fill is white-noise-grey because its
ground is neutral, and a violet panel wants a violet whisper for the same reason.

---

## 3. The four clauses

**(1) "Hover and selection colours look quite ugly" — why, precisely.** § 1.1.
The band the rule was written to reach is unreachable on lightness, so it is bid
on the hue and chroma axes; the hue is the *accent's* while the ground is the
*panel's*, and on 25 of 59 palettes the two are more than 45° apart, with the
shipped values at the accent's hue to the degree. Measured consequence: the fill
reads as a different colour from the thing it is a state of.

**(2) "more should be a brightening against the backdrop", and the direction is
the mode's.** Today's hover spends **30%** of the `L*` it is allowed before
`ink-dim` breaks its 5.0:1 floor on the fill. The direction spends **65%** of the
selection's step, and the selection spends the whole budget. Fleet result: the
hover's step goes from a median of **1.61 to 3.09** on dark and **1.60 to 3.25**
on light; the selection stays at the cap (`median 4.70 → 4.76` dark, `4.87 → 5.00`
light) because it was already spending it. The floor direction is unchanged and
stays asserted: brighter on a dark palette, darker on a light one.

**(3) "when making it colored, you run this risk of looking really off-color and
ugly" — so the colour comes from the backdrop, and is bounded twice.** The hue is
the panel's own (§ 5.1). The hover's chroma may not exceed the panel's, and the
selection's may exceed it by at most **4** — a bounded rise above the panel and
never more than the file's existing absolute cap of 24. Nothing else about a row
state is a free variable.

**(4) "remove the left accent bars … and restore the left rounding."** The bar
goes from `rowCurrent` (`chat-sidebar.tsx:273-274`), which is the shared constant
five surfaces import; the two *popup* bars (`slash-commands.tsx:1038`,
`at-picker.tsx:788`) stay, for the reason in § 8.2. The rounding was never lost —
`rowStyle` carries `rounded-md` (`chat-sidebar.tsx:69-70`) — the bar's square
leading edge (`before:inset-y-0 before:left-0 before:w-0.5`) painted *over* the
6px corner and squared it visually. Removing the bar restores what was already
there, and § 8.3 says why 6px is the right radius rather than a larger one.

---

## 4. The rule, as a procedure

**THE GROUND THE RULE ASSUMES, stated here because every step below reads
`surface`: a surface that paints `rowCurrent` or `hover:bg-row-hover` wears
`surface`.** Both roles are authored as steps OF the panel's own colour, so the
panel they are painted on has to be the panel they were authored against: on a
rung (`sunken`, `canvas`, `elevated`) a state lands inside the ladder instead of
out of the panel — measured, ΔE00 **0.44** on `alucard`, a fill the reader cannot
see. It is asserted per call site in `scripts/chat-sidebar-selection.test.mjs`,
which resolves each one's painted ancestor and fails a `rowCurrent` surface on a
rung; § 9.2 records the premise this replaced and why re-asserting the roles
against the rungs instead was measured and refused.

Per palette, in this order. Every constant is named; § 5 gives each one its
reason and § 6 its measured consequence.

```
1. HUE       hue ← hue(surface)                      # the panel's own cast
             if C*(surface) < 2.0: hue ← hue(accent) # a cast-less panel has no hue to be faithful to

2. CAST      C*(rowHover)    = clamp(0.60 × C*(surface), 2.5, 24)
             C*(rowSelected) = clamp(C*(surface) + 4.0, 5.0, 24)

3. CEILING   step_selected ← min(H, 5.0)
             H = the largest raised L* step at which ink / ink-muted / ink-dim still
                 read 7.0 / 5.5 / 5.0 on the fill, authored 0.02:1 above each floor

4. HOVER     step_hover ← clamp(0.65 × step_selected, 1.5 + 0.02, step_selected − 1.15)
             the lower bound is the absolute floor plus ONE 0.02 authoring grid
             step. The floor itself is 1.5 and it is asserted on the AUTHORED
             hex, so a value authored AT the floor can round to 1.49 and fail a
             bound it is allowed to sit on; authoring one grid step above it is
             what makes the authored value and the asserted value the same
             statement. The fleet's achieved hover step bottoms at 1.53.
             then walk step_hover DOWN in 0.02 steps until the rank, measured on the
             AUTHORED hexes, clears 1.0 L*

5. AUTHOR    hover    = the hex for (L*(surface) ± step_hover,    C*(rowHover),    hue)
             selected = the hex for (L*(surface) ± step_selected, C*(rowSelected), hue)
             ± is + on a dark palette and − on a light one
```

The values are **authored as the hex the triple resolves to**, with the
measurement beside it, exactly as the roles are authored today — never computed at
runtime, never a mix percentage. The procedure is deterministic: it reads only
`surface`, `accent`, `ink`, `ink-muted`, `ink-dim` and the mode.

The fleet result, over all 59 (and, where the split matters, over the 41 dark and
the 18 light separately — every cell below carries its own population, because a
reader comparing two medians drawn from different sets is not comparing like with
like):

| quantity | before | after |
| --- | --- | --- |
| hover step `L*` | 1.50–4.99 (1.61) · dark 1.50–4.99 (1.61) · light 1.50–1.92 (1.60) | **1.53–3.86 (3.17)** · dark 1.53–3.38 (3.03) · light 2.79–3.86 (3.23) |
| selection step `L*` | 2.77–5.72 (4.87) · dark 2.77–5.72 (4.70) · light 4.07–4.99 (4.90) | 2.56–5.16 (4.89) · dark 2.56–5.16 (4.60) · light 4.14–5.07 (4.94) |
| hover's share of the selection's step | 0.30–0.87 (0.34) | **0.57–0.77 (0.66)** |
| ΔE00 off `surface`, hover | 4.00–20.42 (6.50) · dark 4.00–15.48 (6.78) · light 4.30–20.42 (6.09) | 1.67–5.81 (**3.58**) · dark 2.02–5.81 (3.81) · light 1.67–5.52 (2.72) |
| ΔE00 off `surface`, selection | 4.22–27.51 (10.95) · dark 4.22–21.23 (10.58) · light 6.56–27.51 (11.45) | 3.18–6.86 (4.26) · dark 3.18–5.23 (4.21) · light 3.29–6.86 (4.50) |
| pair separation | 2.69–11.52 (6.78) · dark 3.56–11.52 (6.88) · light 2.69–11.29 (6.22) | 2.15–7.01 (**5.68**) · dark 2.75–7.01 (6.01) · light 2.15–6.79 (4.16) |
| `L*` rank — `\|selection − hover\|`, MODE-SIGNED (`contrast-contract.mjs:3330-3333`: the raw difference is negative on a light palette by construction, so the rank is its magnitude) | **0.72–3.48 (3.22)** · dark 0.72–3.46 (2.97) · light 2.45–3.48 (3.33) | **0.94–2.03 (1.62)** · dark 0.94–2.03 (1.53) · light 1.18–1.94 (1.67) |
| `C*` rank (`C*(selection) − C*(hover)`, measured on the authored hexes) | −14.43–17.79 (7.82) · dark −14.43–17.79 (8.09) · light 2.14–16.57 (7.54) | **2.07–12.09 (7.52)** · dark 2.74–12.09 (8.05) · light 2.07–10.86 (4.78) |
| `ink-dim` on the selection | 5.00–6.24 (5.09) | 5.02–6.24 (5.10) |

The `C*` rank row is measured on the AUTHORED hexes, not on the rule's target
triples: the clamp difference `max(5.0, C*(surface)) − max(2.5, 0.5 × C*(surface))`
is 2.50 at a cast-less panel, and no hex reaches it — `oneLight`'s round trip
takes its hover to `C*` 2.61 and its selection to 4.68, a rank of 2.07, which is
where the fleet's minimum sits.

The band off `surface` falls and the pair separation's median falls with it — both
are § 9's assertion change and the trade clause 2 makes, since 6.78 was bought by
hue rotation. **The `L*` rank does NOT rise; it falls**, from 3.22 to 1.62, because
the hover now takes 66% of the selection's step where it used to take 34%. What
improves is (i) the **worst** rank — 0.72 (`obsidian`) becomes 0.94
(`catppuccinMacchiato`) — and (ii) the `C*` axis, which ran **backwards on 2 of
the 59** before (`tokyoNightStorm` −14.43, `kanagawaWave` −5.06) and on none now.
§ 5.4's conclusion — that the fill ranks the pair and the rank is asserted where
it was not — is what the numbers support; the ordering of the rank did not move
the way the first draft of this table claimed.

---

## 5. Each decision, with its reason

### 5.1 Hue source: the panel's, not the accent's

**The rule is the panel's own hue, and the accent's only where the panel has no
cast** (`C*(surface) < 2.0`) — the seven palettes `githubLight`, `gruvbox`,
`highContrastLight`, `iceberg`, `linen`, `oneLight`, `tokyoNightDay`.

Three arguments, all measured.

- **It is the only source that cannot be off-colour.** The fill's job is to be a
  state *of the surface it is painted on*; a hue taken from the panel is inside
  that surface's own colour by construction. The accent is a different object with
  a different job (primary action, links, focus ring, the popup's pointer mark),
  and it is 45°-plus away from the panel on 25 of 59 palettes — the mechanism of
  § 1.1.
- **The 12° bound stays, re-anchored.** `ROW_STATE_HUE_LIMIT = 12`
  (`contrast-contract.mjs:2813`) becomes a bound on the panel's hue instead of the
  accent's; every authored value sits at exactly 0° of it, so the assertion is now
  satisfied with the whole of its slack unused rather than being the thing the
  values press against.
- **The seven cast-less palettes are the case the accent's hue was invented for,
  and they keep it.** A panel at C\* < 2 has no hue to be faithful to, so the
  fill takes the accent's — at the rule's own low chroma (2.5 hover / 5.0
  selected), which is the reference's "faint cool cast on a near-black ground"
  arriving on `obsidian`, whose accent is `#FAFAFA` at C\* 0 and which therefore
  falls back to the panel's hue and stays neutral. That is the class
  `contrast-contract.mjs:2829-2843` already defines, re-keyed from the *accent's*
  chroma to the *panel's*.

**What happens in the 25 hue-rotated palettes is that they simply stop rotating.**
`synth`'s hover goes from h3 to h310 — the panel's; `cyberpunk`'s from h102 to
h304; `outrun`'s from h20 to h293; `localOperatorDark`'s from h150 to h81. The
accent keeps every other job it has, including the two popup bars (§ 8.2).

### 5.2 Chroma policy: bounded, and anchored on the panel

**The hover never exceeds the panel's cast; the selection exceeds it by at most
4.** Panel-relative rather than accent-relative, for the same reason the hue is:
the row sits *on* the surface, so the surface is the reference. The accent's
chroma is not a fact about this row at all.

- **A floor, so it reads as coloured rather than grey.** The declared-and-
  unasserted `ROW_HOVER_CHROMA_FLOOR = 4` / `ROW_SELECTED_CHROMA_FLOOR = 8`
  (`contrast-contract.mjs:2808-2809`) become asserted panel-relative floors
  `max(2.5, 0.5 × C*(surface))` and `max(5.0, C*(surface))`. That is the defect
  `fix/row-state-cast-floor` found, at the value the new rule needs: its own
  proposal was `max(4, C*(surface))`, i.e. the fill may not be *less* coloured
  than its panel. § 5.2.1 says why this rule needs the fraction rather than the
  whole.
- **A ceiling, so it never becomes a saturated plane.** The hover's ceiling is
  `C*(surface)`. The selection's is `min(C*(surface) + 4, 24)`: the one axis on
  which a row may be more coloured than its backdrop, bounded, and what buys the
  pair's rank where the ink floors leave no `L*` room (§ 6, `rosePine`).
- **Why the accent-relative ceiling had to go.** `min(0.6 × C*(accent), 24)`
  permitted C\* 24 on `tokyoNightStorm` (accent C\* 48.1 against a panel of 16.3)
  and the shipped hover sat at 22.4 — 1.4× its own panel's cast, the loudest row
  in the fleet, bought entirely on the chroma axis so the band could be met
  without lighting the row. A ceiling expressed in the accent's chroma cannot see
  that, because the accent's chroma is not the row's backdrop.

#### 5.2.1 Why the hover's cast is a fraction of the panel's, and not the whole of it

`fix/row-state-cast-floor`'s central measurement is that a fill **less saturated
than the surface it sits on** reads as a grey wash of that surface, and it is
right about the case it measured: `tokyoNight`'s hover at C\* 4.79 on a panel of
13.44 — 36% of the panel's cast — *and rotated to another hue*. Two things are
different here, and both are measurements rather than assurances:

- **the hue is held**, so a 60% cast is the panel's own colour at 60% strength,
  not a grey version of a different colour. On `tokyoNight` the new hover is
  `#3A3B48` at h276 against a panel at h288 — a quieter blue-grey, in family,
  where the shipped one was h276 C\* 4.8 *and* the panel's own hue was 288, which
  is the case the branch was measuring;
- **the selection carries the panel's full cast and 4 more**, so the *pair* is
  never two greys, which is what the branch's own pair finding was about: today
  the pair's chroma rank is **inverted** where the hover desaturates and the
  selection does not. Under the rule the sign is fixed and the fleet's `C*` rank
  runs **2.50 – 11.46**.

The floor is asserted at `max(2.5, 0.5 × C*(surface))`, so a future palette cannot
quiet its hover past half its own cast and pass.

### 5.3 The `L*` step: the carrier, and it is spent against the headroom

| | floor | what the rule takes | fleet median | fleet range |
| --- | --- | --- | --- | --- |
| `rowHover`, absolute | 1.5 `L*` (unchanged; authored at 1.52, § 4) | `0.65 × step_selected` | 3.17 (dark 3.03, light 3.23) | 1.53 – 3.86 |
| `rowHover`, **share of the selection** | **0.5 ×** (new) | `0.65 ×` | 0.66 | 0.57 – 0.77 |
| `rowSelected` | 1.5 `L*` (unchanged) | the whole legal budget, capped at 5.0 | 4.89 (dark 4.60, light 4.94) | 2.56 – 5.16 |

**The absolute hover floor stays at 1.5 and clause 2 is asserted as a
relationship instead** — `step_hover ≥ 0.5 × step_selected`, a new constant
(`ROW_HOVER_STEP_SHARE_FLOOR`). An absolute floor cannot encode clause 2 on this
fleet: the hover's step is bounded by the budget the ink floors leave the
*selection*, so asking for an absolute 2.0 on every palette would force the pair's
rank below 1.0 on `catppuccinMacchiato`, `rosePine` and `palenight` (§ 5.4)
rather than buy anything. A share of the selection's step is the shape the
operator's sentence actually has — *more* of the signal than the shipped 34% — and
it holds everywhere with the measured minimum at **0.57** (`rosePine`, the palette
the rank clause walks down furthest). The shipped share before this change ran
0.30–0.87 with a median of **0.34**, so the median share roughly doubles, which is
the 2× the clause asks for. The fleet's hover step bottoms at **1.53 `L*`**
(`rosePine`), one authoring grid step above the floor, exactly as § 4's rule
produces; `catppuccinMacchiato`, whose whole legal budget is 2.56, measures 1.62.

`step_selected` is capped at 5.0 by the existing `ROW_SELECTED_STEP_CEILING`, and
underneath that by the three ink floors, which is what binds almost everywhere:
**44 of the 59 palettes sit below the ceiling** (median 4.89, dark 4.60, light
4.94), so on dark the ink floor — not the ceiling — is the limit. **No palette is
asked for a step it cannot take**: `step_selected = min(H, 5.0)` reads `H`, so a
palette whose ink-legal budget is under the ceiling takes the budget — the two the
brief named take 2.56 (`catppuccinMacchiato`) and 2.70 (`rosePine`) — and the rule
does not ask for more.

**Where the budget is spent on the pair, and where it is not.** On **57 of 59**
palettes the pair separates by ΔE00 2.68 or more, because the selection's extra
cast does the rest of the work the rank no longer does. On **`catppuccinMacchiato`**
the rank is **0.94 `L*`** against the 1.0 floor: its legal budget is 2.56, so the
selection cannot rise past it and the hover cannot fall below its own floor without
the ink floors refusing the hover instead. The floor that refuses is
**`ink-dim`'s 5.0:1 on the selection**, and this is the one palette in the fleet
where the pair is ranked by its chroma rank (10.72) rather than by its lightness.
§ 9 states it as a named shortfall rather than a relaxed floor.

### 5.4 The hover-vs-selection separation: the fill ranks now

**What replaces the bar as the ranking channel is the fill itself, on two axes.**
The direction changes the *jobs* of the two roles, and `palette-contract.ts:288-295`
is the text that has to change with it:

> `rowHover` is the POINTER's mark and is LOAD-BEARING … THIS role is SUPPORTING.
> What says "you are here" is the 2px `accent` bar plus `font-medium` … so the
> selection's fill only has to be FINDABLE, not rankable. The ranking is the
> bar's job, not the colour's.

Under the direction there is **no bar**, so the fill has to rank. The floors:

- **`L*` rank ≥ 1.0** (was `ROW_STATE_HOVER_RANK` 0.5) — doubled, and the
  authoring order targets 1.15 so the *painted* rank clears 1.0 after the hex
  round trip;
- **`C*` rank ≥ 2.0** (new) — the selection must carry at least 2 chroma more
  than the hover. This is the axis that costs nothing: `L*` determines relative
  luminance, so contrast ratios are blind to chroma, and the pair can be ranked on
  cast at zero ink cost. The fleet's `C*` rank is 2.07 – 12.09 (median 7.52);
- **pair separation ≥ ΔE00 2.0** (unchanged) — `oneLight` (2.15) and
  `highContrastLight` (2.16) are the two nearest it, and the fleet's median is
  5.68 … 6.01 on dark.

And `font-medium` stays, which is why the least-privileged palette
(`obsidian`, whose panel has almost no cast) still has a non-colour mark.

### 5.5 The non-colour marks that remain

- **`font-medium` on the selected row — kept.** It is the one non-colour mark the
  row keeps, it is already in `rowCurrent`, and it is the whole of the mark on
  `obsidian` where the cast is 2.1.
- **The 2px accent bar — removed** (§ 8.2).
- **No edge, no ring, no border.** `palette-contract.ts:340-344` already forbids
  a ring or a four-sided border for this role, retired by design round 1 because
  the ring rendered as the search field above the list. Nothing here reopens that.
- **The fill now ranks, and that is the change of contract**: the docstring's
  "only has to be FINDABLE, not rankable" becomes "the fill carries the ranking,
  with `font-medium` as the non-colour half", and § 5.4's three floors are what
  assert it.

### 5.6 The dark/light asymmetry, and which way a step goes

Unchanged from the contract and asserted in the same place
(`contrast-contract.mjs:3067-3072`): a dark palette's fill is **lighter** than its
panel, a light palette's **darker**. What the direction adds is that both modes
now take *more* of it — the light palettes' steps were as small as the dark
ones' and their headroom is larger (median 7.35 against 4.85), so the light
fleet's hover goes from 1.50–1.92 to 2.79–3.25 and its selection to a flat 5.00.
That is also the operator's own read of the light palettes — "their shape is
already the darkening the operator asks for, they are only over-saturated" — and
the chroma half of the rule answers the saturation: `kanagawaLotus`'s selection
goes from C\* 11.8 at the accent's h278 to C\* 24.0 at the panel's h102;
`everforestLight`'s from 20.7 to 16.9.

---

## 6. The worked table

Ten palettes: the two brand ramps, the neutral class, the two worst hue rotations
by the brief's own list, the highest panel cast, and a light palette with a
strong cast. `H` is the available headroom; the bands are ΔE00 off `surface`;
`inkDim(s)` is the ratio on the selected fill.

**THE AFTER COLUMN IS WHAT SHIPPED, NOT WHAT THE RULE ASKS FOR, AND THIS IS A
CORRECTION TO HOW THE TABLE READ.** Every after-cell is ONE VALUE read three
ways — the hex from `themes.generated.css` and that hex's own cast, hue and `L*`
step measured from it — so a cell here and its row in the appendix are the same
numbers, and `contrast-contract.mjs` measures the same quantity. The rule's own
targets are § 4's, and they sit within the 8-bit round trip of these rather than
beside them: the round trip moves the cast by up to 0.6 (`synth`'s selection target
24.0 resolves at 23.4), the step by up to 0.19 (`tokyoNightStorm`'s selection 4.44 →
4.25), and the hue by up to 11 degrees (`dune`'s hover, authored at the panel's 66
and resolved at 55, inside the rule's own 12-degree bound). An earlier revision of
this table read the step and cast from the RULE while the hex in the same cell was
the SHIPPED one, which is how one hex came to carry two different steps across § 6
and the appendix. `dune` is also the one row whose rule-TARGET the document no
longer states at all: the remediation round lifted its hover step off the rule's
`0.65 × step_selected` to the lowest rung that clears the 2.0 field floor.

| palette | mode | panel | H | hover: before → after | selected: before → after | band h/s | pair | rank | inkDim(s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `localOperatorDark` | dark | `#2b2721` L\*15.9 C\*4.7 h83 | 4.4 | `#272C28` h150 +1.52 (band 5.91) → **`#302D29` C\*3.1 h81 +2.78** | `#1F3624` C\*16.2 h148 +4.40 (15.40) → **`#372F24` C\*8.6 h80 +4.06** | 2.30 / 4.16 | 4.49 | 1.28 | 5.05 |
| `localOperatorLight` | light | `#f7f5ee` L\*96.5 C\*3.6 h99 | 5.4 | `#E4F5E8` h151 +1.51 (8.68) → **`#EDECE7` C\*2.6 h102 +3.17** | `#CFEFD7` C\*17.0 h151 +4.87 (14.46) → **`#EBE7D8` C\*7.9 h99 +4.93** | 2.11 / 4.52 | 4.44 | 1.77 | 5.04 |
| `obsidian` | dark | `#2A2A2D` L\*17.2 C\*2.1 h291 | 5.7 | `#353535` C\*0 h338 +4.99 (4.05) → **`#313135` C\*2.7 h291 +3.30** | `#37363B` C\*3.4 h299 +5.72 (4.22) → **`#34343D` C\*6.0 h292 +4.86** | 2.34 / 4.91 | 3.18 | 1.56 | 5.16 |
| `synth` | dark | `#2E1D42` L\*14.7 C\*26.8 h310 | 5.9 | `#2F2628` C\*4.6 h3 +1.53 (15.48) → **`#32273E` C\*16.6 h310 +3.12** | `#3F2A2E` C\*10.6 h7 +4.98 (14.36) → **`#39294A` C\*23.4 h311 +5.15** | 5.81 / 3.84 | 4.06 | 2.03 | 5.13 |
| `outrun` | dark | `#232543` L\*15.9 C\*21.0 h294 | 4.0 | `#312929` C\*3.9 h20 +1.52 (14.68) → **`#2C2C3E` C\*12.4 h293 +2.80** | `#402B2D` C\*10.4 h14 +4.14 (15.69) → **`#2B2D51` C\*24.5 h294 +4.05** | 5.46 / 3.23 | 6.88 | 1.25 | 5.02 |
| `tokyoNightStorm` | dark | `#2B3048` L\*20.4 C\*16.3 h287 | 4.3 | `#253455` C\*22.4 h282 +1.54 (4.27) → **`#353745` C\*9.3 h287 +2.98** | `#373A46` C\*8.0 h283 +4.16 (6.44) → **`#323958` C\*20.5 h287 +4.25** | 5.03 / 3.81 | 6.92 | 1.27 | 5.04 |
| `cyberpunk` | dark | `#282332` L\*14.9 C\*10.9 h305 | 3.9 | `#2A2923` C\*4.2 h102 +1.64 (14.55) → **`#2C2932` C\*6.4 h304 +2.37** | `#312E1C` C\*12.3 h100 +3.90 (21.23) → **`#302A3F` C\*14.7 h303 +3.69** | 3.97 / 3.59 | 6.26 | 1.32 | 5.03 |
| `kanagawaLotus` | light | `#E9E2B6` L\*89.4 C\*22.9 h102 | 8.3 | `#DADCE4` C\*4.2 h281 +1.62 (20.42) → **`#DDD8BE` C\*13.7 h101 +3.33** | `#CBD3E9` C\*11.8 h278 +4.87 (27.51) → **`#DBD4A6` C\*24.2 h102 +5.00** | 5.52 / 3.29 | 5.82 | 1.67 | 5.51 |
| `dune` | dark | `#2C2825` L\*16.4 C\*2.9 h66 | 4.4 | `#342A23` C\*7.1 h62 +1.51 (4.00) → **`#322E2C` C\*2.4 h55 +2.85** | `#462C1C` C\*18.2 h57 +4.34 (12.07) → **`#393029` C\*6.6 h66 +4.17** | 2.05 / 4.35 | 3.84 | 1.33 | 5.03 |
| `iceberg` | light | `#F2F3F6` L\*95.8 C\*1.6 h277 | 8.9 | `#EDEEFA` C\*6.2 h287 +1.51 (4.33) → **`#E9E9EE` C\*2.6 h290 +3.37** | `#E2E4F4` C\*8.3 h286 +4.98 (6.56) → **`#E3E4EF` C\*5.7 h287 +5.04** | 2.39 / 4.91 | 2.91 | 1.67 | 5.55 |
| `tokyoNight` | dark | `#313448` L\*22.2 C\*13.4 h288 | 4.8 | `#363940` C\*4.8 h276 +1.72 (7.05) → **`#3A3B48` C\*8.6 h289 +3.03** | `#333F5F` C\*21.1 h283 +4.76 (5.98) → **`#3A3E59` C\*17.6 h289 +4.70** | 4.01 / 4.26 | 6.01 | 1.68 | 5.04 |

Read the hue column: every "after" hue is the panel's (`localOperatorDark` 81/80
against a panel at 83; `synth` 310/311 against 310; `cyberpunk` 304/303 against
305; `kanagawaLotus` 101/102 against 102), and every "before" hue is the accent's.
The one after-hue that reads as a gap is the round trip's: `dune`'s hover is
authored at its panel's 66 and the hex resolves at 55.
Read the `tokyoNightStorm` row: its hover was 6.1 chroma **louder** than the
panel and is now 6.5 quieter, and its selection was quieter than its panel and is
now 4 louder — the two roles swap which side of the backdrop's cast they sit on,
which is the pair rank `fix/row-state-cast-floor` was trying to fix.

`everforestLight`'s and `alucard`'s selections are the extremes worth checking in
the sheet: the first goes from C\* 20.7 at the accent's h111 to C\* 16.9 at the
panel's h98, the second from C\* 12.9 at h305 to C\* 9.7 at h99.

---

## 7. The rendered comparison

The direction is a look judgement, so it is rendered. Two instruments, labelled
for what they are — **the frames are the app's own component; the swatch sheets
are a simulation.**

### 7.1 The app's own sidebar — `docs/design/assets/row-states-refinement/sheet-app-before-after.png`

Ten palettes × four tiles: **BEFORE rest**, **BEFORE with the pointer on the
neighbour above the current row**, **AFTER rest**, **AFTER with the pointer on
the neighbour above**. One tile therefore carries the plain row, the hovered
neighbour, the selected row and the selected row's own text in one frame — the
four states the brief asks for, at the frame's own 2x.

How it was taken, and it follows `AGENTS.md`'s capture rules:

- the **story is the product's**: `chat-sidebar-current-row--selected-row`
  (`chat-sidebar-current-row.stories.tsx`), the same story the committed set
  `docs/evidence/chat-sidebar-current-row/` uses, at the viewport that set uses
  for it (780×560), captured through the **headless Storybook/CDP path** the
  repo's own rig uses (`scripts/capture-evidence.mjs:4395-4440` for the Chrome
  invocation: private scratch `--user-data-dir`, `--use-mock-keychain`,
  `--remote-debugging-port=0`, `--headless=new`).
- **Nothing took the operator's focus**: the run is headless, the tab is never
  raised, and the process group is killed by exact pid when the run ends. No
  `screencapture`, no downloaded browser engine, no `https://localhost` throwaway.
- the theme is driven the way the house rig drives it — `args=theme:<id>` on the
  iframe URL plus a seeded `ui-preferences-storage` before the document's scripts
  run — and each frame asserts `documentElement.dataset.theme` equals the palette
  it is named for before the shutter.
- the pointer is **a real pointer**, dispatched as an `Input.dispatchMouseEvent`
  `mouseMoved` onto the row above the current one and left there while the frame
  is taken, which is the only way a still can hold a hover state.

**Which tree each half came from, exactly.** The BEFORE half is this branch's own
tree — and this branch is `origin/main` at `3922738d3` with no `src/` or
`scripts/` change, so it is `origin/main`'s state (§ 0 above, and
`git diff --stat origin/main...HEAD -- src/ scripts/` is empty). The AFTER half is
**the same tree, the same story and the same cascade, with the direction's two
halves applied at the DOM**:

- the two role values, overridden by an injected
  `:root, [data-theme="<id>"] { --lo-row-hover: …; --lo-row-selected: … }`
  stylesheet — exactly the swap `src/renderer/src/styles/index.css:30-31` maps
  (`--color-row-hover: var(--lo-row-hover)`), so the component really is reading
  the proposed roles;
- the leading bar, removed by
  `[class~="before:bg-accent"]::before { content: none }` — because the bar's
  removal is a **class** change (§ 8.1) and a variable override cannot make one.
  Hiding the pseudo-element by its class *token* is immune to React re-rendering
  `className` back, which a `classList` strip is not: measured, the strip was undone
  before the shutter and the bar was still painted at x=0-3 of the row.

**It is a proposal render, not a shipped build**: the difference from the
post-implementation frame is where the two hexes come from and whether the five
`before:*` utilities are in the class string — nothing else. Verified at the pixel
rather than asserted: on the selected row of `localOperatorDark`, x=0-5 at the
row's mid-line reads `srgb(55,47,36)` (= `#372F24`, the proposed selection) where
the before frame reads `srgb(56,201,106)` (= the accent) for x=0-3 and
`srgb(31,54,36)` beyond it. The `--values` table that drove it is the § 4
procedure as code (`~/scratchpad/rule_final.py`), and the property readback at
capture time is in `~/scratchpad/sb-frames/{before,after}/readings.json` — the
page's own `getComputedStyle` on the selected row and the neighbour, per frame.

A single tile, `sheet-detail-dark.png`, is the same four columns for
`localOperatorDark` and `tokyoNightStorm` at full 2x, which is the pair to look at
first: the green plane with its green bar on a warm brown panel, beside a warm
brown lift with no bar.

### 7.2 The simulation, all fifty-nine — `simulation-59-{before,after}.webp`

**This is a simulation and is labelled as one.** `~/scratchpad/row_sheet.py` draws
the shipped and the proposed role values as a mock sidebar row on each palette's
own panel — a 384×34 row, 6px radius, the label in `ink`, the trailing `· lopdev`
in `ink-dim`, the 2px bar drawn on the before sheets only. It is the map, not the
evidence: it cannot show a toolbar, a hover, or the component's own geometry.
`simulation-12-{before,after}.webp` is the same thing for the ten palettes of § 7.1.

What the pair shows, and it is the brief's reading of the reference confirmed on
the other 49 palettes: on every dark palette the before fill is a **different
colour family** from its panel (`synth` violet → maroon, `cyberpunk` violet →
olive, `outrun` blue-violet → red-brown, `localOperatorDark` brown → green,
`tokyoNightStorm` a hover louder than the panel it sits on); after, every fill is
the panel's own family, lifted.

### 7.3 The frames' own limits

- The tiles are the **row list only**, cropped to the rows' bounding box, so the
  panel's header and the search field are not in frame. `sunken` is NOT where the
  search field lives — the chat sidebar's field is `bg-surface` + `border-control`
  (`chat-sidebar.tsx`) — and the rung this exemption actually had to answer for is
  the **app rail's own `<nav>`, which was `sunken`, and the agent-hub categories
  rail's column, which was on `canvas`**. Both are re-grounded to `surface` with
  frames and a DOM readback in `docs/evidence/row-states-refined/`, so the
  exemption that remains is the `elevated` one and it is about a dialog's ground
  or an input well rather than about a rung a row is painted on. § 9.2 carries the
  sentence this bullet used to point at.
- **No light-theme tile has a hovered neighbour on a light panel with a strong
  cast** other than `kanagawaLotus`; `everforestLight` and `gruvboxLight`, the
  fleet's other two strong-cast light palettes, are in the 59-sheet only.
- The **`· lopdev` binder's `ink-dim`** is legible in every tile but the sheet is
  not a contrast instrument; the ratios in § 6 are from the palette values, not
  from the pixels.

---

## 8. The bar, the rounding, and the popup

### 8.1 The constant

`rowCurrent` (`src/renderer/src/features/chat/components/chat-sidebar.tsx:273-274`)
loses `relative` and the whole `before:*` group:

```
- "relative bg-row-selected font-medium text-ink hover:bg-row-selected before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent";
+ "bg-row-selected font-medium text-ink hover:bg-row-selected";
```

`relative` exists **only** to position the bar, so it goes with it. The
`hover:bg-row-selected` half stays and is not cosmetic: a `hover:` variant
outranks a bare background in the cascade, and without it the pointer repaints the
selected row as the hover — one state painted as the other
(`palette-contract.ts:335-338`, and `scripts/chat-sidebar-selection.test.mjs`
resolves the expression through the shipped `cn` to catch it).

The constant is imported by five surfaces — the settings rail
(`settings-sidebar.tsx:1,244`), the app rail (`sidebar-navigation.tsx:6,203`),
the agents sidebar (`agents-sidebar.tsx:13,136`), the agent-categories sidebar
(`agent-categories-sidebar.tsx:1,51`) and the agents page
(`agents-page.tsx:1,606`) — and 27 `bg-row-*` utilities across `src/`
(`grep -rn 'bg-row-' src/ | wc -l`; 26 in `.tsx`, 24 of those outside `.stories.`)
change with it. That is the blast radius, and it is a *removal*, so every consumer
gets the rounding back for free.

### 8.2 The slash popup's own bar **stays**, and the chat sidebar's goes

The same `before:absolute before:inset-y-0 before:left-0 before:w-0.5
before:bg-accent` idiom appears in three places:
`chat-sidebar.tsx:274`, `slash-commands.tsx:1038` and `at-picker.tsx:788`.

- **The sidebar's goes.** The operator named the chat sidebar, and § 5.4 gives the
  reason it *can* go: the bar existed to rank the selection against the hover
  because both fills were the same hue at two strengths, and now they are not —
  the fill ranks on `L*` and cast. Keeping it would also keep the fill squared.
- **The two popups' stay.** They are a different surface with a different job:
  the slash popup's active row is the row **Enter will apply**, in a transient
  popup over the composer, where the fill alone was measured as insufficient
  (`palette-contract.ts:321-329`: "the row Enter will apply was carried by hue
  alone", and the popup row's ground differs from a list row's). Their bars are
  the pointer's and the keyboard's shared mark, they are 2px on a row that
  carries `rounded-md` *inside* a popup, and neither is a list a reader scans for
  a persistent "you are here". Removing them is not asked for and would remove the
  only mark the keyboard has in that popup.
- What would change the answer: if the popups' rows are later re-authored on
  `rowSelected` (they are on `sunken`/`accentWash` today,
  `contrast-contract.mjs:1803-1848`), the same argument applies to them and the
  bars should go with it. That is a separate round with a separate measurement.

### 8.3 Rounding: the row stays at 6px, and this is the case the rule was written for

`rowStyle` is `flex h-8 … rounded-md px-1` — a **32px-tall** row at
`rounded-md` = 6px (`chat-sidebar.tsx:69-70`). `docs/branding.md:583-587`:

> **6px, controls.** Anything you click or type into … and the small blocks that
> live at control scale … **A 32px-tall control cannot carry more: 10px eats a
> third of its height and reads as a lozenge**, and every desktop tool that feels
> precise sits at 4–6.

A sidebar row is a thing you click, it is exactly 32px, and 6px is the number the
rule names for that shape — so **the radius does not move**. Against the
reference: Slack's ~8px on a 34px row is a ratio of 0.235, and 6px on 32px is
0.1875 — the same family, and the difference is inside the noise of reading a
rounded corner off a screenshot. 10px would be 0.3125 on this row, i.e. the
lozenge the rule forbids, and it would also break § 5's concentric rule against
the 10px panel the rows sit in with 8px of padding (an inner radius should then
be *smaller*, not larger).

So the answer to "restore the left rounding" is that the rounding was never taken
away — **the bar's square leading edge painted over it**, and removing the bar is
the restore. § 7.1's tiles show it: the after rows are rounded on all four
corners, the before rows are square on the left.

---

## 9. The contract changes

`scripts/contrast-contract.mjs`, in the row-state block
(`:2781-2815` for the constants, `:2999-3172` for the loop), and
`docs/branding.md` § 3's table (`:463-469`) and § 2's prose (`:135-151`).

### 9.1 Assertions that MOVE

Two conventions in the tables below: a **step** is the authored `L*` distance
between the fill and `surface`, and the **band**, **pair**, **rank** and ink
ratios are measured on the authored hex, so they differ from the step by the hex
round trip's own error (up to 0.16 `L*`).

| assertion | from | to | why |
| --- | --- | --- | --- |
| hue source (`:3031-3050`) | `accent` ±`ROW_STATE_HUE_LIMIT` 12° | **`surface`** ± 12°; `accent` where `C*(surface) < 2` | § 5.1 |
| `ROW_HOVER_CHROMA_FLOOR` (`:2808`) | 4, **declared and asserted nowhere** | **asserted**: `max(2.5, 0.5 × C*(surface))` | the defect `fix/row-state-cast-floor` found; § 5.2 |
| `ROW_SELECTED_CHROMA_FLOOR` (`:2809`) | 8, as dead as the above | **asserted**: `max(5.0, C*(surface))` | same |
| hover chroma ceiling (`:3053-3063`) | `min(0.6 × C*(accent), 24)` | **`C*(surface)`** | § 5.2, `tokyoNightStorm` C\* 22.4 on a panel of 16.3 |
| selection chroma ceiling | `min(0.75 × C*(accent), 24)` | **`min(C*(surface) + 4, 24)`** | § 5.2 |
| `ROW_HOVER_STEP_FLOOR` (`:2799`) | 1.5 | 1.5, **plus a new share floor** `step_hover ≥ 0.5 × step_selected` | clause 2, as the relationship it is; § 5.3 |
| `ROW_STATE_HOVER_RANK` (`:2785`) | +0.5 `L*` | **+1.0 `L*`**, authored at 1.15 | § 5.4 |
| chroma rank | *not asserted* | **+2.0 `C*`** (new) | § 5.4 |
| `ROW_STATE_NEUTRAL_ACCENT` (`:2888`) | keyed on the **accent's** chroma | keyed on the **panel's** (`C*(surface) < 2`) | § 5.1; the seven members are named in § 5.1 |

### 9.2 Assertions that are WITHDRAWN, and what replaces them

- **The ΔE00 band off `surface` (4.0, `ROW_HOVER_BAND` / `ROW_SELECTED_BAND`).**
  Withdrawn rather than lowered, because the measurement says it is not a floor a
  backdrop-relative fill can hold: with the hue and chroma held, the band reaches
  4.0 on 40 of 59 palettes and is as low as 2.08. What replaces it is the pair of
  what the direction actually asks for — **the `L*` step floors (1.5 for the
  hover, 1.5 for the selection: the absolute hover floor is what § 5.3 argues for,
  and clause 2 is asserted as the SHARE instead)** and **ΔE00 ≥ 2.0 off
  `surface`** (the file's own field floor, so a fill literally indistinguishable
  from its panel still fails). The consequence to accept: the achieved band's
  median falls from 6.50 to **3.58** on the hover and from 10.95 to 4.26 on the
  selection, over all 59 (dark: 6.78 → 3.81). **That is the trade clause 2 makes**,
  and it is why the step floors have to rise with it.
- **The accent-bar assertions** (`ROW_STATE_BAR_FLOOR` 3.0 and
  `ROW_STATE_BAR_DELTA_E` 2.0, `:3155-3171`) — retired with the bar. One thing
  worth saying: the measured `accent`-on-`rowSelected` ratios they asserted
  (4.23–11.48:1) were never about the bar being visible; they were about the
  *fill* being distinct enough for a bar to sit on, and they go with it.
- **The `canvas` / `elevated` / `sunken` collision floor (ΔE00 ≥ 1.0,
  `ROW_STATE_COLLISION_FLOOR`) for the two row roles.** This is the one that needs
  an argument rather than a number, and it is the structural consequence of the
  direction: **a fill that is the panel's own colour one step up IS a step of the
  ladder.** The assertion is unsatisfiable in principle on the palettes whose
  ladder step is small — measured: 7 of 59 already breach it under the rule
  (`alucard` selection vs its `sunken` 0.44, `duskfox` selection vs its `elevated`
  0.47, `tokyoNightDay` hover vs its `canvas` 0.51, `iceberg` 0.83,
  `kanagawaLotus` 0.83, `rosePine` 0.85, `arcade` 0.74) — where the shipped values
  escape it only because they are rotated to a different hue. The contract already
  has exactly this exemption for one class, `:3125-3131`: *"A NEUTRAL-CLASS fill is
  necessarily a step of the ladder it sits on, so it is exempt from the `elevated`
  collision: there is no cast with which to be a different colour at the same
  depth."* The direction generalises that sentence from "the accent has no chroma"
  to "the fill is a step of the panel's ladder", which is now every palette.
  **THE PREMISE THE WITHDRAWAL USED TO REST ON, CORRECTED.** It read "they are
  never adjacent inside one list", and that sentence is FALSE on two surfaces: the
  app rail's own `<nav>` was `bg-sunken` and the agent-hub categories rail's column
  painted nothing at all over the shell's `canvas`, and BOTH are lists whose rows
  carry these two roles. A row state's own backdrop is the one adjacency a row
  cannot avoid, so the fix is the invariant rather than a value: **a surface that
  paints `rowCurrent` or `hover:bg-row-hover` wears `surface`.** Both surfaces were
  re-grounded — `sidebar-navigation.tsx`'s `<nav>` to `bg-surface` with
  `border-r border-hairline` carrying the boundary its tonal step used to, and the
  categories column in `agent-hub-page.tsx` to a `rounded-md bg-surface p-2` panel
  — which puts all six `rowCurrent` surfaces (the chat sidebar, the settings rail,
  the app rail, the categories rail, the agents sidebar and the agents page's
  roster) on `surface`, plus the canvas Files list. `scripts/chat-sidebar-selection.test.mjs`
  asserts every call site against its ground, so a new one on a rung fails the
  gate. Re-asserting the ROLES against `sunken`/`canvas` instead was measured and
  refused: on the light fleet the largest ink-legal fill reaches ΔE00 1.73–2.81
  against `canvas`, and clearing `sunken` forces `alucard`'s selection to a 2.36
  `L*` step, under the pair's own floors.
  **The risk this still accepts, stated plainly**: a selected row can be the same
  colour as a dialog's ground or an input well. `elevated` keeps its exemption
  because a menu, popover, tooltip, dialog or drawn card is not a row's plane and
  no row is painted on one — the sidebar's own `elevated` use is the `· lopdev`
  cap and the `⋯` button, which are text-sized, not full-width rows. The two
  `hover`-only sites that still ride a rung are recorded with their numbers in
  `scripts/chat-sidebar-selection.test.mjs` (`HOVER_STATES_ON_A_RUNG`): the canvas
  document-tab strip, which § 10 scopes out, and the schedules page's annex.
- **`chat sidebar current-row ground`'s pinned literal**
  (`contrast-contract.mjs:1944-1947`) loses `relative` and the `before:*` terms.
  The pin stays a pin: it is the only place that catches the wrong ground or a
  lost second signal arriving, and `font-medium` remains its second signal.

### 9.3 The doc updates

- `src/renderer/src/shared/themes/palette-contract.ts:213-380` — the `rowHover`
  and `rowSelected` docs. Four paragraphs change: **THE HUE** (`:247-255`) now
  argues from the panel, **THE RULE** (`:256-280`) carries the § 4 procedure, the
  **SHAPE** section's chroma floors/ceilings (`:296-320`) become panel-relative,
  and **"WHICH CHANNEL CARRIES THE RANKING"** (`:288-295`) inverts — the fill
  ranks and `font-medium` is the non-colour half. **THE BAR IS THE SECOND SIGNAL**
  (`:321-339`) is replaced by a paragraph saying why the bar was removed and what
  replaced it. The **NEUTRAL CLASS** paragraph (`:351-362`) is re-keyed to the
  panel's chroma and its `obsidian` measurements re-derived.
- `docs/branding.md:135-151` — "Both are **tints of the palette's own `accent`
  hue** at two strengths — the axis the ladder could not supply, since 32 of the
  41 dark palettes share one 230–306° family" is the sentence the direction
  reverses: the shared family is the reason the *ladder* cannot carry the state on
  hue, and the direction's answer is that the state should not leave the family at
  all. This paragraph also has to record, in the operator's own terms, why clause 2
  needed the step to be the carrier.
- `docs/branding.md:483-505` — "**A selection is not a tint**" keeps its rule and
  loses its reason: it says the accent wash collapses onto its ground and that a
  selection carries a non-colour mark "beside it (the 2px accent bar the slash
  popup uses)". The popup still does; the sidebar now carries `font-medium` alone.
- `docs/branding.md:463-469` — the table rows move as in § 9.1/§ 9.2.

### 9.4 The floors this direction does NOT touch

Stated because the brief asks which floors cap the brightening: **`ink` 7.0:1,
`ink-muted` 5.5:1 and `ink-dim` 5.0:1 on the row fills are unchanged, and they are
what caps the step.** `ink-dim` is the binding one on all 59 palettes — it is the
floor that produces the headroom column of § 1 and the cap in § 5.3 — and no
palette in this direction reports a value below **5.02:1** on the selection. **I am
not proposing to relax any floor.** The cost is real and is stated: it is why the
median dark-palette selection step is 4.76 `L*` and not the ~8 the Slack reference
suggests, and it is why `catppuccinMacchiato` cannot rank its pair past 0.94 `L*`.

---

## 10. Scope: the operator's "hover colours in the themes", and what else it reaches

`rowHover`/`rowSelected` are the sidebar and list **row states**. Two other
patterns carry 46 hover sites between them, and the operator's words plausibly
reach them. The measurement is that they land on opposite sides.

- **`hover:bg-elevated` — 29 occurrences in 22 files — needs nothing.**
  `grep -ro 'hover:bg-elevated' src/ | wc -l`; the sites
  (`ask-options.tsx:166`, `tool-row.tsx:608`, `measured-suggestion-stack.tsx:179`,
  `canvas-file-viewer.tsx:565`, `trace-line.tsx:291`, …) are control hovers, and
  `elevated` is **already backdrop-relative**: it is the panel one rung up, at the
  panel's own hue (§ 6's ladder measurement: `elevated`'s hue is within 5° of
  `surface`'s on 55 of 59 palettes). **These 29 sites are the counter-example that
  shows what the row states were doing wrong** — the app's control hovers already
  do what the operator asks; only the row states left the family. No change.
- **`hover:bg-accent-wash` — 17 occurrences — is in scope, and is NOT covered
  here.** All 17 are control hovers, not rows; 8 of them are the two shared
  `Button` variants (`shared/components/ui/button.tsx:163,169`) and the rest are
  transcript icon controls (`link-toolkit.tsx:324`, `quote-toolkit.tsx:209`,
  `message-controls.tsx:103`, `session-status-strip.tsx:226`,
  `run-details-trigger.tsx:283`, `wysiwyg-markdown-editor.tsx:343`, …). They are
  the same off-colour risk, on `accent`-derived colour — a teal wash on a warm
  brown panel — and the recommendation is the same principle: **the wash's hover
  uses should be authored panel-relative too**, and its *non-hover* uses (callout
  grounds, chips, find-match, the ask-option cards) should keep the accent's hue,
  because there the accent hue is a **meaning** ("this belongs to the accent's
  thing") that a row state does not have. I am not proposing values for them in
  this round because it is a role with a wide blast radius, it needs its own
  measured pass, and the roles it shares with controls (the `active:` fill, the
  paired `hover:text-accent`) make a partial change worse than a complete one.
  **Recorded as a follow-up round, not as done.**
- **Not covered by this document at all**: the popup rows' own grounds
  (`sunken`/`accentWash` in `picker-host.tsx`, `slash-commands.tsx`,
  `at-picker.tsx`), the MUI half of the app (which reads hexes, not these
  variables, so a ported surface does not move with this change), and the
  canvas/tab-strip hovers.

---

## 11. Falsifiable predictions

Each one is something a review round can look at and confirm or refute, stated so
that being wrong is cheap to see.

1. **On `localOperatorDark`, the selected sidebar row is no longer greener than
   its panel.** Today it is `#1F3624` at h148 on a panel at h83; after, `#372F24`
   at h80. If a reviewer's frame still shows a green row on the warm brown panel,
   the hue rule did not land.
2. **On `tokyoNightStorm`, the hover stops being the loudest fill in the fleet.**
   C\* 22.4 → 9.8 against a panel of 16.3. If the hovered row still reads as a
   saturated blue slab beside its panel, the cast ceiling did not land.
3. **On `obsidian`, the selection can still be told from the hover with no colour
   at all** — the chroma rank there is 3.6 and the `L*` rank 1.56, and if the pair
   reads as one mark at two strengths, the rank floors are wrong.
4. **On `catppuccinMacchiato` the rank is 0.94 `L*`**, below the 1.0 floor. If a
   reviewer's frame shows the pair reading cleanly apart there anyway, the floor is
   settable higher and I under-set it; if it reads as one mark, this is the palette
   that proves the ink floors are the cap.
5. **The band off `surface` is smaller everywhere and it does not matter**: the
   hover's median drops from ΔE00 6.50 to **3.58** over all 59 (3.81 over the 41
dark, 2.72 over the 18 light — the medians move with their population, so a
reader comparing across this change has to hold the set fixed). If any palette
   now reads as *not marked at all* — the operator's original `tokyoNight` report,
   ΔE00 1.05 — the band withdrawal was wrong and the step floor is carrying more
   than it can. The three palettes that sat under the file's 2.0 field floor when
   this shipped (`rosePineDawn` 1.67, `dune` 1.91, `ayuLight` 1.95) are down to
   **one**: `dune` and `ayuLight` were lifted in the remediation round (§ D7 of
   the design round) and `rosePineDawn` is a ledger row whose ceiling is now
   recorded. `rosePineDawn` is the fleet minimum and its frame pair is in
   `docs/evidence/row-states-refined/`.
6. **The bar's removal restores the left rounding on five surfaces at once**
   (settings rail, app rail, agents sidebar, agent-categories sidebar, agents
   page), because they share `rowCurrent`. If any one of them is still square on
   the left, a caller is restating the bar rather than importing the constant.
7. **`outrun`'s selection is the loudest in the after fleet at C\* 24.47**, on a
   panel of 21.0 — then `vaporwave` 24.25 on 21.5 and `kanagawaLotus` 24.17 on
   22.9 — i.e. it is the palette most likely to be called "a saturated plane"
   under the new rule, and it is the one to look at if the ceiling needs
   re-arguing. Its frame is in the set (`after/neighbour-hovered/outrun.webp`),
   where it reads as a step of its own panel rather than as a plane.
   **Why this pointer was wrong when this document was written, since it is the
   kind of error worth naming**: § 6's worked table carries the three selections
   rounded to ONE decimal, where all three read **24.0** — equal to the flat cap —
   so a reader comparing them there cannot tell them apart. The three differ in
   the second decimal, and § 13.6 does not "record 24.47 for `outrun`" either: the
   figure appears nowhere in this document (it is in `contrast-contract.mjs`'s cap
   note, which is a different file). What the appendix tabulates now is the
   shipped hex, where the ordering is the one above.
8. **Nothing in the light fleet gets lighter.** Every light selection step is
   between 4.14 and 5.07 `L*` *downward*. If a light palette's selected row reads
   as raised rather than recessed, the direction sign was inverted somewhere.

---

## 12. What is NOT in this document

- **The other 47 hovers** (§ 10) and the popup rows' own grounds.
- **The MUI half of the app.** `createBaseTheme` reads the palettes as hex, and
  the roughly 299 `alpha()` call sites do not move with a CSS-variable change.
  Nothing here asserts that a ported surface matches.
- **Any change to `src/` or `scripts/`.** The coder implements; § 9 is the list.
- **A re-derivation of the evidence manifest.** This document adds no frame to
  `docs/evidence/`, so `manifest.json`'s `srcTree`/`scriptsTree` stamps and the
  sweep are untouched; the frames live under `docs/design/assets/` and are not
  evidence-set members.
- **A `pnpm check-evidence` sweep.** Not run: it admits one sweep per machine and
  defers (exit 75) while a peer holds the lease, and this change moves no `src/`
  or `scripts/` tree so there is nothing for it to answer.

---

## 13. Corrections to the brief's findings

I re-derived each of the brief's measurements rather than taking them on trust.
Four disagree, and none of them changes a decision:

1. **The hue gap is 25 of 59, not 26.** `hue_gap(hue(accent), hue(surface)) > 45°`
   over the 59 shipped hexes, hue as Lab `atan2(b, a)` — which is the measure this
   contract itself uses (`contrast-contract.mjs:3036-3040`). The near-boundary
   palettes are `nord` 51°, `sage` 48°, `tron` 47°, `solarizedDark` 44°,
   `rosePineDawn` 41°; a reader that had counted one of them on the other side is
   the whole of the difference, and no conclusion rests on it.
2. **The brief's named hue numbers are HSL, not Lab.** The brief says "`synth`
   panel hue 269° violet with a hover at hue 3° red". In Lab, `synth`'s panel
   `#2E1D42` is **h310**, and its accent `#FF618E` is **h7**; 269° is that panel's
   HSL hue. The *worst* offenders by the contract's own measure are
   `kanagawaLotus` 176°, `solarizedLight` 168°, `arcade` 158°, `cyberpunk` 155°,
   `alucard` 154° — `synth` is 57°. The finding is unaffected (both readings put
   `synth` in the off-colour class) but the ranking is different, and
   `kanagawaLotus` — a *light* palette, which the brief's list does not carry — is
   the worst in the fleet at 176°.
3. **The dark hover step is 1.50–2.07, not 1.50–2.1, and the fleet's maximum is
   4.99** (`obsidian`, the neutral class, where there is no cast to buy the band
   with so the whole of the mark is `L*`). Worth stating separately because it is
   the shape the direction moves *toward* on the other 58.
4. **The band off `surface` is not merely "bought mostly on the accent hue" — it
   is unreachable on lightness, and that is measurable.** Holding hue and chroma
   at the panel's own and taking the largest step the inks allow, the band reaches
   4.0 on 40 of 59 and bottoms at 2.08. That is why § 9.2 withdraws the band
   rather than lowering it, and it is the strongest single piece of evidence for
   the direction: **the shipped rule only met its own band because it left the
   panel's colour family.**

Confirmed, and worth recording because they are load-bearing:
`ROW_HOVER_CHROMA_FLOOR` / `ROW_SELECTED_CHROMA_FLOOR` are **dead as assertions** —
both are passed into the row loop (`contrast-contract.mjs:2999`) and used *only*
inside two failure-message strings (`:3059`, `:3131`), compared nowhere;
`hover:bg-elevated` is 29 occurrences in 22 files;
`hover:bg-accent-wash` is 17; `bg-row-*` is 27 lines across `src/`.

---

## Appendix: the fleet, after

Per palette, mode, hue source, panel cast, the two authored values, their steps,
the band, the pair, the rank, and `ink-dim` on the selection — **every cell
measured on the SHIPPED hex in
`src/renderer/src/shared/themes/palettes/`, not on the rule's target triples**,
because the two differ by the 8-bit round trip and it is the hex that ships
(`contrast-contract.mjs` asserts the hex). `hue` is the source § 5.1 takes, keyed
on `C*(panel)`; `rank` is the mode-signed magnitude of `selection − hover` in
`L*`, the same quantity the contract's rank floor reads. The steps read `+` on
both fleet halves because the sign is applied per mode (§ 5.6) and the column
prints its magnitude.

| palette | mode | hue | C\*(panel) | hover | hover step | selected | sel step | band h/s | pair | rank | `ink-dim`(s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `alucard` | light | panel | 5.71 | `#EDECE5` | +3.19 | `#ECE7D4` | +4.93 | 2.61 / 4.35 | 5.02 | 1.73 | 5.17 |
| `arcade` | dark | panel | 2.11 | `#2D2D31` | +2.87 | `#303039` | +4.45 | 2.02 / 4.72 | 3.2 | 1.58 | 5.04 |
| `arctic` | dark | panel | 11 | `#2F353E` | +3.36 | `#29394E` | +4.92 | 4 / 4.21 | 5.76 | 1.56 | 5.12 |
| `autumn` | dark | panel | 7.42 | `#3A342F` | +2.70 | `#453429` | +3.81 | 3.58 / 4.12 | 6.17 | 1.11 | 5.06 |
| `ayuDark` | dark | panel | 7.9 | `#2D3037` | +3.29 | `#2B3445` | +5.03 | 3.23 / 4.41 | 5.19 | 1.74 | 5.12 |
| `ayuLight` | light | panel | 2.89 | `#E7EDF0` | +3.86 | `#DCEBF4` | +5.04 | 2.36 / 4.74 | 3.89 | 1.18 | 5.56 |
| `ayuMirage` | dark | panel | 9.75 | `#373B44` | +3.21 | `#343F54` | +4.91 | 3.53 / 4.57 | 5.68 | 1.7 | 5.1 |
| `catppuccinFrappe` | dark | panel | 12.6 | `#3E404C` | +2.19 | `#3B425C` | +3.23 | 3.71 / 3.57 | 6.01 | 1.04 | 5.04 |
| `catppuccinLatte` | light | panel | 2.16 | `#E5E8EC` | +3.22 | `#DDE3EE` | +5.02 | 2.02 / 4.49 | 3.39 | 1.79 | 5.24 |
| `catppuccinMacchiato` | dark | panel | 14.41 | `#30313D` | +1.62 | `#2E324E` | +2.56 | 4.46 / 3.18 | 6.96 | 0.94 | 5.06 |
| `catppuccinMocha` | dark | panel | 11.52 | `#3A3943` | +3.33 | `#3C3B53` | +4.81 | 4.39 / 4.43 | 6.52 | 1.48 | 5.03 |
| `cyberpunk` | dark | panel | 10.9 | `#2C2932` | +2.37 | `#302A3F` | +3.69 | 3.97 / 3.59 | 6.26 | 1.32 | 5.03 |
| `desert` | dark | panel | 10.7 | `#423C33` | +3.28 | `#4C3E2B` | +4.80 | 3.94 / 4.24 | 5.65 | 1.53 | 5.06 |
| `dracula` | dark | panel | 14.21 | `#383946` | +3.36 | `#393C57` | +5.13 | 4.57 / 4.24 | 6.08 | 1.78 | 5.2 |
| `dune` | dark | panel | 2.89 | `#322E2C` | +2.85 | `#393029` | +4.17 | 2.05 / 4.35 | 3.84 | 1.33 | 5.03 |
| `duskfox` | dark | panel | 18.65 | `#353243` | +3.18 | `#383456` | +5.01 | 4.98 / 4.13 | 6.75 | 1.83 | 5.33 |
| `everforest` | dark | panel | 5.56 | `#3F4649` | +3.34 | `#374C55` | +5.10 | 3.16 / 5.22 | 5.57 | 1.76 | 5.29 |
| `everforestLight` | light | panel | 13.08 | `#E8E4D5` | +3.16 | `#E7DFBF` | +4.99 | 4.04 / 3.85 | 5.92 | 1.83 | 5.46 |
| `forest` | dark | panel | 8.68 | `#303833` | +2.81 | `#2A3E31` | +4.36 | 4.06 / 4.48 | 6.85 | 1.55 | 5.02 |
| `githubLight` | light | accent | 1.84 | `#EBEBF0` | +3.22 | `#E5E6F1` | +4.89 | 2.82 / 5.21 | 2.9 | 1.67 | 5.28 |
| `gruvbox` | dark | accent | 1.16 | `#3A3734` | +3.24 | `#403B34` | +5.12 | 2.63 / 5.19 | 2.75 | 1.89 | 5.38 |
| `gruvboxLight` | light | panel | 15.49 | `#F1ECDB` | +3.35 | `#F0E8C2` | +4.97 | 4.78 / 3.85 | 6.79 | 1.62 | 5.25 |
| `highContrastLight` | light | accent | 0 | `#E9E8ED` | +3.29 | `#E4E3EC` | +4.95 | 3.41 / 5.53 | 2.16 | 1.65 | 6.24 |
| `iceberg` | light | accent | 1.57 | `#E9E9EE` | +3.37 | `#E3E4EF` | +5.04 | 2.39 / 4.91 | 2.91 | 1.67 | 5.55 |
| `kanagawaLotus` | light | panel | 22.88 | `#DDD8BE` | +3.33 | `#DBD4A6` | +5.00 | 5.52 / 3.29 | 5.82 | 1.67 | 5.51 |
| `kanagawaWave` | dark | panel | 9.05 | `#313038` | +3.15 | `#333347` | +4.94 | 3.55 / 4.61 | 6.01 | 1.79 | 5.13 |
| `lavender` | dark | panel | 11.75 | `#37353F` | +2.71 | `#3B364E` | +4.05 | 4.4 / 4.05 | 6.84 | 1.34 | 5.03 |
| `linen` | light | accent | 1.59 | `#DAE1DF` | +3.24 | `#CFDEDA` | +4.92 | 3.4 / 6.86 | 3.71 | 1.69 | 5.33 |
| `localOperatorDark` | dark | panel | 4.67 | `#302D29` | +2.78 | `#372F24` | +4.06 | 2.3 / 4.16 | 4.49 | 1.28 | 5.05 |
| `localOperatorLight` | light | panel | 3.64 | `#EDECE7` | +3.17 | `#EBE7D8` | +4.93 | 2.11 / 4.52 | 4.44 | 1.77 | 5.04 |
| `matrix` | dark | panel | 6.11 | `#282D2A` | +2.81 | `#233329` | +4.49 | 3.69 / 4.84 | 7.01 | 1.68 | 5.02 |
| `mintLight` | light | panel | 3.57 | `#E8EDEA` | +3.29 | `#DCEBE0` | +4.91 | 2.42 / 5.31 | 5.87 | 1.61 | 5.36 |
| `monokai` | dark | panel | 4.8 | `#353632` | +3.31 | `#383B2D` | +5.10 | 2.98 / 5.23 | 5.77 | 1.79 | 5.13 |
| `neon` | dark | panel | 11.4 | `#2B2E38` | +3.28 | `#293248` | +5.16 | 3.89 / 4.22 | 5.68 | 1.88 | 5.04 |
| `neonNoir` | dark | panel | 4.95 | `#333539` | +3.20 | `#323846` | +4.60 | 2.91 / 4.77 | 5.46 | 1.39 | 5.05 |
| `nightfox` | dark | panel | 12.5 | `#2D343E` | +3.38 | `#25384F` | +4.89 | 4.32 / 4.15 | 6.04 | 1.51 | 5.1 |
| `nord` | dark | panel | 9.57 | `#3C3F48` | +1.93 | `#384257` | +3.15 | 3.09 / 3.76 | 5.64 | 1.23 | 5.04 |
| `obsidian` | dark | panel | 2.08 | `#313135` | +3.30 | `#34343D` | +4.86 | 2.34 / 4.91 | 3.18 | 1.56 | 5.16 |
| `ocean` | dark | panel | 10.18 | `#303A41` | +2.75 | `#223F4F` | +4.09 | 3.81 / 3.97 | 5.99 | 1.34 | 5.02 |
| `oneDark` | dark | panel | 6.36 | `#383B41` | +3.23 | `#363F4E` | +4.85 | 2.93 / 4.53 | 4.81 | 1.62 | 5.11 |
| `oneLight` | light | accent | 0 | `#EBEAEF` | +3.29 | `#E6E5EE` | +4.94 | 3.4 / 5.51 | 2.15 | 1.65 | 5.33 |
| `outrun` | dark | panel | 21.02 | `#2C2C3E` | +2.80 | `#2B2D51` | +4.05 | 5.46 / 3.23 | 6.88 | 1.25 | 5.02 |
| `palenight` | dark | panel | 12.19 | `#363843` | +1.78 | `#333A53` | +2.86 | 3.66 / 3.43 | 6.2 | 1.08 | 5.06 |
| `paper` | light | panel | 8.13 | `#E3DFD6` | +3.26 | `#E4DAC4` | +4.86 | 3.23 / 4.08 | 5.29 | 1.6 | 5.36 |
| `radient` | dark | panel | 11.89 | `#2E303B` | +3.17 | `#2D344B` | +5.11 | 3.81 / 4.23 | 5.57 | 1.94 | 5.15 |
| `rosePine` | dark | panel | 13 | `#36333F` | +1.53 | `#38344E` | +2.70 | 3.62 / 3.41 | 6.31 | 1.17 | 5.06 |
| `rosePineDawn` | light | panel | 2.7 | `#F1ECE8` | +2.79 | `#F3E7DD` | +4.14 | 1.67 / 4.33 | 3.62 | 1.35 | 5.02 |
| `rosePineMoon` | dark | panel | 16.79 | `#322F3E` | +3.28 | `#353150` | +5.06 | 4.81 / 4.2 | 6.7 | 1.78 | 5.29 |
| `rosewood` | dark | panel | 7.43 | `#3B3232` | +2.93 | `#483133` | +4.24 | 3.97 / 4.52 | 6.84 | 1.31 | 5.03 |
| `sage` | light | panel | 5.78 | `#EFEDE6` | +3.19 | `#EEE8D5` | +4.92 | 2.6 / 4.34 | 5 | 1.73 | 5.38 |
| `solarizedDark` | dark | panel | 15.32 | `#22373E` | +2.60 | `#003C4C` | +3.79 | 4.65 / 3.2 | 5.97 | 1.18 | 5.05 |
| `solarizedLight` | light | panel | 6.28 | `#EEECE5` | +3.17 | `#EDE7D3` | +4.92 | 2.87 / 4.31 | 5.35 | 1.75 | 5.42 |
| `synth` | dark | panel | 26.82 | `#32273E` | +3.12 | `#39294A` | +5.15 | 5.81 / 3.84 | 4.06 | 2.03 | 5.13 |
| `synthwave` | dark | panel | 15.94 | `#33313F` | +2.71 | `#363250` | +4.12 | 4.78 / 3.78 | 6.92 | 1.41 | 5.04 |
| `tokyoNight` | dark | panel | 13.44 | `#3A3B48` | +3.03 | `#3A3E59` | +4.70 | 4 / 4.26 | 6.01 | 1.68 | 5.04 |
| `tokyoNightDay` | light | accent | 1.58 | `#E1E2E6` | +3.14 | `#DBDCE7` | +5.07 | 2.01 / 5 | 3.56 | 1.94 | 5.13 |
| `tokyoNightStorm` | dark | panel | 16.33 | `#353745` | +2.98 | `#323958` | +4.25 | 5.03 / 3.81 | 6.92 | 1.27 | 5.04 |
| `tron` | dark | panel | 9.59 | `#282D35` | +2.86 | `#243043` | +4.18 | 3.41 / 3.83 | 5.47 | 1.32 | 5.08 |
| `vaporwave` | dark | panel | 21.54 | `#3D3548` | +3.17 | `#43365A` | +4.95 | 5.51 / 3.8 | 6.53 | 1.78 | 5.04 |
