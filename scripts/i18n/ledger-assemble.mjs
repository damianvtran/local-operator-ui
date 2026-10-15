#!/usr/bin/env node
/**
 * The ledger WRITER: derive a row of `i18n/ledger.json` from the files on disk and
 * one auditor's receipt, instead of anyone hand-editing hashes.
 *
 * WHY THIS EXISTS. `ledger-check.mjs` is read-only: it can refuse a stale or
 * unaudited locale but nothing could produce a correct row. With one locale-
 * shipping PR per language (es, ru, vi, hi, zh-CN, ur) each hand-copying two
 * sha256 values and an audit verdict, a transcription slip is a certainty and a
 * wrongly-promoted status is a real risk. This tool removes the human from the
 * parts a machine can derive, and refuses the parts it cannot support.
 *
 * WHAT IT DERIVES (never accepts from the operator):
 *   - `source_sha256` = sha256 of the ENGLISH catalogue on disk;
 *   - `target_sha256` = sha256 of the locale catalogue on disk;
 *   - the audit's severity counts, from the receipt's findings;
 *   - `receipt_sha256`, from the receipt's own bytes;
 *   - the row's `status`, from the auditors (see `supportedStatus`): it is never
 *     a flag, so a `changes_requested` receipt cannot be made `audited`.
 *
 * WHAT IT REFUSES (exit 2, nothing written):
 *   - a receipt that does not exist or is not JSON;
 *   - a receipt whose `instance` is missing, a placeholder (`scratchpad`...), or
 *     different from `--auditor-instance` (the receipt must be the audit it
 *     claims to be);
 *   - a receipt that does not NAME the bytes on disk: both the target and the
 *     English sha256 must appear in it, so an audit of an older file cannot back
 *     a newer one (the staleness rule `ledger-check` also enforces);
 *   - a `--result` the receipt does not support: the receipt's own status and
 *     severity counts decide it (any blocker/major => `changes_requested`; only
 *     minor/nit => `clean-with-findings`; nothing => `clean`);
 *   - a second audit that reuses an `instance` already on the row (one audit run
 *     is one audit; re-running the same command with the same instance REPLACES
 *     that entry, it does not duplicate it);
 *   - a locale file whose key set differs from English.
 *
 * WHAT IT DOES TO EXISTING ROWS. If the file on disk has changed since the row's
 * recorded hashes, the audits on the row described OLDER bytes: they are moved to
 * `superseded` (kept as history, never counted) and the row restarts from the new
 * audit. That is the ledger's standing rule - a namespace edit after its audit
 * flips its row to pending until re-audited - made mechanical.
 *
 * RECEIPT CONTRACT (what an auditor writes; `ledger-assemble.test.mjs` pins it):
 *   { "auditor": "i18n-auditor", "model": "<actual model>", "instance": "<run id>",
 *     "status": "passed" | "changes_requested",
 *     "namespace": "ui.console", "sha256": { "fr": "<hex>", "en": "<hex>" },
 *     "findings": [ { "severity": "MINOR", "key": "ui.x.y", ... } ] }
 *   Severity may be spelled `severity` or `sev`; `findings` may also be an object
 *   keyed by severity whose values are arrays. A receipt covering several
 *   namespaces puts them under `namespaces.<ns>` (each with its own status and
 *   role-labelled source/target hashes). Findings may live in each block or in a
 *   receipt-wide list whose keys name their namespace. Identity/model aliases
 *   must agree; no missing auditor identity is invented. `INFO` is not counted.
 *
 * Receipts are copied byte-for-byte into i18n/receipts/<instance>.json. The gate
 * requires that portable evidence and re-hashes it; there is no machine-local
 * legacy allowance. Neither tool can prove who authored the receipt.
 *
 * USAGE:
 *   node scripts/i18n/ledger-assemble.mjs --locale fr \
 *     --file src/i18n/catalogues/fr/ui.console.json \
 *     --auditor-instance 5091a70eeedc --auditor-model anthropic/claude-sonnet-5-5 \
 *     --result clean-with-findings --receipt ~/path/to/receipt.json \
 *     [--translator-agent i18n-translator --translator-model <m>]  # required for a NEW row
 *     [--scope "<what was audited>"] [--note "<=280 chars"] [--date YYYY-MM-DD] [--repo <root>]
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ALL_RESULTS,
	RECEIPTS_DIR,
	ReceiptRefusal as Refusal,
	SEVERITIES,
	compareReceiptAudit,
	deriveReceiptAudit,
	isPlaceholderInstance,
	isRepoReceiptPath,
	sha256Hex,
	supportedStatus,
	validateAuditSet,
} from "./ledger-rules.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_LOCALE = "en";
const LEDGER_RELATIVE = join("i18n", "ledger.json");

/** A refusal: the tool understood the request and will not do it. Exit 2, no write. */
export { ReceiptRefusal as Refusal } from "./ledger-rules.mjs";

const refuse = (message) => {
	throw new Refusal(message);
};

export { receiptIdentity, resultSupportedBy } from "./ledger-rules.mjs";

function readJson(path, what) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return refuse(`${what} is not readable JSON: ${error.message}`);
	}
}

function expandHome(path) {
	return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/**
 * Assemble (or update) the row for one locale/namespace.
 *
 * Exported so the test drives it against synthetic trees; the CLI is a thin
 * wrapper. Returns what it wrote; throws `Refusal` and writes nothing otherwise.
 */
export function assemble(options) {
	const repo = options.repo ?? REPO;
	const cataloguesDir = join(repo, "src", "i18n", "catalogues");
	const ledgerPath = join(repo, LEDGER_RELATIVE);

	/* ---- the catalogue: where it is, what it is, whether it is complete ---- */
	const fileAbsolute = resolve(repo, options.file ?? "");
	const underCatalogues = relative(cataloguesDir, fileAbsolute).split(sep);
	if (underCatalogues.length !== 2 || underCatalogues[0].startsWith("..")) {
		refuse(
			`--file must be src/i18n/catalogues/<locale>/<namespace>.json (got ${options.file})`,
		);
	}
	const [locale, fileName] = underCatalogues;
	const namespace = basename(fileName, ".json");
	if (!fileName.endsWith(".json") || fileName.endsWith(".context.json")) {
		refuse(`--file must be a message catalogue, not ${fileName}`);
	}
	if (locale === SOURCE_LOCALE) refuse("the source locale needs no ledger row");
	if (options.locale && options.locale !== locale) {
		refuse(
			`--locale ${options.locale} does not match the file's locale directory (${locale})`,
		);
	}
	const sourceFile = join(cataloguesDir, SOURCE_LOCALE, fileName);
	if (!existsSync(fileAbsolute)) refuse(`${options.file} does not exist`);
	if (!existsSync(sourceFile)) refuse(`no English source for ${namespace}`);

	const sourceBytes = readFileSync(sourceFile);
	const targetBytes = readFileSync(fileAbsolute);
	const sourceKeys = Object.keys(
		JSON.parse(sourceBytes.toString("utf8")),
	).sort();
	const targetKeys = Object.keys(readJson(fileAbsolute, fileName)).sort();
	const missing = sourceKeys.filter((key) => !targetKeys.includes(key));
	const extra = targetKeys.filter((key) => !sourceKeys.includes(key));
	if (missing.length || extra.length) {
		refuse(
			`${locale}/${namespace} is not key-complete against English (${missing.length} missing, ${extra.length} extra) - an incomplete locale cannot be recorded`,
		);
	}
	const source_sha256 = sha256Hex(sourceBytes);
	const target_sha256 = sha256Hex(targetBytes);

	/* ---- the request ---- */
	if (!ALL_RESULTS.has(options.result)) {
		refuse(
			`--result must be one of ${[...ALL_RESULTS].join(" | ")} (got ${JSON.stringify(options.result)})`,
		);
	}
	if (isPlaceholderInstance(options.auditorInstance)) {
		refuse(
			`--auditor-instance ${JSON.stringify(options.auditorInstance)} is missing or a placeholder`,
		);
	}
	if (!options.auditorModel) refuse("--auditor-model is required");

	/* ---- the receipt: exists, is the audit it claims, names these bytes ---- */
	if (!options.receipt) refuse("--receipt is required");
	const receiptAbsolute = resolve(repo, expandHome(options.receipt));
	if (!existsSync(receiptAbsolute))
		refuse(`receipt ${options.receipt} does not exist`);
	const receiptBytes = readFileSync(receiptAbsolute);
	const derived = deriveReceiptAudit(receiptBytes, {
		locale,
		namespace,
		sourceHash: source_sha256,
		targetHash: target_sha256,
	});
	const identity = derived;
	if (identity.instance !== options.auditorInstance)
		refuse(
			`the receipt is instance ${JSON.stringify(identity.instance)}, not the --auditor-instance ${JSON.stringify(options.auditorInstance)}`,
		);
	if (identity.model !== options.auditorModel)
		refuse(
			`the receipt names model ${JSON.stringify(identity.model)}, not --auditor-model ${JSON.stringify(options.auditorModel)}`,
		);
	const counts = derived.findings;
	const supported = derived.result;
	if (options.result !== supported)
		refuse(
			`--result ${options.result} is not supported by the receipt (${SEVERITIES.map((s) => `${counts[s]} ${s}`).join(", ")}): it supports ${supported}`,
		);

	/* ---- the row ---- */
	const ledger = existsSync(ledgerPath)
		? readJson(ledgerPath, "the ledger")
		: { schema: 1, entries: [] };
	if (!Array.isArray(ledger.entries))
		refuse("the ledger has no `entries` array");
	// One run may cover several namespaces, but never two different receipts.
	// Check ledger history too: a missing receipt copy must not bypass collisions.
	for (const entry of ledger.entries) {
		const recorded = [
			...(entry.auditors ?? []),
			...(entry.superseded ?? []).flatMap((old) => old.auditors ?? []),
		];
		if (
			recorded.some(
				(audit) =>
					audit.instance === options.auditorInstance &&
					audit.receipt_sha256 !== sha256Hex(receiptBytes),
			)
		) {
			refuse(
				`instance ${options.auditorInstance} is already recorded on ${entry.locale}/${entry.namespace} with a different receipt`,
			);
		}
	}
	let row = ledger.entries.find(
		(entry) => entry.locale === locale && entry.namespace === namespace,
	);
	// An idempotent write must not launder forged row claims back into valid
	// evidence. Verify existing audits against their own immutable receipts before
	// replacing anything. Stale rows bind their old hashes and are then archived.
	for (const recorded of row?.auditors ?? []) {
		if (!isRepoReceiptPath(recorded.receipt))
			refuse("existing audit has no portable receipt");
		const path = join(repo, recorded.receipt);
		if (!existsSync(path)) refuse("existing audit receipt is missing");
		const bytes = readFileSync(path);
		if (sha256Hex(bytes) !== recorded.receipt_sha256)
			refuse("receipt already exists with different content");
		const evidence = deriveReceiptAudit(bytes, {
			locale,
			namespace,
			sourceHash: row.source_sha256,
			targetHash: row.target_sha256,
		});
		const mismatches = compareReceiptAudit(recorded, evidence);
		if (mismatches.length)
			refuse(`existing audit ${recorded.instance}: ${mismatches.join("; ")}`);
	}
	if (
		row &&
		row.status !==
			supportedStatus(
				row.auditors,
				row.translator?.agent,
				`${locale}/${namespace}`,
			)
	) {
		refuse("existing row status contradicts its receipt-backed audits");
	}
	const stale =
		row &&
		(row.source_sha256 !== source_sha256 ||
			row.target_sha256 !== target_sha256);

	if (!row) {
		if (!options.translatorAgent?.trim() || !options.translatorModel?.trim()) {
			refuse(
				`no row for ${locale}/${namespace} yet: --translator-agent (and --translator-model) are required to create one`,
			);
		}
		row = {
			locale,
			namespace,
			source_sha256,
			target_sha256,
			translator: {
				agent: options.translatorAgent,
				...(options.translatorModel ? { model: options.translatorModel } : {}),
				date: options.date,
			},
			auditors: [],
			status: "pending",
		};
		ledger.entries.push(row);
	} else if (stale) {
		row.superseded = [
			...(row.superseded ?? []),
			{
				source_sha256: row.source_sha256,
				target_sha256: row.target_sha256,
				auditors: row.auditors,
				status: row.status,
			},
		];
		row.auditors = [];
		row.source_sha256 = source_sha256;
		row.target_sha256 = target_sha256;
		row.status = "pending";
	}

	/*
	 * Keep the evidence IN the repo: copy the receipt to i18n/receipts/<instance>.json
	 * so the gate can re-hash it from any clone. Receipts are immutable evidence: if
	 * a different file already sits at that name the tool REFUSES rather than
	 * overwrite it, because replacing a receipt under an existing row would let a
	 * verdict be rewritten after the fact.
	 */
	const receiptRelative = join(RECEIPTS_DIR, `${options.auditorInstance}.json`);
	const receiptCopy = join(repo, receiptRelative);
	if (
		existsSync(receiptCopy) &&
		sha256Hex(readFileSync(receiptCopy)) !== sha256Hex(receiptBytes)
	) {
		refuse(
			`${receiptRelative} already exists with different content - a receipt is immutable evidence and is never overwritten`,
		);
	}

	const audit = {
		agent: derived.agent,
		model: options.auditorModel,
		date: options.date,
		result: options.result,
		instance: options.auditorInstance,
		findings: counts,
		receipt: receiptRelative,
		receipt_sha256: sha256Hex(receiptBytes),
		...(options.scope ? { scope: options.scope } : {}),
		...(options.note ? { note: options.note } : {}),
	};
	/*
	 * ONE INSTANCE IS ONE AUDIT RUN. Re-running this command with the SAME receipt
	 * is idempotent (the entry is replaced by an identical one). A DIFFERENT
	 * receipt claiming an instance already on the row is the failure the
	 * distinct-instance rule exists for - two audits passed off as two runs, or a
	 * verdict rewritten under an old id - so it is refused, not merged.
	 */
	const existing = row.auditors.findIndex((a) => a.instance === audit.instance);
	if (existing >= 0) {
		if (row.auditors[existing].receipt_sha256 !== audit.receipt_sha256) {
			refuse(
				`instance ${audit.instance} is already recorded on ${locale}/${namespace} with a different receipt - one run is one audit; a second audit needs its own instance`,
			);
		}
		row.auditors[existing] = { ...row.auditors[existing], ...audit };
	} else {
		row.auditors.push(audit);
	}

	const where = `${locale}/${namespace}`;
	const set = validateAuditSet(row.auditors, row.translator?.agent, where);
	// `supportedStatus` never reports `audited` for an invalid set or any
	// non-passing audit, so the status written is only ever what the auditors
	// support. Any set failure is surfaced to the operator as a note.
	row.status = supportedStatus(row.auditors, row.translator?.agent, where);

	/* ---- atomic write: temp file in the same directory, then rename ---- */
	mkdirSync(dirname(ledgerPath), { recursive: true });
	const temporary = `${ledgerPath}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(ledger, null, "\t")}\n`);
	if (!existsSync(receiptCopy)) {
		mkdirSync(dirname(receiptCopy), { recursive: true });
		const receiptTemporary = `${receiptCopy}.${process.pid}.tmp`;
		writeFileSync(receiptTemporary, receiptBytes);
		renameSync(receiptTemporary, receiptCopy);
	}
	renameSync(temporary, ledgerPath);

	return {
		where,
		status: row.status,
		audit,
		stale: Boolean(stale),
		setFailures: set,
	};
}

function parseArgs(argv) {
	const flags = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith("--")) refuse(`unexpected argument ${arg}`);
		const name = arg.slice(2);
		const value = argv[i + 1];
		if (value === undefined || value.startsWith("--"))
			refuse(`--${name} needs a value`);
		flags[name] = value;
		i += 1;
	}
	return flags;
}

export function main(argv) {
	if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
		process.stdout.write(
			"usage: node scripts/i18n/ledger-assemble.mjs --locale <l> --file <catalogue.json> \\\n" +
				"  --auditor-instance <id> --auditor-model <m> --result <clean|clean-with-findings|changes_requested> \\\n" +
				"  --receipt <path> [--translator-agent <a> --translator-model <m>] [--scope <s>] [--note <n>] [--date YYYY-MM-DD] [--repo <root>]\n\n" +
				"Derives the row's hashes and status from disk and the receipt; refuses what the receipt does not support.\n",
		);
		return argv.length === 0 ? 2 : 0;
	}
	try {
		const flags = parseArgs(argv);
		const result = assemble({
			repo: flags.repo ? resolve(flags.repo) : undefined,
			locale: flags.locale,
			file: flags.file,
			auditorInstance: flags["auditor-instance"],
			auditorModel: flags["auditor-model"],
			result: flags.result,
			receipt: flags.receipt,
			translatorAgent: flags["translator-agent"],
			translatorModel: flags["translator-model"],
			scope: flags.scope,
			note: flags.note,
			date: flags.date ?? new Date().toISOString().slice(0, 10),
		});
		process.stdout.write(
			`ledger-assemble: ${result.where} -> status ${result.status}` +
				`${result.stale ? " (prior audits were of older bytes: moved to superseded)" : ""}` +
				` | ${result.audit.result}, ${SEVERITIES.map((s) => `${result.audit.findings[s]} ${s}`).join(", ")}\n`,
		);
		for (const failure of result.setFailures)
			process.stderr.write(`ledger-assemble: note: ${failure}\n`);
		return 0;
	} catch (error) {
		if (error instanceof Refusal) {
			process.stderr.write(`ledger-assemble: refused - ${error.message}\n`);
			return 2;
		}
		throw error;
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	process.exit(main(process.argv.slice(2)));
}
