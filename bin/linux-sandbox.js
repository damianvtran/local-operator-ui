/**
 * Linux Chromium-sandbox diagnostics for the npm/global install path.
 *
 * WHY THIS FILE EXISTS (issue #91)
 *
 * Electron ships a setuid helper, `chrome-sandbox`, next to its binary. npm
 * strips setuid bits from package contents by design and Electron's own
 * postinstall does not restore them, so after `npm install -g` the helper lands
 * `root:root 0755` and Chromium aborts before any window opens:
 *
 *   [FATAL:setuid_sandbox_host.cc(163)] The SUID sandbox helper binary was
 *   found, but is not configured correctly.
 *
 * That message names the file but not the commands, it arrives after a crash
 * rather than instead of one, and the launcher used to exit 0 on it (see
 * exitCodeFor below), so callers were told the app had started cleanly.
 *
 * WHAT IS DELIBERATELY *NOT* HERE: `--no-sandbox` / ELECTRON_DISABLE_SANDBOX are
 * never passed by us. Turning the Chromium sandbox off for every Linux user is a
 * security-posture decision that belongs to the user, so it is offered in the
 * guidance below as their explicit opt-out with the consequence stated, and
 * never applied on their behalf.
 *
 * TWO CASES, AND WHY THEY ARE HANDLED DIFFERENTLY
 *
 * Both were measured in node:22-bookworm rather than reasoned about, and the
 * measurements are what shaped the code:
 *
 * 1. Running as root ALWAYS aborts, whatever the helper's mode. Verified: with
 *    the helper corrected to `root:root 4755`, root still gets
 *    "[FATAL:electron_main_delegate.cc(288)] Running as root without
 *    --no-sandbox is not supported". Because the outcome depends only on the
 *    effective uid, this is decidable BEFORE spawning, so it is a true
 *    preflight: we stop and explain instead of letting Chromium abort.
 *
 * 2. A missing setuid bit does NOT reliably mean failure. Chromium falls back to
 *    the unprivileged user-namespace sandbox, and where the kernel permits that
 *    the app starts normally with the helper at 0755. Verified: the same
 *    container that aborts under Docker's default seccomp profile reaches
 *    LOCAL_OPERATOR_UI_READY with `--security-opt seccomp=unconfined`, helper
 *    unchanged at `root:root 755`. So a preflight keyed on "the setuid bit is
 *    missing" would refuse to start installs that work today.
 *
 *    Detecting user-namespace availability up front is not dependable either:
 *    /proc/sys/user/max_user_namespaces read 31322 in BOTH containers, so the
 *    /proc indicators cannot see a seccomp filter that blocks the unshare(2)
 *    call itself. Probing by spawning would mean guessing about a syscall we
 *    cannot make from Node.
 *
 *    So case 2 is handled by REACTING rather than predicting: if the app exits
 *    abnormally and the helper is in the state known to cause it, we translate
 *    that into the exact commands. This cannot produce a false positive on a
 *    working install, because it only runs after a launch has already failed.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Chromium's own required mode for the helper. `chown root:root` + `chmod 4755`
// is what the FATAL message asks for, and what the issue verified as a fix.
const REQUIRED_MODE = 0o4755;
const SETUID_BIT = 0o4000;

/**
 * Every stat and every mutation in this file goes through a descriptor opened
 * with O_NOFOLLOW, and this is the single most security-sensitive decision here.
 *
 * WHY: the repair runs as root during `sudo npm install -g`, and `chownSync`,
 * `chmodSync` and `statSync` all FOLLOW symlinks (there is no lchmod on Linux).
 * If the helper path is a symlink, a path-based repair applies `root:root 4755`
 * to the link's TARGET -- so a crafted dependency that drops a link to, say,
 * /usr/bin/env turns this postinstall into a root setuid primitive it can aim.
 * The path itself is safe (it is built with path.join from __dirname, never from
 * package metadata), but the CONTENT of node_modules is not a trust boundary
 * during an install: dependency postinstalls run alongside ours.
 *
 * Opening once and operating on the fd closes the TOCTOU window in the same
 * move: without it we stat a path and then chown that path, and the file can be
 * swapped in between. Holding the descriptor means the thing we inspected is
 * provably the thing we modify.
 *
 * WHY O_NONBLOCK IS PART OF THIS, and it is not decoration: `open(2)` on a FIFO
 * with O_RDONLY BLOCKS UNTIL A WRITER APPEARS. That is plain POSIX open
 * semantics and has nothing to do with O_NOFOLLOW, which refuses only symlinks.
 * So a dependency that drops a FIFO at the helper path -- a file it can create
 * as easily as a symlink -- makes `sudo npm install -g` hang FOREVER, with no
 * timeout and no failure, and the path is reachable: ensureElectronDist()
 * fast-paths on existsSync(chrome-sandbox), which a FIFO satisfies. Measured:
 * both entry points had to be SIGKILLed after 8s without this flag and return in
 * ~1ms with it. O_NONBLOCK is a no-op on the regular file we actually expect, so
 * it costs nothing on the healthy path; it only turns "wait indefinitely" into
 * "open it and let the fstat below refuse it as not a regular file".
 *
 * KNOWN LIMIT, stated rather than implied: O_NOFOLLOW only refuses a symlink as
 * the FINAL path component. An attacker who can replace an intermediate
 * directory inside our own node_modules/electron/dist with a link is not
 * defeated by this. That is accepted -- defending it needs a resolved-directory
 * walk (openat/O_DIRECTORY per component), which Node does not expose -- and the
 * final component is the one an npm-installed package can actually place.
 */
const OPEN_NOFOLLOW =
	fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;

// A refused O_NOFOLLOW open reports ELOOP on Linux and macOS; BSDs use EMLINK.
// Both mean the same thing here: the final component is a symlink.
const isSymlinkRefusal = (err) => err.code === "ELOOP" || err.code === "EMLINK";

/**
 * Chromium's acceptance rule for the helper, as a pure predicate over the two
 * stat fields it depends on.
 *
 * Extracted rather than inlined because it is the whole correctness question in
 * this file and both halves matter: root ownership WITHOUT the setuid bit is the
 * exact state npm leaves behind, and the setuid bit on a file owned by anyone
 * else confers nothing. Testing it through a real file cannot cover the
 * root-owned cases without being root, so keeping it separately callable is what
 * lets the shipped rule be asserted directly instead of restated in a test.
 */
const isHelperHealthy = (uid, mode) => uid === 0 && (mode & SETUID_BIT) !== 0;

/**
 * The helper sits beside the Electron binary in the same dist directory.
 * Returns null when it cannot be located, which is the normal case on macOS and
 * Windows and on any install where the optional Electron download was skipped.
 */
const resolveSandboxHelper = (electronBinaryPath) => {
	if (typeof electronBinaryPath !== "string" || electronBinaryPath === "") {
		return null;
	}
	return path.join(path.dirname(electronBinaryPath), "chrome-sandbox");
};

/**
 * Read the helper's ownership and permissions from a descriptor, never by path.
 *
 * `needsRepair` is true only when the file exists and is not already
 * root-owned-setuid, so a helper that is absent (not a Linux install, optional
 * dependency skipped) is never reported as broken. Any stat failure degrades to
 * "nothing to say" rather than throwing: this is a diagnostic, and a diagnostic
 * must never be the reason the app fails to start.
 *
 * `unsafe` is the third state, distinct from both: the path exists but is a
 * symlink or is not a regular file. It reports `needsRepair: false` because the
 * repair must refuse it (see OPEN_NOFOLLOW) and because the chown/chmod guidance
 * would send the user to "fix" permissions on someone else's file.
 */
const inspectSandboxHelper = (helperPath) => {
	if (!helperPath) {
		return { exists: false, needsRepair: false };
	}
	let fd;
	try {
		fd = fs.openSync(helperPath, OPEN_NOFOLLOW);
	} catch (err) {
		if (isSymlinkRefusal(err)) {
			return {
				exists: true,
				path: helperPath,
				unsafe: true,
				needsRepair: false,
			};
		}
		return { exists: false, needsRepair: false };
	}
	try {
		const stats = fs.fstatSync(fd);
		if (!stats.isFile()) {
			// A fifo or device in the helper's place is not something to chmod 4755.
			return {
				exists: true,
				path: helperPath,
				unsafe: true,
				needsRepair: false,
			};
		}
		const mode = stats.mode & 0o7777;
		const isSetuidRoot = isHelperHealthy(stats.uid, mode);
		return {
			exists: true,
			path: helperPath,
			uid: stats.uid,
			gid: stats.gid,
			mode,
			isSetuidRoot,
			needsRepair: !isSetuidRoot,
		};
	} catch {
		return { exists: false, needsRepair: false };
	} finally {
		fs.closeSync(fd);
	}
};

/**
 * Restore `root:root 4755` on the helper. Used by the postinstall step, where we
 * may already be root because the user ran `sudo npm install -g`.
 *
 * Returns a result object and NEVER throws or exits non-zero. An unprivileged
 * install legitimately cannot do this, and a postinstall that fails the install
 * is a worse defect than the bug it is fixing: the user would end up with no
 * package at all instead of one that needs a documented chmod. When we cannot
 * repair it, the launcher's post-mortem guidance covers the case.
 */
const repairSandboxHelper = (helperPath) => {
	if (!helperPath) {
		return { outcome: "absent" };
	}
	let fd;
	try {
		fd = fs.openSync(helperPath, OPEN_NOFOLLOW);
	} catch (err) {
		// Refusing a symlink is a REFUSAL, not a failure to find the file: the
		// caller must be able to tell "nothing to repair" from "something is in the
		// way that we will not chmod as root".
		if (isSymlinkRefusal(err)) {
			return { outcome: "unsafe", path: helperPath };
		}
		return { outcome: "absent" };
	}
	try {
		// Everything below reads and mutates THIS descriptor. Re-deriving state from
		// the path here would reopen the TOCTOU window the fd exists to close.
		const before = fs.fstatSync(fd);
		if (!before.isFile()) {
			return { outcome: "unsafe", path: helperPath };
		}
		if (isHelperHealthy(before.uid, before.mode & 0o7777)) {
			return { outcome: "already-correct", path: helperPath };
		}
		try {
			// chown first: chmod's setuid bit is cleared by a subsequent chown, so the
			// reverse order silently produces a 0755 file and a "success" report.
			fs.fchownSync(fd, 0, 0);
			fs.fchmodSync(fd, REQUIRED_MODE);
		} catch (err) {
			return { outcome: "not-permitted", path: helperPath, error: err };
		}
		// Re-stat rather than trusting the syscalls returned without throwing. This
		// is the check that catches the ordering inversion above in production: a
		// chmod-then-chown pair succeeds and still leaves 0755.
		const after = fs.fstatSync(fd);
		return isHelperHealthy(after.uid, after.mode & 0o7777)
			? { outcome: "repaired", path: helperPath }
			: { outcome: "not-permitted", path: helperPath };
	} catch (err) {
		return { outcome: "not-permitted", path: helperPath, error: err };
	} finally {
		fs.closeSync(fd);
	}
};

const OPT_OUT_NOTE = (command) => [
	"",
	"If you would rather run without the Chromium sandbox, that is your call to",
	"make: it starts the app but removes a significant security boundary around",
	"the browser engine, so it is not something we enable for you.",
	"",
	`  ELECTRON_DISABLE_SANDBOX=1 ${command}`,
];

/**
 * Guidance for the root case, decided before Electron is spawned.
 */
const rootGuidance = (command) => [
	"Local Operator UI cannot start as root with the Chromium sandbox enabled.",
	"",
	"Electron refuses to run as root and aborts with",
	'"Running as root without --no-sandbox is not supported". This is not caused',
	"by the sandbox helper's permissions and is not fixed by changing them.",
	"",
	"Run the app as your normal desktop user instead. If you installed it with",
	"sudo, only the install needed root:",
	"",
	"  sudo npm install -g local-operator-ui   # install as root",
	`  ${command}                                # run as yourself`,
	...OPT_OUT_NOTE(command),
];

/**
 * Guidance for a launch that already failed with the helper unrepaired.
 *
 * The path is the real resolved one rather than a placeholder, because the whole
 * complaint in issue #91 is that the user is told what is wrong without being
 * told what to type.
 */
// POSIX single-quote escaping: end the quoted run, emit a literal quote, start
// a new one. Copy-paste guidance whose whole point is being pasteable must
// survive an install path like /home/o'brien/.npm-global.
const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const sandboxHelperGuidance = (state, command) => {
	const quoted = shellQuote(state.path);
	const current = `${state.uid}:${state.gid} ${state.mode.toString(8).padStart(4, "0")}`;
	return [
		"Local Operator UI exited before it could start, and its Chromium sandbox",
		"helper is not configured the way Electron requires:",
		"",
		`  ${state.path}`,
		`  currently  ${current}`,
		"  required   0:0 4755",
		"",
		"npm removes setuid bits from package contents, so a global install leaves",
		"this helper unprivileged. Restore it with:",
		"",
		`  sudo chown root:root ${quoted}`,
		`  sudo chmod 4755 ${quoted}`,
		"",
		`Then run ${command} again.`,
		...OPT_OUT_NOTE(command),
	];
};

/**
 * Translate a child process result into an exit code for the wrapper.
 *
 * A Chromium FATAL kills the process with a signal, so `close` reports
 * `code === null, signal === 'SIGTRAP'` (measured). The wrapper used to call
 * `process.exit(code)` with that null, which Node coerces to 0 — so an app that
 * aborted on startup reported success to the shell, to scripts, and to CI. The
 * conventional 128+n encoding preserves which signal it was.
 */
/**
 * Signals that mean "a fatal precondition check killed us", which is how a
 * Chromium sandbox abort actually terminates.
 *
 * This is an ALLOWLIST, and that direction is the point. The previous version
 * asked "is this NOT a deliberate stop?", which acquits Ctrl+C but still
 * convicts every other early death -- including an app that ran its own code and
 * chose an exit status. QA reproduced exactly that: with the sandbox provably
 * not implicated (userns working, so the app reached its own `exit(42)`), the
 * launcher still printed the full chown/chmod guidance. Asking instead "does
 * this death look like a failed CHECK?" is what separates the two.
 *
 * Chromium's LOG(FATAL) raises the debugger trap rather than returning a status,
 * so the sandbox abort arrives as code null + SIGTRAP -- measured in
 * node:22-bookworm, and reported by a shell as 133 (128+5). SIGABRT and SIGILL
 * are the same class of deliberate self-kill on a failed check and are included
 * so the rule is not pinned to one Chromium build's trap instruction.
 *
 * NOT included, deliberately: SIGSEGV and SIGBUS (a memory fault is a genuine
 * crash, not a misconfigured helper), and ANY numeric exit code. A numeric code
 * means the process got far enough to decide one, and the zygote abort never
 * does. The asymmetry is what settles the borderline: a false positive tells a
 * working install to run two sudo commands that change nothing, while a false
 * negative merely leaves the user with Chromium's own message -- the state
 * before this file existed.
 */
const ABORT_SIGNALS = new Set(["SIGTRAP", "SIGABRT", "SIGILL"]);

/**
 * How long after spawn a death can still plausibly be a startup abort.
 *
 * The sandbox FATAL is raised during Chromium's zygote setup, before any window
 * exists -- measured at well under a second in node:22-bookworm. Ten seconds is
 * a deliberately loose bound around that: generous enough for a slow or loaded
 * machine, far short of any session a user would call "it was running".
 */
const STARTUP_WINDOW_MS = 10_000;

/**
 * Did the child fail to START, as opposed to exiting non-zero after running?
 *
 * WHY THIS IS NOT `code !== 0`: the post-mortem below prints "your sandbox
 * helper is misconfigured" and tells the user to chmod 4755. On the exact
 * configuration this fix sets out to protect -- a working 0755 install using the
 * unprivileged user-namespace sandbox -- the helper is PERMANENTLY in the state
 * the guidance keys on, so any non-zero exit misdiagnoses. `code !== 0` is also
 * true for `code === null`, which is every signal death including Ctrl+C: the
 * user quits an app that ran fine for an hour and is told to fix its
 * permissions. That is precisely the "sends the reader to diagnose the wrong
 * thing" failure the postinstall's own comments are careful to avoid.
 *
 * Two conditions, BOTH required: the death has the shape of a fatal check (see
 * ABORT_SIGNALS -- a deliberate stop signal and an ordinary numeric exit are
 * both excluded by it), and it happened inside the startup window, since a
 * process that lived past it demonstrably started.
 */
const isStartupFailure = ({ signal, elapsedMs }) => {
	if (!signal || !ABORT_SIGNALS.has(signal)) {
		return false;
	}
	return typeof elapsedMs !== "number" || elapsedMs < STARTUP_WINDOW_MS;
};

const exitCodeFor = (code, signal) => {
	if (typeof code === "number") {
		return code;
	}
	if (signal) {
		const number = require("node:os").constants.signals[signal];
		return typeof number === "number" ? 128 + number : 1;
	}
	return 1;
};

/**
 * Make sure Electron's dist/ exists before we try to repair the helper inside it.
 *
 * WHY THIS IS NECESSARY, and it is not obvious: npm runs the ROOT package's
 * postinstall BEFORE the postinstall of its dependencies. Measured on a real
 * `npm install -g` in node:22-bookworm, our script is line 27 of the install
 * stream and `electron@35.5.1 postinstall -> node install.js` is line 57 — and
 * that dependency script is what downloads and unpacks dist/. At our turn the
 * helper does not exist yet and `require("electron")` throws
 * "Electron failed to install correctly".
 *
 * The first version of this fix therefore did nothing at all: it reported the
 * helper "absent", exited 0, and Electron then unpacked a fresh 0755 helper
 * afterwards, leaving the bug exactly as it was while the install looked clean.
 * That is the failure mode this file's whole design is meant to avoid, so it is
 * recorded here rather than quietly corrected.
 *
 * The fix is to drive Electron's own installer first. It is idempotent and
 * cache-backed: with a valid dist/ already present it returns in ~0.08s without
 * touching the network, and npm's later invocation of the same script is then
 * the no-op instead. It also preserves a setuid bit we have already set
 * (verified), so the ordering between the two runs does not matter.
 *
 * Returns true when a helper is present afterwards. Every failure degrades to
 * false: the install must still succeed (see bin/postinstall.js).
 */
const ensureElectronDist = (packageRoot) => {
	const installer = path.join(
		packageRoot,
		"node_modules",
		"electron",
		"install.js",
	);
	if (!fs.existsSync(installer)) {
		return false;
	}
	const distDir = path.join(packageRoot, "node_modules", "electron", "dist");
	// Key the fast path on the SAME marker electron's own isInstalled() uses
	// (dist/version) as well as the helper. Keying on chrome-sandbox alone let a
	// partially-extracted dist/ that happens to contain the helper report a
	// healthy install, so we would skip the installer that would have repaired it.
	if (
		fs.existsSync(path.join(distDir, "version")) &&
		fs.existsSync(path.join(distDir, "chrome-sandbox"))
	) {
		return true;
	}
	// Inherit nothing on stdout: the download prints a progress bar that would
	// otherwise appear twice in the install log, once here and once from npm's
	// own run of the same script.
	const result = spawnSync(process.execPath, [installer], {
		cwd: path.dirname(installer),
		stdio: "ignore",
		// A hung download must not hang the install. Ten minutes is generous for a
		// ~100MB fetch on a slow link and still bounded.
		timeout: 10 * 60 * 1000,
	});
	return (
		result.status === 0 && fs.existsSync(path.join(distDir, "chrome-sandbox"))
	);
};

module.exports = {
	REQUIRED_MODE,
	STARTUP_WINDOW_MS,
	isHelperHealthy,
	isStartupFailure,
	ensureElectronDist,
	resolveSandboxHelper,
	inspectSandboxHelper,
	repairSandboxHelper,
	rootGuidance,
	sandboxHelperGuidance,
	exitCodeFor,
};
