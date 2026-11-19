/** One explicit own-card intent survives route mounting, not account changes.
 * No DOM polling or page-level coupling: Settings consumes it after its guarded
 * profile read answers. An unrelated account can never inherit the focus jump. */
let pendingAuthority: string | undefined;
export function requestAccountProfileFocus(authority: string): void {
	pendingAuthority = authority;
}
export function consumeAccountProfileFocus(authority: string): boolean {
	const matches = pendingAuthority === authority;
	pendingAuthority = undefined;
	return matches;
}
