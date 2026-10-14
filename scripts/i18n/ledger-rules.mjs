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
 *    result label is a string the audit's author wrote; the counts are what the
 *    gate can actually check. A passing audit must record `blocker: 0` and
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
 *    path under `i18n/receipts/` is verified by the gate (the file travels with
 *    the repo), a machine-local path is a legacy pointer the gate cannot verify.
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
		trimmed.length < MIN_INSTANCE_LENGTH || PLACEHOLDER_INSTANCES.has(trimmed)
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
		value.startsWith(`${RECEIPTS_DIR}/`) &&
		!value.includes("..")
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
