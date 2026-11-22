import type { DesktopFeedFrame } from "./desktop-session-contract";

type Status = { revision: number; code: string };

export type DesktopFeedStatusSnapshot = {
	epoch: string;
	seq: number;
	statuses: Record<string, Status>;
};

/** Status proof comes from the open/frame stream, never from a catalogue row.
 * Main keeps it even without a chat route; an interested renderer can seed from
 * that snapshot and then apply live deltas with the same epoch/revision rules.
 */
export class DesktopFeedStatusProjection {
	private epoch: string | undefined;
	private seq = -1;
	private readonly statuses = new Map<string, Status>();

	clear() {
		this.epoch = undefined;
		this.seq = -1;
		this.statuses.clear();
	}

	seed(snapshot: DesktopFeedStatusSnapshot) {
		if (this.epoch === snapshot.epoch && this.seq >= snapshot.seq) return;
		this.clear();
		this.epoch = snapshot.epoch;
		this.seq = snapshot.seq;
		for (const [identity, { code, revision }] of Object.entries(
			snapshot.statuses,
		)) {
			const id = identity.startsWith("session/") ? identity.slice(8) : identity;
			this.statuses.set(id, { code, revision });
		}
	}

	observe(frame: DesktopFeedFrame): boolean {
		if (frame.type === "open") {
			this.seed({
				epoch: frame.epoch,
				seq: frame.seq,
				statuses: frame.payload.attention_status ?? {},
			});
			return true;
		}
		if (frame.epoch !== this.epoch || frame.seq <= this.seq) return false;
		this.seq = frame.seq;
		if (frame.type === "gap") {
			this.statuses.clear();
			return true;
		}
		if (frame.type !== "session_status") return false;
		const { code, revision } = frame.payload;
		const prior = this.statuses.get(frame.session_id);
		if (prior && prior.revision >= revision) return false;
		this.statuses.set(frame.session_id, { code, revision });
		return true;
	}

	get(id: string) {
		const status = this.statuses.get(id);
		return this.epoch !== undefined && status
			? { epoch: this.epoch, ...status }
			: undefined;
	}

	snapshot(): DesktopFeedStatusSnapshot | undefined {
		return this.epoch === undefined
			? undefined
			: {
					epoch: this.epoch,
					seq: this.seq,
					statuses: Object.fromEntries(this.statuses),
				};
	}
}
