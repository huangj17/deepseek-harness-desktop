import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { installDesktopIntegration, TERMINAL_BUTTON_PLUGIN_NAME } from '../src/desktop-integration.mjs'

const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const userDataDirectory = await mkdtemp(join(tmpdir(), 'deepseek-harness-integration-test-'))
try {
  const integration = await installDesktopIntegration({ appPath: desktopDirectory, userDataDirectory })
  assert.match(await readFile(integration.patchPath, 'utf8'), new RegExp(TERMINAL_BUTTON_PLUGIN_NAME.replaceAll('/', '\\/')))
  const manifest = JSON.parse(await readFile(join(integration.pluginDirectory, 'package.json'), 'utf8'))
  assert.equal(manifest.name, TERMINAL_BUTTON_PLUGIN_NAME)
  assert.equal(manifest.dsh.client.platform, 'web')
  await readFile(join(integration.pluginDirectory, 'index.mjs'))

  let registration
  let installedStyle
  const document = {
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild(style) { installedStyle = style } },
  }
  const source = await readFile(join(integration.pluginDirectory, 'client.js'), 'utf8')
  vm.runInNewContext(source, { document, window: { __ModuleLoader__: { load(value) { registration = value } } } })
  assert.equal(registration.id, TERMINAL_BUTTON_PLUGIN_NAME)
  assert.equal(typeof registration.factory, 'function')
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [initial, () => {}],
  }
  const plugin = registration.factory(specifier => {
    assert.equal(specifier, 'react')
    return React
  })
  let registered
  plugin.apply({
    effect: callback => callback(),
    locale: { register: (namespace, dictionaries) => {
      assert.equal(namespace, 'desktop-terminal')
      assert.equal(dictionaries.en.open, 'Open DSH Terminal')
    } },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'sidebar.footer.action')
        callback()
      },
      register(options, component) {
        registered = { options, component }
      },
    },
  })
  assert.match(installedStyle.textContent, /\[data-slot="sidebar\.footer\.action"\]:has\(\.dsh-desktop-terminal-button\)/)
  assert.match(installedStyle.textContent, /flex-direction: column/)
  assert.match(installedStyle.textContent, /\.dsh-desktop-terminal-button \{\s+flex: none/)
  assert.equal(registered.options.id, 'desktop-terminal-button')
  const button = registered.component({
    wide: true,
    useSessions: selector => selector({ current: 'session-1', byId: { 'session-1': { id: 'session-1', cwd: '/workspace' } } }),
    useWorkspaces: selector => selector({ items: [], recentWorkspaceId: undefined }),
    t: key => ({ open: 'Open DSH Terminal', opening: 'Opening terminal…', error: 'Failed to open terminal' })[key],
  })
  assert.equal(button.type, 'button')
  assert.equal(button.props.disabled, true)
  console.log('Desktop integration tests passed')
} finally {
  await rm(userDataDirectory, { recursive: true, force: true })
}
