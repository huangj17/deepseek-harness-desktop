import assert from 'node:assert/strict'
import { createHarnessReadyUrlReader, harnessWebArguments } from '../src/harness-launch.mjs'

const runtime = version => ({ version, binPath: '/runtime/dsh/bin.js' })

assert.deepEqual(
  harnessWebArguments(runtime('0.1.0-rc.7')),
  ['--expose-internals', '/runtime/dsh/bin.js', 'web', '--host', '127.0.0.1', '--port', '0'],
)

assert.deepEqual(
  harnessWebArguments(runtime('0.1.1-rc.2')),
  ['--expose-internals', '/runtime/dsh/bin.js', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'],
)

assert.deepEqual(
  harnessWebArguments(runtime('0.2.0')),
  ['--expose-internals', '/runtime/dsh/bin.js', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'],
)

assert.deepEqual(
  harnessWebArguments(runtime('0.2.0'), { patchPath: '/desktop/cordis.patch.yml' }),
  ['--expose-internals', '/runtime/dsh/bin.js', 'web', '--patch', '/desktop/cordis.patch.yml', '--no-open', '--host', '127.0.0.1', '--port', '0'],
)

for (const url of [
  'http://127.0.0.1:3080',
  'http://127.0.0.1:3080/?token=test-launch-token_123-abc',
]) {
  const line = `dsh web: ${url}\n`
  for (let split = 0; split < line.length; split += 1) {
    const read = createHarnessReadyUrlReader()
    assert.equal(read('stdout', line.slice(0, split)), undefined)
    assert.equal(read('stderr', 'interleaved diagnostic\n'), undefined)
    assert.equal(read('stdout', line.slice(split)), url)
  }
}

const readReadyUrl = createHarnessReadyUrlReader()
assert.equal(readReadyUrl('stdout', 'starting service\n'), undefined)
assert.equal(readReadyUrl('stdout', 'dsh web: http://127.0.0.1:3080.evil.example/\n'), undefined)
assert.equal(readReadyUrl('stderr', '\x1b[32mdsh web: http://127.0.0.1:3080/?token=test-token\x1b[0m\r\n'), 'http://127.0.0.1:3080/?token=test-token')

console.log('Harness launch tests passed')
