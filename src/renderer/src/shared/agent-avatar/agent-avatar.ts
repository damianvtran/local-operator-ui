/**
 * Agent profile pictures, owned by the local backend.
 *
 * THE SEAM. #1517 (bbqben) built the surfaces against three names -
 * `useAgentAvatar(id)`, `setAgentAvatar(id, image)` and `clearAgentAvatar(id)` -
 * over a `localStorage` proof of concept, so the backend could arrive without
 * moving a surface. This module is that swap: the same three names, now backed
 * by core's `/v1/agents/{id}/avatar` (agent profile pictures contract, frozen
 * 2026-10-30). `agent.yml`'s `avatar: {sha256, mime, bytes, updated_at} | null`
 * is the authority; nothing here keeps a second copy of it.
 *
 * WHY THE HOOK ANSWERS A `blob:` URL AND NOT THE ROUTE. The contract says a
 * client addresses the bytes as `/v1/agents/{id}/avatar?v=<sha>`. This app
 * cannot hand that to an `<img>`: the route needs the bearer, and the bearer
 * lives in MAIN and never crosses IPC (`src/main/desktop-media.ts`). So the
 * bytes ride the media relay (`agent.avatar`) and are painted from a refcounted
 * object URL filed under that same address (`shared/lib/blob-url-cache.ts`),
 * which is why `agentAvatarPath` still exists: it is the cache key, and it is
 * the URL any bearer-free client (the browser dev proxy, a future mobile view)
 * would build.
 *
 * HOW A SURFACE LEARNS A PICTURE EXISTS, WITHOUT A FETCH PER ROW. Two sources,
 * both of which already arrive with data the surface reads anyway:
 *   - the agents list (`GET /v1/agents` -> `avatar`), read ONCE into a map by
 *     `useAgentAvatarMap` below - the roster, the editor and the header use it;
 *   - the session row (`avatar_sha256`), which the sidebar passes in as a hint so
 *     a conversation row never waits on the agents list at all.
 * Only a digest that is actually on screen costs a byte read, and the read is
 * shared by every surface showing the same digest.
 *
 * HOW A CHANGE REACHES OTHER SURFACES. A write from this window invalidates the
 * agents queries and re-reads the session catalogue. A write from anywhere else
 * in the same backend process arrives as the feed's `agent.avatar.changed`
 * frame (`applyAgentAvatarFrame`). A write from the CLI is another process and
 * publishes no frame; it shows up on the next agents/catalogue read, which is
 * the contract's "consumers reconcile on agent.yml".
 */

import {
	desktopControlResponse,
	desktopMedia,
	mediaError,
} from "@shared/api/local-operator/desktop-api";
import type {
	AgentAvatarMeta,
	AgentListResult,
	CRUDResponse,
} from "@shared/api/local-operator/types";
import { queryClient } from "@shared/api/query-client";
import {
	createBlobUrl,
	peek,
	publish,
	release,
	retain,
} from "@shared/lib/blob-url-cache";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	type AgentAvatarMap,
	SHA256,
	agentAvatarPath,
	avatarMetaOf,
} from "./agent-avatar-meta";
import { sanitizeAvatarImages } from "./avatar-image";

export {
	agentAvatarPath,
	avatarMetaOf,
	sessionPictureEditable,
} from "./agent-avatar-meta";
export type { AgentAvatarMap } from "./agent-avatar-meta";

/**
 * The query key of the avatar map. Under `["agents"]` on purpose: every
 * existing agent mutation already invalidates that prefix (`use-update-agent`,
 * the hub download), so an agent created, renamed or deleted anywhere refreshes
 * the map without this module having to know about those writers.
 */
export const agentAvatarsQueryKey = ["agents", "avatars"] as const;

/**
 * The agents route's own page ceiling (`legacy.agents.list` caps `perPage` at
 * 500). One page is the whole roster on every machine measured; an agent past
 * it draws the glyph, which is the fallback every surface already has.
 */
const AVATAR_MAP_PAGE = 500;

/**
 * The query client the mounted surfaces read through.
 *
 * The writes below are plain functions (an editor's click handler, a feed
 * frame), not hooks, so they cannot ask React for the client. They use the one
 * the last mounted reader registered, falling back to the app's singleton: in
 * the app those are the same object, and in Storybook (one client per story,
 * `.storybook/preview.tsx`) the registered one is the story's, so a story's
 * Save repaints that story rather than a client nothing renders.
 */
let activeClient: QueryClient | null = null;
const client = (): QueryClient => activeClient ?? queryClient;

/**
 * Every agent id the last map read LISTED, picture or not.
 *
 * The migration must tell "this backend has no such agent" (keep the entry)
 * from "this agent exists and has no picture yet" (upload it). The map holds
 * only agents WITH a picture, so on its own it cannot; the agents page's cached
 * list used to supply the rest, which is the dependency Q-2 removed - with only
 * the shell's layer mounted nothing else has listed the agents. Kept beside the
 * read that produced it so the two cannot disagree.
 */
let listedAgentIds: ReadonlySet<string> = new Set();

async function readAvatarMap(): Promise<AgentAvatarMap> {
	const response = await desktopControlResponse({
		op: "legacy.agents.list",
		page: 1,
		perPage: AVATAR_MAP_PAGE,
	});
	if (!response.ok) throw new Error(`agents list ${response.status}`);
	const body = (await response.json()) as CRUDResponse<AgentListResult>;
	const map: AgentAvatarMap = {};
	const listed = new Set<string>();
	for (const agent of body.result?.agents ?? []) {
		listed.add(agent.id);
		const meta = avatarMetaOf(agent.avatar);
		if (meta) map[agent.id] = meta;
	}
	listedAgentIds = listed;
	return map;
}

/**
 * The picture records of every local agent, read once and shared.
 *
 * It also runs the one-time `localStorage` migration (below) the first time a
 * map arrives, because the migration's question - "does the backend already
 * have a picture for this agent?" - is exactly this map.
 */
export function useAgentAvatarMap(enabled = true) {
	activeClient = useQueryClient();
	const query = useQuery({
		queryKey: agentAvatarsQueryKey,
		queryFn: readAvatarMap,
		enabled,
		staleTime: 30_000,
		// A failed read is the glyph everywhere, never an error surface: pictures
		// are decoration on every surface that reads this map.
		retry: 1,
		refetchOnWindowFocus: false,
	});
	const data = query.data;
	useEffect(() => {
		if (data) void migrateLocalAvatars(data);
	}, [data]);
	return query;
}

/**
 * The app's agent-avatar layer: mounted ONCE, by the shell (`app.tsx`), so the
 * #1517 `localStorage` migration runs on every launch whichever page is open
 * (QA round 1, Q-2).
 *
 * WHY THE SHELL AND NOT A SURFACE. The migration is triggered by the first map
 * read (`useAgentAvatarMap`), but the chat header and the sidebar rows pass the
 * session row's `avatar_sha256` as a hint, which turns that read OFF for them
 * (`useAgentAvatar`: `enabled = ... && !hinted`). A person who upgraded and
 * stayed in chat therefore kept a picture in `localStorage` that nothing drew
 * and nothing uploaded until they happened to open the Agents page. The map is
 * one shared query, so reading it here costs one list request per staleness
 * window, not one per surface, and the migration's own rules (backend wins,
 * unknown ids kept, failure retried next launch, upload once then clear) are
 * unchanged - only WHEN it first runs moves.
 */
export function useAgentAvatarLayer(): void {
	useAgentAvatarMap(true);
}

/** The record for one agent, or null when it has none (or none is known yet). */
export function useAgentAvatarMeta(
	agentId: string | null | undefined,
): AgentAvatarMeta | null {
	const { data } = useAgentAvatarMap(Boolean(agentId));
	return (agentId && data?.[agentId]) || null;
}

/**
 * The picture for one agent as a paintable URL, or `null` when it has none.
 *
 * `sha256Hint` is the session row's `avatar_sha256`: when a caller has it the
 * agents list is not consulted at all (`undefined` means "no hint, look it up";
 * `null` means "the row says there is none"). A digest that fails to load also
 * answers `null`, so every caller's fallback glyph covers a missing file too.
 */
export function useAgentAvatar(
	agentId: string | null | undefined,
	sha256Hint?: string | null,
): string | null {
	const hinted = sha256Hint !== undefined;
	const { data } = useAgentAvatarMap(Boolean(agentId) && !hinted);
	const sha256 = hinted
		? sha256Hint && SHA256.test(sha256Hint)
			? sha256Hint
			: null
		: agentId
			? (data?.[agentId]?.sha256 ?? null)
			: null;
	return useAvatarBytes(agentId ?? null, sha256);
}

/**
 * Bytes for one (agent, digest) pair, through the shared blob cache.
 *
 * The discipline is `use-file-blob-url`'s: `peek` in render so a warm mount
 * paints on its first frame, `retain`/`release` only in the effect. A digest is
 * immutable, so the cache key never needs invalidating - a new picture is a new
 * key, and the old one is revoked when its last holder lets go.
 */
function useAvatarBytes(
	agentId: string | null,
	sha256: string | null,
): string | null {
	const key = agentId && sha256 ? agentAvatarPath(agentId, sha256) : null;
	/*
	 * THE KEY TRAVELS WITH THE URL, so a render can tell a fresh answer from the
	 * previous key's (agent review round 1, m1). `url` alone was seeded once by a
	 * lazy initializer, so when `key` changed on a MOUNTED component the render
	 * that preceded the effect returned the OLD key's URL - one painted frame of
	 * the previous agent's face. Reachable in practice: the chat header's mark is
	 * not keyed by session, so switching between two agents that both have
	 * pictures re-renders this hook with a new agent id.
	 *
	 * With the key held beside it, the render below falls through to `peek(key)`
	 * for a key it has no answer for: the new digest's warm bytes if they are
	 * already cached, nothing otherwise - never the picture that was on screen a
	 * moment ago. The effect then corrects it as before.
	 */
	const [drawn, setDrawn] = useState<{
		key: string | null;
		url: string | null;
	}>(() => ({ key, url: key ? peek(key) : null }));
	useEffect(() => {
		if (!key || !agentId || !sha256) {
			setDrawn({ key, url: null });
			return;
		}
		const cached = retain(key);
		if (cached) {
			setDrawn({ key, url: cached });
			return () => release(key);
		}
		setDrawn({ key, url: null });
		let cancelled = false;
		let held = false;
		void desktopMedia({ op: "agent.avatar", agentId, sha256 }, null)
			.then((result) => {
				if (cancelled || result.kind !== "bytes") return;
				publish(key, createBlobUrl(result.data as BlobPart, result.mimeType));
				const joined = retain(key);
				held = joined !== null;
				setDrawn({ key, url: joined });
			})
			.catch(() => {
				// A relay that rejected outright is the same answer as a 404: the glyph.
			});
		return () => {
			cancelled = true;
			if (held) release(key);
		};
	}, [key, agentId, sha256]);
	if (!key) return null;
	if (drawn.key === key) return drawn.url;
	return peek(key) ?? null;
}

/**
 * Re-read everything that carries a digest: the agents queries (the map and
 * every list/detail under the same prefix) and the session catalogue (whose
 * rows carry `avatar_sha256`). One function so a local write and a feed frame
 * cannot refresh different sets.
 */
function refreshAvatarReaders(): void {
	void client().invalidateQueries({ queryKey: ["agents"] });
	void useCanonicalSessionsStore.getState().fetchSessions();
}

/**
 * Stores a picture for one agent. `image` is the editor's cropped 512px PNG;
 * core re-normalises whatever it is sent, so this does not re-encode.
 *
 * Resolves with the new record when core answers with one, and throws a
 * readable error otherwise - the editor states it beside its buttons.
 */
export async function setAgentAvatar(
	agentId: string,
	image: Blob,
): Promise<AgentAvatarMeta | null> {
	const bytes = new Uint8Array(await image.arrayBuffer());
	const result = await desktopMedia({ op: "agent.avatar.put", agentId }, bytes);
	/*
	 * Core's refusal sentence (unsupported_type, too_large, too_many_pixels,
	 * undecodable) arrives as the relay's `detail`; `mediaError` carries it as
	 * the message, which is the one place the server's own reason is readable.
	 */
	if (result.status >= 400 || result.kind === "error") throw mediaError(result);
	const meta =
		result.kind === "json"
			? avatarMetaOf(
					(result.body as { avatar?: unknown } | null)?.avatar ?? result.body,
				)
			: null;
	if (meta) {
		client().setQueryData<AgentAvatarMap>(agentAvatarsQueryKey, (map) => ({
			...(map ?? {}),
			[agentId]: meta,
		}));
	}
	refreshAvatarReaders();
	return meta;
}

/** Forgets one agent's picture, leaving the fallback glyph in its place. */
export async function clearAgentAvatar(agentId: string): Promise<void> {
	const result = await desktopMedia(
		{ op: "agent.avatar.delete", agentId },
		null,
	);
	// 404 is "already unset": the state the user asked for, not a failure.
	if (
		result.status !== 404 &&
		(result.status >= 400 || result.kind === "error")
	)
		throw mediaError(result);
	client().setQueryData<AgentAvatarMap>(agentAvatarsQueryKey, (map) => {
		if (!map) return map;
		const { [agentId]: _removed, ...rest } = map;
		return rest;
	});
	refreshAvatarReaders();
}

/**
 * Apply one `agent.avatar.changed` feed frame.
 *
 * Called by the transport (`use-desktop-feed.ts`) rather than subscribed to
 * here, because only the transport holds the feed; it hands over the payload
 * and this module, which owns the keys, decides what to refresh. The map is
 * patched first so a mounted surface repaints on this frame rather than after
 * the re-read, then the readers are refreshed so the authority confirms it.
 */
export function applyAgentAvatarFrame(payload: {
	agent_id: string;
	sha256: string | null;
}): void {
	if (typeof payload?.agent_id !== "string" || !payload.agent_id) return;
	client().setQueryData<AgentAvatarMap>(agentAvatarsQueryKey, (map) => {
		if (!map) return map;
		const { [payload.agent_id]: previous, ...rest } = map;
		if (!payload.sha256 || !SHA256.test(payload.sha256)) return rest;
		return {
			...rest,
			[payload.agent_id]: {
				...(previous ?? { mime: "image/png", bytes: 0, updated_at: "" }),
				sha256: payload.sha256,
			},
		};
	});
	refreshAvatarReaders();
}

/* ------------------------------------------------------------------ *
 * ONE-TIME MIGRATION FROM #1517's `localStorage` STORE
 * ------------------------------------------------------------------ */

/** #1517's storage key (`zustand` persist: `{state: {images}, version}`). */
export const LEGACY_AVATAR_STORAGE_KEY = "agent-avatar-storage";

let migration: Promise<void> | null = null;

/** Test seam: forget that a migration ran in this document. */
export function resetAgentAvatarMigrationForTests(): void {
	migration = null;
	listedAgentIds = new Set();
}

function readLegacyImages(): Record<string, string> {
	try {
		const raw = globalThis.localStorage?.getItem(LEGACY_AVATAR_STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as { state?: { images?: unknown } };
		// The same filter #1517's hydrate used: a tampered entry is not uploaded.
		return sanitizeAvatarImages(parsed?.state?.images);
	} catch {
		return {};
	}
}

function writeLegacyImages(images: Record<string, string>): void {
	try {
		if (Object.keys(images).length === 0) {
			globalThis.localStorage?.removeItem(LEGACY_AVATAR_STORAGE_KEY);
			return;
		}
		globalThis.localStorage?.setItem(
			LEGACY_AVATAR_STORAGE_KEY,
			JSON.stringify({ state: { images }, version: 0 }),
		);
	} catch {
		// A blocked store keeps its entries; the next launch tries again.
	}
}

function dataUrlBytes(dataUrl: string): Blob | null {
	const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
	if (!match) return null;
	try {
		const binary = atob(match[2]);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return new Blob([bytes], { type: match[1] });
	} catch {
		return null;
	}
}

/**
 * Move pictures #1517 stored on this machine into the backend, once.
 *
 * The rules, each a deliberate answer:
 * - An agent the backend ALREADY has a picture for: the backend wins, the local
 *   copy is dropped without uploading (it is the older, smaller 256px one).
 * - An agent this backend does not list: the entry is KEPT. It may belong to a
 *   different backend this app is paired with on another launch, and dropping
 *   it would lose the only copy.
 * - An upload that fails: the entry is KEPT and retried next launch.
 * Everything else is uploaded and then cleared, entry by entry, so an
 * interrupted migration never re-uploads a picture it already moved.
 */
export function migrateLocalAvatars(map: AgentAvatarMap): Promise<void> {
	if (migration) return migration;
	migration = (async () => {
		const images = readLegacyImages();
		const ids = Object.keys(images);
		if (ids.length === 0) {
			writeLegacyImages({});
			return;
		}
		const known = new Set(
			(
				client()
					.getQueriesData<AgentListResult>({ queryKey: ["agents"] })
					.flatMap(([, value]) =>
						Array.isArray(value?.agents) ? value.agents : [],
					) as { id: string }[]
			).map((agent) => agent.id),
		);
		for (const agentId of Object.keys(map)) known.add(agentId);
		for (const agentId of listedAgentIds) known.add(agentId);
		const remaining = { ...images };
		for (const agentId of ids) {
			if (map[agentId]) {
				delete remaining[agentId];
				continue;
			}
			if (known.size > 0 && !known.has(agentId)) continue;
			const blob = dataUrlBytes(images[agentId]);
			if (!blob) {
				delete remaining[agentId];
				continue;
			}
			try {
				await setAgentAvatar(agentId, blob);
				delete remaining[agentId];
			} catch {
				// Kept for the next launch (see the rules above).
			}
			writeLegacyImages(remaining);
		}
		writeLegacyImages(remaining);
	})();
	return migration;
}
