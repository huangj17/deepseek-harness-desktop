import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
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

// GUI 启动的应用继承不到用户 shell 的 PATH（macOS 从 Finder 启动尤其明显），而依赖树里
// 的 install/postinstall 脚本（node-pty、koffi、dsh-subprocess-local 等）都会调用 `node`，
// 缺了就是 `sh: node: command not found` 加退出码 127，整个更新失败。这里写一个把 Electron
// 以 run-as-node 模式重新执行的 node 垫片，挂到 npm 子进程 PATH 的最前面。
async function ensureNodeShimDirectory(userDataDirectory, electronExecutable) {
  const directory = join(userDataDirectory, 'node-shim')
  await mkdir(directory, { recursive: true })
  if (process.platform === 'win32') {
    await writeFile(join(directory, 'node.cmd'), `@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${electronExecutable}" %*\r\n`)
    return directory
  }
  const shimPath = join(directory, 'node')
  await writeFile(shimPath, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${electronExecutable}" "$@"\n`)
  await chmod(shimPath, 0o755)
  return directory
}

// Windows 上 process.env 的键名大小写不定（通常是 Path），直接加一个 PATH 会变成两个键。
function withDirectoryOnPath(env, directory) {
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH'
  const current = env[key]
  return { ...env, [key]: current === undefined || current === '' ? directory : `${directory}${delimiter}${current}` }
}

function runNpmInstall({ electronExecutable, npmCliPath, targetDirectory, cacheDirectory, version, shimDirectory, onOutput }) {
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
      env: withDirectoryOnPath({ ...process.env, ELECTRON_RUN_AS_NODE: '1' }, shimDirectory),
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
  const shimDirectory = await ensureNodeShimDirectory(userDataDirectory, electronExecutable)
  await mkdir(temporaryDirectory, { recursive: true })
  try {
    await runNpmInstall({
      electronExecutable,
      npmCliPath,
      targetDirectory: temporaryDirectory,
      cacheDirectory: join(userDataDirectory, 'npm-cache'),
      version: validVersion,
      shimDirectory,
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
