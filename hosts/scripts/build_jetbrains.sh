#!/usr/bin/env bash
set -euo pipefail

# Opencode JetBrains Plugin Build Script
# Supports building two variants:
#   - Standard:  bundles opencode binaries (default)
#   - GUI-only:  no binaries, uses system opencode, embeds webgui-dist
#
# By default both variants are built. Use --gui-only or --standard-only to
# build a single variant.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/hosts/jetbrains-plugin"
GRADLEW="$PLUGIN_DIR/gradlew"
WEBGUI_DIR="$ROOT_DIR/packages/opencode/webgui"
WEBGUI_DIST="$ROOT_DIR/packages/opencode/webgui-dist"

BUILD_STANDARD=true
BUILD_GUI_ONLY=true
SKIP_BINARIES=false
EXTRA_ARGS=()
GRADLE_VERSION_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --gui-only)
      BUILD_STANDARD=false
      BUILD_GUI_ONLY=true
      shift
      ;;
    --standard-only)
      BUILD_STANDARD=true
      BUILD_GUI_ONLY=false
      shift
      ;;
    --skip-binaries)
      SKIP_BINARIES=true
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo "Options:"
      echo "  --gui-only        Build only the gui-only variant (no binaries)"
      echo "  --standard-only   Build only the standard variant (with binaries)"
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
[ "$BUILD_STANDARD" = true ] && echo "  Variant: standard (with binaries)"
[ "$BUILD_GUI_ONLY" = true ] && echo "  Variant: gui-only (system opencode)"

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

# ─── Standard variant ────────────────────────────────────────────────────

if [ "$BUILD_STANDARD" = true ]; then
  echo "=> Building standard variant"
  if [ "$SKIP_BINARIES" = false ]; then
    echo "=> Building opencode binaries"
    "$SCRIPT_DIR/build_opencode.sh"
  fi

  cd "$PLUGIN_DIR"
  "$GRADLEW" clean buildPlugin "${GRADLE_VERSION_ARGS[@]}" "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
  echo "=> Standard variant built"
fi

# ─── GUI-only variant ────────────────────────────────────────────────────

if [ "$BUILD_GUI_ONLY" = true ]; then
  echo "=> Building gui-only variant"

  # Build webgui if webgui-dist doesn't exist yet
  if [ ! -d "$WEBGUI_DIST" ] || [ -z "$(ls -A "$WEBGUI_DIST" 2>/dev/null)" ]; then
    echo "=> Building webgui..."
    cd "$WEBGUI_DIR"
    if command -v bun >/dev/null 2>&1; then
      bun run build
    elif command -v pnpm >/dev/null 2>&1; then
      pnpm run build
    else
      npm run build
    fi
  fi

  if [ ! -d "$WEBGUI_DIST" ]; then
    echo "Error: webgui-dist not found at $WEBGUI_DIST after build" >&2
    exit 1
  fi

  cd "$PLUGIN_DIR"
  "$GRADLEW" buildPlugin "${GRADLE_VERSION_ARGS[@]}" -PguiOnly=true "-PwebguiDist=$WEBGUI_DIST" "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
  echo "=> GUI-only variant built"
fi

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
