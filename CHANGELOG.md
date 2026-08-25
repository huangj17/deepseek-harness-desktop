# Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

This file records what changed in each desktop client release. The release workflow reads the section matching the tag from this file and from [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md), so add a section to both before tagging a release.

## 0.2.11

- Added: **Open DSH Terminal** at the bottom of the sidebar opens the system terminal in the current Session or recent Workspace. The `dsh` command uses the same active bundled or downloaded runtime and Harness home as the desktop client, with no global installation required.
- Improved: closing the main window now keeps Harness and active tasks running in the background. Reopen it from the app icon, or quit the client completely from the Dock, taskbar, or tray menu.
- Reliability and security: terminal requests are restricted to the trusted Harness main frame and validated absolute directories. Electron's Node mode is scoped to the `dsh` wrapper, and unique launch scripts prevent concurrent terminals from opening the wrong Workspace.
- Compatibility: if the desktop terminal plugin prevents a future Harness runtime from starting, the client retries without the integration so the main Harness UI remains available.

## 0.2.10

- Fixed: after an in-app Harness update to `0.1.1-rc.2` or later, launching the desktop client also opened the Harness page in the system browser. The client now passes `--no-open` to compatible runtimes so the Web UI stays in the Electron window.
- Compatibility: older bundled Harness versions do not recognize `--no-open`, so the launcher keeps their original arguments and enables the flag only for versions that support it.
- Tests: source and packaged-runtime smoke tests now share the same version-aware launch arguments, preventing the browser handoff from returning in a later bundled-runtime update.

## 0.2.9

- Added: the app now checks for desktop client updates itself. It queries the GitHub releases feed after launch and every six hours, and a new version opens a prompt that links straight to the installer for your platform.
- Added: the update prompt can skip a version. A skipped version stops asking, while checking manually from the menu always reports what is available.
- Note: client updates are still installed by hand — the packages carry no Apple Developer ID signature, so silent auto-update is not possible. Harness runtime updates are unaffected.

## 0.2.8

- Fixed: picking a folder on Windows failed with `win32 folder dialog worker exited before reporting a result`, leaving the workspace unopened. The upstream native picker over-reads the returned path and crashes its worker process, so the client now uses the in-page directory browser on Windows.
- Fixed: updating the Harness runtime failed with exit code 127 when the app was launched from Finder or the Start menu, because dependency install scripts could not find `node` on the inherited PATH. The installer now carries its own node shim.
- Improved: the update progress window no longer draws a card inside a card or the fake macOS titlebar, and it drops the inherited menu bar and scrollbar on Windows and Linux.

## 0.2.7

- Added: installers for macOS (Apple Silicon and Intel), Windows, and Linux.
- Fixed: incomplete Linux package metadata.
- Improved: clearer wording about how this client relates to the official Harness.

## 0.2.6

- First open-source release.
