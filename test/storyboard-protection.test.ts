import assert from 'node:assert/strict'
import { test } from 'node:test'
import { protectStoryboardDialogue } from '../src/jobs.ts'

test('分镜 Agent 不能改写已确认对白', () => {
  const source = { line_id: 'L01', speaker_id: 'person_1', text: '我以为你早扔了。' }
  const input = { approved_script: { beats: [{ beat_id: 'B01', dialogue: [source] }] } }
  const response = { status: 'ok', issues: [], result: {
    total_duration_ms: 3000,
    shots: [{ shot_id: 'S01', beat_ids: ['B01'], dialogue: [{ ...source, speaker_id: 'person_2', text: '改成别的台词。' }] }],
  } }
  const protectedResult = protectStoryboardDialogue(response, input)
  assert.deepEqual(protectedResult.response.result.shots[0].dialogue[0], source)
  assert.equal(protectedResult.changes.length, 1)
  assert.equal(response.result.shots[0].dialogue[0].text, '改成别的台词。')
})
