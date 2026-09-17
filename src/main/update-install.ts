import { execFileSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import BUNDLED_PYTHON_LAYOUT from "../shared/bundled-python-layout.json";

/**
 * Pure helpers behind the application update path.
 *
 * Why this module exists: on 2026-09-11 the 0.17.0 auto-update downloaded,
 * verified its sha512, called `quitAndInstall`, and then the app never came
 * back. Squirrel.Mac's ShipIt logged `NSOSStatusErrorDomain Code=-67028`
 * (`errSecCSBadBundleFormat`) from `SecStaticCodeCreateWithPath` on the
 * *installed* bundle - it was mid-replacement by a Finder copy at that moment -
 * quit, and nothing relaunched the app or told the user anything. The checks in
 * here are the ones whose absence produced that outcome:
 *
 * - a seal check on the installed bundle before we agree to quit (so ShipIt is
 *   never handed a bundle it will reject),
 * - a size/sha512/disk check on the staged artifact (so a truncated or
 *   mis-published download is refused with a message instead of failing
 *   silently during the install),
 * - a pending-update marker plus a bounded relaunch watchdog, because a failed
 *   Squirrel install strands the user with no app and no explanation.
 *
 * Everything here is deliberately free of Electron imports so the contract
 * tests can bundle the shipped TypeScript in memory (`pnpm test:desktop`),
 * and side effects are confined to functions that take the directory to act in.
 */

/** Marker file name, written under the app's userData directory. */
export const PENDING_INSTALL_MARKER_FILE = "pending-update-install.json";

/**
 * Free-space headroom over the two copies an install materializes at its peak.
 *
 * `requiredDiskBytes` computes the footprint from the artifact plus the app
 * being replaced; this margin covers the extraction working set and the swap's
 * own bookkeeping. See that function for why the artifact alone is the wrong
 * number.
 */
export const INSTALL_DISK_SLACK_BYTES = 256 * 1024 * 1024;

/** Where a user gets a fresh copy when the app can no longer update itself. */
export const DOWNLOAD_PAGE_URL = "https://local-operator.com/download";

/**
 * Bound on the relaunch watchdog, in seconds.
 *
 * This is the user-visible promise, so the number is measured rather than
 * picked: the ShipIt attempts recorded on this machine for the 1 GiB app ran
 * 255 s (2026-09-11 22:36:49 request -> 22:41:04 `-67028` verdict, the install
 * that stranded the operator) and 168 s (2026-09-09 19:34:20 -> 19:37:08, a
 * swap that completed and relaunched) from request to settled. 600 s is ~2.4x
 * the slowest of them, which is the margin a cold cache or a slower volume
 * needs, and it is the OUTER bound only: the script exits as soon as either
 * the ShipIt job goes or the swap has landed on disk, so a successful install
 * never waits for it and a failed one that did swap does not either.
 *
 * It used to be 900 s, and 900 s was the *only* exit on a failed install -
 * which is why the app came back fifteen minutes later - so the number and the
 * decision the script makes are one change, not two (review R11).
 */
export const WATCHDOG_TIMEOUT_SECONDS = 600;

/**
 * The watchdog's last-resort bound, in seconds.
 *
 * `WATCHDOG_TIMEOUT_SECONDS` is a promise to try at that point, not a verdict on
 * the install: the script may be looking at a job that is still loaded because
 * the install is genuinely still running. On 2026-09-13 it was - the host was at
 * load ~95 and ShipIt spent 09:39:22 to 09:44:07 moving and code-verifying the
 * ~1 GiB bundle, while our own watchdog fired at the 600 s bound and started the
 * app straight into Squirrel's final validation. A running instance is what
 * aborts that validation (`App Still Running Error`, SQRLInstallerErrorDomain
 * -9), so the watchdog was killing any install slower than itself and then
 * reporting it as a failed update.
 *
 * Waiting past 600 s is only safe while the job is still loaded, because a
 * loaded job is the machine's own statement that an install is alive. This
 * bound is where that ends and the accepted risk (start the app even though a
 * swap may still be in flight, rather than leave the user with nothing) begins:
 * an order of magnitude over the 285 s the 2026-09-13 install took, and still
 * short enough to give the user their app back in the same sitting.
 */
export const WATCHDOG_HARD_TIMEOUT_SECONDS = 1800;

/**
 * How much later than the watchdog's hard bound a marker stops describing a
 * live install.
 *
 * The two bounds must not be the same instant, which is what they were: the
 * watchdog's hard bound is where it gives up holding and STARTS THE APP, and
 * recovery's recency bound is where the app it just started decides the install
 * was a failure. With both at 1800 s and an inclusive test, the app the
 * watchdog opens at the hard bound reads a marker that is already past it and
 * tells the user "the last update didn't finish" - seconds after the watchdog
 * told them it is still installing - and clears the marker and the install's
 * job for an install that is demonstrably still loaded. Two decisions about the
 * same install, pointing opposite ways, is the defect the recency rule exists
 * to remove (UX U5).
 *
 * The margin is what the app needs to start and evaluate before the marker ages
 * out from under it: a cold start of this app, plus the first evaluation, with
 * room for an installing machine at load. 300 s is generous against the seconds
 * a start actually takes. It is also the whole cost of the margin: a genuinely
 * failed install whose job Squirrel never unloaded is treated as live for five
 * minutes longer before the user is told, which is inside the same sitting.
 */
export const PENDING_INSTALL_RECENCY_MARGIN_SECONDS = 300;

/**
 * How recent a pending-install marker must be to describe a live install.
 *
 * The marker alone cannot say "an install is running": a failed install leaves
 * its marker AND its launchd job behind (the 0.17.0 failure respawned for hours,
 * runs=3114), and start-up recovery must not treat that leftover as an install
 * it is forbidden to touch. Recency is what separates the two, and the line is
 * the watchdog's own hard bound plus the margin above: an install this app would
 * still be waiting on is live, while anything older is a job Squirrel left
 * behind - a failure to clean up rather than an install to keep hands off.
 */
export const PENDING_INSTALL_RECENCY_SECONDS =
	WATCHDOG_HARD_TIMEOUT_SECONDS + PENDING_INSTALL_RECENCY_MARGIN_SECONDS;

/**
 * How long the watchdog's on-disk version read may take before it is killed.
 *
 * The read is the plan's plist reader (`plutil`) on the target bundle's own
 * Info.plist for every poll, and the path is `/Applications` in every real
 * layout - so a real read is milliseconds and this bound only ever fires on a
 * path whose mount has stopped answering, where the alternative is a read that
 * outlives the script's own deadline and leaves the user with no app at all
 * (review R17).
 */
export const PLIST_READ_TIMEOUT_SECONDS = 5;

/** Sentinel inside the watchdog script; see `watchdogIsOurs`. */
export const WATCHDOG_TOKEN = "local-operator-update-watchdog";

export type InstallBlockCode =
	| "installed-bundle-not-sealed"
	| "download-verification-failed"
	| "insufficient-disk-space"
	| "artifact-metadata-missing";

/** What the user can actually do about a refusal, in their own UI terms. */
export type UpdateRemedy = {
	/** One sentence telling them what to do, without the mechanism. */
	text: string;
	/** A page to open, when the remedy is a reinstall. */
	url?: string;
	/** A command to run, when the remedy is on the user's terminal. */
	command?: string;
};

export type InstallBlock = {
	code: InstallBlockCode;
	/** One sentence, sentence case, shown to the user. */
	message: string;
	/** The actionable half: what to do about it. */
	remedy: UpdateRemedy;
	/** Raw command output or numbers, for the log and the detail line. */
	detail: string;
	/**
	 * Override for the panel's heading, when one code covers two situations.
	 *
	 * The heading map is keyed by `code`, and `installed-bundle-not-sealed` is
	 * reachable from two contexts that are not the same news: an update that was
	 * refused, and a copy that is damaged with no update in play. The map cannot
	 * express that, so the copy that knows the difference says so (design D2).
	 */
	heading?: string;
	/** The dismiss control's label, when the default would misdescribe it (D3). */
	dismissLabel?: string;
};

// ---------------------------------------------------------------------------
// Installed bundle seal check
// ---------------------------------------------------------------------------

/** Result of running `codesign --verify --deep` on a bundle. */
export type SealProbe = {
	exitCode: number;
	stdout: string;
	stderr: string;
	/**
	 * Whether the probe ran to a verdict at all.
	 *
	 * `false` means the process timed out, failed to exec, or died without
	 * saying anything - "the probe could not run", which is a different claim
	 * from "codesign rejected this bundle", and the two must not be collapsed:
	 * a timed-out probe used to become a permanent "this app can't be updated in
	 * place" with a reinstall remedy (review R5). Defaults to `true` so a caller
	 * holding only a status code keeps the old meaning.
	 */
	ran?: boolean;
};

/**
 * What a seal probe proved.
 *
 * Three states rather than a boolean because "could not run" has to be
 * handled differently from "ran and said no": the first is retried and then
 * allowed to proceed, the second refuses the install (see
 * `probeInstalledBundleSeal` in the update service).
 */
export type SealVerdict =
	| { kind: "sealed" }
	| { kind: "unavailable"; detail: string }
	| { kind: "unsealed"; detail: string };

/**
 * Markers ShipIt reports for a path it cannot treat as a code object.
 *
 * -67068 `errSecCSStaticCodeNotFound` is a *missing* bundle, a different
 * problem from a bundle that exists but seals badly, and the probe proves the
 * distinction: a nonexistent path gives -67068, while a plain directory or a
 * bundle with no `Contents/MacOS/<exe>` gives -67028.
 */
const BAD_BUNDLE_MARKERS = [
	"errSecCSBadBundleFormat",
	"-67028",
	"not a valid code object",
	"code object is not signed at all",
	"a sealed resource is missing or invalid",
	"errSecCSUnsigned",
	"-67062",
];

/** The `.app` bundle that contains an executable, or null when there is none. */
export function appBundleFromExecutable(execPath: string): string | null {
	const marker = `${join("Contents", "MacOS")}/`;
	const index = execPath.lastIndexOf(marker);
	if (index <= 0) return null;
	return execPath.slice(0, index - 1);
}

/**
 * Decide whether the installed bundle is a sealed code object.
 *
 * A non-zero `codesign --verify` that printed a reason is a hard failure:
 * ShipIt validates the installed bundle the same way and refuses the install on
 * anything here. A probe that never produced a verdict is a third outcome and
 * is reported as such - see `SealVerdict`.
 */
export function evaluateBundleSeal(probe: SealProbe): SealVerdict {
	const output = `${probe.stdout}\n${probe.stderr}`.trim();
	if (probe.ran === false) {
		return {
			kind: "unavailable",
			detail: `codesign --verify did not complete: ${output || "no output"}`,
		};
	}
	if (probe.exitCode === 0) return { kind: "sealed" };
	const marker = BAD_BUNDLE_MARKERS.find((candidate) =>
		output.includes(candidate),
	);
	return {
		kind: "unsealed",
		detail: marker
			? `${marker}: ${output || "no output"}`
			: `codesign --verify exited ${probe.exitCode}: ${output || "no output"}`,
	};
}

/**
 * Who found the broken seal, which decides what the user is told.
 *
 * Two contexts with the same remedy and different facts behind them: the
 * pre-flight finds it while an update is being offered, so the update is the
 * thing that was stopped; the start-up pass finds it with no update in play at
 * all, and what the user has to know there is that macOS will refuse to open this
 * copy the next time. Borrowing the update's sentence told that user an update had
 * been stopped when none had been attempted (review R2).
 */
export type SealBlockContext = "update" | "startup";

/**
 * The refusal shown when the installed bundle cannot be replaced in place.
 *
 * The remedy names the first step the user has to take themselves - quitting
 * the app - because a user who drags a fresh copy over a running app ends up
 * looking at the old instance with no idea whether it worked (review U9).
 */
export function installedBundleSealBlock(
	appBundlePath: string,
	detail: string,
	version?: string | null,
	context: SealBlockContext = "update",
): InstallBlock {
	/*
	 * Two contexts, two pieces of news, and the start-up one is not about an
	 * update at all: the user asked for nothing, and what they have is a copy that
	 * cannot repair itself. It therefore says the fact and stops - the remedy line
	 * owns the instruction - and it carries its own heading and dismiss label, so
	 * the panel does not answer a question the user never asked and does not offer
	 * to defer an update that is not coming (design D1, D2, D3).
	 *
	 * What it still does NOT say: that macOS will refuse the next launch. The app
	 * is running with the break, so it cannot know that, and the suite holds a
	 * negative guard on exactly this copy.
	 */
	const message =
		context === "startup"
			? "This copy of Local Operator did not pass its integrity check, so it can't repair itself."
			: version
				? `This install of Local Operator can't be updated in place, so the update to version ${version} was stopped before the app quit.`
				: "This install of Local Operator can't be updated in place, so the update was stopped before the app quit.";
	return {
		code: "installed-bundle-not-sealed",
		message,
		remedy: {
			text: "Quit Local Operator, then download a fresh copy and replace the app in Applications.",
			url: DOWNLOAD_PAGE_URL,
		},
		detail: `${appBundlePath}: ${detail}`,
		...(context === "startup"
			? {
					heading: "This copy of Local Operator needs replacing",
					dismissLabel: "Not now",
				}
			: {}),
	};
}

// ---------------------------------------------------------------------------
// Self-healing the bytecode-cache seal break

/**
 * One thing `codesign --verify` reported about a bundle it refused.
 *
 * The kinds are `codesign`'s own vocabulary, and they are not interchangeable:
 * measured on an ad-hoc-signed fixture (`/tmp/sealfmt2`), a path it reports as
 * `file added:` can be deleted and `codesign --verify --deep` answers
 * `valid on disk` (exit 0), while a path reported as `file modified:` cannot -
 * deleting that one turns it into `file missing:`, which still fails. Only the
 * `added` class is recoverable, which is what makes the heal below narrow
 * rather than general.
 */
export type SealViolation = {
	kind: "added" | "modified" | "missing" | "other";
	path: string;
};

/**
 * `file added: <path>` and its siblings, as `codesign` prints them.
 *
 * Present tense, one space, a colon and the path - the same line at `--verbose`
 * 2, 3 and 4, which is why the pre-flight's own verbosity is enough to heal
 * from. Cases are matched as printed rather than lowercased, so a hypothetical
 * future `File Added:` cannot be silently misread as a different class.
 */
const VIOLATION_LINE = /^file (added|modified|missing):\s*(.+)$/;

/**
 * Classify `codesign --verify`'s output into the violations it reported.
 *
 * Anything that is not one of the three `file <kind>:` lines is kept as
 * `other`: `codesign` says `In subcomponent: <path>` and `resource envelope is
 * obsolete` rather than a `file` line, and a bundle carrying one of those is
 * not a bundle we should be deleting files out of. Unrecognised output is a
 * reason to refuse, never a reason to proceed.
 *
 * Pass stdout. `codesign` prints its violations on stdout and its one-line
 * verdict (`<app>: a sealed resource is missing or invalid`) on stderr, and the
 * verdict is about the bundle rather than a violation of it - classifying it as
 * `other` would make every healable bundle unhealable.
 */
export function parseSealViolations(output: string): SealViolation[] {
	const violations: SealViolation[] = [];
	for (const rawLine of output.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		const match = VIOLATION_LINE.exec(line);
		if (match) {
			violations.push({
				kind: match[1] as SealViolation["kind"],
				path: match[2].trim(),
			});
			continue;
		}
		violations.push({ kind: "other", path: line });
	}
	return violations;
}

/**
 * Canonicalise a path the way `codesign` prints it, tolerating a missing file.
 *
 * `codesign` reports canonical paths, so a bundle at `/tmp/x/App.app` is
 * reported as `/private/tmp/x/App.app/...` and a plain string comparison
 * against the bundle path we were given would never match - which would make
 * every heal refuse. The fallback chain exists because the caller may hold a
 * path that no longer resolves: try the whole path, then its directory, then
 * give up and compare what we were given.
 */
function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		try {
			return join(realpathSync(dirname(path)), basename(path));
		} catch {
			return path;
		}
	}
}

/**
 * The directory names of the bundled interpreters, under `Contents/Resources`.
 *
 * Read from the ONE definition of this layout rather than spelled again here.
 * It used to be a local `["python", "python_aarch64"]`, which was right for the
 * layout the app shipped before this change and wrong for the one it ships now:
 * the interpreter moved to `python-runtime-seed/<arch>`, the release gate's twin
 * list was updated with it, and this predicate stayed behind - so on a bundle
 * this branch builds, every `.pyc` violation was unhealable by construction and
 * the user got the reinstall refusal for a file the heal exists to delete
 * (review R10 / QA Q2). Both sides now read `bundled-python-layout.json`, so the
 * two lists cannot diverge again, and the legacy names stay in it because a
 * bundle being *replaced* may still be the old layout.
 */
const BUNDLED_PYTHON_DIRS = [
	...BUNDLED_PYTHON_LAYOUT.legacyResourceNames,
	...BUNDLED_PYTHON_LAYOUT.architectures.map(
		(arch) => `${BUNDLED_PYTHON_LAYOUT.seedNamespace}/${arch}`,
	),
];

/**
 * Whether a path is bytecode this application itself wrote into its own bundle.
 *
 * Three conditions, and together they are the whole entitlement: the path is a
 * `.pyc`, and it is at or under this bundle's own interpreter trees
 * ({@link BUNDLED_PYTHON_DIRS}, the current seed namespace and the names a
 * bundle we are *replacing* may still carry). The third - that `codesign`
 * reported it `added` - is the caller's, in `planPythonBytecodeHeal`. The heal
 * runs against an installed app that is about to be handed to ShipIt, and the
 * only thing it is entitled to delete is a `.pyc` CPython wrote into the
 * interpreter we ship. Anything else - a sealed file, an asset, a file in
 * another application's bundle - must refuse instead.
 *
 * Why there is no fourth condition on the *shape* of the path. This predicate
 * used to require a literal `__pycache__` segment, on the assumption that
 * CPython only ever writes `source/__pycache__/module.cpython-XY.pyc` beside the
 * source it imported. That assumption is wrong whenever the writing interpreter
 * runs under `PYTHONPYCACHEPREFIX`, and that is no hypothetical: the layout it
 * produces is the prefix directory followed by the *absolute source path minus
 * its root*, i.e. `<prefix>/<abs/dir>/<module>.pyc`, with no `__pycache__`
 * anywhere. The field incident of 2026-09-15 is exactly that shape - 19 added
 * files under
 * `Contents/Resources/python_aarch64/pycache/var/folders/.../T/lo-guard-real-79tKWP/modules/`
 * and `.../pycache/opt/homebrew/Cellar/python@3.14/...` - and this predicate
 * called every one of them "outside the bundled python trees", so a bundle one
 * file-deletion away from valid was reported unrepairable and the user was sent
 * to reinstall the app the heal exists to save (the start-up dialog's "it can't
 * repair itself").
 *
 * Widening it this far is not a licence to delete arbitrary files in the tree,
 * because the two remaining conditions are already sufficient:
 *
 * - nothing we ship is a `.pyc` at all, and that is enforced twice at build time
 *   (`scripts/setup-python-resource.sh`, and the release gate in
 *   `scripts/verify-macos-artifacts.mjs`), precisely because a *shipped* `.pyc`
 *   that gets rewritten is the `file modified:` class the heal can never repair.
 *   So any `.pyc` inside these trees is a cache an interpreter wrote after
 *   signing, whatever directory name it chose;
 * - and the caller only offers paths `codesign` itself reported `added` in this
 *   bundle, so this predicate never has to decide about a file that was there
 *   when the bundle was signed.
 *
 * The path separator is hardcoded because the caller is macOS-only: the probe
 * it heals from is `codesign`, which does not exist anywhere else.
 */
export function isPythonBytecodePath(
	bundlePath: string,
	candidate: string,
): boolean {
	const bundle = canonicalPath(bundlePath);
	const path = canonicalPath(candidate);
	const dirs = BUNDLED_PYTHON_DIRS.map((name) =>
		join(bundle, "Contents", "Resources", name),
	);
	const separator = "/";
	if (!path.endsWith(".pyc")) return false;
	return dirs.some((dir) => path.startsWith(`${dir}${separator}`));
}

/** What the heal decided, and why - `reason` is what goes in the log. */
export type BytecodeHealPlan = {
	healable: boolean;
	reason: string;
	/** The files to remove, in the order they were reported. Empty when refused. */
	paths: string[];
};

/**
 * Decide whether an unsealed bundle can be healed by removing bytecode.
 *
 * Healable only when there is at least one `added` violation, no `modified`,
 * `missing` or `other` violation at all, and every added path is a `.pyc` under
 * our own bundled interpreter trees. Each of those is load-bearing:
 *
 * - a `modified` violation is unhealable by deletion (measured; it becomes
 *   `file missing:`), so a bundle carrying one needs the reinstall the refusal
 *   already asks for;
 * - `missing` means something was removed after signing, which is not what
 *   bytecode writes do, and deleting more cannot restore it;
 * - `other` is `codesign` output we did not recognise - refusing is the whole
 *   reason that class exists;
 * - and at least one `added` is what makes this a bytecode break rather than
 *   something else that happens to leave an added file behind.
 *
 * The result is checked again afterwards by re-running the probe: this decides
 * only whether removing these files is allowed, never whether the bundle is
 * sealed.
 */
export function planPythonBytecodeHeal(
	bundlePath: string,
	violations: SealViolation[],
): BytecodeHealPlan {
	const added = violations.filter((violation) => violation.kind === "added");
	const elsewhere = violations.filter(
		(violation) => violation.kind !== "added",
	);
	if (added.length === 0) {
		return {
			healable: false,
			reason: `no added-resource violation to heal (${violations.length} violation(s))`,
			paths: [],
		};
	}
	if (elsewhere.length > 0) {
		const kinds = [...new Set(elsewhere.map((violation) => violation.kind))];
		return {
			healable: false,
			reason: `unhealable violation class(es) present: ${kinds.join(", ")}`,
			paths: [],
		};
	}
	const outside = added.filter(
		(violation) => !isPythonBytecodePath(bundlePath, violation.path),
	);
	if (outside.length > 0) {
		return {
			healable: false,
			reason: `added resource outside the bundled python trees: ${outside[0].path}`,
			paths: [],
		};
	}
	return {
		healable: true,
		reason: `${added.length} bytecode file(s) added after signing`,
		paths: [...new Set(added.map((violation) => violation.path))],
	};
}

/** What a heal attempt did. `removed` is what it deleted, in report order. */
export type BytecodeHealResult = BytecodeHealPlan & { removed: string[] };

/**
 * Remove the bytecode a bundle's own interpreter wrote into it.
 *
 * Removal is per FILE, never per directory, and that is a measured constraint
 * rather than a preference: `encodings/__pycache__` is one of the directories
 * that exists in the shipped bundle, and the three `.pyc` it holds are sealed
 * files. Deleting the directory takes a sealed file with it and turns a
 * recoverable bundle into an unhealable one - codesign then reports
 * `file missing:` and the seal does not come back. Deleting exactly the
 * reported added files heals it (`valid on disk`, exit 0).
 *
 * The directories the writes created are deliberately left behind: an added
 * *directory* is not a violation of a bundle's resource envelope (measured -
 * an empty `__pycache__` added after signing still verifies), so removing them
 * would be extra deletion with nothing to gain. That is the rule for every
 * shape of write, and the shape matters here: an interpreter under
 * `PYTHONPYCACHEPREFIX` leaves a whole *mirrored* tree behind
 * (`<tree>/pycache/opt/homebrew/.../lib/python3.14/json/`, one directory per
 * path component of every source it cached), which is empty of violations once
 * the `.pyc` leaves are removed and verifies exactly as the empty `__pycache__`
 * does. So the leftover directories stay, and a re-probe - not a tidy tree - is
 * what decides whether the heal worked.
 *
 * A *sealed* tree is healable, and that is a property of the seal rather than of
 * this function: the retired build-time ACL seal withheld `add_file` and
 * `add_subdirectory` from the trees' directories and `write`/`append` from the
 * bytecode already in them, and deliberately leaves `delete_child` granted -
 * unlinking is a directory right, not a file one. So both halves of the
 * guarantee hold at once: a sealed bundle cannot *gain* a `.pyc` for codesign to
 * report, and this removal still works on one that already carries it. The
 * previous revision of the seal cleared the trees' write bits instead, which
 * refuses the write and the unlink together: the heal came back
 * `healable=false removed=0` - the reinstall refusal, on exactly the install this
 * exists to repair - and `rm -rf` of the tree exited 1, so the app could not be
 * deleted either. Neither half is allowed to break the other.
 *
 * `remove` is injectable so the tests can drive every branch without a signed
 * bundle on disk; the default is the real thing. A path is re-checked against
 * `isPythonBytecodePath` immediately before it is removed, and what that buys is
 * narrower than "a stale plan is refused" (review round 1, R2): no caller can
 * supply a plan, and the plan this function computes has already passed the same
 * predicate, so with an unchanged filesystem the second call is a tautology. What
 * it is NOT is time-invariant: `isPythonBytecodePath` resolves `realpathSync` on
 * the path it is given, so the re-check re-resolves whatever the path means *now*
 * - and a component of it replaced by a symlink out of the bundle between the
 * plan and the unlink is refused then, which is the class a plan can never know
 * about. It is cheap (one stat per file, on a pass that removes a handful) and it
 * is the difference between the entitlement being read once and being read at the
 * moment of deletion, so it stays; the test "a swap under the tree between the
 * plan and the unlink refuses" is what makes it bite. A removal that throws is
 * reported as not healed with the path, because the caller's next step is a
 * re-probe and a refusal rather than a half-healed bundle it believes in.
 */
export function healPythonBytecode(
	bundlePath: string,
	violations: SealViolation[],
	remove: (path: string) => void = (path) => rmSync(path, { force: true }),
): BytecodeHealResult {
	const plan = planPythonBytecodeHeal(bundlePath, violations);
	if (!plan.healable) return { ...plan, removed: [] };

	const removed: string[] = [];
	for (const path of plan.paths) {
		if (!isPythonBytecodePath(bundlePath, path)) {
			return {
				healable: false,
				reason: `refused to remove ${path}: not bytecode under the bundled python trees`,
				paths: plan.paths,
				removed,
			};
		}
		try {
			remove(path);
			removed.push(path);
		} catch (error) {
			return {
				healable: false,
				reason: `could not remove ${path}: ${error instanceof Error ? error.message : String(error)}`,
				paths: plan.paths,
				removed,
			};
		}
	}
	return { ...plan, removed };
}

// ---------------------------------------------------------------------------
// Staged artifact verification
// ---------------------------------------------------------------------------

/** The `files[]` entry shape electron-updater parses out of the release yml. */
export type UpdateFileMetadata = {
	url: string;
	sha512?: string | null;
	size?: number | null;
};

function metadataBasenames(
	filePath: string,
	updatePath?: string | null,
): string[] {
	const names = [basename(filePath)];
	if (updatePath) names.push(basename(updatePath));
	return names;
}

/**
 * Find the release-metadata entry for a downloaded file.
 *
 * Matching on the file name rather than on the updater's private download
 * helper keeps this working for both a fresh download (where the caller has the
 * returned path) and a download staged during an earlier run.
 */
export function matchArtifactMetadata(
	filePath: string,
	files: UpdateFileMetadata[],
	updatePath?: string | null,
): UpdateFileMetadata | null {
	const names = metadataBasenames(filePath, updatePath);
	for (const name of names) {
		for (const file of files) {
			let url = file.url;
			try {
				url = decodeURIComponent(url);
			} catch {
				// A malformed percent sequence is not a reason to skip the file.
			}
			if (basename(url) === name) return file;
		}
	}
	return null;
}

export type ArtifactVerdict =
	| { ok: true; sha512: string; size: number }
	| { ok: false; block: InstallBlock };

/**
 * Free space the install needs on the volume that holds the app.
 *
 * The peak is not the download: Squirrel unpacks the new app into a staging
 * directory on the app's own volume and then swaps it in, so the artifact, the
 * staged copy of the new app and the app being replaced are all on that volume
 * at once. Hence artifact + two app copies + slack.
 *
 * The guard this replaces multiplied the ARTIFACT by three and labelled the
 * result the install's footprint - about 0.98 GiB for 0.18.0's 336 MiB zip,
 * below the roughly 1.3 GiB the swap actually needs, while the comment above it
 * claimed the 1 GiB app copy it never measured (review R4). The app's own size
 * is measured now, and the detail line shows the arithmetic that was used.
 */
export function requiredDiskBytes(input: {
	artifactSize: number;
	installedBundleSize: number;
}): number {
	return (
		input.artifactSize +
		input.installedBundleSize * 2 +
		INSTALL_DISK_SLACK_BYTES
	);
}

function formatGiB(bytes: number): string {
	return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/**
 * Bytes an installed bundle occupies, or null when it cannot be measured.
 *
 * Symlinks are counted as the links they are rather than followed: an app
 * bundle is full of them (`Versions/Current`, framework aliases) and following
 * them would both double-count and risk a cycle. The figure is therefore a
 * floor, which is the right direction for a free-space guard.
 */
export function measureDirectoryBytes(root: string): number | null {
	try {
		const stats = lstatSync(root);
		if (!stats.isDirectory()) return stats.size;
		let total = 0;
		for (const entry of readdirSync(root)) {
			const child = join(root, entry);
			let childStats: ReturnType<typeof lstatSync>;
			try {
				childStats = lstatSync(child);
			} catch {
				// A file that vanished mid-walk (a running app rotating a log) is not
				// a measurement failure; it is simply not part of the footprint.
				continue;
			}
			if (childStats.isDirectory()) {
				const nested = measureDirectoryBytes(child);
				if (nested != null) total += nested;
			} else {
				total += childStats.size;
			}
		}
		return total;
	} catch {
		return null;
	}
}

/** The version clause every refusal carries, so the user can quote it. */
function versionClause(version: string | null | undefined): string {
	return version ? ` to version ${version}` : "";
}

/**
 * Check a staged artifact against the metadata the updater already parsed.
 *
 * The disk requirement is the install's own footprint, not the download's (see
 * `requiredDiskBytes`), and the sample is honestly sized either way: when the
 * installed app cannot be measured the artifact plus slack is what the guard
 * can defend, and the detail line says so rather than implying the bigger
 * number. `version` names the release the user is being refused, which is what
 * makes a refusal quotable in a support report (review U10).
 */
export function verifyStagedArtifact(input: {
	filePath: string;
	actualSize: number;
	actualSha512: string;
	metadata: UpdateFileMetadata | null;
	freeBytes: number;
	updatePath?: string | null;
	/** Size of the app this update would replace, when it could be measured. */
	installedBundleSize?: number | null;
	/** The release being verified, for the refusal copy. */
	version?: string | null;
}): ArtifactVerdict {
	const name = basename(input.filePath);
	const version = input.version ?? null;

	if (input.metadata == null) {
		return {
			ok: false,
			block: {
				code: "artifact-metadata-missing",
				message: `The downloaded update${versionClause(version)} isn't listed in the release metadata, so it wasn't installed.`,
				remedy: {
					text: "Check for updates again to re-download the release.",
				},
				detail: `${name} has no matching entry in the update metadata.`,
			},
		};
	}

	const expectedSize = input.metadata.size ?? null;
	if (expectedSize != null && input.actualSize !== expectedSize) {
		return {
			ok: false,
			block: {
				code: "download-verification-failed",
				message: `The downloaded update${versionClause(version)} doesn't match the published release, so it wasn't installed.`,
				remedy: {
					text: "Check for updates again to re-download the release.",
				},
				detail: `${name} is ${input.actualSize} bytes; the release lists ${expectedSize}.`,
			},
		};
	}

	const expectedSha = input.metadata.sha512 ?? null;
	if (expectedSha != null && input.actualSha512 !== expectedSha) {
		return {
			ok: false,
			block: {
				code: "download-verification-failed",
				message: `The downloaded update${versionClause(version)} doesn't match the published release, so it wasn't installed.`,
				remedy: {
					text: "Check for updates again to re-download the release.",
				},
				detail: `${name} sha512 ${input.actualSha512} does not match the release's ${expectedSha}.`,
			},
		};
	}

	const artifactSize = expectedSize ?? input.actualSize;
	const installedBundleSize = input.installedBundleSize ?? 0;
	const needed = requiredDiskBytes({ artifactSize, installedBundleSize });
	if (input.freeBytes < needed) {
		const footprint = installedBundleSize
			? `${formatGiB(artifactSize)} artifact + two ${formatGiB(
					installedBundleSize,
				)} app copies + ${formatGiB(INSTALL_DISK_SLACK_BYTES)} slack`
			: `${formatGiB(artifactSize)} artifact + ${formatGiB(INSTALL_DISK_SLACK_BYTES)} slack (the installed app could not be measured)`;
		return {
			ok: false,
			block: {
				code: "insufficient-disk-space",
				message: `There isn't enough free disk space to install the update${versionClause(version)}, so it wasn't installed.`,
				remedy: {
					text: `Free up about ${formatGiB(needed - input.freeBytes)}, then check for updates again.`,
				},
				detail: `Install needs ${formatGiB(needed)} (${footprint}); ${formatGiB(input.freeBytes)} free.`,
			},
		};
	}

	return { ok: true, sha512: input.actualSha512, size: input.actualSize };
}

/**
 * Resolve the staged artifact's path, newest first.
 *
 * The updater's own download helper is the authoritative path when this run
 * downloaded the file; after a restart the file is whatever the updater left in
 * its pending cache, which is why the directory listing is the fallback.
 */
export function resolveStagedArtifactPath(input: {
	downloadHelperFile: string | null;
	pendingDir: string;
	candidateNames: string[];
	listDir: (dir: string) => string[];
}): string | null {
	if (input.downloadHelperFile && existsSync(input.downloadHelperFile)) {
		return input.downloadHelperFile;
	}
	if (input.candidateNames.length === 0 || !existsSync(input.pendingDir)) {
		return null;
	}
	const entries = input.listDir(input.pendingDir);
	for (const name of input.candidateNames) {
		const match = entries.find((entry) => entry === name);
		if (match) return join(input.pendingDir, match);
	}
	return null;
}

// ---------------------------------------------------------------------------
// Pending-install marker
// ---------------------------------------------------------------------------

export type PendingInstallMarker = {
	targetVersion: string;
	artifactPath: string;
	/** ISO timestamp of the install attempt. */
	startedAt: string;
	/** Pid of the relaunch watchdog, for the log and for a bounded reap. */
	watchdogPid: number | null;
};

export function pendingInstallMarkerPath(dir: string): string {
	return join(dir, PENDING_INSTALL_MARKER_FILE);
}

/**
 * Write the marker before the app quits.
 *
 * Written to a sibling temp file and renamed so a crash mid-write cannot leave
 * a half-parsed marker that reads as "no failed install".
 */
export function writePendingInstallMarker(
	dir: string,
	marker: PendingInstallMarker,
): PendingInstallMarker {
	mkdirSync(dir, { recursive: true });
	const target = pendingInstallMarkerPath(dir);
	const temp = `${target}.tmp`;
	writeFileSync(temp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
	renameSync(temp, target);
	return marker;
}

export function parsePendingInstallMarker(
	raw: string,
): PendingInstallMarker | null {
	try {
		const parsed = JSON.parse(raw) as Partial<PendingInstallMarker>;
		if (
			typeof parsed?.targetVersion !== "string" ||
			parsed.targetVersion.length === 0
		) {
			return null;
		}
		return {
			targetVersion: parsed.targetVersion,
			artifactPath:
				typeof parsed.artifactPath === "string" ? parsed.artifactPath : "",
			startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
			watchdogPid:
				typeof parsed.watchdogPid === "number" ? parsed.watchdogPid : null,
		};
	} catch {
		return null;
	}
}

export function readPendingInstallMarker(
	dir: string,
): PendingInstallMarker | null {
	const path = pendingInstallMarkerPath(dir);
	if (!existsSync(path)) return null;
	try {
		return parsePendingInstallMarker(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

export function clearPendingInstallMarker(dir: string): boolean {
	const path = pendingInstallMarkerPath(dir);
	if (!existsSync(path)) return false;
	rmSync(path, { force: true });
	return true;
}

// ---------------------------------------------------------------------------
// Pending SERVER-update marker
// ---------------------------------------------------------------------------

/**
 * What an app-driven SERVER update leaves on disk while it runs.
 *
 * WHY A SECOND MARKER, next to the app-install one above: the two answer
 * different questions and have different owners. The app-install marker is
 * written by the quit-and-install path and consumed by the watchdog, which owns
 * swapping the bundle. This one is written by `UpdateService.updateGlobalInstall`
 * before it runs the install's own `lop update`, and its job is the state UX U6
 * found unaccounted for: the installer is a CHILD that outlives the app when the
 * user quits mid-update (measured: the app was killed 10 s in, the child kept
 * running, and a new generation was created and flipped with no app alive). The
 * next launch then reads the end state as if it had always been that way - "the
 * install reports X, no panel" - and the user is told nothing about the update
 * THEY started, because the successful path cleared every trace of it.
 *
 * It is deliberately NOT a failure record (`recordInstallFailure` is for the
 * app's own install, whose failure leaves the app on the old build and needs a
 * remedy). A server update that lands unattended needs one sentence, not a
 * remedy, so this file is cleared by the reporting path and by every finished
 * attempt in-process.
 */
export const PENDING_SERVER_UPDATE_MARKER_FILE = "pending-server-update.json";

export type PendingServerUpdateMarker = {
	/** The install version read immediately before the installer ran. */
	before: string | null;
	/** The version the update was asked for, when the caller knew one. */
	target: string | null;
	/** ISO timestamp of the attempt. */
	startedAt: string;
	/**
	 * When the attempt's own budget expires, ISO, or null when the writer could not
	 * date it.
	 *
	 * It is what BOUNDS the record: a marker whose budget passed long ago is not
	 * evidence that anything is still running, and treating it as if it were is how
	 * a record survives its run for ever (QA round 2's finding on the withdrawn
	 * model: 8.5 hours past the deadline, every later update on every later launch
	 * refused).
	 */
	deadlineAt: string | null;
	/** The updater's process-group leader, written once it exists. */
	groupPid: number | null;
	/**
	 * The start stamp the kernel reports for that leader, taken while it is certainly
	 * alive - see `readProcessStartStamp` for why liveness alone is not identity.
	 */
	groupStartedAt: string | null;
};

export function pendingServerUpdateMarkerPath(dir: string): string {
	return join(dir, PENDING_SERVER_UPDATE_MARKER_FILE);
}

/**
 * Write the marker before the installer is spawned.
 *
 * Same temp-then-rename discipline as the app-install marker, and for the same
 * reason: a crash mid-write must not leave a half-parsed file that reads as "no
 * update was in flight".
 */
export function writePendingServerUpdateMarker(
	dir: string,
	marker: PendingServerUpdateMarker,
): PendingServerUpdateMarker {
	mkdirSync(dir, { recursive: true });
	const target = pendingServerUpdateMarkerPath(dir);
	const temp = `${target}.tmp`;
	writeFileSync(temp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
	renameSync(temp, target);
	return marker;
}

export function parsePendingServerUpdateMarker(
	raw: string,
): PendingServerUpdateMarker | null {
	try {
		const parsed = JSON.parse(raw) as Partial<PendingServerUpdateMarker>;
		/*
		 * `before` is the one field the reader acts on, and it is allowed to be
		 * null (an unreadable starting reading is a real state). So the marker is
		 * judged by the TIMESTAMP instead: a file whose attempt cannot be dated is
		 * not evidence that anything was in flight, and reporting it would be
		 * inventing an update the user never started.
		 */
		if (
			typeof parsed?.startedAt !== "string" ||
			parsed.startedAt.length === 0
		) {
			return null;
		}
		return {
			before: typeof parsed.before === "string" ? parsed.before : null,
			target: typeof parsed.target === "string" ? parsed.target : null,
			startedAt: parsed.startedAt,
			// The three identity fields are additive: a record written before they
			// existed parses as "no evidence", which is exactly what the evaluator
			// bounds by the deadline rather than by a pid.
			deadlineAt:
				typeof parsed.deadlineAt === "string" ? parsed.deadlineAt : null,
			groupPid: typeof parsed.groupPid === "number" ? parsed.groupPid : null,
			groupStartedAt:
				typeof parsed.groupStartedAt === "string"
					? parsed.groupStartedAt
					: null,
		};
	} catch {
		return null;
	}
}

export function readPendingServerUpdateMarker(
	dir: string,
): PendingServerUpdateMarker | null {
	const path = pendingServerUpdateMarkerPath(dir);
	if (!existsSync(path)) return null;
	try {
		return parsePendingServerUpdateMarker(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

export function clearPendingServerUpdateMarker(dir: string): boolean {
	const path = pendingServerUpdateMarkerPath(dir);
	if (!existsSync(path)) return false;
	rmSync(path, { force: true });
	return true;
}

/** What a pending-update marker means for a NEW attempt asking to run. */
export type PendingServerUpdateOutcome =
	| { kind: "none" }
	| {
			kind: "running";
			marker: PendingServerUpdateMarker;
			reason: "owned" | "unproven";
	  }
	| {
			kind: "expired";
			marker: PendingServerUpdateMarker;
			reason: "gone" | "foreign-pid" | "expired";
	  };

/**
 * How long past a run's own budget a record with no identity evidence may still be
 * called running.
 *
 * Not zero, because the last minutes of a run are exactly when a crash leaves the
 * record behind and the updater carries on unwatched - the case the record exists
 * for. Not unlimited, because that is the permanent refusal QA measured on the
 * withdrawn model: a record whose pid was recycled held every later update for
 * ever.
 */
export const PENDING_SERVER_UPDATE_GRACE_MS = 10 * 60_000;

/**
 * Read a pending-update record against what can be known about its process group.
 *
 * THE DECISION TABLE, in order, because the failure mode of getting it wrong is a
 * permanent refusal rather than a wrong sentence:
 *
 * 1. no group alive -> `expired/gone`. The pid is the fact the record was written
 *    from, and it is not there any more.
 * 2. the group is alive AND the stamp the record carries still matches the stamp
 *    the kernel reports for that pid -> `running/owned`. This is the only case
 *    allowed to claim a run is going without an age bound, because it is the only
 *    one with evidence the process is the one this app started: the app's own
 *    budget stops it WAITING, but nothing stops a detached updater from finishing
 *    after its app died.
 * 3. the group is alive and the stamps DIFFER -> `expired/foreign-pid`. Some
 *    process is running under that pid and it is not our updater; the number was
 *    recycled. Reported as expired so the record expires with it.
 * 4. the group is alive and there is no evidence either way - a record written
 *    before the identity fields existed, or a pid `ps` will not report ->
 *    `running` only while the record's own deadline plus `graceMs` has not
 *    passed, and `expired/expired` after it. `EPERM` counts as alive in
 *    `isInstallGroupAlive`, deliberately (a group this app may not signal is still
 *    a group), which is the other half of why the age bound has to exist.
 *
 * `now` is an input rather than `Date.now()` so the expiry is a case in a test
 * rather than a sleep.
 */
export function evaluatePendingServerUpdateMarker(input: {
	marker: PendingServerUpdateMarker | null;
	groupAlive: boolean;
	/** What `readProcessStartStamp` answers for the record's pid now, or null. */
	liveGroupStamp?: string | null;
	now?: number;
	graceMs?: number;
}): PendingServerUpdateOutcome {
	const marker = input.marker;
	if (!marker) return { kind: "none" };
	if (marker.groupPid === null || !input.groupAlive) {
		return { kind: "expired", marker, reason: "gone" };
	}
	const recorded = marker.groupStartedAt;
	const live = input.liveGroupStamp ?? null;
	if (recorded && live) {
		return recorded === live
			? { kind: "running", marker, reason: "owned" }
			: { kind: "expired", marker, reason: "foreign-pid" };
	}
	const deadline = Date.parse(marker.deadlineAt ?? "");
	const now = input.now ?? Date.now();
	const grace = input.graceMs ?? PENDING_SERVER_UPDATE_GRACE_MS;
	if (Number.isFinite(deadline) && now > deadline + grace) {
		return { kind: "expired", marker, reason: "expired" };
	}
	return { kind: "running", marker, reason: "unproven" };
}

/**
 * The last failed install, kept on disk rather than in memory.
 *
 * Why a second file: the marker is consumed at start-up - it is read, reported
 * and cleared - and the notice is delivered once per process, so dismissing the
 * panel used to be the end of the record. A user who clicked the panel's only
 * control (Dismiss) had lost which version failed, when, and how many times;
 * reviews U1 and D3 asked for the record to outlive the notification. This file
 * is that record, and Settings -> App updates reads it back.
 */
export const LAST_INSTALL_ATTEMPT_FILE = "last-update-install.json";

export type LastInstallAttempt = {
	targetVersion: string;
	runningVersion: string;
	/** When the install that failed was started, as the marker recorded it. */
	startedAt: string | null;
	/** When the failure was detected (the next start). */
	detectedAt: string;
	detail: string;
	/** How many times this same target has failed here, so "again" is a fact. */
	attempts: number;
};

export function lastInstallAttemptPath(dir: string): string {
	return join(dir, LAST_INSTALL_ATTEMPT_FILE);
}

/** Read the recorded last failure, or null when there is none to report. */
export function readLastInstallAttempt(dir: string): LastInstallAttempt | null {
	const path = lastInstallAttemptPath(dir);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(
			readFileSync(path, "utf8"),
		) as Partial<LastInstallAttempt>;
		if (
			typeof parsed?.targetVersion !== "string" ||
			parsed.targetVersion.length === 0
		) {
			return null;
		}
		return {
			targetVersion: parsed.targetVersion,
			runningVersion:
				typeof parsed.runningVersion === "string"
					? parsed.runningVersion
					: "unknown",
			startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
			detectedAt:
				typeof parsed.detectedAt === "string" ? parsed.detectedAt : "",
			detail: typeof parsed.detail === "string" ? parsed.detail : "",
			attempts:
				typeof parsed.attempts === "number" && parsed.attempts > 0
					? parsed.attempts
					: 1,
		};
	} catch {
		return null;
	}
}

/**
 * Record a failed install, counting repeats of the same target.
 *
 * The count is what turns "try again" into evidence for the user: the install
 * that keeps failing is the one that has to be replaced by hand, and the panel
 * can only say so once somebody has counted (review U1). Written temp-then-
 * rename for the same reason the marker is.
 *
 * `runningVersion` is passed in rather than carried forward from the previous
 * record. It is what Settings prints as "Version X is running", and carrying it
 * forward made a first failure on a machine record "unknown" while the panel two
 * lines above named the real version - the same event described two ways, one of
 * them wrong (QA Q1). An empty answer from the caller is the only case where the
 * previous record beats "unknown": it is at least a version this machine ran.
 */
export function recordInstallFailure(
	dir: string,
	input: {
		payload: InstallFailurePayload;
		/** The version running now, from `app.getVersion()`. */
		runningVersion: string;
		/** The marker's own start time, when it recorded one. */
		startedAt: string | null;
		detectedAt: string;
	},
): LastInstallAttempt {
	const previous = readLastInstallAttempt(dir);
	const record: LastInstallAttempt = {
		targetVersion: input.payload.targetVersion,
		runningVersion:
			input.runningVersion || previous?.runningVersion || "unknown",
		startedAt: input.startedAt,
		detectedAt: input.detectedAt,
		detail: input.payload.detail,
		attempts:
			previous && previous.targetVersion === input.payload.targetVersion
				? previous.attempts + 1
				: 1,
	};
	mkdirSync(dir, { recursive: true });
	const target = lastInstallAttemptPath(dir);
	const temp = `${target}.tmp`;
	writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
	renameSync(temp, target);
	return record;
}

export type PendingInstallOutcome =
	| { kind: "none" }
	| { kind: "succeeded"; marker: PendingInstallMarker }
	/** A marker from an install that a later one superseded: not a failure. */
	| { kind: "stale"; marker: PendingInstallMarker }
	/**
	 * An install whose ShipIt job is still loaded and whose marker is current:
	 * it is running, not failed. While this is the answer nothing may be cleared,
	 * reaped, relaunched or reported as a failure - each of those is a way to
	 * kill a live install (2026-09-13: the app was opened 4:40 in, recovery
	 * cleared the marker, removed the job and told the user the install had
	 * failed, two seconds before ShipIt aborted it).
	 */
	| { kind: "in-flight"; marker: PendingInstallMarker }
	| { kind: "failed"; marker: PendingInstallMarker };

/** `x.y.z` at the start of a version string, with an optional leading `v`. */
const VERSION_TRIPLE_REGEX = /^v?(\d+)\.(\d+)\.(\d+)/;

/**
 * Compare dotted numeric versions: -1, 0, 1, or null when either is not
 * parseable as `x.y.z`.
 *
 * Null is the honest answer for a version this cannot order - "unknown" from
 * the backend, a dev build stamp - and every caller has to decide what to do
 * with it rather than being handed a made-up ordering.
 */
export function compareVersions(a: string, b: string): number | null {
	const parse = (value: string): [number, number, number] | null => {
		const match = VERSION_TRIPLE_REGEX.exec(value.trim());
		if (!match) return null;
		return [Number(match[1]), Number(match[2]), Number(match[3])];
	};
	const left = parse(a);
	const right = parse(b);
	if (!left || !right) return null;
	for (let index = 0; index < 3; index++) {
		if (left[index] !== right[index])
			return left[index] < right[index] ? -1 : 1;
	}
	return 0;
}

/**
 * Interpret the marker on the next start.
 *
 * The running version is the only evidence available: Squirrel leaves no exit
 * status behind and `launchAfterInstallation` never ran, so "still on the old
 * version" is the whole signal that the install failed.
 *
 * That reading has one exception, and it produced a false alarm: a marker whose
 * target is OLDER than the running version describes an install that was
 * superseded (the user is on something newer), not an install that failed. It
 * used to make the app say "the update to version 0.9.0 didn't finish, so
 * version 0.17.0 is still running" (review Q2). The marker is cleared either
 * way; only the message the user sees differs.
 *
 * The second exception is `installInFlight`, and it is the 2026-09-13 incident:
 * the app that comes back WHILE ShipIt is still installing is on the old
 * version and looks exactly like a failed install from here, so "still on the
 * old version" was read as failure and recovery threw away the marker, removed
 * the live install's job and told the user it had failed. The caller supplies
 * that fact (see `isInstallInFlight`) because it is the one thing this function
 * cannot see, and the order matters: a running version that has reached the
 * target IS the install landing, however loaded the job still is, and a marker
 * the running version has moved past is superseded regardless of any job.
 */
export function evaluatePendingInstall(input: {
	marker: PendingInstallMarker | null;
	runningVersion: string;
	/**
	 * True when the caller has established that this target's install is still
	 * running (`isInstallInFlight`). Absent means "no install in flight", which
	 * is the reading for every caller that cannot probe: Windows and Linux have
	 * no launchd to ask, so there the marker can only be judged by version.
	 */
	installInFlight?: boolean;
}): PendingInstallOutcome {
	const { marker } = input;
	if (marker == null) return { kind: "none" };
	if (marker.targetVersion === input.runningVersion) {
		return { kind: "succeeded", marker };
	}
	const order = compareVersions(marker.targetVersion, input.runningVersion);
	if (order !== null && order < 0) return { kind: "stale", marker };
	if (input.installInFlight === true) return { kind: "in-flight", marker };
	return { kind: "failed", marker };
}

/**
 * How old a pending-install marker is, in seconds, or null when it is undated.
 *
 * The same rule the installer itself is judged by, so the two cannot disagree:
 * an unparseable or absent `startedAt` answers null rather than a made-up age,
 * and a caller that needs "is this current" has to decide what to do with it.
 */
export function pendingInstallAgeSeconds(
	marker: PendingInstallMarker,
	now: number = Date.now(),
): number | null {
	if (!marker.startedAt) return null;
	const started = Date.parse(marker.startedAt);
	if (Number.isNaN(started)) return null;
	return (now - started) / 1000;
}

/**
 * Whether a loaded ShipIt job plus this marker describe a live install.
 *
 * All three facts are needed and each one alone is wrong. The job alone is not
 * an answer: a failed install never unloads it (0.17.0: `runs=3114`, still
 * loaded until it was removed by hand), so treating a loaded job as an install
 * would leave the app forbidden to clean up a failure forever. The marker alone
 * is what produced the false failure on 2026-09-13. Recency is what separates a
 * live install from a leftover job, and it is deliberately generous: it outlives
 * the watchdog's own hold (see `PENDING_INSTALL_RECENCY_SECONDS`), so the app
 * the watchdog starts at its hard bound cannot read the same install as a
 * failure before it has drawn a panel.
 *
 * A marker with no readable `startedAt` is NOT current: the honest reading of
 * an undated marker is that nothing can say it is live, and the failure path -
 * which reports rather than hides, and still carries the remedy - is the safe
 * direction to be wrong in.
 */
export function isInstallInFlight(input: {
	marker: PendingInstallMarker | null;
	/** The answer the caller got from the launchd job probe. */
	jobLoaded: boolean;
	now?: number;
}): boolean {
	if (!input.marker || !input.jobLoaded) return false;
	const age = pendingInstallAgeSeconds(input.marker, input.now);
	if (age === null) return false;
	return age >= 0 && age <= PENDING_INSTALL_RECENCY_SECONDS;
}

/**
 * Whether a launchd job is loaded, from a probe the caller supplies.
 *
 * `launchctl list <label>` exits 0 while the job is loaded and 113 when it is
 * not, and that is the whole question - so the probe reports the command's exit
 * status and nothing else. It is an argument rather than a `spawnSync` here for
 * the same reason `reapFailedInstall` takes its collaborators: the contract
 * tests drive this without a launchd domain, and the only caller in production
 * is the app's own.
 *
 * A probe that could not run at all (`null`) is not an answer, and it must not
 * read as one: "cannot ask" is reported as not loaded, which is the direction
 * that lets recovery proceed, because the alternative - refusing to act on a
 * machine whose launchd is unreachable - would strand the user with a marker
 * and a job nobody ever clears.
 */
export type LaunchdJobProbe = (label: string) => number | null;

export function launchdJobLoaded(
	jobLabel: string | null,
	probe: LaunchdJobProbe,
): boolean {
	if (!jobLabel) return false;
	return probe(jobLabel) === 0;
}

export type InstallFailurePayload = {
	targetVersion: string;
	message: string;
	remedy: UpdateRemedy;
	detail: string;
	/** How many times this target has failed on this machine. */
	attempts: number;
	/**
	 * True when this process watched the install run (`in-flight`) and then found
	 * it did not finish. The app being opened is the one cause this process can
	 * attest to, so the copy for it names that rather than the generic sentence.
	 */
	cancelledByRelaunch?: boolean;
};

/**
 * When this install started, in the form a person reads.
 *
 * A shared helper rather than a line in each payload because BOTH details lines
 * end up in front of a user: the failure panel's, and the in-flight panel's,
 * whose Details block is what "Copy details" hands to a support thread. The
 * in-flight payload shipped interpolating `marker.startedAt` verbatim, so that
 * line read `Install started 2026-09-13T07:39:00.991Z from ...` and the raw
 * ISO-8601 UTC stamp wrapped mid-token in the panel's narrow details block - the
 * machine-readable form belongs in the log, not in a notice (review R1).
 *
 * The fallback is a sentence rather than an empty interpolation because a marker
 * with no start time still has to produce a readable line.
 */
export function installStartedText(marker: PendingInstallMarker): string {
	const started = marker.startedAt ? new Date(marker.startedAt) : null;
	return started && !Number.isNaN(started.getTime())
		? started.toLocaleString()
		: "at an unknown time";
}

/**
 * What the user is told after an install that did not complete.
 *
 * Two things here are deliberate. The remedy carries the download page URL so
 * the panel has a control that reaches it - the copy used to name "the update
 * prompt" while the panel's only button was Dismiss, and the user whose install
 * kept failing had no way out of the cycle (reviews U1, D3). And the timestamp
 * is rendered in the user's own locale rather than as a raw ISO-8601 UTC stamp:
 * it is read by a person, and the machine-readable form stays in the log.
 *
 * The details line also names Squirrel's own log for this install when the
 * caller can point at it. The app was dead while the install failed, so the log
 * is the only record of WHY - the refusal panel can quote an OSStatus code
 * because the app was alive to read one, and this one cannot (review U14). The
 * detail is the line the panel's copy button hands to a support thread, so it
 * has to carry the reason rather than only the artifact that was staged.
 *
 * `cancelledByRelaunch` is the one cause the app can name from its own
 * observation rather than infer from a version mismatch, and it is the incident
 * of 2026-09-13. Squirrel asks its final question - is any instance of the
 * target app running? - after moving and code-verifying the whole bundle, and
 * the operator reopening the app from Spotlight 4:40 into that window is what
 * aborted the install (`App Still Running Error`, SQRLInstallerErrorDomain -9).
 * Saying only "the update didn't finish" there hands the user a retry that will
 * fail the same way for the same reason until they are told to leave the app
 * closed. The remedy does not change: the download page is still where someone
 * whose install will not settle gets a working app.
 */
export function installFailurePayload(
	marker: PendingInstallMarker,
	runningVersion: string,
	options: {
		attempts?: number;
		shipItLogPath?: string | null;
		/** Watch this install run and then not finish, rather than guess at why. */
		cancelledByRelaunch?: boolean;
	} = {},
): InstallFailurePayload {
	const startedText = installStartedText(marker);
	const logText = options.shipItLogPath
		? ` Squirrel's own log is at ${options.shipItLogPath}.`
		: "";
	if (options.cancelledByRelaunch === true) {
		return {
			message: `The update to version ${marker.targetVersion} was cancelled because Local Operator was opened while the update was installing. Version ${runningVersion} is still running.`,
			remedy: {
				text: "Quit Local Operator and replace it in Applications with a fresh copy, or update again from the app — and leave it closed until the update finishes.",
				url: DOWNLOAD_PAGE_URL,
			},
			detail: `Install started ${startedText} from ${marker.artifactPath || "an unknown artifact"}. Squirrel cancels an install when an instance of the app is running.${logText}`,
			targetVersion: marker.targetVersion,
			attempts: options.attempts ?? 1,
			cancelledByRelaunch: true,
		};
	}
	return {
		message: `The update to version ${marker.targetVersion} didn't finish, so version ${runningVersion} is still running.`,
		remedy: {
			text: "Quit Local Operator and replace it in Applications with a fresh copy, or update again from the app.",
			url: DOWNLOAD_PAGE_URL,
		},
		detail: `Install started ${startedText} from ${marker.artifactPath || "an unknown artifact"}.${logText}`,
		targetVersion: marker.targetVersion,
		attempts: options.attempts ?? 1,
	};
}

/**
 * What the user is told when the app comes back while its install is running.
 *
 * Its own state rather than a failure, because nothing has failed: this is the
 * app that was opened mid-install, and the install is still there to be saved -
 * Squirrel only asks whether the app is running once, so quitting now can still
 * let the swap through. The message says why the app's presence matters, since
 * "quit again" without a reason is what a user reads as the app being broken.
 *
 * The Details line goes through `installStartedText` for the same reason the
 * failure's does: it is read by a person and copied into support threads, so its
 * start time is a locale string rather than the marker's raw ISO-8601 stamp
 * (review R1).
 *
 * The message names the COST of staying open rather than only the reason the
 * install is stuck. "The update can't finish while Local Operator is open" reads
 * as "not yet" - a user who needs the app now reads it as "quit later and it will
 * finish" - while Squirrel asks once whether an instance is running and abandons
 * the install when one is (the 2026-09-13 incident, and the failure state this
 * same change adds says "the update was cancelled"). The panel's secondary action
 * forfeits the install, so the sentence above it has to say so. It also no longer
 * opens by restating the panel's heading (review D1, D4).
 */
export type InstallInFlightPayload = {
	targetVersion: string;
	message: string;
	detail: string;
};

export function installInFlightPayload(
	marker: PendingInstallMarker,
	runningVersion: string,
): InstallInFlightPayload {
	return {
		targetVersion: marker.targetVersion,
		message: `Version ${marker.targetVersion} can't finish installing while Local Operator is open — keeping it open cancels the install. Quit and leave it closed until the app opens again by itself.`,
		detail: `Install started ${installStartedText(marker)} from ${marker.artifactPath || "an unknown artifact"}, while version ${runningVersion} was running.`,
	};
}

// ---------------------------------------------------------------------------
// Relaunch watchdog
// ---------------------------------------------------------------------------

/**
 * The launchd job Squirrel's ShipIt runs an install under.
 *
 * Squirrel builds this label as `<bundle id>.ShipIt` (`shipItJobLabel` in
 * SQRLShipItLauncher) and the job is submitted as part of the app's quit and
 * unloaded when the install is over. Its presence in the user's launchd domain
 * is therefore the machine's own answer to "is an install still in flight" -
 * and the answer for a *hung* install, which is the case that left the operator
 * with no app. The watchdog used to ask `pgrep -f ShipIt` instead, which matched
 * any process whose command line merely contains that word (a reviewer's
 * sampling loop held it open past the deadline; review R7).
 */
export function shipItJobLabel(bundleId: string): string {
	return `${bundleId}.ShipIt`;
}

/**
 * Squirrel's own cache directory for an app: its logs and its staged update.
 *
 * `reapFailedInstall` uses this to find the staging tree a failed install
 * leaves behind; the logs inside it are deliberately kept.
 */
export function shipItCacheDir(cacheRoot: string, bundleId: string): string {
	return join(cacheRoot, shipItJobLabel(bundleId));
}

export type WatchdogPlan = {
	/** The shell script handed to `sh -c`. */
	script: string;
	/** Environment carrying the paths, so the script's argv holds none of them. */
	env: Record<string, string>;
	/**
	 * The soft bound: the point the script stops waiting when it has no loaded
	 * job telling it an install is alive.
	 */
	timeoutSeconds: number;
	/**
	 * The hard bound: the point it stops waiting even then, so a user is never
	 * left without an app. Carried in the plan so the caller's log can state both
	 * promises rather than only the earlier one.
	 */
	hardTimeoutSeconds: number;
};

/**
 * Build the detached relaunch watchdog.
 *
 * Why the signals are what they are (each was wrong at some point, and in a way
 * that produced the operator's outcome - see the docstring in the script):
 *
 * - "has the app exited" is asked of the APP'S OWN PID with `kill -0`. The pid
 *   is captured here, by the app, before the quit. A name probe cannot answer
 *   this question: macOS `pgrep -f` does not report its own ancestors, and this
 *   script is spawned BY the app, so `pgrep -f <app path>` returned "not
 *   running" while the app was very much running (review R1, reproduced).
 * - "is the install over" is asked of the ShipIt launchd job by label AND of
 *   the version in the bundle's own Info.plist at the target path. The job
 *   alone is not an answer: a failed install never unloads it (this PR's own
 *   evidence: runs=3114, still loaded until it was removed by hand), so the job
 *   was the reason a failed install waited out the whole bound with no app on
 *   screen (review R11). The bundle's version is the swap's own state, and it
 *   is what makes an early exit safe rather than a guess - and it is read as "at
 *   or beyond the target", the same shape as the renderer's own clear rule, so a
 *   bundle already past the target is not waited out to the bound (review Q6).
 *
 * `targetVersion` is the version the update was for - the updater's advertised
 * version, which is the same fact the pending-install marker records. `null`
 * means the caller could name no version OTHER than the one already installed,
 * and the script then has only the job and the bound to go on: a target that is
 * already in place would read as "the swap landed" on the first poll.
 *
 * The paths travel in the environment rather than in the script text, as
 * before: `sh -c` puts the script in its own command line, and a script
 * carrying `/Applications/Local Operator.app/...` would show up in any process
 * listing of it.
 *
 * The two probes travel the same way, and they are the reason the plan carries a
 * platform at all (`watchdogSignals`): both are macOS tools, so the script is
 * generated for the platform it will run on rather than reading them off
 * whichever host built it. Only the app calls this in production, on macOS, and
 * it says so with `platform: "darwin"`.
 */
/**
 * The version the watchdog's on-disk swap check may be handed, or null.
 *
 * The app used to fall back to its own running version when the updater named
 * none. That target is already in place, so `swap_landed` was true on the
 * script's first poll, `decided()` returned at once and the app came back ~5 s
 * into a live install - the one outcome the on-disk check exists to prevent
 * (review R15). The pre-flight refuses an install the updater has no version
 * for, so this is belt-and-braces rather than a live path; `null` means the
 * script waits on ShipIt's job and the bound instead of on a version that can
 * say nothing.
 */
export function watchdogSwapTarget(input: {
	/** The version the update was for, when the updater named one. */
	target: string | null;
	/** The version already installed, which proves nothing about a swap. */
	running: string | null;
}): string | null {
	if (!input.target) return null;
	if (!input.running) return input.target;
	// The on-disk check reads "at or beyond the target", so a target the running
	// version is already at - or past - is a target that answers yes before the
	// install has begun.
	const order = compareVersions(input.target, input.running);
	if (order !== null && order <= 0) return null;
	if (input.target === input.running) return null;
	return input.target;
}

export type WatchdogSignals = {
	/** The command that asks launchd about a job by label, or null off macOS. */
	jobProbe: string | null;
	/** The command that reads a bundle's own Info.plist version, or null off macOS. */
	plistReader: string | null;
};

/**
 * The probes the watchdog script may use, from the platform it is planned for.
 *
 * Why the platform is carried in the plan rather than assumed: both signals the
 * script waits on are macOS tools - launchd's `launchctl list <label>` and
 * `/usr/bin/plutil` reading the bundle's own version - so a script generated on
 * a host without them asks questions nothing can answer. That is not a
 * hypothetical: the swap-landed case of the watchdog's own test asserted an
 * early exit that could only fire where `plutil` exists, passed on the developer
 * machine it was written on, and failed on `ubuntu-latest` on every push from
 * the commit that added it (`expected the swap to end the wait, took 126265ms` -
 * the read answered nothing on every poll, so the wait ran out its 120s bound).
 * A test that reads its probe availability off its own host is not a test of the
 * platform the app runs on.
 *
 * `null` means the platform has the tool nowhere, and the script treats it as an
 * unavailable signal rather than as a negative answer: no job probe cannot mean
 * "the job is not loaded", and no reader cannot mean "the swap has not landed".
 * The bound is then the only decider, which still relaunches at the deadline and
 * still never exits silently.
 */
export function watchdogSignals(platform: NodeJS.Platform): WatchdogSignals {
	if (platform !== "darwin") return { jobProbe: null, plistReader: null };
	return { jobProbe: "launchctl", plistReader: "/usr/bin/plutil" };
}

export function buildWatchdogPlan(input: {
	appBundlePath: string;
	executableName: string;
	/** The app's own pid, captured before the quit. */
	appPid: number;
	/** The launchd job label ShipIt's install runs under. */
	shipItJob: string | null;
	/** The version the install is for, for the on-disk swap check. */
	targetVersion?: string | null;
	timeoutSeconds?: number;
	intervalSeconds?: number;
	settleSeconds?: number;
	/** How long to wait for ShipIt's job to be submitted after the app exits. */
	appearSeconds?: number;
	/**
	 * How long the script waits before it tells the user the install is under
	 * way. A few seconds, because the notification has to arrive while the user
	 * is still looking at where the window was - that gap is when reopening the
	 * app feels like the right move, and reopening is what aborts the install.
	 */
	announceSeconds?: number;
	/**
	 * The last-resort bound, used only once the soft bound has arrived with the
	 * install's job still loaded. Defaults to `WATCHDOG_HARD_TIMEOUT_SECONDS`;
	 * an argument because a test cannot wait half an hour to see the difference
	 * between holding and launching.
	 */
	hardTimeoutSeconds?: number;
	/** How long the on-disk version read may take before it is killed. */
	plistReadTimeoutSeconds?: number;
	/**
	 * The platform the script is planned for. Defaults to `darwin`: this watchdog
	 * exists for Squirrel.Mac's ShipIt and nothing else, and a caller that says
	 * nothing gets the platform the feature is for.
	 */
	platform?: NodeJS.Platform;
	/**
	 * The probes to generate into the script, when the caller has its own.
	 *
	 * A seam, and the only one here: the darwin plan cannot be driven anywhere
	 * without fixtures for both probes - `/usr/bin/plutil` does not exist off
	 * macOS, and the real `launchctl` would ask the launchd domain of whoever runs
	 * the test - so the caller can substitute the two commands and the darwin
	 * branch is exercised on any host instead of only on a Mac. Production passes
	 * neither this nor `platform` and gets `watchdogSignals("darwin")`.
	 */
	signals?: WatchdogSignals;
}): WatchdogPlan {
	const signals = input.signals ?? watchdogSignals(input.platform ?? "darwin");
	const timeoutSeconds = input.timeoutSeconds ?? WATCHDOG_TIMEOUT_SECONDS;
	const hardTimeoutSeconds =
		input.hardTimeoutSeconds ?? WATCHDOG_HARD_TIMEOUT_SECONDS;
	const intervalSeconds = input.intervalSeconds ?? 3;
	const settleSeconds = input.settleSeconds ?? 5;
	const appearSeconds = input.appearSeconds ?? 30;
	const announceSeconds = input.announceSeconds ?? 5;
	const plistTimeoutSeconds =
		input.plistReadTimeoutSeconds ?? PLIST_READ_TIMEOUT_SECONDS;

	const script = `#!/bin/sh
# ${WATCHDOG_TOKEN}
#
# Why this exists: a failed Squirrel.Mac install quits the app and never brings
# it back - ShipIt logs an installation error, leaves no exit status and does not
# run the relaunch - so the user is left with no app and no message (operator
# report, 2026-09-11, errSecCSBadBundleFormat -67028).
#
# How it decides, and why each signal is the one it is:
#   - "the app has exited" is asked of the app's own pid (kill -0), captured by
#     the app before it quit. A name probe cannot answer it on macOS: pgrep -f
#     does not report its own ancestors, and this script is the app's child.
#   - "the install is over" is asked of BOTH the ShipIt launchd job, by label,
#     AND the state of the swap on disk. The job is submitted as part of the quit
#     and unloaded when an install settles, so it is the signal that separates a
#     hung install from an unrelated process that merely has the word in its
#     command line - but it is not sufficient on its own: the 0.17.0 failure
#     left its job loaded and respawning for hours (runs=3114), so waiting only
#     on the job meant waiting for the bound with the user staring at nothing
#     (review R11). The version in the target bundle's own Info.plist is what
#     says the swap landed, whether or not the job ever goes away.
#
# It starts the app in exactly one situation - the app is not running - and it
# reaches that point on three paths:
#   (a) ShipIt's job is gone: the install is decided. The conservative case.
#   (b) the bundle at the target path reports the version this update was for, or
#       one beyond it: the new app is in place and ShipIt has nothing left to do.
#       This is what makes an early exit safe rather than a guess, and it is the
#       path a failed-but-swapped install takes.
#   (c) a bound arrived with no decision. Trying is still better than leaving the
#       user with nothing, and the bound is what makes the previous version's
#       silent exit 0 impossible.
#
# (c) has a HOLD in front of it whenever the job is known and still loaded, and
# that hold is the 2026-09-13 incident written into the script. At the soft bound
# the install can be perfectly alive - that day it was, and it needed another
# four minutes to move and code-verify a 1 GiB bundle on a host at load ~95 - and
# Squirrel asks "is any instance of the target app running?" one last time before
# it swaps. A launch there is not a rescue, it is the kill: the install aborts
# (App Still Running, SQRLInstallerErrorDomain -9) and this script's own relaunch
# is the whole cause of the failure the user is then told about. So while the job
# is still loaded the script holds, says the update is still installing, and
# starts the app only at the hard bound - where a job that old is better assumed
# hung than live. (c) is therefore the ONE path that can start the app while a
# swap is still in flight - an accepted risk, now taken at the hard bound rather
# than at the soft one.
#
# It also says what is happening while it waits, because the silence is what cost
# the operator the install: the window vanishes, nothing says the install takes
# minutes, and reopening the app is the natural thing to do - which is exactly
# what aborts it. Notifying is best-effort in every sense (notifications muted,
# osascript blocked, no notifier at all), so no notification failure may change
# what this script decides or what it exits with.
#
# With no job label to ask about, the job cannot be consulted at all, so the swap
# state is the whole signal: the script waits for (b) rather than spending an
# appear window on a job it cannot see and then relaunching on no evidence.
set -u
APP_PID="\${LO_UPDATE_WATCHDOG_APP_PID:-}"
BUNDLE="\${LO_UPDATE_WATCHDOG_APP_BUNDLE:-}"
NAME="\${LO_UPDATE_WATCHDOG_APP_NAME:-}"
SHIPIT_JOB="\${LO_UPDATE_WATCHDOG_SHIPIT_JOB:-}"
TARGET_VERSION="\${LO_UPDATE_WATCHDOG_TARGET_VERSION:-}"
# The two probes, from the platform the plan was built for. Empty means the
# platform has no such tool and the signal is unavailable - not "the job is not
# loaded" and not "the swap has not landed". shipit_loaded, swap_landed and
# job_known each decline on it rather than answering, so a host without them
# waits out the bound and still relaunches.
SHIPIT_PROBE="\${LO_UPDATE_WATCHDOG_SHIPIT_PROBE:-}"
PLIST_READER="\${LO_UPDATE_WATCHDOG_PLIST_READER:-}"
if [ -z "$APP_PID" ] || [ -z "$BUNDLE" ]; then
	exit 1
fi
now() { date +%s; }
app_running() { kill -0 "$APP_PID" 2>/dev/null; }
# Tell the user what is going on, in the only way available: the app is dead
# while this runs, so this is osascript and nothing else - no app process, no
# updater. Backgrounded and status-dropped, because a notification is best-effort
# in every sense: muted Notification Center, osascript blocked by policy, or no
# notifier at all must never change what this script decides, when it retries, or
# what it exits with. The text travels as its own argument rather than inside the
# AppleScript, so no word of it needs escaping.
notify() {
	[ -n "$1" ] || return 0
	osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title (item 2 of argv)' -e 'end run' "$1" "Local Operator" >/dev/null 2>&1 &
}
# launchctl list <label> exits 0 when the job is loaded and 113 when launchd has
# no such job; every other status is not an answer at all. An unanswerable probe
# is read as "still loaded" - the safe direction - because the one decision this
# feeds here is whether to start the app into a live install, and a launchctl
# that failed for some other reason (not on PATH, a transient launchd error) must
# not be what starts it. The other direction is not licensed by it: the hard
# bound still ends the wait, so an unanswered probe costs time rather than the
# install. A definite 113 still means the install declared itself over, which is
# the one answer that ends the wait early. With no probe at all there is no
# launchd to ask, and this answers "cannot ask" rather than "not loaded":
# job_known below requires the probe for the same reason.
shipit_loaded() {
	[ -n "$SHIPIT_PROBE" ] && [ -n "$SHIPIT_JOB" ] || return 1
	"$SHIPIT_PROBE" list "$SHIPIT_JOB" >/dev/null 2>&1
	job_status=$?
	[ "$job_status" -eq 113 ] && return 1
	return 0
}
# (b), the swap's own state: is the app at the target path AT OR BEYOND the
# version this update was for? plutil rather than \`defaults read\`, which reads
# through a preference domain and can answer from a stale cache; a half-written
# plist and a missing one both read as "not landed yet", which is the safe
# direction.
#
# At or beyond rather than an exact match, because this is the same question the
# renderer's clear rule asks ("is the server no longer behind the version the
# panel named?"): a release that moves on between the offer and the check must
# not leave the app waiting out the whole bound for a bundle already past the
# target (review Q6).
version_at_least() {
	# An absent version is not a version. This is the ONE input the two halves
	# answer differently on, deliberately: the renderer pads a missing side with
	# zero (\`left[index] ?? 0\`), so it reads an empty target as "at least 0",
	# while a rule that can start a relaunch must not call a version nobody
	# reported "landed". Both callers prove the operand non-empty first - the
	# script's \`swap_landed\` declines an empty target outright and the read
	# answers nothing rather than a version - so no path reaches this with one.
	[ -n "$1" ] && [ -n "$2" ] || return 1
	# Exact match first, as the renderer's rule does: a pre-release pair that
	# matches exactly IS the version that was waited for, and the digit checks
	# below cannot order a suffix at all. The caller strips a leading \`v\` before
	# calling, which is the other half of what the renderer's rule does itself.
	[ "$1" = "$2" ] && return 0
	# Anything else carrying a suffix is not orderable here, and the renderer's
	# rule refuses the same inputs for the same reason ("keeps the instruction on
	# screen rather than clearing over a real gap"). Answered before the digit
	# walk, because a suffix the unrelated leading numeric components never reach
	# would otherwise be ignored - \`1.0.0\` against \`0.18.0-rc1\` compared as
	# landed here and as not-beyond there. Not-landed is the safe direction in
	# this script: the job and the bound still decide, and the app still comes
	# back.
	case "$1$2" in *-*) return 1 ;; esac
	_va="$1"
	_vb="$2"
	while :; do
		case "$_va" in
			*.*) _ha="\${_va%%.*}"; _va="\${_va#*.}" ;;
			*) _ha="$_va"; _va="" ;;
		esac
		case "$_vb" in
			*.*) _hb="\${_vb%%.*}"; _vb="\${_vb#*.}" ;;
			*) _hb="$_vb"; _vb="" ;;
		esac
		# A component with no digits in it is a pre-release suffix, which this
		# cannot order: it reads as "not landed", so the job and the bound stay
		# the deciders. Same shape as the renderer's rule.
		case "$_ha" in *[!0-9]*) return 1 ;; esac
		case "$_hb" in *[!0-9]*) return 1 ;; esac
		# A side that has run out contributes zero, which is what the renderer's
		# \`left[index] ?? 0\` does, so unequally wide dotted versions order the
		# same way in both halves of "at or beyond". Without this, \`0.18.0.1\`
		# against \`0.18.0\` read as not-landed here and as landed there (review
		# round 4, M3): the safe direction is not a reason to leave two
		# implementations of one rule disagreeing.
		[ -n "$_ha" ] || _ha=0
		[ -n "$_hb" ] || _hb=0
		if [ "$_ha" -gt "$_hb" ]; then return 0; fi
		if [ "$_ha" -lt "$_hb" ]; then return 1; fi
		if [ -z "$_va" ] && [ -z "$_vb" ]; then return 0; fi
	done
}
# Read the bundle's version under a hard time bound. This sits inside the poll
# loop, and an unbounded read of a path on a mount that has stopped answering
# would outlive the script's own deadline and leave the user with no app - the
# very outcome this script exists to undo. macOS ships no \`timeout(1)\`, so the
# bound is a background read the script can stop waiting on (review R17).
bundle_version() {
	_plist="$BUNDLE/Contents/Info.plist"
	# A plist that is not readable yet - the ordinary state while a swap is in
	# flight - answers without starting a read at all, so the bound below is only
	# ever spent on a read that started and did not answer.
	[ -r "$_plist" ] || return 1
	_stamp="$$-$(now)"
	_out="\${TMPDIR:-/tmp}/lo-update-watchdog-version-$_stamp.out"
	# The pid the bound kills IS the reader: \`exec\` replaces the subshell rather
	# than wrapping the reader, so nothing is reparented when the kill lands. The
	# previous shape killed a subshell whose whole job was to drop a completion
	# marker, and the read that subshell had forked was left blocked under pid 1 -
	# one more per poll, for as long as the mount stayed dead (review round 4,
	# Q7). Completion is read off the answer itself instead: the reader writes the
	# version into this file and nothing else does, so bytes in it mean the read
	# answered, and a read that fails writes none and is stopped by the same
	# deadline.
	( exec "$PLIST_READER" -extract CFBundleShortVersionString raw -o - "$_plist" ) >"$_out" 2>/dev/null &
	_read_pid=$!
	_waited=0
	while [ ! -s "$_out" ]; do
		if [ "$_waited" -ge ${plistTimeoutSeconds} ]; then
			kill -9 "$_read_pid" 2>/dev/null
			rm -f "$_out"
			return 1
		fi
		sleep 1
		_waited=$((_waited + 1))
	done
	_version="$(cat "$_out" 2>/dev/null)"
	rm -f "$_out"
	[ -n "$_version" ] || return 1
	printf '%s\n' "$_version"
}
swap_landed() {
	# A platform with no plist reader cannot ask this question at all, and the
	# answer it must not give is "not landed yet" either: the signal is declined
	# and the job and the bound decide instead. \`bundle_version\` is only ever
	# reached from here.
	[ -n "$PLIST_READER" ] || return 1
	[ -n "$TARGET_VERSION" ] || return 1
	installed=$(bundle_version) || return 1
	installed=\${installed#v}
	[ -n "$installed" ] || return 1
	target=\${TARGET_VERSION#v}
	[ "$installed" = "$target" ] && return 0
	version_at_least "$installed" "$target"
}
job_known=0
[ -n "$SHIPIT_PROBE" ] && [ -n "$SHIPIT_JOB" ] && job_known=1
decided() {
	if [ "$job_known" -eq 1 ] && ! shipit_loaded; then return 0; fi
	swap_landed && return 0
	return 1
}
deadline=$(( $(now) + ${timeoutSeconds} ))
hard_deadline=$(( $(now) + ${hardTimeoutSeconds} ))
# 1. The install only starts once the old app has exited.
while app_running; do
	if [ "$(now)" -ge "$deadline" ]; then break; fi
	sleep ${intervalSeconds}
done
# 1b. The app is gone, so an install is at work: say so a few seconds in, so the
#     window that just vanished comes with an explanation. This is the moment the
#     operator of 2026-09-13 was left guessing, and reopening the app four
#     minutes later is what aborted their install. Skipped when the app is still
#     running - a quit the user cancelled, where nothing is being installed and
#     nothing should be claimed.
if ! app_running; then
	sleep ${announceSeconds}
	notify "Installing the update. Keep Local Operator closed until it opens again by itself — this can take a few minutes."
fi
# 2. ShipIt's job is submitted as part of the quit, so it may not be loaded the
#    instant the app is gone: give it a bounded window to appear before treating
#    "no job" as "the install is over". Skipped when there is no label to ask
#    about: an appear window for an unaskable job is 30s of pretending, and it
#    used to end by relaunching with no evidence about the install at all.
if [ "$job_known" -eq 1 ]; then
	appear_deadline=$(( $(now) + ${appearSeconds} ))
	while ! shipit_loaded; do
		if [ "$(now)" -ge "$appear_deadline" ] || [ "$(now)" -ge "$deadline" ]; then break; fi
		sleep ${intervalSeconds}
	done
fi
# 3. Wait for the install to be decided - by the job going, or by the swap
#    landing. The soft bound ends this wait only when there is no loaded job
#    answering for the install: see the hold below.
holding=0
while :; do
	if decided; then break; fi
	if [ "$(now)" -ge "$deadline" ]; then
		if [ "$job_known" -eq 1 ] && shipit_loaded; then
			holding=1
			notify "The update is still installing. Keep Local Operator closed; it will open again when the install finishes."
		fi
		break
	fi
	sleep ${intervalSeconds}
done
# 3b. The hold. The soft bound arrived with the install's job still loaded, so
#     the install is alive and a launch here is what aborts it: Squirrel's last
#     question before it swaps is whether any instance of the app is running,
#     and on 2026-09-13 our own relaunch was the instance that answered yes. The
#     job going or the swap landing still ends this at once - both are decisions
#     the install made - and otherwise the hard bound does, which is where
#     "better a live swap than no app at all" takes over.
#
#     The hard bound's notice names the action the panel will ask for instead of
#     a different one. What the user sees next is the app coming back with the
#     in-flight panel, whose copy is "quit and leave it closed until the app
#     opens again by itself" - so a notice that ended "check for updates when it
#     is back" told them the install was over at the exact moment the app was
#     about to say it was still running, and two authorities seconds apart with
#     opposite instructions is worse than either alone (UX U10). The notice now
#     states what is happening and hands over to that panel rather than
#     pre-empting it: the instruction the user acts on is the panel's, and it is
#     the correct one - quitting again is what lets the swap finish.
if [ "$holding" -eq 1 ]; then
	while :; do
		if decided; then break; fi
		if [ "$(now)" -ge "$hard_deadline" ]; then
			notify "The update is taking longer than expected. Local Operator is opening again so you are not left without it — if it says the update is still installing, quit it and leave it closed until the install finishes."
			break
		fi
		sleep ${intervalSeconds}
	done
fi
# Let Squirrel's own relaunch (which happens as the job finishes) land first.
sleep ${settleSeconds}
# 4. Nothing to do if Squirrel relaunched the app or the user started it. This is
#    what makes the script a no-op when the install succeeded, by construction
#    rather than by claim.
if app_running; then exit 0; fi
if [ -n "$NAME" ] && [ -x "$BUNDLE/Contents/MacOS/$NAME" ]; then
	open -a "$BUNDLE" >/dev/null 2>&1 || "$BUNDLE/Contents/MacOS/$NAME" >/dev/null 2>&1 &
fi
exit 0
`;

	return {
		script,
		env: {
			LO_UPDATE_WATCHDOG_APP_PID: String(input.appPid),
			LO_UPDATE_WATCHDOG_APP_BUNDLE: input.appBundlePath,
			LO_UPDATE_WATCHDOG_APP_NAME: input.executableName,
			LO_UPDATE_WATCHDOG_SHIPIT_JOB: input.shipItJob ?? "",
			LO_UPDATE_WATCHDOG_TARGET_VERSION: input.targetVersion ?? "",
			// Empty off macOS, which the script reads as "this signal is not available
			// here" rather than as a negative answer (see `watchdogSignals`).
			LO_UPDATE_WATCHDOG_SHIPIT_PROBE: signals.jobProbe ?? "",
			LO_UPDATE_WATCHDOG_PLIST_READER: signals.plistReader ?? "",
		},
		timeoutSeconds,
		hardTimeoutSeconds,
	};
}

export type FailedInstallReap = {
	jobLabel: string | null;
	jobRemoved: boolean;
	removedStaging: string[];
	errors: string[];
};

/**
 * The outcome of removing one staged update tree.
 *
 * `removed` is about the filesystem, not about the call: a tree that is gone
 * after a failed attempt HAS been removed, whatever the error said.
 */
export type StagedTreeRemoval = {
	removed: boolean;
	attempts: number;
	error: string | null;
};

/**
 * Remove a staged update tree, retrying the race that beat `rmSync`.
 *
 * Why this is not one `rmSync` call: on 2026-09-13 the reap logged
 * `ENOTDIR: not a directory, rmdir '.../update.tsRsfCm/Local Operator.app/Contents/Resources/app.asar'`
 * and left ~1 GiB of staged update in the cache.
 * That is a race, not a permission problem - ShipIt was moving that same tree
 * into place at that instant (the reap ran at 09:44:05, two seconds before the
 * install aborted), so an entry readdir had just reported as a directory was a
 * regular file by the time rmdir reached it. Node's own `rmSync` retries
 * EBUSY/EMFILE/ENFILE/ENOTEMPTY/EPERM and not ENOTDIR, and its `force: true`
 * suppresses ENOENT rather than a type change, so the retry has to live here.
 *
 * Both halves of the pair are checked, because either can be the truth after a
 * failed call: the removal may have succeeded despite the error (the tree was
 * already consumed by the install it belonged to), and the retry may succeed
 * once the rename has settled. A failure that survives every attempt is
 * returned as `removed: false` with the real error text - the caller still
 * reports it, because a staged tree that cannot be removed is the thing the
 * user's disk is quietly paying for.
 */
export function removeStagedTree(input: {
	path: string;
	/** The removal itself, as the app really does it (`rmSync(..., {recursive})`). */
	remove: (path: string) => void;
	exists: (path: string) => boolean;
	/** Attempts in total, including the first. */
	attempts?: number;
	delayMs?: number;
	/** The wait between attempts, injectable so a test does not spend it. */
	sleep?: (ms: number) => void;
}): StagedTreeRemoval {
	const attempts = input.attempts ?? 3;
	const delayMs = input.delayMs ?? 250;
	const sleep = input.sleep ?? defaultSleep;
	let error: string | null = null;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			input.remove(input.path);
		} catch (thrown) {
			error = String(thrown);
		}
		// Checked after a call that threw as well as after one that did not: the
		// tree being gone is the answer this function exists to report, and a
		// second removal attempt on a path that no longer exists is noise.
		if (!input.exists(input.path)) {
			return { removed: true, attempts: attempt, error: null };
		}
		if (attempt < attempts) sleep(delayMs);
	}
	return {
		removed: false,
		attempts,
		error: error ?? `the staged tree at ${input.path} is still there`,
	};
}

/**
 * A synchronous wait, for the retry above.
 *
 * Synchronous on purpose: `removeStagedTree` is called from the start-up reap,
 * which is synchronous, and the alternative - spawning `/bin/sleep` - pays a
 * process to do nothing. `Atomics.wait` on a scratch buffer is the one sleep
 * available to a single-threaded caller, and it never actually waits on a value
 * that could be notified: the buffer is private and uncontended, so it expires.
 */
function defaultSleep(ms: number): void {
	if (ms <= 0) return;
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The removal the reap really performs, with the retry above and the real fs.
 *
 * A function of its own so the production call site is one line and the tests
 * drive the same code rather than a copy of it - the copy is how a fix for this
 * can pass its own test and still leave the staged tree on the machine.
 */
export function reapStagedTree(path: string): void {
	const removal = removeStagedTree({
		path,
		remove: (target) => rmSync(target, { recursive: true, force: true }),
		exists: (target) => existsSync(target),
	});
	if (!removal.removed) {
		throw new Error(removal.error ?? `could not remove ${path}`);
	}
}

/**
 * Clean up what a failed Squirrel install leaves running on the user's machine.
 *
 * Why the product has to do this: on the operator's machine the 0.17.0 failure
 * left the ShipIt launchd job loaded in their user domain, respawning every
 * ~2.5 s (`runs=3114`, `LastExitStatus=256`) and appending `Could not read
 * update request` to `ShipIt_stderr.log` until it was 3.4 MB - with the staged
 * update tree still beside it. Squirrel retires that job when an install
 * finishes; when an install fails it simply stays, and a job in a respawn loop
 * is not something to leave on someone's machine because an updater fell over.
 * It was removed by hand during round 1 of the review; the app does it now.
 *
 * Deliberately narrow, and deliberately not silent: this app's own ShipIt job
 * by label, and the `update.*` staging directories under that same app's ShipIt
 * cache directory. The ShipIt logs are NOT touched - they are the only record of
 * why the install failed, and the failure detail points at them.
 *
 * Every step takes its collaborator as an argument so the contract tests can
 * drive it against a temporary tree instead of the developer's launchd domain.
 */
export function reapFailedInstall(input: {
	bundleId: string | null;
	cacheRoot: string | null;
	removeJob: (label: string) => { notFound: boolean; output: string };
	exists: (path: string) => boolean;
	listDir: (dir: string) => string[];
	removeDir: (path: string) => void;
	log: (message: string) => void;
}): FailedInstallReap {
	const result: FailedInstallReap = {
		jobLabel: null,
		jobRemoved: false,
		removedStaging: [],
		errors: [],
	};
	if (!input.bundleId) {
		// Without the bundle id there is no label to remove and no cache directory
		// to look in. Guessing one (or removing by process name) is exactly the
		// over-reach this whole change is undoing.
		input.log(
			"Skipped cleaning up the failed install: the app's bundle id could not be read.",
		);
		return result;
	}

	const label = shipItJobLabel(input.bundleId);
	result.jobLabel = label;
	try {
		const removal = input.removeJob(label);
		result.jobRemoved = !removal.notFound;
		input.log(
			removal.notFound
				? `Leftover install job ${label} was not loaded.`
				: `Removed the leftover install job ${label}.`,
		);
	} catch (error) {
		// A launchd domain that refuses to answer is not a reason to fail the
		// start-up path; it is a reason to say so in the log.
		result.errors.push(`launchctl remove ${label}: ${String(error)}`);
		input.log(
			`Could not remove the leftover install job ${label}: ${String(error)}`,
		);
	}

	const cacheDir = input.cacheRoot
		? shipItCacheDir(input.cacheRoot, input.bundleId)
		: null;
	if (!cacheDir) return result;
	try {
		if (!input.exists(cacheDir)) return result;
		for (const entry of input.listDir(cacheDir)) {
			if (!entry.startsWith("update.")) continue;
			const staging = join(cacheDir, entry);
			try {
				input.removeDir(staging);
				result.removedStaging.push(staging);
				input.log(`Removed the staged update left behind at ${staging}.`);
			} catch (error) {
				result.errors.push(`${staging}: ${String(error)}`);
				input.log(`Could not remove ${staging}: ${String(error)}`);
			}
		}
	} catch (error) {
		result.errors.push(`${cacheDir}: ${String(error)}`);
		input.log(`Could not inspect ${cacheDir}: ${String(error)}`);
	}
	return result;
}

/**
 * Decide whether a recorded watchdog pid is still ours.
 *
 * Killing by pid alone would be unsafe after a pid reuse, so the decision also
 * requires the process's command line to still contain the script's sentinel.
 */
export function watchdogIsOurs(input: {
	alive: boolean;
	commandLine: string | null;
	installSucceeded: boolean;
}): boolean {
	if (!input.alive || !input.installSucceeded) return false;
	return (input.commandLine ?? "").includes(WATCHDOG_TOKEN);
}

// ---------------------------------------------------------------------------
// Backend update planning
// ---------------------------------------------------------------------------

export type BackendRemedyKind =
	| "managed"
	| "external"
	| "uv-tool"
	| "pipx"
	| "pip"
	| "editable"
	| "global-unknown";

/**
 * What a global `local-operator` install actually is.
 *
 * Mirrors `local_operator/update.py`'s `install_kind()` on the Python side - same
 * six outcomes for the same reasons - because the app and the server have to
 * agree about who owns the environment before either names a command for it.
 */
export type GlobalInstallKind = Exclude<
	BackendRemedyKind,
	"managed" | "external"
>;

export type BackendPlan = {
	canManageUpdate: boolean;
	updateCommand: string;
	remedy: string;
	detail: string;
	/**
	 * Whether this install follows a source tree on this machine rather than the
	 * published release - a uv tool built by `lop-update`, or the checkout
	 * itself.
	 *
	 * Why the prompt needs to know: for these installs the version the server
	 * reports afterwards is the CHECKOUT's, which is not the version the app
	 * offered, so a closing line promising "the new server version" promises
	 * something this install may never reach (review U12). The detail line and
	 * the closing sentence both say so instead.
	 */
	sourceBuild: boolean;
	/**
	 * WHICH managed route the app runs, when `canManageUpdate` is true.
	 *
	 * `entry-point` is the install's own front end, `<resolved console script>
	 * update`, which is the only route for a host on the generation layout: it
	 * detects the kind, writes the `.lop-source` marker runtimes converge on, and
	 * lands the install in a tree no running process is reading.
	 *
	 * `source-build` is `lop-update` - the checkout rebuild - and it exists because
	 * a uv tool BUILT FROM THIS MACHINE's checkout is a different audience. The
	 * entry point installs the PUBLISHED WHEEL over such an install (the harness
	 * prints the same notice), which is the right answer for a released install and
	 * the wrong one for the operator's own: their `.lop-source` names a git sha and
	 * `lop-update` is the tool that maintains it, so refusing to run anything left
	 * the panel instructing them to paste the command themselves. This route runs
	 * that same tool, and only that tool: with `lop-update` absent from the machine
	 * the arm falls back to the refusal and the command, unchanged.
	 *
	 * null for every refusal, which is what the surfaces read.
	 */
	managedRoute: "entry-point" | "source-build" | null;
	/**
	 * The install tree the managed route rewrites, when it may rewrite one.
	 *
	 * It is where that route's EVIDENCE lives, and the two routes read different
	 * evidence on purpose: the entry point moves the install's VERSION, while a
	 * rebuild of the checkout usually keeps the version (the checkout's
	 * `pyproject.toml` names the last release) and moves `.lop-source`'s ref - so a
	 * version comparison would report a successful rebuild as a failure.
	 */
	installPrefix: string | null;
};

/**
 * The evidence a global install's kind is decided from.
 *
 * Why the path alone is not enough: both `uv tool` and `pipx` install a console
 * SCRIPT into `~/.local/bin`, so the string `which local-operator` prints
 * contains neither `/uv/tools/` nor `/pipx/venvs/`. On the operator's machine it
 * is `/Users/<user>/.local/bin/local-operator`, a symlink into the uv tool
 * environment - and matching markers against that string classified their own uv
 * tool install as unknown and told them to run pip, which is the command from
 * the incident report (review R2).
 *
 * The `uv`/`pipx` outputs are consulted last and only when the cheaper signals
 * have declined, matching the Python implementation's order.
 */
export type InstallIdentity = {
	/** The path `which local-operator` returned, shim and all. */
	path: string | null;
	/** `realpathSync` of that path, when it resolves somewhere else. */
	realPath?: string | null;
	/** First line of the file at `path`: a console script's own shebang. */
	shebang?: string | null;
	/** A `uv-receipt.toml` beside the resolved install, when one exists. */
	uvReceipt?: string | null;
	/** A `pyvenv.cfg` in the prefix the script lives in, when one exists. */
	venvPrefix?: string | null;
	/**
	 * Lower-cased `INSTALLER` from the `local-operator` dist-info beside the
	 * resolved install, when there is one.
	 *
	 * Why a file read and not another layout test: pip, uv and pipx each write
	 * it, so it states outright which tool owns the install. The Python side
	 * consults it last and only for the exact value `pip` - a `mise`, `pyenv` or
	 * `asdf` toolchain installs into a BASE prefix that writes no
	 * `pyvenv.cfg` (#396), and `pip install --upgrade` is the right command
	 * there. Without it the app called that install `global-unknown` and named
	 * no command at all, which is where this began to diverge from the server
	 * (review R13).
	 */
	installer?: string | null;
	/**
	 * Whether the dist-info's `direct_url.json` marks this install editable.
	 *
	 * PEP 610/660: `dir_info.editable` is what pip and uv write for `-e`, and it
	 * is the only POSITIVE evidence that an install is a checkout rather than an
	 * installed distribution. The Python side answers `editable` - a refusal -
	 * before any layout probe, and `pyvenv.cfg` alone cannot tell the two apart:
	 * a developer's repo `.venv` has one, so the app classified it `pip` and
	 * told them to install a wheel over their own checkout (review Q5).
	 */
	editable?: boolean;
	/**
	 * The distribution version this install reports, from its dist-info name.
	 *
	 * Read shell-free and kept apart from the running daemon's `/health` version
	 * on purpose: `/health` describes the install a PROCESS was started from, and
	 * the install on disk is what an update moves. Right after an update those two
	 * disagree until the daemon is restarted, and a panel that cannot name both
	 * describes one install as if it were the other.
	 */
	version?: string | null;
	/**
	 * The first token of `.lop-source` at this install's venv root, or null.
	 *
	 * The install's provenance rather than the machine's: see
	 * `isSourceBuildRef` for why the token, and not the presence of a
	 * `lop-update` script, is the signal.
	 */
	sourceRef?: string | null;
	/** `uv tool list` output, when the uv CLI could be run. */
	uvToolList?: string | null;
	/** `pipx list` output, when the pipx CLI could be run. */
	pipxList?: string | null;
};

/** `uv tool list` names each tool as `local-operator v0.54.20` on its own line. */
const UV_TOOL_LIST_ENTRY_REGEX = /(^|\n)local-operator v\d/i;

/** `pipx list` names its environment as `package local-operator 0.54.20, ...`. */
const PIPX_LIST_ENTRY_REGEX = /(^|\n)\s*package local-operator\b/i;

/**
 * `uv tool list` names each tool as `local-operator v0.54.20` on its own line;
 * anchored there so a version string that merely mentions the name cannot match.
 */
function uvToolListNamesLocalOperator(
	output: string | null | undefined,
): boolean {
	return UV_TOOL_LIST_ENTRY_REGEX.test(output ?? "");
}

/** `pipx list` names its environment as `package local-operator 0.54.20, ...`. */
function pipxListNamesLocalOperator(
	output: string | null | undefined,
): boolean {
	return PIPX_LIST_ENTRY_REGEX.test(output ?? "");
}

/** `<prefix>/lib/pythonX.Y` — the POSIX interpreter directory of a prefix. */
const PYTHON_LIB_DIR = /^python\d/;

/** A dist-info for this package, under either name normalisation. */
const LOCAL_OPERATOR_DIST_INFO = /^local[-_]operator[-_]/;

/**
 * The first token `lop-update` writes into `.lop-source` for a PyPI install.
 *
 * Mirrors `PYPI_SOURCE_TOKEN` in `local_operator/update.py`: a sentinel rather
 * than a fake commit, because a wheel genuinely has no git ref and copying the
 * previous install's sha forward is the lie the marker exists to stop.
 */
const PYPI_SOURCE_TOKEN = "pypi";

/** `<prefix>/.lop-source`'s token list: whitespace-separated, two tokens at most. */
const SOURCE_MARKER_SEPARATOR = /\s+/;

/**
 * Whether a `.lop-source` token names a git commit, as opposed to a sentinel.
 *
 * Mirrors `_looks_like_git_sha` in `local_operator/update.py`, shape for shape:
 * 7-40 hex characters is a commit, and `pypi` (or an unrecognised token, or no
 * file at all) is a release build. Discriminating on SHAPE rather than on an
 * allow-list is what lets the two writers - `lop-update` and `lop update` -
 * agree on nothing but the format, and it is why a future sentinel must not be
 * hex: it would read as a commit rather than degrading to "no ref".
 *
 * Why this predicate exists at all: the source-build sentence has to describe
 * the INSTALL. The signal it replaces - "a `lop-update` script exists on this
 * machine" - was a fact about the machine, so an install that had already been
 * replaced by a wheel was still described to its owner as following a checkout.
 */
export function isSourceBuildRef(token: string | null | undefined): boolean {
	if (typeof token !== "string") return false;
	const trimmed = token.trim();
	if (trimmed.length < 7 || trimmed.length > 40) return false;
	for (const char of trimmed) {
		if (!"0123456789abcdefABCDEF".includes(char)) return false;
	}
	// `pypi` cannot reach here - it is not hex - and the check is written out
	// anyway so a reader does not have to prove that to themselves.
	return trimmed.toLowerCase() !== PYPI_SOURCE_TOKEN;
}

/**
 * The first whitespace-delimited token of `<prefix>/.lop-source`, or null.
 *
 * The marker sits at the venv root beside the interpreters and names what is
 * installed there: `<git-sha> <ref>` from `lop-update`, `pypi <version>` from
 * `lop update`. Absent (never upgraded through either writer, an editable
 * checkout), unreadable, or empty all answer null - "no provenance" is a real
 * answer, and the caller renders it as a release build rather than as a guess.
 */
export function readSourceRef(prefix: string): string | null {
	try {
		const raw = readFileSync(join(prefix, ".lop-source"), "utf8");
		const token = raw.split(SOURCE_MARKER_SEPARATOR).filter(Boolean)[0];
		return token && token.length > 0 ? token : null;
	} catch {
		// Missing or unreadable: a fact about the install we can support (absent),
		// and not a failure worth propagating out of a version check.
		return null;
	}
}

/**
 * What `<prefix>/.lop-source` says, and when it last said it.
 *
 * THE EVIDENCE A REBUILD MOVES, and the two fields are there because neither alone
 * is enough. The REF is the identity of the commit that was installed - it is what
 * makes an update that landed distinguishable from one that did not, where the
 * VERSION cannot be: a checkout's `pyproject.toml` names the last release, so a
 * successful rebuild of `main` usually reports the same `0.56.x` it reported
 * before, and comparing versions would call that a failure. The MTIME is the
 * fallback for the case the ref cannot answer - a marker written by an older
 * tool, or a rebuild that landed the same commit again after a `reset` - and it is
 * read from the same stat call, so a caller never has to decide which to ask for.
 *
 * `prefix` is a parameter and null is an answer, not an error: the caller resolves
 * the install's prefix freshly on every read rather than holding the one its check
 * saw, because the generations swap moves the tree the prefix names.
 */
export type SourceMarkerState = {
	ref: string | null;
	mtimeMs: number | null;
};

export function readSourceMarkerState(
	prefix: string | null,
): SourceMarkerState {
	if (!prefix) return { ref: null, mtimeMs: null };
	const marker = join(prefix, ".lop-source");
	try {
		const stat = statSync(marker);
		return { ref: readSourceRef(prefix), mtimeMs: stat.mtimeMs };
	} catch {
		return { ref: null, mtimeMs: null };
	}
}

/**
 * Whether a rebuild of the checkout landed, judged by the marker rather than by a
 * version.
 *
 * The rule, in the order it is applied: a changed REF is a landed rebuild, whatever
 * the versions say; when either reading has no ref to compare, an ADVANCED mtime
 * is; and a marker that was ABSENT before and present now is one too, because that
 * is what the first rebuild of an editable-style prefix looks like. Everything else
 * is not-landed - including the case where the after reading is absent entirely,
 * which means the tool removed the marker or the prefix could not be read, and a
 * failure is the honest answer to both.
 */
export function didSourceRebuildLand(input: {
	before: SourceMarkerState;
	after: SourceMarkerState;
}): boolean {
	const { before, after } = input;
	const hadMarker = before.ref !== null || before.mtimeMs !== null;
	const hasMarker = after.ref !== null || after.mtimeMs !== null;
	if (!hasMarker) return false;
	if (!hadMarker) return true;
	if (before.ref !== null && after.ref !== null) {
		return before.ref !== after.ref;
	}
	if (before.mtimeMs !== null && after.mtimeMs !== null) {
		return after.mtimeMs > before.mtimeMs;
	}
	return false;
}

/**
 * A line that tells the reader to go around a guard the installer just applied.
 *
 * `lop-update` refuses a ref that is behind or diverged FROM ITS OWN GATE and then
 * closes its message with how to bypass that gate (`--skip-remote-check`, and the
 * same spelling for `--allow-downgrade` and any `--force`). That line is the LAST
 * line of its output and it is the one thing this module must never put in front of
 * the user as their remedy: it recommends disabling the check that just protected
 * them (review round 2, U7 - measured on the operator's own refusal, 18 lines whose
 * head carries the diagnosis and whose tail carries the bypass).
 */
const GUARD_BYPASS_ADVICE =
	/--skip-[a-z-]+|--allow-downgrade|--force\b|--no-verify|--ignore-checks/i;

/**
 * A line that is an instruction to run something in a terminal.
 *
 * The refusal's body is addressed to a person at a shell - `git -C ... fetch`,
 * `lop-update <ref>` - and those belong to the by-hand path the panel already
 * offers, not to the diagnosis. They also nest a `lop-update` line inside a message
 * ABOUT a `lop-update` run, which reads as the app telling itself what to do.
 *
 * AN INSTALLER'S OWN DIAGNOSTICS ARE NOT INSTRUCTIONS, and the lookahead is what
 * draws that line: `lop-update: REFUSING to release a stale ref.` is the tool
 * SPEAKING (and the one line this function exists to keep), while `lop-update main
 * --skip-remote-check` is the tool being RUN. Without it the first message line
 * would end the head at the warning above it and the verdict would be lost.
 */
const TERMINAL_INSTRUCTION =
	/^(?!\S+:\s)(?:git|lop-update|uv|pip|pipx|python\d?|sudo)\b/i;

/**
 * The installer's own diagnosis, chosen by where the diagnosis IS rather than by
 * where its output ended.
 *
 * WHY NOT A TAIL (`stderrTail`). An installer's last line is its exit reason for a
 * crash - `installer exited 127`, `error: Failed to install` - which is why the pip
 * path takes the tail. A REFUSAL is the opposite shape: the verdict, the refs and
 * the consequence are the FIRST paragraph, and what follows is the by-hand
 * instructions and then how to bypass the guard. Selecting by tail hands the reader
 * the bypass as their remedy, which is what this function exists to prevent.
 *
 * The rules, in order: drop guard-bypass lines entirely; take the head up to the
 * first terminal instruction (so the verdict and its evidence survive and the
 * by-hand recipe does not); cap at `maxLines`; and fall back to the tail when the
 * head yields nothing usable, because a short unexplained one-liner (`installer
 * exited 127`) must still reach the panel. The result is bounded, because it lands
 * in a panel sentence whose full streams are in the update service log.
 */
export function installDiagnosisLines(text: string, maxLines = 6): string {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return "";
	const allowed = lines.filter((line) => !GUARD_BYPASS_ADVICE.test(line));
	const pool = allowed.length > 0 ? allowed : lines;
	const head: string[] = [];
	for (const line of pool) {
		if (head.length >= maxLines) break;
		if (head.length > 0 && TERMINAL_INSTRUCTION.test(line)) break;
		head.push(line);
	}
	return (head.length > 0 ? head : pool.slice(-maxLines))
		.join("\n")
		.slice(0, 800);
}

/** `local_operator-0.56.0.dist-info`, in either separator spelling. */
const LOCAL_OPERATOR_DIST_INFO_VERSION =
	/^local[-_]operator[-_](.+)\.dist-info$/;

/**
 * Whether `candidate` is the newer of two dist-info version spellings.
 *
 * A prefix can hold more than one dist-info: an upgrade that was interrupted
 * between uninstall and install leaves the previous distribution beside the new
 * one. The reading has to be the NEWEST, because this version is half of the
 * only evidence that the install moved - reporting the older directory would
 * make an update that landed read as one that did not. A spelling neither side
 * can parse falls back to the lexicographic answer, so the result is always
 * deterministic rather than dependent on `readdir` order.
 */
function newerDistInfoVersion(
	candidate: string,
	current: string | null,
): boolean {
	if (current === null) return true;
	const order = compareVersions(candidate, current);
	if (order !== null) return order > 0;
	return compareVersions(current, candidate) === null && candidate > current;
}

/**
 * The two files in a `local-operator` dist-info that state who owns an install.
 *
 * Read from disk rather than inferred from a layout, because two of the install
 * kinds the server recognises cannot be told apart any other way:
 *
 * - `INSTALLER` is what says `pip` for a BASE-prefix install. A
 *   `mise`/`pyenv`/`asdf` toolchain reports `sys.prefix == sys.base_prefix` and
 *   writes no `pyvenv.cfg`, so the layout probes all decline and the app used to
 *   answer `global-unknown` - naming no command for a user whose environment
 *   `pip install -U` upgrades fine (#396, review R13). Consulted only for the
 *   exact value `pip`, as `_is_ordinary_pip` does: uv and pipx write their own
 *   value, and answering `pip` for them is the guess this module exists to
 *   refuse.
 * - `direct_url.json`'s `dir_info.editable` (PEP 610/660) is the only positive
 *   evidence that a prefix is the repo checkout rather than an installed copy.
 *   A checkout usually has a `pyvenv.cfg` too, so the layout says `pip` - and
 *   `pip install --upgrade local-operator` would put a wheel over the code the
 *   user is working in (review Q5).
 *
 * The VERSION and the PROVENANCE are read here too, because this is the one
 * place that already knows where the resolved install's metadata lives: the
 * version out of the dist-info directory's own name, and the first token of
 * `.lop-source` at the venv root. Both describe the INSTALL rather than the
 * running daemon - the daemon's `/health` lags an install by a restart - which
 * is what the update prompt needs to describe the state after an update.
 *
 * Every `site-packages` under the prefix is read, and `editable` wins over
 * `installer`: a prefix rebuilt against a second interpreter leaves the previous
 * one's dist-info behind, and the order `install_kind()` uses is the checkout
 * first. A prefix with no readable distribution is not evidence of anything, so
 * the caller's answer stays "unknown" rather than becoming a guess.
 */
export function resolveDistributionMarkers(prefix: string): {
	installer: string | null;
	editable: boolean;
	/** The version the dist-info directory NAME carries, or null when absent. */
	version: string | null;
	/** The first token of `<prefix>/.lop-source`, or null when there is none. */
	sourceRef: string | null;
} {
	const sitePackages: string[] = [];
	// POSIX: `<prefix>/lib/pythonX.Y/site-packages`. Windows: `Lib/site-packages`.
	try {
		for (const entry of readdirSync(join(prefix, "lib"))) {
			if (!PYTHON_LIB_DIR.test(entry)) continue;
			const candidate = join(prefix, "lib", entry, "site-packages");
			if (existsSync(candidate)) sitePackages.push(candidate);
		}
	} catch {
		// No `lib`: not a POSIX Python prefix. The Windows layout below still runs.
	}
	const windowsSitePackages = join(prefix, "Lib", "site-packages");
	if (existsSync(windowsSitePackages)) sitePackages.push(windowsSitePackages);

	let installer: string | null = null;
	let editable = false;
	let version: string | null = null;
	for (const dir of sitePackages) {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			// `local-operator` normalises to `local_operator` in a dist-info name;
			// accept either separator rather than depending on the normalisation.
			if (!LOCAL_OPERATOR_DIST_INFO.test(entry)) continue;
			if (!entry.endsWith(".dist-info")) continue;
			const distInfo = join(dir, entry);
			// The directory NAME is the version, which is what `importlib.metadata`
			// reads on the Python side (`installed_build`, `local_operator/update.py`):
			// no subprocess, no import, and therefore no interpreter to find.
			const parsed = LOCAL_OPERATOR_DIST_INFO_VERSION.exec(entry)?.[1]?.trim();
			if (parsed && newerDistInfoVersion(parsed, version)) version = parsed;
			try {
				const installerText = readFileSync(join(distInfo, "INSTALLER"), "utf8");
				installer = installerText.trim().toLowerCase() || installer;
			} catch {
				// Absent is no evidence, never a negative.
			}
			try {
				const payload = JSON.parse(
					readFileSync(join(distInfo, "direct_url.json"), "utf8"),
				) as { editable?: unknown; dir_info?: { editable?: unknown } };
				if (payload.editable === true || payload.dir_info?.editable === true) {
					editable = true;
				}
			} catch {
				// No direct_url.json, or not JSON: not an editable install.
			}
		}
	}

	return { installer, editable, version, sourceRef: readSourceRef(prefix) };
}

/** Trailing slashes in a PATH entry, which `join` would faithfully double. */
const TRAILING_SLASHES = /\/+$/;

/**
 * Where a user-installed command can live, in the order to try them.
 *
 * Why the app cannot just ask the shell's `which`: the app is normally started
 * by Finder or `open`, and macOS gives such a process the launchd default PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`) with no `~/.local/bin` in it - which is
 * where uv and pipx link their console scripts, and where `lop-update` lives on
 * this machine. Resolving the install from `which` alone therefore answered
 * "nothing is installed" for the very install this classification exists to
 * describe: no path, so no kind, so a remedy carrying no command at all (the
 * empty-command panel nobody had rendered). The inherited PATH is still
 * searched first, so a shell launch, a custom prefix or a `UV_TOOL_BIN_DIR`
 * override keeps its own precedence; these locations are what answers the
 * question when it is not there.
 */
function commandSearchDirs(env: NodeJS.ProcessEnv, home: string): string[] {
	const dirs: string[] = [];
	const add = (dir: string | undefined) => {
		if (!dir) return;
		const trimmed = dir.replace(TRAILING_SLASHES, "");
		if (trimmed.length === 0 || dirs.includes(trimmed)) return;
		dirs.push(trimmed);
	};
	for (const dir of (env.PATH ?? "").split(delimiter)) add(dir);
	// The installers' own bin directories first - uv's default tool bin dir IS
	// `~/.local/bin`, `XDG_BIN_HOME` is the XDG spelling of the same thing, and
	// pipx links into it too - then the two Homebrew prefixes and the OS's own.
	add(env.UV_TOOL_BIN_DIR);
	add(env.XDG_BIN_HOME);
	// uv's own bin-dir precedence runs `UV_TOOL_BIN_DIR` -> `XDG_BIN_HOME` ->
	// `$XDG_DATA_HOME/../bin` -> `~/.local/bin` (measured on uv 0.10.8:
	// `XDG_DATA_HOME=/tmp/xdgd uv tool dir --bin` -> `/tmp/xdgd/../bin`), so an
	// install configured with a data home alone put its shim in a directory
	// nothing searched: the classification then answered "could not tell how this
	// was installed" for an install whose command was right there (review round
	// 4, M2). `join` normalises the `..` away because the directory searched is
	// the same one either way.
	if (env.XDG_DATA_HOME) add(join(env.XDG_DATA_HOME, "..", "bin"));
	add(join(home, ".local", "bin"));
	add("/opt/homebrew/bin");
	add("/usr/local/bin");
	/*
	 * The OS's own directories LAST, and named explicitly rather than left to the
	 * inherited PATH. They are already in a shell's PATH, so on a normal launch
	 * these two lines are duplicates the de-duplicator drops - but with an empty
	 * or absent PATH they are the only thing that searches the directories a
	 * system interpreter or a distro package installs into, and the shell probe
	 * this list replaced would have found those entries. Never fewer places than
	 * the probe searched (review R1-5).
	 */
	add("/usr/bin");
	add("/bin");
	return dirs;
}

/**
 * The PATH an installer CHILD needs, built from the app's own search list.
 *
 * This is a second consumer of `commandSearchDirs`, not a second list: the
 * update child has to find the same installers this app resolved the install
 * from. `lop update` reaches `uv` by BARE NAME through the child's PATH
 * (`installer_invocation` -> `_run_installer` -> `subprocess.run(argv)`,
 * `local_operator/update.py`), and a LaunchServices-launched app has
 * `/usr/bin:/bin:/usr/sbin:/sbin` with no `uv` in it - on this machine `uv` is
 * `/opt/homebrew/bin/uv`. Without this the feature fails on exactly the machines
 * it exists for, with an `installer exited 127` that reads as an installer bug
 * rather than as a missing PATH entry.
 *
 * The installers' own bin directories LEAD and the inherited PATH follows, which
 * is `commandSearchDirs`'s list REORDERED rather than a different list: the
 * child must answer with the install this app classified, so a
 * `UV_TOOL_BIN_DIR`, an XDG layout or `~/.local/bin` has to outrank whatever an
 * inherited entry would otherwise answer with. Nothing is dropped - every
 * inherited entry is kept, after ours, so a uv or pipx that only the user's
 * shell knows about is still reachable.
 */
export function installerSearchPath(
	env: NodeJS.ProcessEnv = process.env,
	home: string = homedir(),
): string {
	const inherited = (env.PATH ?? "")
		.split(delimiter)
		.map((dir) => dir.replace(TRAILING_SLASHES, ""))
		.filter((dir) => dir.length > 0);
	const inheritedSet = new Set(inherited);
	const ours = commandSearchDirs(env, home).filter(
		(dir) => !inheritedSet.has(dir),
	);
	return [...ours, ...inherited].join(delimiter);
}

/**
 * The uv tool environments' own script directories.
 *
 * A tool's console script is normally linked into the tool bin dir above, but a
 * link that was removed, or a `UV_TOOL_DIR` that is not uv's default, still
 * leaves the script inside the environment itself - beside the
 * `uv-receipt.toml` that names the install as a uv tool - and that is the one
 * place `readInstallIdentity` can still see the layout markers from.
 *
 * Three platform rules live here, and they are not all measured: the tool root
 * (`UV_TOOL_DIR`, then `$XDG_DATA_HOME/uv/tools`, then
 * `~/.local/share/uv/tools`) and the POSIX `bin` script dir are measured
 * against uv's own answers on this host (review round 4, M2). The Windows
 * `Scripts` half is DERIVED rather than measured - there is no Windows host to
 * ask - from the split `updateBackend` already writes for a bundled venv,
 * which is the layout uv's own tool environments use (review round 4, M1).
 *
 * Known and deliberate: uv's own default root on Windows is under the user's
 * app data (`%LOCALAPPDATA%\uv\tools`, uv's storage reference), which this
 * does not model - there is no Windows host to measure it on, and a guessed
 * path is worse than a stated gap. Nothing depends on it being right: the
 * shims live in `%USERPROFILE%\.local\bin`, which `commandSearchDirs` searches
 * and `where` finds, and a Windows tool install is then classified by the
 * `uv tool list` probe the resolved `uv.exe` answers (review round 4, M1).
 */
function uvToolBinDirs(
	env: NodeJS.ProcessEnv,
	home: string,
	listDir: (dir: string) => string[],
	platform: NodeJS.Platform,
): string[] {
	const root =
		env.UV_TOOL_DIR ??
		(env.XDG_DATA_HOME
			? join(env.XDG_DATA_HOME, "uv", "tools")
			: join(home, ".local", "share", "uv", "tools"));
	const scriptDir = platform === "win32" ? "Scripts" : "bin";
	const dirs: string[] = [];
	try {
		for (const entry of listDir(root)) {
			dirs.push(join(root, entry, scriptDir));
		}
	} catch {
		// No uv tool environments on this machine: nothing to add.
	}
	return dirs;
}

/**
 * What Windows appends to a bare command name, in the platform's own order.
 *
 * `PATHEXT` is the machine's list; the documented default is used when the
 * environment carries none, so the search still resolves an executable in a
 * context that never inherited a shell's environment - the case this whole
 * module exists for. The case is kept as written because it is only ever
 * concatenated onto a name the caller gave, and Windows compares file names
 * case-insensitively.
 */
const WINDOWS_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function windowsCommandExtensions(env: NodeJS.ProcessEnv): string[] {
	const raw = (env.PATHEXT ?? "").trim();
	const parts = (raw.length > 0 ? raw : WINDOWS_DEFAULT_PATHEXT).split(";");
	const extensions: string[] = [];
	for (const part of parts) {
		const extension = part.trim();
		if (extension.length === 0 || extensions.includes(extension)) continue;
		extensions.push(extension);
	}
	return extensions;
}

/**
 * The file names to try inside one directory, in the order the platform does.
 *
 * POSIX resolves a bare command name to the file of that same name, and that is
 * all this has to do there. Windows resolves it through `PATHEXT`: `uv` is
 * `uv.exe`, pipx writes its shims as `.exe` trampolines rather than symlinks,
 * and uv does the same - so an exact-name `existsSync` finds nothing on a
 * machine that has both installed. That answer then read as "nothing here",
 * which is how a uv-tool or pipx install came out unidentifiable with no
 * command at all on Windows (review round 4, M1). The bare name is tried first
 * because an extensionless executable is legitimate on Windows too.
 */
function commandCandidates(
	dir: string,
	name: string,
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): string[] {
	const candidates = [join(dir, name)];
	if (platform !== "win32") return candidates;
	for (const extension of windowsCommandExtensions(env)) {
		candidates.push(join(dir, name + extension));
	}
	return candidates;
}

/**
 * The path `name` resolves to, or null when it is nowhere to be found.
 *
 * Not `which`, for the reason `commandSearchDirs` gives: the app is normally
 * started without a shell, so the search has to cover the installers' own
 * locations, not just the PATH it inherited. On Windows a bare name is resolved
 * through `PATHEXT` (`commandCandidates`), which is the part of `where`'s
 * semantics that matters to the callers here.
 *
 * The injected options exist so the contract tests can drive a synthetic tree -
 * including the Windows one - instead of the developer's machine.
 */
export function resolveCommandPath(
	name: string,
	options: {
		env?: NodeJS.ProcessEnv;
		home?: string;
		/** The platform whose resolution rules to apply; defaults to this one. */
		platform?: NodeJS.Platform;
		listDir?: (dir: string) => string[];
		exists?: (path: string) => boolean;
	} = {},
): string | null {
	const env = options.env ?? process.env;
	const home = options.home ?? homedir();
	const platform = options.platform ?? process.platform;
	const exists = options.exists ?? existsSync;
	const listDir =
		options.listDir ??
		((dir: string): string[] => {
			try {
				return readdirSync(dir);
			} catch {
				return [];
			}
		});

	const dirs = [
		...commandSearchDirs(env, home),
		...uvToolBinDirs(env, home, listDir, platform),
	];
	for (const dir of dirs) {
		for (const candidate of commandCandidates(dir, name, env, platform)) {
			try {
				if (exists(candidate)) return candidate;
			} catch {
				// An unreadable entry is not an answer: try the next location.
			}
		}
	}
	return null;
}

/**
 * The console script that fronts the operator's global install, or null.
 *
 * ONE helper for both callers - `BackendServiceManager.globalConsoleScript`,
 * which decides and spawns, and the update service's plan/identity reads - because
 * they have to agree. They used to differ: the decision tried `local-operator`
 * and then `lop`, while the plan resolved `local-operator` only, so an install
 * whose older console script is gone started the app as `GLOBAL_INSTALL` on `lop`
 * and was then classified `global-unknown` with no remedy at all (review R1-6).
 * `local-operator` first: it is the name this app has always spawned, and the
 * spawn validates the resolved script's shebang
 * (`consoleInterpreter`), while `lop` covers an install whose older console
 * script is gone.
 */
export function resolveGlobalConsoleScript(
	options: Parameters<typeof resolveCommandPath>[1] = {},
): string | null {
	if ((options.platform ?? process.platform) === "win32") {
		/*
		 * Windows keeps `where`, whose semantics differ enough (the machine's and
		 * the user's own install locations, `PATHEXT`) that a second resolution
		 * rule is the honest thing rather than a re-implementation. Both names,
		 * in the same order as the Unix arm. A failed probe is not an answer, and
		 * the timeout is the one the probes elsewhere in this app use.
		 */
		const first = (name: string): string | null => {
			try {
				const resolved = execFileSync("where", [name], {
					encoding: "utf8",
					timeout: 5000,
				})
					.split("\n")[0]
					?.trim();
				return resolved && resolved.length > 0 ? resolved : null;
			} catch {
				return null;
			}
		};
		return first("local-operator") ?? first("lop");
	}
	return (
		resolveCommandPath("local-operator", options) ??
		resolveCommandPath("lop", options)
	);
}

/**
 * Everything `classifyGlobalInstall` needs to tell a uv tool install from a
 * pipx one from an ordinary pip venv from the checkout a developer runs.
 *
 * Two markers are read out of the dist-info itself, because the layout cannot
 * answer them: `INSTALLER`, which is what names pip for a base-prefix install
 * (`mise`/`pyenv`/`asdf` write no `pyvenv.cfg`, review R13), and
 * `direct_url.json`'s `dir_info.editable`, which is the only positive evidence
 * that a prefix IS the repo checkout rather than an installed copy (review Q5).
 * Both mirror `install_kind()` in `local_operator/update.py`. The markers are
 * where they are: a uv tool environment lives at `<...>/uv/tools/<name>`, and
 * its console script in `~/.local/bin` is a symlink into it, so the resolved
 * path carries the marker the printed path does not (review R2).
 */
export function readInstallIdentity(shimPath: string | null): InstallIdentity {
	if (!shimPath) return { path: null };

	let realPath: string | null = null;
	try {
		realPath = realpathSync(shimPath);
	} catch {
		realPath = null;
	}

	let shebang: string | null = null;
	try {
		const firstLine = readFileSync(shimPath, "utf8").split("\n", 1)[0] ?? "";
		shebang = firstLine.startsWith("#!") ? firstLine : null;
	} catch {
		shebang = null;
	}

	// The script lives in `<prefix>/bin/<name>`, and a Python install records
	// its own kind next to that prefix: uv writes `uv-receipt.toml` beside the
	// environment, and pip leaves `pyvenv.cfg` in it.
	const executable = realPath ?? shimPath;
	const prefix = dirname(dirname(executable));
	const existing = (candidate: string) =>
		existsSync(candidate) ? candidate : null;
	const markers = resolveDistributionMarkers(prefix);

	return {
		path: shimPath,
		realPath,
		shebang,
		uvReceipt: existing(join(prefix, "uv-receipt.toml")),
		venvPrefix: existsSync(join(prefix, "pyvenv.cfg")) ? prefix : null,
		installer: markers.installer,
		editable: markers.editable,
		version: markers.version,
		sourceRef: markers.sourceRef,
	};
}

/**
 * The `generations/<id>` root this install is launched from, or null.
 *
 * This is the predicate the update path's safety rests on, and it answers a
 * question about the LAYOUT rather than about a version. Present means the
 * install implements the atomic handover: one tree per build behind a `current`
 * pointer (`docs/design-install-generations.md`), so an install lands in a tree
 * no running process is reading and the handover is a pointer flip. Absent
 * means the installer rewrites the shared environment in place - the shape that
 * killed 36 sessions with no exit record under a uv rewrite on 2026-09-15, and
 * not something the app may start on a user's behalf.
 *
 * A VERSION IS DELIBERATELY NOT THE TEST. The capability arrived in 0.56.0, but
 * the version is a proxy for the layout and the layout is the capability: a
 * hand-made 0.56 tree installed in place has the version and not the layout, and
 * the gate would wave its owner into the in-place rewrite. The `current` entry
 * is the second half for the same reason - a `generations/` directory with no
 * pointer is a tree nothing launches from, so the layout is not in use and must
 * not be reported as if it were.
 *
 * Never throws. It runs inside a version check, and a check that throws is a
 * check that reports nothing: a missing path, an unresolvable one (a symlink
 * loop raises ELOOP from the resolver), and an unreadable tree all answer null,
 * which the plan renders as "the app names the command but will not run it".
 */
export function generationInstallRoot(
	identity: InstallIdentity,
): string | null {
	const resolved = identity.realPath ?? identity.path;
	if (!resolved) return null;
	let executable: string;
	try {
		executable = realpathSync(resolved);
	} catch {
		return null;
	}
	// The resolved path is `<stable>/generations/<id>/...`, and the generation
	// root is the path element directly under `generations`. Walked by name
	// rather than by a fixed depth, because the two layouts in the wild differ
	// below that point (`generations/<id>/bin/...` for a generation's own
	// console scripts, `generations/<id>/tools/local-operator/bin/...` for the
	// venv a uv install writes) and only the root itself is the same in both.
	let dir = executable;
	for (;;) {
		const parent = dirname(dir);
		if (parent === dir) return null;
		if (basename(parent) === "generations") {
			return existsSync(join(dirname(parent), "current")) ? dir : null;
		}
		dir = parent;
	}
}

/**
 * Classify a global `local-operator` install from what the install IS.
 *
 * Order matters and follows the Python side: a checkout is answered first (it
 * is not an install to upgrade), a uv tool install is recognised by its receipt
 * before any layout guess, pipx next, an ordinary pip venv last - and "unknown"
 * is a real answer, never a fallback to pip.
 */
export function classifyGlobalInstall(
	identity: InstallIdentity,
): GlobalInstallKind {
	if (!identity.path) return "global-unknown";
	// An editable install is the repo checkout, or a checkout beside it. Answered
	// before the layout probes because every layout probe would match it too - it
	// has a `pyvenv.cfg` when it is a venv, and often a uv receipt when uv made
	// it - and `pip install --upgrade` would install a wheel over the checkout
	// the user is working in (review Q5).
	if (identity.editable) return "editable";
	// The resolved path and the script's own shebang both name the interpreter
	// that owns the install, which is where the layout markers actually live.
	const haystack = [
		identity.path,
		identity.realPath ?? "",
		identity.shebang ?? "",
	]
		.join("\n")
		.toLowerCase();
	if (haystack.includes("/uv/tools/")) return "uv-tool";
	if (identity.uvReceipt) return "uv-tool";
	if (uvToolListNamesLocalOperator(identity.uvToolList)) return "uv-tool";
	if (
		haystack.includes("/pipx/venvs/") ||
		(haystack.includes("/pipx/") && haystack.includes("venvs"))
	)
		return "pipx";
	if (pipxListNamesLocalOperator(identity.pipxList)) return "pipx";
	// A `local-operator` script inside a virtualenv prefix: the README's
	// `pip install` path, and the one case where pip is the right command.
	if (identity.venvPrefix) return "pip";
	// The base-prefix case, consulted last and only for the exact value `pip`,
	// as `_is_ordinary_pip` does: uv and pipx write their own INSTALLER value and
	// have already been answered above, so reading "pip" as a guess for them is
	// the thing this classifier exists to refuse (review R13).
	if (identity.installer === "pip") return "pip";
	return "global-unknown";
}

/**
 * The tree an install lives in, from what the identity itself carries.
 *
 * The `pyvenv.cfg`'s own prefix when the install has one - it is EVIDENCE, a file
 * read from the tree - and otherwise the prefix the resolved script sits in
 * (`<prefix>/bin/<name>`, which is uv's and pipx's layout for every kind this
 * function classifies). Both are needed: a uv tool install seen through a
 * `generations/<id>` symlink carries the generation's own `pyvenv.cfg`, while a
 * fixture or a half-installed tree can have the script without the config file.
 * Null when there is no resolved path at all.
 *
 * This is the plan's `installPrefix`, which is where a managed route's EVIDENCE
 * lives: an answer that named the wrong tree would make a landed rebuild read as
 * one that did not.
 */
function installPrefixOf(identity: InstallIdentity): string | null {
	if (identity.venvPrefix) return identity.venvPrefix;
	const script = identity.realPath ?? identity.path;
	return script ? dirname(dirname(script)) : null;
}

/**
 * Resolve what a global (GLOBAL_INSTALL) backend can be told to do.
 *
 * `canManageUpdate` is false in every case: the installer that owns the
 * environment is the only thing that may touch it, and running
 * `pip install --upgrade` inside a uv- or pipx-managed environment either fails
 * or corrupts it. A `lop-update` command on PATH takes precedence for a uv tool
 * install because that install was built from source - upgrading it from the
 * registry would replace the user's own build.
 *
 * The unidentified case names NO command. Shipping `pip install --upgrade
 * local-operator` as the answer for an install we could not identify is how the
 * app told the operator to pip into a uv tool environment (reviews R2, U4, D4);
 * "we could not tell" is a claim we can support, and pip is not.
 */
export function resolveGlobalInstallPlan(input: {
	identity: InstallIdentity;
	/**
	 * The `lop-update` this machine resolves, or null when it has none.
	 *
	 * An INPUT rather than a lookup in here, because this function is the statement
	 * that has to be testable without a machine: the caller resolves the tool the
	 * same way it resolves everything else, and the plan says what that licence is
	 * worth. Null means what it says - the app has no rebuild route here.
	 */
	sourceRebuild?: string | null;
}): BackendPlan {
	const kind = classifyGlobalInstall(input.identity);
	const installPrefix = installPrefixOf(input.identity);
	// A uv tool built from a git snapshot and the checkout itself both report the
	// CHECKOUT's version after they are updated, so neither can be promised the
	// version the app offered (review U12). Which of the two it is now comes from
	// the install's own `.lop-source` rather than from a `lop-update` script
	// existing on this machine, which described the machine and not the install.
	const sourceBuild =
		kind === "editable" ||
		(kind === "uv-tool" && isSourceBuildRef(input.identity.sourceRef));
	const detail = input.identity.path
		? `local-operator resolves to ${input.identity.path}${
				input.identity.realPath &&
				input.identity.realPath !== input.identity.path
					? ` (${input.identity.realPath})`
					: ""
			}, classified as ${kind}.${
				kind === "editable"
					? " Built from source on this machine, so it follows the checkout rather than the published release."
					: ""
			}`
		: "local-operator was not found on PATH.";

	if (kind === "editable") {
		// The Python side refuses this case by name (`editable_refusal()`), and the
		// refusal is the point: `pip install -U` into the checkout either no-ops or
		// breaks the editable link, and the tools that own the environment are not
		// named for it either. No command, then - the sentence says what to do
		// instead.
		return {
			canManageUpdate: false,
			updateCommand: "",
			remedy:
				"The server is running from a source checkout on this machine rather than an installed copy, so update it with lop-update after your change is merged.",
			detail,
			sourceBuild: true,
			managedRoute: null,
			installPrefix,
		};
	}
	if (kind === "uv-tool") {
		/*
		 * One command for both audiences, and the layout - not the version - decides
		 * which audience. `lop update` IS the install's front end: it detects the
		 * kind, honours the `editable`/`unknown` refusals, writes the `.lop-source`
		 * marker that makes runtimes converge, prunes, and refreshes the daemons it
		 * supervises. Both commands this branch used to name are broken remedies:
		 * `lop-update` is the release owner's out-of-tree script (a checkout at a
		 * hardcoded path, `uv tool install --force --from`, and an outright refusal
		 * when the local ref is behind or diverged from its remote - a remedy that
		 * can refuse is not a remedy), and `uv tool upgrade local-operator` is
		 * documented in the harness as failing for a git-snapshot install or a
		 * pinned receipt (`local_operator/update.py`).
		 *
		 * `canManageUpdate` is the generation layout and nothing else. On that layout
		 * an install lands in a tree no running process is reading, so the app may
		 * run it while sessions are mid-turn; on the legacy layout the same command
		 * rewrites `site-packages` under every live runtime, which is the incident
		 * this gate exists to keep the app out of. The gate clears itself: one manual
		 * `lop update` puts the host on the generation layout and the button works
		 * from then on.
		 */
		const managed = generationInstallRoot(input.identity) !== null;
		/*
		 * THE SOURCE-BUILD ROUTE, and why it is NOT gated on the generation layout the
		 * way the entry point is. That gate exists because `<console path> update`
		 * installs the published wheel: on a legacy layout it rewrites `site-packages`
		 * under every live runtime, which is the 2026-09-15 incident. `lop-update`
		 * rebuilds and reinstalls THE CHECKOUT this install already came from - the
		 * exact command the panel has been telling this audience to paste, and the only
		 * one that keeps their build rather than replacing it with a release wheel.
		 * Running it for them changes who types it, not what happens; and it is the
		 * case the report asked for, because the operator's install is a uv-tool build
		 * of their own checkout and a refusal left them a copy/paste instruction.
		 */
		const sourceRebuildRoute =
			!managed && sourceBuild && (input.sourceRebuild ?? null) !== null;
		const provenance = sourceBuild
			? " Built from source on this machine, so `lop update` installs the published release over it - the harness prints the same notice."
			: "";
		return {
			canManageUpdate: managed || sourceRebuildRoute,
			updateCommand: sourceRebuildRoute ? "lop-update" : "lop update",
			/*
			 * The remedy is the sentence above the command well in the by-hand panel
			 * and the consequence line in the managed offer, and each arm says the
			 * thing that decides the reader's next move:
			 *
			 * Managed - what the app is about to do TO THEM. This arm used to tell the
			 * user to go to a terminal on the one path where the app runs the command
			 * itself, which no surface rendered (reviews D7, U7), and the offer named
			 * no cost at all before the click (review U3). The restart is the one
			 * destructive thing this path does, so it is stated here rather than in
			 * the in-flight panel the user reaches only after pressing.
			 *
			 * Source build - the same disclosure with the one difference that matters:
			 * what is rebuilt is THEIR checkout, and the version they end up on is the
			 * checkout's rather than the release the app offered.
			 *
			 * Legacy - WHY the app will not press the button, which is what the user
			 * is choosing between (reviews U8, N1). It lived only in the mono Details
			 * line, trailing a resolved path and a classification.
			 *
			 * NEITHER ENDS IN A COLON: the well below is visually distinct in both
			 * panels, and in the by-hand panel the next line was the version sentence,
			 * so the promise landed on the wrong line (review D5).
			 */
			remedy: managed
				? "The app updates this install and then restarts the server it started, so a turn that is in flight is dropped while the server comes back. This can take a minute or two."
				: sourceRebuildRoute
					? "The app rebuilds this source checkout with `lop-update` and then restarts the server it started. That rebuild reinstalls the install in place, so sessions running on this machine can be interrupted while it happens, and it can take a few minutes. The version this install reports afterwards is the checkout's, not the release the app offered."
					: "This install predates the non-disruptive installer, so update it once from your terminal. This install's updater rewrites the shared environment in place, which can interrupt sessions mid-turn; the app manages updates after that.",
			detail: `${detail}${
				managed
					? provenance
					: sourceRebuildRoute
						? " Built from source on this machine, so the app rebuilds the checkout rather than installing the published release over it."
						: provenance
			}`,
			sourceBuild,
			managedRoute: managed
				? "entry-point"
				: sourceRebuildRoute
					? "source-build"
					: null,
			installPrefix,
		};
	}
	if (kind === "pipx") {
		return {
			canManageUpdate: false,
			updateCommand: "pipx upgrade local-operator",
			remedy: "The server is a pipx install, so update it from your terminal",
			detail,
			sourceBuild: false,
			managedRoute: null,
			installPrefix,
		};
	}
	if (kind === "pip") {
		return {
			canManageUpdate: false,
			updateCommand: "pip install --upgrade local-operator",
			remedy: "The server is a pip install, so update it from your terminal",
			detail,
			sourceBuild: false,
			managedRoute: null,
			installPrefix,
		};
	}
	return {
		canManageUpdate: false,
		updateCommand: "",
		remedy:
			"The app could not tell how this server was installed, so update it with the tool you installed it with - uv, pipx or pip",
		detail,
		sourceBuild: false,
		managedRoute: null,
		installPrefix,
	};
}

/**
 * A version safe to put in a `local-operator==<version>` requirement.
 *
 * The target crosses the IPC boundary as an arbitrary string, so it is pinned
 * only when it actually looks like a release - digits, dots, and the PEP 440
 * pre-release/dev/local spellings - and never when it carries whitespace, a
 * shell metacharacter or a flag. Anything that does not match keeps the
 * unpinned requirement rather than reaching the command line.
 *
 * The spellings are PEP 440's, including the two the first version of this
 * pattern rejected (review R1-3): an optional `N!` epoch, and a pre-release
 * followed by a post or dev segment, so `1!0.55.10`, `0.55.10a1.post1` and
 * `0.55.10.post1.dev2` are all pinnable. Those are legitimate publishable
 * releases, and the cost of refusing them was not cosmetic: an unpinned
 * requirement against a FRESH index installs the newest release, which can be
 * newer than the one the app promised and then polls for, so the update would be
 * reported as failed over a server that had in fact moved.
 *
 * The segments are written in the ORDER PEP 440 defines them (release, epoch,
 * pre, post, dev, local) and each may appear at most once, because that is the
 * whole of the grammar: the pattern has to be wide enough for every release the
 * index can publish and narrow enough that a string which is not a version is
 * never pinned. `0.55.10.dev2.post1` is therefore NOT pinned - the spec has no
 * such version - while `0.55.10.post1.dev2` is.
 */
const PINNABLE_VERSION_REGEX =
	/^(?:\d+!)?\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?(?:[-+][0-9A-Za-z.]+)?$/;

/** Whether a target is a release version, and so may be pinned in a requirement. */
export function isPinnableVersion(
	target: string | null | undefined,
): target is string {
	return (
		typeof target === "string" && PINNABLE_VERSION_REGEX.test(target.trim())
	);
}

/**
 * The pip invocation used for the app's own bundled environment.
 *
 * `--no-input` keeps a prompt from hanging an install with no console attached,
 * and `--disable-pip-version-check` keeps pip's self-update notice out of the
 * output we read the installed version back from.
 *
 * TWO THINGS HERE ANSWER THE SAME DEFECT, AND ONLY ONE OF THEM IS ENOUGH.
 *
 * The defect (operator report, 2026-09-15): the app's own check read 0.55.10 from
 * PyPI at 22:08:58, this command was run at 22:09:53 and again at 22:10:50, and
 * both runs answered `Requirement already satisfied: local-operator ... (0.55.9)`
 * with exit 0 - `version 0.55.9 -> 0.55.9`, nothing installed. PyPI's own upload
 * time for 0.55.10 is 2026-09-16T02:05:21Z, so the resolver was answering from a
 * simple-index page that predated the release by four and a half minutes, inside
 * the `max-age=600` window such a page carries.
 *
 * The PIN is the load-bearing half. `local-operator==<target>` cannot be satisfied
 * by the version already installed, so a stale or unreachable index turns the
 * silent no-op into a loud `ERROR: No matching distribution found` and exit 1 -
 * which is what the app then reports, instead of claiming success. Measured on a
 * purpose-built stale page (the app's own cached `/simple/local-operator/` with
 * the 0.55.10 artifacts removed, its ETag kept): the unpinned form answers
 * "already satisfied", exit 0; the pinned form without `--no-cache-dir` fails
 * loudly, exit 1; pin plus `--no-cache-dir` installs 0.55.10, exit 0.
 *
 * `--no-cache-dir` covers ONE of the two stale sources, and it is worth keeping
 * anyway: without it, pip answers a `/simple/` request out of its own HTTP cache
 * while that entry is fresh, so the cache can keep feeding the resolver a page
 * older than the release. WHICH path that takes depends on the pip, and both were
 * measured: on the pip this app bundles (26.2.1) it is a plainly FRESH hit - no
 * request to PyPI at all, `The response is "fresh", returning cached response` -
 * and on the older pip 25.0.1 the same reconstructed entry is revalidated and its
 * stale body served on a 304 (`pip/_internal/index/collector.py` sends `max-age=0`
 * on every `/simple/` request, and `pip/_vendor/cachecontrol/adapter.py` still
 * revalidates and reuses). Two pips, two paths, one outcome, and the outcome is
 * what this flag is here for. What it does NOT cover is a stale page served by the
 * CDN in front of PyPI, which the pin does. It also bypasses the wheel cache, so
 * the honest price is a fresh index read AND re-downloading the artifact - not the
 * index alone. A server update is a rare, explicitly requested, network-bound
 * operation, so that is the intended trade.
 *
 * (The command is not merely belt-and-braces: removing the PIN and keeping the flag
 * still installs whatever the fresh page offers, which may be a release newer than
 * the one the app promised and is polling for.)
 *
 * When the caller knows which release it promised the user, the requirement is
 * pinned to it (`local-operator==0.55.10`). The unpinned form is kept for callers
 * that name no target - the compatibility banner asks for "the current server", and
 * it has no version to pin - and for a target that is not a release version, which
 * `isPinnableVersion` refuses rather than putting an arbitrary string on the command
 * line.
 */
export function buildPipUpgradeCommand(
	pythonPath: string,
	targetVersion?: string | null,
): {
	command: string;
	args: string[];
	/** The same thing, for the log line and any message shown to the user. */
	display: string;
} {
	const requirement = isPinnableVersion(targetVersion)
		? `local-operator==${targetVersion.trim()}`
		: "local-operator";
	const args = [
		"-m",
		"pip",
		"install",
		"--upgrade",
		"--no-input",
		"--disable-pip-version-check",
		"--no-cache-dir",
		requirement,
	];
	return {
		command: pythonPath,
		args,
		display: `"${pythonPath}" ${args.join(" ")}`,
	};
}

const PIP_SHOW_VERSION_REGEX = /^Version:\s*(.+)$/m;

export function parsePipShowVersion(stdout: string): string | null {
	const match = stdout.match(PIP_SHOW_VERSION_REGEX);
	if (!match) return null;
	const version = match[1].trim();
	return version.length > 0 ? version : null;
}

/**
 * Whether an upgrade actually landed.
 *
 * "pip exited 0" is not evidence: pip reports success when the requirement is
 * already satisfied, and it can exit 0 having installed a wheel for a different
 * interpreter than the one the app started. The version read back afterwards is
 * the only thing that answers the question the user asked.
 *
 * The `before` reading deserves its own rule. It is null whenever `pip show`
 * failed before the upgrade, and the old code read that as "changed" - an
 * unreadable starting point cannot prove an upgrade landed, so the target
 * version is what the after-reading is held to instead (review R6).
 *
 * A KNOWN TARGET REFRAMES SUCCESS, and this is the R1-1 fix. When the caller
 * knows the version it asked for, "the install is at the target" IS the verdict,
 * and a CHANGE is not required - both installers exit 0 and print
 * "already latest" over an install that is already there (`lop update`
 * unconditionally, `pip install --upgrade` whenever the requirement is
 * satisfied). The change test alone therefore reported a machine that was
 * already correct as "the update did not take effect", and the panel's own
 * button reaches that state: it appears exactly when the INSTALL is ahead of the
 * serving daemon (design note §5), which is the state left behind by the last
 * successful update. The change test remains the fallback for the one caller
 * that names no target.
 *
 * AT OR PAST THE TARGET, not exactly on it (review R2-1). The target is the
 * version the CHECK read off PyPI, and `lop update` installs whatever PyPI has
 * when it RUNS - so a release published between the offer and the click lands
 * the install one version past the string the app asked for, and equality
 * reported that (correct, newer) machine as "the update did not take effect".
 * That is R1-1's false failure again with a narrower trigger. Ordering is the
 * honest test, and an unorderable reading is not a landing: `compareVersions`
 * answers null for anything that is not `x.y.z`, and this file already refuses to
 * invent an ordering it cannot compute.
 */
export function didUpgradeLand(input: {
	before: string | null;
	after: string | null;
	/** The version this upgrade was asked for, when the caller knows it. */
	target?: string | null;
}): boolean {
	const { before, after, target } = input;
	if (after == null) return false;
	if (target != null) {
		const order = compareVersions(after, target);
		return order !== null && order >= 0;
	}
	if (before == null) return false;
	return before.trim() !== after.trim();
}
