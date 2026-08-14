import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import semver from 'semver'

export const HARNESS_PACKAGE_NAME = '@deepseek-ai/dsh'
export const HARNESS_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest'

function statePath(userDataDirectory) {
  return join(userDataDirectory, 'harness-runtime.json')
}

function runtimesDirectory(userDataDirectory) {
  return join(userDataDirectory, 'harness-runtimes')
}

async function readManifest(packagePath) {
  return JSON.parse(await readFile(packagePath, 'utf8'))
}

async function runtimeFromPackagePath(packagePath, source, expectedVersion) {
  const manifest = await readManifest(packagePath)
  const version = semver.valid(manifest.version)
  if (version === null) throw new Error(`Harness 版本无效：${String(manifest.version)}`)
  if (expectedVersion !== undefined && version !== expectedVersion) {
    throw new Error(`Harness 版本校验失败：期望 ${expectedVersion}，实际 ${version}`)
  }

  const relativeBinPath = manifest.bin?.dsh
  if (typeof relativeBinPath !== 'string') throw new Error('Harness 安装包缺少 dsh 启动入口。')
  const binPath = join(dirname(packagePath), relativeBinPath)
  await access(binPath)
  return { version, binPath, packagePath, source }
}

export async function bundledHarnessRuntime(bundledPackagePath) {
  return runtimeFromPackagePath(bundledPackagePath, 'bundled')
}

export async function resolveHarnessRuntime({ userDataDirectory, bundledPackagePath }) {
  const bundled = await bundledHarnessRuntime(bundledPackagePath)
  try {
    const state = JSON.parse(await readFile(statePath(userDataDirectory), 'utf8'))
    const activeVersion = semver.valid(state.activeVersion)
    if (activeVersion === null) return bundled
    const packagePath = join(runtimesDirectory(userDataDirectory), activeVersion, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    const downloaded = await runtimeFromPackagePath(packagePath, 'downloaded', activeVersion)
    return semver.gte(downloaded.version, bundled.version) ? downloaded : bundled
  } catch {
    return bundled
  }
}

export function isNewerHarnessVersion(candidate, current) {
  const validCandidate = semver.valid(candidate)
  const validCurrent = semver.valid(current)
  return validCandidate !== null && validCurrent !== null && semver.gt(validCandidate, validCurrent)
}

export async function fetchLatestHarnessVersion({ fetchImplementation = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImplementation(HARNESS_REGISTRY_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`版本服务器返回 HTTP ${response.status}`)
    const metadata = await response.json()
    const version = semver.valid(metadata.version)
    if (version === null) throw new Error('版本服务器返回了无效版本。')
    return version
  } finally {
    clearTimeout(timeout)
  }
}

function runNpmInstall({ electronExecutable, npmCliPath, targetDirectory, cacheDirectory, version, onOutput }) {
  return new Promise((resolve, reject) => {
    const args = [
      npmCliPath,
      'install',
      '--prefix', targetDirectory,
      `${HARNESS_PACKAGE_NAME}@${version}`,
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--package-lock=false',
      '--cache', cacheDirectory,
    ]
    const child = spawn(electronExecutable, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const observe = chunk => {
      const text = chunk.toString()
      output = `${output}${text}`.slice(-40_000)
      onOutput?.(text)
    }
    child.stdout.on('data', observe)
    child.stderr.on('data', observe)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`下载程序退出（退出码 ${String(code)}，信号 ${String(signal)}）。\n\n${output.slice(-4_000)}`))
    })
  })
}

async function activateRuntime(userDataDirectory, version) {
  const path = statePath(userDataDirectory)
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify({ activeVersion: version, installedAt: new Date().toISOString() }, null, 2)}\n`)
  await rename(temporaryPath, path)
}

export async function installHarnessRuntime({ userDataDirectory, bundledNpmPackagePath, electronExecutable, version, onOutput }) {
  const validVersion = semver.valid(version)
  if (validVersion === null || validVersion !== version) throw new Error(`拒绝安装无效版本：${String(version)}`)

  const root = runtimesDirectory(userDataDirectory)
  const targetDirectory = join(root, validVersion)
  const targetPackagePath = join(targetDirectory, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  await mkdir(root, { recursive: true })

  try {
    const existingRuntime = await runtimeFromPackagePath(targetPackagePath, 'downloaded', validVersion)
    await activateRuntime(userDataDirectory, validVersion)
    return existingRuntime
  } catch {
    await rm(targetDirectory, { recursive: true, force: true })
  }

  const temporaryDirectory = join(root, `.installing-${process.pid}-${Date.now()}`)
  const npmCliPath = join(dirname(bundledNpmPackagePath), 'bin', 'npm-cli.js')
  await access(npmCliPath)
  await mkdir(temporaryDirectory, { recursive: true })
  try {
    await runNpmInstall({
      electronExecutable,
      npmCliPath,
      targetDirectory: temporaryDirectory,
      cacheDirectory: join(userDataDirectory, 'npm-cache'),
      version: validVersion,
      onOutput,
    })
    const temporaryPackagePath = join(temporaryDirectory, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    await runtimeFromPackagePath(temporaryPackagePath, 'downloaded', validVersion)
    await rename(temporaryDirectory, targetDirectory)
    const runtime = await runtimeFromPackagePath(targetPackagePath, 'downloaded', validVersion)
    await activateRuntime(userDataDirectory, validVersion)
    return runtime
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export async function deactivateDownloadedHarnessRuntime(userDataDirectory) {
  await rm(statePath(userDataDirectory), { force: true })
}
