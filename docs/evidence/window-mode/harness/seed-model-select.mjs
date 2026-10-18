#!/usr/bin/env node
/**
 * Extra seeding for the Settings model-select driver: the operator's own
 * state, on an isolated store.
 *
 *     node seed-model-select.mjs <scratch-root>
 *
 * Run by `run.sh` through `EXTRA_SEED`, after the standard `seed.mjs`, into the
 * same scratch root. Three things are seeded, and each one is the product's own
 * mechanism rather than a fixture poked into the UI:
 *
 *  1. `config/config.yml` — `hosting: openai` and `model_name:
 *     openai/gpt-6.1-sol`. That pair is the operator's report: a saved
 *     provider-qualified value (`openai/gpt-6.1-sol`) on the OpenAI hosting
 *     provider. It is also what makes the app boot into chat/Settings instead
 *     of the first-run wizard, the same way `seed-model-picker.mjs` binds
 *     OpenRouter there.
 *  2. `config/auth.db` — ONE synthetic OpenAI OAuth credential written through
 *     the backend's own `AuthStore`. The `/v1/models` route resolves the
 *     listing credential through that store's cascade, and only an OAuth row
 *     carries the account id that selects ChatGPT's account-scoped catalogue
 *     (`ProviderController.listing_credential`). No live provider is contacted:
 *     the credential authorizes the READ of the catalogue below, and the
 *     synthetic token is never sent anywhere.
 *  3. `home/.local-operator/cache/openai.oauth.<account-scope>.listing.json` —
 *     the native-shaped OpenAI listing, written through the discovery cache's
 *     OWN writer (`local_operator.model.catalogue._write_cache`) under the key
 *     its own reader derives (`discovery._cache_key`, `listing_capture_version`).
 *     This is the mechanism the catalogue cache already documents for offline
 *     use (`catalogue.py` state machine rule 1: a fresh document is served with
 *     no request), and it is what QA's credentialed seed did for a cached
 *     `openrouter` listing. The one row is the pair this change's own
 *     regression test pins — id `gpt-6.1-sol`, label `GPT 6.1 Sol` — so both
 *     trees are photographed against the same catalogue.
 *
 * The Python half runs on the SAME interpreter the `local-operator` launcher
 * runs on (derived from its shebang), with HOME / LOCAL_OPERATOR_CONFIG_DIR /
 * LOCAL_OPERATOR_HOME pointed into the scratch root first — the catalogue cache
 * resolves from HOME, not from the config dir (`catalogue.default_cache_dir()`),
 * so nothing outside the scratch root is read or written.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = process.argv[2];
if (!root) {
	console.error("usage: seed-model-select.mjs <scratch-root>");
	process.exit(1);
}
const SCRATCH = resolve(root);
const CONFIG = join(SCRATCH, "config");
const HOME = join(SCRATCH, "home");
if (CONFIG === join(homedir(), ".local-operator")) {
	console.error("refusing to seed into the live config dir");
	process.exit(1);
}
mkdirSync(CONFIG, { recursive: true });
mkdirSync(HOME, { recursive: true });

/* 1. The stored provider-qualified value, on its hosting provider.
 *
 * The `values:` mapping is the canonical home of EVERY setting
 * (`config.py`: "EVERY setting is read from `values`"), so a top-level
 * `hosting:`/`model_name:` pair - the shape `seed-model-picker.mjs` used for
 * the chat boot check - reads as an empty setting on the Settings page. The
 * earlier shape cost a whole capture attempt: `values.hosting` stayed empty,
 * the model row rendered disabled-empty, and the run's first wait never held.
 */
writeFileSync(
	join(CONFIG, "config.yml"),
	[
		"values:",
		"  hosting: openai",
		'  model_name: "openai/gpt-6.1-sol"',
		"",
	].join("\n"),
);

/* 2 + 3. The credential and the catalogue document, through the backend's own
 * code. Derived from the launcher's shebang so this seeds the exact
 * interpreter the harness's `local-operator serve` runs on. */
const launcher = execFileSync(
	"/bin/bash",
	["-c", "command -v local-operator"],
	{
		encoding: "utf8",
	},
).trim();
const shebang = readFileSync(launcher, "utf8").split("\n", 1)[0];
if (!shebang.startsWith("#!")) {
	console.error(`cannot derive the backend interpreter from ${launcher}`);
	process.exit(1);
}
const python = shebang.slice(2).trim();

const PY_SOURCE = String.raw`
import dataclasses
import os
import time
from pathlib import Path

from local_operator.model import catalogue as catalogue_mod
from local_operator.model import discovery
from local_operator.providers.auth_store import AuthStore
from local_operator.providers.registry import credential_provider_id

config_dir = Path(os.environ["LOCAL_OPERATOR_CONFIG_DIR"])
account_id = "synthetic-sol-account"
now_ms = int(time.time() * 1000)

# One OAuth row: the kind that carries the account scope
# ProviderController.listing_credential reports to the listing route. The
# token is synthetic and is never sent: the cache document below is fresh, so
# the catalogue is served with no request at all (catalogue.py rule 1).
store = AuthStore(db_path=config_dir / "auth.db")
row = store.upsert_credential(
    "openai",
    {
        "type": "oauth",
        "access": "synthetic-openai-access-token",
        "refresh": "synthetic-openai-refresh-token",
        "expires": now_ms + 6 * 3600 * 1000,
        "authorized_at": now_ms,
        "account_id": account_id,
        "org_id": account_id,
        "email": "synthetic-sol@example.invalid",
    },
)
print(f"seeded credential row {row.id} ({row.provider}, {row.credential_type})")
store.close()

# The native listing document, at the key the route's own reader derives, in
# the shape and capture stamp the discovery writer uses.
storage_id = credential_provider_id("openai")
key = discovery._cache_key(storage_id, account_scoped=True, account_id=account_id)
capture = discovery.listing_capture_version("openai")
model = discovery.DiscoveredModel(
    id="gpt-6.1-sol",
    name="GPT 6.1 Sol",
    context_window=872000,
    default_context_window=500000,
    max_context_window=872000,
    supports_images=True,
)
payload = {"capture": capture, "models": [dataclasses.asdict(model)]}
path = catalogue_mod._cache_path(key, catalogue_mod.default_cache_dir())
catalogue_mod._write_cache(path, payload)
print(f"seeded catalogue document {path}")
`;

execFileSync(python, ["-c", PY_SOURCE], {
	env: {
		...process.env,
		HOME,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG,
		LOCAL_OPERATOR_HOME: HOME,
	},
	stdio: ["ignore", "inherit", "inherit"],
});
console.log(join(CONFIG, "config.yml"));
