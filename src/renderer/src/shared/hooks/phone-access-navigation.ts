/**
 * One explicit "land on Phone access" intent, set by the sidebar offer's
 * [Set up phone access] and consumed by the Phone access block the next time it
 * mounts (UX review U3c). Same shape as `account-profile-navigation.ts`: no DOM
 * polling and no page-level coupling, so Settings needs no knowledge of the
 * block. Consuming clears it, so only the navigation that asked moves focus; a
 * later visit to Settings lands wherever it normally would.
 */
let pending = false;

export function requestPhoneAccessFocus(): void {
	pending = true;
}

export function consumePhoneAccessFocus(): boolean {
	const asked = pending;
	pending = false;
	return asked;
}
