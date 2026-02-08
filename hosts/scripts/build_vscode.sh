#!/bin/bash

# Opencode VSCode Extension Build Script
# This script handles the complete build process for the Opencode VSCode extension.
# Supports building two variants:
#   - Standard:  bundles opencode binaries (default)
#   - GUI-only:  no binaries, uses system opencode, embeds webgui-dist
#
# By default both variants are built. Use --gui-only or --standard-only to
# build a single variant.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory references
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/hosts/vscode-plugin"
WEBGUI_DIR="$ROOT_DIR/packages/opencode/webgui"
WEBGUI_DIST="$ROOT_DIR/packages/opencode/webgui-dist"

echo -e "${BLUE}Opencode VSCode Extension Build Script${NC}"
echo "Plugin directory: $PLUGIN_DIR"
echo "Root directory: $ROOT_DIR"

# --- Package manager helpers ---
PNPM_AVAILABLE=false

if command -v pnpm >/dev/null 2>&1; then
    PNPM_AVAILABLE=true
fi

run_install() {
    if $PNPM_AVAILABLE; then
        pnpm install --frozen-lockfile
    else
        npm ci || npm install
    fi
}

run_script() {
    local script="$1"
    if $PNPM_AVAILABLE; then
        pnpm run "$script"
    else
        npm run "$script"
    fi
}

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

if [ ! -f "$PLUGIN_DIR/package.json" ]; then
    print_error "package.json not found. Please run this script from the repository root."
    exit 1
fi

BUILD_TYPE="development"
SKIP_BINARIES=false
SKIP_TESTS=false
PACKAGE_ONLY=false
BUILD_STANDARD=true
BUILD_GUI_ONLY=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --production)
            BUILD_TYPE="production"
            shift
            ;;
        --skip-binaries)
            SKIP_BINARIES=true
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --package-only)
            PACKAGE_ONLY=true
            shift
            ;;
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
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --production      Build for production (default: development)"
            echo "  --skip-binaries   Skip building backend binaries"
            echo "  --skip-tests      Skip running tests"
            echo "  --package-only    Only create the .vsix package (skip compilation)"
            echo "  --gui-only        Build only the gui-only variant (no binaries)"
            echo "  --standard-only   Build only the standard variant (with binaries)"
            echo "  --help            Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

print_status "Building VSCode extension in $BUILD_TYPE mode"
[ "$BUILD_STANDARD" = true ] && print_status "  Variant: standard (with binaries)"
[ "$BUILD_GUI_ONLY" = true ] && print_status "  Variant: gui-only (system opencode)"

cd "$PLUGIN_DIR"

# ─── Shared preparation (compile once, package per-variant) ───────────────

if [ "$PACKAGE_ONLY" = false ]; then
    print_status "Cleaning previous build artifacts..."
    set +e
    if [ ! -d node_modules ]; then
        print_warning "Dependencies not installed; skipping script clean and removing artifacts manually."
        rm -rf out
        rm -f ./*.vsix
    fi

    if [ -d node_modules ]; then
        run_script clean
        if [[ $? -ne 0 ]]; then
            print_warning "Clean command failed, applying fallback removal..."
            rm -rf out
            rm -f ./*.vsix
        fi
    fi
    set -e
fi

if [ "$PACKAGE_ONLY" = false ]; then
    print_status "Installing dependencies..."
    if ! command -v node >/dev/null 2>&1; then
        print_error "Node.js is required but not found in PATH. Please install Node.js."
        exit 1
    fi
    run_install
fi

if [ "$SKIP_BINARIES" = false ] && [ "$PACKAGE_ONLY" = false ] && [ "$BUILD_STANDARD" = true ]; then
    print_status "Building backend binaries..."
    "$SCRIPT_DIR/build_opencode.sh"
fi

if [ "$PACKAGE_ONLY" = false ]; then
    print_status "Compiling TypeScript..."
    if [ "$BUILD_TYPE" = "production" ]; then
        run_script compile:production
    else
        run_script compile
    fi
fi

if [ "$PACKAGE_ONLY" = false ]; then
    print_status "Running linter..."
    set +e
    run_script lint
    if [[ $? -ne 0 ]]; then
        print_warning "Linting failed, continuing with build..."
    fi
    set -e
fi

if [ "$SKIP_TESTS" = false ] && [ "$PACKAGE_ONLY" = false ]; then
    print_status "Running tests..."
    set +e
    run_script test
    if [[ $? -ne 0 ]]; then
        print_warning "Tests failed, continuing with build..."
    fi
    set -e
fi

# ─── Resolve vsce command ────────────────────────────────────────────────

VSCE_CMD="vsce"
if ! command -v vsce >/dev/null 2>&1; then
    if command -v npx >/dev/null 2>&1; then
        VSCE_CMD="npx -y @vscode/vsce"
    else
        print_warning "vsce not found and npx unavailable; attempting global install via npm"
        npm install -g @vscode/vsce
    fi
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

# ─── Build helper: package a single variant ──────────────────────────────

build_variant() {
    local variant="$1"   # "standard" or "gui-only"

    cd "$PLUGIN_DIR"

    if [ "$variant" = "standard" ]; then
        print_status "=== Packaging STANDARD variant ==="

        # Check for required binaries
        BINARY_PATHS=(
            "resources/bin/windows/amd64/opencode.exe"
            "resources/bin/macos/amd64/opencode"
            "resources/bin/macos/arm64/opencode"
            "resources/bin/linux/amd64/opencode"
            "resources/bin/linux/arm64/opencode"
        )

        MISSING_BINARIES=false
        for binary_path in "${BINARY_PATHS[@]}"; do
            if [ ! -f "$binary_path" ]; then
                print_warning "Missing binary: $binary_path"
                MISSING_BINARIES=true
            fi
        done

        if [ "$MISSING_BINARIES" = true ]; then
            print_warning "Some binaries are missing. The extension may not work on all platforms."
            print_warning "Run '$SCRIPT_DIR/build_opencode.sh' from the root directory to build all binaries."
        fi

        # Package with original package.json and .vscodeignore
        if [ "$BUILD_TYPE" = "production" ]; then
            eval "$VSCE_CMD package --no-dependencies --out 'opencode-vscode-${TIMESTAMP}.vsix'"
        else
            eval "$VSCE_CMD package --pre-release --no-dependencies --out 'opencode-vscode-dev-${TIMESTAMP}.vsix'"
        fi

    elif [ "$variant" = "gui-only" ]; then
        print_status "=== Packaging GUI-ONLY variant ==="

        # Always rebuild webgui to pick up source changes
        # The monorepo uses bun workspaces – deps are already installed at root level
        print_status "Building webgui..."
        if command -v bun >/dev/null 2>&1; then
            (cd "$WEBGUI_DIR" && bun run build)
        else
            (cd "$WEBGUI_DIR" && npm run build)
        fi

        if [ ! -d "$WEBGUI_DIST" ]; then
            print_error "webgui-dist not found at $WEBGUI_DIST after build"
            return 1
        fi

        # Copy webgui-dist into plugin resources for embedding
        print_status "Embedding webgui-dist into plugin resources..."
        rm -rf "$PLUGIN_DIR/resources/webgui-app"
        cp -r "$WEBGUI_DIST" "$PLUGIN_DIR/resources/webgui-app"

        # Move binaries completely outside the plugin tree so vsce cannot bundle them
        BIN_STASH="$(mktemp -d)"
        if [ -d "$PLUGIN_DIR/resources/bin" ]; then
            mv "$PLUGIN_DIR/resources/bin" "$BIN_STASH/bin"
        fi

        # Temporarily swap package.json with gui-only overrides and .vscodeignore
        cp "$PLUGIN_DIR/package.json" "$PLUGIN_DIR/package.json.bak"
        cp "$PLUGIN_DIR/.vscodeignore" "$PLUGIN_DIR/.vscodeignore.bak"

        # Ensure originals are restored even on failure
        gui_only_cleanup() {
            cd "$PLUGIN_DIR"
            [ -f package.json.bak ] && mv package.json.bak package.json
            [ -f .vscodeignore.bak ] && mv .vscodeignore.bak .vscodeignore
            [ -d "$BIN_STASH/bin" ] && mv "$BIN_STASH/bin" resources/bin
            rm -rf "$BIN_STASH"
            rm -rf resources/webgui-app
        }
        trap gui_only_cleanup EXIT

        # Deep-merge gui-only overrides into package.json
        node -e "
            const fs = require('fs');
            function deep(target, src) {
                for (const key of Object.keys(src)) {
                    const s = src[key];
                    const t = target[key];
                    if (Array.isArray(s) && Array.isArray(t)) {
                        for (let i = 0; i < s.length; i++) {
                            if (i < t.length && typeof s[i] === 'object' && typeof t[i] === 'object') {
                                deep(t[i], s[i]);
                            } else {
                                t[i] = s[i];
                            }
                        }
                    } else if (s && typeof s === 'object' && !Array.isArray(s) && t && typeof t === 'object' && !Array.isArray(t)) {
                        deep(t, s);
                    } else {
                        target[key] = s;
                    }
                }
                return target;
            }
            const base = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            const overrides = JSON.parse(fs.readFileSync('package.gui-only.json', 'utf8'));
            fs.writeFileSync('package.json', JSON.stringify(deep(base, overrides), null, 2) + '\n');
        "

        # Swap .vscodeignore
        cp "$PLUGIN_DIR/.vscodeignore.gui-only" "$PLUGIN_DIR/.vscodeignore"

        # Package gui-only variant
        if [ "$BUILD_TYPE" = "production" ]; then
            eval "$VSCE_CMD package --no-dependencies --out 'opencode-vscode-gui-only-${TIMESTAMP}.vsix'"
        else
            eval "$VSCE_CMD package --pre-release --no-dependencies --out 'opencode-vscode-gui-only-dev-${TIMESTAMP}.vsix'"
        fi

        # Restore originals (also handled by trap on failure)
        gui_only_cleanup
        trap - EXIT

        print_status "GUI-only variant packaged successfully"
    fi
}

# ─── Build requested variants ────────────────────────────────────────────

if [ "$BUILD_STANDARD" = true ]; then
    build_variant "standard"
fi

if [ "$BUILD_GUI_ONLY" = true ]; then
    build_variant "gui-only"
fi

print_status "Build completed successfully!"
print_status "Extension packages created in: $PLUGIN_DIR"

shopt -s nullglob
VSIX_FILES=( "$PLUGIN_DIR"/*.vsix )
shopt -u nullglob
if ((${#VSIX_FILES[@]} > 0)); then
    echo "Packages created:"
    for vsix in "${VSIX_FILES[@]}"; do
        echo "  $(basename "$vsix")"
    done
fi
