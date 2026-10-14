/**
 * The audit-ledger rules, in ONE place, shared by the gate and the assembler.
 *
 * WHY THIS IS A MODULE. `ledger-check.mjs` (read-only gate) and
 * `ledger-assemble.mjs` (the writer) must agree on what a valid audit is. If each
 * carried its own copy of "which results pass" or "what counts as a placeholder
 * instance", the writer could produce a row the gate then refuses, or - worse -
 * the gate could be loosened without the writer noticing. Both import this file,
 * so there is one definition and one test target.
 *
 * WHAT A ROW'S AUDITOR ENTRY MEANS (see `validateAuditorEntry`):
 *
 *  - `result` is one of `clean` | `clean-with-findings` | `changes_requested`.
 *    Only the first two PASS. `changes_requested` is recorded honestly but can
 *    never back `status: "audited"`.
 *  - `findings` carries SEVERITY COUNTS `{blocker, major, minor, nit}`. The
 *    labels and counts must match what the gate derives from the immutable
 *    namespace-scoped receipt, not merely agree with each other. A passing audit
 *    must record `blocker: 0` and
 *    `major: 0`. `clean-with-findings` is therefore exactly "only minors/nits,
 *    recorded rather than churned" - and the gate can tell, instead of trusting
 *    the label (the reviewer's M1/M2 on #1041: a MAJOR-bearing last audit
 *    labelled `clean-with-findings` used to pass).
 *
 *    Why not require a plain `clean` as the LAST audit instead: the programme's
 *    own outcome for "no blocker or major; minors and nits recorded, not
 *    churned" is `clean-with-findings`, so that rule would fail honest rows for
 *    no defect, and it would still be a label rather than a measurement. The
 *    counts are the measurement.
 *  - `instance` is the audit run's own id (the 12-hex session id). It must be a
 *    real id, not a placeholder: a receipt that names itself "scratchpad" (the
 *    directory it happened to be written into) evidences nothing, and the
 *    distinct-instance rule only means something if the ids are real.
 *  - `receipt_sha256` is the sha256 of the receipt file the audit wrote, so a
 *    row records WHAT it was derived from. `receipt` is the path; a repo-relative
 *    path under `i18n/receipts/` is required and verified by the gate so the file
 *    travels with the repo. Machine-local pointers are refused, not grandfathered.
 */

import { createHash } from "node:crypto";

/** Results that count as a pass. `changes_requested` is deliberately absent. */
export const PASSING_RESULTS = new Set(["clean", "clean-with-findings"]);

/** Every result an auditor may record. */
export const ALL_RESULTS = new Set([...PASSING_RESULTS, "changes_requested"]);

/** The severities a finding may carry, in descending order. */
export const SEVERITIES = ["blocker", "major", "minor", "nit"];

/**
 * Instance values that are not run ids. Lower-case compare. A real instance is
 * the session id of the audit run (12 hex chars in this harness); the test
 * fixtures use `audit-run-a` style ids, so the rule is a denylist plus a floor
 * on length, not a hex pattern.
 */
const PLACEHOLDER_INSTANCES = new Set([
	"scratchpad",
	"session",
	"instance",
	"unknown",
	"none",
	"null",
	"undefined",
	"todo",
	"tbd",
	"test",
	"placeholder",
	"n/a",
	"na",
]);

const MIN_INSTANCE_LENGTH = 6;

/** True when `value` is not an id an audit run could have: empty, too short, or a stock word. */
export function isPlaceholderInstance(value) {
	if (typeof value !== "string") return true;
	const trimmed = value.trim().toLowerCase();
	return (
		trimmed.length < MIN_INSTANCE_LENGTH ||
		!/^[a-z0-9_-]+$/.test(value) ||
		PLACEHOLDER_INSTANCES.has(trimmed)
	);
}

export function sha256Hex(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

const HEX64 = /^[0-9a-f]{64}$/;
export const isSha256 = (value) =>
	typeof value === "string" && HEX64.test(value);

/**
 * Normalise a severity word from a receipt (`BLOCKER`, `Major`, `sev: "MINOR"`)
 * to the ledger vocabulary, or null when it names none.
 */
export function normaliseSeverity(word) {
	if (typeof word !== "string") return null;
	const lowered = word.trim().toLowerCase();
	return SEVERITIES.includes(lowered) ? lowered : null;
}

/** Receipts record verified-OK remarks as `INFO`: an observation, not a defect. */
const OBSERVATION_WORDS = new Set(["info", "ok", "note", "observation"]);

/**
 * Count a receipt's findings by severity.
 *
 * Receipts are written by independent auditors and have grown two spellings of
 * the severity key (`severity`, `sev`), so both are read. A finding with no
 * recognisable severity is an ERROR, not a zero: silently dropping it would let a
 * MAJOR hide behind a typo.
 *
 * @returns {{ counts: {blocker:number,major:number,minor:number,nit:number}, errors: string[] }}
 */
export function countFindings(findings) {
	const counts = { blocker: 0, major: 0, minor: 0, nit: 0 };
	const errors = [];
	for (const [position, finding] of findings.entries()) {
		if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
			errors.push(`finding ${position + 1} is malformed`);
			continue;
		}
		if (
			finding.severity !== undefined &&
			finding.sev !== undefined &&
			String(finding.severity).trim().toLowerCase() !==
				String(finding.sev).trim().toLowerCase()
		) {
			errors.push(`finding ${position + 1} has conflicting severity fields`);
			continue;
		}
		const word = finding?.severity ?? finding?.sev;
		if (
			typeof word === "string" &&
			OBSERVATION_WORDS.has(word.trim().toLowerCase())
		) {
			continue;
		}
		const severity = normaliseSeverity(word);
		if (!severity) {
			errors.push(
				`finding ${position + 1} has no recognisable severity (blocker/major/minor/nit)`,
			);
			continue;
		}
		counts[severity] += 1;
	}
	return { counts, errors };
}

/**
 * Validate one auditor entry of a ledger row. Pure: returns failure strings
 * (prefixed by the caller's `where`) and touches no file, so the gate and the
 * assembler share it verbatim.
 *
 * @param {object} auditor  the row's auditor entry
 * @param {string} where    "locale/namespace" for messages
 * @param {string} label    "auditor N" for messages
 */
export function validateAuditorEntry(auditor, where, label) {
	const failures = [];
	const result = auditor?.result;
	if (!PASSING_RESULTS.has(result)) {
		failures.push(
			`${where}: ${label} result is ${JSON.stringify(result)}, not a passing result (${[...PASSING_RESULTS].join(" / ")}) - a failed or unrecorded audit cannot back an "audited" entry`,
		);
	}

	const findings = auditor?.findings;
	const countsOk =
		findings &&
		typeof findings === "object" &&
		SEVERITIES.every(
			(severity) =>
				Number.isInteger(findings[severity]) && findings[severity] >= 0,
		);
	if (!countsOk) {
		failures.push(
			`${where}: ${label} records no severity counts (findings: {blocker, major, minor, nit}) - the result label alone is self-attested`,
		);
	} else {
		if (PASSING_RESULTS.has(result)) {
			for (const severity of ["blocker", "major"]) {
				if (findings[severity] > 0) {
					failures.push(
						`${where}: ${label} is labelled ${JSON.stringify(result)} but records ${findings[severity]} ${severity.toUpperCase()} finding(s) - an unresolved blocker/major cannot back "audited"`,
					);
				}
			}
		}
		const total = SEVERITIES.reduce(
			(sum, severity) => sum + findings[severity],
			0,
		);
		// The label must agree with the counts in BOTH directions: a "clean" that
		// records findings, or a "clean-with-findings" that records none, is a label
		// that does not describe the audit it sits on.
		if (result === "clean-with-findings" && total === 0) {
			failures.push(
				`${where}: ${label} is "clean-with-findings" but records no findings - use "clean"`,
			);
		}
		if (result === "clean" && total > 0) {
			failures.push(
				`${where}: ${label} is "clean" but records ${total} finding(s) - use "clean-with-findings"`,
			);
		}
	}

	if (isPlaceholderInstance(auditor?.instance)) {
		failures.push(
			`${where}: ${label} has ${auditor?.instance ? `a placeholder \`instance\` (${JSON.stringify(auditor.instance)})` : "no `instance`"} - record the audit run's own id so distinct audits are evidenced`,
		);
	}

	if (!isRepoReceiptPath(auditor?.receipt)) {
		failures.push(
			`${where}: ${label} must name a verifiable receipt under ${RECEIPTS_DIR}/`,
		);
	}

	if (!isSha256(auditor?.receipt_sha256)) {
		failures.push(
			`${where}: ${label} records no \`receipt_sha256\` - the row must say which receipt it was derived from`,
		);
	}
	return failures;
}

/**
 * Repo-relative receipts live here; the gate re-hashes anything that does.
 * `ledger-assemble.mjs` copies each receipt in as `<instance>.json` so the
 * evidence travels with the repo (M3 on #1041: a machine-local receipt cannot be
 * re-opened from a clone). One file per audit run, named by its instance; a run
 * that covered two namespaces is one file referenced by two rows.
 */
export const RECEIPTS_DIR = "i18n/receipts";

/** A `receipt` value the gate can verify against the repo (not `~/...`, not absolute). */
export function isRepoReceiptPath(value) {
	return (
		typeof value === "string" &&
		/^i18n\/receipts\/[a-z0-9_-]+\.json$/.test(value)
	);
}

/**
 * The rules over a row's WHOLE auditor list: at least one auditor, at least one
 * independent of the translator by agent, every entry valid, and every `instance`
 * distinct. Shared so the assembler can decide a row's status with exactly the
 * rules the gate will later enforce on it.
 *
 * @returns {string[]} failure messages ([] = the set is valid)
 */
export function validateAuditSet(auditors, translatorAgent, where) {
	if (!Array.isArray(auditors) || auditors.length === 0) {
		return [`${where}: no auditor recorded`];
	}
	const failures = [];
	if (!auditors.some((a) => a?.agent && a.agent !== translatorAgent)) {
		failures.push(
			`${where}: every auditor is the translator's own agent - the audit must be independent`,
		);
	}
	for (const [position, auditor] of auditors.entries()) {
		failures.push(
			...validateAuditorEntry(auditor, where, `auditor ${position + 1}`),
		);
	}
	const seen = new Set();
	for (const auditor of auditors) {
		const instance =
			typeof auditor?.instance === "string" ? auditor.instance.trim() : "";
		if (instance === "") continue; // already reported as missing/placeholder
		if (seen.has(instance)) {
			failures.push(
				`${where}: two auditors share one \`instance\` (${JSON.stringify(instance)}) - a second audit must be a distinct run`,
			);
		}
		seen.add(instance);
	}
	return failures;
}

/**
 * The status a row's auditors SUPPORT - never more. `audited` needs a valid,
 * all-passing set; any recorded non-passing audit makes the row
 * `changes_requested`; no audit at all is `pending`. The assembler writes this
 * value and never an operator-supplied one, so a `changes_requested` receipt
 * cannot be turned into `audited` by a flag.
 */
export function supportedStatus(auditors, translatorAgent, where) {
	if (!Array.isArray(auditors) || auditors.length === 0) return "pending";
	if (auditors.some((a) => !PASSING_RESULTS.has(a?.result))) {
		return "changes_requested";
	}
	return validateAuditSet(auditors, translatorAgent, where).length === 0
		? "audited"
		: "pending";
}

/** Semantic receipt failures are shared by the writer and read-only gate. */
export class ReceiptRefusal extends Error {}
const receiptRefuse = (message) => {
	throw new ReceiptRefusal(message);
};

/** Flatten `findings` (array, or object keyed by severity) to an array of finding objects. */
function flattenFindings(findings) {
	if (Array.isArray(findings)) return findings;
	if (findings && typeof findings === "object") {
		const flat = [];
		if (Object.keys(findings).length === 0)
			receiptRefuse(
				"findings must be an explicit array or severity-keyed object",
			);
		for (const [severity, list] of Object.entries(findings)) {
			// Validate empty buckets too: a typo is not evidence of zero majors.
			if (countFindings([{ severity }]).errors.length || !Array.isArray(list)) {
				receiptRefuse(
					`findings.${severity} must name a recognised severity and contain an array`,
				);
			}
			for (const item of list) {
				if (!item || typeof item !== "object" || Array.isArray(item)) {
					receiptRefuse(`findings.${severity} contains a malformed finding`);
				}
				const word = item.severity ?? item.sev ?? severity;
				// A member cannot downgrade the severity of its enclosing bucket.
				if (
					String(word).trim().toLowerCase() !== severity.trim().toLowerCase()
				) {
					receiptRefuse(`findings.${severity} contains a conflicting severity`);
				}
				flat.push({ ...item, severity: word });
			}
		}
		return flat;
	}
	receiptRefuse("findings must be an explicit array or severity-keyed object");
}

/**
 * Resolve the part of a receipt that speaks about ONE namespace: its status and
 * its findings. See the receipt contract in the header.
 */
function receiptScope(receipt, namespace) {
	const names =
		receipt.namespaces && typeof receipt.namespaces === "object"
			? Object.keys(receipt.namespaces)
			: [];
	if (names.length > 0 && !names.includes(namespace)) {
		receiptRefuse(
			`the receipt covers ${names.join(", ")} but not ${namespace}`,
		);
	}
	const scoped = names.length > 0 ? receipt.namespaces[namespace] : undefined;
	const status = scoped?.status ?? receiptIdentity(receipt).status;

	// A namespace block that carries its OWN findings speaks for itself.
	if (scoped && scoped.findings !== undefined) {
		return { status, findings: flattenFindings(scoped.findings) };
	}

	// Otherwise the findings are the receipt's top-level ones. With no blocks
	// they belong to the explicit single namespace. With blocks they must be
	// attributed by key prefix, and a finding that names no namespace is REFUSED
	// rather than dropped: a dropped finding is a MAJOR that can hide.
	// ABSENT IS NOT ZERO. A receipt with no `findings` field at all (a narrow
	// addendum that points at an earlier full audit, say) says nothing about
	// severity; counting it as zero would turn silence into a `clean`. An explicit
	// empty array is the only way to record "no findings".
	if (receipt.findings === undefined || receipt.findings === null) {
		receiptRefuse(
			"the receipt has no `findings` field - absent is not zero; record an explicit `findings: []` (or the findings) so severity can be counted",
		);
	}
	const all = flattenFindings(receipt.findings);
	if (names.length === 0) return { status, findings: all };
	const mine = [];
	for (const finding of all) {
		const key = String(finding?.key ?? "");
		const owner = names.find((name) => key.startsWith(`${name}.`));
		if (!owner) {
			receiptRefuse(
				`a finding (${JSON.stringify(key.slice(0, 50))}) names no namespace of a multi-namespace receipt, so it cannot be attributed`,
			);
		}
		if (owner === namespace) mine.push(finding);
	}
	return { status, findings: mine };
}

/**
 * Read a receipt's identity and verdict from the shapes auditors actually write.
 *
 * Inspected against real receipts (the fr audits here and the es/ru/vi final
 * addenda of the locale-shipping lane), which differ:
 *   - instance: `instance`, or `auditor.instance`;
 *   - model:    `model`, or `auditor.model` / `auditor.actual_model`;
 *   - verdict:  `status` (`passed` | `changes_requested`), or `result`
 *               (`clean` | `clean-with-findings` | `changes_requested`).
 * Anything else resolves to undefined and is refused by the caller: a receipt this
 * tool cannot read is not guessed at.
 */
export function receiptIdentity(receipt) {
	const auditor =
		receipt.auditor && typeof receipt.auditor === "object"
			? receipt.auditor
			: {};
	const verdictWord = receipt.status ?? receipt.result;
	const status =
		verdictWord === "passed" || PASSING_RESULTS.has(verdictWord)
			? "passed"
			: verdictWord === "changes_requested"
				? "changes_requested"
				: undefined;
	return {
		instance: receipt.instance ?? auditor.instance,
		model: receipt.model ?? auditor.model ?? auditor.actual_model,
		status,
	};
}

/** The result a receipt supports: its counts and status decide, not the operator. */
export function resultSupportedBy(status, counts) {
	if (
		status === "changes_requested" ||
		counts.blocker > 0 ||
		counts.major > 0
	) {
		return "changes_requested";
	}
	return counts.minor + counts.nit > 0 ? "clean-with-findings" : "clean";
}

const JSON_RECEIPT_TOKENS = /"(?:\\.|[^"\\])*"|[{}\[\]:]/g;
const AUDITOR_AGENT = /^([a-zA-Z0-9_-]+)(?: \([\s\S]*\))?$/;

/** JSON.parse loses duplicate members before a reviver can see them. Scan only
 * the receipt's structural tokens (quoted braces stay inside string tokens) so
 * duplicate namespace, identity and hash members cannot choose a last winner.
 * This is not a second JSON parser: JSON.parse still owns syntax and values.
 */
export function parseReceipt(bytes) {
	let receipt;
	try {
		receipt = JSON.parse(bytes.toString("utf8"));
	} catch (error) {
		receiptRefuse(`the receipt is not readable JSON: ${error.message}`);
	}
	if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
		receiptRefuse("the receipt must be a JSON object");
	const tokens = bytes.toString("utf8").match(JSON_RECEIPT_TOKENS) ?? [];
	const stack = [];
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "{") stack.push(new Set());
		else if (token === "[") stack.push(null);
		else if (token === "}" || token === "]") stack.pop();
		else if (token.startsWith('"') && tokens[index + 1] === ":") {
			const key = JSON.parse(token);
			const keys = stack.at(-1);
			if (keys?.has(key))
				receiptRefuse(
					`the receipt contains duplicate member ${JSON.stringify(key)}`,
				);
			keys?.add(key);
		}
	}
	return receipt;
}

function unambiguous(label, values) {
	const named = values.filter((value) => value !== undefined);
	if (
		!named.length ||
		named.some((value) => typeof value !== "string" || !value.trim())
	)
		receiptRefuse(`the receipt has no valid ${label}`);
	if (new Set(named).size !== 1)
		receiptRefuse(`the receipt has ambiguous ${label}`);
	return named[0];
}

function auditorAgent(value) {
	if (value === undefined) return undefined;
	if (typeof value !== "string")
		receiptRefuse("the receipt has a malformed auditor agent");
	const match = value.match(AUDITOR_AGENT);
	if (!match) receiptRefuse("the receipt has a malformed auditor agent");
	return match[1];
}

/** Receipt aliases are explicit roles, not a bag of strings: a target hash in a
 * note or the English slot is never evidence for the target catalogue. Multiple
 * aliases must agree; root hashes cannot supply a missing namespace-block hash.
 */
function scopedHash(block, locale, source) {
	const role = source ? "source" : "target";
	const language = source ? "en" : locale;
	const hash = unambiguous(`${source ? "English source" : "target"} hash`, [
		block[`${language}_sha256`],
		block[`${role}_sha256`],
		block.sha256?.[language],
		block.sha256?.[role],
		block.hashes?.[language],
		block.hashes?.[role],
	]);
	if (!isSha256(hash)) receiptRefuse(`the receipt has an invalid ${role} hash`);
	return hash;
}

/** Canonical, pure derivation used on BOTH write and read paths. Catalogue
 * hashes are supplied by each caller from actual bytes, never from a claim.
 * Namespace blocks own their verdict/hashes; a receipt-wide finding list is
 * scoped by key only for the real multi-namespace audit format used by pass B.
 */
export function deriveReceiptAudit(
	bytes,
	{ locale, namespace, sourceHash, targetHash },
) {
	const receipt = parseReceipt(bytes);
	let block = receipt;
	if (receipt.namespaces !== undefined) {
		if (
			!receipt.namespaces ||
			typeof receipt.namespaces !== "object" ||
			Array.isArray(receipt.namespaces) ||
			!Object.keys(receipt.namespaces).length
		)
			receiptRefuse("the receipt has malformed or missing namespace blocks");
		if (!Object.hasOwn(receipt.namespaces, namespace))
			receiptRefuse(`the receipt does not cover namespace ${namespace}`);
		block = receipt.namespaces[namespace];
		if (!block || typeof block !== "object" || Array.isArray(block))
			receiptRefuse(
				`the receipt has a malformed namespace block for ${namespace}`,
			);
	} else if (receipt.namespace !== namespace)
		receiptRefuse(`the receipt does not cover namespace ${namespace}`);
	if (
		(receipt.namespace !== undefined && receipt.namespace !== namespace) ||
		(block.namespace !== undefined && block.namespace !== namespace)
	)
		receiptRefuse(`the receipt does not cover namespace ${namespace}`);
	if (receipt.locale !== undefined && receipt.locale !== locale)
		receiptRefuse("the receipt names a different locale");
	const identities = block === receipt ? [receipt] : [receipt, block];
	const agents = [];
	const instances = [];
	const models = [];
	for (const identity of identities) {
		const auditor = identity.auditor;
		if (
			auditor !== undefined &&
			(auditor === null ||
				(typeof auditor !== "string" &&
					(typeof auditor !== "object" || Array.isArray(auditor))))
		)
			receiptRefuse("the receipt has a malformed auditor identity");
		const nested =
			typeof auditor === "object" && auditor !== null ? auditor : {};
		agents.push(
			auditorAgent(typeof auditor === "string" ? auditor : nested.agent),
			auditorAgent(identity.agent),
		);
		instances.push(identity.instance, nested.instance);
		models.push(identity.model, nested.model, nested.actual_model);
	}
	const agent = unambiguous("auditor agent", agents);
	const instance = unambiguous("instance", instances);
	if (isPlaceholderInstance(instance))
		receiptRefuse("the receipt instance is missing or a placeholder");
	const model = unambiguous("model", models);
	const statuses = [block.status, block.result]
		.filter((word) => word !== undefined)
		.map((word) =>
			word === "passed" || PASSING_RESULTS.has(word) ? "passed" : word,
		);
	const status = unambiguous("status", statuses);
	if (!["passed", "changes_requested"].includes(status))
		receiptRefuse(
			`the receipt's status for ${namespace} is not passed | changes_requested`,
		);
	const source_sha256 = scopedHash(block, locale, true);
	const target_sha256 = scopedHash(block, locale, false);
	if (source_sha256 !== sourceHash)
		receiptRefuse(
			"the receipt does not name the English source bytes on disk - it audited a different file",
		);
	if (target_sha256 !== targetHash)
		receiptRefuse(
			"the receipt does not name the target bytes on disk - it audited a different file",
		);
	const scoped = receiptScope(receipt, namespace);
	const { counts, errors } = countFindings(scoped.findings);
	if (errors.length)
		receiptRefuse(
			`the receipt's findings are not countable: ${errors.join("; ")}`,
		);
	const result = resultSupportedBy(status, counts);
	if (status === "passed" && !PASSING_RESULTS.has(result))
		receiptRefuse(
			"the receipt says passed but its findings include a blocker/major",
		);
	return {
		agent,
		instance,
		model,
		result,
		findings: counts,
		source_sha256,
		target_sha256,
		receipt_sha256: sha256Hex(bytes),
	};
}

/** Row labels cannot rewrite receipt evidence. Kept separate from passing-state
 * validation because the writer must also record honest changes_requested runs.
 */
export function compareReceiptAudit(audit, derived) {
	const failures = [];
	for (const key of ["agent", "instance", "model", "result", "receipt_sha256"])
		if (audit?.[key] !== derived[key])
			failures.push(`${key} contradicts immutable receipt`);
	if (
		!audit?.findings ||
		SEVERITIES.some((key) => audit.findings[key] !== derived.findings[key]) ||
		Object.keys(audit.findings).length !== SEVERITIES.length
	)
		failures.push("findings contradict immutable receipt");
	return failures;
}
