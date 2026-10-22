#!/usr/bin/env bash
# Runs once when the codespace is created: install and build the game.
set -euo pipefail
cd "$(dirname "$0")/.."
npm install --global --ignore-scripts npm@12.1.0
npm ci --ignore-scripts
npm run build-prod
