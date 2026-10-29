/**
 * Bounded eviction for Storybook's on-disk cache - the one Storybook 8.6 never evicts.
 *
 * WHY THIS EXISTS. Storybook keys its cache by a hash of the config dir relative to the
 * project root (`<root>/<64-hex cacheKey>/{public,sb-manager,sb-vite/deps}`), so every
 * checkout and every worktree that runs `storybook dev|build` leaves its own directory
 * behind, forever. Measured 2026-10-28 on this machine: 85 such directories in one
 * `node_modules/.cache/storybook` after six days (6.12 GiB by `du`, ~0.5 GiB real because
 * the worktree dependency trees are APFS clones), on a disk ~25 sessions share. Checked
 * against the installed 8.6.12 `@storybook/core` (`common` + `core-server` dist) and
 * `storybook dev --help`: there is NO option, flag or env var that evicts, caps or ages
 * it - `CACHE_DIR` only MOVES the root. So the policy has to live in this repository.
 *
 * Everything under the root is regenerable: a pruned entry costs the next run a cold
 * Vite dependency pre-bundle (seconds to a minute), never a wrong result.
 *
 * THE POLICY (all numbers are options, defaulted here, overridable by env - see
 * `pruneOptionsFromEnv`):
 *   1. An entry whose newest mtime is older than `maxAgeMs` (48 h) is removed.
 *   2. If more than `maxEntries` (40) remain, the oldest go first until the cap holds -
 *      but NEVER an entry touched within `minKeepAgeMs` (6 h): that is a live server's
 *      cache, and deleting `sb-vite/deps` from under a running Vite makes every reload
 *      answer "outdated optimize dep". So the cap is best-effort: many fresh entries
 *      stay over it rather than break a running Storybook.
 *   3. `protectKey` (the current run's cache key) is never removed, whatever its age.
 *
 * WHAT IT WILL TOUCH. Only direct children of the root that are real directories (an
 * `lstat`, so a symlink is never followed) named by exactly 64 lowercase hex digits.
 * Anything else a person or another tool put there is left alone. The root itself must
 * look like a Storybook cache (`.../.cache/storybook`, or `<CACHE_DIR>/storybook` when
 * `CACHE_DIR` is set - the two shapes `@storybook/core/common` resolves to) and must not
 * be a symlink; otherwise the prune REFUSES, because `rmSync(recursive)` with a wrongly
 * resolved root is the failure mode that makes this dangerous. No shell, no globbing:
 * `fs.rmSync` is only ever called on a path this module built from a verified child name.
 *
 * AGE IS CHEAP ON PURPOSE. The newest mtime among the entry directory, its immediate
 * children, and `sb-vite/deps` (where Vite's optimizer writes, so it moves whenever the
 * entry is in use). No deep walk: this runs on every Storybook start.
 *
 * FAILS OPEN. A prune problem must never stop Storybook from starting, so every fs error
 * is caught per entry (the entry is reported in `failed`) and a whole-run failure is
 * returned as `error`, never thrown.
 *
 * Wired in `.storybook/main.ts` (config load, so `pnpm storybook`, a bare
 * `storybook dev` and `storybook build` are all covered). It is not a package.json
 * script: a script only covers the invocations that remember to call it, and the
 * worktrees that leak this cache are the ones started by hand.
 *
 *     node scripts/storybook-cache-prune.mjs [--dry-run] [root]
 *
 * runs it from a shell; with no root it uses `CACHE_DIR`'s or the nearest `node_modules`
 * default for the current directory, the same rule Storybook applies.
 */

import {
	lstatSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	utimesSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";

export const DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const DEFAULT_MAX_ENTRIES = 40;
export const DEFAULT_MIN_KEEP_AGE_MS = 6 * 60 * 60 * 1000;

/** Storybook's cache key: a SHA-256 hex digest, so exactly 64 lowercase hex digits. */
const ENTRY_NAME = /^[0-9a-f]{64}$/;

/**
 * Total `lstat` calls spent sizing ALL doomed entries in one prune. The first run on a
 * long-neglected cache can doom 85 entries of tens of thousands of files each, and this
 * runs synchronously at Storybook config load, so the figure is a bounded lower bound
 * (printed as "at least") rather than a walk that could stat millions of files.
 */
const SIZE_WALK_BUDGET = 4_000;

/** `CACHE_DIR` values Storybook treats as a flag rather than a path. */
const CACHE_DIR_FLAGS = new Set(["true", "false", "1", "0"]);

/**
 * Why `root` is not a directory this module may delete under, or `null` when it is.
 * Mirrors `findCacheDirectory` in `@storybook/core/common`: `<CACHE_DIR>/storybook`, or
 * `<project>/node_modules/.cache/storybook`.
 */
export function refusalFor(root, env = process.env) {
	if (typeof root !== "string" || root === "") return "no cache root given";
	const abs = resolve(root);
	if (basename(abs) !== "storybook") return `not a storybook directory: ${abs}`;
	const cacheDir = env.CACHE_DIR;
	const underCacheDir =
		cacheDir &&
		!CACHE_DIR_FLAGS.has(cacheDir) &&
		abs === resolve(cacheDir, "storybook");
	if (!underCacheDir && basename(dirname(abs)) !== ".cache") {
		return `neither .cache/storybook nor $CACHE_DIR/storybook: ${abs}`;
	}
	let stat;
	try {
		stat = lstatSync(abs);
	} catch (error) {
		return `unreadable root: ${error.code ?? error.message}`;
	}
	// A symlinked root would aim every rmSync below at wherever it points.
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		return `root is a symlink or not a directory: ${abs}`;
	}
	if (realpathSync(abs) !== join(realpathSync(dirname(abs)), basename(abs))) {
		return `root resolves outside its parent: ${abs}`;
	}
	return null;
}

/** Newest mtime (ms) among the entry, its immediate children and `sb-vite/deps`. */
function newestMtimeMs(entryPath) {
	let newest = statSync(entryPath).mtimeMs;
	const consider = (path) => {
		try {
			newest = Math.max(newest, statSync(path).mtimeMs);
		} catch {
			// Vanished between listing and stat: it simply does not count.
		}
	};
	for (const child of readdirSync(entryPath)) consider(join(entryPath, child));
	consider(join(entryPath, "sb-vite", "deps"));
	return newest;
}

/** Bounded byte estimate of a tree about to go; logical size, so clones overcount. */
function estimateBytes(path, budget) {
	let bytes = 0;
	const stack = [path];
	while (stack.length > 0 && budget.left > 0) {
		const current = stack.pop();
		let stat;
		try {
			stat = lstatSync(current);
		} catch {
			continue;
		}
		budget.left -= 1;
		bytes += stat.size;
		if (stat.isDirectory()) {
			try {
				for (const child of readdirSync(current))
					stack.push(join(current, child));
			} catch {
				// Unreadable subtree: the estimate is a lower bound.
			}
		}
	}
	return bytes;
}

/**
 * Prune `root` per the policy above. Pure apart from the `rmSync` calls (injectable as
 * `rm` so a test can make one fail), the optional `log`, and the filesystem reads.
 *
 * Returns `{ kept, removed, failed, bytesEstimate, refused?, error? }`; `kept` and
 * `removed` are entry names. With `dryRun`, `removed` is what WOULD go and nothing is
 * deleted.
 */
export function pruneStorybookCache({
	root,
	now = Date.now(),
	maxAgeMs = DEFAULT_MAX_AGE_MS,
	maxEntries = DEFAULT_MAX_ENTRIES,
	minKeepAgeMs = DEFAULT_MIN_KEEP_AGE_MS,
	dryRun = false,
	protectKey = null,
	env = process.env,
	rm = (path) => rmSync(path, { recursive: true, force: true }),
	log = null,
} = {}) {
	const result = { kept: [], removed: [], failed: [], bytesEstimate: 0 };
	try {
		const refused = refusalFor(root, env);
		if (refused) {
			log?.(`storybook cache prune skipped: ${refused}`);
			return { ...result, refused };
		}
		const abs = resolve(root);
		const entries = [];
		for (const name of readdirSync(abs)) {
			if (!ENTRY_NAME.test(name)) continue;
			const path = join(abs, name);
			try {
				if (!lstatSync(path).isDirectory()) continue; // symlinks and files stay
				entries.push({ name, path, mtimeMs: newestMtimeMs(path) });
			} catch {
				// Unreadable entry: leave it, do not let it stop the others.
			}
		}
		entries.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

		// Rule 1 judges liveness by mtime, but a dev server that has been up (or warm-
		// restarted) for days rewrites nothing under the entry, so another worktree's
		// start would delete a running server's deps ("outdated optimize dep"). Stamping
		// the current run's entry fresh makes every started run count as live for the
		// whole age window. Skipped on a dry run, which must change nothing.
		if (protectKey && ENTRY_NAME.test(protectKey)) {
			const current = entries.find((entry) => entry.name === protectKey);
			if (current) {
				if (!dryRun) {
					try {
						utimesSync(current.path, new Date(now), new Date(now));
					} catch {
						// Cannot stamp it: it is still exempt from removal below.
					}
				}
				current.mtimeMs = now;
			}
		}

		const doomed = new Set();
		const sizeBudget = { left: SIZE_WALK_BUDGET };
		const protectedEntry = (entry) => entry.name === protectKey;
		for (const entry of entries) {
			if (now - entry.mtimeMs > maxAgeMs && !protectedEntry(entry)) {
				doomed.add(entry.name);
			}
		}
		let remaining = entries.length - doomed.size;
		for (const entry of entries) {
			if (remaining <= maxEntries) break;
			if (doomed.has(entry.name) || protectedEntry(entry)) continue;
			// Sorted oldest-first, so the first young-enough entry ends the trim.
			if (now - entry.mtimeMs < minKeepAgeMs) break;
			doomed.add(entry.name);
			remaining -= 1;
		}

		for (const entry of entries) {
			if (!doomed.has(entry.name)) {
				result.kept.push(entry.name);
				continue;
			}
			const bytes = estimateBytes(entry.path, sizeBudget);
			if (!dryRun) {
				try {
					rm(entry.path);
				} catch {
					result.failed.push(entry.name);
					result.kept.push(entry.name);
					continue;
				}
			}
			result.removed.push(entry.name);
			result.bytesEstimate += bytes;
		}
		if (log && (result.removed.length > 0 || dryRun)) {
			const gib = (result.bytesEstimate / 1024 ** 3).toFixed(2);
			log(
				`storybook cache prune${dryRun ? " (dry run)" : ""}: ${dryRun ? "would remove" : "removed"} ${result.removed.length}, kept ${result.kept.length}, ~${gib} GiB logical${result.failed.length ? `, ${result.failed.length} failed` : ""}`,
			);
		}
		return result;
	} catch (error) {
		log?.(`storybook cache prune failed open: ${error?.message ?? error}`);
		return { ...result, error: String(error?.message ?? error) };
	}
}

/** Positive finite number from an env string, else the fallback. */
function numberFrom(raw, fallback) {
	const value = Number(raw);
	return raw !== undefined && raw !== "" && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

/**
 * The knobs `.storybook/main.ts` honours, so a person can switch the prune off or
 * retune it without editing the config:
 *   STORYBOOK_CACHE_PRUNE=off          disable entirely (returns null)
 *   STORYBOOK_CACHE_MAX_AGE_HOURS=48   age cut-off
 *   STORYBOOK_CACHE_MAX_ENTRIES=40     entry cap
 *   STORYBOOK_CACHE_MIN_KEEP_HOURS=6   never-touch window for the cap
 */
export function pruneOptionsFromEnv(env = process.env) {
	if (/^(off|0|false|no)$/i.test(env.STORYBOOK_CACHE_PRUNE ?? "")) return null;
	const hours = (name, fallbackMs) =>
		numberFrom(env[name], fallbackMs / 3_600_000) * 3_600_000;
	return {
		maxAgeMs: hours("STORYBOOK_CACHE_MAX_AGE_HOURS", DEFAULT_MAX_AGE_MS),
		maxEntries: numberFrom(
			env.STORYBOOK_CACHE_MAX_ENTRIES,
			DEFAULT_MAX_ENTRIES,
		),
		minKeepAgeMs: hours(
			"STORYBOOK_CACHE_MIN_KEEP_HOURS",
			DEFAULT_MIN_KEEP_AGE_MS,
		),
	};
}

/** The one call `.storybook/main.ts` makes: env-driven options, console logging. */
export function pruneStorybookCacheFromEnv({
	root,
	protectKey = null,
	env = process.env,
} = {}) {
	const options = pruneOptionsFromEnv(env);
	if (!options) return null;
	return pruneStorybookCache({
		...options,
		root,
		protectKey,
		env,
		log: (line) => console.log(`[storybook] ${line}`),
	});
}

if (isEntryPoint(import.meta.url)) {
	const args = process.argv.slice(2);
	const dryRun = args.includes("--dry-run");
	const root = args.find((arg) => !arg.startsWith("--"));
	if (!root) {
		console.error("usage: storybook-cache-prune.mjs [--dry-run] <cache-root>");
		process.exit(2);
	}
	const result = pruneStorybookCache({
		root,
		dryRun,
		...(pruneOptionsFromEnv() ?? {}),
		log: console.log,
	});
	console.log(
		JSON.stringify({
			...result,
			kept: result.kept.length,
			removed: result.removed,
		}),
	);
}
