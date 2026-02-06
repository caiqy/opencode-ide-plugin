#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/hosts/jetbrains-plugin"
GRADLEW="$PLUGIN_DIR/gradlew"

echo "Opencode JetBrains Plugin Build Script"
echo "Plugin directory: $PLUGIN_DIR"

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

echo "=> Building opencode binaries"
"$SCRIPT_DIR/build_opencode.sh"

cd "$PLUGIN_DIR"

# Override version from PLUGIN_VERSION env var if set
GRADLE_VERSION_ARGS=""
if [ -n "${PLUGIN_VERSION:-}" ]; then
    echo "=> Overriding version with PLUGIN_VERSION=$PLUGIN_VERSION"
    GRADLE_VERSION_ARGS="-Pplugin.version=$PLUGIN_VERSION"
fi

echo "=> Building JetBrains plugin"
"$GRADLEW" buildPlugin $GRADLE_VERSION_ARGS "$@"

echo "=> Build completed"
