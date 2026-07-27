# OpenCodeUI SnoreToast

This directory contains the corresponding source for the SnoreToast binary shipped by OpenCodeUI.

- Upstream: KDE SnoreToast v0.7.0
- Commit: `5aee2959cc107b69acbaedb3068de9d85b54666e`
- License: LGPL-3.0-or-later; see `COPYING.LGPL-3`

OpenCodeUI changes are limited to preserving an explicit AppUserModelID, carrying the VS Code main process ID in toast activation data, and calling `AllowSetForegroundWindow(pid)` before either activation callback reaches the existing named pipe. The embedded fallback icon was removed; OpenCodeUI always supplies `-p`.

Build on Windows x64 with `build-x64.bat`. The script runs the native test and writes the distributable binary and license to `resources/windows`.
