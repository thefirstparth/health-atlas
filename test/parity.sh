#!/bin/sh
# Parser parity: the browser parser must match the Python reference value for value.
# sh test/parity.sh <export.zip>     (needs python3 + lxml, node 22+)
set -e
T=$(mktemp -d)
python3 test/reference/parse_health.py "$1" "$T/py.json" >/dev/null
node test/run-node.mjs "$1" "$T/js.json" 2>/dev/null
python3 test/parity.py "$T/py.json" "$T/js.json"
rm -rf "$T"
