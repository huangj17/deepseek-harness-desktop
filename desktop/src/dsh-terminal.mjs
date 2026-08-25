import { constants as fsConstants } from 'node:fs'
import { access, chmod, mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { delimiter, extname, isAbsolute, join } from 'node:path'

export const OPEN_DSH_TERMINAL_CHANNEL = 'desktop:open-dsh-terminal'

function posixQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function batchValue(value) {
  return String(value).replaceAll('%', '%%')
}

function powershellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function terminalBanner(version) {
  return `DeepSeek Harness DSH terminal (${version})`
}

export async function resolveTerminalCwd(requestedCwd, fallbackCwd) {
  const candidate = requestedCwd === undefined || requestedCwd === '' ? fallbackCwd : requestedCwd
  if (typeof candidate !== 'string' || !isAbsolute(candidate)) {
    throw new Error('终端工作目录必须是绝对路径。')
  }
  const resolved = await realpath(candidate)
  if (!(await stat(resolved)).isDirectory()) throw new Error('终端工作目录不是文件夹。')
  return resolved
}

export function dshWrapperContents({ platform, electronExecutable, runtime, dshHome }) {
  if (platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      `set "DSH_HOME=${batchValue(dshHome)}"`,
      'set "ELECTRON_RUN_AS_NODE=1"',
      `"${batchValue(electronExecutable)}" "${batchValue(runtime.binPath)}" %*`,
      'exit /b %errorlevel%',
      '',
    ].join('\r\n')
  }
  return `#!/bin/sh\nDSH_HOME=${posixQuote(dshHome)} ELECTRON_RUN_AS_NODE=1 exec ${posixQuote(electronExecutable)} ${posixQuote(runtime.binPath)} "$@"\n`
}

export function terminalLauncherContents({ binDirectory, cwd, dshHome, runtime, launcherPath }) {
  return [
    '#!/bin/sh',
    `rm -f -- ${posixQuote(launcherPath)}`,
    `export PATH=${posixQuote(binDirectory)}:"$PATH"`,
    `export DSH_HOME=${posixQuote(dshHome)}`,
    `cd ${posixQuote(cwd)} || exit 1`,
    `printf '%s\\n' ${posixQuote(terminalBanner(runtime.version))}`,
    `printf 'Workspace: %s\\n' ${posixQuote(cwd)}`,
    "printf '%s\\n\\n' 'Run dsh --help to get started.'",
    'exec "${SHELL:-/bin/sh}" -i',
    '',
  ].join('\n')
}

export async function createDshTerminalFiles({ platform, terminalDirectory, electronExecutable, runtime, dshHome, cwd }) {
  const binDirectory = join(terminalDirectory, 'bin')
  await mkdir(binDirectory, { recursive: true })
  const wrapperPath = join(binDirectory, platform === 'win32' ? 'dsh.cmd' : 'dsh')
  await writeFile(wrapperPath, dshWrapperContents({ platform, electronExecutable, runtime, dshHome }))
  if (platform !== 'win32') await chmod(wrapperPath, 0o755)

  if (platform === 'win32') return { binDirectory, wrapperPath, launcherPath: undefined }
  const launcherName = platform === 'darwin'
    ? `launch-dsh-terminal-${randomUUID()}.command`
    : `launch-dsh-terminal-${randomUUID()}.sh`
  const launcherPath = join(terminalDirectory, launcherName)
  await writeFile(launcherPath, terminalLauncherContents({ binDirectory, cwd, dshHome, runtime, launcherPath }))
  await chmod(launcherPath, 0o755)
  return { binDirectory, wrapperPath, launcherPath }
}

async function findExecutable(name, { env = process.env, platform = process.platform } = {}) {
  if (isAbsolute(name)) {
    try {
      await access(name, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
      return name
    } catch {
      return undefined
    }
  }
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH')
  const pathDirectories = pathKey === undefined ? [] : (env[pathKey] ?? '').split(platform === 'win32' ? ';' : delimiter)
  const extensions = platform === 'win32' && extname(name) === ''
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
    : ['']
  for (const directory of pathDirectories) {
    if (directory === '') continue
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`)
      try {
        await access(candidate, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
        return candidate
      } catch {}
    }
  }
  return undefined
}

export function terminalLaunchSpec({ platform, cwd, launcherPath, executables = {}, env = process.env, version }) {
  if (platform === 'darwin') {
    if (launcherPath === undefined) throw new Error('macOS 终端启动脚本缺失。')
    return { command: '/usr/bin/open', args: [launcherPath] }
  }
  if (platform === 'linux') {
    if (launcherPath === undefined) throw new Error('Linux 终端启动脚本缺失。')
    if (executables['x-terminal-emulator'] !== undefined) return { command: executables['x-terminal-emulator'], args: ['-e', launcherPath] }
    if (executables['gnome-terminal'] !== undefined) return { command: executables['gnome-terminal'], args: ['--', launcherPath] }
    if (executables.konsole !== undefined) return { command: executables.konsole, args: ['-e', launcherPath] }
    if (executables['xfce4-terminal'] !== undefined) return { command: executables['xfce4-terminal'], args: ['-x', launcherPath] }
    throw new Error('找不到可用的系统终端（x-terminal-emulator、GNOME Terminal、Konsole 或 Xfce Terminal）。')
  }
  if (platform === 'win32') {
    const powershell = executables.pwsh ?? executables.powershell
    const commandShell = env.ComSpec ?? executables.cmd ?? 'cmd.exe'
    const banner = terminalBanner(version)
    const shellCommand = powershell === undefined ? commandShell : powershell
    const shellArgs = powershell === undefined
      ? ['/d', '/k', `echo ${banner} && echo Run dsh --help to get started.`]
      : ['-NoLogo', '-NoExit', '-Command', `Write-Host ${powershellLiteral(banner)} -ForegroundColor Cyan; Write-Host 'Run dsh --help to get started.'`]
    if (executables.wt !== undefined) {
      return { command: executables.wt, args: ['-d', cwd, shellCommand, ...shellArgs] }
    }
    return { command: shellCommand, args: shellArgs }
  }
  throw new Error(`不支持在 ${platform} 上打开 DSH 终端。`)
}

async function platformExecutables(platform, env) {
  if (platform === 'linux') {
    const names = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal']
    return Object.fromEntries((await Promise.all(names.map(async name => [name, await findExecutable(name, { env, platform })])))
      .filter(([, value]) => value !== undefined))
  }
  if (platform === 'win32') {
    const [wt, pwsh, powershell, cmd] = await Promise.all([
      findExecutable('wt', { env, platform }),
      findExecutable('pwsh', { env, platform }),
      findExecutable('powershell', { env, platform }),
      findExecutable('cmd', { env, platform }),
    ])
    return { wt, pwsh, powershell, cmd }
  }
  return {}
}

function withTerminalBinOnPath(env, binDirectory, platform) {
  const key = Object.keys(env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH'
  const current = env[key]
  const separator = platform === 'win32' ? ';' : delimiter
  return { ...env, [key]: current === undefined || current === '' ? binDirectory : `${binDirectory}${separator}${current}` }
}

export function terminalShellEnvironment({ env, binDirectory, platform, dshHome }) {
  const clean = { ...env }
  for (const key of Object.keys(clean)) {
    if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete clean[key]
  }
  clean.DSH_HOME = dshHome
  return withTerminalBinOnPath(clean, binDirectory, platform)
}

async function spawnDetached(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export async function openDshTerminal({
  platform = process.platform,
  terminalDirectory,
  electronExecutable,
  runtime,
  dshHome,
  requestedCwd,
  fallbackCwd,
  env = process.env,
}) {
  const cwd = await resolveTerminalCwd(requestedCwd, fallbackCwd)
  const files = await createDshTerminalFiles({ platform, terminalDirectory, electronExecutable, runtime, dshHome, cwd })
  const terminalEnv = terminalShellEnvironment({ env, binDirectory: files.binDirectory, platform, dshHome })
  try {
    const executables = await platformExecutables(platform, terminalEnv)
    const spec = terminalLaunchSpec({ platform, cwd, launcherPath: files.launcherPath, executables, env: terminalEnv, version: runtime.version })
    await spawnDetached(spec.command, spec.args, { cwd, env: terminalEnv })
    return { cwd, command: spec.command }
  } catch (error) {
    if (files.launcherPath !== undefined) await rm(files.launcherPath, { force: true }).catch(() => {})
    throw error
  }
}
