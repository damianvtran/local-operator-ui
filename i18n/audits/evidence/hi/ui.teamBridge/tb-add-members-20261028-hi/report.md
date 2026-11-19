# Independent audit — hi — ui.teamBridge.members.* (PR add-members)

- audit id: `tb-add-members-20261028-hi`
- date: 2026-10-28
- auditor: i18n-auditor (independent of the translator; wrote none of the audited strings)
- model: kimi/k3.1-pro — session header string; the run executed under the harness's 429 fallback chain (see the receipt's `model_note`)
- HEAD: `b3a67e9bb78248070f1e243a04e0c6d9910b4d72`

## Verdict

**CLEAN (terminal)** — 0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT.

The 28-key delta preserves every semantic the brief names: inviting is not membership (`add` = send invitations),
an invited agent stays invited and joins muted only on its OWNER's consent (`state.invited`, `agent_invitation`,
`invitation_note`), roles are conversation owner/member, `state.invited` never reads as active, `remove` is a
conversation-member action, and `Team Bridge` stays untranslated Latin.

## Hashes

- en: `4337253270df03ec0ad4bf00bd27db4f4e8d279376f0dfe5be230fb1d897d01a`
- hi: `55f3cf950b5e57bf216f58fabdff0ee73e12e356b346137fcd2882b884ed4ebf`
- context sidecar: `3c204399befa0116d1b72c6e2cc0905fab61389d18fedfca72a7fddb4b813c8f`

## Findings

- **MINOR** `ui.teamBridge.members.role.owner` — Owner is «स्वामी» here and in members.agent_invitation and members.invitation_note, while this same file renders the same owner concept as «मालिक» (ui.teamBridge.thread.intro_chief: «…यह इसका मालिक तय करता है») and five other hi catalogues use «मालिक» for organization and installation owners. «स्वामी» also carries the husband/lord sense in Hindi product register. Meaning survives, so MINOR not MAJOR — it is the one term I would change. Proposed in all three sites: role.owner «मालिक»; agent_invitation «एजेंट; मालिक की स्वीकृति के बाद म्यूट होकर जुड़ता है»; invitation_note «आमंत्रण सक्रिय पहुँच नहीं देते। एजेंट केवल अपने मालिक की सहमति के बाद म्यूट होकर जुड़ता है।»
- **NIT** `ui.teamBridge.members.human_invitation` — «आमंत्रण स्वीकारने के बाद» splits the verb differently from this file's established «स्वीकार करने पर» (ui.teamBridge.invitations.consent.*). Both are grammatical; matching the file reads better. Proposed: «व्यक्ति; आमंत्रण स्वीकार करने के बाद जुड़ता है».

## Source-side gate (blocks merge, not this locale's copy)

`scripts/i18n/context-parity.mjs` exits 1: 15 of the 28 English keys have no
`.context.json` entry and no `i18n/context-allowance.json` entry, so those strings were translated
blind. Authoring the sidecar entries fixes the gate; the translated bytes do not change, so no re-audit
of the copy is implied.

Uncovered: `menu`, `current`, `current_empty`, `invite`, `search`, `empty`, `no_matches`, `load_error`, `removing`, `read_only`, `role.owner`, `role.member`, `state.active`, `state.left`, `mutation_error`

## Not claimed

Source-only audit: no test, build, Storybook, browser or rendered-frame run. No width, activation or
release approval.
