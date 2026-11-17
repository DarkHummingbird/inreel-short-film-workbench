import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProject } from '../src/store.ts'
import { apply, put } from '../src/workflow.ts'
import { clone, fixture } from '../src/common.ts'

test('历史项目兼容：旧审核账号处理确认节点 6 并通知运营下载', () => {
  const operator = 'op_lin', director = 'dir_zhou', reviewer = 'reviewer_wu'
  const p = createProject('成片独立审核', operator, { reviewer })
  p.languages = ['zh-CN']
  p.active['5:zh-CN'] = 'zh_check5@v1'
  p.confirmations['zh_check5@v1'] = { ref: 'zh_check5@v1' }
  const makeDelivery = (file_ref: string) => {
    p.assets[file_ref] = { kind: 'delivery', duration_ms: 30000, sha256: file_ref }
    return put(p, director, 'delivery', { file_ref, language_confirmation_ref: 'zh_check5@v1' }, 'zh_check5@v1', 'zh-CN')
  }
  const first = makeDelivery('zh_file@v1')
  apply(p, director, 'submit', { ref: first.ref })
  assert.equal(p.notifications.at(-1).to, reviewer)
  const review = { step: 6, ref: first.ref, file_ref: first.data.file_ref, decision: 'return', note: '复核首句字幕', start_ms: 100, end_ms: 1200 }
  for (const account of [operator, director, 'owner_chen']) {
    assert.throws(() => apply(p, account, 'decide', review), /没有此操作权限/)
  }
  apply(p, reviewer, 'decide', review)
  assert.equal(first.status, 'returned')
  assert.equal(p.notifications.at(-1).to, director)
  const second = makeDelivery('zh_file@v2')
  assert.throws(() => apply(p, reviewer, 'submit', { ref: second.ref }), /没有此操作权限/)
  apply(p, director, 'submit', { ref: second.ref })
  const approved = { step: 6, ref: second.ref, decision: 'approve', content_checked: true }
  assert.throws(() => apply(p, reviewer, 'decide', { ...approved, file_ref: first.data.file_ref }), /成片文件已变化/)
  const record = apply(p, reviewer, 'decide', { ...approved, file_ref: second.data.file_ref })
  assert.equal(record.actor, reviewer)
  assert.equal(record.delivery_review.sha256, p.assets[second.data.file_ref].sha256)
  assert.ok(p.notifications.some(n => n.kind === 'approved' && n.to === operator && n.ref === second.ref))
})

test('确认节点 4 要求对应剪辑预览及编导对采用候选的结论', () => {
  const p = createProject('末班车之后 · 人工质检', 'op_lin')
  const actor = 'dir_zhou'
  const board = put(p, actor, 'storyboard', {
    shots: [{ shot_id: 'S04', dialogue: [] }],
    references: {}, keyframes: {}, production: { S04: {} },
  }, null)
  p.confirmations['check3@v1'] = { ref: 'check3@v1', artifact_ref: board.ref }
  p.active['3'] = 'check3@v1'
  const ref = 'S04_video@v1'
  p.assets[ref] = { ref, kind: 'video', shot_id: 'S04', duration_ms: 3000, board_ref: board.ref }
  const select = (data: object) => apply(p, actor, 'select', { shot_id: 'S04', ref, ...data })
  assert.throws(() => select({}), /人工结论/)
  select({ decision: 'reject', note: '箱杆变形' })
  assert.equal(p.selected.S04, undefined)
  select({ decision: 'accept', note: '已看片核对' })
  const cut = apply(p, actor, 'artifact', { type: 'cut', data: {} })
  const approve = () => apply(p, actor, 'decide', { step: 4, ref: cut.ref, decision: 'approve' })
  assert.throws(approve, /剪辑预览/)
  p.assets['rough_file@v1'] = { kind: 'delivery' }
  cut.data.preview_ref = 'rough_file@v1'
  const review = p.assets[ref].human_review
  delete p.assets[ref].human_review
  assert.throws(approve, /人工通过记录/)
  p.assets[ref].human_review = review
  approve()
  assert.equal(p.confirmations[p.active['4']].preview_ref, 'rough_file@v1')
  assert.equal(p.confirmations[p.active['4']].shot_reviews[0].video_ref, ref)
})

test('接镜结论绑定相邻版本和切点，裁切后必须重新检查', () => {
  const p = createProject('接镜检查', 'op_lin'), actor = 'dir_zhou'
  const board = put(p, actor, 'storyboard', { shots: ['S01','S02'].map(shot_id => ({ shot_id, dialogue: [] })), production: {}, join_checks: true }, null)
  p.confirmations['check3@v1'] = { ref:'check3@v1', artifact_ref:board.ref }
  p.active['3'] = 'check3@v1'
  for (const shot_id of ['S01','S02']) {
    const ref = shot_id + '_video@v1'
    p.assets[ref] = { ref, kind:'video', shot_id, duration_ms:3000, board_ref:board.ref }
    apply(p,actor,'select',{shot_id,ref,decision:'accept',note:'已看片'})
  }
  p.assets['preview@v1'] = { kind:'delivery' }
  const save = trims => { const item = apply(p,actor,'artifact',{type:'cut',data:{trims}}); item.data.preview_ref='preview@v1'; return item }
  const first = save({ S01:{in_ms:500,out_ms:2500} })
  assert.equal(first.data.duration_ms,5000)
  assert.equal(first.data.cut[1].start_ms,2000)
  const approve = item => apply(p,actor,'decide',{step:4,ref:item.ref,decision:'approve'})
  assert.throws(() => approve(first), /缺少当前切点/)
  const review = {cut_ref:first.ref,shot_id:'S01',next_shot_id:'S02',left_ref:'S01_video@v1',right_ref:'S02_video@v1',left_out_ms:2500,right_in_ms:0,decision:'accept',note:'已连播检查'}
  assert.throws(() => apply(p,actor,'join.review',{...review,left_out_ms:3000}), /切点已变化/)
  apply(p,actor,'join.review',review)
  assert.equal(approve(first).join_reviews[0].left_out_ms,2500)
  const second = save({ S01:{in_ms:500,out_ms:2400} })
  assert.throws(() => approve(second), /缺少当前切点/)
  assert.throws(() => save({ S01:{in_ms:2500,out_ms:2400} }), /入点或出点/)
})

test('逐镜标注和返工保留其他选版，仅在镜间承接变化时要求复核', () => {
  const p = createProject('末班车之后 · 单镜返工', 'op_lin')
  const actor = 'dir_zhou'
  const script = put(p, actor, 'script', fixture.script, null)
  const scriptCheck = { ref: 'check2@v1', artifact_ref: script.ref }
  p.confirmations[scriptCheck.ref] = scriptCheck
  p.active['2'] = scriptCheck.ref
  p.assets['station@v1'] = { kind: 'image', reference_kind:'location' }
  for (const person of fixture.script.characters) p.assets[person.character_id+'_ref@v1'] = { kind:'image', character_id:person.character_id }
  const shots = clone(fixture.shots)
  const data = {
    shots, total_duration_ms: shots.reduce((sum, shot) => sum + shot.duration_ms, 0),
    references: Object.fromEntries(fixture.script.characters.map(person => [person.character_id, person.character_id+'_ref@v1'])),
    keyframes: Object.fromEntries(shots.map(shot => [shot.shot_id, 'station@v1'])),
    production: Object.fromEntries(shots.map(shot => [shot.shot_id, { location: 'station@v1' }])),
  }
  const board = apply(p, actor, 'artifact', { type: 'storyboard', data })
  const approveBoard = ref => apply(p, actor, 'decide', { step: 3, ref, decision: 'approve' })
  approveBoard(board.ref)
  const adopt = (shotId, videoRef) => apply(p, actor, 'select', { shot_id: shotId, ref: videoRef, decision: 'accept', note: '人工对照通过' })
  function addVideo(shotId, boardRef, version) {
    const ref = shotId + '_video@v' + version
    p.assets[ref] = { ref, kind: 'video', shot_id: shotId, duration_ms: 7000, board_ref: boardRef }
    return ref
  }
  for (const shot of shots) adopt(shot.shot_id, addVideo(shot.shot_id, board.ref, 1))
  const target = { shot_id: 'S04', ref: p.selected.S04 }
  const mark = { ...target, start_ms: 2500, end_ms: 4000, category: 'prop', expected: '手指逐渐握紧', actual: '手指始终没有明显变化' }
  assert.throws(() => apply(p, actor, 'shot.observe', { ...mark, end_ms: 8000 }), /时长内/)
  assert.throws(() => apply(p, 'op_lin', 'shot.observe', mark), /没有此操作权限/)
  const issue = apply(p, actor, 'shot.observe', mark)
  const edit = (base, changes) => apply(p, actor, 'shot.edit', { board_ref: base.ref, shot_id: target.shot_id, changes, observation_id: issue.id })
  const actionEdit = edit(board, { action: '手指先放松，再缓慢握紧箱杆' })
  assert.equal(actionEdit.data.keyframes.S04, board.data.keyframes.S04)
  assert.equal(actionEdit.shot_revision.observation_id, issue.id)
  assert.deepEqual(actionEdit.data.shots.find(s => s.shot_id === 'S03'), board.data.shots.find(s => s.shot_id === 'S03'))
  assert.throws(() => edit(board, { camera: '固定机位' }), /分镜已更新/)
  assert.throws(() => apply(p, actor, 'artifact', { type: 'cut', data: {} }), /新版分镜/)
  approveBoard(actionEdit.ref)
  assert.equal(p.selected.S04, undefined)
  assert.equal(p.selected.S03, 'S03_video@v1')
  assert.throws(() => adopt('S04', target.ref), /不属于本版镜头/)
  adopt('S04', addVideo('S04', actionEdit.ref, 2))
  p.assets['rough_file@v1'] = { kind: 'delivery' }
  function approveCut() {
    const cut = apply(p, actor, 'artifact', { type: 'cut', data: {} })
    cut.data.preview_ref = 'rough_file@v1'
    return apply(p, actor, 'decide', { step: 4, ref: cut.ref, decision: 'approve' })
  }
  const approvedCut = approveCut()
  assert.equal(approvedCut.shot_reviews.find(entry => entry.shot_id === 'S03').board_ref, board.ref)
  const visualEdit = edit(actionEdit, { framing: '手指近景', end_state: '行李箱横转后停下' })
  assert.equal(visualEdit.data.keyframes.S04, undefined)
  assert.throws(() => approveBoard(visualEdit.ref), /S04 缺少关键帧/)
  const reframed = apply(p, actor, 'artifact', { type: 'storyboard', data: {
    ...visualEdit.data, keyframes: { ...visualEdit.data.keyframes, S04: 'station@v1' },
  } })
  assert.equal(reframed.has_shot_rework, true)
  approveBoard(reframed.ref)
  adopt('S04', addVideo('S04', reframed.ref, 3))
  assert.equal(p.selected.S05, 'S05_video@v1')
  assert.throws(approveCut, /S05 缺少与当前分镜承接一致的人工通过记录/)
  adopt('S05', p.selected.S05)
  assert.equal(approveCut().shot_reviews.find(entry => entry.shot_id === 'S05').board_ref, reframed.ref)
})

test('结构化编排支持新增、删除、排序和修改，并只失效实际受影响的首帧与视频', () => {
  const p = createProject('分镜编排', 'op_lin'), actor = 'dir_zhou'
  const script = put(p, actor, 'script', fixture.script, null)
  p.confirmations['check2@v1'] = { ref:'check2@v1', artifact_ref:script.ref }
  p.active['2'] = 'check2@v1'
  p.assets['station@v1'] = { kind:'image', reference_kind:'location' }
  for (const person of fixture.script.characters) p.assets[person.character_id+'_ref@v1'] = { kind:'image', character_id:person.character_id }
  const shots = clone(fixture.shots)
  const board = apply(p, actor, 'artifact', { type:'storyboard', data:{
    shots, total_duration_ms:shots.reduce((sum, shot) => sum + shot.duration_ms, 0),
    references:Object.fromEntries(fixture.script.characters.map(person => [person.character_id,person.character_id+'_ref@v1'])),
    keyframes:Object.fromEntries(shots.map(shot => [shot.shot_id,'station@v1'])),
    production:Object.fromEntries(shots.map(shot => [shot.shot_id,{ location:'station@v1' }])),
  } })
  apply(p, actor, 'decide', { step:3, ref:board.ref, decision:'approve' })
  for (const shot of shots) {
    const ref = shot.shot_id + '_video@v1'
    p.assets[ref] = { ref, kind:'video', shot_id:shot.shot_id, duration_ms:shot.duration_ms, board_ref:board.ref }
    apply(p, actor, 'select', { shot_id:shot.shot_id, ref, decision:'accept', note:'已看片' })
  }

  const arranged = [shots[1], shots[0], shots[2], shots[3]].map((shot, order) => ({
    ...shot, order:order + 1, ...(shot.shot_id === 'S03' ? { action:shot.action + ' 增加一次自然的呼吸停顿。' } : {}),
  }))
  const source = shots.find(shot => shot.shot_id === 'S05')
  arranged.push({ ...source, shot_id:'S06', order:5, action:'补充一个保持空间连续的落镜。' })
  const revision = apply(p, actor, 'storyboard.arrange', { board_ref:board.ref, shots:arranged })

  assert.deepEqual(revision.shot_structure_revision?.added, ['S06'])
  assert.deepEqual(revision.shot_structure_revision?.deleted, ['S05'])
  assert.deepEqual(revision.shot_structure_revision?.modified, ['S03'])
  assert.deepEqual(revision.shot_structure_revision?.reordered, ['S02','S01','S03','S04'])
  assert.deepEqual(revision.shot_structure_revision?.keyframes_invalidated.sort(), ['S06'])
  assert.deepEqual(revision.shot_structure_revision?.videos_need_regeneration.sort(), ['S03','S06'])
  assert.equal(revision.data.keyframes.S01, 'station@v1')
  assert.equal(revision.data.keyframes.S03, 'station@v1')
  assert.equal(revision.data.keyframes.S06, undefined)
  assert.equal(revision.data.production.S05, undefined)
  assert.equal(revision.data.total_duration_ms, arranged.reduce((sum, shot) => sum + shot.duration_ms, 0))
  assert.throws(() => apply(p, actor, 'decide', { step:3, ref:revision.ref, decision:'approve' }), /S06 缺少关键帧/)

  revision.data.keyframes.S06 = 'station@v1'
  revision.data.production.S06 = { location:'station@v1' }
  apply(p, actor, 'decide', { step:3, ref:revision.ref, decision:'approve' })
  assert.equal(p.selected.S05, undefined)
  assert.equal(p.selected.S03, undefined)
  assert.equal(p.selected.S01, 'S01_video@v1')
  assert.equal(p.selected.S02, 'S02_video@v1')
  assert.equal(p.selected.S04, 'S04_video@v1')
})
