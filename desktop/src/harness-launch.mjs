import semver from 'semver'

// Harness 0.1.1-rc.2 changed `dsh web` to open the default browser unless the
// caller opts out. Older bundled runtimes reject the new flag, so keep their
// original arguments until the active runtime supports it.
const NO_OPEN_MIN_VERSION = '0.1.1-rc.2'

// Wait for the complete line: a pipe chunk can end at the port or inside the
// authentication token. Keep stdout and stderr separate when their chunks interleave.
export function createHarnessReadyUrlReader() {
  const pending = new Map()
  return (source, chunk) => {
    const lines = `${pending.get(source) ?? ''}${chunk.toString()}`.split('\n')
    pending.set(source, lines.pop().slice(-40_000))
    for (const line of lines) {
      const plain = line.replace(/\x1b\[[0-9;]*m/g, '')
      const match = plain.match(/dsh web:[ \t]+(http:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?)[ \t]*\r?$/)
      if (match !== null) return match[1]
    }
    return undefined
  }
}

export function harnessWebArguments(runtime, { patchPath } = {}) {
  return [
    '--expose-internals',
    runtime.binPath,
    'web',
    ...(patchPath === undefined ? [] : ['--patch', patchPath]),
    ...(semver.gte(runtime.version, NO_OPEN_MIN_VERSION) ? ['--no-open'] : []),
    '--host', '127.0.0.1',
    '--port', '0',
  ]
}
