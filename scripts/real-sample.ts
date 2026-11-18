import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { contracts, schema, validateAgent } from '../src/contracts.ts'
import { dashscope, speechModelFor, validateConfig, voiceFor, wanCapabilities } from '../src/dashscope.ts'
import { importProviderMedia, mediaPath } from '../src/media.ts'

const kind = process.argv[2]
const textAgent = kind === 'text' ? process.argv[3] : undefined
const textAgents = ['producer', 'creative', 'writer', 'storyboard']
const resumePath = kind === 'image-video' && process.argv[3] ? resolve(process.argv[3]) : null
if (!['text', 'storyboard-short', 'image-video', 'speech'].includes(kind) || (textAgent && !textAgents.includes(textAgent))) {
  console.log('用法：npm run sample:real -- text [producer|creative|writer|storyboard] | storyboard-short | image-video | speech')
  process.exit(2)
}

let config
try { config = validateConfig() }
catch (error: any) {
  console.error(error.message + (error.field ? ' · ' + error.field : ''))
  process.exit(2)
}
const outputDir = resumePath ? dirname(resumePath) : resolve('test-results', 'real-' + new Date().toISOString().replaceAll(':','-'))
await mkdir(outputDir, { recursive: true })
const report: any = resumePath ? JSON.parse(await readFile(resumePath, 'utf8')) : { started_at: new Date().toISOString(), type: kind, region: config.region,
  text_thinking: config.textThinking, text_stream: Boolean(config.textStream), models: { text: config.text, image: config.image, video: config.video, speech: config.speech, speech_th: speechModelFor(config, 'th') }, calls: [], result: null }
if (resumePath) {
  if (report.type !== kind || report.region !== config.region || !report.result?.imageTask ||
    report.models.image !== config.image || report.models.video !== config.video) {
    console.error('仅可恢复同地域、同模型并有原图像任务号的小样。')
    process.exit(2)
  }
  report.recoveries = [...(report.recoveries ?? []), { at: new Date().toISOString(), previous_error: report.error ?? null }]
  delete report.error
  delete report.finished_at
}
const reportPath = resumePath ?? join(outputDir, 'report.json')
const checkpoint = () => {
  const temporary = reportPath + '.next'
  writeFileSync(temporary, JSON.stringify(report, null, 2))
  renameSync(temporary, reportPath)
}
checkpoint()
const adapter = dashscope(config, (stage, { result_url, plan, ...metadata }) => {
  report.calls.push({ stage, ...metadata })
  checkpoint()
})
const exportFile = async (asset: any, name: string) => {
  await copyFile(mediaPath(asset.file), join(outputDir, name))
  return { name, duration_ms: asset.duration_ms, width: asset.width, height: asset.height, sha256: asset.sha256 }
}
try {
  if (kind === 'text') {
    const results = []
    for (const agent of textAgent ? [textAgent] : textAgents) {
      const contract = contracts[agent]
      const input = contract.examples[0].input
      const output = await adapter.json(contract.prompt + '\n输出一个符合以下 Schema 的 JSON 对象：\n' + JSON.stringify(contract.outputSchema), input, agent)
      validateAgent(agent, input, output)
      results.push({ agent, input, output, usable: output.status === 'ok' })
      report.result = results
      checkpoint()
    }
    if (results.some(item => !item.usable)) process.exitCode = 1
  } else if (kind === 'storyboard-short') {
    const contract = contracts.storyboard
    const input = structuredClone(contract.examples[0].input)
    input.approved_script.beats = input.approved_script.beats.slice(0, 1)
    input.brief.target_duration_ms = 2000
    input.planned_shot_count = 1
    input.task_request = '只把 B01 转成一条 2000 毫秒分镜，保持无对白。每个描述字段写一句短语。'
    schema('storyboard', 'input', input)
    const output = await adapter.json(contract.prompt + '\n输出一个符合以下 Schema 的 JSON 对象：\n' + JSON.stringify(contract.outputSchema), input, 'storyboard')
    validateAgent('storyboard', input, output)
    const usable = output.status === 'ok' && output.result.shots.length === 1 && output.result.total_duration_ms === 2000
    report.result = [{ agent: 'storyboard', input, output, usable }]
    if (!usable) process.exitCode = 1
  } else if (kind === 'image-video') {
    if (!wanCapabilities(config.video).first_frame) throw new Error('视频模型需要支持 Wan 2.7 首帧接口')
    const imagePlan = { reference_map: [], image_prompt: '虚构成年男子，浅灰外套，夜间车站拖黑色行李箱。9:16 竖屏，写实，无字。', composition: '侧后方中景，固定机位', avoid: ['出现文字', '多余人物'] }
    if (!report.result?.imageTask) {
      const imageTask = await adapter.startMedia('image', imagePlan, {})
      report.result = { imagePlan, imageTask }
      checkpoint()
    }
    const image = report.result.image
      ? await importProviderMedia(await readFile(join(outputDir, 'first-frame.png')), 'image')
      : await adapter.queryMedia('image', report.result.imageTask, 50)
    if (!report.result.image) {
      report.result.image = await exportFile(image, 'first-frame.png')
      checkpoint()
    }
    const videoPlan = { first_frame_ref: 'frame@v1', duration_ms: 2000, video_prompt: '固定机位，男子拖行李箱向出口走一步，服装和行李箱保持一致。', avoid: ['跳切', '脸部变形'] }
    if (!report.result.videoTask) {
      if (report.result.videoSubmissionStarted) throw new Error('前一次视频提交尚未确认，请先在百炼核对。')
      Object.assign(report.result, { videoPlan, videoSubmissionStarted: true })
      checkpoint()
      report.result.videoTask = await adapter.startMedia('video', videoPlan, { 'frame@v1':image })
      checkpoint()
    }
    if (!report.result.video) {
      const video = await adapter.queryMedia('video', report.result.videoTask, 100)
      report.result.video = await exportFile(video, 'first-frame-2s.mp4')
    }
  } else {
    const samples = { 'zh-CN': process.argv[3] === 'alternate-zh' ? '那你再等我一次。' : '先别走。', en: "Don't go yet.", th: 'อย่าเพิ่งไป' }
    report.result = {}
    for (const [language, text] of Object.entries(samples)) {
      try { voiceFor(config, language) }
      catch (error: any) { report.result[language] = { status: 'configuration_missing', detail: error.message }; process.exitCode = 1; continue }
      try {
        const asset = await adapter.speak({ target_text:text }, language)
        report.result[language] = { text, voice: asset.voice, model: asset.model, ...await exportFile(asset, language + '.wav') }
      } catch (error: any) {
        report.result[language] = { text, status: 'failed', code: error.code ?? error.name, detail: error.status || error.name === 'UnknownProviderResult' ? error.message : '未能导入语音文件' }
        process.exitCode = 1
      }
      checkpoint()
    }
  }
} catch (error: any) {
  report.error = { code: error.code ?? error.name, message: error.status || error.name === 'UnknownProviderResult' ? error.message : '小样处理失败，请检查模型及已保存的任务号', field: error.field ?? null }
  process.exitCode = 1
} finally {
  report.finished_at = new Date().toISOString()
  if (kind === 'image-video' || kind === 'speech') report.human_review = '待编导检查画面或试听语音。'
  checkpoint()
  console.log(reportPath)
}
