import { active, current, ref, role, slot, type Artifact, type DeliveryReview, type Project } from './store.ts'
import { array, canonical, check, clean, clone, conflict, fixture, id, integer, languages, langKey, now, object } from './common.ts'
import { schema, validateScript, validateStoryboard } from './contracts.ts'
import { sequelBindings } from './episodes.ts'

export const checkpointTypes = ['', 'concept', 'script', 'storyboard', 'cut', 'language', 'delivery']
const checkpointNames = ['', '创意方向', '完整剧情剧本', '分镜脚本与镜头清单', '画面与接镜', '语言素材', '成片交付']
const prefix = (type: string, language?: string | null) => language ? langKey(language) + '_' + (type === 'language' ? 'lang' : type) : type
export const languageOf = (p: Project, value: string) => {
  check(p.languages.includes(value), '项目没有这个目标语种', 'language')
  return value
}
export function notify(p: Project, to: string, from: string, kind: string, ref: string | null, language: string | null = null, note = '') {
  p.notifications.push({ id: id(), to, from, kind, ref, language, note, at: now(), read_at: null, closed_at: null })
}
function close(p: Project, artifact: string) {
  for (const item of p.notifications) if (item.ref === artifact && !item.closed_at) item.closed_at = now()
}
function closeKind(p: Project, kind: string) {
  for (const item of p.notifications) if (item.kind === kind && !item.closed_at) item.closed_at = now()
}
export function invalidate(p: Project, start: number, onlyLang?: string) {
  for (let step = start; step <= 6; step++) {
    for (const lang of step <= 4 ? [null] : onlyLang ? [onlyLang] : p.languages) {
      const item = current(p, checkpointTypes[step], lang)
      delete p.active[slot(String(step), lang)]
      if (!item || (step === 6 && item.status === 'approved')) continue
      item.status = 'needs_recheck'
      close(p, item.ref)
    }
  }
}
function upstream(p: Project, step: number, language?: string | null) {
  return step === 1 ? current(p, 'brief')?.ref : active(p, step - 1, step === 6 ? language : null)?.ref
}
export function requireStep(p: Project, step: number, language?: string | null) {
  const value = active(p, step, language)
  conflict(value, '请先完成确认节点 ' + step + '：' + checkpointNames[step])
  return value
}
export function put(p: Project, actor: string, type: string, data: any, input: string | null, language: string | null = null): Artifact {
  const key = slot(type, language)
  const previous = current(p, type, language)
  if (previous?.status === 'pending_review') { previous.status = 'needs_recheck'; close(p, previous.ref) }
  const artifact: Artifact = { ref: ref(p, prefix(type, language)), type, language, status: 'draft', data, upstream: input, author: actor, at: now() }
  p.current[key] = artifact.ref
  p.artifacts[artifact.ref] = artifact
  return artifact
}
export function addAsset(p: Project, actor: string, metadata: any, base = 'asset') {
  const key = ref(p, base)
  p.assets[key] = { ...metadata, ref: key, author: actor, at: now() }
  return p.assets[key]
}
function langList(values: any) {
  const list = array(values, 'languages')
  check(list.every(lang => languages.includes(lang)) && new Set(list).size === list.length, '语种无效或重复', 'languages')
  return list
}
function brief(p: Project, body: any) {
  const raw = clean(body.raw)
  const source = body.source_ref ? p.assets[body.source_ref] : null
  check(!body.source_ref || source?.kind === 'script', '请选用本项目已解析的剧本文档', 'source_ref')
  const goal = clean(body.goal) || 'series_promotion'
  const target = Number(body.target_duration_ms || 36000)
  check(['series_promotion', 'original_validation'].includes(goal) && integer(target, 1000) && target <= 180000, '创作目标或目标时长无效', 'brief')
  return { raw, source_ref: source?.ref ?? null, source_script: source?.text ?? clean(body.source_script) ?? null, goal,
    theme: body.theme === 'GL' || body.theme === 'BL' ? body.theme : null, premise: raw || source?.text || clean(body.source_script),
    audience: clean(body.audience) || null, hook: clean(body.hook) || null, ending_constraint: clean(body.ending_constraint) || null,
    must_keep: array(body.must_keep ?? [], 'must_keep').map(clean).filter(Boolean), target_duration_ms: target, aspect_ratio: '9:16',
    target_languages: langList(body.target_languages ?? (p.languages.length ? p.languages : ['zh-CN'])), planned_shot_count: integer(body.planned_shot_count, 1) ? body.planned_shot_count : 5,
    due: clean(body.due) || null,
  }
}
function characterCards(data: any) {
  const cards = array(data, 'characters')
  check(cards.length === 2 && new Set(cards.map(c => c?.character_id)).size === 2, '需要两张独立主角卡', 'characters')
  for (const c of cards) check(c && /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(c.character_id) && clean(c.name) && clean(c.description) && clean(c.goal), '请填写角色标识、名字、描述与动机', 'characters')
  return cards.map(({ character_id, name, description, goal }) => ({ character_id, name, description, goal }))
}
function usableCharacterImage(p: Project, asset: any, characterId: string) {
  if (asset?.kind !== 'image') return false
  if (asset.reuse) return asset.reuse.kind === 'character' && asset.reuse.character_id === characterId
  if (asset.character_id) return asset.character_id === characterId
  const sourceJob = asset.job_id ? p.jobs[asset.job_id] : null
  return sourceJob?.plan.task === 'reference' && sourceJob.plan.character_id === characterId
}
function usableShotReference(asset: any, kind: 'location'|'prop', current?: string|null) {
  if (asset?.kind !== 'image') return false
  if (asset.reuse) return asset.reuse.kind === kind
  if (asset.reference_kind) return asset.reference_kind === kind
  return Boolean(current && asset.ref === current && asset.source === 'upload')
}
export function sameShotInputs(p: Project, previousRef: string, boardRef: string, shotId: string) {
  if (previousRef === boardRef) return true
  const previous = p.artifacts[previousRef]?.data
  const currentBoard = p.artifacts[boardRef]?.data
  const a = previous?.shots.find((shot: any) => shot.shot_id === shotId)
  const b = currentBoard?.shots.find((shot: any) => shot.shot_id === shotId)
  if (!a || !b || previous.keyframes[shotId] !== currentBoard.keyframes[shotId]) return false
  const { order: oldOrder, ...oldShot } = a
  const { order: newOrder, ...newShot } = b
  return canonical(oldShot) === canonical(newShot) &&
    canonical(previous.production?.[shotId] ?? {}) === canonical(currentBoard.production?.[shotId] ?? {}) &&
    b.character_ids.every((id: string) => previous.references[id] === currentBoard.references[id])
}
export function fitsBoard(p: Project, asset: any, boardRef: string, shotId: string) {
  return asset?.kind === 'video' && asset.shot_id === shotId && sameShotInputs(p, asset.board_ref, boardRef, shotId)
}
function reviewFitsBoard(p: Project, asset: any, boardRef: string, shotId: string) {
  const review = asset?.human_review
  if (review?.decision !== 'accept' || !fitsBoard(p, asset, boardRef, shotId)) return false
  if (review.board_ref === boardRef) return true
  if (!sameShotInputs(p, review.board_ref, boardRef, shotId)) return false
  const boundaries = (ref: string) => {
    const shots = p.artifacts[ref].data.shots
    const index = shots.findIndex((shot: any) => shot.shot_id === shotId)
    const previous = shots[index - 1], next = shots[index + 1]
    return [previous?.shot_id, previous?.end_state, previous?.continuity, next?.shot_id, next?.start_state, next?.continuity]
  }
  return canonical(boundaries(review.board_ref)) === canonical(boundaries(boardRef))
}
const shotFields = ['purpose', 'scene', 'framing', 'camera', 'start_state', 'action', 'end_state', 'continuity', 'duration_ms']
const keyframeFields = ['scene', 'framing', 'start_state', 'location', 'prop', 'wardrobe', 'layout']
const observationCategories = ['identity', 'wardrobe', 'action', 'continuity', 'prop', 'dialogue', 'emotion', 'other']

function arrangeShots(p: Project, actor: string, body: any) {
  const board = current(p, 'storyboard')
  conflict(board && board.ref === body.board_ref && board.upstream === requireStep(p, 2).ref, '分镜已更新，请刷新后再编排')
  const script = p.artifacts[requireStep(p, 2).artifact_ref].data
  const beats = new Map(script.beats.map((beat: any) => [beat.beat_id, beat]))
  const people = new Set(script.characters.map((person: any) => person.character_id))
  const input = array(body.shots, 'shots')
  check(input.length > 0 && input.length <= 100, '分镜至少保留一个镜头', 'shots')
  const ids = new Set<string>()
  const reserved = new Set(board.data.shots.map((shot: any) => shot.shot_id))
  let nextNumber = board.data.shots.reduce((max: number, shot: any) => {
    const value = /^S(\d+)$/.exec(shot.shot_id)
    return value ? Math.max(max, Number(value[1])) : max
  }, 0) + 1
  const allocate = () => {
    let value = 'S' + String(nextNumber++).padStart(2, '0')
    while (reserved.has(value)) value = 'S' + String(nextNumber++).padStart(2, '0')
    reserved.add(value)
    return value
  }
  const prepared = input.map((raw: any, index: number) => {
    const entry = object(raw, 'shots/' + index)
    let shotId = clean(entry.shot_id)
    if (!shotId) {
      shotId = allocate()
    }
    check(/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(shotId) && !ids.has(shotId), '镜头编号无效或重复', 'shots/' + index + '/shot_id')
    ids.add(shotId)
    const beatIds = array(entry.beat_ids, 'beat_ids')
    const characterIds = array(entry.character_ids, 'character_ids')
    check(beatIds.length > 0 && new Set(beatIds).size === beatIds.length && beatIds.every((id: string) => beats.has(id)), '请为每个镜头选择至少一个有效剧本段落', shotId + '/beat_ids')
    check(new Set(characterIds).size === characterIds.length && characterIds.length <= 2 &&
      characterIds.every((id: string) => people.has(id)), '每个镜头最多选择两位剧本中的出场人物', shotId + '/character_ids')
    const duration = entry.duration_ms
    check(integer(duration, 1), '镜头时长必须大于 0', shotId + '/duration_ms')
    const text = (key: string) => {
      const value = clean(entry[key])
      check(value && value.length <= 4000, '请填写完整的镜头内容', shotId + '/' + key)
      return value
    }
    const dialogue = beatIds.flatMap((id: string) => (beats.get(id) as any).dialogue)
    return {
      shot_id: shotId, order: index + 1, beat_ids: beatIds, purpose: text('purpose'),
      character_ids: characterIds, scene: text('scene'), framing: text('framing'), camera: text('camera'),
      start_state: text('start_state'), action: text('action'), end_state: text('end_state'),
      continuity: text('continuity'), duration_ms: duration, dialogue,
    }
  })
  for (const shot of prepared) {
    const previous = board.data.shots.find((item: any) => item.shot_id === shot.shot_id)
    if (previous && canonical([...previous.character_ids].sort()) === canonical([...shot.character_ids].sort())) {
      shot.character_ids = clone(previous.character_ids)
    }
  }
  const content = { total_duration_ms: prepared.reduce((sum, shot) => sum + shot.duration_ms, 0), shots: prepared }
  validateStoryboard(content, script)
  const before = new Map(board.data.shots.map((shot: any) => [shot.shot_id, shot]))
  const after = new Map(prepared.map((shot: any) => [shot.shot_id, shot]))
  const added = prepared.filter(shot => !before.has(shot.shot_id)).map(shot => shot.shot_id)
  const deleted = board.data.shots.filter((shot: any) => !after.has(shot.shot_id)).map((shot: any) => shot.shot_id)
  const survivingBefore = board.data.shots.filter((shot: any) => after.has(shot.shot_id)).map((shot: any) => shot.shot_id)
  const survivingAfter = prepared.filter(shot => before.has(shot.shot_id)).map(shot => shot.shot_id)
  const reordered = canonical(survivingBefore) === canonical(survivingAfter) ? [] : survivingAfter
  const modified = prepared.filter(shot => {
    const previous = before.get(shot.shot_id)
    if (!previous) return false
    const { order: oldOrder, ...oldContent } = previous
    const { order: newOrder, ...newContent } = shot
    oldContent.character_ids = [...oldContent.character_ids].sort()
    newContent.character_ids = [...newContent.character_ids].sort()
    return canonical(oldContent) !== canonical(newContent)
  }).map(shot => shot.shot_id)
  const keyframesInvalidated = prepared.filter(shot => {
    const previous = before.get(shot.shot_id)
    if (!previous) return true
    if (canonical([...previous.character_ids].sort()) !== canonical([...shot.character_ids].sort())) return true
    return keyframeFields.some(field => Object.hasOwn(previous, field) && canonical(previous[field]) !== canonical(shot[field]))
  }).map(shot => shot.shot_id)
  const videosNeedRegeneration = [...new Set([...added, ...modified])]
  const neighbours = (shots: any[]) => new Set(shots.slice(0, -1).map((shot, index) => shot.shot_id + ':' + shots[index + 1].shot_id))
  const oldNeighbours = neighbours(board.data.shots)
  const newNeighbours = neighbours(prepared)
  const joinsChanged = [...new Set([...oldNeighbours, ...newNeighbours])].filter(pair => oldNeighbours.has(pair) !== newNeighbours.has(pair))
  check(added.length || deleted.length || reordered.length || modified.length, '分镜没有变化', 'shots')

  const keyframes = Object.fromEntries(Object.entries(board.data.keyframes ?? {})
    .filter(([shotId]) => after.has(shotId) && !keyframesInvalidated.includes(shotId)))
  let production = board.data.production
  if (production !== undefined) {
    production = Object.fromEntries(Object.entries(production).flatMap(([shotId, value]: [string, any]) => {
      const shot = after.get(shotId)
      if (!shot) return []
      if (!value?.wardrobe) return [[shotId, clone(value)]]
      const wardrobe = Object.fromEntries(Object.entries(value.wardrobe).filter(([person]) => shot.character_ids.includes(person)))
      const next = clone(value)
      if (Object.keys(wardrobe).length) next.wardrobe = wardrobe
      else delete next.wardrobe
      return [[shotId, next]]
    }))
  }
  const data = { ...clone(board.data), ...content, keyframes, ...(production === undefined ? {} : { production }) }
  const revision = apply(p, actor, 'artifact', { type: 'storyboard', data }) as Artifact
  revision.has_shot_rework = true
  revision.shot_structure_revision = {
    previous_board_ref: board.ref, added, deleted, reordered, modified,
    keyframes_invalidated: keyframesInvalidated, videos_need_regeneration: videosNeedRegeneration, joins_changed: joinsChanged,
  }
  return revision
}

function editShot(p: Project, actor: string, body: any) {
  const board = current(p, 'storyboard')
  conflict(board && board.ref === body.board_ref && board.upstream === requireStep(p, 2).ref, '分镜已更新，请刷新后再修改镜头')
  const data = clone(board.data)
  const shot = data.shots.find((item: any) => item.shot_id === body.shot_id)
  check(shot, '镜头不存在', 'shot_id', 404)
  const changes: Record<string, { before: any, after: any }> = {}
  for (const [field, value] of Object.entries(object(body.changes, 'changes'))) {
    if (field === 'wardrobe') {
      data.production ??= {}
      const references = data.production[shot.shot_id] ??= {}
      const next = { ...references.wardrobe, ...object(value, 'wardrobe') }
      if (canonical(next) !== canonical(references.wardrobe ?? {})) {
        changes[field] = { before: references.wardrobe ?? {}, after: next }
        references.wardrobe = next
      }
      continue
    }
    if (field === 'location' || field === 'prop' || field === 'layout') {
      check(data.production && typeof value === 'string' && p.assets[value]?.kind === 'image', '请选择本项目的参考图', field)
      const references = data.production[shot.shot_id] ??= {}
      if (field === 'layout') check(p.assets[value].reference_kind === 'layout' && p.assets[value].source_location === references.location && p.assets[value].layout_spec?.confirmed, '请选择基于当前场景且已确认的俯视调度图', 'layout')
      else check(usableShotReference(p.assets[value], field, references[field]), '请选择该镜头对应类型的场景或道具图', field)
      if (references[field] !== value) {
        changes[field] = { before: references[field] ?? null, after: value }
        references[field] = value
        if (field === 'location' && references.layout) delete references.layout
      }
      continue
    }
    check(shotFields.includes(field), '此字段请在剧本或分镜中修改', field)
    const next = field === 'duration_ms' ? value : clean(value)
    check(field === 'duration_ms' ? integer(next, 1) : typeof next === 'string' && next.length > 0 && next.length <= 4000, '请填写有效的镜头内容', field)
    if (next !== shot[field]) {
      changes[field] = { before: shot[field], after: next }
      shot[field] = next
    }
  }
  check(Object.keys(changes).length > 0, '镜头内容没有变化', 'changes')
  const observationId = body.observation_id ?? null
  if (observationId !== null) {
    check(Object.values(p.assets).some(asset => asset.kind === 'video' && asset.shot_id === shot.shot_id &&
      asset.observations?.some((observation: any) => observation.id === observationId)), '问题标注不属于此镜头', 'observation_id')
  }
  if (keyframeFields.some(field => Object.hasOwn(changes, field))) delete data.keyframes[shot.shot_id]
  data.total_duration_ms = data.shots.reduce((total: number, item: any) => total + item.duration_ms, 0)
  const revision = apply(p, actor, 'artifact', { type: 'storyboard', data }) as Artifact
  revision.has_shot_rework = true
  revision.shot_revision = { shot_id: shot.shot_id, previous_board_ref: board.ref, changes, observation_id: observationId }
  return revision
}
export function cutFrom(p: Project, data: any) {
  const confirmed = requireStep(p, 3)
  const draft = current(p, 'storyboard')
  conflict(!draft?.has_shot_rework || draft.ref === confirmed.artifact_ref, '请先确认有镜头修改的新版分镜')
  const board = p.artifacts[confirmed.artifact_ref].data
  const order = array(data?.order ?? board.shots.map((shot: any) => shot.shot_id), 'order')
  check(order.length === board.shots.length && new Set(order).size === order.length, '画面顺序必须覆盖本版分镜', 'order')
  const overrides = object(data?.dialogue ?? {}, 'dialogue')
  const trims = object(data?.trims ?? {}, 'trims')
  let start = 0
  const cut = order.map(shotId => {
    const shot = board.shots.find((s: any) => s.shot_id === shotId)
    const video = p.assets[p.selected[shotId]]
    check(shot && fitsBoard(p, video, confirmed.artifact_ref, shotId) && integer(video.duration_ms, 1), shotId + ' 缺少本版分镜对应的可播放视频', shotId)
    const dialogue = shot.dialogue.map((line: any) => {
      const replacement = overrides[line.line_id]
      if (replacement === undefined) return line
      check(clean(replacement), '对白不能为空', shotId + '/' + line.line_id)
      return { ...line, text: clean(replacement) }
    })
    const trim = trims[shotId] ?? {}
    const in_ms = trim.in_ms ?? 0, out_ms = trim.out_ms ?? video.duration_ms
    check(integer(in_ms, 0) && integer(out_ms, in_ms + 1) && out_ms <= video.duration_ms, shotId + ' 入点或出点超出视频范围', shotId)
    const duration_ms = out_ms - in_ms
    const value = { shot_id: shotId, video_ref: video.ref, start_ms: start, duration_ms, dialogue,
      ...(in_ms || out_ms !== video.duration_ms ? { in_ms, out_ms } : {}) }
    start += duration_ms
    return value
  })
  return { cut, duration_ms: start }
}
export function validateLines(p: Project, language: string, cut: any[], lines: any[], requireAudio = true) {
  const source = cut.flatMap(shot => shot.dialogue.map((line: any) => ({ ...line, shot })))
  check(lines.length === source.length && new Set(lines.map(line => line.line_id)).size === lines.length, '对白清单必须覆盖确认的全部对白', 'lines')
  const nativeAudio = lines.every((line: any) => !line.audio_ref) && cut.every((shot: any) =>
    p.assets[shot.video_ref]?.audio && p.assets[shot.video_ref]?.language === language)
  check(!requireAudio || nativeAudio || lines.every((line: any) => line.audio_ref),
    '请先生成并选用该语种的原生对白视频，或逐句补齐后期配音', 'lines')
  for (const line of lines) {
    const original = source.find(item => item.line_id === line.line_id)
    const field = line.shot_id + '/' + line.line_id
    check(original && line.shot_id === original.shot.shot_id && line.speaker_id === original.speaker_id && line.source_text === original.text, '对白或说话人不属于确认的画面', field)
    check(clean(line.target_text) && (language !== 'zh-CN' || line.target_text === original.text), '请校对译文；中文配音沿用确认的源对白', field)
    check(line.subtitle_text === undefined || clean(line.subtitle_text), '字幕不能留空', field)
    if (!requireAudio) continue
    const { start_ms, duration_ms } = original.shot
    if (nativeAudio) {
      check(integer(line.subtitle_start_ms, start_ms) && integer(line.subtitle_end_ms, line.subtitle_start_ms + 1) && line.subtitle_end_ms <= start_ms + duration_ms, '字幕时间轴超出镜头', field)
      continue
    }
    const audio = p.assets[line.audio_ref]
    check(audio?.kind === 'audio' && integer(audio.duration_ms, 1) && (!audio.language || audio.language === language) &&
      (!audio.text || audio.text === line.target_text) && (audio.source !== 'upload' || language === 'th'), '配音缺失或已与文本版本不一致', field)
    check(line.audio_duration_ms === audio.duration_ms && integer(line.audio_start_ms, start_ms) && line.audio_start_ms + audio.duration_ms <= start_ms + duration_ms, '配音超出镜头时长', field)
    check(integer(line.subtitle_start_ms, start_ms) && integer(line.subtitle_end_ms, line.subtitle_start_ms + 1) && line.subtitle_end_ms <= start_ms + duration_ms &&
      line.subtitle_start_ms <= line.audio_start_ms + 400 && line.subtitle_end_ms >= line.audio_start_ms + audio.duration_ms - 400, '字幕与配音时序不匹配', field)
  }
}
export function languageCut(p: Project, language: string, cut: any[]) {
  if (language === 'zh-CN') return cut
  const selected = p.localized_selected?.[language] ?? {}
  const boardRef = active(p, 3)?.artifact_ref
  return cut.map((shot: any) => {
    const video = p.assets[selected[shot.shot_id]]
    check(video?.kind === 'video' && video.language === language && video.shot_id === shot.shot_id,
      shot.shot_id + ' 尚未选用' + language + '原生对白视频', shot.shot_id)
    check(boardRef && fitsBoard(p, video, boardRef, shot.shot_id), shot.shot_id + ' 的' + language + '视频基于旧分镜，请重新生成', shot.shot_id)
    return { ...shot, video_ref: video.ref }
  })
}
function reviewDelivery(p: Project, item: Artifact, actor: string, body: any): DeliveryReview {
  const fileRef = item.data.file_ref
  const file = p.assets[fileRef]
  conflict(body.file_ref === fileRef, '待验收的成片文件已变化，请刷新后重新看片')
  check(file?.kind === 'delivery' && item.data.language_confirmation_ref === item.upstream, '缺少有效合成文件', 'delivery')
  const note = clean(body.note)
  check(note.length <= 2000, '审核意见不能超过 2000 字', 'note')
  if (body.decision === 'approve') check(body.content_checked === true, '请先看片并确认内容可交付', 'content_checked')
  else check(note, '退回须填写意见', 'note')
  let range = null
  if (body.decision === 'return' && (body.start_ms != null || body.end_ms != null)) {
    const { start_ms, end_ms } = body
    check(integer(start_ms, 0) && integer(end_ms, start_ms + 1) && end_ms <= file.duration_ms,
      '问题时间段必须在成片时长内', 'range')
    range = { start_ms, end_ms }
  }
  return { decision: body.decision, file_ref: fileRef, sha256: file.sha256 ?? null, actor, at: now(), note, range }
}
export function apply(p: Project, actor: string, action: string, body: any) {
  const actorRole = role(p, actor)
  if (action === 'brief.save' || action === 'brief.submit') {
    role(p, actor, 'operations')
    const next = brief(p, body.data ?? p.brief)
    if (action === 'brief.save') { p.brief = next; return put(p, actor, 'brief_draft', next, null) }
    check(next.premise, '请填写想法或上传可读剧本', 'brief')
    check(next.theme === 'BL' || next.theme === 'GL', '请选择故事关系', 'theme')
    check(next.target_languages.length > 0, '请至少选择一种交付语种', 'target_languages')
    const previous = current(p, 'brief')
    if (previous && canonical(previous.data) === canonical(next)) return previous
    invalidate(p, 1)
    closeKind(p, 'brief_submitted')
    p.brief = next
    p.languages = [...new Set([...p.languages, ...next.target_languages])]
    const submitted = put(p, actor, 'brief', next, null)
    submitted.status = 'approved'
    if (p.episode) put(p, actor, 'characters', clone(current(p, 'characters')?.data ?? p.episode.characters), submitted.ref)
    notify(p, p.members.director, actor, 'brief_submitted', submitted.ref)
    return submitted
  }
  if (action === 'languages') {
    role(p, actor, 'operations')
    conflict(current(p, 'brief'), '请先提交 Brief，再追加语种')
    const list = langList(body.languages)
    check(list.length > 0, '请选择要追加的语种', 'languages')
    p.languages = [...new Set([...p.languages, ...list])]
    if (p.languages.length) closeKind(p, 'select_languages')
    return p.languages
  }
  if (action === 'read') {
    const item = p.notifications.find(item => item.id === body.id && item.to === actor)
    check(item, '通知不存在', 'id', 404)
    item.read_at ??= now()
    return item
  }
  if (action === 'join.review') {
    role(p, actor, 'director')
    const board = p.artifacts[requireStep(p, 3).artifact_ref]
    const cut = current(p, 'cut')
    conflict(cut?.status === 'draft' && cut.ref === body.cut_ref && cut.upstream === active(p, 3)?.ref, '请先保存当前画面基准')
    const index = cut.data.cut.findIndex((shot: any) => shot.shot_id === body.shot_id)
    const left = cut.data.cut[index], right = cut.data.cut[index + 1]
    check(left && right && right.shot_id === body.next_shot_id, '请选择相邻镜头', 'shot_id')
    conflict(left.video_ref === body.left_ref && right.video_ref === body.right_ref &&
      body.left_out_ms === (left.out_ms ?? p.assets[left.video_ref].duration_ms) &&
      body.right_in_ms === (right.in_ms ?? 0), '镜头版本或切点已变化，请刷新')
    check(['accept', 'reject'].includes(body.decision) && clean(body.note), '请填写接镜结论', 'note')
    const review = { left_id: left.shot_id, right_id: right.shot_id, left_ref: left.video_ref, right_ref: right.video_ref,
      left_out_ms: body.left_out_ms, right_in_ms: body.right_in_ms, decision: body.decision, note: clean(body.note),
      board_ref: board.ref, actor, at: now() }
    p.join_reviews ??= {}
    p.join_reviews[left.shot_id + ':' + right.shot_id] = review
    return review
  }
  if (action === 'feedback') {
    role(p, actor, 'owner')
    const note = clean(body.note)
    check(note && (!body.ref || p.artifacts[body.ref]), '需要意见和有效的产物引用', 'note')
    const item = { actor, note, ref: body.ref ?? null, at: now() }
    p.feedback.push(item)
    notify(p, p.members.director, actor, 'owner_feedback', item.ref, null, note)
    if (p.members.operations !== p.members.director) notify(p, p.members.operations, actor, 'owner_feedback', item.ref, null, note)
    return item
  }
  if (action === 'restore') {
    role(p, actor, 'director')
    const source = p.artifacts[body.ref]
    check(source, '历史版本不存在', 'ref', 404)
    check(['concept','script','storyboard','cut','language','delivery'].includes(source.type), '这个版本暂不支持恢复', 'ref')
    check(current(p, source.type, source.language)?.ref !== source.ref, '这已经是当前版本', 'ref')
    if (source.type === 'concept') {
      const brief = current(p, 'brief')
      check(brief?.ref === source.upstream, '旧创意基于已变化的需求，请重新生成', 'ref')
      schema('creative', 'output', { status:'ok', result:source.data, issues:[] })
      if (active(p, 1)) invalidate(p, 1)
      return put(p, actor, 'concept', clone(source.data), brief!.ref)
    }
    if (source.type === 'script') {
      const first = requireStep(p, 1)
      check(first.ref === source.upstream, '旧剧本基于已变化的创意，请重新生成', 'ref')
      validateScript(source.data)
      if (active(p, 2)) invalidate(p, 2)
      return put(p, actor, 'script', clone(source.data), first.ref)
    }
    if (source.type === 'storyboard') {
      const script = requireStep(p, 2)
      check(script.ref === source.upstream, '旧分镜基于已变化的剧本，请重新生成', 'ref')
      const { keyframes = {}, references = {}, production, join_checks, ...content } = clone(source.data)
      schema('storyboard', 'output', { status:'ok', result:content, issues:[] })
      validateStoryboard(content, p.artifacts[script.artifact_ref].data)
      if (active(p, 3)) invalidate(p, 3)
      const restored = put(p, actor, 'storyboard', { ...content, keyframes, references, ...(production === undefined ? {} : { production }), ...(join_checks ? { join_checks:true } : {}) }, script.ref)
      restored.has_shot_rework = true
      return restored
    }
    if (source.type === 'cut') {
      const board = requireStep(p, 3)
      check(board.ref === source.upstream, '旧画面基准基于已变化的分镜，请重新生成', 'ref')
      const cut = cutFrom(p, source.data.options)
      if (active(p, 4)) invalidate(p, 4)
      return put(p, actor, 'cut', { ...cut, options:clone(source.data.options) }, board.ref)
    }
    if (source.type === 'language') {
      const lang = languageOf(p, source.language)
      const cut = requireStep(p, 4)
      check(cut.ref === source.upstream, '旧语言素材基于已变化的画面基准，请重新生成', 'ref')
      validateLines(p, lang, p.artifacts[cut.artifact_ref].data.cut, source.data.lines)
      if (active(p, 5, lang)) invalidate(p, 5, lang)
      return put(p, actor, 'language', clone(source.data), cut.ref, lang)
    }
    const lang = languageOf(p, source.language)
    const check5 = requireStep(p, 5, lang)
    check(check5.ref === source.upstream && source.data.language_confirmation_ref === source.upstream, '旧成片基于已变化的语言确认，请重新合成', 'ref')
    check(p.assets[source.data.file_ref]?.kind === 'delivery', '旧成片文件已不可用', 'file_ref')
    if (active(p, 6, lang)) invalidate(p, 6, lang)
    return put(p, actor, 'delivery', clone(source.data), check5.ref, lang)
  }
  if (action === 'submit' || action === 'decide') {
    const item = p.artifacts[body.ref]
    check(item, '产物版本不存在', 'ref', 404)
    const step = checkpointTypes.indexOf(item.type)
    const lang = item.language
    const deliveryReviewer = p.members.reviewer ?? p.members.operations
    check(step > 0 && (body.step === undefined || step === body.step), '确认节点与产物不匹配', 'step')
    if (action === 'submit') role(p, actor, 'director')
    else role(p, actor, step === 6 ? (p.members.reviewer ? 'reviewer' : 'operations') : [1, 2].includes(step) ? 'operations' : 'director')
    const dependency = upstream(p, step, lang)
    conflict(current(p, item.type, lang)?.ref === item.ref && dependency && item.upstream === dependency && (!Object.hasOwn(body, 'upstream') || body.upstream === dependency), '该版本已被替换或上游已变化')
    if (action === 'submit') {
      check([1, 2, 6].includes(step), '编导内部确认可直接处理', 'step')
      conflict(item.status === 'draft', '只可提交当前草稿')
      if (step === 6) check(p.assets[item.data.file_ref]?.kind === 'delivery' && item.data.language_confirmation_ref === dependency, '缺少有效合成文件', 'delivery')
      if (step === 1) closeKind(p, 'brief_submitted')
      item.status = 'pending_review'
      notify(p, step === 6 ? deliveryReviewer : p.members.operations, actor, 'review', item.ref, lang)
      return item
    }
    conflict(item.status === ([1, 2, 6].includes(step) ? 'pending_review' : 'draft'), '该版本当前不可确认')
    check(['approve', 'return'].includes(body.decision), '决定无效', 'decision')
    const deliveryReview = step === 6 ? reviewDelivery(p, item, actor, body) : null
    if (deliveryReview) item.delivery_review = deliveryReview
    if (body.decision === 'return') {
      check((actorRole === 'operations' || (step === 6 && actorRole === 'reviewer')) && clean(body.note), '退回须填写意见', 'note')
      item.status = 'returned'
      item.note = clean(body.note)
      close(p, item.ref)
      notify(p, p.members.director, actor, 'returned', item.ref, lang, item.note)
      return item
    }
    let chosen: string | null = null
    if (step === 1) {
      check(item.data.concepts.some((concept: any) => concept.concept_key === body.candidate), '请指定有效创意候选', 'candidate')
      chosen = body.candidate
    }
    if (step === 3) {
      for (const c of p.artifacts[active(p, 2).artifact_ref].data.characters) {
        const image = p.assets[item.data.references[c.character_id]]
        check(image?.kind === 'image', '缺少角色参考图', c.character_id)
      }
      for (const shot of item.data.shots) {
        check(p.assets[item.data.keyframes[shot.shot_id]]?.kind === 'image', shot.shot_id + ' 缺少关键帧', shot.shot_id)
        if (item.data.production) check(p.assets[item.data.production[shot.shot_id]?.location]?.kind === 'image', shot.shot_id + ' 缺少场景参考', shot.shot_id)
        if (p.episode) check(shot.character_ids.every((key: string) =>
          p.wardrobes?.[item.data.production?.[shot.shot_id]?.wardrobe?.[key]]?.character_id === key),
        shot.shot_id + ' 缺少服装版本', shot.shot_id)
      }
    }
    if (step === 4) {
      const checked = cutFrom(p, item.data.options)
      conflict(canonical(checked.cut) === canonical(item.data.cut), '当前镜头选版已更新，请重新保存画面基准')
      const board = p.artifacts[requireStep(p, 3).artifact_ref]
      if (board.data.production) {
        check(item.data.preview_ref && p.assets[item.data.preview_ref]?.kind === 'delivery', '请生成并检查当前剪辑预览', 'preview')
        for (const shot of checked.cut) {
          check(reviewFitsBoard(p, p.assets[shot.video_ref], board.ref, shot.shot_id), shot.shot_id + ' 缺少与当前分镜承接一致的人工通过记录', shot.shot_id)
        }
      }
      if (board.data.join_checks) {
        check(item.data.preview_ref && p.assets[item.data.preview_ref]?.kind === 'delivery', '请生成并检查当前剪辑预览', 'preview')
        for (let i = 0; i < checked.cut.length - 1; i++) {
          const left = checked.cut[i], right = checked.cut[i + 1]
          const review = p.join_reviews?.[left.shot_id + ':' + right.shot_id]
          check(review?.decision === 'accept' && review.board_ref === board.ref && review.left_ref === left.video_ref && review.right_ref === right.video_ref &&
            review.left_out_ms === (left.out_ms ?? p.assets[left.video_ref].duration_ms) && review.right_in_ms === (right.in_ms ?? 0),
          left.shot_id + ' → ' + right.shot_id + ' 缺少当前切点的通过记录', 'join')
        }
      }
    }
    if (step === 5) {
      const cut = p.artifacts[active(p, 4).artifact_ref]
      validateLines(p, lang!, languageCut(p, lang!, cut.data.cut), item.data.lines)
      check(item.data.preview_ref && p.assets[item.data.preview_ref]?.kind === 'delivery', '请先生成当前版本的同步预览', 'preview')
    }
    if (step === 3) {
      for (const [shotId, assetRef] of Object.entries(p.selected)) {
        if (!fitsBoard(p, p.assets[assetRef], item.ref, shotId)) delete p.selected[shotId]
      }
    }
    if (step < 6) invalidate(p, step + 1, step === 5 ? lang! : undefined)
    const record = { ref: ref(p, prefix('check' + step, lang)), step, language: lang, artifact_ref: item.ref,
      upstream: dependency, actor, at: now(), candidate: chosen,
      ...(deliveryReview ? { file_ref: deliveryReview.file_ref, delivery_review: deliveryReview } : {}),
      ...(step === 4 && (p.artifacts[active(p, 3).artifact_ref].data.production || p.artifacts[active(p, 3).artifact_ref].data.join_checks) ? {
        preview_ref: item.data.preview_ref,
        ...(p.artifacts[active(p, 3).artifact_ref].data.production ? { shot_reviews: item.data.cut.map((shot: any) => ({ shot_id: shot.shot_id, video_ref: shot.video_ref, ...p.assets[shot.video_ref].human_review })) } : {}),
        ...(p.artifacts[active(p, 3).artifact_ref].data.join_checks ? { join_reviews: item.data.cut.slice(0, -1).map((shot: any, i: number) =>
          clone(p.join_reviews?.[shot.shot_id + ':' + item.data.cut[i + 1].shot_id])) } : {}),
      } : {}),
    }
    p.confirmations[record.ref] = record
    p.active[slot(String(step), lang)] = record.ref
    item.status = 'approved'
    close(p, item.ref)
    if (actorRole === 'operations') notify(p, p.members.director, actor, 'approved', item.ref, lang)
    if (step === 6 && actorRole === 'reviewer') {
      notify(p, p.members.operations, actor, 'approved', item.ref, lang)
      notify(p, p.members.director, actor, 'approved', item.ref, lang)
    }
    if (step === 4 && !p.languages.length) notify(p, p.members.operations, actor, 'select_languages', item.ref)
    return record
  }
  role(p, actor, 'director')
  if (action === 'characters') {
    const submitted = current(p, 'brief')
    conflict(submitted, '请先提交 Brief')
    return put(p, actor, 'characters', characterCards(body.data), submitted.ref)
  }
  if (action === 'storyboard.arrange') return arrangeShots(p, actor, body)
  if (action === 'character.reference') {
    const board = current(p, 'storyboard')
    conflict(board && board.ref === body.board_ref, '分镜已更新，请刷新后再修改角色参考')
    const character = body.character_id
    const asset = p.assets[body.ref]
    check(usableCharacterImage(p, asset, character), '请选择对应角色的参考图', 'ref')
    const data = clone(board.data)
    if (data.references[character] === body.ref) return board
    data.references[character] = body.ref
    for (const shot of data.shots) if (shot.character_ids.includes(character)) delete data.keyframes[shot.shot_id]
    const result = apply(p, actor, 'artifact', { type: 'storyboard', data }) as Artifact
    result.has_shot_rework = true
    return result
  }
  if (action === 'shot.edit') return editShot(p, actor, body)
  if (action === 'wardrobe') {
    const description = clean(body.description)
    check(description && description.length <= 1000, '请输入服装描述', 'description')
    const board = current(p, 'storyboard')
    const shot = board?.data.shots.find((item: any) => item.shot_id === body.shot_id)
    check(shot?.character_ids.includes(body.character_id), '该角色不在此镜中', 'character_id')
    const wardrobe = ref(p, body.character_id + '_wardrobe')
    const versions = p.wardrobes ??= {}
    versions[wardrobe] = { ref: wardrobe, character_id: body.character_id, description }
    return editShot(p, actor, { ...body, changes: { wardrobe: { [body.character_id]: wardrobe } } })
  }
  if (action === 'shot.observe') {
    const asset = p.assets[body.ref]
    check(asset?.kind === 'video' && asset.shot_id === body.shot_id, '请选择此镜头的视频候选', 'ref', 404)
    const { start_ms, end_ms, category } = body
    const expected = clean(body.expected), actual = clean(body.actual)
    check(integer(start_ms, 0) && integer(end_ms, start_ms + 1) && end_ms <= asset.duration_ms, '标注时间必须在候选时长内', 'time')
    check(observationCategories.includes(category) && expected && actual && expected.length <= 2000 && actual.length <= 2000, '请选择问题类型并填写预期和实际表现', 'observation')
    const entry = { id: id(), category, start_ms, end_ms, expected, actual, actor, at: now() }
    const observations = asset.observations ??= []
    observations.push(entry)
    return entry
  }
  if (action === 'select') {
    const board = requireStep(p, 3)
    const candidate = p.assets[body.ref]
    const selectedLanguage = clean(body.language) || null
    const selectedLanguageArtifact = selectedLanguage ? current(p, 'language', selectedLanguage) : null
    if (selectedLanguage) {
      languageOf(p, selectedLanguage)
      const check4 = requireStep(p, 4)
      check(selectedLanguageArtifact?.upstream === check4.ref, '请先保存该语种的对白稿', 'language')
      check(candidate?.language === selectedLanguage, '候选不属于当前目标语种', 'ref')
    }
    check(fitsBoard(p, candidate, board.artifact_ref, body.shot_id), '候选不属于本版镜头', 'ref')
    if (p.artifacts[board.artifact_ref].data.production) {
      const note = clean(body.note)
      check((body.decision === 'accept' || body.decision === 'reject') && note, '看片后填写人工结论及理由', 'note')
      check(!active(p, 4) || selectedLanguage || p.selected[body.shot_id] !== body.ref || body.decision === 'accept', '请先保存新的画面基准再变更已确认选版', 'ref')
      candidate.human_review = { decision: body.decision, note, actor, at: now(), board_ref: board.artifact_ref }
      if (body.decision === 'reject') {
        const currentSelected = selectedLanguage ? p.localized_selected?.[selectedLanguage]?.[body.shot_id] : p.selected[body.shot_id]
        if (currentSelected === body.ref) {
          if (selectedLanguage) delete p.localized_selected![selectedLanguage][body.shot_id]
          else delete p.selected[body.shot_id]
          if (selectedLanguage) {
            delete p.active['5:' + selectedLanguage]
            delete p.active['6:' + selectedLanguage]
            if (selectedLanguageArtifact) { delete selectedLanguageArtifact.data.preview_ref; selectedLanguageArtifact.status = 'draft' }
          } else invalidate(p, 4)
        }
        return candidate
      }
    }
    if (selectedLanguage) {
      p.localized_selected ??= {}
      p.localized_selected[selectedLanguage] ??= {}
      if (p.localized_selected[selectedLanguage][body.shot_id] !== body.ref) {
        p.localized_selected[selectedLanguage][body.shot_id] = body.ref
        delete p.active['5:' + selectedLanguage]
        delete p.active['6:' + selectedLanguage]
        if (selectedLanguageArtifact) { delete selectedLanguageArtifact.data.preview_ref; selectedLanguageArtifact.status = 'draft' }
      }
    } else if (p.selected[body.shot_id] !== body.ref) {
      p.selected[body.shot_id] = body.ref
      invalidate(p, 4)
    }
    return candidate
  }
  if (action === 'artifact') {
    const data = object(body.data)
    const type = body.type
    if (type === 'concept') {
      const previous = current(p, 'concept')
      conflict(previous && ['draft', 'returned'].includes(previous.status), '只有草稿或退回的创意可以编辑')
      conflict(previous.upstream === current(p, 'brief')?.ref, '需求已变更，请重新生成创意')
      schema('creative', 'output', { status: 'ok', result: data, issues: [] })
      const characters = current(p, 'characters')?.data ?? []
      check(new Set(data.concepts.map((c: any) => c.concept_key)).size === data.concepts.length && new Set(data.concepts.map((c: any) => c.title)).size === data.concepts.length, '创意方向的标识和标题不能重复', 'concepts')
      for (const c of data.concepts) check(c.character_goals.length === characters.length && new Set(c.character_goals.map((g: any) => g.character_id)).size === characters.length && c.character_goals.every((g: any) => characters.some((person: any) => person.character_id === g.character_id)), '创意方向中的人物与角色卡不一致', 'concepts')
      return put(p, actor, type, data, previous.upstream)
    }
    if (type === 'script') {
      requireStep(p, 1)
      schema('writer', 'output', { status: 'ok', result: data, issues: [] })
      validateScript(data)
      if (body.rework === 'story') invalidate(p, 2)
      return put(p, actor, type, data, upstream(p, 2))
    }
    if (type === 'storyboard') {
      const script = requireStep(p, 2)
      const { keyframes = {}, references: suppliedReferences, production: suppliedProduction, join_checks, ...content } = data
      schema('storyboard', 'output', { status: 'ok', result: content, issues: [] })
      validateStoryboard(content, p.artifacts[script.artifact_ref].data)
      const inherited = sequelBindings(p, content.shots, p.artifacts[script.artifact_ref].data.characters)
      const references = suppliedReferences ?? inherited?.references ?? {}
      const production = suppliedProduction ?? inherited?.production
      for (const [key, value] of Object.entries(object(keyframes))) check(content.shots.some((shot: any) => shot.shot_id === key) && p.assets[String(value)]?.kind === 'image', '镜头关键帧引用无效', key)
      const previous = current(p, 'storyboard')
      for (const [key, value] of Object.entries(object(references))) check(p.artifacts[script.artifact_ref].data.characters.some((c: any) => c.character_id === key) && usableCharacterImage(p, p.assets[String(value)], key), '角色参考图引用无效', key)
      check(!previous?.data.production || production, '已启用制作质检的分镜须保留制作资料', 'production')
      const bound: Record<string, any> = {}
      if (production !== undefined) {
        for (const [shotId, value] of Object.entries(object(production))) {
          check(content.shots.some((shot: any) => shot.shot_id === shotId), '参考图必须绑定本版镜头', shotId)
          const entry = object(value)
          bound[shotId] = {}
          for (const kind of ['location', 'prop']) {
            if (!entry[kind]) continue
            const asset = p.assets[entry[kind]]
            const existing = previous?.data.production?.[shotId]?.[kind]
            check(usableShotReference(asset, kind, existing), '请选择对应类型的项目参考图', kind)
            bound[shotId][kind] = entry[kind]
          }
          if (entry.layout) {
            const asset=p.assets[entry.layout]
            check(asset?.kind === 'image' && asset.reference_kind === 'layout' && asset.source_location === entry.location && asset.layout_spec?.confirmed, '调度图必须基于当前场景并经确认', 'layout')
            bound[shotId].layout=entry.layout
          }
          if (entry.wardrobe !== undefined) {
            const shot = content.shots.find((item: any) => item.shot_id === shotId)
            const wardrobe = object(entry.wardrobe, 'wardrobe')
            for (const [id, version] of Object.entries(wardrobe)) {
              check(shot.character_ids.includes(id) && p.wardrobes?.[String(version)]?.character_id === id, '服装版本必须属于此镜角色', 'wardrobe')
            }
            bound[shotId].wardrobe = wardrobe
          }
        }
      }
      check(join_checks === undefined || typeof join_checks === 'boolean', '接镜检查设置无效', 'join_checks')
      const saved = put(p, actor, type, { ...content, keyframes, references, ...(production === undefined ? {} : { production: bound }),
        ...(join_checks ? { join_checks: true } : {}) }, script.ref)
      if (previous?.status === 'draft' && previous.has_shot_rework) saved.has_shot_rework = true
      return saved
    }
    if (type === 'cut') {
      if (body.rework === 'story') {
        const previous = current(p, 'script')
        requireStep(p, 1)
        invalidate(p, 2)
        const script = clone(previous.data)
        for (const beat of script.beats) for (const line of beat.dialogue) if (data.dialogue?.[line.line_id]) line.text = clean(data.dialogue[line.line_id])
        validateScript(script)
        return put(p, actor, 'script', script, upstream(p, 2))
      }
      const options = { order: data.order ?? null, dialogue: data.dialogue ?? {}, ...(data.trims ? { trims: data.trims } : {}) }
      const cut = cutFrom(p, options)
      invalidate(p, 4)
      return put(p, actor, type, { ...cut, options }, upstream(p, 4))
    }
    if (type === 'language') {
      const lang = languageOf(p, body.language)
      const cut = requireStep(p, 4)
      const lines = array(data.lines, 'lines')
      validateLines(p, lang, p.artifacts[cut.artifact_ref].data.cut, lines, false)
      invalidate(p, 5, lang)
      return put(p, actor, type, { lines, reviewed: data.reviewed === true }, cut.ref, lang)
    }
  }
  check(false, '未知操作', 'action', 404)
}
