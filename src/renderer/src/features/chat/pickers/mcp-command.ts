export type McpIntent =
	| { kind: "list"; action: "login" | "reauth" }
	| { kind: "auth"; name: string; action: "login" | "reauth" }
	| { kind: "error"; message: string };
const SPACE = /\s+/;

/** Exact names remain valid. Multi-token input has a verb and ONE target;
 * never scan backwards and silently turn a typo into a verb-named server.
 *
 * `raw` is typed `string | undefined` because it arrives as a wire value: the
 * sibling `resolveMcpServerTarget` already treats it as possibly absent, and a
 * helper that threw on `undefined` would make behaviour depend on which entry
 * point filled the field. */
export function parseMcpIntent(
	raw: string | undefined,
	names: readonly string[],
): McpIntent {
	const text = (raw ?? "").trim();
	if (!text) return { kind: "list", action: "login" };
	/*
	 * A server's own name is checked BEFORE the bare-list form, so the promise in the
	 * paragraph above holds for `list` too: a server literally named `list` is
	 * reachable by its bare name, exactly as `login` and `reauth` are. Testing the
	 * reserved word first made `list` the one configured name the bare form could not
	 * reach, which is the opposite of what the doc comment claimed (code review round
	 * 3, m1).
	 */
	if (names.includes(text))
		return { kind: "auth", name: text, action: "login" };
	if (text === "list") return { kind: "list", action: "login" };
	const [verb, name, ...extra] = text.split(SPACE);
	if (verb !== "login" && verb !== "reauth" && verb !== "auth") {
		return {
			kind: "error",
			message: `Unknown MCP server or command: ${text}. Use /mcp login <name> or /mcp reauth <name>.`,
		};
	}
	const action = verb === "reauth" ? "reauth" : "login";
	if (!name) return { kind: "list", action };
	if (extra.length || !names.includes(name))
		return {
			kind: "error",
			message: `Unknown MCP server: ${name}${extra.length ? " (expected one target)" : ""}. No server was changed.`,
		};
	return { kind: "auth", name, action };
}
