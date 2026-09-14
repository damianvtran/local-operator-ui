/**
 * Daemon discovery: find the `lop serve` daemon this app should talk to.
 *
 * WHY this module exists. The app used to answer "is a backend running?" by
 * probing ONE fixed URL for `/health` and accepting any 200. On the machine
 * this was written against, three daemons were live at once - `:1111` (the
 * app's bundled venv), `:7341` (the global uv tool, its TUI gone) and `:8080`
 * (a dev server eleven releases behind) - and every one of them answered 200,
 * so "the backend" was whichever one the probe happened to reach. A 200 is not
 * identification: it says a process is listening, not that it is the daemon we
 * meant, and not that it is even a local-operator daemon.
 *
 * The backend publishes a rendezvous record per serving process at
 * `<config root>/run/serve/<pid>.json` (0600 in a 0700 directory) carrying the
 * address it actually bound, an `instance_id` minted at startup, and the
 * identity of the INSTALL (`prefix`, `install_kind`, `version`, `source_ref`).
 * `/health` reports that same `instance_id`. So a candidate is admitted only
 * when all three agree: a record exists, its pid is alive, and the process
 * answering at the record's address proves it is that same process.
 *
 * That identity test is also what makes `--port 0` daemons findable at all -
 * the record names the port the kernel gave them - and what lets a later probe
 * tell "the daemon I attached to is still there" from "a different process
 * took its port".
 *
 * This module is deliberately Electron-free: everything in it is
 * file-system, process and HTTP work, so the ranking and validation rules can
 * be exercised by the node-runner tests against real loopback daemons (see
 * `scripts/daemon-discovery.test.mjs`). The caller supplies its own logging
 * sink for the same reason.
 */

import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

/** Record namespace under the config root (`session/runtime/types.py`). */
export const SERVE_RUN_DIRNAME = "run/serve";

/** The override `local_operator/paths.py::config_dir` treats as authoritative. */
export const CONFIG_DIR_ENV = "LOCAL_OPERATOR_CONFIG_DIR";

/** Default config root when no override is set: `paths.py::DEFAULT_CONFIG_DIRNAME`. */
export const DEFAULT_CONFIG_DIRNAME = ".local-operator";

/** How often the backend rewrites its record (`HEARTBEAT_INTERVAL_S`). */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Past this age a record is `wedged`: live pid, stopped heartbeat. */
export const HEARTBEAT_TIMEOUT_MS = 45_000;

/** One identity probe's budget. Short on purpose: it runs on a timer. */
export const PROBE_TIMEOUT_MS = 2_000;

/**
 * How long a freshly spawned daemon gets to publish its own record.
 *
 * Only the child's own record carries the port an ephemeral bind got, so this is
 * the window in which a `--port 0` spawn becomes dialable. Four seconds is a
 * cold Python start on this codebase (the record is published with the
 * listener, before the app serves anything), and expiring early is benign: the
 * caller respawns on the configured port, which is where installs predating the
 * record format are reachable anyway.
 */
export const OWNED_RECORD_WINDOW_MS = 4_000;

/**
 * A `started_at` this far ahead of us is clock skew, not a daemon that booted
 * in the future; the record is ignored rather than trusted for ordering.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * The desktop claim route and the capability route (`server/routes/`).
 *
 * Declared here rather than inline so the two probes that must never be
 * confused - identity and capability - cannot drift apart.
 */
export const HEALTH_PATH = "/health";
export const CAPABILITIES_PATH = "/v1/capabilities";
export const CLAIM_PATH = "/v1/desktop/claim";

/**
 * A published serve record, as written by `server/registry.py`.
 *
 * Fields beyond the ones this module reads are preserved untouched: the record
 * is a forward-compatible document (an older reader must accept a newer
 * writer's additions), so parsing never drops or rewrites one.
 */
export interface ServeRecord {
	pid: number;
	host: string;
	port: number;
	instance_id: string;
	version: string;
	source_ref: string;
	prefix: string;
	install_kind: string;
	desktop: boolean;
	claim_key: string;
	started_at: number;
	heartbeat_at: number;
	retiring_from?: string | null;
	retiring_to?: string | null;
}

/** One file in the record directory: parsed, or named as a problem. */
export interface RecordFile {
	file: string;
	record: ServeRecord | null;
	/** Set when `record` is null: why the file could not be used. */
	problem?: RecordProblem;
}

export type RecordProblem = "unreadable" | "unparseable" | "malformed";

/** `live` is a daemon worth talking to; the other two are not. */
export type RecordHealth = "live" | "wedged" | "stale";

/** Result of the signal-0 check, mirroring `registry.py::pid_alive`. */
export type PidLiveness = "alive" | "dead";

export interface DiscoveredDaemon {
	/** Dialable base URL built from the record's own host and port. */
	address: string;
	record: ServeRecord;
	file: string;
	health: RecordHealth;
	/**
	 * `configured` marks a candidate whose address is the one
	 * `VITE_LOCAL_OPERATOR_API_URL` names. Such a candidate ranks LAST: the
	 * variable is a pin, not an admission, and it must never outrank a daemon
	 * the app found on its own.
	 */
	source: "record" | "configured";
	/** Identity as the answering process reported it, not as the record claims. */
	identity: HealthIdentity;
}

export interface HealthIdentity {
	instanceId: string;
	pid: number;
	version: string;
	prefix: string;
	installKind: string;
}

export type RejectionReason =
	| "unreadable-record"
	| "unparseable-record"
	| "malformed-record"
	| "clock-skew"
	| "pid-dead"
	| "wedged"
	| "undialable-address"
	| "unreachable"
	| "identity-mismatch"
	| "not-a-daemon";

export interface DiscoveryRejection {
	/** Record file, or the configured address when no record named it. */
	subject: string;
	reason: RejectionReason;
	detail: string;
}

export interface DiscoveryResult {
	candidates: DiscoveredDaemon[];
	rejected: DiscoveryRejection[];
	/** The winner, or null when nothing validated. */
	picked: DiscoveredDaemon | null;
	/** Record files whose pid is gone: the caller may reap them. */
	reapable: string[];
	/**
	 * True when the record directory held no parsable record at all. The caller
	 * uses this (and only this) to allow the one-release legacy fixed-port
	 * probe of design §8: a daemon predating the record format is invisible to
	 * every rule here, and without the fallback a UI update would strand it.
	 */
	noRecordsAtAll: boolean;
}

export interface DiscoverOptions {
	env?: NodeJS.ProcessEnv;
	/** Injected for tests: the clock. */
	now?: () => number;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	/** `sys.prefix` of the install the user's own `lop` runs, when known. */
	preferredPrefix?: string | null;
	/** `VITE_LOCAL_OPERATOR_API_URL`, as an address pin only. */
	configuredUrl?: string | null;
	log?: (message: string) => void;
}

/** The config root a reader must use: the override, else `~/.local-operator`. */
export function configRoot(env: NodeJS.ProcessEnv = process.env): string {
	const override = env[CONFIG_DIR_ENV];
	if (override?.trim()) return override;
	return join(os.homedir(), DEFAULT_CONFIG_DIRNAME);
}

/** `<config root>/run/serve` - not created here; a reader does not write. */
export function serveRunDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(configRoot(env), SERVE_RUN_DIRNAME);
}

function asFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Parse one record payload, or say why it is unusable.
 *
 * A record missing the three fields every rule here depends on (pid, the
 * address, the instance id) is not this shape at all: attaching on a guess is
 * the failure mode this module exists to remove, so it is rejected by name
 * rather than defaulted.
 */
export function parseRecord(data: unknown, file: string): RecordFile {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return { file, record: null, problem: "malformed" };
	}
	const raw = data as Record<string, unknown>;
	const pid = asFiniteNumber(raw.pid);
	const port = asFiniteNumber(raw.port);
	const host = typeof raw.host === "string" ? raw.host : "";
	const instanceId = typeof raw.instance_id === "string" ? raw.instance_id : "";
	if (pid === null || port === null || !host || !instanceId) {
		return { file, record: null, problem: "malformed" };
	}
	if (port <= 0 || port > 65535) {
		// Port 0 in a record means "not announced" and is not dialable
		// (`registry.py::ANNOUNCED_PORT_UNKNOWN`). A daemon that published one
		// cannot be reached through it, so it is not a candidate.
		return { file, record: null, problem: "malformed" };
	}
	const record: ServeRecord = {
		pid,
		host,
		port,
		instance_id: instanceId,
		version: typeof raw.version === "string" ? raw.version : "",
		source_ref: typeof raw.source_ref === "string" ? raw.source_ref : "",
		prefix: typeof raw.prefix === "string" ? raw.prefix : "",
		install_kind: typeof raw.install_kind === "string" ? raw.install_kind : "",
		desktop: raw.desktop === true,
		claim_key: typeof raw.claim_key === "string" ? raw.claim_key : "",
		started_at: asFiniteNumber(raw.started_at) ?? 0,
		heartbeat_at: asFiniteNumber(raw.heartbeat_at) ?? 0,
		retiring_from:
			typeof raw.retiring_from === "string" ? raw.retiring_from : null,
		retiring_to: typeof raw.retiring_to === "string" ? raw.retiring_to : null,
	};
	return { file, record };
}

/**
 * Every candidate record in one directory.
 *
 * Unparseable files are reported, never skipped silently: "the app cannot see
 * my daemon" is exactly the report this module exists to answer, and a record
 * that failed to parse is the first thing to look at.
 */
export function readServeRecords(dir: string): {
	files: RecordFile[];
	problem: "absent" | "unreadable" | null;
} {
	let names: string[];
	try {
		names = fs.readdirSync(dir);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		// A missing directory is the ordinary state on a machine whose daemon
		// predates the record format, or that has none running.
		return { files: [], problem: code === "ENOENT" ? "absent" : "unreadable" };
	}
	const files: RecordFile[] = [];
	for (const name of names.sort()) {
		if (!name.endsWith(".json")) continue;
		const file = join(dir, name);
		let text: string;
		try {
			text = fs.readFileSync(file, "utf8");
		} catch {
			files.push({ file, record: null, problem: "unreadable" });
			continue;
		}
		try {
			files.push(parseRecord(JSON.parse(text), file));
		} catch {
			files.push({ file, record: null, problem: "unparseable" });
		}
	}
	return { files, problem: null };
}

/**
 * Signal-0 liveness, the same rule as `registry.py::pid_alive`.
 *
 * `ESRCH` is the only answer that means gone. `EPERM` means alive but not
 * ours, which for "is this daemon there" is alive.
 */
export function pidLiveness(pid: number): PidLiveness {
	try {
		process.kill(pid, 0);
		return "alive";
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "alive";
	}
}

/**
 * Classify one record's freshness.
 *
 * `stale` requires BOTH a dead pid and an aged heartbeat: a record whose pid is
 * gone is not a daemon, and one that is merely quiet (live pid, old heartbeat)
 * is `wedged` - a daemon to report as degraded, never to reap and never to
 * start over. Reaping a live process's record is how a running daemon becomes
 * invisible.
 */
export function classifyRecord(
	record: ServeRecord,
	now: number,
	liveness: PidLiveness = pidLiveness(record.pid),
): RecordHealth {
	const age = now - record.heartbeat_at * 1000;
	if (liveness === "dead") {
		return age > HEARTBEAT_TIMEOUT_MS ? "stale" : "wedged";
	}
	return age > HEARTBEAT_TIMEOUT_MS ? "wedged" : "live";
}

/** `http://host:port`, with an IPv6 literal bracketed so it is dialable. */
export function recordAddress(record: ServeRecord): string {
	const host = record.host.includes(":") ? `[${record.host}]` : record.host;
	return `http://${host}:${record.port}`;
}

export type IdentityProbe =
	| { outcome: "identified"; identity: HealthIdentity }
	| { outcome: "unreachable"; detail: string }
	| { outcome: "not-a-daemon"; detail: string }
	| { outcome: "identity-mismatch"; detail: string; identity: HealthIdentity };

function readIdentity(payload: unknown): HealthIdentity | null {
	if (typeof payload !== "object" || payload === null) return null;
	const result = (payload as { result?: unknown }).result;
	if (typeof result !== "object" || result === null) return null;
	const item = result as Record<string, unknown>;
	if (typeof item.instance_id !== "string" || !item.instance_id) return null;
	return {
		instanceId: item.instance_id,
		pid: asFiniteNumber(item.pid) ?? 0,
		version: typeof item.version === "string" ? item.version : "",
		prefix: typeof item.prefix === "string" ? item.prefix : "",
		installKind: typeof item.install_kind === "string" ? item.install_kind : "",
	};
}

/**
 * Ask one address who it is, and require the answer to be the process the
 * record described.
 *
 * A `/health` 200 with no `instance_id` is an older build: it cannot prove it
 * is the daemon we found, so it is refused here and reaches adoption only
 * through the legacy fallback in `backend-service.ts`, which is logged and
 * deprecated (design §8). Everything else - a 200 that names a different
 * instance, a non-JSON body, a connection refused - is a named rejection.
 */
export async function probeIdentity(
	address: string,
	expectedInstanceId: string,
	options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<IdentityProbe> {
	const fetchImpl = options.fetchImpl ?? fetch;
	try {
		const response = await fetchImpl(new URL(HEALTH_PATH, address), {
			method: "GET",
			headers: { Accept: "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
		});
		if (response.status !== 200) {
			return {
				outcome: "not-a-daemon",
				detail: `${HEALTH_PATH} answered ${response.status}`,
			};
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return {
				outcome: "not-a-daemon",
				detail: `${HEALTH_PATH} answered 200 with a body that is not JSON`,
			};
		}
		const identity = readIdentity(payload);
		if (!identity) {
			return {
				outcome: "not-a-daemon",
				detail: `${HEALTH_PATH} answered 200 without an instance_id`,
			};
		}
		if (identity.instanceId !== expectedInstanceId) {
			return {
				outcome: "identity-mismatch",
				detail: `answered instance_id ${identity.instanceId} but the record names ${expectedInstanceId}`,
				identity,
			};
		}
		return { outcome: "identified", identity };
	} catch (error) {
		return {
			outcome: "unreachable",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

/** Version separators: `1.2.3`, `1.2.3-rc1` and `1.2.3+build` all compare. */
const VERSION_SEPARATOR = /[.+-]/;

/** Numeric semver comparison; unparsable components compare as 0. */
export function compareVersions(a: string, b: string): number {
	const parse = (value: string) =>
		value
			.split(VERSION_SEPARATOR)
			.slice(0, 3)
			.map((part) => Number.parseInt(part, 10) || 0);
	const left = parse(a);
	const right = parse(b);
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i]) return left[i] - right[i];
	}
	return 0;
}

/**
 * Rank valid candidates, best first (design §3.5).
 *
 * The order encodes the complaint that produced this work: the app used to
 * prefer its own bundled venv, so "the same install as your CLI runs" outranks
 * "the newest process". Newer version, then `source_ref`, then newest
 * `started_at` break ties, and a candidate pinned by the configured URL always
 * sorts last - the variable is a fallback address, never a preference.
 */
export function compareCandidates(
	a: DiscoveredDaemon,
	b: DiscoveredDaemon,
	preferredPrefix: string | null,
): number {
	// The CLI's own install first: it is the strongest statement about which
	// daemon a user means, and it is the preference this whole change exists to
	// restore (the app used to prefer its bundled venv). It outranks the
	// configured-address demotion below rather than fighting it, because a daemon
	// that is BOTH the CLI's install and the configured address is not a
	// demotion case at all.
	const sameInstall = (candidate: DiscoveredDaemon) =>
		preferredPrefix !== null &&
		preferredPrefix !== "" &&
		candidate.record.prefix === preferredPrefix;
	if (sameInstall(a) !== sameInstall(b)) return sameInstall(a) ? -1 : 1;
	// Then a daemon the app FOUND before one the configured URL merely names.
	if (a.source !== b.source) return a.source === "record" ? -1 : 1;
	const byVersion = compareVersions(b.record.version, a.record.version);
	if (byVersion !== 0) return byVersion;
	if (a.record.source_ref !== b.record.source_ref) {
		return a.record.source_ref < b.record.source_ref ? 1 : -1;
	}
	return b.record.started_at - a.record.started_at;
}

export function rankCandidates(
	candidates: DiscoveredDaemon[],
	preferredPrefix: string | null,
): DiscoveredDaemon[] {
	return [...candidates].sort((a, b) =>
		compareCandidates(a, b, preferredPrefix),
	);
}

/**
 * Discover the daemons on this machine, ranked.
 *
 * One pass, in the order the rules need each other: enumerate, drop what cannot
 * be dialed, drop what cannot be identified, rank what is left, and report the
 * configured address separately (as a rejection or as a last-ranked candidate)
 * so a wrong pick is diagnosable from the log alone.
 */
export async function discoverDaemons(
	options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
	const env = options.env ?? process.env;
	const now = options.now ?? Date.now;
	const log = options.log ?? (() => {});
	const dir = serveRunDir(env);
	const { files, problem } = readServeRecords(dir);
	const rejected: DiscoveryRejection[] = [];
	const reapable: string[] = [];
	const candidates: DiscoveredDaemon[] = [];
	const configuredUrl = options.configuredUrl ?? null;
	const configuredAddress = normaliseAddress(configuredUrl);

	log(`[discovery] record directory ${dir} (${files.length} record(s))`);

	for (const entry of files) {
		if (!entry.record) {
			rejected.push({
				subject: entry.file,
				reason:
					entry.problem === "unparseable"
						? "unparseable-record"
						: entry.problem === "unreadable"
							? "unreadable-record"
							: "malformed-record",
				detail: `record ${entry.problem}; not a candidate`,
			});
			continue;
		}
		const record = entry.record;
		if (record.started_at * 1000 > now() + CLOCK_SKEW_TOLERANCE_MS) {
			rejected.push({
				subject: entry.file,
				reason: "clock-skew",
				detail: `started_at is ${Math.round((record.started_at * 1000 - now()) / 1000)}s in the future`,
			});
			continue;
		}
		const health = classifyRecord(record, now());
		if (health === "stale") {
			// Dead pid AND an aged heartbeat: the file outlived the process.
			rejected.push({
				subject: entry.file,
				reason: "pid-dead",
				detail: `pid ${record.pid} is gone and the heartbeat is ${Math.round((now() - record.heartbeat_at * 1000) / 1000)}s old`,
			});
			reapable.push(entry.file);
			continue;
		}
		if (health === "wedged") {
			// Live pid, stopped heartbeat: report it, never attach to it, never
			// reap it (the process still owns that file).
			rejected.push({
				subject: entry.file,
				reason: "wedged",
				detail: `pid ${record.pid} is alive but its heartbeat is ${Math.round((now() - record.heartbeat_at * 1000) / 1000)}s old`,
			});
			continue;
		}
		const address = recordAddress(record);
		const probe = await probeIdentity(address, record.instance_id, {
			timeoutMs: options.timeoutMs,
			fetchImpl: options.fetchImpl,
		});
		if (probe.outcome !== "identified") {
			rejected.push({
				subject: entry.file,
				reason:
					probe.outcome === "unreachable"
						? "unreachable"
						: probe.outcome === "not-a-daemon"
							? "not-a-daemon"
							: "identity-mismatch",
				detail: `${address}: ${probe.detail}`,
			});
			continue;
		}
		candidates.push({
			address,
			record,
			file: entry.file,
			health,
			source: address === configuredAddress ? "configured" : "record",
			identity: probe.identity,
		});
		log(
			`[discovery] candidate ${address} pid ${record.pid} v${record.version} prefix ${record.prefix || "(unknown)"}${address === configuredAddress ? " (configured URL)" : ""}`,
		);
	}

	const ranked = rankCandidates(candidates, options.preferredPrefix ?? null);

	/*
	 * The configured address, after enumeration: it is reported even when it is
	 * not a candidate. Its whole purpose is to explain a user's "my server is
	 * right there" - so if something answers at that address and is not the
	 * daemon a record describes, that fact belongs in the log with its reason
	 * rather than being silently ignored. It never ADMITS anything: a listener
	 * that answers 200 without the record's instance_id is precisely the old
	 * bug (`:8080`, a dev server eleven releases behind, accepted as "the
	 * backend"), and it stays refused here.
	 */
	if (
		configuredAddress &&
		!candidates.some((c) => c.address === configuredAddress)
	) {
		// A record already named this address and the rules above refused it: the
		// rejection is on the list with its reason and its own detail, and probing
		// again would only repeat the same answer. Only an address NO record
		// describes is probed here - and then only to name what answered.
		const named = files.some(
			(entry) =>
				entry.record && recordAddress(entry.record) === configuredAddress,
		);
		if (!named) {
			const probe = await probeUnidentified(configuredAddress, {
				timeoutMs: options.timeoutMs,
				fetchImpl: options.fetchImpl,
			});
			rejected.push({
				subject: configuredAddress,
				reason: probe.reason,
				detail: probe.detail,
			});
		}
	}

	const result: DiscoveryResult = {
		candidates: ranked,
		rejected,
		picked: ranked[0] ?? null,
		reapable,
		noRecordsAtAll: files.length === 0,
	};
	for (const rejection of rejected) {
		log(
			`[discovery] rejected ${rejection.subject}: ${rejection.reason} (${rejection.detail})`,
		);
	}
	log(
		result.picked
			? `[discovery] picked ${result.picked.address} (pid ${result.picked.record.pid}, v${result.picked.record.version}, ${result.picked.source})`
			: `[discovery] no valid daemon among ${files.length} record(s)${problem ? ` (directory ${problem})` : ""}`,
	);
	return result;
}

/** `http://127.0.0.1:1111`, normalised so address comparisons are exact. */
export function normaliseAddress(
	url: string | null | undefined,
): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.includes(":")
			? `[${parsed.hostname}]`
			: parsed.hostname;
		const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
		return `${parsed.protocol}//${host}:${port}`;
	} catch {
		return null;
	}
}

/**
 * Probe an address we have no record for, purely to name what is there.
 *
 * Used for the configured URL when no record describes it: the answer decides
 * whether the log says "nothing is listening" or "something answered and it is
 * not the daemon this app discovered".
 */
export async function probeUnidentified(
	address: string,
	options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ reason: RejectionReason; detail: string }> {
	const fetchImpl = options.fetchImpl ?? fetch;
	try {
		const response = await fetchImpl(new URL(HEALTH_PATH, address), {
			method: "GET",
			headers: { Accept: "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
		});
		if (response.status !== 200) {
			return {
				reason: "not-a-daemon",
				detail: `${HEALTH_PATH} answered ${response.status} and no record describes this address`,
			};
		}
		const payload = await response.json().catch(() => null);
		if (readIdentity(payload)) {
			return {
				reason: "identity-mismatch",
				detail: `a daemon answered but no serve record describes ${address}, so it cannot be proven to be the one this app found`,
			};
		}
		return {
			reason: "not-a-daemon",
			detail: `${HEALTH_PATH} answered 200 with no instance_id; not a local-operator daemon`,
		};
	} catch (error) {
		return {
			reason: "unreachable",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Reap records whose process is gone.
 *
 * Guarded three ways, because this is the one place this module deletes
 * anything: the pid must be dead, the heartbeat must be aged past the timeout,
 * and the file must be byte-identical to what was read (re-read immediately
 * before unlinking). A daemon that republished in the meantime - including one
 * whose pid the OS reused - keeps its record; the cost of not reaping is one
 * stale file, the cost of reaping wrongly is a daemon nobody can find.
 */
export function reapStaleRecords(reapable: string[]): string[] {
	const reaped: string[] = [];
	for (const file of reapable) {
		try {
			const entry = parseRecord(
				JSON.parse(fs.readFileSync(file, "utf8")),
				file,
			);
			if (!entry.record) continue;
			if (pidLiveness(entry.record.pid) === "alive") continue;
			if (
				Date.now() - entry.record.heartbeat_at * 1000 <=
				HEARTBEAT_TIMEOUT_MS
			) {
				continue;
			}
			fs.unlinkSync(file);
			reaped.push(file);
		} catch {
			// Racing the owning process is normal; a record that vanished under
			// us is already reaped.
		}
	}
	return reaped;
}

/** An origin a claim may declare: a plain `http(s)` origin, nothing else. */
const DECLARABLE_ORIGIN = /^https?:\/\//;

export type ClaimOutcome =
	| { outcome: "claimed"; origins: string[] }
	| { outcome: "already-claimed"; status: number }
	| { outcome: "wrong-key"; status: number }
	| { outcome: "refused"; status: number; detail: string }
	| { outcome: "unreachable"; detail: string };

/**
 * Claim the desktop plane on a daemon this app did NOT start.
 *
 * The key comes from that daemon's 0600 record, which only this account can
 * read; it is used as the bearer and is never logged, returned or forwarded
 * anywhere. Two rules the backend enforces and this caller must respect:
 * a claim carrying `Sec-Fetch-Site` (a page) is refused even with the key, and
 * the origins it installs must be plain `http(s)` origins - `"null"` (an
 * opaque `file://` document) and `"*"` are refused as declarations, so neither
 * is ever sent.
 *
 * `409` is the latch: somebody already governs this plane, and the right answer
 * is to talk to it with the key we hold rather than to fight for it. `401`
 * means the key we read is not the key this daemon published (a record from
 * the previous process), and `503` means the daemon never published one.
 */
export async function claimDesktopPlane(
	address: string,
	claimKey: string,
	options: {
		origins?: string[];
		timeoutMs?: number;
		fetchImpl?: typeof fetch;
	} = {},
): Promise<ClaimOutcome> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const declared = (options.origins ?? []).filter(
		(origin) =>
			origin !== "null" && origin !== "*" && DECLARABLE_ORIGIN.test(origin),
	);
	try {
		const response = await fetchImpl(new URL(CLAIM_PATH, address), {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				Authorization: `Bearer ${claimKey}`,
			},
			// The body is `{}` plus the renderer's origin when there is one to
			// declare. A native caller has no Origin of its own, which is exactly
			// why the declared list exists.
			body: JSON.stringify(declared.length > 0 ? { origins: declared } : {}),
			redirect: "error",
			signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS * 5),
		});
		if (response.ok) {
			return { outcome: "claimed", origins: declared };
		}
		if (response.status === 409)
			return { outcome: "already-claimed", status: 409 };
		if (response.status === 401) return { outcome: "wrong-key", status: 401 };
		return {
			outcome: "refused",
			status: response.status,
			detail: `claim refused with ${response.status}`,
		};
	} catch (error) {
		return {
			outcome: "unreachable",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Read `desktop_available` from a daemon's capability report.
 *
 * A `401`/`403`/`503` here is a CAPABILITY answer, not a liveness one: it says
 * this app may not use those controls, and saying "server down" for it is the
 * conflation this whole change is about. The caller keeps its connection state
 * untouched and reports the capability separately.
 */
export async function readDesktopAvailable(
	address: string,
	options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ available: boolean | null; status: number | null }> {
	const fetchImpl = options.fetchImpl ?? fetch;
	try {
		const response = await fetchImpl(new URL(CAPABILITIES_PATH, address), {
			method: "GET",
			headers: { Accept: "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
		});
		if (!response.ok) return { available: null, status: response.status };
		const payload = (await response.json().catch(() => null)) as {
			result?: { desktop_available?: unknown };
		} | null;
		const flag = payload?.result?.desktop_available;
		return { available: flag === true, status: response.status };
	} catch {
		return { available: null, status: null };
	}
}
