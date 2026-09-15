/*
 * The app -> backend hop, measured rather than asserted.
 *
 * WHY THIS EXISTS. The claim this change makes about the app is that the switch
 * set at LAUNCH reaches the backend the app spawns. That hop crosses two things
 * which can quietly replace it: `backend/config.ts` folds a `.env` from the
 * working directory with dotenv `override: true` AFTER the launch, and
 * `backend-service.ts::loadMacOSEnvironment` merges the operator's shell rc over
 * that. Reading the source can only show that the fold happens; it cannot show
 * what the child ends up with, which is what the backend actually reads.
 *
 * WHAT IT DOES. Loaded into the Electron main process with
 * `NODE_OPTIONS=--require` (Electron honours it for the main process - measured),
 * it records three things to $LO_HOP_LOG:
 *
 *   launch     the value this process was handed, at load, plus the cwd it will
 *              fold a `.env` from and whether that file is there at all;
 *   folded@N   the same key N ms later, i.e. after the fold - the value the app
 *              itself now believes, and the one that used to be handed on;
 *   spawn      the environment of EVERY child the app spawns, which is where
 *              the backend's launch appears (`python3 -c ... serve --port N`)
 *              beside the shell-environment probe (`bash -c ...`).
 *
 * It records and calls through: nothing is replaced, the app runs normally and
 * the backend it starts is a real one. The runs in `transcript-launch-hop.txt`
 * used a scratch HOME, config dir, log dir and `--user-data-dir`, and the port
 * was a scratch one baked into the build, so no live session is involved.
 */
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const LOG = process.env.LO_HOP_LOG;
const KEY = "LOCAL_OPERATOR_NO_NOTIFICATIONS";
const write = (line) => fs.appendFileSync(LOG, `${line}\n`);

write(
	`launch  ${KEY}=${JSON.stringify(process.env[KEY])} ` +
		`cwd=${process.cwd()} envExists=${fs.existsSync(path.join(process.cwd(), ".env"))}`,
);

// After the app's own startup, so the `.env` fold in `backend/config.ts` has
// run: the same key, read again in the same process.
for (const ms of [1500, 4000, 8000]) {
	setTimeout(() => {
		write(`folded@${ms}  ${KEY}=${JSON.stringify(process.env[KEY])}`);
	}, ms);
}

for (const name of ["spawn", "spawnSync"]) {
	const original = cp[name];
	cp[name] = function (command, args, options) {
		const env = (options && options.env) || {};
		write(
			`spawn   ${name} ${JSON.stringify(String(command).split("/").pop())} ` +
				`dir=${Array.isArray(args) ? JSON.stringify(args[0]).slice(0, 40) : "?"} ` +
				`child ${KEY}=${JSON.stringify(env[KEY])} (env keys: ${Object.keys(env).length})`,
		);
		return original.apply(this, arguments);
	};
}
