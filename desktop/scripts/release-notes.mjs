// 取出某个版本的发布说明：优先用 CHANGELOG.md 里对应的小节，没写的话退回该
// 版本区间的提交标题，保证发布说明永远不会是空的。
// 用法：node scripts/release-notes.mjs v0.2.9 [> notes.md]

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function extractChangelogSection(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex(line => line.trim() === `## ${version}`)
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
  return body === '' ? undefined : body
}

function previousTag(tag) {
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', `${tag}^`], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

export function commitSubjects(tag) {
  const previous = previousTag(tag)
  const range = previous === undefined ? tag : `${previous}..${tag}`
  const log = execFileSync('git', ['log', '--reverse', '--pretty=- %s', range], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
  return log === '' ? undefined : log
}

export async function releaseNotes(tag) {
  const version = tag.replace(/^v/, '')
  const changelog = await readFile(join(repositoryRoot, 'CHANGELOG.md'), 'utf8').catch(() => '')
  return extractChangelogSection(changelog, version) ?? commitSubjects(tag) ?? `发布 ${version}。`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2]
  if (tag === undefined) {
    console.error('用法：node scripts/release-notes.mjs <tag>')
    process.exit(1)
  }
  process.stdout.write(`${await releaseNotes(tag)}\n`)
}
