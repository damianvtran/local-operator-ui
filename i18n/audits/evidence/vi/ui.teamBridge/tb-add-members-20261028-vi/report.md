# Independent audit — vi — ui.teamBridge.members.* (PR add-members)

- audit id: `tb-add-members-20261028-vi`
- date: 2026-10-28
- auditor: i18n-auditor (independent of the translator; wrote none of the audited strings)
- model: kimi/k3.1-pro — session header string; the run executed under the harness's 429 fallback chain (see the receipt's `model_note`)
- HEAD: `b3a67e9bb78248070f1e243a04e0c6d9910b4d72`

## Verdict

**CLEAN (terminal)** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 1 NIT.

The 28-key delta preserves every semantic the brief names: inviting is not membership (`add` = send invitations),
an invited agent stays invited and joins muted only on its OWNER's consent (`state.invited`, `agent_invitation`,
`invitation_note`), roles are conversation owner/member, `state.invited` never reads as active, `remove` is a
conversation-member action, and `Team Bridge` stays untranslated Latin.

## Hashes

- en: `4337253270df03ec0ad4bf00bd27db4f4e8d279376f0dfe5be230fb1d897d01a`
- vi: `67ee41034f2d9cd7eb87520d51120eac99ea14375dafc03bbccc3daf0031136a`
- context sidecar: `3c204399befa0116d1b72c6e2cc0905fab61389d18fedfca72a7fddb4b813c8f`

## Findings

- **NIT** `ui.teamBridge.members.loading` — «Đang tải mọi người và tác nhân» names people as «mọi người» while the other seven people-and-agents keys in this group use «người» («Mời người và tác nhân», «Tìm người và tác nhân», «Không có người hoặc tác nhân nào…»), so it reads 'Loading everyone and agents'. NIT rather than MINOR because «Mọi người» is also this file's People surface title (ui.teamBridge.people.title). Proposed: «Đang tải người và tác nhân».

## Source-side gate (blocks merge, not this locale's copy)

`scripts/i18n/context-parity.mjs` exits 1: 15 of the 28 English keys have no
`.context.json` entry and no `i18n/context-allowance.json` entry, so those strings were translated
blind. Authoring the sidecar entries fixes the gate; the translated bytes do not change, so no re-audit
of the copy is implied.

Uncovered: `menu`, `current`, `current_empty`, `invite`, `search`, `empty`, `no_matches`, `load_error`, `removing`, `read_only`, `role.owner`, `role.member`, `state.active`, `state.left`, `mutation_error`

## Not claimed

Source-only audit: no test, build, Storybook, browser or rendered-frame run. No width, activation or
release approval.
