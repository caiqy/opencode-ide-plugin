#!/bin/bash

# Opencode VSCode Extension Development Workflow Script
# Provides common development tasks for the Opencode VSCode extension

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/hosts/vscode-plugin"
EXTENSION_ID="opencode.opencode"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

echo -e "${BLUE}Opencode VSCode Extension Development Script${NC}"

PNPM_AVAILABLE=false
PM_RUN="npm run"
PM_INSTALL="npm ci || npm install"

if command -v pnpm >/dev/null 2>&1; then
    PNPM_AVAILABLE=true
    PM_RUN="pnpm run"
    PM_INSTALL="pnpm install --frozen-lockfile"
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

if [[ ! -f "$PLUGIN_DIR/package.json" ]]; then
    log_error "package.json not found. Please run this script from the repository root."
    exit 1
fi

cd "$PLUGIN_DIR"

show_help() {
    cat <<EOF
Usage: $0 <command>

Commands:
  setup         Install dependencies and tooling
  build         Build the extension for development
  watch         Start TypeScript compiler in watch mode
  test          Run all tests
  test:watch    Run tests in watch mode (requires inotifywait on Linux)
  lint          Run ESLint
  lint:fix      Run ESLint with auto-fix
  clean         Clean build artifacts
  package       Build binaries and create a dev package
  install       Install the latest .vsix into VSCode
  uninstall     Uninstall the extension from VSCode
  logs          Show VSCode extension log folder
  debug         Show debugging hints
  help          Show this message
EOF
}

cmd="${1:-help}"
shift || true

case "$cmd" in
    setup)
        log_info "Setting up development environment..."
        if ! command -v node >/dev/null 2>&1; then
            log_error "Node.js is required but not found in PATH."
            exit 1
        fi
        log_info "Installing dependencies..."
        run_install
        if ! command -v vsce >/dev/null 2>&1; then
            log_info "Installing vsce..."
            npm install --global @vscode/vsce || true
        fi
        log_info "Setup complete"
        ;;
    build)
        log_info "Building extension..."
        run_script compile
        ;;
    watch)
        log_info "Starting TypeScript watch... (Ctrl+C to stop)"
        run_script watch
        ;;
    test)
        log_info "Running tests..."
        run_script test
        ;;
    test:watch)
        log_info "Running tests in watch mode..."
        if command -v inotifywait >/dev/null 2>&1; then
            while true; do
                run_script test
                log_info "Waiting for file changes..."
                inotifywait -r -e modify,create,delete src/ --timeout 30 || true
            done
        else
            log_warn "inotifywait not found. Running tests once."
            run_script test
        fi
        ;;
    lint)
        log_info "Running ESLint..."
        run_script lint
        ;;
    lint:fix)
        log_info "Running ESLint with auto-fix..."
        npx eslint src --ext ts --fix
        ;;
    clean)
        log_info "Cleaning build artifacts..."
        set +e
        if [ ! -d node_modules ]; then
            log_warn "Dependencies not installed; removing artifacts manually."
            rm -rf out
            rm -f ./*.vsix
        fi

        if [ -d node_modules ]; then
            run_script clean
            local status=$?
            if [[ $status -ne 0 ]]; then
                log_warn "Clean command failed; applying manual removal."
                rm -rf out
                rm -f ./*.vsix
            fi
        fi
        set -e
        ;;
    package)
        log_info "Building binaries and packaging..."
        "$SCRIPT_DIR/build-vscode.sh" --skip-tests
        ;;
    install)
        log_info "Installing latest .vsix..."
        vsix="$(ls -t *.vsix 2>/dev/null | head -n1)"
        if [[ -z "$vsix" ]]; then
            log_error "No .vsix found. Run '$0 package' first."
            exit 1
        fi
        if ! command -v code >/dev/null 2>&1; then
            log_error "VSCode 'code' CLI not found in PATH."
            exit 1
        fi
        code --install-extension "$vsix" --force
        log_info "Installed $vsix"
        ;;
    uninstall)
        log_info "Uninstalling extension from VSCode..."
        if ! command -v code >/dev/null 2>&1; then
            log_error "VSCode 'code' CLI not found in PATH."
            exit 1
        fi
        code --uninstall-extension "$EXTENSION_ID" || log_warn "Extension may not be installed."
        ;;
    logs)
        log_info "VSCode extension logs location:"
        if [[ "$OSTYPE" == "darwin"* ]]; then
            echo "  $HOME/Library/Application Support/Code/logs"
        elif [[ "$OSTYPE" == "linux"* ]]; then
            echo "  $HOME/.config/Code/logs"
        else
            log_warn "Log path unknown for this OS."
        fi
        ;;
    debug)
        log_info "Debugging steps:"
        log_info "1. Open project in VSCode"
        log_info "2. Go to Run and Debug (Ctrl+Shift+D)"
        log_info "3. Select 'Run Extension'"
        log_info "4. Press F5"
        ;;
    help|-h|--help)
        show_help
        ;;
    *)
        log_error "Unknown command: $cmd"
        echo
        show_help
        exit 1
        ;;
esac
