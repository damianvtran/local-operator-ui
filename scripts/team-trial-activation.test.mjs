import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Execute the shipped wrapper, mutation and API independently. Transport/hooks
 * are seams, not replacements for the guards: removing EITHER boundary must
 * fail its own test even while the other guard still exists. Bundles stay in
 * memory; no browser, live account, server or trial-start side effect is used.
 */
const require = createRequire(import.meta.url);
const root = "./src/renderer/src/";
const activationError = /Team trial activation is not available/;
const anyModule = /.*/;
const entryPaths = {
	mount: `${root}features/team-bridge-trial/team-bridge-trial-empty.tsx`,
	mutation: `${root}features/team-bridge-trial/use-team-trial.ts`,
	api: `${root}shared/api/local-operator/team-trial-api.ts`,
};

async function load(kind, fixture) {
	const mocks = {
		"@features/agent-hub/hooks/use-memberships-query":
			"export const membershipKeys = {all: ['memberships']}; export const useMembershipsQuery = () => ({data: {memberships: []}});",
		"@shared/hooks/radient-account-authority":
			"export const useObservedRadientAuthority = () => ({accountId:'synthetic-account'}); export const readForRadientAccount = (_client,_id,read) => read();",
		"@tanstack/react-query":
			"export const useQueryClient = () => ({}); export const useMutation = options => options; export const useQuery = options => options;",
		"../team-bridge/team-bridge-keys":
			"export const teamBridgeKeys = {statusFor: id => ['status',id]};",
	};
	if (kind === "mount") {
		Object.assign(mocks, {
			"./use-team-trial":
				"export const useTeamTrialEligibility = () => { fixture.reads++; return fixture.answer; };",
			"./team-bridge-trial-dialog":
				"export const TeamBridgeTrialDialog = () => { fixture.dialogs++; return null; };",
			"@shared/components/common/spinner": "export const Spinner = () => null;",
			"@shared/components/ui/button": "export const Button = () => null;",
			"@shared/i18n": "export const t = key => key;",
			"@shared/i18n/use-locale": "export const useI18nLocale = () => {};",
			"@shared/utils/radient-account-copy":
				"export const openConsolePage = () => {};",
			"lucide-react": "export const Users = () => null;",
		});
	} else if (kind === "mutation") {
		mocks["@shared/api/local-operator/team-trial-api"] = `
			export const teamTrialApi = {
				start: () => { fixture.writes++; return Promise.resolve({}); },
				status: () => { fixture.statusReads++; return fixture.status(); }
			};
			export const trialUnavailable = error => error.status === 404 || error.status === 422;
		`;
	} else {
		mocks["@shared/api/radient/proxy"] =
			"export const radientProxy = input => { fixture.requests.push(input); return Promise.resolve({}); };";
		mocks["./desktop-api"] =
			"export class DesktopControlError extends Error {}";
	}
	const result = await build({
		stdin: {
			contents: `export * from ${JSON.stringify(entryPaths[kind])};`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		format: "cjs",
		platform: "node",
		jsx: "automatic",
		external: ["react", "react/jsx-runtime"],
		alias: { "@shared": `${root}shared`, "@features": `${root}features` },
		plugins: [
			{
				name: "activation-boundary-seams",
				setup(builder) {
					builder.onResolve({ filter: anyModule }, ({ path }) =>
						Object.hasOwn(mocks, path)
							? { path, namespace: "activation-fixture" }
							: undefined,
					);
					builder.onLoad(
						{ filter: anyModule, namespace: "activation-fixture" },
						({ path }) => ({ contents: mocks[path], loader: "js" }),
					);
				},
			},
		],
	});
	const module = { exports: {} };
	// The closure fixture is private to this bundle, so tests do not share globals.
	new Function(
		"require",
		"module",
		"exports",
		"fixture",
		result.outputFiles[0].text,
	)(require, module, module.exports, fixture);
	return module.exports;
}

for (const [name, answer] of [
	["older backend 422", { isPending: false, unavailable: true }],
	[
		"server-eligible account",
		{
			isPending: false,
			unavailable: false,
			data: {
				eligible: true,
				tenant_id: "synthetic-tenant",
				tenant_name: "Synthetic Team",
				would_end_at: "2026-12-05T00:00:00Z",
				terms_version: "synthetic-terms",
			},
		},
	],
]) {
	test(`disabled mount: ${name} returns fallback without reads or dialog`, async () => {
		const fixture = { answer, reads: 0, dialogs: 0 };
		const { TeamBridgeTrialEmpty } = await load("mount", fixture);
		const html = renderToStaticMarkup(
			createElement(TeamBridgeTrialEmpty, {
				fallback: createElement("p", null, "existing plan panel"),
			}),
		);
		assert.equal(html, "<p>existing plan panel</p>");
		assert.equal(fixture.reads, 0);
		assert.equal(fixture.dialogs, 0);
	});
}

const input = {
	tenantId: "synthetic-tenant",
	termsVersion: "synthetic-terms",
	requestId: "synthetic-request",
};

test("disabled mutation refuses before even a permissive API can start", async () => {
	const fixture = { writes: 0 };
	const { useStartTeamTrial } = await load("mutation", fixture);
	assert.throws(() => useStartTeamTrial().mutationFn(input), activationError);
	assert.equal(fixture.writes, 0);
});

test("disabled direct API start refuses before proxy transport", async () => {
	const fixture = { requests: [] };
	const { teamTrialApi } = await load("api", fixture);
	await assert.rejects(teamTrialApi.start(input), activationError);
	assert.deepEqual(fixture.requests, []);
	// Passive reads MUST remain live even while new starts are disabled.
	await teamTrialApi.status(input.tenantId);
	await teamTrialApi.eligibility();
	assert.deepEqual(
		fixture.requests.map((request) => request.operation),
		["team_trial.status", "team_trial.eligibility"],
	);
});

test("disabled starts do not suppress existing trial status or older-core fallback", async () => {
	const ended = { state: "ended", trial_end: "2026-11-04T00:00:00Z" };
	const fixture = { statusReads: 0, status: async () => ended };
	const { useTeamTrialStatus } = await load("mutation", fixture);
	const options = useTeamTrialStatus(input.tenantId);
	assert.equal(options.enabled, true);
	assert.equal(await options.queryFn(), ended);
	assert.equal(fixture.statusReads, 1);
	for (const status of [404, 422]) {
		fixture.status = async () => {
			throw Object.assign(new Error("unsupported"), { status });
		};
		assert.equal(await options.queryFn(), null);
	}
});
