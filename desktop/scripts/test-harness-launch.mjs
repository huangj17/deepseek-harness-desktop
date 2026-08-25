import assert from 'node:assert/strict'
import { harnessWebArguments } from '../src/harness-launch.mjs'

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

console.log('Harness launch tests passed')
