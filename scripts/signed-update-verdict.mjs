import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";

const verdictCodes = new Set(["PASS", "FAIL", "BLOCKED"]);
// verify-signed-update.mjs records this final positive row only after both
// native launches pass. Earlier rows are written incrementally and can survive
// an interrupted run; the job result also covers errors after this last check.
const NATIVE_COMPLETION_SURFACE = "Candidate first and second launch";
const lineBreak = /[\r\n\u2028\u2029]/;
const spaces = /\s+/;
const labelWord = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const nonDigit = /[^0-9]/;
const blockedClasses = [
	[/\bINCUP_UPDATE_CONTROL\b/i, "INCUP_UPDATE_CONTROL"],
	[/\bGUI (?:launchd )?session\b/i, "GUI_SESSION_ABSENT"],
	[/\b(?:metadata|latest-mac\.yml)\b/i, "METADATA_RESOLUTION"],
];

function blockedClass(actual) {
	// Match the producer's first line for classification, but never publish its
	// prose: it can contain diagnoses with local paths or URLs.
	const firstLine = actual.split(lineBreak, 1)[0];
	return (
		blockedClasses.find(([pattern]) => pattern.test(firstLine))?.[1] ??
		"UNCLASSIFIED_BLOCK"
	);
}

function safeSurface(surface) {
	// Labels are artifact input too. Keep only plain label words; drop whole
	// tokens with URL/path punctuation instead of accidentally retaining links or
	// turning artifact text into GitHub commands or Markdown syntax.
	return (
		surface
			.split(lineBreak, 1)[0]
			.split(spaces)
			.filter((word) => labelWord.test(word))
			.join(" ") || "Unnamed surface"
	);
}

/** Judge the downloaded matrix without creating logs or changing process state. */
export function signedUpdateVerdict(
	proofDir,
	{ trigger, runId, exactUpdateResult } = {},
) {
	const context = `${
		trigger === "repository_dispatch" || trigger === "workflow_dispatch"
			? trigger
			: "unknown trigger"
	}, ${typeof runId === "string" && runId && !nonDigit.test(runId) ? `run ${runId}` : "unknown run"}`;
	const result = (verdict, codes, reasonCodes, detail) => ({
		verdict,
		codes,
		reasonCodes,
		exitCode: verdict === "PASS" ? 0 : 1,
		message: `Signed update proof: ${verdict} (${context}) — ${detail}`,
	});
	const noProof = () =>
		result(
			"BLOCKED",
			[],
			["NO_PROOF_ARTIFACT"],
			"NO_PROOF_ARTIFACT: no proof artifact with a valid, nonempty matrix",
		);

	let rows;
	try {
		if (!proofDir) return noProof();
		rows = JSON.parse(readFileSync(join(proofDir, "matrix.json"), "utf8"));
	} catch {
		return noProof();
	}
	// In particular, [] is not an all-PASS proof, and an unknown or malformed
	// row must not be silently filtered out of a matrix of otherwise PASS rows.
	if (
		!Array.isArray(rows) ||
		!rows.length ||
		!rows.every(
			(row) =>
				row &&
				verdictCodes.has(row.verdict) &&
				typeof row.surface === "string" &&
				row.surface.trim() &&
				typeof row.actual === "string",
		)
	)
		return noProof();

	const codes = [...new Set(rows.map((row) => row.verdict))];
	const failures = rows.filter((row) => row.verdict === "FAIL");
	if (failures.length) {
		const surfaces = [
			...new Set(failures.map((row) => safeSurface(row.surface))),
		];
		return result("FAIL", codes, [], `failed surfaces: ${surfaces.join(", ")}`);
	}
	const blocks = rows.filter((row) => row.verdict === "BLOCKED");
	if (blocks.length) {
		const reasonCodes = new Set();
		const details = new Set();
		for (const row of blocks) {
			const reason = blockedClass(row.actual);
			reasonCodes.add(reason);
			details.add(`${reason}: ${safeSurface(row.surface)}`);
		}
		return result("BLOCKED", codes, [...reasonCodes], [...details].join("; "));
	}
	if (!rows.some((row) => row.surface === NATIVE_COMPLETION_SURFACE))
		return result(
			"INCOMPLETE",
			codes,
			["NATIVE_COMPLETION_MISSING"],
			"NATIVE_COMPLETION_MISSING: matrix lacks the completed native launch checks",
		);
	if (exactUpdateResult !== "success")
		return result(
			"INCOMPLETE",
			codes,
			["EXACT_UPDATE_NOT_SUCCESSFUL"],
			"EXACT_UPDATE_NOT_SUCCESSFUL: exact-update job did not succeed",
		);
	return result("PASS", codes, [], `all ${rows.length} matrix rows passed`);
}

if (isEntryPoint(import.meta.url)) {
	const [, , proofDir] = process.argv;
	const { exitCode, message } = signedUpdateVerdict(proofDir, {
		trigger: process.env.GITHUB_EVENT_NAME,
		runId: process.env.GITHUB_RUN_ID,
		exactUpdateResult: process.env.EXACT_UPDATE_RESULT,
	});
	console.log(message);
	if (process.env.GITHUB_STEP_SUMMARY)
		appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${message}\n`);
	process.exitCode = exitCode;
}
