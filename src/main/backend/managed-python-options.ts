/**
 * The managed-Python options for THIS process's instance.
 *
 * WHY ITS OWN MODULE. Two callers need these four values and they are not the same
 * shape of caller: `BackendInstaller` builds the instance's environment, and
 * `UpdateService` publishes a NEW generation beside the published one. The second
 * needs four path fields and nothing else, and reaching for them through
 * `./backend-installer` would drag that module's whole install lifecycle into the
 * update path - the three platform install scripts as raw imports, the modal
 * progress window, the `app.exit(1)` cancel path - which the update path must not
 * have (an update that can quit the app is not an update that leaves the runtimes
 * running). Measured, not argued: the first version of this change imported the
 * installer from `update-service.ts` and `scripts/update-robustness.test.mjs`'s
 * esbuild bundle of the update service failed with "No loader is configured for
 * `.sh` files".
 *
 * WHY ONE FUNCTION AND NOT TWO DERIVATIONS. These values decide WHICH environment
 * this instance builds and reads: `packaged` is the packaged/dev split, and
 * `resources` is where the interpreter seed lives. A second answer to "which
 * environment is this instance's" is how a dev instance's install once landed
 * inside the packaged app's tree, so both callers read this one function.
 */
import { join } from "node:path";
import { app } from "electron";
import type { ManagedPythonOptions } from "./managed-python";

export function managedPythonOptions(): ManagedPythonOptions {
	return {
		support: join(
			app.getPath("home"),
			"Library",
			"Application Support",
			"Local Operator",
		),
		resources: !app.isPackaged
			? join(process.cwd(), "resources")
			: join(process.resourcesPath),
		packaged: app.isPackaged,
		arch: process.arch,
	};
}
