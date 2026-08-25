import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const manifestPath = require.resolve('@deepseek-ai/dsh/package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const binPath = join(dirname(manifestPath), manifest.bin.dsh)
await readFile(binPath)

const desktopManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (!desktopManifest.build.files.includes('build/icon.png')) {
  throw new Error('The tray icon is missing from build.files')
}
await readFile(new URL('../build/icon.png', import.meta.url))

if (manifest.version !== '0.1.0-rc.6') {
  throw new Error(`Unexpected @deepseek-ai/dsh version: ${String(manifest.version)}`)
}

console.log(`Verified @deepseek-ai/dsh ${manifest.version} at ${binPath}`)
console.log('Verified packaged tray icon')
