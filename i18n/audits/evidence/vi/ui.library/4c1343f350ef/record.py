#!/usr/bin/env python3
"""Write the vi/ui.library delta-audit RECORD, deriving every hash from disk."""
import hashlib
import json
import pathlib

HOME = pathlib.Path.home()
SP = HOME / ".local-operator/sessions/4c1343f350ef/scratchpad"
WT = HOME / "local-operator-ui/.worktrees/i18n-s8"
AU = HOME / "local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23"
NAME = "vi-ds-4c1343f350ef"


def sha(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()


receipt = json.loads((SP / f"{NAME}.json").read_text())
h_receipt = sha(SP / f"{NAME}.json")
h_log = sha(SP / f"{NAME}.audit.log")
h_check = sha(SP / f"{NAME}-check.py")
h_out = sha(SP / f"{NAME}-check.out")

record = {
    "locale": "vi",
    "namespaces": {
        "ui.library": {
            "status": "passed",
            "fully_audited_key_count": 20,
            "consistency_only_key_count": 159,
            "finding_ids": ["F1", "F2"],
            "input_hashes": receipt["namespaces"]["ui.library"]["input_hashes"],
        }
    },
    "audit_date": "2026-11-10",
    "key_count": 179,
    "fully_audited_key_count": 20,
    "consistency_only_key_count": 159,
    "scope": (
        "PR damianvtran/local-operator-ui #1851 @ 8a9ce1f808c266ebe9a0e924094344cea60c2c23 "
        "(0e12072d2b3..HEAD); delta audit of the 20 new ui.library keys (12 kind labels, 7 tag-category "
        "headings, preview.unsupported_generic). The namespace's 159 legacy values were not recertified: "
        "only JSON validity, key-set parity, unchanged-value parity against the base and "
        "placeholder/plural integrity were checked for them."
    ),
    "head_sha": "8a9ce1f808c266ebe9a0e924094344cea60c2c23",
    "auditor": receipt["auditor"],
    "translator": receipt["translator"],
    "policy_inputs": {
        "style_guide": {
            "path": "~/local-operator/i18n/style-guides/vi.md",
            "sha256": sha(HOME / "local-operator/i18n/style-guides/vi.md"),
        },
        "glossary": {
            "path": "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23/glossary.md",
            "sha256": sha(AU / "glossary.md"),
            "note": "Manager-owned byte-copy; verified identical by sha256 to ~/local-operator/i18n/glossary.md; glossary conformance was checked against this copy.",
        },
        "expected_hashes": {
            "path": "~/local-operator-ui/.worktrees/_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23/expected-hashes.json"
        },
    },
    "artifacts": [
        {
            "path": f"{NAME}.json",
            "sha256": h_receipt,
            "kind": "audit_notes_not_execution_log",
            "record_reference": "record.json",
        },
        {
            "path": f"{NAME}.audit.log",
            "sha256": h_log,
            "kind": "actual_execution_log",
            "record_reference": "record.json",
        },
        {
            "path": f"{NAME}-check.py",
            "sha256": h_check,
            "kind": "executed_check_source",
            "record_reference": "record.json",
        },
        {
            "path": f"{NAME}-check.out",
            "sha256": h_out,
            "kind": "executed_check_output",
            "record_reference": "record.json",
        },
    ],
    "current_report_verdict": {
        "status": "passed",
        "unresolved_blocker_major_count": 0,
        "finding_ids": ["F1", "F2"],
    },
    "finding_report": f"{NAME}.json",
    "audit_notes_not_execution_log": False,
    "execution_log": f"{NAME}.audit.log",
    "ledger_row": {
        "command_named_in_the_RFC": "node scripts/i18n/ledger-assemble.mjs",
        "ran": False,
        "why_not": (
            "Read-only audit: ledger-assemble writes i18n/ledger.json in the repository and this task "
            "forbids repo writes. Recording is the manager's step."
        ),
        "derived_values": {
            "locale": "vi",
            "namespace": "ui.library",
            "auditor": "i18n-auditor",
            "model": "deepseek/deepseek-flash",
            "instance": "4c1343f350ef",
            "status": "audited",
            "source_sha256": receipt["namespaces"]["ui.library"]["source_sha256"],
            "target_sha256": receipt["namespaces"]["ui.library"]["target_sha256"],
            "result": "clean-with-findings",
        },
        "proposed_note": (
            "passed; 2 MINOR (F1 en note kind.other misleading, F2 type 'Loại' collides sort.kind); "
            "20/20 keys audited, hashes 3/3 OK; record i18n/audits/evidence/vi/ui.library/ds-4c1343f350ef/record.json"
        ),
        "proposed_note_length": None,
    },
    "retention": {
        "state": "scratch_handoff_only_per_explicit_read_only_task",
        "intended_tracked_directory": "i18n/audits/evidence/vi/ui.library/ds-4c1343f350ef",
        "manager_action_required": (
            "Retain these four files under the canonical evidence root (" +
            "record.json plus the receipt, audit.log and executed check source/output) and record the "
            "ledger row with ledger-assemble.mjs."
        ),
        "proposed_note": (
            "passed; 2 MINOR (F1 en note kind.other misleading, F2 type 'Loại' collides sort.kind); "
            "20/20 keys audited, hashes 3/3 OK; record i18n/audits/evidence/vi/ui.library/ds-4c1343f350ef/record.json"
        ),
    },
    "unverified": receipt["unverified"],
}

note = record["ledger_row"]["proposed_note"]
record["ledger_row"]["proposed_note_length"] = len(note)
assert len(note) <= 280, len(note)

out = SP / f"{NAME}.record.json"
out.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
print("wrote", out)
print("note length:", len(note))
print("artifacts:", [(a["path"], a["sha256"][:12]) for a in record["artifacts"]])
