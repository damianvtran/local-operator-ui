/**
 * Tests for `ledger-assemble.mjs` (the ledger WRITER) and the rules it shares with
 * `ledger-check.mjs` (`ledger-rules.mjs`).
 *
 * WHY EACH CASE EXISTS. A writer is only trustworthy if it can be made to refuse.
 * Every refusal below is driven by mutating ONE thing in an otherwise-valid
 * fixture, so a failure is attributable to exactly that rule; the controls prove
 * the unmutated fixture assembles and that what the tool writes is a row the gate
 * accepts (the writer and the gate must agree - that is why the rules are shared).
 *
 * Fixtures are synthetic trees under the OS temp dir; nothing here touches the
 * repo's own ledger, catalogues or `i18n/receipts/`.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	Refusal,
	assemble,
	receiptIdentity,
	resultSupportedBy,
} from "./ledger-assemble.mjs";
import { checkLedger } from "./ledger-check.mjs";
import {
	countFindings,
	isPlaceholderInstance,
	supportedStatus,
	validateAuditSet,
} from "./ledger-rules.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");

const EN = `${JSON.stringify({ "demo.words.hello": "Hello, {name}!", "demo.words.plain": "plain" }, null, "\t")}\n`;
const FR = `${JSON.stringify({ "demo.words.hello": "Bonjour, {name} !", "demo.words.plain": "simple" }, null, "\t")}\n`;
const FILE = "src/i18n/catalogues/fr/demo.words.json";
const MODEL = "test/model-1";

/** A receipt that names the bytes on disk, with the given findings. */
function receiptFor({
	instance = "run-aaaaaaaa",
	status = "passed",
	findings = [],
	extra = {},
} = {}) {
	return {
		auditor: "i18n-auditor",
		model: MODEL,
		instance,
		status,
		sha256: { fr: sha(FR), en: sha(EN) },
		findings,
		...extra,
	};
}

function buildTree() {
	const root = mkdtempSync(join(tmpdir(), "i18n-assemble-"));
	for (const [locale, text] of [
		["en", EN],
		["fr", FR],
	]) {
		const dir = join(root, "src", "i18n", "catalogues", locale);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "demo.words.json"), text);
	}
	mkdirSync(join(root, "receipts-in"), { recursive: true });
	return root;
}

const writeReceipt = (root, name, body) => {
	const path = join(root, "receipts-in", name);
	writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
	return path;
};

const ledgerOf = (root) =>
	JSON.parse(readFileSync(join(root, "i18n", "ledger.json"), "utf8"));

function run(root, overrides = {}) {
	const instance = overrides.auditorInstance ?? "run-aaaaaaaa";
	const receipt =
		overrides.receipt ??
		writeReceipt(root, `${instance}.json`, receiptFor({ instance }));
	return assemble({
		repo: root,
		locale: "fr",
		file: FILE,
		auditorInstance: instance,
		auditorModel: MODEL,
		result: "clean",
		receipt,
		translatorAgent: "i18n-translator",
		translatorModel: "test/translator",
		date: "2026-10-14",
		...overrides,
	});
}

function withTree(fn) {
	const root = buildTree();
	try {
		return fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function refusal(fn, pattern) {
	assert.throws(fn, (error) => {
		assert.ok(error instanceof Refusal, `expected a Refusal, got ${error}`);
		assert.match(error.message, pattern);
		return true;
	});
}

/* ------------------------------ controls ------------------------------ */

test("CONTROL: a clean receipt assembles an audited row the GATE accepts", () => {
	withTree((root) => {
		const out = run(root);
		// One valid, passing, independent audit supports `audited`: that is the
		// GATE's rule (the two-audit policy for high-visibility namespaces is a
		// programme rule the ledger does not encode). The tool must not invent a
		// stricter status than the gate would accept, nor a laxer one.
		assert.equal(out.status, "audited");
		const ledger = ledgerOf(root);
		const row = ledger.entries[0];
		// Hashes are DERIVED from the files, not supplied.
		assert.equal(row.source_sha256, sha(EN));
		assert.equal(row.target_sha256, sha(FR));
		assert.deepEqual(row.auditors[0].findings, {
			blocker: 0,
			major: 0,
			minor: 0,
			nit: 0,
		});
		assert.equal(row.auditors[0].instance, "run-aaaaaaaa");
		// The receipt travelled into the repo, and the row records its hash.
		const copy = join(root, row.auditors[0].receipt);
		assert.ok(existsSync(copy), "the receipt is copied under i18n/receipts/");
		assert.equal(row.auditors[0].receipt_sha256, sha(readFileSync(copy)));
		// The gate agrees with the writer.
		const { failures } = checkLedger({ repo: root });
		assert.deepEqual(failures, []);
	});
});

test("CONTROL: a status is `audited` only when the auditors support it", () => {
	withTree((root) => {
		run(root);
		const second = run(root, {
			auditorInstance: "run-bbbbbbbb",
			result: "clean-with-findings",
			receipt: writeReceipt(
				root,
				"b.json",
				receiptFor({
					instance: "run-bbbbbbbb",
					findings: [
						{ severity: "MINOR", key: "demo.words.plain" },
						{ sev: "NIT", key: "demo.words.hello" },
					],
				}),
			),
		});
		assert.equal(second.status, "audited");
		assert.deepEqual(ledgerOf(root).entries[0].auditors[1].findings, {
			blocker: 0,
			major: 0,
			minor: 1,
			nit: 1,
		});
		assert.deepEqual(checkLedger({ repo: root }).failures, []);
	});
});

test("CONTROL: re-running with the SAME receipt is idempotent (one audit, not two)", () => {
	withTree((root) => {
		run(root);
		run(root);
		assert.equal(ledgerOf(root).entries[0].auditors.length, 1);
	});
});

/* ------------------------------ refusals ------------------------------ */

test("NEGATIVE: a missing receipt is refused and nothing is written", () => {
	withTree((root) => {
		refusal(
			() => run(root, { receipt: join(root, "receipts-in", "nope.json") }),
			/does not exist/,
		);
		assert.equal(
			existsSync(join(root, "i18n", "ledger.json")),
			false,
			"no ledger written",
		);
	});
});

test("NEGATIVE: a receipt that is not JSON is refused", () => {
	withTree((root) => {
		refusal(
			() => run(root, { receipt: writeReceipt(root, "bad.json", "{not json") }),
			/not readable JSON/,
		);
	});
});

test("NEGATIVE: a stale hash - the receipt audited different bytes - is refused", () => {
	withTree((root) => {
		const stale = receiptFor();
		stale.sha256.fr = sha("an older translation");
		refusal(
			() => run(root, { receipt: writeReceipt(root, "stale.json", stale) }),
			/does not name the target bytes on disk/,
		);
		const staleEnglish = receiptFor();
		staleEnglish.sha256.en = sha("an older source");
		refusal(
			() =>
				run(root, {
					receipt: writeReceipt(root, "stale-en.json", staleEnglish),
				}),
			/does not name the English source bytes on disk/,
		);
	});
});

test("NEGATIVE: a result the receipt does not support is refused (result/status mismatch)", () => {
	withTree((root) => {
		// changes_requested receipt, operator claims clean: can never become audited.
		const rejected = writeReceipt(
			root,
			"rej.json",
			receiptFor({
				instance: "run-cccccccc",
				status: "changes_requested",
				findings: [{ severity: "MAJOR", key: "demo.words.hello" }],
			}),
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-cccccccc",
					receipt: rejected,
					result: "clean",
				}),
			/is not supported by the receipt/,
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-cccccccc",
					receipt: rejected,
					result: "clean-with-findings",
				}),
			/is not supported by the receipt/,
		);
		// A `passed` receipt that records a MAJOR cannot be labelled clean-with-findings.
		const hidden = writeReceipt(
			root,
			"hid.json",
			receiptFor({
				instance: "run-dddddddd",
				findings: [{ severity: "MAJOR", key: "demo.words.hello" }],
			}),
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-dddddddd",
					receipt: hidden,
					result: "clean-with-findings",
				}),
			/supports changes_requested/,
		);
		// Findings but labelled plain clean.
		const minors = writeReceipt(
			root,
			"min.json",
			receiptFor({
				instance: "run-eeeeeeee",
				findings: [{ severity: "MINOR", key: "demo.words.hello" }],
			}),
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-eeeeeeee",
					receipt: minors,
					result: "clean",
				}),
			/supports clean-with-findings/,
		);
	});
});

test("NEGATIVE: a changes_requested receipt is recorded honestly and the row is NEVER audited", () => {
	withTree((root) => {
		const rejected = writeReceipt(
			root,
			"rej.json",
			receiptFor({
				instance: "run-cccccccc",
				status: "changes_requested",
				findings: [{ severity: "MAJOR", key: "demo.words.hello" }],
			}),
		);
		const out = run(root, {
			auditorInstance: "run-cccccccc",
			receipt: rejected,
			result: "changes_requested",
		});
		assert.equal(out.status, "changes_requested");
		// ...so the gate refuses to ship it.
		const { failures } = checkLedger({ repo: root });
		assert.ok(
			failures.some(
				(f) =>
					f.includes("not a passing result") || f.includes('not "audited"'),
			),
			JSON.stringify(failures),
		);
	});
});

test("NEGATIVE: a duplicate instance with a DIFFERENT receipt is refused", () => {
	withTree((root) => {
		run(root);
		const other = receiptFor({
			instance: "run-aaaaaaaa",
			findings: [{ severity: "MINOR", key: "demo.words.hello" }],
		});
		refusal(
			() =>
				run(root, {
					receipt: writeReceipt(root, "other.json", other),
					result: "clean-with-findings",
				}),
			// TWO guards cover this and the first to fire wins: the receipt copy is
			// named by its instance, so a different file at that name trips the
			// immutable-evidence guard before the row-level one is reached.
			/already exists with different content|already recorded .* with a different receipt/,
		);
	});
});

test("NEGATIVE: the ROW-level guard refuses a different receipt on a recorded instance even with no copy on disk", () => {
	withTree((root) => {
		run(root);
		// Remove the in-repo copy so the immutable-evidence guard cannot fire; the
		// row itself still remembers the instance and the receipt hash.
		rmSync(join(root, "i18n", "receipts", "run-aaaaaaaa.json"));
		const other = receiptFor({
			instance: "run-aaaaaaaa",
			findings: [{ severity: "MINOR", key: "demo.words.hello" }],
		});
		refusal(
			() =>
				run(root, {
					receipt: writeReceipt(root, "other2.json", other),
					result: "clean-with-findings",
				}),
			/already recorded .* with a different receipt/,
		);
	});
});

test("NEGATIVE: a placeholder instance is refused (the receipt that names itself 'scratchpad')", () => {
	withTree((root) => {
		const receipt = writeReceipt(
			root,
			"ph.json",
			receiptFor({ instance: "scratchpad" }),
		);
		refusal(
			() => run(root, { auditorInstance: "scratchpad", receipt }),
			/missing or a placeholder/,
		);
		refusal(
			() =>
				run(root, {
					auditorInstance: "x",
					receipt: writeReceipt(
						root,
						"short.json",
						receiptFor({ instance: "x" }),
					),
				}),
			/missing or a placeholder/,
		);
	});
});

test("NEGATIVE: --auditor-instance must be the receipt's own instance", () => {
	withTree((root) => {
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-zzzzzzzz",
					receipt: writeReceipt(
						root,
						"r.json",
						receiptFor({ instance: "run-aaaaaaaa" }),
					),
				}),
			/not the --auditor-instance/,
		);
	});
});

test("NEGATIVE: --auditor-model must match the receipt's model", () => {
	withTree((root) => {
		refusal(
			() => run(root, { auditorModel: "some/other-model" }),
			/names model/,
		);
	});
});

test("NEGATIVE: a receipt with no findings field is refused (absent is not zero)", () => {
	withTree((root) => {
		const body = receiptFor();
		delete body.findings;
		refusal(
			() => run(root, { receipt: writeReceipt(root, "nof.json", body) }),
			/no `findings` field/,
		);
	});
});

test("NEGATIVE: a finding with no recognisable severity is refused, never dropped", () => {
	withTree((root) => {
		const body = receiptFor({
			findings: [{ severity: "CRITICAL!!", key: "demo.words.hello" }],
		});
		refusal(
			() =>
				run(root, {
					receipt: writeReceipt(root, "sev.json", body),
					result: "clean-with-findings",
				}),
			/not countable/,
		);
	});
});

test("NEGATIVE: an incomplete locale file is refused (a dropped key must not hide behind fallback)", () => {
	withTree((root) => {
		const dropped = `${JSON.stringify({ "demo.words.hello": "Bonjour, {name} !" }, null, "\t")}\n`;
		writeFileSync(join(root, FILE), dropped);
		const body = receiptFor();
		body.sha256.fr = sha(dropped);
		refusal(
			() => run(root, { receipt: writeReceipt(root, "d.json", body) }),
			/not key-complete against English \(1 missing/,
		);
	});
});

test("NEGATIVE: a new row without a translator is refused", () => {
	withTree((root) => {
		refusal(
			() => run(root, { translatorAgent: undefined }),
			/--translator-agent/,
		);
	});
});

test("NEGATIVE: the source locale and a path outside the catalogue tree are refused", () => {
	withTree((root) => {
		refusal(
			() =>
				run(root, {
					locale: "en",
					file: "src/i18n/catalogues/en/demo.words.json",
				}),
			/source locale/,
		);
		refusal(
			() => run(root, { file: "../elsewhere/demo.words.json" }),
			/catalogue/,
		);
	});
});

test("NEGATIVE: an existing receipt copy is never overwritten with different content", () => {
	withTree((root) => {
		run(root);
		// Tamper with the in-repo copy, then ask for the same instance again.
		const copy = join(root, ledgerOf(root).entries[0].auditors[0].receipt);
		writeFileSync(copy, '{"tampered":true}');
		refusal(() => run(root), /already exists with different content/);
	});
});

/* ------------------------- staleness and history ------------------------- */

test("a file edited after its audit moves the old audits to `superseded` and restarts the row", () => {
	withTree((root) => {
		run(root);
		const edited = `${JSON.stringify({ "demo.words.hello": "Salut, {name} !", "demo.words.plain": "simple" }, null, "\t")}\n`;
		writeFileSync(join(root, FILE), edited);
		const body = receiptFor({ instance: "run-ffffffff" });
		body.sha256.fr = sha(edited);
		const out = run(root, {
			auditorInstance: "run-ffffffff",
			receipt: writeReceipt(root, "new.json", body),
		});
		assert.equal(out.stale, true);
		const row = ledgerOf(root).entries[0];
		assert.equal(row.target_sha256, sha(edited));
		assert.equal(
			row.auditors.length,
			1,
			"only the audit of the NEW bytes counts",
		);
		assert.equal(row.auditors[0].instance, "run-ffffffff");
		assert.equal(row.superseded.length, 1, "the old audit is kept as history");
		assert.equal(row.superseded[0].target_sha256, sha(FR));
	});
});

/* ------------------- the GATE's new rules (shared module) ------------------- */

const GOOD = {
	agent: "i18n-auditor",
	result: "clean",
	instance: "run-aaaaaaaa",
	findings: { blocker: 0, major: 0, minor: 0, nit: 0 },
	receipt_sha256: "a".repeat(64),
};

test("GATE M2: a passing audit that records a MAJOR or BLOCKER fails, whatever its label says", () => {
	for (const severity of ["blocker", "major"]) {
		const failures = validateAuditSet(
			[
				{
					...GOOD,
					result: "clean-with-findings",
					findings: { ...GOOD.findings, [severity]: 1, minor: 1 },
				},
			],
			"i18n-translator",
			"fr/x",
		);
		assert.ok(
			failures.some((f) => f.includes(severity.toUpperCase())),
			JSON.stringify(failures),
		);
	}
});

test("GATE M2: a result label that disagrees with its counts fails in both directions", () => {
	assert.ok(
		validateAuditSet(
			[{ ...GOOD, result: "clean-with-findings" }],
			"t",
			"fr/x",
		).some((f) => f.includes('use "clean"')),
	);
	assert.ok(
		validateAuditSet(
			[{ ...GOOD, findings: { ...GOOD.findings, minor: 2 } }],
			"t",
			"fr/x",
		).some((f) => f.includes('use "clean-with-findings"')),
	);
});

test("GATE M2: an audit with no severity counts fails (the label alone is self-attested)", () => {
	const { findings, ...noCounts } = GOOD;
	assert.ok(
		validateAuditSet([noCounts], "t", "fr/x").some((f) =>
			f.includes("severity counts"),
		),
	);
});

test("GATE M3: a placeholder instance, a missing receipt hash, and a tampered in-repo receipt all fail", () => {
	assert.ok(
		validateAuditSet([{ ...GOOD, instance: "scratchpad" }], "t", "fr/x").some(
			(f) => f.includes("placeholder"),
		),
	);
	assert.ok(
		validateAuditSet(
			[{ ...GOOD, receipt_sha256: undefined }],
			"t",
			"fr/x",
		).some((f) => f.includes("receipt_sha256")),
	);
	withTree((root) => {
		run(root);
		run(root, {
			auditorInstance: "run-bbbbbbbb",
			receipt: writeReceipt(
				root,
				"b.json",
				receiptFor({ instance: "run-bbbbbbbb" }),
			),
		});
		assert.deepEqual(checkLedger({ repo: root }).failures, []);
		const path = join(root, ledgerOf(root).entries[0].auditors[0].receipt);
		writeFileSync(path, '{"tampered":true}');
		assert.ok(
			checkLedger({ repo: root }).failures.some((f) =>
				f.includes("no longer matches its recorded receipt_sha256"),
			),
			"the gate re-hashes in-repo receipts",
		);
		rmSync(path);
		assert.ok(
			checkLedger({ repo: root }).failures.some((f) =>
				f.includes("is not in the repo"),
			),
		);
	});
});

test("GATE: two auditors sharing an instance still fail", () => {
	assert.ok(
		validateAuditSet([GOOD, { ...GOOD }], "t", "fr/x").some((f) =>
			f.includes("share one `instance`"),
		),
	);
});

/* ------------------------------ unit pieces ------------------------------ */

test("placeholder detection: stock words and short ids are placeholders, a 12-hex session id is not", () => {
	for (const value of [
		"scratchpad",
		"Session",
		"unknown",
		"",
		"abc",
		undefined,
		null,
		42,
	]) {
		assert.equal(isPlaceholderInstance(value), true, String(value));
	}
	for (const value of ["340d8507700f", "run-aaaaaaaa"]) {
		assert.equal(isPlaceholderInstance(value), false, value);
	}
});

test("severity counting reads both spellings, ignores INFO, and errors on the unknown", () => {
	const { counts, errors } = countFindings([
		{ severity: "MAJOR" },
		{ sev: "Minor" },
		{ severity: "nit" },
		{ sev: "INFO" },
		{ severity: "BLOCKER" },
	]);
	assert.deepEqual(counts, { blocker: 1, major: 1, minor: 1, nit: 1 });
	assert.deepEqual(errors, []);
	assert.equal(countFindings([{ severity: "weird" }]).errors.length, 1);
});

test("a findings OBJECT keyed by severity (the shape one real receipt uses) is counted", () => {
	withTree((root) => {
		const body = receiptFor({ instance: "run-gggggggg" });
		body.findings = {
			BLOCKER: [],
			MAJOR: [],
			MINOR: [{ key: "demo.words.plain" }],
			NIT: [],
		};
		const out = run(root, {
			auditorInstance: "run-gggggggg",
			receipt: writeReceipt(root, "o.json", body),
			result: "clean-with-findings",
		});
		assert.deepEqual(out.audit.findings, {
			blocker: 0,
			major: 0,
			minor: 1,
			nit: 0,
		});
	});
});

test("receipt identity: instance/model/verdict are read from the shapes auditors really write", () => {
	assert.deepEqual(
		receiptIdentity({ instance: "i", model: "m", status: "passed" }),
		{ instance: "i", model: "m", status: "passed" },
	);
	assert.deepEqual(
		receiptIdentity({
			auditor: { agent: "a", instance: "i2", actual_model: "m2" },
			result: "clean",
		}),
		{ instance: "i2", model: "m2", status: "passed" },
	);
	assert.equal(
		receiptIdentity({ result: "changes_requested" }).status,
		"changes_requested",
	);
	assert.equal(receiptIdentity({ status: "who knows" }).status, undefined);
});

test("a multi-namespace receipt is scoped per namespace and a finding that names none is refused", () => {
	withTree((root) => {
		const body = receiptFor({ instance: "run-hhhhhhhh" });
		body.namespaces = {
			"demo.words": {
				status: "passed",
				findings: [{ severity: "MINOR", key: "demo.words.plain" }],
			},
			"demo.other": {
				status: "changes_requested",
				findings: [{ severity: "MAJOR", key: "demo.other.x" }],
			},
		};
		delete body.findings;
		const out = run(root, {
			auditorInstance: "run-hhhhhhhh",
			receipt: writeReceipt(root, "m.json", body),
			result: "clean-with-findings",
		});
		assert.deepEqual(
			out.audit.findings,
			{ blocker: 0, major: 0, minor: 1, nit: 0 },
			"the other namespace's MAJOR does not leak in",
		);
	});
	withTree((root) => {
		const body = receiptFor({
			instance: "run-iiiiiiii",
			findings: [{ severity: "MAJOR", key: "unattributable" }],
		});
		body.namespaces = { "demo.words": {}, "demo.other": {} };
		refusal(
			() =>
				run(root, {
					auditorInstance: "run-iiiiiiii",
					receipt: writeReceipt(root, "m2.json", body),
					result: "clean-with-findings",
				}),
			/names no namespace/,
		);
	});
});

test("resultSupportedBy and supportedStatus never promote beyond the evidence", () => {
	assert.equal(
		resultSupportedBy("changes_requested", {
			blocker: 0,
			major: 0,
			minor: 0,
			nit: 0,
		}),
		"changes_requested",
	);
	assert.equal(
		resultSupportedBy("passed", { blocker: 0, major: 1, minor: 0, nit: 0 }),
		"changes_requested",
	);
	assert.equal(
		resultSupportedBy("passed", { blocker: 0, major: 0, minor: 0, nit: 1 }),
		"clean-with-findings",
	);
	assert.equal(
		resultSupportedBy("passed", { blocker: 0, major: 0, minor: 0, nit: 0 }),
		"clean",
	);
	assert.equal(supportedStatus([], "t", "fr/x"), "pending");
	assert.equal(
		supportedStatus([{ ...GOOD, result: "changes_requested" }], "t", "fr/x"),
		"changes_requested",
	);
	assert.equal(supportedStatus([GOOD], "t", "fr/x"), "audited");
});
