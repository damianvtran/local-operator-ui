/** One private in-memory editor slot per QueryClient. Plain HashRouter has no
 * route blocker; retaining the draft avoids silent navigation loss without
 * persisting personal information or replacing the app router. The same auth
 * journal that revokes photos clears this slot on every login transition. */
import type { AccountProfileFields } from "@shared/api/radient/account-profile";
import type { QueryClient } from "@tanstack/react-query";
import {
	radientAuthoritySnapshot,
	subscribeRadientAuthority,
} from "./radient-account-authority";
type Draft = { key: string; fields: Partial<AccountProfileFields> };
const drafts = new WeakMap<QueryClient, Draft>();
const installed = new WeakSet<QueryClient>();
export function accountProfileDraft(
	client: QueryClient,
	key: string,
): Draft | undefined {
	if (!installed.has(client)) {
		installed.add(client);
		let authority = radientAuthoritySnapshot(client);
		subscribeRadientAuthority(client, () => {
			const next = radientAuthoritySnapshot(client);
			if (authority === next) return;
			authority = next;
			drafts.delete(client);
		});
	}
	if (!key.startsWith(`${radientAuthoritySnapshot(client)}:`)) return undefined;
	const draft = drafts.get(client);
	if (draft?.key === key) return draft;
	drafts.delete(client);
	return undefined;
}
export function retainProfileFields(
	client: QueryClient,
	key: string,
	fields: Partial<AccountProfileFields>,
): void {
	if (!key.startsWith(`${radientAuthoritySnapshot(client)}:`)) return;
	accountProfileDraft(client, key);
	if (!Object.keys(fields).length) {
		drafts.delete(client);
		return;
	}
	drafts.set(client, { key, fields });
}
