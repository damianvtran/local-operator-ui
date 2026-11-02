/** Synthetic closed-relay and account-switch tests. Canvas/native pixels are
 * intentionally covered by Storybook/independent browser QA, not this suite. */
import assert from "node:assert/strict";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

const MEDIA_MODULE = /desktop-api\.ts$/;
const REQUEST_FAILED = /request failed/;
const AUTHORITY_CHANGED = /authority changed/;
const dir = "node_modules/.cache";
const output = `${dir}/account-profile-${process.pid}.mjs`;
await mkdir(dir, { recursive: true });
const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/shared/api/radient/account-profile";
export * from "./src/renderer/src/shared/api/radient/profile-image";
export * from "./src/renderer/src/shared/hooks/radient-account-authority";
export * from "./src/renderer/src/shared/hooks/use-account-profile";
export * from "./src/renderer/src/shared/hooks/account-profile-draft";`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	write: false,
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	plugins: [
		{
			name: "synthetic-media",
			setup(build) {
				build.onLoad({ filter: MEDIA_MODULE }, () => ({
					contents:
						"export const desktopMedia = (...args) => globalThis.__profileMedia(...args);",
					loader: "ts",
				}));
			},
		},
	],
});
await writeFile(output, bundle.outputFiles[0].text);
after(() => unlink(output));
const profile = await import(new URL(`../${output}`, import.meta.url));
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { createElement } = await import("react");
const { renderToString } = await import("react-dom/server");
const snapshot = {
	scope: "a".repeat(64),
	profile: {
		account_id: "acct_fixture",
		display_name: "Fixture",
		display_label: "Fixture",
		title: "",
		description: "",
		timezone: "UTC",
	},
};
const user = {
	account: {
		id: "acct_fixture",
		tenant_id: "tenant_fixture",
		name: "Identity",
		email: "fixture@example.test",
	},
	identity: {},
};
const client = () => {
	const query = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	query.setQueryData(profile.radientUserKeys.user(), user);
	return query;
};

test("dirty PATCH retains absent fields and preserves explicit clear", () => {
	const fields = {
		display_name: "Fixture",
		title: "Engineer",
		description: "Old",
		timezone: "UTC",
	};
	assert.deepEqual(
		profile.dirtyProfileFields(fields, { ...fields, description: "" }),
		{ description: "" },
	);
	assert.deepEqual(profile.dirtyProfileFields(fields, { ...fields }), {});
});
test("profile transport pins opaque scope and sends raw bytes only for photo", async () => {
	const calls = [];
	globalThis.__profileMedia = async (...args) => {
		calls.push(args);
		return { kind: "json", status: 200, body: { result: snapshot } };
	};
	await profile.accountProfileApi.update("acct_fixture", snapshot.scope, {
		title: "New",
	});
	await profile.accountProfileApi.upload(
		"acct_fixture",
		snapshot.scope,
		new Uint8Array([1, 2, 3]),
	);
	await profile.accountProfileApi.remove(
		"acct_fixture",
		snapshot.scope,
		"provider",
	);
	assert.deepEqual(calls[0], [
		{
			op: "account.profile.update",
			expectedAccountId: "acct_fixture",
			scope: snapshot.scope,
			fields: { title: "New" },
		},
		null,
	]);
	assert.ok(calls[1][1] instanceof Uint8Array);
	assert.equal(calls[2][0].confirmed, true);
	assert.equal(calls[2][0].mode, "provider");
});
test("wrong-account successful HTTP body is refused", async () => {
	globalThis.__profileMedia = async () => ({
		kind: "json",
		status: 200,
		body: {
			result: {
				...snapshot,
				profile: { ...snapshot.profile, account_id: "other" },
			},
		},
	});
	await assert.rejects(
		profile.accountProfileApi.read("acct_fixture"),
		REQUEST_FAILED,
	);
});
test("auth transition suppresses stale write result and preserves other cache", () => {
	const query = client();
	const token = profile.radientAuthoritySnapshot(query);
	query.setQueryData(
		["team-bridge", "directory", "tenant_other", "account", "other"],
		"private-other",
	);
	profile.beginRadientAuthorityTransition(query);
	assert.throws(
		() => profile.publishAccountProfile(query, token, snapshot),
		AUTHORITY_CHANGED,
	);
	assert.equal(
		query.getQueryData(profile.radientUserKeys.user()).account.name,
		"Identity",
	);
	assert.equal(
		query.getQueryData([
			"team-bridge",
			"directory",
			"tenant_other",
			"account",
			"other",
		]),
		"private-other",
	);
	query.clear();
});
test("organization view switch rejects before invoking media", async () => {
	const query = client();
	const token = profile.radientAuthoritySnapshot(query);
	query.setQueryData(
		profile.accountProfileKeys.snapshot("acct_fixture", token),
		snapshot,
	);
	let scope = "tenant_fixture";
	let controls;
	let calls = 0;
	globalThis.__profileMedia = async () => {
		calls++;
		throw new Error("unexpected dispatch");
	};
	function Harness() {
		controls = profile.useAccountProfile(false, () => scope);
		return null;
	}
	renderToString(
		createElement(
			QueryClientProvider,
			{ client: query },
			createElement(Harness),
		),
	);
	scope = "tenant_other";
	await assert.rejects(controls.update({ title: "New" }), AUTHORITY_CHANGED);
	assert.equal(calls, 0);
	query.clear();
});
test("retained text returns within one scope, Cancel and A→B→A erase it", () => {
	const query = client();
	const token = profile.radientAuthoritySnapshot(query);
	const key = `${token}:tenant_fixture:${snapshot.scope}`;
	profile.retainProfileFields(query, key, { title: "Unsaved" });
	assert.deepEqual(profile.accountProfileDraft(query, key)?.fields, {
		title: "Unsaved",
	});
	profile.retainProfileFields(query, key, {});
	assert.equal(profile.accountProfileDraft(query, key), undefined);
	profile.retainProfileFields(query, key, { title: "Private unsaved" });
	profile.beginRadientAuthorityTransition(query);
	profile.settleRadientAuthority(
		query,
		profile.radientAuthorityEpoch(query),
		"acct_fixture",
	);
	assert.equal(profile.accountProfileDraft(query, key), undefined);
	profile.retainProfileFields(query, key, { title: "Late stale callback" });
	assert.equal(
		profile.accountProfileDraft(
			query,
			`${profile.radientAuthoritySnapshot(query)}:tenant_fixture:${snapshot.scope}`,
		),
		undefined,
	);
	query.clear();
});

test("PNG header rejects pixel bombs before the browser decoder", () => {
	const bytes = new Uint8Array(24);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x89504e47);
	view.setUint32(4, 0x0d0a1a0a);
	view.setUint32(12, 0x49484452);
	view.setUint32(16, 40000);
	view.setUint32(20, 40000);
	assert.equal(
		profile.profileImageFits(profile.profileImageDimensions(bytes)),
		false,
	);
	view.setUint32(16, 256);
	view.setUint32(20, 256);
	assert.deepEqual(profile.profileImageDimensions(bytes), {
		width: 256,
		height: 256,
	});
	assert.equal(
		profile.profileImageFits(profile.profileImageDimensions(bytes)),
		true,
	);
	assert.equal(
		profile.profileImageDimensions(new TextEncoder().encode("<svg></svg>")),
		null,
	);
});
test("decoded edge and total pixel limits both apply", () => {
	assert.equal(profile.profileImageFits({ width: 4096, height: 4096 }), false);
	assert.equal(profile.profileImageFits({ width: 4096, height: 3906 }), true);
	assert.equal(profile.profileImageFits({ width: 4097, height: 1 }), false);
	assert.equal(profile.profileImageFits({ width: 0, height: 1 }), false);
});
