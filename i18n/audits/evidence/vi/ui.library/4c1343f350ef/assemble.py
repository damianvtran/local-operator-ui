#!/usr/bin/env python3
"""Assemble the vi/ui.library delta-audit receipt, record and companions.

Writes ONLY into this session's scratchpad. Every value that names audited bytes
(hash, English source, translated text) is read from disk here, never typed.
"""
import hashlib
import json
import pathlib

HOME = pathlib.Path.home()
WT = HOME / "local-operator-ui/.worktrees/i18n-s8"
AU = HOME / "local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23"
SP = HOME / ".local-operator/sessions/4c1343f350ef/scratchpad"
HEAD = "8a9ce1f808c266ebe9a0e924094344cea60c2c23"
BASE = "0e12072d2b3"
NS = "ui.library"
INST = "4c1343f350ef"
TAG = "ds"
LOC = "vi"

KINDS = "audio code docx html image markdown other pdf pptx spreadsheet text video".split()
CATS = "custom format project source status topic type".split()
NEW = [f"{NS}.kind.{k}" for k in KINDS] + [f"{NS}.tag_category.{k}" for k in CATS] + [f"{NS}.preview.unsupported_generic"]


def flat(d, p=""):
    o = {}
    for k, v in d.items():
        kk = f"{p}.{k}" if p else k
        if isinstance(v, dict):
            o.update(flat(v, kk))
        else:
            o[kk] = v
    return o


def sha(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()


en = flat(json.loads((WT / f"src/i18n/catalogues/en/{NS}.json").read_text()))
vi = flat(json.loads((WT / f"src/i18n/catalogues/{LOC}/{NS}.json").read_text()))
ctx = json.loads((WT / f"src/i18n/catalogues/en/{NS}.context.json").read_text())
H_EN = sha(WT / f"src/i18n/catalogues/en/{NS}.json")
H_VI = sha(WT / f"src/i18n/catalogues/{LOC}/{NS}.json")
H_CTX = sha(WT / f"src/i18n/catalogues/en/{NS}.context.json")
H_SG = sha(HOME / "local-operator/i18n/style-guides/vi.md")
H_GL = sha(AU / "glossary.md")

ASSESS = {
    "audio": "Exact singular of this locale's own group label ui.library.category.sounds 'Âm thanh'; the noun for sound/audio. Badge reads naturally beside the size.",
    "code": "'Mã nguồn' (source code) is the settled rendering in this catalogue for the code family: ui.library.category.code, ui.canvas.files.code, ui.canvas.file_rows.code, ui.settings.model.system_prompt.source 'Mã nguồn Markdown'. Correct for a source-code file.",
    "docx": "DOCX retained. No earlier DOCX occurrence in vi to contradict it; the en note and the locale's HTML/Markdown precedent both support keeping the format acronym.",
    "html": "HTML retained, matching ui.canvas.create_file_dialog.html_html 'HTML (.html)', ui.canvas.html_preview 'Xem trước HTML: {title}' and onboarding 'tệp HTML'.",
    "image": "Exact singular of ui.library.category.images 'Hình ảnh'; no plural inflection in vi, so identity with the group label is the correct form.",
    "markdown": "Markdown retained as the format's proper name, matching 'Markdown (.md)', 'Mã nguồn Markdown', 'Sao chép Markdown' and 'Xem trước markdown'.",
    "other": "'Khác' is the ordinary catch-all noun and matches ui.library.category.other exactly; singular/plural-neutral, not an action.",
    "pdf": "PDF retained, matching onboarding 'tệp PDF', ui.canvas.pdf_preview.pdf 'PDF: {title}' and ui.teamBridge.fileCard.kind 'pdf {PDF}'.",
    "pptx": "PPTX retained. No earlier PPTX occurrence in vi to contradict it; same retention rule the en note allows and DOCX/HTML follow.",
    "spreadsheet": "'Bảng tính' matches ui.library.category.spreadsheets, ui.canvas.files.spreadsheets and ui.canvas.file_rows.spreadsheets; the badge is unambiguous for one workbook file.",
    "text": "'Văn bản' is this catalogue's word for text (ui.library.preview.pptx_text 'Văn bản'; ui.teamBridge.fileCard.kind 'text {Tệp văn bản}'). The bare noun is the right shape for a badge and does not collide with category.documents 'Tài liệu'.",
    "video": "Video retained, matching ui.library.category.video, ui.canvas.files.videos and ui.canvas.file_rows.video.",
    "custom": "'Tùy chỉnh' matches every existing occurrence in this catalogue (ui.agents.pages.scope.custom, ui.settings.appearance.editor.customize, three onboarding titles, ui.chat.dialogs.options.description); orthography (tone on the first vowel of the open 'uy' syllable) and NFC form both follow the vi guide.",
    "format": "'Định dạng' matches the catalogue's own use of the word in ui.library.preview.pptx_failed_detail ('dùng định dạng mà trình xem này không hiểu'); correct heading for file-format tags.",
    "project": "'Dự án' is the glossary's vi rendering for project (glossary §2, project -> dự án) and the catalogue's vocabulary; the en note's caveat (not the Projects page) does not require a different word, and English shares the word too.",
    "source": "'Nguồn' matches ui.library.filter.source exactly; English shares the word between the tag group and the filter section, so sharing it here is faithful, not sloppy.",
    "status": "'Trạng thái' matches ui.library.filter.status exactly; same shared-word situation as English.",
    "topic": "'Chủ đề' matches this catalogue's use for topic (ui.teamBridge.create.topic 'Chủ đề (không bắt buộc)'); correct subject-matter heading.",
    "type": "Defensible but weaker: 'Loại' is also the shipped rendering of 'Kind' at ui.library.sort.kind, and the English note asks for distinctness from it. See F2; 'Kiểu' would separate the two concepts.",
    "unsupported_generic": "Grammatical, names no kind, carries no placeholder, and is the exact same frame as the shipped ui.library.preview.unsupported with the {kind} clause replaced by 'này' ('Tệp {kind} không có bản xem trước trong ứng dụng.' -> 'Tệp này không có bản xem trước trong ứng dụng.'). Register and the 'in-app preview' phrasing match the neighbouring strings.",
}
SHORT = {k.split(".")[-1]: k for k in NEW}

def build_per_key():
    """Built after f1/f2 exist, so each entry can carry the finding OBJECT itself."""
    per_key = []
    for k in NEW:
     slug = k.split(".")[-1]
     per_key.append({
        "key": k,
        "source": en[k],
        "current_text": vi[k],
        # The model receipt's per-key `findings` is a list; here it carries the same
        # finding OBJECTS as the root list (the model's own duplication pattern), so the
        # field's type is uniform across the receipt instead of mixing ids and objects.
        "findings": ([f2] if k == f"{NS}.tag_category.type" else
                     [f1] if k == f"{NS}.kind.other" else []),
        "assessment": ASSESS[slug],
        "placeholder_integrity": {"arguments": [], "matches_english": True, "number_skeleton": None},
        "plural_select": [],
      })
    return per_key

f1 = {
    "id": "F1",
    "severity": "minor",
    "key": f"{NS}.kind.other",
    "current_text": vi[f"{NS}.kind.other"],
    "english_source": en[f"{NS}.kind.other"],
    "problem": ("English context note: the note says "
                "'Rendered inside the sentence ui.library.preview.unsupported ONLY via the generic fallback; "
                "see manifest.' The label is never substituted into that sentence - library-viewers.tsx:108 "
                "renders ui.library.preview.unsupported_generic for kind === 'other', and that message has no "
                "{kind} slot. Its sibling note for unsupported_generic states the same fact correctly, so the "
                "two notes contradict each other, and the 'see manifest' pointer does not resolve to a file a "
                "translator can open (the only library-adjacent manifest is the five-key census audit-evidence "
                "manifest, which has no library-kind entries). No defect in the vi value itself."),
    "recommendation": ("Reword the note to: 'Never substituted into a sentence: the catch-all state renders "
                       "ui.library.preview.unsupported_generic, which has no {kind} slot.' Metadata only; "
                       "the translated value 'Khác' is correct as shipped."),
    "evidence": [
        "src/renderer/src/features/library/components/library-viewers.tsx:104-112 — asset.kind === 'other' ? t('ui.library.preview.unsupported_generic') : t('ui.library.preview.unsupported', {kind: libraryKindLabel(asset.kind)})",
        "src/i18n/catalogues/en/ui.library.context.json ui.library.preview.unsupported_generic note: 'Shown when the file kind is the catch-all `other`; no placeholders.'",
        "docs/i18n/census-five-key-provenance.md line 104: the 'manifest' link points at i18n/audit-evidence/census-five-key-second/manifest.json, which greps empty for unsupported_generic and kind.other",
        "src/i18n/catalogues/en/ui.library.json ui.library.preview.unsupported_generic = 'This file has no in-app preview here.' (no placeholder)",
    ],
    "gates": False,
}
f2 = {
    "id": "F2",
    "severity": "minor",
    "key": f"{NS}.tag_category.type",
    "current_text": vi[f"{NS}.tag_category.type"],
    "english_source": en[f"{NS}.tag_category.type"],
    "problem": ("'Loại' is a fair rendering of 'Type', but it is also this catalogue's shipped rendering of "
                "'Kind' at ui.library.sort.kind ('Loại'), which the English note explicitly asks to be kept "
                "distinct ('Keep it distinct from the sort option \\'Kind\\'.'). Both are reachable on the "
                "Library page: the tag-group header in the filter rail and the sort menu "
                "(library-page.tsx:904-924). MINOR rather than MAJOR because the word is not wrong, the "
                "colliding concept is a legacy, rarely-used category (core ids are format/status), and the "
                "collision exists only across two different controls."),
    "recommendation": "Move this new key, not the shipped sort option: 'Kiểu' (4 cells) or 'Thể loại' (8 cells) — both fit the ~12-cell rail header budget and keep 'Loại' meaning exactly one thing on the page.",
    "evidence": [
        "src/i18n/catalogues/vi/ui.library.json ui.library.sort.kind = 'Loại'",
        "src/i18n/catalogues/en/ui.library.context.json ui.library.tag_category.type note: 'Keep it distinct from the sort option \\'Kind\\'.'",
        "src/i18n/catalogues/en/ui.library.json ui.library.tag_category.type = 'Type' (separate English word from 'Kind')",
        "src/renderer/src/features/library/components/library-page.tsx:904-924 — the sort list renders t(sort.labelKey) including sort.kind",
        "src/renderer/src/features/library/components/library-filter-rail.tsx:104 — the tag-group header renders tagCategoryLabel(category) in the same page's rail",
    ],
    "gates": False,
}

receipt = {
    "locale": LOC,
    "mode": ("Fresh independent delta audit of the 20 new keys in the single namespace ui.library against "
             f"frozen head {HEAD[:10]}; read-only worktree ~/local-operator-ui/.worktrees/i18n-s8. Allocation: "
             "fix (<2h), bounded audit only. Glossary conformance checked against the manager-owned byte-copy "
             "at _s14-audits/8a9ce1f8…/glossary.md (sha256 0eb34437a8c3d6f5…, identical to "
             "~/local-operator/i18n/glossary.md). All 20 delta keys audited in full in two passes; the "
             "namespace's other 159 legacy values were read only for JSON validity, key-set parity, "
             "unchanged-value parity against the base and plural/placeholder integrity, and are NOT certified."),
    "scope": (f"PR damianvtran/local-operator-ui #1851 @ {HEAD} ({BASE}..HEAD). Audited keys: 12 x "
              "ui.library.kind.{audio,code,docx,html,image,markdown,other,pdf,pptx,spreadsheet,text,video}, "
              "7 x ui.library.tag_category.{custom,format,project,source,status,topic,type}, "
              "ui.library.preview.unsupported_generic — the file-kind badge (card caption, list row, preview "
              "header), the tag-group heading in the filter rail, and the catch-all unsupported-preview "
              "sentence. Concerns (a)-(i) of the brief each answered; the English context note of "
              "ui.library.kind.other is flagged (F1) as metadata, not translation. No full legacy namespace "
              "certification, no ledger write, no PR comment, no commit."),
    "head_sha": HEAD,
    "audit_date": "2026-11-10",
    "key_count": len(en),
    "fully_audited_key_count": 20,
    "consistency_only_key_count": len(en) - 20,
    "translator": {
        "agent": "i18n-translator",
        "model": "anthropic/claude-sonnet-5-5",
        "source": ("Translator model and session (vi 8f78815e51e3) supplied by delegation; this auditor did "
                   "not translate, edit or take part in translation."),
    },
    "auditor": {
        "agent": "i18n-auditor",
        "instance": INST,
        "session": INST,
        "model": "deepseek/deepseek-flash",
        "actual_model_source": ("Served session header for session 4c1343f350ef states "
                                "deepseek/deepseek-flash; no model switch, pin or fallback occurred in this "
                                "session."),
        "fallback_used": False,
        "independent_from_translator_session": True,
    },
    "policy_sources": {
        "style_guide": {"path": "~/local-operator/i18n/style-guides/vi.md", "sha256": H_SG},
        "glossary": {
            "path": "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23/glossary.md",
            "sha256": H_GL,
            "note": ("Manager-owned byte-copy; verified identical to ~/local-operator/i18n/glossary.md by "
                     "sha256; glossary conformance was checked against this copy."),
        },
        "expected_hashes": {
            "path": "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23/expected-hashes.json"
        },
    },
    "status": "passed",
    "result": "clean-with-findings",
    "verdict": "clean-with-findings",
    "verdict_note": ("passed — 20/20 delta keys audited; 0 BLOCKER, 0 MAJOR, 2 MINOR, 0 NIT. The shipped vi "
                "strings need no change to pass: F1 is an English context note, F2 is a defensible word the "
                "manager may prefer to move ('Loại' -> 'Kiểu' for tag_category.type). Hash binding 3/3."),
    "findings": [f1, f2],
    "severity_counts": {"blocker": 0, "major": 0, "minor": 2, "nit": 0},
    "namespaces": {
        NS: {
            "status": "passed",
            "result": "clean-with-findings",
            "source_sha256": H_EN,
            "target_sha256": H_VI,
            "input_hashes": {
                "en": {"path": f"src/i18n/catalogues/en/{NS}.json", "sha256": H_EN},
                LOC: {"path": f"src/i18n/catalogues/{LOC}/{NS}.json", "sha256": H_VI},
                "context": {"path": f"src/i18n/catalogues/en/{NS}.context.json", "sha256": H_CTX},
            },
            "fully_audited_keys": NEW,
            "findings": [f1, f2],
        }
    },
    "per_key_checks": build_per_key(),
    "english_metadata_check": {
        "key": "the 20 context entries of ui.library (12 kind badges, 7 tag headings, 1 preview sentence)",
        "verdict": ("19 of 20 accurate; one misleading clause in ui.library.kind.other (F1)"),
        "detail": ("Roles verified against the render sites: 'Library card/list/preview badge' is exact "
                   "(KindLabel at library-card.tsx:250 card caption and :368 list row; the neutral Badge at "
                   "library-preview.tsx:494 is the preview header), and 'Library filter rail: header above "
                   "one group of tags' matches the <h3> Section header fed by TagCategoryLabel "
                   "(library-filter-rail.tsx). The tone line ('sentence case, no exclamation marks') matches "
                   "both the English and the vi values. All 20 'length' claims were recomputed against the "
                   "English strings (5,4,4,4,5,8,5,3,4,11,4,5 / 6,6,7,6,6,5,4 / 37) and all 20 match "
                   "character-for-character. The unsupported_generic note ('Shown when the file kind is the "
                   "catch-all `other`; no placeholders') is accurate against library-viewers.tsx."),
        "observation": ("F1 only: the kind.other note's 'Rendered inside the sentence "
                        "ui.library.preview.unsupported ONLY via the generic fallback; see manifest' "
                        "misdescribes the render path and its pointer does not resolve. Reported on the "
                        "English metadata, not against the vi value."),
    },
    "mechanical": {
        "validator_commands_run": [
            "git rev-parse HEAD -> 8a9ce1f808c266ebe9a0e924094344cea60c2c23 (equals the frozen head); git status --porcelain -> empty",
            "shasum -a 256 en/vi ui.library.json + en context -> 065ac47c…/12262f8c…/2fe63e83…, all equal to expected-hashes.json",
            "node scripts/i18n/generate.mjs --check -> 'src/i18n/keys.gen.ts is byte-identical to a fresh generation' (exit 0)",
            "node scripts/i18n/check-duplicates.mjs -> 'check-duplicates: ok — 1419 file(s) scanned, 0 duplicate key(s)' (exit 0)",
            "node scripts/i18n/context-parity.mjs -> 'context-parity: ok — every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s)' (exit 0)",
            "node scripts/i18n/ledger-check.mjs -> FAILED, 21 findings across 1099 entries; the 3 vi/ui.library findings are the expected pre-audit staleness (stale source_sha256 f573e43a8f34…, stale target_sha256 d303b353483f…, receipt does not name the English bytes on disk). No ledger write run.",
            "python3 <scratchpad>/vi-ds-4c1343f350ef-check.py -> the numbers below (output kept as vi-ds-4c1343f350ef-check.out)",
        ],
        "json_valid": True,
        "key_sets_identical_to_english": True,
        "keys_added_or_removed_vs_origin_main": ("vi: 20 keys added, 0 removed, 0 existing values changed; the "
                                                "single '-' line is the previously-last key re-emitted with a "
                                                "trailing comma (parsed-value comparison, not diff reading). "
                                                "en +21/-1 and context +120/-0 behave the same way; no "
                                                "existing en value or context entry changed."),
        "placeholder_parity": True,
        "icu_plural_select_needed": False,
        "hash_binding": "3/3 sha256 entries for this locale's namespace match expected-hashes.json (exact 64-hex equality).",
        "invisible_characters": "none in the 20 values (no NBSP, U+202F, ZWJ/ZWNJ/ZWSP, bidi control, soft hyphen, BOM)",
        "nfc_form": "all 20 values NFC with no combining marks (vi guide's precomposed-form rule holds)",
        "width_cells": ("kind labels 3-9 cells, tag headings 4-10 cells, all inside the ~12-cell badge/rail "
                        "budget from the en sidecar; unsupported_generic 46 cells vs the shipped unsupported "
                        "sentence's 49 in the same body-copy slot, so no overflow to report"),
        "terminology_consistency": ("kind labels equal the singular of this locale's own group labels where "
                                    "the language allows it (code, image, audio/sounds, spreadsheet, video, "
                                    "other); tag headings reuse shipped vocabulary (filter.source 'Nguồn', "
                                    "filter.status 'Trạng thái', glossary project -> 'Dự án'); retentions "
                                    "DOCX/HTML/PDF/PPTX/Markdown/Video are backed by existing vi values, not "
                                    "convention alone"),
    },
    "unverified": [
        "No production ICU parser/formatter, Electron/React run, screen-reader session or rendered-frame check: read-only, no-build, no-server, no-test-tree constraint. Width figures are cell counts from east-asian-width, not pixels; no truncation was observed or could be.",
        "No ledger write (ledger-assemble.mjs), no tracked evidence retention, no PR comment and no commit: writes were limited to this session's scratchpad.",
        "The 159 non-delta legacy values of ui.library were not certified; only JSON validity, key-set parity, unchanged-value parity against the base and placeholder/plural integrity were checked for them.",
        "The 'see manifest' pointer in the kind.other note was searched only under docs/ and i18n/audit-evidence/ in this worktree; a manifest outside the repo cannot be ruled out.",
    ],
    "receipt_contract_review": ("Root, per-namespace, auditor and translator field sets mirror the model receipt "
                                "_s12-audits/e5fb4310…/fr-ds-e3c562b03258.json; the namespaces object carries "
                                "exactly one block for ui.library with status, result, source_sha256, "
                                "target_sha256, input_hashes and findings."),
    "audit_notes_not_execution_log": False,
    "execution_log": f"{LOC}-{TAG}-{INST}.audit.log",
}

receipt_path = SP / f"{LOC}-{TAG}-{INST}.json"
receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
print("wrote", receipt_path, len(receipt_path.read_text()), "bytes")
print("receipt re-parses:", bool(json.loads(receipt_path.read_text())))
