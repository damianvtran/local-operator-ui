"""Generate offline Unicode RGI picker data from emoji-test.txt and CLDR English annotations.

Usage: python scripts/generate-team-bridge-emoji.py <emoji-test.txt> <annotations.json>
Inputs are downloaded deliberately by the maintainer, never at app build/runtime. Unicode data
is licensed under Unicode License V3 (https://www.unicode.org/license.txt). Keep the server's
pinned Unicode version in sync: a picker must never offer a sequence the reaction API refuses.
"""
import gzip
import hashlib
import json
import pathlib
import re
import sys
import subprocess

source = pathlib.Path(sys.argv[1]).read_text()
annotations = json.loads(pathlib.Path(sys.argv[2]).read_text())["annotations"]["annotations"]
groups, entries = [], []
for line in source.splitlines():
    if line.startswith("# group:"):
        group = line.partition(":")[2].strip()
        if group != "Component":
            groups.append(group)
    if not line or line.startswith("#") or ";" not in line:
        continue
    cps, rest = line.split(";", 1)
    if rest.partition("#")[0].strip() != "fully-qualified":
        continue
    emoji = "".join(chr(int(cp, 16)) for cp in cps.split())
    name = re.split(r" E[0-9.]+ ", rest.partition("#")[2].strip(), maxsplit=1)[1]
    annotation = annotations.get(emoji, annotations.get(emoji.replace("\ufe0f", ""), {}))
    entries.append([emoji, name, groups.index(group), annotation.get("default", [])])
version = re.search(r"# Version: (.+)", source)[1]
data = {"version": version, "sourceSha256": hashlib.sha256(source.encode()).hexdigest(),
        "license": "Unicode License V3: https://www.unicode.org/license.txt", "groups": groups,
        "entries": entries}
out = pathlib.Path("src/renderer/src/features/team-bridge/data/emoji.json")
raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
out.write_bytes(raw)
# Generated data follows the repository formatter, so regeneration is lint-clean.
subprocess.run(["pnpm", "exec", "biome", "format", "--write", str(out)], check=True)
print(f"{len(entries)} RGI sequences; {len(raw)} bytes, {len(gzip.compress(raw))} gzipped; Unicode {version}")
