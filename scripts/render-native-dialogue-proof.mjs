import { copyFile, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { render } from '../src/media.ts'

const root = resolve(import.meta.dirname, '..')
const project = JSON.parse(await readFile('/tmp/full-flow-state.json', 'utf8'))
const cut = project.artifacts['cut@v1'].data.cut
const lines = project.artifacts['zh_CN_lang@v2'].data.lines.map(line => ({
  ...line,
  audio_ref: null,
  audio_duration_ms: null,
}))
const rendered = await render(cut, lines, project.assets['bgm@v1'], project.assets)
const source = join(root, 'data/full-flow-acceptance-2026-11-18/media', rendered.file)
const output = join(root, 'test-results/full-flow-acceptance-2026-11-18/雨停照相馆-原生对白-字幕BGM-v2.mp4')
await copyFile(source, output)
const info = await stat(output)
console.log(JSON.stringify({ output, bytes: info.size, rendered }, null, 2))
