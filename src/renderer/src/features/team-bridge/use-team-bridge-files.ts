import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { useEffect, useReducer, useRef } from "react";
import {
	type TeamBridgeFilesCapability,
	teamBridgeFilesCapabilitySchema,
} from "../../../../shared/team-bridge-contract";
import { sniffImage } from "./team-bridge-attachments-model";

/** Mirrors core #3363's normalized status.files, not the image capability. */
export function filesCapability(
	status: unknown,
): TeamBridgeFilesCapability | null {
	const block = (status as { status?: { files?: unknown } } | null)?.status
		?.files;
	const result = teamBridgeFilesCapabilitySchema.safeParse(block);
	return result.success ? result.data : null;
}
export type FileChip = {
	key: string;
	file: File;
	status: "held" | "uploading" | "ready" | "error";
	id?: string;
};
export type FileSend = {
	count: number;
	stageInto: (
		conversationId: string,
		tenantId: string | undefined,
	) => Promise<string[]>;
};

/** Human files stay in RAM. In particular neither localStorage nor the desktop
 * attachment store is the hub's store: persisting bytes/paths there would turn a
 * scoped draft into durable cross-account state. A generation is invalidated
 * DURING render, before effects, so a completion cannot resurrect a previous
 * destination in the render-to-effect gap (including an A→B→A switch).
 * Upload requests cannot be cancelled over IPC; abandoned staged IDs expire on
 * the hub. They are never bound after the author leaves their pinned scope. */
export function useTeamBridgeFiles(args: {
	scopeKey: string;
	accountId?: string;
	tenantId?: string;
	conversationId?: string | null;
	capability: TeamBridgeFilesCapability | null;
}) {
	const [, render] = useReducer((n: number) => n + 1, 0);
	const scope = JSON.stringify([
		args.scopeKey,
		args.accountId,
		args.tenantId,
		args.conversationId,
	]);
	const live = useRef({
		scope,
		generation: 0,
		active: true,
		chips: [] as FileChip[],
	});
	if (live.current.scope !== scope)
		live.current = {
			scope,
			generation: live.current.generation + 1,
			active: true,
			chips: [],
		};
	const owner = live.current;
	const capability = useRef(args.capability);
	capability.current = args.capability;
	useEffect(() => {
		owner.active = true;
		return () => {
			owner.active = false;
		};
	}, [owner]);
	const current = () => live.current === owner && owner.active;
	const update = (key: string, patch: Partial<FileChip>) => {
		if (!current()) return;
		owner.chips = owner.chips.map((chip) =>
			chip.key === key ? { ...chip, ...patch } : chip,
		);
		render();
	};
	const upload = async (chip: FileChip, into: string): Promise<string> => {
		const cap = capability.current;
		if (!current() || !cap || !args.accountId || !args.tenantId)
			throw new Error("File upload authority unavailable");
		// The hub sniffs the class. Before reading, apply the largest advertised
		// ceiling; the authoritative per-class refusal remains the hub's decision.
		if (
			!chip.file.size ||
			chip.file.size > Math.max(...cap.classes.map((c) => c.max_bytes)) ||
			encodeURIComponent(chip.file.name).length > 1024
		) {
			update(chip.key, { status: "error" });
			throw new Error("File exceeds upload bounds");
		}
		update(chip.key, { status: "uploading" });
		try {
			const bytes = new Uint8Array(await chip.file.arrayBuffer());
			if (
				!current() ||
				!owner.chips.some((row) => row.key === chip.key) ||
				!capability.current
			)
				throw new Error("File upload cancelled");
			const answer = await TeamBridgeApi.uploadFile(
				args.tenantId,
				into,
				bytes,
				args.accountId,
				chip.file.name,
			);
			if (
				!current() ||
				!owner.chips.some((row) => row.key === chip.key) ||
				!capability.current
			)
				throw new Error("File upload cancelled");
			update(chip.key, { status: "ready", id: answer.id });
			return answer.id;
		} catch (error) {
			update(chip.key, { status: "error" });
			throw error;
		}
	};
	const add = (files: readonly File[]) => {
		if (!current()) return;
		// Keep refused files visible and removable. Dropping a file on a disabled
		// rollout must not silently erase the user's attachment or send prose alone.
		const cap = capability.current;
		const limit = Math.min(10, cap?.max_items ?? 10);
		for (const file of files) {
			const chip: FileChip = {
				key: crypto.randomUUID(),
				file,
				status: cap && owner.chips.length < limit ? "held" : "error",
			};
			owner.chips = [...owner.chips, chip];
			if (cap && args.conversationId && chip.status === "held")
				void upload(chip, args.conversationId).catch(() => {});
		}
		render();
	};
	const stageInto = async (into: string, tenant: string | undefined) => {
		if (
			!current() ||
			tenant !== args.tenantId ||
			!capability.current ||
			(args.conversationId && into !== args.conversationId)
		)
			throw new Error("File destination changed");
		const snapshot = [...owner.chips];
		if (snapshot.length > Math.min(10, capability.current.max_items ?? 10))
			throw new Error("Too many files");
		const ids: string[] = [];
		for (const chip of snapshot) {
			if (!current() || !owner.chips.some((row) => row.key === chip.key))
				throw new Error("File destination changed");
			if (chip.status === "uploading")
				throw new Error("File upload still pending");
			ids.push(
				chip.status === "ready" && chip.id ? chip.id : await upload(chip, into),
			);
		}
		if (!current() || !capability.current)
			throw new Error("File destination changed");
		return ids;
	};
	return {
		chips: owner.chips,
		enabled: args.capability !== null,
		busy: owner.chips.some((chip) => chip.status === "uploading"),
		blocked:
			owner.chips.length > 0 &&
			(!args.capability || owner.chips.some((chip) => chip.status === "error")),
		add,
		stageInto,
		receipt: (): FileSend => ({ count: owner.chips.length, stageInto }),
		retry: (key: string) => {
			const chip = owner.chips.find((row) => row.key === key);
			if (!chip || !capability.current) return;
			if (args.conversationId)
				void upload(chip, args.conversationId).catch(() => {});
			else update(key, { status: "held" });
		},
		remove: (key: string) => {
			if (current()) {
				owner.chips = owner.chips.filter((chip) => chip.key !== key);
				render();
			}
		},
		clear: () => {
			if (current()) {
				owner.chips = [];
				render();
			}
		},
	};
}
export type TeamBridgeFilesState = ReturnType<typeof useTeamBridgeFiles>;

/** Items-first preserves browser image clipboard payloads without duplicating a
 * Finder file exposed in both DataTransfer collections. Text stays untouched. */
export function transferredFiles(data: DataTransfer): File[] {
	const items = Array.from(data.items ?? []).filter(
		(item) => item.kind === "file",
	);
	return items.length
		? items.flatMap((item) => {
				const file = item.getAsFile();
				return file ? [file] : [];
			})
		: Array.from(data.files ?? []);
}
/*
 * ANY FILE TYPE TRAVELS. The image lane takes only what it can actually turn
 * into a png/jpeg (`prepareImageForUpload`) and refuses the rest as
 * "unsupported" - so routing by the DECLARED type used to strand an SVG, TIFF,
 * BMP, ICO, PSD or AVIF (all `image/*`) on an error chip instead of sending it
 * as the file it is. The bytes decide instead: a picture this platform can
 * draw goes inline; everything else, whatever its type or extension, goes to
 * the generic file lane.
 *
 * HEIC is the one picture Chromium usually cannot decode. It goes inline only
 * when this build proves it can (`createImageBitmap` on the file itself, the
 * call the image lane would make next); otherwise the iPhone photo travels as
 * the original file rather than failing as an "unsupported" image.
 */
async function decodesHere(file: File): Promise<boolean> {
	if (typeof createImageBitmap !== "function") return false;
	try {
		(await createImageBitmap(file)).close();
		return true;
	} catch {
		return false;
	}
}

/** Empty MIME is common on Finder documents AND HEIC. Sniff a small header so
 * a PDF without a declared MIME does not accidentally enter image conversion. */
export async function splitBridgeFiles(files: readonly File[]) {
	const images: File[] = [];
	const generic: File[] = [];
	for (const file of files) {
		const sniffed = sniffImage(
			new Uint8Array(await file.slice(0, 32).arrayBuffer()),
		);
		const image =
			sniffed !== null &&
			(sniffed !== "image/heic" || (await decodesHere(file)));
		(image ? images : generic).push(file);
	}
	return { images, generic };
}
