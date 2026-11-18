import { readFile } from 'node:fs/promises'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { check, clean, dataDir, id, Problem } from './common.ts'
import { mediaPath, importProviderMedia, referenceJpeg, locationPropReference } from './media.ts'

const regions = ['cn-beijing', 'ap-southeast-1']
const modelId = /^[a-zA-Z0-9][a-zA-Z0-9./_-]{0,100}$/
const voiceId = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/
const priceFields = ['text_input_per_1k','text_output_per_1k','image_each','video_second','speech_character'] as const
const legacyProviderConfigPath = join(dataDir, 'provider-config.json')
export const providerConfigPath = (projectId?: string) => {
  check(!projectId || /^[A-Za-z0-9_-]{1,120}$/.test(projectId), '项目配置标识无效', 'project')
  return projectId ? join(dataDir, 'provider-config', projectId + '.json') : legacyProviderConfigPath
}
export const realEnabled = () => process.env.MODEL_MODE === 'dashscope'

function savedProviderConfig(projectId?: string): any {
  try {
    const value = JSON.parse(readFileSync(providerConfigPath(projectId), 'utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch { return {} }
}

export function providerConfigStatus(projectId?: string) {
  const saved = savedProviderConfig(projectId)
  const config = dashscopeConfig(projectId)
  return {
    mode: realEnabled() ? 'dashscope' : 'mock',
    region: config.region,
    workspace: config.workspace,
    models: { text:config.text, image:config.image, video:config.video, speech:config.speech },
    text_thinking: config.textThinking,
    voices: { 'zh-CN':Boolean(config.voices['zh-CN']), en:Boolean(config.voices.en), th:Boolean(config.voices.th) },
    pricing: Object.fromEntries(priceFields.map(field => [field, Number.isFinite(saved.pricing?.[field]) ? Number(saved.pricing[field]) : null])),
    api_key_configured: Boolean(config.apiKey),
    source: Object.keys(saved).length ? (projectId ? 'project-config-file' : 'server-config-file') : 'environment',
    can_edit: false,
  }
}

export function saveProviderConfig(input: any, projectId?: string) {
  const current = savedProviderConfig(projectId)
  const region = clean(input.region)
  const workspace = clean(input.workspace)
  const models = {
    text: clean(input.text) || clean(current.text) || 'qwen3.8-flash',
    image: clean(input.image) || clean(current.image) || 'qwen-image-3.0-pro',
    video: clean(input.video) || clean(current.video) || 'wan2.7-i2v',
    speech: clean(input.speech) || clean(current.speech) || 'qwen-audio-3.1-tts-flash',
  }
  check(regions.includes(region) && /^[a-z0-9][a-z0-9-]{0,62}$/.test(workspace), '请填写同地域的百炼业务空间 ID（北京或新加坡）', 'workspace')
  check(Object.values(models).every(name => modelId.test(name)), '模型标识格式有误', 'model')
  const key = clean(input.api_key)
  check(!key || key.length <= 500, 'API Key 格式异常', 'api_key')
  const textThinking = input.text_thinking == null ? current.textThinking !== false : input.text_thinking === true || ['1','true','on'].includes(String(input.text_thinking).toLowerCase())
  const pricing = Object.fromEntries(priceFields.map(field => {
    const value = input[field]
    if (value == null || value === '') return [field, Number.isFinite(current.pricing?.[field]) ? Number(current.pricing[field]) : null]
    const number = Number(value)
    check(Number.isFinite(number) && number >= 0, '价格必须是非负数字', field)
    return [field, number]
  }))
  const next = {
    ...current,
    region, workspace, ...models,
    textThinking,
    ...(String(input.voice_zh || '').trim() ? { voice_zh:String(input.voice_zh).trim() } : {}),
    ...(String(input.voice_en || '').trim() ? { voice_en:String(input.voice_en).trim() } : {}),
    ...(String(input.voice_th || '').trim() ? { voice_th:String(input.voice_th).trim() } : {}),
    ...(key ? { api_key:key } : {}),
    pricing,
    updated_at:new Date().toISOString(),
  }
  const path = providerConfigPath(projectId)
  mkdirSync(join(path,'..'), { recursive:true, mode:0o700 })
  writeFileSync(path, JSON.stringify(next, null, 2), { mode:0o600 })
  chmodSync(path, 0o600)
  return providerConfigStatus(projectId)
}

export function dashscopeConfig(projectId?: string) {
  const saved = savedProviderConfig(projectId)
  const fallback = projectId ? savedProviderConfig() : {}
  const value = (key: string) => clean(saved[key]) || clean(fallback[key])
  const region = value('region') || process.env.DASHSCOPE_REGION || 'cn-beijing'
  const workspace = value('workspace') || clean(process.env.DASHSCOPE_WORKSPACE_ID)
  const text = value('text') || process.env.DASHSCOPE_TEXT_MODEL || 'qwen3.8-flash'
  const image = value('image') || process.env.DASHSCOPE_IMAGE_MODEL || 'qwen-image-3.0-pro'
  const video = value('video') || process.env.DASHSCOPE_VIDEO_MODEL || 'wan2.7-i2v'
  const speech = value('speech') || process.env.DASHSCOPE_SPEECH_MODEL || 'qwen-audio-3.1-tts-flash'
  const savedThinking = saved.textThinking ?? fallback.textThinking
  const textThinking = savedThinking == null ? process.env.DASHSCOPE_TEXT_THINKING !== '0' : savedThinking !== false
  const voices = {
    'zh-CN': value('voice_zh') || process.env.DASHSCOPE_VOICE_ZH || '',
    en: value('voice_en') || process.env.DASHSCOPE_VOICE_EN || '',
    th: value('voice_th') || process.env.DASHSCOPE_VOICE_TH || '',
  }
  const apiKey = value('api_key') || clean(process.env.DASHSCOPE_API_KEY)
  return { region, workspace, text, image, video, speech, voices, apiKey, textThinking, ...(process.env.DASHSCOPE_TEXT_STREAM === '1' ? { textStream: true } : {}) }
}
export function validateConfig(config = dashscopeConfig()) {
  check(config.apiKey?.trim(), '请在模型配置页或服务端配置百炼 API Key', 'DASHSCOPE_API_KEY', 422, 'provider_config')
  check(regions.includes(config.region) && /^[a-z0-9][a-z0-9-]{0,62}$/.test(config.workspace), '请配置同地域的百炼业务空间 ID（北京或新加坡）', 'DASHSCOPE_WORKSPACE_ID', 422, 'provider_config')
  check([config.text, config.image, config.video, config.speech].every(name => modelId.test(name)), '模型标识格式有误', 'model', 422, 'provider_config')
  return config
}
const videoV3 = /^wan3\.0-video(?:-prime)?(?:-\d{4}-\d{2}-\d{2})?$/
export const wanCapabilities = (model: string) => ({
  first_frame: /^wan2\.7-i2v(?:-\d{4}-\d{2}-\d{2})?$/.test(model) || videoV3.test(model),
  character_references: false,
  supported_durations_ms: Array.from({ length: videoV3.test(model) ? 29 : 14 }, (_, i) => (i + 2) * 1000),
  aspect_ratios: ['9:16'],
})
const thaiSambert = 'sambert-waan-v1'
export function speechModelFor(config: ReturnType<typeof dashscopeConfig>, language: string) {
  return language === 'th' && config.region === 'cn-beijing' && !clean(config.voices.th) ? thaiSambert : config.speech
}
export function voiceFor(config: ReturnType<typeof dashscopeConfig>, language: string) {
  if (speechModelFor(config, language) === thaiSambert) return 'Waan'
  const voice = config.voices[language as keyof typeof config.voices]
  check(voiceId.test(voice ?? ''), language === 'th' ? '请配置该模型可用的泰语音色，或上传逐句泰语备用配音' : '请配置该语种在百炼可用的系统音色', 'voice', 422, 'provider_config')
  return voice
}

type Unit = { unit: string, quantity: number }
type Log = (stage: string, record: {
  request_id?: string, task_id?: string, usage?: Unit[], plan?: any, result_url?: string,
  model?: string, requested_model?: string, reasoning_present?: boolean, parameters?: Record<string, unknown>, prompt?: string, references?: { ref: unknown, role: string }[],
  joins?: Record<string, unknown>,
}) => void
const units = (usage: any, fields: Record<string, string>): Unit[] =>
  Object.entries(fields).flatMap(([field, unit]) => Number.isFinite(usage?.[field]) && usage[field] >= 0 ? [{ unit, quantity: usage[field] }] : [])
const tokens = { prompt_tokens: 'input_tokens', completion_tokens: 'output_tokens', input_tokens: 'input_tokens', output_tokens: 'output_tokens' }

export class UnknownProviderResult extends Error {
  constructor(message: string) { super(message); this.name = 'UnknownProviderResult' }
}
function providerError(status: number, code: any) {
  const safe = typeof code === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(code) ? '（' + code + '）' : ''
  if ([401,403].includes(status) || ['InvalidApiKey', 'invalid_api_key'].includes(code)) return new Problem(422, 'provider_auth', '百炼拒绝凭证或模型权限，请检查 Key、地域与业务空间' + safe, 'model')
  return new Problem(422, 'provider_error', '百炼调用失败' + safe + (status ? ' · HTTP ' + status : ''), 'model')
}
function limitedId(value: any) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value) ? value : undefined
}
const generationPath = '/services/aigc/image-generation/generation'
const videoPath = '/services/aigc/video-generation/video-synthesis'
const speechPath = '/services/audio/tts/SpeechSynthesizer'
function connectionCode(error: unknown) {
  const failure = error as { name?: string, cause?: { code?: string } }
  const code = failure?.cause?.code || failure?.name
  return code && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : null
}
function connectionDetail(error: unknown) {
  const code = connectionCode(error)
  return code ? '（' + code + '）' : ''
}

type SocketFactory = (url: string, headers: Record<string, string>) => WebSocket
const openSocket: SocketFactory = (url, headers) => new WebSocket(url, { headers } as any)

export function dashscope(config: ReturnType<typeof dashscopeConfig>, log: Log, transport = fetch, connect = openSocket) {
  const host = 'https://' + config.workspace + '.' + config.region + '.maas.aliyuncs.com'
  async function request(path: string, body?: any, asyncJob = false) {
    const post = body !== undefined
    let response
    const attempts = 3
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        response = await transport(host + path, {
          method: post ? 'POST' : 'GET',
          headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json', Connection: 'close', ...(asyncJob ? { 'X-DashScope-Async': 'enable' } : {}) },
          body: post ? JSON.stringify(body) : undefined,
          redirect: 'error',
          signal: AbortSignal.timeout(post ? 90000 : 15000),
        })
        break
      } catch (error) {
        if (post && connectionCode(error) === 'UND_ERR_CONNECT_TIMEOUT') {
          if (attempt + 1 === attempts) throw new Problem(503, 'provider_connect_timeout', '连接百炼超时，请求尚未送达服务商', 'model')
          await delay(700 * (attempt + 1))
          continue
        }
        if (post) throw new UnknownProviderResult('提交结果未知，请核对原请求或服务商任务记录' + connectionDetail(error))
        if (attempt + 1 === attempts) throw new UnknownProviderResult('暂未查到服务商任务，请稍后查询原任务' + connectionDetail(error))
        await delay(700 * (attempt + 1))
      }
    }
    check(response, '服务商未返回响应', 'model')
    if (body?.stream && response.ok && response.headers.get('content-type')?.includes('text/event-stream')) return response
    let data
    try { data = await response.json() }
    catch {
      if (response.status < 500 && response.status !== 408 && !response.ok) throw providerError(response.status, null)
      throw new UnknownProviderResult('服务商响应无法解析，请核对原请求')
    }
    if (response.status >= 500 || response.status === 408) throw new UnknownProviderResult('服务商暂未确认请求状态，请核对原任务')
    if (!response.ok || data.code || data.error) throw providerError(response.status, data.code ?? data.error?.code)
    return data
  }
  async function json(system: string, input: any, stage = 'text') {
    const result = await request('/compatible-mode/v1/chat/completions', {
      model: config.text, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }],
      response_format: { type: 'json_object' }, enable_thinking: config.textThinking,
      ...(config.textStream ? { stream: true, stream_options: { include_usage: true } } : {}),
    })
    let content
    if (result instanceof Response) {
      content = await streamContent(result, stage)
    } else {
      const message = result.choices?.[0]?.message
      log(stage, {
        request_id: limitedId(result.id ?? result.request_id),
        model: limitedId(result.model), requested_model: config.text,
        reasoning_present: typeof message?.reasoning_content === 'string' && message.reasoning_content.length > 0,
        usage: units(result.usage, tokens),
      })
      content = message?.content
    }
    try { return JSON.parse(content) }
    catch { throw new Problem(422, 'model_invalid_json', '千问没有返回可解析的单个 JSON 对象', 'output') }
  }
  async function streamContent(response: Response, stage: string) {
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    let pending = '', content = '', requestId: string | undefined
    let reasoningPresent = false, model: string | undefined
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        pending += value
        let end
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end)
          pending = pending.slice(end + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') {
            log(stage, { model, requested_model: config.text, reasoning_present: reasoningPresent })
            return content
          }
          const event = JSON.parse(data)
          if (event.error) throw new UnknownProviderResult('流式响应返回错误，请按原请求编号核对')
          const id = limitedId(event.id ?? event.request_id)
          if (id && !requestId) {
            requestId = id
            log(stage, { request_id: requestId })
          }
          if (event.usage) log(stage, { usage: units(event.usage, tokens) })
          model = limitedId(event.model) ?? model
          const delta = event.choices?.[0]?.delta
          reasoningPresent ||= typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0
          content += delta?.content ?? ''
        }
      }
    } catch (error) {
      if (error instanceof UnknownProviderResult) throw error
      throw new UnknownProviderResult('流式响应中断，请按原请求记录核对' + connectionDetail(error))
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    throw new UnknownProviderResult('流式响应未收到结束标记，请按原请求记录核对')
  }
  async function dataUrl(asset: any, compact = false, multiReference = false) {
    check(asset?.kind === 'image' && asset.bytes <= 10 * 1024 * 1024, '图片缺失或超过 10 MB', 'reference')
    const tooSmall = Number.isFinite(asset.width) && Number.isFinite(asset.height) && (asset.width < 240 || asset.height < 240)
    if (compact && (tooSmall || asset.bytes > (multiReference ? 64 : 500) * 1024)) {
      return 'data:image/jpeg;base64,' + (await referenceJpeg(asset.file, multiReference, tooSmall)).toString('base64')
    }
    const ext = asset.file.split('.').at(-1)
    const mime = ({ png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' } as Record<string, string>)[ext]
    check(mime, '参考图格式不支持', 'reference')
    return 'data:image/' + mime + ';base64,' + (await readFile(mediaPath(asset.file))).toString('base64')
  }
  async function startMedia(kind: 'image' | 'video', plan: any, assets: any) {
    const path = kind === 'image' ? generationPath : videoPath
    let input: any, parameters: any
    const wardrobe = (plan.production?.wardrobe ?? []).map((entry: any) => entry.character_id + '：' + entry.description).join('；')
    if (kind === 'image') {
      const editBase = plan.production?.edit_base
      const refs = editBase ? [{ ref: editBase, role: '待局部修改的原始画面' }] : [
        ...plan.reference_map.map((r: any) => ({ ref: r.asset_ref, role: '角色 ' + r.character_id })),
        ...Object.entries(plan.production?.references ?? {}).map(([kind, ref]) => ({ ref, role: kind === 'location' ? '场景' : '道具' })),
      ]
      const capped = /^qwen-image-3\.0(?:-|$)/.test(config.image) && refs.length > 3
      const location = assets[plan.production?.references?.location]
      const prop = assets[plan.production?.references?.prop]
      check(!capped || (refs.length === 4 && location?.kind === 'image' && prop?.kind === 'image'),
        '生图模型最多接收三张参考图，请调整参考图', 'reference')
      const transmitted = capped ? refs.slice(0, 2) : refs
      const images = await Promise.all(transmitted.map(async r => ({ image: await dataUrl(assets[String(r.ref)], true, refs.length > 1) })))
      const descriptions = transmitted.map((r, index) => '图' + (index+1) + '对应' + r.role)
      if (capped) {
        images.push({ image: 'data:image/jpeg;base64,' + (await locationPropReference(location.file, prop.file)).toString('base64') })
        descriptions.push('图3左半是场景参考、右半是道具参考。只生成一个完整镜头画面，不要生成拼贴或分屏')
      }
      const mapping = descriptions.join('，')
      const costume = wardrobe ? '服装使用已选版本：' + wardrobe + '。人物参考图用于识别身份，若图中服装与所选版本不同，按所选服装描述。' : ''
      const editInstruction = editBase ? '基于图1做局部重绘。只修改用户要求修复的问题区域；人物身份、脸型、年龄感、手部数量、服装、构图、镜头角度、背景结构、道具位置和光线不得变化。返回同一画幅的一张完整图片，不要添加说明、边框或拼贴。' : ''
      const prompt = [mapping, editInstruction, plan.image_prompt, costume, plan.composition && '构图：' + plan.composition, plan.avoid?.length && '避免：' + plan.avoid.join('，')].filter(Boolean).join('\n')
      input = { messages: [{ role: 'user', content: [...images, { text: prompt }] }] }
      parameters = { size: '720*1280', n: 1, prompt_extend: false, watermark: false }
      log('compiled_request', { model: config.image, parameters, prompt, references: capped ? [
        ...transmitted, { ref: [plan.production.references.location, plan.production.references.prop], role: '场景与道具合图（左场景、右道具）' },
      ] : refs })
    } else {
      const frame = assets[plan.first_frame_ref]
      check(frame?.height && Math.abs(frame.width / frame.height - 9 / 16) < 0.035, '首帧比例与 9:16 不符，请重新选帧', 'first_frame_ref')
      const referenceMode = plan.video_mode === 'references'
      const references = referenceMode ? plan.video_references : [{ref:plan.first_frame_ref, role:'严格首帧'}]
      check(!referenceMode || (videoV3.test(config.video) && Array.isArray(references) && references.length >= 1 && references.length <= 10), '多素材参考仅支持 Wan 3.0，且需 1 至 10 张图片', 'reference_images')
      const mapping = referenceMode ? '\n素材用途：' + references.map((r: any, i: number) => '图' + (i+1) + '为' + r.role).join('；') + '。按素材用途保持人物、场景和调度；参考图不保证是视频首帧。' : ''
      input = { prompt: plan.video_prompt + mapping + (wardrobe ? '\n保持角色的已选服装：' + wardrobe : '') + (plan.avoid.length ? '\n避免：' + plan.avoid.join('，') : ''),
        media: await Promise.all(references.map(async (r: any) => ({ type:referenceMode ? 'reference_image' : 'first_frame', url:await dataUrl(assets[r.ref], true) }))) }
      parameters = videoV3.test(config.video)
        ? { resolution: '720P', ratio: '9:16', duration: plan.duration_ms / 1000, prompt_extend: false, watermark: false, audio: true }
        : { resolution: '720P', duration: plan.duration_ms / 1000, prompt_extend: false, watermark: false }
      log('compiled_request', { model: config.video, parameters, prompt: input.prompt, mode: referenceMode ? 'references' : 'first_frame', references,
        ...(plan.production?.joins ? { joins: plan.production.joins } : {}) })
    }
    const payload = await request('/api/v1' + path, { model: config[kind], input, parameters }, true)
    const taskId = limitedId(payload.output?.task_id)
    log(kind, { request_id: limitedId(payload.request_id), task_id: taskId })
    if (!taskId) throw new UnknownProviderResult('服务商未返回任务号，请核对原提交记录')
    return taskId
  }
  async function queryMedia(kind: 'image' | 'video', taskId: string, polls = 1) {
    check(limitedId(taskId), '缺少可查询的服务商任务号', 'provider_job_id')
    for (let attempt = 0; attempt < polls; attempt++) {
      const result = await request('/api/v1/tasks/' + encodeURIComponent(taskId)).catch(error => {
        if (error instanceof UnknownProviderResult) throw error
        throw new UnknownProviderResult('原任务暂时无法查询：' + error.message)
      })
      const output = result.output
      const usage = kind === 'video' ? units(result.usage, { duration: 'video_seconds', video_count: 'videos' })
        : units(result.usage, result.usage?.output_image_count === undefined ? { image_count: 'images' } : { input_image_count: 'input_images', output_image_count: 'images' })
      log(kind, { request_id: limitedId(result.request_id), task_id: taskId, ...(usage.length ? { usage } : {}) })
      if (output?.task_status === 'SUCCEEDED') {
        const url = kind === 'video' ? output.video_url : output.choices?.[0]?.message?.content?.find((c: any) => c.image)?.image
        return download(url, kind).catch(error => {
          if (error instanceof UnknownProviderResult) throw error
          throw new UnknownProviderResult('服务商已完成，暂时无法导入原任务的媒体：' + error.message)
        })
      }
      if (['FAILED', 'CANCELED'].includes(output?.task_status)) throw providerError(0, output.code ?? output.task_status)
      if (!['PENDING', 'RUNNING', 'SUSPENDED'].includes(output?.task_status)) throw new UnknownProviderResult('服务商暂时无法确认该任务，请按原任务号核对')
      if (attempt < polls - 1) await delay(2500)
    }
    throw new UnknownProviderResult('服务商仍在处理，稍后查询原任务')
  }
  async function speak(line: any, language: string) {
    const voice = voiceFor(config, language)
    const model = speechModelFor(config, language)
    if (model === thaiSambert) {
      const audio = await speakSambert(line.target_text)
      return { ...await importProviderMedia(audio, 'audio'), text: line.target_text, language, voice, model }
    }
    const result = await request('/api/v1' + speechPath, { model: config.speech, input: {
      text: line.target_text, voice, format: 'wav', sample_rate: 24000, language_hints: [language === 'zh-CN' ? 'zh' : language],
    } })
    const url = result.output?.audio?.url
    log('speech', { request_id: limitedId(result.request_id), usage: units(result.usage, { input_tokens: 'input_tokens', output_tokens: 'output_tokens', characters: 'speech_characters' }), result_url: url })
    return { ...await download(url, 'audio'), text: line.target_text, language, voice, model }
  }
  function speakSambert(text: string): Promise<Buffer> {
    const taskId = id()
    const socket = connect(host.replace(/^https:/, 'wss:') + '/api-ws/v1/inference', {
      Authorization: 'Bearer ' + config.apiKey,
    })
    socket.binaryType = 'arraybuffer'
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      let submitted = false
      let done = false
      const finish = (error?: Error) => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (socket.readyState < 2) socket.close()
        if (error) reject(error)
        else resolve(Buffer.concat(chunks))
      }
      const interrupted = () => finish(submitted
        ? new UnknownProviderResult('泰语合成连接中断，请核对原任务状态')
        : new Problem(422, 'provider_connection', '百炼泰语语音接口未能建立连接', 'model'))
      const timer = setTimeout(interrupted, 45000)
      socket.addEventListener('open', () => {
        if (done) return
        try {
          socket.send(JSON.stringify({
            header: { action: 'run-task', task_id: taskId, streaming: 'out' },
            payload: {
              task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer', model: thaiSambert,
              input: { text }, parameters: { text_type: 'PlainText', format: 'wav', sample_rate: 16000 },
            },
          }))
          submitted = true
          log('speech', { task_id: taskId })
        } catch { interrupted() }
      })
      socket.addEventListener('error', interrupted)
      socket.addEventListener('close', interrupted)
      socket.addEventListener('message', event => {
        if (done) return
        if (event.data instanceof ArrayBuffer) {
          size += event.data.byteLength
          if (size > 20 * 1024 * 1024) return finish(new Problem(422, 'invalid_media', '泰语音频超过导入限制', 'media'))
          chunks.push(Buffer.from(event.data))
          return
        }
        try {
          const message = JSON.parse(event.data)
          const header = message?.header
          if (header?.task_id !== taskId) return
          if (header.event === 'task-failed') return finish(providerError(0, header.error_code))
          if (header.event !== 'task-finished') return
          log('speech', { task_id: taskId, request_id: limitedId(header.attributes?.request_uuid),
            usage: units(message.payload?.usage, { characters: 'speech_characters' }) })
          if (!size) return finish(new Problem(422, 'invalid_media', '百炼未返回可导入的泰语音频', 'media'))
          finish()
        } catch { interrupted() }
      })
    })
  }
  async function download(value: unknown, kind: 'image' | 'video' | 'audio') {
    let url
    try { url = new URL(String(value)) } catch { throw new UnknownProviderResult('服务商文件链接缺失，请核对原任务') }
    const allowed = /^(?:[a-z0-9-]+\.oss-(?:[a-z0-9-]+|accelerate)\.aliyuncs\.com|[a-z0-9-]+\.alicdn\.com)$/.test(url.hostname)
    check(allowed && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.port, '服务商返回了不受支持的媒体地址', 'media_url')
    url.protocol = 'https:'
    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await transport(url, { redirect: 'error', signal: AbortSignal.timeout(25000) })
        break
      } catch (error) {
        if (attempt === 2) throw new UnknownProviderResult('暂未能保存媒体，请查询原任务' + connectionDetail(error))
        await delay(700 * (attempt + 1))
      }
    }
    check(response, '服务商媒体未返回响应', 'media')
    if (!response.ok || !response.body) throw new UnknownProviderResult('服务商媒体暂不可读取，请查询原任务')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    const max = kind === 'video' ? 80 * 1024 * 1024 : 20 * 1024 * 1024
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        check(length <= max, '服务商文件超过本地导入限制', 'media')
        chunks.push(value)
      }
    } catch (error) {
      if (error instanceof Problem) throw error
      throw new UnknownProviderResult('媒体下载中断，请查询原任务')
    } finally { await reader.cancel().catch(() => {}) }
    return importProviderMedia(Buffer.concat(chunks), kind)
  }
  return { json, startMedia, queryMedia, speak, download }
}
