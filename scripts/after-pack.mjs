#!/usr/bin/env node
/**
 * The `afterPack` hook: prune the interpreter this build cannot run, then seal
 * the one that survives.
 *
 * Two steps in one hook because electron-builder takes a single `afterPack`, and
 * the order between them is load-bearing: sealing a tree that is about to be
 * deleted is wasted work, and sealing after signing would be too late for
 * anything that changed (see `prune-python-resource.mjs` and
 * `seal-python-resource.mjs`, each of which carries its own measurements).
 *
 * The context shape is resolved the same way the prune step resolves it - a
 * missing `packager.appInfo` is a programming error rather than a build
 * condition, and defaulting here would guess the bundle's name.
 */
import pruneAfterPack from "./prune-python-resource.mjs";
import { sealPackagedPythonTrees } from "./seal-python-resource.mjs";

export default async function afterPack(context) {
	const productFilename = context.packager?.appInfo?.productFilename;
	if (productFilename == null) {
		throw new Error(
			"Cannot prepare the bundled Python: afterPack context has no packager.appInfo.productFilename",
		);
	}
	const pruned = await pruneAfterPack(context);
	const seal = await sealPackagedPythonTrees({
		appOutDir: context.appOutDir,
		productFilename,
		platform: context.electronPlatformName ?? process.platform,
	});
	return { ...pruned, seal };
}
