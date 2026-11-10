/**
 * The manager's durable state: `<root>/state.json` (design §4.1).
 *
 *   state.json            {version:1, extensions:{<id>: InstalledExtension}}
 *   <id>/official.crx     the trust root, re-verified on EVERY load
 *   <id>/pending.crx      a verified update waiting for re-approval
 *   <id>/verified-XXXX/   fresh extraction per load, deleted on unload
 *
 * A state entry IS the user's consent. A cached CRX alone is never consent: a
 * file dropped into `<id>/` without a state entry is ignored, and only the
 * native install/enable dialog writes an entry with `enabled: true`.
 */
import { join } from "node:path";
import { isExtensionId } from "../../../shared/browser-extensions";
import { readJson, writeJsonAtomic } from "../atomic-json";
import type { ExtensionAccess } from "./policy";

export interface InstalledExtension {
	enabled: boolean;
	installedAt: number;
	version: string;
	/** Display name and bounded icon captured from the VERIFIED package at
	 * install, so a disabled extension lists without extracting it. */
	name: string;
	icon: string | null;
	/** What the user approved in the native dialog. `null` only for an entry
	 * migrated from the single-vendor layout, whose dialog stated all-sites
	 * access; it is replaced by the verified manifest's access on first load. */
	consented: ExtensionAccess | null;
	/** Version of `<id>/pending.crx`, when an update asks for more access. */
	pendingVersion?: string;
	/** Captured from the verified package for the extensions page; optional so
	 * entries written before the page existed still read (they fill in on the
	 * next load). */
	description?: string;
	homepage?: string | null;
	/** A `runtime.onInstalled` owed to the extension (review U1b): set in the
	 * same save that records a consented install/update, cleared once
	 * dispatched, so a crash in between re-delivers it on the next load and a
	 * plain restart never re-fires it. */
	installEvent?: InstallEvent;
}

export type InstallEvent =
	| { reason: "install" }
	| { reason: "update"; previousVersion: string };

function installEventOf(raw: unknown): InstallEvent | null {
	if (!raw || typeof raw !== "object") return null;
	const event = raw as Record<string, unknown>;
	if (event.reason === "install") return { reason: "install" };
	if (event.reason === "update" && typeof event.previousVersion === "string")
		return {
			reason: "update",
			previousVersion: event.previousVersion.slice(0, 64),
		};
	return null;
}

export interface ExtensionsState {
	version: 1;
	extensions: Record<string, InstalledExtension>;
}

function validAccess(value: unknown): value is ExtensionAccess {
	if (!value || typeof value !== "object") return false;
	const access = value as Record<string, unknown>;
	const list = (item: unknown) =>
		Array.isArray(item) && item.every((entry) => typeof entry === "string");
	return (
		typeof access.allSites === "boolean" &&
		list(access.hosts) &&
		list(access.permissions)
	);
}

/** Tolerant read: a malformed entry is dropped (fails closed = not installed),
 * never coerced into consent. */
export function readExtensionsState(root: string): ExtensionsState {
	const raw = readJson<{ version?: unknown; extensions?: unknown }>(
		join(root, "state.json"),
	);
	const state: ExtensionsState = { version: 1, extensions: {} };
	if (
		!raw ||
		raw.version !== 1 ||
		!raw.extensions ||
		typeof raw.extensions !== "object"
	)
		return state;
	for (const [id, value] of Object.entries(
		raw.extensions as Record<string, unknown>,
	)) {
		if (!isExtensionId(id) || !value || typeof value !== "object") continue;
		const entry = value as Record<string, unknown>;
		if (
			typeof entry.enabled !== "boolean" ||
			typeof entry.version !== "string" ||
			typeof entry.name !== "string" ||
			(entry.icon !== null &&
				(typeof entry.icon !== "string" ||
					!entry.icon.startsWith("data:image/"))) ||
			typeof entry.installedAt !== "number" ||
			(entry.consented !== null && !validAccess(entry.consented))
		)
			continue;
		state.extensions[id] = {
			enabled: entry.enabled,
			installedAt: entry.installedAt,
			version: entry.version,
			name: entry.name,
			icon: entry.icon as string | null,
			consented: entry.consented as ExtensionAccess | null,
			...(typeof entry.pendingVersion === "string"
				? { pendingVersion: entry.pendingVersion }
				: {}),
			...(installEventOf(entry.installEvent)
				? { installEvent: installEventOf(entry.installEvent) as InstallEvent }
				: {}),
			...(typeof entry.description === "string"
				? { description: entry.description.slice(0, 400) }
				: {}),
			// Re-checked on read: only an http(s) URL is ever opened from here.
			...(typeof entry.homepage === "string" &&
			/^https?:\/\//i.test(entry.homepage)
				? { homepage: entry.homepage }
				: {}),
		};
	}
	return state;
}

export function writeExtensionsState(
	root: string,
	state: ExtensionsState,
): void {
	if (!writeJsonAtomic(join(root, "state.json"), state))
		throw new Error("Could not save extension state");
}
