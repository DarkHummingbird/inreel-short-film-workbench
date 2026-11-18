import { active, current, role, type Project, type Store } from './store.ts'
import { canonical, check, clean, clone, conflict, fixture, hash, id, integer, langKey, now } from './common.ts'
import { contracts, manifest, schema, validateAgent } from './contracts.ts'
import { addAsset, buildDeliveryManifest, fitsBoard, languageOf, put, requireStep, sameShotInputs, validateLines } from './workflow.ts'
import { dashscope, dashscopeConfig, providerConfigStatus, realEnabled, speechModelFor, UnknownProviderResult, validateConfig, voiceFor, wanCapabilities } from './dashscope.ts'
import { cropVideoRight, mockImage, mockMusic, mockSpeech, mockVideo, render, renderSceneLayout } from './media.ts'
import { composeSkillPrompt, productionSkill } from './production-skills.ts'
import { sequelBindings, wardrobeDescriptions } from './episodes.ts'

const ok = (result: any, issues = []) => ({ status: 'ok', result, issues })
const source = (kind: string, ref: string) => ({ kind, ref })
const settings = (brief: any) => {
  const { goal, theme, premise, audience, hook, ending_constraint, must_keep, target_duration_ms, aspect_ratio, target_languages } = brief
  return { goal, theme, premise, audience, hook, ending_constraint, must_keep, target_duration_ms, aspect_ratio, target_languages }
}
const sum = (shots: any[]) => shots.reduce((total, shot) => total + shot.duration_ms, 0)
const findLine = (cut: any[], id: string) => cut.find(shot => shot.dialogue.some((line: any) => line.line_id === id))
const simpleMode = new Set(['reference', 'keyframe', 'repaint', 'location_reference', 'prop_reference', 'location_view', 'blocking_plan', 'layout_render', 'video', 'crop', 'translate', 'dubbing', 'preview', 'assemble', 'music', 'rough'])
const via: Record<string, string> = { reference: 'art', keyframe: 'art', repaint: 'art', location_reference: 'art', prop_reference: 'art', location_view: 'art', blocking_plan: 'art', video: 'vfx', preview: 'post', assemble: 'post' }
const imageTasks = new Set(['reference', 'keyframe', 'repaint', 'location_reference', 'prop_reference', 'location_view', 'blocking_plan'])
const mediaKindFor = (task: string) => task === 'video' ? 'video' : imageTasks.has(task) ? 'image' : null

export function canQueryOriginal(job: any) {
  if (job.config?.adapter !== 'dashscope') return job.scenario === 'timeout'
  return Boolean((mediaKindFor(job.plan.task) && job.provider_job_id) || job.provider_receipts?.speech?.result_url)
}
function shotAssets(p: Project, board: any, shot: any) {
  const bindings = board.data.production?.[shot.shot_id] ?? {}
  const { location, prop, layout } = bindings
  const wardrobe = wardrobeDescriptions(p, bindings)
  return { references: { ...(location ? { location } : {}), ...(prop ? { prop } : {}) }, ...(layout ? { layout: {ref:layout,geometry:p.assets[layout]?.layout_spec} } : {}), ...(wardrobe.length ? { wardrobe } : {}) }
}
const outputTypes: Record<string, string> = { creative: 'concept', writer: 'script', storyboard: 'storyboard' }
const mockDurations = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000]
const directorCheckpoints: Record<string, number> = { brief:1, concept:1, script:2, storyboard:3, cut:4, language:5, delivery:6 }
const directorJobLabels: Record<string, string> = { producer:'制片整理', creative:'创意策划', writer:'编剧', storyboard:'分镜', reference:'角色参考', location_reference:'场景参考', prop_reference:'道具参考', location_view:'场景新视角', blocking_plan:'调度示意', layout_render:'俯视布局', keyframe:'关键帧', repaint:'关键帧局部重绘', video:'镜头生成', quality:'历史质检（已停用）', content_review:'历史内容审核（已停用）', translate:'翻译', dubbing:'配音', preview:'同步预览', assemble:'成片合成' }
function directorBlockers(p: Project, target: any) {
  const blockers: any[] = []
  const jobs = Object.values(p.jobs).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
  const latest = new Map<string, any>()
  for (const job of jobs) latest.set([job.plan.task,job.plan.shot_id,job.plan.language,job.plan.line?.line_id].join('|'), job)
  const pending = jobs.filter(job => !['quality','content_review'].includes(job.plan.task) &&
    (['queued','running','awaiting_query'].includes(job.state) ||
      (job.state === 'failed' && latest.get([job.plan.task,job.plan.shot_id,job.plan.language,job.plan.line?.line_id].join('|'))?.id === job.id)))
  for (const job of pending.slice(-12)) {
    blockers.push({
      code: job.state === 'awaiting_query' ? 'unverifiable' : 'manual_review',
      message: `${directorJobLabels[job.plan.task] ?? job.plan.task}${job.plan.shot_id ? ' ' + job.plan.shot_id : ''}：${
        job.state === 'awaiting_query' ? '结果未知，需先查询原任务' :
        job.state === 'failed' ? '任务失败，可使用已保存输入决定是否重试' : '任务仍在处理中'
      }`,
      field: null, shot_id: job.plan.shot_id ?? null,
    })
  }
  if (current(p, target.type, target.language)?.ref !== target.ref) blockers.push({ code:'invalid_reference', message:'当前选择的是历史版本，建议前必须先确认是否恢复为草稿', field:'ref', shot_id:null })
  if (target.type === 'concept') blockers.push({ code:'manual_review', message:'创意方向需要运营选择后才能进入剧本', field:'concept', shot_id:null })
  if (target.type === 'script') blockers.push({ code:'manual_review', message:'剧本需要运营确认后才能进入分镜', field:'script', shot_id:null })
  if (target.type === 'storyboard') {
    for (const shot of target.data.shots ?? []) if (!p.assets[target.data.keyframes?.[shot.shot_id]]) blockers.push({ code:'missing_input', message:shot.shot_id+' 缺少已选关键帧', field:'keyframes', shot_id:shot.shot_id })
  }
  if (target.type === 'cut') {
    const board = p.artifacts[active(p, 3)?.artifact_ref]
    for (const shot of board?.data.shots ?? []) if (!p.selected[shot.shot_id]) blockers.push({ code:'missing_input', message:shot.shot_id+' 尚未选择可播放视频', field:'selected', shot_id:shot.shot_id })
    if (!target.data.preview_ref) blockers.push({ code:'missing_input', message:'尚未生成当前画面基准的拼接预览', field:'preview_ref', shot_id:null })
  }
  if (target.type === 'language') {
    const lines = target.data.lines ?? []
    for (const line of lines) if (!line.audio_ref) blockers.push({ code:'missing_input', message:line.line_id+' 缺少该语种配音', field:'audio_ref', shot_id:line.shot_id })
    if (!target.data.preview_ref) blockers.push({ code:'missing_input', message:'尚未生成该语种同步预览', field:'preview_ref', shot_id:null })
  }
  if (target.type === 'delivery') {
    if (target.status === 'pending_review') blockers.push({ code:'manual_review', message:'文件正在等待运营看片验收' + (p.members.reviewer ? '（历史项目由兼容审核账号处理）' : ''), field:'status', shot_id:null })
    if (target.status === 'returned') blockers.push({ code:'manual_review', message:'该成片已退回，请先根据验收意见合成新版本', field:'status', shot_id:null })
    if (!p.assets[target.data.file_ref]) blockers.push({ code:'missing_input', message:'交付文件不可用', field:'file_ref', shot_id:null })
  }
  return blockers.slice(0, 20)
}
function context(p: Project, body: any) {
  const task = body.task
  check(Object.hasOwn(contracts, task) || simpleMode.has(task), '未知任务', 'task')
  const brief = current(p, 'brief')
  const lang = body.language == null ? null : languageOf(p, body.language)
  const agent = via[task] ?? (Object.hasOwn(contracts, task) ? task : null)
  const args: any = { task, language: lang, agent, context: {}, input: null }
  const task_request = clean(body.task_request) || null
  const set = (data: any, sources: any[]) => { args.input = { project_id: p.id, sources, task_request, ...data } }
  const bind = (kind: string, ref: string) => { args.context[kind] = ref }
  if (brief) bind('brief', brief.ref)
  const common = brief ? settings({ ...brief.data, target_languages: p.languages }) : null
  if (task === 'music') return args
  if (task === 'producer') {
    const draftArtifact = current(p, 'brief_draft')
    const draft = draftArtifact?.data ?? brief?.data ?? p.brief
    check(clean(draft.raw) || clean(draft.source_script), '请先保存 Brief 原文', 'brief')
    const { goal, theme, target_duration_ms, aspect_ratio, target_languages } = draft
    set({ raw_brief: draft.raw || null, source_script: draft.source_script || null,
      project_settings: { goal, theme, target_duration_ms, aspect_ratio, target_languages } }, [source('brief', draftArtifact?.ref ?? brief?.ref)])
  } else {
    conflict(brief, '请先提交 Brief')
  }
  if (task === 'crop') {
    const confirmed = requireStep(p, 3)
    const asset = p.assets[body.asset_ref]
    conflict(current(p, 'storyboard')?.ref === confirmed.artifact_ref, '请先确认当前分镜')
    check(fitsBoard(p, asset, confirmed.artifact_ref, asset?.shot_id) && !asset.derived_from &&
      integer(asset.width, 2) && integer(asset.height, 2) && integer(asset.duration_ms, 1), '请选择本版分镜的原视频候选', 'asset_ref')
    check(integer(body.crop_right_percent, 1) && body.crop_right_percent <= 20, '右缘裁切比例须为 1 至 20 的整数', 'crop_right_percent')
    bind('check3', confirmed.ref)
    bind('board', confirmed.artifact_ref)
    return { ...args, shot_id: asset.shot_id, crop: { asset_ref: asset.ref, right_percent: body.crop_right_percent } }
  }
  if (task === 'layout_render') {
    const script = requireStep(p, 2), board = current(p, 'storyboard')
    const shot = board?.data.shots.find((s: any) => s.shot_id === body.shot_id)
    const location = board?.data.production?.[body.shot_id]?.location
    check(shot && p.assets[location]?.kind === 'image', '请先绑定场景参考', 'shot_id')
    const layout=body.layout
    check(layout && layout.confirmed === true && clean(layout.note) && Array.isArray(layout.objects) && layout.objects.length >= 1 && layout.objects.length <= 20 && Array.isArray(layout.people) && layout.people.length <= 10, '请确认布局、填写推断说明和至少一个固定物', 'layout')
    const num=(v:any,max:number)=>typeof v === 'number' && Number.isFinite(v) && v>=0 && v<=max
    for (const a of layout.objects) check(clean(a.name) && a.name.length<=30 && num(a.x,10) && num(a.y,8) && num(a.w,10) && a.w>0 && num(a.h,8) && a.h>0 && a.x-a.w/2>=0 && a.x+a.w/2<=10 && a.y-a.h/2>=0 && a.y+a.h/2<=8, '固定物超出场景范围', 'layout')
    for (const a of layout.people) check(clean(a.name) && a.name.length<=30 && [a.start_x,a.end_x].every((v:any)=>num(v,10)) && [a.start_y,a.end_y].every((v:any)=>num(v,8)) && ['N','E','S','W'].includes(a.facing) && ((a.via_x==null && a.via_y==null) || (num(a.via_x,10) && num(a.via_y,8))), '人物起点、终点、途经点或朝向无效', 'layout')
    const intersects=(a:number[],b:number[],r:any)=>{
      const lo=[r.x-r.w/2,r.y-r.h/2], hi=[r.x+r.w/2,r.y+r.h/2]; let t0=0,t1=1
      for(let i=0;i<2;i++){const d=b[i]-a[i];if(Math.abs(d)<1e-9){if(a[i]<=lo[i] || a[i]>=hi[i]) return false;continue} let u=(lo[i]-a[i])/d,v=(hi[i]-a[i])/d;if(u>v)[u,v]=[v,u];t0=Math.max(t0,u);t1=Math.min(t1,v);if(t0>=t1)return false} return true
    }
    for(const person of layout.people){const points=[[person.start_x,person.start_y],...(person.via_x!=null?[[person.via_x,person.via_y]]:[]),[person.end_x,person.end_y]]
      for(let i=1;i<points.length;i++) check(!layout.objects.some((o:any)=>intersects(points[i-1],points[i],o)), person.name+' 的路线穿过固定物，请添加途经点绕行', 'layout')}
    check(layout.camera && num(layout.camera.x,10) && num(layout.camera.y,8) && ['N','E','S','W'].includes(layout.camera.facing), '机位或朝向无效', 'layout')
    bind('check2',script.ref); bind('board',board.ref)
    return {...args,shot_id:shot.shot_id,layout:clone(layout),source_location:location}
  }
  if (['creative', 'writer'].includes(task)) {
    const cards = current(p, 'characters')
    check(cards?.upstream === brief.ref, '请补齐两张角色草稿', 'characters')
    bind('characters', cards.ref)
    const sources = [source('brief', brief.ref)]
    if (task === 'creative') set({ brief: common, characters: cards.data, canon_facts: common.must_keep, candidate_count: 2 }, sources)
    else {
      const selected = requireStep(p, 1)
      const selected_concept = p.artifacts[selected.artifact_ref].data.concepts.find((c: any) => c.concept_key === selected.candidate)
      const existing = current(p, 'script')
      set({ brief: common, selected_concept, characters: cards.data, source_script: brief.data.source_script || null,
        review_feedback: existing?.note ?? null }, [...sources, source('concept', selected.artifact_ref)])
      bind('check1', selected.ref)
      if (existing) bind('script', existing.ref)
    }
  }
  if (['storyboard', 'reference', 'keyframe', 'repaint', 'location_reference', 'prop_reference', 'location_view', 'blocking_plan', 'video', 'art'].includes(task)) {
    const script = requireStep(p, 2)
    const approved_script = p.artifacts[script.artifact_ref].data
    const board = current(p, 'storyboard')
    const references = Object.entries(board?.data.references || {}).map(([character_id, asset_ref]) => ({ character_id, asset_ref }))
    const sources = [source('script', script.artifact_ref)]
    bind('check2', script.ref)
    if (task === 'storyboard') set({ approved_script, brief: common, reference_assets: references.map(({ asset_ref }) => ({ kind: 'image', asset_ref, duration_ms: null, available_to_model: false })), planned_shot_count: brief.data.planned_shot_count }, sources)
    if (['location_reference', 'prop_reference', 'location_view', 'blocking_plan'].includes(task)) {
      const shot = board?.data.shots.find((s: any) => s.shot_id === body.shot_id)
      check(shot && board.data.production, '请选择启用逐镜制作的分镜', 'shot_id')
      check(task !== 'prop_reference' || task_request, '请描述要生成的道具', 'task_request')
      const location = board.data.production[shot.shot_id]?.location
      check(!['location_view','blocking_plan'].includes(task) || (p.assets[location]?.kind === 'image' && task_request), '生成新视角或调度图前请绑定场景图并填写要求', 'task_request')
      sources.push(source('storyboard', board.ref))
      set({ mode: task === 'location_reference' ? 'location' : task === 'prop_reference' ? 'prop' : 'location_view', characters: [], character_references: [], shot,
        visual_style: '真人写实，场景光线与色温遵循剧本和已绑定参考', aspect_ratio: common.aspect_ratio }, sources)
      args.shot_id = shot.shot_id
      args.shot_index = shot.order
      const layoutRef=board.data.production[shot.shot_id]?.layout
      args.production = { references: ['location_view','blocking_plan'].includes(task) ? { location } : {},
        ...(task === 'location_view' && layoutRef ? {layout:{ref:layoutRef,geometry:p.assets[layoutRef]?.layout_spec}} : {}) }
      bind('board', board.ref)
    }
    if (task === 'repaint') {
      const confirmed = requireStep(p, 3)
      const confirmedBoard = p.artifacts[confirmed.artifact_ref]
      const shot = confirmedBoard.data.shots.find((s: any) => s.shot_id === body.shot_id)
      const base = confirmedBoard.data.keyframes?.[body.shot_id]
      check(shot && p.assets[base]?.kind === 'image', '请先选择要局部修改的关键帧', 'shot_id')
      check(task_request, '请填写只允许修改的问题区域和保持不变的要素', 'task_request')
      sources.push(source('storyboard', confirmedBoard.ref), source('media', base))
      set({ mode: 'keyframe', characters: [], character_references: [], shot,
        visual_style: '真人、低饱和；只修改指定局部，其他区域和构图保持不变', aspect_ratio: common.aspect_ratio }, sources)
      args.shot_id = shot.shot_id
      args.shot_index = shot.order
      args.production = { ...shotAssets(p, confirmedBoard, shot), edit_base: base,
        image: { subjects: shot.character_ids, location: shot.scene, composition: shot.framing, visible_state: shot.start_state, continuity: shot.continuity } }
      bind('check3', confirmed.ref)
      bind('board', confirmedBoard.ref)
    }
    if (task === 'reference' || task === 'keyframe' || task === 'art') {
      const shot = board?.data.shots.find((s: any) => s.shot_id === body.shot_id)
      const characters = approved_script.characters.filter((c: any) => task === 'reference' ? c.character_id === body.character_id : shot?.character_ids.includes(c.character_id))
      check(task === 'reference' ? characters.length : shot, '选择有效角色或镜头', 'shot_id')
      if (shot) sources.push(source('storyboard', board.ref))
      set({ mode: task === 'reference' ? 'character' : 'keyframe', characters,
        character_references: references.filter(item => characters.some((c: any) => c.character_id === item.character_id)),
        shot: shot ?? null, visual_style: '真人、低饱和；光线与色温遵循剧本场景和已绑定的参考', aspect_ratio: common.aspect_ratio }, sources)
      args.character_id = body.character_id
      args.shot_id = body.shot_id
      args.shot_index = shot?.order ?? (characters[0]?.character_id === approved_script.characters[0].character_id ? 0 : 6)
      if (shot && board.data.production) args.production = {
        ...shotAssets(p, board, shot),
        image: { subjects: shot.character_ids, location: shot.scene, composition: shot.framing, visible_state: shot.start_state, continuity: shot.continuity },
      }
      if (shot) bind('board', board.ref)
    }
    if (task === 'video') {
      const confirmed = requireStep(p, 3)
      const plan = p.artifacts[confirmed.artifact_ref]
      const sourceShot = plan.data.shots.find((s: any) => s.shot_id === body.shot_id)
      const localizedLanguage = clean(body.language) || null
      let shot = sourceShot
      check(shot, '选择已确认镜头', 'shot_id')
      bind('check3', confirmed.ref)
      bind('board', plan.ref)
      if (localizedLanguage) {
        const check4 = requireStep(p, 4)
        const language = current(p, 'language', localizedLanguage)
        check(language?.upstream === check4.ref && language.data.reviewed,
          '请先保存并校对该语种对白，再生成对应语言视频', 'language')
        bind('check4', check4.ref)
        bind('language', language.ref)
        const translated = language.data.lines.filter((line: any) => line.shot_id === shot.shot_id)
        const cut = p.artifacts[check4.artifact_ref].data.cut
        const sourceLines = cut.find((entry: any) => entry.shot_id === shot.shot_id)?.dialogue ?? []
        check(translated.length === sourceLines.length, '该镜头的翻译对白不完整', 'language')
        shot = { ...shot, dialogue: sourceLines.map((line: any) => {
          const match = translated.find((item: any) => item.line_id === line.line_id)
          check(match, '该镜头对白未完整翻译', line.line_id)
          return { ...line, text: match.target_text }
        }) }
        sources.push(source('language_assets', language.ref))
      }
      args.shot_id = shot.shot_id
      args.shot_index = shot.order
      args.previous_selection = localizedLanguage
        ? p.localized_selected?.[localizedLanguage]?.[shot.shot_id] ?? null
        : p.selected[shot.shot_id] ?? null
      if (localizedLanguage) args.language = localizedLanguage
      const keyframe_ref = plan.data.keyframes[shot.shot_id]
      const character_references = Object.entries(plan.data.references).filter(([key]) => shot.character_ids.includes(key)).map(([character_id, asset_ref]) => ({ character_id, asset_ref }))
      if (task === 'video') {
        const mode = body.video_mode ?? 'first_frame'
        check(['first_frame','references'].includes(mode), '请选择视频生成模式', 'video_mode')
        if (mode === 'references') {
          check(!realEnabled() || /^wan3\.0-video(?:-prime)?$/.test(dashscopeConfig(p.id).video), '当前视频模型不支持多素材参考模式', 'video_mode')
          const refs = Array.isArray(body.reference_images) ? body.reference_images : []
          check(refs.length >= 1 && refs.length <= 10 && new Set(refs.map((r: any) => r.ref)).size === refs.length, '请选择 1 到 10 张不同参考图', 'reference_images')
          for (const item of refs) check(typeof item.ref === 'string' && p.assets[item.ref]?.kind === 'image' && clean(item.role) && item.role.length <= 100, '参考图或用途无效', 'reference_images')
          args.video_references = refs.map((r: any) => ({ref:r.ref, role:clean(r.role)}))
        }
        args.video_mode = mode
        if (board?.has_shot_rework) conflict(sameShotInputs(p, plan.ref, board.ref, shot.shot_id), '此镜头的修改待确认，请先确认新版分镜')
        if (plan.data.production) {
          const index = plan.data.shots.indexOf(sourceShot)
          const previous = plan.data.shots[index - 1]
          const next = plan.data.shots[index + 1]
          args.production = {
            ...shotAssets(p, plan, shot),
            video: { start: shot.start_state, action: shot.action, end: shot.end_state, camera: shot.camera, continuity: shot.continuity, duration_ms: shot.duration_ms },
            joins: {
              incoming: previous ? { shot_id: previous.shot_id, end_state: previous.end_state, continuity: shot.continuity } : null,
              outgoing: next ? { shot_id: next.shot_id, start_state: next.start_state, continuity: next.continuity } : null,
            },
          }
        }
        const capabilities = body.scenario === 'unsupported'
          ? { first_frame: false, character_references: false, supported_durations_ms: [5000], aspect_ratios: ['9:16'] }
          : realEnabled() ? wanCapabilities(dashscopeConfig(p.id).video)
          : { first_frame: true, character_references: false, supported_durations_ms: mockDurations, aspect_ratios: ['9:16'] }
        check(capabilities.first_frame, '视频服务不支持首帧输入，任务未发起', 'first_frame', 422, 'unsupported')
        check(capabilities.supported_durations_ms.includes(shot.duration_ms), '视频服务不支持目标镜头时长，任务未发起', 'duration_ms', 422, 'unsupported')
        set({ approved_shot: shot, keyframe_ref, character_references, capabilities, aspect_ratio: common.aspect_ratio,
          task_request: localizedLanguage ? '这是' + ({'zh-CN':'中文',en:'英文',th:'泰语'} as Record<string,string>)[localizedLanguage] + '专属视频。对白和内心独白必须使用 approved_shot.dialogue 中的目标语言文本；其他中文动作描述只作为表演与镜头指导，不得被角色念出。保留人物、表演和画面连续性，并生成与台词匹配的原生声音。' : null },
        [source('storyboard', plan.ref), source('media', keyframe_ref), ...(localizedLanguage ? [source('language_assets', current(p, 'language', localizedLanguage)!.ref)] : [])])
      }
    }
  }
  if (['translate', 'dubbing', 'preview', 'assemble'].includes(task)) {
    check(lang, '请选择目标语种', 'language')
    const approved = requireStep(p, 4)
    const cut = p.artifacts[approved.artifact_ref]
    bind('check4', approved.ref)
    const language = current(p, 'language', lang)
    if (language?.upstream === approved.ref) bind('language', language.ref)
    args.cut = cut.data.cut
    if (task !== 'translate') {
      conflict(language?.upstream === approved.ref, '请先保存当前画面的语言稿')
      check(language.data.reviewed, '请先校对并保存该语种的文本', 'reviewed')
      if (task === 'dubbing') {
        validateLines(p, lang, args.cut, language.data.lines, false)
        const line = language.data.lines.find((entry: any) => entry.line_id === body.line_id)
        check(line, '请选择要配音的对白', 'line_id')
        args.line = line
      } else {
        const confirmation = active(p, 5, lang)
        if (task === 'assemble') {
          check(confirmation?.artifact_ref === language.ref && confirmation.upstream === approved.ref, '正式合成需要当前语种的“确认节点 5：语言素材”', 'language_confirmation_ref', 409)
          conflict(confirmation.delivery_manifest, '此历史确认缺少交付清单，请重新生成同步预览并确认语言素材')
          const confirmedMusic = confirmation.delivery_manifest.music?.asset_ref ?? null
          conflict(!Object.hasOwn(body, 'music_ref') || (clean(body.music_ref) || null) === confirmedMusic,
            '背景音乐已由同步预览锁定，修改后请重新生成预览并确认语言素材')
          args.delivery_manifest = clone(confirmation.delivery_manifest)
          bind('check5', confirmation.ref)
        } else {
          conflict(language.status === 'draft', '请先重新打开语言稿，再生成同步预览')
          args.delivery_manifest = buildDeliveryManifest(p, language, clean(body.music_ref) || null)
          check(args.delivery_manifest.music, '请先选择随交付一起确认的背景音乐', 'music_ref')
        }
        const snapshot = args.delivery_manifest
        set({ mode: task === 'assemble' ? 'assemble_delivery' : 'prepare_language', target_language: lang, cut_ref: snapshot.cut_ref,
          cut: snapshot.cut, lines: snapshot.lines.map(({ subtitle_text, ...line }: any) => line),
          language_assets_ref: snapshot.language_assets_ref, subtitle_ref: snapshot.language_assets_ref,
          music: snapshot.music, language_confirmation_ref: task === 'assemble' ? confirmation.ref : null },
          [source('cut', snapshot.cut_ref), source('language_assets', snapshot.language_assets_ref)])
      }
    }
  }
  if (task === 'rough') {
    const cut = current(p, 'cut')
    const confirmed = requireStep(p, 3)
    check(cut && cut.status !== 'needs_recheck' && cut.upstream === confirmed.ref, '请先保存当前画面基准', 'cut')
    bind('cut_draft', cut.ref)
    args.cut = cut.data.cut
  }
  if (task === 'director') {
    const target = p.artifacts[body.ref]
    const step = directorCheckpoints[target?.type]
    check(target && step, '请选择导演建议对应的产物', 'ref')
    check(target.language === lang, '产物语种与建议目标不一致', 'language')
    set({ brief: common, next_checkpoint: step, artifact_refs: [target.ref], blocking_issues: directorBlockers(p,target), review_feedback: target.note ?? null,
      ...(step === 6 && p.members.reviewer ? { delivery_reviewer: 'reviewer' } : {}),
      target_language: step >= 5 ? lang : null }, [source(target.type === 'language' ? 'language_assets' : target.type, target.ref)])
  }
  check(!agent || args.input, '请从对应制作操作调用该角色', 'task')
  if (agent) schema(agent, 'input', args.input)
  return args
}
export function queue(p: Project, actor: string, body: any) {
  role(p, actor, body.task === 'producer' && actor === p.members.operations ? 'operations' : 'director')
  const real = realEnabled()
  check(!real || !body.scenario, '故障注入仅用于本地模拟', 'scenario')
  check(!real || body.task !== 'music', '真实模式请上传本项目背景音乐', 'music')
  const config = real ? dashscopeConfig(p.id) : null
  const safeConfig = config ? Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'apiKey')) : null
  const plan = context(p, body)
  plan.prompt_only = body.prompt_only === true
  check(!plan.prompt_only || ['reference','keyframe','repaint','location_reference','prop_reference','location_view','blocking_plan','video'].includes(plan.task), '该任务不支持仅准备提示词', 'prompt_only')
  check(!(plan.prompt_only && body.prepared_plan), '准备提示词和最终生成不能同时执行', 'prepared_plan')
  if (body.prepared_plan) {
    check(plan.agent && ['art','vfx'].includes(plan.agent), '该任务不支持使用修改后的提示词', 'prepared_plan')
    validateAgent(plan.agent, plan.input, body.prepared_plan, p)
    check(body.prepared_plan.status === 'ok', '修改后的提示词计划不可执行', 'prepared_plan')
  }
  const skill = productionSkill(plan.agent ?? plan.task)
  const prompt = agentSystemPrompt(plan, skill)
  const external = real && !['rough', 'music', 'crop', 'layout_render', 'preview', 'assemble'].includes(plan.task) && !(plan.task === 'translate' && plan.language === 'zh-CN')
  if (external) validateConfig(config!)
  if (external && plan.task === 'dubbing') voiceFor(config!, plan.language)
  const mediaKind = mediaKindFor(plan.task)
  const model = external ? mediaKind ? config![mediaKind] : plan.task === 'dubbing' ? speechModelFor(config!, plan.language) : config!.text
    : real ? 'local/' + plan.task : 'mock/' + (plan.agent ?? plan.task)
  const preparedFingerprint = body.prepared_plan ? hash(canonical(body.prepared_plan)) : null
  const identityParts = { task: body.task, context: plan.context, input: plan.input, lang: plan.language, shot: plan.shot_id, character: plan.character_id, line: plan.line?.line_id, music: plan.music, model, config: external ? safeConfig : null, prompt_only:plan.prompt_only, prepared_plan:preparedFingerprint, ...(plan.delivery_manifest ? { delivery_manifest:plan.delivery_manifest } : {}), ...(plan.crop ? { crop: plan.crop } : {}), ...(plan.layout ? {layout:plan.layout,source_location:plan.source_location} : {}), ...(skill ? { skill: skill.fingerprint } : {}) }
  const identity = canonical({ ...identityParts, ...(plan.video_mode ? { video_mode:plan.video_mode, video_references:plan.video_references ?? [] } : {}) })
  const legacyIdentity = plan.video_mode === 'first_frame' ? canonical(identityParts) : null
  const existing = Object.values(p.jobs).findLast(job => job.identity === identity || (legacyIdentity && !job.plan.video_mode && job.identity === legacyIdentity))
  const previewLanguage = plan.task === 'preview' ? p.artifacts[plan.context.language] : null
  if (!body.retry_of && existing && (!previewLanguage || (previewLanguage.data.preview_job_id === existing.id && existing.state !== 'failed'))) return existing
  const scenario = clean(body.scenario) || null
  let savedAgentPlan: any = body.prepared_plan ? { response: body.prepared_plan, source: 'edited' } : undefined
  if (body.retry_of) {
    const retry = Object.values(p.jobs).findLast(job =>
      job.retry_of === body.retry_of && job.identity === identity && (job.scenario ?? null) === scenario)
    if (retry) return retry
    const previous = p.jobs[body.retry_of]
    const interruptedText = previous?.state === 'awaiting_query' && previous.plan.agent === previous.plan.task
      && !previous.provider_receipts?.compiled_request
    check(previous?.plan.task === body.task && previous.plan.shot_id === plan.shot_id && previous.plan.language === plan.language &&
      previous.plan.line?.line_id === plan.line?.line_id && previous.plan.character_id === plan.character_id &&
      (['succeeded', 'failed', 'superseded'].includes(previous.state) || interruptedText), '请选择同一操作的已结束任务或结果未知的文字任务', 'retry_of')
    if (previous.provider_receipts?.reconciliation?.confirmed_missing &&
        previous.provider_receipts?.agent?.plan && previous.identity === identity) {
      savedAgentPlan = { response: previous.provider_receipts.agent.plan, job_id: previous.id }
    }
  }
  const sequence = Object.values(p.jobs).filter(job => job.plan.task === plan.task && job.plan.shot_id === plan.shot_id).length + 1
  const job = {
    id: id(), actor, plan, identity, sequence, retry_of: body.retry_of ?? null, scenario,
    state: 'queued', created_at: now(), updated_at: now(), usage: null, result: null, error: null, provider_job_id: null,
    model, config: external ? { adapter: 'dashscope', ...safeConfig } : { adapter: real ? 'local' : 'mock' },
    provider_receipts: {}, prompt_fingerprint: plan.agent ? contracts[plan.agent].fingerprint : null, agent_prompt: prompt,
    ...(skill ? { skill } : {}),
    ...(savedAgentPlan ? { saved_agent_plan: savedAgentPlan } : {}),
  }
  p.jobs[job.id] = job
  if (previewLanguage) {
    delete previewLanguage.data.preview_ref
    delete previewLanguage.data.preview_manifest
    previewLanguage.data.preview_job_id = job.id
  }
  return job
}
export function previewJob(p: Project, actor: string, body: any) {
  role(p, actor, body.task === 'producer' && actor === p.members.operations ? 'operations' : 'director')
  check(!realEnabled() || !body.scenario, '故障注入仅用于本地模拟', 'scenario')
  const plan = context(p, body)
  const skill = productionSkill(plan.agent ?? plan.task)
  const agentPrompt = agentSystemPrompt(plan, skill)
  const pricing = providerConfigStatus(p.id).pricing
  const estimate = (() => {
    if (!realEnabled() || plan.delivery_manifest) return { mode:'local', currency:'CNY', low:0, high:0, note:'本地执行不产生模型费用' }
    let low = 0, high = 0
    const missing: string[] = []
    if (plan.task === 'video') {
      const seconds = Number(plan.input?.approved_shot?.duration_ms ?? 0) / 1000
      if (Number.isFinite(pricing.video_second)) { low += seconds * pricing.video_second; high += seconds * pricing.video_second }
      else missing.push('视频/秒')
    } else if (['reference','keyframe','repaint','location_reference','prop_reference','location_view','blocking_plan'].includes(plan.task)) {
      if (Number.isFinite(pricing.image_each)) { low += pricing.image_each; high += pricing.image_each }
      else missing.push('图片/次')
    } else if (plan.task === 'dubbing') {
      const chars = [...String(plan.input?.lines?.find((line: any) => line.line_id === plan.line?.line_id)?.target_text ?? plan.line?.target_text ?? '')].length
      if (Number.isFinite(pricing.speech_character)) { low += chars * pricing.speech_character; high += chars * pricing.speech_character }
      else missing.push('配音/字')
    }
    if (plan.agent) {
      const inputTokens = Math.max(100, Math.ceil(((agentPrompt?.length ?? 0) + JSON.stringify(plan.input ?? {}).length) / 3))
      if (Number.isFinite(pricing.text_input_per_1k) && Number.isFinite(pricing.text_output_per_1k)) {
        low += inputTokens / 1000 * pricing.text_input_per_1k + 200 / 1000 * pricing.text_output_per_1k
        high += inputTokens / 1000 * pricing.text_input_per_1k + 1600 / 1000 * pricing.text_output_per_1k
      } else missing.push('文字 Token')
    }
    return { mode:'remote', currency:'CNY', low, high:Math.max(low,high), note:missing.length ? '未配置：' + missing.join('、') + '；以下为已配置部分' : '按项目配置单价估算，实际以供应商账单为准' }
  })()
  return {
    task: plan.task, agent: plan.agent, plan, skill: skill ?? null,
    agent_prompt: agentPrompt, real_call: Boolean(realEnabled() && plan.agent && !plan.delivery_manifest),
    estimate,
    note: plan.agent
      ? '生成前检查只显示将使用的素材；点击“准备提示词”后，页面只展示真正发送给媒体模型的自然语言提示词。'
      : '本地工具不调用 Agent；执行后会记录实际请求和结果。',
  }
}
function mockAgent(p: Project, job: any) {
  const { task, agent, input } = job.plan
  const example = contracts[agent].examples[0].output
  if (agent === 'producer') return ok({ normalized_brief: settings((current(p, 'brief_draft') ?? current(p, 'brief'))?.data ?? p.brief),
    facts: [], missing_fields: [], proposed_characters: fixture.script.characters })
  if (agent === 'creative') return ok({ concepts: example.result.concepts.map((c: any) => ({
    ...c, character_goals: input.characters.map((person: any) => ({ character_id: person.character_id, goal: person.goal })),
  })) })
  if (agent === 'writer') {
    const script = clone(fixture.script)
    const pairs = new Map(script.characters.map((c: any, i: number) => [c.character_id, input.characters[i].character_id]))
    script.characters = input.characters
    for (const beat of script.beats) for (const line of beat.dialogue) line.speaker_id = pairs.get(line.speaker_id)
    if (!input.review_feedback) { script.ending = '小林回头拥抱阿哲。'; script.beats.at(-1).action = '小林回头拥抱阿哲。' }
    return ok(script)
  }
  if (agent === 'storyboard') {
    const script = input.approved_script
    const people = new Map(fixture.script.characters.map((c: any, i: number) => [c.character_id, script.characters[i].character_id]))
    const shots = fixture.shots.slice(0, script.beats.length).map((shot: any, i: number) => ({
      ...shot, beat_ids: [script.beats[i].beat_id], dialogue: script.beats[i].dialogue,
      character_ids: shot.character_ids.map((key: string) => people.get(key)), action: script.beats[i].action,
    }))
    if (job.scenario === 'missing_duration') delete shots[0].duration_ms
    return ok({ total_duration_ms: job.scenario === 'missing_duration' ? 36000 : sum(shots), shots })
  }
  if (agent === 'art') {
    const template = task === 'reference' ? contracts.art.examples[1].output : example
    return ok({ ...template.result, mode: input.mode, reference_map: input.character_references })
  }
  if (agent === 'vfx') return ok({
    ...example.result, shot_id: input.approved_shot.shot_id, first_frame_ref: job.scenario === 'foreign_frame' ? 'foreign_frame@v1' : input.keyframe_ref,
    duration_ms: input.approved_shot.duration_ms, aspect_ratio: input.aspect_ratio,
  })
  if (agent === 'director') return ok({ ...example.result, stage: input.next_checkpoint,
    next_actor: input.next_checkpoint === 6 ? (input.delivery_reviewer ?? 'operations') : [1, 2].includes(input.next_checkpoint) ? 'operations' : 'director',
    target_language: job.scenario === 'wrong_language' ? 'en' : input.target_language,
    required_refs: input.artifact_refs, deliverable: input.artifact_refs[0], human_decision: '由工作台指定的账号人工确认。',
  })
  if (agent === 'post') return ok(manifest(input))
  return clone(example)
}
function agentSystemPrompt(plan: any, skill: any) {
  const contract = plan.agent ? contracts[plan.agent] : null
  if (!contract) return null
  const shotInstructions = plan.production ? '\n已确认的镜头制作单：\n' + JSON.stringify(plan.production) : ''
  const modeInstructions = plan.task === 'repaint'
    ? '\n本次是局部重绘。已有画面是唯一底图；只针对用户指定的问题区域给出局部编辑说明，必须逐项列出不得改变的人物身份、手部数量、服装、构图、背景、道具和光线。不要重新设计整个镜头。'
    : plan.task === 'video' && plan.video_mode === 'references'
      ? '\n本次使用多素材参考模式，不锁定视频首帧。first_frame_ref 字段仅用作结构化画面参考，不要在提示词中承诺首帧严格相同；只让当前镜头需要入画的角色出现。'
      : ''
  const fixedManifest = plan.agent === 'post'
    ? '\n服务端已从确认版本计算出固定合成清单。请检查输入；如 status 为 ok，result 必须逐字段原样使用以下内容，勿改时长、顺序或引用：\n' + JSON.stringify(manifest(plan.input))
    : ''
  return contract.prompt + composeSkillPrompt(skill) + shotInstructions + modeInstructions + fixedManifest +
    '\n输出单个 JSON 对象，遵循以下 JSON Schema：\n' + JSON.stringify(contract.outputSchema)
}
function translated(plan: any) {
  const variants = fixture.language_variants[plan.language].lines
  return plan.cut.flatMap((shot: any) => shot.dialogue.map((line: any, index: number) => {
    const start = shot.start_ms + Math.min(1000 + 2500 * index, Math.round(shot.duration_ms / 3))
    const available = shot.start_ms + shot.duration_ms - start
    return { line_id: line.line_id, shot_id: shot.shot_id, speaker_id: line.speaker_id, source_text: line.text,
      target_text: plan.language === 'zh-CN' ? line.text : variants.find((v: any) => v.line_id === line.line_id && v.source_text === line.text)?.target_text ?? line.text,
      audio_ref: null, audio_start_ms: start, audio_duration_ms: null, subtitle_start_ms: start - 50,
      subtitle_end_ms: start + Math.min(2700, available),
    }
  }))
}
export type PreparedAgentPlan = (agent: string, input: any) => any

export function protectStoryboardDialogue(response: any, input: any) {
  if (!response?.result?.shots || !Array.isArray(response.result.shots)) return { response, changes: [] }
  const beats = new Map<string, any>((input?.approved_script?.beats ?? []).map((beat: any) => [beat.beat_id, beat]))
  const changes: any[] = []
  const next = clone(response)
  for (const shot of next.result.shots) {
    const allowed = new Map<string, any>((shot.beat_ids ?? []).flatMap((beatId: string) => beats.get(beatId)?.dialogue ?? [])
      .map((line: any) => [line.line_id, line]))
    shot.dialogue = Array.isArray(shot.dialogue) ? shot.dialogue.map((line: any) => {
      const source = allowed.get(line?.line_id)
      if (!source) return line
      if (canonical(source) !== canonical(line)) changes.push({ shot_id: shot.shot_id, line_id: line.line_id, before: line, after: source })
      return clone(source)
    }) : []
  }
  return { response: next, changes }
}

async function performReal(p: Project, job: any, audit: (stage: string, receipt: any) => void, query: boolean, preparedPlan?: PreparedAgentPlan, transport?: typeof fetch) {
  const live = dashscopeConfig(p.id)
  const config = validateConfig({ ...job.config, apiKey: live.apiKey, voices: live.voices })
  const adapter = dashscope(config, audit, transport)
  const { task, agent, input, language, line } = job.plan
  const mediaKind = mediaKindFor(task)
  let response = mediaKind && query ? job.provider_receipts.agent?.plan : null
  let dialogueProtection: any[] = []
  if (agent && !query) {
    const prepared = job.saved_agent_plan?.response ?? preparedPlan?.(agent, input)
    response = prepared ?? await adapter.json(job.agent_prompt ?? agentSystemPrompt(job.plan, job.skill)!, input, 'agent')
    const protectedResponse = agent === 'storyboard' ? protectStoryboardDialogue(response, input) : { response, changes: [] }
    dialogueProtection = protectedResponse.changes
    if (agent === 'storyboard') audit('agent_raw', { plan: response, dialogue_protection: protectedResponse.changes })
    response = protectedResponse.response
    validateAgent(agent, input, response, p)
    check(response.status === 'ok', response.issues?.map((issue: any) => issue.message).join('；') || '模型缺少输入或能力', 'agent')
    if (mediaKind || prepared) audit('agent', { plan: response, ...(job.saved_agent_plan ? { source:'previous_real_plan', source_job_id:job.saved_agent_plan.job_id } : prepared ? { source:'prepared' } : {}) })
  }
  if (job.plan.prompt_only) return { response, data: response?.result, asset: null, dialogue_protection: dialogueProtection }
  let asset: any = null
  let data = response?.result
  if (mediaKind) {
    check(data, '缺少已保存的生成计划', 'plan')
    const reference_map = ['keyframe','repaint'].includes(task) && job.plan.production ? input.character_references : data.reference_map
    const taskId = query ? job.provider_job_id : await adapter.startMedia(mediaKind, { ...data, reference_map, production: job.plan.production, video_mode:job.plan.video_mode, video_references:job.plan.video_references }, p.assets)
    asset = await adapter.queryMedia(mediaKind, taskId, query ? 1 : 5)
  }
  if (task === 'translate') {
    const baseLines = translated(job.plan)
    const items = baseLines.map(({ line_id, speaker_id, shot_id, source_text }: any) => ({ line_id, speaker_id, shot_id, source_text }))
    const translations = await adapter.json('把对白翻译为指定语种，语气自然、适合短片配音，保留原意和人物关系。输出一个 JSON 对象，格式为 {"lines":[{"line_id":"L01","target_text":"..."}]}。原样保留每条对白标识，不能遗漏或新增。', { target_language: language, lines: items }, 'translation')
    check(Array.isArray(translations?.lines) && translations.lines.length === items.length &&
      new Set(translations.lines.map((entry: any) => entry?.line_id)).size === items.length, '译文对白标识缺失、重复或数量不一致', 'lines')
    data = baseLines.map((source: any) => {
      const found = translations.lines.find((entry: any) => entry?.line_id === source.line_id)
      check(clean(found?.target_text), '缺少可校对译文', source.shot_id + '/' + source.line_id)
      return { ...source, target_text: found.target_text }
    })
  }
  if (task === 'dubbing') {
    asset = query
      ? { ...await adapter.download(job.provider_receipts.speech.result_url, 'audio'), text: line.target_text, language, voice: voiceFor(config, language) }
      : await adapter.speak(line, language)
  }
  return { response, data, asset, dialogue_protection: dialogueProtection }
}
async function perform(p: Project, job: any) {
  const plan = job.plan
  const { task, agent, input } = plan
  let response = job.saved_agent_plan?.response ?? (agent ? mockAgent(p, job) : null)
  if (response) {
    if (agent === 'storyboard') response = protectStoryboardDialogue(response, input).response
    validateAgent(agent, input, response, p)
    check(response.status === 'ok', response.issues?.map((issue: any) => issue.message).join('；') || '任务缺少输入或能力', 'agent')
  }
  let data = response?.result
  let asset: any = null
  let units: any[] | null = agent ? [{ unit: 'tokens', quantity: 180 + (job.sequence * 11) }] : null
  if (plan.prompt_only) return { response, data, asset:null, usage:units }
  if (['reference', 'keyframe', 'repaint', 'location_reference', 'prop_reference', 'location_view', 'blocking_plan'].includes(task)) {
    asset = await mockImage(plan.shot_index)
    units = [...units!, { unit: 'images', quantity: 1 }]
  }
  if (task === 'video') {
    const bad = plan.shot_id === 'S04' && job.sequence === 1
    asset = await mockVideo(bad ? 14 : plan.shot_index, data.duration_ms, bad ? undefined : p.assets[data.first_frame_ref].file)
    units = [...units!, { unit: 'video_seconds', quantity: asset.duration_ms / 1000 }]
  }
  if (task === 'translate') data = translated(plan)
  if (task === 'dubbing') {
    const shot = findLine(plan.cut, plan.line.line_id)
    const window = shot.start_ms + shot.duration_ms - plan.line.audio_start_ms
    asset = await mockSpeech(plan.line.target_text, plan.language, Math.min(window, 3100), plan.line.speaker_id)
    units = [{ unit: 'speech_characters', quantity: [...plan.line.target_text].length }]
  }
  if (task === 'music') asset = await mockMusic()
  if (task === 'rough') asset = await render(plan.cut, [], null, p.assets)
  return { response, data, asset, usage: job.scenario === 'missing_usage' ? null : units }
}
async function performDelivery(p: Project, job: any) {
  const snapshot = job.plan.delivery_manifest
  conflict(snapshot, '旧任务缺少固定交付清单，请重新生成同步预览')
  const data = manifest(job.plan.input)
  const response = ok(data)
  validateAgent('post', job.plan.input, response, p)
  const asset = await render(snapshot.cut, snapshot.lines, p.assets[snapshot.music?.asset_ref], p.assets, snapshot.audio_modes)
  return { response, data, asset, usage: null }
}
function isCurrent(p: Project, job: any) {
  const { context, language } = job.plan
  const compare: Record<string, string> = {
    brief: current(p, 'brief')?.ref, characters: current(p, 'characters')?.ref, script: current(p, 'script')?.ref, board: current(p, 'storyboard')?.ref,
    check1: active(p, 1)?.ref, check2: active(p, 2)?.ref, check3: active(p, 3)?.ref, check4: active(p, 4)?.ref,
    cut_draft: current(p, 'cut')?.ref, language: current(p, 'language', language)?.ref, check5: active(p, 5, language)?.ref,
  }
  return Object.entries(context).every(([key, value]) => compare[key] === value)
}
function accept(p: Project, job: any, result: any) {
  const { task, language, context, shot_id, line } = job.plan
  const { data, asset } = result
  if (result.dialogue_protection?.length) job.dialogue_protection = result.dialogue_protection
  if (job.plan.prompt_only) {
    job.state = isCurrent(p, job) ? 'succeeded' : 'superseded'
    job.result = { artifact_ref:null, asset_ref:null, response:result.response, data }
    if (Object.hasOwn(result, 'usage')) job.usage = result.usage
    job.error = null
    job.updated_at = now()
    return
  }
  let media: any
  if (asset) {
    const prefix = ['video', 'crop'].includes(task) ? (language ? langKey(language) + '_' + shot_id + '_video' : shot_id + '_video') : task === 'music' ? 'bgm' : task === 'keyframe' ? shot_id + '_keyframe' : task === 'repaint' ? shot_id + '_repaint'
      : ['location_reference', 'prop_reference', 'location_view', 'blocking_plan', 'layout_render'].includes(task) ? shot_id + '_' + task
      : task === 'reference' ? job.plan.character_id + '_ref' : task === 'dubbing' ? langKey(language) + '_' + line.line_id + '_audio' : task + '_file'
    const spoken = job.plan.input?.approved_shot?.dialogue
    const isLocalized = task === 'video' && Boolean(language)
    media = addAsset(p, job.actor, { ...asset, job_id: job.id, shot_id, language: language ?? (task === 'video' ? 'zh-CN' : null),
      localized: isLocalized, board_ref: context.board ?? null,
      ...(task === 'video' ? { spoken_dialogue: clone(spoken) } : {}),
      ...(['location_reference', 'prop_reference', 'location_view', 'blocking_plan', 'layout_render'].includes(task) ? { purpose:'reference', reference_kind:task === 'prop_reference' ? 'prop' : ['blocking_plan','layout_render'].includes(task) ? 'layout' : 'location', ...(task === 'layout_render' ? {source_location:job.plan.source_location} : {}) } : {}) }, prefix)
  }
  const currentSelection = job.plan.language
    ? p.localized_selected?.[job.plan.language]?.[shot_id] ?? null
    : p.selected[shot_id] ?? null
  const previewLanguage = task === 'preview' ? p.artifacts[context.language] : null
  const latest = isCurrent(p, job) && (task !== 'video' || currentSelection === job.plan.previous_selection) &&
    (!previewLanguage || (previewLanguage.status === 'draft' && previewLanguage.data.preview_job_id === job.id))
  let artifact: any = null
  if (latest) {
    if (outputTypes[task]) {
      let payload = data
      if (task === 'storyboard') {
        const inherited = sequelBindings(p, data.shots, job.plan.input.approved_script.characters)
        const production = job.config.adapter === 'dashscope' || current(p, 'storyboard')?.data.production ? { production: {} } : {}
        payload = { ...data, keyframes: {}, references: {}, ...production, ...(Object.hasOwn(production, 'production') ? { join_checks: true } : {}), ...inherited }
      }
      artifact = put(p, job.actor, outputTypes[task], payload, context.check2 ?? context.check1 ?? context.brief)
    }
    if (task === 'translate') {
      const existing = current(p, 'language', language)
      if (!existing || existing.upstream !== context.check4 || existing.status === 'needs_recheck')
        artifact = put(p, job.actor, 'language', { lines: data, reviewed: language === 'zh-CN' }, context.check4, language)
    }
    if (task === 'rough') p.artifacts[context.cut_draft].data.preview_ref = media.ref
    if (previewLanguage) {
      previewLanguage.data.preview_ref = media.ref
      previewLanguage.data.preview_manifest = clone(job.plan.delivery_manifest)
    }
    if (task === 'assemble') artifact = put(p, job.actor, 'delivery', {
      ...data, file_ref: media.ref, delivery_manifest: clone(job.plan.delivery_manifest),
    }, context.check5, language)
  }
  job.state = latest ? 'succeeded' : 'superseded'
  job.result = { artifact_ref: artifact?.ref ?? null, asset_ref: media?.ref ?? null, response: result.response, data: ['translate', 'producer'].includes(task) ? data : undefined }
  if (Object.hasOwn(result, 'usage')) job.usage = result.usage
  job.error = null
  job.updated_at = now()
}
export function worker(store: Store, preparedPlan?: PreparedAgentPlan, transport?: typeof fetch) {
  const running = new Map<string, Promise<void>>()
  function start(projectId: string, jobId: string, query = false) {
    if (running.has(jobId)) return running.get(jobId)
    const snapshot = store.get(projectId)
    const job = snapshot.jobs[jobId]
    if (!job || (query ? job.state !== 'awaiting_query' : job.state !== 'queued')) return
    const real = job.config.adapter === 'dashscope'
    if (query && !canQueryOriginal(job)) return
    const execute = async () => {
      const simulatedTimeout = job.scenario === 'timeout' && !query
      const claimed = store.update(projectId, p => {
        const record = p.jobs[jobId]
        if (record.state !== (query ? 'awaiting_query' : 'queued')) return false
        record.state = simulatedTimeout ? 'awaiting_query' : 'running'
        record.updated_at = now()
        if (simulatedTimeout) record.provider_job_id = 'mock-' + job.id
        return true
      })
      if (!claimed.result || simulatedTimeout) return
      const audit = (stage: string, receipt: any) => {
        store.update(projectId, p => {
          const record = p.jobs[jobId]
          record.provider_receipts[stage] = { ...record.provider_receipts[stage], ...receipt }
          if (receipt.task_id) record.provider_job_id = receipt.task_id
          const entries = Object.values(record.provider_receipts).flatMap((item: any) => item.usage || [])
          record.usage = entries.length ? entries : null
        })
      }
      try {
        if (job.scenario === 'invalid_key') check(false, '配置无效：服务商拒绝凭证，请检查地域和 Key', 'model', 422, 'provider_auth')
        const result = ['preview', 'assemble'].includes(job.plan.task) ? await performDelivery(snapshot, job)
          : job.plan.task === 'layout_render' ? {asset:await renderSceneLayout(job.plan.layout)} : job.plan.task === 'crop'
          ? { asset: await cropVideoRight(snapshot.assets[job.plan.crop.asset_ref], job.plan.crop.right_percent) }
          : real ? await performReal(snapshot, job, audit, query, preparedPlan, transport)
          : job.config.adapter === 'local' && job.plan.task === 'translate' ? { response: null, data: translated(job.plan), asset: null, usage: null }
          : await perform(snapshot, job)
        store.update(projectId, p => accept(p, p.jobs[jobId], result))
      } catch (error: any) {
        const unknown = error instanceof UnknownProviderResult
        const message = error.status || unknown ? error.message : '任务处理失败：' + String(error.stderr || error.message).slice(0, 600)
        store.update(projectId, p => Object.assign(p.jobs[jobId], {
          state: unknown ? 'awaiting_query' : 'failed', updated_at: now(), error: { code: unknown ? 'provider_unknown' : error.code ?? 'job_failed', message, field: error.field ?? null },
        }))
      }
    }
    const work = Promise.resolve().then(execute).finally(() => running.delete(jobId))
    running.set(jobId, work)
    return work
  }
  function recover() {
    for (const project of store.all()) {
      if (Object.values(project.jobs).some(job => job.state === 'running')) store.update(project.id, p => {
        for (const job of Object.values(p.jobs)) if (job.state === 'running')
          job.state = job.plan.delivery_manifest ? 'queued' : 'awaiting_query'
      })
      for (const job of Object.values(store.get(project.id).jobs)) {
        if (job.state === 'queued') start(project.id, job.id)
        if (job.state === 'awaiting_query' && job.config.adapter === 'dashscope' && job.plan.task === 'repaint' && canQueryOriginal(job))
          start(project.id, job.id, true)
      }
    }
  }
  return { start, recover, idle: () => Promise.all([...running.values()]) }
}
