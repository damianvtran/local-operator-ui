// Per-module type erasure only: no bundle, app build, dependency install or boot.
import { transform } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
const old = "43fc66a1b",
	incoming = "51a2eccfb";
const src = (ref, p) =>
	execFileSync("git", ["show", `${ref}:${p}`], {
		encoding: "utf8",
		maxBuffer: 8e6,
	});
const sha = (s) => createHash("sha256").update(s).digest("hex");
const emit = async (s) =>
	(
		await transform(s, {
			loader: "ts",
			format: "esm",
			target: "es2022",
			sourcemap: false,
		})
	).code;
const paths = [
	"src/renderer/src/shared/api/local-operator/desktop-hooks.ts",
	"src/renderer/src/shared/store/ui-preferences-store.ts",
	"src/shared/desktop-contract.ts",
	"src/i18n/keys.gen.ts",
];
const results = [];
for (const p of paths) {
	const a = src(old, p),
		b = src(incoming, p),
		ea = await emit(a),
		eb = await emit(b);
	results.push({
		path: p,
		oldSourceSha256: sha(a),
		incomingSourceSha256: sha(b),
		oldEmittedSha256: sha(ea),
		incomingEmittedSha256: sha(eb),
		emittedEqual: ea === eb,
	});
}
const pref = src(incoming, paths[1]);
// Isolate the explicitly type-only parts of the otherwise runtime preferences delta.
const stripped = pref
	.replace("\ttype FinderPreferences,\n", "")
	.replace("\tfinderFiles: FinderPreferences;\n", "")
	.replace(
		"\tsetFinderFiles: (patch: Partial<FinderPreferences>) => void;\n",
		"",
	);
const ep = await emit(pref),
	eps = await emit(stripped);
results.push({
	proof: "preferences: remove only added type import and two state type fields",
	fullEmittedSha256: sha(ep),
	withoutAddedTypesEmittedSha256: sha(eps),
	equal: ep === eps,
});
// The generated file has ONE real runtime addition (new English canvas import/spread).
// Removing only that runtime addition leaves all new MessageParams declarations in
// place; equality with old emission then proves those remaining additions erased.
const keys = src(incoming, paths[3]);
const withoutCanvas = keys
	.replace('import enUiCanvas from "./catalogues/en/ui.canvas.json";\n', "")
	.replace("\t...enUiCanvas,\n", "");
const eOldKeys = await emit(src(old, paths[3])),
	eTypeKeys = await emit(withoutCanvas);
results.push({
	proof:
		"keys.gen: retain all new MessageParams, remove only runtime canvas import/spread",
	oldEmittedSha256: sha(eOldKeys),
	newWithOnlyTypeDeltaEmittedSha256: sha(eTypeKeys),
	equal: eOldKeys === eTypeKeys,
});
writeFileSync(
	"docs/evidence/hub-skills-library/receipts/convergence-emitted-hashes.json",
	JSON.stringify(
		{
			tool: "existing esbuild.transform; loader ts, format esm, target es2022, no sourcemap",
			old,
			incoming,
			results,
		},
		null,
		2,
	) + "\n",
);
console.log(JSON.stringify(results, null, 2));
