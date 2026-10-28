/**
 * Independent re-check of the shipped receipt against the committed bytes, using
 * the repo's OWN derivation (`deriveReceiptAudit`), not a re-implementation:
 * the coordinator's first act is ledger-assemble -> ledger-check, and this makes
 * a refusal there impossible to discover late.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { deriveReceiptAudit, sha256Hex } from "../scripts/i18n/ledger-rules.mjs";

const HEAD = "a5356ce91c4f37bf4c4d1c4518070e3a9b2505cb";
const RECEIPT = "/Users/damian/qa/wave-b-delta-fr-deliver/i18n/receipts/c3a8965266e3.json";
const NAMESPACES = [
	"ui.chat.device",
	"ui.chat.pickers",
	"ui.chat.canonical",
	"ui.chat",
	"ui.chat.status",
	"ui.chat.run_details",
	"ui.common.connection",
	"ui.common.layout",
	"ui.agents.config",
];
const bytes = readFileSync(RECEIPT);
const out = [];
for (const namespace of NAMESPACES) {
	const file = (locale) =>
		execFileSync("git", ["-C", "/Users/damian/local-operator-ui", "show", `${HEAD}:src/i18n/catalogues/${locale}/${namespace}.json`]);
	const derived = deriveReceiptAudit(bytes, {
		locale: "fr",
		namespace,
		sourceHash: sha256Hex(file("en")),
		targetHash: sha256Hex(file("fr")),
	});
	out.push({ namespace, ...derived, receipt_sha256: derived.receipt_sha256.slice(0, 12) + "…" });
}
console.log(JSON.stringify({ receipt: RECEIPT, sha256: createHash("sha256").update(bytes).digest("hex"), derived: out }, null, 1));
