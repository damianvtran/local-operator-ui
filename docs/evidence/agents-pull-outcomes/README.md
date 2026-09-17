# Pulling from the hub: four outcomes, told apart

The pull's only visible surface is a toast plus the navigation that follows it,
and every outcome used to read the same way: the mutation's own words ("Agent
downloaded") over the name the user REQUESTED. Two of those outcomes are not
clean successes, and one is a refusal whose reason was hidden behind a transport
prefix — contract §0.2 D-4 and §3.6:

- **A pulled agent can land under a name this machine already holds.**
  `import_agent` skips the registry's name check, and the local lookup is exact
  and case-sensitive, so `Coder` beside `coder` is legal and the profile resolver
  then picks one of them arbitrarily. The backend's fix (import as
  `"<name> (2)"`, and return `renamed_from`) is not on `main` yet, so the renderer
  must behave honestly in BOTH states: report the name it was told was created,
  and when it can see the name is now held twice, say so instead of reporting a
  clean success.
- **A refusal arrived as transport prose.** `Download agent from Radient failed:
  Error downloading agent from Radient: ...` names the route it came from and
  repeats itself. The reason is what is left after those prefixes.

## What produced these frames

Storybook built from this tree, through the repo's own capturer, all twelve
themes, one narrowed (append-mode) pass:

```
pnpm storybook --ci -p 6017
node scripts/capture-evidence.mjs --only=agents-pull-outcomes --allow-backend
```

Each story mounts the SHIPPED `useDownloadAgentMutation` — the real hook, the
real `AgentsApi`, the real toast manager — over a stubbed desktop transport that
answers the `legacy.agent.download` op, and `toastDuration: Infinity` holds the
toast open because an auto-closed toast is a frame that cannot be reproduced.
That mechanism and the reason it exists are `scripts/toast-lifetime.test.mjs`'s.

## The frames

| Frame | What it is |
|---|---|
| `downloaded/` | The clean case: the agent arrived under the hub's own name. |
| `adjusted-name/` | The backend renamed it (`renamed_from`), and the receipt quotes the name the pulled one collided with. |
| `already-held/` | The same situation on a backend that has NOT disambiguated: the row landed beside a name this machine already holds, and the warning says two agents now answer to that name. |
| `refused/` | A refusal with a code (`agent_not_found`): the listing is gone, nothing was downloaded, and nothing is worth retrying. |
| `refused-prose/` | An older backend's single prose refusal, with the transport's prefixes stripped so the reason is what remains. |

## What these frames do NOT prove

- **The navigation.** On success the app routes to the created row's id
  (`/chat/<id>`), which is what makes the toast and the page agree; a still cannot
  show a route change, and the end-to-end run in the pull request is where the
  created row is shown (two rows named `ok-agent` after two pulls of one listing).
- **That the hub produces `renamed_from`.** It is the agreed backend contract
  (§3.6) and is not implemented yet, so `adjusted-name/` is a fixture of the
  shape rather than a recording of the backend — which is exactly why the hook
  has the second, cache-based arm that `already-held/` shows.
- **That the cache arm fires in the app.** These stories seed the React Query
  cache the same way a loaded agents list does, but whether the list is loaded
  when a user clicks Download depends on which surfaces they have visited; the
  hook reads the cache and reports nothing when it is empty, by design.
- **Nothing about ordering, stacking or lifetime** of the toasts, which
  `scripts/toast-lifetime.test.mjs` owns.
