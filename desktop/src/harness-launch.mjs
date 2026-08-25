import semver from 'semver'

// Harness 0.1.1-rc.2 changed `dsh web` to open the default browser unless the
// caller opts out. Older bundled runtimes reject the new flag, so keep their
// original arguments until the active runtime supports it.
const NO_OPEN_MIN_VERSION = '0.1.1-rc.2'

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
