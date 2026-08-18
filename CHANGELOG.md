# Changelog

**English** · [简体中文](CHANGELOG.zh-CN.md)

This file records what changed in each desktop client release. The release workflow reads the section matching the tag from this file and from [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md), so add a section to both before tagging a release.

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
