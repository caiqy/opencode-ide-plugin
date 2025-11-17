#!/bin/bash

# Opencode VSCode Extension Test Runner Script

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/hosts/vscode-plugin"

if [[ ! -f "$PLUGIN_DIR/package.json" ]]; then
    print_error "package.json not found. Please run this script from the repository root."
    exit 1
fi

cd "$PLUGIN_DIR"

command="${1:-test}"

case "$command" in
    test|t)
        print_status "Running full test suite..."
        pnpm test
        ;;
    compile|c)
        print_status "Compiling TypeScript..."
        pnpm run compile
        ;;
    lint|l)
        print_status "Running ESLint..."
        pnpm run lint
        ;;
    lint-fix|lf)
        print_status "Running ESLint with auto-fix..."
        npx eslint src --ext ts --fix
        ;;
    watch|w)
        print_status "Starting TypeScript watch mode..."
        pnpm run watch
        ;;
    clean)
        print_status "Cleaning build outputs..."
        rm -rf out/ .vscode-test/
        print_status "Clean complete"
        ;;
    install|i)
        print_status "Installing dependencies..."
        pnpm install
        ;;
    help|h|--help)
        cat <<EOF
Opencode VSCode Extension Test Runner

Usage: $0 [command]

Commands:
  test, t        Run full test suite (default)
  compile, c     Compile TypeScript only
  lint, l        Run ESLint only
  lint-fix, lf   Run ESLint with auto-fix
  watch, w       Start TypeScript watch mode
  clean          Clean build outputs
  install, i     Install dependencies
  help, h        Show this help message
EOF
        ;;
    *)
        print_error "Unknown command: $command"
        print_warn "Use '$0 help' to see available commands"
        exit 1
        ;;
esac
