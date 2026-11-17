import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mediaPath, persist, probe, render } from '../src/media.ts'

test('语言专属视频保留原生对白音轨并叠加字幕', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-audio-'))
  const inputs: any[] = []
  try {
    for (const [index, frequency] of [440, 660].entries()) {
      const file = join(dir, 'shot-' + index + '.mp4')
      execFileSync('ffmpeg', [
        '-nostdin', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=gray:s=360x640:d=1:r=24',
        '-f', 'lavfi', '-i', 'sine=frequency=' + frequency + ':duration=1:sample_rate=24000',
        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file,
      ])
      inputs.push(await persist(readFileSync(file), 'mp4', {
        ...(await probe(file)), kind: 'video', language: 'en', shot_id: index ? 'S02' : 'S01',
      }))
    }
    const cut = [
      { shot_id: 'S01', video_ref: inputs[0].ref ?? inputs[0].sha256, start_ms: 0, duration_ms: 1000, dialogue: [] },
      { shot_id: 'S02', video_ref: inputs[1].ref ?? inputs[1].sha256, start_ms: 1000, duration_ms: 1000, dialogue: [] },
    ]
    const assets = Object.fromEntries(inputs.map((asset, index) => [
      cut[index].video_ref,
      { ...asset, ref: cut[index].video_ref, kind: 'video', audio: true, language: 'en', shot_id: cut[index].shot_id },
    ]))
    const lines = [{ line_id: 'L01', shot_id: 'S01', speaker_id: 'person_1', source_text: 'Hi', target_text: 'Hi',
      audio_ref: null, audio_duration_ms: null, audio_start_ms: 100, subtitle_start_ms: 100, subtitle_end_ms: 800 }]
    const output = await render(cut, lines, null, assets)
    const info = await probe(mediaPath(output.file))
    assert.equal(info.duration_ms, 2000)
    assert.equal(info.audio, true)
    assert.equal(info.video, true)
    for (const input of inputs) {
      try { unlinkSync(mediaPath(input.file)) } catch {}
    }
    try { unlinkSync(mediaPath(output.file)) } catch {}
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
