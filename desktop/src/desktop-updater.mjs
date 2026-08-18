import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'

export const DESKTOP_REPOSITORY = 'huangj17/deepseek-harness-desktop'
export const DESKTOP_RELEASE_API_URL = `https://api.github.com/repos/${DESKTOP_REPOSITORY}/releases/latest`
export const DESKTOP_RELEASE_PAGE_URL = `https://github.com/${DESKTOP_REPOSITORY}/releases/latest`

// GitHub API 会拒绝没有 User-Agent 的请求（403），而 node 的 fetch 默认不带。
const REQUEST_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'deepseek-harness-desktop',
}

export function isNewerDesktopVersion(candidate, current) {
  const validCandidate = semver.valid(candidate)
  const validCurrent = semver.valid(current)
  return validCandidate !== null && validCurrent !== null && semver.gt(validCandidate, validCurrent)
}

// 发布产物的命名由 electron-builder 的 artifactName 决定：
// DeepSeek-Harness-${version}-${arch}.${ext}。匹配不上就退回发布页，让用户自己挑。
function installerSuffix(platform, arch) {
  if (platform === 'darwin') return arch === 'arm64' ? '-arm64.dmg' : '-x64.dmg'
  if (platform === 'win32') return '-x64.exe'
  if (platform === 'linux') return '-x64.AppImage'
  return undefined
}

export function pickInstallerUrl(release, { platform = process.platform, arch = process.arch } = {}) {
  const suffix = installerSuffix(platform, arch)
  if (suffix === undefined) return undefined
  return release.assets.find(asset => asset.name.endsWith(suffix))?.url
}

export async function fetchLatestDesktopRelease({ fetchImplementation = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImplementation(DESKTOP_RELEASE_API_URL, {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`版本服务器返回 HTTP ${response.status}`)
    const payload = await response.json()
    const version = semver.valid(String(payload.tag_name ?? '').replace(/^v/, ''))
    if (version === null) throw new Error('版本服务器返回了无效版本。')
    const assets = (payload.assets ?? [])
      .filter(asset => typeof asset?.name === 'string' && typeof asset?.browser_download_url === 'string')
      .map(asset => ({ name: asset.name, url: asset.browser_download_url }))
    return { version, assets, pageUrl: payload.html_url ?? DESKTOP_RELEASE_PAGE_URL }
  } finally {
    clearTimeout(timeout)
  }
}

function skipStatePath(userDataDirectory) {
  return join(userDataDirectory, 'desktop-update.json')
}

export async function readSkippedDesktopVersion(userDataDirectory) {
  try {
    const state = JSON.parse(await readFile(skipStatePath(userDataDirectory), 'utf8'))
    return semver.valid(state.skippedVersion) ?? undefined
  } catch {
    return undefined
  }
}

export async function skipDesktopVersion(userDataDirectory, version) {
  const validVersion = semver.valid(version)
  if (validVersion === null) return
  const path = skipStatePath(userDataDirectory)
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({ skippedVersion: validVersion }, null, 2)}\n`)
  await rename(temporaryPath, path)
}

// 跳过 0.2.9 之后，0.2.9 及更早的版本都不再打扰；只有更新的版本才会重新弹。
export function isSkippedDesktopVersion(version, skippedVersion) {
  if (skippedVersion === undefined) return false
  const validVersion = semver.valid(version)
  const validSkipped = semver.valid(skippedVersion)
  return validVersion !== null && validSkipped !== null && semver.lte(validVersion, validSkipped)
}
