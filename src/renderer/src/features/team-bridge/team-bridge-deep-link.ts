import type { TeamBridgeTarget } from "./team-bridge-model";
import { TEAM_BRIDGE_PATH } from "./team-bridge-nav";

/**
 * The Team Bridge page's deep-link address: which organization, and which rail
 * row, a `/team-bridge?...` URL opens on.
 *
 * WHY THIS MODULE EXISTS. A notification click already opens a conversation
 * through `?tenant=&conversation=` (`teamBridgeOpenPath`, `src/shared`, built
 * there because main composes it too). The command palette (operator,
 * 2026-11-04: "hop into team bridge by searching for the channel, team member,
 * agent, DM, group") needs the same door for the two rail rows a conversation
 * id cannot name: a PERSON and a CHIEF OF STAFF. Those rows are targets, not
 * conversations - the rail selects the person and the pane shows their DM if one
 * exists, or an empty draft addressed to them if not (`TeamBridgeTarget`), and a
 * conversation is created only by the first send. Encoding them as a
 * conversation id would force a create on click, which is exactly what the rail
 * stopped doing (operator review, 2026-10-21).
 *
 * ONE PARSER, ONE BUILDER. The page reads the address only through
 * `teamBridgeTargetFromSearch`, and the palette writes it only through
 * `teamBridgeTargetPath`, so the two cannot drift into two spellings. The
 * conversation form is byte-compatible with `teamBridgeOpenPath` (same keys,
 * same order), so a notification link and a palette link to one conversation
 * are the same URL.
 *
 * EXACTLY ONE ROW PARAMETER. A URL carrying two (`conversation` and `person`)
 * names no single row; it parses to null rather than guessing which one wins,
 * and so does any row parameter without its `tenant` - a person or conversation
 * belongs to exactly one organization, and the page composes against that
 * organization.
 */
export const TEAM_BRIDGE_ROW_PARAMS = [
	"conversation",
	"person",
	"chief",
] as const;

export type TeamBridgeLinkTarget = Extract<
	TeamBridgeTarget,
	{ type: "conversation" | "person" | "chief" }
>;

export type TeamBridgeLink = {
	tenantId: string;
	target: TeamBridgeLinkTarget;
};

export function teamBridgeTargetFromSearch(
	params: URLSearchParams,
): TeamBridgeLink | null {
	const tenantId = params.get("tenant");
	if (!tenantId) return null;
	const present = TEAM_BRIDGE_ROW_PARAMS.filter((key) => params.get(key));
	if (present.length !== 1) return null;
	const [key] = present;
	const value = params.get(key) as string;
	return {
		tenantId,
		target:
			key === "conversation"
				? { type: "conversation", id: value }
				: { type: key, accountId: value },
	};
}

export function teamBridgeTargetPath(link: TeamBridgeLink): string {
	const { target } = link;
	const query = new URLSearchParams({ tenant: link.tenantId });
	if (target.type === "conversation") query.set("conversation", target.id);
	else query.set(target.type, target.accountId);
	return `${TEAM_BRIDGE_PATH}?${query.toString()}`;
}
