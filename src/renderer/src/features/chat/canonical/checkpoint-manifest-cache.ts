/**
 * The checkpoint manifest this window last saw, per conversation — the memory
 * that lets a conversation's rail be drawn in the SAME commit as its rows.
 *
 * WHY A MEMORY AND NOT JUST THE READ. The rail's ticks are the manifest's
 * (`sessions.checkpoints`), and that read used to start when the transcript
 * mounted — i.e. alongside the history page, so its answer landed 30-94 ms after
 * the first contentful commit on every open (first-paint bench, baseline: rail
 * late on 5/5 cold opens of every shape). Two things close that gap and this
 * module is both of them: the read is started when the CONVERSATION opens rather
 * than when its rows arrive (`use-open-prefetch.ts`), and a manifest this window
 * already has paints immediately while the fresh one is fetched underneath.
 *
 * WHAT A SEEDED MANIFEST MAY COST, and why it is still the better trade. Ticks
 * are placed SEQ-PROPORTIONALLY over the whole journal (`checkpoint-model.ts`),
 * so a conversation that gained a turn since this window last read it gets a
 * tick added — and every tick's position moves by that turn's fraction of the
 * journal, which is sub-pixel on any conversation long enough to have a rail.
 * The rail's own jump resolves an id it cannot reach as "not reachable", which
 * is the state a deleted or compacted anchor already reaches. The old behaviour
 * was the rail's entire chrome appearing one round trip after the rows, on every
 * open; this replaces that with ticks that are right for everything this window
 * has seen.
 *
 * WHO STARTS THE READ, AND WHAT IS STILL A RACE. `use-open-prefetch.ts` starts
 * it when the conversation opens (the pane's own effect, beside the settings
 * prefetch), and the transcript's mount joins it through `inFlight` — so the
 * common case is ONE request for one open. The two effects order by tree
 * position, though, so on a cold open the transcript's mount can reach this
 * module first and start the read itself; that is the residual one-frame-late
 * rail QA round 1 recorded (5/18 cold opens, worst +127.6 ms on S3), and it is
 * the class of thing a CLICK-time warm would remove, because the click precedes
 * both. Recorded rather than wired: a store-layer call is the next step if that
 * race matters, and the read is deduped through `inFlight` either way.
 *
 * AND A SETTLED READ IS NOT RE-READ (QA round 1, Q-2). Before this, a prefetch
 * that answered *before* the mount left the mount's own ask to start a SECOND
 * request for a fact this window had read milliseconds earlier — measured at 2
 * reads on 29/36 opens against base's 1. `checkpointManifestAgeMs` is what lets
 * the hook tell "the open already answered this" from "this is an old memory
 * worth verifying", and it is the same clock the freshness gate reads.
 *
 * THE BOUND IS BY CONVERSATION, not by bytes: a manifest is a few hundred ticks
 * of small records (measured at ~116 KB on the operator's largest journal, which
 * is the whole payload of the endpoint, not one tick), so the cap exists to stop
 * a long browsing session accumulating one entry per conversation visited rather
 * than to police a heavy single conversation. Eviction is by WRITE order, which
 * is what a Map's insertion order gives for free: a read does not reorder, so the
 * one thing this cache must not do — run a mutation while a component's first
 * render is between two reads of it — cannot happen.
 */
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { CheckpointManifest } from "../../../../../shared/desktop-contract";

/**
 * Conversations kept, most-recently-read last. Eight is the rail's own reach in
 * practice — the reader's last few conversations, which is what "switch away and
 * back" means — and it costs a few hundred kilobytes at the endpoint's measured
 * size rather than a per-session budget nobody can reason about.
 */
export const CHECKPOINT_MANIFEST_CACHE_SESSIONS = 8;

const manifests = new Map<string, CheckpointManifest>();
/** Reads in flight, so a prefetch and the hook's own mount share ONE request. */
const inFlight = new Map<string, Promise<CheckpointManifest>>();
/** When each memory was read, for the freshness gate below. */
const readAt = new Map<string, number>();

/**
 * How long a memory counts as THIS OPEN's answer rather than an old one.
 *
 * What it gates: the hook's first ask of a conversation, which is the one ask a
 * read started at the open may already have answered (QA round 1, Q-2: two
 * `/checkpoints` reads on 29/36 opens, because the cache deduped only while the
 * first read was IN FLIGHT). The window is generous on purpose — the read it is
 * standing in for answered in tens of milliseconds on a healthy backend, and a
 * manifest's ticks are seq-proportional over the journal, so a manifest this
 * fresh is the same picture the fresh read would return. It is deliberately
 * SHORT in absolute terms, so a memory from a previous visit is still verified
 * rather than trusted.
 */
export const CHECKPOINT_MANIFEST_FRESH_MS = 2_000;

/** The manifest this window holds for a conversation, or null. */
export function readCachedCheckpointManifest(
	sessionId: string,
): CheckpointManifest | null {
	return manifests.get(sessionId) ?? null;
}

/**
 * How long ago this window read that conversation's manifest, in ms, or null
 * when it holds none. See `CHECKPOINT_MANIFEST_FRESH_MS` for what reads it.
 */
export function checkpointManifestAgeMs(sessionId: string): number | null {
	const at = readAt.get(sessionId);
	return at === undefined ? null : Date.now() - at;
}

/**
 * Read a conversation's manifest, sharing one request between every caller that
 * asks while it is in flight.
 *
 * A FAILURE IS NOT CACHED and is not swallowed: the promise rejects so the hook
 * that owns the reader-facing consequences (one warn per failure class per
 * conversation, and the fallback text its own doc describes) can do its job,
 * while a prefetch catches it and drops it. Nothing here fetches twice for one
 * ask — that is the whole reason the in-flight map exists, because the prefetch
 * and the transcript's mount are two callers a few milliseconds apart.
 */
export function loadCheckpointManifest(
	sessionId: string,
): Promise<CheckpointManifest> {
	const pending = inFlight.get(sessionId);
	if (pending) return pending;
	const load = desktopResult<CheckpointManifest>({
		op: "sessions.checkpoints",
		sessionId,
	})
		.then((manifest) => {
			manifests.delete(sessionId);
			manifests.set(sessionId, manifest);
			readAt.set(sessionId, Date.now());
			while (manifests.size > CHECKPOINT_MANIFEST_CACHE_SESSIONS) {
				const oldest = manifests.keys().next();
				if (oldest.done) break;
				manifests.delete(oldest.value);
				readAt.delete(oldest.value);
			}
			return manifest;
		})
		.finally(() => {
			inFlight.delete(sessionId);
		});
	inFlight.set(sessionId, load);
	return load;
}

/** Drop every cached manifest; the next read starts from nothing. */
export function __resetCheckpointManifestCache(): void {
	manifests.clear();
	inFlight.clear();
	readAt.clear();
}
