// Validate the s16f-au3-ur receipt with the repo's OWN rules module — the same
// code ledger-assemble.mjs uses — so the integrator is not the first to learn the
// receipt is malformed. Read-only: nothing is written, no ledger row is produced.
import { readFileSync } from "node:fs";
import {
	deriveReceiptAudit,
	resultSupportedBy,
	countFindings,
} from "/Users/damian/local-operator-ui/scripts/i18n/ledger-rules.mjs";

const receiptPath = `${process.env.HOME}/.local-operator/scratchpad/s16f-au3-ur/receipt.json`;
const bytes = readFileSync(receiptPath);

const derived = deriveReceiptAudit(bytes, {
	locale: "ur",
	namespace: "ui.chat.canonical",
	sourceHash: "905fb4d86bab02148e90dea09a1e7d74c628fcdeb3f40f49126b21f491a8d28e",
	targetHash: "fd1116ccb5e847eb7f28c4cf5d1084efad95edf52d638d1a6144e065ce7d98a7",
});
console.log("derived audit entry:", JSON.stringify(derived, null, 1));
const receipt = JSON.parse(bytes.toString("utf8"));
const counted = countFindings(receipt.findings ?? []);
console.log("countFindings:", JSON.stringify(counted));
console.log(
	"resultSupportedBy(receipt.status, counts) =",
	resultSupportedBy(receipt.status, counted.counts),
);
