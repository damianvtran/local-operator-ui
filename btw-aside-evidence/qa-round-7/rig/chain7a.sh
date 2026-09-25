#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
echo "===== chain7a start $(date -u +%H:%M:%S) ====="
bash run7.sh btw-r5-clip r7clipnarrow2 800x900
bash run7.sh btw-r5-clip r7clipwide  1380x900
bash run7.sh btw-r6-cap  r7capnarrow 800x900
bash run7.sh btw-r6-cap  r7capwide  1380x900
echo "===== chain7a done $(date -u +%H:%M:%S) ====="
