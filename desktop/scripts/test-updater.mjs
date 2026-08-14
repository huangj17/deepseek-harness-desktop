import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  fetchLatestHarnessVersion,
  isNewerHarnessVersion,
  resolveHarnessRuntime,
} from '../src/harness-updater.mjs'

assert.equal(isNewerHarnessVersion('0.1.0-rc.7', '0.1.0-rc.6'), true)
assert.equal(isNewerHarnessVersion('0.1.0-rc.6', '0.1.0-rc.6'), false)
assert.equal(isNewerHarnessVersion('invalid', '0.1.0-rc.6'), false)

const latest = await fetchLatestHarnessVersion({
  fetchImplementation: async (_url, options) => {
    assert.equal(options.headers.Accept, 'application/json')
    return { ok: true, json: async () => ({ version: '0.1.0-rc.7' }) }
  },
})
assert.equal(latest, '0.1.0-rc.7')

const testDirectory = await mkdtemp(join(tmpdir(), 'dsh-updater-test-'))
try {
  const bundledDirectory = join(testDirectory, 'bundled')
  const bundledPackagePath = join(bundledDirectory, 'package.json')
  await mkdir(join(bundledDirectory, 'lib'), { recursive: true })
  await writeFile(bundledPackagePath, JSON.stringify({ version: '0.1.0-rc.6', bin: { dsh: 'lib/bin.js' } }))
  await writeFile(join(bundledDirectory, 'lib', 'bin.js'), '')

  const bundledRuntime = await resolveHarnessRuntime({ userDataDirectory: join(testDirectory, 'user-data'), bundledPackagePath })
  assert.equal(bundledRuntime.version, '0.1.0-rc.6')
  assert.equal(bundledRuntime.source, 'bundled')

  const downloadedDirectory = join(testDirectory, 'user-data', 'harness-runtimes', '0.1.0-rc.7', 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(join(downloadedDirectory, 'lib'), { recursive: true })
  await writeFile(join(downloadedDirectory, 'package.json'), JSON.stringify({ version: '0.1.0-rc.7', bin: { dsh: 'lib/bin.js' } }))
  await writeFile(join(downloadedDirectory, 'lib', 'bin.js'), '')
  await writeFile(join(testDirectory, 'user-data', 'harness-runtime.json'), JSON.stringify({ activeVersion: '0.1.0-rc.7' }))

  const downloadedRuntime = await resolveHarnessRuntime({ userDataDirectory: join(testDirectory, 'user-data'), bundledPackagePath })
  assert.equal(downloadedRuntime.version, '0.1.0-rc.7')
  assert.equal(downloadedRuntime.source, 'downloaded')
} finally {
  await rm(testDirectory, { recursive: true, force: true })
}

console.log('Harness updater tests passed')
