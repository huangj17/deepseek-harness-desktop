import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installHarnessRuntime } from '../src/harness-updater.mjs'

const require = createRequire(import.meta.url)
const dshManifest = require('@deepseek-ai/dsh/package.json')
const npmPackagePath = require.resolve('npm/package.json')
const electronExecutable = require('electron')
const userDataDirectory = await mkdtemp(join(tmpdir(), 'dsh-updater-smoke-'))

try {
  const runtime = await installHarnessRuntime({
    userDataDirectory,
    bundledNpmPackagePath: npmPackagePath,
    electronExecutable,
    version: dshManifest.version,
    onOutput: text => process.stdout.write(text),
  })
  if (runtime.version !== dshManifest.version || runtime.source !== 'downloaded') {
    throw new Error(`Unexpected installed runtime: ${JSON.stringify(runtime)}`)
  }
  console.log(`Updater smoke test installed and verified ${runtime.version}`)
} finally {
  await rm(userDataDirectory, { recursive: true, force: true })
}
