import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installDesktopIntegration, TERMINAL_BUTTON_PLUGIN_NAME } from '../src/desktop-integration.mjs'
import { harnessWebArguments } from '../src/harness-launch.mjs'

const require = createRequire(import.meta.url)
const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const electronBinary = require('electron')
const dshManifest = require.resolve('@deepseek-ai/dsh/package.json')
const dshVersion = require(dshManifest).version
const dshBin = join(dirname(dshManifest), 'lib', 'bin.js')
const userDataDirectory = await mkdtemp(join(tmpdir(), 'deepseek-harness-desktop-smoke-'))
const integration = await installDesktopIntegration({ appPath: desktopDirectory, userDataDirectory })

const child = spawn(electronBinary, harnessWebArguments({ version: dshVersion, binPath: dshBin }, { patchPath: integration.patchPath }), {
  env: { ...process.env, DSH_HOME: integration.dshHome, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
let finished = false

try {
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Runtime did not become ready.\n${output}`)), 120_000)
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
      reject(new Error(`Runtime exited before readiness: code=${String(code)} signal=${String(signal)}\n${output}`))
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
  if (response === undefined) {
    throw new Error(`Web UI did not accept HTTP connections: ${String(lastFetchError)}\n${output}`)
  }
  const html = await response.text()
  if (!response.ok || !/<!doctype html>/i.test(html)) {
    throw new Error(`Unexpected Web response: HTTP ${response.status}\n${html.slice(0, 500)}`)
  }
  if (!html.includes(TERMINAL_BUTTON_PLUGIN_NAME)) throw new Error('Web UI boot manifest does not include the desktop terminal button')
  console.log(`Runtime ready and Web UI returned HTTP ${response.status}: ${url}`)
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
  await rm(userDataDirectory, { recursive: true, force: true })
}
