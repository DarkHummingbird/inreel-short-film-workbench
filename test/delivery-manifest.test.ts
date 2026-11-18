import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('两镜双语交付固定看片清单，逐镜保留原声并撤回受影响的待审版本', { timeout: 120000 }, async t => {
  const folder = mkdtempSync(join(tmpdir(), 'inreel-delivery-manifest-'))
  const environment = { DATA_DIR:process.env.DATA_DIR, MODEL_MODE:process.env.MODEL_MODE }
  process.env.DATA_DIR = folder
  process.env.MODEL_MODE = 'dashscope'
  t.after(() => {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(folder, { recursive:true, force:true })
  })
  const { createProject, current, openStore } = await import('../src/store.ts')
  const { apply, put, cutFrom } = await import('../src/workflow.ts')
  const { worker, queue } = await import('../src/jobs.ts')
  const { mediaPath, persist, probe } = await import('../src/media.ts')
  const op = 'op_lin', director = 'dir_zhou'
  const project = createProject('两镜双语隔离验收', op)
  apply(project, op, 'brief.submit', { data:{ raw:'两位虚构主角在门口交谈。', theme:'GL', target_languages:['zh-CN','en'] } })
  const shots = [
    { shot_id:'S01', order:1, dialogue:[{ line_id:'L01', speaker_id:'C01', text:'进来吧。' }] },
    { shot_id:'S02', order:2, dialogue:[{ line_id:'L02', speaker_id:'C02', text:'好。' }] },
  ]
  const board = put(project, director, 'storyboard', { shots, references:{}, keyframes:{}, production:{} }, null)
  project.confirmations['check3@v1'] = { ref:'check3@v1', step:3, artifact_ref:board.ref }
  project.active['3'] = 'check3@v1'

  async function makeVideo(ref: string, index: number, language: string, color: string, frequency: number | null, words: string) {
    const file = join(folder, ref + '.mp4')
    execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=' + color + ':s=96x160:d=2:r=24',
      ...(frequency ? ['-f','lavfi','-i','sine=frequency='+frequency+':sample_rate=24000:duration=2','-c:a','aac'] : []),
      '-c:v','libx264','-pix_fmt','yuv420p',file])
    const info = await probe(file)
    const shot = shots[index]
    project.assets[ref] = {
      ...await persist(readFileSync(file), 'mp4', info), ref, kind:'video', shot_id:shot.shot_id,
      duration_ms:2000, language, localized:language === 'en', board_ref:board.ref,
      spoken_dialogue:[{ ...shot.dialogue[0], text:words }],
    }
  }
  await makeVideo('zh_a@v1', 0, 'zh-CN', 'gray', 400, '进来吧。')
  await makeVideo('zh_b@v1', 1, 'zh-CN', 'gray', 400, '好。')
  await makeVideo('en_a@v1', 0, 'en', 'blue', 500, 'Come in.')
  await makeVideo('en_a@v2', 0, 'en', 'red', 500, 'Come in.')
  await makeVideo('en_a@v3', 0, 'en', 'yellow', 500, 'Please come in.')
  await makeVideo('en_b@v1', 1, 'en', 'green', null, 'Okay.')
  const dubFile = join(folder, 'dub.wav')
  execFileSync('ffmpeg', ['-nostdin','-loglevel','error','-f','lavfi','-i','sine=frequency=900:sample_rate=24000:duration=1',dubFile])
  const dubRef = 'dub@v1'
  project.assets[dubRef] = { ...await persist(readFileSync(dubFile), 'wav'), ref:dubRef, kind:'audio', duration_ms:1000, language:'en', text:'Okay.' }
  const musicFile = join(folder, 'music.wav')
  execFileSync('ffmpeg', ['-nostdin','-loglevel','error','-f','lavfi','-i','sine=frequency=220:sample_rate=24000:duration=2',musicFile])
  const musicRef = 'bgm@v1'
  project.assets[musicRef] = { ...await persist(readFileSync(musicFile), 'wav'), ref:musicRef, kind:'audio', purpose:'music', duration_ms:2000 }
  project.selected = { S01:'zh_a@v1', S02:'zh_b@v1' }
  const basis = put(project, director, 'cut', cutFrom(project, {}), 'check3@v1')
  project.confirmations['check4@v1'] = { ref:'check4@v1', step:4, artifact_ref:basis.ref }
  project.active['4'] = 'check4@v1'

  const store = openStore(join(folder, 'isolated.sqlite'))
  t.after(() => store.close())
  store.save(project)
  let providerCalls = 0
  const background = worker(store, undefined, (async () => {
    providerCalls++
    throw new Error('隔离验收不允许调用供应商')
  }) as typeof fetch)
  const state = () => store.get(project.id)
  const change = (action: string, input: any, actor = director) =>
    store.update(project.id, p => apply(p, actor, action, input)).result
  const enqueue = (body: any) => store.update(project.id, p => queue(p, director, body)).result
  async function finish(job: any, expected = 'succeeded') {
    await background.start(project.id, job.id)
    const result = state().jobs[job.id]
    assert.equal(result.state, expected, JSON.stringify(result.error))
    return result
  }
  const select = (shot_id: string, ref: string) => change('select', { shot_id, ref, language:'en', decision:'accept', note:'已检查' })
  const saveLanguage = (language: string, lines: any[]) => change('artifact', { type:'language', language, data:{ reviewed:true, lines } })
  const draft = (language: string) => current(state(), 'language', language)
  const preview = (language: string) => enqueue({ task:'preview', language, music_ref:musicRef })
  const approve = (language: string, previewRef = draft(language).data.preview_ref) =>
    change('decide', { step:5, ref:draft(language).ref, decision:'approve', preview_ref:previewRef })
  const lines = shots.map((shot, index) => ({
    line_id:shot.dialogue[0].line_id, speaker_id:shot.dialogue[0].speaker_id, shot_id:shot.shot_id,
    source_text:shot.dialogue[0].text, target_text:shot.dialogue[0].text, audio_ref:null, audio_duration_ms:null,
    audio_start_ms:index * 2000 + 200, subtitle_start_ms:index * 2000 + 200, subtitle_end_ms:index * 2000 + 1200,
  }))

  saveLanguage('zh-CN', lines)
  await finish(preview('zh-CN'))
  const zhConfirmation = approve('zh-CN')
  const zhFinalJob = await finish(enqueue({ task:'assemble', language:'zh-CN' }))
  const zhFinal = state().artifacts[zhFinalJob.result.artifact_ref]
  change('submit', { ref:zhFinal.ref })
  const zhDelivery = change('decide', { step:6, ref:zhFinal.ref, decision:'approve', file_ref:zhFinal.data.file_ref, content_checked:true }, op)

  const english = lines.map((line, index) => ({ ...line, target_text:index ? 'Okay.' : 'Come in.' }))
  saveLanguage('en', english)
  select('S01', 'en_a@v1')
  select('S02', 'en_b@v1')
  assert.throws(() => preview('en'), /配音缺失/)
  Object.assign(english[1], { audio_ref:dubRef, audio_duration_ms:1000, subtitle_text:'Okay, then.' })
  saveLanguage('en', english)

  const outdated = preview('en')
  select('S01', 'en_a@v2')
  await finish(outdated, 'superseded')
  assert.equal(draft('en').data.preview_ref, undefined)
  assert.throws(() => approve('en', state().jobs[outdated.id].result.asset_ref), /同步预览/)

  const checked = await finish(preview('en'))
  assert.throws(() => approve('en', state().jobs[outdated.id].result.asset_ref), /同步预览/)
  const snapshot = approve('en')
  assert.deepEqual(snapshot.delivery_manifest, checked.plan.delivery_manifest)
  assert.deepEqual(snapshot.delivery_manifest.cut.map(shot => shot.video_ref), ['en_a@v2', 'en_b@v1'])
  assert.deepEqual(snapshot.delivery_manifest.audio_modes, { S01:'native', S02:'dub' })
  assert.equal(snapshot.delivery_manifest.lines[1].subtitle_text, 'Okay, then.')
  assert.throws(() => enqueue({ task:'assemble', language:'en', music_ref:'' }), /音乐已由同步预览锁定/)
  const finalJob = enqueue({ task:'assemble', language:'en' })
  assert.deepEqual(finalJob.plan.delivery_manifest, snapshot.delivery_manifest)
  const final = await finish(finalJob)
  const pending = state().artifacts[final.result.artifact_ref]
  assert.deepEqual(pending.data.delivery_manifest, snapshot.delivery_manifest)
  const finalAsset = state().assets[pending.data.file_ref]
  assert.equal(finalAsset.sha256, state().assets[checked.result.asset_ref].sha256)

  function frequencyPower(start: string, frequency: number) {
    const pcm = execFileSync('ffmpeg', ['-nostdin','-loglevel','error','-ss',start,'-i',mediaPath(finalAsset.file),
      '-t','0.2','-vn','-f','s16le','-ac','1','-ar','24000','pipe:1'])
    let real = 0, imaginary = 0
    for (let i = 0; i < pcm.length / 2; i++) {
      const phase = 2 * Math.PI * frequency * i / 24000
      const value = pcm.readInt16LE(i * 2)
      real += value * Math.cos(phase)
      imaginary += value * Math.sin(phase)
    }
    return Math.hypot(real, imaginary)
  }
  assert.ok(frequencyPower('0.4', 500) > 5 * frequencyPower('0.4', 900))
  assert.ok(frequencyPower('2.4', 900) > 5 * frequencyPower('2.4', 500))

  change('submit', { ref:pending.ref })
  select('S01', 'en_a@v1')
  const replaced = state()
  assert.equal(replaced.active['5:en'], undefined)
  assert.equal(replaced.artifacts[pending.ref].status, 'needs_recheck')
  assert.ok(replaced.notifications.find(n => n.kind === 'review' && n.ref === pending.ref)?.closed_at)
  assert.throws(() => change('decide', { step:6, ref:pending.ref, decision:'approve', file_ref:pending.data.file_ref, content_checked:true }, op), /上游已变化/)
  assert.deepEqual(replaced.confirmations[snapshot.ref].delivery_manifest, snapshot.delivery_manifest)

  english[0].target_text = 'Please come in.'
  saveLanguage('en', english)
  assert.equal(state().localized_selected.en.S01, undefined)
  assert.equal(state().localized_selected.en.S02, 'en_b@v1')
  assert.throws(() => select('S01', 'en_a@v2'), /对白与/)
  select('S01', 'en_a@v3')
  await finish(preview('en'))
  assert.equal(approve('en').delivery_manifest.lines[0].target_text, 'Please come in.')
  assert.equal(state().active['5:zh-CN'], zhConfirmation.ref)
  assert.equal(state().active['6:zh-CN'], zhDelivery.ref)
  assert.equal(providerCalls, 0)
})
