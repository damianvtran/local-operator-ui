/**
 * Backend Service Manager
 *
 * This module is responsible for managing the Local Operator backend service.
 * It handles starting, stopping, and monitoring the health of the backend service.
 */

/**
 * Enum representing the different startup modes for the Local Operator server
 */
export enum LocalOperatorStartupMode {
	/** An existing server was detected, not managed by the backend service */
	EXISTING_SERVER = "EXISTING_SERVER",
	/** Server started using globally installed local-operator entrypoint */
	GLOBAL_INSTALL = "GLOBAL_INSTALL",
	/** Server started from the virtual environment created with bundled python */
	APP_BUNDLED_VENV = "APP_BUNDLED_VENV",
	/** Initial state before server has been started */
	NOT_STARTED = "NOT_STARTED",
}

import { type ChildProcess, exec, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { app, dialog as electronDialog } from "electron";
import {
	type AddressSubstitution,
	type DaemonStatusSnapshot,
	isServerReachable,
} from "../../shared/backend-status";
import {
	DAEMON_PAIRED,
	pairingHasRemedy,
	relayNeedsRebuild,
} from "../../shared/backend-status";
import type {
	DesktopFeedState,
	DesktopResponse,
} from "../../shared/desktop-contract";
import type { DesktopFeedFrame } from "../../shared/desktop-session-contract";
import {
	type FleetRosterRow,
	type ServingInstallReadings,
	type ServingOwnership,
	type ServingWorkState,
	fleetRosterFromSessions,
	serveRecord,
	servingInstallIsAppOwned,
	servingInstallReadings,
	servingWorkStateFromSessions,
} from "../backend-version-drift";
import { DesktopFeedRelay } from "../desktop-feed";
import {
	type DesktopMediaResponse,
	requestDesktopMediaOutcome,
} from "../desktop-media";
import { DesktopStreamRelay } from "../desktop-stream";
import {
	desktopAnswerProvesPairing,
	requestDesktop,
	requestDesktopOutcome,
} from "../desktop-transport";
import { withPythonBytecodeCache } from "../python-bytecode-cache";
import { type UserShellPath, withUserShellPath } from "../shell-path";
import {
	readInstallIdentity,
	resolveGlobalConsoleScript,
} from "../update-install";
import { backendConfig } from "./config";
import {
	DETACHED_AFTER_MS,
	type DaemonIdentity,
	DaemonStateMachine,
	PROBE_INTERVAL_MS,
	PROBE_TIMEOUT_MS,
	type ProbeObservation,
} from "./daemon-status";
import type {
	DiscoveredDaemon,
	HealthIdentity,
	ServeRecord,
} from "./discovery";
import {
	HEALTH_PATH,
	OWNED_RECORD_WINDOW_MS,
	OWNED_REGISTRATION_WINDOW_MS,
	type UnreachableCause,
	type WedgedRecord,
	addressHolders,
	addressHoldsLiveRecord,
	claimDesktopPlane,
	classifyUnreachable,
	discoverDaemons,
	listenerPidsOn,
	normaliseAddress,
	parseRecord,
	pidLiveness,
	probeIdentity,
	probeUnidentified,
	readIdentity,
	readRecordForPid,
	reapStaleRecords,
	recordAddress,
	serveRunDir,
} from "./discovery";
import { launchEnv } from "./launch-env";
import { LogFileType, logger } from "./logger";
import { isLegacyManagedCommand } from "./managed-python";
import { resolveNotificationLaunch } from "./notification-launch";
import { managedEnvironmentRoots, managedVenvPath } from "./venv-paths";

import {
	consoleInterpreter,
	ownedServeLaunch,
	windowsInterpreterCandidates,
	windowsPathInterpreterCandidates,
} from "./owned-serve-launch";

/*
 * There is no `CONSOLE_RESOLUTION_WORST_MS` here any more, and the absence is a
 * removal rather than an oversight. The console half of the start path used to
 * be two bounded `which`/`where` execs - the existence check, then the
 * resolution - and the quit path's failsafe carried a term for them. Both are
 * gone: the launcher is named by `resolveCommandPath`, a synchronous search of
 * the installers' own bin directories (see `globalConsoleScript`). Leaving the
 * term in place would inflate `QUIT_CLEANUP_FAILSAFE_MS` by ten seconds of
 * waiting that no longer happens, and that constant's own note says each term
 * has to be the bound it comes from. A future exec on this path owes the
 * failsafe a term again.
 */

/** The shutdown escalation one `stop(false)` can spend before it gives up: the
 * normal grace, then the force hold after SIGKILL. Exported for the same reason
 * as the constant above - the quit failsafe is derived, not asserted. */
const SHUTDOWN_TIMEOUT_DEFAULTS = {
	restart: 10_000, // 10 seconds for restart operations
	normal: 5_000, // 5 seconds for normal shutdowns
	force: 3_000, // 3 seconds before force killing after SIGKILL
};
export const OWNED_STOP_WORST_MS =
	SHUTDOWN_TIMEOUT_DEFAULTS.normal + SHUTDOWN_TIMEOUT_DEFAULTS.force;

/** The LONGEST the readiness loop waits between attempts. Exported for the same
 * reason as the bounds above: the quit path's failsafe adds it up rather than
 * naming a number, and every rung of `readinessPollDelayMs` is at most this. */
export const READINESS_POLL_INTERVAL_MS = 1_000;

/** How long an owned serve gets to answer `/health` before the start fails,
 * counted as the sum of the waits BETWEEN attempts - exactly what the old
 * `30 attempts x 1 s` loop counted (it never added the probes' own time
 * either), so the bound is the one it always was. It is a sum of scheduled
 * waits rather than a wall clock so the loop stays a pure function of its
 * schedule: `owned-serve-lifecycle.test.mjs` shortens those waits to drive a
 * start that never becomes ready, and a wall-clock bound would make that test
 * sit out the whole 30 s. */
export const READINESS_BUDGET_MS = 30_000;

/**
 * The wait before the next readiness attempt, by how long the start has
 * waited so far.
 *
 * WHY NOT A FLAT SECOND. Measured on this repo's rig (`health_ready.py`: a real
 * `local-operator serve` under an isolated root, `/health` sampled every 25 ms,
 * six boots at load 105-118): the daemon answers 1.53-2.23 s after spawn, and a
 * 1 s poll reported it at 2.0-3.0 s - 310-772 ms after it was ready, a median of
 * ~420 ms of launch spent waiting on this timer rather than on the daemon.
 * Readiness lands inside the first few seconds, so that is where the poll is
 * fast: 100 ms rungs report the same boots 4-72 ms late.
 *
 * WHY IT STILL BACKS OFF. A daemon that is not up by 5 s is on a slow path
 * (first-run install, a cold disk, a loaded machine), and each attempt against
 * it is a fetch plus a log line. So the rung widens to 250 ms, and past 10 s
 * returns to the flat 1 s it always was. A refused socket - the common answer
 * while the child is still importing - costs a sub-millisecond failed connect,
 * so the fast rungs are not load on the machine they are waiting for.
 */
export function readinessPollDelayMs(elapsedMs: number): number {
	if (elapsedMs < 5_000) return 100;
	if (elapsedMs < 10_000) return 250;
	return READINESS_POLL_INTERVAL_MS;
}

/**
 * Where the app keeps the bearer for the daemon it spawns, inside its userData
 * directory. 0600, written by `mintDesktopToken` on every managed start and read
 * by `persistedDesktopToken` on every launch, so the daemon a previous run left
 * serving is attachable.
 */
const DESKTOP_TOKEN_FILENAME = "desktop-token";

/** The port one of this app's own addresses names, or null when it names none. */
function portOf(address: string): number | null {
	try {
		const parsed = Number.parseInt(new URL(address).port, 10);
		return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * The install's own NAME from its `prefix`, for a holder that published no
 * `install_kind`.
 *
 * WHY NOT THE WHOLE PATH (design round 1, D4). The fallback rendered
 * `/Users/damian/.local/share/uv/tools/local-operator` - 47 characters of ONE
 * machine's directory layout - in the middle of a sentence the reader is trying to
 * scan, and the layout is not the fact: which install put the daemon on the port
 * is, and its own last segment says that in one word. Nothing at all is preferred
 * to a bare separator, so a prefix that ends in `/` contributes no fact rather
 * than an empty one.
 */
function installName(prefix: string): string {
	return prefix ? basename(prefix) : "";
}

/**
 * When the holder started, in the READER's own local time and at minute precision.
 *
 * WHY NOT THE APP'S `shared/utils/date-utils.ts` HELPERS (design round 1, D4): they
 * are renderer modules (`date-fns`, `navigator.language`) and this sentence is
 * composed in main, so the alternatives were a second dialect of the same fact or a
 * sentence split across two processes - and one composer for every sentence about an
 * occupant is the property this change exists to keep. What is taken from that module
 * is its SHAPE (a clock time for today, a date for anything older) and its choice
 * formatter (the platform's own, so the instant reads in the operator's locale rather
 * than in UTC). The raw ISO-8601 string with milliseconds it replaces was addressed to
 * a reader comparing it against their own clock, which is the one thing UTC is not.
 */
function describeStartedAt(startedAtMs: number): string {
	const started = new Date(startedAtMs);
	if (started.toDateString() === new Date().toDateString()) {
		return `started ${started.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
		})}`;
	}
	return `started ${started.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	})}`;
}

/**
 * One holder, as the parenthesised machine-voice clause every sentence about it
 * renders - composed HERE and nowhere else, so the log line and the status detail
 * cannot describe one occupant two ways.
 *
 * WHY `describeHolders` AND `describeSpawnRefusal` ARE EXPORTED (design round 1, D2).
 * The frames committed under `docs/evidence/common-connectivity-banner/` are shot from
 * story fixtures whose `detail` is a hand-written string, so a copy change here left
 * the committed frames documenting a sentence that no longer ships - and the next
 * sweep would re-shoot the stale fixture and agree with itself. The harnesses bundle
 * these functions (as they already do for `normaliseAddress` and
 * `addressHolders`) so a fixture can carry the SHIPPED sentence, and
 * `scripts/connectivity-banner-copy.test.mjs` compares the two, so neither can drift
 * from the other in silence.
 *
 * `install_kind` when the holder published one (`uv-tool`, `pipx`, `pip`, ...), and
 * otherwise the install's own NAME from its `prefix` (see `installName`).
 *
 * THE DESKTOP-READ FACT SPEAKS THE PRODUCT'S EXISTING REGISTER (design round 1,
 * D5). A 401/403 is this app's credential being refused, which is how the
 * `unclaimed` state has said it since before this change, and the code stays
 * because the code is the machine fact; any other non-2xx is a daemon that
 * ANSWERED with something unusable, which is not a credential refusal and must not
 * borrow that sentence.
 */
function describeOccupant(occupant: AddressOccupant): string {
	const facts: string[] = [];
	if (occupant.pid !== null) {
		facts.push(
			occupant.pidSource === "listener"
				? `pid ${occupant.pid} read off the listening socket`
				: `pid ${occupant.pid}`,
		);
	}
	const install = occupant.installKind || installName(occupant.prefix);
	if (install) facts.push(install);
	if (occupant.version) facts.push(`v${occupant.version}`);
	if (occupant.startedAtMs !== null) {
		facts.push(describeStartedAt(occupant.startedAtMs));
	}
	if (occupant.desktopReadStatus !== null) {
		facts.push(
			classifyDesktopAnswer(occupant.desktopReadStatus) === "refused"
				? `refused this app's credential for its desktop plane (HTTP ${occupant.desktopReadStatus})`
				: `answered this app's desktop read with HTTP ${occupant.desktopReadStatus}`,
		);
	}
	return facts.length > 0 ? ` (${facts.join(", ")})` : "";
}

/**
 * How one KIND of holder is named, ONCE per kind rather than once per address.
 *
 * WHY (design round 1, D6, measured). With two holders that clause was the bulk of
 * each holder's text and asserted the same fact twice in one line, and the band -
 * which is in flow and takes its height out of the shell - grew from the 68 CSS px
 * the one-holder sentence cost to 106 px. Stating the class once and listing the
 * addresses it covers makes the SENTENCE scale with holders rather than the CLAIM.
 *
 * The register is the one the product already has (design round 1, D5): "this app has
 * no key for" is the same fact as the `unclaimed` state's "refused this app's
 * credential", and "listed as still running in this app's own records" says what a
 * record means to a reader rather than the implementation nouns "serve record" and
 * "registry".
 */
const HOLDER_CLASS = {
	daemon: {
		one: "is running a Local Operator daemon this app has no key for",
		many: "are running Local Operator daemons this app has no key for",
	},
	record: {
		one: "is listed as still running in this app's own records",
		many: "are listed as still running in this app's own records",
	},
} as const;

/** `a`, `a and b`, `a, b and c` - so a list of addresses reads as one. */
function listAddresses(items: string[]): string {
	if (items.length === 0) return "";
	if (items.length === 1) return items[0];
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The address fragment for one holder: its address and the facts about it.
 *
 * Composed from the occupancy records rather than from the probe details, because
 * the operator's question is "what is on my port" and the answer has to name it:
 * address, pid, install, and when the holder started where a record on this machine
 * knows. Verified against the app's own run of 2026-09-23: the sentence the app
 * produced then named the OCCUPANCY as a category and no holder at all, so the only
 * way to find the daemon that had taken the port was to go and look.
 */
function describeHolder(occupancy: OriginOccupancy): string {
	return `${occupancy.occupant.address}${describeOccupant(occupancy.occupant)}`;
}

/**
 * Every holder the gate found, as one sentence fragment.
 *
 * THE UNREADABLE ARM NAMES NO ADDRESS (review round 1, R1-3). The record directory
 * could not be read, so there is no record to attribute to any address and no
 * process this app knows of; the sentence that used to be produced here - "<address>
 * is named by a serve record in this app's own registry, and that process is still
 * running" - was therefore false in both halves, on the strength of which the
 * operator was told their port was taken. One fragment however many addresses were
 * refused, for the reason `HOLDER_CLASS` gives about repeated clauses.
 */
export function describeHolders(refusals: OriginOccupancy[]): string {
	const fragments: string[] = [];
	for (const kind of ["daemon", "record"] as const) {
		const group = refusals.filter((occupancy) => occupancy.kind === kind);
		if (group.length === 0) continue;
		fragments.push(
			`${listAddresses(group.map(describeHolder))} ${HOLDER_CLASS[kind][group.length === 1 ? "one" : "many"]}`,
		);
	}
	/*
	 * A silent occupant keeps its own fragment per address: it is the one claim about
	 * an address that is about THAT address's own failure, and the cause in the
	 * parentheses is the whole of what the app observed.
	 */
	for (const occupancy of refusals) {
		if (occupancy.kind !== "silent") continue;
		fragments.push(
			`${describeHolder(occupancy)} did not answer this app's probe with anything it could use (${occupancy.detail})`,
		);
	}
	if (refusals.some((occupancy) => occupancy.kind === "unreadable")) {
		fragments.push(
			"this app's own records could not be read, so no address it may serve on could be called free",
		);
	}
	return fragments.join("; ");
}

/**
 * The act an operator can take about these holders, or the empty string where no
 * act exists.
 *
 * `lop services reclaim <pid>` ends a serve daemon that is alive but not serving
 * its address - exactly the orphan a fallback spawn's credential rotation can leave
 * behind, which is why the two changes are meant to be read together. It ships in
 * the sibling CLI, v0.62.27 (the correction on this round measured it: `lop services
 * --help` lists `{status,restart,reclaim}`).
 *
 * The install phrasing is kept BESIDE the command rather than instead of it: a reader
 * may know the install that owns the holder and not its pid, and the pid is the one
 * fact of the two that the command needs. Where there is exactly one holder with a
 * pid the sentence spends the real pid; several holders get the placeholder, because
 * naming one of them would point at a daemon the reader may not want ended.
 *
 * THE VERB AGREES WITH THE HOLDERS (design round 2, D9): with two pids the sentence
 * says "them from the installs that own them", because "Stop it" beside "are running
 * Local Operator daemons" reads as one broken sentence rather than as two clauses.
 *
 * EXPORTED, with `describeHolders`, so a harness compares a surface's act against
 * THIS composer rather than re-typing it (design round 1, D2's rule for the sentence,
 * applied to the clause agent round 2's R2-4 found spelled twice).
 */
export function reclaimClause(refusals: OriginOccupancy[]): string {
	const pids = refusals
		.map((occupancy) => occupancy.occupant.pid)
		.filter((pid): pid is number => pid !== null);
	if (pids.length === 0) return "";
	const command =
		pids.length === 1
			? `lop services reclaim ${pids[0]}`
			: "lop services reclaim <pid>";
	const direct =
		pids.length === 1
			? "it from the install that owns it"
			: "them from the installs that own them";
	return ` Stop ${direct} with \`${command}\` (\`lop services status\` lists what is running).`;
}

/**
 * The same holders, as the sentence for the case where NOWHERE was free.
 *
 * THE HOLDER LEADS (design round 1, D7), and the app's own bookkeeping follows as
 * "Nothing was started over it": the sentence used to open with what the app did not
 * do, where the operator's question is what is on their port. The app's other details
 * already lead with the fact being looked for.
 *
 * The tail is a PROMISE, so it may only name futures this app can reach (review
 * round 1, F-3): "keeps probing" is reachable, and with the fallback budget beside it
 * that promise is now stronger than it was - there is a second address to keep
 * probing as well.
 */
export function describeSpawnRefusal(refusals: OriginOccupancy[]): string {
	/*
	 * "Over it" only where there IS an address to speak of: the unreadable arm names
	 * no address, so "nothing was started over them" would be a pronoun with no noun
	 * in front of it.
	 */
	const named = refusals.filter((occupancy) => occupancy.kind !== "unreadable");
	const stopped =
		named.length === 0
			? "Nothing was started"
			: named.length === 1
				? "Nothing was started over it"
				: "Nothing was started over them";
	return `${describeHolders(refusals)}. ${stopped}.${reclaimClause(refusals)} It keeps probing for a server it can open.`;
}

/**
 * The SECOND address this app may spawn its managed daemon on, and the last one
 * it may: after the address it is configured for, this is the whole of the
 * fallback budget.
 *
 * WHY THERE IS A BUDGET AT ALL RATHER THAN A FREE PORT. The renderer talks to
 * the backend DIRECTLY - the API clients in `src/renderer/src/shared/api/local-operator/`
 * fetch, stream and read against a mutable base URL, and main only moves that URL -
 * and the renderer's content-security policy pins `connect-src` to exactly two
 * local origins (`src/renderer/index.html`). A daemon on any other port is
 * answering a document that is not allowed to dial it, so a spawn there would
 * produce a backend the app cannot use. `scripts/backend-spawn-address.test.mjs`
 * fails if this constant and that policy ever stop agreeing.
 *
 * WHY A FALLBACK EXISTS (2026-09-23, measured). The configured address was held
 * by a DIFFERENT local-operator install's stray `lop serve`. The app refused it
 * by identity - correct - and refused to spawn its own over it - also correct,
 * because the token is minted before the spawn and minting over an occupied
 * address overwrites that daemon's credential. It then QUIT, and the operator had
 * no app for twelve minutes while a backend they did not own held their port.
 * The two addresses the renderer already trusts are therefore what the app
 * serves on, and the configured one stays the first choice.
 */
export const FALLBACK_SPAWN_URL = "http://127.0.0.1:8080";

/**
 * What is holding one address, as the spawn gate can prove it.
 *
 * WHY THIS IS A RECORD RATHER THAN A SENTENCE. The gate used to keep a pid and a
 * version and throw the rest of the answer away, so an operator whose app would
 * not start could not be told WHAT was in the way - and the question they ask
 * first ("what is on my port") had to be answered by reading the process table by
 * hand. Every field here is either a fact the probe already returned or one
 * read-only lookup (`listenerPidsOn`, `readRecordForPid`), and the sentence the
 * status carries is composed from this record in ONE place (`describeOccupant`),
 * so the log and the banner cannot describe one occupant two ways.
 */
export interface AddressOccupant {
	address: string;
	/** The holder's pid, when it named one or the listening socket did. */
	pid: number | null;
	/**
	 * Which of those two sources the pid came from, or null when neither had one.
	 *
	 * Not decoration: the occupant's own answer is proof of who holds the address,
	 * while a pid read off the listening socket is a fact about the kernel's table
	 * that the occupant has not confirmed, and the copy says which it is.
	 */
	pidSource: "answer" | "listener" | null;
	version: string;
	prefix: string;
	installKind: string;
	/**
	 * `started_at` from a serve record in this app's own root whose pid matches the
	 * holder, in epoch ms, or null when no record names it. The interesting case is
	 * a daemon of this app's own from an earlier run: it is what turns "something
	 * is on your port" into "a daemon that started at 14:02 is still on it".
	 */
	startedAtMs: number | null;
	/**
	 * The status this app's own DESKTOP READ got from the holder, when a sweep
	 * observed one (`answeredButUnusable`), or null.
	 *
	 * It is the evidence a reader needs to tell "a daemon whose session store
	 * cannot be read" from "a daemon that never spoke", and it lives beside the
	 * record facts because that is the arm that reaches the copy without a probe of
	 * its own.
	 */
	desktopReadStatus: number | null;
}

/**
 * What the spawn gate found at ONE address this app may spawn on.
 *
 * `null` (no occupancy) is deliberately absent from this union: the gate's
 * caller tests for it, so "provably free" cannot be mistaken for a variant
 * somebody forgot to handle.
 *
 * `record` is the third kind, and it is a different fact from the other two: no
 * probe answered this address, but a serve record in this app's own registry
 * names it with a pid that is not dead. That is why no daemon was started there,
 * and it is also the shape that used to take the whole app down (see
 * `FALLBACK_SPAWN_URL`).
 */
export type OriginOccupancy =
	| { kind: "daemon"; occupant: AddressOccupant; detail: string }
	| {
			kind: "silent";
			cause: UnreachableCause;
			occupant: AddressOccupant;
			detail: string;
	  }
	| { kind: "record"; occupant: AddressOccupant; detail: string }
	/*
	 * The fourth kind, and the only one that is not a claim about an ADDRESS at all
	 * (review round 1, R1-3): this app's own record directory could not be read, so
	 * it can call no address free. It is carried as an occupancy rather than as a
	 * boolean because it travels to the same sentence and must not be worded as a
	 * holder - the `occupant` it carries names the address that was ASKED about and
	 * holds no facts, which is what the unreadable fragment in `describeHolders`
	 * renders instead of a holder clause.
	 */
	| { kind: "unreadable"; occupant: AddressOccupant; detail: string };

/** The one kind that does not claim a Local Operator server is present. */
type SilentOccupancy = Extract<OriginOccupancy, { kind: "silent" }>;

const execPromise = promisify(exec);

// Regex for parsing environment variable lines (moved to top-level for performance)
const ENV_VAR_REGEX = /^([^=]+)=(.*)$/;

/**
 * Which of the three things one answered desktop read told us.
 *
 * `refused` is HTTP 401/403 and NOTHING else: those are the two statuses that
 * mean this app's CREDENTIAL was rejected. Every other answered status - a 503
 * from a daemon whose session store cannot be read, a 500 from a broken build,
 * a 404 from a daemon that never had a desktop plane - is `unusable`: a daemon
 * answered, so the address is OCCUPIED and the app must neither call that a
 * credential refusal nor start a second daemon over it.
 *
 * WHY the distinction is a type and not a boolean. Reading "any non-2xx" as a
 * refusal recorded a live 503-answering daemon as one that refused this app's
 * bearer, and that verdict - a `capability` observation plus a declined
 * candidate - is what reached `start()` and spawned a replacement onto a port
 * that was already answering. A boolean cannot carry the third case, so the
 * distinction had nowhere to live.
 */
function classifyDesktopAnswer(
	status: number,
): "accepted" | "refused" | "unusable" {
	if (status >= 200 && status < 300) return "accepted";
	if (status === 401 || status === 403) return "refused";
	return "unusable";
}

/** Options a `start()` caller may set. `quiet` is the watchdog's retry, whose
 * failures the status surface is already reporting; `reuseDiscovery` is the
 * startup block's second call, in the same tick as its own discovery pass. */
interface StartOptions {
	quiet?: boolean;
	reuseDiscovery?: boolean;
}

/**
 * One managed `serve` lifetime: the handle this app actually spawned, plus the
 * state that decides its shutdown.
 *
 * WHY a per-generation record rather than fields on the manager. Every
 * shutdown hazard here was a late callback acting on mutable manager state: a
 * predecessor's exit handler clearing the successor's `process`, an escalation
 * timer firing after a replacement had started, a stop resolving because
 * *something* exited. Anchoring exit state, the stop operation and its timers
 * to the captured child makes a stale generation structurally unable to reach
 * its successor - it holds a reference to its own record, which nothing else
 * consults once `ownedServe` has moved on.
 *
 * Ownership is the child handle and nothing else. A PID is not ownership (it
 * is reused), a responding port is not ownership (anyone may bind it), and a
 * matching process name is not ownership (other tools run backends too).
 */
interface OwnedServe {
	child: ChildProcess;
	exited: boolean;
	/** Resolves on the observed `exit` event - the only evidence of termination
	 * this class accepts. A delivered signal is a request, not a result. */
	exit: Promise<void>;
	resolveExit: () => void;
	/** Non-null once a stop is in flight, which makes it the shared promise every
	 * concurrent quit/restart/update caller awaits instead of starting a second
	 * termination sequence against the same child. */
	stop: Promise<void> | null;
	/** Escalation timers, held so this generation's exit cancels them; a timer
	 * that outlives its generation is how a replacement used to get killed. */
	timers: Set<NodeJS.Timeout>;
}

/**
 * What the manager may be handed from outside.
 *
 * One option, because it is the one thing the app owns and this class must not
 * decide for itself: the login-shell PATH shared with the console host.
 */
export interface BackendServiceManagerOptions {
	/** The app's ONE login-shell PATH resolver (`../shell-path`). Absent - a test or
	 * a rig - leaves the spawn environment's PATH as the launch environment's. */
	userShellPath?: UserShellPath;
	/**
	 * The addresses this app may spawn a managed daemon on AFTER the configured one,
	 * best first. Absent - a test or a rig - is `[FALLBACK_SPAWN_URL]`, which is the
	 * shipped budget: the second and last origin the renderer's policy trusts.
	 */
	fallbackSpawnUrls?: string[];
}

/**
 * Backend Service Manager class
 * Manages the Local Operator backend service
 */
export class BackendServiceManager {
	private process: ChildProcess | null = null;
	private isRunning = false;
	private isExternalBackend = false;
	/**
	 * Whether this app may SPAWN or KILL a daemon - never whether one exists.
	 *
	 * `VITE_DISABLE_BACKEND_MANAGER=true` used to mean "assume a backend is
	 * already there": `checkExistingBackend()` returned true before probing and
	 * the startup block in `index.ts` was skipped outright, so discovery never
	 * ran, no daemon was ever found, no bearer was ever held, and every
	 * conversation opened empty. It now means exactly what its name says: do not
	 * spawn one and do not kill one. Discovery runs either way, which is the
	 * only way the operator's own daemon (started by a TUI, publishing a record)
	 * is ever found by an app configured this way.
	 */
	private readonly managerMaySpawn =
		backendConfig.VITE_DISABLE_BACKEND_MANAGER !== "true";
	private startupMode: LocalOperatorStartupMode =
		LocalOperatorStartupMode.NOT_STARTED;
	private port: number;
	private backendUrl: string;
	/**
	 * The address this app is CONFIGURED to serve on, which never rotates.
	 *
	 * `backendUrl` is where the app is TALKING - a daemon discovery adopted, or the
	 * fallback address after a fallback spawn - so a spawn gate keyed on it would
	 * ask "may I start a daemon here" about whatever the app happens to be attached
	 * to, which is somebody else's daemon. The config address is a separate fact and
	 * it is the one the gate needs.
	 */
	private configuredUrl: string;
	/**
	 * The addresses this app may spawn a managed daemon on after the configured one,
	 * best first (`FALLBACK_SPAWN_URL` by default).
	 *
	 * A field rather than a bare constant so a rig can exercise the fallback on a
	 * port the kernel picked, which is the same reason `DiscoverOptions.fetchImpl`
	 * is injectable: proving this path must not require binding a fixed port on a
	 * machine somebody else is using.
	 */
	private fallbackSpawnUrls: string[];
	/**
	 * What stopped the last spawn attempt, when what stopped it was an address this
	 * app may spawn on being held by something IT DOES NOT OWN. Null when nothing
	 * did.
	 *
	 * Read by `index.ts` through `isStartBlockedByOccupiedAddress()`: a false return
	 * from `start()` is the one place the app used to quit, and the whole point of
	 * this field is that this class of failure is not a reason to take the app down.
	 */
	private spawnRefusals: OriginOccupancy[] | null = null;
	private remoteConfigured = false;
	/**
	 * The last address this app served on that was NOT the one it is configured for,
	 * and the reason the gate gave for moving there.
	 *
	 * NEITHER IS THE CLAIM - both are history. The claim itself is derived on every
	 * snapshot from the address the connection is on (`addressSubstitutionFor`), so a
	 * reason recorded here can only reach a surface while the app is genuinely on
	 * that other address (agent round 2, R2-1/R2-2). That is what makes it safe to
	 * write the reason at the moment the gate makes its decision, which is the only
	 * moment the holder is observable at all.
	 */
	private servedElsewhere: string | null = null;
	private substitutionReason: {
		holder: string | null;
		reclaim: string | null;
	} = { holder: null, reclaim: null };
	/** A failed probe or unreadable record is not evidence that spawning is safe. */
	private discoveryBlocksSpawn = false;
	/**
	 * The address of a daemon that ANSWERED this app's desktop read without
	 * refusing its credential, and the status it answered, from the last
	 * discovery sweep.
	 *
	 * Non-null means the address is OCCUPIED by a daemon this app may not attach
	 * to *yet*: `start()`'s no-spawn report has to publish that as a running
	 * daemon, because the alternative it would otherwise reach - `no-candidate` -
	 * renders as offline, which is the one sentence this whole change exists to
	 * stop saying about a server that answers (#1170: an unreadable session store
	 * answers 503 instead of an empty 200).
	 */
	private answeredButUnusable: { address: string; status: number } | null =
		null;
	/**
	 * Records discovery found alive but unresponsive (pid alive, heartbeat
	 * stopped). They are why no candidate exists AND why spawning is forbidden,
	 * and they are carried separately from `discoveryBlocksSpawn` so the app can
	 * say which of those two facts it observed.
	 */
	private discoveryWedged: WedgedRecord[] = [];
	private recoveryInFlight = false;
	private nextRecoveryAt = 0;
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	/**
	 * Why the last `/health` read did not return 200, for the callers that must
	 * tell a refusal from an expired budget: `null` when it was not a transport
	 * failure at all (the address answered, with a status this path does not
	 * accept).
	 */
	private lastHealthFailure: UnreachableCause | null = null;

	/** The one probe loop's interval handle. */
	private healthCheckInterval: NodeJS.Timeout | null = null;
	/** The only process this manager may terminate. Null means it owns nothing,
	 * which is a reason to report "nothing to stop" - never to go looking. */
	private ownedServe: OwnedServe | null = null;
	/** In-flight start, so a stop can await the resolver/readiness work that has
	 * not yet produced a child. Without it, cleanup can return before a spawn
	 * that was already committed, and the caller installs over a live serve. */
	private startPromise: Promise<boolean> | null = null;
	private restartPromise: Promise<boolean> | null = null;
	/** Bumped by every stop. A start that began under an older epoch cannot
	 * report success or adopt its child: the cancellation happened after it
	 * checked, and this is what it re-checks across each await. */
	private startEpoch = 0;
	/** The record behind the current attachment, when discovery found it. */
	private attachedRecord: DiscoveredDaemon | null = null;
	/**
	 * The connection state.
	 *
	 * One machine, one answer to "is the server up": the renderer's status
	 * signal is this object's snapshot (see `getStatusSnapshot`), so a second
	 * opinion about liveness cannot grow inside the renderer or in a probe that
	 * forgot the capability rules.
	 */
	private daemonState = new DaemonStateMachine();
	/** Consumers of status changes in main (the window's IPC sender). */
	private statusObserver: ((snapshot: DaemonStatusSnapshot) => void) | null =
		null;
	private shellEnv: Record<string, string | undefined> = {};
	/**
	 * The user's own login-shell PATH, resolved once for the whole app.
	 *
	 * Handed in by `src/main/index.ts` rather than constructed here, for one
	 * reason: the console host is given the SAME instance, so "what is this user's
	 * PATH" has one answer in this process instead of one per consumer. Absent -
	 * every test and rig that builds a manager directly - means this instance keeps
	 * the launch environment's PATH, which is exactly what it did before.
	 */
	private readonly userShellPath?: UserShellPath;
	// External/dev backends may be explicitly paired through main's environment.
	// Managed starts always rotate this; it is never exposed by preload or logs.
	/**
	 * The credential this app holds for its OWN daemon.
	 *
	 * Read from disk at construction, and REPLACED by a freshly minted, persisted
	 * one on every managed start. Those are two halves of one rule:
	 *
	 *   - the read is what makes a daemon the previous run left running
	 *     attachable. The app deliberately leaves its daemon serving when it
	 *     attached to an external backend, and a daemon it spawned is
	 *     env-governed from the spawn (its record publishes `claim_key: ""`), so
	 *     the ONLY credential that can ever open it is the token its spawner held.
	 *     A launch that starts with no token there declines the daemon it owns and
	 *     starts a second one onto its port - measured on the operator's machine as
	 *     the 07:47 -> 09:17 sequence, ending in `[Errno 48] Address already in
	 *     use`;
	 *   - the write is why the token still changes when the app REPLACES a daemon
	 *     in place: the relay's cache key is this value (see `getStreamRelay`), and
	 *     a token that survived a restart would leave a subscription pointed at a
	 *     daemon this app had already stopped.
	 *
	 * The environment still wins, because an explicitly paired app is a deliberate
	 * configuration and not a cache to be second-guessed.
	 */
	private desktopToken: string | null =
		process.env.LOCAL_OPERATOR_DESKTOP_TOKEN || null;

	/** Authenticated SSE relay for canonical session events. Recreated when the
	 * backend URL rotates (external-backend discovery) or the desktop token does
	 * (every managed start mints one), and dropped outright by `stop()`.
	 *
	 * WHY the token is part of the cache key. A URL-only key was the bug behind
	 * "every conversation opens empty": an in-place restart - the health-check
	 * watchdog, or "Update server" - keeps `backendUrl` at
	 * `http://127.0.0.1:1111` and rotates ONLY the token, so the cached relay
	 * went on authenticating with the credential of the process that had just
	 * been killed. Each `GET /v1/desktop/sessions/{id}/events` was refused 401
	 * while `sessions?limit=500` and `sessions.get` stayed 200 (those read the
	 * live token at call time), the renderer never received an `open` frame, and
	 * with no receipt its single auto-reconnect was skipped - so the transcript
	 * stayed empty until the app itself was restarted. */
	private streamRelay: DesktopStreamRelay | null = null;
	private streamRelayUrl = "";
	/** The token `streamRelay` was built with. Tracked beside the URL, not
	 * derived from it: the rotation above is exactly a case where the URL is
	 * unchanged and the token is not. */
	private streamRelayToken: string | null = null;
	/** Survives relay recreation so notifications never silently detach
	 * when the backend URL rotates. */
	private streamObserver: ((sessionId: string, data: string) => void) | null =
		null;

	/**
	 * The machine-wide desktop feed relay, rebuilt when the backend URL rotates
	 * for the same reason the stream relay is: a subscription must never pin a
	 * stale origin. Held HERE rather than in `index.ts` because the desktop
	 * bearer lives in this class and is never exposed — the feed needs it to
	 * carry an SSE connection and to beat the presence lease.
	 */
	private feedRelay: DesktopFeedRelay | null = null;
	private feedRelayUrl = "";
	/**
	 * The credential the current feed relay was built with.
	 *
	 * WHY IT IS TRACKED AT ALL, and the defect it stands for: the relay takes its
	 * bearer ONCE, at construction, and a re-pair leaves the address unchanged
	 * while replacing the credential - same port, new claim key. A rebuild keyed on
	 * the URL alone therefore keeps a relay that 401s on every attempt, for good:
	 * measured after the successor swap, the app was `attached` and paired with the
	 * new daemon while the sidebar still rendered "Not connected to the backend -
	 * showing the last known state." more than a minute later, and the same line
	 * never cleared (QA round 1 Q-2, design round 1 D3). The stream relay next door
	 * already compares the token; this one now does too.
	 */
	private feedRelayToken: string | null = null;
	/** Both survive relay recreation, so a URL rotation cannot silently detach
	 * the banner path or leave the sidebar reading a stale connection state. */
	private feedFrameObserver: ((frame: DesktopFeedFrame) => void) | null = null;
	private feedStateObserver: ((state: DesktopFeedState) => void) | null = null;
	/**
	 * The window/focus/displayed-session answers the presence claim carries.
	 *
	 * Set by main once a window can exist — before that a windowless app is the
	 * honest answer, which is also the reference's own default for a client that
	 * has not said anything yet.
	 */
	private presenceContext:
		| (() => {
				sessionId: string;
				window: {
					exists: boolean;
					focused: boolean;
					visible: boolean;
					minimized: boolean;
				};
		  })
		| null = null;

	/**
	 * Called every time the backend becomes reachable and authenticated.
	 *
	 * The desktop token is minted inside `start()`, so anything that must query
	 * the backend cannot be issued from `app.whenReady()` — at that point the
	 * port is dead on the ordinary self-managed cold start and the request is
	 * lost. This fires after the health check passes, which is the first moment
	 * `requestDesktop` can succeed.
	 *
	 * It fires AGAIN on every restart and on external-backend discovery, on
	 * purpose: the backend underneath a running app can be replaced by a
	 * different version, and a capability read taken once at startup would
	 * outlive the backend it described.
	 */
	private backendReadyObserver: (() => void) | null = null;

	onBackendReady(observer: (() => void) | null): void {
		this.backendReadyObserver = observer;
	}

	private notifyBackendReady(): void {
		try {
			this.backendReadyObserver?.();
		} catch (error) {
			// A consumer's failure must never take down backend startup: the
			// backend is up either way, and this is a notification, not a step.
			logger.error("Backend-ready observer threw:", LogFileType.BACKEND, error);
		}
	}

	/**
	 * Subscribe to status changes.
	 *
	 * A push rather than a poll so a state change reaches the renderer within a
	 * probe interval, and a pull (`getStatusSnapshot`) so a window that opens
	 * later is not left waiting for the next transition.
	 */
	onStatusChange(
		observer: ((snapshot: DaemonStatusSnapshot) => void) | null,
	): void {
		this.statusObserver = observer;
	}

	private notifyStatus(): void {
		try {
			this.statusObserver?.(this.getStatusSnapshot());
		} catch (error) {
			// A consumer's failure must not take down the supervisor: the state
			// is reported either way, and a later push carries it again.
			logger.error(
				"Backend status observer threw:",
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * The server-status signal, for the renderer's IPC handlers.
	 *
	 * Carries the daemon's identity (version, prefix, install kind) because the
	 * main process is the only caller that can read it honestly: it holds the
	 * bearer and sends no Origin, so neither CORS nor a gated route can turn
	 * "I am not allowed" into "it is down".
	 */
	getStatusSnapshot(): DaemonStatusSnapshot {
		const snapshot = this.daemonState.snapshot();
		return {
			...snapshot,
			addressSubstitution: this.addressSubstitutionFor(snapshot),
		};
	}

	/**
	 * Where this app is serving, relative to the address it is configured for.
	 *
	 * THE INVARIANT (agent round 2, R2-1): a snapshot's address claim is a FUNCTION
	 * OF THE ADDRESS THE APP IS ACTUALLY USING, never of the last decision a gate
	 * made. The first version of this field was written once by the spawn gate, and
	 * that produced two wrong answers in opposite directions:
	 *
	 *   - a launch that ATTACHES to a daemon discovered on another address (the
	 *     second launch of the incident - the fallback daemon is still there and the
	 *     persisted credential still opens it) records nothing, so the app was
	 *     silently on another address, which is the invisibility D1 exists to remove;
	 *   - a substitution recorded earlier was never retracted: once recovery attached
	 *     the app back to the configured address the record still said `serving:
	 *     <fallback>`, beside a snapshot whose own `url` was the configured address,
	 *     and its reclaim advice named a pid that may by then be the daemon the
	 *     operator is using.
	 *
	 * It also answers agent round 2's R2-2 for free: the claim is derived from
	 * `isRunning` and the attached URL, so a start that never landed - a readiness
	 * timeout, a throw, a stop - reports nothing at all, where a record written at
	 * intent time announced a return over a dead backend.
	 *
	 * `holder`/`reclaim` are the one fact the derivation cannot recover, because the
	 * gate is the only witness to what held the address; they are kept beside the
	 * landing (`recordSubstitutionReason`) and reach a surface only through an arm
	 * that is true. Null holder/reclaim is the honest state for a launch that adopted
	 * somebody else's daemon: it never asked the configured address anything.
	 */
	private addressSubstitutionFor(
		snapshot: Omit<DaemonStatusSnapshot, "addressSubstitution">,
	): AddressSubstitution | null {
		const configured = normaliseAddress(this.configuredUrl);
		/*
		 * THE APP'S OWN VOCABULARY, DELIBERATELY NOT `isRunning`: that flag means "the
		 * child this app spawned is up", and an ADOPTED daemon - the second launch of
		 * the very incident this presentation exists for - leaves it false while the app
		 * is attached and serving. `isServerReachable` is the shared contract's own
		 * answer to "is this app on a server", and it is what a surface already reads, so
		 * the claim and the surface cannot come to different conclusions about the app.
		 *
		 * No URL or an unusable state means this app is serving NOWHERE, which is the
		 * answer that fixes agent round 2's R2-2: a start that never landed - a readiness
		 * timeout, a throw, a dead child - claims no address at all.
		 */
		if (!configured || !snapshot.url || !isServerReachable(snapshot.state)) {
			return null;
		}
		const serving = normaliseAddress(snapshot.url);
		if (!serving) return null;
		if (serving !== configured) {
			return {
				kind: "substituted",
				configured,
				serving,
				...this.substitutionReason,
			};
		}
		// On the configured address again, and a substitution is what it came back from.
		return this.servedElsewhere
			? { kind: "returned", configured, serving: this.servedElsewhere }
			: null;
	}

	/**
	 * Adopt a validated daemon, and record WHERE the app landed.
	 *
	 * Every landing in this class goes through here - the spawn's registration and
	 * both attach paths - which is what makes the record a property of the app's
	 * address rather than of one code path (agent round 2, R2-1). `servedElsewhere`
	 * survives a landing on the configured address on purpose: it is what a return
	 * has to name.
	 */
	private attachDaemon(
		identity: DaemonIdentity,
		options: { owned: boolean },
	): void {
		this.daemonState.attach(identity, options);
		const configured = normaliseAddress(this.configuredUrl);
		const landed = normaliseAddress(identity.url);
		if (landed && configured && landed !== configured) {
			this.servedElsewhere = landed;
		}
		/*
		 * A landing clears the reason: it belongs to the address the app was pushed
		 * off, and this landing may be on a different one (an adopted daemon). The
		 * spawn path re-records it immediately after registering, where the gate's
		 * own refusals are in hand.
		 */
		this.clearSubstitutionReason();
	}

	/**
	 * The reason a fallback was taken, recorded WHERE THE LANDING IS (agent round 2,
	 * R2-2): the gate decides on a target before the spawn, but nothing about the
	 * decision is announced until the daemon it started answers, so the reason is
	 * written here rather than there. A failed start therefore leaves no reason
	 * behind, and the claim (`addressSubstitutionFor`) is not there to render anyway.
	 */
	private recordSubstitutionReason(refusals: OriginOccupancy[]): void {
		this.substitutionReason =
			refusals.length > 0
				? {
						holder: describeHolders(refusals),
						reclaim: reclaimClause(refusals).trim() || null,
					}
				: { holder: null, reclaim: null };
	}

	private clearSubstitutionReason(): void {
		this.substitutionReason = { holder: null, reclaim: null };
	}

	getStreamRelay(): DesktopStreamRelay {
		if (
			!this.streamRelay ||
			this.streamRelayUrl !== this.backendUrl ||
			this.streamRelayToken !== this.desktopToken
		) {
			this.streamRelay?.dispose();
			this.streamRelay = new DesktopStreamRelay(
				this.backendUrl,
				this.desktopToken,
			);
			this.streamRelay.observe(this.streamObserver);
			this.streamRelayUrl = this.backendUrl;
			this.streamRelayToken = this.desktopToken;
		}
		return this.streamRelay;
	}

	/**
	 * Drop the relay and its streams.
	 *
	 * Called from `stop()` so an in-place restart cannot leave a stream bound to
	 * the token of the process being stopped - the open streams are aborted
	 * deliberately, which the renderer sees as a stream `end` and recovers from
	 * with a bounded retry rather than waiting for a frame that will never come.
	 *
	 * `streamRelayToken` is cleared rather than left at the retired value: the
	 * next `getStreamRelay()` must not be able to answer "already built" for a
	 * token whose relay no longer exists.
	 */
	private disposeStreamRelay(): void {
		this.streamRelay?.dispose();
		this.streamRelay = null;
		this.streamRelayUrl = "";
		this.streamRelayToken = null;
	}

	observeStream(
		observer: ((sessionId: string, data: string) => void) | null,
	): void {
		this.streamObserver = observer;
		this.streamRelay?.observe(observer);
	}

	/**
	 * The machine-wide feed, rebuilt when the backend URL rotates.
	 *
	 * Lazily constructed for the same reason `getStreamRelay` is: the desktop
	 * token is minted inside `start()`, so a relay built at `app.whenReady()`
	 * would capture `null` and never authenticate. Callers reach for it from the
	 * backend-ready hook, which is the first moment the token exists.
	 */
	getDesktopFeedRelay(): DesktopFeedRelay {
		if (
			!this.feedRelay ||
			relayNeedsRebuild(
				{ url: this.feedRelayUrl, token: this.feedRelayToken },
				{ url: this.backendUrl, token: this.desktopToken },
			)
		) {
			this.feedRelay?.stop();
			this.feedRelay = new DesktopFeedRelay(
				this.backendUrl,
				this.desktopToken,
				{
					request: (input) => this.requestDesktop(input),
					// The presence beat is a contract op, so it travels the same
					// authenticated transport as every other control and the token
					// never leaves this class.
					beatPresence: (presence) =>
						this.requestDesktop({
							op: "sessions.presence",
							...presence,
						}),
					// What this app can say about its own window. Supplied by main
					// (it owns the window and the notifier's displayed session) and
					// read at each beat rather than captured, so a window that opens
					// or closes mid-lease is reported without a new relay.
					presenceContext: () => this.presenceContext?.() ?? null,
				},
			);
			this.feedRelay.observe(this.feedFrameObserver);
			this.feedRelay.watchState(this.feedStateObserver);
			this.feedRelayUrl = this.backendUrl;
			this.feedRelayToken = this.desktopToken;
		}
		return this.feedRelay;
	}

	/**
	 * Supply the presence claim's window state.
	 *
	 * Separate from `observeDesktopFeed` because it is a different question
	 * asked of a different owner: the observers are consumers of frames, and
	 * this is main's answer about itself. Applied to a relay that already
	 * exists, so the ordering between "start the feed" and "make a window" does
	 * not decide whether the claim is complete.
	 */
	providePresenceContext(
		context: () => {
			sessionId: string;
			window: {
				exists: boolean;
				focused: boolean;
				visible: boolean;
				minimized: boolean;
			};
		},
	): void {
		this.presenceContext = context;
	}

	observeDesktopFeed(
		frameObserver: ((frame: DesktopFeedFrame) => void) | null,
		stateObserver: ((state: DesktopFeedState) => void) | null,
	): void {
		this.feedFrameObserver = frameObserver;
		this.feedStateObserver = stateObserver;
		this.feedRelay?.observe(frameObserver);
		this.feedRelay?.watchState(stateObserver);
	}

	requestDesktop(input: unknown): Promise<DesktopResponse> {
		return requestDesktopOutcome(
			input,
			this.backendUrl,
			this.desktopToken,
		).then(({ response, answered }) => {
			if (answered)
				this.noteTransportAnswer(desktopAnswerProvesPairing(input, response));
			return response;
		});
	}

	requestDesktopMedia(
		input: unknown,
		bytes: Uint8Array<ArrayBuffer> | null,
	): Promise<DesktopMediaResponse> {
		return requestDesktopMediaOutcome(
			input,
			bytes,
			this.backendUrl,
			this.desktopToken,
		).then(({ response, answered }) => {
			// A media answer is recorded as LIVENESS and nothing else, and the
			// reason is structural rather than provisional: `desktopAnswerProvesPairing`
			// parses its request against the JSON contract's op vocabulary, and the
			// media vocabulary is outside it (`speech.create`, `agent.export`,
			// `sessions.attachment`, ... - see `../desktop-media`'s own schema), so the
			// predicate refuses the INPUT before it ever reads a path or a status. Its
			// answer here could only be `false`, which would record a decision this
			// relay is not able to make rather than the honest "an answer arrived".
			//
			// Nothing is lost by that: the two media ops whose paths are under the
			// admitted prefix (`sessions.attachment`, `subagents.attachment`) are reads
			// issued alongside the contract ops this app already sends - the presence
			// beat every 15 s among them - and THOSE are what supply the pairing
			// evidence, through the predicate written for them. If a media op ever
			// needs to prove a pairing on its own, it needs its own predicate rather
			// than a widened `input` type here.
			if (answered) this.daemonState.recordTransportAnswer();
			return response;
		});
	}

	/**
	 * Tell the state machine that this app's own request reached the daemon.
	 *
	 * `answered` is the TRANSPORT's verdict, not the promise's: every failure the
	 * transport can produce resolves rather than throws, so `.then()` alone fires
	 * for a refused socket, for a request this app never sent (no token, oversize,
	 * an invalid op), and for one whose budget expired. Gating on it here is the
	 * fix for review round 1's F-1, where an unearned stamp held the state at
	 * `degraded` - which is not a state `checkBackendHealth` recovers from, so a
	 * genuinely gone daemon could never be reported as gone.
	 *
	 * `admitted` is the second, narrower question and the two are deliberately
	 * separate calls rather than one boolean: an answer of ANY status is liveness
	 * evidence (a `401`, a `403` or a `503` is a process that read the request and
	 * wrote a status line, which is exactly what a probe that ran out of its 2 s
	 * budget failed to establish - without that, one long agent turn was enough to
	 * detach the connection and disable every read the daemon was still answering),
	 * while only an answer the plane ADMITTED proves the pairing still holds.
	 * Collapsing the two is the defect this split fixes, measured 2026-09-18: a
	 * replaced daemon's refusals - plus the capability poll the renderer runs every
	 * 15 s while the plane is shut, which the plane serves without admitting
	 * anyone - each cleared the identity-failure count, so the app never detached,
	 * never re-discovered and never re-claimed, and reported "not paired with the
	 * running Local Operator server" until it was restarted (see
	 * `daemon-status.ts`'s `recordTransportAnswer`/`recordTransportSuccess`).
	 *
	 * Only a state that actually moves pushes a snapshot: this runs on every
	 * desktop call, and one IPC wake-up per request would be worse than the bug.
	 */
	private noteTransportAnswer(admitted: boolean): void {
		if (!admitted) {
			this.daemonState.recordTransportAnswer();
			return;
		}
		if (this.daemonState.recordTransportSuccess()) this.notifyStatus();
	}
	private isAppClosing = false; // Flag to track when the app is being closed
	private isAutoUpdating = false; // Flag to track when an autoupdate is in progress
	/**
	 * WHY the fleet roster last came back unreadable, when the server answered.
	 *
	 * A dead socket and a 401 look the same to `servingWorkState` - both are not
	 * evidence about work, so both are `unknown` and both hold a restart - but they
	 * are different next steps for a READER, and the update path's refusal says
	 * which happened (QA round 1, observation b). The transport is the only party
	 * that knows, so it records the answer here and the refusal reads it back;
	 * guessing it from the verdict is how the two would come to disagree. Reset on
	 * every read, so it always describes the most recent one.
	 */
	private fleetReadFailure: "unreachable" | "refused-credentials" =
		"unreachable";
	private shutdownTimeoutMs = { ...SHUTDOWN_TIMEOUT_DEFAULTS }; // Configurable timeouts for different shutdown scenarios

	/**
	 * Constructor
	 *
	 * @param options.userShellPath the app's one login-shell PATH resolver (see
	 * `../shell-path`). Optional so a manager built without the app - a test, a rig
	 * - behaves exactly as it did before this option existed.
	 */
	constructor(options: BackendServiceManagerOptions = {}) {
		this.userShellPath = options.userShellPath;
		this.fallbackSpawnUrls = options.fallbackSpawnUrls ?? [FALLBACK_SPAWN_URL];
		// Extract port from API URL
		try {
			const apiUrl = new URL(backendConfig.VITE_LOCAL_OPERATOR_API_URL);
			this.port = Number.parseInt(apiUrl.port, 10) || 1111; // Default to 1111 if port is not specified

			this.remoteConfigured = !["localhost", "127.0.0.1", "[::1]"].includes(
				apiUrl.hostname,
			);
			// A remote configuration is an explicit target, not a local port hint.
			// Never rewrite its scheme/host or substitute a local daemon for it.
			this.backendUrl = this.remoteConfigured
				? apiUrl.href.endsWith("/")
					? apiUrl.href.slice(0, -1)
					: apiUrl.href
				: `http://127.0.0.1:${this.port}`;

			logger.info(
				`Backend service configured with port ${this.port} and URL ${this.backendUrl}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			// Fallback to default values if URL parsing fails
			this.port = 1111;
			this.backendUrl = `http://127.0.0.1:${this.port}`;

			logger.error(
				`Error parsing API URL, using default port ${this.port}`,
				LogFileType.BACKEND,
				error,
			);
		}
		// AFTER the try, so both arms leave it set: the configured address is the
		// parsed one where there is one, and the default the fallback arm just
		// established where there is not - one assignment, two ways in.
		this.configuredUrl = this.backendUrl;

		// The app-managed venv for THIS instance - a packaged install and an
		// unpackaged one must not share it, or the dev instance's backend imports its
		// stdlib out of the installed, code-sealed bundle (see `managedVenvPath`).
		this.venvPath = managedVenvPath({
			platform: process.platform,
			home: app.getPath("home"),
			appDataPath: this.appDataPath,
			packaged: app.isPackaged,
		});

		// Load shell environment variables
		this.loadShellEnvironment();

		/*
		 * The credential for this app's OWN daemon, read before anything asks
		 * whether there is one to attach to.
		 *
		 * ORDER IS THE WHOLE POINT. `src/main/index.ts` calls
		 * `checkExistingBackend()` first and `start()` only when discovery finds
		 * nothing, so a token minted inside `startOwned()` does not exist yet when
		 * the app decides whether it can attach to the daemon the previous run left
		 * running - which is how a daemon that was serving got declined and a second
		 * one was spawned onto its port. Loading it here means the first adoption
		 * pass already holds the credential.
		 */
		this.desktopToken = this.desktopToken || this.persistedDesktopToken();

		// Log initialization status
		logger.info(
			`Backend Service Manager initialized. May spawn or kill: ${this.managerMaySpawn}`,
			LogFileType.BACKEND,
		);
		logger.info(
			`Virtual environment path: ${this.venvPath}`,
			LogFileType.BACKEND,
		);
	}

	/**
	 * Load shell environment variables from user's shell configuration files
	 * This ensures that programs like gh and brew that are in the PATH are available to the backend service
	 */
	private async loadShellEnvironment(): Promise<void> {
		try {
			// Start with current process environment
			this.shellEnv = { ...process.env };

			// Platform-specific shell environment loading
			if (process.platform === "darwin") {
				// macOS: Source .zshrc or .bash_profile
				await this.loadMacOSEnvironment();
			} else if (process.platform === "linux") {
				// Linux: Source .bashrc or .zshrc
				await this.loadLinuxEnvironment();
			} else if (process.platform === "win32") {
				// Windows: Load from registry and user profile
				await this.loadWindowsEnvironment();
			} else {
				logger.error(
					"Unsupported platform for shell environment loading",
					LogFileType.BACKEND,
				);
			}

			// Half of a deliberate belt-and-braces pair (the other half is
			// `backendSpawnEnv()`, which every spawn calls): this line corrects a
			// value the platform loaders above can inject from the operator's shell
			// rc, and it is what every OTHER reader of `shellEnv` inherits. It alone
			// is not enough, because this method is started un-awaited from the
			// constructor and nothing sequences it against `start()` - see
			// `backendSpawnEnv()` for the ordering hole and why the guarantee lives
			// there.
			this.shellEnv = withPythonBytecodeCache(this.shellEnv, this.appDataPath);

			// And the PATH, last of all, from the user's OWN login shell. After the
			// platform loaders on purpose: they merge the rc files' `env` dump, PATH
			// included, and on macOS that dump is the wrong answer - it reads the first
			// of `~/.zshrc`/`~/.bash_profile` through `/bin/bash` and misses
			// `~/.zprofile`, which is where Homebrew's `shellenv` lives on Apple
			// silicon. Resolving it here means one mechanism answers "what is this
			// user's PATH" for both this manager and the console host, rather than the
			// two the app used to have.
			await this.settleUserShellPath();

			// The PATH is logged AFTER both folds, not before them: this line is the
			// record of the PATH the backend is actually given, and printed first it
			// reported a value the spawn never saw - which is how the missing Homebrew
			// directory was read off this log in the first place.
			logger.info(
				`Shell environment variables loaded successfully. PATH: ${this.shellEnv.PATH || this.shellEnv.Path || "(not set)"}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				"Error loading shell environment variables:",
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Fold the user's login-shell PATH into `shellEnv`, when the app handed one in.
	 *
	 * Awaited at BOTH of its call sites, unlike the other enrichments the spawn
	 * environment carries, because unlike them this one IS the value being fixed: a
	 * fire-and-forget resolution is the defect it exists to remove, and the first
	 * spawn would keep the launchd PATH on exactly the machines whose rc is slowest.
	 * `resolve()` is memoized, so the second caller - and the console host, which
	 * holds the same resolver - is answered from the first shell's result rather
	 * than starting one.
	 *
	 * A no-op without a resolver: a manager a test or rig builds directly keeps the
	 * launch environment's PATH exactly as it did before.
	 */
	private async settleUserShellPath(): Promise<void> {
		if (!this.userShellPath) return;
		this.shellEnv = await withUserShellPath(this.shellEnv, this.userShellPath);
	}

	/**
	 * The environment the backend process is spawned with.
	 *
	 * The prefix is applied HERE, at the point the environment is handed to the
	 * spawn, rather than only inside `loadShellEnvironment()`. That load is
	 * started from the constructor without `await` (a constructor cannot wait)
	 * and `start()` has nothing sequencing it, so a shell rc that takes seconds
	 * to source - nvm, pyenv, conda init all do - leaves `shellEnv` at its
	 * `{ ...process.env }` seed when the first spawn happens: no prefix, and the
	 * exact pre-fix configuration, on the machines whose rc is slowest. Applying
	 * it here makes the guarantee structural instead of ordering-dependent, so
	 * no spawn path can miss it.
	 *
	 * PATH is the one term of that race this method no longer has to carry: its
	 * resolver is awaited before the first spawn (`settleUserShellPath`), so a slow
	 * rc delays the start rather than quietly leaving the launchd PATH in place.
	 * The prefix and the kill switch stay here all the same, because the seed they
	 * are read from is `process.env` itself - an exported `PYTHONPYCACHEPREFIX`
	 * inside the bundle, or a `.env` folded over the launch - and no shell
	 * resolution of PATH has anything to say about either.
	 *
	 * These spawns are the ones whose `python` is the interpreter we ship:
	 * CPython writes `__pycache__/*.pyc` beside the sources it imports, those
	 * sources are inside the code-sealed `.app`, and every such write breaks the
	 * signature ShipIt validates before an in-place update.
	 *
	 * The notification kill switch joins it here for the same reason, one level
	 * further out: the environment this returns is also where a `.env` folded
	 * over the launch, or a shell rc merged over that, would otherwise be the
	 * one that decides whether the backend this app spawns can banner the
	 * operator (see the comment on that entry, and `./notification-launch`).
	 */
	private backendSpawnEnv(): Record<string, string | undefined> {
		return {
			...withPythonBytecodeCache(this.shellEnv, this.appDataPath),
			// Managed starts rotate the token; set after the spread so the spawn
			// can never inherit a stale one from the shell environment. `start()`
			// mints it before it can reach a spawn site, so the `??` only satisfies
			// the field's nullable seed from `process.env`.
			LOCAL_OPERATOR_DESKTOP_TOKEN: this.desktopToken ?? undefined,
			/*
			 * LAST, and from `launchEnv` rather than from `this.shellEnv`: the
			 * notification kill switch is a fact about the LAUNCH, and `shellEnv`
			 * is where that fact can be lost twice over. `backend/config.ts` folds
			 * a `.env` from the working directory with dotenv `override: true`
			 * AFTER the launch, and `loadMacOSEnvironment` merges the operator's
			 * own shell rc on top of that - so a file or an rc can replace the
			 * value `pnpm app:headless` set, and the empty shape it leaves behind
			 * reads as ENABLED in the backend, which is the incident back.
			 * Applying it here, at the point the environment is handed to the
			 * spawn, is what the python bytecode prefix above already does for the
			 * same reason: structural, so no spawn path and no fold order can miss
			 * it. See `./notification-launch` for the three cases and why an
			 * unstated key is left alone.
			 */
			...resolveNotificationLaunch(launchEnv),
		};
	}

	/**
	 * Load environment variables from macOS shell configuration files
	 */
	private async loadMacOSEnvironment(): Promise<void> {
		const home = os.homedir();
		const possibleFiles = [
			join(home, ".zshrc"),
			join(home, ".bash_profile"),
			join(home, ".bashrc"),
			join(home, ".profile"),
		];

		// Find the first shell config file that exists
		let shellConfigFile: string | null = null;
		for (const file of possibleFiles) {
			if (fs.existsSync(file)) {
				shellConfigFile = file;
				break;
			}
		}

		if (!shellConfigFile) {
			logger.info(
				"No shell configuration file found on macOS",
				LogFileType.BACKEND,
			);
			return;
		}

		try {
			// Execute a command that sources the shell config file and prints the environment
			const { stdout } = await execPromise(
				`source "${shellConfigFile}" && env`,
				{ shell: "/bin/bash" },
			);

			// Parse the environment variables
			const envVars = stdout.split("\n");
			for (const line of envVars) {
				const match = line.match(ENV_VAR_REGEX);
				if (match) {
					const [, key, value] = match;
					this.shellEnv[key] = value;
				}
			}

			logger.info(
				`Loaded environment variables from ${shellConfigFile}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				`Error loading environment from ${shellConfigFile}:`,
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Load environment variables from Linux shell configuration files
	 */
	private async loadLinuxEnvironment(): Promise<void> {
		const home = os.homedir();
		const possibleFiles = [
			join(home, ".bashrc"),
			join(home, ".zshrc"),
			join(home, ".profile"),
		];

		// Find the first shell config file that exists
		let shellConfigFile: string | null = null;
		for (const file of possibleFiles) {
			if (fs.existsSync(file)) {
				shellConfigFile = file;
				break;
			}
		}

		if (!shellConfigFile) {
			logger.info(
				"No shell configuration file found on Linux",
				LogFileType.BACKEND,
			);
			return;
		}

		try {
			// Execute a command that sources the shell config file and prints the environment
			const { stdout } = await execPromise(
				`bash -c "source \\"${shellConfigFile}\\" && env"`,
				{ shell: "/bin/bash" },
			);

			// Parse the environment variables
			const envVars = stdout.split("\n");
			for (const line of envVars) {
				const match = line.match(ENV_VAR_REGEX);
				if (match) {
					const [, key, value] = match;
					this.shellEnv[key] = value;
				}
			}

			logger.info(
				`Loaded environment variables from ${shellConfigFile}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				`Error loading environment from ${shellConfigFile}:`,
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Load environment variables from Windows user profile
	 */
	private async loadWindowsEnvironment(): Promise<void> {
		try {
			// On Windows, we can use the 'set' command to get environment variables
			const { stdout } = await execPromise("set", { shell: "cmd.exe" });

			// Parse the environment variables
			const envVars = stdout.split("\r\n");
			for (const line of envVars) {
				const match = line.match(ENV_VAR_REGEX);
				if (match) {
					const [, key, value] = match;
					this.shellEnv[key] = value;
				}
			}

			// Explicitly check for and add pyenv-win paths
			// These might not be in the current process environment yet if they were just set
			const userProfile = process.env.USERPROFILE || os.homedir();
			const pyenvDir = join(userProfile, ".pyenv");
			const pyenvBinPath = join(pyenvDir, "pyenv-win", "bin");
			const pyenvShimsPath = join(pyenvDir, "pyenv-win", "shims");

			// Check if these directories exist
			if (fs.existsSync(pyenvBinPath) && fs.existsSync(pyenvShimsPath)) {
				logger.info(
					`Found pyenv-win directories at ${pyenvBinPath} and ${pyenvShimsPath}`,
					LogFileType.BACKEND,
				);

				// Add to PATH if not already there
				const currentPath = this.shellEnv.PATH || "";
				if (!currentPath.includes(pyenvBinPath)) {
					this.shellEnv.PATH = `${pyenvBinPath};${currentPath}`;
				}
				if (!currentPath.includes(pyenvShimsPath)) {
					this.shellEnv.PATH = `${pyenvShimsPath};${this.shellEnv.PATH}`;
				}

				// Set PYENV and PYENV_HOME environment variables
				const pyenvWinPath = join(pyenvDir, "pyenv-win");
				this.shellEnv.PYENV = pyenvWinPath;
				this.shellEnv.PYENV_HOME = pyenvWinPath;

				logger.info(
					`Added pyenv-win paths to environment. PATH now includes: ${pyenvBinPath} and ${pyenvShimsPath}`,
					LogFileType.BACKEND,
				);
			} else {
				logger.info(
					`pyenv-win directories not found at ${pyenvBinPath} or ${pyenvShimsPath}`,
					LogFileType.BACKEND,
				);
			}

			// Add the virtual environment Scripts directory to PATH
			// This ensures we can find the local-operator executable
			const venvScriptsPath = join(this.venvPath, "Scripts");
			if (fs.existsSync(venvScriptsPath)) {
				const currentPath = this.shellEnv.PATH || "";
				if (!currentPath.includes(venvScriptsPath)) {
					this.shellEnv.PATH = `${venvScriptsPath};${currentPath}`;
					logger.info(
						`Added virtual environment Scripts directory to PATH: ${venvScriptsPath}`,
						LogFileType.BACKEND,
					);
				}
			}

			logger.info(
				"Loaded environment variables from Windows user profile",
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				"Error loading environment from Windows user profile:",
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/** Publish WHY no daemon could be attached, as a named state rather than a
	 * generic failure.
	 *
	 * Three different facts reach the no-spawn branch and a surface told only
	 * "blocked" rendered a daemon that is still running as an outage: a wedged
	 * record is a LIVE process whose heartbeat stopped, a gone record is a lost
	 * server whose heartbeat is too fresh to reap, and a remote target that
	 * refused this app's credential is a third. Each is named here, which is what
	 * lets the copy say "a server is running and this app did not attach to it"
	 * instead of "the server is offline". */
	private observeNoCandidate(): void {
		const wedged = this.discoveryWedged.find((record) => record.alive);
		const goneRecord = this.discoveryWedged.find((record) => !record.alive);
		if (wedged) {
			/*
			 * A daemon IS running: its process is alive and its record is on disk,
			 * but its published heartbeat stopped, so discovery refuses both to
			 * attach to it and to start a second one over it. Reporting this as
			 * `detached` was the last way this app told a user their server was
			 * offline while a process was still there - the record is the reason
			 * it is named by pid, which is also its filename in `run/serve`.
			 */
			this.daemonState.observe({
				kind: "heartbeat-stale",
				detail: `A Local Operator daemon is running (pid ${wedged.pid}), but it stopped publishing its heartbeat, so this app did not attach to it. Waiting without starting a second one.`,
			});
		} else if (this.answeredButUnusable) {
			/*
			 * A daemon that answered is not an absence. Reaching `no-candidate` here
			 * published `detached` - the banner's "offline" - for a server that had
			 * just answered this app's own read with a status, which is the same
			 * wrong sentence as the false credential refusal one branch up, one
			 * state further along.
			 */
			this.daemonState.observe({
				kind: "unattachable",
				detail: `A Local Operator daemon is running at ${this.answeredButUnusable.address} and answered this app's read with HTTP ${this.answeredButUnusable.status}, so this app is not attached to it. Nothing is being started over it; it keeps probing.`,
			});
		} else {
			this.daemonState.observe({
				kind: "no-candidate",
				detail: this.remoteConfigured
					? "The configured remote server is unavailable or refused this app's credential; no local replacement will be started."
					: goneRecord
						? /*
							 * The other way a record is `wedged`: the process is GONE and the
							 * heartbeat is too fresh to justify reaping. That is a lost server,
							 * not a running one, so it is reported as a detach - claiming a
							 * daemon "is running" here would be the same wrong sentence QA
							 * round 1 found in the rejection detail, on the surface a user reads.
							 */
							`The Local Operator server whose record names pid ${goneRecord.pid} is no longer running, but its record is too fresh to reap, so this app did not attach to it.`
						: this.discoveryBlocksSpawn
							? "A local daemon may still be running, but could not be attached. Waiting without starting a duplicate."
							: "No Local Operator daemon was found and this app is configured not to start one.",
			});
		}
		this.notifyStatus();
	}

	/**
	 * The global launcher this app ranks its daemons by, spawns from, and reports.
	 *
	 * ONE resolution, read by `checkLocalOperatorExists`, `resolveGlobalConsole`
	 * and `preferredInstallPrefix`, because the three have to name the same
	 * install: the decision to run GLOBAL_INSTALL is only true if the spawn can
	 * resolve that same launcher, and a second resolution through a different
	 * mechanism is exactly how a shell rc file's prepended venv becomes the thing
	 * that gets spawned while the ranking talked about a different one.
	 *
	 * `resolveCommandPath`, NOT `which`. WHY, measured on this host 2026-09-16: the
	 * app is started by LaunchServices, whose PATH is `/usr/bin:/bin:/usr/sbin:/sbin`,
	 * and an app launched from a session that carries its own minimal PATH inherits
	 * that. `~/.local/bin` - where uv and pipx link their console scripts, and where
	 * this machine's `lop-update` install lives - is on neither. So the shell probe
	 * this replaced answered "not found globally" on every ordinary launch, and the
	 * app fell through to its OWN bundled environment: it ran a backend the
	 * operator never updates, watched it diverge from `lop --version` (0.55.9
	 * bundled against 0.55.10 installed), and offered to `pip install` into a uv
	 * tool. `resolveCommandPath` searches the installers' own locations
	 * (`UV_TOOL_BIN_DIR`, `XDG_BIN_HOME`, `$XDG_DATA_HOME/../bin`, `~/.local/bin`,
	 * the Homebrew prefixes and every uv tool environment) as well as the inherited
	 * PATH, so the same install is named with or without a shell - which is the
	 * ranking rule `preferredInstallPrefix` states, and precisely what a
	 * `which`-based check could not honour.
	 *
	 * `local-operator` before `lop`: both are console scripts of the same install
	 * and normally sit in the same bin directory, but the spawn reads the resolved
	 * script's shebang and refuses anything that is not a
	 * `from local_operator.cli import main` launcher (`consoleInterpreter`), so the
	 * name this app has always spawned is tried first and `lop` covers an install
	 * whose older console script is gone.
	 */
	private globalConsoleScript(): string | null {
		/*
		 * THE SHARED HELPER, not a second copy of its rule (review R2-2). The update
		 * path resolves the plan and the install's identity through this same
		 * function, so the decision this feeds, the ranking and the plan cannot drift
		 * apart - including on Windows, where the helper's own arm asks `where` for
		 * both names and the inline pair here could only ever have tried one of them
		 * through `resolveCommandPath`. Its docstring says it is one helper for both
		 * callers; this is the call site that made that true.
		 */
		return resolveGlobalConsoleScript();
	}

	/**
	 * Check if the local-operator command exists globally
	 * @returns Promise resolving to true if the command exists, false otherwise
	 */
	async checkLocalOperatorExists(): Promise<boolean> {
		const command = this.globalConsoleScript();
		if (!command) {
			logger.info(
				"local-operator command not found globally",
				LogFileType.BACKEND,
			);
			return false;
		}
		if (
			process.platform === "darwin" &&
			isLegacyManagedCommand(
				command,
				join(
					app.getPath("home"),
					"Library",
					"Application Support",
					"Local Operator",
				),
			)
		) {
			logger.info(
				`The resolved command belongs to a legacy managed environment (${command}); preparing a separate backend instead`,
				LogFileType.BACKEND,
			);
			return false;
		}
		logger.info(
			`local-operator command found at: ${command}`,
			LogFileType.BACKEND,
		);
		return true;
	}

	/**
	 * `sys.prefix` of the install the user's own `lop` runs, when it can be named.
	 *
	 * This is ranking rule 1 (design §3.5): the daemon to prefer is the one that
	 * shares your CLI's install, because the complaint that produced this work
	 * is that the app used to prefer its OWN bundled venv. The prefix is read
	 * from the resolved shim's layout - uv writes `uv-receipt.toml` beside the
	 * environment, pip/pipx leave `pyvenv.cfg` in it - rather than from a version
	 * comparison, since two installs can hold the same version and still be the
	 * wrong one.
	 */
	private preferredInstallPrefix(): string | null {
		try {
			const identity = readInstallIdentity(this.globalConsoleScript());
			if (identity.uvReceipt) return dirname(identity.uvReceipt);
			if (identity.venvPrefix) return identity.venvPrefix;
			return null;
		} catch {
			// Not being able to name the user's install is a ranking downgrade,
			// never a reason to fail: discovery still attaches to a validated
			// daemon by version and start time.
			return null;
		}
	}

	/**
	 * True when this app holds a desktop credential for the configured backend.
	 *
	 * This is the RELAY's own `available` fact, asked here rather than re-derived,
	 * so that adopting a backend and streaming from it agree on what "we can talk
	 * to this server" means. A server this app holds no token for is one it can
	 * never authenticate to: adopting it attaches the renderer to a backend that
	 * refuses every session list and every stream - the empty-conversation
	 * outcome this whole subsystem exists to remove.
	 *
	 * Since discovery, the ordinary path mints that credential through the claim
	 * handshake (`attachIfUsable`). This predicate is the gate of the ONE path
	 * that cannot: the legacy fixed-port fallback below.
	 */
	private canAuthenticate(): boolean {
		return this.getStreamRelay().available;
	}

	/**
	 * Discover the daemons on this machine, then attach to the best usable one.
	 *
	 * The replacement for "probe one URL and accept any 200". Every candidate is
	 * a record whose pid is alive and whose `/health` proves it is the process
	 * the record describes, so this answers the two questions the old probe could
	 * not: WHICH daemon is this, and is it the same one I was talking to a minute
	 * ago.
	 *
	 * Candidates are tried in rank order and the first USABLE one wins, where
	 * usable means this app holds a bearer the daemon actually accepts. That gate
	 * is not new and not negotiable: adopting a daemon this app cannot
	 * authenticate to attaches the renderer to a backend that refuses every
	 * session list and every stream - the empty-conversation outcome. A daemon
	 * that answers but is out of this app's reach is REPORTED (its capability is
	 * in the status) and skipped, which is also why the next candidate gets a
	 * try: the operator can have several daemons, and the right one is not
	 * necessarily the first by version.
	 *
	 * @returns true when a daemon was attached (which is not the same as "the
	 * app will not start one": `start()` decides that separately, and an app
	 * forbidden from spawning is still allowed to discover).
	 */
	private async discoverAndAttach(): Promise<boolean> {
		const adopted = await this.adoptFirstUsableDaemon();
		/*
		 * WHY the probe loop is armed HERE and not only in `startOwned()`.
		 *
		 * `src/main/index.ts` calls this (through `checkExistingBackend()`) at
		 * startup and calls `start()` ONLY when discovery found nothing - so an app
		 * that adopted the operator's daemon finished starting with no interval at
		 * all. The status then froze for the life of the app: the row kept naming
		 * the adopted pid (and its version) after that process was gone,
		 * `DETACHED_AFTER_MS` never promoted it to "stopped", nothing re-discovered
		 * a daemon the operator started later without an app restart, and the
		 * connectivity banner - whose only entry is an unreachable state - could
		 * never appear, so the Retry that would run `reconnectNow()` was unreachable
		 * in exactly the state that needed it (QA round 3, Q-1; review round 3,
		 * R3-1).
		 *
		 * Adoption is what arms it, at every adoption: the record-backed candidate
		 * here and the deprecated pre-record fallback this method reaches, which
		 * publishes the same attachment. `startHealthCheck()` is idempotent - it
		 * clears any existing interval first - so the owned path's own call, a
		 * re-attach after a recovery and the three existing call sites stay
		 * harmless.
		 */
		if (adopted) this.startHealthCheck();
		return adopted;
	}

	/**
	 * The discovery sweep and the adoption it ends in.
	 *
	 * {@link discoverAndAttach} owns what a successful attach implies for the
	 * app; this owns which daemon is found, and why the rest are refused.
	 */
	private async adoptFirstUsableDaemon(): Promise<boolean> {
		if (this.isAppClosing) return false;
		this.discoveryWedged = [];
		this.answeredButUnusable = null;
		if (this.remoteConfigured) {
			this.discoveryBlocksSpawn = true;
			return await this.legacyFixedPortAdoption();
		}
		const result = await discoverDaemons({
			configuredUrl: backendConfig.VITE_LOCAL_OPERATOR_API_URL,
			preferredPrefix: this.preferredInstallPrefix(),
			log: (message) => logger.info(message, LogFileType.BACKEND),
		});
		this.discoveryBlocksSpawn = result.blocksSpawn;
		this.discoveryWedged = result.wedged;
		// Reaping is the one write discovery may lead to, and it is guarded
		// inside `reapStaleRecords`: dead pid, aged heartbeat, and a re-read
		// record that must still classify as dead. A proven-dead record is MOVED
		// into `<run dir>/reaped/`, never deleted - the backend's own reaper keeps
		// it there as the evidence an attention classifier reads.
		for (const file of reapStaleRecords(result.reapable)) {
			logger.info(`Reaped stale serve record ${file}`, LogFileType.BACKEND);
		}
		for (const candidate of result.candidates) {
			if (await this.attachIfUsable(candidate)) return true;
		}
		if (result.noRecordsAtAll) return await this.legacyFixedPortAdoption();
		return false;
	}

	/**
	 * Attach to one candidate, if this app holds a bearer its desktop plane
	 * accepts.
	 *
	 * The claim happens HERE, before anything about this app changes: a candidate
	 * that turns out to be unusable must leave the manager exactly as it was, or
	 * a failed attach would strand the app on a daemon it cannot talk to. The
	 * key comes from that daemon's 0600 record - the only channel it is ever
	 * published through - and is used as a bearer and nothing else: never logged,
	 * never returned, never forwarded, including in the failure branches below,
	 * which name the OUTCOME only.
	 *
	 * @returns true when the candidate was adopted
	 */
	private async attachIfUsable(candidate: DiscoveredDaemon): Promise<boolean> {
		const key = candidate.record.claim_key;
		// Two ways to hold a bearer for somebody else's daemon: the claim key it
		// published, or the token this app was paired with through its
		// environment. With neither, the daemon is out of reach by construction -
		// an env-governed daemon the app did not spawn has no key on disk and a
		// token nobody told us.
		if (!key && !this.desktopToken) {
			/*
			 * WHICH fact this is decides both the sentence and whether any control may
			 * be offered, and the record already publishes it: `ServeRecord.desktop` is
			 * `true` exactly when the plane is GOVERNED (`registry.py` sets it for an
			 * env-governed plane and for an accepted claim, and publishes `claim_key:
			 * ""` in that same state). So a record with `desktop: true` and no key says
			 * "somebody else claimed this plane", which is a state with NO remedy this
			 * app may offer - while a record with neither says the daemon predates the
			 * handshake, where an update of an install this app owns IS a remedy.
			 * Collapsing the two into one sentence is what the operator photographed
			 * (design § 1.5, § 2 S2/S3).
			 */
			const governed = candidate.record.desktop;
			logger.info(
				`Daemon ${candidate.address} publishes no claim key and this app holds no pairing token for it; not attaching (its controls would refuse every call).${governed ? " Its record says the plane is already governed by another program." : " Its record does not describe a governed plane, so it predates the pairing handshake."}`,
				LogFileType.BACKEND,
			);
			// A CAPABILITY result, recorded beside the state: the daemon is
			// running, this app simply may not use it. Rendering that as "server
			// down" is the conflation this whole change exists to remove.
			this.daemonState.setPairing({
				available: false,
				cause: governed ? "governed-elsewhere" : "pre-handshake",
			});
			this.daemonState.observe({
				kind: "capability",
				status: 401,
				detail: governed
					? `A daemon is running at ${candidate.address}, but its desktop plane is already managed by another program and this app holds no credential for it.`
					: `A daemon is running at ${candidate.address}, but it is older than the pairing handshake this app uses and this app holds no credential for it.`,
			});
			this.notifyStatus();
			return false;
		}
		const token = key || (this.desktopToken as string);
		if (key) {
			const outcome = await claimDesktopPlane(candidate.address, key, {
				origins: this.rendererOrigins(),
			});
			switch (outcome.outcome) {
				case "claimed":
					logger.info(
						`Claimed the desktop plane on ${candidate.address}${outcome.origins.length > 0 ? ` declaring ${outcome.origins.length} renderer origin(s)` : ""}.`,
						LogFileType.BACKEND,
					);
					break;
				case "already-claimed":
					// The latch: the plane is already governed. The key it was
					// governed with is the SAME key this record publishes (the claim
					// stores the published value), so the read below decides - and a
					// second app instance on this machine is a normal thing for the
					// operator to run, not an error.
					logger.info(
						`Daemon ${candidate.address} is already governed (claim latch). Verifying that this app's key is the accepted one rather than fighting for ownership.`,
						LogFileType.BACKEND,
					);
					break;
				case "wrong-key":
					/*
					 * `401` from the claim route means the key this record published is not the
					 * key the answering process holds, which is a record left behind by a
					 * PREVIOUS process at this address - a successor took the port. That is the
					 * S1 fact, and naming it is what lets the banner say the server was replaced
					 * instead of inventing an ownership instruction (design § 2 S1, § 1.6).
					 */
					logger.info(
						`Daemon ${candidate.address} did not accept the claim key its own record published (${outcome.outcome}); the record belongs to a process that is no longer answering. Not attaching.`,
						LogFileType.BACKEND,
					);
					this.daemonState.setPairing({
						available: false,
						cause: "successor",
					});
					return false;
				case "no-handshake":
					// The route is absent, so the INSTALL predates the handshake. No credential
					// of ours can ever be accepted by it, and that is a different sentence from
					// "it refused me" - and the only pairing cause for which a server update is
					// a remedy at all (design § 2 S3).
					logger.info(
						`Daemon ${candidate.address} has no claim route (HTTP ${outcome.status}); it predates the pairing handshake. Not attaching.`,
						LogFileType.BACKEND,
					);
					this.daemonState.setPairing({
						available: false,
						cause: "pre-handshake",
					});
					this.daemonState.observe({
						kind: "capability",
						status: outcome.status,
						detail: `A daemon is running at ${candidate.address}, but it is older than the pairing handshake this app uses (its claim route answered HTTP ${outcome.status}).`,
					});
					this.notifyStatus();
					return false;
				case "refused":
					// The daemon answered and refused the claim for a reason of its own. A
					// `503` is the one status the daemon's contract uses for "this plane never
					// published a key", which is the pre-handshake shape again; everything
					// else is this app's credential being refused.
					logger.info(
						`Daemon ${candidate.address} did not accept this app's claim (${outcome.outcome} ${outcome.status}); not attaching.`,
						LogFileType.BACKEND,
					);
					this.daemonState.setPairing({
						available: false,
						cause:
							outcome.status === 503 ? "pre-handshake" : "credential-refused",
					});
					return false;
				case "unreachable":
					logger.info(
						`Daemon ${candidate.address} could not be reached to claim its desktop plane: ${outcome.detail}`,
						LogFileType.BACKEND,
					);
					return false;
			}
		}
		const probe = await this.probeCandidate(candidate.address, token);
		if (probe.verdict === "refused") {
			logger.info(
				`Daemon ${candidate.address} refused this app's bearer for its desktop plane (HTTP ${probe.status}); not attaching (it would refuse every session list and every stream).`,
				LogFileType.BACKEND,
			);
			this.daemonState.setPairing({
				available: false,
				cause: "credential-refused",
			});
			this.daemonState.observe({
				kind: "capability",
				status: probe.status,
				detail: `A daemon is running at ${candidate.address}, but it refused this app's credential for its desktop plane (HTTP ${probe.status}).`,
			});
			this.notifyStatus();
			return false;
		}
		if (probe.verdict === "unusable") {
			/*
			 * A daemon that ANSWERS but cannot serve this read is not a daemon that
			 * refused this app's credential, and the difference is load-bearing: the
			 * refusal branch above records a capability verdict and declines, and a
			 * decline here is what let `start()` mint a replacement token and spawn a
			 * second daemon onto a port that was already answering (a 503 from a
			 * daemon whose session store cannot be read was read as "any non-2xx" by
			 * the old boolean probe). `discoveryBlocksSpawn` is the flag the spawn
			 * path already consults to mean "a local daemon may still be running"
			 * (backend-service.ts, `start`), so the app keeps probing and re-attaches
			 * on a later tick instead of racing a replacement onto a serving port.
			 */
			logger.info(
				`Daemon ${candidate.address} answered HTTP ${probe.status} to this app's desktop read without refusing its credential; not attaching this tick, and not starting a daemon over it.`,
				LogFileType.BACKEND,
			);
			this.discoveryBlocksSpawn = true;
			this.answeredButUnusable = {
				address: candidate.address,
				status: probe.status,
			};
			this.daemonState.observe({
				kind: "unattachable",
				detail: `A daemon is running at ${candidate.address} and answered this app's read with HTTP ${probe.status}, so this app is not attached to it. Nothing is being started over it.`,
			});
			this.notifyStatus();
			return false;
		}
		if (probe.verdict === "unreachable") {
			/*
			 * Nothing answered, so this is not evidence about the ADDRESS either way
			 * - unlike the two branches above, it must not claim occupancy, or a
			 * stale record's dead address would pin the app off spawning for good.
			 * The record's own aging path (`reapStaleRecords`) is what retires it.
			 */
			return false;
		}
		await this.attachTo(candidate, token);
		return true;
	}

	/**
	 * One authenticated read against a specific address with a specific bearer.
	 *
	 * A `/health` 200 proves a process is listening, not that it is OURS or that
	 * this app may use it. The desktop vocabulary answers 401/403 for a bearer it
	 * does not hold, so one authenticated read is what separates a daemon this
	 * app can actually drive from one that merely answers.
	 *
	 * The address and token are parameters rather than `this.backendUrl` /
	 * `this.desktopToken` because this runs BEFORE adoption: the candidate must
	 * be proved usable without the manager having committed to it.
	 */
	private async probeCandidate(
		address: string,
		token: string,
	): Promise<
		| { verdict: "accepted" }
		| { verdict: "refused" | "unusable"; status: number }
		| { verdict: "unreachable" }
	> {
		try {
			/*
			 * Deliberately NOT evidence for the state machine, unlike
			 * `requestDesktop`. This asks about a CANDIDATE address with a
			 * candidate's credential, which may be neither the daemon this app is
			 * attached to nor one it ever attaches to; stamping `lastTransportAt`
			 * from a probe of someone else's port would let an unrelated listener
			 * hold the app off `detached`. The adoption path that follows an
			 * `accepted` here publishes its own state through `attachTo`.
			 */
			const result = await requestDesktop(
				{ op: "sessions.list", limit: 1 },
				address,
				token,
			);
			const verdict = classifyDesktopAnswer(result.status);
			return verdict === "accepted"
				? { verdict }
				: { verdict, status: result.status };
		} catch {
			return { verdict: "unreachable" };
		}
	}

	/**
	 * Adopt a validated, usable daemon: rotate onto it and publish the state.
	 *
	 * The rotation must happen before `notifyBackendReady()`: everything that
	 * queries the backend (the SSE relay, `requestDesktop`, the capability read)
	 * resolves against `backendUrl` at call time, and a consumer that ran against
	 * the previous address would describe a daemon the app has just left
	 * (review round 2, R2-2).
	 */
	private async attachTo(
		candidate: DiscoveredDaemon,
		token: string,
	): Promise<void> {
		const previousUrl = this.backendUrl;
		this.port = candidate.record.port;
		this.backendUrl = candidate.address;
		this.attachedRecord = candidate;
		this.isExternalBackend = true;
		// The bearer that was just proved accepted, kept for the relay and every
		// later desktop call against this daemon.
		this.desktopToken = token;
		// EXISTING_SERVER, not a new mode: "a daemon this app did not start is
		// serving" is exactly what that mode already means to the update plan and
		// to the quit path, and a second spelling for it would be a second opinion
		// about ownership (design §3.7).
		this.startupMode = LocalOperatorStartupMode.EXISTING_SERVER;
		logger.info(
			`Attached to daemon ${candidate.address} (pid ${candidate.record.pid}, v${candidate.identity.version}, ${candidate.record.install_kind || "kind unknown"}, record ${candidate.file})${previousUrl !== candidate.address ? ` - backend URL moved from ${previousUrl}` : ""}`,
			LogFileType.BACKEND,
		);
		this.attachDaemon(
			{
				url: candidate.address,
				instanceId: candidate.identity.instanceId,
				pid: candidate.record.pid,
				version: candidate.identity.version,
				prefix: candidate.identity.prefix || candidate.record.prefix,
				installKind:
					candidate.identity.installKind || candidate.record.install_kind,
			},
			{ owned: false },
		);
		this.daemonState.setPairing(DAEMON_PAIRED);
		if (candidate.record.retiring_to) {
			/*
			 * The record announces that the INSTALLED build changed under this
			 * daemon. It is NOT a handover: the daemon keeps serving, and no
			 * successor is promised, so this only names what was observed. Reading
			 * it as "handing over" and moving the state would detach the event
			 * stream and abandon in-flight turns over an announcement. Acting on it
			 * is the update-continuity work, which needs a verified idle-boundary
			 * handoff from the backend before the app may do anything at all.
			 */
			this.daemonState.observe({
				kind: "build-announced",
				detail: `Daemon ${candidate.address} reports a new installed build (v${candidate.record.retiring_from ?? "?"} -> v${candidate.record.retiring_to}); it is still serving on this connection.`,
			});
		}
		this.notifyStatus();
		this.notifyBackendReady();
	}

	/**
	 * The origins a claim may declare, or none.
	 *
	 * Only a real `http(s)` origin is declarable. The packaged app renders from
	 * `file://`, whose origin is the literal `"null"` that the backend refuses to
	 * install - it names every opaque document rather than this application - so
	 * a packaged claim declares nothing, and because an EMPTY allowlist keeps the
	 * daemon's historical CORS echo, the renderer's remaining direct reads keep
	 * working. In development the renderer is served from an http origin, and
	 * declaring it is what admits that origin once the claim tightens the plane.
	 */
	private rendererOrigins(): string[] {
		const url = process.env.ELECTRON_RENDERER_URL;
		if (!url) return [];
		const origin = normaliseAddress(url);
		return origin ? [origin] : [];
	}

	/**
	 * The ONE-release fallback for a daemon that predates the rendezvous record.
	 *
	 * This is the previous adoption path, kept verbatim in intent and renamed for
	 * what it now is (design §8): reachable ONLY when the record directory holds
	 * no record at all, i.e. the daemon serving this machine was built before
	 * `run/serve` existed. Without it a UI update would strand every user whose
	 * daemon is older than the UI; with it, that user keeps exactly the behaviour
	 * they had, including the pairing gate: a listener is adopted only when this
	 * app can authenticate to it.
	 *
	 * It is NOT reachable when records exist. There, a listener that is not the
	 * daemon a record describes is refused by the identity check - precisely the
	 * bug that admitted a stale dev server eleven releases behind - and the
	 * configured URL can only rank a candidate last, never admit one.
	 */
	private async legacyFixedPortAdoption(): Promise<boolean> {
		if (!this.canAuthenticate()) {
			logger.info(
				"No desktop pairing token for the configured backend; not adopting an external backend.",
				LogFileType.BACKEND,
			);
			return false;
		}
		try {
			logger.warn(
				`Deprecated: no serve records found. Falling back to the fixed-port probe at ${this.backendUrl}/health for a daemon predating the record format. This fallback is scheduled for removal (design §8).`,
				LogFileType.BACKEND,
			);
			const response = await fetch(`${this.backendUrl}${HEALTH_PATH}`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 2),
			});
			if (!response.ok) {
				logger.info(
					`Legacy probe of ${this.backendUrl} answered ${response.status}; not adopting.`,
					LogFileType.BACKEND,
				);
				return false;
			}
			const payload = (await response.json().catch(() => null)) as {
				result?: { version?: unknown };
			} | null;
			if (!(await this.authenticatesAgainstBackend())) {
				logger.info(
					"A backend answered health but did not accept this app's desktop credential; not adopting it.",
					LogFileType.BACKEND,
				);
				return false;
			}
			const version =
				typeof payload?.result?.version === "string"
					? payload.result.version
					: "";
			this.attachedRecord = null;
			this.isExternalBackend = true;
			this.startupMode = LocalOperatorStartupMode.EXISTING_SERVER;
			this.attachDaemon(
				{
					url: this.backendUrl,
					instanceId: "",
					pid: 0,
					version,
					prefix: "",
					installKind: "",
				},
				{ owned: false },
			);
			this.daemonState.setPairing(DAEMON_PAIRED);
			logger.info(
				`Adopted a pre-record daemon at ${this.backendUrl} (v${version || "unknown"}) through the deprecated fallback.`,
				LogFileType.BACKEND,
			);
			this.notifyStatus();
			this.notifyBackendReady();
			return true;
		} catch (error) {
			logger.info(
				`Legacy fixed-port probe of ${this.backendUrl} failed: ${error instanceof Error ? error.message : String(error)}`,
				LogFileType.BACKEND,
			);
			return false;
		}
	}

	/**
	 * Ask the answering backend whether it will accept this app's bearer.
	 *
	 * Used by the deprecated pre-record fallback, which has no claim key to
	 * present: the only credential there is the token this app already holds.
	 */
	private async authenticatesAgainstBackend(): Promise<boolean> {
		try {
			const result = await this.requestDesktop({
				op: "sessions.list",
				limit: 1,
			});
			return classifyDesktopAnswer(result.status) === "accepted";
		} catch {
			return false;
		}
	}

	/**
	 * Check whether a daemon this app can use is already running, and attach to
	 * it if so.
	 *
	 * Declining is not a failure: `start()` spawns this app's own daemon exactly
	 * as it would on a cold start, and only when the manager is permitted to.
	 *
	 * @returns Promise resolving to true if a daemon was discovered and adopted
	 */
	async checkExistingBackend(): Promise<boolean> {
		return await this.discoverAndAttach();
	}

	/**
	 * Start the backend service
	 * @returns Promise resolving to true if the backend was started successfully, false otherwise
	 */
	/** The global console to launch, resolved the one shell-free way.
	 *
	 * `ownedServeLaunch` still proves the identity of what it is handed rather than
	 * trusting the name it was resolved under - that part is unchanged. What
	 * changed is WHERE the name comes from: this method used to re-resolve a bare
	 * `local-operator` through a shell, in the spawn environment that carries the
	 * login shell's PATH. That is the second resolution `globalConsoleScript`
	 * warns about, and it could name a venv a shell rc file prepends while the
	 * decision above had ranked the operator's real install - two answers to one
	 * question, with the spawn using the one the ranking never saw. Reading the
	 * same helper removes the possibility instead of documenting it.
	 *
	 * The throw is reachable only when the resolution succeeded a moment ago and
	 * the install disappeared since. It is deliberately not swallowed into an
	 * empty string: `consoleInterpreter("")` would report that as an ENOENT on a
	 * path nobody printed, and the caller's own failure report is the honest face
	 * of this.
	 */
	private async resolveGlobalConsole(): Promise<string> {
		const command = this.globalConsoleScript();
		if (!command) {
			throw new Error(
				"No global local-operator command could be resolved, though one was found a moment ago",
			);
		}
		return command;
	}

	/**
	 * Start a daemon this app owns, or attach to one that already exists.
	 *
	 * `stop(false)` is terminal by design: the app is going away or handing the
	 * installation over, and a spawn racing that hand-off is the double-serve
	 * case. A restart asks for `stop(true)`, which leaves this flag alone.
	 *
	 * Discovery runs FIRST, because this method is also the watchdog's recovery
	 * path: a daemon that appeared (or came back) after the app lost the one it
	 * had must be found again before a second one is ever spawned.
	 *
	 * @param options.quiet set by the watchdog, whose retries would otherwise
	 * raise one modal error dialog per attempt for a failure the app is already
	 * reporting in its status surface
	 * @param options.reuseDiscovery the caller has JUST run discovery in this same
	 * startup tick and its verdict - `discoveryBlocksSpawn`, the wedged records,
	 * the configured/remote flag - is what the decision below reads. Never pass it
	 * where time has passed in between - an installer, a dialog, anything that can
	 * let a daemon appear - because then the verdict is stale and spawning over a
	 * live daemon is the failure this path exists to prevent.
	 * @returns Promise resolving to true if the backend was started successfully, false otherwise
	 */
	start(options: StartOptions = {}): Promise<boolean> {
		if (this.isAppClosing) return Promise.resolve(false);
		if (this.startPromise) return this.startPromise;
		this.startPromise = this.startOwned(this.startEpoch, options).finally(
			() => {
				this.startPromise = null;
			},
		);
		return this.startPromise;
	}

	private async startOwned(
		epoch: number,
		options: StartOptions = {},
	): Promise<boolean> {
		if (this.ownedServe?.stop) return false;
		if (this.ownedServe) return this.isRunning;

		/*
		 * Discovery, unless the caller has just run it in this same startup tick.
		 *
		 * `checkExistingBackend()` publishes the attached state when it finds one,
		 * and it fires `notifyBackendReady()` AFTER the URL rotation - which is the
		 * ordering a consumer re-reading capabilities needs. Firing it again here
		 * raised two concurrent capability probes on the ordinary external-backend
		 * start, doubling that traffic and letting the OLDER read decide the result
		 * by settling last (review round 2, R2-2).
		 */
		if (!options.reuseDiscovery && (await this.checkExistingBackend())) {
			this.isRunning = true;
			this.startHealthCheck();
			return true;
		}
		if (epoch !== this.startEpoch || this.isAppClosing) return false;

		if (!this.managerMaySpawn || this.remoteConfigured) {
			/*
			 * `VITE_DISABLE_BACKEND_MANAGER=true` means "do not spawn or kill a
			 * daemon", NOT "assume one exists". Discovery found nothing, so there
			 * is nothing to attach to and nothing this app is allowed to start:
			 * the honest outcome is a named state plus a probe loop that keeps
			 * re-discovering, so the daemon the operator starts a minute later is
			 * attached without restarting the app. Returning true here, as the old
			 * early return did, is what made every conversation open empty.
			 */
			/*
			 * Three different reasons reach this branch, and a log that named the
			 * disable flag for all of them sent whoever read it looking in the wrong
			 * place - a remote target reported as "VITE_DISABLE_BACKEND_MANAGER=true"
			 * is a config file that is not the one in play.
			 */
			const noSpawnReason = this.managerMaySpawn
				? `the configured target (${this.backendUrl}) is remote`
				: "VITE_DISABLE_BACKEND_MANAGER=true";
			logger.info(
				`No daemon discovered, and this app is configured not to spawn one (${noSpawnReason}).`,
				LogFileType.BACKEND,
			);
			this.observeNoCandidate();
			this.startHealthCheck();
			return false;
		}

		/*
		 * NEVER SPAWN ONTO A PORT A LOCAL OPERATOR DAEMON IS ANSWERING.
		 *
		 * WHY this runs before every spawn attempt rather than only at discovery.
		 * Discovery's verdict answers "is there a daemon I may attach to"; this
		 * answers "would a child of mine be able to bind that port". They came apart
		 * on the operator's machine: discovery had no record to work with (`0
		 * record(s)`) so it reported nothing to attach to, the app spawned onto a
		 * port where a Local Operator daemon was already serving, and the child died
		 * with `[Errno 48] Address already in use` - every ~10 s, each an orphan,
		 * while `/health` and `/v1/desktop/sessions` kept answering 200 to the app's
		 * own reads in between. The spawner was the only process that could have
		 * known, and it was asking too late.
		 *
		 * Four answers stop the spawn, and the distinction between them is what the
		 * app can honestly act on:
		 *
		 *   - a daemon identifies itself at that address, and no record this app can
		 *     read gives it a credential: the app takes the capability path instead
		 *     (recorded as `unattachable`, never as "offline");
		 *   - the address did not answer in time: something may well be listening, and
		 *     a busy daemon missing a 2 s budget is exactly the condition this file's
		 *     probe rules exist for, so the port is not treated as free;
		 *   - the address ANSWERED with a status that is not 200: a daemon starting up,
		 *     one that is unhealthy or shutting down, or a proxy fronting one. A
		 *     status is not an identity, but it is an occupant, and this one is
		 *     counted because the two costs are not symmetric: declining to start
		 *     costs one recovery tick, and starting over that answer costs the
		 *     credential (the token is minted before the spawn, so the pairing for the
		 *     daemon actually serving there is already overwritten) plus an orphan on
		 *     an `[Errno 48]` loop every ~10 s;
		 *   - nothing answered and the socket was REFUSED: that is the one answer
		 *     that proves the port free, and it is the ordinary first run.
		 *
		 * A 200 that names no daemon identity does not stop the spawn: this app cannot
		 * tell a reverse proxy or a development fixture from a port it may use,
		 * refusing would leave it with no backend and no path to one, and the cost of
		 * being wrong there - one child that cannot bind, reported by the readiness
		 * loop - is smaller than the cost of never starting one. The observation still
		 * goes to the log, so the case is diagnosable. That licence does NOT extend to
		 * a non-200 answer, which is the case above and was the review's F-2: a
		 * listener answering 503 while it starts says nothing about whether the port is
		 * free, and reading it as free is exactly how the app spawned onto a serving
		 * daemon.
		 *
		 * Retried on the next recovery tick, so a port that frees up is spawned onto
		 * without an app restart.
		 */
		/*
		 * WHERE THIS ATTEMPT MAY SPAWN, and what happens when NOWHERE is free.
		 *
		 * The configured address is the first and ordinary choice; the fallback
		 * budget (`FALLBACK_SPAWN_URL`) is what keeps a daemon this app does not own
		 * from taking the app down with it. Everything below the resolution is
		 * unchanged: the winner is assigned to `port`/`backendUrl`, so the spawn, the
		 * readiness loop, the registration, the identity and the renderer's own base
		 * URL all follow one address - which is what makes the fallback a choice of
		 * address rather than a second code path.
		 *
		 * `discoveryBlocksSpawn` is no longer read HERE, deliberately. It is discovery's
		 * verdict scoped to the configured address, and this decision needs the same
		 * question answered per address, freshly: a stale root-wide verdict was exactly
		 * what forbade the spawn onto an address nothing was using (see
		 * `addressHoldsLiveRecord`). The field keeps its reporting role in
		 * `observeNoCandidate`.
		 */
		const { target, refusals } = await this.resolveSpawnTarget();
		this.spawnRefusals = target ? null : refusals;
		if (!target) {
			this.observeSpawnRefusal(refusals);
			this.startHealthCheck();
			return false;
		}
		this.port = target.port;
		this.backendUrl = target.address;
		if (refusals.length > 0) {
			/*
			 * The configured address was held and the app is serving somewhere else.
			 * This is a SUCCESS, and it is a success the operator has to be able to SEE
			 * (design round 1, D1): it used to raise no banner and no other surface said
			 * it either, so the "attached on 8080" and "attached on 1111" frames were
			 * byte-identical and "why is my app on 8080" had no in-product answer. The
			 * fact now goes into the snapshot (`AddressSubstitution`, recorded above),
			 * where the connectivity band renders it; this line stays because it is the
			 * diagnosable record of WHICH holder made the app move, in the daemon log.
			 */
			logger.warn(
				`Starting a managed daemon on ${target.address} instead: ${describeHolders(refusals)}.`,
				LogFileType.BACKEND,
			);
		}

		// No external backend, start our own. The token is minted and persisted
		// here, and the START is where it rotates: see the field's own note for why
		// a launch reads it back before rotating it.
		this.desktopToken = this.mintDesktopToken();
		// The generation THIS start creates, retained so a failure below cleans up
		// its own child: by then `this.ownedServe` may name a successor.
		let captured: OwnedServe | null = null;
		try {
			// Installation can select a new generation after this manager is built.
			// Once started, this instance pins that generation until its next start.
			this.venvPath = managedVenvPath({
				platform: process.platform,
				home: app.getPath("home"),
				appDataPath: this.appDataPath,
				packaged: app.isPackaged,
			});
			const globalInstall = await this.checkLocalOperatorExists();
			/*
			 * Before the spawn environment is built, not after: this is the ordering
			 * guarantee the PATH needs, and the reason it is not left to
			 * `loadShellEnvironment()` (started un-awaited from the constructor) or to
			 * `backendSpawnEnv()` (which has no async step to hook). A resolver answers
			 * from its first shell, so an already-started resolution costs a microtask
			 * here, and a resolution that is still running delays this start by at most
			 * its own bound instead of spawning with the PATH the app was launched with.
			 */
			await this.settleUserShellPath();
			const env = this.backendSpawnEnv();
			/*
			 * The interpreter to own, as CLAIMS rather than one path.
			 *
			 * POSIX reads the console script's shebang, which names the interpreter
			 * exactly. Windows cannot: the launcher is a PE shim, and the directory it
			 * was found in need not hold an interpreter at all - uv's executable
			 * directory holds versioned shims while the tool environment lives in
			 * another tree - so this side asks for every layout that could carry the
			 * backend and lets the identity probe admit one. A wrong assumption here is
			 * an app that cannot start (review round 2, F8).
			 */
			let interpreters: string[];
			if (globalInstall) {
				this.startupMode = LocalOperatorStartupMode.GLOBAL_INSTALL;
				const executable = await this.resolveGlobalConsole();
				interpreters =
					process.platform === "win32"
						? await windowsInterpreterCandidates(executable, env)
						: [consoleInterpreter(executable)];
			} else {
				this.startupMode = LocalOperatorStartupMode.APP_BUNDLED_VENV;
				const bin = join(
					this.venvPath,
					process.platform === "win32" ? "Scripts" : "bin",
				);
				interpreters = [
					join(bin, process.platform === "win32" ? "python.exe" : "python"),
				];
				// Preserve activation's environment without leaving an activation
				// shell between the ChildProcess handle and the actual HTTP server.
				env.VIRTUAL_ENV = this.venvPath;
				env.PATH = `${bin}${process.platform === "win32" ? ";" : ":"}${env.PATH ?? ""}`;
				env.PYTHONHOME = undefined;
			}
			const launch = await ownedServeLaunch(
				interpreters,
				this.port,
				env,
				process.platform,
				{},
				// The PATH-side claims spawn discovery children, so they are offered
				// only after the claims above have all failed (round 3, F14).
				process.platform === "win32"
					? () => windowsPathInterpreterCandidates(env)
					: undefined,
			);
			if (epoch !== this.startEpoch || this.isAppClosing) return false;
			const child = spawn(launch.command, launch.args, {
				detached: false,
				stdio: "pipe",
				// The plan owns the environment it proved: a Windows venv's base
				// interpreter needs the venv's import paths, added there and not here.
				env: launch.env,
				windowsHide: true,
			});
			const generation = this.captureServe(child);
			captured = generation;

			// Log output
			if (child.stdout) {
				child.stdout.on("data", (data) => {
					logger.info(`Backend stdout: ${data}`, LogFileType.BACKEND);
				});
			}

			if (child.stderr) {
				child.stderr.on("data", (data) => {
					logger.error(`Backend stderr: ${data}`, LogFileType.BACKEND);
				});
			}

			// Wait for backend to be healthy, polling fast while readiness is
			// likely and backing off after (see `readinessPollDelayMs`), inside the
			// same 30 s bound the flat 30 x 1 s loop gave.
			let readinessWaitedMs = 0;

			while (readinessWaitedMs < READINESS_BUDGET_MS) {
				const healthy = await this.checkHealth();
				if (epoch !== this.startEpoch || generation.exited || generation.stop)
					break;
				if (healthy) {
					this.isRunning = true;
					// Registered BEFORE readiness is announced: the Settings row's
					// version comes from this registration, and a consumer that
					// re-reads capabilities on `backendReady` must already see it.
					await this.registerOwnedDaemon(child);
					/*
					 * The REASON the app is on this address is recorded here, with the landing
					 * (agent round 2, R2-2): the gate picked the target earlier, but nothing
					 * about that decision is true until the daemon it started answers, and a
					 * reason recorded at intent time outlived a start that never landed.
					 */
					this.recordSubstitutionReason(refusals);
					this.startHealthCheck();
					this.notifyBackendReady();
					return true;
				}

				const delay = readinessPollDelayMs(readinessWaitedMs);
				readinessWaitedMs += delay;
				await new Promise((resolve) => setTimeout(resolve, delay));
			}

			await this.stopGeneration(generation, false);
			if (epoch !== this.startEpoch) return false;
			logger.error(
				"Failed to start backend service after multiple attempts",
				LogFileType.BACKEND,
			);

			this.reportStartOutcome(
				options,
				"Failed to start the Local Operator backend service. Please check the logs for more information.",
			);

			return false;
		} catch (error) {
			/*
			 * Clean up the generation this start created, not whatever manager state
			 * names: `this.ownedServe` can already hold a replacement (the watchdog
			 * spawns one) and stopping that would kill a live backend.
			 *
			 * `stopGeneration` memoises one promise per generation, so a cleanup whose
			 * own attempt already failed throws the SAME rejection here. Awaiting it
			 * unguarded rethrows past the dialog below and turns this method into a
			 * rejection - and `start()` is awaited by `checkUnhealthyBackend`, which
			 * runs from a void'd `setInterval`, so under Node's default
			 * `--unhandled-rejections=throw` the app died of an exception raised while
			 * reporting that it could not stop its own child (review round 1, F3).
			 * An unconfirmed cleanup is a fact to report, not a reason to lose the
			 * report.
			 */
			if (captured) {
				try {
					await this.stopGeneration(captured, false);
				} catch (cleanupError) {
					logger.error(
						"Owned backend cleanup after a failed start did not confirm exit",
						LogFileType.BACKEND,
						cleanupError,
					);
				}
			}
			logger.error(
				"Error starting backend service:",
				LogFileType.BACKEND,
				error,
			);

			this.reportStartOutcome(
				options,
				`Error starting the Local Operator backend service: ${error}`,
			);

			return false;
		}
	}

	/**
	 * Register the daemon this app just spawned with the state machine.
	 *
	 * WHY this exists. `attach()` used to be called only for a daemon this app
	 * DISCOVERED (plus a spawn that asked for an ephemeral port), so the ordinary
	 * fixed-port spawn - the path every user without a global `lop` takes -
	 * returned `true` without registering anything. The snapshot then described
	 * an app with no daemon (`owned: false`, no version, no pid), Settings printed
	 * `Unknown (update required)` for a backend the app had started seconds ago,
	 * and the death notice called it "the attached backend". Registering here is
	 * also what makes the app's own daemon reachable by the same rules as every
	 * other one: the probe loop can compare an `instance_id`, and the renderer can
	 * name which daemon the number describes.
	 *
	 * Identity comes from the child's own record when it publishes one - the only
	 * source of the `instance_id` a later probe compares against - and otherwise
	 * from the address that just answered, where the identity question for a
	 * process this app spawned itself is "is the answering pid my child". That
	 * second arm is the case of an install predating the record format, which is
	 * reachable on a fixed port exactly as the deprecated adoption path allows.
	 */
	private async registerOwnedDaemon(child: ChildProcess): Promise<void> {
		const identity = await this.ownedDaemonIdentity(child);
		if (!identity) {
			/*
			 * Nothing could be established: no record, and the address either did
			 * not answer or was answered by a process that is not this child.
			 * Registering a guess is the failure mode this whole module exists to
			 * remove, so the manager reports and leaves the state alone - and the
			 * sentence below names what that means for the row: nothing
			 * re-registers this child, so a later discovery pass can only re-find
			 * it as an EXTERNAL daemon (`owned: false`, no ownership re-derived).
			 * It used to promise the daemon "stays unregistered until the next
			 * probe", which is a re-registration that does not exist (review
			 * round 3, R3-4).
			 */
			logger.warn(
				`Started a daemon at ${this.backendUrl} (pid ${child.pid}) but could not establish its identity; it is left unregistered rather than guessed, and a later discovery pass can only re-find it as a DISCOVERED daemon - not as the child this app started.`,
				LogFileType.BACKEND,
			);
			return;
		}
		this.attachDaemon(identity, { owned: true });
		// Spawned by this app with this app's desktop token, so the plane accepts
		// it. Never asserted for a daemon this app did not start.
		this.daemonState.setPairing(DAEMON_PAIRED);
		this.notifyStatus();
		logger.info(
			`Registered this app's own daemon: ${identity.url} (pid ${identity.pid}, v${identity.version || "unknown"}, ${identity.installKind || "kind unknown"}).`,
			LogFileType.BACKEND,
		);
	}

	/**
	 * The identity of a daemon this app spawned, or null when it cannot be proved.
	 *
	 * The record is preferred and is asked for with the SHORT registration window:
	 * the child has already answered `/health` here, and a record is published
	 * with the listener, so the file is either already there or this install does
	 * not write one at all (see `OWNED_REGISTRATION_WINDOW_MS`).
	 */
	private async ownedDaemonIdentity(
		child: ChildProcess,
	): Promise<DaemonIdentity | null> {
		const pid = child.pid;
		if (pid === undefined) return null;
		const resolved = await this.resolveOwnedAddress(
			child,
			OWNED_REGISTRATION_WINDOW_MS,
		);
		if (resolved) {
			/*
			 * The URL stays the address the app is dialling and just proved healthy:
			 * the record's spelling of the same listener (`localhost` for
			 * `127.0.0.1`, say) is a second place for the two to disagree, and every
			 * later request resolves against this field.
			 */
			return {
				url: this.backendUrl,
				instanceId: resolved.instanceId,
				pid,
				version: resolved.version,
				prefix: resolved.prefix,
				installKind: resolved.installKind,
			};
		}
		try {
			const response = await fetch(`${this.backendUrl}${HEALTH_PATH}`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			});
			if (!response.ok) return null;
			const payload = (await response.json().catch(() => null)) as {
				result?: { version?: unknown };
			} | null;
			const health = readIdentity(payload);
			// A daemon that names a DIFFERENT process is somebody else's: the port
			// was taken, and registering it would label a stranger as this app's
			// child - the conflation the identity check exists to prevent.
			if (health && health.pid !== 0 && health.pid !== pid) return null;
			const version =
				health?.version ||
				(typeof payload?.result?.version === "string"
					? payload.result.version
					: "");
			return {
				url: this.backendUrl,
				// Empty for an install predating `instance_id`, which is what the
				// deprecated adoption path publishes for the same reason: there is
				// nothing to compare a later probe against, and the state machine
				// says so rather than inventing one.
				instanceId: health?.instanceId ?? "",
				pid,
				version,
				prefix: health?.prefix ?? "",
				installKind: health?.installKind ?? "",
			};
		} catch {
			return null;
		}
	}

	/**
	 * Wait for the child to publish its own record, then prove the address it
	 * names is the child.
	 *
	 * The record is keyed by pid, which is why this is scoped to THIS child: a
	 * record for any other pid is somebody else's daemon and is never adopted
	 * here. The `/health` identity check afterwards is what makes the record's
	 * claim trustworthy rather than merely plausible - the same rule discovery
	 * applies to every other candidate.
	 */
	private async resolveOwnedAddress(
		child: ChildProcess,
		windowMs: number = OWNED_RECORD_WINDOW_MS,
	): Promise<{
		address: string;
		port: number;
		instanceId: string;
		version: string;
		prefix: string;
		installKind: string;
	} | null> {
		if (!child.pid) return null;
		const deadline = Date.now() + windowMs;
		while (Date.now() < deadline) {
			if (this.process !== child) return null;
			const file = join(serveRunDir(), `${child.pid}.json`);
			try {
				const entry = parseRecord(
					JSON.parse(fs.readFileSync(file, "utf8")),
					file,
				);
				if (entry.record && entry.record.pid === child.pid) {
					const address = recordAddress(entry.record);
					const probe = await probeIdentity(address, entry.record.instance_id, {
						timeoutMs: PROBE_TIMEOUT_MS,
					});
					if (probe.outcome === "identified") {
						return {
							address,
							port: entry.record.port,
							instanceId: probe.identity.instanceId,
							version: probe.identity.version || entry.record.version,
							prefix: probe.identity.prefix || entry.record.prefix,
							installKind:
								probe.identity.installKind || entry.record.install_kind,
						};
					}
				}
			} catch {
				// No record yet (or a torn read): the child publishes once it has
				// bound its listener, which is what this loop waits for.
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		return null;
	}

	/** Report a start failure, honouring the watchdog's `quiet` retry.
	 *
	 * A retry the status surface is already reporting must not raise one modal per
	 * attempt; every other caller goes through `reportStartFailure`, which keeps
	 * the quit-path suppression that stops a modal parking the main thread. */
	private reportStartOutcome(options: StartOptions, message: string): void {
		if (options.quiet) {
			logger.error(
				`Backend Error (not shown; a retry is already reported in the status surface): ${message}`,
				LogFileType.BACKEND,
			);
			return;
		}
		this.reportStartFailure("Backend Error", message);
	}

	/**
	 * Stop only the captured serve generation, including failed startups. A port
	 * or process name is not ownership. Unconfirmed exit blocks replacement.
	 */
	async stop(isRestart = false): Promise<void> {
		this.startEpoch++;
		if (!isRestart) this.isAppClosing = true;
		this.disposeStreamRelay();
		this.stopHealthCheck();
		const generation = this.ownedServe;
		if (generation) await this.stopGeneration(generation, isRestart);
		// Resolver/readiness work must observe cancellation before an installer
		// is allowed to replace files, even when stop arrived before spawn.
		await this.startPromise;
	}

	private captureServe(child: ChildProcess): OwnedServe {
		let resolveExit = () => {};
		const generation: OwnedServe = {
			child,
			exited: false,
			exit: new Promise<void>((resolve) => {
				resolveExit = resolve;
			}),
			resolveExit: () => resolveExit(),
			stop: null,
			timers: new Set(),
		};
		this.ownedServe = generation;
		this.process = child;
		/*
		 * An adopted daemon's record stops describing the daemon serving this app the
		 * moment this process holds its own child (review round 2, T2). Left in place it
		 * outlived the adoption, and the reads that take a record - the drift's boot
		 * reading, and the post-restart one that is re-read from the same document -
		 * answered with the OLDER process's numbers, so a skew could be reported against
		 * a daemon that is not serving and a restart that did move the reading could be
		 * recorded as "did not take". The adoption arms set this field themselves
		 * (`attachTo`, the fixed-port adopt), so clearing it here loses nothing.
		 */
		this.attachedRecord = null;
		const exited = (code?: number | null) => {
			if (generation.exited) return;
			generation.exited = true;
			// This generation's escalation timers die with it, so a SIGKILL armed
			// for a process that has already gone cannot fire at a successor that
			// took its place in the meantime.
			for (const timer of generation.timers) clearTimeout(timer);
			generation.timers.clear();
			generation.resolveExit();
			// A LATE exit from a retired generation stops here. Everything below
			// writes manager-wide state, and a predecessor writing it is how a live
			// replacement used to be recorded as gone (and then re-spawned over).
			if (this.ownedServe !== generation) return;
			this.ownedServe = null;
			this.process = null;
			this.isRunning = false;
			// Only an exit nobody asked for is an error worth interrupting the user
			// for. `generation.stop` covers the deliberate kills - including the
			// Windows exit code 1 that a terminated serve reports, which the previous
			// code had to special-case by platform because it could not tell a
			// requested termination from a crash.
			if (
				code != null &&
				code !== 0 &&
				!generation.stop &&
				!this.isAppClosing &&
				!this.isAutoUpdating
			) {
				electronDialog.showErrorBox(
					"Backend Error",
					`The Local Operator backend service exited unexpectedly with code ${code}. Please restart the application.`,
				);
			}
		};
		child.once("exit", exited);
		child.on("error", (error) => {
			logger.error("Owned backend process error", LogFileType.BACKEND, error);
			// Spawn failure has no process. A signal error with a PID does not
			// prove exit and must retain ownership for fail-closed cleanup.
			if (child.pid === undefined) exited();
		});
		return generation;
	}

	/** Signals may only be sent while the handle itself still reports a live
	 * process. Node keeps `kill()` callable on a reaped child, and on a PID the
	 * OS has since recycled that call reaches whatever now holds the number. */
	private canSignal(generation: OwnedServe): boolean {
		return (
			!generation.exited &&
			generation.child.exitCode === null &&
			generation.child.signalCode === null
		);
	}

	/**
	 * The one termination sequence: SIGTERM, wait out the grace, SIGKILL, wait
	 * again, and throw if the process never reported exit.
	 *
	 * Failing rather than returning is the point. Callers use a resolved stop as
	 * permission to replace the backend - install over it, spawn a successor - so
	 * "we signalled it and moved on" would authorise exactly the double-serve
	 * this class exists to prevent. An unconfirmed exit keeps ownership, and the
	 * caller reports failure instead of proceeding.
	 */
	private stopGeneration(
		generation: OwnedServe,
		isRestart: boolean,
	): Promise<void> {
		if (generation.stop) return generation.stop;
		generation.stop = (async () => {
			const waitForExit = (ms: number) =>
				new Promise<boolean>((resolve) => {
					if (generation.exited) {
						resolve(true);
						return;
					}
					const timer = setTimeout(() => {
						generation.timers.delete(timer);
						resolve(false);
					}, ms);
					generation.timers.add(timer);
					void generation.exit.then(() => {
						clearTimeout(timer);
						generation.timers.delete(timer);
						resolve(true);
					});
				});
			if (this.canSignal(generation)) generation.child.kill("SIGTERM");
			const grace = isRestart
				? this.shutdownTimeoutMs.restart
				: this.shutdownTimeoutMs.normal;
			if (!(await waitForExit(grace))) {
				if (this.canSignal(generation)) generation.child.kill("SIGKILL");
				if (!(await waitForExit(this.shutdownTimeoutMs.force))) {
					throw new Error(
						"Owned backend exit is unconfirmed; refusing replacement",
					);
				}
			}
			if (!isRestart && !this.ownedServe)
				this.startupMode = LocalOperatorStartupMode.NOT_STARTED;
			logger.info("Owned backend generation stopped", LogFileType.BACKEND);
		})();
		return generation.stop;
	}

	private stopHealthCheck(): void {
		if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
		this.healthCheckInterval = null;
	}

	/** Whether a quit may proceed. `will-quit` cannot await a listener, so it
	 * prevents the first quit, runs cleanup, and asks this on the retry. */
	/** Whether a shutdown is in flight.
	 *
	 * `stop(false)` is terminal and is what the quit path calls, so this is the
	 * state a caller checks before raising blocking UI it would never be able to
	 * dismiss - `index.ts`'s start-failure paths are the callers. */
	isShuttingDown(): boolean {
		return this.isAppClosing;
	}

	/**
	 * Report a start failure to the user - unless the app is on its way out.
	 *
	 * `showErrorBox` is a native modal: it parks the main thread until somebody
	 * dismisses it, and Electron cannot run the quit it was asked for past a
	 * parked thread. On the quit path that is not a message, it is a deadlock -
	 * the quit has already prevented itself, the owned cleanup it waits on can
	 * never finish, and the quit's own failsafe cannot even fire, because that is
	 * a timer on the thread the dialog holds (review round 4, Q-20: a SIGTERM
	 * during the first start left the app alive 50 s later with the failsafe line
	 * never logged). A shutdown in flight logs the failure instead, where the
	 * post-mortem finds it without the process still being up.
	 */
	private reportStartFailure(title: string, message: string): void {
		if (this.isAppClosing) {
			logger.error(
				`${title} (not shown; the app is shutting down): ${message}`,
				LogFileType.BACKEND,
			);
			return;
		}
		electronDialog.showErrorBox(title, message);
	}

	isOwnedCleanupComplete(): boolean {
		return this.isAppClosing && !this.ownedServe && !this.startPromise;
	}

	/** Synchronous exit cannot await cleanup. Canonical runtimes deliberately
	 * outlive their HTTP server, so neither PID rediscovery nor descent is safe. */
	emergencyStopOwned(): void {
		this.startEpoch++;
		this.isAppClosing = true;
		const generation = this.ownedServe;
		if (
			generation &&
			!generation.exited &&
			generation.child.exitCode === null &&
			generation.child.signalCode === null
		) {
			generation.child.kill("SIGKILL");
		}
	}

	/**
	 * Check if backend is healthy
	 * @returns Promise resolving to true if the backend is healthy, false otherwise
	 */
	async checkHealth(): Promise<boolean> {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000);

			const response = await fetch(`${this.backendUrl}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			logger.info(
				`Backend health check response status: ${response.status}`,
				LogFileType.BACKEND,
			);

			// An answer of ANY status proves the transport reached the daemon, so the
			// failure cause is cleared here and set only by the catch below.
			this.lastHealthFailure = null;
			return response.ok;
		} catch (error) {
			/*
			 * Remember WHY this failed, not just that it did. The caller above reports
			 * an unattached daemon from this boolean alone, and a refused socket is
			 * evidence of absence while an expired budget is not - so the cause has to
			 * survive the fold into a boolean rather than being re-guessed upstream.
			 */
			this.lastHealthFailure = classifyUnreachable(error);
			return false;
		}
	}

	/**
	 * What is answering the address this app is configured to serve on, if
	 * anything that stops it starting a daemon there.
	 *
	 * `null` means "start it": either the socket was refused (the one answer that
	 * proves a port free), or something answered 200 without identifying as a Local
	 * Operator daemon. The second arm is deliberate and narrow - see the spawn gate
	 * in `startOwned()` - and the observation is logged either way. An answer whose
	 * STATUS is not 200 is not in that arm: it is an occupant (review round 1,
	 * F-2), and it returns a `silent` occupancy below rather than a licence to
	 * spawn.
	 */
	private async configuredOriginOccupancy(
		address: string,
	): Promise<OriginOccupancy | null> {
		const probe = await probeUnidentified(address, {
			timeoutMs: PROBE_TIMEOUT_MS,
		});
		switch (probe.reason) {
			case "identity-mismatch":
				return {
					kind: "daemon",
					occupant: this.occupantOf(address, probe.identity ?? null),
					detail: probe.detail,
				};
			/*
			 * A status that is not 200 is an OCCUPANT, not a licence to spawn, and it
			 * is handled here rather than by the `default` arm below so the decision is
			 * the one a reader finds rather than the one the switch happens to fall
			 * into (review round 1, F-2). It covers a Local Operator daemon starting up,
			 * unhealthy or shutting down, and a proxy that fronts one and answers 5xx:
			 * in every one of them the socket is bound, so a child spawned onto it dies
			 * on `[Errno 48]` - after `mintDesktopToken()` has already overwritten the
			 * credential for the daemon actually serving there. The answer does not
			 * prove a daemon this app may attach to, so the gate declines to start one
			 * and keeps probing; that is the safe direction, because the failure mode of
			 * the other one is unrecoverable loss of the pairing token.
			 */
			case "unready-answer":
				return {
					kind: "silent",
					cause: "other",
					occupant: this.occupantOf(address, null),
					detail: probe.detail,
				};
			case "not-a-daemon":
				logger.info(
					`${address}${HEALTH_PATH} answered and is not a Local Operator daemon (${probe.detail}); starting a daemon anyway, as this app always has.`,
					LogFileType.BACKEND,
				);
				return null;
			case "unreachable":
				return probe.cause === "refused"
					? null
					: {
							kind: "silent",
							cause: probe.cause ?? "other",
							occupant: this.occupantOf(address, null),
							detail: probe.detail,
						};
			default:
				// Any other verdict is still an ANSWER, so the address is not free.
				return {
					kind: "silent",
					cause: "other",
					occupant: this.occupantOf(address, null),
					detail: probe.detail,
				};
		}
	}

	/**
	 * One address's holder, from the facts already in hand.
	 *
	 * WHERE EACH FACT COMES FROM, because the copy has to be able to say it. The
	 * occupant's own `/health` is asked first and is the only source that proves who
	 * holds the address; when it did not answer with an identity - a timeout, a
	 * non-200, a body with no `instance_id` - the LISTENING SOCKET is asked instead
	 * (`listenerPidsOn`), and `pidSource` carries which of the two produced the pid
	 * so the sentence reports a kernel fact as a kernel fact.
	 *
	 * The record lookup goes the other way round: it is keyed by the pid, so it adds
	 * `started_at` and the published install to whichever source named the holder.
	 * A holder that ALSO has a record in this app's own root is usually one of this
	 * app's own daemons from an earlier run, and that is worth saying out loud.
	 */
	private occupantOf(
		address: string,
		identity: HealthIdentity | null,
	): AddressOccupant {
		let pid =
			identity && Number.isInteger(identity.pid) && identity.pid > 0
				? identity.pid
				: null;
		let pidSource: AddressOccupant["pidSource"] =
			pid === null ? null : "answer";
		if (pid === null) {
			const port = portOf(address);
			const [found] = port === null ? [] : listenerPidsOn(port);
			if (found !== undefined) {
				pid = found;
				pidSource = "listener";
			}
		}
		const record = pid === null ? null : readRecordForPid(pid);
		return {
			address,
			pid,
			pidSource,
			version: identity?.version || record?.version || "",
			prefix: identity?.prefix || record?.prefix || "",
			installKind: identity?.installKind || record?.install_kind || "",
			startedAtMs: record ? record.started_at * 1000 : null,
			// Probe-side occupancy never carries this: `configuredOriginOccupancy` is
			// asked about an address the attach path did not just read, and inventing
			// a status here would be the same class of guess the record arm avoids.
			desktopReadStatus: null,
		};
	}

	/**
	 * The addresses this app may spawn a managed daemon on, best first.
	 *
	 * The configured address leads, so a fallback spawn does not make the app forget
	 * where it was told to serve: `backendUrl` rotates to wherever the app ended up,
	 * while this list is recomputed from the configuration on every attempt. The rest
	 * are the fallback budget, de-duplicated by `normaliseAddress` so a configuration
	 * that already names 8080 does not probe one address twice - and the de-dup reads
	 * through `canonicalHost`, so a configuration naming `localhost` is not probed a
	 * second time as `127.0.0.1` (review round 1, R1-6: this comment asserted that
	 * folding before `normaliseAddress` did it, which is how the assertion and the
	 * comparison could disagree without either looking wrong).
	 */
	private spawnAddresses(): string[] {
		const addresses = [this.configuredUrl, ...this.fallbackSpawnUrls];
		const seen = new Set<string>();
		const allowed: string[] = [];
		for (const address of addresses) {
			const normalised = normaliseAddress(address);
			if (!normalised || seen.has(normalised)) continue;
			if (portOf(normalised) === null) continue;
			seen.add(normalised);
			allowed.push(normalised);
		}
		return allowed;
	}

	/**
	 * Record where this attempt's daemon is going, relative to the address this app
	 * is configured for (design round 1, D1).
	 *
	 * WHY THE SNAPSHOT AND NOT ONLY THE LOG LINE. Measured on this change: serving on
	 * the fallback address was pixel-for-pixel invisible - the "attached on 8080" and
	 * "attached on 1111" frames of the whole surface hashed identically - and the
	 * operator's own question in that state had no in-product answer while they
	 * worked. What is recorded here is what the band renders.
	 *
	/**
	 * The first address this attempt may actually start a daemon on, and what the
	 * gate found on every address that refused.
	 *
	 * TWO GATES PER ADDRESS, and each answers a different question. The record gate
	 * (`addressHoldsLiveRecord`) is "does this app's own registry say a process holds
	 * this address": its subject is a pid, and it needs no network. The occupancy
	 * probe is "would a child of mine be able to bind this address", asked of the
	 * address itself - and it exists precisely because the two came apart on the
	 * operator's machine, where discovery had no record to work with, the app spawned
	 * onto a port a daemon was already serving, and the child died on `[Errno 48]`
	 * every ~10 s (see the comment at the call site).
	 *
	 * ORDER MATTERS and it is the record gate first: a live record for the address
	 * means the address is held by something whose pid we can already name, and
	 * probing it would only add an answer to a question already answered.
	 */
	private async resolveSpawnTarget(): Promise<{
		target: { address: string; port: number } | null;
		refusals: OriginOccupancy[];
	}> {
		const refusals: OriginOccupancy[] = [];
		for (const address of this.spawnAddresses()) {
			const port = portOf(address);
			if (port === null) continue;
			if (addressHoldsLiveRecord(address)) {
				const { unreadable, records } = addressHolders(address);
				/*
				 * AN UNREADABLE REGISTRY IS NOT A HOLDER (review round 1, R1-3). The gate is
				 * deliberately conservative - a directory it cannot read forbids a spawn on
				 * every address - but the REPORT may not inherit that conservatism: `records`
				 * is empty here, so the record arm's own sentence ("<address> is listed as
				 * still running in this app's own records") would name a process this app
				 * never read about, and the status would say a daemon is running on the
				 * strength of it. The refusal carries the fact that WAS established, and
				 * `observeSpawnRefusal` treats it as no holder for the same reason.
				 *
				 * The occupant is deliberately factless and is never rendered as a holder:
				 * `describeHolders` words this arm from the fact above instead, and asking
				 * `occupantOf` here would spend an `lsof` on a question with no owner.
				 */
				if (unreadable) {
					refusals.push({
						kind: "unreadable",
						occupant: {
							address,
							pid: null,
							pidSource: null,
							version: "",
							prefix: "",
							installKind: "",
							startedAtMs: null,
							desktopReadStatus: null,
						},
						detail:
							"this app's own records could not be read, so no address it may serve on could be called free",
					});
					continue;
				}
				const record = records[0] ?? null;
				// The desktop-read status, when this same sweep observed one: the record
				// arm refuses on the record alone, and "and it answered this app's read
				// with HTTP 503" is the evidence a reader needs to tell an unreadable
				// store from an install that never spoke.
				const observed =
					this.answeredButUnusable?.address === address
						? this.answeredButUnusable.status
						: null;
				refusals.push({
					kind: "record",
					occupant: {
						address,
						pid: record?.pid ?? null,
						// The record is this app's own file about its own child, so the pid
						// is this app's own answer rather than a socket's.
						pidSource: record ? "answer" : null,
						version: record?.version ?? "",
						prefix: record?.prefix ?? "",
						installKind: record?.install_kind ?? "",
						startedAtMs: record ? record.started_at * 1000 : null,
						desktopReadStatus: observed,
					},
					/*
					 * Not user-facing: the record arm is rendered by `HOLDER_CLASS.record`, which
					 * words the fact for a reader. This is the diagnostic beside it, for a log or
					 * a debugger, so it keeps the module's own nouns.
					 */
					detail: `a serve record names ${address} with a pid that is not proven dead`,
				});
				continue;
			}
			const occupancy = await this.configuredOriginOccupancy(address);
			if (!occupancy) return { target: { address, port }, refusals };
			refusals.push(occupancy);
			/*
			 * A SILENT occupant stops the search for somewhere else, and this is the
			 * deliberate boundary of the fallback.
			 *
			 * `silent` is "the address did not answer with anything this app could use":
			 * a probe that ran out its 2 s budget, a status that is not 200, a socket
			 * still closing. Those are exactly the answers OUR OWN daemon gives while it
			 * is busy on a turn, still importing, or shutting down - and starting a
			 * daemon somewhere else on one of them would strand it (it keeps the address)
			 * and rotate its credential away (the mint happens before the spawn), which is
			 * the cost the design accepted only for the case where the app can NAME the
			 * holder as a Local Operator daemon it holds no key to. A silent occupant is
			 * the shape the existing refuse-and-probe path was built for, and this keeps
			 * it: the app reports what it observed and keeps probing.
			 */
			if (occupancy.kind === "silent") return { target: null, refusals };
		}
		return { target: null, refusals };
	}

	/**
	 * Whether the last spawn attempt declined because an address this app may serve
	 * on is held by something it does not own, so the app has nowhere of its own to
	 * start a daemon.
	 *
	 * THIS IS THE ONE THING `index.ts` NEEDS FROM THIS CLASS, and it is the whole of
	 * the incident it answers: a `false` from `start()` used to mean "quit", and this
	 * class of false means the opposite - the app is fine, its address is taken, and
	 * waiting is what recovers it.
	 */
	isStartBlockedByOccupiedAddress(): boolean {
		return this.spawnRefusals !== null;
	}

	/**
	 * Publish what the spawn gate saw, in the vocabulary the copy already uses.
	 *
	 * Three outcomes reach here and each gets the state that names it: a Local
	 * Operator daemon this app may not drive is `unattachable` (state `wedged` - a
	 * server IS running and this app did not attach to it, no banner claiming it is
	 * offline), an address that did not answer in time is `unanswered` -
	 * `degraded`, usable, no banner, and still counted, because a budget that
	 * expired is not evidence of absence either way - and a registry this app could
	 * not read is `no-candidate`, which claims only that this app has no daemon of its
	 * own (review round 1, R1-3).
	 */
	private observeSpawnRefusal(refusals: OriginOccupancy[]): void {
		const detail = describeSpawnRefusal(refusals);
		/*
		 * WHICH OBSERVATION, and the three are not interchangeable. A holder that is a
		 * Local Operator daemon (or a record that says one is running) is
		 * `unattachable` - state `wedged`, "a server is running on this machine and
		 * this app is not attached to it" - so no surface renders it as offline. Only
		 * a set of addresses that answered NOTHING usable is `unanswered`, which is
		 * `degraded`: usable, and a probe's silence rather than an absent server. And
		 * an `unreadable` refusal is neither a holder nor a silence: it is the absence of
		 * facts about every address, so it falls through to `no-candidate`.
		 *
		 * The old copy stayed in one arm because there was only ever one address. With
		 * a fallback budget there can be both kinds at once, and then the daemon is the
		 * fact worth a banner: it is the one the operator can act on.
		 */
		const holder = refusals.find(
			(occupancy) => occupancy.kind === "daemon" || occupancy.kind === "record",
		);
		const silent = refusals.find(
			(occupancy): occupancy is SilentOccupancy => occupancy.kind === "silent",
		);
		this.daemonState.observe(
			holder
				? { kind: "unattachable", detail }
				: silent
					? { kind: "unanswered", cause: silent.cause, detail }
					: { kind: "no-candidate", detail },
		);
		logger.info(`Not spawning a daemon: ${detail}`, LogFileType.BACKEND);
		this.notifyStatus();
	}

	/**
	 * The token governing the daemon this app spawned in a PREVIOUS run, read from
	 * the 0600 file beside the app's other per-user state, or null.
	 *
	 * Read-only on purpose: a launch that has not spawned anything yet must not
	 * create a credential, or "this app holds no token" (a first run, and the
	 * honest reason to decline a daemon it cannot open) would become unreachable.
	 */
	private persistedDesktopToken(): string | null {
		try {
			const stored = fs.readFileSync(this.desktopTokenFile(), "utf8").trim();
			return stored || null;
		} catch {
			// Absent or unreadable: this is a first run as far as re-attaching goes.
			return null;
		}
	}

	/**
	 * Mint the token for a daemon this app is about to spawn, and persist it so the
	 * next launch can re-attach to that daemon instead of starting a second one.
	 *
	 * A token that cannot be written still governs this run's child - failing to
	 * start over a cache file would be the worse trade - and the log line names
	 * the cost, which is the stranded daemon next launch.
	 */
	private mintDesktopToken(): string {
		const token = randomBytes(32).toString("hex");
		try {
			const file = this.desktopTokenFile();
			fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
			fs.writeFileSync(file, token, { mode: 0o600 });
		} catch (error) {
			logger.warn(
				"Could not persist the desktop token; a daemon spawned now will not be re-attachable after a restart.",
				LogFileType.BACKEND,
				error,
			);
		}
		return token;
	}

	private desktopTokenPath: string | null = null;

	private desktopTokenFile(): string {
		if (this.desktopTokenPath === null) {
			this.desktopTokenPath = join(this.appDataPath, DESKTOP_TOKEN_FILENAME);
		}
		return this.desktopTokenPath;
	}

	/**
	 * One probe of the daemon this app is attached to.
	 *
	 * "Identified" means the answer came from the process we attached to, which
	 * is a strictly stronger question than "something answered 200". A 200 from a
	 * DIFFERENT process means the daemon was replaced under us or its port was
	 * taken, and that is a failure of the attachment, not a success.
	 *
	 * `/health` carries no authorization, so a gated route's 401/403/503 can
	 * never be read as a liveness answer here - which is the conflation this
	 * whole change is about. Those statuses surface through `requestDesktop`, and
	 * `DaemonStateMachine` records them BESIDE the state.
	 */
	private async probeAttachedDaemon(): Promise<ProbeObservation> {
		const expected = this.daemonState.expectedInstanceId();
		if (!expected) {
			// No identity to compare against (only reachable through the
			// deprecated pre-record path): a 200 is the most that can be known,
			// and it is reported as what it is.
			const ok = await this.checkHealth();
			if (ok) return { kind: "identified" };
			/*
			 * `checkHealth` cannot tell a refusal from an expired budget, so the cause it
			 * captured decides which of the three facts this observation is:
			 *
			 *   - nothing captured: the address ANSWERED, with a status this path does not
			 *     accept. A process is there and says it is not ready, which is an owned
			 *     child this app must replace, so it counts like a refusal;
			 *   - a refused socket: nothing is accepting on that port, which is evidence
			 *     of absence and may detach on the ordinary three misses;
			 *   - anything else (a budget that expired, an unknown throw): the address may
			 *     well be listening and busy, so it is counted as `unanswered` and needs
			 *     `UNANSWERED_BEFORE_DETACHED` of them.
			 */
			const failure = this.lastHealthFailure;
			return {
				kind:
					failure === null || failure === "refused" ? "failed" : "unanswered",
				cause: failure ?? "other",
				detail:
					failure === null
						? `${this.backendUrl}${HEALTH_PATH} answered a status this app does not accept`
						: `No answer from ${this.backendUrl}${HEALTH_PATH}`,
			};
		}
		const probe = await probeIdentity(this.backendUrl, expected, {
			timeoutMs: PROBE_TIMEOUT_MS,
		});
		/*
		 * THE ANSWERED VERDICT IS ALSO A PAIRING FACT, and recording it here is what
		 * makes the pairing record honest while the app is still `attached`.
		 *
		 * The state machine asks two questions of one answer and they are not the
		 * same question: is the connection ALIVE (any answer counts, and the
		 * transport answers that continuously), and does this app still hold a
		 * credential for what is answering (only the same process does). A daemon
		 * replaced under the app - a `lop` build swap is the ordinary cause - keeps
		 * answering `/health` and its public capability route while refusing every
		 * gated call, so an app that recorded pairing only when it attached reported
		 * a pairing that no longer existed for as long as the operator left it open
		 * (design § 1.4, measured on this machine 2026-09-18).
		 *
		 * Only an ANSWERED contradiction sets it, and only a matching answer clears
		 * it. `unreachable` settles nothing about the pairing - a socket that
		 * refused, or a budget that expired on a busy daemon, is a statement about
		 * the connection - so it is left alone rather than overwritten with a cause
		 * the app cannot prove.
		 */
		/*
		 * A RELOAD OF THE PROCESS THIS APP SPAWNED IS NOT A SUCCESSOR (2026-09-20).
		 *
		 * `lop-update` moving the daemon it serves in place is `os.execve`: the pid, the
		 * listener fd, the cwd and the environment all survive, and the ASGI lifespan
		 * re-runs - which MINTS A NEW `instance_id` and republishes the serve record under
		 * it (`server/app.py`, `server/reload.py`). Read as "a different process answered"
		 * that is a contradiction, and the app published the "server was replaced" band
		 * over a connection still authenticated to the very same process - for hours, with
		 * the band's Retry inert. Measured on the operator's machine 2026-09-20: app pid
		 * 1968's own child, pid 2082, moved v0.61.1 -> v0.61.4 in place twice, and every
		 * gated route on it kept answering 200.
		 *
		 * WHY THE SAME PID SETTLES IT, and why the app is the side that must yield.
		 * An identity is minted per PROCESS, so "my daemon reloaded" and "something else
		 * is answering" are told apart by the process, not by the id: `execve` cannot hand
		 * one pid to a second live process, and the pid that answers here is the one
		 * `spawn()` returned to this app. It is not merely a number read off a record -
		 * `this.process` is a live `ChildProcess` handle whose `pid` proves it belongs to
		 * the process this app started, so pid reuse cannot produce this shape: a reused
		 * pid means our child EXITED, and an exited handle fails the guard below -
		 * MODULO the window before Node RECORDS that exit, since `exitCode` and
		 * `signalCode` are set when the process event arrives rather than when the
		 * process dies, and a pid recycled inside that window would read as a live
		 * handle. Reaching it also needs the successor bound to this app's own port, so
		 * it is a residual race rather than a hole, and the recovery guard accepts the
		 * identical window (see `holdsLiveChildProcess`).
		 *
		 * THE PLANE, AND WHO OWNS THAT IT SURVIVES THE RELOAD. The environment this app
		 * spawned its child with is what governs the daemon's plane, and the reload path
		 * is what preserves it: `local_operator/server/reload.py` hands the listener fd
		 * across `os.execve(..., dict(os.environ))`, so `LOCAL_OPERATOR_DESKTOP_TOKEN` is
		 * the same token against the same process and the accepted bearer does not change
		 * either (the record republishes `desktop: true, claim_key: ""`, i.e.
		 * env-governed). That invariant is daemon-side and cannot be observed from here,
		 * which is why it is NAMED rather than assumed: a reload that rebuilt its
		 * environment instead of passing it through would leave this re-anchor adopting an
		 * identity on a plane this app is no longer admitted to.
		 *
		 * WHY THE DAEMON SIDE IS NOT THE FIX. Re-minting is that side's own contract for a
		 * landed reload: `lop services` confirms one by looking for a NEW `instance_id`
		 * under the SAME pid ("instance_id is the proof and the version is not: it is
		 * minted once per process", `services.py`). Pinning the id would break the
		 * handshake the operator's own tooling reads, so the false premise - "a new
		 * instance id means a new process" - is this app's to correct.
		 *
		 * WHAT DOES NOT CHANGE: a DIFFERENT pid is still a successor, a `not-a-daemon`
		 * answer is still not a daemon, and an unreachable socket is still a missing one -
		 * all three keep their current verdicts, as does the reload of a daemon this app
		 * did NOT spawn: with no child handle there is nothing to re-anchor to, so
		 * discovery and the claim handshake remain that case's recovery (A3 of
		 * `scripts/daemon-observation.test.mjs` pins it).
		 */
		const attachedPid = this.daemonState.snapshot().pid;
		const reanchored =
			probe.outcome === "identity-mismatch" &&
			attachedPid !== null &&
			probe.identity.pid === attachedPid &&
			this.holdsLiveChildProcess(attachedPid)
				? // Spread rather than field by field: this value IS `probe.identity` plus the
					// address. A field added to `DaemonIdentity` later must not have to be
					// remembered in this one literal, where it would silently take the widened
					// type's `undefined` instead of the answering value.
					{ ...probe.identity, url: this.backendUrl }
				: null;
		const answersThisApp =
			reanchored !== null ||
			(probe.outcome === "identified" &&
				probe.identity.pid === this.daemonState.snapshot().pid);
		const answeredAnotherProcess =
			reanchored === null &&
			(probe.outcome === "identity-mismatch" ||
				probe.outcome === "not-a-daemon" ||
				probe.outcome === "identified");
		if (answersThisApp) {
			this.daemonState.setPairing(DAEMON_PAIRED);
		} else if (answeredAnotherProcess) {
			this.daemonState.setPairing({
				available: false,
				cause: "successor",
			});
		}
		switch (probe.outcome) {
			case "identified":
				return probe.identity.pid === this.daemonState.snapshot().pid
					? { kind: "identified" }
					: {
							kind: "contradicted",
							detail:
								"The answering daemon's PID no longer matches the attachment.",
						};
			case "identity-mismatch":
				/*
				 * An ANSWERED contradiction, not a `failed` probe: the address answered and
				 * named a different process, which is what a daemon REPLACED under this app
				 * looks like (a `lop` build swap is the ordinary cause on a developer box).
				 * The successor refuses this app's credential until the app claims its
				 * plane, so those refusals arrive as answers too - and if they were allowed
				 * to excuse this observation, the count would never reach three and the app
				 * would never re-discover or re-claim (see `daemon-status.ts`).
				 *
				 * The exception above it is the OTHER cause of a changed `instance_id`: the
				 * same process, reloaded. It is checked before this arm so a reload cannot
				 * reach the contradiction at all.
				 */
				if (reanchored) {
					return {
						kind: "reanchored",
						identity: reanchored,
						detail: `Connected to the daemon on ${this.backendUrl} (pid ${reanchored.pid}, v${reanchored.version}). It reloaded in place and kept the same process.`,
					};
				}
				return {
					kind: "contradicted",
					detail: `Another process is answering at ${this.backendUrl} (${probe.detail})`,
				};
			case "not-a-daemon":
				return {
					kind: "contradicted",
					detail: `${this.backendUrl} answered but is not a Local Operator daemon (${probe.detail})`,
				};
			case "unreachable":
				/*
				 * THE fix for the operator's report, and the reason the cause is carried
				 * this far. A refused socket means nothing is accepting on the port - the
				 * daemon is gone, and three of those may detach. A budget that expired with
				 * no answer means the opposite: something is listening and was busy. One
				 * long agent turn was enough to produce three of those while every session
				 * read succeeded, and the app reported its server offline for it.
				 */
				return probe.cause === "refused"
					? {
							kind: "failed",
							detail: `${this.backendUrl} refused the connection (${probe.detail})`,
						}
					: {
							kind: "unanswered",
							cause: probe.cause,
							detail: `${this.backendUrl} did not answer (${probe.detail})`,
						};
		}
	}

	/**
	 * Start health check interval.
	 *
	 * 10 s rather than 30 s, because the loop is now cheap and non-destructive:
	 * it observes, and the state machine - not the clock - decides whether
	 * anything is done about what it saw. A single missed probe changes nothing
	 * at all.
	 */
	private startHealthCheck(): void {
		// Clear existing interval if any
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
		}

		// Start new interval
		this.healthCheckInterval = setInterval(() => {
			void this.checkBackendHealth();
		}, PROBE_INTERVAL_MS);
	}

	/**
	 * One watchdog tick: observe the daemon, then act only where the state
	 * machine says action is warranted.
	 *
	 * The previous loop restarted the backend on ONE failed 30 s sample - for a
	 * daemon that might have been mid-restart, busy with someone else's turn, or
	 * serving another app - and, for an external daemon, adopted it as "ours" and
	 * started a second one. Neither is possible here: `degraded` never starts
	 * anything, and {@link recoverFromDetachment} is reached only from the facts
	 * the state machine has already established - a `detached`/`wedged`
	 * connection, a pid its liveness probe read as gone (EVIDENCE, not a sample),
	 * and, since the 2026-09-21 change below, a pairing record that says the
	 * pairing is broken with a cause a sweep could repair, even while the
	 * connection still reads `attached`.
	 */
	private async checkBackendHealth(): Promise<void> {
		if (this.isAppClosing) return;

		// A child of ours whose pid is gone is EVIDENCE, not a timeout to
		// interpret: no probe is needed to learn something we already know.
		// The pid may belong to an EXTERNAL daemon this app discovered, so the
		// sentence names which one it was: reporting a discovered daemon as
		// "owned" tells the operator this app was managing it, which is exactly
		// the claim the no-replacement rules exist to make false.
		const snapshot = this.daemonState.snapshot();
		const pid = this.remoteConfigured
			? null
			: snapshot.pid || this.process?.pid;
		if (pid && pidLiveness(pid) === "dead") {
			logger.info(
				`${snapshot.owned ? "The backend this app started" : "The attached backend"} (pid ${pid}, ${snapshot.installKind ?? "unknown install"}) is gone; detaching immediately.`,
				LogFileType.BACKEND,
			);
			this.daemonState.observe({ kind: "pid-dead" });
			this.notifyStatus();
			await this.recoverFromDetachment();
			return;
		}

		if (
			this.daemonState.getState() === "detached" ||
			this.daemonState.getState() === "wedged"
		) {
			// Already without a usable daemon: this tick is a re-discovery, never a
			// restart of the daemon that was lost. `wedged` takes the same path for
			// the same reason - a record whose heartbeat stopped may resume, may die
			// (and then be reaped), or may be replaced by a daemon the operator
			// starts, and all three are found by looking, not by spawning.
			await this.recoverFromDetachment();
			// This `return` was a no-op where the call above was already the last
			// statement of the method; it is LOAD-BEARING now that the
			// broken-pairing block below follows. Remove it and a detached/wedged
			// tick would run BOTH recoveries - this one and the pairing one - in a
			// single tick.
			return;
		}

		const observation = await this.probeAttachedDaemon();
		const before = this.daemonState.snapshot();
		const next = this.daemonState.observe(observation);
		const after = this.daemonState.snapshot();
		// Push only a real change: a probe that found what the last probe found is
		// not news, and a status event per 10 s tick would be one IPC wake-up per
		// interval forever.
		if (after.state !== before.state || after.detail !== before.detail) {
			this.notifyStatus();
		}
		if (next === "detached") {
			logger.warn(
				`Backend detached: ${this.daemonState.snapshot().detail}`,
				LogFileType.BACKEND,
			);
			await this.recoverFromDetachment();
			return;
		}
		/*
		 * RE-DISCOVERY MUST BE REACHABLE WHEN MAIN ALREADY KNOWS THE PAIRING IS
		 * BROKEN, even while the connection still reads `attached` (design § 6.2).
		 *
		 * WHY the STATE is the wrong gate here, and the pairing record the right one.
		 * They answer different questions: a process can be answering this address -
		 * so the connection is `attached` and every probe ANSWERS - while it is no
		 * longer the process this app holds a credential for. That is exactly a `lop`
		 * build swap of an ADOPTED daemon: the reload republishes the record under a
		 * new `instance_id`, the probe answers `identity-mismatch` (an ANSWER, not a
		 * miss), one `contradicted` observation is folded per tick - and then this
		 * app's OWN admitted reads (the renderer's presence beat, a session list) run
		 * `recordTransportSuccess()`, which zeroes the count and revives `degraded` ->
		 * `attached`. The three CONSECUTIVE contradictions the state machine needs for
		 * `detached` are never reached, so `recoverFromDetachment` - the only path
		 * that re-discovers and re-pairs - was never entered, and the "server was
		 * replaced" band stood until the app was restarted. Measured on the operator's
		 * machine 2026-09-21: adopted daemon pid 1276 reloaded v0.61.18 -> v0.62.0 in
		 * place at ~20:08, the band sat until the manual Retry at 21:20:31, and the
		 * log held no "Backend detached:" line in that window at all.
		 *
		 * WHY THIS IS SAFE, and which guards make it so. `recoverFromDetachment`
		 * re-probes first and then re-discovers, and the two facts that keep that to
		 * a RE-DISCOVERY rather than a replacement are its OWN guards, named here
		 * rather than assumed: (1) the owned-child guard - `this.process` live
		 * (`exitCode === null && signalCode == null`) returns before
		 * `discoverAndAttach()` and therefore before any spawn - and (2)
		 * `isExternalBackend`, set on every adoption path, which returns before
		 * `start({ quiet: true })` for a daemon this app is attached to but did not
		 * spawn. So the operator's reported shape cannot be spawned over, and the
		 * hazard the owned-child guard prevents - a discovery that answers `false`
		 * and falls through to `start()` - is untouched.
		 *
		 * THE RESIDUAL, named so the paragraph above is not read as a guarantee the
		 * code does not make: an app holding NO identity at all (it never attached)
		 * with a remedy-bearing cause reaches NEITHER guard - `this.process` is null
		 * and `isExternalBackend` is false - so that one shape can reach
		 * `start({ quiet: true })`, gated only by `startOwned`'s own occupancy probe
		 * against the configured origin. It is not a spawn over a live process: a
		 * port a daemon is already answering makes that probe decline, and a stale
		 * record's own aging path is what retires the record.
		 *
		 * WHY `pairingHasRemedy` and not `!available`. A cause with no remedy this app
		 * may offer (`governed-elsewhere`: a second claim is refused by contract;
		 * `pre-handshake`: the claim route does not exist) would make every tick run a
		 * sweep that can only fail, so it is excluded here the same way the banner
		 * withholds its Retry for it. Recovery is paced by the reattach backoff for a
		 * broken-with-remedy pairing whether or not an identity is held
		 * (`pairingBreaksPacing`), so a pairing that cannot yet be repaired retries
		 * on that cadence rather than on every tick - while the FIRST attempt still
		 * runs on the tick the break is first seen, which is what this block is for.
		 */
		const pairing = this.daemonState.snapshot().pairing;
		if (!pairing.available && pairingHasRemedy(pairing.cause)) {
			await this.recoverFromDetachment();
		}
	}

	/**
	 * Re-discover NOW, on the renderer's request, and answer with the snapshot.
	 *
	 * The connectivity banner's Retry needs this. Recovery is paced by
	 * `nextRecoveryAt`, so once the liveness signal moved to MAIN a renderer that
	 * only re-read the snapshot could not cause an attempt the timer was not
	 * already going to make - an inert control in the one state that offers it.
	 * This clears the pacing for this attempt (a user asking IS the reason to try
	 * now) and runs the same recovery path the timer runs, so the two cannot
	 * drift apart about what trying means.
	 *
	 * @returns the snapshot as it stands when the attempt has finished, so the
	 * caller renders what main observed rather than what it hoped for
	 */
	async reconnectNow(): Promise<DaemonStatusSnapshot> {
		this.nextRecoveryAt = 0;
		await this.recoverFromDetachment();
		return this.getStatusSnapshot();
	}

	/**
	 * Whether a broken pairing main knows about is one a sweep could repair, and
	 * is therefore a subject for the reattach backoff.
	 *
	 * WHY the pacing needs this second clause at all. The identity gate above is
	 * `expectedInstanceId() !== null`, and the pairing record can be broken while
	 * NO identity is held: `attachIfUsable`'s wrong-key arm (and its refused arm)
	 * records the cause and returns WITHOUT attaching, so the old gate has nothing
	 * to pace against. That state IS reachable in production, because
	 * `checkExistingBackend()` drives that pass and a later `start()` calls
	 * `discoverAndAttach()` again before it spawns, so the loop can be armed with
	 * the app `connecting` and a cause already recorded. Without this clause such
	 * a pairing would re-probe, sweep discovery and re-claim on every 10 s tick.
	 *
	 * THE EXCLUSION: `unpaired` is the control flow's own initial value - "the
	 * cause is not yet established" (design § 2, S5) - and not an observation that
	 * a pairing broke. It is what `attachIfUsable` records while the app is
	 * `connecting` and has not attached yet, which is a FIRST RUN rather than a
	 * break, so a first run with no daemon at all stays unpaced; every cause a
	 * pass actually observed is paced.
	 */
	private pairingBreaksPacing(): boolean {
		const pairing = this.daemonState.snapshot().pairing;
		return (
			!pairing.available &&
			pairing.cause !== null &&
			pairing.cause !== "unpaired" &&
			pairingHasRemedy(pairing.cause)
		);
	}

	/**
	 * Recover from a lost daemon - by RE-DISCOVERING, and only then by starting
	 * one.
	 *
	 * The order is the whole safety property: a daemon that a TUI (or a previous
	 * app run) owns may still be there on a port this app has not looked at yet,
	 * and starting a second one because the first did not answer would leave two
	 * servers writing one transcript. An external daemon is never restarted or
	 * replaced at all: if it is gone, the app says so.
	 */
	private async recoverFromDetachment(): Promise<void> {
		if (this.isAppClosing || this.isAutoUpdating || this.recoveryInFlight)
			return;
		// Backoff applies to a daemon we HAD (re-attaching to a specific daemon
		// on a specific address is the case worth pacing), and to a pairing main
		// already knows is broken with a cause a sweep could repair even when no
		// identity is held (`pairingBreaksPacing`) - the wrong-key `successor`
		// shape, where the record names a process that is gone and the pairing can
		// only be repaired once that record ages out, would otherwise be a full
		// sweep every 10 s tick. With no daemon at all AND no cause yet
		// established, a tick is one directory read plus a couple of loopback
		// probes, and discovering one the operator starts a minute later is the
		// entire point. The FIRST attempt is immediate either way: `nextRecoveryAt`
		// starts at 0 and is advanced only by a real attempt, below.
		if (
			this.daemonState.expectedInstanceId() !== null ||
			this.pairingBreaksPacing()
		) {
			const now = Date.now();
			if (now < this.nextRecoveryAt) return;
			// Advance only on a real attempt, not each skipped timer tick.
			this.nextRecoveryAt = now + this.daemonState.nextBackoff();
		}
		if (this.daemonState.isReportablyGone()) {
			// Named with the record that described it: "the daemon my TUI started
			// is gone" is diagnosable only if the log says which record was
			// behind the attachment.
			logger.info(
				`No daemon at ${this.backendUrl} for over ${DETACHED_AFTER_MS / 1000}s${this.attachedRecord ? ` (its record was ${this.attachedRecord.file})` : ""}; reporting it as stopped rather than reconnecting.`,
				LogFileType.BACKEND,
			);
		}
		this.recoveryInFlight = true;
		try {
			// Recover the selected daemon first. Re-discovery must not silently switch
			// installs during a transient outage, especially with an active turn.
			if (this.daemonState.expectedInstanceId()) {
				const observation = await this.probeAttachedDaemon();
				/*
				 * `reanchored` is folded on the SAME arm as `identified`, and for the same
				 * reason: both are the app's own process answering, so both are the
				 * connection this app already had rather than a lost one. Recovery is the
				 * banner's Retry (`reconnectNow()`), and a verdict it dropped here would
				 * leave the Retry answering with the stale snapshot it was asked to
				 * refresh - which is precisely what the reported defect did: it reached
				 * neither this arm nor the discovery below it (the owned-child guard
				 * would have returned), so only an app restart cleared the band.
				 */
				if (
					observation.kind === "identified" ||
					observation.kind === "reanchored"
				) {
					this.daemonState.observe(observation);
					this.nextRecoveryAt = 0;
					this.notifyStatus();
					this.notifyBackendReady();
					return;
				}
				/*
				 * WHAT the probe found is folded into the state on EVERY branch, not only
				 * on `identified`.
				 *
				 * Recovery is the only path a renderer can trigger (`reconnectNow()`,
				 * the banner's Retry), and it is the only path that can correct a stale
				 * attachment when nothing ticks: dropping a `failed`/`pid-dead` verdict
				 * here left the machine on `attached` while the probe had just answered
				 * that the daemon was gone, so `reconnectNow()` returned the same stale
				 * pid and detail it was asked to refresh - a Retry that could not retry,
				 * and a status claiming a dead daemon was connected (QA round 3, Q-2).
				 *
				 * A pid that is gone is EVIDENCE rather than a timeout to interpret, and
				 * is recorded as such - the same rule `checkBackendHealth` applies before
				 * it comes here, which is why the two cannot disagree about what a dead
				 * process means.
				 */
				const selectedPid = this.daemonState.snapshot().pid;
				const processGone =
					selectedPid !== null && pidLiveness(selectedPid) === "dead";
				const before = this.daemonState.snapshot();
				this.daemonState.observe(
					processGone ? { kind: "pid-dead" } : observation,
				);
				const after = this.daemonState.snapshot();
				// The same push discipline the tick uses: a probe that found what the
				// last one found is not news.
				if (after.state !== before.state || after.detail !== before.detail) {
					this.notifyStatus();
				}
				// A process that is still there is not ours to replace on a failed
				// probe: paced and retried, never spawned over.
				//
				// A CONTRADICTION is the exception, and it is what the exception is
				// for. The pid is alive, and it is still the process this app attached
				// to - but it is demonstrably no longer the process ANSWERING this
				// address, which is exactly what a `lop` build swap leaves behind: a
				// successor holding the port while the process it replaced is still
				// winding down. Discovery is the half that recovers from that, and it
				// is a CLAIM on the successor the operator's own tooling started, not a
				// spawn - spawning stays behind every guard below (`isExternalBackend`
				// for an adopted daemon, and the owned-child guard), and this app may
				// not replace a live process it did not start. Measured on the
				// 2026-09-18 report: without this, an app that correctly detached on
				// three answered contradictions still could not re-pair while the
				// replaced process lingered, so the operator's only route back was the
				// restart the banner asked for.
				//
				// WHERE this exception sits is load-bearing: it is ABOVE the live
				// owned-child guard directly below, and that guard still returns before
				// `discoverAndAttach()`. So an app-OWNED child - a daemon this app
				// SPAWNED - does NOT recover this way, and is not meant to: an owned
				// child is governed by the environment this app spawned it with, so a
				// successor contradicting its own record is not the reported shape
				// there (that one is an adopted daemon, which does recover). Loosening
				// the guard to let discovery run first would let `discoverAndAttach()`
				// answer `false` and fall through to `start({ quiet: true })` below - a
				// second daemon spawned over a live child, which is the one outcome
				// that guard exists to prevent.
				//
				// THE OWNED CASE THAT WAS STUCK IS NOT REACHED FROM HERE FOR ONE SHAPE OF
				// CONTRADICTION, and only one: where the SAME process answers under a new
				// `instance_id`, `probeAttachedDaemon` re-anchors instead of contradicting,
				// so it never arrives here as a `contradicted` observation at all (measured
				// from the operator's machine, 2026-09-20: `lop-update` reloaded this app's
				// own child in place, the app published `pairing: successor` over it and the
				// Retry was inert until the app was restarted).
				//
				// THE RESIDUE IS REAL AND DELIBERATE. A live owned child can STILL arrive
				// here as `contradicted` - it answers `not-a-daemon`, or it names a different
				// pid - and this guard returns before `discoverAndAttach()`, so the Retry is
				// inert for that shape too and only a restart clears it. That is not this
				// change's to alter: the guard exists because discovery can answer `false`
				// and fall through to `start({ quiet: true })`, spawning a second daemon over
				// a live child, and an owned child's contradictory answer is not proof that
				// the process is gone. Pinned as a case in
				// `scripts/daemon-observation.test.mjs` ("the residue: an owned child that
				// answers as a non-daemon still reaches the guard, and the Retry cannot
				// clear it").
				if (!processGone && observation.kind !== "contradicted") return;
			}
			// A live owned ChildProcess (including a legacy daemon without records)
			// is not ours to kill just because HTTP timed out.
			if (
				this.process &&
				this.process.exitCode === null &&
				this.process.signalCode == null
			)
				return;
			if (await this.discoverAndAttach()) return;
			/*
			 * `discoveryBlocksSpawn` is deliberately NOT a term here (2026-09-23). It is
			 * discovery's verdict scoped to the configured address, and refusing on it
			 * vetoed the recovery spawn on the FALLBACK address in exactly the incident
			 * this change exists for: a live record naming the configured address, which
			 * this app may not attach to, was enough to stop the app ever getting a
			 * daemon of its own. The term is subsumed by `startOwned`'s own resolution,
			 * which asks that question per address and refuses each held one - so a
			 * spawn over a live daemon remains impossible, without one address's record
			 * silencing every other address.
			 */
			if (
				!this.managerMaySpawn ||
				this.remoteConfigured ||
				this.isExternalBackend
			)
				return;
			await this.start({ quiet: true });
		} finally {
			this.recoveryInFlight = false;
		}
	}
	/**
	 * Get the port number used by the backend service
	 * @returns The port number
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * The pid of the process this app SPAWNED, or null.
	 *
	 * The one way any caller may learn what this app is allowed to signal. It is
	 * deliberately not "the backend's pid": an attached daemon has a pid too, and
	 * it is not this app's to kill - the invariant is `owned <-> this.process`.
	 *
	 * Used by the quit path's last-resort handler, which must be synchronous and
	 * therefore cannot go through `stop()`.
	 */
	getOwnedPid(): number | null {
		return this.process?.pid ?? null;
	}

	/**
	 * Whether `pid` is the process this app spawned and that process is still live.
	 *
	 * The three clauses are one statement - "this is my child, and it has not
	 * exited" - and each is load-bearing:
	 *
	 *  - the handle is the proof of identity. A `ChildProcess` is only ever built by
	 *    this manager's own `spawn()`, so its `pid` cannot be a number read off a
	 *    record that something else wrote, and it cannot be recycled: the OS does not
	 *    reuse a pid while the process it names is alive, and a reused one means THIS
	 *    child exited - which the `exitCode` clause reads. That reading is Node's
	 *    RECORDED exit, set when the process event arrives rather than when the process
	 *    dies, so a pid recycled inside the window before it is recorded would pass
	 *    here. It is the same window the recovery guard accepts, and the caller that
	 *    matters (the reload re-anchor) needs the answering pid to be bound to this
	 *    app's own port as well, which is why this is stated rather than hedged.
	 *  - `exitCode === null && signalCode == null` is the same liveness spelling
	 *    `stop()` and the recovery guard act on (see `ownedPid`'s note), so a process
	 *    this app has already reaped is never treated as live by one caller and dead
	 *    by another;
	 *  - a `null` pid is not a match. A manager that has never spawned anything owns
	 *    nothing, and `undefined === undefined` must not read as ownership.
	 *
	 * Used by the reload re-anchor in `probeAttachedDaemon`, which is the one place
	 * this app decides that a changed `instance_id` belongs to the process it
	 * already holds rather than to a successor.
	 */
	private holdsLiveChildProcess(pid: number | null): boolean {
		return (
			pid !== null &&
			this.process !== null &&
			this.process.pid === pid &&
			this.process.exitCode === null &&
			this.process.signalCode == null
		);
	}

	/**
	 * The install SERVING this app, read from the serving process's own record.
	 *
	 * WHAT THIS IS NOT, and the mistake it exists to prevent: the `version` of a
	 * `/health` payload or of a status snapshot is what the daemon computes from the
	 * metadata installed ON DISK when it answers, so a process running old code out
	 * of memory reports the NEWER version and the skew disappears exactly when a
	 * reader needs to see it. The serve record (`server/registry.py`) is written
	 * once at process start and never re-read, so its `version` is the build the
	 * running process actually loaded, and its fields beside it (`prefix`,
	 * `install_kind`, and the claim handshake's own `desktop`/`claim_key` pair) are
	 * what the drift decision resolves WHICH INSTALL and WHOSE PROCESS against.
	 *
	 * Two arms, because the record is reached two ways: a daemon discovery ADOPTED
	 * keeps its parsed record on this manager, while one this app SPAWNED is keyed
	 * by its own pid in the record directory. Both are the same document.
	 *
	 * A missing record, a torn read and a record that carries no version (an install
	 * predating the field) are all absences - reported by the decision, never
	 * papered over by a reading that cannot see a stale process.
	 *
	 * NOTHING HERE ANSWERS "MAY THE APP MOVE IT": that is `owned`, and it is asked of
	 * the generation this process holds rather than of the record, because a record is
	 * something the app can read about any daemon on the machine and a restart is only
	 * legal for one it holds (QA round 1, Q1). `readings.prefix` and the ownership
	 * rule's own environment roots are still read here, because the refusal sentence
	 * turns on them - see `ServingOwnership.startedByEarlierAppRun`.
	 */
	servingInstall(): {
		readings: ServingInstallReadings;
		owned: ServingOwnership;
	} {
		const readings = servingInstallReadings(this.servingRecord());
		return {
			readings,
			owned: servingInstallIsAppOwned({
				/*
				 * "Does this app run HOLD the process" - the exact question `stop()` acts
				 * on, and therefore the exact ground the drift repair may fire on. A
				 * looser answer is what QA's Q1 caught: the record- and
				 * environment-derived grounds read as permission while `restart()` had
				 * nothing to stop, so the app logged a restart it never performed.
				 */
				spawnedByThisProcess: this.holdsServingGeneration(),
				readings,
				managedEnvironmentRoots: this.managedEnvironmentRoots(),
			}),
		};
	}

	/**
	 * Whether this manager holds a serve generation, i.e. a process `stop()` can end.
	 *
	 * Deliberately not `getOwnedPid() !== null`: that answers "which pid do I hold",
	 * which is the quit path's question, while this answers "is there a generation here
	 * to terminate". `stop()` acts on `ownedServe` (a generation whose spawn failed has
	 * one and may have no pid yet), so this is the invariant the drift repair is
	 * asking about, and anything else - an adopted daemon, a record read from the run
	 * directory - is a process this app can READ but not MOVE.
	 */
	holdsServingGeneration(): boolean {
		return this.ownedServe !== null;
	}

	/**
	 * The record of the daemon serving this app, from the arm that reaches it.
	 *
	 * `null` for a daemon with no record at all - a legacy fixed-port adoption, or
	 * a build that predates the record format. The caller reports that absence
	 * rather than substituting another reading for it.
	 *
	 * THE GENERATION THIS APP HOLDS WINS (review round 2, T2). The adopted record was
	 * returned first unconditionally, so a manager that had adopted a daemon and then
	 * spawned its own would read every drift reading off the OLDER process's record -
	 * a phantom skew against a process that is not serving, and the successor re-read
	 * from the same document afterwards. A pid is only ever read for a generation this
	 * process holds (`this.process`), which is the same invariant `stop()` acts on, so
	 * the two arms cannot be confused: while a generation is held, its own record is
	 * the answer even when that read fails or is not written yet - an absence the
	 * decision reports as `no-boot-reading` rather than papering over with another
	 * process's numbers.
	 */
	private servingRecord(): ServeRecord | null {
		if (this.process)
			return serveRecord(this.process.pid ?? null, serveRunDir());
		return this.attachedRecord?.record ?? null;
	}

	/**
	 * The directories a daemon this app started can have booted from.
	 *
	 * The one part of the ownership question that is a fact about this instance
	 * rather than about the record, so it lives with the layout it names
	 * (`venv-paths.ts`) and is passed in. Empty on a platform whose managed
	 * environment that module does not claim - the record's own answer and this
	 * app's own child still answer there.
	 */
	private managedEnvironmentRoots(): string[] {
		return managedEnvironmentRoots({
			platform: process.platform,
			home: app.getPath("home"),
			packaged: app.isPackaged,
			venvPath: this.venvPath,
		});
	}

	/**
	 * Whether the renderer holds any session stream open right now.
	 *
	 * A COUNT OF VIEWS, not of turns: a mounted chat keeps its subscription while
	 * it sits idle, and a turn in a conversation nobody has open sends nothing. It
	 * is therefore a courtesy signal for the drift restart - "somebody is looking,
	 * wait a cycle" - and never the safety gate; the daemon's own work state is
	 * (`servingWorkState`).
	 */
	hasOpenSessionStreams(): boolean {
		return (this.streamRelay?.openStreamCount() ?? 0) > 0;
	}

	/**
	 * Whether the daemon serving this app is running a turn, from its own roster.
	 *
	 * WHY THIS IS ASKED OF THE DAEMON: main has no turn-in-flight signal of its own,
	 * and a restart is `stop(true)` - SIGTERM, ten seconds, SIGKILL - which the
	 * daemon's own `retire.py` refuses precisely because its shutdown cancels work
	 * it owns. The roster's `live_state` is the daemon's own answer about a running
	 * turn (`servingWorkStateFromSessions` states the signal and its limits).
	 *
	 * A transport that does not answer, and a non-200, are both `unknown` - which
	 * the decision treats as a reason to WAIT. A read that could not be taken is
	 * not evidence that the machine is quiet.
	 *
	 * A LISTING whose own liveness read failed is `unknown` for the same reason and
	 * by the same route: `fleetRosterFromSessions` declines a degraded roster and
	 * answers null, which this reduces to `unknown` (review round 1, B1 = QA Q-1).
	 */
	async servingWorkState(): Promise<ServingWorkState> {
		try {
			const response = await this.requestDesktop({
				op: "sessions.list",
				// The route's own maximum: a busy turn the reader cannot see in the
				// first page is still work in flight, so the read asks for the lot.
				limit: 500,
			});
			this.noteFleetReadAnswer(response.status);
			if (response.status !== 200) return "unknown";
			return servingWorkStateFromSessions(response.body);
		} catch {
			this.fleetReadFailure = "unreachable";
			return "unknown";
		}
	}

	/**
	 * Record what a `sessions.list` answer says about the app's own access.
	 *
	 * 401/403 is the one non-200 that is about the CREDENTIAL rather than about the
	 * fleet: the server is up and answering, and it is refusing this app's token.
	 * Everything else - another status, or no answer at all - is `unreachable`,
	 * which is the arm whose remedy (try again once the server answers) is true.
	 */
	private noteFleetReadAnswer(status: number): void {
		this.fleetReadFailure =
			status === 401 || status === 403 ? "refused-credentials" : "unreachable";
	}

	/**
	 * Why the last fleet read could not be taken: `servingWorkState`'s own reason.
	 *
	 * Read by the update path only when a refusal is being composed, and only on
	 * the `unknown` arm - see `FleetDrainOutcome.credentialsRefused`.
	 */
	fleetReadFailureReason(): "unreachable" | "refused-credentials" {
		return this.fleetReadFailure;
	}

	/**
	 * The session roster itself: the same read as `servingWorkState`, with the
	 * rows kept rather than reduced to one verdict.
	 *
	 * The update path's fleet gate needs the rows for two jobs a verdict cannot
	 * do: naming the sessions it waited for in a refusal, and taking the before
	 * and after snapshots that tell it which runtimes a restart displaced
	 * (`backend/fleet-drain.ts`). Both callers read ONE route, and the row shape
	 * and the busy spelling come from the same module, so there is no second
	 * reading of what "busy" means.
	 *
	 * Null rather than an empty array when the route did not answer: an empty
	 * roster is a machine with no sessions, which is a different fact from a read
	 * that could not be taken.
	 */
	async servingSessionFleet(): Promise<FleetRosterRow[] | null> {
		try {
			const response = await this.requestDesktop({
				op: "sessions.list",
				limit: 500,
			});
			this.noteFleetReadAnswer(response.status);
			if (response.status !== 200) return null;
			return fleetRosterFromSessions(response.body);
		} catch {
			this.fleetReadFailure = "unreachable";
			return null;
		}
	}

	/**
	 * The address this app is talking to RIGHT NOW.
	 *
	 * Not the configured target: `attachTo` rotates `backendUrl` onto the daemon
	 * discovery adopted, and everything that queries the backend resolves against
	 * it at call time. A consumer that instead read the configured URL described a
	 * daemon the app is not talking to - the update service's `/health` read did
	 * exactly that, so for an adopted daemon every version read failed and the
	 * panel could neither name the build being served nor report the skew after an
	 * install moved (QA Q-2, UX U1).
	 */
	getBackendUrl(): string {
		return this.backendUrl;
	}

	/**
	 * Check if the backend service is using an external backend
	 * @returns True if using an external backend, false if we started our own
	 */
	isUsingExternalBackend(): boolean {
		return this.isExternalBackend;
	}

	/**
	 * Get the startup mode of the Local Operator server
	 * @returns The current startup mode
	 */
	getStartupMode(): LocalOperatorStartupMode {
		return this.startupMode;
	}

	/**
	 * Get the virtual environment path used by the backend service
	 * @returns The path to the virtual environment
	 */
	getVenvPath(): string {
		return this.venvPath;
	}

	/**
	 * Check if the backend service is auto-updating
	 * @returns True if auto-updating, false otherwise
	 */
	checkIsAutoUpdating(): boolean {
		return this.isAutoUpdating;
	}

	/**
	 * Set the auto-updating flag
	 * @param isAutoUpdating True if auto-updating, false otherwise
	 */
	setAutoUpdating(isAutoUpdating: boolean): void {
		this.isAutoUpdating = isAutoUpdating;
	}

	/**
	 * Restart the backend service
	 * This method properly handles the restart process to ensure that any pending
	 * timeouts from the stop operation don't affect the newly started process
	 * @returns Promise resolving to true if the restart was successful, false otherwise
	 */
	restart(): Promise<boolean> {
		if (this.restartPromise) return this.restartPromise;
		this.restartPromise = (async () => {
			try {
				await this.stop(true);
				if (this.isAppClosing) return false;
				return await this.start();
			} catch (error) {
				logger.error("Backend restart refused", LogFileType.BACKEND, error);
				return false;
			}
		})().finally(() => {
			this.restartPromise = null;
		});
		return this.restartPromise;
	}
}

/**
 * Helper function to show error dialog
 * @param title Dialog title
 * @param message Dialog message
 */
export function showErrorDialog(title: string, message: string): void {
	electronDialog.showErrorBox(title, message);
}
