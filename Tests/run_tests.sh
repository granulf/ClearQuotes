#!/bin/bash
# Runs the parser/engine tests: JavaScript (Node 18+) and Swift (swiftc from Xcode).
#   ./run_tests.sh           offline tests against Tests/fixtures (downloads them once)
#   ./run_tests.sh --live    also runs the Scriptable script against jamesclear.com
#   ./run_tests.sh --refresh re-downloads the fixtures first
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out fixtures

if [[ "${1:-}" == "--refresh" ]] || ! ls fixtures/rest-page-*.json >/dev/null 2>&1; then
  node fetch_fixtures.mjs
fi

node test_parse.mjs
node test_engine.mjs
node test_refresh.mjs
node test_menu.mjs

swiftc -swift-version 5 -O -o out/enginetest ../Shared/QuoteEngine.swift swift/main.swift
./out/enginetest "$PWD"

if [[ "${1:-}" == "--live" ]]; then
  node test_live.mjs
fi
echo "ALL TESTS PASSED"
