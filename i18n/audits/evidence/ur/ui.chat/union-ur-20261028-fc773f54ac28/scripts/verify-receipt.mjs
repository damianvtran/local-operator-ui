#!/usr/bin/env node
/**
 * Contract check for the union receipt: feed its bytes to the repository's own
 * ledger-rules.deriveReceiptAudit with the en/ur hashes of the files on disk.
 * This does NOT write a ledger row and does not run ledger-assemble.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { deriveReceiptAudit } from "../scripts/i18n/ledger-rules.mjs";

const receiptPath = process.argv[2];
const repo = process.argv[3] ?? ".";
const locale = process.argv[4] ?? "ur";
const namespace = process.argv[5] ?? "ui.chat";
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const sourceHash = sha(resolve(repo, "src/i18n/catalogues/en/ui.chat.json"));
const targetHash = sha(resolve(repo, `src/i18n/catalogues/${locale}/ui.chat.json`));

try {
	const derived = deriveReceiptAudit(readFileSync(receiptPath), {
		locale,
		namespace,
		sourceHash,
		targetHash,
	});
	console.log("ACCEPTED by ledger-rules.deriveReceiptAudit:");
	console.log(JSON.stringify(derived, null, 1));
} catch (error) {
	console.log(`REFUSED: ${error.name}: ${error.message}`);
	process.exit(1);
}
