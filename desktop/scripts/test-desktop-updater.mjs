import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DESKTOP_RELEASE_API_URL,
  fetchLatestDesktopRelease,
  isNewerDesktopVersion,
  isSkippedDesktopVersion,
  pickInstallerUrl,
  readSkippedDesktopVersion,
  skipDesktopVersion,
} from '../src/desktop-updater.mjs'

assert.equal(isNewerDesktopVersion('0.2.9', '0.2.8'), true)
assert.equal(isNewerDesktopVersion('0.2.8', '0.2.8'), false)
assert.equal(isNewerDesktopVersion('0.2.7', '0.2.8'), false)
assert.equal(isNewerDesktopVersion('v0.2.9', '0.2.8'), true) // semver 容忍前导 v
assert.equal(isNewerDesktopVersion('nightly', '0.2.8'), false)

const releasePayload = {
  tag_name: 'v0.2.9',
  html_url: 'https://github.com/huangj17/deepseek-harness-desktop/releases/tag/v0.2.9',
  assets: [
    { name: 'DeepSeek-Harness-0.2.9-arm64.dmg', browser_download_url: 'https://example.test/arm64.dmg' },
    { name: 'DeepSeek-Harness-0.2.9-x64.dmg', browser_download_url: 'https://example.test/x64.dmg' },
    { name: 'DeepSeek-Harness-0.2.9-x64.exe', browser_download_url: 'https://example.test/x64.exe' },
    { name: 'DeepSeek-Harness-0.2.9-x64.zip', browser_download_url: 'https://example.test/x64.zip' },
    { name: 'DeepSeek-Harness-0.2.9-x64.AppImage', browser_download_url: 'https://example.test/x64.AppImage' },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt' },
    { name: 'incomplete-asset' },
  ],
}

const release = await fetchLatestDesktopRelease({
  fetchImplementation: async (url, options) => {
    assert.equal(url, DESKTOP_RELEASE_API_URL)
    assert.equal(options.headers['User-Agent'], 'deepseek-harness-desktop')
    return { ok: true, json: async () => releasePayload }
  },
})
assert.equal(release.version, '0.2.9')
assert.equal(release.pageUrl, releasePayload.html_url)
assert.equal(release.assets.length, 6)

assert.equal(pickInstallerUrl(release, { platform: 'darwin', arch: 'arm64' }), 'https://example.test/arm64.dmg')
assert.equal(pickInstallerUrl(release, { platform: 'darwin', arch: 'x64' }), 'https://example.test/x64.dmg')
assert.equal(pickInstallerUrl(release, { platform: 'win32', arch: 'x64' }), 'https://example.test/x64.exe')
assert.equal(pickInstallerUrl(release, { platform: 'linux', arch: 'x64' }), 'https://example.test/x64.AppImage')
assert.equal(pickInstallerUrl(release, { platform: 'freebsd', arch: 'x64' }), undefined)
assert.equal(pickInstallerUrl({ assets: [] }, { platform: 'win32', arch: 'x64' }), undefined)

await assert.rejects(
  fetchLatestDesktopRelease({ fetchImplementation: async () => ({ ok: false, status: 403 }) }),
  /HTTP 403/,
)
await assert.rejects(
  fetchLatestDesktopRelease({ fetchImplementation: async () => ({ ok: true, json: async () => ({ tag_name: 'nightly' }) }) }),
  /无效版本/,
)

assert.equal(isSkippedDesktopVersion('0.2.9', undefined), false)
assert.equal(isSkippedDesktopVersion('0.2.9', '0.2.9'), true)
assert.equal(isSkippedDesktopVersion('0.2.8', '0.2.9'), true)
assert.equal(isSkippedDesktopVersion('0.3.0', '0.2.9'), false)

const skipDirectory = await mkdtemp(join(tmpdir(), 'dsh-desktop-update-test-'))
try {
  assert.equal(await readSkippedDesktopVersion(skipDirectory), undefined)
  await skipDesktopVersion(skipDirectory, '0.2.9')
  assert.equal(await readSkippedDesktopVersion(skipDirectory), '0.2.9')
  await skipDesktopVersion(skipDirectory, 'nightly')
  assert.equal(await readSkippedDesktopVersion(skipDirectory), '0.2.9')
} finally {
  await rm(skipDirectory, { recursive: true, force: true })
}

console.log('Desktop updater tests passed')
