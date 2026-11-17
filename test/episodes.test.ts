import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clone, fixture } from '../src/common.ts'
import { createSequel } from '../src/episodes.ts'
import { queue } from '../src/jobs.ts'
import { createProject, openStore } from '../src/store.ts'
import { apply, put } from '../src/workflow.ts'

test('续集引用已确认的人物、服装、场景和道具版本，换装只影响指定镜头', () => {
  const op = 'op_lin', dir = 'dir_zhou'
  const source = createProject('末班车之后', op)
  source.brief.theme = 'BL'
  const story = clone(fixture.script)
  const shots = clone(fixture.shots)
  const content = { shots, total_duration_ms: shots.reduce((sum, shot) => sum + shot.duration_ms, 0) }
  function confirmScript(project, data) {
    const script = put(project, dir, 'script', data, null)
    project.active['2'] = 'check2@v1'
    project.confirmations['check2@v1'] = { ref: 'check2@v1', artifact_ref: script.ref }
  }
  confirmScript(source, story)
  source.assets['azhe@v1'] = { kind: 'image', file: 'azhe.png', bytes: 10, character_id:'azhe' }
  source.assets['xiaolin@v1'] = { kind: 'image', file: 'xiaolin.png', bytes: 10, character_id:'xiaolin' }
  source.assets['unused@v1'] = { kind: 'image', file: 'unused.png', bytes: 10, character_id:'azhe' }
  source.assets['station@v1'] = { kind: 'image', file: 'station.png', bytes: 10, reference_kind:'location' }
  source.assets['case@v1'] = { kind: 'image', file: 'case.png', bytes: 10, reference_kind:'prop' }
  const initial = { ...content, references: { azhe: 'azhe@v1', xiaolin: 'xiaolin@v1' },
    keyframes: Object.fromEntries(shots.map(s => [s.shot_id, 'station@v1'])),
    production: Object.fromEntries(shots.map(s => [s.shot_id, { location: 'station@v1', prop: 'case@v1' }])),
  }
  const board = apply(source, dir, 'artifact', { type: 'storyboard', data: initial })
  apply(source, dir, 'decide', { step: 3, ref: board.ref, decision: 'approve' })
  apply(source, dir, 'artifact', { type: 'storyboard', data: {
    ...initial, references: { ...initial.references, azhe: 'unused@v1' },
  } })
  const db = openStore(':memory:')
  try {
    db.save(source)
    const make = (parent, number) => createSequel(parent, op, '末班车之后 · 站外', number)
    const request = { expected_version: source.version, title: '末班车之后 · 站外' }
    assert.throws(() => db.sequel(source.id, dir, request, 'forbidden', make), /没有此操作权限/)
    const created = db.sequel(source.id, op, request, 'first', make).result
    assert.equal(db.sequel(source.id, op, request, 'first', make).result.id, created.id)
    const sequel = db.get(created.id)
    assert.equal(sequel.episode.number, 2)
    assert.equal(sequel.episode.board_ref, board.ref)
    assert.equal(sequel.episode.series_id, source.id)
    assert.equal(sequel.assets[sequel.episode.references.azhe].reuse.version, 'azhe@v1')
    assert.equal(Object.values(sequel.assets).length, 4)
    assert.equal(Object.keys(sequel.active).length, 0)
    const brief = apply(sequel, op, 'brief.submit', { data: { ...sequel.brief, raw: '站外，阿哲追上准备离开的小林。' } })
    assert.match(brief.data.must_keep[0], /续集承接上集结尾/)
    assert.deepEqual(sequel.artifacts[sequel.current.characters].data, story.characters)
    confirmScript(sequel, story)
    let draft = apply(sequel, dir, 'artifact', { type: 'storyboard', data: content })
    const location = Object.values(sequel.assets).find(a => a.reuse.kind === 'location')
    const prop = Object.values(sequel.assets).find(a => a.reuse.kind === 'prop')
    assert.equal(location.file, source.assets['station@v1'].file)
    assert.equal(prop.file, source.assets['case@v1'].file)
    const shot = shots.find(s => s.character_ids.length === 2)
    const other = shots.find(s => s.shot_id !== shot.shot_id && s.character_ids.includes('xiaolin'))
    assert.throws(() => apply(sequel, dir, 'shot.edit', {
      board_ref: draft.ref, shot_id: shot.shot_id, changes: { location: prop.ref },
    }), /对应类型/)
    draft = apply(sequel, dir, 'shot.edit', {
      board_ref: draft.ref, shot_id: shot.shot_id, changes: { location: location.ref, prop: prop.ref },
    })
    const job = queue(sequel, dir, { task: 'keyframe', shot_id: shot.shot_id })
    assert.deepEqual(job.plan.production.references, { location: location.ref, prop: prop.ref })
    assert.equal(job.plan.input.character_references.length, 2)
    assert.match(job.plan.production.wardrobe.find(entry => entry.character_id === 'xiaolin').description, /浅灰外套/)
    draft = apply(sequel, dir, 'artifact', { type: 'storyboard', data: {
      ...draft.data, keyframes: { [shot.shot_id]: location.ref, [other.shot_id]: location.ref },
    } })
    const changed = apply(sequel, dir, 'wardrobe', { board_ref: draft.ref, shot_id: shot.shot_id,
      character_id: 'xiaolin', description: '深灰风衣' })
    assert.equal(changed.data.keyframes[shot.shot_id], undefined)
    assert.equal(changed.data.keyframes[other.shot_id], location.ref)
    assert.equal(changed.data.production[other.shot_id].wardrobe.xiaolin, draft.data.production[other.shot_id].wardrobe.xiaolin)
    assert.equal(queue(sequel, dir, { task: 'keyframe', shot_id: shot.shot_id }).plan.production.wardrobe.find(entry => entry.character_id === 'xiaolin').description, '深灰风衣')
    assert.deepEqual(db.get(source.id).artifacts[board.ref].data, initial)
  } finally { db.close() }
})
