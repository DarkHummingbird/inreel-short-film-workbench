import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { createApp, demoPasswords } from '../src/server.ts'
import { openStore } from '../src/store.ts'
import { clone, fixture, hash } from '../src/common.ts'
import { contracts, manifest, schema, validateAgent } from '../src/contracts.ts'
import { probe } from '../src/media.ts'

const op = 'op_lin', dir = 'dir_zhou', owner = 'owner_chen'
const LANG = ['zh-CN', 'en', 'th']
const evidence = resolve(process.env.ACCEPTANCE_DIR || 'test-results')
const projectBrief = { ...fixture.brief, raw: '给《末班车之后》做一条真人 BL 宣推片。阿哲和小林是分手三个月的成年前任。小林拖着行李离开，阿哲在车站追上他。前三秒看出有人要走、有人舍不得，结尾停在小林有没有回头。约 36 秒、竖屏。' }
const status = (project: any, ref: string) => project.artifacts[ref].status
const isProblem = (field: string) => (error: any) => error.field === field
const expectations = [
  '',
  '想法及剧本上传进入同一制作流程，提交保存原文并通知编导。',
  '阅读通知不解锁剧本，运营选定候选才解锁。',
  '剧本退回不解锁分镜，旧版确认被拒，运营通过修改稿。',
  '角色参考和逐镜关键帧齐全后由编导确认，缺 S05 定位到该镜。',
  'S04 重抽有单独调用，采用 v2 后画面基准为五镜三句对白、36 秒。',
  '三语分别同步预览和确认，均使用同一画面确认。',
  '三语独立验收，泰语退回和重提不改变英文待审或历史下载。',
  '三语预览与下载字节相同，MP4 可完整解码，负责人反馈且权限受限。',
  '泰语单语项目完成全部六个节点，只交付泰语。',
  '服务端拒绝越权确认、非成员访问、历史版本确认。',
  '同键重放复用原任务，查询不增加调用，明确重抽增加调用，缺用量不写零。',
  '超时保留原选版，晚到结果及用量进入原任务。',
  '无时长、外项目首帧和已移除的质检 Agent 调用分别被拒并定位。',
  '定位 S04/L03 八秒音频超时，上传替代片段后完成泰语确认。',
  '换镜使泰语待审版失效，旧英文仍可下载；改原意退回剧本。',
  '只换音乐复用确认节点 5 并重走确认节点 6。',
  '四种文本解析成功，损坏文件保留原输入，重启可恢复并下载。',
  '能力不足与无效凭证保护项目，已移除的质检 Agent 不再创建任务。',
  '泰语导演建议指向运营验收，错语种和确认角色被拒。',
  '每语种合成清单绑定有效确认节点 5，空、错语种和旧画面引用被拒。',
  '质检和内容审核 Agent 不再创建任务；运营可清理失败与待查询任务，成功任务和产物保留。',
]
function volume(filename: string, start: number) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-ss', String(start), '-i', filename, '-t', '1', '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  return Number(result.stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1])
}


test('注册表全部输入输出示例通过 Draft 2020-12 校验', () => {
  for (const [name, contract] of Object.entries(contracts)) for (const example of contract.examples) {
    schema(name, 'input', example.input)
    schema(name, 'output', example.output)
  }
})

test('《末班车之后》HTTP 验收 AT-01–22', { timeout: 240000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'film-acceptance-'))
  await mkdir(evidence, { recursive: true })
  const db = join(temp, 'acceptance.sqlite')
  let { app, background, store } = createApp(openStore(db))
  const cookies: Record<string,string> = {}
  const ledger: any[] = []
  let origin = ''
  async function listen() {
    app.listen(0, '127.0.0.1')
    await once(app, 'listening')
    origin = 'http://127.0.0.1:' + (app.address() as any).port
  }
  async function close() {
    await background.idle()
    if (app.listening) await new Promise<void>(resolve => app.close(() => resolve()))
    store.close()
  }
  await listen()
  t.after(async () => {
    await writeFile(join(evidence, 'acceptance.json'), JSON.stringify({ environment: 'mock + local macOS speech + FFmpeg + SQLite + HTTP', executed_at: new Date().toISOString(), cases: ledger.sort((a,b) => a.case - b.case) }, null, 2))
    await close()
    if (ledger.filter(c => c.passed).length === 22) {
      const exported = join(evidence, 'acceptance.sqlite')
      const next = exported + '.next'
      const sanitized = openStore(db)
      sanitized.clearSessions()
      sanitized.close()
      await copyFile(db, next)
      await rename(next, exported)
    }
  })
  async function call(actor: string, path: string, { data, code = 200, method = data === undefined ? 'GET' : 'POST', headers = {}, bytes, binary = false }: any = {}) {
    const res = await fetch(origin + '/api/' + path, { method, headers: { cookie: cookies[actor] || '', 'content-type': 'application/json', ...headers }, body: bytes ?? (data === undefined ? undefined : JSON.stringify(data)) })
    if (res.headers.has('set-cookie')) cookies[actor] = res.headers.get('set-cookie')!.split(';')[0]
    const output = binary && res.status < 400 ? Buffer.from(await res.arrayBuffer()) : await res.json()
    assert.equal(res.status, code, method + ' ' + path + ' · ' + (Buffer.isBuffer(output) ? '<bytes>' : JSON.stringify(output).slice(0, 1200)))
    return output
  }
  async function run(number: number, actor: string, input: any, fn: () => Promise<any>) {
    let outcome: any
    await t.test('AT-' + String(number).padStart(2, '0'), async () => {
      try { outcome = await fn(); ledger.push({ case: number, actor, input, expected: expectations[number], actual: '断言通过', passed: true, evidence: outcome ?? null }) }
      catch (error: any) { ledger.push({ case: number, actor, input, expected: expectations[number], actual: error.message, passed: false }); throw error }
    })
    return outcome
  }
  for (const actor of [op, dir, owner, 'guest']) await call(actor, 'login', { data: { account: actor, password: demoPasswords[actor] } })
  let projectId = ''
  const path = (suffix = '') => 'projects/' + projectId + (suffix ? '/' + suffix : '')
  const get = (actor = dir) => call(actor, path())
  const create = async (title: string) => projectId = (await call(op, 'projects', { data: { title }, code: 201 })).id
  async function write(actor: string, route: string, body: any = {}, opts: any = {}) {
    const expected_version = opts.version ?? (await get(actor)).version
    const result = await call(actor, path(route), { data: { expected_version, ...body }, code: opts.code ?? 200, headers: { 'idempotency-key': opts.key ?? randomUUID() } })
    return opts.code >= 400 ? result : result.result
  }
  async function asset(actor: string, purpose: string, name: string, bytes: Buffer, code = 201, extraHeaders: Record<string,string> = {}) {
    const result = await call(actor, path('assets'), { bytes, method: 'POST', code,
      headers: { 'idempotency-key': randomUUID(), 'x-expected-version': String((await get(actor)).version), 'x-asset-purpose': purpose, 'x-filename': encodeURIComponent(name), ...extraHeaders } })
    return code === 201 ? result.result : result
  }
  const checkpoint = async (actor: string, step: number, ref: string, decision = 'approve', extra: any = {}, opts?: any) => {
    const preview_ref = step === 5 ? (await get(actor)).artifacts[ref]?.data.preview_ref : undefined
    return write(actor, 'checkpoints/' + step + '/decide', { ref, decision, preview_ref, ...extra }, opts)
  }
  async function review(ref: string, decision = 'approve', extra: any = {}, opts?: any) {
    const file_ref = (await get(op)).artifacts[ref].data.file_ref
    return checkpoint(op, 6, ref, decision, { file_ref, content_checked: true, ...extra }, opts)
  }
  const submit = (ref: string) => write(dir, 'artifacts/' + ref + '/submit')
  const save = (type: string, data: any, extra: any = {}) => write(dir, 'artifacts', { type, data, ...extra })
  const start = (task: string, args: any = {}, opts: any = {}) => write(dir, 'jobs', { task, ...args }, { code: 202, ...opts })
  async function job(task: string, args: any = {}, state = 'succeeded') {
    const request = await start(task, args)
    await background.idle()
    const result = await call(dir, path('jobs/' + request.id))
    assert.equal(result.state, state, task + ': ' + JSON.stringify(result.error))
    return result
  }
  const download = (ref: string, code = 200) => call(op, path('deliveries/' + ref + '/download'), { code, binary: true })
  const select = (shot: string, ref: string) => write(dir, 'shots/' + shot + '/select', { ref })
  const refOf = (j: any) => j.result.artifact_ref
  const fileOf = (j: any) => j.result.asset_ref
  const details = (j: any) => ({ id: j.id, state: j.state, usage: j.usage, result: j.result?.artifact_ref ?? j.result?.asset_ref, error: j.error })
  async function assemble(language: string, music_ref: string, retry_of?: string) {
    const record = await job('assemble', { language, music_ref, retry_of })
    await submit(refOf(record))
    return record
  }
  async function prepareLanguage(language: string, { thaiBackup = false, oversize = false, music = bgm } = {}) {
    const translate = await job('translate', { language })
    const item = (await get()).artifacts[refOf(translate)]
    const lines = item.data.lines
    await save('language', { lines, reviewed: true }, { language })
    if (language !== 'zh-CN') {
      const state = await get()
      const shots = state.artifacts[state.confirmations[state.active['4']].artifact_ref].data.cut
      for (const shot of shots) {
        const localized = await job('video', { shot_id: shot.shot_id, language, video_mode: 'first_frame' })
        const translated = item.data.lines.filter((line: any) => line.shot_id === shot.shot_id)
        assert.deepEqual(localized.plan.input.approved_shot.dialogue.map((line: any) => line.text), translated.map((line: any) => line.target_text))
        await write(dir, 'shots/' + shot.shot_id + '/select', {
          ref: fileOf(localized), language, decision: 'accept', note: language + ' 专属对白与画面连续性已检查',
        })
      }
      const localizedState = await get()
      assert.equal(Object.keys(localizedState.localized_selected?.[language] ?? {}).length, shots.length)
      assert.ok(Object.values(localizedState.assets).filter((asset: any) => asset.kind === 'video' && asset.localized && asset.language === language).length >= shots.length)
    }
    for (const line of lines) {
      let sound
      if (thaiBackup && line.line_id === 'L03') {
        const dubbed = await job('dubbing', { language, line_id: line.line_id })
        const wav = await call(dir, path('media/' + fileOf(dubbed)), { binary: true })
        if (oversize) {
          const over = join(temp, 'long.wav')
          execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=8', over])
          const wrong = await asset(dir, 'dubbing', 'long.wav', await readFile(over))
          Object.assign(line, { audio_ref: wrong.ref, audio_duration_ms: wrong.duration_ms })
          const draft = await save('language', { lines: lines.map(x => x.audio_ref ? x : { ...x, audio_ref: wrong.ref, audio_duration_ms: wrong.duration_ms }), reviewed: true }, { language })
          const fail = await checkpoint(dir, 5, draft.ref, 'approve', {}, { code: 422 })
          assert.equal(fail.field, 'S04/L03')
          assert.equal((await get()).assets[wrong.ref].duration_ms, 8000)
        }
        sound = await asset(dir, 'dubbing', 'thai-backup.wav', wav)
      } else {
        const dubbed = await job('dubbing', { language, line_id: line.line_id })
        sound = (await get()).assets[fileOf(dubbed)]
      }
      Object.assign(line, { audio_ref: sound.ref, audio_duration_ms: sound.duration_ms, subtitle_end_ms: line.audio_start_ms + sound.duration_ms + 140 })
    }
    const draft = await save('language', { lines, reviewed: true }, { language })
    await start('assemble', { language }, { code: 409 })
    await job('preview', { language, music_ref: music })
    const confirmation = await checkpoint(dir, 5, draft.ref)
    return { draft, confirmation, lines }
  }
  await create(fixture.title)
  const main = projectId
  let concept: string, script: string, board: string, cut: string, bgm: string
  let firstS04: any, secondS04: any, thirdS04: any
  const prepared: Record<string, any> = {}, deliveries: Record<string, any> = {}, accepted: Record<string, string> = {}
  await run(1, op + ', ' + dir, projectBrief, async () => {
    assert.deepEqual((await get(op)).brief.target_languages, ['zh-CN'])
    const draftKey = main + ':operations:brief:zh-CN:brief-editor'
    const draftVersion = (await get(op)).version
    await call(op, path('drafts/' + encodeURIComponent(draftKey)), { data:{ data:{ values:[{ name:'raw', type:'textarea', value:'服务端草稿' }] } } })
    const drafts = await call(op, path('drafts'))
    assert.equal(drafts[draftKey].values[0].value, '服务端草稿')
    assert.deepEqual(await call(dir, path('drafts')), {})
    assert.equal((await get(op)).version, draftVersion)
    await call(op, path('drafts/' + encodeURIComponent(draftKey)), { method:'DELETE' })
    const missingLanguage = await write(op, 'brief/submit', { data: { ...projectBrief, target_languages: [] } }, { code: 422 })
    assert.equal(missingLanguage.field, 'target_languages')
    await write(op, 'brief', { data: projectBrief })
    const item = await write(op, 'brief/submit', { data: projectBrief })
    assert.equal(item.data.raw, projectBrief.raw)
    const p = await get()
    assert.equal(Object.keys(p.confirmations).length, 0)
    const notice = (await call(dir, 'notifications')).find(n => n.project_id === main && n.ref === item.ref)
    assert.ok(notice)
    await write(dir, 'notifications/' + notice.id + '/read')
    await create('已有剧本入口')
    const doc = await asset(op, 'script', 'source.txt', Buffer.from(fixture.source_script_excerpt))
    const uploaded = await write(op, 'brief/submit', { data: { ...projectBrief, raw: '', source_ref: doc.ref } })
    assert.equal(uploaded.data.source_script, fixture.source_script_excerpt)
    await write(dir, 'characters', { data: fixture.script.characters })
    await job('creative')
    projectId = main
    return { brief: item.ref, notification: notice.id, uploaded: uploaded.ref, server_draft_roundtrip:true }
  })
  await run(19, dir, '两张角色草稿', async () => {
    await write(dir, 'characters', { data: fixture.script.characters })
    const creative = await job('creative')
    concept = refOf(creative)
    assert.equal(creative.result.response.result.concepts[0].character_goals.length, 2)
    const original = creative.result.response.result
    const edited = structuredClone(original)
    edited.concepts[0].conflict = '人物为是否留下发生分歧。'
    await write(op, 'artifacts', { type: 'concept', data: edited }, { code: 403 })
    const saved = await write(dir, 'artifacts', { type: 'concept', data: edited })
    assert.equal(saved.data.concepts[0].conflict, edited.concepts[0].conflict)
    assert.notEqual(saved.ref, concept)
    assert.equal((await get()).artifacts[concept].data.concepts[0].conflict, original.concepts[0].conflict)
    concept = saved.ref
    return details(creative)
  })
  await run(2, op + ', ' + dir, '车站挽留／旧车票', async () => {
    await submit(concept)
    const notice = (await get(op)).notifications.find(n => n.ref === concept)
    await write(op, 'notifications/' + notice.id + '/read')
    await start('writer', {}, { code: 409 })
    const confirmation = await checkpoint(op, 1, concept, 'approve', { candidate: 'C01' })
    await write(dir, 'artifacts', { type: 'concept', data: (await get()).artifacts[concept].data }, { code: 409 })
    return confirmation
  })
  await run(3, op + ', ' + dir, '保留悬念', async () => {
    const first = await job('writer')
    assert.match(first.result.response.result.ending, /拥抱/)
    await submit(refOf(first))
    await checkpoint(op, 2, refOf(first), 'return', { note: '保留悬念' })
    await start('storyboard', {}, { code: 409 })
    const second = await job('writer')
    script = refOf(second)
    assert.equal(script, 'script@v2')
    await submit(script)
    await checkpoint(op, 2, refOf(first), 'approve', {}, { code: 409 })
    const approval = await checkpoint(op, 2, script)
    assert.equal((await get()).artifacts[refOf(first)].note, '保留悬念')
    return { tasks: [details(first), details(second)], approval }
  })
  await run(10, dir + ', ' + op + ', guest', ['role', 'membership', 'stale'], async () => {
    const before = (await get()).active['2']
    await checkpoint(dir, 2, script, 'approve', {}, { code: 403 })
    await call('guest', path(), { code: 403 })
    await checkpoint(op, 2, 'script@v1', 'approve', {}, { code: 409 })
    assert.equal((await get()).active['2'], before)
  })
  await run(4, dir, ['generated reference', 'uploaded reference', 'S05'], async () => {
    const plan = await job('storyboard')
    const data = (await get()).artifacts[refOf(plan)].data
    const azhe = await job('reference', { character_id: 'azhe' })
    const xiaolin = await job('reference', { character_id: 'xiaolin' })
    const png = await call(dir, path('media/' + fileOf(xiaolin)), { binary: true })
    const image = await asset(dir, 'reference', 'xiaolin.png', png, 201, { 'x-character-id':'xiaolin' })
    data.references = { azhe: fileOf(azhe), xiaolin: image.ref }
    await save('storyboard', data)
    for (const shot of fixture.shots) data.keyframes[shot.shot_id] = fileOf(await job('keyframe', { shot_id: shot.shot_id }))
    const complete = clone(data)
    delete data.keyframes.S05
    const incomplete = await save('storyboard', data)
    const missing = await checkpoint(dir, 3, incomplete.ref, 'approve', {}, { code: 422 })
    assert.equal(missing.field, 'S05')
    await start('video', { shot_id: 'S01' }, { code: 409 })
    board = (await save('storyboard', complete)).ref
    const record = await checkpoint(dir, 3, board)
    assert.ok(!(await get(op)).notifications.some(n => n.ref === board))
    return { record, references: complete.references, keyframes: complete.keyframes }
  })
  await run(5, dir, ['S01', 'S02', 'S03', 'S04', 'S05'], async () => {
    for (const shot of fixture.shots) {
      const result = await job('video', { shot_id: shot.shot_id })
      await select(shot.shot_id, fileOf(result))
      if (shot.shot_id === 'S04') firstS04 = result
    }
    const original = (await get()).selected
    secondS04 = await job('video', { shot_id: 'S04', retry_of: firstS04.id })
    assert.equal((await get()).selected.S04, 'S04_video@v1')
    await select('S04', fileOf(secondS04))
    const draft = await save('cut', {})
    assert.equal(draft.data.duration_ms, 36000)
    assert.equal(draft.data.cut.flatMap(s => s.dialogue).length, 3)
    assert.deepEqual((await get()).selected, { ...original, S04: 'S04_video@v2' })
    cut = draft.ref
    return { record: await checkpoint(dir, 4, cut), shots: draft.data.cut, S04: [details(firstS04), details(secondS04)] }
  })
  await run(6, dir, LANG, async () => {
    bgm = fileOf(await job('music'))
    for (const language of LANG) prepared[language] = await prepareLanguage(language, { thaiBackup: language === 'th' })
    assert.equal(new Set(LANG.map(language => prepared[language].confirmation.upstream)).size, 1)
    return LANG.map(language => prepared[language].confirmation)
  })
  await run(7, op + ', ' + dir, LANG, async () => {
    // Create an accepted Thai version so the historical-file rule has a real baseline.
    const historical = await assemble('th', bgm)
    const history = refOf(historical)
    await review(history)
    const historicalBytes = await download(history)
    const alternate = (await asset(dir, 'music', 'alternate.wav', await call(dir, path('media/' + bgm), { binary: true }))).ref
    deliveries['zh-CN'] = await assemble('zh-CN', bgm)
    deliveries.en = await assemble('en', bgm)
    const alternateDraft = await save('language', { lines:prepared.th.lines, reviewed:true }, { language:'th' })
    await job('preview', { language:'th', music_ref:alternate })
    await checkpoint(dir, 5, alternateDraft.ref)
    deliveries.th = await assemble('th', alternate)
    accepted['zh-CN'] = refOf(deliveries['zh-CN'])
    await review(accepted['zh-CN'])
    await download(accepted['zh-CN'])
    await download(refOf(deliveries.en), 403)
    const returned = refOf(deliveries.th)
    const missingReview = await review(returned, 'approve', { content_checked: false }, { code: 422 })
    assert.equal(missingReview.field, 'content_checked')
    await review(returned, 'approve', { file_ref: fileOf(deliveries.en) }, { code: 409 })
    const missingNote = await review(returned, 'return', {}, { code: 422 })
    assert.equal(missingNote.field, 'note')
    const invalidTime = await review(returned, 'return', { note: '请校对泰语字幕', start_ms: 34000, end_ms: 37000 }, { code: 422 })
    assert.equal(invalidTime.field, 'range')
    await review(returned, 'return', { note: '请校对泰语字幕', start_ms: 34000, end_ms: 35000 })
    assert.deepEqual((await get()).artifacts[returned].delivery_review.range, { start_ms: 34000, end_ms: 35000 })
    await download(returned, 403)
    assert.deepEqual(await download(history), historicalBytes)
    assert.equal(status(await get(), refOf(deliveries.en)), 'pending_review')
    const lines = clone(prepared.th.lines)
    lines.at(-1).subtitle_text = 'อย่าเพิ่งไปนะ'
    const correction = await save('language', { lines, reviewed: true }, { language: 'th' })
    await job('preview', { language: 'th', music_ref:bgm })
    await checkpoint(dir, 5, correction.ref)
    deliveries.th = await assemble('th', bgm)
    for (const language of ['en', 'th']) {
      accepted[language] = refOf(deliveries[language])
      const confirmation = await review(accepted[language])
      assert.equal(confirmation.delivery_review.file_ref, fileOf(deliveries[language]))
      assert.equal(confirmation.delivery_review.sha256, (await get()).assets[fileOf(deliveries[language])].sha256)
    }
    assert.equal((await get()).active['5:en'], prepared.en.confirmation.ref)
    return { accepted, rejected: returned, historical: history }
  })
  await run(8, op + ', ' + owner, accepted, async () => {
    const files: any = {}
    for (const language of LANG) {
      const ref = accepted[language]
      const bytes = await download(ref)
      const preview = await call(op, path('deliveries/' + ref + '/preview'), { binary: true })
      assert.deepEqual(bytes, preview)
      const filename = join(evidence, '末班车之后-' + language + '.mp4')
      await writeFile(filename, bytes)
      const media = await probe(filename)
      assert.equal(media.width / media.height, 9 / 16)
      assert.equal(media.duration_ms, 36000)
      assert.equal(media.audio, true)
      execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', filename, '-f', 'null', '-'])
      const bgm_db = volume(filename, 1)
      const dialogue_db = volume(filename, 22)
      assert.ok(bgm_db > -50 && dialogue_db > bgm_db + 5)
      const p = await get()
      assert.equal(hash(bytes), p.assets[p.artifacts[ref].data.file_ref].sha256)
      files[language] = { filename, media, bgm_db, dialogue_db, sha256: hash(bytes), ref }
    }
    const usage = await call(owner, path('usage'))
    assert.ok(usage.totals.tokens > 0 && usage.totals.video_seconds > 0)
    const listed = (await call(op, 'projects')).find((item: any) => item.id === projectId)
    assert.equal(listed.task_state.tab, 'delivery')
    assert.equal(listed.task_state.action, '下载验收版')
    await write(owner, 'feedback', { note: '三语预览后请保留末镜停步。', ref: accepted.th })
    await checkpoint(owner, 6, accepted.th, 'approve', {}, { code: 403 })
    await write(owner, 'jobs', { task: 'music' }, { code: 403 })
    return { files, usage: usage.totals }
  })
  await run(11, dir, '重复请求、查询、显式重抽', async () => {
    const key = randomUUID()
    const one = await start('video', { shot_id: 'S04', retry_of: secondS04.id, scenario: 'missing_usage' }, { key })
    await background.idle()
    const two = await start('video', { shot_id: 'S04', retry_of: secondS04.id, scenario: 'missing_usage' }, { key })
    assert.equal(one.id, two.id)
    await start('video', { shot_id: 'S03' }, { key, code: 409 })
    thirdS04 = await call(dir, path('jobs/' + one.id))
    assert.equal(thirdS04.usage, null)
    const count = (await call(owner, path('usage'))).jobs.length
    await call(dir, path('jobs/' + one.id + '/query'), { data: {} })
    assert.equal((await call(owner, path('usage'))).jobs.length, count)
    return details(thirdS04)
  })
  await run(12, dir, 'S04 超时、换镜、晚到', async () => {
    const delayed = await job('video', { shot_id: 'S04', retry_of: thirdS04.id, scenario: 'timeout' }, 'awaiting_query')
    const selected = (await get()).selected.S04
    assert.equal(selected, fileOf(secondS04))
    const before = Object.keys((await get()).jobs).length
    await select('S04', fileOf(thirdS04))
    const old = await call(dir, path('jobs/' + delayed.id + '/query'), { data: {} })
    assert.equal(old.state, 'superseded')
    assert.ok(old.usage.some(item => item.unit === 'video_seconds'))
    assert.equal((await get()).selected.S04, fileOf(thirdS04))
    assert.equal(Object.keys((await get()).jobs).length, before)
    return details(old)
  })
  await run(13, dir, ['missing duration', 'foreign frame', 'removed quality agent'], async () => {
    const prior = (await get()).active['3']
    const results = [
      await job('storyboard', { scenario: 'missing_duration', task_request: 'Schema 验证' }, 'failed'),
      await job('video', { shot_id: 'S04', retry_of: thirdS04.id, scenario: 'foreign_frame' }, 'failed'),
      await start('quality', { shot_id: 'S04', asset_ref: fileOf(firstS04) }, { code: 422 }),
    ]
    assert.match(results[0].error.field, /duration_ms/)
    assert.equal(results[1].error.field, 'first_frame_ref')
    assert.match(results[2].message, /未知任务/)
    assert.equal((await get()).active['3'], prior)
    return results.map(details)
  })
  await run(15, dir + ', ' + op, ['替换 S04', '修改对白原意'], async () => {
    // New valid cut after the selected replacement.
    const newer = await save('cut', {})
    await checkpoint(dir, 4, newer.ref)
    const th = await prepareLanguage('th')
    const pending = refOf(await assemble('th', bgm))
    const replacement = await job('video', { shot_id: 'S04', retry_of: thirdS04.id })
    await select('S04', fileOf(replacement))
    assert.equal(status(await get(), pending), 'needs_recheck')
    await checkpoint(op, 6, pending, 'approve', {}, { code: 409 })
    const updatedCut = await save('cut', {})
    await checkpoint(dir, 4, updatedCut.ref)
    await download(accepted.en)
    assert.notEqual(updatedCut.ref, newer.ref)
    assert.equal((await get()).active['5:th'], undefined)
    return { old_cut: newer.ref, new_cut: updatedCut.ref, invalidated_th: pending, previous5: th.confirmation.ref }
  })
  await run(14, dir, 'S04/L03 八秒泰语配音', async () => {
    const checked = await prepareLanguage('th', { thaiBackup: true, oversize: true })
    const item = refOf(await assemble('th', bgm))
    await review(item)
    await download(accepted['zh-CN'])
    await download(accepted.en)
    return { confirmed: checked.confirmation, delivery: item }
  })
  await run(16, dir + ', ' + op, '仅替换背景音乐', async () => {
    const old = (await get()).active['5:th']
    const current = (await get()).current['delivery:th']
    const oldBytes = await download(current)
    const music = (await asset(dir, 'music', 'music-v2.wav', await call(dir, path('media/' + bgm), { binary: true }))).ref
    const previous = Object.values((await get()).jobs).find((record: any) => record.result?.artifact_ref === current) as any
    const rejected = await assemble('th', bgm, previous.id)
    const item = refOf(rejected)
    await review(item, 'return', { note: '仅更换音乐' })
    const retry = await job('assemble', { language: 'th', music_ref: bgm, retry_of: rejected.id })
    assert.notEqual(refOf(retry), item)
    await submit(refOf(retry))
    await download(refOf(retry), 403)
    await review(refOf(retry), 'return', { note: '音乐仍需调整' })
    await start('assemble', { language:'th', music_ref:music }, { code:409 })
    const state = await get()
    const lines = state.artifacts[state.current['language:th']].data.lines
    const draft = await save('language', { lines, reviewed:true }, { language:'th' })
    await job('preview', { language:'th', music_ref:music })
    const preview = await checkpoint(dir, 5, draft.ref)
    const revised = refOf(await assemble('th', music))
    await review(revised)
    assert.notEqual(preview.ref, old)
    assert.equal((await get()).active['5:th'], preview.ref)
    assert.deepEqual(await download(current), oldBytes)
    return { old, revised, music }
  })
  await run(17, op, ['TXT', 'MD', 'DOCX', 'DOC', 'restart'], async () => {
    const original = (await get(op)).brief.raw
    await asset(op, 'script', 'empty.txt', Buffer.alloc(0), 422)
    await asset(op, 'script', 'bad.docx', Buffer.from('broken'), 422)
    const parsed: any = {}
    const source = join(temp, 'script.txt')
    await writeFile(source, fixture.source_script_excerpt)
    for (const ext of ['txt', 'md', 'docx', 'doc']) {
      const doc = join(temp, 'valid.' + ext)
      if (['docx', 'doc'].includes(ext)) execFileSync('textutil', ['-convert', ext, '-output', doc, source])
      else await writeFile(doc, fixture.source_script_excerpt)
      const result = await asset(op, 'script', 'valid.' + ext, await readFile(doc))
      assert.equal(result.text, fixture.source_script_excerpt)
      parsed[ext] = result.ref
    }
    const oldBytes = await download(accepted.en)
    await close()
    ;({ app, background, store } = createApp(openStore(db)))
    await listen()
    assert.equal((await get(op)).brief.raw, original)
    assert.ok((await call(op, 'notifications')).some(n => n.project_id === main))
    assert.deepEqual(await download(accepted.en), oldBytes)
    return parsed
  })
  await run(18, dir, ['unavailable media', 'unsupported video', 'invalid credentials'], async () => {
    const before = Object.keys((await get()).jobs).length
    const unavailable = await start('video', { shot_id: 'S04', scenario: 'unsupported' }, { code: 422 })
    assert.equal(unavailable.field, 'first_frame')
    assert.equal(Object.keys((await get()).jobs).length, before)
    const bad = await job('writer', { task_request: '测试凭证失败', scenario: 'invalid_key' }, 'failed')
    assert.equal(bad.error.code, 'provider_auth')
    assert.equal((await get()).active['2'], 'check2@v1')
    const beforeRemoved = Object.keys((await get()).jobs).length
    const qc = await start('quality', { shot_id: 'S04', asset_ref: fileOf(firstS04) }, { code: 422 })
    assert.match(qc.message, /未知任务/)
    assert.equal(Object.keys((await get()).jobs).length, beforeRemoved)
    return [details(bad), qc]
  })
  await run(20, dir, '泰语成片导演建议', async () => {
    const result = await job('director', { ref: accepted.th, language: 'th' })
    assert.equal(result.result.response.result.target_language, 'th')
    assert.equal(result.result.response.result.next_actor, 'operations')
    const wrong = await job('director', { ref: accepted.th, language: 'th', scenario: 'wrong_language', task_request: '语种校验' }, 'failed')
    assert.equal(wrong.error.field, 'target_language')
    const example = clone(contracts.director.examples[1])
    example.output.result.next_actor = 'director'
    assert.throws(() => validateAgent('director', example.input, example.output))
    return [details(result), details(wrong)]
  })
  await run(21, dir, ['zh-CN', 'en', 'th', 'wrong check5', 'old cut'], async () => {
    const project = await get()
    for (const language of LANG) {
      const d = project.jobs[deliveries[language].id]
      assert.equal(d.plan.input.target_language, language)
      assert.equal(project.confirmations[d.plan.input.language_confirmation_ref].language, language)
      assert.equal(d.result.response.result.cut_ref, cut)
    }
    const candidate = clone(project.jobs[deliveries.th.id].plan.input)
    candidate.language_confirmation_ref = null
    assert.throws(() => schema('post', 'input', candidate))
    candidate.language_confirmation_ref = prepared.en.confirmation.ref
    assert.throws(() => validateAgent('post', candidate, { status: 'ok', issues: [], result: manifest(candidate) }, project), isProblem('language_confirmation_ref'))
    candidate.language_confirmation_ref = project.active['5:th']
    assert.throws(() => validateAgent('post', candidate, { status: 'ok', issues: [], result: manifest(candidate) }, project), isProblem('language_confirmation_ref'))
    return LANG.map(language => details(project.jobs[deliveries[language].id]))
  })
  await run(22, dir, ['removed quality agent', 'removed content review agent', 'human review remains'], async () => {
    const before = Object.keys((await get()).jobs).length
    const quality = await start('quality', { shot_id: 'S04', asset_ref: fileOf(firstS04) }, { code: 422 })
    const contentReview = await start('content_review', { ref: accepted.th }, { code: 422 })
    assert.match(quality.message, /未知任务/)
    assert.match(contentReview.message, /未知任务/)
    assert.equal(contracts.quality, undefined)
    assert.equal(contracts.content_review, undefined)
    assert.equal(Object.keys((await get()).jobs).length, before)
    const record = Object.values((await get()).confirmations).find((item: any) => item.artifact_ref === accepted.th)
    assert.equal(record.actor, op)
    assert.equal(record.delivery_review.decision, 'approve')
    const beforeCleanup = await get(op)
    const succeededBefore = Object.values(beforeCleanup.jobs).filter((job: any) => job.state === 'succeeded').length
    const forbidden = await write(dir, 'jobs/cleanup', { states:['failed','awaiting_query'] }, { code:403 })
    assert.equal(forbidden.code, 'forbidden')
    const cleanup = await write(op, 'jobs/cleanup', { states:['failed','awaiting_query'] })
    const afterCleanup = await get(op)
    assert.equal(Object.values(afterCleanup.jobs).filter((job:any) => ['failed','awaiting_query'].includes(job.state)).length, 0)
    assert.equal(Object.values(afterCleanup.jobs).filter((job:any) => job.state === 'succeeded').length, succeededBefore)
    return { quality, contentReview, manual_review_actor:record.actor, file_ref:record.delivery_review.file_ref, cleanup }
  })
  await run(9, op + ', ' + dir, '独立泰语项目', async () => {
    await create('末班车之后 · 仅泰语')
    await write(op, 'brief/submit', { data: { ...projectBrief, target_languages: ['th'] } })
    await write(dir, 'characters', { data: fixture.script.characters })
    const idea = refOf(await job('creative'))
    await submit(idea)
    await checkpoint(op, 1, idea, 'approve', { candidate: 'C01' })
    const draft = refOf(await job('writer'))
    const p = await get()
    const story = clone(p.artifacts[draft].data)
    story.ending = fixture.script.ending
    story.beats.at(-1).action = fixture.script.beats.at(-1).action
    const good = await save('script', story)
    await submit(good.ref)
    await checkpoint(op, 2, good.ref)
    const sb = refOf(await job('storyboard'))
    const plan = (await get()).artifacts[sb].data
    for (const c of fixture.script.characters) plan.references[c.character_id] = fileOf(await job('reference', { character_id: c.character_id }))
    await save('storyboard', plan)
    for (const shot of plan.shots) plan.keyframes[shot.shot_id] = fileOf(await job('keyframe', { shot_id: shot.shot_id }))
    const picked = await save('storyboard', plan)
    await checkpoint(dir, 3, picked.ref)
    for (const shot of plan.shots) await select(shot.shot_id, fileOf(await job('video', { shot_id: shot.shot_id })))
    const joined = await save('cut', {})
    await checkpoint(dir, 4, joined.ref)
    const music = fileOf(await job('music'))
    await prepareLanguage('th', { music })
    const output = refOf(await assemble('th', music))
    await review(output)
    assert.ok((await download(output)).length)
    const state = await get()
    assert.deepEqual(Object.values(state.confirmations).map(c => c.step), [1,2,3,4,5,6])
    assert.deepEqual(Object.values(state.artifacts).filter(a => a.type === 'delivery').map(a => a.language), ['th'])
    // Run semantic rework independently of the main project.
    const semantic = await save('cut', { dialogue: { L03: '你走吧。' } }, { rework: 'story' })
    assert.equal(semantic.type, 'script')
    assert.equal((await get()).active['2'], undefined)
    await start('storyboard', {}, { code: 409 })
    await download(output)
    return { output, confirmations: Object.values(state.confirmations), AT15_semantic: semantic.ref }
  })
  assert.equal(ledger.filter(c => c.passed).length, 22)
})
