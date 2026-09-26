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
 * WHAT IT PROTECTS, STATED NO WIDER THAN THE CODE: a desktop TEST-FILE process
 * cannot write through a shared inode. The guard is installed with `--import`,
 * which is per-process, so a node process a test SPAWNS is not covered — those
 * are the product's own children, they hardlink an interpreter while staging a
 * runtime, and arming them was measured to buy nothing. That gap is deliberate
 * and is recorded rather than papered over.
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
 *  - a hardlink the FIXTURE ITSELF created inside the process temp ground is its
 *    own business. The product hardlinks an interpreter while staging a runtime
 *    — `linkSync(binary, join(root, "Local Operator"))`, nlink 3, every name
 *    inside one `lo-managed-python-*` fixture, then written through on purpose.
 *    That is how it copies cheaply, and it must keep working.
 *
 *    THE EXEMPTION IS GRANTED PER INODE, ON THE AUTHORITY OF THE `linkSync` THAT
 *    CREATED THE LINK, NOT ON THE PATH BEING WRITTEN — and that is a fixed hole
 *    rather than a style choice. The path-keyed form was exploitable in two
 *    sanctioned calls: `linkSync(<shared file outside the ground>, join(
 *    mkdtempSync(join(tmpdir(), "x-")), "linked"))` then `writeFileSync(<that
 *    temp path>, "STUB")`. The write's path is inside the ground, so it was
 *    exempt, and the shared inode was clobbered.
 *
 *    The tempting repair — "ask where the INODE resolves" — does NOT work, and
 *    is worth recording because it looks right: a hard link has no canonical
 *    name, so `realpathSync` on any of its names answers with the path it was
 *    handed, and the test collapses back into the path test it was meant to
 *    replace. Measured: the evasion still wrote through.
 *
 *    So the ground is entered by DECLARATION. `linkSync` is wrapped, and it
 *    records the `dev:ino` of a link only when BOTH of its arguments are inside
 *    the ground — a fixture building its own tree, which is the legitimate case.
 *    A link whose source lives outside the ground is a shared inode being given
 *    a temp name, and it is refused outright. A name REACHING the ground by
 *    `rename` is not recorded, because the inode was already somewhere else;
 *  - a READ is not a write. `openSync(path, "r")` on a linked file is what a
 *    test does to inspect a shared runtime, and only `w`/`a`/`+` flags (or a
 *    numeric mode carrying a write bit) can clobber.
 *
 * EVERY `nlink > 1` hit is RECORDED, refused or not, and `NLINK_GUARD_HITS`
 * appends them as JSON Lines when it is set. A scoped-out write that nobody can
 * see is the false green this repository treats as the cardinal sin, so the
 * exemption is reported rather than silent.
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

/** The native ledger writer, captured before the wrappers below replace it. */
const nativeAppendFileSync = fs.appendFileSync;

/**
 * Where the audit ledger goes, when a caller asks for one.
 *
 * Read per hit rather than cached, so a test can set it after this module is
 * loaded. Read through the captured native: the module's own `appendFileSync`
 * is wrapped below, and a ledger write must not be able to recurse into the
 * guard or be refused by it.
 */
function hitsLedgerPath() {
	return process.env.NLINK_GUARD_HITS || null;
}

export function recordHit(hit) {
	const ledger = hitsLedgerPath();
	if (!ledger) return;
	try {
		nativeAppendFileSync(ledger, `${JSON.stringify(hit)}\n`);
	} catch {
		/* a ledger that cannot be written must never mask the refusal */
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

/**
 * Whether `path` is inside the process temp ground.
 *
 * The REALPATH of both sides is what is compared: on macOS `tmpdir()` is
 * `/var/folders/...` while the same directory resolves to
 * `/private/var/folders/...`, so a comparison against the raw string matches
 * nothing and the guard silently disarms.
 */
function isInTempGround(path) {
	let real;
	try {
		real = fs.realpathSync(path);
	} catch {
		real = resolve(String(path));
	}
	const root = tempGround();
	return real === root || real.startsWith(root + sep);
}

/**
 * The `dev:ino` keys this process has DECLARED as a fixture's own temp inode.
 *
 * Populated only by the `linkSync` wrapper, and only for a link whose every name
 * is inside the ground. There is intentionally no path-based fallback: a path
 * test is what the evasion defeated, and a hard link cannot be located by
 * resolving one of its names.
 */
const declaredTempInodes = new Set();

/**
 * Depth of the guard's own wrappers, so a call node makes INTERNALLY is not
 * counted twice.
 *
 * `fs.appendFileSync` re-enters `fs.writeFileSync`, so one `appendFileSync`
 * through a link produced TWO ledger entries and an exemption summary that said
 * "2 linked write(s)" for a single call. A ledger that double-counts is one
 * nobody can audit — the count is the whole point of the trail — so a nested
 * entry records nothing and refuses nothing: the OUTER call has already made
 * that decision for the same inode.
 */
let guardDepth = 0;

/** The key an inode is declared and looked up under. */
function inodeKey(stats) {
	return `${stats.dev}:${stats.ino}`;
}

/**
 * Record a link the fixture made entirely inside its own temp ground.
 *
 * Returns `true` when the link is the fixture's own (both names in the ground),
 * and `false` when it would give a name inside the ground to an inode that lives
 * outside it — which is the evasion, and is refused rather than merely recorded.
 */
export function declareTempLink(source, destination) {
	if (!isInTempGround(source) || !isInTempGround(destination)) return false;
	let stats;
	try {
		stats = fs.statSync(source);
	} catch {
		return false;
	}
	declaredTempInodes.add(inodeKey(stats));
	return true;
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
	return {
		op,
		target: String(target),
		nlink: stats.nlink,
		ino: stats.ino,
		dev: stats.dev,
		exemptInTempGround: declaredTempInodes.has(inodeKey(stats)),
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
 * check on `src`, which is the stub.
 *
 * `clobbers: false` is a SCOPE statement, not an oversight, and the namespace
 * operations are in the table so the reader can see they were considered. They
 * move NAMES and never content: `linkSync` INCREMENTS a link count, `unlinkSync`
 * DECREMENTS one, and `rename` rewrites which name points where — removing or
 * relabelling one name leaves the content intact for every other name, which is
 * the opposite of the hazard. `rename` was refused in an earlier revision and
 * that was the wrong side of the asymmetry: a refusal whose message says "a
 * write here changes every one of them" is factually false about a rename, and a
 * guard that reds legitimate harnesses is one that gets switched off. The route
 * a rename could have opened is closed by the inode-keyed exemption above.
 */
const OPERATIONS = {
	writeFileSync: { victim: 0 },
	appendFileSync: { victim: 0 },
	truncateSync: { victim: 0 },
	copyFileSync: { victim: 1, modeArg: 2 },
	openSync: { victim: 0, flagArg: 1, defaultFlag: "r" },
	createWriteStream: {
		victim: 0,
		flagArg: 1,
		flagKey: "flags",
		objectOnlyFlag: true,
		defaultFlag: "w",
	},
	chmodSync: { victim: 0 },
	lchmodSync: { victim: 0 },
	chownSync: { victim: 0 },
	lchownSync: { victim: 0 },
	utimesSync: { victim: 0 },
	lutimesSync: { victim: 0 },
	renameSync: { victim: 0, clobbers: false },
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
	open: { victim: 0, flagArg: 1, defaultFlag: "r" },
	chmod: { victim: 0 },
	lchmod: { victim: 0 },
	chown: { victim: 0 },
	lchown: { victim: 0 },
	utimes: { victim: 0 },
	lutimes: { victim: 0 },
	rename: { victim: 0, clobbers: false },
	link: { victim: 1, clobbers: false },
	symlink: { victim: 1, clobbers: false },
	unlink: { victim: 0, clobbers: false },
	rm: { victim: 0, clobbers: false },
	rmdir: { victim: 0, clobbers: false },
	mkdir: { victim: 0, clobbers: false },
};

/**
 * The CALLBACK forms, which are a third surface and were unwrapped entirely.
 *
 * `fs.writeFile(path, data, cb)` clobbers exactly as the sync form does. The
 * callback is the LAST argument and must never be read as a path, so the victim
 * position stays the same as the sync table's and only the argument COUNT
 * differs — a callback form has one more argument than its sync twin.
 */
const CALLBACK_OPERATIONS = {
	writeFile: { victim: 0 },
	appendFile: { victim: 0 },
	truncate: { victim: 0 },
	copyFile: { victim: 1, modeArg: 2 },
	open: { victim: 0, flagArg: 1, defaultFlag: "r" },
	chmod: { victim: 0 },
	lchmod: { victim: 0 },
	chown: { victim: 0 },
	lchown: { victim: 0 },
	utimes: { victim: 0 },
	lutimes: { victim: 0 },
	rename: { victim: 0, clobbers: false },
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
 * The shape differs per call and each difference was a hole first:
 *
 *  - `createWriteStream(path, { flags: "w" })` passes an OPTIONS OBJECT, and a
 *    guard that only accepts a string or a number reads that as "not a write"
 *    before it ever stats;
 *  - `createWriteStream(path, "utf8")` passes the ENCODING. Only the OBJECT form
 *    states flags for a stream, so a non-object second argument there means the
 *    default flags — reading the string as flags is what let "utf8" through;
 *  - `open(path)` with no flag is a READ in node, so open's default is `"r"`.
 */
function openFlagFor(spec, args) {
	const raw = args[spec.flagArg];
	if (raw === undefined) return spec.defaultFlag;
	if (raw !== null && typeof raw === "object" && spec.flagKey in raw) {
		return raw[spec.flagKey];
	}
	if (spec.objectOnlyFlag) return spec.defaultFlag;
	if (typeof raw === "string" || typeof raw === "number") return raw;
	return spec.defaultFlag;
}

/**
 * Decide whether a call must be refused, and which of its paths is at risk.
 *
 * `form` names which table the operation came from (`sync`, `promise` or
 * `callback`); the tables are kept separate rather than merged because the same
 * name can exist in more than one, and a merge would silently pick one.
 *
 * Returns `{ hit, mayClobber }`: `hit` is the descriptor for the path the call
 * would damage (`null` when there is nothing to damage) and `mayClobber` is the
 * operation's own scope statement from the table above. Exported so the guard
 * instance and its test ask the same question rather than two similar ones.
 */
export function classifyCall(op, args, form = "sync") {
	/*
	 * The label a wrapper passes is prefixed (`callback.writeFile`) so a refusal
	 * says which surface was used, while every table is keyed by the bare name.
	 * The prefix MUST be stripped here rather than assumed absent: an unmatched
	 * label falls through to `{ hit: null }`, which is not a loud failure but the
	 * quietest one possible — the guard reports nothing and the write lands. It
	 * has now caused that twice, once on the Promise surface and once on the
	 * callback surface, which is why the strip is unconditional.
	 */
	const name = op.includes(".") ? op.slice(op.indexOf(".") + 1) : op;
	const spec =
		form === "promise"
			? PROMISE_OPERATIONS[name]
			: form === "callback"
				? CALLBACK_OPERATIONS[name]
				: OPERATIONS[name];
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
	return { hit: sharedInodeWrite(op, args[spec.victim]), mayClobber: true };
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
export function installHardlinkWriteGuard({ record = recordHit } = {}) {
	const installed = [];
	const wrap = (holder, name, label, form, body) => {
		const original = holder[name];
		if (typeof original !== "function" || original.__hardlinkGuard) return;
		const wrapped = function guardedMutation(...args) {
			if (guardDepth > 0) return original.apply(holder, args);
			if (body) return body(args, () => original.apply(holder, args));
			const { hit, mayClobber } = classifyCall(label, args, form);
			if (hit) {
				record({ ...hit, mayClobber, form });
				if (mayClobber && !hit.exemptInTempGround) refuse(hit);
			}
			guardDepth += 1;
			try {
				return original.apply(holder, args);
			} finally {
				guardDepth -= 1;
			}
		};
		Object.defineProperty(wrapped, "name", { value: name });
		wrapped.__hardlinkGuard = true;
		holder[name] = wrapped;
		installed.push(label);
	};

	/*
	 * `linkSync` is the one operation that both moves a name AND decides an
	 * exemption, so it is wrapped with its own body rather than the generic one:
	 * the declaration has to run only AFTER the link exists, and a link whose
	 * source is outside the ground must be refused before it is made — that is
	 * the evasion this closes.
	 */
	wrap(fs, "linkSync", "linkSync", "sync", (args, call) => {
		if (guardDepth > 0) return call();
		/*
		 * ONLY the laundering direction is refused: a name OUTSIDE the ground being
		 * given a name INSIDE it. Two names outside the ground are an ordinary
		 * hardlink between a fixture's own files — linking a cache file to another
		 * cache file harms nothing, and refusing it would be the over-broad class of
		 * false positive that gets a guard switched off. Linking within the ground is
		 * the declared, legitimate case.
		 */
		const [source, destination] = args;
		if (!isInTempGround(source) && isInTempGround(destination)) {
			const hit = sharedInodeWrite("linkSync", source);
			if (hit) {
				record({ ...hit, mayClobber: true, form: "sync" });
				refuse(hit);
			}
		}
		const result = call();
		declareTempLink(source, destination);
		return result;
	});

	for (const name of Object.keys(OPERATIONS)) {
		if (name === "linkSync") continue;
		wrap(fs, name, name, "sync");
	}
	for (const name of Object.keys(PROMISE_OPERATIONS)) {
		wrap(fs.promises, name, `promises.${name}`, "promise");
	}
	for (const name of Object.keys(CALLBACK_OPERATIONS)) {
		wrap(fs, name, `callback.${name}`, "callback");
	}

	return installed;
}
