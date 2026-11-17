import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, statSync, unlinkSync } from 'node:fs'
import { dashscope, dashscopeConfig, providerConfigPath, providerConfigStatus, saveProviderConfig, UnknownProviderResult, validateConfig, voiceFor, wanCapabilities } from '../src/dashscope.ts'
import { persist, probe, mediaPath } from '../src/media.ts'

test('每个项目保存独立 API Key 配置文件且权限为 600', () => {
  const first = 'p-config-test-a-' + process.pid
  const second = 'p-config-test-b-' + process.pid
  const base = { region:'cn-beijing', text:'qwen-plus', image:'qwen-image-3.0-pro', video:'wan3.0-video', speech:'qwen-audio-3.1-tts-flash' }
  try {
    saveProviderConfig({ ...base, workspace:'team-a-space', api_key:'team-a-secret', text_input_per_1k:0.002, text_output_per_1k:0.006,
      image_each:0.2, video_second:0.1, speech_character:0.001 }, first)
    saveProviderConfig({ ...base, workspace:'team-b-space', api_key:'team-b-secret' }, second)
    assert.equal(dashscopeConfig(first).apiKey, 'team-a-secret')
    assert.equal(dashscopeConfig(second).apiKey, 'team-b-secret')
    assert.equal(dashscopeConfig(first).workspace, 'team-a-space')
    assert.equal(dashscopeConfig(second).workspace, 'team-b-space')
    assert.equal(statSync(providerConfigPath(first)).mode & 0o777, 0o600)
    assert.equal(JSON.parse(readFileSync(providerConfigPath(first), 'utf8')).api_key, 'team-a-secret')
    assert.equal(providerConfigStatus(first).pricing.video_second, 0.1)
    assert.equal(JSON.parse(readFileSync(providerConfigPath(second), 'utf8')).api_key, 'team-b-secret')
  } finally {
    for (const id of [first, second]) { try { unlinkSync(providerConfigPath(id)) } catch {} }
  }
})

test('百炼请求协议、首帧能力、用量与原任务查询', async () => {
  const config = { ...dashscopeConfig(), workspace: 'llm-example', region: 'cn-beijing', video:'wan3.0-video' }
  assert.equal(wanCapabilities(config.video).first_frame, true)
  assert.equal(wanCapabilities('other-video').first_frame, false)
  assert.ok(wanCapabilities(config.video).supported_durations_ms.includes(7000))
  const sent: any[] = [], logs: any[] = []
  const transport = (async (url: any, options: any) => {
    sent.push({ url: String(url), ...options })
    if (String(url).endsWith('/chat/completions')) return Response.json({
      id: 'req-text', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
    })
    if (String(url).endsWith('/video-synthesis')) return Response.json({ request_id: 'req-submit', output: { task_id: 'task-video', task_status: 'PENDING' } })
    if (String(url).endsWith('/tasks/task-video')) return Response.json({ request_id: 'req-query', output: { task_status: 'RUNNING' } })
    if (String(url).endsWith('/image-generation/generation')) return Response.json({ request_id: 'req-image', output: { task_id: 'task-image', task_status: 'PENDING' } })
    throw new Error('unexpected route')
  }) as typeof fetch
  const adapter = dashscope(config, (name, result) => logs.push({ name, result }), transport)
  assert.deepEqual(await adapter.json('只输出 JSON', { id: 'example' }), { ok: true })
  const textBody = JSON.parse(sent[0].body)
  assert.equal(textBody.messages[0].role, 'system')
  assert.equal(textBody.messages[1].content, '{"id":"example"}')
  assert.deepEqual(logs[0].result.usage, [{ unit:'input_tokens',quantity:8 },{ unit:'output_tokens',quantity:5 }])
  const stored = await persist(Buffer.from('isolated-transport-fixture'), 'png', { kind: 'image', width:720, height:1280 })
  const plan = { first_frame_ref:'frame@v1', video_prompt:'hold', avoid:[], duration_ms:7000 }
  assert.equal(await adapter.startMedia('video', plan, { 'frame@v1': stored }), 'task-video')
  const payload = JSON.parse(sent[1].body)
  assert.equal(sent[1].headers['X-DashScope-Async'], 'enable')
  assert.equal(payload.input.media[0].type, 'first_frame')
  assert.match(payload.input.media[0].url, /^data:image\/png;base64,/)
  assert.equal(payload.parameters.duration,7)
  await assert.rejects(() => adapter.queryMedia('video', 'task-video'), UnknownProviderResult)
  assert.equal(sent[2].method,'GET')
  assert.equal(sent.filter(call => call.url.endsWith('/video-synthesis')).length,1)
  const production = { references: { location: 'station@v1', prop: 'case@v1' },
    wardrobe: [{ character_id: 'person', ref: 'person_wardrobe@v1', description: '浅灰外套' }] }
  assert.equal(await adapter.startMedia('image', { image_prompt:'scene', composition:'wide', avoid:[],
    reference_map:[{ character_id:'person',asset_ref:'frame@v1' }], production },
  { 'frame@v1':stored, 'station@v1':stored, 'case@v1':stored }), 'task-image')
  const content = JSON.parse(sent[3].body).input.messages[0].content
  assert.equal(content.length, 4)
  assert.equal(content[0].image,payload.input.media[0].url)
  assert.match(content[3].text, /图2对应场景，图3对应道具/)
  assert.match(content[3].text, /服装使用已选版本：person：浅灰外套/)
  assert.deepEqual(logs.filter(entry => entry.name === 'compiled_request').at(-1).result.references.map(entry => entry.ref),
    ['frame@v1', 'station@v1', 'case@v1'])
  assert.equal(await adapter.startMedia('video', {...plan, video_mode:'references',video_references:[{ref:'frame@v1',role:'人物'},{ref:'scene@v1',role:'场景'}]}, {'frame@v1':stored,'scene@v1':stored}), 'task-video')
  const multi=JSON.parse(sent.at(-1).body)
  assert.deepEqual(multi.input.media.map(m=>m.type),['reference_image','reference_image'])
  assert.match(multi.input.prompt,/图1为人物；图2为场景/)
  assert.ok(!multi.input.media.some(m=>m.type==='first_frame'))
  const tiny=await persist(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),'png',{kind:'image',width:1,height:1})
  await adapter.startMedia('video',{...plan,video_mode:'references',video_references:[{ref:'tiny@v1',role:'道具'}]},{'frame@v1':stored,'tiny@v1':tiny})
  const uri=JSON.parse(sent.at(-1).body).input.media[0].url
  const converted=await persist(Buffer.from(uri.split(',')[1],'base64'),'jpg')
  const size=await probe(mediaPath(converted.file))
  assert.ok(size.width>=240 && size.height>=240)
})

test('流式文字任务保留首段回执，收到结束标记后解析 JSON', async () => {
  const config = { ...dashscopeConfig(), workspace:'llm-example', textStream:true }
  const events = [
    { id:'req-sse', choices:[{ delta:{ content:'{"ok":' } }] },
    { id:'req-sse', choices:[{ delta:{ content:'true}' } }] },
    { id:'req-sse', choices:[], usage:{ prompt_tokens:8, completion_tokens:5 } },
  ].map(event => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join('')
  const receipts:any[] = []
  let calls = 0
  const adapter = dashscope(config, (_, receipt) => receipts.push(receipt), (async (url, request) => {
    calls++
    assert.equal(JSON.parse(String(request.body)).stream_options.include_usage,true)
    const data = calls === 1 ? events + 'data: [DONE]\r\n\r\n' : events
    return new Response(data, { headers:{ 'Content-Type':'text/event-stream' } })
  }) as typeof fetch)
  assert.deepEqual(await adapter.json('JSON',{}), { ok:true })
  assert.deepEqual(receipts[0], { request_id:'req-sse' })
  assert.deepEqual(receipts[1].usage, [{ unit:'input_tokens',quantity:8 },{ unit:'output_tokens',quantity:5 }])
  await assert.rejects(() => adapter.json('JSON',{}), UnknownProviderResult)
  assert.equal(calls,2)
  assert.equal(receipts[2].request_id,'req-sse')
})

test('百炼超时、缺凭证和无效 Key 不触发再次提交', async () => {
  const config = { ...dashscopeConfig(), workspace:'llm-example' }
  const key = process.env.DASHSCOPE_API_KEY
  delete process.env.DASHSCOPE_API_KEY
  try { assert.throws(() => validateConfig(config), { code:'provider_config' }) }
  finally { if (key !== undefined) process.env.DASHSCOPE_API_KEY = key }
  let calls = 0
  const adapter = dashscope(config, () => {}, (async () => {
    calls++
    if (calls === 1) throw new Error('timeout')
    return Response.json({ code:'InvalidApiKey' }, { status:401 })
  }) as typeof fetch)
  await assert.rejects(() => adapter.json('JSON',{}), UnknownProviderResult)
  assert.equal(calls,1)
  await assert.rejects(() => adapter.json('JSON',{}), { code:'provider_auth' })
  assert.equal(calls,2)
})

function speechFixture() {
  const wav = Buffer.alloc(44 + 24000 * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24000, 24)
  wav.writeUInt32LE(48000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(wav.length - 44, 40)
  return wav
}

test('泰语合成使用已配置音色与语言提示，并导入供应商的实际音频', async () => {
  const config = dashscopeConfig()
  config.workspace = 'llm-example'
  config.voices.th = 'sample_voice'
  const wav = speechFixture()
  const record: any[] = []
  const adapter = dashscope(config, (name, receipt) => record.push({ name, receipt }), (async (url: any, options: any) => {
    if (String(url).endsWith('/SpeechSynthesizer')) {
      const { input, model } = JSON.parse(options.body)
      assert.equal(model, config.speech)
      assert.equal(input.voice, 'sample_voice')
      assert.deepEqual(input.language_hints, ['th'])
      assert.equal(input.text, 'อย่าเพิ่งไป')
      return Response.json({ request_id:'req-thai', output:{ audio:{ url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/file.wav' } }, usage:{ characters:10 } })
    }
    assert.equal(String(url), 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/file.wav')
    assert.equal(options.headers, undefined)
    return new Response(wav)
  }) as typeof fetch)
  const asset = await adapter.speak({ target_text:'อย่าเพิ่งไป' }, 'th')
  assert.equal(asset.language,'th')
  assert.equal(asset.duration_ms,1000)
  assert.deepEqual(record[0].receipt.usage,[{ unit:'speech_characters', quantity:10 }])
})

test('官方带版本号的音色 ID 可以通过本地配置校验', () => {
  const config = dashscopeConfig()
  config.voices['zh-CN'] = 'anmingyuan_v3.1'
  config.voices.en = 'Eric_v3.1'
  assert.equal(voiceFor(config, 'zh-CN'), 'anmingyuan_v3.1')
  assert.equal(voiceFor(config, 'en'), 'Eric_v3.1')
  config.voices.th = 'invalid voice'
  assert.throws(() => voiceFor(config, 'th'), { code: 'provider_config' })
})

test('北京泰语空配置使用百炼 Waan，拼接音频并记录实际用量', async () => {
  const config = { ...dashscopeConfig(), workspace: 'ws-test', region: 'cn-beijing' }
  config.voices.th = ''
  const wav = speechFixture()
  const records: any[] = []
  let sent: any
  class ThaiSocket extends EventTarget {
    readyState = 0
    binaryType = ''
    constructor() {
      super()
      queueMicrotask(() => {
        this.readyState = 1
        this.dispatchEvent(new Event('open'))
      })
    }
    send(data: string) {
      sent = JSON.parse(data)
      const taskId = sent.header.task_id
      queueMicrotask(() => {
        for (const chunk of [wav.subarray(0, 44), wav.subarray(44)]) {
          const binary = new Uint8Array(chunk).buffer
          this.dispatchEvent(new MessageEvent('message', { data: binary }))
        }
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
          header: { task_id: taskId, event: 'task-finished', attributes: { request_uuid: 'thai-request' } },
          payload: { usage: { characters: 10 } },
        }) }))
      })
    }
    close() {
      this.readyState = 3
      this.dispatchEvent(new Event('close'))
    }
  }
  const adapter = dashscope(config, (stage, receipt) => records.push({ stage, ...receipt }), fetch, (url, headers) => {
    assert.equal(url, 'wss://ws-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference')
    assert.match(headers.Authorization, /^Bearer /)
    return new ThaiSocket() as unknown as WebSocket
  })
  const asset = await adapter.speak({ target_text: 'อย่าเพิ่งไป' }, 'th')
  assert.equal(asset.voice, 'Waan')
  assert.equal(asset.model, 'sambert-waan-v1')
  assert.equal(asset.duration_ms, 1000)
  assert.equal(sent.payload.model, 'sambert-waan-v1')
  assert.equal(sent.payload.input.text, 'อย่าเพิ่งไป')
  assert.equal(records[1].request_id, 'thai-request')
  assert.equal(records[0].task_id, records[1].task_id)
  assert.deepEqual(records[1].usage, [{ unit: 'speech_characters', quantity: 10 }])
})

test('仅在 HTTP 连接尚未建立时重试 POST', async () => {
  const config = { ...dashscopeConfig(), workspace:'llm-example' }
  let calls = 0
  const adapter = dashscope(config, () => {}, (async () => {
    calls++
    if (calls === 1) throw new TypeError('fetch failed', { cause: { code:'UND_ERR_CONNECT_TIMEOUT' } })
    return Response.json({ choices:[{ message:{ content:'{"ok":true}' } }] })
  }) as typeof fetch)
  assert.deepEqual(await adapter.json('JSON', {}), { ok:true })
  assert.equal(calls, 2)

  let uncertainCalls = 0
  const reset = dashscope(config, () => {}, (async () => {
    uncertainCalls++
    throw new TypeError('fetch failed', { cause: { code:'ECONNRESET' } })
  }) as typeof fetch)
  await assert.rejects(() => reset.json('JSON', {}), UnknownProviderResult)
  assert.equal(uncertainCalls, 1)
})
