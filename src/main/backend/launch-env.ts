/**
 * The environment this process was LAUNCHED with, captured before any code in
 * this process rewrites `process.env`.
 *
 * Why a LAUNCH fact needs its own snapshot. `dotenvConfig` in
 * `backend/config.ts` runs at import time with `override: true`, so from then on
 * `process.env` is no longer a record of the launch: it is the launch with
 * whatever is in a file at `process.cwd()` folded in, and the file wins over the
 * shell. This repository's own `.env` is gitignored, long-lived and required for
 * `pnpm dev`, which makes it a real input rather than a hypothetical one: read
 * from `process.env`, it could arm the renderer dev driver on a trusted process,
 * move where this app writes its logs — measured, the one path a harness run
 * otherwise writes into the operator's own log files — or turn a deliberate
 * `headless` run into a window that takes the operator's focus, and an explicit
 * `LOCAL_OPERATOR_UI_DEV_DRIVER=0` typed at the shell could not turn it back off.
 *
 * Why this is its own module rather than the top of `backend/config.ts`, where it
 * began. Two modules need it, and one of them cannot import the other:
 * `backend/logger.ts` reads `LOCAL_OPERATOR_LOG_DIR` while the `Logger` singleton
 * is constructed (which happens during `logger.ts`'s own evaluation), and
 * `backend/config.ts` imports `logger.ts` in order to warn through it. Having
 * `logger.ts` import back into `config.ts` would be a cycle, and in ESM the
 * binding would still be in its temporal dead zone at that point — the read that
 * decides the log directory happens before `config.ts`'s body runs. So the
 * snapshot lives in a leaf module that imports nothing, and both import it.
 *
 * Why "before any mutation" still holds, now that it is not on the statement
 * before the mutation. It is ESM's evaluation order rather than a line's
 * position: a module's imported dependencies are evaluated before the importing
 * module's body, and `backend/config.ts` imports this module statically. The only
 * code in this process that writes `process.env` is that same file's dotenv call,
 * which is in its body. So the snapshot cannot be taken after a fold, whichever
 * module the import graph happens to reach first.
 *
 * That is also why the log directory is read from here rather than from
 * `process.env` inside the `Logger` constructor, which is where it was: that read
 * behaved as a launch fact only by import order (`logger.ts` is evaluated before
 * `config.ts` folds the file), and a later refactor to a lazy `getInstance()`
 * would quietly have let a cwd `.env` choose the directory — the difference
 * between a harness run that leaves marks on the operator's machine and one that
 * does not.
 *
 * It is a plain copy, not a live view, so nothing that mutates `process.env`
 * afterwards can reach back into it.
 *
 * Add a key by asking the question a reader of a launch would: did the operator
 * (or the harness) say this, or did a file in the working directory say it? Launch
 * facts — the window mode and size, the dev driver's opt-in, the log directory —
 * take this one. Product configuration (`VITE_*`, the API URL, credentials) keeps
 * reading `process.env` after the dotenv call, because a `.env` is exactly where
 * that is supposed to come from.
 */
export const launchEnv: Record<string, string | undefined> = {
	...process.env,
};
