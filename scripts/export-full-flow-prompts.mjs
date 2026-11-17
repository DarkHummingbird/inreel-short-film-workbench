import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const statePath = join(root, 'data/full-flow-acceptance-2026-11-18/workbench.sqlite')
const stateJsonPath = '/tmp/full-flow-state.json'
const outDir = join(root, 'test-results/full-flow-acceptance-2026-11-18')

// The state export is generated with:
// sqlite3 -readonly -json DATA/workbench.sqlite "select state from project;"
// and then jq -r '.[0].state' to preserve the JSON-safe project state.
const project = JSON.parse(await readFile(stateJsonPath, 'utf8'))
const storyboardSystem = await readFile(join(root, 'contracts/agents/storyboard/system.md'), 'utf8')
const jobs = Object.values(project.jobs).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
const successful = jobs.filter(job => job.state === 'succeeded')
const label = {
  producer: '制片 Producer',
  creative: '创意 Creative',
  writer: '编剧 Writer',
  storyboard: '分镜 Storyboard',
  reference: '美术 Art · 人物参考',
  location_reference: '美术 Art · 场景参考',
  prop_reference: '美术 Art · 道具参考',
  keyframe: '美术 Art · 关键帧',
  video: '视效 VFX · 视频',
  director: '导演 Director',
  preview: '后期 Post · 语言同步预览',
  assemble: '后期 Post · 正式合成',
  dubbing: '语音 · 中文配音',
}
const checkpoint = { 1:'确认节点 1：创意方向', 2:'确认节点 2：完整剧情剧本', 3:'确认节点 3：分镜脚本与镜头清单', 4:'确认节点 4：画面与接镜', 5:'确认节点 5：语言素材', 6:'确认节点 6：成片交付' }
const readablePrompt = value => String(value ?? '')
  .replace(/第\s*1、2\s*次由运营处理，第\s*3、4、5\s*次由编导处理，第\s*6\s*次由运营完成成片验收/g,
    '“确认节点 1、2”由运营处理，“确认节点 3、4、5”由编导处理，“确认节点 6：成片交付”由运营完成验收')
  .replace(/第\s*([1-6])\s*次确认/g, (_, n) => checkpoint[n])
  .replace(/转回第\s*4\s*次/g, '退回“确认节点 4：画面与接镜”')
  .replace(/第\s*([1-6])\s*次/g, (_, n) => checkpoint[n])
const findJob = (task, extra = () => true) => jobs.find(job => job.plan.task === task && job.state === 'succeeded' && extra(job))
const code = value => '```text\n' + String(value ?? '').replaceAll('```', '``\\`') + '\n```'
const json = value => '```json\n' + JSON.stringify(value, null, 2) + '\n```'
const lines = []
const entries = []

const addPrompt = (id, stage, name, type, value, note, meta = {}) => {
  entries.push({ id, stage, name, type, prompt: value, note, ...meta })
  lines.push(`### ${name}`, '', note, '')
  if (meta.model) lines.push(`- 模型：\`${meta.model}\``)
  if (meta.params) lines.push(`- 参数：\`${JSON.stringify(meta.params)}\``)
  if (meta.refs?.length) lines.push('- 引用：' + meta.refs.map(ref => typeof ref === 'string' ? `\`${ref}\`` : `\`${ref.role}: ${Array.isArray(ref.ref) ? ref.ref.join(' + ') : ref.ref}\``).join('；'))
  lines.push('', code(value), '')
}

lines.push(
  '# 《雨停照相馆》全流程提示词汇总',
  '',
  '来源：`data/full-flow-acceptance-2026-11-18/workbench.sqlite` 中保留的真实任务记录。',
  '',
  '说明：',
  '',
  '- “Agent 系统提示词”是任务发送给文字 Agent 的完整 `agent_prompt`，包含当时的职责、输入边界和输出结构。',
  '- “最终生图提示词”和“最终生视频提示词”是图片/视频模型实际收到的 `compiled_request.prompt`，已经合并构图、负面约束和镜头承接。',
  '- 同一类 Agent 的通用系统指令在多个任务中重复，这里只保留代表性完整版本；每个素材、每个镜头的最终媒体提示词则全部列出。',
  '- S02 关键帧和视频均生成过两版；v1 是未采用版本，但保留在记录中用来说明重试差异。',
  '- 分镜 Agent 两次调用均未成功，任务记录已清理；下面保留项目当前分镜契约中的系统提示词，并明确它不是成功执行记录。',
  '- 中文项目没有机器翻译提示词；配音只记录实际发送的文本、音色和模型参数；FFmpeg 合成没有 LLM 提示词。',
  '- 为便于普通用户阅读，导出文档和 JSON 将历史简写“第 N 次确认”统一规范为带阶段名称的说法；数据库中的原始任务回执没有被改写。',
  '',
  '## 术语对照',
  '',
  '历史任务提示词使用“第 N 次确认”作为简写。阅读时按下表理解，避免把确认序号误当成镜头序号：',
  '',
  '| 历史简写 | 明确含义 | 负责人 |',
  '| --- | --- | --- |',
  '| 第 1 次确认 | 确认节点 1：创意方向 | 运营 |',
  '| 第 2 次确认 | 确认节点 2：完整剧情剧本 | 运营 |',
  '| 第 3 次确认 | 确认节点 3：分镜脚本与镜头清单 | 编导 |',
  '| 第 4 次确认 | 确认节点 4：画面与接镜 | 编导 |',
  '| 第 5 次确认 | 确认节点 5：语言素材 | 编导 |',
  '| 第 6 次确认 | 确认节点 6：成片交付 | 运营 |',
  '',
  '注意：本验收项目生成时，中文后期流程曾用 TTS 重新合成三句对白。Wan 视频本身已经带原生音频，当前产品已改为每种语言分别生成带该语言对白的视频，并保留原生对白和心声；后期只加对应语言字幕与 BGM。第四节中的中文 TTS 仅作为历史回执保留。',
  '',
  '## 模型选择说明',
  '',
  '- 本轮所有文字 Agent 都使用 `qwen-plus`。它是当前项目配置中的默认文字模型，优点是响应较快、成本低于 Pro 类模型，并且能够完成结构化 JSON 输出，不代表做过跨模型质量评测后的最优结论。',
  '- 美术、视效的“系统提示词”由 `qwen-plus` 读取并产出生成计划；随后图片计划发送给 `qwen-image-3.0-pro`，视频计划发送给 `wan3.0-video`。',
  '- 中文配音历史回执发送给 `qwen-audio-3.1-tts-flash`；当前每种语言优先使用该语言视频的原生音轨，TTS 仅作音轨不可用时的补录。',
  '- 模型可在每个项目的“模型配置”中单独修改；换模型只影响之后的新任务，不改写已有版本和回执。',
  '',
  '## 一、Agent 系统提示词',
  '',
)

for (const [task, title] of [
  ['producer', '制片 Producer'],
  ['creative', '创意 Creative'],
  ['writer', '编剧 Writer'],
  ['director', '导演 Director'],
]) {
  const job = findJob(task)
  addPrompt(`agent-${task}`, 'Agent', `${title} · 执行时完整系统提示词`, 'system_prompt', readablePrompt(job.agent_prompt),
    `${title} 的实际任务 \`${job.id}\`；状态 \`succeeded\`。`, { model: job.model, jobId: job.id })
}

addPrompt('agent-storyboard-contract', 'Agent', '分镜 Storyboard · 当前契约系统提示词', 'system_prompt', readablePrompt(storyboardSystem),
  '这是当前项目契约中的分镜系统提示词。本轮两次真实分镜调用均失败，失败任务已清理，所以这里不是一份成功调用回执。')

for (const [task, title] of [
  ['reference', '美术 Art · 人物参考'],
  ['keyframe', '美术 Art · 关键帧'],
]) {
  const job = findJob(task)
  addPrompt(`agent-art-${task}`, 'Agent', `${title} · 执行时完整系统提示词`, 'system_prompt', readablePrompt(job.agent_prompt),
    `代表性真实任务 \`${job.id}\`；场景、道具任务沿用美术系统指令，并在末尾附加各自的制作单。`, { model: job.config?.text ?? 'qwen-plus', jobId: job.id })
}

{
  const job = findJob('video')
  addPrompt('agent-vfx', 'Agent', '视效 VFX · 执行时完整系统提示词', 'system_prompt', readablePrompt(job.agent_prompt),
    '包含 `visual-video-adapted@1.2.0` 的可执行改编方法；每个镜头另有制作单附加段。来源与许可证已记录在任务中。',
    { model: job.config?.text ?? 'qwen-plus', jobId: job.id, skill: 'visual-video-adapted@1.2.0' })
}

for (const [task, title] of [
  ['preview', '后期 Post · 同步预览'],
  ['assemble', '后期 Post · 正式合成'],
]) {
  const job = findJob(task)
  addPrompt(`agent-post-${task}`, 'Agent', `${title} · 执行时完整系统提示词`, 'system_prompt', readablePrompt(job.agent_prompt),
    `后期任务 \`${job.id}\`；末尾固定清单由服务端从确认版本计算。`, { model: job.model, jobId: job.id })
}

lines.push('## 二、最终生图提示词', '', '以下 9 个任务都实际调用了 `qwen-image-3.0-pro`。图片参数统一为 `720*1280`、单张、关闭提示词扩写、关闭水印。', '')
for (const job of successful.filter(job => ['reference', 'location_reference', 'prop_reference', 'keyframe'].includes(job.plan.task) && job.provider_receipts?.compiled_request)) {
  const receipt = job.provider_receipts.compiled_request
  addPrompt(`image-${job.result.asset_ref}`, '生图', `${job.result.asset_ref} · ${label[job.plan.task]}`, 'image_prompt',
    receipt.prompt, `任务 \`${job.id}\`；资产 \`${job.result.asset_ref}\`。`, {
      model: receipt.model, params: receipt.parameters, refs: receipt.references, jobId: job.id, assetRef: job.result.asset_ref,
    })
}

lines.push('## 三、最终生视频提示词', '', '以下 4 个任务实际调用了 `wan3.0-video`。项目最终只采用 S01 v1、S02 v2、S03 v1；S02 v1 明确标注为未采用。', '')
for (const job of successful.filter(job => job.plan.task === 'video' && job.provider_receipts?.compiled_request)) {
  const receipt = job.provider_receipts.compiled_request
  addPrompt(`video-${job.result.asset_ref}`, '生视频', `${job.result.asset_ref} · ${job.plan.shot_id}`, 'video_prompt',
    receipt.prompt, `任务 \`${job.id}\`；镜头 \`${job.plan.shot_id}\`；${job.result.asset_ref === 'S02_video@v1' ? '人工退回，未采用。' : '已进入最终成片。'}`,
    { model: receipt.model, params: receipt.parameters, refs: receipt.references, jobId: job.id, assetRef: job.result.asset_ref })
}

lines.push('## 四、历史后期 TTS 与合成请求', '', '以下是本轮成片生成时的历史 TTS 回执：3 句中文对白均使用 `qwen-audio-3.1-tts-flash`，音色 `longanlingxin_v3.1`。当前流程已改为中文原始版本使用视频原生对白和心声；这些 TTS 内容只用于回看旧流程，不代表新项目的默认步骤。', '')
for (const job of successful.filter(job => job.plan.task === 'dubbing')) {
  const voice = job.config?.voices?.['zh-CN'] ?? null
  const text = job.plan.line?.target_text ?? ''
  const value = [
    `line_id: ${job.plan.line?.line_id}`,
    `shot_id: ${job.plan.line?.shot_id}`,
    `speaker_id: ${job.plan.line?.speaker_id}`,
    `text: ${text}`,
    `model: ${job.model}`,
    `voice: ${voice}`,
  ].join('\n')
  addPrompt(`tts-${job.plan.line?.line_id}`, '历史配音', `${job.plan.line?.line_id} · 历史 TTS 输入`, 'tts_input', value,
    `历史任务 \`${job.id}\`；合成时间为 ${job.plan.line?.audio_start_ms}ms。当前中文原生配音流程不再默认生成这条 TTS。`, { model: job.model, voice, jobId: job.id })
}

{
  const preview = findJob('preview')
  const assemble = findJob('assemble')
  const finalManifest = assemble.result?.response?.result
  addPrompt('post-final-manifest', '后期', '正式合成清单', 'post_manifest', JSON.stringify(finalManifest, null, 2),
    `来自 \`${assemble.id}\`；最终文件 \`${assemble.result.asset_ref}\`。`, { model: assemble.model, jobId: assemble.id })
  lines.push(`同步预览任务：\`${preview.id}\`；资产：\`${preview.result.asset_ref}\`。`, '')
}

lines.push(
  '## 五、版本选择',
  '',
  '- 人物参考：`person_1_ref@v1`、`person_2_ref@v1`。',
  '- 场景：`S01_location_reference@v1`。',
  '- 道具：`S01_prop_reference@v1` 与 `@v2` 均有实际生成；最终 S01 关键帧引用 `@v2`，S02、S03 关键帧引用 `@v1`，S01 镜头制作单也记录 `@v2`。',
  '- 关键帧：`S01_keyframe@v1`、`S02_keyframe@v1`、`S02_keyframe@v2`、`S03_keyframe@v1`；最终采用 S02 v2。',
  '- 视频：`S01_video@v1`、`S02_video@v1`、`S02_video@v2`、`S03_video@v1`；最终采用 S01 v1、S02 v2、S03 v1。',
  '',
  '## 六、音频职责修正',
  '',
  '- 三条采用视频均含 AAC 原生音轨，视频请求参数为 `audio: true`，提示词中已写明对白。',
  '- 当前产品规则：每种语言分别生成包含该语言对白、气息和心声的视频；字幕和 BGM 在后期添加。',
  '- 翻译成英文或泰文时，先使用该语言专属视频重新生成；只有视频原生音轨不可用时，才显式选择补录配音。',
  '- 本验收项目原版 `雨停照相馆-真实全流程-v1.mp4` 是修复前流程，使用后期 TTS；另保留本地重合成的 `雨停照相馆-原生对白-字幕BGM-v2.mp4` 作为原生音轨证明，没有发起新的模型调用。',
  '',
  '结构化数据见同目录 `prompts.json`。',
  '',
)

await writeFile(join(outDir, '全流程提示词汇总.md'), lines.join('\n'), 'utf8')
await writeFile(join(outDir, 'prompts.json'), JSON.stringify({ project_id: project.id, project_title: project.title, generated_at: new Date().toISOString(), entries }, null, 2), 'utf8')
console.log(`prompts: ${entries.length}`)
