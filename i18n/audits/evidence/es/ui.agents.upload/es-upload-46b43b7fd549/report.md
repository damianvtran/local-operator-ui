# es audit — `ui.agents.upload`, 15 new keys (round 1)

- **Head:** `2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82` (branch `i18n/slice-upload-agent-dialog`), base `3378319980ff898892f316ae3a17cc22c089b7d3`
- **Auditor:** `i18n-auditor`, instance `46b43b7fd549`; served model **`deepseek/deepseek-flash`** (pin `anthropic/claude-sonnet-5-5` was quota-refused; fallback chain `claude-opus-5-5` → `gpt-6.1-sol` → `deepseek/deepseek-flash`)
- **Bindings:** en `3676c1b3…ff514f`, es `2fd38ed2…ed4569b`, context `76323fe3…f11cec` (committed blobs, verified with `git show HEAD:<path> | shasum -a 256`, not the working tree)
- **Receipt:** `i18n/receipts/es-upload-r1-46b43b7fd549.json` sha256 `6f21994c40a95cba26094f35b8d7b90d13313b4e2f7338fd876d2ffab716d647`

## Verdict: `clean-with-findings` — 0 blocker, 0 major, 1 minor, 1 nit

Validated with the shared gate rules: `deriveReceiptAudit()` accepts this receipt against the on-disk hashes and derives
`{blocker: 0, major: 0, minor: 1, nit: 1} → clean-with-findings`.

## Findings

### ES-UPL-1 — MINOR — `target.blocked_hint`: `many` branch copies the singular
```
es  {count, plural, one {{org}} many {{org}} other {cualquiera de las organizaciones marcadas arriba}}
en  {count, plural, one {{org}}            other {any of the organizations marked above}}
```
Spanish `many` is the CLDR category for **exact millions**, where the wording must stay plural. Rendered at `count = 1.000.000`:

> Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de **Minerva Labs** puede activarlo en la consola de Radient.

Catalogue-wide census of every `many` branch in `src/i18n/catalogues/es/` (**370** branches, 61 of the 65 plural-bearing catalogues):

| shape | count |
|---|---|
| distinct millions form (`{count} de …`, `# de …`) | 318 |
| `many` == `other` | 33 |
| `many` == `one` == `other` | 18 |
| `many` == `one` **only** | **1 — this key** |

Not a MAJOR: `count` is `planBlockedOrgs(memberships).length` (`upload-agent-dialog.tsx:274-277`) and `Intl.PluralRules('es')` returns `many` only at 1.000.000+, so no user reaches it. Fix: make `many` match `other` (or drop the category — English and 4 of the 65 es catalogues omit it). Keep `one` as is.

### ES-UPL-2 — NIT — `intro.public`: adjective trails the product name
`… en el Hub de agentes público.` The reader passes through `de agentes público` (an agreement error on its face) before resolving `público` onto the capitalised `Hub`. Faithful to *the public Agent Hub* and defensible — Spanish puts the adjective after the noun — so wording only. If the line is touched for other reasons: `en el Hub público de agentes` avoids the trailing adjective at the cost of interrupting the product name; leaving it is also fine.

## Claims checked (all four hold)

| claim | measurement | verdict |
|---|---|---|
| `ficha` for *listing* | 12 es values across `ui.agents.upload` (5), `ui.agents.publication` (6), `ui.mesh` (1): `Abrir la ficha`, `Actualizar la ficha existente`, `Publicar como ficha nueva`, `Esa ficha ya no existe` … no competing term — the only `listado` hits are *list variables* / *as listed* / *models listed* | **verified** |
| `Hub de agentes` for the product name | 5 pre-existing + `intro.public`; the common noun stays lowercase (`Nombre en el hub`, `publicado en el hub`, `El hub reserva …`, `Publicado en el hub`) — the new keys follow that case discipline exactly | **verified** |
| `plan Team` | 14 occurrences already in the es tree (`plan Radient`, `plan gratuito` sit alongside); new `blocked_hint` matches | **verified** |
| `la consola de Radient` | 10 occurrences of the exact phrase, e.g. `Añade créditos en la consola de Radient para continuar.` | **verified** |
| `agentes integrados` for *built-in agents* | pre-existing `Un agente integrado está listo para instalar` | **verified** |
| es CLDR plurals: one/many/other is house convention | `Intl.PluralRules('es').resolvedOptions().pluralCategories = [one, many, other]`; **61 of 65** plural-bearing es catalogues carry `many` (370 branches) — so the cited precedent holds, and the *content* rule the translator missed is the one ES-UPL-1 breaks | **convention verified; content deviates (ES-UPL-1)** |
| `many` genuinely needed here | reachable only at `count >= 1.000.000` blocked orgs — unreachable, but including it is conventional and harmless once its text follows `other` | **not reachable; keep only if fixed** |

## Mechanical results (all clean unless named above)

- 46 keys, key set **equal** to English; every key has a context entry; no duplicate keys; tabs; trailing newline.
- Pre-existing 31 values **byte-identical** to the parent commit; nothing removed; the scope is exactly the 15 new keys.
- Key order sorted except the `sign_in.title_continue` / `title_again` tail — **identical in English and present at the parent** → `out of scope — pre-existing`.
- Placeholders/ICU: **14 of 15 keys identical** argument sets to English; `blocked_hint` differs only by the added `many` category (ES-UPL-1). `{org}` is nested in `one`/`many` and the call site always passes it (`upload-agent-dialog.tsx:1041-1046`); the message parses under `@formatjs/icu-messageformat-parser`.
- No English leakage: the only ASCII lexemes shared with English are placeholders (`name`, `destination`, `count`, `org`), ICU keywords, and `plan` / `Team` / `hub` (Spanish *plan*, product names).
- No empty values, edge whitespace, double spaces, straight quotes or `...` — typographic `“ ”` / `…` throughout, matching the 9 pre-existing values that quote a name.
- Register: `tú` throughout (`Vas a publicar` beside `Debes iniciar sesión`, `Vuelve a iniciar sesión`, `Confirmo que he leído`); `conjunto de instrucciones` reused from the pre-existing lines.

## Width (SF Pro, `--text-body` = 0.875rem = 14px, CoreText `CTLineGetTypographicBounds`; `hb-shape --font-size=14` cross-check)

| key | en | es | delta |
|---|---|---|---|
| `action.publish` | 45.9 px | 50.6 px | +10.2% |
| `action.publishing` | 78.6 | 83.3 | +5.9% |
| `action.update_listing` | 84.8 | 109.7 | **+29.3%** |
| `receipt.title_updated` | 95.0 | 109.0 | +14.7% |
| `target.blocked_hint` | 1209.2 | 1542.3 | +27.5% |
| `not_leaving.public` | 1185.8 | 1359.6 | +14.7% |

No overflow: the dialog is `maxWidth="sm"` → `max-w-xl` (576 px) and the primary button carries `min-w-25` (100 px). The widest footer state is `Cancelar` 56.0 px + `Actualizar la ficha` 109.7 px ≈ 166 px of text against ~528 px of content. The three paragraph keys grow 14–28%, i.e. at most one extra wrapped line.

## Limitations

- No browser tool in this session: widths are font metrics from the app's real font at the real body size, **not screenshots**. Reflow is stated from the metrics, not observed.
- CoreText and `hb-shape` differ by ~5% (hb-shape rounds each advance); neither gates anything here — both agree the footer and titles fit.
- Scope is `es` only. The other six locales in this commit are audited by their own sessions; `fr` also emits `many` for this key, *with* the plural text — recorded as supporting evidence, not ruled on.
