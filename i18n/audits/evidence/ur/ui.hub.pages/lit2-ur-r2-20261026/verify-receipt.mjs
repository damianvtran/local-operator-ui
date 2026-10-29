/**
 * Verify the round-2 ur receipt with the repository's OWN derivation rules.
 *
 * Calls `deriveReceiptAudit` from scripts/i18n/ledger-rules.mjs — the same
 * function `ledger-check.mjs` and `ledger-assemble.mjs` use — for all seven ur
 * namespaces, supplying the English and target sha256 read from the files on
 * disk. A refused receipt throws ReceiptRefusal; the script exits non-zero and
 * prints the refusal. Read-only: nothing is written.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = process.cwd();
const { deriveReceiptAudit } = await import(
	pathToFileURL(path.join(ROOT, "scripts/i18n/ledger-rules.mjs"))
);
const RECEIPT = "i18n/receipts/ur-agents-literals-audit-r2-d959bfda62d5.json";
const bytes = readFileSync(path.join(ROOT, RECEIPT));
const sha = (p) => createHash("sha256").update(readFileSync(path.join(ROOT, p))).digest("hex");

const NS = [
	"ui.agents.config",
	"ui.agents.detail",
	"ui.agents.pages",
	"ui.agents.upload",
	"ui.common.actions",
	"ui.hub.pages",
	"ui.hub.teams",
];

let failed = 0;
for (const namespace of NS) {
	const sourceHash = sha(`src/i18n/catalogues/en/${namespace}.json`);
	const targetHash = sha(`src/i18n/catalogues/ur/${namespace}.json`);
	try {
		const audit = deriveReceiptAudit(bytes, { locale: "ur", namespace, sourceHash, targetHash });
		const ok =
			audit.result === "clean" &&
			audit.agent === "i18n-auditor" &&
			audit.instance === "d959bfda62d5" &&
			audit.model === "radient/auto" &&
			["blocker", "major", "minor", "nit"].every((k) => audit.findings[k] === 0) &&
			audit.source_sha256 === sourceHash &&
			audit.target_sha256 === targetHash;
		console.log(
			`${ok ? "PASS" : "FAIL"} ${namespace}: agent=${audit.agent} instance=${audit.instance} model=${audit.model} result=${audit.result} findings=${JSON.stringify(audit.findings)} receipt_sha256=${audit.receipt_sha256}`,
		);
		if (!ok) failed++;
	} catch (error) {
		failed++;
		console.log(`FAIL ${namespace}: ${error.name}: ${error.message}`);
	}
}
console.log(failed ? `FAILED — ${failed} namespace(s)` : "PASS — all 7 namespaces derive a clean audit");
process.exit(failed ? 1 : 0);
