import { createHash } from "node:crypto";
import fs from "node:fs";
import { deriveReceiptAudit } from "/Users/damian/local-operator-ui/.worktrees/i18n-agents-literals-2/scripts/i18n/ledger-rules.mjs";

const RECEIPT = "/Users/damian/local-operator-ui/.worktrees/i18n-agents-literals-2/i18n/receipts/hi-agents-literals-audit-c512d3228b7f.json";
const NS = ["ui.agents.pages","ui.agents.config","ui.agents.detail","ui.agents.upload","ui.hub.pages","ui.hub.teams","ui.common.actions"];
const sha = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const bytes = fs.readFileSync(RECEIPT);
let bad = 0;
for (const ns of NS) {
  try {
    const d = deriveReceiptAudit(bytes, {
      locale: "hi",
      namespace: ns,
      sourceHash: sha(`/Users/damian/local-operator-ui/.worktrees/i18n-agents-literals-2/src/i18n/catalogues/en/${ns}.json`),
      targetHash: sha(`/Users/damian/local-operator-ui/.worktrees/i18n-agents-literals-2/src/i18n/catalogues/hi/${ns}.json`),
    });
    console.log(`${ns.padEnd(18)} OK  agent=${d.agent} instance=${d.instance} model=${d.model} result=${d.result} findings=b${d.findings.blocker}/maj${d.findings.major}/min${d.findings.minor}/n${d.findings.nit} receipt_sha256=${d.receipt_sha256.slice(0,12)}`);
  } catch (e) {
    bad++;
    console.log(`${ns.padEnd(18)} REFUSED: ${e.message}`);
  }
}
console.log(bad ? `FAIL (${bad})` : "deriveReceiptAudit accepted all 7 namespaces");
process.exit(bad ? 1 : 0);
