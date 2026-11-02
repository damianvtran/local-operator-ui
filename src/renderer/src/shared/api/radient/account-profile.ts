/** Human account profile transport. No agent ids, image store or OAuth bearer. */
import { desktopMedia } from "@shared/api/local-operator/desktop-api";
import { z } from "zod";
import type { DesktopMediaRequest } from "../../../../../shared/desktop-contract";

export const accountProfileFieldsSchema = z.object({
	display_name: z.string(),
	title: z.string(),
	description: z.string(),
	timezone: z.string(),
});
export const accountProfileSchema = accountProfileFieldsSchema.extend({
	account_id: z.string(),
	display_label: z.string(),
	avatar_url: z.string().optional(),
	avatar: z
		.object({
			source: z.string(),
			hash: z.string(),
			updated_at: z.string().optional(),
		})
		.optional(),
});
const snapshotSchema = z.object({
	scope: z.string().regex(/^[a-f0-9]{64}$/),
	profile: accountProfileSchema,
});
export type AccountProfileFields = z.infer<typeof accountProfileFieldsSchema>;
export type AccountProfileSnapshot = z.infer<typeof snapshotSchema>;
export type AccountProfile = z.infer<typeof accountProfileSchema>;

export class AccountProfileError extends Error {
	constructor(
		readonly code: string | undefined,
		readonly status: number | null,
	) {
		super("Account profile request failed");
	}
}

type ProfileRequest = Extract<
	DesktopMediaRequest,
	{
		op:
			| "account.profile"
			| "account.profile.update"
			| "account.avatar.put"
			| "account.avatar.delete";
	}
>;
async function request(
	args: ProfileRequest,
	bytes: Uint8Array | null = null,
): Promise<AccountProfileSnapshot> {
	const response = await desktopMedia(args, bytes);
	if (response.kind !== "json")
		throw new AccountProfileError(
			response.kind === "error" ? response.code : undefined,
			response.kind === "error" ? response.status : null,
		);
	const snapshot = snapshotSchema.parse(
		(response.body as { result: unknown }).result,
	);
	if (snapshot.profile.account_id !== args.expectedAccountId)
		throw new AccountProfileError("account_mismatch", 409);
	return snapshot;
}

export const accountProfileApi = {
	read: (expectedAccountId: string) =>
		request({ op: "account.profile", expectedAccountId }),
	update: (
		expectedAccountId: string,
		scope: string,
		fields: Partial<AccountProfileFields>,
	) =>
		request({ op: "account.profile.update", expectedAccountId, scope, fields }),
	upload: (expectedAccountId: string, scope: string, bytes: Uint8Array) =>
		request({ op: "account.avatar.put", expectedAccountId, scope }, bytes),
	remove: (
		expectedAccountId: string,
		scope: string,
		mode: "uploaded" | "provider",
	) =>
		request({
			op: "account.avatar.delete",
			expectedAccountId,
			scope,
			mode,
			confirmed: true,
		}),
};

/** Partial PATCH is deliberate: changing a photo or one text field must never
 * replace unrelated personal data with an old editor snapshot. */
export function dirtyProfileFields(
	before: AccountProfileFields,
	after: AccountProfileFields,
): Partial<AccountProfileFields> {
	return Object.fromEntries(
		(Object.keys(before) as (keyof AccountProfileFields)[])
			.filter((key) => before[key] !== after[key])
			.map((key) => [key, after[key]]),
	);
}
