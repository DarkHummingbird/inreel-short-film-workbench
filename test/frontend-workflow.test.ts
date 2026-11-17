import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProject, current, openStore } from '../src/store.ts'
import { apply, put } from '../src/workflow.ts'
import { validateScript } from '../src/contracts.ts'
import { clone, fixture } from '../src/common.ts'
import { queue } from '../src/jobs.ts'

test('首次提交需求必须明确故事关系，不再静默默认 BL', () => {
  const p = createProject('新人需求校验', 'op_lin')
  const data = {
    raw:'两位成年女性在咖啡店重逢。', goal:'series_promotion', theme:'',
    target_duration_ms:30000, target_languages:['zh-CN'], planned_shot_count:5,
  }
  apply(p, 'op_lin', 'brief.save', { data })
  assert.equal(current(p, 'brief_draft')?.data.theme, null)
  assert.throws(() => apply(p, 'op_lin', 'brief.submit', { data }), /请选择故事关系/)
  const submitted = apply(p, 'op_lin', 'brief.submit', { data:{ ...data, theme:'GL' } })
  assert.equal(submitted.data.theme, 'GL')
  assert.equal(submitted.status, 'approved')
})

test('历史剧本可恢复成新草稿并重开下游确认', () => {
  const p = createProject('历史恢复', 'op_lin')
  p.active['1'] = 'check1@v1'
  p.confirmations['check1@v1'] = { ref:'check1@v1', artifact_ref:'concept@v1' }
  const original = put(p, 'dir_zhou', 'script', clone(fixture.script), 'check1@v1')
  const revised = clone(fixture.script)
  revised.logline += ' 修订版。'
  const latest = put(p, 'dir_zhou', 'script', revised, 'check1@v1')
  p.active['2'] = 'check2@v1'
  p.confirmations['check2@v1'] = { ref:'check2@v1', artifact_ref:latest.ref }
  const restored = apply(p, 'dir_zhou', 'restore', { ref:original.ref })
  assert.equal(restored.type, 'script')
  assert.equal(restored.status, 'draft')
  assert.equal(restored.data.logline, fixture.script.logline)
  assert.notEqual(restored.ref, latest.ref)
  assert.equal(p.active['2'], undefined)
  assert.equal(p.artifacts[original.ref].data.logline, fixture.script.logline)
})

test('历史成片可恢复为待提交草稿并重开验收', () => {
  const p = createProject('成片恢复', 'op_lin')
  p.languages = ['zh-CN']
  p.active['5:zh-CN'] = 'zh_check5@v1'
  p.confirmations['zh_check5@v1'] = { ref:'zh_check5@v1' }
  p.assets['file@v1'] = { kind:'delivery', duration_ms:30000 }
  p.assets['file@v2'] = { kind:'delivery', duration_ms:30000 }
  const first = put(p, 'dir_zhou', 'delivery', { file_ref:'file@v1', language_confirmation_ref:'zh_check5@v1' }, 'zh_check5@v1', 'zh-CN')
  const second = put(p, 'dir_zhou', 'delivery', { file_ref:'file@v2', language_confirmation_ref:'zh_check5@v1' }, 'zh_check5@v1', 'zh-CN')
  p.active['6:zh-CN'] = 'zh_check6@v1'
  p.confirmations['zh_check6@v1'] = { ref:'zh_check6@v1', artifact_ref:second.ref, file_ref:'file@v2' }
  const restored = apply(p, 'dir_zhou', 'restore', { ref:first.ref })
  assert.equal(restored.type, 'delivery')
  assert.equal(restored.status, 'draft')
  assert.equal(restored.data.file_ref, 'file@v1')
  assert.equal(p.active['6:zh-CN'], undefined)
  assert.equal(p.assets['file@v2'].kind, 'delivery')
})

test('导演建议按产物类型映射正确确认节点和责任人', () => {
  const p = createProject('导演节点映射', 'op_lin')
  p.languages = ['zh-CN']
  const brief = put(p, 'op_lin', 'brief', { ...clone(fixture.brief), theme:'BL', target_languages:['zh-CN'] }, null)
  p.current.brief = brief.ref
  const targets = [
    ['concept',null,1], ['script',null,2], ['storyboard',null,3],
    ['cut',null,4], ['language','zh-CN',5], ['delivery','zh-CN',6],
  ] as const
  for (const [type, language, checkpoint] of targets) {
    const ref = type + '_advice@v1'
    p.artifacts[ref] = { ref, type, language, status:'draft', data:{ shots:[], lines:[] }, upstream:null, author:'dir_zhou', at:new Date().toISOString() }
    const job = queue(p, 'dir_zhou', { task:'director', ref, language })
    assert.equal(job.plan.input.next_checkpoint, checkpoint)
    assert.equal(job.plan.input.target_language, checkpoint >= 5 ? 'zh-CN' : null)
    assert.ok(Array.isArray(job.plan.input.blocking_issues))
  }
})

test('新项目只有运营、编导、负责人，确认节点 6 由运营验收', () => {
  const p = createProject('三岗位验收', 'op_lin')
  assert.deepEqual(Object.keys(p.members).sort(), ['director','operations','owner'])
  assert.equal(p.members.reviewer, undefined)
  assert.throws(() => apply(p, 'reviewer_wu', 'read', { id:'x' }), /只有项目成员可访问/)
  p.languages = ['zh-CN']
  p.active['5:zh-CN'] = 'zh_check5@v1'
  p.confirmations['zh_check5@v1'] = { ref:'zh_check5@v1' }
  p.assets['zh_file@v1'] = { kind:'delivery', duration_ms:30000, sha256:'file' }
  const delivery = put(p, 'dir_zhou', 'delivery', {
    file_ref:'zh_file@v1', language_confirmation_ref:'zh_check5@v1',
  }, 'zh_check5@v1', 'zh-CN')
  apply(p, 'dir_zhou', 'submit', { ref:delivery.ref })
  assert.equal(p.notifications.at(-1).to, 'op_lin')
  const record = apply(p, 'op_lin', 'decide', {
    step:6, ref:delivery.ref, file_ref:'zh_file@v1', decision:'approve', content_checked:true,
  })
  assert.equal(record.actor, 'op_lin')
  assert.equal(record.delivery_review.actor, 'op_lin')
})

test('表单草稿保存在 SQLite，按项目和账号隔离且不推进项目版本', () => {
  const store = openStore(':memory:')
  try {
    const p = createProject('跨设备草稿', 'op_lin')
    store.save(p)
    const before = p.version
    const saved = store.saveDraft(p.id, 'op_lin', p.id + ':operations:brief:zh-CN:brief-editor',
      { values:[{ name:'raw', type:'textarea', value:'另一台电脑也能恢复', checked:false }] })
    assert.ok(saved.at > 0)
    const own = store.drafts(p.id, 'op_lin')
    assert.equal(own[p.id + ':operations:brief:zh-CN:brief-editor'].values[0].value, '另一台电脑也能恢复')
    assert.deepEqual(store.drafts(p.id, 'dir_zhou'), {})
    assert.equal(store.get(p.id).version, before)
    store.clearDraft(p.id, 'op_lin', p.id + ':operations:brief:zh-CN:brief-editor')
    assert.deepEqual(store.drafts(p.id, 'op_lin'), {})
  } finally { store.close() }
})

test('完整剧情剧本不能写入景别、机位或运镜', () => {
  const script = clone(fixture.script)
  script.beats[0].action = '特写推近纸袋提绳。'
  assert.throws(() => validateScript(script), /剧情剧本不要写景别/)
})
