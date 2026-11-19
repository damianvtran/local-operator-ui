// Prove the receipt is bindable by the repo's own rules: derive each namespace's
// audit exactly as ledger-check.mjs/ledger-assemble.mjs do, from the bytes on disk.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deriveReceiptAudit } from "../scripts/i18n/ledger-rules.mjs";

const NSS = ["ui.chat", "ui.chat.header", "ui.chat.response_actions", "ui.chat.sidebar"];
const receiptPath = "i18n/receipts/wa-a81c00c-20261027-hi.json";
const bytes = readFileSync(receiptPath);
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const out = { receipt: receiptPath, receipt_sha256: sha(receiptPath), derived: {} };
for (const ns of NSS) {
  const sourceHash = sha(`src/i18n/catalogues/en/${ns}.json`);
  const targetHash = sha(`src/i18n/catalogues/hi/${ns}.json`);
  try {
    out.derived[ns] = deriveReceiptAudit(bytes, { locale: "hi", namespace: ns, sourceHash, targetHash });
  } catch (error) {
    out.derived[ns] = { error: error.message };
  }
}
console.log(JSON.stringify(out, null, 1));
