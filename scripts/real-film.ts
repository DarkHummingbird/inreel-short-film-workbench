import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createApp, demoPasswords } from '../src/server.ts'
import { fixture, hash, languages } from '../src/common.ts'
import { manifest, validateAgent } from '../src/contracts.ts'
import { validateConfig, voiceFor } from '../src/dashscope.ts'
import { mediaPath, mockMusic, probe } from '../src/media.ts'
import { current, role } from '../src/store.ts'
import { put } from '../src/workflow.ts'
import { curlTransport } from './provider-curl.ts'

assert.equal(process.env.MODEL_MODE, 'dashscope', '运行完整验收需使用真实模型模式')
const config = validateConfig()
for (const language of languages) voiceFor(config, language)
const evidence = resolve(process.argv[2] || 'test-results/last-train-real')
await mkdir(evidence, { recursive: true })
const reportPath = join(evidence, 'report.json')
const report: any = await readFile(reportPath, 'utf8').then(JSON.parse).catch(error => {
  if (error.code !== 'ENOENT') throw error
  return { mode:'dashscope', region:config.region, project:null, phase:'setup', jobs:{}, deliveries:{}, started_at:new Date().toISOString(),
    production_inputs:{ script:'已校对的案例剧本', storyboard:'已校对的五镜案例分镜', music:'本地生成的测试配乐' } }
})
const savedCreativeReport = process.argv[3] ? JSON.parse(await readFile(resolve(process.argv[3]), 'utf8')) : null
const openingReportPath = process.argv[4] ? resolve(process.argv[4]) : null
const openingReport = openingReportPath ? JSON.parse(await readFile(openingReportPath, 'utf8')) : null
const savedCreative = savedCreativeReport?.result?.find((entry: any) => entry.agent === 'creative' && entry.usable)
if (savedCreativeReport) {
  assert.ok(savedCreative && savedCreativeReport.calls.some((call: any) => call.stage === 'creative' && call.request_id))
  validateAgent('creative', savedCreative.input, savedCreative.output)
  report.production_inputs.creative = { source: '复用已通过契约校验的真实百炼候选', report: resolve(process.argv[3]) }
}
function preparedPlan(agent: string, input: any) {
  let result
  if (agent === 'art') {
    const identities = input.characters.map((person: any) => person.name + '：约三十岁的东亚成年男子，' + person.description).join('；')
    const scene = input.mode === 'character'
      ? '夜间车站冷光，胸像，面部清晰，人物单独入镜。'
      : [input.shot.scene, input.shot.framing, input.shot.start_state, input.shot.action].join('。')
    result = { mode: input.mode, image_prompt: '9:16 电影写实剧照。' + identities + '。' + scene,
      avoid: ['新增人物', '文字水印', '改变外套颜色或黑色行李箱'], reference_map: input.character_references,
      composition: input.mode === 'character' ? '正面半身，肩部清晰' : input.shot.framing,
      continuity_checks: ['按角色参考保持面部和衣着', '夜间车站冷光'] }
  }
  if (agent === 'vfx') {
    const shot = input.approved_shot
    result = { shot_id: shot.shot_id, video_prompt: [shot.camera, shot.start_state, shot.action, shot.end_state,
      '保持首帧人物、服装、行李和车站环境一致。单镜头连续拍摄。'].join('。'),
      avoid: ['跳切', '新增人物', '文字字幕', '脸部或手指变形'], first_frame_ref: input.keyframe_ref,
      reference_assets: [], duration_ms: shot.duration_ms, aspect_ratio: input.aspect_ratio }
  }
  if (agent === 'post') result = manifest(input)
  return result && { status: 'ok', result, issues: [] }
}
report.production_inputs.media_planning = '使用案例分镜直接构造并校验美术、视频及后期计划；图像、视频和语音使用百炼真实任务'
async function saveReport() {
  const temp = reportPath + '.next'
  await writeFile(temp, JSON.stringify(report, null, 2))
  await rename(temp, reportPath)
}
await saveReport()
const { app, background, store } = createApp(undefined, demoPasswords, preparedPlan, process.env.REAL_PROVIDER_TRANSPORT === 'curl' ? curlTransport : undefined)
app.listen(0, '127.0.0.1')
await once(app, 'listening')
const address = app.address()
assert.ok(address && typeof address !== 'string')
const origin = 'http://127.0.0.1:' + address.port
const op = fixture.accounts.operations
const dir = fixture.accounts.director
const owner = fixture.accounts.owner
const sessions: Record<string,string> = {}
class ApiError extends Error {
  constructor(public status: number, public data: any) { super(data.message ?? 'HTTP ' + status) }
}
async function api(account: string, path: string, method = 'GET', data?: any, headers: Record<string,string> = {}) {
  const response = await fetch(origin + '/api/' + path, {
    method, headers:{cookie:sessions[account] || '', 'content-type':'application/json', ...headers},
    body: data === undefined ? undefined : Buffer.isBuffer(data) ? data : JSON.stringify(data),
  })
  if (response.headers.has('set-cookie')) sessions[account] = response.headers.get('set-cookie')!.split(';')[0]
  if (!response.ok) throw new ApiError(response.status, await response.json())
  return response
}
const projectPath = (route = '') => 'projects/' + report.project + (route ? '/' + route : '')
const project = async (account = dir) => (await api(account, projectPath())).json()
const cur = (p: any, key: string) => p.artifacts[p.current[key]]
async function write(account: string, route: string, data: any = {}) {
  const key = randomUUID()
  for (let attempt=0; attempt<8; attempt++) {
    const p = await project(account)
    try {
      const response = await api(account, projectPath(route), 'POST', { ...data, expected_version:p.version }, { 'idempotency-key':key })
      return (await response.json()).result
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409 && error.message.includes('项目版本已更新')) || attempt === 7) throw error
    }
  }
}
const save = (type: string, data: any, extra = {}) => write(dir,'artifacts',{type,data,...extra})
const submit = (artifact: any) => artifact.status === 'draft' ? write(dir,'artifacts/'+artifact.ref+'/submit') : artifact
const approve = (account: string, step: number, artifact: any, candidate?: string) =>
  write(account,'checkpoints/'+step+'/decide',{ ref:artifact.ref, upstream:artifact.upstream, decision:'approve', ...(candidate ? {candidate} : {}) })
async function confirm(account: string, step: number, artifact: any) {
  return artifact.status === 'approved' ? artifact : approve(account, step, artifact)
}
const remoteTransport = process.env.REAL_PROVIDER_TRANSPORT === 'curl' ? curlTransport : fetch
const mediaTasks = ['reference', 'keyframe', 'video']
const beijingTime = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 19).replace(/[^0-9]/g, '')
async function reconcileUnacknowledged(key: string, job: any) {
  if (!mediaTasks.includes(job.plan.task) || job.provider_job_id || job.state !== 'awaiting_query') return false
  const recovered = report.provider_recoveries ??= []
  if (recovered.filter((entry: any) => entry.key === key).length >= 2) return false
  const originalStart = Date.parse(job.created_at)
  const originalEnd = Date.parse(job.updated_at)
  const wait = originalEnd + 20_000 - Date.now()
  if (wait > 0) await delay(wait)
  const url = new URL('https://' + config.workspace + '.' + config.region + '.maas.aliyuncs.com/api/v1/tasks')
  url.search = new URLSearchParams({
    start_time: beijingTime(Date.parse(report.started_at) - 15 * 60_000),
    end_time: beijingTime(Date.now()), model_name: job.model, region: config.region, page_size: '50',
  }).toString()
  let listing
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await remoteTransport(url, { headers: { Authorization:'Bearer ' + process.env.DASHSCOPE_API_KEY }, redirect:'error', signal:AbortSignal.timeout(18000) })
      if (!response.ok) return false
      listing = await response.json()
      break
    } catch {
      if (attempt === 2) return false
      await delay(1000 * (attempt + 1))
    }
  }
  if (!Array.isArray(listing?.data) || listing.data.length !== listing.total) return false
  const knownTasks = new Set(Object.values(report.jobs).map((item: any) => item.task_id).filter(Boolean))
  if (openingReport) {
    knownTasks.add(openingReport.result.imageTask)
    knownTasks.add(openingReport.result.videoTask)
  }
  if (!listing.data.some((task: any) => knownTasks.has(task.task_id))) return false
  const possible = listing.data.filter((task: any) => Number.isFinite(task.gmt_create) &&
    task.gmt_create >= originalStart - 1000 && task.gmt_create <= originalEnd + 5000 && !knownTasks.has(task.task_id))
  if (possible.length) return false
  recovered.push({ key, job_id:job.id, list_request_id:listing.request_id, checked_at:new Date().toISOString(), confirmed_missing:true })
  await saveReport()
  store.update(report.project, p => {
    const original = p.jobs[job.id]
    assert.equal(original.state, 'awaiting_query')
    assert.equal(original.provider_job_id, null)
    original.state = 'failed'
    original.error = { code:'provider_not_found_confirmed', message:'已核对百炼异步任务列表，提交时段无对应任务记录', field:'model' }
  })
  return true
}
async function runJobs(specs: {key:string, task:string, args?:any}[]) {
  const submitted: [string,string][] = []
  for (const {key, task, args} of specs) {
    const previous = report.jobs[key]
    let job = previous ? (await project()).jobs[previous.id] : await write(dir,'jobs',{task,...args})
    assert.ok(job, '找不到原任务 ' + key)
    if (job.state === 'awaiting_query' && !job.provider_job_id &&
      job.error?.message === '提交结果未知，请核对原请求或服务商任务记录（UND_ERR_CONNECT_TIMEOUT）') {
      store.update(report.project, p => {
        const original = p.jobs[job.id]
        assert.equal(original.state, 'awaiting_query')
        assert.equal(original.provider_job_id, null)
        original.state = 'failed'
        original.error = { code:'provider_connect_timeout', message:'连接百炼超时，请求尚未送达服务商', field:'model' }
      })
      job = (await project()).jobs[job.id]
    }
    if (await reconcileUnacknowledged(key, job)) job = (await project()).jobs[job.id]
    if (job.state === 'failed' && ['provider_connect_timeout','provider_not_found_confirmed'].includes(job.error?.code) && !job.provider_job_id) {
      report.pre_submission_failures ??= []
      report.pre_submission_failures.push({ key, job_id:job.id, error:job.error })
      await saveReport()
      job = await write(dir,'jobs',{task,...args,retry_of:job.id})
    }
    report.jobs[key] = { id:job.id, model:job.model, state:job.state }
    await saveReport()
    submitted.push([key, job.id])
  }
  const deadline = Date.now() + 7 * 60_000
  const result: Record<string, any> = {}
  let nextQuery = 0
  while (submitted.some(([key]) => !result[key]) && Date.now() < deadline) {
    const p = await project()
    for (const [key, id] of submitted) {
      const job = p.jobs[id]
      report.jobs[key] = { id, model:job.model, state:job.state, task_id:job.provider_job_id, usage:job.usage, error:job.error, result:job.result?.asset_ref || job.result?.artifact_ref }
      if (job.state === 'succeeded') result[key] = job.result
      if (['failed','superseded'].includes(job.state)) {
        await saveReport()
        throw new Error(key + ' · ' + (job.error?.message ?? job.state) + (job.error?.field ? ' · ' + job.error.field : ''))
      }
      if (job.state === 'awaiting_query' && !job.provider_job_id && !job.provider_receipts?.speech?.request_id) {
        await saveReport()
        if (await reconcileUnacknowledged(key, job)) return runJobs(specs)
        throw new Error(key + ' · 服务商结果未知，原任务已保留')
      }
    }
    await saveReport()
    if (submitted.every(([key]) => result[key])) break
    if (Date.now() >= nextQuery) {
      const queryable = submitted.filter(([key,id]) => !result[key] && p.jobs[id].state === 'awaiting_query' &&
        (['reference','keyframe','video'].includes(p.jobs[id].plan.task) ||
         (p.jobs[id].plan.task === 'dubbing' && p.jobs[id].model !== 'sambert-waan-v1' && p.jobs[id].provider_receipts?.speech?.request_id)))
      await Promise.all(queryable.map(([,id]) => api(dir,projectPath('jobs/'+id+'/query'),'POST',{}).then(res => res.json())))
      nextQuery = Date.now() + 6000
    }
    await delay(1800)
  }
  assert.ok(submitted.every(([key]) => result[key]), '等待原任务超时，请查看已保存的任务号')
  return result
}
async function stage(name: string) {
  report.phase = name
  await saveReport()
  console.log(name)
}
async function uploadMusic() {
  const p = await project()
  const old = Object.values(p.assets).find((asset: any) => asset.purpose === 'music')
  if (old) return old as any
  const music = await mockMusic()
  const response = await api(dir,projectPath('assets'),'POST',await readFile(mediaPath(music.file)),{
    'idempotency-key':randomUUID(), 'x-expected-version':String(p.version), 'x-asset-purpose':'music', 'x-filename':'acceptance-bed.wav',
  })
  return (await response.json()).result
}
async function uploadKeyframe(bytes: Buffer, filename: string) {
  const state = await project()
  const sha256 = hash(bytes)
  const reusable = Object.values(state.assets).find((asset: any) => asset.sha256 === sha256 && asset.purpose === 'keyframe') as any
  if (reusable) return reusable
  return (await (await api(dir,projectPath('assets'),'POST',bytes,{
    'idempotency-key':randomUUID(), 'x-expected-version':String(state.version), 'x-asset-purpose':'keyframe', 'x-filename':filename,
  })).json()).result
}
try {
  for (const account of [op,dir,owner]) await api(account,'login','POST',{account,password:demoPasswords[account]})
  if (!report.project) {
    const created = await (await api(op,'projects','POST',{title:'末班车之后 · 真实成片验收'})).json()
    report.project = created.id
    await saveReport()
  }
  delete report.error
  await stage('第 1–2 次确认 · 创意与固定剧本')
  let p = await project()
  if (!cur(p,'brief')) await write(op,'brief/submit',{data:{...fixture.brief,raw:fixture.brief.premise,source_script:fixture.source_script_excerpt}})
  if (!cur(p,'characters')) await write(dir,'characters',{data:fixture.script.characters})
  p = await project()
  if (!p.active['1']) {
    if (!cur(p,'concept')) {
      if (savedCreative) {
        store.update(report.project, project => {
          role(project, dir, 'director')
          return put(project, dir, 'concept', savedCreative.output.result, current(project, 'brief').ref)
        })
      } else await runJobs([{key:'creative',task:'creative',args:{task_request:'候选保留夜间车站、成年前任、黑色行李箱和悬念结尾。'}}])
    }
    const idea = await submit(cur(await project(),'concept'))
    await approve(op,1,idea,idea.data.concepts[0].concept_key)
  }
  p = await project()
  if (!p.active['2']) {
    const script = cur(p,'script') ?? await save('script',fixture.script)
    await confirm(op,2,await submit(script))
  }
  await stage('第 3 次确认 · 角色参考和五个关键帧')
  p = await project()
  if (!p.active['3']) {
    if (!cur(p,'storyboard')) await save('storyboard',{total_duration_ms:36000,shots:fixture.shots,keyframes:{},references:{}})
    const references: Record<string,string> = { ...cur(await project(),'storyboard').data.references }
    for (const character of fixture.script.characters) {
      const key = 'reference-' + character.character_id
      if (!references[character.character_id]) references[character.character_id] = (await runJobs([{key,task:'reference',
        args:{character_id:character.character_id,task_request:'真实电影剧照。约三十岁的东亚成年男子，胸像，面部清晰，按角色卡固定外套颜色，夜间车站冷光。'}}]))[key].asset_ref
    }
    const board = cur(await project(),'storyboard')
    if (Object.keys(board.data.references).length !== Object.keys(references).length) await save('storyboard',{...board.data,references})
    const keyframes: Record<string,string> = { ...cur(await project(),'storyboard').data.keyframes }
    if (!keyframes.S01 && openingReport && openingReportPath && report.jobs['keyframe-S01']?.state === 'awaiting_query') {
      assert.equal(openingReport.type, 'image-video')
      assert.ok(openingReport.result.imageTask && openingReport.result.image.sha256)
      const original = await readFile(join(dirname(openingReportPath), 'first-frame.png'))
      assert.equal(hash(original), openingReport.result.image.sha256)
      const uploaded = await uploadKeyframe(original, 'real-sample-first-frame.png')
      keyframes.S01 = uploaded.ref
      report.production_inputs.opening_frame = { source: '复用已验收的真实小样首帧', report: openingReportPath, ref: uploaded.ref }
      await saveReport()
    }
    if (!keyframes.S05 && report.jobs['keyframe-S05']?.state === 'awaiting_query' &&
      report.provider_recoveries?.filter((entry: any) => entry.key === 'keyframe-S05').length >= 2) {
      const state = await project()
      const origin = state.assets[report.jobs['keyframe-S03'].result]
      assert.equal(origin.source, 'dashscope')
      const crop = join(evidence, 'S05-背身首帧.png')
      execFileSync('ffmpeg', ['-nostdin','-loglevel','error','-y','-i',mediaPath(origin.file),'-vf',
        'crop=324:576:36:150,scale=720:1280:flags=lanczos','-frames:v','1',crop])
      const uploaded = await uploadKeyframe(await readFile(crop), 'S05-shoulder-detail.png')
      keyframes.S05 = uploaded.ref
      report.production_inputs.ending_frame = { source:'从已生成的 S03 真实画面裁切小林的背身和侧脸边缘', source_ref:origin.ref, ref:uploaded.ref }
      await saveReport()
    }
    for (const shot of fixture.shots) {
      const key = 'keyframe-' + shot.shot_id
      if (!keyframes[shot.shot_id]) keyframes[shot.shot_id] = (await runJobs([{key,task:'keyframe',args:{shot_id:shot.shot_id,
        task_request:'使用已确认人物参考及外套。9:16 真人车站电影剧照，同一夜间车站出口、黑色拉杆箱；按照镜头起始状态构图。画面无文字。'}}]))[key].asset_ref
    }
    const ready = await save('storyboard',{...cur(await project(),'storyboard').data,references,keyframes})
    await confirm(dir,3,ready)
  }
  await stage('第 4 次确认 · 生成并选择五个真实镜头')
  p = await project()
  if (!p.active['4']) {
    const remaining = fixture.shots.filter((shot: any) => !p.selected[shot.shot_id])
      .sort((a: any, b: any) =>
        Number(report.jobs['video-'+a.shot_id]?.state === 'awaiting_query') -
        Number(report.jobs['video-'+b.shot_id]?.state === 'awaiting_query'))
    const unresolved: string[] = []
    for (let i=0; i<remaining.length; i+=2) {
      const batch = remaining.slice(i,i+2)
      try {
        await runJobs(batch.map((shot: any) => ({
          key:'video-'+shot.shot_id, task:'video', args:{shot_id:shot.shot_id,task_request:'连续单镜头，保持首帧人物面貌、服装、行李与车站。只做分镜描述中的动作；不加字幕、不跳切。'},
        })))
      } catch (error: any) {
        unresolved.push(error.message)
        await background.idle()
      }
      const state = await project()
      for (const shot of batch) {
        const item = report.jobs['video-'+shot.shot_id]
        const generated = item && state.jobs[item.id]
        if (generated?.state === 'succeeded')
          await write(dir,'shots/'+shot.shot_id+'/select',{ref:generated.result.asset_ref})
      }
    }
    if (unresolved.length) throw new Error(unresolved.join('；'))
    p = await project()
    const cut = cur(p,'cut')?.status === 'draft' ? cur(p,'cut') : await save('cut',{})
    await confirm(dir,4,cut)
  }
  await stage('第 5–6 次确认 · 三语配音、成片和验收')
  const music = await uploadMusic()
  let awaitingReview = false
  for (const language of languages) {
    p = await project()
    if (!p.active['5:'+language]) {
      if (!cur(p,'language:'+language)) await runJobs([{key:'translate-'+language,task:'translate',args:{language}}])
      let item = cur(await project(),'language:'+language)
      if (!item.data.reviewed) item = await save('language',{...item.data,reviewed:true},{language})
      const lines = structuredClone(item.data.lines)
      const missing = lines.filter((line: any) => !line.audio_ref)
      const dubs = await runJobs(missing.map((line: any) => ({
        key:'dubbing-'+language+'-'+line.line_id, task:'dubbing', args:{language,line_id:line.line_id},
      })))
      const mediaAssets = (await project()).assets
      for (const line of lines) {
        if (line.audio_ref) continue
        const key = 'dubbing-'+language+'-'+line.line_id
        const asset = mediaAssets[dubs[key].asset_ref]
        Object.assign(line,{audio_ref:asset.ref,audio_duration_ms:asset.duration_ms,subtitle_end_ms:line.audio_start_ms+asset.duration_ms+120})
      }
      if (lines.some((line: any,i: number) => line.audio_ref !== item.data.lines[i].audio_ref))
        item = await save('language',{lines,reviewed:true},{language})
      if (!cur(await project(),'language:'+language).data.preview_ref)
        await runJobs([{key:'preview-'+language,task:'preview',args:{language}}])
      await confirm(dir,5,cur(await project(),'language:'+language))
    }
    let delivery = cur(await project(),'delivery:'+language)
    if (!delivery) {
      const composed = await runJobs([{key:'assemble-'+language,task:'assemble',args:{language,music_ref:music.ref}}])
      delivery = (await project()).artifacts[composed['assemble-'+language].artifact_ref]
    }
    delivery = await submit(delivery)
    const route = projectPath('deliveries/'+delivery.ref)
    const preview = Buffer.from(await (await api(op,route+'/preview')).arrayBuffer())
    const name = '末班车之后-真实-'+language+'.mp4'
    const output = join(evidence,name)
    const temporaryPreview = output + '.preview.mp4'
    await writeFile(temporaryPreview, preview)
    const info = await probe(temporaryPreview)
    assert.ok(info.video && info.audio && info.width! / info.height! === 9 / 16)
    assert.ok(Math.abs(info.duration_ms! - 36000) < 500)
    execFileSync('ffmpeg',['-nostdin','-v','error','-xerror','-i',temporaryPreview,'-f','null','-'])
    if (delivery.status !== 'approved') {
      await assert.rejects(() => api(op,route+'/download'), {status:403})
      awaitingReview = true
      report.deliveries[language] = {ref:delivery.ref, name:name + '.preview.mp4', sha256:hash(preview), media:info, status:delivery.status}
      await saveReport()
      console.log(language + ' 成片预览已生成，请在工作台完成第 6 次人工验收')
      continue
    }
    const downloaded = Buffer.from(await (await api(op,route+'/download')).arrayBuffer())
    assert.equal(hash(downloaded),hash(preview))
    await rename(temporaryPreview,output)
    report.deliveries[language] = {ref:delivery.ref, name, sha256:hash(downloaded), media:info, matches_preview:true}
    await saveReport()
    console.log(language + ' 成片下载并完整解码通过')
  }
  const final = await project(owner)
  report.checkpoints = Object.values(final.confirmations)
  report.usage = await (await api(owner,projectPath('usage'))).json().then(({totals,unavailable})=>({totals,unavailable}))
  report.finished_at = new Date().toISOString()
  await stage(awaitingReview ? '待运营人工验收' : '验收通过')
} catch (error: any) {
  report.error = error.message
  await saveReport()
  console.error(error.message)
  process.exitCode = 1
} finally {
  await background.idle()
  await new Promise<void>(done => app.close(() => done()))
  store.close()
  console.log(reportPath)
}
