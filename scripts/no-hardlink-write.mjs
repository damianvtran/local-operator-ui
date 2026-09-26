#!/usr/bin/env node
/**
 * Refuses a mutating write whose target shares its inode with another name.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS WIRED INTO THE RUNNER RATHER THAN A TEST.
 * On 2026-09-18 a `pnpm test:desktop` run on this host left
 * `/Users/damian/.local/share/uv/python/cpython-3.12-macos-aarch64-none/bin/python3.12`
 * as a 12-byte text file. `uv` hardlinks an interpreter into each venv rather
 * than copying it — that is what makes dozens of venvs cheap — so the file had
 * 23 names (27 on this host today) and the write landed on the ONE inode all of
 * them point at. Every 3.12 venv on the machine stopped working until
 * `uv python install 3.12 --reinstall`. The run was killed rather than repeated
 * and the offending suite was never reduced, which is the second half of why
 * this is a guard over the whole suite instead of an edit to one call site: a
 * hazard that cannot be reproduced today is one a future test can reintroduce
 * with a single `writeFileSync`. See issue #381.
 *
 * The cheap check is the whole guard: `stat().nlink > 1` on the target. What a
 * write through a link actually costs is every OTHER name of that inode, and no
 * test file can see them — `writeFileSync(join(venv, "bin", "python"), stub)` on
 * a venv whose `bin/python` is a uv hardlink rewrites the shared interpreter for
 * the entire machine.
 *
 * THREE EXCLUSIONS, and each one is a measured false positive rather than a
 * concession:
 *
 *  - a DIRECTORY is not a hard link. Its link count is 2 + its subdirectory
 *    count, so a `chmodSync` of a temp fixture's root (nlink 4) or of a mounted
 *    volume's directory (nlink 5) is ordinary and must not be refused;
 *  - a hardlink INSIDE the process temp ground is the fixture's own business.
 *    The product hardlinks an interpreter while staging a runtime
 *    (`runtime/python`, nlink 3 inside a `lo-managed-python-*` fixture) on
 *    purpose, because that is how it copies cheaply. The hazard is a target that
 *    LEAVES that ground for something shared, so the refusal is scoped to a
 *    target whose realpath is outside `tmpdir()`. Note that the realpath is what
 *    is compared: on macOS `tmpdir()` is `/var/folders/...` while the same
 *    directory resolves to `/private/var/folders/...`, so a comparison against
 *    the raw string matches nothing and the guard silently disarms;
 *  - a READ is not a write. `openSync(path, "r")` on a linked file is what a
 *    test does to inspect a shared runtime, and only `w`/`a`/`+` flags (or a
 *    numeric mode carrying a write bit) can clobber.
 *
 * EVERY nlink > 1 hit is RECORDED, refused or not, and `NLINK_GUARD_HITS`
 * appends them as JSON Lines. A scoped-out write that nobody can see is the
 * false green this repository treats as the cardinal sin, so the exemption is
 * reported rather than silent.
 */

import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

/**
 * The CJS `node:fs` exports object, obtained WITHOUT an ESM `node:fs` import.
 *
 * This is the difference between a guard that works and one that reports a
 * clean run while the clobber happens. Node builds the named-export view of a
 * CJS builtin at that module's FIRST ESM import, and an ESM namespace object is
 * read-only — so `import * as fs from "node:fs"` cannot be patched at all, and
 * patching a default-imported object after the fact leaves every
 * `import { writeFileSync } from "node:fs"` in every test file holding the
 * ORIGINAL function. `createRequire` reaches the exports object itself, whose
 * properties are writable and are what the named bindings read.
 */
const require = createRequire(import.meta.url);
const fs = require("node:fs");

/** The flags an open may carry that can modify the path it names. */
const WRITE_FLAG = /[wa+]/;

/** Raised instead of damaging an inode that other names reach. */
export class SharedInodeWriteError extends Error {
	constructor(message) {
		super(message);
		this.name = "SharedInodeWriteError";
	}
}

/**
 * The process temp ground, REALPATH'D once.
 *
 * `tmpdir()` and `realpathSync` disagree on macOS (`/var` vs `/private/var`), and
 * comparing a resolved target against the unresolved string is a guard that
 * never fires. Failing to resolve is not a reason to refuse every temp write, so
 * it degrades to the raw value.
 */
function tempGround() {
	try {
		return fs.realpathSync(tmpdir());
	} catch {
		return resolve(tmpdir());
	}
}

function inTempGround(realPath) {
	const root = tempGround();
	return realPath === root || realPath.startsWith(root + sep);
}

/**
 * Whether `flag` opens a path in a way that can modify it.
 *
 * A numeric mode carries the write bit in `O_WRONLY`/`O_RDWR`/`O_CREAT`/
 * `O_TRUNC`/`O_APPEND`, and node accepts that spelling, so it is tested rather
 * than treated as a read.
 */
export function flagsAllowWrite(flag) {
	if (typeof flag === "number") {
		// O_WRONLY 1, O_RDWR 2, O_CREAT 0o100, O_TRUNC 0o1000, O_APPEND 0o2000
		return (flag & 0o3) !== 0 || (flag & 0o3100) !== 0;
	}
	return typeof flag === "string" && WRITE_FLAG.test(flag);
}

/**
 * Whether `target` is a file whose inode other names also reach.
 *
 * The cheap check the issue asks for: `stat().nlink > 1`. Returns a descriptor
 * rather than a boolean because every caller needs the numbers for the message,
 * and `null` for everything that cannot be damaged — a path that does not exist,
 * a directory (whose link count is 2 + its subdirectory count, not a hard link),
 * and an ordinary single-name file.
 */
export function sharedInodeWrite(op, target) {
	if (target === undefined || target === null) return null;
	let stats;
	try {
		stats = fs.statSync(target);
	} catch {
		return null; // nothing there to damage
	}
	if (!stats.isFile()) return null;
	if (stats.nlink <= 1) return null;
	let real;
	try {
		real = fs.realpathSync(target);
	} catch {
		real = resolve(String(target));
	}
	return {
		op,
		target: String(target),
		real,
		nlink: stats.nlink,
		ino: stats.ino,
		dev: stats.dev,
		exemptInTempGround: inTempGround(real),
	};
}

/**
 * What each wrapped operation does to the paths it is handed.
 *
 * ARGUMENT POSITION IS THE BUG THIS TABLE EXISTS TO PREVENT. A guard that checks
 * `args[0]` for every name looks right and is wrong for two of them:
 * `copyFileSync(src, dest)` truncates the DESTINATION, so a
 * `copyFileSync(stub, venvBinPython)` — which is exactly "a test fakes an
 * interpreter by writing a stub onto the python path" — walks straight through a
 * check on `src`, which is the stub. `renameSync(old, new)` replaces `new` and
 * leaves `old`'s inode intact for its other names, so its content check belongs
 * on the second argument too; its first is still checked, because moving a
 * shared inode into a test tree strands the other names where the test will then
 * delete it.
 *
 * `clobbers: false` is a SCOPE statement, not an oversight, and the namespace
 * operations are in the table so the reader can see they were considered:
 * `linkSync` INCREMENTS a link count and `unlinkSync` DECREMENTS one — removing
 * one name leaves the content intact for every other name, which is the opposite
 * of the hazard. They are recorded and never refused. Refusing them is how a
 * guard that reds legitimate harnesses gets switched off, and the refusal
 * wording ("a write here changes every one of them") would be factually wrong
 * about them.
 */
const OPERATIONS = {
	writeFileSync: { victim: 0 },
	appendFileSync: { victim: 0 },
	truncateSync: { victim: 0 },
	copyFileSync: { victim: 1, modeArg: 2 },
	openSync: { victim: 0, flagArg: 1, defaultFlag: "w" },
	createWriteStream: {
		victim: 0,
		flagArg: 1,
		flagKey: "flags",
		defaultFlag: "w",
	},
	chmodSync: { victim: 0 },
	lchmodSync: { victim: 0 },
	chownSync: { victim: 0 },
	lchownSync: { victim: 0 },
	utimesSync: { victim: 0 },
	lutimesSync: { victim: 0 },
	renameSync: { victim: 1, alsoCheck: 0 },
	linkSync: { victim: 1, clobbers: false },
	symlinkSync: { victim: 1, clobbers: false },
	unlinkSync: { victim: 0, clobbers: false },
	rmSync: { victim: 0, clobbers: false },
	rmdirSync: { victim: 0, clobbers: false },
	mkdirSync: { victim: 0, clobbers: false },
};

/**
 * The same questions for the Promise API, which is a live property lookup rather
 * than a snapshot and therefore a second surface a suite can reach — a test that
 * awaits `fs.promises.writeFile` would bypass every sync wrapper above. The
 * names differ (`writeFile`, not `writeFileSync`) and the argument positions are
 * identical, so this table restates them rather than deriving them: a derivation
 * with a wrong mapping would silently unwrap a whole surface, and that is the
 * failure this file exists to make impossible.
 */
const PROMISE_OPERATIONS = {
	writeFile: { victim: 0 },
	appendFile: { victim: 0 },
	truncate: { victim: 0 },
	copyFile: { victim: 1, modeArg: 2 },
	open: { victim: 0, flagArg: 1, defaultFlag: "w" },
	chmod: { victim: 0 },
	lchmod: { victim: 0 },
	chown: { victim: 0 },
	lchown: { victim: 0 },
	utimes: { victim: 0 },
	lutimes: { victim: 0 },
	rename: { victim: 1, alsoCheck: 0 },
	link: { victim: 1, clobbers: false },
	symlink: { victim: 1, clobbers: false },
	unlink: { victim: 0, clobbers: false },
	rm: { victim: 0, clobbers: false },
	rmdir: { victim: 0, clobbers: false },
	mkdir: { victim: 0, clobbers: false },
};

/**
 * The flag a call opens with, read from wherever that call puts it.
 *
 * `createWriteStream(path, { flags: "w" })` passes an OPTIONS OBJECT, and a
 * guard that only accepts a string or a number reads that as "not a write"
 * before it ever stats — so the default form was refused while the explicit form
 * clobbered the inode. The object form is what a caller who thought about the
 * flags writes, which makes it the last one that should slip through.
 */
function openFlagFor(spec, args) {
	const raw = args[spec.flagArg];
	if (raw === undefined) return spec.defaultFlag;
	if (typeof raw === "string" || typeof raw === "number") return raw;
	if (raw !== null && typeof raw === "object" && spec.flagKey in raw) {
		return raw[spec.flagKey];
	}
	return spec.defaultFlag;
}

/**
 * Decide whether a call must be refused, and which of its paths is at risk.
 *
 * Returns `{ hit, mayClobber }`: `hit` is the descriptor for the path the call
 * would damage (`null` when there is nothing to damage) and `mayClobber` is the
 * operation's own scope statement from the table above. Exported so the guard
 * instance and its test ask the same question rather than two similar ones.
 */
export function classifyCall(op, args) {
	/*
	 * The Promise wrappers are labelled `promises.<name>` so a refusal says which
	 * surface was used, and both tables are keyed by the bare name — the prefix is
	 * stripped here rather than duplicated into every row. Getting this wrong is
	 * silent in the worst way: an unmatched label falls through to
	 * `{ hit: null, mayClobber: true }`, so the guard reports nothing while the
	 * write lands, which is exactly the false green this file exists to prevent.
	 */
	const name = op.startsWith("promises.") ? op.slice("promises.".length) : op;
	const spec = OPERATIONS[name] ?? PROMISE_OPERATIONS[name];
	if (!spec) return { hit: null, mayClobber: true };
	if (spec.clobbers === false) return { hit: null, mayClobber: false };
	if (spec.flagArg !== undefined && !flagsAllowWrite(openFlagFor(spec, args))) {
		return { hit: null, mayClobber: false };
	}
	/*
	 * A copy that may not overwrite an existing destination cannot damage the
	 * shared inode — `COPYFILE_EXCL` makes the call fail with EEXIST first — so
	 * refusing it would be a false positive on the one spelling already safe.
	 */
	if (spec.modeArg !== undefined) {
		const mode = args[spec.modeArg];
		if (typeof mode === "number" && (mode & fs.constants.COPYFILE_EXCL) !== 0) {
			return { hit: null, mayClobber: false };
		}
	}
	const hit = sharedInodeWrite(op, args[spec.victim]);
	if (hit) return { hit, mayClobber: true };
	if (spec.alsoCheck !== undefined) {
		return {
			hit: sharedInodeWrite(op, args[spec.alsoCheck]),
			mayClobber: true,
		};
	}
	return { hit: null, mayClobber: true };
}

/**
 * Why the write is refused, in the operator's terms rather than the guard's.
 *
 * The measured incident is stated because a generic "unsafe write" is what gets
 * a guard deleted: whoever meets this error needs to know the names it is
 * protecting are on the whole machine, not in their worktree.
 */
const REFUSAL_REASON =
	"names point at that inode, so a write here changes every one of them — this is " +
	"how the uv-managed interpreter was replaced on 2026-09-18 (issue #381). Write " +
	"to a private copy instead, or set LOCAL_OPERATOR_UI_NO_HARDLINK_GUARD=1 to run unguarded.";

function refuse(hit) {
	throw new SharedInodeWriteError(
		`refusing ${hit.op} on ${hit.target}: link count ${hit.nlink}, shared inode ${hit.ino} (device ${hit.dev}). ${hit.nlink} ${REFUSAL_REASON}`,
	);
}

/**
 * Wrap every operation in the tables above with the refusal.
 *
 * IDEMPOTENT, and the idempotence is load-bearing rather than tidy: this module
 * patches in place, so installing twice would wrap the wrapper and a refusal
 * would arrive as a stack of identically-worded errors. It is also what makes
 * arming it from both the preload and a test harmless.
 */
export function installHardlinkWriteGuard({ record = () => {} } = {}) {
	const installed = [];
	const wrap = (holder, name, label) => {
		const original = holder[name];
		if (typeof original !== "function" || original.__hardlinkGuard) return;
		const wrapped = function guardedMutation(...args) {
			const { hit, mayClobber } = classifyCall(label, args);
			if (hit) {
				record({ ...hit, mayClobber });
				if (mayClobber && !hit.exemptInTempGround) refuse(hit);
			}
			return original.apply(holder, args);
		};
		Object.defineProperty(wrapped, "name", { value: name });
		wrapped.__hardlinkGuard = true;
		holder[name] = wrapped;
		installed.push(label);
	};

	for (const name of Object.keys(OPERATIONS)) wrap(fs, name, name);
	for (const name of Object.keys(PROMISE_OPERATIONS)) {
		wrap(fs.promises, name, `promises.${name}`);
	}

	return installed;
}
