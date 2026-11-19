#!/bin/sh
# The Hub Skills HTTP matrix, run against the REAL core.
#
# Every line below is a live request and its actual answer, printed as it ran;
# nothing here is transcribed from a previous run. It expects:
#   CORE  the real integration core with hub_skills:1   (e.g. http://127.0.0.1:8131)
#   HUB   the stub hub this directory's harness serves  (e.g. http://127.0.0.1:8127)
#   TOKEN the core's LOCAL_OPERATOR_DESKTOP_TOKEN
#   CFG   the core's LOCAL_OPERATOR_CONFIG_DIR (for the on-disk assertions)
# The core must be freshly configured with
#   values: { radient_base_url: <HUB> }
# so its approved source is the hub's /v1 root.
set -u
CORE=${CORE:-http://127.0.0.1:8131}
HUB=${HUB:-http://127.0.0.1:8127}
TOKEN=${TOKEN:-rig}
CFG=${CFG:-}

say() { printf '\n=== %s ===\n' "$1"; }
req() { curl -s -m 30 -w '\nHTTP %{http_code}\n' "$@"; }
post() { req -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$2" "$CORE$1"; }

say "0. capabilities (the adapter's own promise)"
req -H "Authorization: Bearer $TOKEN" "$CORE/v1/capabilities" | tr ',' '\n' | grep -E 'hub_|HTTP'

say "1. the hub's public catalogue, as the app reads it"
req "$HUB/v1/skills"

say "2. SUBSCRIBE with a VERSIONED source (what the core's own tests pin)"
post /v1/desktop/hub/skills/subscribe '{"request_id":"10000000-0000-4000-8000-000000000001","hub_id":"skill-release-notes","hub_source":"'"$HUB"'/v1","visibility":"public","tenant_id":null,"local_alias":"release-notes"}'
say "2b. the row it wrote, and the disk it did NOT write"
req -H "Authorization: Bearer $TOKEN" "$CORE/v1/desktop/hub/links"
[ -n "$CFG" ] && { echo "skills root:"; ls -la "$CFG/skills" 2>&1 || true; }

say "3. SUBSCRIBE with the UNVERSIONED source the app actually sends (hubSource = apiConfig.radientBaseUrl)"
post /v1/desktop/hub/skills/subscribe '{"request_id":"10000000-0000-4000-8000-000000000002","hub_id":"skill-transcript-audit","hub_source":"'"$HUB"'","visibility":"public","tenant_id":null,"local_alias":"transcript-audit"}'

say "4. PULL with the same unversioned source (the app's own body)"
post /v1/desktop/hub/skills/pull '{"request_id":"10000000-0000-4000-8000-000000000003","hub_id":"skill-transcript-audit","hub_source":"'"$HUB"'","visibility":"public","tenant_id":null,"local_alias":"transcript-audit","subscribe":false,"auto_push":false,"confirm_public_egress":false}'

say "5. PULL with the versioned source (control for case 4)"
post /v1/desktop/hub/skills/pull '{"request_id":"10000000-0000-4000-8000-000000000004","hub_id":"skill-transcript-audit","hub_source":"'"$HUB"'/v1","visibility":"public","tenant_id":null,"local_alias":"transcript-audit","subscribe":false,"auto_push":false,"confirm_public_egress":false}'
[ -n "$CFG" ] && { echo "files:"; find "$CFG/skills" -maxdepth 3 -type f 2>/dev/null; }

say "6. an UPDATE arrives (bump the stub's opaque revision), then a check"
req -X POST -H "Content-Type: application/json" -d '{"id":"skill-transcript-audit","bump":1}' "$HUB/__fixture/revision"
post /v1/desktop/hub/updates/check '{"request_id":"10000000-0000-4000-8000-000000000005","kind":"skill"}'
req -H "Authorization: Bearer $TOKEN" "$CORE/v1/desktop/hub/updates?kind=skill"

say "7. apply it, and read the bytes it wrote"
post /v1/desktop/hub/updates/apply '{"request_id":"10000000-0000-4000-8000-000000000006","kind":"skill","name":"transcript-audit"}'
[ -n "$CFG" ] && tail -3 "$CFG/skills/transcript-audit/SKILL.md"

say "8. a FORCED failure, its row, then Retry once the cause is gone"
req -X POST -H "Content-Type: application/json" -d '{"count":1,"status":500}' "$HUB/__fixture/fail"
post /v1/desktop/hub/updates/check '{"request_id":"10000000-0000-4000-8000-000000000007","kind":"skill","name":"transcript-audit"}'
req -H "Authorization: Bearer $TOKEN" "$CORE/v1/desktop/hub/updates?kind=skill"
req -X POST -H "Content-Type: application/json" -d '{}' "$HUB/__fixture/clear"
post /v1/desktop/hub/updates/retry '{"request_id":"10000000-0000-4000-8000-000000000008","kind":"skill","name":"transcript-audit"}'

say "9. UNSUBSCRIBE (Subscribe switch off) must keep the local files"
# Per-link values, extracted by name: the first row in the inventory is a
# DIFFERENT skill, and its policy revision would make this a 409 (correctly).
read -r LINK REV <<EOF
$(python3 - "$CORE" "$TOKEN" <<'PY'
import json, sys, urllib.request
core, token = sys.argv[1], sys.argv[2]
request = urllib.request.Request(f"{core}/v1/desktop/hub/links", headers={"Authorization": f"Bearer {token}"})
links = json.load(urllib.request.urlopen(request))["result"]["links"]
row = next(link for link in links if link["name"] == "transcript-audit")
print(row["link_id"], row["policy"]["revision"])
PY
)
EOF
echo "link_id=$LINK revision=$REV"
[ -n "$CFG" ] && { echo "before:"; ls "$CFG/skills/transcript-audit"; }
patch_policy() {
  req -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"request_id":"'"$2"'","subscribe":false,"auto_push":false,"expected_policy_revision":"'"$1"'"}' \
    "$CORE/v1/desktop/hub/links/$LINK"
}
OUT=$(patch_policy "$REV" "10000000-0000-4000-8000-000000000012")
printf '%s\n' "$OUT"
case "$OUT" in
  *policy-revision-changed*)
    # A CAS refusal is the contract working: the revision moved between the read
    # and the write (the update runner rewrites the baseline on a cycle). The
    # client's own answer is "reload before saving", so this does exactly that.
    echo "-- 409 policy-revision-changed; re-reading and retrying once, as a client must --"
    read -r LINK REV <<EOF
$(python3 - "$CORE" "$TOKEN" <<'PY'
import json, sys, urllib.request
core, token = sys.argv[1], sys.argv[2]
request = urllib.request.Request(f"{core}/v1/desktop/hub/links", headers={"Authorization": f"Bearer {token}"})
links = json.load(urllib.request.urlopen(request))["result"]["links"]
row = next(link for link in links if link["name"] == "transcript-audit")
print(row["link_id"], row["policy"]["revision"])
PY
)
EOF
    patch_policy "$REV" "10000000-0000-4000-8000-000000000013"
    ;;
esac
[ -n "$CFG" ] && { echo "after (files must still be here):"; ls "$CFG/skills/transcript-audit"; }

say "10. UNPULL removes the copy but keeps link, alias, policy and subscription"
post /v1/desktop/hub/skills/unpull '{"request_id":"10000000-0000-4000-8000-000000000009","link_id":"'"$LINK"'"}'
[ -n "$CFG" ] && { echo "after:"; ls -la "$CFG/skills/transcript-audit" 2>&1 || true; }
req -H "Authorization: Bearer $TOKEN" "$CORE/v1/desktop/hub/links"

say "11. PRIVATE-SCOPE NEGATIVES (unauthenticated / outsider)"
echo "-- an org row is absent from the public list:"
req "$HUB/v1/skills" | grep -c 'skill-org-playbook' || true
echo "-- its detail answers the SAME 404 a nonexistent id answers:"
req "$HUB/v1/skills/skill-org-playbook"
req "$HUB/v1/skills/skill-no-such-id"
echo "-- pull/subscribe an org row with no account:"
post /v1/desktop/hub/skills/subscribe '{"request_id":"10000000-0000-4000-8000-000000000010","hub_id":"skill-org-playbook","hub_source":"'"$HUB"'/v1","visibility":"org","tenant_id":"tenant-outsider","local_alias":"org-playbook"}'
post /v1/desktop/hub/skills/pull '{"request_id":"10000000-0000-4000-8000-000000000011","hub_id":"skill-org-playbook","hub_source":"'"$HUB"'/v1","visibility":"org","tenant_id":"tenant-outsider","local_alias":"org-playbook","subscribe":true,"auto_push":false,"confirm_public_egress":false}'
echo "-- no local baseline was created for it:"
req -H "Authorization: Bearer $TOKEN" "$CORE/v1/desktop/hub/links" | grep -c 'org-playbook' || true
[ -n "$CFG" ] && ls "$CFG/skills/org-playbook" 2>&1 || true

say "12. org_skills.list without a tenant is refused before any read"
post /v1/desktop/radient '{"operation":"org_skills.list","payload":{}}'
