import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const TERMINAL_BUTTON_PLUGIN_NAME = '@deepseek-harness-desktop/dsh-terminal-button'

const PLUGIN_FILES = ['package.json', 'index.mjs', 'client.js']
const PATCH_CONTENT = `# Managed by DeepSeek Harness Desktop. Local desktop-only browser integration.
- insert:
    - id: desktop-terminal-button
      name: '${TERMINAL_BUTTON_PLUGIN_NAME}'
`

function pluginInstallDirectory(dshHome) {
  return join(dshHome, 'profiles', 'node_modules', '@deepseek-harness-desktop', 'dsh-terminal-button')
}

export async function installDesktopIntegration({ appPath, userDataDirectory }) {
  const sourceDirectory = join(appPath, 'plugins', 'dsh-terminal-button')
  const dshHome = join(userDataDirectory, 'harness-home')
  const targetDirectory = pluginInstallDirectory(dshHome)
  const integrationDirectory = join(userDataDirectory, 'desktop-integration')
  const patchPath = join(integrationDirectory, 'cordis.patch.yml')

  await mkdir(targetDirectory, { recursive: true })
  await mkdir(integrationDirectory, { recursive: true })
  await Promise.all(PLUGIN_FILES.map(async file => {
    await readFile(join(sourceDirectory, file))
    await copyFile(join(sourceDirectory, file), join(targetDirectory, file))
  }))
  await writeFile(patchPath, PATCH_CONTENT)

  return { dshHome, patchPath, pluginDirectory: targetDirectory }
}
