#!/usr/bin/env node
/**
 * Make the packaged interpreter trees refuse bytecode writes, before signing.
 *
 * Why this is a build step and not only the app's own job: the app applies the
 * same seal from `src/main/backend/backend-installer.ts`, at runtime, and that
 * is exactly the hole. Measured on the operator's machine, 2026-09-14 - the
 * `backend-installer.log` has `Bundled interpreter trees sealed against bytecode
 * writes: /Applications/Local Operator.app/Contents/Resources/python_aarch64;
 * 134 directory path(s) selected and now refusing new entries` at 08:37:24,
 * 08:38:23, 09:03:28 and 09:32:10, an in-app update replaced the bundle at
 * 09:48, and nothing after it: every in-place update swaps in a fresh copy that
 * carries no access-control entries, so a freshly installed bundle is born
 * writable and only becomes sealed if and when the installer happens to run
 * again. Checked against the shipped artifact itself - a real copy of the 0.22.2
 * app out of the signed DMG has a bare mode line on
 * `Contents/Resources/python_aarch64` and on `.../lib/python3.12`, and `touch`
 * succeeds at every level. The bundle that macOS then refused as "damaged" was
 * unsealed from the moment it landed.
 *
 * `afterPack` is the right seam: it runs after the files are copied and after
 * `scripts/prune-python-resource.mjs` has removed the tree this architecture
 * cannot run, and BEFORE signing. Access-control entries are not sealed
 * resources - measured, a sealed tree still gives `codesign --verify --deep`
 * exit 0 with no violations - and the seal grants `delete_child`, so the app can
 * still delete itself and the update-time heal can still remove a stray `.pyc`.
 *
 * What it does NOT cover, stated so it is not read as more than it is: ACLs are
 * filesystem metadata, so anything that copies the tree without them loses the
 * seal. `ditto` and a disk image built from a `ditto`ed folder keep them
 * (measured: `ls -lde` on the mounted image shows the entry, and a write into it
 * is refused), while `cp -R` and a ZIP archive drop them - the in-app
 * auto-update path stages `update.zip`, so a bundle that arrived that way is
 * unsealed until the app runs again. That is why the runtime seal stays: it is
 * the repair path, and this step is the one that makes the shipped artifact
 * refuse the write in the first place.
 *
 * The seal itself is the app's own implementation, bundled from the shipped
 * TypeScript in memory rather than reimplemented here: a second copy of the
 * rights set is how the build and the app would come to disagree about what
 * "sealed" means.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The tree names a packaged app can carry, in the app's own spelling. */
const PYTHON_TREE_NAMES = ["python", "python_aarch64"];

/** The bundled module, built once per process. */
let sealModulePromise = null;

/**
 * The app's `python-bytecode-cache` module, bundled in memory.
 *
 * Bundled rather than imported: it is TypeScript, and the alternative - reading
 * the `.ts` and matching on its text - would be a second implementation of the
 * thing being asserted.
 */
function loadSealModule() {
	if (!sealModulePromise) {
		sealModulePromise = (async () => {
			const bundle = await build({
				stdin: {
					contents: 'export * from "./src/main/python-bytecode-cache";',
					resolveDir: ROOT,
				},
				bundle: true,
				format: "esm",
				platform: "node",
				write: false,
			});
			return await import(
				`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
			);
		})();
	}
	return sealModulePromise;
}

/** The packaged app's resources directory, where `extraResources` land. */
export function pythonResourcesDir(appOutDir, productFilename) {
	return join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
}

/**
 * Seal every interpreter tree the packaged app carries.
 *
 * Throws when a tree that IS there could not be sealed: an unsealed tree in a
 * release artifact is the failure this step exists to prevent, and a build that
 * cannot produce a sealed artifact must fail here rather than ship a bundle that
 * unseals itself on first use. A build carrying no tree at all is a different
 * case and is reported rather than thrown - see the branch below, which names the
 * check that refuses the artifact and why failing here would break local
 * packaging.
 */
export async function sealPackagedPythonTrees({
	appOutDir,
	productFilename,
	platform = process.platform,
	log = console.log,
}) {
	if (platform !== "darwin") {
		log(`Skipping the interpreter tree seal: not macOS (${platform})`);
		return { supported: false, sealed: [], directories: 0, failures: [] };
	}
	const resourcesDir = pythonResourcesDir(appOutDir, productFilename);
	const module = await loadSealModule();
	const trees = PYTHON_TREE_NAMES.map((name) => join(resourcesDir, name));
	const seal = module.sealPythonInterpreterTrees(trees);
	if (seal.sealed.length === 0) {
		/*
		 * Not this step's failure, and deliberately not a throw.
		 *
		 * A checkout that has not downloaded the interpreters (`pnpm setup-python`,
		 * which `publish.yml` runs before the release build) packs an app with no
		 * bundled interpreter at all - there is nothing here that could write bytecode
		 * into anything, and the artifact that comes out is refused by the release
		 * gate (`app-one-bundled-python` in `scripts/verify-macos-artifacts.mjs`, which
		 * names the interpreter the bundle's architecture needs). Throwing would also
		 * break `pnpm exec electron-builder --dir --arm64`, which this repository's
		 * AGENTS.md documents for local packaging on a machine that has no interpreter
		 * tree to seal, and which has always produced an app with no backend rather
		 * than an error.
		 */
		log(
			`Nothing to seal: no bundled interpreter tree under ${resourcesDir}. Run \`pnpm setup-python\` before packaging a release - a released app without one is refused by the artifact gate as app-one-bundled-python.`,
		);
		return seal;
	}
	if (seal.failures.length > 0) {
		throw new Error(
			`Cannot seal every path under ${seal.sealed.join(", ")}: ${seal.failures.join("; ")}. Every directory under a bundled interpreter tree must refuse add_file/add_subdirectory before the bundle is signed, and a partial seal leaves the rest writing bytecode into a code-sealed bundle.`,
		);
	}
	log(
		`Sealed the bundled interpreter trees against bytecode writes: ${seal.sealed.join(", ")}; ${seal.directories} directory path(s) now refuse new entries and ${seal.bytecodeFiles} bytecode file(s) are refused a rewrite`,
	);
	return seal;
}
