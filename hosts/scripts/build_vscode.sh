#!/bin/bash

# Opencode VSCode Extension Build Script
# This script handles the complete build process for the Opencode VSCode extension

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

echo -e "${BLUE}Opencode VSCode Extension Build Script${NC}"
echo "Plugin directory: $PLUGIN_DIR"
echo "Root directory: $ROOT_DIR"

# --- Package manager helpers ---
PNPM_AVAILABLE=false
RUN_PM="npm run"
INSTALL_PM="npm ci || npm install"

if command -v pnpm >/dev/null 2>&1; then
    PNPM_AVAILABLE=true
    RUN_PM="pnpm run"
    INSTALL_PM="pnpm install --frozen-lockfile"
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
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --production      Build for production (default: development)"
            echo "  --skip-binaries   Skip building backend binaries"
            echo "  --skip-tests      Skip running tests"
            echo "  --package-only    Only create the .vsix package (skip compilation)"
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

cd "$PLUGIN_DIR"

# Override version from PLUGIN_VERSION env var if set
if [ -n "${PLUGIN_VERSION:-}" ]; then
    print_status "Overriding version with PLUGIN_VERSION=$PLUGIN_VERSION"
    node -e '
      const fs = require("fs");
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      pkg.version = process.argv[1];
      fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
    ' "$PLUGIN_VERSION"
fi

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

if [ "$SKIP_BINARIES" = false ] && [ "$PACKAGE_ONLY" = false ]; then
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

print_status "Checking for required binaries..."
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

print_status "Creating VSCode extension package..."
VSCE_CMD="vsce"
if ! command -v vsce >/dev/null 2>&1; then
    if command -v npx >/dev/null 2>&1; then
        VSCE_CMD="npx -y @vscode/vsce"
    else
        print_warning "vsce not found and npx unavailable; attempting global install via npm"
        npm install -g @vscode/vsce
    fi
fi

if [ "$BUILD_TYPE" = "production" ]; then
    eval "$VSCE_CMD package --no-dependencies --out 'opencode-vscode-$(date +%Y%m%d-%H%M%S).vsix'"
else
    eval "$VSCE_CMD package --pre-release --no-dependencies --out 'opencode-vscode-dev-$(date +%Y%m%d-%H%M%S).vsix'"
fi

print_status "Build completed successfully!"
print_status "Extension package created in: $PLUGIN_DIR"

shopt -s nullglob
VSIX_FILES=( *.vsix )
shopt -u nullglob
if ((${#VSIX_FILES[@]} > 0)); then
    echo "Packages created:"
    for vsix in "${VSIX_FILES[@]}"; do
        echo "  $vsix"
    done
fi
