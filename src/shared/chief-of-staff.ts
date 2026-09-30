import type { DesktopCapabilities, DesktopRequest } from "./desktop-contract";
import type {
	DesktopAidaControlResult,
	DesktopAidaState,
} from "./desktop-control-contract";

export const CHIEF_OF_STAFF_COPY = {
	missing: "This build doesn't have a chief-of-staff seat.",
	disabled: "The chief of staff is switched off on this install.",
	unreachable: "Couldn't reach the chief of staff.",
	openFailed: "Couldn't open the chief-of-staff conversation.",
} as const;

const SESSION_ID = /^[a-f0-9]{12}$/;

export class ChiefOfStaffUnavailable extends Error {
	constructor(readonly reason: keyof typeof CHIEF_OF_STAFF_COPY) {
		super(CHIEF_OF_STAFF_COPY[reason]);
	}
}

export async function resolveAidaSession(
	known: DesktopAidaState | undefined,
	open: () => Promise<DesktopAidaControlResult>,
): Promise<string> {
	if (known?.enabled === false) throw new ChiefOfStaffUnavailable("disabled");
	const sessionId = known?.session_id ?? (await open()).session_id;
	if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId))
		throw new ChiefOfStaffUnavailable("openFailed");
	return sessionId;
}

/** Resolving the shared conversation never enables or resumes its proactive cadence. */
export async function resolveChiefOfStaff(
	request: (input: DesktopRequest) => Promise<unknown>,
): Promise<{ sessionId: string; capabilities: DesktopCapabilities }> {
	try {
		const capabilities = (await request({
			op: "capabilities",
		})) as DesktopCapabilities | null;
		if (!capabilities?.desktop_available)
			throw new ChiefOfStaffUnavailable("unreachable");
		if (
			!(
				typeof capabilities.features?.aida === "number" &&
				capabilities.features.aida >= 1
			)
		)
			throw new ChiefOfStaffUnavailable("missing");
		const state = (await request({ op: "aida.status" })) as DesktopAidaState;
		if (state?.enabled === false) throw new ChiefOfStaffUnavailable("disabled");
		if (state?.enabled !== true)
			throw new ChiefOfStaffUnavailable("unreachable");
		const sessionId = await resolveAidaSession(
			state,
			async () =>
				(await request({
					op: "aida.control",
					action: "open",
				})) as DesktopAidaControlResult,
		);
		return { sessionId, capabilities };
	} catch (error) {
		if (error instanceof ChiefOfStaffUnavailable) throw error;
		if (
			error !== null &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "aida_disabled"
		)
			throw new ChiefOfStaffUnavailable("disabled");
		throw new ChiefOfStaffUnavailable("unreachable");
	}
}
