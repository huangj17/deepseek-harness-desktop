import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  createDshTerminalFiles,
  dshWrapperContents,
  openDshTerminal,
  resolveTerminalCwd,
  terminalShellEnvironment,
  terminalLaunchSpec,
  terminalLauncherContents,
} from '../src/dsh-terminal.mjs'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'deepseek-harness-terminal-test-'))
try {
  const workspace = join(root, "project with ' quote")
  await mkdir(workspace)
  assert.equal(await resolveTerminalCwd(workspace, root), await realpath(workspace))
  assert.equal(await resolveTerminalCwd(undefined, root), await realpath(root))
  await assert.rejects(resolveTerminalCwd('relative', root), /绝对路径/)
  const file = join(root, 'file.txt')
  await writeFile(file, 'x')
  await assert.rejects(resolveTerminalCwd(file, root), /不是文件夹/)

  const runtime = { version: '1.2.3', binPath: "/runtime/it's/dsh.js" }
  const unixWrapper = dshWrapperContents({
    platform: 'darwin', electronExecutable: "/Applications/DeepSeek's Harness", runtime, dshHome: "/Users/me/.dsh home's",
  })
  assert.match(unixWrapper, /ELECTRON_RUN_AS_NODE=1 exec/)
  assert.match(unixWrapper, /"\$@"/)
  assert.match(unixWrapper, /'\\''/)

  const windowsWrapper = dshWrapperContents({
    platform: 'win32', electronExecutable: 'C:\\Apps\\100% Harness\\Harness.exe', runtime: { ...runtime, binPath: 'C:\\Runtime\\dsh.js' }, dshHome: 'C:\\Users\\100% me',
  })
  assert.match(windowsWrapper, /100%% Harness/)
  assert.match(windowsWrapper, /%\*/)

  const launcher = terminalLauncherContents({
    binDirectory: '/tmp/dsh bin', cwd: workspace, dshHome: root, runtime, launcherPath: '/tmp/launch once.sh',
  })
  assert.match(launcher, /rm -f -- '\/tmp\/launch once\.sh'/)
  assert.match(launcher, /Run dsh --help/)
  assert.match(launcher, /exec "\$\{SHELL:-\/bin\/sh\}" -i/)
  assert.doesNotMatch(launcher, /ELECTRON_RUN_AS_NODE/)

  const terminalEnv = terminalShellEnvironment({
    env: { PATH: '/usr/bin', electron_run_as_node: '1', KEEP_ME: 'yes' },
    binDirectory: '/tmp/dsh bin',
    platform: 'linux',
    dshHome: root,
  })
  assert.equal(terminalEnv.PATH, '/tmp/dsh bin:/usr/bin')
  assert.equal(terminalEnv.DSH_HOME, root)
  assert.equal(terminalEnv.KEEP_ME, 'yes')
  assert.equal(Object.keys(terminalEnv).some(key => key.toUpperCase() === 'ELECTRON_RUN_AS_NODE'), false)

  const files = await createDshTerminalFiles({
    platform: 'darwin', terminalDirectory: join(root, 'terminal'), electronExecutable: '/Applications/Harness', runtime, dshHome: root, cwd: workspace,
  })
  if (process.platform !== 'win32') {
    assert.equal((await stat(files.wrapperPath)).mode & 0o111, 0o111)
    assert.equal((await stat(files.launcherPath)).mode & 0o111, 0o111)
  }
  assert.match(await readFile(files.launcherPath, 'utf8'), /Workspace:/)
  assert.match(await readFile(files.launcherPath, 'utf8'), /rm -f --/)

  const secondFiles = await createDshTerminalFiles({
    platform: 'darwin', terminalDirectory: join(root, 'terminal'), electronExecutable: '/Applications/Harness', runtime, dshHome: root, cwd: workspace,
  })
  assert.notEqual(secondFiles.launcherPath, files.launcherPath)

  if (process.platform !== 'win32') {
    const dshManifestPath = require.resolve('@deepseek-ai/dsh/package.json')
    const dshManifest = require(dshManifestPath)
    const executableFiles = await createDshTerminalFiles({
      platform: process.platform,
      terminalDirectory: join(root, 'executable-terminal'),
      electronExecutable: require('electron'),
      runtime: { version: dshManifest.version, binPath: join(dirname(dshManifestPath), dshManifest.bin.dsh) },
      dshHome: root,
      cwd: workspace,
    })
    const { stdout } = await execFileAsync(executableFiles.wrapperPath, ['--version'])
    assert.equal(stdout.trim(), dshManifest.version)
  }

  assert.deepEqual(
    terminalLaunchSpec({ platform: 'darwin', cwd: workspace, launcherPath: '/tmp/open.command', version: '1.2.3' }),
    { command: '/usr/bin/open', args: ['/tmp/open.command'] },
  )
  assert.deepEqual(
    terminalLaunchSpec({ platform: 'linux', cwd: workspace, launcherPath: '/tmp/open.sh', executables: { 'gnome-terminal': '/usr/bin/gnome-terminal' }, version: '1.2.3' }),
    { command: '/usr/bin/gnome-terminal', args: ['--', '/tmp/open.sh'] },
  )
  assert.deepEqual(
    terminalLaunchSpec({
      platform: 'win32', cwd: 'C:\\project', executables: { wt: 'C:\\wt.exe', powershell: 'C:\\powershell.exe' }, env: {}, version: '1.2.3',
    }),
    {
      command: 'C:\\wt.exe',
      args: ['-d', 'C:\\project', 'C:\\powershell.exe', '-NoLogo', '-NoExit', '-Command', "Write-Host 'DeepSeek Harness DSH terminal (1.2.3)' -ForegroundColor Cyan; Write-Host 'Run dsh --help to get started.'"],
    },
  )
  assert.throws(
    () => terminalLaunchSpec({ platform: 'linux', cwd: workspace, launcherPath: '/tmp/open.sh', version: '1.2.3' }),
    /找不到可用的系统终端/,
  )

  const failedTerminalDirectory = join(root, 'failed-terminal')
  await assert.rejects(openDshTerminal({
    platform: 'unsupported',
    terminalDirectory: failedTerminalDirectory,
    electronExecutable: '/Applications/Harness',
    runtime,
    dshHome: root,
    requestedCwd: workspace,
    fallbackCwd: root,
    env: { PATH: '' },
  }), /不支持在 unsupported 上打开/)
  assert.equal((await readdir(failedTerminalDirectory)).some(name => name.startsWith('launch-dsh-terminal-')), false)

  // Make sure chmod remains usable on the generated wrapper after a rewrite.
  await chmod(files.wrapperPath, 0o755)
  console.log('DSH terminal launcher tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
}
