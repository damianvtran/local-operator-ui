import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

export class AuditSaveScopeChanged extends Error {
	constructor() {
		super("owner_audit_scope_changed");
	}
}

/** Stage beside the USER-CHOSEN destination (same filesystem), exclusively and
 * owner-readable only. A failed download/write/cancel must not truncate an
 * existing destination. Recheck captured authority at the commit barrier, then
 * rename atomically; only a temp we successfully created may be removed. */
export async function writeAuditAttachmentAtomically(
	path: string,
	data: Uint8Array,
	canCommit: () => Promise<boolean>,
): Promise<void> {
	const temp = join(dirname(path), `.attachment-${randomUUID()}.tmp`);
	let created = false;
	let committed = false;
	try {
		const handle = await open(temp, "wx", 0o600);
		created = true;
		try {
			await handle.writeFile(data);
			await handle.sync();
		} finally {
			await handle.close();
		}
		if (!(await canCommit())) throw new AuditSaveScopeChanged();
		await rename(temp, path);
		committed = true;
	} finally {
		if (created && !committed) await unlink(temp);
	}
}
