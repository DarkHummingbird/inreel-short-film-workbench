import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { check, clean, fixture, hash, id, object, Problem } from './common.ts'
import { active, createProject, current, episodePosition, openStore, role, usage, type Store } from './store.ts'
import { addAsset, apply, fitsBoard, localizedDialogueMatches } from './workflow.ts'
import { createSequel } from './episodes.ts'
import { canQueryOriginal, previewJob, queue, worker, type PreparedAgentPlan } from './jobs.ts'
import { dashscopeConfig, providerConfigStatus, realEnabled, saveProviderConfig, speechModelFor } from './dashscope.ts'
import { mediaPath, upload } from './media.ts'

const web = fileURLToPath(new URL('../public/', import.meta.url))
export const demoPasswords: Record<string, string> = { op_lin: 'lin-demo', dir_zhou: 'zhou-demo', reviewer_wu: 'wu-demo', owner_chen: 'chen-demo', guest: 'guest-demo' }
const types: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  mp4: 'video/mp4', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac' }
const uploadTypes = ['script', 'reference', 'keyframe', 'music', 'dubbing']
const uploadLimit = 28 * 1024 * 1024
const demoProfiles: Record<string, { name: string; role: string }> = {
  op_lin: { name: '运营 · 林', role: 'operations' },
  dir_zhou: { name: '编导 · 周', role: 'director' },
  owner_chen: { name: '负责人 · 陈', role: 'owner' },
  reviewer_wu: { name: '历史审核账号 · 吴', role: 'reviewer' },
}

async function readBody(req: IncomingMessage, max: number) {
  let size = 0
  const parts: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    check(size <= max, '请求超过大小限制', 'body', 413)
    parts.push(chunk)
  }
  return Buffer.concat(parts)
}
async function json(req: IncomingMessage) {
  const raw = await readBody(req, 1024 * 1024)
  let data
  try { data = JSON.parse(raw.toString('utf8') || '{}') } catch { throw new Problem(422, 'invalid_json', '请求 JSON 无效') }
  return object(data)
}
function send(res: ServerResponse, status: number, payload: any) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}
async function file(req: IncomingMessage, res: ServerResponse, path: string, contentType: string, downloadName?: string) {
  const info = await stat(path).catch(() => null)
  check(info?.isFile(), '文件不可用', undefined, 404)
  const headers: Record<string, string | number> = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-cache' }
  if (downloadName) headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + encodeURIComponent(downloadName).replace(/'/g, '%27')
  let start = 0
  let end = info.size - 1
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    if (range?.[1]) start = Number(range[1])
    else if (range?.[2]) start = Math.max(0, info.size - Number(range[2]))
    if (range?.[1] && range[2]) end = Math.min(end, Number(range[2]))
    if (!range || (!range[1] && !range[2]) || start > end || start < 0) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + info.size }); return res.end()
    }
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + info.size
  }
  headers['Content-Length'] = end - start + 1
  res.writeHead(req.headers.range ? 206 : 200, headers)
  if (req.method === 'HEAD') return res.end()
  const stream = createReadStream(path, { start, end })
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}
function cookie(req: IncomingMessage) {
  return req.headers.cookie?.match(/(?:^|;\s*)workbench=([a-f0-9-]+)(?:;|$)/)?.[1] ?? ''
}
function publicJob(job: any) {
  const { identity, provider_receipts = {}, ...data } = job
  const receipts = Object.fromEntries(Object.entries(provider_receipts).map(([name, r]: [string, any]) => {
    const { result_url, plan, ...receipt } = r
    return [name, receipt]
  }))
  const { apiKey, ...safeConfig } = data.config ?? {}
  return { ...data, config: data.config ? safeConfig : data.config, provider_receipts: receipts,
    query_available: job.state === 'awaiting_query' && canQueryOriginal(job) }
}
function publicProject(project: any, account: string) {
  const { requests, notifications, ...data } = project
  const confirmedBoard = active(project, 3)?.artifact_ref
  const cutCheck = active(project, 4)
  const cut = project.artifacts[cutCheck?.artifact_ref]?.data.cut ?? []
  const adoptableVideos = confirmedBoard ? Object.values(project.assets)
    .filter((asset: any) => {
      if (!fitsBoard(project, asset, confirmedBoard, asset.shot_id)) return false
      if (!asset.localized) return true
      const language = current(project, 'language', asset.language)
      const shot = cut.find((entry: any) => entry.shot_id === asset.shot_id)
      return shot && language?.upstream === cutCheck?.ref &&
        (shot.in_ms ?? 0) + shot.duration_ms <= asset.duration_ms &&
        localizedDialogueMatches(project, asset, language.data.lines, asset.shot_id)
    })
    .map((asset: any) => asset.ref) : []
  const member_profiles = project.member_profiles ?? Object.fromEntries(Object.values(project.members).map((id: any) => [id, storelessProfile(String(id))]))
  return { ...data, member_profiles, adoptable_videos: adoptableVideos, jobs: Object.fromEntries(Object.entries(project.jobs).map(([id, j]) => [id, publicJob(j)])), notifications: notifications.filter((item: any) => item.to === account), role: role(project, account) }
}
function storelessProfile(account: string) {
  return demoProfiles[account] ?? { name: account, role: '' }
}
function projectTaskState(project: any, account: string) {
  const myRole = role(project, account)
  const confirmed = (step: number, language?: string) => Boolean(project.confirmations[project.active[String(step) + (language ? ':' + language : '')]])
  const idea = current(project, 'concept')
  const script = current(project, 'script')
  const board = current(project, 'storyboard')
  let stage = '需求', action = '填写创作需求', actor = 'operations', tab = 'brief'
  if (!current(project, 'brief')) return { stage, action, actor, tab, my_turn: actor === myRole, progress: { confirmed:0, total:4 + project.languages.length * 2 } }
  stage = '创意'
  if (!confirmed(1)) {
    tab = 'story'
    if (idea?.status === 'pending_review') { action = '选择或退回创意方向'; actor = 'operations' }
    else { action = '准备创意方向'; actor = 'director' }
  } else if (!confirmed(2)) {
    stage = '剧情剧本'; tab = 'story'
    if (script?.status === 'pending_review') { action = '审核或退回剧情剧本'; actor = 'operations' }
    else { action = '准备完整剧情剧本'; actor = 'director' }
  } else if (!confirmed(3) || (board?.has_shot_rework && board.ref !== active(project, 3)?.artifact_ref)) {
    stage = '分镜脚本与素材'; action = board ? '准备素材并确认分镜脚本' : '把剧情剧本转换为分镜脚本'; actor = 'director'
    tab = board ? 'assets' : 'shots'
  } else if (!confirmed(4)) {
    stage = '画面与接镜'; action = '选择镜头视频并确认画面'; actor = 'director'; tab = 'shots'
  } else {
    const language = project.languages.find((code: string) => !confirmed(5, code))
    if (language) {
      stage = '语言素材'; action = '生成该语种专属视频、字幕和同步预览'; actor = 'director'; tab = 'language'
    } else {
      const deliveryLanguage = project.languages.find((code: string) => !confirmed(6, code))
      if (deliveryLanguage) {
        stage = '成片验收'; tab = 'delivery'
        const delivery = current(project, 'delivery', deliveryLanguage)
        if (delivery?.status === 'pending_review') { action = '验收成片'; actor = project.members.reviewer ? 'reviewer' : 'operations' }
        else { action = '合成并提交成片'; actor = 'director' }
      } else {
        stage = '已交付'; action = myRole === 'operations' ? '下载验收版' : '查看已交付成片'; actor = null; tab = 'delivery'
      }
    }
  }
  const shared = [1,2,3,4].filter(step => confirmed(step)).length
  const languageCount = project.languages.filter((code: string) => confirmed(5, code)).length
  const deliveryCount = project.languages.filter((code: string) => confirmed(6, code)).length
  return { stage, action, actor, tab, my_turn: actor === myRole, progress: {
    confirmed: shared + languageCount + deliveryCount,
    total: 4 + project.languages.length * 2,
    shared, languages:languageCount, deliveries:deliveryCount,
  } }
}

export function createApp(store: Store = openStore(), passwords = demoPasswords, preparedPlan?: PreparedAgentPlan, transport?: typeof fetch) {
  const background = worker(store, preparedPlan, transport)
  const profile = (account: string) => {
    const custom = store.user(account)
    return custom ? { name: custom.name, role: custom.role } : demoProfiles[account] ?? { name: account, role: '' }
  }
  const hasRole = (account: string, expected: string) => profile(account).role === expected
  const provisionMember = (value: any, expectedRole: string, createdBy: string) => {
    const data = typeof value === 'string' ? { account: value } : object(value, expectedRole)
    const account = clean(data.account)
    const existing = store.user(account)
    if (existing) {
      check(existing.role === expectedRole, '该账号岗位与项目角色不一致', expectedRole)
      return { account, profile: { name: existing.name, role: existing.role } }
    }
    if (Object.hasOwn(passwords, account)) {
      check(hasRole(account, expectedRole), '该账号岗位与项目角色不一致', expectedRole)
      return { account, profile: { ...profile(account), role: expectedRole } }
    }
    check(data.password, '新成员需要设置初始密码', expectedRole + '/password')
    const created = store.createUser({ ...data, account, role: expectedRole }, createdBy)
    return { account, profile: { name: created.name, role: created.role } }
  }
  const app = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'")
    const method = req.method
    try {
      const parts = new URL(req.url!, 'http://localhost').pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (parts[0] !== 'api') {
        const name = parts.length === 0 ? 'index.html' : parts.length === 1 ? parts[0] : ''
        check(['index.html', 'app.js', 'style.css'].includes(name), '页面不存在', undefined, 404)
        return await file(req, res, join(web, name), types[name.split('.').at(-1)!])
      }
      if (!['GET', 'HEAD'].includes(method || '') && req.headers.origin) {
        const origin = new URL(req.headers.origin)
        check(origin.host === req.headers.host && ['http:', 'https:'].includes(origin.protocol), '不允许跨站提交', undefined, 403)
      }
      const [, resource, projectId, item, detail, sub] = parts
      if (resource === 'register' && method === 'POST') {
        const body = await json(req)
        check(!Object.hasOwn(passwords, clean(body.account)) && !store.user(clean(body.account)), '账号已存在', 'account', 409, 'account_exists')
        const created = store.createUser({ ...body, role: 'operations' }, 'self-register')
        const token = store.login(created.account)
        res.setHeader('Set-Cookie', 'workbench=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400')
        return send(res, 201, { account: created.account, role: created.role, name: created.name })
      }
      if (resource === 'login' && method === 'POST') {
        const body = await json(req)
        const account = clean(body.account), supplied = String(body.password ?? '')
        const expected = Object.hasOwn(passwords, account) ? passwords[account] : undefined
        const equal = timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(hash(expected ?? 'invalid')))
        const authenticated = store.authenticate(account, supplied) ?? (expected && equal ? { account, ...profile(account) } : null)
        check(authenticated, '账号或密码错误', undefined, 401, 'invalid_login')
        const token = store.login(account)
        res.setHeader('Set-Cookie', 'workbench=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400')
        return send(res, 200, { account, role: authenticated.role, name: authenticated.name })
      }
      const token = cookie(req)
      const account = store.account(token)
      check(account, '请登录', undefined, 401, 'login_required')
      if (resource === 'me' && method === 'GET') return send(res, 200, { account, ...profile(account) })
      if (resource === 'logout' && method === 'POST') {
        store.logout(token)
        res.setHeader('Set-Cookie', 'workbench=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
        return send(res, 200, { ok: true })
      }
      if (resource === 'runtime' && method === 'GET') {
        const config = dashscopeConfig()
        return send(res, 200, realEnabled() ? {
          mode: 'dashscope', region: config.region, configured: Boolean(config.apiKey && config.workspace),
          models: { text: config.text, image: config.image, video: config.video, speech: config.speech, speech_th: speechModelFor(config, 'th') },
        } : { mode: 'mock' })
      }
      if (resource === 'usage' && method === 'GET') {
        const visible = store.all().filter(project => Object.values(project.members).includes(account))
        return send(res, 200, {
          generated_at: new Date().toISOString(),
          projects: visible.map(project => {
            const summary = usage(project)
            return {
              id: project.id, title: project.title, languages: project.languages, members: project.members,
              active: project.active, updated: project.updated, ...episodePosition(project),
              pricing: providerConfigStatus(project.id).pricing, billing: project.billing ?? [],
              totals: summary.totals, unavailable: summary.unavailable,
              jobs: summary.jobs.map(publicJob),
            }
          }).sort((a, b) => b.updated.localeCompare(a.updated)),
        })
      }
      if (resource === 'sample' && method === 'GET') return send(res, 200, {
        title: fixture.title, brief: { ...fixture.brief, raw: '给《末班车之后》做一条真人 BL 宣推片。阿哲和小林是分手三个月的成年前任。小林拖着行李离开，阿哲在车站追上他。前三秒看出有人要走、有人舍不得，结尾停在小林有没有回头。约 36 秒、竖屏。分别制作中文、英文、泰文，成片带配音、字幕和背景音乐。' },
        characters: fixture.script.characters,
      })
      if (resource === 'notifications' && method === 'GET') {
        return send(res, 200, store.all().flatMap(p => p.notifications.filter(n => n.to === account).map(n => ({ ...n, project_id: p.id, title: p.title }))).sort((a,b) => b.at.localeCompare(a.at)))
      }
      check(resource === 'projects', '接口不存在', undefined, 404)
      if (!projectId && method === 'GET') {
        return send(res, 200, store.all().filter(p => Object.values(p.members).includes(account)).map(p => ({
          id: p.id, title: p.title, languages: p.languages, active: p.active, updated: p.updated, ...episodePosition(p),
          task_state: projectTaskState(p, account),
        })).sort((a,b) => b.updated.localeCompare(a.updated)))
      }
      if (!projectId && method === 'POST') {
        const body = await json(req)
        const title = clean(body.title)
        check(title && title.length <= 120, '请输入项目名称', 'title')
        check(hasRole(account, 'operations'), '仅运营可创建项目', undefined, 403, 'forbidden')
        const members: any = {}
        const member_profiles: Record<string, { name: string; role: string }> = { [account]: profile(account) }
        for (const roleName of ['director','owner'] as const) {
          const value = body.members?.[roleName]
          if (value) {
            const member = provisionMember(value, roleName, account)
            members[roleName] = member.account
            member_profiles[member.account] = member.profile
          }
        }
        if (store.user(account)) check(members.director && members.owner, '新团队创建项目时需要填写编导和负责人账号', 'members')
        const project = createProject(title, account, members)
        project.member_profiles = member_profiles
        store.save(project)
        return send(res, 201, publicProject(project, account))
      }
      const project = store.get(projectId)
      role(project, account)
      if (item === 'billing' && ['GET','POST'].includes(method || '')) {
        if (method === 'GET') return send(res, 200, project.billing ?? [])
        const accountRole = role(project, account)
        check(accountRole === 'operations', '只有运营可以录入实际账单', undefined, 403, 'forbidden')
        const body = await json(req)
        const amount = Number(body.amount)
        const currency = clean(body.currency) || 'CNY'
        check(Number.isFinite(amount) && amount >= 0 && amount <= 100000000, '账单金额无效', 'amount')
        check(['CNY','USD'].includes(currency), '币种仅支持 CNY 或 USD', 'currency')
        const record = {
          id:id(), amount, currency, actor:account, at:new Date().toISOString(),
          period_start:clean(body.period_start) || null, period_end:clean(body.period_end) || null,
          provider_reference:clean(body.provider_reference).slice(0,200) || null,
          note:clean(body.note).slice(0,1000) || null,
        }
        const result = store.mutate(projectId, account, 'billing.create', { ...body, expected_version:project.version }, String(req.headers['idempotency-key'] || ''), p => {
          role(p, account, 'operations')
          p.billing ??= []
          p.billing.push(record)
          return record
        })
        return send(res, 201, result)
      }
      if (item === 'team' && ['GET','POST'].includes(method || '')) {
        const accountRole = role(project, account)
        if (method === 'GET') return send(res, 200, {
          members: Object.entries(project.members).map(([roleName, id]) => ({ role: roleName, account: id, ...profile(String(id)) })),
        })
        check(accountRole === 'operations', '只有运营可以管理项目成员', undefined, 403, 'forbidden')
        const body = await json(req)
        const members = { ...project.members }
        const profiles = { ...(project.member_profiles ?? {}) }
        for (const roleName of ['director','owner'] as const) {
          if (!body.members?.[roleName]) continue
          const member = provisionMember(body.members[roleName], roleName, account)
          members[roleName] = member.account
          profiles[member.account] = member.profile
        }
        const result = store.mutate(projectId, account, 'team.update', body, String(req.headers['idempotency-key'] || ''), p => {
          role(p, account, 'operations')
          p.members = members
          p.member_profiles = profiles
          return publicProject(p, account)
        })
        return send(res, 200, result)
      }
      if (item === 'model-config' && ['GET','POST'].includes(method || '')) {
        const accountRole = role(project, account)
        if (method === 'GET') return send(res, 200, { ...providerConfigStatus(projectId), can_edit:['operations','owner'].includes(accountRole) })
        check(['operations','owner'].includes(accountRole), '只有运营或负责人可以修改模型配置', undefined, 403,'forbidden')
        return send(res, 200, { ...saveProviderConfig(await json(req), projectId), can_edit:true })
      }
      if (!item && method === 'GET') return send(res, 200, publicProject(project, account))
      if (item === 'usage' && method === 'GET') { const summary = usage(project); return send(res, 200, { ...summary, pricing: providerConfigStatus(projectId).pricing, jobs: summary.jobs.map(publicJob) }) }
      if (item === 'drafts' && !detail && method === 'GET') return send(res, 200, store.drafts(projectId, account))
      if (item === 'drafts' && detail && method === 'POST') {
        const body = await json(req)
        return send(res, 200, store.saveDraft(projectId, account, detail, body.data))
      }
      if (item === 'drafts' && detail && method === 'DELETE') return send(res, 200, store.clearDraft(projectId, account, detail))
      if (item === 'jobs' && detail === 'preview' && method === 'POST') {
        const body = await json(req)
        return send(res, 200, previewJob(project, account, body))
      }
      if (item === 'jobs' && detail && method === 'GET') {
        check(project.jobs[detail], '任务不存在', 'job', 404)
        return send(res, 200, publicJob(project.jobs[detail]))
      }
      if (item === 'jobs' && detail && sub === 'query' && method === 'POST') {
        role(project, account, 'director')
        const job = project.jobs[detail]
        check(job, '任务不存在', 'job', 404)
        check(job.state !== 'awaiting_query' || canQueryOriginal(job),
          '未保存可查询的原任务回执，请先在服务商侧核对提交记录', 'provider_job_id', 409, 'provider_receipt_missing')
        await background.start(projectId, detail, true)
        return send(res, 200, publicJob(store.get(projectId).jobs[detail]))
      }
      if (['deliveries', 'media'].includes(item) && ['GET', 'HEAD'].includes(method!)) {
        let asset = project.assets[detail]
        let downloadName
        if (item === 'deliveries') {
          const artifact = project.artifacts[detail]
          check(artifact?.type === 'delivery', '交付不存在', 'ref', 404)
          const approved = Object.values(project.confirmations).find(c => c.step === 6 && c.artifact_ref === detail && c.file_ref === artifact.data.file_ref)
          if (sub === 'download') {
            role(project, account, 'operations')
            check(approved, '该版本尚未通过成片验收', 'ref', 403, 'approval_required')
            downloadName = project.title + '-' + artifact.language + '-' + detail.split('@').at(-1) + '.mp4'
          } else check(sub === 'preview', '接口不存在', undefined, 404)
          asset = project.assets[artifact.data.file_ref]
        } else check(asset?.kind !== 'delivery' || /^(preview|rough)_file@/.test(detail), '请从交付版本访问成片', 'ref', 404)
        check(asset, '素材不存在', 'ref', 404)
        const contentType = types[asset.file.split('.').at(-1)] || 'application/octet-stream'
        return await file(req, res, mediaPath(asset.file), contentType, downloadName)
      }
      check(['POST', 'PATCH'].includes(method!), '接口不存在', undefined, 404)
      const key = String(req.headers['idempotency-key'] || '')
      if (item === 'jobs' && detail === 'cleanup' && method === 'POST') {
        const body = await json(req)
        const states = Array.isArray(body.states) && body.states.length ? body.states : ['failed','awaiting_query']
        check(states.every((state: string) => ['failed','awaiting_query','superseded'].includes(state)), '可清理的任务状态无效', 'states')
        const result = store.mutate(projectId, account, 'jobs.cleanup', { ...body, states }, key, p => {
          role(p, account, 'operations')
          const candidates = Object.values(p.jobs).filter(job => states.includes(job.state))
          // Keep repaint receipts and retry links available for reconciliation and deduplication.
          const retained = candidates.filter(job => job.plan.task === 'repaint' && job.config.adapter === 'dashscope' &&
            (job.state === 'awaiting_query' || job.provider_job_id || job.retry_of)).map(job => job.id)
          const deleted = candidates.filter(job => !retained.includes(job.id)).map(job => job.id)
          for (const id of deleted) delete p.jobs[id]
          return { deleted, count:deleted.length, retained, states }
        })
        return send(res, 200, result)
      }
      if (item === 'assets') {
        const kind = String(req.headers['x-asset-purpose'] || '')
        check(uploadTypes.includes(kind), '上传用途无效', 'purpose')
        role(project, account, kind === 'script' ? 'operations' : 'director')
        const filename = decodeURIComponent(String(req.headers['x-filename'] || ''))
        const referenceKind = clean(req.headers['x-reference-kind'])
        const characterId = clean(req.headers['x-character-id'])
        check(!referenceKind || ['location','prop'].includes(referenceKind), '参考图类型无效', 'reference_kind')
        check(!characterId || /^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(characterId), '人物参考标识无效', 'character_id')
        check(!(referenceKind && characterId), '人物参考和场景/道具参考不能同时标记', 'reference_kind')
        const bytes = await readBody(req, uploadLimit)
        const expected_version = Number(req.headers['x-expected-version'])
        const asset = await upload(filename, bytes, kind)
        const result = store.mutate(projectId, account, 'upload', { expected_version, kind, filename, sha256: asset.sha256, reference_kind:referenceKind || null, character_id:characterId || null }, key,
          p => addAsset(p, account, { ...asset, language: kind === 'dubbing' ? 'th' : null,
            ...(referenceKind ? { purpose:'reference', reference_kind:referenceKind } : {}),
            ...(characterId ? { purpose:'reference', character_id:characterId } : {}) }, kind === 'music' ? 'bgm' : kind))
        return send(res, 201, result)
      }
      const body = await json(req)
      if (item === 'episodes' && method === 'POST' && !detail) {
        const title = clean(body.title)
        check(title && title.length <= 120, '请输入续集名称', 'title')
        const result = store.sequel(projectId, account, { ...body, title }, key, (source, number) => createSequel(source, account, title, number))
        return send(res, 201, result)
      }
      if (item === 'jobs') {
        const result = store.mutate(projectId, account, 'jobs', body, key, p => queue(p, account, body))
        background.start(projectId, result.result.id)
        return send(res, 202, { ...result, result: publicJob(result.result) })
      }
      const routes: Record<string, [string, any?]> = {
        brief: [detail === 'submit' ? 'brief.submit' : 'brief.save'],
        artifacts: [sub === 'submit' ? 'submit' : sub === 'restore' ? 'restore' : 'artifact', sub === 'submit' || sub === 'restore' ? { ref: detail } : {}],
        storyboards: [detail === 'arrange' ? 'storyboard.arrange' : 'artifact'],
        checkpoints: ['decide', { step: Number(detail) }],
        shots: [sub === 'edit' ? 'shot.edit' : sub === 'observations' ? 'shot.observe' : sub === 'wardrobe' ? 'wardrobe' : 'select', { shot_id: detail }],
        joins: ['join.review', { shot_id: detail }],
        notifications: ['read', { id: detail }],
        characters: [sub === 'reference' ? 'character.reference' : 'characters', { character_id: detail }], languages: ['languages'], feedback: ['feedback'],
      }
      check(Object.hasOwn(routes, item), '接口不存在', undefined, 404)
      if (item === 'shots') check(detail && [undefined, 'select', 'edit', 'observations', 'wardrobe'].includes(sub), '镜头操作不存在', undefined, 404)
      if (item === 'storyboards') check(detail === 'arrange', '分镜操作不存在', undefined, 404)
      const [action, defaults] = routes[item]
      const payload = { ...body, ...defaults }
      return send(res, 200, store.mutate(projectId, account, action, payload, key, p => apply(p, account, action, payload)))
    } catch (error: any) {
      if (res.headersSent) return res.destroy()
      if (error instanceof Problem) return send(res, error.status, { code: error.code, message: error.message, field: error.field ?? null })
      if (error instanceof URIError) return send(res, 400, { code: 'invalid_url', message: '网址格式有误' })
      console.error(error)
      send(res, 500, { code: 'internal_error', message: '服务处理失败' })
    }
  })
  background.recover()
  return { app, background, store }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const passwords = {
    op_lin: process.env.WORKBENCH_PASSWORD_OP || demoPasswords.op_lin,
    dir_zhou: process.env.WORKBENCH_PASSWORD_DIRECTOR || demoPasswords.dir_zhou,
    reviewer_wu: process.env.WORKBENCH_PASSWORD_REVIEWER || demoPasswords.reviewer_wu,
    owner_chen: process.env.WORKBENCH_PASSWORD_OWNER || demoPasswords.owner_chen,
  }
  const { app } = createApp(openStore(process.env.WORKBENCH_DB || undefined), passwords)
  app.listen(Number(process.env.PORT || 3180), '127.0.0.1', () => console.log('工作台 http://127.0.0.1:' + (process.env.PORT || 3180)))
}
