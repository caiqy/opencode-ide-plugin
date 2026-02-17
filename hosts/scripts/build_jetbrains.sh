#!/usr/bin/env bash
set -euo pipefail

# Opencode JetBrains Plugin Build Script
# Standard only: bundles opencode binaries.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/hosts/jetbrains-plugin"
GRADLEW="$PLUGIN_DIR/gradlew"

SKIP_BINARIES=false
EXTRA_ARGS=()
GRADLE_VERSION_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-binaries)
      SKIP_BINARIES=true
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --skip-binaries   Skip building backend binaries"
      echo "  --help            Show this help message"
      exit 0
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

echo "Opencode JetBrains Plugin Build Script"
echo "Plugin directory: $PLUGIN_DIR"
echo "  Variant: standard (with binaries)"

if [ -n "${PLUGIN_VERSION:-}" ]; then
  echo "=> Overriding version with PLUGIN_VERSION=$PLUGIN_VERSION"
  GRADLE_VERSION_ARGS=(-Pplugin.version="$PLUGIN_VERSION")
fi

echo "=> Verifying JetBrains plugin workspace"
if [ ! -d "$PLUGIN_DIR" ]; then
  echo "Error: JetBrains plugin directory not found at $PLUGIN_DIR" >&2
  exit 1
fi

if [ ! -x "$GRADLEW" ] && [ -f "$GRADLEW" ]; then
  chmod +x "$GRADLEW"
fi

if [ ! -f "$GRADLEW" ]; then
  echo "Error: gradlew not found at $GRADLEW" >&2
  exit 1
fi

echo "=> Building standard variant"
if [ "$SKIP_BINARIES" = false ]; then
  echo "=> Building opencode binaries"
  "$SCRIPT_DIR/build_opencode.sh"
fi

cd "$PLUGIN_DIR"
"$GRADLEW" clean buildPlugin "${GRADLE_VERSION_ARGS[@]}" "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
echo "=> Standard variant built"

echo "=> Build completed"

# List output artifacts
shopt -s nullglob
ARTIFACTS=( "$PLUGIN_DIR"/build/distributions/*.zip )
shopt -u nullglob
if ((${#ARTIFACTS[@]} > 0)); then
  echo "Artifacts:"
  for a in "${ARTIFACTS[@]}"; do
    echo "  $(basename "$a")"
  done
fi
