import { readFileSync } from 'node:fs'
import Ajv from 'ajv/dist/2020.js'
import { array, canonical, check, clean, hash, integer } from './common.ts'

const read = (path: string) => readFileSync(new URL('../contracts/' + path, import.meta.url), 'utf8')
const registry = JSON.parse(read('agent-registry.json'))
const ajv = new Ajv({ allErrors: true, strict: false })
export const contracts = Object.fromEntries(Object.entries(registry.agents).map(([name, a]: [string, any]) => {
  const prompt = read(a.system_prompt)
  const inputSchema = JSON.parse(read(a.input_schema))
  const outputSchema = JSON.parse(read(a.output_schema))
  return [name, {
    prompt, fingerprint: hash(prompt), inputSchema, outputSchema, failure: read(a.failure_guide),
    examples: [a.example, ...(a.additional_examples || [])].map(path => JSON.parse(read(path))),
    input: ajv.compile(inputSchema), output: ajv.compile(outputSchema),
  }]
}))
export function schema(name: string, direction: 'input' | 'output', data: any) {
  const validate = contracts[name]?.[direction]
  check(validate, '未知 Agent', 'agent')
  if (!validate(data)) {
    const error = validate.errors[0]
    const path = [direction + error.instancePath, error.params.missingProperty, error.params.additionalProperty].filter(Boolean).join('/')
    check(false, 'Schema 校验失败 · ' + error.message, path)
  }
}
const same = (a: any, b: any) => canonical(a) === canonical(b)
function unique(items: any[], key: string) {
  check(new Set(items.map(item => item[key])).size === items.length, '标识必须唯一', key)
}
function interval(value: any, duration: number, field: string) {
  check(integer(value.start_ms) && integer(value.end_ms) && value.start_ms < value.end_ms && value.end_ms <= duration, '证据区间超出素材', field)
}
export function validateScript(script: any, characters: any[] = script.characters) {
  unique(script.characters, 'character_id')
  unique(script.beats, 'beat_id')
  unique(script.beats.flatMap((beat: any) => beat.dialogue), 'line_id')
  const ids = new Set(characters.map(c => c.character_id))
  check(script.characters.length >= 2 && script.characters.every((c: any) => ids.has(c.character_id)), '剧本需要两位有效主角', 'characters')
  const cast = new Set(script.characters.map((c: any) => c.character_id))
  const shotLanguage = /(镜头|景别|机位|运镜|特写|中景|近景|全景|俯拍|仰拍|推镜|拉镜|摇镜|切镜)/
  for (const beat of script.beats) {
    check(!shotLanguage.test(String(beat.scene ?? '') + ' ' + String(beat.action ?? '')), '剧情剧本不要写景别、机位、运镜或镜头时长，请在确认后转换为分镜脚本', beat.beat_id)
    for (const line of beat.dialogue) check(cast.has(line.speaker_id) && clean(line.text), '对白缺少有效说话人或文本', beat.beat_id + '/' + line.line_id)
  }
}
export function validateStoryboard(story: any, script: any) {
  unique(story.shots, 'shot_id')
  unique(story.shots.flatMap((shot: any) => shot.dialogue), 'line_id')
  const characters = new Set(script.characters.map((c: any) => c.character_id))
  const beats = new Map(script.beats.map((beat: any) => [beat.beat_id, beat]))
  let duration = 0
  for (const [i, shot] of story.shots.entries()) {
    check(/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(shot.shot_id) && shot.order === i + 1 && integer(shot.duration_ms, 1), '镜头顺序、编号或时长无效', 'shots/' + i)
    check(shot.beat_ids.every((key: string) => beats.has(key)) && shot.character_ids.every((key: string) => characters.has(key)), '镜头引用了未知节拍或角色', shot.shot_id)
    const lines = shot.beat_ids.flatMap((key: string) => (beats.get(key) as any).dialogue)
    for (const line of shot.dialogue) check(lines.some((source: any) => same(source, line)), '对白需引用当前已确认剧本', shot.shot_id + '/' + line.line_id)
    duration += shot.duration_ms
  }
  check(story.total_duration_ms === duration, '分镜合计时长与镜头时长不一致', 'total_duration_ms')
  check(story.shots.flatMap((shot: any) => shot.dialogue).length === script.beats.flatMap((beat: any) => beat.dialogue).length, '分镜遗漏已确认对白', 'shots')
}
export function manifest(input: any) {
  return {
    mode: input.mode, target_language: input.target_language, cut_ref: input.cut_ref,
    ordered_video_refs: input.cut.map((shot: any) => shot.video_ref),
    language_assets_ref: input.language_assets_ref, dubbing_refs: input.lines.map((line: any) => line.audio_ref).filter(Boolean),
    subtitle_ref: input.subtitle_ref, music_ref: input.music?.asset_ref ?? null,
    duration_ms: input.cut.reduce((sum: number, shot: any) => sum + shot.duration_ms, 0),
    missing_line_ids: [], timing_issues: [], language_confirmation_ref: input.language_confirmation_ref,
  }
}
export function validateAgent(name: string, input: any, output: any, project?: any) {
  schema(name, 'input', input)
  schema(name, 'output', output)
  if (project) {
    check(input.project_id === project.id, '项目引用不匹配', 'project_id')
    for (const source of input.sources) check(project.artifacts[source.ref] || project.assets[source.ref] || project.confirmations[source.ref], '引用不属于当前项目', source.ref)
  }
  if (output.status !== 'ok') return
  const result = output.result
  if (name === 'director') {
    check(result.stage === input.next_checkpoint && result.target_language === input.target_language, '导演建议的阶段或语种与当前请求不一致', 'target_language')
    const actor = input.next_checkpoint === 6 ? (input.delivery_reviewer ?? 'operations') : [1, 2].includes(input.next_checkpoint) ? 'operations' : 'director'
    check(result.next_actor === actor, '该节点的人工确认角色不正确', 'next_actor')
    check(result.required_refs.every((ref: string) => input.artifact_refs.includes(ref)), '导演建议引用了未知产物', 'required_refs')
  }
  if (name === 'creative') {
    check(result.concepts.length === input.candidate_count, '候选数量与请求不一致', 'concepts')
    unique(result.concepts, 'concept_key')
    unique(result.concepts, 'title')
    for (const concept of result.concepts) {
      unique(concept.character_goals, 'character_id')
      check(concept.character_goals.length === input.characters.length && concept.character_goals.every((g: any) => input.characters.some((c: any) => c.character_id === g.character_id)), '创意候选缺少有效主角', concept.concept_key)
    }
  }
  if (name === 'writer') validateScript(result, input.characters)
  if (name === 'storyboard') validateStoryboard(result, input.approved_script)
  if (name === 'art') {
    check(result.mode === input.mode, '美术任务模式不匹配', 'mode')
    unique(result.reference_map, 'character_id')
    check(result.reference_map.every((item: any) => input.character_references.some((source: any) => same(source, item))), '参考图映射不属于本次输入', 'reference_map')
  }
  if (name === 'vfx') {
    check(input.capabilities.first_frame && result.first_frame_ref === input.keyframe_ref && (!project || project.assets[result.first_frame_ref]?.kind === 'image'), '首帧必须是本项目已选关键帧', 'first_frame_ref')
    check(result.shot_id === input.approved_shot.shot_id && result.duration_ms === input.approved_shot.duration_ms && input.capabilities.supported_durations_ms.includes(result.duration_ms), '服务商不支持所需镜头时长', 'duration_ms')
    check(result.aspect_ratio === input.aspect_ratio && input.capabilities.aspect_ratios.includes(result.aspect_ratio), '服务商不支持所需画幅', 'aspect_ratio')
    check((!result.reference_assets.length || input.capabilities.character_references) && result.reference_assets.every((ref: string) => input.character_references.some((item: any) => item.asset_ref === ref)), '参考图不在本次输入或模型能力范围内', 'reference_assets')
  }
  if (name === 'post') {
    if (project && input.mode === 'assemble_delivery') {
      const record = project.confirmations[input.language_confirmation_ref]
      const language = project.artifacts[input.language_assets_ref]
      check(record?.step === 5 && record.language === input.target_language && record.artifact_ref === language?.ref &&
        project.active['5:' + input.target_language] === record.ref &&
        project.confirmations[record.upstream]?.artifact_ref === input.cut_ref, '“确认节点 5：语言素材”的语种、素材或画面版本不匹配', 'language_confirmation_ref')
    }
    check(same(result, manifest(input)), '后期清单与输入的固定版本或时间不一致', 'result')
  }
}
