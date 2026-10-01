#!/usr/bin/env node
/**
 * The death-watch for `run-desktop-tests.mjs`: kills the test process group if the
 * runner dies WITHOUT cleaning up, so `detached` does not make the runner's death
 * the one way to leave an unbounded test tree behind.
 *
 * WHY IT EXISTS. The runner starts `node --test` `detached` (its own group) so the
 * memory watchdog and the signal forwarding can address the whole tree with one
 * `kill(-pgid)`. The price, found in review: a harness that SIGKILLs the RUNNER's
 * group (every per-command memory guard and `timeout`-by-pgid wrapper on this
 * fleet does exactly that) no longer reaches the test tree, and the watchdog that
 * would have bounded it died with the runner. Reproduced on the first revision:
 * base leaves no survivor, the detached runner left the test-file process alive.
 * That is the incident shape, newly reachable, so the tether is part of the design
 * and not an extra.
 *
 * HOW. The keeper is spawned by the runner in its OWN session (so a kill of the
 * runner's group does not take it too) with a pipe on stdin whose only writer is
 * the runner. The kernel closes that write end however the runner dies, SIGKILL
 * included, and EOF is the signal — event-driven, no polling of the runner pid and
 * therefore nothing to get wrong about a recycled pid:
 *
 *   - the runner writes `done` before a NORMAL exit, and the keeper then just
 *     leaves: a finished suite's group is never signalled;
 *   - EOF with no `done` means the runner is gone, and the keeper SIGKILLs the test
 *     group — but only if that group still has a member (`kill(-pgid, 0)`), so an
 *     already-finished suite whose pgid could in principle have been recycled is
 *     not signalled blind;
 *   - independently, every 2 s the keeper checks the group is still alive and
 *     leaves when it is not, so it never outlives the tree it guards.
 *
 * SCOPE, stated: it signals the GROUP only. A descendant that called setsid (an
 * Electron launched `detached`) is out of reach here, exactly as it is for
 * Ctrl-C forwarding and for the base runner; the watchdog's breach path is the
 * one that walks those. A SIGKILL of the keeper ITSELF defeats it (and a runner
 * killed in the same instant), which no tether can cover.
 *
 *     node scripts/desktop-test-keeper.mjs <pgid>
 */

const POLL_MS = 2000;

const pgid = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isInteger(pgid) || pgid <= 1 || pgid === process.pid) {
	// Never become `kill(-1)` / `kill(0)`: a malformed argument is a bug upstream.
	process.exit(2);
}

function groupAlive() {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch {
		// ESRCH: gone. EPERM: on macOS a group holding only zombies - nothing left
		// to signal. Either way there is nothing for the keeper to do.
		return false;
	}
}

let finished = false;
let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffered += chunk;
	if (buffered.includes("done")) finished = true;
});
process.stdin.on("end", () => {
	if (!finished && groupAlive()) {
		try {
			process.kill(-pgid, "SIGKILL");
		} catch {
			// Already gone: the goal is met.
		}
	}
	process.exit(0);
});
process.stdin.on("error", () => process.exit(0));

setInterval(() => {
	if (!groupAlive()) process.exit(0);
}, POLL_MS);
