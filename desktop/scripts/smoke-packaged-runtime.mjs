import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
if (process.platform !== 'darwin' && process.platform !== 'win32') {
  throw new Error(`Packaged runtime smoke test is unsupported on ${process.platform}.`)
}
const appDirectory = process.platform === 'darwin'
  ? join(desktopDirectory, 'dist', 'mac-arm64', 'DeepSeek Harness.app')
  : join(desktopDirectory, 'dist', 'win-unpacked')
const resourcesDirectory = process.platform === 'darwin'
  ? join(appDirectory, 'Contents', 'Resources', 'app')
  : join(appDirectory, 'resources', 'app')
const electronBinary = process.platform === 'darwin'
  ? join(appDirectory, 'Contents', 'MacOS', 'DeepSeek Harness')
  : join(appDirectory, 'DeepSeek Harness.exe')
const dshBin = join(resourcesDirectory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dshHome = await mkdtemp(join(tmpdir(), 'deepseek-harness-packaged-smoke-'))

const child = spawn(electronBinary, ['--expose-internals', dshBin, 'web', '--host', '127.0.0.1', '--port', '0'], {
  env: { ...process.env, DSH_HOME: dshHome, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
let finished = false

try {
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Packaged runtime did not become ready.\n${output}`)), 120_000)
    const observe = chunk => {
      output += chunk.toString()
      const url = output.match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1]
      if (url === undefined || finished) return
      finished = true
      clearTimeout(timeout)
      resolve(url)
    }
    child.stdout.on('data', observe)
    child.stderr.on('data', observe)
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (finished) return
      clearTimeout(timeout)
      reject(new Error(`Packaged runtime exited before readiness: code=${String(code)} signal=${String(signal)}\n${output}`))
    })
  })

  let response
  let lastFetchError
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      response = await fetch(url)
      break
    } catch (error) {
      lastFetchError = error
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  if (response === undefined) throw new Error(`Packaged Web UI did not accept HTTP connections: ${String(lastFetchError)}\n${output}`)
  const html = await response.text()
  if (!response.ok || !/<!doctype html>/i.test(html)) {
    throw new Error(`Unexpected packaged Web response: HTTP ${response.status}\n${html.slice(0, 500)}`)
  }
  console.log(`Packaged runtime ready and Web UI returned HTTP ${response.status}: ${url}`)
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 8_000)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  await rm(dshHome, { recursive: true, force: true })
}
