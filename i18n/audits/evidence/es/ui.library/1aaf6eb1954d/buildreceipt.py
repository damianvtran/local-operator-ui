#!/usr/bin/env python3
"""Writes the es delta-audit receipt (es-ds-1aaf6eb1954d.json).

Schema mirrors _s12-audits/e5fb4310.../fr-ds-e3c562b03258.json: root fields plus
ONE namespaces block for ui.library.
"""
import hashlib
import json
import os

SCRATCH = os.environ["LOCAL_OPERATOR_SCRATCHPAD"]
OUT = os.path.join(SCRATCH, "es-ds-1aaf6eb1954d.json")
HEAD = "8a9ce1f808c266ebe9a0e924094344cea60c2c23"
EN = "src/i18n/catalogues/en/ui.library.json"
CTX = "src/i18n/catalogues/en/ui.library.context.json"
ES = "src/i18n/catalogues/es/ui.library.json"
H = {
    "en": "065ac47c67e2a82867070f9df0e33d25c0d96aedd77438b584114147db07fd71",
    "context": "2fe63e830b49079dac67c5c4513358d0a8559a94fbf27ac8d437212b13aa2e72",
    "es": "56d0fdd0f7fa73704840093247fa06fb04e1cb0abaaccce7318b9f37b916f099",
}
GUIDE = {
    "path": "~/local-operator/i18n/style-guides/es.md",
    "sha256": "77b9227213802d14c74d4298d6b346ad842bbf2a5ca3b9d46fc6144430d26c3e",
}
GLOSS = {
    "path": "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23/glossary.md",
    "sha256": "0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8",
    "note": "Manager-owned byte-copy; sha256-verified identical to "
            "~/local-operator/i18n/glossary.md. Glossary conformance was checked "
            "against this copy.",
}
EXP = {
    "path": "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23/expected-hashes.json"
}

FINDINGS = [
    {
        "id": "F1",
        "severity": "minor",
        "key": "ui.library.kind.spreadsheet",
        "current_text": "Hoja de cálculo",
        "english_source": "Spreadsheet",
        "problem": (
            "Fit only — the wording is the correct singular of the locale's own "
            "group label (\"Hojas de cálculo\" in ui.library.category.spreadsheets, "
            "ui.canvas.files.spreadsheets, ui.canvas.file_rows.spreadsheets) and "
            "agrees with the shipped sentence ui.library.preview.sheet_unreadable = "
            "\"No se pudo leer esta hoja de cálculo.\" But it measures 15 cells "
            "against English's 11 and the sidecar's \"about 12\" badge hint — 36% "
            "wider than English in a slot the sidecar calls truncating. Two real "
            "consequences: on a grid card the caption wraps the label in "
            "<span className=\"truncate\">, so a narrow tile ellipsizes it; on a "
            "list row the same label sits in a shrink-0 cluster, so the extra cells "
            "come out of the truncated asset name/subtitle beside it."
        ),
        "recommendation": (
            "Keep the word — no shorter accurate es noun exists (\"Hoja\" alone is "
            "ambiguous, \"Excel\" is wrong). If a render check shows the ellipsis or "
            "the squeezed name, fix the layout (a min-w-0/truncate on the row's kind "
            "span, or a slightly wider badge), not the copy. Verify at render before "
            "merging; this is why the finding is filed rather than dismissed."
        ),
        "evidence": [
            "src/i18n/catalogues/es/ui.library.json: ui.library.category.spreadsheets = \"Hojas de cálculo\"",
            "src/i18n/catalogues/es/ui.canvas.json: ui.canvas.file_rows.spreadsheets = \"Hojas de cálculo\"",
            "src/i18n/catalogues/es/ui.library.json: ui.library.preview.sheet_unreadable = \"No se pudo leer esta hoja de cálculo.\"",
            "src/renderer/src/features/library/components/library-card.tsx:249-251 (card caption) and :366-373 (list row, `flex shrink-0`)",
            "src/i18n/catalogues/en/ui.library.context.json: ui.library.kind.spreadsheet.length = \"English is 11 source characters. A truncating badge slot (about 12 characters)…\"",
        ],
        "gates": False,
    },
    {
        "id": "N1",
        "severity": "nit",
        "key": "ui.library.kind.video",
        "current_text": "Video",
        "english_source": "Video",
        "problem": (
            "\"Video\" is byte-identical to this namespace's own ui.library.category.video "
            "= \"Video\", which is the right choice, and RAE gives \"video\" as the main "
            "form (\"vídeo\" is accepted). The only observation is a pre-existing split "
            "the delta does not create: ui.canvas.file_rows.video = \"Vídeo\" and "
            "ui.canvas.files.videos = \"Vídeos\" carry the accent while ui.library uses "
            "the unaccented form. Recorded for the ledger, not filed against this "
            "translation."
        ),
        "recommendation": "No change here. If the split is ever unified, unify ui.canvas, not ui.library.",
        "evidence": [
            "src/i18n/catalogues/es/ui.library.json: ui.library.category.video = \"Video\"",
            "src/i18n/catalogues/es/ui.canvas.json: ui.canvas.file_rows.video = \"Vídeo\"",
            "src/i18n/catalogues/es/ui.canvas.json: ui.canvas.files.videos = \"Vídeos\"",
        ],
        "gates": False,
    },
    {
        "id": "N2",
        "severity": "nit",
        "key": "ui.library.kind.other (English context note)",
        "current_text": "Rendered inside the sentence ui.library.preview.unsupported ONLY via the generic fallback; see manifest.",
        "english_source": "Other",
        "problem": (
            "English metadata, not the translation. The code path is a ternary "
            "(library-viewers.tsx:107-112): kind === \"other\" renders "
            "ui.library.preview.unsupported_generic, every other kind renders "
            "ui.library.preview.unsupported with {kind}. So this value is never "
            "interpolated into any sentence — it only paints as the badge — and the "
            "note's phrasing invites a translator to believe otherwise. The \"see "
            "manifest\" pointer resolves to nothing at this head: all seven "
            "manifests under i18n/ (renderer-blind-spots, census-five-key-second, "
            "highlights-withheld-1652, owner-audit-download-actions, s3-attachment-cards, "
            "u1-file-cards, hi/ui.chat evidence) were checked and none mentions the "
            "Library, kind.other or unsupported_generic."
        ),
        "recommendation": (
            "Reword to: \"When the kind is `other` the preview renders "
            "ui.library.preview.unsupported_generic instead of "
            "ui.library.preview.unsupported, so this value only ever appears as the "
            "badge.\" Drop the manifest pointer or name the artifact."
        ),
        "evidence": [
            "src/renderer/src/features/library/components/library-viewers.tsx:107-112",
            "i18n/audits/renderer-blind-spots-manifest.json (searched: 0 occurrences of library / unsupported_generic)",
        ],
        "gates": False,
    },
]

PER_KEY = [
    ("ui.library.kind.audio", "Audio", "Audio", [],
     "Exact match to English, and \"audio\" is an ordinary Spanish noun (no loanword problem). Correctly keeps the distinction English makes between this singular badge and the plural rail group ui.library.category.sounds = \"Sonidos\" (ui.canvas.files.audio = \"Sonidos\"). Singular noun, 5 cells, sentence case, no placeholders, no invisible characters."),
    ("ui.library.kind.code", "Code", "Código", [],
     "The locale's settled word for this concept: ui.library.category.code = \"Código\", ui.canvas.files.code = \"Código\", ui.canvas.file_rows.code = \"Código\". Reusing the rail group's word for the badge is what English does (\"Code\"/\"Code\") and the sidecar records the roles as independent. 6 cells."),
    ("ui.library.kind.docx", "DOCX", "DOCX", [],
     "Format acronym retained, which is this catalogue's established treatment of format names: \"PDF\" (ui.canvas.pdf_preview.pdf = \"PDF: {title}\"), \"HTML\" (ui.canvas.html_preview.html_preview = \"Vista previa de HTML: {title}\"), \"Markdown\" (ui.canvas.create_file_dialog.markdown_md = \"Markdown (.md)\"), \"ZIP\" (ui.teamBridge.fileCard.kind, container {ZIP}). Glossary §1 keeps technology names in their official spelling; the es guide adds no rule that would localise them, and no Spanish rendering of DOCX exists in the product. 4 cells."),
    ("ui.library.kind.html", "HTML", "HTML", [],
     "Retained, exactly as the locale already writes it — ui.canvas.html_preview.html_preview = \"Vista previa de HTML: {title}\" and ui.canvas.create_file_dialog.html_html = \"HTML (.html)\". Same glossary §1 basis as DOCX. 4 cells."),
    ("ui.library.kind.image", "Image", "Imagen", [],
     "Ordinary noun and the singular of the locale's own plural labels: ui.library.category.images = \"Imágenes\", ui.canvas.files.images = \"Imágenes\", ui.canvas.file_rows.images = \"Imágenes\". 6 cells, sentence case, no truncation risk."),
    ("ui.library.kind.markdown", "Markdown", "Markdown", [],
     "Format proper name kept, matching ui.canvas.create_file_dialog.markdown_md = \"Markdown (.md)\", ui.chat.transcript_copy.menu.copy_markdown = \"Copiar como Markdown\" and ui.projects.project_editors.markdown_headings_lists_code = \"Markdown — encabezados, listas, código.\" 8 cells, within the hint."),
    ("ui.library.kind.other", "Other", "Otro", [],
     "Singular masculine catch-all, the same standalone value the catalogue already ships for this English word (ui.library.origin.other = \"Otro\"), against the plural rail group ui.library.category.other = \"Otros\". 4 cells. It never feeds a sentence: library-viewers.tsx:107-112 renders unsupported_generic when kind === \"other\"; the English note about that is N2."),
    ("ui.library.kind.pdf", "PDF", "PDF", [],
     "Retained, matching ui.canvas.pdf_preview.pdf = \"PDF: {title}\" and ui.teamBridge.fileCard.kind (pdf {PDF}). 3 cells."),
    ("ui.library.kind.pptx", "PPTX", "PPTX", [],
     "Retained acronym with the surrounding prose kept Spanish — ui.library.preview.pptx_failed = \"No se pudo procesar esta presentación\", ui.library.preview.pptx_loading = \"Procesando la presentación: {percent}%\" — which is exactly the split English uses (acronym names the format, prose says presentation). 4 cells."),
    ("ui.library.kind.spreadsheet", "Spreadsheet", "Hoja de cálculo", ["F1"],
     "Semantics and family are right (singular of ui.library.category.spreadsheets = \"Hojas de cálculo\", agrees with ui.library.preview.sheet_unreadable = \"No se pudo leer esta hoja de cálculo.\"); only the width is a concern — 15 cells against English's 11 and the sidecar's ~12 hint. F1."),
    ("ui.library.kind.text", "Text", "Texto", [],
     "Ordinary noun, attested as the value of ui.library.preview.pptx_text = \"Texto\" and inside ui.onboarding.tour.attachments.body.2 (\"…o un archivo de texto…\"). 5 cells."),
    ("ui.library.kind.video", "Video", "Video", ["N1"],
     "Correct choice and byte-identical to this namespace's own ui.library.category.video = \"Video\"; RAE gives \"video\" as the main form. N1 records the pre-existing accent split in ui.canvas only. 5 cells."),
    ("ui.library.tag_category.custom", "Custom", "Personalizado", [],
     "The catalogue's only use of the word family is the adjective \"Temas personalizados\" (ui.settings.appearance.editor.custom_group), and a bare masculine adjective is idiomatic for a Spanish filter-group heading; the sidecar's role (naming the group, not a count) is served. Measured 13 cells against the sidecar's ~12 rail hint — one cell over an approximate hint, and the rail heading is an h3 with no truncate/nowrap (library-filter-rail.tsx:91-97), so it wraps instead of clipping; recorded, no finding. \"Personalizadas\" (agreeing with etiquetas) is the only alternative and reads no better as a category header."),
    ("ui.library.tag_category.format", "Format", "Formato", [],
     "The locale's own word for a file format: ui.agents.skills.detail.form_label = \"Formato\", ui.settings.appearance.editor.picker.format = \"Formato de color\", and the error strings \"Formato de respuesta…\" (ui.common.errors.credit_balance_invalid). 7 cells."),
    ("ui.library.tag_category.project", "Project", "Proyecto", [],
     "Glossary §2 project → proyecto, and the catalogue agrees: ui.projects.project_list.project = \"Proyecto\", ui.projects.project_sort.project = \"Proyecto\". The sidecar's warning that this is a taxonomy group and not the Projects page is accurate (the Projects page labels are \"Proyectos\"). 8 cells."),
    ("ui.library.tag_category.source", "Source", "Origen", [],
     "Matches the neighbouring ui.library.filter.source = \"Origen\" — the same English word in two roles, which is exactly what English does (\"Source\" twice) — and ui.notifications.filter.from = \"Origen\", ui.browser.extensions.details_source = \"Origen\". The sidecar's note that this is not the Source filter section is accurate. 6 cells."),
    ("ui.library.tag_category.status", "Status", "Estado", [],
     "Matches ui.library.filter.status = \"Estado\"; the same word appearing as both a filter section and a tag-group heading is the same duplication English ships (\"Status\" twice), so no information is lost. ui.chat.status and ui.browser.extensions.details_on_off use \"Estado\" in the same sense. 6 cells."),
    ("ui.library.tag_category.topic", "Topic", "Tema", [],
     "Attested for this exact concept: ui.teamBridge.create.topic = \"Tema (opcional)\" (a topic field). The theme vocabulary elsewhere (ui.chat.pickers.theme.title = \"Tema\", ui.settings.appearance.editor.mode_dark = \"Tema oscuro\") is a different surface and different sense, and Spanish uses \"tema\" for both, so no Library-internal clash. 4 cells."),
    ("ui.library.tag_category.type", "Type", "Tipo", [],
     "The catalogue's established rendering for BOTH English words: \"Type\" in ui.agents.teams.col.type = \"Tipo\", ui.canvas.variable_form_dialog.type = \"Tipo\"; \"Kind\" in ui.library.sort.kind = \"Tipo\", ui.canvas.files.kind = \"Tipo\", ui.notifications.filter.kind = \"Tipo\". The sidecar asks this legacy group to stay distinct from the sort option \"Kind\"; Spanish has no natural second noun, the sort rows only appear while the sort menu (LIBRARY_SORTS, library-model.ts:79-90) is open, and the only alternative (\"Categoría\") would collide harder with ui.library.filter.categories = \"Categorías\". Recorded in the audit, not filed as a finding."),
    ("ui.library.preview.unsupported_generic", "This file has no in-app preview here.",
     "Este archivo no tiene vista previa en la app.", [],
     "Grammatical, names no kind, no placeholder, and the predicate is byte-identical to the shipped parameterised sentence ui.library.preview.unsupported = \"Un archivo de tipo {kind} no tiene vista previa en la app.\", so the two preview states read as one family rather than two dialects. Neutral-Spanish rule honoured (\"archivo\", not \"fichero\"), \"en la app\" for \"in-app\" inherited from the sibling, \"aquí/here\" dropped as the sibling drops it. 45 cells vs English's 37 (es runs 15-25% longer per the guide) in a centred paragraph (max-w-90), not a fixed-width slot. No exclamation, no address form required."),
]

NAMESPACE = {
    "status": "passed",
    "result": "clean-with-findings",
    "source_sha256": H["en"],
    "target_sha256": H["es"],
    "input_hashes": {
        "en": {"path": EN, "sha256": H["en"]},
        "es": {"path": ES, "sha256": H["es"]},
        "context": {"path": CTX, "sha256": H["context"]},
    },
    "fully_audited_keys": [k[0] for k in PER_KEY],
    "findings": FINDINGS,
}

receipt = {
    "locale": "es",
    "mode": (
        "Fresh independent delta audit of the 20 new keys of the single namespace "
        "ui.library for es against frozen head 8a9ce1f8; read-only worktree "
        "~/local-operator-ui/.worktrees/i18n-s8 (HEAD verified before any read). "
        "Allocation: fix (<2h), bounded audit only. Glossary conformance checked "
        "against the manager-owned byte-copy at _s14-audits/8a9ce1f8.../glossary.md "
        "(sha256 0eb34437a8c3d6f5..., identical to ~/local-operator/i18n/glossary.md). "
        "Fully audited keys: 20. The other 159 namespace keys were read only for JSON "
        "validity, key-set parity and cross-file term consistency; their legacy values "
        "are NOT recertified. No second independent pass: ui.library is not one of the "
        "high-visibility groups (onboarding, errors, settings) named for that; this "
        "auditor instead re-checked its own 20 values once before recording."
    ),
    "scope": (
        "PR damianvtran/local-operator-ui #1851 'fix(i18n): localize Library kind and "
        "tag-category labels' @ 8a9ce1f808c266ebe9a0e924094344cea60c2c23 (origin/main..HEAD). "
        "Audited keys: ui.library.kind.{audio,code,docx,html,image,markdown,other,pdf,"
        "pptx,spreadsheet,text,video} (12 file-kind badges), "
        "ui.library.tag_category.{custom,format,project,source,status,topic,type} "
        "(7 filter-rail group headings) and ui.library.preview.unsupported_generic. "
        "English metadata (ui.library.context.json) checked for all 20 entries. "
        "No full legacy namespace certification."
    ),
    "head_sha": HEAD,
    "audit_date": "2026-11-10",
    "key_count": 179,
    "fully_audited_key_count": 20,
    "consistency_only_key_count": 159,
    "translator": {
        "agent": "i18n-translator",
        "model": "anthropic/claude-sonnet-5-5",
        "source": (
            "Translator model supplied by the delegation (es, one session per locale, "
            "values landed verbatim); the translator SESSION ID was not supplied by the "
            "manager and is recorded as not supplied. This auditor did not translate and "
            "took no part in the translation."
        ),
    },
    "auditor": {
        "agent": "i18n-auditor",
        "instance": "1aaf6eb1954d",
        "session": "1aaf6eb1954d",
        "model": "deepseek/deepseek-flash",
        "actual_model_source": (
            "Served session header for session 1aaf6eb1954d states "
            "deepseek/deepseek-flash; no model switch or fallback occurred in this session."
        ),
        "fallback_used": False,
        "independent_from_translator_session": True,
    },
    "policy_sources": {
        "style_guide": GUIDE,
        "glossary": GLOSS,
        "expected_hashes": EXP,
    },
    "status": "passed",
    "result": "clean-with-findings",
    "verdict": "passed",
    "findings": FINDINGS,
    "severity_counts": {"blocker": 0, "major": 0, "minor": 1, "nit": 2},
    "namespaces": {"ui.library": NAMESPACE},
    "per_key_checks": [
        {
            "key": k,
            "source": src,
            "current_text": cur,
            "findings": f,
            "assessment": note,
            "placeholder_integrity": {
                "arguments": [],
                "matches_english": True,
                "number_skeleton": None,
            },
            "plural_select": [],
        }
        for k, src, cur, f, note in PER_KEY
    ],
    "english_metadata_check": {
        "key": "ui.library.context.json — all 20 new entries",
        "verdict": "accurate, with one imprecise pointer on kind.other (N2)",
        "detail": (
            "Roles match the render sites: the 12 kind notes say 'Library card/list/"
            "preview badge', which is LibraryCard's caption (library-card.tsx:245-252), "
            "LibraryRow's shrink-0 cluster (:365-374) and the preview header Badge "
            "(library-preview.tsx:494); the 7 tag_category notes say 'Library filter "
            "rail: header above one group of tags', which is Section's h3 "
            "(library-filter-rail.tsx:91-97) rendered through TagCategoryLabel "
            "(:102-105). Every 'length' count recomputes correctly: Audio 5, Code 4, "
            "DOCX 4, HTML 4, Image 5, Markdown 8, Other 5, PDF 3, PPTX 4, Spreadsheet "
            "11, Text 4, Video 5, Custom 6, Format 6, Project 7, Source 6, Status 6, "
            "Topic 5, Type 4, unsupported_generic 37. The raw-value fallback sentence "
            "is true of both helpers (libraryKindLabel returns the unknown kind, "
            "tagCategoryLabel returns the unknown category, and an empty category maps "
            "to 'custom' as the custom note states). The Singular/Legacy/plural-group "
            "warnings are all correct. Only kind.other's sentence-role pointer is "
            "wrong (N2)."
        ),
    },
    "mechanical": {
        "validator_commands_run": [
            "git rev-parse HEAD -> 8a9ce1f808c266ebe9a0e924094344cea60c2c23 on feat/i18n-s14-library-taxonomy (matches the frozen head)",
            "git status --porcelain -> empty (clean read-only worktree; nothing written)",
            "shasum -a 256 (en, en context, es) -> 065ac47c…, 2fe63e83…, 56d0fdd0…",
            "shasum -a 256 glossary copies -> both 0eb34437a8c3d6f5… (byte-identical)",
            "git diff --stat 0e12072d2b3..HEAD -- src/i18n/catalogues/es/ui.library.json -> 21 insertions(+), 1 deletion(-)",
            "python3 es-ds-1aaf6eb1954d-check.py -> all checks PASS (see audit.log for full output)",
            "node scripts/i18n/generate.mjs --check -> src/i18n/keys.gen.ts is byte-identical to a fresh generation. exit 0",
            "node scripts/i18n/check-duplicates.mjs -> ok — 1419 file(s) scanned, 0 duplicate key(s)",
            "node scripts/i18n/context-parity.mjs -> ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s) (shrink-only)",
            "node scripts/i18n/ledger-check.mjs -> FAILED — 21 finding(s) across 1099 ledger entr(ies); the es/ui.library rows are stale source_sha256 (ledger f573e43a8f34…, file 065ac47c67e2…), stale target_sha256 (ledger 97277c6a42c1…, file 56d0fdd0f7fa…) and the previous receipt naming older English bytes. Expected pre-audit state for a locale delta; no ledger write was run by this auditor.",
        ],
        "json_valid": True,
        "key_sets_identical_to_english": True,
        "keys_added_or_removed_vs_origin_main": (
            "none removed; es adds exactly the 20 task keys (git diff 0e12072d2b3..HEAD); "
            "the single deleted line is the trailing-comma rewrite of "
            "ui.library.time.years_y_ago, whose VALUE is unchanged — verified by loading "
            "both blobs: 0 changed values"
        ),
        "placeholder_parity": True,
        "icu_plural_select_needed": False,
        "es_plural_categories": (
            "not exercised: none of the 20 new values carries a plural or select, so the "
            "es one/many/other rule (and the prohibition on 'few') does not apply here"
        ),
        "invisible_characters": (
            "none: no NBSP, narrow NBSP, ZW*, bidi control, or non-space Zs/Cf/Cc "
            "character in any of the 20 es values (checked per character)"
        ),
        "widths_cells_vs_en": {
            "ui.library.kind.audio": [5, 5], "ui.library.kind.code": [6, 4],
            "ui.library.kind.docx": [4, 4], "ui.library.kind.html": [4, 4],
            "ui.library.kind.image": [6, 5], "ui.library.kind.markdown": [8, 8],
            "ui.library.kind.other": [4, 5], "ui.library.kind.pdf": [3, 3],
            "ui.library.kind.pptx": [4, 4], "ui.library.kind.spreadsheet": [15, 11],
            "ui.library.kind.text": [5, 4], "ui.library.kind.video": [5, 5],
            "ui.library.tag_category.custom": [13, 6],
            "ui.library.tag_category.format": [7, 6],
            "ui.library.tag_category.project": [8, 7],
            "ui.library.tag_category.source": [6, 6],
            "ui.library.tag_category.status": [6, 6],
            "ui.library.tag_category.topic": [4, 5],
            "ui.library.tag_category.type": [4, 4],
            "ui.library.preview.unsupported_generic": [45, 37],
            "_note": "[es cells, en cells]; the sidecar carries no machine maxCells, only the prose hints 'about 12 characters' (badge) and 'about 12 characters' (rail header)",
        },
        "hash_binding": "9/9 sha256 entries in expected-hashes.json recomputed and matching (en, fr, es, zh-CN, ru, vi, ur, hi ui.library + en ui.library.context); 0 mismatches",
    },
    "term_decisions": {
        "retained_latin_tokens": (
            "DOCX, HTML, PDF, PPTX and Markdown stay Latin: the es catalogue already "
            "writes PDF (ui.canvas.pdf_preview.pdf = 'PDF: {title}'), HTML "
            "(ui.canvas.create_file_dialog.html_html = 'HTML (.html)') and Markdown "
            "(ui.canvas.create_file_dialog.markdown_md = 'Markdown (.md)') in Latin, and "
            "glossary §1 keeps technology names in their official spelling; DOCX/PPTX are "
            "the same class of format acronym with no Spanish rendering in the product"
        ),
        "loanwords": (
            "'Audio' and 'Video' are ordinary Spanish nouns, not loanword drift; 'Code' "
            "is translated as 'Código' and 'Image'/'Text' as 'Imagen'/'Texto' rather than "
            "retained"
        ),
        "singular_vs_group": (
            "every kind badge is the singular of the family its plural rail group already "
            "uses (Imagen/Imágenes, Hoja de cálculo/Hojas de cálculo, Otro/Otros, "
            "Código/Código, Video/Video), with the one justified exception Audio vs "
            "Sonidos, which reproduces English's own Audio/Sounds split"
        ),
        "duplicate_words_vs_english": (
            "'Origen' and 'Estado' each name both a filter section (ui.library.filter."
            "source/.status) and a tag group here; English ships the same duplicates "
            "('Source' twice, 'Status' twice), so the translation is faithful rather "
            "than ambiguous-beyond-source"
        ),
    },
    "unverified": [
        "No rendered frame, Electron/React run, screenshot or Storybook: read-only, no-build, no-server constraint. Grammar, register and fit judgements are native-reader reasoning over the catalogue plus the markup read from source, not rendered output.",
        "No production ICU parser/formatter was run: none of the 20 values carries a placeholder, plural or select, so there was nothing for it to parse.",
        "No ledger write, no i18n/audits/evidence retention, no PR comment and no commit: writes were limited to this session's scratchpad. The manager retains these deliverables and records the ledger row.",
        "The 159 legacy ui.library values were not recertified; only JSON validity, key-set parity, 'nothing removed or altered vs origin/main' and cross-file term consistency were checked for them.",
        "The English kind.other note's 'see manifest' pointer could not be resolved to any artifact at this head; if it means a manager-held census, only the manager can confirm it (N2).",
        "The fit consequence of 'Hoja de cálculo' (F1) is reasoned from the markup (truncate on the card caption span, shrink-0 on the list-row cluster); it was not observed in a rendered frame.",
    ],
    "receipt_contract_review": (
        "Root, per-namespace, auditor and translator field sets mirror the model receipt "
        "_s12-audits/e5fb4310.../fr-ds-e3c562b03258.json; the single namespaces block "
        "carries status, result, source_sha256, target_sha256, input_hashes and findings. "
        "All three deliverable files were re-parsed with python3 json.load after writing "
        "(the log is plain text, parsed by reading). No repo schema validator writes were "
        "permitted or attempted."
    ),
    "audit_notes_not_execution_log": False,
    "execution_log": "es-ds-1aaf6eb1954d.audit.log",
}

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(receipt, fh, indent=1, ensure_ascii=False)
    fh.write("\n")

print("wrote", OUT, os.path.getsize(OUT), "bytes")
print("parsed back keys:", len(json.load(open(OUT)).keys()))
print("findings:", [f["id"] for f in json.load(open(OUT))["findings"]])
print("sha256:", hashlib.sha256(open(OUT, "rb").read()).hexdigest())
