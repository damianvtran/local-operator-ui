#!/usr/bin/env node
/**
 * Assert the TRACKED evidence structure - the half of `check-evidence` that needs
 * no pixel - and fail closed on the invariant that keeps the frames out of the
 * repository.
 *
 * WHY THIS EXISTS RATHER THAN `pnpm check-evidence` IN CI. The frames are rig
 * output in the ignored `docs/evidence-frames/` (see `.gitignore`), so a fresh
 * checkout has none: a job that decoded frames in CI would either fail on every
 * evidence-touching PR or pass over zero frames, which is the green-by-absence
 * this repository's own job comment calls "worse than no gate". The pixel sweep
 * therefore lives on the RELEASE path (AGENTS.md, "the release owner's
 * procedure"), where a captured checkout exists, and this gate keeps what a
 * checkout can actually answer:
 *
 *   1. NO FRAME IS COMMITTED. `docs/evidence/**` must carry no frame container,
 *      and `docs/evidence-frames/**` must carry nothing at all. This catches a
 *      frame that is COMMITTED, on the PR that commits it. It does NOT see a
 *      regressed rig's untracked write - no diff sees an untracked file - so the
 *      net for that is the `.gitignore` leftover rules (an unforced `git add -A`
 *      cannot add one) plus this assertion refusing the commit if one is forced.
 *   2. THE MANIFEST PARSES AND ITS DECLARATIONS ARE SOUND. `manifest.json` has
 *      the numeric count fields, every `supplementary` entry carries its
 *      provenance (`path`, `source`, `why`, `capturedAt`), every path is a
 *      repository-relative path that cannot escape the tree, no path is declared
 *      twice (a duplicate double-counts the same frames and silently passes the
 *      sweep), and every declared count is a non-negative integer.
 *
 *      It does NOT require a tracked README under each set: 51 of the 229 shipped
 *      sets hold nothing but their frames, so their tracked directory disappears
 *      with the split. Demanding one would make this gate a request to author 51
 *      READMEs, which is not a structural property of the manifest - and when it
 *      DID demand one, the CI job reported 58 failures on a correct tree
 *      (measured 2026-10-20, the first run of this gate).
 *   3. THE PROOF ARTEFACTS THE RUNBOOK NAMES ARE STILL TRACKED. Frames became
 *      regenerable; these did not, and a split that quietly untracked one would
 *      take a reader's evidence with it.
 *   4. THE COUNTS THAT DO NOT NEED FRAMES. `stampFailures` is called with its
 *      frame tree absent: it answers `surfaces`/`themes` against
 *      `HEAD:scripts/capture-evidence.mjs` and the `partialCapture` tallies, and
 *      stands down from the tree half (which the sweep enforces at release). One
 *      opinion, not a second implementation of the same arithmetic.
 *
 * WHAT IS DELIBERATELY NOT HERE: any decode, any frame count against disk, and
 * any `sharp` work beyond the import chain `check-evidence.mjs` already carries.
 * A green run here says the STRUCTURE holds; it says nothing about whether the
 * pixels are pictures of their themes, and the release step is where that is
 * answered.
 *
 * Exit status: 0 when every assertion holds, 1 with one `FAIL` line per
 * assertion otherwise. It never skips: a missing manifest, an unreadable tree or
 * an absent proof artefact is a failure, because "the thing this gate reads is
 * not there" is exactly the state that is invisible when it is allowed to pass.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { stampFailures } from "./check-evidence.mjs";
import { isEntryPoint } from "./entry-point.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The tracked proof tree and the ignored frames tree, by repository-relative path. */
export const EVIDENCE_PATH = "docs/evidence";
export const FRAMES_PATH = "docs/evidence-frames";

/**
 * The proof artefacts named by the runbook (AGENTS.md) and by the tests that read
 * them by path - `interrupt-control.test.mjs`'s `git show`, `clear-search.test.mjs`
 * and `new-chat-row-evidence.test.mjs`. They are the evidence that is NOT a frame
 * and must stay tracked whichever way the rigs move.
 */
export const PROOF_ARTEFACTS = [
	"docs/evidence/interrupt-live/interrupt-proof.json",
	"docs/evidence/clear-search/after-readback.json",
	"docs/evidence/new-chat-row/after-readback.json",
	"docs/evidence/new-chat-row/before-readback.json",
];

/**
 * Frame containers, as an EXTENSION LIST - the property this gate can ask of a
 * committed PATH without opening the file.
 *
 * Deliberately a second spelling of `check-evidence.mjs`'s `FRAME_CONTAINERS`
 * (which decides what the sweep judges), because importing that module for the
 * list would pull the decoder into a structural gate. The two are pinned equal by
 * `check-evidence-structure.test.mjs`, so a container added for the sweep and not
 * here (or the reverse) is a red test rather than a frame that ships under a
 * green structure.
 */
export const FRAME_EXTENSIONS = [
	".webp",
	".png",
	".jpg",
	".jpeg",
	".avif",
	".gif",
];

/** The provenance every declared set owes a reader who was not there. */
const PROVENANCE = ["source", "why", "capturedAt"];

/** One git read over the checkout, or null when git cannot answer. */
const gitOut = (args) => {
	try {
		return execFileSync("git", args, {
			cwd: ROOT,
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 64 * 1024 * 1024,
		})
			.toString()
			.trim();
	} catch {
		return null;
	}
};

const isFrame = (path) =>
	FRAME_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));

/**
 * Every structural failure, over `root` and a git reader that can be injected so
 * the assertions are exercisable on a throwaway checkout.
 *
 * `read` mirrors `gitOut`: one argument list, one string or null.
 */
export const structureFailures = ({ root = ROOT, read = gitOut } = {}) => {
	const out = [];
	const evidence = join(root, EVIDENCE_PATH);
	const frames = join(root, FRAMES_PATH);
	const rel = (path) => path.slice(root.length + 1);

	/*
	 * (1) The invariant the whole split exists for. `git ls-files` rather than a
	 * directory walk: an untracked frame left on disk by a pre-split checkout is
	 * not what this asks about, and a frame someone force-added IS.
	 */
	const tracked = read(["ls-files", "--", EVIDENCE_PATH]);
	if (tracked === null) {
		out.push(
			`git could not list ${EVIDENCE_PATH}, so nothing about the tracked evidence was verified`,
		);
	} else {
		for (const path of tracked.split("\n").filter(Boolean)) {
			if (isFrame(path))
				out.push(
					`${path}: a frame is COMMITTED. Frames are rig output and belong in the ignored ${FRAMES_PATH}/ (see .gitignore); a rig writing them here again is the regression this gate exists to stop. Untrack it with \`git rm --cached\` and let the rig write the frames tree.`,
				);
		}
	}
	const trackedFrames = read(["ls-files", "--", FRAMES_PATH]);
	if (trackedFrames === null) {
		out.push(
			`git could not list ${FRAMES_PATH}, so the frames tree's ignore invariant was not verified`,
		);
	} else if (trackedFrames.length > 0) {
		out.push(
			`${FRAMES_PATH}: ${trackedFrames.split("\n").length} file(s) are tracked. The frames tree is IGNORED and must stay empty in git - a force-add re-materialises the capture set in every worktree.`,
		);
	}

	/*
	 * (2) The manifest and its declarations. A parse failure is reported rather
	 * than thrown, because the verdict is the gate's output and a stack trace is
	 * not a reader's answer.
	 */
	const manifestPath = join(evidence, "manifest.json");
	let manifest = null;
	if (!existsSync(manifestPath)) {
		out.push(
			`${EVIDENCE_PATH}/manifest.json is missing: it is the tracked record of what every set is and why, and nothing else in the repository answers for it`,
		);
	} else {
		try {
			manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		} catch (error) {
			out.push(`${EVIDENCE_PATH}/manifest.json does not parse: ${error}`);
		}
	}
	if (manifest && typeof manifest === "object" && manifest !== null) {
		for (const field of ["frames", "surfaces", "themes"]) {
			if (typeof manifest[field] !== "number")
				out.push(
					`manifest.json: \`${field}\` is not a number (${JSON.stringify(manifest[field])}); the manifest's counts are what a reader cites and what the sweep binds at release`,
				);
		}
		const sets = manifest.supplementary;
		if (!Array.isArray(sets)) {
			out.push(
				"manifest.json: `supplementary` is not an array, so no declared set can be checked",
			);
		} else {
			const seen = new Map();
			for (const [index, set] of sets.entries()) {
				const where = set?.path
					? `supplementary[${index}] (${set.path})`
					: `supplementary[${index}]`;
				if (typeof set?.path !== "string" || set.path.length === 0) {
					out.push(`manifest.json: ${where} declares no path`);
					continue;
				}
				const missing = PROVENANCE.filter((field) => !set[field]);
				if (missing.length > 0)
					out.push(
						`manifest.json: ${where} does not say where it came from (missing ${missing.join(", ")})`,
					);
				/*
				 * The path is used as a DIRECTORY under both trees, so it has to be a
				 * repository-relative one: an absolute path or a `..` segment would
				 * point the sweep and this gate outside the checkout, and the count
				 * arithmetic would be about a tree nobody ships.
				 */
				const segments = set.path.split("/");
				if (
					set.path.startsWith("/") ||
					segments.includes("..") ||
					segments.some((segment) => segment.length === 0 || segment === ".")
				)
					out.push(
						`manifest.json: ${where} is not a repository-relative path (${JSON.stringify(set.path)}); it is joined under ${EVIDENCE_PATH}/ and ${FRAMES_PATH}/, so it must stay inside them`,
					);
				const previous = seen.get(set.path);
				if (previous !== undefined)
					out.push(
						`manifest.json: ${where} repeats the path declared at supplementary[${previous}]; two entries over one directory count the same frames twice, and the sweep's arithmetic cannot see it because each entry passes its own tree check`,
					);
				else seen.set(set.path, index);
				for (const field of ["frames", "surfaces", "themes"]) {
					if (!(field in set)) continue;
					if (!Number.isInteger(set[field]) || set[field] < 0)
						out.push(
							`manifest.json: ${where} declares \`${field}\` as ${JSON.stringify(set[field])}; a count is a non-negative integer`,
						);
				}
				if (!Number.isInteger(set.frames) || set.frames < 0)
					out.push(
						`manifest.json: ${where} declares no non-negative integer \`frames\`; every set owes that number even when it is 0 (the shipped \`submit-latency\` is the zero-frame spelling)`,
					);
			}
		}
		const unjudged = manifest.unjudgedFrames;
		if (unjudged !== undefined) {
			for (const field of ["insideDeclaredSets", "outsideDeclaredSets"]) {
				if (!Number.isInteger(unjudged?.[field]) || unjudged[field] < 0)
					out.push(
						`manifest.json: \`unjudgedFrames.${field}\` is not a non-negative integer; without it a frame that names no theme is counted by nothing`,
					);
			}
			if (typeof unjudged?.why !== "string" || unjudged.why.trim().length === 0)
				out.push(
					"manifest.json: `unjudgedFrames.why` is missing, so a reader is told the count without being told what class it covers",
				);
		}
		/*
		 * (4) The count checks that need no pixels, asked through the sweep's own
		 * guard. It stands down from its tree half when the frames tree is absent
		 * (CI), and enforces it when a release owner runs this on a captured
		 * checkout - one function, two environments.
		 */
		out.push(...stampFailures(manifest, read, frames));
	}

	/* (3) The proof artefacts the runbook names, tracked and present. */
	const trackedSet = new Set((tracked ?? "").split("\n").filter(Boolean));
	for (const path of PROOF_ARTEFACTS) {
		if (!trackedSet.has(path))
			out.push(
				`${path}: the proof artefact is not tracked. It is evidence that is NOT a frame - a reader cites it and \`interrupt-control.test.mjs\` reads it by path - so it stays in the repository`,
			);
		if (!existsSync(join(root, path)))
			out.push(
				`${path}: the tracked proof artefact is missing from the checkout`,
			);
	}
	// `scripts/` is the runbook's home; named so a reader can find the paragraph.
	if (!existsSync(join(root, "AGENTS.md")))
		out.push(
			`${rel(join(root, "AGENTS.md"))}: missing - the release-path step for the pixel sweep is documented there, so its absence would hide where the sweep went`,
		);

	return out;
};

const main = () => {
	const failures = structureFailures();
	for (const line of failures) console.log(`FAIL  ${line}`);
	if (failures.length > 0) {
		console.log(
			`\nEvidence structure FAILED: ${failures.length} assertion(s). The pixel sweep is NOT run here - it is the release path's step (AGENTS.md).`,
		);
		process.exit(1);
	}
	const manifest = JSON.parse(
		readFileSync(join(ROOT, EVIDENCE_PATH, "manifest.json"), "utf8"),
	);
	console.log(
		`Evidence structure holds: ${
			(gitOut(["ls-files", "--", EVIDENCE_PATH]) ?? "")
				.split("\n")
				.filter(Boolean).length
		} tracked files under ${EVIDENCE_PATH}/, ${manifest.supplementary?.length ?? 0} declared set(s), 0 committed frames, ${PROOF_ARTEFACTS.length} named proof artefact(s). The pixel sweep runs at release.`,
	);
};

if (isEntryPoint(import.meta.url)) main();
