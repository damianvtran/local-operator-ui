#!/usr/bin/env python3
"""Writes es-ds-1aaf6eb1954d.record.json (provenance record) and prints the
ledger-note candidate with its length (the note must stay <= 280 characters)."""
import hashlib
import json
import os

SCRATCH = os.environ["LOCAL_OPERATOR_SCRATCHPAD"]
RECEIPT = "es-ds-1aaf6eb1954d.json"
LOG = "es-ds-1aaf6eb1954d.audit.log"
CHECK = "es-ds-1aaf6eb1954d-check.py"
OUT = os.path.join(SCRATCH, "es-ds-1aaf6eb1954d.record.json")

def sha(name):
    return hashlib.sha256(open(os.path.join(SCRATCH, name), "rb").read()).hexdigest()

INPUT_HASHES = {
    "en": {"path": "src/i18n/catalogues/en/ui.library.json",
           "sha256": "065ac47c67e2a82867070f9df0e33d25c0d96aedd77438b584114147db07fd71"},
    "context": {"path": "src/i18n/catalogues/en/ui.library.context.json",
                "sha256": "2fe63e830b49079dac67c5c4513358d0a8559a94fbf27ac8d437212b13aa2e72"},
    "es": {"path": "src/i18n/catalogues/es/ui.library.json",
           "sha256": "56d0fdd0f7fa73704840093247fa06fb04e1cb0abaaccce7318b9f37b916f099"},
}

NOTE = (
    "passed; clean-with-findings: 0 blocker/major, F1 MINOR (kind.spreadsheet 15 "
    "cells vs ~12 hint), N1/N2 nits; 9/9 expected hashes match; record "
    "i18n/audits/evidence/es/ui.library/es-ds-1aaf6eb1954d/record.json"
)

record = {
    "locale": "es",
    "namespace": "ui.library",
    "audit_date": "2026-11-10",
    "key_count": 179,
    "fully_audited_key_count": 20,
    "consistency_only_key_count": 159,
    "head_sha": "8a9ce1f808c266ebe9a0e924094344cea60c2c23",
    "scope": (
        "PR damianvtran/local-operator-ui #1851 'fix(i18n): localize Library kind and "
        "tag-category labels' @ 8a9ce1f8 (origin/main..HEAD). Delta audit of the 20 new "
        "ui.library keys (12 kind.* badges, 7 tag_category.* rail headings, "
        "preview.unsupported_generic) plus the 20 English context entries. No full "
        "legacy namespace certification: the other 159 values were checked only for "
        "JSON validity, key-set parity, nothing removed/altered vs origin/main and "
        "cross-file term consistency."
    ),
    "namespaces": {
        "ui.library": {
            "status": "passed",
            "result": "clean-with-findings",
            "fully_audited_key_count": 20,
            "consistency_only_key_count": 159,
            "finding_ids": ["F1", "N1", "N2"],
            "input_hashes": INPUT_HASHES,
        }
    },
    "auditor": {
        "agent": "i18n-auditor",
        "instance": "1aaf6eb1954d",
        "session": "1aaf6eb1954d",
        "model": "deepseek/deepseek-flash",
        "actual_model_source": (
            "Served session header for session 1aaf6eb1954d states "
            "deepseek/deepseek-flash; no model switch or fallback occurred in this "
            "session."
        ),
        "fallback_used": False,
        "independent_from_translator_session": True,
    },
    "translator": {
        "agent": "i18n-translator",
        "model": "anthropic/claude-sonnet-5-5",
        "source": (
            "Translator model supplied by the delegation; the translator session id was "
            "not supplied by the manager and is recorded as 'not supplied'. One session "
            "per locale, values landed verbatim. This auditor did not translate and took "
            "no part in translation."
        ),
    },
    "policy_inputs": {
        "style_guide": {
            "path": "~/local-operator/i18n/style-guides/es.md",
            "sha256": "77b9227213802d14c74d4298d6b346ad842bbf2a5ca3b9d46fc6144430d26c3e",
        },
        "glossary": {
            "path": "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23/glossary.md",
            "sha256": "0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8",
            "note": (
                "Manager-owned byte-copy, sha256-verified identical to "
                "~/local-operator/i18n/glossary.md; glossary conformance was checked "
                "against this copy."
            ),
        },
        "expected_hashes": {
            "path": "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23/expected-hashes.json",
        },
    },
    "artifacts": [
        {"path": RECEIPT, "sha256": sha(RECEIPT),
         "kind": "audit_notes_not_execution_log", "record_reference": "record.json"},
        {"path": LOG, "sha256": sha(LOG),
         "kind": "actual_execution_log", "record_reference": "record.json"},
        {"path": CHECK, "sha256": sha(CHECK),
         "kind": "executed_check_source", "record_reference": "record.json"},
    ],
    "current_report_verdict": {
        "status": "passed",
        "unresolved_blocker_major_count": 0,
        "finding_ids": ["F1", "N1", "N2"],
    },
    "finding_report": RECEIPT,
    "audit_notes_not_execution_log": False,
    "execution_log": LOG,
    "retention": {
        "state": "scratch_handoff_only_per_explicit_read_only_task",
        "intended_tracked_directory": "i18n/audits/evidence/es/ui.library/es-ds-1aaf6eb1954d/",
        "manager_action_required": (
            "Retain these three files plus the executed check source under the canonical "
            "evidence root and record the ledger row. No ledger command was run by this "
            "auditor (read-only, no repo writes)."
        ),
        "proposed_ledger_note": NOTE,
        "proposed_ledger_note_length": len(NOTE),
    },
    "unverified": [
        "No rendered frame, Electron/React run or Storybook: read-only, no-build, "
        "no-server constraint. Grammar, register and fit judgements are native-reader "
        "reasoning over the catalogue plus markup read from source.",
        "No ICU parser/formatter run: none of the 20 values carries a placeholder, plural "
        "or select.",
        "No ledger write, tracked evidence retention, PR comment or commit: writes were "
        "limited to this session's scratchpad.",
        "The 159 legacy ui.library values were not recertified.",
        "The English kind.other note's 'see manifest' pointer resolved to no artifact at "
        "this head (N2); if it means a manager-held census, only the manager can confirm.",
        "F1's fit consequence is reasoned from the markup, not observed in a rendered "
        "frame.",
    ],
}

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(record, fh, indent=1, ensure_ascii=False)
    fh.write("\n")

back = json.load(open(OUT, encoding="utf-8"))
print("wrote", OUT, os.path.getsize(OUT), "bytes; parsed back:", len(back), "fields")
print("artifacts:", [(a["path"], a["sha256"][:16] + "…") for a in back["artifacts"]])
print("ledger note length:", len(NOTE), "<= 280:", len(NOTE) <= 280)
print(NOTE)
print("record sha256:", hashlib.sha256(open(OUT, "rb").read()).hexdigest())
