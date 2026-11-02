/** Human profile writes share the account authority journal, not agent state. */
import {
	type AccountProfileSnapshot,
	accountProfileApi,
} from "@shared/api/radient/account-profile";
import type { UserInfoResult } from "@shared/api/radient/types";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	observedRadientAuthority,
	radientAuthoritySnapshot,
	radientUserKeys,
	readForRadientAccount,
	useObservedRadientAuthority,
} from "./radient-account-authority";

export const accountProfileKeys = {
	snapshot: (accountId: string, authority: string) =>
		["account-profile", accountId, authority] as const,
};

/** Never file an old write's result under a newly active account. A completed
 * upstream write cannot be cancelled; this rejects its stale local success. */
export function publishAccountProfile(
	client: QueryClient,
	token: string,
	snapshot: AccountProfileSnapshot,
): void {
	if (
		radientAuthoritySnapshot(client) !== token ||
		observedRadientAuthority(client).accountId !== snapshot.profile.account_id
	)
		throw new Error("Account authority changed");
	client.setQueryData(
		accountProfileKeys.snapshot(snapshot.profile.account_id, token),
		snapshot,
	);
	client.setQueryData<UserInfoResult | null>(radientUserKeys.user(), (old) => {
		if (!old || old.account.id !== snapshot.profile.account_id) return old;
		const { display_name, title, description, timezone, avatar, avatar_url } =
			snapshot.profile;
		return {
			...old,
			account: {
				...old.account,
				profile: {
					...old.account.profile,
					display_name,
					title,
					description,
					timezone,
					avatar,
				},
				avatar_url,
			},
		};
	});
	// Every Bridge query carries the viewer account suffix; do not invalidate
	// another account's retained private cache or issue requests with its keys.
	void client.invalidateQueries({
		predicate: (query) =>
			query.queryKey[0] === "team-bridge" &&
			query.queryKey.some(
				(part, index) =>
					part === "account" &&
					query.queryKey[index + 1] === snapshot.profile.account_id,
			),
	});
	void client.invalidateQueries({ queryKey: radientUserKeys.user() });
}

export function useAccountProfile(
	enabled = true,
	readViewScope: () => string = () => "personal",
) {
	const client = useQueryClient();
	const authority = useObservedRadientAuthority();
	const accountId = authority.accountId;
	// View scope is not upstream authorization (profile writes are personal),
	// but queued work must not dispatch or claim success in a changed view.
	const viewScope = readViewScope();
	const query = useQuery({
		queryKey: accountProfileKeys.snapshot(
			accountId ?? "unresolved",
			authority.token,
		),
		enabled: enabled && Boolean(accountId),
		retry: false,
		queryFn: () =>
			readForRadientAccount(client, accountId, () =>
				accountProfileApi.read(accountId ?? ""),
			),
	});
	const guard = () => {
		if (
			!accountId ||
			radientAuthoritySnapshot(client) !== authority.token ||
			readViewScope() !== viewScope
		)
			throw new Error("Account authority changed");
	};
	return {
		...query,
		authority,
		async update(fields: Parameters<typeof accountProfileApi.update>[2]) {
			guard();
			if (!query.data || !accountId)
				throw new Error("Account profile unresolved");
			const next = await accountProfileApi.update(
				accountId,
				query.data.scope,
				fields,
			);
			guard();
			publishAccountProfile(client, authority.token, next);
			return next;
		},
		async upload(bytes: Uint8Array) {
			guard();
			if (!query.data || !accountId)
				throw new Error("Account profile unresolved");
			const next = await accountProfileApi.upload(
				accountId,
				query.data.scope,
				bytes,
			);
			guard();
			publishAccountProfile(client, authority.token, next);
			return next;
		},
		async remove(mode: "uploaded" | "provider") {
			guard();
			if (!query.data || !accountId)
				throw new Error("Account profile unresolved");
			const next = await accountProfileApi.remove(
				accountId,
				query.data.scope,
				mode,
			);
			guard();
			publishAccountProfile(client, authority.token, next);
			return next;
		},
	};
}
