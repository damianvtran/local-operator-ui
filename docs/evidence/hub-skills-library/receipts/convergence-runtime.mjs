// Bounded Node module proof, following scripts/right-slot-memory.test.mjs.
// No app build/boot or dependency install. All repository modules load from the
// nominated Git ref via onLoad, not accidentally from the current worktree.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = process.cwd(),
	refs = ["43fc66a1b", "51a2eccfb"],
	require = createRequire(import.meta.url);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const storage = new Map();
globalThis.localStorage = {
	getItem: (k) => storage.get(k) ?? null,
	setItem: (k, v) => storage.set(k, String(v)),
	removeItem: (k) => storage.delete(k),
};
async function load(ref) {
	const sources = {};
	const out = await build({
		stdin: {
			contents:
				'export {useUiPreferencesStore,persistedUiPreferences,mergePersistedUiPreferences,migrateUiPreferences,UI_PREFERENCES_VERSION} from "./src/renderer/src/shared/store/ui-preferences-store"; export {desktopRequestSchema,desktopEndpoint,desktopRequestDeadlineDetail,__proofReadOnly} from "./src/shared/desktop-contract";',
			resolveDir: root,
			loader: "ts",
		},
		bundle: true,
		write: false,
		format: "cjs",
		platform: "node",
		logLevel: "silent",
		alias: {
			"@features": resolve(root, "src/renderer/src/features"),
			"@shared": resolve(root, "src/renderer/src/shared"),
			"@assets": resolve(root, "src/renderer/src/assets"),
		},
		plugins: [
			{
				name: "pinned-git-source",
				setup(b) {
					b.onLoad({ filter: /\.(tsx?|jsx?|json)$/ }, (args) => {
						if (args.path.includes("/node_modules/")) return;
						const p = relative(root, args.path);
						let contents = execFileSync("git", ["show", `${ref}:${p}`], {
							encoding: "utf8",
							maxBuffer: 8e6,
						});
						sources[p] = sha(contents);
						if (p === "src/shared/desktop-contract.ts")
							contents +=
								"\nexport const __proofReadOnly = (op: string) => READ_ONLY_OPS.has(op);\n";
						return {
							contents,
							loader: p.endsWith(".json")
								? "json"
								: p.endsWith(".tsx")
									? "tsx"
									: p.endsWith(".ts")
										? "ts"
										: "js",
						};
					});
				},
			},
		],
	});
	const code = out.outputFiles[0].text,
		module = { exports: {} };
	new Function("require", "module", "exports", code)(
		require,
		module,
		module.exports,
	);
	return {
		mod: module.exports,
		moduleBundleSha256: sha(code),
		sourcePins: sources,
	};
}
const [a, b] = await Promise.all(refs.map(load));
const stable = (v) =>
	JSON.stringify(v, (_, x) =>
		typeof x === "function" ? { functionSource: x.toString() } : x,
	);
const oldState = a.mod.useUiPreferencesStore.getState(),
	newState = b.mod.useUiPreferencesStore.getState();
const oldKeys = Object.keys(oldState);
const changedExisting = oldKeys.filter(
	(k) => stable(oldState[k]) !== stable(newState[k]),
);
assert.deepEqual(changedExisting, []);
const addedKeys = Object.keys(newState).filter((k) => !oldKeys.includes(k));
assert.deepEqual(addedKeys.sort(), ["finderFiles", "setFinderFiles"]);
const clone = (v) => JSON.parse(JSON.stringify(v));
const persisted = clone(a.mod.persistedUiPreferences(oldState));
const excludeFinder = (o) =>
	Object.fromEntries(Object.entries(o).filter(([k]) => k !== "finderFiles"));
const projectionRuns = [];
const scenarios = [
	["empty", {}],
	["all-existing-persisted-keys", persisted],
];
// Every existing persisted field is independently perturbed, not a selected
// Hub-only subset. Invalid fields exercise the identical sanitization path.
for (const [key, value] of Object.entries(persisted)) {
	const changed =
		typeof value === "boolean"
			? !value
			: typeof value === "number"
				? value + 7
				: typeof value === "string"
					? value + "-probe"
					: Array.isArray(value)
						? [...value]
						: value;
	scenarios.push([`perturb:${key}`, { ...clone(persisted), [key]: changed }]);
}
for (const [name, seed] of scenarios)
	for (const version of [0, 1, 2, 3]) {
		const oldMigrated = a.mod.migrateUiPreferences(clone(seed), version),
			newMigrated = b.mod.migrateUiPreferences(clone(seed), version);
		assert.equal(
			stable(excludeFinder(oldMigrated)),
			stable(excludeFinder(newMigrated)),
			`migrate ${name} v${version}`,
		);
		const om = a.mod.mergePersistedUiPreferences(oldMigrated, oldState),
			nm = b.mod.mergePersistedUiPreferences(newMigrated, newState);
		const differences = oldKeys.filter((k) => stable(om[k]) !== stable(nm[k]));
		assert.deepEqual(differences, [], `projection ${name} v${version}`);
		projectionRuns.push({
			name,
			version,
			existingKeysCompared: oldKeys.length,
			differences,
		});
	}
const v3 = { ...clone(persisted), unknownSentinel: { preserve: true } };
const migrated = b.mod.migrateUiPreferences(clone(v3), 3);
assert.equal(stable(excludeFinder(migrated)), stable(v3));
const requests = [];
for (const operation of [
	"account",
	"memberships.list",
	"org_agents.list",
	"org_teams.list",
	"org_skills.list",
	"org_skill.get",
])
	requests.push({
		op: "radient.request",
		control: {
			operation,
			...(operation.startsWith("org_") ? { tenant_id: "org-minerva" } : {}),
			...(operation === "org_skill.get"
				? { skill_id: "skill-minerva-deploy" }
				: {}),
		},
	});
requests.push(
	{ op: "capabilities" },
	{ op: "skills.list" },
	{ op: "hub.links" },
);
for (const visibility of ["org", "public"]) {
	const tenantId = visibility === "org" ? "org-minerva" : null;
	requests.push({
		op: "hub.skillPull",
		requestId: "12345678-1234-4123-8123-123456789abc",
		hubId:
			visibility === "org" ? "skill-minerva-deploy" : "skill-release-notes",
		hubSource: "http://127.0.0.1:8127",
		visibility,
		tenantId,
		localAlias: visibility === "org" ? "minerva-deploy" : "release-notes",
		subscribe: true,
		autoPush: true,
		confirmPublicEgress: visibility === "public",
	});
	for (const dryRun of [true, false])
		requests.push({
			op: "hub.skillPublish",
			requestId: "12345678-1234-4123-8123-123456789abc",
			dryRun,
			sourceSkill: "release-notes",
			localAlias: "release-notes-copy",
			visibility,
			tenantId,
			subscribe: true,
			autoPush: false,
			confirmPublicEgress: false,
			...(!dryRun
				? { previewReceipt: "receipt-stub-1", confirmPublish: true }
				: {}),
		});
}
// Direct regression negatives: mismatched destination and missing confirm receipt.
requests.push({
	...requests.find((r) => r.op === "hub.skillPull"),
	visibility: "public",
	tenantId: "org-minerva",
});
requests.push({
	...requests.find((r) => r.op === "hub.skillPublish"),
	dryRun: false,
});
const replay = requests.map((input) => {
	function observe(mod) {
		const p = mod.desktopRequestSchema.safeParse(input);
		return p.success
			? {
					ok: true,
					parsed: p.data,
					endpoint: mod.desktopEndpoint(p.data),
					readOnly: mod.__proofReadOnly(input.op),
					deadlineDetail: mod.desktopRequestDeadlineDetail(input.op, 150000),
				}
			: { ok: false, issues: p.error.issues };
	}
	const old = observe(a.mod),
		incoming = observe(b.mod);
	assert.deepEqual(incoming, old, `request ${input.op}`);
	return { input, result: old, identical: true };
});
assert.equal(
	replay.slice(0, -2).every((r) => r.result.ok),
	true,
	"all captured-shape requests valid",
);
assert.equal(
	replay.slice(-2).every((r) => !r.result.ok),
	true,
	"regression negatives refused",
);
const result = {
	scope:
		"Node-only targeted module compilation/execution, not a native render proof",
	refs,
	modules: [a, b].map((x, i) => ({
		ref: refs[i],
		moduleBundleSha256: x.moduleBundleSha256,
		sourcePins: x.sourcePins,
	})),
	preferences: {
		versions: [a.mod.UI_PREFERENCES_VERSION, b.mod.UI_PREFERENCES_VERSION],
		allExistingStateKeys: oldKeys,
		addedKeys,
		changedExisting,
		allExistingPersistedKeys: Object.keys(persisted),
		v3MigrationChangedOnlyFinderFiles: true,
		projectionRuns,
	},
	requestInputProvenance:
		"Reconstructed from exact use-hub-skills.ts and radient/proxy operation shapes plus stub fixture names; fixed synthetic UUID replaces non-retained original random request IDs. These are NOT claimed as raw recorded wire bodies.",
	replay,
};
writeFileSync(
	"docs/evidence/hub-skills-library/receipts/convergence-runtime-results.json",
	JSON.stringify(result, null, 2) + "\n",
);
console.log(
	JSON.stringify(
		{
			oldKeys: oldKeys.length,
			persistedKeys: Object.keys(persisted).length,
			projectionCases: projectionRuns.length,
			changedExisting,
			addedKeys,
			requestCases: replay.length,
			valid: replay.filter((x) => x.result.ok).length,
			refused: replay.filter((x) => !x.result.ok).length,
			allIdentical: true,
		},
		null,
		2,
	),
);
