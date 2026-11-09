/** Read-only check that the receipt this run wrote is one the ledger gate can
 * derive: deriveReceiptAudit(bytes, {locale, namespace, sourceHash, targetHash})
 * is the same function scripts/i18n/ledger-check.mjs calls. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deriveReceiptAudit, receiptIdentity, countFindings } from "../../../../../../scripts/i18n/ledger-rules.mjs";

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const RECEIPT = "i18n/receipts/ur-upload-r1-74af897140ba.json";
const bytes = readFileSync(RECEIPT);
const derived = deriveReceiptAudit(bytes, {
	locale: "ur",
	namespace: "ui.agents.upload",
	sourceHash: sha("src/i18n/catalogues/en/ui.agents.upload.json"),
	targetHash: sha("src/i18n/catalogues/ur/ui.agents.upload.json"),
});
console.log(JSON.stringify({ derived, identity: receiptIdentity(JSON.parse(bytes.toString("utf8"))) }, null, 1));
