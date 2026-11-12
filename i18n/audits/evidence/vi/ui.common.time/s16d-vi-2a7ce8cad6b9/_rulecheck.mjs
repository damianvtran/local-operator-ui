
import { readFileSync } from "node:fs";
import { deriveReceiptAudit } from "/Users/damian/local-operator-ui/.worktrees/i18n-s16d/scripts/i18n/ledger-rules.mjs";
const bytes = readFileSync("/Users/damian/.local-operator/sessions/2a7ce8cad6b9/scratchpad/receipt-s16d-vi.json");
const tryIt = (targetHash, label) => {
  try {
    const d = deriveReceiptAudit(bytes, {
      locale: "vi", namespace: "ui.common.time",
      sourceHash: "bb0b3aa1a71679cc73cb40d73616b5e22057c7dcbc86705c2ec4425984971e13",
      targetHash,
    });
    console.log(label, "ACCEPTED", JSON.stringify({instance: d.instance, model: d.model, result: d.result, findings: d.findings}));
  } catch (e) { console.log(label, "REFUSED:", e.message); }
};
tryIt("f87b908a4add8d24d3f52e8663b3f9198a20d77d93f6817ec413375d62a7b4fb", "predicted-landed-target:");
tryIt("c0bed5df041a72992031e574f0f3a59cd29608a4c6dd13cb1d41186e05d1b60a", "pre-landing-target:  ");
tryIt("0000000000000000000000000000000000000000000000000000000000000000", "wrong-target:        ");
