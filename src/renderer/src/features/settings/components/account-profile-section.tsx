import {
	SCOPE_PREFERENCE_KEY,
	readScopePreference,
} from "@features/team-bridge/team-bridge-scope-preference";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Button } from "@shared/components/ui";
import {
	accountProfileDraft,
	retainProfileFields,
} from "@shared/hooks/account-profile-draft";
import { consumeAccountProfileFocus } from "@shared/hooks/account-profile-navigation";
import { useObservedRadientAuthority } from "@shared/hooks/radient-account-authority";
import { useAccountAvatar } from "@shared/hooks/use-account-avatar";
import { useAccountProfile } from "@shared/hooks/use-account-profile";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { openConsolePage } from "@shared/utils/radient-account-copy";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { AccountProfileEditor } from "./account-profile-editor";

/** A failed cloud read is not an empty editable profile. The key deliberately
 * includes the authority epoch: an account switch discards the old private
 * draft and closes/releases its decoded photo before a new editor is admitted. */
export function AccountProfileLoading() {
	useI18nLocale();
	return (
		<output className="text-body-sm text-ink-muted">
			{t("ui.settings.personal_profile.loading")}
		</output>
	);
}
export function AccountProfileReadError({ onRetry }: { onRetry: () => void }) {
	useI18nLocale();
	return (
		<div className="flex flex-col items-start gap-2">
			<p role="alert" className="text-body-sm text-danger">
				{t("ui.settings.personal_profile.load_error")}
			</p>
			<Button variant="secondary" size="sm" onClick={onRetry}>
				{t("ui.common.actions.retry")}
			</Button>
		</div>
	);
}
const AVATAR_HASH = /^[a-f0-9]{16}$/;
export function AccountProfileSection() {
	useI18nLocale();
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "account_profile");
	const observed = useObservedRadientAuthority();
	const readViewScope = useCallback(() => {
		try {
			return JSON.stringify(
				observed.accountId
					? (readScopePreference(window.localStorage, observed.accountId) ??
							"personal")
					: "unresolved",
			);
		} catch {
			return "unresolved";
		}
	}, [observed.accountId]);
	const subscribeViewScope = useCallback((listener: () => void) => {
		const storage = (event: StorageEvent) => {
			if (event.key === SCOPE_PREFERENCE_KEY || event.key === null) listener();
		};
		window.addEventListener("storage", storage);
		return () => window.removeEventListener("storage", storage);
	}, []);
	const viewScope = useSyncExternalStore(
		subscribeViewScope,
		readViewScope,
		readViewScope,
	);
	const profile = useAccountProfile(enabled, readViewScope);
	const anchor = useRef<HTMLDivElement>(null);
	const data = profile.data;
	const client = useQueryClient();
	const draftKey = `${profile.authority.token}:${viewScope}:${data?.scope ?? ""}`;
	const retained = data ? accountProfileDraft(client, draftKey) : undefined;
	const hash = data?.profile.avatar?.hash;
	const photoUrl = useAccountAvatar(
		data && hash && AVATAR_HASH.test(hash)
			? { accountId: data.profile.account_id, hash }
			: null,
		256,
	);
	useEffect(() => {
		if (!data || !consumeAccountProfileFocus(profile.authority.token)) return;
		anchor.current?.scrollIntoView({ block: "start" });
		anchor.current?.focus({ preventScroll: true });
	}, [data, profile.authority.token]);
	if (!enabled)
		return (
			<Button
				variant="secondary"
				size="sm"
				onClick={() =>
					openConsolePage("https://console.radienthq.com/dashboard/account")
				}
			>
				{t("ui.settings.personal_profile.manage")}
			</Button>
		);
	if (!profile.authority.accountId || profile.isPending)
		return <AccountProfileLoading />;
	if (!data)
		return <AccountProfileReadError onRetry={() => void profile.refetch()} />;
	return (
		<div
			ref={anchor}
			tabIndex={-1}
			aria-label={t("ui.settings.personal_profile.heading")}
			className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
		>
			<AccountProfileEditor
				key={draftKey}
				snapshot={data}
				initialDraft={retained?.fields}
				onDraftChange={(fields) =>
					retainProfileFields(client, draftKey, fields)
				}
				photoUrl={photoUrl}
				onSave={profile.update}
				onUpload={profile.upload}
				onRemove={profile.remove}
			/>
		</div>
	);
}
