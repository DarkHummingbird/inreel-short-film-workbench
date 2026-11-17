const root = document.querySelector('#app')
const message = document.querySelector('#message')
const labels = { operations: '运营 · 林', director: '编导 · 周', reviewer: '历史审核账号 · 吴（仅旧项目）', owner: '负责人 · 陈', guest: '访客' }
const langs = { 'zh-CN': '中文', en: '英文', th: '泰语' }
const checkpointNames = { 1:'创意方向', 2:'完整剧情剧本', 3:'分镜脚本与镜头清单', 4:'画面与接镜', 5:'语言素材', 6:'成片交付' }
const checkpointName = step => '确认节点 ' + step + '：' + (checkpointNames[step] ?? '')
const states = { draft:'草稿', pending_review:'待确认', approved:'已通过', returned:'已退回', needs_recheck:'待复核', queued:'排队中', running:'处理中', succeeded:'已完成', failed:'失败', awaiting_query:'待查询', superseded:'历史结果' }
const notifications = { brief_submitted:'Brief 已提交', review:'待你确认', returned:'已退回修改', approved:'已确认', select_languages:'请选择目标语种', owner_feedback:'负责人反馈' }
const types = ['concept','script','storyboard','cut','language','delivery']
const tabs = ['brief','story','assets','shots','language','delivery']
const tabNames = ['需求','创意与剧情剧本','素材','分镜和画面','语言素材','成片交付']
const allTabs = [...tabs,'jobs','models','team']
const actors = { operations:'op_lin', director:'dir_zhou', owner:'owner_chen' }
const actions = new Map()
const remoteJobTasks = new Set(['producer','creative','writer','storyboard','reference','location_reference','prop_reference','location_view','blocking_plan','keyframe','repaint','video','music','director','translate','dubbing'])
let runtime = {mode:'mock'}
let serial = 0, session, project, projects = [], inbox = [], usageOverview = { projects: [] }, modelConfig = {}, view = 'projects', tab = 'brief', language = 'zh-CN', focus = '', busy = false, messageTimer, usageGroup = 'stage', usageScope = 'all', completedEdit = false, taskPreview = null
let writeCount = 0
const formDrafts = new Map()
let serverDrafts = {}
const draftSyncTimers = new Map()
let liveRefreshTimer, liveRefreshBusy = false, liveUpdatePending = false
const x = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const option = (v, label, selected) => '<option value="' + x(v) + '"' + (selected ? ' selected' : '') + '>' + x(label) + '</option>'
const select = (name, values) => '<select name="' + name + '">' + values.join('') + '</select>'
const label = (name, control) => '<label>' + x(name) + control + '</label>'
const input = (name, value = '', type = 'text') => '<input name="' + name + '" type="' + type + '" value="' + x(value) + '">'
const area = (name, value, cls = '') => '<textarea name="' + name + '" class="' + cls + '">' + x(value) + '</textarea>'
const encoded = value => encodeURIComponent(value)
const record = value => '<pre>' + x(JSON.stringify(value,null,2)) + '</pre>'
const show = (value, title='查看数据') => '<details><summary>' + x(title) + '</summary>' + record(value) + '</details>'
const tag = value => '<span class="tag ' + x(value) + '">' + x(states[value] ?? value) + '</span>'
const card = (html, cls = '') => '<section class="panel ' + cls + '">' + html + '</section>'
const row = html => '<div class="row actions">' + html + '</div>'
const is = role => session?.role === role
const cur = (type, lang) => project?.artifacts[project.current[type + (lang ? ':'+lang : '')]]
const active = (step, lang) => project?.confirmations[project.active[step + (lang ? ':'+lang : '')]]
const base = () => '/api/projects/' + project.id
const media = ref => base() + '/media/' + encoded(ref)
const statusHeading = (title, artifact) => '<div class="spread"><h2>' + x(title) + '</h2>' + (artifact ? tag(artifact.status) : '') + '</div>'
const version = item => item ? '<p class="label">' + x(item.ref) + (item.upstream ? ' · 依据 ' + x(item.upstream) : '') + '</p>' : ''
const note = item => item?.note ? '<p class="text">退回意见 · ' + x(item.note) + '</p>' : ''
const video = (url, name) => '<video controls playsinline preload="metadata" src="' + x(url) + '" aria-label="' + x(name) + '"></video>'
const picture = (ref, name) => '<img class="frame" src="' + x(media(ref)) + '" alt="' + x(name) + '">'
const audio = (ref, name) => '<audio controls preload="metadata" src="' + x(media(ref)) + '" aria-label="' + x(name) + '"></audio>'
function imagePicker(name, current, items) {
  const unique=[...new Map(items.filter(Boolean).map(a => [a.ref,a])).values()]
  return '<div class="asset-picker">' + select(name,[option("","请选择图片"),...unique.map((a,i) => option(a.ref,(a.filename || (a.reuse ? '沿用图片' : '候选图片 '+(i+1))) + ' · ' + a.ref,a.ref === current))]) + '<img class="asset-picker-preview" alt="新选择的图片预览" data-current-ref="' + x(current ?? '') + '" hidden></div>'
}
const languageOptions = values => Object.entries(langs).map(([code,name]) => '<label class="label-inline"><input type="checkbox" name="language" value="' + code + '"' + (values?.includes(code) ? ' checked' : '') + '> ' + name + '</label>').join('')
const actorName = account => project?.member_profiles?.[account]?.name ?? (account === 'reviewer_wu' ? labels.reviewer : labels[Object.keys(actors).find(key => actors[key] === account)] || account)
function button(label, fn, cls = '', disabled = false, attrs = '') {
  const id = String(++serial)
  actions.set(id, fn)
  const icon = cls.includes('side-projects') ? '▦' : cls.includes('side-inbox') ? '◉' : cls.includes('side-jobs') ? '▤' : cls.includes('side-config') ? '⚙' : cls.includes('side-team') ? '♙' : ''
  return '<button type="button" class="btn ' + cls + '" data-action="' + id + '"' + (disabled ? ' disabled' : '') + ' ' + attrs + '>' + (icon ? '<span class="side-icon" aria-hidden="true">'+icon+'</span>' : '') + x(label) + '</button>'
}
function form(id, html) { return '<form id="' + id + '" autocomplete="off">' + html + '</form>' }
function getForm(element, fallback) {
  const node = element.closest('form') || document.getElementById(fallback)
  if (!node) throw new Error('找不到当前编辑表单')
  return new FormData(node)
}
function focusErrorField(field) {
  if (!field) return
  for (const node of document.querySelectorAll('[aria-invalid="true"]')) node.removeAttribute('aria-invalid')
  const aliases = { brief:'raw', target_languages:'language', languages:'language', wardrobe:'description' }
  let target
  if (field.startsWith('shots/')) {
    const index = Number(field.split('/')[1])
    const card = document.querySelectorAll('[data-shot-card]')[index]
    if (card) {
      const details = card.querySelector('details')
      if (details) details.open = true
      target = card.querySelector('textarea, input, select')
    }
  } else {
    const name = aliases[field] ?? field
    target = document.getElementsByName(name)[0] ?? document.getElementById(name)
    if (!target && field.includes('/')) target = document.getElementsByName(field.split('/').at(-1))[0]
  }
  if (!target) return
  target.setAttribute('aria-invalid', 'true')
  target.scrollIntoView({ behavior:'smooth', block:'center' })
  target.focus({ preventScroll:true })
}
function flash(text, error = false, field = '') {
  message.textContent = text
  message.hidden = false
  message.className = error ? 'error' : ''
  message.setAttribute('role', error ? 'alert' : 'status')
  clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { message.hidden = true }, error ? 8500 : 3400)
  if (error) focusErrorField(field)
}
async function api(path, method = 'GET', body, headers = {}) {
  const res = await fetch(path, { method, headers: { ...(body instanceof File ? {} : { 'Content-Type':'application/json' }), ...headers },
    body: body === undefined ? undefined : body instanceof File ? body : JSON.stringify(body) })
  const result = await res.json()
  if (!res.ok) {
    const error = new Error(result.message + (result.field ? ' · ' + result.field : ''))
    error.field = result.field
    throw error
  }
  return result
}
async function refreshProject() {
  if (!project) return
  project = await api(base())
  if (project.languages.length && !project.languages.includes(language)) language = project.languages[0]
}
async function refreshModelConfig() {
  if (!project) return
  try { modelConfig = await api(base() + '/model-config') } catch { modelConfig = {} }
}
async function refreshDrafts() {
  if (!project) { serverDrafts = {}; return }
  try { serverDrafts = await api(base() + '/drafts') } catch { serverDrafts = {} }
}
async function refreshLists() {
  ;[projects, inbox, runtime, usageOverview] = await Promise.all([api('/api/projects'), api('/api/notifications'), api('/api/runtime'), api('/api/usage')])
}
async function write(path, body = {}) {
  const result = await api(base() + '/' + path, 'POST', { expected_version: project.version, ...body }, { 'Idempotency-Key': crypto.randomUUID() })
  await refreshProject()
  writeCount++
  return result.result
}
async function save(type, data, extra = {}) { return write('artifacts', { type, data, ...extra }) }
async function fileUpload(element, field, purpose, meta = {}) {
  const file = getForm(element).get(field)
  if (!file?.size) throw new Error('请先选择文件')
  const { result } = await api(base() + '/assets', 'POST', file, {
    'Idempotency-Key':crypto.randomUUID(), 'X-Expected-Version':String(project.version),
    'X-Asset-Purpose':purpose, 'X-Filename':encoded(file.name),
    ...(meta.reference_kind ? { 'X-Reference-Kind':meta.reference_kind } : {}),
    ...(meta.character_id ? { 'X-Character-Id':meta.character_id } : {}),
  })
  await refreshProject()
  return result
}
async function job(task, args = {}) {
  if (runtime.mode === 'dashscope' && remoteJobTasks.has(task) && !(task === 'translate' && args.language === 'zh-CN')) {
    let estimate = ''
    try {
      const preview = await api(base() + '/jobs/preview', 'POST', { task, ...args })
      if (preview.estimate?.mode === 'remote') estimate = (preview.estimate.low || preview.estimate.high
        ? '预估费用：¥' + Number(preview.estimate.low).toFixed(2) + '–¥' + Number(preview.estimate.high).toFixed(2) + '。'
        : '费用单价尚未配置，无法预估金额。') + preview.estimate.note + '。'
    } catch {}
    if (!confirm('此操作会调用真实 AI 模型，可能产生费用。' + estimate + '实际扣费以所用账号的账单为准。确认继续吗？')) return false
  }
  const request = await write('jobs', { task, ...args })
  if (request.plan.production && !request.plan.prompt_only && ['queued','running'].includes(request.state)) {
    flash('任务已提交，可继续制作其他镜头。请在任务与用量页刷新状态。')
    return request
  }
  let result
  for (let i = 0; i < 100; i++) {
    result = await api(base() + '/jobs/' + request.id)
    if (!['queued','running'].includes(result.state)) break
    await new Promise(resolve => setTimeout(resolve, 550))
  }
  await refreshProject()
  if (result.state === 'failed') {
    render()
    throw new Error(result.error.message + (result.error.field ? ' · ' + result.error.field : ''))
  }
  if (result.state !== 'succeeded') {
    tab = 'jobs'
    flash('任务状态 · ' + states[result.state])
  }
  return result
}
const decision = (step, item, outcome, args = {}) => write('checkpoints/' + step + '/decide', { ref: item.ref, upstream: item.upstream, decision: outcome, ...args })
const submit = item => write('artifacts/' + encoded(item.ref) + '/submit')
function approve(step, item, args = {}, title = '通过' + checkpointName(step)) {
  return button(title, async () => { await decision(step, item, 'approve', args); flash('已确认 ' + item.ref) }, 'primary')
}
function returnBox(step, item) {
  return form('return-' + item.ref, label('退回意见', area('note', '')) +
    button('退回修改', el => decision(step, item, 'return', { note: getForm(el).get('note') }), 'small'))
}
function history(type, selectedLang) {
  const items = Object.values(project.artifacts).filter(item => item.type === type && (!selectedLang || item.language === selectedLang)).reverse()
  if (!items.length) return ''
  return '<details><summary>历史版本 · ' + items.length + '</summary>' +
    items.map(item => '<div class="list-item"><div class="spread"><b>' + x(item.ref) + '</b>' + tag(item.status) + '</div>' + note(item) +
      '<small>' + x(actorName(item.author)) + ' · ' + x(new Date(item.at).toLocaleString('zh-CN')) + '</small>' + show(item.data, '产物内容') +
      (is('director') && types.includes(item.type) && item.ref !== cur(item.type,item.language)?.ref ?
        row(button('恢复为新草稿',async()=>{
          if (!confirm('恢复这个历史版本会重开受影响的下游确认，但不会覆盖历史文件或成片。继续吗？')) return false
          const restored=await write('artifacts/'+encoded(item.ref)+'/restore',{})
          flash('已从 '+item.ref+' 恢复为 '+restored.ref)
        },'small ghost')) : '') + '</div>').join('') + '</details>'
}
function enter(id, next = 'brief') {
  view = 'project'
  tab = next
  focus = ''
  completedEdit = false
  taskPreview = null
  return api('/api/projects/' + id).then(async value => {
    project = value
    language = project.languages.includes(language) ? language : project.languages[0] ?? 'zh-CN'
    await Promise.all([refreshModelConfig(), refreshDrafts()])
    window.history.replaceState({}, '', '#project/' + project.id + '/' + tab)
  })
}
function switchTab(next) {
  tab = next
  focus = ''
  window.history.replaceState({}, '', '#project/' + project.id + '/' + tab)
}
function loginPage() {
  return '<header><span class="brand"><span class="brand-name">INREEL</span><span class="brand-divider"></span><span class="brand-product">短片制作台</span></span></header><main class="login">' +
    card('<h1>登录工作台</h1><p class="subhead">使用分配的账号进入项目。</p>' +
      '<div class="role-summary"><b>三个正式岗位</b><p>运营负责需求、创意与剧情剧本确认和成片验收；编导负责分镜脚本、画面、语言素材与人工看片质检；负责人查看进度、成果和用量并反馈。</p><p>“审核”是流程中的动作，不是第四个岗位。旧项目历史记录会保留，但当前登录入口不再展示审核账号。</p></div>' + form('login',
      label('账号', '<input name="account" list="known-accounts" autocomplete="username" placeholder="输入团队账号"><datalist id="known-accounts">' + Object.values(actors).map(user => option(user,user)).join('') + '</datalist>') +
      label('密码', input('password', '', 'password')) + row(button('登录', async el => {
        const data = getForm(el)
        session = await api('/api/login', 'POST', Object.fromEntries(data))
        await refreshLists()
        const route = location.hash.slice(1).split('/')
        if (route[0] === 'project' && projects.some(p => p.id === route[1])) await enter(route[1], allTabs.includes(route[2]) ? route[2] : 'brief')
      }, 'primary'))) + '<p class="label">演示账号可使用 lin-demo / zhou-demo / chen-demo；团队账号使用管理员设置的密码。</p>' +
      '<details class="team-register"><summary>创建新的团队运营账号</summary>' + form('register',
        label('团队运营账号', input('account', '', 'text')) +
        label('显示名称', input('name', '', 'text')) +
        label('初始密码（至少 8 位）', input('password', '', 'password')) +
        row(button('创建团队并登录', async el => {
          session = await api('/api/register', 'POST', Object.fromEntries(getForm(el)))
          await refreshLists()
          render()
        }, 'primary'))) + '</details>') + '</main>'
}
function roleGuide() {
  const roles = [
    ['运营', '需求、创意选择、剧情剧本确认、成片验收和下载', '对“做什么、能不能交付”负责'],
    ['编导', '分镜、素材、镜头、接镜、语言素材和人工看片质检', '对“怎么拍、画面能不能用”负责'],
    ['负责人', '只读查看进度、版本、成果和用量，向编导反馈', '对业务方向和风险提出意见，不改确认记录'],
  ]
  return card('<div class="spread"><div><span class="eyebrow">ROLE GUIDE</span><h2>三个岗位，审核分散在流程里</h2></div><span class="tag">没有独立审核岗</span></div>' +
    '<p class="muted">每到一个确认节点，由当前岗位完成该段工作的检查；通过后自动开放下一步。负责人反馈不会代替运营或编导的确认。</p>' +
    '<div class="role-guide">' + roles.map(([name,work,accountability], index) =>
      '<article><span>' + String(index + 1).padStart(2,'0') + '</span><div><h3>' + x(name) + '</h3><b>' + x(work) + '</b><p>' + x(accountability) + '</p></div></article>').join('') + '</div>', 'role-guide-card')
}
function projectsPage() {
  const list = projects.map(item => {
    const state = item.task_state ?? { stage:'制作中', action:'打开项目查看详情', actor:null, my_turn:false,
      progress:{ confirmed:0, total:4 + (item.languages?.length ?? 0) * 2 } }
    return card('<div class="project-card-top"><span class="project-card-icon" aria-hidden="true">▶</span><div class="project-card-tags">' +
      (state.my_turn ? '<span class="tag pending_review">待我处理</span>' : '') +
      '<span class="tag">' + x(state.progress.confirmed + ' / ' + state.progress.total + ' 节点确认') + '</span></div></div><h2>' + x(item.title) + '</h2>' +
      '<p class="project-card-stage"><b>' + x(state.stage) + '</b><span>' + x(state.action) + '</span></p>' +
      '<p class="muted">' + (item.number > 1 ? '第 ' + x(item.number) + ' 集 · ' : '') +
      x(item.languages.map(lang => langs[lang]).join(' · ') || '待定语种') + '</p>' +
      '<div class="project-card-bottom">' + button(state.my_turn ? '去处理' : '打开项目', () => enter(item.id, state.tab ?? 'brief'), state.my_turn ? 'small primary' : 'small') + '</div>', 'project-card' + (state.my_turn ? ' needs-me' : ''))
  }).join('')
  const customOperator = !Object.values(actors).includes(session.account)
  const teamFields = '<details class="team-fields"' + (customOperator ? ' open' : '') + '><summary>团队成员账号</summary>' +
    '<p class="muted">新账号填写姓名和至少 8 位初始密码；已有成员只填账号，密码留空。</p><div class="grid">' +
    label('编导账号',input('director_account','','text')) + label('编导姓名',input('director_name','','text')) + label('编导初始密码',input('director_password','','password')) + '</div><div class="grid">' +
    label('负责人账号',input('owner_account','','text')) + label('负责人姓名',input('owner_name','','text')) + label('负责人初始密码',input('owner_password','','password')) + '</div></details>'
  const memberData = data => {
    const value = role => {
      const account = String(data.get(role + '_account') ?? '').trim()
      if (!account) return null
      return { account, name:String(data.get(role + '_name') ?? '').trim(), password:String(data.get(role + '_password') ?? '') }
    }
    return { director:value('director') ?? undefined, owner:value('owner') ?? undefined }
  }
  const newProject = is('operations') ? card('<h2>新建项目</h2>' + form('new', label('项目名称', input('title')) + teamFields +
    '<p class="muted">新项目只绑定运营、编导、负责人三个岗位。审核动作按阶段由对应岗位完成，“确认节点 6：成片交付”默认由运营负责。</p>' + row(
    button('创建项目', async el => {
      const data = getForm(el)
      const p = await api('/api/projects', 'POST', { title:data.get('title'), members:memberData(data) })
      await refreshLists(); await enter(p.id)
    }, 'primary') + button('创建《末班车之后》案例', async el => {
      const data = getForm(el)
      const sample = await api('/api/sample')
      const p = await api('/api/projects', 'POST', { title:sample.title, members:memberData(data) })
      await enter(p.id)
      await write('brief', { data: sample.brief })
      await refreshLists()
    })))) : ''
  return '<div class="heading page-heading"><div><p class="eyebrow">CREATOR STUDIO <span>/</span> 工作台</p><h1>项目空间</h1><p class="subhead">从创意到成片，让每一步创作都有迹可循。</p></div><div class="heading-stat"><strong>' + projects.length + '</strong><span>个项目</span></div></div>' +
    roleGuide() +
    '<div class="section-heading"><div><span class="eyebrow">YOUR PROJECTS</span><h2>我的项目</h2></div></div>' +
    (list ? '<div class="grid project-grid">' + list + '</div>' : card('<p class="muted">暂无分配给当前账号的项目。</p>')) + newProject
}
function inboxPage() {
  const destination = { brief:'brief', concept:'story', script:'story', storyboard:'shots', cut:'shots', language:'language', delivery:'delivery' }
  const actionLabel = { brief_submitted:'准备创意', review:'去处理', returned:'查看退回原因', approved:'查看结果', select_languages:'选择语种', owner_feedback:'查看反馈' }
  const itemCard = item => {
    const needsAction = !item.closed_at && !['approved'].includes(item.kind)
    return '<div class="list-item notice-card ' + (!item.read_at ? 'notice-unread' : '') + '"><div class="spread"><div><b>' +
      x(notifications[item.kind]) + '</b><p class="notice-project">' + x(item.title + (item.language ? ' · ' + langs[item.language] : '')) + '</p></div>' +
      tag(item.closed_at ? '已处理' : needsAction ? '待处理' : item.read_at ? '已读' : '未读') + '</div>' +
      (item.note ? '<p class="text notice-reason">' + x(item.note) + '</p>' : '') +
      '<div class="notice-foot"><small>' + x(actorName(item.from) + ' · ' + new Date(item.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})) + (item.ref ? ' · 版本 ' + item.ref.split('@').at(-1) : '') + '</small>' +
      button(item.closed_at ? '查看结果' : actionLabel[item.kind] ?? '打开', async () => {
        await enter(item.project_id)
        if (!item.read_at) await write('notifications/' + item.id + '/read')
        switchTab(destination[project.artifacts[item.ref]?.type] ?? 'brief')
        focus = item.ref ?? ''
        if (item.language) language = item.language
        await refreshLists()
      }, needsAction ? 'small primary' : 'small') + '</div></div>'
  }
  const actionable = inbox.filter(item => !item.closed_at && !['approved'].includes(item.kind))
  const updates = inbox.filter(item => !item.closed_at && item.kind === 'approved')
  const history = inbox.filter(item => item.closed_at)
  const section = (title, items, noteText='') => items.length ? '<section class="notice-group"><div class="section-heading"><div><span class="eyebrow">INBOX</span><h2>' + title + '</h2></div><span class="workflow-count">' + items.length + '</span></div>' + (noteText ? '<p class="muted">' + x(noteText) + '</p>' : '') + '<div class="list">' + items.map(itemCard).join('') + '</div></section>' : ''
  const body = section('待我处理',actionable,'这些消息会打开对应项目版本，并标为已读。') + section('需要关注',updates) + section('历史记录',history)
  return '<div class="heading"><h1>站内通知</h1><p class="subhead">先处理与你当前角色有关的消息。</p></div>' + (body || card('<p class="muted">暂无通知。</p>'))
}
function briefPage() {
  const brief = cur('brief_draft')?.data ?? project.brief
  const item = cur('brief')
  const completed = project.languages.length > 0 && project.languages.every(code => active(6, code))
  const sourceAsset = project.assets[brief.source_ref]
  const producer = latestJob('producer', j => j.state === 'succeeded')?.result?.data
  const readableFact = item => typeof item === 'string' ? item : item?.text ?? item?.fact ?? item?.statement ?? item?.value ?? JSON.stringify(item)
  const targetLanguages = item
    ? [...new Set([...(brief.target_languages ?? []), ...project.languages])]
    : brief.target_languages ?? (project.languages.length ? project.languages : ['zh-CN'])
  const draftData = el => {
    const f = getForm(el)
    return { ...brief, raw:f.get('raw'), source_ref:f.get('source') || null, goal:f.get('goal'), theme:f.get('theme'), target_duration_ms: Number(f.get('duration'))*1000,
      target_languages:f.getAll('language'), due:f.get('due'), audience:f.get('audience'), planned_shot_count:Number(f.get('shots')) }
  }
  const editable = form('brief-editor',
    '<div class="grid">' + label('制作目标', select('goal', [option('series_promotion','短剧宣推', brief.goal !== 'original_validation'), option('original_validation','原创验证', brief.goal === 'original_validation')])) +
    label('故事关系', select('theme', [option('','请选择……',!brief.theme), option('GL','女性 × 女性（GL）',brief.theme === 'GL'), option('BL','男性 × 男性（BL）',brief.theme === 'BL')])) +
    label('目标时长（秒）', input('duration', (brief.target_duration_ms ?? 36000)/1000, 'number')) +
    label('计划镜头数', input('shots', brief.planned_shot_count ?? 5, 'number')) + '</div>' +
    label('想法或原剧脚本', area('raw', brief.raw)) +
    '<div class="grid">' + label('目标受众', input('audience', brief.audience)) + label('期望交付时间', input('due', brief.due, 'date')) + '</div>' +
    label('已有剧本', select('source', [option('','从想法开始'), ...Object.values(project.assets).filter(a => a.kind === 'script').map(a => option(a.ref,a.filename,a.ref === brief.source_ref))])) +
    label('上传剧本（TXT / MD / DOCX / DOC）', '<input type="file" name="document" accept=".txt,.md,.markdown,.docx,.doc">') +
    button('上传并查看提取文本', async el => {
      const data = draftData(el)
      const asset = await fileUpload(el, 'document', 'script')
      await write('brief', { data: { ...data, source_ref:asset.ref } })
    }, 'small') +
    (sourceAsset?.text ? '<div class="list-item text">' + x(sourceAsset.text) + '</div>' : '') +
    '<fieldset><legend>目标语种（至少选一种）</legend><div class="row">' + languageOptions(targetLanguages) + '</div></fieldset>' +
    row(button('保存草稿', el => write('brief', { data:draftData(el) })) +
      button('提交给编导', el => write('brief/submit', { data:draftData(el) }), 'primary') +
      button('AI 整理需求', async el => { await write('brief', { data:draftData(el) }); await job('producer') }, 'ghost') +
      (item ? button('追加所选语种', el => write('languages', { languages:getForm(el).getAll('language') }), 'ghost') : '')))
  const episode = project.episode
  const previous = episode ? '<p class="muted">' + x('接续《' + episode.previous_title + '》 · ' + episode.board_ref) + '</p>' +
    (episode.ending ? '<p class="text">' + x('上集结尾：' + episode.ending) + '</p>' : '') : ''
  const producerCard = producer?.normalized_brief ? card('<div class="spread"><h2>制片整理建议</h2>' + tag('未应用') + '</div><p class="muted">这是 AI 对原文的整理结果，不会自动覆盖你的 Brief。核对后再写入草稿。</p>' +
    '<div class="producer-summary">' + Object.entries({
      goal:'制作目标', theme:'故事关系', premise:'故事前提', audience:'目标受众', hook:'开场钩子',
      ending_constraint:'结尾限制', target_duration_ms:'目标时长（毫秒）', target_languages:'目标语种',
    }).filter(([key]) => producer.normalized_brief[key] != null).map(([key,name]) => '<div><span>'+x(name)+'</span><b>'+x(Array.isArray(producer.normalized_brief[key]) ? producer.normalized_brief[key].join('、') : producer.normalized_brief[key])+'</b></div>').join('') + '</div>' +
    (producer.facts?.length ? '<p class="text"><b>提取事实</b><br>'+x(producer.facts.map(readableFact).join('；'))+'</p>' : '') +
    (producer.missing_fields?.length ? '<p class="text"><b>仍待补充</b><br>'+x(producer.missing_fields.map(readableFact).join('；'))+'</p>' : '') +
    (producer.proposed_characters?.length ? '<p class="text"><b>候选角色</b><br>'+x(producer.proposed_characters.map(person => person.name).join('、'))+'</p>' : '') +
    row(button('把制片摘要填入草稿',()=>write('brief',{data:{...brief,...producer.normalized_brief,target_languages:producer.normalized_brief.target_languages ?? brief.target_languages,planned_shot_count:producer.normalized_brief.planned_shot_count ?? brief.planned_shot_count}}),'small primary'))) : ''
  return card(statusHeading('运营 Brief', item) + version(item) + previous +
    (completed && !completedEdit ? '<p class="job-notice">项目已完成。需求内容默认只读，避免误改已通过的分镜、语言素材和成片。</p>' : '') +
    (completed && completedEdit ? '<p class="job-notice">修改模式已开启：保存或重新提交需求会重开下游确认，历史版本和已通过文件仍会保留。</p>' : '') +
    (is('operations') && (!completed || completedEdit) ? editable : item ? '<p class="text">' + x(item.data.raw || item.data.source_script) + '</p>' + show(item.data, '需求规格') : '<p class="muted">等待运营提交 Brief。</p>') +
    (is('operations') && completed && !completedEdit ? row(button('修改需求并重开流程',() => {
      if (!confirm('修改需求会使后续确认失效，并需要重新制作或审核。已有历史文件会保留。继续吗？')) return false
      completedEdit = true
    },'small')) : '') + history('brief')) + producerCard
}
function latestJob(task, predicate = () => true) {
  return Object.values(project.jobs).reverse().find(j => j.plan.task === task && predicate(j))
}
async function showTaskPreview(key, task, args = {}) {
  try {
    const data = await api(base() + '/jobs/preview', 'POST', { task, ...args })
    taskPreview = { key, data, at:Date.now() }
    render()
  } catch (error) {
    flash(error.message, true, error.field)
  }
  return false
}
function previewPanel(key) {
  if (taskPreview?.key !== key) return ''
  const preview = taskPreview.data, plan = preview.plan, input = plan.input ?? {}
  const refs = [
    input.keyframe_ref && { ref:input.keyframe_ref, role:'严格首帧' },
    ...(plan.production?.references ? Object.entries(plan.production.references).map(([role,ref]) => ({ ref, role:{ location:'场景', prop:'道具', layout:'俯视调度图' }[role] ?? role })) : []),
    ...(input.character_references ?? []).map(item => ({ ref:item.asset_ref, role:'角色参考 · ' + item.character_id })),
    ...(plan.video_references ?? []),
    ...(input.reference_assets ?? []).map(item => ({ ref:item.asset_ref, role:'剧本/角色参考素材' })),
  ].filter(item => item?.ref)
  const uniqueRefs = [...new Map(refs.map(item => [item.ref + '|' + item.role,item])).values()]
  return '<section class="task-preview-card"><div class="spread"><div><span class="eyebrow">GENERATION PREFLIGHT</span><h3>' + x((usageJobLabels[preview.task] ?? preview.task) + ' · 生成前检查') + '</h3></div><span class="tag">' + (preview.real_call ? '真实模型调用' : '当前模式') + '</span></div>' +
    '<p class="muted">这里只显示会随生成请求发送的素材。最终自然语言提示词需要在下方“准备提示词”后查看和修改。</p>' +
    (preview.estimate ? '<div class="cost-estimate"><b>费用预估</b><span>' + x(preview.estimate.mode === 'local' ? '本地模拟不产生模型费用' : (preview.estimate.low || preview.estimate.high ? '¥' + Number(preview.estimate.low).toFixed(2) + '–¥' + Number(preview.estimate.high).toFixed(2) : '费用单价未配置') + ' · ' + preview.estimate.note) + '</span></div>' : '') +
    '<div class="preview-section"><h4>将使用的素材</h4>' + (uniqueRefs.length ?
      '<div class="preview-assets">' + uniqueRefs.map(item => '<div><b>' + x(item.role) + '</b><small>' + x(item.ref) + '</small>' + (project.assets[item.ref]?.kind === 'image' ? picture(item.ref,item.role) : '') + '</div>').join('') + '</div>' :
      '<p class="muted">没有额外图片素材；本次只使用结构化剧本和项目设置。</p>') + '</div>' +
    (preview.skill ? '<div class="preview-section"><h4>工作方法</h4><p><b>' + x(preview.skill.id + ' @ ' + preview.skill.version) + '</b></p><p class="muted">' + x(preview.skill.adaptation) + '</p></div>' : '') +
    '</section>'
}
function generatedPromptReport(key, task, predicate = () => true) {
  const generated = latestJob(task, job => job.state === 'succeeded' && predicate(job))
  if (!generated) return ''
  const prompt = generated.provider_receipts?.compiled_request?.prompt
  if (!prompt) return ''
  return '<details class="prompt-details"><summary>最近一次' + x(usageJobLabels[task] ?? task) + '实际发送给模型的提示词</summary>' +
    '<pre class="prompt-text">' + x(prompt) + '</pre></details>'
}
const taskPreviewKey = (task, args) => task + ':' + (args.language ?? 'source') + ':' + (args.shot_id ?? args.character_id ?? 'all')
function promptTools(task, argsFor, media = '生图') {
  return button('查看生成素材',el=>showTaskPreview(taskPreviewKey(task,argsFor(el)),task,argsFor(el)),'small ghost') +
    button('准备'+media+'提示词',async el=>{
      await job(task,{...argsFor(el),prompt_only:true})
      flash(media+'提示词已准备，可在下方查看和修改')
    },'small ghost')
}
function promptPlanEditor(task, args) {
  const prepared = latestJob(task, job => job.plan.prompt_only && job.state === 'succeeded' &&
    (args.shot_id == null || job.plan.shot_id === args.shot_id) && (args.character_id == null || job.plan.character_id === args.character_id) &&
    (args.language == null || job.plan.language === args.language))
  const result = prepared?.result?.response?.result
  if (!result) return ''
  const image = prepared.plan.agent === 'art'
  const id = 'prompt-plan-' + task + '-' + (args.language ?? 'source') + '-' + (args.shot_id ?? args.character_id ?? 'all')
  const natural = image
    ? [result.image_prompt, result.composition && '构图：' + result.composition, result.avoid?.length && '避免：' + result.avoid.join('，')].filter(Boolean).join('\n')
    : [result.video_prompt, result.avoid?.length && '避免：' + result.avoid.join('，')].filter(Boolean).join('\n')
  return '<details class="prompt-editor" data-disclosure="'+x(id)+'"><summary>查看并修改最终'+x(image?'生图':'生视频')+'提示词 · '+x(prepared.id.slice(0,8))+'</summary>' +
    '<p class="muted">修改文字后可直接生成。如果更换首帧、人物/场景/道具参考或生成模式，请先重新准备提示词，使结构参数与最新素材一致。</p>' +
    form(id,
      label('实际发送给模型的自然语言',area('prompt',natural,'prompt-input')) +
      row(button('使用修改后的提示词生成',el=>{
        const values=getForm(el)
        const next=structuredClone(result)
        if (image) {
          next.image_prompt=String(values.get('prompt')).trim()
          next.composition=''
        } else next.video_prompt=String(values.get('prompt')).trim()
        next.avoid=[]
        if (image) next.continuity_checks=[]
        const preparedArgs={
          ...args,
          ...(prepared.plan.shot_id ? {shot_id:prepared.plan.shot_id} : {}),
          ...(prepared.plan.character_id ? {character_id:prepared.plan.character_id} : {}),
          ...(prepared.plan.language ? {language:prepared.plan.language} : {}),
          ...(prepared.plan.input?.task_request ? {task_request:prepared.plan.input.task_request} : {}),
          ...(prepared.plan.video_mode ? {video_mode:prepared.plan.video_mode} : {}),
          ...(prepared.plan.video_references ? {reference_images:prepared.plan.video_references} : {}),
        }
        return job(task,{...preparedArgs,prepared_plan:{status:'ok',issues:[],result:next}})
      },'primary small'))) + '</details>'
}
function agentAdvice(targetRefs = []) {
  if (!targetRefs.length) return ''
  const job = latestJob('director', j => j.state === 'succeeded' && (j.plan.input?.artifact_refs ?? []).some(ref => targetRefs.includes(ref)))
  if (!job) return ''
  const result = job.result?.response?.result
  if (!result) return ''
  const activeTaskStates = new Set(Object.values(project.jobs)
    .filter(item => ['queued','running','awaiting_query','failed'].includes(item.state))
    .map(item => item.plan.task))
  const blockers = (job.plan.input?.blocking_issues ?? []).filter(item => {
    if (!/(结果未知|任务失败|任务仍在处理中)/.test(item.message)) return true
    const task = Object.entries(usageJobLabels).find(([, label]) => item.message.startsWith(label))?.[0]
    return !task || activeTaskStates.has(task)
  })
  return card('<div class="spread"><h2>导演建议</h2>' + tag('仅供参考') + '</div><p class="text">' +
    x(result.deliverable || '查看当前阶段的下一步建议') + '</p>' +
    (blockers.length ? '<div class="agent-blockers"><b>服务端识别的阻塞</b><ul class="agent-actions">' + blockers.map(item => '<li>' + x(item.message) + '</li>').join('') + '</ul></div>' : '') +
    (result.actions?.length ? '<ul class="agent-actions">' + result.actions.map(action => '<li>' + x(action) + '</li>').join('') + '</ul>' : '') +
    '<p class="muted">Agent 建议不会改动确认记录、镜头选版或流程状态。</p>' + show(job.result.response, '查看结构化建议'))
}
function generation(task, args, title, previous) {
  return button(title, () => job(task, previous ? { ...args, retry_of:previous.id } : args), previous ? 'ghost small' : 'small')
}
function jsonEditor(id, field, data, text, fn) {
  return form(id, label(text, area(field, JSON.stringify(data,null,2),'json')) +
    row(button('保存新版本', el => {
      let value
      try { value = JSON.parse(getForm(el).get(field)) } catch { throw new Error('编辑区不是有效 JSON') }
      return fn(value)
    }, 'small')))
}
function storyPage() {
  const idea = cur('concept')
  const script = cur('script')
  const board = cur('storyboard')
  const cards = cur('characters')
  const director = is('director')
  const ops = is('operations')
  const creativeJob = latestJob('creative')
  const writerJob = latestJob('writer')
  const boardJob = latestJob('storyboard')
  const shotLanguagePattern = /(镜头|景别|机位|运镜|特写|中景|近景|全景|俯拍|仰拍|推镜|拉镜|摇镜|切镜)/
  const editor = director && cur('brief') ? card('<h2>主角草稿</h2>' + form('character-cards',
    '<div class="grid">' + [0,1].map(index => {
      const c = cards?.data[index] || {}
      return '<div class="list-item"><h3>主角 ' + (index+1) + '</h3>' +
        label('姓名', input('name'+index,c.name)) + label('外观和关系', input('description'+index,c.description)) +
        label('动机', input('goal'+index,c.goal)) + '</div>'
    }).join('') + '</div>' + row(button('保存角色草稿', el => {
      const f = getForm(el)
      return write('characters',{data:[0,1].map(i => ({ character_id:cards?.data[i]?.character_id || 'person_'+(i+1), name:f.get('name'+i), description:f.get('description'+i), goal:f.get('goal'+i) }))})
    }) + button('载入案例角色', async () => write('characters', { data:(await api('/api/sample')).characters }), 'ghost') +
      button('采用制片角色建议', () => write('characters',{data:latestJob('producer', j => j.state === 'succeeded').result.data.proposed_characters}), 'ghost',
        !latestJob('producer', j => j.state === 'succeeded'))))) : ''
  const chosen = active(1) && active(1).artifact_ref === idea?.ref ? active(1).candidate : null
  const conceptCard = (c, index) => '<div class="list-item concept-card"><div class="spread"><h3>' + x(c.title) + '</h3>' + (chosen === c.concept_key ? tag('已选方向') : '') + '</div>' +
    (shotLanguagePattern.test([c.hook,c.conflict,c.turn,c.ending].join(' ')) ? '<p class="job-notice">这个创意包含景别或镜头语言。建议在这里改回剧情描述，镜头安排留到分镜脚本。</p>' : '') +
    [['开场',c.hook],['冲突',c.conflict],['转折',c.turn],['结尾',c.ending]].map(([name,value]) => '<div class="concept-field"><b>' + name + '</b><p class="text">' + x(value) + '</p></div>').join('') +
    (c.new_elements?.length ? '<details><summary>新增的情节设定</summary><p class="text">' + c.new_elements.map(x).join('；') + '</p></details>' : '') +
    (ops && idea.status === 'pending_review' ? approve(1,idea,{candidate:c.concept_key},'选定这个方向') : '') +
    (director && ['draft','returned'].includes(idea.status) ? '<details><summary>修改这个方向</summary>' + form('concept-edit-'+index,
      [['title','标题'],['hook','开场'],['conflict','冲突'],['turn','转折'],['ending','结尾']].map(([key,name]) => label(name, key === 'title' ? input(key,c[key]) : area(key,c[key]))).join('') +
      button('保存创意修改',el => { const f=getForm(el); const revised=idea.data.concepts.map((item,i) => i !== index ? item : {...item, ...Object.fromEntries(['title','hook','conflict','turn','ending'].map(key => [key,String(f.get(key)).trim()]))}); return save('concept',{...idea.data,concepts:revised}) },'small')) + '</details>' : '') + '</div>'
  const conceptList = idea?.data.concepts.map((c,i) => ({c,i})) ?? []
  const chosenItem = conceptList.find(({c}) => c.concept_key === chosen)
  const concepts = chosenItem ? conceptCard(chosenItem.c,chosenItem.i) + '<details><summary>查看其他创意方向</summary><div class="grid">' + conceptList.filter(({c}) => c.concept_key !== chosen).map(({c,i}) => conceptCard(c,i)).join('') + '</div></details>' : '<div class="grid">' + conceptList.map(({c,i}) => conceptCard(c,i)).join('') + '</div>'
  const choice = card(statusHeading('创意方向', idea) + version(idea) + note(idea) + (idea ? '<p class="muted">' + (chosen ? '已选方向如下；其他方案仍可展开查看。' : ops && idea.status === 'pending_review' ? '比较以下方向，选定一个；不满意可以写意见退回。' : '先检查和修改内容，再提交运营选择。') + '</p>' + concepts : '<p class="muted">等待编导生成创意候选。</p>') +
    (director && cards ? row(generation('creative',{},creativeJob?.state === 'failed' ? '重试创意策划' : '生成创意方向',
      idea?.status === 'returned' || creativeJob?.state === 'failed' ? creativeJob : undefined) +
      (idea?.status === 'draft' ? button('提交运营选择',() => submit(idea),'primary') : '')) : '') +
    (ops && idea?.status === 'pending_review' ? returnBox(1,idea) : '') + history('concept'))
  const story = card(statusHeading('完整剧情剧本',script) + version(script) + note(script) +
    '<p class="job-notice">这一步只确认剧情：场景、人物动作、情绪和对白。景别、机位、运镜、镜头时长与承接属于下一步“分镜脚本”。</p>' +
    (script?.data.beats.some(beat => shotLanguagePattern.test(String(beat.scene ?? '') + ' ' + String(beat.action ?? ''))) ? '<p class="job-notice">当前版本包含历史镜头语言。已确认内容不会自动改写；如需规范，请修改剧情剧本并保存新版本，系统会阻止继续提交含镜头语言的剧情。</p>' : '') +
    (script ? '<h3>' + x(script.data.title) + '</h3><p>' + x(script.data.logline) + '</p><div class="list">' +
      script.data.beats.map(beat => '<div class="list-item"><b>' + x(beat.beat_id + ' · ' + beat.scene) + '</b><p>' + x(beat.action) + '</p>' +
        beat.dialogue.map(line => '<p class="muted">' + x((script.data.characters.find(c => c.character_id === line.speaker_id)?.name ?? line.speaker_id) + ' · ' + line.text) + '</p>').join('') + '</div>').join('') + '</div>' : '<p class="muted">运营选定创意后开放剧本。</p>') +
    (director && active(1) ? row(generation('writer',{},script?.status === 'returned' ? '按意见重写剧情剧本' : writerJob?.state === 'failed' ? '重试编剧' : '生成完整剧情剧本',
      writerJob?.state === 'failed' ? writerJob : undefined) +
      (script?.status === 'draft' ? button('提交剧情剧本确认',() => submit(script),'primary') : '')) : '') +
    (director && script && active(1) ? '<details><summary>修改完整剧情剧本</summary><p>这里修改剧情段落和对白，不填写景别、机位或镜头时长。保存后生成新版本' + (active(2) ? '，已确认的剧情和分镜需要重新确认。' : '，提交后由运营确认。') + '</p>' + form('script-edit',
      label('标题',input('title',script.data.title)) + label('一句话简介',area('logline',script.data.logline)) +
      '<div class="grid">' + label('开场钩子',area('hook',script.data.hook)) + label('核心冲突',area('conflict',script.data.conflict)) + label('转折',area('turn',script.data.turn)) + label('结尾',area('ending',script.data.ending)) + '</div>' +
      script.data.beats.map((beat,i) => '<div class="list-item"><h3>第 ' + (i+1) + ' 段</h3>' + label('场景',input('scene'+i,beat.scene)) + label('剧情动作',area('action'+i,beat.action)) + beat.dialogue.map((line,j) => '<div class="grid">' + label('说话人',select('speaker'+i+'_'+j,script.data.characters.map(c=>option(c.character_id,c.name,line.speaker_id===c.character_id)))) + label('对白',area('line'+i+'_'+j,line.text)) + '</div>').join('') + '</div>').join('') +
      button('保存剧情剧本修改',el => {const f=getForm(el); return save('script',{...script.data,title:String(f.get('title')).trim(),logline:String(f.get('logline')).trim(),hook:String(f.get('hook')).trim(),conflict:String(f.get('conflict')).trim(),turn:String(f.get('turn')).trim(),ending:String(f.get('ending')).trim(),beats:script.data.beats.map((beat,i) => ({...beat,scene:String(f.get('scene'+i)).trim(),action:String(f.get('action'+i)).trim(),dialogue:beat.dialogue.map((line,j) => ({...line,speaker_id:String(f.get('speaker'+i+'_'+j)),text:String(f.get('line'+i+'_'+j)).trim()}))}))},{rework:active(2) ? 'story' : undefined})},'small')) + '</details>' : '') +
    (ops && script?.status === 'pending_review' ? row(approve(2,script)) + returnBox(2,script) : '') + history('script'))
  const conversion = active(2) ? card('<div class="spread"><div><span class="eyebrow">STORY TO SHOT SCRIPT</span><h2>分镜脚本</h2></div>' + tag(board ? board.status : '待转换') + '</div>' +
    '<p class="muted">完整剧情剧本已经确认。下一步由编导把场景、动作和对白转换为可拍摄的镜头：补充景别、机位、起始画面、结束画面、镜头时长和前后承接。</p>' +
    (board ? '<div class="storyboard-script-summary"><p><b>' + x(board.ref) + '</b> · ' + x(board.data.shots.length + ' 个镜头 · ' + board.data.total_duration_ms/1000 + ' 秒') + '</p>' +
      '<div class="storyboard-script-shots">' + board.data.shots.map(shot=>'<div><b>'+x(shot.shot_id)+'</b><span>'+x(shot.framing+' · '+shot.duration_ms/1000+' 秒')+'</span><small>'+x(shot.action)+'</small></div>').join('')+'</div>' +
      row(button('打开分镜脚本',()=>switchTab('shots'),'small primary')) : '<p class="job-notice">剧情剧本确认后才会开放转换。转换会生成独立的分镜脚本版本，不会改写已确认的剧情。</p>' +
      (director ? row(button(boardJob?.state === 'failed' ? '重新转换分镜脚本' : '转换为分镜脚本',async()=>{await job('storyboard');switchTab('shots')},'primary')) : '<p class="muted">等待编导转换分镜脚本。</p>')) + '</div>') : ''
  return editor + choice + story + conversion
}
const shotFieldLabels = {
  purpose:'剧情目的', scene:'场景', framing:'景别与构图', camera:'机位与运镜', start_state:'起始画面',
  action:'动作', end_state:'结束画面', continuity:'镜间承接', duration_ms:'时长（秒）', location:'场景参考', prop:'道具参考', wardrobe:'服装版本',
}
const issueLabels = {
  identity:'人物身份', wardrobe:'服装造型', action:'动作', continuity:'镜间承接',
  prop:'道具', dialogue:'对白', emotion:'情绪', other:'其他',
}
function shotEditor(board, shot, candidates) {
  const fields = Object.keys(shotFieldLabels).filter(key => Object.hasOwn(shot,key))
  const observations = candidates.flatMap(candidate => (candidate.observations ?? []).map(item =>
    option(item.id, candidate.ref + ' · ' + issueLabels[item.category] + ' · ' + item.actual)))
  const revision = Object.values(project.artifacts).reverse().find(item => item.shot_revision?.shot_id === shot.shot_id)
  const recent = revision ? '<p class="muted">最近修改 · ' + x(revision.ref) + '</p>' +
    Object.entries(revision.shot_revision.changes).map(([key, change]) =>
      '<p class="text"><b>' + x(shotFieldLabels[key]) + '</b><br>' +
      x('原：' + shotFieldValue(key, change.before)) + '<br>' +
      x('新：' + shotFieldValue(key, change.after)) + '</p>').join('') : ''
  return '<details data-disclosure="edit-' + x(shot.shot_id) + '"><summary>修改此镜制作单</summary>' + recent +
    form('shot-edit-' + shot.shot_id, '<div class="grid">' + fields.map(key =>
      label(shotFieldLabels[key], key === 'duration_ms'
        ? '<input name="duration_ms" type="number" min="0.001" step="0.001" value="' + x(shot[key] / 1000) + '">'
        : area(key, shot[key]))).join('') + '</div>' +
      (observations.length ? label('关联问题', select('observation_id', [option('','请选择'), ...observations])) : '') +
      row(button('保存此镜修改', async el => {
        const values = getForm(el)
        const changes = {}
        for (const key of fields) {
          const raw = String(values.get(key) ?? '').trim()
          const next = key === 'duration_ms' ? Math.round(Number(raw) * 1000) : raw
          if (next !== shot[key]) changes[key] = next
        }
        const result = await write('shots/' + encoded(shot.shot_id) + '/edit', {
          board_ref: board.ref, changes, observation_id: values.get('observation_id') || null,
        })
        flash(result.data.keyframes[shot.shot_id] ? '已保存，请确认新版分镜。' : '已保存，请重新选定此镜关键帧后确认分镜。')
      },'small'))) + '</details>'
}
function shotFieldValue(key, value) {
  if (key === 'wardrobe') return Object.values(value ?? {}).join('、') || '未设置'
  if (key === 'duration_ms') return value / 1000
  return value ?? '未设置'
}
const arrangementFields = [
  ['purpose','剧情作用'],['scene','场景'],['framing','景别与构图'],['camera','机位与运镜'],
  ['start_state','起始画面'],['action','核心动作'],['end_state','结束画面'],['continuity','与相邻镜头的承接'],
]
const arrangementKeyframeFields = new Set(['scene','framing','start_state'])
function shotLines(shot, script) {
  const beats = new Map(script.beats.map(beat => [beat.beat_id, beat]))
  return shot.beat_ids.flatMap(id => beats.get(id)?.dialogue ?? [])
}
function shotArrangementCard(shot, index, script, board) {
  const keyframe = board.data.keyframes?.[shot.shot_id]
  const people = script.characters.map(person =>
    '<label class="shot-choice"><input type="checkbox" data-field="character_ids" value="' + x(person.character_id) + '"' +
    (shot.character_ids?.includes(person.character_id) ? ' checked' : '') + '> <span>' + x(person.name) + '</span></label>').join('')
  const beats = script.beats.map(beat =>
    '<label class="shot-choice shot-beat-choice"><input type="checkbox" data-field="beat_ids" value="' + x(beat.beat_id) + '"' +
    (shot.beat_ids?.includes(beat.beat_id) ? ' checked' : '') + '> <span><b>' + x(beat.beat_id) + '</b> ' + x(beat.scene) + '</span></label>').join('')
  const lines = shotLines(shot, script)
  return '<article class="shot-arrange-card" data-shot-card data-shot-id="' + x(shot.shot_id) + '">' +
    '<header class="shot-arrange-head"><div><div class="shot-arrange-title"><span class="shot-sequence" data-shot-sequence>镜头 ' + (index + 1) + '</span><code data-shot-id-label>' + x(shot.shot_id) + '</code>' +
    '<span class="shot-duration" data-shot-duration>' + x(shot.duration_ms / 1000) + ' 秒</span></div><p data-shot-summary>' + x(shot.framing + ' · ' + shot.action) + '</p></div>' +
    '<div class="shot-order-actions" aria-label="调整镜头顺序"><button type="button" class="btn small ghost" data-shot-command="up" aria-label="上移镜头 ' + (index + 1) + '">↑ 上移</button>' +
    '<button type="button" class="btn small ghost" data-shot-command="down" aria-label="下移镜头 ' + (index + 1) + '">↓ 下移</button>' +
    '<button type="button" class="btn small danger-ghost" data-shot-command="delete" aria-label="删除镜头 ' + (index + 1) + '">删除</button></div></header>' +
    '<div class="shot-card-meta"><span>关键帧：' + x(keyframe || '待补') + '</span><span>出场：' + x(script.characters.filter(person => shot.character_ids?.includes(person.character_id)).map(person => person.name).join('、') || '无人物入画') + '</span><span data-shot-lines>' + (lines.length ? lines.length + ' 句对白' : '无对白') + '</span></div>' +
    '<details data-disclosure="arrange-' + x(shot.shot_id) + '"><summary>编辑镜头内容、人物与剧本段落</summary>' +
      '<div class="shot-field-grid">' + arrangementFields.map(([field, labelText], fieldIndex, values) =>
        label(labelText, area('shot_' + shot.shot_id + '_' + field, shot[field] ?? '', 'shot-field' + (fieldIndex === values.length - 1 ? ' shot-field-wide' : '')).replace('<textarea ', '<textarea data-field="' + field + '" '))).join('') +
        label('时长（秒）','<input data-field="duration_ms" name="shot_' + x(shot.shot_id) + '_duration_ms" type="number" min="0.001" step="0.1" value="' + x(shot.duration_ms / 1000) + '">') +
      '</div>' +
      '<div class="shot-choice-groups"><fieldset><legend>出场人物（最多两位）</legend><div class="row">' + people + '</div></fieldset>' +
      '<fieldset><legend>对应剧本段落</legend><p class="muted">段落决定本镜能使用的对白。需要改台词时，请回到剧本修改并重新确认。</p><div class="shot-beats">' + beats + '</div></fieldset></div>' +
      '<div class="shot-dialogue-preview" data-shot-dialogue>' + (lines.length ? lines.map(line => '<p><b>' + x(script.characters.find(person => person.character_id === line.speaker_id)?.name ?? line.speaker_id) + '</b> · ' + x(line.text) + '</p>').join('') : '<p class="muted">本镜没有对白。</p>') + '</div>' +
    '</details></article>'
}
function manualStoryboardDraft(script) {
  const count = Math.max(1, script.beats.length)
  const total = cur('brief')?.data.target_duration_ms ?? 24000
  const perShot = Math.max(2000, Math.round(total / count / 1000) * 1000)
  const duration = perShot * count
  return {
    shots: script.beats.map((beat, index) => ({
      shot_id: 'S' + String(index + 1).padStart(2, '0'),
      order: index + 1,
      beat_ids: [beat.beat_id],
      purpose: beat.emotion || '推进当前剧情',
      character_ids: [...new Set(beat.dialogue.map(line => line.speaker_id))],
      scene: beat.scene,
      framing: '中景',
      camera: '固定机位，9:16 竖屏',
      start_state: beat.action,
      action: beat.action,
      end_state: beat.action,
      continuity: index ? '延续上一镜的人物位置、服装、道具和光线' : '建立人物、空间与关键道具',
      duration_ms: perShot,
      dialogue: beat.dialogue,
    })),
    total_duration_ms: duration,
  }
}
function shotArrangement(board, script) {
  const shots = board.data.shots
  return '<details class="shot-arrangement" data-disclosure="shot-arrangement"><summary><span>编排分镜 · ' + shots.length + ' 个镜头 · ' + (board.data.total_duration_ms / 1000) + ' 秒</span><small>新增、删除、排序和修改镜头内容</small></summary>' +
    '<form id="shot-arrangement-form" class="shot-arrangement-form" data-board-ref="' + x(board.ref) + '">' +
      '<textarea hidden name="snapshot" data-shot-snapshot>' + x(JSON.stringify(shots)) + '</textarea>' +
      '<div class="shot-arrangement-toolbar"><div><h3>镜头编排</h3><p class="muted">镜头按从上到下的顺序进入剪辑。收起卡片仍可上移、下移或删除。</p></div>' +
      '<button type="button" class="btn small" data-shot-command="add">＋ 新增镜头</button></div>' +
      '<div class="shot-arrange-list" data-shot-cards>' + shots.map((shot,index) => shotArrangementCard(shot,index,script,board)).join('') + '</div>' +
      '<template data-new-shot-template>' + shotArrangementCard({ shot_id:'NEW', order:shots.length + 1, beat_ids:[], character_ids:[], purpose:'补充镜头', scene:'', framing:'中景', camera:'固定机位，竖屏 9:16', start_state:'', action:'', end_state:'', continuity:'', duration_ms:5000, dialogue:[] }, shots.length, script, board).replace(/data-shot-id="NEW"/, 'data-shot-id=""') + '</template>' +
      '<div class="shot-impact" data-shot-impact role="status" aria-live="polite">展开卡片修改内容，或用上移、下移调整顺序。保存后会生成新的分镜版本。</div>' +
      '<p class="shot-save-note">保存不会覆盖历史分镜、已确认版本或已有成片。改动后会进入新版分镜复核；仅受影响的首帧和视频需要重做。</p>' +
      row('<button type="button" class="btn small primary" data-shot-command="save">保存分镜新版本</button>') +
    '</form></details>'
}
const reuseCaption = ref => {
  const source = project.assets[ref]?.reuse
  return source ? '<small>' + x('沿用《' + source.episode_title + '》 · ' + source.version) + '</small>' : ''
}
function wardrobeControls(board, shot, characters) {
  const choices = board.data.production?.[shot.shot_id]?.wardrobe ?? {}
  return characters.filter(person => shot.character_ids.includes(person.character_id)).map(person => {
    const id = person.character_id
    const current = project.wardrobes?.[choices[id]]
    const versions = Object.values(project.wardrobes ?? {}).filter(version => version.character_id === id)
    const path = 'shots/' + encoded(shot.shot_id)
    return '<details data-disclosure="wardrobe-' + x(shot.shot_id + '-' + id) + '"><summary>' + x(person.name + '服装 · ' + (current?.ref ?? '待选')) + '</summary>' +
      (current ? '<p class="text">' + x(current.description) + '</p>' +
        (current.source ? '<small>' + x('来源《' + current.source.episode_title + '》 · ' + current.source.version) + '</small>' : '') : '') +
      (is('director') ? form('wardrobe-' + shot.shot_id + '-' + id,
        (versions.length ? label('服装版本', select('version', [option('', '请选择'), ...versions.map(v => option(v.ref, v.ref + ' · ' + v.description, current?.ref === v.ref))])) +
          button('应用到此镜', el => {
            const version = getForm(el).get('version')
            if (!version) throw new Error('请选择服装版本')
            return write(path + '/edit', { board_ref: board.ref, changes: { wardrobe: { [id]: version } } })
          },'small') : '') +
        label('新服装描述', area('description', current?.description ?? '')) +
        button('另存服装版本并应用到此镜', el => write(path + '/wardrobe', {
          board_ref: board.ref, character_id: id, description: getForm(el).get('description'),
        }), 'small')) : '') + '</details>'
  }).join('')
}
function candidateIssues(asset) {
  const marks = (asset.observations ?? []).map(item => '<li class="text">' +
    button((item.start_ms / 1000).toFixed(2) + '–' + (item.end_ms / 1000).toFixed(2) + ' 秒', el => {
      const player = el.closest('.shot-candidate').querySelector('video')
      player.currentTime = item.start_ms / 1000
      player.focus()
      return false
    }, 'small ghost') + ' ' + x(issueLabels[item.category]) + '<br>预期：' + x(item.expected) + '<br>实际：' + x(item.actual) + '</li>').join('')
  const editor = is('director') ? form('issue-' + asset.ref, label('问题类型', select('category',
    Object.entries(issueLabels).map(([key,value]) => option(key,value)))) + '<div class="grid shot-times">' +
    label('开始（秒）','<input name="start" type="number" min="0" step="0.001">') +
    label('结束（秒）','<input name="end" type="number" min="0" step="0.001">') + '</div>' +
    label('预期表现', area('expected','')) + label('实际表现', area('actual','')) +
    button('保存问题', async el => {
      const values = getForm(el)
      if (!values.get('start') || !values.get('end')) throw new Error('请填写标注的开始和结束时间')
      await write('shots/' + encoded(asset.shot_id) + '/observations', {
        ref: asset.ref, category: values.get('category'),
        start_ms: Math.round(Number(values.get('start')) * 1000), end_ms: Math.round(Number(values.get('end')) * 1000),
        expected: values.get('expected'), actual: values.get('actual'),
      })
      flash('已保存此候选的问题')
    }, 'small')) : ''
  return marks || editor ? '<details data-disclosure="issues-' + x(asset.ref) + '"><summary>问题标注' +
    (marks ? ' · ' + asset.observations.length : '') + '</summary>' + (marks ? '<ul class="shot-issues">' + marks + '</ul>' : '') + editor + '</details>' : ''
}
function assetsPage() {
  const board = cur('storyboard'), script = project.artifacts[active(2)?.artifact_ref], director = is('director')
  if (!board || !script) return card('<h2>素材</h2><p class="muted">确认剧情剧本并转换成分镜脚本后，在这里制作和选择人物、场景、道具与调度图。</p>' + button(!script ? '去确认剧情剧本' : '去转换分镜脚本',() => switchTab(!script ? 'story' : 'shots'),'small'))
  const images = Object.values(project.assets).filter(a => a.kind === 'image' && a.purpose === 'reference')
  const pick = (name, current, items) => imagePicker(name,current,items)
  const roles = script.data.characters.map(person => {
    const current = board.data.references?.[person.character_id], previous = latestJob('reference',j=>j.plan.character_id === person.character_id)
    const candidates = Object.values(project.assets).filter(a => a.kind === 'image' && (
      a.ref === current ||
      (a.job_id && project.jobs[a.job_id]?.plan.task === 'reference' && project.jobs[a.job_id]?.plan.character_id === person.character_id) ||
      (a.reuse?.kind === 'character' && a.reuse.character_id === person.character_id)
    ))
    return '<div class="list-item"><h3>' + x(person.name) + '</h3><p>' + x(person.description) + '</p>' + (current ? picture(current,person.name) : '<p>尚未选择人物参考图</p>') +
      (director ? form('asset-person-' + person.character_id, row(generation('reference',{character_id:person.character_id},'生成人物参考',previous && ['succeeded','failed'].includes(previous.state) ? previous : undefined)) +
        promptTools('reference',()=>({character_id:person.character_id}),'生图') +
        label('人物参考',pick('asset',current,candidates)) + button('保存人物选版',el=>write('characters/'+encoded(person.character_id)+'/reference',{board_ref:board.ref,ref:getForm(el).get('asset')}),'small') +
        label('上传人物参考','<input type="file" name="image" accept="image/png,image/jpeg,image/webp">') + button('上传并选用',async el=>write('characters/'+encoded(person.character_id)+'/reference',{board_ref:board.ref,ref:(await fileUpload(el,'image','reference',{character_id:person.character_id})).ref}),'small')) : '') +
        previewPanel(taskPreviewKey('reference',{character_id:person.character_id})) + promptPlanEditor('reference',{character_id:person.character_id}) + '</div>'
  }).join('')
  const locations = board.data.shots.map(shot => {
    const selected = board.data.production?.[shot.shot_id] ?? {}
    const layoutAssets=images.filter(a=>a.reference_kind==='layout' && a.source_location===selected.location && a.layout_spec?.confirmed)
    const coord=(name,value,max) => '<input type="number" name="'+x(name)+'" min="0" max="'+max+'" step="0.1" value="'+x(value)+'">'
    const existing=project.assets[selected.layout]?.layout_spec
    const personFields=script.data.characters.map((person,i)=>{
      const v=existing?.people?.find(p=>p.name===person.name) ?? {start_x:i?7:3,start_y:3,end_x:i?7:5,end_y:3}
      return '<div><b>'+x(person.name + (shot.character_ids.includes(person.character_id) ? ' · 本镜入画' : ' · 本镜画外'))+'</b><div class="grid">'+['start_x','start_y','via_x','via_y','end_x','end_y'].map((key,k)=>label(['起点 X','起点 Y','途经点 X（可选）','途经点 Y（可选）','终点 X','终点 Y'][k],coord('person_'+i+'_'+key,v[key] ?? '',key.endsWith('_x')?10:8))).join('')+
        label('人物面向',select('person_'+i+'_facing',['N','E','S','W'].map(d=>option(d,{N:'北',E:'东',S:'南',W:'西'}[d],(v.facing ?? 'N')===d))))+'</div></div>'
    }).join('')
    const o=existing?.objects?.[0] ?? {name:'柜台',x:4,y:5,w:4,h:1}
    const extraObjects=[1,2,3].map(i=>{const item=existing?.objects?.[i] ?? {name:'',x:'',y:'',w:'',h:''};return '<details><summary>补充固定物 '+i+'（可选）</summary>'+label('名称',input('object_'+i+'_name',item.name))+'<div class="grid">'+['x','y','w','h'].map((key,j)=>label(['中心 X','中心 Y','宽','深'][j],coord('object_'+i+'_'+key,item[key],key==='x'||key==='w'?10:8))).join('')+'</div></details>'}).join('')
    const cam=existing?.camera ?? {x:5,y:1,facing:'N'}
    const layoutForm=director && selected.location ? form('layout-'+shot.shot_id,
      '<p class="muted">以 10 × 8 的相对坐标绘制正俯视图；下方初值是示例，须按场景修改。画外区域请写明推测。</p>' +
      '<p class="muted">可拖动方块和圆点调整固定物、人物起终点与机位；坐标也可直接输入。</p><svg class="layout-editor" viewBox="0 0 10 8" role="img" aria-label="俯视布局编辑器"></svg>' +
      label('固定物名称',input('object_name',o.name)) + '<div class="grid">'+['x','y','w','h'].map((key,i)=>label(['固定物中心 X','固定物中心 Y','宽','深'][i],coord('object_'+key,o[key],key==='x'||key==='w'?10:8))).join('')+'</div>' + extraObjects +
      personFields + '<div class="grid">'+label('机位 X',coord('camera_x',cam.x,10))+label('机位 Y',coord('camera_y',cam.y,8))+
      label('机位朝向',select('camera_facing',['N','E','S','W'].map(d=>option(d,{N:'北',E:'东',S:'南',W:'西'}[d],cam.facing===d))))+'</div>' +
      label('布局依据与画外假设',area('layout_note',existing?.note ?? '')) + '<label class="label-inline"><input type="checkbox" name="confirmed" value="yes"> 我已核对布局和人物路线</label>' +
      button('生成可复核俯视图',el=>{const v=getForm(el),number=k=>{const raw=v.get(k);if(raw===null || String(raw).trim()==='') throw new Error('请填写所有坐标');return Number(raw)}
        const people=script.data.characters.map((c,i)=>{const px=v.get('person_'+i+'_via_x'),py=v.get('person_'+i+'_via_y');if(Boolean(px)!==Boolean(py))throw new Error('途经点 X 和 Y 须同时填写');return {name:c.name,facing:v.get('person_'+i+'_facing'),...Object.fromEntries(['start_x','start_y','end_x','end_y'].map(k=>[k,number('person_'+i+'_'+k)])),...(px ? {via_x:Number(px),via_y:Number(py)} : {})}})
        const objects=[{name:v.get('object_name'),...Object.fromEntries(['x','y','w','h'].map(k=>[k,number('object_'+k)]))},...[1,2,3].filter(i=>String(v.get('object_'+i+'_name') ?? '').trim()).map(i=>({name:v.get('object_'+i+'_name'),...Object.fromEntries(['x','y','w','h'].map(k=>[k,number('object_'+i+'_'+k)]))}))]
        return job('layout_render',{shot_id:shot.shot_id,layout:{confirmed:v.get('confirmed')==='yes',note:v.get('layout_note'),objects,people,camera:{x:number('camera_x'),y:number('camera_y'),facing:v.get('camera_facing')}}})},'small') +
      (layoutAssets.length ? label('选用已确认的调度图',pick('layout_ref',selected.layout,layoutAssets)) + button('绑定调度到此镜',el=>write('shots/'+encoded(shot.shot_id)+'/edit',{board_ref:board.ref,changes:{layout:getForm(el).get('layout_ref')}}),'small') : '')) : ''
    const controls = ['location','prop'].map(kind => {
      const title = kind === 'location' ? '场景' : '道具', ref=selected[kind]
      const currentAsset=project.assets[ref]
      const legacyReference=ref && !currentAsset?.reference_kind && !currentAsset?.reuse
      const candidates=images.filter(a=>a.ref===ref || a.reference_kind===kind || a.reuse?.kind===kind)
      const previous=latestJob(kind === 'location' ? 'location_reference' : 'prop_reference',j=>j.plan.shot_id===shot.shot_id)
      const task=kind === 'location' ? 'location_reference' : 'prop_reference'
      return '<div class="list-item"><h4>' + title + '</h4>' + (ref ? picture(ref,title+'参考') + '<p>' + x(ref) + '</p>' : '<p>尚未绑定</p>') +
        (legacyReference ? '<p class="job-notice">这是历史上传的通用参考，系统无法仅凭文件信息判断' + x(kind==='location'?'是否为空景、是否包含人物':'是否只包含该道具') + '。请人工核对，必要时用下方任务重新生成专用参考。</p>' : '') +
        (candidates.length ? '<details><summary>查看候选素材 · ' + candidates.length + '</summary><div class="grid">' + candidates.map(a => '<div><small>' + x(a.ref) + '</small>' + picture(a.ref,a.ref) + '</div>').join('') + '</div></details>' : '') +
        (director ? form('asset-'+kind+'-'+shot.shot_id,label(kind === 'location' ? '场景补充要求' : '需要生成的道具（必填）',area('description',kind === 'location' ? shot.scene : '')) +
          button('生成'+title+'参考',el=>{const description=String(getForm(el).get('description') ?? '').trim();if(!description) throw new Error('请先描述要生成的道具');return job(task,{shot_id:shot.shot_id,task_request:description,...(previous && ['succeeded','failed','superseded'].includes(previous.state) ? {retry_of:previous.id} : {})})},'small') +
          promptTools(task,el=>({shot_id:shot.shot_id,task_request:getForm(el).get('description')}),'生图') +
          label('参考素材',pick('asset',ref,candidates)) + button('绑定到此镜',el=>write('shots/'+encoded(shot.shot_id)+'/edit',{board_ref:board.ref,changes:{[kind]:getForm(el).get('asset')}}),'small') +
          label('上传'+title+'图','<input type="file" name="image" accept="image/png,image/jpeg,image/webp">') + button('上传并绑定',async el=>write('shots/'+encoded(shot.shot_id)+'/edit',{board_ref:board.ref,changes:{[kind]:(await fileUpload(el,'image','reference',{reference_kind:kind})).ref}}),'small') +
          (kind === 'location' && ref ? label('新机位描述',input('view','从柜台另一侧看向入口')) + button('生成场景新视角',el=>{const prev=latestJob('location_view',j=>j.plan.shot_id===shot.shot_id);return job('location_view',{shot_id:shot.shot_id,task_request:getForm(el).get('view'),...(prev && ['succeeded','failed','superseded'].includes(prev.state)?{retry_of:prev.id}:{})})},'small') +
            promptTools('location_view',el=>({shot_id:shot.shot_id,task_request:getForm(el).get('view')}),'生图') +
            label('俯视调度要求',area('blocking',shot.start_state + '；' + shot.action)) + button('生成俯视调度示意图',el=>{const prev=latestJob('blocking_plan',j=>j.plan.shot_id===shot.shot_id);return job('blocking_plan',{shot_id:shot.shot_id,task_request:'制作俯视平面调度示意图，结合场景参考，以标记和箭头说明固定物、人物起点终点、路线与机位。画面不可见的区域标为待核对。人物调度：'+getForm(el).get('blocking'),...(prev && ['succeeded','failed','superseded'].includes(prev.state)?{retry_of:prev.id}:{})})},'small') +
            promptTools('blocking_plan',el=>({shot_id:shot.shot_id,task_request:'制作俯视平面调度示意图，结合场景参考，以标记和箭头说明固定物、人物起点终点、路线与机位。画面不可见的区域标为待核对。人物调度：'+getForm(el).get('blocking')}),'生图') +
            '<p class="muted">调度图为生成的示意，人物位置和不可见区域需人工核对。</p>' : '')) : '') +
        previewPanel(taskPreviewKey(task,{shot_id:shot.shot_id})) + promptPlanEditor(task,{shot_id:shot.shot_id}) +
        (kind === 'location' ? previewPanel(taskPreviewKey('location_view',{shot_id:shot.shot_id})) + promptPlanEditor('location_view',{shot_id:shot.shot_id}) + previewPanel(taskPreviewKey('blocking_plan',{shot_id:shot.shot_id})) + promptPlanEditor('blocking_plan',{shot_id:shot.shot_id}) : '') +
        (kind === 'location' ? images.filter(a=>a.reference_kind==='layout' && a.shot_id===shot.shot_id).map(a=>'<div><h4>俯视调度示意 · '+x(a.ref)+'</h4>'+picture(a.ref,a.ref)+'</div>').join('') : '') + '</div>'
    }).join('')
    return '<details><summary>' + x(shot.shot_id + ' · ' + shot.scene) + '</summary><div class="grid">' + controls + '</div><h4>俯视布局与人物调度</h4>' +
      (selected.layout ? picture(selected.layout,'已绑定俯视调度图') + '<p>' + x(selected.layout) + '</p>' : '<p class="muted">尚未绑定可复核的调度图。</p>') + layoutForm +
      '<h4>本镜服装</h4>' + wardrobeControls(board, shot, script.data.characters) + '</details>'
  }).join('')
  return card('<h2>人物素材</h2><p class="muted">生成人物参考并选择版本，供镜头关键帧复用。</p><div class="grid">' + roles + '</div>') +
    card('<h2>场景与道具</h2><p class="muted">按镜头生成或上传场景与道具，已生成的参考可在其他镜头复用。场景新视角以当前绑定的场景为参考，请人工核对空间一致性。</p>' +
      (!board.data.production && director ? button('启用场景与道具制作',()=>save('storyboard',{...board.data,production:{}}),'small') : '') + (board.data.production ? locations : '<p>请先启用逐镜制作。</p>'))
}
function shotPage() {
  const script = project.artifacts[active(2)?.artifact_ref]
  const board = cur('storyboard')
  const approved = project.artifacts[active(3)?.artifact_ref]
  const cut = cur('cut')
  const cutCurrent = Boolean(cut && active(3) && cut.upstream === active(3).ref)
  const currentCut = cutCurrent ? cut : null
  const director = is('director')
  const refs = board?.data.references || {}
  const keys = board?.data.keyframes || {}
  const allVideos = Object.values(project.assets).filter(asset => asset.kind === 'video' && !asset.localized).reverse()
  const adoptableVideos = new Set(project.adoptable_videos)
  const possible = (task, key, value) => Object.values(project.jobs).filter(j => j.plan.task === task && j.plan[key] === value && j.result?.asset_ref).map(j => project.assets[j.result.asset_ref])
  const addBoardAsset = (key, target, asset) => save('storyboard', { ...board.data, [key]: { ...board.data[key], [target]:asset } })
  const assetPick = (name, current, assets) => imagePicker(name,current,assets)
  const boardJob = latestJob('storyboard')
  const boardProtection = boardJob?.dialogue_protection ?? boardJob?.provider_receipts?.agent_raw?.dialogue_protection ?? []
  const retryBoard = board?.status === 'needs_recheck' || ['failed','awaiting_query'].includes(boardJob?.state)
  const plan = card(statusHeading('分镜与关键帧',board) + version(board) +
    (director && board && !board.data.production ? button('启用逐镜制作与人工质检',() => save('storyboard',{...board.data,production:{}}),'small') : '') +
    (director && board && !board.data.join_checks ? button('启用接镜检查',() => save('storyboard',{...board.data,join_checks:true}),'small') : '') +
    (director && script ? row(generation('storyboard',{},retryBoard ? '重新转换分镜脚本' : '转换为分镜脚本',retryBoard ? boardJob : undefined)) +
      button('查看分镜生成素材',()=>showTaskPreview('storyboard','storyboard'),'small ghost') +
      (!board ? button('从剧本手动创建分镜',()=>save('storyboard',manualStoryboardDraft(script.data)),'small') : '') : '') +
    (boardJob && ['failed','awaiting_query'].includes(boardJob.state) ? '<div class="job-notice"><b>' + x(boardJob.state === 'failed' ? '分镜 Agent 未完成，已保留失败回执。' : '分镜结果未知，请先查询原任务。') + '</b><span>' + x(boardJob.error?.message ?? '') + '</span>' +
      (boardJob.provider_receipts?.agent_raw?.plan ? show(boardJob.provider_receipts.agent_raw.plan,'查看失败原始回执') : '') +
      (boardProtection.length ? show(boardProtection,'查看对白保护记录') : '') + '</div>' : '') +
    previewPanel('storyboard') + generatedPromptReport('storyboard','storyboard') +
    (!script ? '<p class="muted">剧情剧本确认后开放分镜脚本转换。</p>' : '') +
    (board ? '<div class="list">' + board.data.shots.map((shot, index) => {
      const ref = keys[shot.shot_id], assets = possible('keyframe','shot_id',shot.shot_id).concat(possible('repaint','shot_id',shot.shot_id)).concat(Object.values(project.assets).filter(a => a.purpose === 'keyframe'))
      const previous = latestJob('keyframe',j => j.plan.shot_id === shot.shot_id)
      const prior = board.data.shots[index - 1], priorVideo = prior && project.selected[prior.shot_id]
      return '<div class="list-item"><div class="spread"><h3>' + x(shot.shot_id + ' · ' + shot.framing) + '</h3><small>' + shot.duration_ms/1000 + ' 秒</small></div><p>' + x(shot.action) + '</p>' +
        (prior ? '<details><summary>接镜设计与首帧对照 · ' + x(prior.shot_id + ' → ' + shot.shot_id) + '</summary><div class="grid shot-comparison"><div><h4>上一镜结束画面</h4><p>' + x(prior.end_state) + '</p>' + (priorVideo ? video(media(priorVideo), priorVideo) + button('查看上一镜尾部',el => { const v=el.parentElement.querySelector('video'); v.currentTime=Math.max(0,project.assets[priorVideo].duration_ms/1000-0.2); return false },'small') : '<p>尚未选定上一镜视频</p>') + '</div><div><h4>本镜起始画面与承接</h4><p>' + x(shot.start_state) + '</p><p>' + x(shot.continuity) + '</p>' + (ref ? picture(ref,shot.shot_id + '已选首帧') : '<p>尚未选定首帧</p>') + '</div></div><details><summary>查看关键帧候选</summary><div class="grid">' + [...new Map(assets.filter(Boolean).filter(a => a.shot_id === shot.shot_id).map(a => [a.ref,a])).values()].map(a => '<div><b>' + x(a.ref) + '</b>' + picture(a.ref,a.ref) + '</div>').join('') + '</div></details></details>' : '') +
        (ref ? picture(ref,shot.shot_id + '关键帧') : '<small>待选关键帧</small>') +
        (director ? form('key-' + shot.shot_id, row(generation('keyframe',{shot_id:shot.shot_id},'生成关键帧',previous && ['succeeded','failed'].includes(previous.state) ? previous : undefined)) +
          promptTools('keyframe',()=>({shot_id:shot.shot_id}),'生图') +
          label('选定关键帧', assetPick('asset',ref,assets)) + button('保存选版',el => addBoardAsset('keyframes',shot.shot_id,getForm(el).get('asset')),'small') +
          '<p class="muted">选定并通过' + checkpointName(3) + '后，该关键帧会锁定为本镜视频的严格首帧；之后修改会生成新版分镜并让受影响视频重新确认。</p>' +
          label('或上传关键帧','<input type="file" name="image" accept="image/png,image/jpeg,image/webp">') +
          button('上传并选用', async el => addBoardAsset('keyframes',shot.shot_id,(await fileUpload(el,'image','keyframe')).ref),'small')) +
          (ref ? '<details><summary>局部重绘已选关键帧</summary><p class="muted">只修改指定问题区域，其他人物、手部、服装、构图、背景和光线保持不变。</p>' +
            form('repaint-'+shot.shot_id,label('只修改什么、必须保持不变什么',area('task_request','例如：只修正前景多出来的一只手；保持两名人物身份、照片、构图、光线和其他手部不变。')) +
              row(button('准备局部重绘提示词',el=>job('repaint',{shot_id:shot.shot_id,task_request:getForm(el).get('task_request'),prompt_only:true}),'small') +
                promptTools('repaint',el=>({shot_id:shot.shot_id,task_request:getForm(el).get('task_request')}),'生图'))) + '</details>' +
            promptPlanEditor('repaint',{shot_id:shot.shot_id}) : '') +
          shotEditor(board, shot, allVideos.filter(asset => asset.shot_id === shot.shot_id)) : '') +
        previewPanel(taskPreviewKey('keyframe',{shot_id:shot.shot_id})) + promptPlanEditor('keyframe',{shot_id:shot.shot_id}) + '</div>'
    }).join('') + '</div>' : '') +
    (director && board && script ? shotArrangement(board, script.data) : '') +
    (director && board?.status === 'draft' ? row(approve(3,board)) : '') + history('storyboard'))
  const scenes = approved ? approved.data.shots.map((shot, index, shots) => {
    const selected = project.selected[shot.shot_id]
    const versions = allVideos.filter(a => a.shot_id === shot.shot_id)
    const eligible = a => adoptableVideos.has(a.ref)
    const currentCandidates = versions.filter(eligible)
    const previousCandidates = versions.filter(a => !eligible(a))
    const compare = [...currentCandidates, ...previousCandidates.slice(0, 1)]
    const prev = latestJob('video',j => j.plan.shot_id === shot.shot_id && j.plan.context.board === approved.ref)
    const candidate = a => '<div class="list-item shot-candidate"><b>' + x(a.ref) + '</b> <small>' + a.duration_ms/1000 + ' 秒</small>' +
      (selected === a.ref ? ' ' + tag('已选用') : !eligible(a) ? ' ' + tag('历史对照') : '') + video(media(a.ref),a.ref) +
      (a.derived_from ? '<p class="muted">' + x('由 ' + a.derived_from + ' 裁切右缘 ' + a.crop_right_percent + '%') + '</p>' : '') +
      (a.human_review ? '<p>' + x((a.human_review.decision === 'accept' ? '人工通过 · ' : '退回重做 · ') + a.human_review.note) + '</p>' : '') +
      (director && eligible(a) && approved.data.production ? form('review-'+a.ref,label('看片结论',area('note',a.human_review?.note ?? '')) +
        row(['accept','reject'].map(decision => button(decision === 'accept' ? '看片通过并采用' : '退回此候选',el =>
          write('shots/'+encoded(shot.shot_id)+'/select',{ref:a.ref,decision,note:getForm(el).get('note')}),'small')).join('')))
        : director && eligible(a) && selected !== a.ref ? button('采用此版本',() => write('shots/' + encoded(shot.shot_id) + '/select',{ref:a.ref}),'small') : '') +
      (director && eligible(a) && !a.derived_from && !revised ? '<details><summary>裁切右缘</summary>' +
        form('crop-' + a.ref, label('裁切百分比（1–20）','<input name="right" type="number" min="1" max="20" step="1">') +
          button('另存裁切版',el => job('crop',{asset_ref:a.ref,crop_right_percent:Number(getForm(el).get('right'))}),'small')) + '</details>' : '') +
      candidateIssues(a) + '</div>'
    const neighbors = [shots[index - 1], shots[index + 1]].flatMap((adjacent, i) => {
      if (!adjacent) return []
      const ref = project.selected[adjacent.shot_id]
      const side = i === 0 ? '上一镜' : '下一镜'
      return '<div><h4>' + x(side + ' · ' + adjacent.shot_id) + '</h4><p class="text">' +
        x(i === 0 ? adjacent.end_state : adjacent.start_state) + '</p>' + (ref ? video(media(ref),side + ' ' + ref) : '') + '</div>'
    })
    const keyframe = approved.data.keyframes[shot.shot_id]
    const revised = board?.has_shot_rework && board.ref !== approved.ref
    const bound = approved.data.production?.[shot.shot_id] ?? {}
    const sources = [keyframe && {ref:keyframe,role:'镜头画面参考'},...shot.character_ids.map(id=>({ref:approved.data.references[id],role:'人物 '+id})),
      bound.location && {ref:bound.location,role:'场景视角'},bound.prop && {ref:bound.prop,role:'道具'},bound.layout && {ref:bound.layout,role:'俯视调度图，只参考空间和路线，不照搬图表或增加画外人物'}].filter(a=>a?.ref)
    const primary = [...new Map(sources.map(a=>[a.ref,a])).values()]
    const primaryRefs = new Set(primary.map(a=>a.ref))
    const extras = Object.values(project.assets).filter(a=>a.kind==='image' && !primaryRefs.has(a.ref)).map(a=>({ref:a.ref,
      role:a.reference_kind==='location' ? '补充场景视角' : a.reference_kind==='prop' ? '补充道具' : a.reference_kind==='layout' ? '补充调度图，只参考布局，不照搬图表或增加画外人物' : '补充画面参考'}))
    const choices = [...primary,...extras]
    const videoArgs = el => { const values=getForm(el), mode=values.get('video_mode'); return {shot_id:shot.shot_id,video_mode:mode,
      ...(mode === 'references' ? {reference_images:choices.filter(a=>values.getAll('reference_image').includes(a.ref))} : {})} }
    const generateVideo = (el, retry) => job('video',{...videoArgs(el), ...(retry ? {retry_of:prev.id} : {})})
    return '<details data-disclosure="review-' + x(shot.shot_id) + '"><summary>' + x(shot.shot_id + ' · ' + (selected || '待选视频')) + '</summary>' +
      '<p class="text">' + x(shot.action) + '</p>' +
      (director && revised ? '<p class="muted">请确认上方修改后的分镜，再按新版生成。</p>' : '') +
      (director && !revised ? form('video-options-'+shot.shot_id,label('生成模式',select('video_mode',[option('first_frame','严格首帧'),option('references','多素材参考（不锁定首帧）')])) +
        '<p class="muted">多素材模式可选择最多 10 张；调度图只作布局参考，严格首帧与其他参考图不能混用。</p>' +
        primary.map(a=>'<label class="label-inline"><input type="checkbox" name="reference_image" value="'+x(a.ref)+'" checked> '+x(a.role+' · '+a.ref)+'</label>').join('') +
        (extras.length ? '<details><summary>添加其他参考图片</summary>' + extras.map(a=>'<label class="label-inline"><input type="checkbox" name="reference_image" value="'+x(a.ref)+'"> '+x(a.role+' · '+a.ref)+'</label>').join('') + '</details>' : '') +
        row(button('生成视频',el=>generateVideo(el,false),'small') +
        promptTools('video',el=>videoArgs(el),'视频') +
        (prev && ['succeeded','failed','superseded'].includes(prev.state) ? button('重抽此镜头',el=>generateVideo(el,true),'small ghost') : ''))) : '') +
      previewPanel('video:'+shot.shot_id) + promptPlanEditor('video',{shot_id:shot.shot_id}) + generatedPromptReport('video:'+shot.shot_id,'video',job=>job.plan.shot_id===shot.shot_id) +
      '<div class="grid shot-comparison">' + compare.map(candidate).join('') + '</div>' +
      (previousCandidates.length > 1 ? '<details data-disclosure="older-' + x(shot.shot_id) + '"><summary>更早的候选</summary><div class="grid shot-comparison">' +
        previousCandidates.slice(1).map(candidate).join('') + '</div></details>' : '') +
      '<details data-disclosure="context-' + x(shot.shot_id) + '"><summary>首帧与相邻镜头</summary><div class="grid shot-comparison">' +
      (keyframe ? '<div><h4>已选首帧</h4>' + picture(keyframe,shot.shot_id + '首帧') + '</div>' : '') + neighbors.join('') + '</div></details></details>'
  }).join('') : ''
  const selectedKeyframes = board ? board.data.shots.filter(shot => board.data.keyframes?.[shot.shot_id]).length : 0
  const sceneBindings = board ? board.data.shots.filter(shot => shot.character_ids.length && board.data.production?.[shot.shot_id]?.location).length : 0
  const videoSection = card('<div class="spread"><div><span class="eyebrow">SHOT GENERATION</span><h2>逐镜视频生成</h2></div>' + tag(approved ? '已开放' : '待确认分镜') + '</div>' +
    '<p class="muted">每个镜头单独生成。严格首帧模式以已选关键帧作为第一帧；多素材参考模式会明确列出人物、场景、道具、调度图和补充图片各自的用途。当前运行：' +
    x(runtime.mode === 'dashscope' ? ('百炼 · ' + (runtime.models?.video ?? '视频模型未读取')) : '本地模拟 · ' + (runtime.models?.video ?? '未读取视频模型')) + '。</p>' +
    '<div class="video-readiness"><div><span>剧情剧本确认</span><b class="' + (active(2) ? 'ok' : 'waiting') + '">' + (active(2) ? '已完成' : '待完成') + '</b></div>' +
      '<div><span>关键帧</span><b class="' + (board?.data.shots.length && selectedKeyframes === board.data.shots.length ? 'ok' : 'waiting') + '">' + selectedKeyframes + ' / ' + (board?.data.shots.length ?? 0) + '</b></div>' +
      '<div><span>场景绑定</span><b class="' + (board?.data.shots.length && sceneBindings === board.data.shots.length ? 'ok' : 'waiting') + '">' + sceneBindings + ' / ' + (board?.data.shots.length ?? 0) + '</b></div>' +
      '<div><span>分镜确认</span><b class="' + (approved ? 'ok' : 'waiting') + '">' + (approved ? approved.ref : '待完成') + '</b></div></div>' +
    (approved ? '<p class="muted">展开任一镜头，可看到生成模式、参考素材勾选、生成按钮、“查看生成素材”和“准备视频提示词”。页面只展示最终发送给模型的可编辑自然语言。</p><div class="video-shot-list">' + scenes + '</div>' :
      '<div class="preview-lock"><b>逐镜生成尚未开放</b><p>' + x(!board ? '先在“分镜与关键帧”中转换分镜脚本。' : !active(2) ? '先确认完整剧情剧本。' : selectedKeyframes < board.data.shots.length ? '先为每个镜头选择关键帧。' : '检查分镜脚本后完成' + checkpointName(3) + '。') + '</p>' +
      (board ? '<p class="muted">已识别 ' + board.data.shots.length + ' 个待生成镜头：' + x(board.data.shots.map(shot => shot.shot_id).join('、')) + '</p>' : '') + '</div>'))
  const defaultOrder = approved?.data.shots.map(s => s.shot_id) ?? []
  const requestedOrder = currentCut?.data.options?.order ?? defaultOrder
  const orderedIds = [...new Set([...requestedOrder, ...defaultOrder])].filter(shotId => defaultOrder.includes(shotId))
  const cutCards = orderedIds.map((shotId,index) => {
    const shot = approved.data.shots.find(item => item.shot_id === shotId)
    const asset = project.assets[project.selected[shotId]], saved = currentCut?.data.options?.trims?.[shotId]
    if (!shot || !asset) return ''
    return '<article class="cut-arrange-card" data-cut-shot="' + x(shotId) + '"><div class="cut-arrange-head"><div><div class="cut-arrange-title"><span data-cut-sequence>镜头 ' + (index+1) + '</span><code>' + x(shotId) + '</code><small>' + x(asset.ref) + '</small></div>' +
      '<p>' + x(shot.framing + ' · ' + shot.action) + '</p></div><div class="cut-order-actions">' +
      button('↑ 上移',el => moveCutCard(el,-1),'small ghost',index===0,'aria-label="上移镜头 '+(index+1)+'"') +
      button('↓ 下移',el => moveCutCard(el,1),'small ghost',index===orderedIds.length-1,'aria-label="下移镜头 '+(index+1)+'"') + '</div></div>' +
      '<details><summary>调整入点、出点</summary><div class="grid">' +
      label('入点（秒）','<input name="in_' + x(shotId) + '" type="number" min="0" step="0.001" value="' + (saved?.in_ms ?? 0)/1000 + '">') +
      label('出点（秒）','<input name="out_' + x(shotId) + '" type="number" min="0" step="0.001" value="' + (saved?.out_ms ?? asset.duration_ms)/1000 + '">') + '</div></details></article>'
  }).join('')
  const moveCutCard = (element,direction) => {
    const form = element.closest('form'), card = element.closest('[data-cut-shot]'), list = form?.querySelector('[data-cut-order-list]')
    if (!form || !card || !list) return false
    const sibling = direction < 0 ? card.previousElementSibling : card.nextElementSibling
    if (!sibling) return false
    if (direction < 0) list.insertBefore(card,sibling)
    else list.insertBefore(sibling,card)
    ;[...list.querySelectorAll('[data-cut-shot]')].forEach((item,index) => {
      item.querySelector('[data-cut-sequence]').textContent = '镜头 ' + (index+1)
      const up=item.querySelector('button[aria-label^="上移"]'), down=item.querySelector('button[aria-label^="下移"]')
      up.disabled=index===0; down.disabled=index===list.children.length-1
      up.setAttribute('aria-label','上移镜头 '+(index+1)); down.setAttribute('aria-label','下移镜头 '+(index+1))
    })
    form.querySelector('[data-cut-order-value]').value = JSON.stringify([...list.querySelectorAll('[data-cut-shot]')].map(item => item.dataset.cutShot))
    ;(direction < 0 ? card.querySelector('button[aria-label^="上移"]') : card.querySelector('button[aria-label^="下移"]'))?.focus()
    return false
  }
  const editCut = approved && director ? form('cut-edit',
    '<input type="hidden" name="order" data-cut-order-value value="' + x(JSON.stringify(orderedIds)) + '">' +
    '<div class="cut-arrangement"><div class="spread"><div><h3>最终镜头顺序</h3><p class="muted">用上下移动调整播放顺序；保存前不会影响当前版本。</p></div><span class="label">' + orderedIds.length + ' 个镜头</span></div>' +
    '<div class="cut-arrange-list" data-cut-order-list>' + cutCards + '</div></div>' +
    approved.data.shots.flatMap(s => s.dialogue).map(line => label(line.line_id + ' · ' + line.speaker_id, input('line_' + line.line_id,currentCut?.data.options?.dialogue?.[line.line_id] ?? line.text))).join('') +
    label('改动类型',select('rework',[option('tech','画面顺序或源对白技术修订'),option('story','改对白原意，退回剧本')])) +
    button('保存画面基准', async el => {
      const f = getForm(el)
      const dialogue = Object.fromEntries([...f].filter(([key]) => key.startsWith('line_')).map(([key,value]) => [key.slice(5),value]))
      const trims = Object.fromEntries(approved.data.shots.filter(s => f.has('in_' + s.shot_id)).map(s => [s.shot_id,{in_ms:Math.round(Number(f.get('in_' + s.shot_id))*1000),out_ms:Math.round(Number(f.get('out_' + s.shot_id))*1000)}]))
      const result = await save('cut',{order:JSON.parse(f.get('order')),dialogue,trims},{rework:f.get('rework')})
      if (result.type === 'script') switchTab('story')
    },'small')) : ''
  const joins = approved?.data.join_checks && currentCut?.status === 'draft' ? currentCut.data.cut.slice(0,-1).map((left,i) => {
    const right = currentCut.data.cut[i+1], saved = project.join_reviews?.[left.shot_id + ':' + right.shot_id]
    const end = left.out_ms ?? project.assets[left.video_ref].duration_ms, start = right.in_ms ?? 0
    const matches = saved && saved.board_ref === approved.ref && saved.left_ref === left.video_ref && saved.right_ref === right.video_ref && saved.left_out_ms === end && saved.right_in_ms === start
    return '<div class="list-item join-review"><h4>' + x(left.shot_id + ' → ' + right.shot_id) + '</h4><p class="muted">' + x(left.video_ref + ' @ ' + end/1000 + ' 秒 → ' + right.video_ref + ' @ ' + start/1000 + ' 秒') + '</p>' +
      '<div class="grid">' + video(media(left.video_ref),left.shot_id) + video(media(right.video_ref),right.shot_id) + '</div>' +
      button('连播前后两秒', async el => {
        const [a,b] = el.closest('.join-review').querySelectorAll('video')
        a.pause(); b.pause(); a.currentTime = Math.max(left.in_ms ?? 0,end - 2000)/1000
        const next = () => { if (a.currentTime >= end/1000 || a.ended) { a.pause(); a.removeEventListener('timeupdate',next); b.currentTime = start/1000; b.play(); const stop = () => { if (b.currentTime >= Math.min(start+2000,right.out_ms ?? project.assets[right.video_ref].duration_ms)/1000 || b.ended) { b.pause(); b.removeEventListener('timeupdate',stop) } }; b.addEventListener('timeupdate',stop) } }
        a.addEventListener('timeupdate',next); a.addEventListener('ended',next,{once:true}); await a.play(); return false
      },'small') + (saved ? '<p>' + x((!matches ? '历史结论，当前切点须重新检查：' : saved.decision === 'accept' ? '已通过：' : '需修改：') + saved.note) + '</p>' : '') +
      (director ? form('join-' + left.shot_id, label('接镜意见',area('note',saved?.note ?? '')) + row(['accept','reject'].map(decision => button(decision === 'accept' ? '接镜通过' : '接镜退回',el => write('joins/' + encoded(left.shot_id),{cut_ref:currentCut.ref,next_shot_id:right.shot_id,left_ref:left.video_ref,right_ref:right.video_ref,left_out_ms:end,right_in_ms:start,decision,note:getForm(el).get('note')}),'small')).join(''))) : '') + '</div>'
  }).join('') : ''
  return plan + videoSection + card(statusHeading('画面和对白',currentCut) + version(currentCut) +
    (cut && !cutCurrent ? '<p class="job-notice">上一版分镜已更新，旧画面基准不能继续使用。保存新的画面基准后会按当前镜头顺序重新检查接镜；旧版仍保留在历史版本中。</p>' : '') +
    editCut + joins +
    (currentCut ? '<p class="muted">采用 ' + currentCut.data.cut.length + ' 镜 · ' + currentCut.data.duration_ms/1000 + ' 秒' +
      (Math.abs(currentCut.data.duration_ms - (cur('brief')?.data.target_duration_ms ?? 36000)) > 3000 ? ' · 请核对与目标时长的差异' : '') + '</p>' : '') +
    (currentCut?.data.preview_ref ? video(media(currentCut.data.preview_ref),'画面拼接预览') : '') +
    (director && currentCut?.status === 'draft' ? row(generation('rough',{},'拼接预览') + approve(4,currentCut)) : '') + history('cut'))
}
function languageTabs() {
  return '<div class="row actions" aria-label="目标语种">' +
    project.languages.map(lang => button(langs[lang],() => { language=lang; focus='' }, lang === language ? 'active' : 'ghost')).join('') + '</div>'
}
function languagePage() {
  const cut = active(4)
  const cutData = cut ? project.artifacts[cut.artifact_ref]?.data?.cut : null
  const item = cur('language', language)
  const usable = item?.upstream === cut?.ref && item?.status !== 'needs_recheck'
  const director = is('director')
  const nativeAudio = !item || item.data.lines.every(line => !line.audio_ref)
  if (!project.languages.length) return card('<h2>目标语种</h2><p class="muted">等待运营在需求页选择目标语种。</p>')
  const options = Object.values(project.assets).filter(a => a.kind === 'audio' && a.language === language)
  const board = project.artifacts[active(3)?.artifact_ref]
  const localizedVideos = Object.values(project.assets).filter(a => a.kind === 'video' && a.localized && a.language === language)
  const adoptable = new Set(project.adoptable_videos)
  const localizedReady = language === 'zh-CN' || Boolean(board?.data.shots.length) && board.data.shots.every(shot => adoptable.has(project.localized_selected?.[language]?.[shot.shot_id]))
  const localizedPanel = director && language !== 'zh-CN' && cut && item && item.data.reviewed !== false ? (() => {
    const selectedCount = board?.data.shots.filter(shot => adoptable.has(project.localized_selected?.[language]?.[shot.shot_id])).length ?? 0
    return card('<div class="spread"><div><span class="eyebrow">LANGUAGE-SPECIFIC VIDEO</span><h2>' + x(langs[language] + '专属对白视频') + '</h2></div><span class="tag ' + (selectedCount === board?.data.shots.length ? 'approved' : 'pending_review') + '">' + x(selectedCount + ' / ' + (board?.data.shots.length ?? 0) + ' 已选用') + '</span></div>' +
      '<p class="muted">每个语言单独生成视频。系统会把该语言已经校对的对白写入视频提示词，让 Wan 3.0 直接生成对应语言的表演和原生声音；不要用中文视频再做翻译配音。</p>' +
      (board ? '<div class="list">' + board.data.shots.map(shot => {
        const selected = project.localized_selected?.[language]?.[shot.shot_id]
        const selectedCurrent = selected && adoptable.has(selected) ? selected : null
        const versions = localizedVideos.filter(asset => asset.shot_id === shot.shot_id && adoptable.has(asset.ref))
        const dialogue = item.data.lines.filter(line => line.shot_id === shot.shot_id).map(line => line.target_text).join(' / ')
        const previous = latestJob('video', job => job.plan.language === language && job.plan.shot_id === shot.shot_id)
        return '<div class="list-item"><div class="spread"><h3>' + x(shot.shot_id + ' · ' + shot.framing) + '</h3><span class="tag ' + (selectedCurrent ? 'approved' : 'draft') + '">' + x(selectedCurrent ? '已选用 ' + selectedCurrent : selected ? '旧选版需重做' : '待生成/选用') + '</span></div>' +
          '<p class="text">' + x(dialogue || '本镜无对白，仅保留环境声与表演声音') + '</p>' +
          form('localized-video-'+language+'-'+shot.shot_id,
            row(button('生成'+langs[language]+'视频',()=>job('video',{shot_id:shot.shot_id,language,video_mode:'first_frame'}),(previous?.state === 'failed' ? 'ghost small' : 'small')) +
              promptTools('video',()=>({shot_id:shot.shot_id,language}),'视频'))) +
          previewPanel(taskPreviewKey('video',{shot_id:shot.shot_id,language})) +
          promptPlanEditor('video',{shot_id:shot.shot_id,language}) +
          generatedPromptReport('video:'+language+':'+shot.shot_id,'video',job=>job.plan.language===language&&job.plan.shot_id===shot.shot_id) +
          '<div class="grid shot-comparison">' + versions.map(version => '<div class="list-item"><div class="spread"><b>' + x(version.ref) + '</b><span>' + x((version.duration_ms/1000)+' 秒') + '</span></div>' +
            video(media(version.ref),version.ref) +
            (version.human_review ? '<p class="muted">' + x((version.human_review.decision === 'accept' ? '已通过：' : '已退回：') + version.human_review.note) + '</p>' : '') +
            form('localized-review-'+version.ref,label('看片结论',area('note',version.human_review?.note ?? '', 'small')) +
              row(button('看片通过并采用',el=>write('shots/'+encoded(shot.shot_id)+'/select',{ref:version.ref,language,decision:'accept',note:getForm(el).get('note')}),'small') +
                button('退回此版本',el=>write('shots/'+encoded(shot.shot_id)+'/select',{ref:version.ref,language,decision:'reject',note:getForm(el).get('note')}),'small ghost'))) +
            '</div>').join('') + (versions.length ? '' : '<p class="muted">还没有该语言的视频候选。</p>') + '</div></div>'
      }).join('') + '</div>' : '<p class="muted">当前还没有已确认的分镜。</p>') +
      (selectedCount !== (board?.data.shots.length ?? 0) ? '<p class="job-notice">完成每个镜头的该语言视频选用后，才能生成同步预览并做' + checkpointName(5) + '。</p>' : ''))
  })() : ''
  const lineEditor = usable && item ? item.data.lines.map((line,index) => {
    const latest = latestJob('dubbing',j => j.plan.language === language && j.plan.line?.line_id === line.line_id)
    const shot = cutData?.find(entry => entry.shot_id === line.shot_id)
    const waveRef = line.audio_ref || project.localized_selected?.[language]?.[line.shot_id] || project.selected[line.shot_id]
    const start = shot?.start_ms ?? 0, duration = shot?.duration_ms ?? 1
    const left = Math.max(0, Math.min(100, (line.subtitle_start_ms - start) / duration * 100))
    const width = Math.max(2, Math.min(100 - left, (line.subtitle_end_ms - line.subtitle_start_ms) / duration * 100))
    const voiceEditor = nativeAudio
      ? '<p class="muted">对白和心声使用该语种视频的原生音轨；这里只校字幕，不再重复生成 TTS。</p>'
      : label('配音片段', select('audio' + index, [option('','请选择'), ...options.filter(a => a.purpose === 'dubbing' || a.ref.includes('_' + line.line_id + '_')).map(a => option(a.ref,a.ref + ' · ' + a.duration_ms/1000 + ' 秒', a.ref === line.audio_ref))])) +
        label('配音起点（毫秒）',input('as'+index,line.audio_start_ms,'number')) +
        row(generation('dubbing',{language,line_id:line.line_id},'生成配音',latest && ['succeeded','failed'].includes(latest.state) ? latest : undefined)) +
        (language === 'th' ? label('上传备用配音','<input type="file" name="fallback'+index+'" accept="audio/*">') +
          button('上传泰语片段', el => fileUpload(el,'fallback'+index,'dubbing'),'small') : '')
    const timeline = '<div class="audio-wave" data-waveform-src="' + x(waveRef ? media(waveRef) : '') + '"><div class="audio-wave-bars"></div><i class="audio-wave-range" style="left:'+left+'%;width:'+width+'%"></i></div>' +
      '<div class="grid timeline-controls">' +
        label('字幕起点', '<input name="ss'+index+'" type="range" min="'+start+'" max="'+(start+duration-10)+'" step="10" value="'+line.subtitle_start_ms+'">') +
        label('字幕终点', '<input name="se'+index+'" type="range" min="'+(start+1)+'" max="'+(start+duration)+'" step="10" value="'+line.subtitle_end_ms+'">') +
      '</div><p class="muted">镜头 '+x(shot?.shot_id ?? line.shot_id)+'：'+x(start/1000+'–'+(start+duration)/1000+' 秒')+'；拖动字幕起止点，保存时校验不跨镜。</p>'
    return '<div class="list-item"><div class="spread"><h3>' + x(line.shot_id + ' / ' + line.line_id) + '</h3><small>' + x(line.speaker_id) + '</small></div><p>' + x(line.source_text) + '</p>' +
      timeline +
      (director ? label('配音文本',language === 'zh-CN' ? '<p>' + x(line.target_text) + '</p>' : input('text' + index,line.target_text)) +
        label('字幕文字', input('sub' + index,line.subtitle_text ?? line.target_text)) +
        voiceEditor : '<p>' + x(line.target_text) + '</p>') +
      (line.audio_ref ? audio(line.audio_ref,line.line_id + ' 已保存配音') : '') + '</div>'
  }).join('') : ''
  const editor = item && lineEditor ? (director ?
    form('language-edit','<div class="list">' + lineEditor + '</div>' + row(button('保存校对稿与片段',el => {
      const f = getForm(el)
      const lines = item.data.lines.map((line,i) => {
        const ref = nativeAudio ? null : f.get('audio'+i)
        return { ...line, target_text:f.get('text'+i) ?? line.target_text, subtitle_text:f.get('sub'+i), audio_ref:ref || null, audio_duration_ms:project.assets[ref]?.duration_ms ?? null,
          audio_start_ms:nativeAudio ? line.audio_start_ms : Number(f.get('as'+i)), subtitle_start_ms:Number(f.get('ss'+i)), subtitle_end_ms:Number(f.get('se'+i)) }
      })
      return save('language',{lines,reviewed:true},{language})
    },'primary'))) : '<div id="language-edit"><div class="list">' + lineEditor + '</div></div>') : ''
  return languageTabs() + localizedPanel + card(statusHeading(langs[language] + '语言素材',item) + version(item) +
    (nativeAudio ? '<div class="job-notice">当前语言以视频原生对白和心声为主。后期只增加字幕和背景音乐；如果换成音轨不可用的视频，再选择逐句补录配音。</div>' : '') +
    (!cut ? '<p class="muted">' + checkpointName(4) + '完成后开放语言制作。</p>' : director ? row(generation('translate',{language},language === 'zh-CN' ? '载入中文对白' : '生成翻译')) : '') +
    editor + (usable && item?.data.preview_ref ? video(media(item.data.preview_ref),langs[language]+'同步预览') : '') +
    (director && usable && item?.status === 'draft' ? row((localizedReady ? generation('preview',{language},'生成同步预览') : button('先生成并选用'+langs[language]+'专属视频',()=>false,'small',true)) +
      (item.data.preview_ref ? approve(5,item) : '')) : '') + history('language',language))
}
function deliveryReviewForm(item) {
  return form('delivery-review-' + item.ref,
    '<label class="label-inline"><input type="checkbox" name="content_checked">已看片并确认内容可交付</label>' +
    label('审核意见（退回时必填）',area('note','')) +
    '<div class="grid">' +
    label('问题开始（秒，可选）','<input name="start" type="number" min="0" step="0.001">') +
    label('问题结束（秒，可选）','<input name="end" type="number" min="0" step="0.001">') + '</div>' +
    row(button('通过此版本',async el => {
      const data = getForm(el)
      await decision(6,item,'approve', {
        file_ref:item.data.file_ref, content_checked:data.has('content_checked'), note:data.get('note'),
      })
      flash('已确认 ' + item.ref)
    },'primary') + button('退回修改',el => {
      const data = getForm(el)
      const milliseconds = name => data.get(name) === '' ? null : Math.round(Number(data.get(name)) * 1000)
      return decision(6,item,'return', {
        file_ref:item.data.file_ref, note:data.get('note'), start_ms:milliseconds('start'), end_ms:milliseconds('end'),
      })
    },'small')))
}
function deliveriesPage() {
  const director = is('director')
  const complete = project.languages.length > 0 && project.languages.every(code => active(6, code))
  const check5 = active(5,language)
  const target = cur('delivery',language)
  const currentDelivery = target?.upstream === check5?.ref ? target : null
  const returnedJob = currentDelivery?.status === 'returned' ? latestJob('assemble', j => j.result?.artifact_ref === currentDelivery.ref && j.state === 'succeeded') : null
  const assemblyJob = latestJob('assemble', j => j.plan.language === language && j.plan.context.check5 === check5?.ref)
  const retryJob = returnedJob ?? (assemblyJob?.state === 'failed' ? assemblyJob : null)
  const all = Object.values(project.artifacts).filter(a => a.type === 'delivery' && a.language === language).reverse()
  const music = Object.values(project.assets).filter(a => a.purpose === 'music' || a.ref.startsWith('bgm@'))
  const composer = director && project.languages.length && (!complete || completedEdit) ? card('<h2>制作' + langs[language] + '成片</h2>' +
    form('composer', label('背景音乐',select('music',[option('','选择背景音乐'),...music.map(a => option(a.ref,a.filename ?? a.ref,a.ref === currentDelivery?.data.music_ref))])) +
      label('上传背景音乐','<input type="file" name="musicfile" accept="audio/*">') +
      row(button('上传音乐',el => fileUpload(el,'musicfile','music'),'small') +
        (runtime.mode === 'mock' ? generation('music',{},'生成模拟音乐') : '') +
        button(retryJob ? '重新合成成片' : '合成成片',el => job('assemble',{
          language,music_ref:getForm(el).get('music'), ...(retryJob ? { retry_of: retryJob.id } : {}),
        }),'primary',!check5)) +
      (!check5 ? '<p class="muted">完成该语种的' + checkpointName(5) + '后开放合成。</p>' : '<p class="muted">使用确认 ' + x(check5.ref) + '</p>'))) : ''
  const deliver = all.map(item => {
    const href = base() + '/deliveries/' + encoded(item.ref)
    const approved = Object.values(project.confirmations).some(c => c.step === 6 && c.artifact_ref === item.ref && c.file_ref === item.data.file_ref)
    const review = item.delivery_review
    const currentBasis = item.upstream === check5?.ref
    return card(statusHeading(item.ref,item) + version(item) + note(item) +
      (!currentBasis ? '<p class="job-notice">历史版本：基于 ' + x(item.upstream ?? '更早确认') + ' 合成，当前语言确认为 ' + x(check5?.ref ?? '待完成') + '。原文件继续保留' + (approved ? '，运营仍可下载' : '') + '；本轮需要重新合成。</p>' : '') +
      video(href + '/preview', langs[language] + '成片 ' + item.ref) +
        (review ? '<p class="muted">' + x('验收文件 ' + review.file_ref +
        (review.range ? ' · 问题时间 ' + review.range.start_ms/1000 + '–' + review.range.end_ms/1000 + ' 秒' : '')) + '</p>' : '') +
      (review?.decision === 'approve' && review.note ? '<p class="text">' + x(review.note) + '</p>' : '') +
      (director && currentDelivery === item && item.status === 'draft' ? row(button(project.members.reviewer ? '提交历史审核验收' : '提交运营验收',() => submit(item),'primary')) : '') +
      (is(project.members.reviewer ? 'reviewer' : 'operations') && currentDelivery === item && item.status === 'pending_review' ? deliveryReviewForm(item) : '') +
      (is('operations') && approved ? row('<a class="btn primary" href="' + x(href + '/download') + '">下载验收版 MP4</a>') : '') +
      show(item.data,'查看合成清单'))
  }).join('')
  return languageTabs() + composer + (deliver || card('<h2>成片交付</h2><p class="muted">当前语种暂无成片。</p>'))
}
const usageUnits = { tokens:'Token', images:'图片', video_seconds:'视频秒', speech_characters:'配音字符', input_tokens:'输入 Token', output_tokens:'输出 Token', input_images:'输入图片', videos:'视频' }
const usageJobLabels = { producer:'制片整理', creative:'创意策划', writer:'编剧', storyboard:'分镜', reference:'角色参考', location_reference:'场景参考', prop_reference:'道具参考', location_view:'场景新视角', blocking_plan:'俯视调度示意', layout_render:'俯视调度绘制', keyframe:'关键帧', repaint:'关键帧局部重绘', video:'镜头生成', crop:'镜头裁切', rough:'画面预览',
  director:'导演建议', translate:'翻译', dubbing:'配音', preview:'同步预览', assemble:'正式合成', music:'背景音乐', quality:'历史质检（已停用）', content_review:'历史内容审核（已停用）' }
const usageTaskFamilies = [
  ['前期策划', ['producer','creative','writer','director','storyboard']],
  ['美术与画面', ['reference','location_reference','prop_reference','location_view','blocking_plan','keyframe','repaint']],
  ['镜头生成', ['video','crop','rough']],
  ['声音与语言', ['translate','dubbing','preview']],
  ['合成与审核', ['assemble','music','quality','content_review']],
]
const usageTaskFamily = task => usageTaskFamilies.find(([,tasks]) => tasks.includes(task))?.[0] ?? '其他任务'
const usageStateLane = state => ['queued','running'].includes(state) ? 'active' : state === 'awaiting_query' ? 'query' : ['succeeded','superseded'].includes(state) ? 'done' : 'attention'
function usageJobProject(job, p) {
  return { ...job, project_id:p.id, project_title:p.title, pricing:p.pricing }
}
function usageText(job) {
  return job.usage?.map(unit => unit.quantity + ' ' + (usageUnits[unit.unit] ?? unit.unit)).join(' / ') || '未提供'
}
function usageCost(job) {
  const pricing = job.pricing
  if (!pricing || !job.usage?.length) return null
  const rate = value => Number.isFinite(value) ? value : null
  const rates = {
    input_tokens: rate(pricing.text_input_per_1k) == null ? null : pricing.text_input_per_1k / 1000,
    output_tokens: rate(pricing.text_output_per_1k) == null ? null : pricing.text_output_per_1k / 1000,
    images: rate(pricing.image_each),
    video_seconds: rate(pricing.video_second),
    speech_characters: rate(pricing.speech_character),
  }
  let amount = 0, priced = 0
  for (const item of job.usage) {
    const rate = rates[item.unit]
    if (!Number.isFinite(rate)) continue
    amount += Number(item.quantity) * rate
    priced += item.quantity
  }
  return priced ? amount : null
}
const usageCostText = job => {
  const cost = usageCost(job)
  return cost == null ? '价格未配置' : '≈ ¥' + cost.toFixed(2)
}
async function refreshUsage() {
  usageOverview = await api('/api/usage')
}
async function queryUsageJob(job) {
  await api('/api/projects/' + encoded(job.project_id) + '/jobs/' + encoded(job.id) + '/query', 'POST', {})
  await refreshUsage()
  if (project?.id === job.project_id) await refreshProject()
  flash('已查询原任务，请查看最新状态')
}
function usageTaskCard(job) {
  return '<article class="usage-task-card">' +
    '<div class="usage-task-top"><span class="tag ' + x(job.state) + '">' + x(states[job.state] ?? job.state) + '</span><small>' + x(new Date(job.updated_at ?? job.created_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})) + '</small></div>' +
    '<h4>' + x(usageJobLabels[job.plan.task] ?? job.plan.task) + '</h4>' +
    '<p class="usage-task-project">' + x(job.project_title) + (job.plan.shot_id ? ' · ' + x(job.plan.shot_id) : '') + (job.plan.language ? ' · ' + x(langs[job.plan.language] ?? job.plan.language) : '') + '</p>' +
    (job.error ? '<p class="usage-task-error">' + x(job.error.message + (job.error.field ? ' · ' + job.error.field : '')) + '</p>' : '') +
    '<div class="usage-task-meta"><span>' + x(usageText(job)) + '</span><span>' + x(job.model) + '</span><span>' + x(usageCostText(job)) + '</span></div>' +
    (job.state === 'awaiting_query' && is('director') ? button('查询原任务',() => queryUsageJob(job),'small') : '') +
    '<details class="usage-task-details"><summary>任务详情</summary><div class="text">' +
      '<p>任务号 ' + x(job.id) + '</p>' + (job.provider_job_id ? '<p>服务商任务 ' + x(job.provider_job_id) + '</p>' : '') +
      (job.skill ? '<p>' + x(job.skill.id + ' @ ' + job.skill.version + ' · ' + (job.skill.mode === 'renderer_only' ? '本地渲染器' : job.skill.mode === 'prompt_injection' ? '提示词注入' : '旧记录（未标注）')) + '</p>' +
        (job.skill.source ? '<p>来源：' + x(job.skill.source) + '</p>' : '') +
        (job.skill.license ? '<p>许可：' + x(job.skill.license) + '</p>' : '') +
        (job.skill.adaptation ? '<p>本项目改编：' + x(job.skill.adaptation) + '</p>' : '') +
        (job.skill.not_executed?.length ? '<p>未执行：' + x(job.skill.not_executed.join('；')) + '</p>' : '') +
        show(job.skill,'Skill 记录') : '') +
      (job.plan.input ? show(job.plan.input,'任务输入') : '') +
      (job.plan.production ? show(job.plan.production,'镜头制作单') : '') +
      (job.provider_receipts?.agent_raw?.plan ? show(job.provider_receipts.agent_raw.plan,'原始 Agent 回执') : '') +
      (job.dialogue_protection?.length ? show(job.dialogue_protection,'对白保护记录') : '') +
      (job.result?.response?.result?.video_prompt ? show(job.result.response.result.video_prompt,'视频模型提示词') : '') +
      (job.provider_receipts?.compiled_request ? show(job.provider_receipts.compiled_request,'实际生成请求') : '') +
      (job.result?.response ? show(job.result.response,'查看结果') : '') +
    '</div></details></article>'
}
function usageDonut(jobs) {
  const counts = [
    ['已完成','done',jobs.filter(job => usageStateLane(job.state) === 'done').length,'var(--good)'],
    ['处理中','active',jobs.filter(job => usageStateLane(job.state) === 'active').length,'var(--accent)'],
    ['待查询','query',jobs.filter(job => usageStateLane(job.state) === 'query').length,'var(--warm)'],
    ['失败', 'attention',jobs.filter(job => usageStateLane(job.state) === 'attention').length,'var(--danger)'],
  ]
  const total = jobs.length
  let cursor = 0
  const gradient = total ? counts.map(([,key,count,color]) => { const start=cursor; cursor += count/total*100; return color+' '+start+'% '+cursor+'%' }).join(',') : 'var(--subtle) 0 100%'
  return '<section class="usage-chart-card"><div class="usage-chart-title"><h3>任务状态</h3><span>' + total + ' 个任务</span></div><div class="usage-donut-layout">' +
    '<div class="usage-donut" style="background:conic-gradient(' + gradient + ')" role="img" aria-label="任务状态分布：' + x(counts.map(([name,,count]) => name + count + '个').join('，')) + '"><div><strong>' + total + '</strong><span>任务</span></div></div>' +
    '<div class="usage-legend">' + counts.map(([name,key,count,color]) => '<div><i style="background:'+color+'"></i><span>'+x(name)+'</span><b>'+count+'</b></div>').join('') + '</div></div></section>'
}
function usageWeekChart(jobs) {
  const days = []
  for (let offset=6; offset>=0; offset--) {
    const date = new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate()-offset)
    const key = date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')
    days.push({ key, label:(date.getMonth()+1)+'/'+date.getDate(), count:jobs.filter(job => String(job.created_at).slice(0,10) === key).length })
  }
  const max = Math.max(1,...days.map(day => day.count))
  return '<section class="usage-chart-card"><div class="usage-chart-title"><h3>最近 7 天</h3><span>任务创建数</span></div><div class="usage-week-chart" role="img" aria-label="最近七天任务创建数：' + x(days.map(day => day.label+' '+day.count+'个').join('，')) + '">' +
    days.map(day => '<div class="usage-day"><span>'+day.count+'</span><div class="usage-day-track"><i style="height:'+Math.max(4,day.count/max*100)+'%"></i></div><small>'+x(day.label)+'</small></div>').join('') + '</div></section>'
}
function usageMixChart(jobs) {
  const groups = usageTaskFamilies.map(([name,tasks]) => ({ name, count:jobs.filter(job => tasks.includes(job.plan.task)).length }))
  const extra = jobs.filter(job => !usageTaskFamilies.some(([,tasks]) => tasks.includes(job.plan.task))).length
  if (extra) groups.push({ name:'其他任务', count:extra })
  const max = Math.max(1,...groups.map(group => group.count))
  return '<section class="usage-chart-card"><div class="usage-chart-title"><h3>阶段构成</h3><span>按制作环节</span></div><div class="usage-mix-chart">' +
    groups.map((group,index) => '<div class="usage-mix-row"><span>'+x(group.name)+'</span><div class="usage-mix-track"><i class="series-'+((index%5)+1)+'" style="width:'+(group.count/max*100)+'%"></i></div><b>'+group.count+'</b></div>').join('') +
    '</div></section>'
}
function usageProjectChart(projects) {
  const rows = projects.filter(p => p.jobs.length)
  const max = Math.max(1,...rows.map(p => p.jobs.length))
  return '<section class="usage-chart-card"><div class="usage-chart-title"><h3>项目负载</h3><span>完成任务 / 总任务</span></div><div class="usage-project-chart">' +
    (rows.length ? rows.map(p => '<div class="usage-project-row"><div><span>'+x(p.title)+'</span><b>'+p.jobs.length+'</b></div><div class="usage-project-track" style="width:'+Math.max(16,p.jobs.length/max*100)+'%"><i style="width:'+(p.jobs.filter(job => usageStateLane(job.state)==='done').length/Math.max(1,p.jobs.length)*100)+'%"></i></div></div>').join('') : '<p class="muted">还没有可统计的任务。</p>') +
    '</div></section>'
}
function usageUnitsChart(totals, jobs) {
  const rows = Object.entries(totals).sort((a,b) => b[1]-a[1])
  const missing = jobs.filter(job => !job.usage?.length).length
  return '<section class="usage-chart-card usage-units-card"><div class="usage-chart-title"><h3>用量明细</h3><span>'+(missing ? missing+' 个任务未提供用量' : '用量均已返回')+'</span></div><div class="usage-units-chart">' +
    (rows.length ? rows.map(([unit,value]) => '<div class="usage-unit-item"><span>'+x(usageUnits[unit]??unit)+'</span><strong>'+Number(value).toLocaleString('zh-CN')+'</strong></div>').join('') : '<p class="muted">当前范围没有已返回的用量。</p>') +
    '</div></section>'
}
function usageLanes(jobs, scopedProjects) {
  if (usageGroup === 'project') return scopedProjects.map(p => ({ key:p.id, label:p.title, detail:p.languages.map(lang => langs[lang] ?? lang).join(' · '), jobs:p.jobs }))
  if (usageGroup === 'task' || usageGroup === 'stage') return usageTaskFamilies.map(([name,tasks]) => ({ key:name, label:name, detail:usageTaskFamilies.find(item => item[0]===name)[1].map(task => usageJobLabels[task] ?? task).join(' / '), jobs:jobs.filter(job => tasks.includes(job.plan.task)) }))
  return [
    { key:'active', label:'处理中', detail:'排队或正在执行', jobs:jobs.filter(job => usageStateLane(job.state)==='active') },
    { key:'query', label:'待查询', detail:'结果未知，先核对原任务', jobs:jobs.filter(job => usageStateLane(job.state)==='query') },
    { key:'done', label:'已完成', detail:'已有结果的调用', jobs:jobs.filter(job => usageStateLane(job.state)==='done') },
    { key:'attention', label:'需要处理', detail:'失败或异常任务', jobs:jobs.filter(job => usageStateLane(job.state)==='attention') },
  ]
}
function jobsPage() {
  const all = []
  const seen = new Set()
  for (const p of usageOverview.projects ?? []) {
    const current = project?.id === p.id ? Object.values(project.jobs) : p.jobs
    seen.add(p.id)
    for (const job of current) all.push(usageJobProject(job,p))
  }
  if (project && !seen.has(project.id)) {
    const source = usageOverview.projects?.find(item => item.id === project.id)
    const p = { id:project.id, title:project.title, languages:project.languages, pricing:source?.pricing }
    for (const job of Object.values(project.jobs)) all.push(usageJobProject(job,p))
  }
  const scopedProjects = projects.map(summary => {
    const source = usageOverview.projects?.find(item => item.id === summary.id)
    if (!source) return summary
    const projectJobs = summary.id === project?.id ? Object.values(project.jobs) : source.jobs
    return {...summary,...source,jobs:projectJobs.map(job => usageJobProject(job,{id:summary.id,title:summary.title}))}
  }).filter(p => p.jobs).filter(p => usageScope === 'all' || p.id === project?.id)
  const jobs = usageScope === 'current' ? all.filter(job => job.project_id === project?.id) : all
  const total = {}
  for (const job of jobs) for (const unit of job.usage || []) total[unit.unit] = (total[unit.unit] || 0) + unit.quantity
  const active = jobs.filter(job => usageStateLane(job.state)==='active').length
  const query = jobs.filter(job => usageStateLane(job.state)==='query').length
  const failed = jobs.filter(job => usageStateLane(job.state)==='attention').length
  const completed = jobs.filter(job => usageStateLane(job.state)==='done').length
  const estimatedCost = jobs.reduce((sum, job) => sum + (usageCost(job) ?? 0), 0)
  const billing = usageScope === 'current' ? project.billing ?? [] : (usageOverview.projects ?? []).flatMap(item => item.billing ?? [])
  const actualCny = billing.filter(item => item.currency === 'CNY').reduce((sum,item) => sum + Number(item.amount || 0), 0)
  const actualUsd = billing.filter(item => item.currency === 'USD').reduce((sum,item) => sum + Number(item.amount || 0), 0)
  const lanes = usageLanes(jobs, scopedProjects)
  const tools = is('director') && cur('brief') ? card('<h2>导演建议</h2>' + form('reports',
    label('产物版本',select('target',Object.values(project.artifacts).filter(a => types.includes(a.type)).reverse().map(a => option(a.ref,a.ref)))) +
    row(button('生成导演建议',el => { const ref=getForm(el).get('target'); return job('director',{ref,language:project.artifacts[ref]?.language}) },'small')) +
    '<p class="muted">导演建议只提供下一步建议，不改变确认记录。画面和成片质检由编导、运营人工看片完成。</p>')) : ''
  const modeInfo = runtime.mode === 'dashscope' ? '阿里云百炼 · ' + x(runtime.region) + (runtime.configured ? '' : ' · 等待服务端配置') : '本地模拟 · 用量为演示数据'
  const modelInfo = runtime.mode === 'dashscope' ? show(runtime.models,'查看当前模型') + '<p class="muted">模型与地域由服务端安全配置管理，API Key 不会进入浏览器或项目记录。</p>' : ''
  const groupNames = { stage:'制作阶段', status:'状态', task:'任务类型', project:'项目' }
  const groupHeadings = { stage:'按制作阶段查看', status:'按状态查看任务', task:'按任务类型查看', project:'按项目查看任务' }
  const detailRows = jobs.slice().sort((a,b) => String(b.updated_at??b.created_at).localeCompare(String(a.updated_at??a.created_at))).map(j =>
    '<tr><td>'+x(usageJobLabels[j.plan.task] ?? j.plan.task)+'<br><small>'+x(j.project_title+' · '+[j.plan.shot_id,langs[j.plan.language],j.plan.line?.line_id].filter(Boolean).join(' · '))+'</small></td><td>'+tag(j.state)+'</td><td>'+x(usageText(j))+'</td><td>'+x(j.model)+'<br><small>'+x(j.provider_job_id??j.id)+'</small></td></tr>').join('')
  return '<section class="usage-hero"><div><p class="eyebrow">OPERATIONS OVERVIEW</p><h2>任务与用量</h2><p class="muted">' + modeInfo + '</p>' + modelInfo + '</div><div class="usage-hero-actions">' +
    button('刷新看板',async()=>{await refreshLists(); if(project) await refreshProject()},'small') +
    (project && is('operations') ? button('清理遗留任务',async()=>{
      if (!confirm('删除当前项目中所有失败和待查询任务？成功任务、产物、成片和确认记录不会删除。')) return false
      const result=await write('jobs/cleanup',{states:['failed','awaiting_query']})
      await refreshLists()
      flash('已清理 '+result.count+' 个遗留任务')
    },'small ghost') : '') + '</div></section>' +
    '<div class="usage-kpis">' +
      [['全部任务',jobs.length,usageScope==='all'?'全部项目':'当前项目'],['已完成',completed,'有结果'],['处理中',active,'排队或执行'],['待查询',query,'需要核对'],['失败',failed,'需要处理'],['预估费用',estimatedCost ? '¥' + estimatedCost.toFixed(2) : '未配置',estimatedCost ? '按项目单价估算' : '请在模型配置填写单价'],['实际账单',actualCny ? '¥' + actualCny.toFixed(2) : actualUsd ? '$' + actualUsd.toFixed(2) : '未录入',billing.length ? billing.length + ' 条账单记录' : '运营录入供应商账单']].map(([name,value,note]) => '<div class="usage-kpi"><span>'+x(name)+'</span><strong>'+x(value)+'</strong><small>'+x(note)+'</small></div>').join('') +
    '</div>' +
    '<div class="usage-toolbar"><div><span class="eyebrow">PROJECT SCOPE</span><div class="usage-segmented">' +
      [['all','全部项目'],['current','当前项目']].map(([key,label]) => button(label,()=>{usageScope=key},'small '+(usageScope===key?'active':''),key==='current'&&!project,'aria-pressed="'+(usageScope===key)+'"')).join('') +
    '</div></div><div><span class="eyebrow">GROUP BY</span><div class="usage-segmented">' +
      ['stage','status','task','project'].map(key => button('按'+groupNames[key],()=>{usageGroup=key},'small '+(usageGroup===key?'active':''),false,'aria-pressed="'+(usageGroup===key)+'"')).join('') +
    '</div></div><div class="usage-note">用量为任务记录中实际返回的数量；未返回时保持“未提供”，不补零。预估价不等于账单。</div></div>' +
    (project && is('operations') ? '<details class="billing-panel"><summary>录入实际账单</summary><div class="grid">' +
      label('金额',input('billing_amount','','number')) + label('币种',select('billing_currency',[option('CNY','人民币 CNY',true),option('USD','美元 USD')])) +
      label('账期开始',input('billing_start','','date')) + label('账期结束',input('billing_end','','date')) +
      label('供应商账单号',input('billing_reference','','text')) + '</div>' +
      label('备注',area('billing_note','')) +
      row(button('保存账单',async el=>{const f=getForm(el);await write('billing',{amount:Number(f.get('billing_amount')),currency:f.get('billing_currency'),period_start:f.get('billing_start'),period_end:f.get('billing_end'),provider_reference:f.get('billing_reference'),note:f.get('billing_note')});await refreshLists();flash('实际账单已记录')},'primary')) +
      (billing.length ? '<div class="list">' + billing.slice().reverse().map(item=>'<div class="list-item"><div class="spread"><b>'+x(item.currency+' '+Number(item.amount).toFixed(2))+'</b><small>'+x(new Date(item.at).toLocaleString('zh-CN'))+'</small></div><p class="muted">'+x([item.period_start,item.period_end,item.provider_reference,item.note].filter(Boolean).join(' · '))+'</p></div>').join('') + '</div>' : '<p class="muted">尚未录入实际账单。</p>') +
      '</details>' : '') +
    '<div class="usage-charts">'+usageDonut(jobs)+usageWeekChart(jobs)+usageMixChart(jobs)+usageProjectChart(scopedProjects)+usageUnitsChart(total,jobs)+'</div>' +
    '<section class="usage-board-section"><div class="usage-board-heading"><div><p class="eyebrow">TASK BOARD</p><h3>'+groupHeadings[usageGroup]+'</h3></div><span>'+jobs.length+' 个任务</span></div>' +
      '<div class="usage-board group-'+usageGroup+'">'+
        lanes.map((lane,index) => '<details class="usage-lane"'+((usageGroup !== 'stage' || index === 0 || lane.jobs.some(job => ['queued','running','awaiting_query','failed'].includes(job.state))) ? ' open' : '')+'><summary><div><h4>'+x(lane.label)+'</h4><p>'+x(lane.detail)+'</p></div><b>'+lane.jobs.length+'</b></summary><div class="usage-lane-list">'+
          (lane.jobs.length ? lane.jobs.slice(0,8).map(job => usageTaskCard(job)).join('') : '<p class="usage-empty">暂无任务</p>') +
          (lane.jobs.length>8 ? '<details class="usage-more"><summary>展开其余 '+(lane.jobs.length-8)+' 个任务</summary>'+lane.jobs.slice(8).map(job => usageTaskCard(job)).join('')+'</details>' : '') +
        '</div></details>').join('')+
      '</div></section>' +
    '<details class="usage-table-details"><summary>查看详细任务表</summary>'+(detailRows?'<div class="table"><table><thead><tr><th>阶段</th><th>状态</th><th>用量</th><th>模型与任务号</th></tr></thead><tbody>'+detailRows+'</tbody></table></div>':'<p class="muted">暂无任务</p>')+'</details>' + tools
}
function modelConfigPage() {
  const info = modelConfig ?? {}
  const models = info.models ?? {}
  const canEdit = info.can_edit === true
  const current = info.api_key_configured ? '已配置' : '未配置'
  const voiceState = value => value ? '已配置' : '未配置'
  return card('<div class="spread"><h2>模型服务</h2>' + tag(info.mode === 'dashscope' ? '百炼' : '本地模拟') + '</div>' +
    '<p class="muted">开发阶段继续使用现有百炼适配器。每个项目使用独立的服务端配置文件和 API Key，保存到 `' + x('provider-config/<项目>.json') + '`（权限 600）。Key 不会进入项目数据库、任务记录、成片或浏览器返回值；未配置的项目回退到服务端环境变量。</p>' +
    '<div class="model-status-grid"><div><span>运行模式</span><b>'+x(info.mode ?? '未知')+'</b></div><div><span>地域</span><b>'+x(info.region ?? '未配置')+'</b></div><div><span>业务空间</span><b>'+x(info.workspace || '未配置')+'</b></div><div><span>API Key</span><b>'+x(current)+'</b></div><div><span>配置来源</span><b>'+x(info.source ?? '未读取')+'</b></div></div>' +
    ['text','image','video','speech'].map(key => '<div class="model-row"><span>'+x({text:'文字',image:'图片',video:'视频',speech:'语音'}[key])+'</span><code>'+x(models[key] ?? '未配置')+'</code></div>').join('') +
    '<div class="model-voice-row"><span>音色</span><b>中文 '+x(voiceState(info.voices?.['zh-CN']))+' · 英文 '+x(voiceState(info.voices?.en))+' · 泰语 '+x(voiceState(info.voices?.th))+'</b></div>' +
    '<div class="model-cost-row"><span>费用单价</span><b>' + [['text_input_per_1k','输入 Token/千'],['text_output_per_1k','输出 Token/千'],['image_each','图片/次'],['video_second','视频/秒'],['speech_character','配音/字']].map(([key,name]) => name + '：' + (Number.isFinite(info.pricing?.[key]) ? '¥' + info.pricing[key] : '未配置')).join(' · ') + '</b></div>' +
    (canEdit ? form('model-config', '<div class="grid">' +
      label('服务地域',select('region',[option('cn-beijing','北京',info.region === 'cn-beijing'),option('ap-southeast-1','新加坡',info.region === 'ap-southeast-1')])) +
      label('业务空间 ID',input('workspace',info.workspace ?? '')) +
      label('文字模型',input('text',models.text ?? 'qwen-plus')) +
      label('图片模型',input('image',models.image ?? 'qwen-image-3.0-pro')) +
      '</div><div class="grid">' + label('视频模型',input('video',models.video ?? 'wan3.0-video')) +
      label('语音模型',input('speech',models.speech ?? 'qwen-audio-3.1-tts-flash')) +
      label('中文音色 ID',input('voice_zh','')) + label('英文音色 ID',input('voice_en','')) +
      '</div>' + label('泰语音色 ID',input('voice_th','')) +
      '<details class="pricing-fields"><summary>费用单价（人民币，留空不修改）</summary><div class="grid">' +
      label('输入 Token / 千',input('text_input_per_1k',info.pricing?.text_input_per_1k ?? '','number')) +
      label('输出 Token / 千',input('text_output_per_1k',info.pricing?.text_output_per_1k ?? '','number')) +
      label('图片 / 次',input('image_each',info.pricing?.image_each ?? '','number')) +
      label('视频 / 秒',input('video_second',info.pricing?.video_second ?? '','number')) +
      label('配音 / 字',input('speech_character',info.pricing?.speech_character ?? '','number')) + '</div>' +
      '<p class="muted">单价由项目运营按实际采购价格填写。任务页只显示估算，不替代供应商账单。</p></details>' +
      '<details><summary>更新 API Key（留空保持现有 Key）</summary>' + label('API Key','<input name="api_key" type="password" autocomplete="new-password" placeholder="已配置，留空不修改">') + '</details>' +
      row(button('保存模型配置',async el=>{
        const f=getForm(el)
        const result=await api(base()+'/model-config','POST',{
          region:f.get('region'),workspace:f.get('workspace'),text:f.get('text'),image:f.get('image'),video:f.get('video'),speech:f.get('speech'),
          voice_zh:f.get('voice_zh'),voice_en:f.get('voice_en'),voice_th:f.get('voice_th'),api_key:f.get('api_key'),
          text_input_per_1k:f.get('text_input_per_1k'),text_output_per_1k:f.get('text_output_per_1k'),
          image_each:f.get('image_each'),video_second:f.get('video_second'),speech_character:f.get('speech_character'),
        })
        modelConfig=result
        clearFormDraft(el.closest('form'))
        flash('模型配置已保存，新的真实任务将使用这组配置。')
      },'primary'))) : '<p class="muted">当前账号只能查看模型配置；运营或负责人可以修改。</p>') +
    '<p class="muted">三个团队可分别在自己的项目中配置三组 Key、地域和业务空间。修改只影响当前项目和下一次真实调用，不会重跑已有任务或历史成片。</p>')
}
function teamPage() {
  const members = Object.entries(project.members).map(([role, account]) => ({
    role, account, name: project.member_profiles?.[account]?.name ?? actorName(account),
    label: role === 'operations' ? '运营' : role === 'director' ? '编导' : role === 'owner' ? '负责人' : '历史兼容审核',
  }))
  const canEdit = is('operations')
  const memberForm = role => '<div class="grid">' +
    label('账号', input(role + '_account', '', 'text')) +
    label('姓名', input(role + '_name', '', 'text')) +
    label('新账号初始密码', input(role + '_password', '', 'password')) + '</div>'
  return card('<div class="spread"><div><span class="eyebrow">TEAM ACCESS</span><h2>团队与权限</h2></div><span class="tag">' + x(project.title) + '</span></div>' +
    '<p class="muted">每位成员只能访问被分配的项目。运营可以新增或替换编导、负责人账号；新账号密码只保存加盐哈希，页面和接口不会回显。</p>' +
    '<div class="team-members">' + members.map(item => '<div class="team-member"><span>' + x(item.label) + '</span><b>' + x(item.name) + '</b><small>' + x(item.account) + '</small></div>').join('') + '</div>' +
    (canEdit ? form('team-update', '<details open><summary>添加或替换编导</summary>' + memberForm('director') + '</details>' +
      '<details><summary>添加或替换负责人</summary>' + memberForm('owner') + '</details>' +
      row(button('保存团队成员', async el => {
        const f = getForm(el)
        const members = {}
        for (const role of ['director','owner']) {
          const account = String(f.get(role + '_account') ?? '').trim()
          if (!account) continue
          members[role] = { account, name:String(f.get(role + '_name') ?? '').trim(), password:String(f.get(role + '_password') ?? '') }
        }
        if (!Object.keys(members).length) throw new Error('请填写至少一个要添加或替换的成员账号')
        await write('team', { members })
        await refreshProject()
        flash('团队成员已更新，新账号可立即登录')
      }, 'primary'))) : '<p class="muted">只有项目运营可以管理成员。</p>'))
}
function focusNextAction(destination, canAct, targetSelector) {
  const actionable = {
    brief:'#brief-editor textarea[name="raw"]',
    story:session.role === 'director' ? '#character-cards input[name="name0"]' : '.panel',
    assets:session.role === 'director' ? '[id^="asset-person-"] select' : '.panel',
    shots:session.role === 'director' ? 'details.shot-arrangement > summary' : '.panel',
    language:session.role === 'director' ? '#language-edit input, #language-edit select, .panel button' : '.panel',
    delivery:session.role === 'director' ? '#composer select' : ['operations','reviewer'].includes(session.role) ? 'form[id^="delivery-review-"] input' : 'a.btn',
  }
  const target = canAct ? document.querySelector(targetSelector || actionable[destination] || '.workflow-heading') : document.querySelector('.next-action')
  if (target?.tagName === 'DETAILS') target.open = true
  target?.scrollIntoView({ behavior:'smooth', block:'center' })
  if (target && ['INPUT','TEXTAREA','SELECT'].includes(target.tagName)) target.focus({ preventScroll:true })
}
function nextAction() {
  const brief=cur('brief'), idea=cur('concept'), script=cur('script'), board=cur('storyboard'), cut=cur('cut')
  const lang=cur('language',language), delivery=cur('delivery',language)
  const director=is('director'), ops=is('operations'), approver=is(project.members.reviewer ? 'reviewer' : 'operations')
  let title, detail, destination, targetSelector, buttonLabel, canAct=false
  if (!brief) { title=ops ? '填写并提交创作需求' : '等待运营提交创作需求'; detail=ops ? '写清故事、受众和限制，再提交给编导。' : '需求提交后，编导会收到站内通知并开始准备创意。'; destination='brief'; canAct=ops }
  else if (!active(1)) {
    destination='story'
    if (idea?.status === 'pending_review') {title='选择创意方向';detail=ops ? '比较候选，选择一个或填写意见退回。' : '等待运营选择创意方向。';canAct=ops}
    else {title='准备创意方向';detail=director ? (!cur('characters') ? '先填写两位主角，保存后生成创意。' : '生成创意，检查或修改后提交运营选择。') : '等待编导准备创意并提交。';canAct=director}
  } else if (!active(2)) {
    destination='story'
    if (script?.status === 'pending_review') {title='审核剧本';detail=ops ? '阅读剧本，通过或填写意见退回。' : '等待运营审核剧本。';canAct=ops}
    else {title='准备剧本';detail=director ? '根据已选创意生成剧本，检查或逐段修改后提交审核。' : '等待编导提交剧本。';canAct=director}
  } else if (!active(3) || (board?.has_shot_rework && board.ref !== active(3)?.artifact_ref)) {
    destination=board ? 'assets' : 'shots'; title=board ? '准备素材并确认分镜脚本' : '转换分镜脚本'
    detail=director ? (board ? '在素材页选择人物、场景和道具，在分镜页检查关键帧后确认。' : '把已确认的完整剧情剧本转换为分镜脚本，再准备素材和关键帧。') : '等待编导转换分镜脚本并完成素材。';canAct=director
  } else if (!active(4)) {
    destination='shots'; const approved=project.artifacts[active(3).artifact_ref], missing=approved?.data.shots.filter(shot => !project.selected[shot.shot_id]) ?? []
    title=missing.length ? '生成并选择镜头视频' : '检查画面与接镜'
    if (missing.length) targetSelector='[data-disclosure="review-'+missing[0].shot_id+'"]'
    detail=director ? (missing.length ? '还有 '+missing.length+' 个镜头未选用视频：'+missing.map(shot=>shot.shot_id).join('、')+'。展开镜头，生成后看片并选择。' : '保存画面基准，生成拼接预览，逐个检查接镜后确认。') : '等待编导完成镜头、接镜和画面确认。';canAct=director
  } else if (!active(5,language)) {
    destination='language';title='制作'+(langs[language] ?? language)+'语言素材';detail=director ? (!lang || lang.upstream !== active(4).ref ? '载入该语种对白，保存后生成专属视频与字幕。' : '检查原生对白、字幕和必要补录，选择每镜视频后生成同步预览。') : '等待编导完成该语种视频、字幕和同步预览。';canAct=director
  } else if (!active(6,language)) {
    destination='delivery'
    if (delivery?.status === 'pending_review') {
      title='验收成片'
      detail=approver ? '播放成片，核对接镜、字幕、台词、口型和音轨后通过或退回。' : '等待运营完成成片验收。' + (project.members.reviewer ? ' 此历史项目由兼容审核账号处理。' : '')
      canAct=approver
    }
    else {title='合成并提交成片';detail=director ? '选择背景音乐，合成后看片并提交验收。' : '等待编导合成并提交成片。';canAct=director}
  } else {
    destination='delivery'; title=(langs[language] ?? language)+'成片已通过验收'
    detail=ops ? '打开交付文件即可下载当前验收版。' : '成片已通过验收，可在交付页查看。'
    buttonLabel=ops ? '打开交付文件' : '查看已交付成片'
    canAct=true
  }
  return '<section class="next-action" aria-label="当前待办"><div><span class="eyebrow">当前待办 · '+x(session.name ?? labels[session.role] ?? '')+'</span><h2>'+x(title)+'</h2><p>'+x(detail)+'</p></div>' + button(buttonLabel ?? (canAct ? (tab === destination ? '开始处理' : '去处理') : '查看进度'),() => {switchTab(destination); requestAnimationFrame(() => focusNextAction(destination,canAct,targetSelector))},canAct ? 'primary' : 'small') + '</section>'
}
function runningJobsNotice() {
  const pending=Object.values(project.jobs).filter(j => ['queued','running','awaiting_query'].includes(j.state))
  if (!pending.length) return ''
  const unknown=pending.filter(j => j.state === 'awaiting_query').length
  return '<div class="job-notice"><span>'+x('有 '+pending.length+' 个任务正在处理或等待查询。'+(unknown ? ' 其中 '+unknown+' 个需要查询原任务，请勿重复提交。' : ' 完成后刷新项目查看结果。'))+'</span>' + button('刷新状态',refreshProject,'small') + button('查看任务',() => switchTab('jobs'),'small ghost') + '</div>'
}
function tabRequirement(tabName) {
  const brief = cur('brief')
  if (['brief','jobs','models','team'].includes(tabName)) return ''
  if (!brief) return '先完成需求，再进入后续制作。'
  if (tabName === 'story') return ''
  if (['assets','shots'].includes(tabName) && !active(2)) return '运营或编导确认剧本后开放。'
  if (tabName === 'language' && !active(4)) return '完成画面与接镜确认后开放。'
  if (tabName === 'delivery' && !active(5,language)) return '完成当前语种的语言素材确认后开放。'
  return ''
}
function lockedTabCard(tabName, requirement) {
  return card('<div class="locked-stage-icon">⌛</div><h2>' + x(tabNames[tabs.indexOf(tabName)]) + '尚未开放</h2><p class="text">' + x(requirement) + '</p>' +
    button('返回需求与当前待办',() => switchTab('brief'), 'small'))
}
function projectPage() {
  const currentRoute = focus ? project.artifacts[focus] : null
  const panel = { brief:briefPage, story:storyPage, assets:assetsPage, shots:shotPage, language:languagePage, delivery:deliveriesPage, jobs:jobsPage, models:modelConfigPage, team:teamPage }[tab]
  const highlighted = currentRoute ? card('<div class="spread"><h2>通知对应版本</h2>' + tag(currentRoute.status) + '</div>' + version(currentRoute) + note(currentRoute) +
    show(currentRoute.data,'查看对应产物') + (currentRoute.type === 'delivery' ? video(base()+'/deliveries/'+encoded(currentRoute.ref)+'/preview','通知对应成片') : '')) : ''
  const feedback = is('owner') ? card('<h2>给编导反馈</h2>' + form('feedback',
    label('产物版本',select('ref',[option('','项目整体'), ...Object.values(project.artifacts).reverse().map(a => option(a.ref,a.ref))])) +
    label('意见',area('note','')) + button('发送项目反馈',el => write('feedback',Object.fromEntries(getForm(el))),'small'))) : ''
  const feedbackHistory = project.feedback?.length ? card('<div class="spread"><h2>负责人反馈</h2><span class="tag">运营与编导可见</span></div><div class="list">' +
    project.feedback.slice().reverse().map(item => '<div class="list-item"><div class="spread"><b>' + x(actorName(item.actor)) + '</b><small>' + x(new Date(item.at).toLocaleString('zh-CN')) + '</small></div><p class="text">' + x(item.note) + '</p><small>' + x(item.ref ? '对应版本 ' + item.ref : '项目整体意见') + '</small></div>').join('') + '</div>') : ''
  const series = project.episode?.series_id ?? project.id
  const episodes = projects.filter(item => item.series_id === series).sort((a,b) => a.number - b.number)
  const episodeLinks = episodes.length > 1 ? row(episodes.map(item => button('第 ' + item.number + ' 集 · ' + item.title,
    () => enter(item.id, tab), item.id === project.id ? 'small active' : 'small', item.id === project.id)).join('')) : ''
  const newEpisode = is('operations') && active(3) && tab === 'brief' ? '<details><summary>新建续集</summary>' +
    form('new-episode', label('续集名称', input('title')) + button('创建并沿用已确认资产', async el => {
      const result = await write('episodes', { title:getForm(el).get('title') })
      await refreshLists()
      await enter(result.id)
    },'primary')) + '</details>' : ''
  const board=cur('storyboard'), cover=board && Object.values(board.data.keyframes ?? {}).find(ref=>project.assets[ref]?.kind==='image')
  const confirmed=[1,2,3,4,5,6].reduce((sum,step) => sum + (active(step,step >= 5 ? language : null) ? 1 : 0),0)
  const completedProject = project.languages.length > 0 && project.languages.every(code => active(6,code))
  const readOnlyStage = completedProject && !completedEdit && ['story','assets','shots','language'].includes(tab)
  const canRequestEdit = is('operations') || is('director')
  const unsaved = [...formDrafts.keys()].some(key => key.startsWith(project.id + ':' + session.role + ':'))
  const tabState = {
    brief:cur('brief') ? '已提交' : '待填写',
    story:[active(1),active(2)].filter(Boolean).length + '/2',
    assets:active(3) ? '已包含' : active(2) ? '待准备' : '未开放',
    shots:[active(3),active(4)].filter(Boolean).length + '/2',
    language:active(5,language) ? '已确认' : active(4) ? '待制作' : '未开放',
    delivery:active(6,language) ? '已验收' : active(5,language) ? '待提交' : '未开放',
  }
  const lock = tabRequirement(tab)
  return '<div class="project-hero">' + (cover ? '<div class="hero-art" aria-hidden="true"><img src="'+x(media(cover))+'" alt=""></div>' : '') +
    '<div class="hero-content"><p class="eyebrow">PROJECT WORKSPACE <span>/</span> 当前项目</p><h1>' + x(project.title) + '</h1><p class="hero-people">' +
    x(Object.values(project.members).map(actorName).join('  /  ') + (project.brief.due ? ' · 期望交付 ' + project.brief.due : '')) +
    '</p><div class="hero-actions"><span class="hero-status"><i></i> '+(confirmed === 6 ? '已完成' : '制作中')+'</span><span class="hero-count">已确认 <b>'+confirmed+'</b> / 6 个节点</span><span id="unsaved-indicator" class="unsaved-indicator"'+(unsaved ? '' : ' hidden')+'>本机草稿未提交</span>' + button('刷新项目',refreshProject,'small ghost') + '</div></div></div>' +
    episodeLinks + newEpisode + '<nav class="tabs" role="tablist" aria-label="项目工作区">' + tabs.map((v,i) => {
      const requirement = tabRequirement(v), blocked = Boolean(requirement) && v !== 'jobs'
      return button((blocked ? '🔒 ' : '') + tabNames[i] + ' · ' + tabState[v],() => switchTab(v),v === tab ? 'active' : '',false,
        'id="workspace-tab-'+v+'" role="tab" aria-selected="'+(v===tab)+'" aria-controls="workspace-panel" tabindex="'+(v===tab?0:-1)+'"'+(blocked ? ' title="'+x(requirement)+'"' : ''))
    }).join('') + '</nav>' +
    nextAction() + runningJobsNotice() +
    agentAdvice(tab === 'story' ? [cur('script')?.ref, cur('concept')?.ref].filter(Boolean) : tab === 'assets' || tab === 'shots' ? [cur('storyboard')?.ref].filter(Boolean) : tab === 'language' ? [cur('language',language)?.ref].filter(Boolean) : tab === 'delivery' ? [cur('delivery',language)?.ref].filter(Boolean) : []) +
    highlighted +
    (readOnlyStage ? '<section class="completed-lock"><b>项目已完成，当前内容只读。</b><span>如需修改这一阶段，会重开后续确认并产生新版本；已有成片和历史文件继续保留。</span>' +
      (canRequestEdit ? button('进入修改模式',()=>{
        if (!confirm('进入修改模式后，保存改动会重开后续确认。已有历史文件和成片不会删除。继续吗？')) return false
        completedEdit = true
      },'small') : '') + '</section>' : '') +
    '<div id="workspace-panel" role="tabpanel" aria-labelledby="workspace-tab-'+tab+'"'+(readOnlyStage?' class="completed-readonly" inert':'')+'>' + (lock ? lockedTabCard(tab,lock) : panel()) + '</div>' + feedbackHistory + feedback
}
function mountLayoutEditors() {
  const ns='http://www.w3.org/2000/svg'
  for(const form of root.querySelectorAll('form[id^="layout-"]')) {
    const svg=form.querySelector('svg.layout-editor'); if(!svg) continue
    const fields=name=>form.elements.namedItem(name), value=name=>Number(fields(name)?.value)
    const node=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text)e.textContent=text;svg.append(e);return e}
    const draw=()=>{
      svg.replaceChildren(); node('rect',{x:0,y:0,width:10,height:8,fill:'#f7f4eb',stroke:'#5c5667','stroke-width':'.04'})
      for(const prefix of ['object','object_1','object_2','object_3']){
        if(prefix!=='object' && !fields(prefix+'_name')?.value.trim())continue
        const ox=value(prefix+'_x'),oy=value(prefix+'_y'),w=value(prefix+'_w'),h=value(prefix+'_h')
        node('rect',{x:ox-w/2,y:8-oy-h/2,width:w,height:h,fill:'#ded5c1',stroke:'#594e40','stroke-width':'.05','data-drag':prefix})
        node('text',{x:ox,y:8-oy,'text-anchor':'middle','font-size':'.28',fill:'#302a24','pointer-events':'none'},fields(prefix+'_name')?.value || '固定物')
      }
      for(let i=0;fields('person_'+i+'_start_x');i++){
        const x1=value('person_'+i+'_start_x'),y1=value('person_'+i+'_start_y'),x2=value('person_'+i+'_end_x'),y2=value('person_'+i+'_end_y')
        const vx=fields('person_'+i+'_via_x')?.value,vy=fields('person_'+i+'_via_y')?.value
        const points=[[x1,8-y1],...(vx!=='' && vy!=='' ? [[Number(vx),8-Number(vy)]] : []),[x2,8-y2]]
        node('polyline',{points:points.map(p=>p.join(',')).join(' '),fill:'none',stroke:i?'#586dc7':'#d04747','stroke-width':'.07','stroke-dasharray':'.15 .1'})
        for(const [part,x,y] of [['start',x1,y1],['end',x2,y2],...(vx!=='' && vy!=='' ? [['via',Number(vx),Number(vy)]] : [])]){
          node('circle',{cx:x,cy:8-y,r:'.22',fill:i?'#586dc7':'#d04747',stroke:'white','stroke-width':'.04','data-drag':'person_'+i+'_'+part})
          node('text',{x:x,y:8-y-.32,'text-anchor':'middle','font-size':'.23',fill:'#302a24','pointer-events':'none'},(i+1)+(part==='start'?'起':part==='end'?'终':'经'))
        }
      }
      const cx=value('camera_x'),cy=value('camera_y');node('circle',{cx,cy:8-cy,r:'.24',fill:'#18825a','data-drag':'camera'})
      node('text',{x:cx,y:8-cy-.32,'text-anchor':'middle','font-size':'.23',fill:'#155d42','pointer-events':'none'},'机位')
    }
    let dragging=null
    svg.addEventListener('pointerdown',e=>{const name=e.target.dataset.drag;if(!name)return;dragging=name;svg.setPointerCapture(e.pointerId);e.preventDefault()})
    svg.addEventListener('pointermove',e=>{if(!dragging)return;const r=svg.getBoundingClientRect(),x=Math.max(0,Math.min(10,(e.clientX-r.left)/r.width*10)),y=Math.max(0,Math.min(8,8-(e.clientY-r.top)/r.height*8)); fields(dragging+'_x').value=x.toFixed(1);fields(dragging+'_y').value=y.toFixed(1);draw()})
    svg.addEventListener('pointerup',()=>{dragging=null});svg.addEventListener('pointercancel',()=>{dragging=null})
    form.addEventListener('input',draw); draw()
  }
}
function mountWaveforms() {
  const Context = window.AudioContext || window.webkitAudioContext
  if (!Context) return
  for (const node of root.querySelectorAll('[data-waveform-src]')) {
    const src = node.dataset.waveformSrc
    const bars = node.querySelector('.audio-wave-bars')
    if (!src || !bars || node.dataset.ready === '1') continue
    node.dataset.ready = '1'
    void fetch(src).then(response => response.arrayBuffer()).then(buffer => new Promise((resolve, reject) => {
      const context = new Context()
      context.decodeAudioData(buffer, audio => { context.close(); resolve(audio) }, reject)
    })).then(audio => {
      const channel = audio.getChannelData(0)
      const count = 56, step = Math.max(1, Math.floor(channel.length / count))
      const peaks = Array.from({length:count}, (_, index) => {
        let peak = 0
        for (let i=index*step; i<Math.min(channel.length,(index+1)*step); i+=Math.max(1,Math.floor(step/30))) peak = Math.max(peak, Math.abs(channel[i]))
        return peak
      })
      const max = Math.max(.01, ...peaks)
      bars.innerHTML = '<svg viewBox="0 0 560 54" preserveAspectRatio="none" aria-hidden="true">' +
        peaks.map((peak, index) => {
          const height = Math.max(6, Math.round(peak / max * 52))
          return '<rect x="'+index*10+'" y="'+((54-height)/2)+'" width="7" height="'+height+'" rx="2"></rect>'
        }).join('') + '</svg>'
    }).catch(() => { bars.innerHTML = '<span class="audio-wave-error">波形暂不可读，仍可试听和调整时间</span>' })
  }
}
function mountShotArrangement() {
  const form = root.querySelector('#shot-arrangement-form')
  if (!form) return
  const script = project.artifacts[active(2)?.artifact_ref]?.data
  const list = form.querySelector('[data-shot-cards]')
  const impact = form.querySelector('[data-shot-impact]')
  const snapshot = JSON.parse(form.querySelector('[data-shot-snapshot]').value || '[]')
  const original = new Map(snapshot.map(shot => [shot.shot_id, shot]))
  const template = form.querySelector('[data-new-shot-template]')
  const pairs = shots => new Set(shots.slice(0, -1).map((shot, index) => shot.shot_id + ':' + shots[index + 1].shot_id))
  const content = shot => JSON.stringify({
    beat_ids:shot.beat_ids, purpose:shot.purpose, character_ids:[...shot.character_ids].sort(), scene:shot.scene, framing:shot.framing,
    camera:shot.camera, start_state:shot.start_state, action:shot.action, end_state:shot.end_state, continuity:shot.continuity,
    duration_ms:shot.duration_ms,
  })
  const field = (card, name) => card.querySelector('[data-field="' + name + '"]')
  const readShot = card => {
    const text = name => field(card, name)?.value.trim() ?? ''
    const beatIds = [...card.querySelectorAll('[data-field="beat_ids"]:checked')].map(node => node.value)
    const characterIds = [...card.querySelectorAll('[data-field="character_ids"]:checked')].map(node => node.value)
    const beats = new Map(script.beats.map(beat => [beat.beat_id, beat]))
    return {
      shot_id:card.dataset.shotId, beat_ids:beatIds, purpose:text('purpose'), character_ids:characterIds,
      scene:text('scene'), framing:text('framing'), camera:text('camera'), start_state:text('start_state'),
      action:text('action'), end_state:text('end_state'), continuity:text('continuity'),
      duration_ms:Math.round(Number(field(card, 'duration_ms')?.value ?? 0) * 1000),
      dialogue:beatIds.flatMap(id => beats.get(id)?.dialogue ?? []),
    }
  }
  const cards = () => [...list.querySelectorAll('[data-shot-card]')]
  const readAll = () => cards().map((card, index) => ({ ...readShot(card), order:index + 1 }))
  const updateCard = (card, index) => {
    const shot = readShot(card)
    card.querySelector('[data-shot-sequence]').textContent = '镜头 ' + (index + 1)
    card.querySelector('[data-shot-id-label]').textContent = shot.shot_id
    card.querySelector('[data-shot-duration]').textContent = (shot.duration_ms / 1000 || 0) + ' 秒'
    card.querySelector('[data-shot-summary]').textContent = [shot.framing, shot.action].filter(Boolean).join(' · ')
    const lines = shotLines(shot, script)
    const keyframe = project.artifacts[form.dataset.boardRef]?.data.keyframes?.[shot.shot_id]
    const names = script.characters.filter(person => shot.character_ids.includes(person.character_id)).map(person => person.name)
    card.querySelector('.shot-card-meta').innerHTML = '<span>关键帧：' + x(keyframe || '待补') + '</span><span>出场：' +
      x(names.join('、') || '无人物入画') + '</span><span>' + (lines.length ? lines.length + ' 句对白' : '无对白') + '</span>'
    card.querySelector('[data-shot-dialogue]').innerHTML = lines.length ? lines.map(line =>
      '<p><b>' + x(script.characters.find(person => person.character_id === line.speaker_id)?.name ?? line.speaker_id) + '</b> · ' + x(line.text) + '</p>').join('') :
      '<p class="muted">本镜没有对白。</p>'
    for (const direction of ['up','down']) {
      const node = card.querySelector('[data-shot-command="' + direction + '"]')
      node.disabled = direction === 'up' ? index === 0 : index === cards().length - 1
      node.setAttribute('aria-label', (direction === 'up' ? '上移' : '下移') + '镜头 ' + (index + 1))
    }
    const remove = card.querySelector('[data-shot-command="delete"]')
    remove.setAttribute('aria-label', '删除镜头 ' + (index + 1))
  }
  const updateImpact = () => {
    cards().forEach(updateCard)
    const current = readAll()
    const now = new Map(current.map(shot => [shot.shot_id, shot]))
    const added = current.filter(shot => !original.has(shot.shot_id)).map(shot => shot.shot_id)
    const deleted = [...original.keys()].filter(id => !now.has(id))
    const oldSurviving = snapshot.filter(shot => now.has(shot.shot_id)).map(shot => shot.shot_id)
    const newSurviving = current.filter(shot => original.has(shot.shot_id)).map(shot => shot.shot_id)
    const reordered = JSON.stringify(oldSurviving) !== JSON.stringify(newSurviving)
    const modified = current.filter(shot => original.has(shot.shot_id) && content(shot) !== content(original.get(shot.shot_id))).map(shot => shot.shot_id)
    const invalidKeyframes = current.filter(shot => {
      const before = original.get(shot.shot_id)
      if (!before) return true
      return JSON.stringify([...before.character_ids].sort()) !== JSON.stringify([...shot.character_ids].sort()) ||
        ['scene','framing','start_state'].some(key => before[key] !== shot[key])
    }).map(shot => shot.shot_id)
    const oldPairs = pairs(snapshot), newPairs = pairs(current)
    const changedPairs = [...new Set([...oldPairs,...newPairs])].filter(pair => oldPairs.has(pair) !== newPairs.has(pair))
    const changes = []
    if (added.length) changes.push('新增 ' + added.length + ' 镜')
    if (deleted.length) changes.push('删除 ' + deleted.length + ' 镜')
    if (modified.length) changes.push('修改 ' + modified.length + ' 镜')
    if (reordered) changes.push('调整镜头顺序')
    const total = current.reduce((sum, shot) => sum + (Number.isFinite(shot.duration_ms) ? shot.duration_ms : 0), 0)
    if (!changes.length) {
      impact.className = 'shot-impact'
      impact.textContent = '尚未改动。当前共 ' + current.length + ' 个镜头，合计 ' + (total / 1000) + ' 秒。'
    } else {
      impact.className = 'shot-impact has-changes'
      impact.innerHTML = '<b>保存后：' + x(changes.join('、')) + '，共 ' + current.length + ' 镜 / ' + (total / 1000) + ' 秒。</b><span>' +
        (invalidKeyframes.length ? x(invalidKeyframes.length + ' 个首帧需重新选择') : '已选首帧可保留') + '；' +
        ((added.length || modified.length) ? x((added.length + modified.length) + ' 个镜头需重新生成视频') : '已有视频可继续对照') + '；' +
        (changedPairs.length ? x(changedPairs.length + ' 个相邻接点需重查') : '相邻接点不变') +
        (deleted.length ? '。被删镜头的视频文件和历史版本仍保留。' : '。') + '</span>'
    }
    return current
  }
  const validate = current => {
    for (const [index, shot] of current.entries()) {
      const number = '第 ' + (index + 1) + ' 个镜头'
      for (const [key, name] of arrangementFields) if (!shot[key]) throw new Error(number + '的“' + name + '”不能为空')
      if (!Number.isFinite(shot.duration_ms) || shot.duration_ms <= 0) throw new Error(number + '的时长必须大于 0')
      if (!shot.beat_ids.length) throw new Error(number + '至少选择一个剧本段落')
      if (shot.character_ids.length > 2) throw new Error(number + '最多选择两位出场人物')
    }
    const lineIds = current.flatMap(shot => shotLines(shot, script).map(line => line.line_id))
    const duplicates = lineIds.filter((line, index) => lineIds.indexOf(line) !== index)
    if (duplicates.length) throw new Error('同一句对白只能放在一个镜头里：' + [...new Set(duplicates)].join('、'))
    const expected = new Set(script.beats.flatMap(beat => beat.dialogue.map(line => line.line_id)))
    const missing = [...expected].filter(line => !lineIds.includes(line))
    if (missing.length) throw new Error('还有剧本对白未安排到镜头：' + missing.join('、') + '。请检查“对应剧本段落”。')
  }
  const renumber = () => cards().forEach(updateCard)
  form.addEventListener('input', updateImpact)
  form.addEventListener('change', updateImpact)
  form.addEventListener('click', async event => {
    const command = event.target.closest('[data-shot-command]')?.dataset.shotCommand
    if (!command) return
    event.preventDefault()
    if (busy) return
    if (command === 'add') {
      const newCard = template.content.firstElementChild.cloneNode(true)
      const largest = cards().reduce((max, card) => {
        const match = /^S(\d+)$/.exec(card.dataset.shotId)
        return match ? Math.max(max, Number(match[1])) : max
      }, 0)
      let number = largest + 1
      const used = new Set(cards().map(card => card.dataset.shotId))
      while (used.has('S' + String(number).padStart(2,'0'))) number++
      const id = 'S' + String(number).padStart(2,'0')
      newCard.dataset.shotId = id
      newCard.querySelector('[data-shot-id-label]').textContent = id
      for (const node of newCard.querySelectorAll('[data-field]')) {
        const key = node.dataset.field
        if (key === 'character_ids' || key === 'beat_ids') node.name = 'shot_' + id + '_' + key
        else node.name = 'shot_' + id + '_' + key
      }
      const assigned = new Set(cards().flatMap(card => [...card.querySelectorAll('[data-field="beat_ids"]:checked')].map(node => node.value)))
      const beat = script.beats.find(item => !assigned.has(item.beat_id)) ??
        [...script.beats].reverse().find(item => !item.dialogue?.length) ?? script.beats.at(-1)
      newCard.querySelector('[data-field="beat_ids"][value="' + CSS.escape(beat.beat_id) + '"]').checked = true
      field(newCard,'scene').value = beat.scene
      field(newCard,'start_state').value = '动作开始前：' + beat.action
      field(newCard,'action').value = beat.action
      field(newCard,'end_state').value = '本段动作完成，画面停在一个可接到下一镜的状态。'
      field(newCard,'continuity').value = '说明与上一镜结束画面、下一镜起始画面如何承接。'
      const speakers = new Set(beat.dialogue.map(line => line.speaker_id))
      const mentioned = script.characters.filter(person =>
        speakers.has(person.character_id) || beat.action.includes(person.name) || beat.scene.includes(person.name)).map(person => person.character_id)
      for (const characterId of mentioned.slice(0, 2)) {
        const node = newCard.querySelector('[data-field="character_ids"][value="' + CSS.escape(characterId) + '"]')
        if (node) node.checked = true
      }
      list.append(newCard)
      newCard.querySelector('details').open = true
      renumber()
      field(newCard,'purpose').focus()
      return
    }
    if (command === 'save') {
      const saveButton = event.target.closest('[data-shot-command="save"]')
      try {
        const current = updateImpact()
        validate(current)
        saveButton.disabled = true
        saveButton.setAttribute('aria-busy', 'true')
        const result = await write('storyboards/arrange', { board_ref:form.dataset.boardRef, shots:current })
        const changed = result.shot_structure_revision
        flash('已保存 ' + result.ref + '。新增 ' + changed.added.length + '、删除 ' + changed.deleted.length +
          '、修改 ' + changed.modified.length + ' 镜；' + changed.keyframes_invalidated.length + ' 个首帧待补，确认新版分镜后继续。')
        clearFormDraft(form)
        render()
      } catch (error) {
        flash(error.message, true, error.field)
        if (saveButton.isConnected) {
          saveButton.disabled = false
          saveButton.removeAttribute('aria-busy')
        }
      }
      return
    }
    const card = event.target.closest('[data-shot-card]')
    if (command === 'delete') {
      if (!confirm('删除这条镜头草稿？保存前不会影响已确认版本；已有视频文件仍会保留。')) return
      const adjacent = card.nextElementSibling || card.previousElementSibling
      card.remove()
      renumber()
      updateImpact()
      ;(adjacent?.querySelector('[data-shot-command]') || form.querySelector('[data-shot-command="add"]')).focus()
      return
    }
    if (command === 'up' && card.previousElementSibling) {
      list.insertBefore(card, card.previousElementSibling)
      renumber()
      updateImpact()
      card.querySelector('[data-shot-command="up"]').focus()
    }
    if (command === 'down' && card.nextElementSibling) {
      list.insertBefore(card.nextElementSibling, card)
      renumber()
      updateImpact()
      card.querySelector('[data-shot-command="down"]').focus()
    }
  })
  updateImpact()
}
function draftKey(form) { return [project?.id,session?.role,tab,language,form.id].join(':') }
function draftStorageKey(form) { return 'inreel-form:' + draftKey(form) }
function updateDraftIndicator() {
  document.querySelector('#unsaved-indicator')?.toggleAttribute('hidden', formDrafts.size === 0)
}
function clearFormDraft(form) {
  const key = draftKey(form)
  clearTimeout(draftSyncTimers.get(key))
  draftSyncTimers.delete(key)
  formDrafts.delete(key)
  delete serverDrafts[key]
  try { localStorage.removeItem('inreel-form:' + key) } catch {}
  updateDraftIndicator()
  if (project) void api(base() + '/drafts/' + encoded(key), 'DELETE').catch(() => {})
}
function rememberForm(form) {
  if (!project || view !== 'project' || !form?.id) return
  const key = draftKey(form)
  const values=[...form.elements].filter(el => el.name && el.type !== 'file' && el.type !== 'password').map(el => ({name:el.name,type:el.type,value:el.value,checked:el.checked}))
  const payload = JSON.stringify(values)
  formDrafts.set(key,values)
  try { localStorage.setItem('inreel-form:' + key,JSON.stringify({at:Date.now(),values})) } catch {}
  updateDraftIndicator()
  clearTimeout(draftSyncTimers.get(key))
  draftSyncTimers.set(key,setTimeout(async () => {
    try {
      const saved = await api(base() + '/drafts/' + encoded(key), 'POST', { data:{ values } })
      serverDrafts[key] = saved
      if (JSON.stringify(formDrafts.get(key)) === payload) {
        formDrafts.delete(key)
        try { localStorage.removeItem('inreel-form:' + key) } catch {}
        updateDraftIndicator()
      }
    } catch {}
  }, 700))
}
function restoreForms() {
  if (!project || view !== 'project') return
  for (const form of root.querySelectorAll('form[id]')) {
    const key = draftKey(form)
    let local = null
    try { local = JSON.parse(localStorage.getItem('inreel-form:' + key)||'null') } catch {}
    if (local && Date.now()-local.at >= 7*86400000) { local=null; try { localStorage.removeItem('inreel-form:' + key) } catch {} }
    const remote = serverDrafts[key]
    const record = local && (!remote || local.at > remote.at) ? local : remote
    let values = formDrafts.get(key) ?? record?.values
    if (local && (!record || local.at > record.at)) formDrafts.set(key,local.values)
    if (!values) continue
    const elements=[...form.elements].filter(el => el.name && el.type !== 'file' && el.type !== 'password')
    values.forEach((item,i) => { const el=elements[i]; if (!el || el.name !== item.name || el.type !== item.type) return
      if (el.type === 'checkbox' || el.type === 'radio') el.checked=item.checked
      else if (el.tagName !== 'SELECT' || [...el.options].some(opt => opt.value === item.value)) el.value=item.value
    })
    for (const picker of form.querySelectorAll('.asset-picker')) { const selected=picker.querySelector('select')?.value, preview=picker.querySelector('.asset-picker-preview'); if (preview) { const changed=selected && selected!==preview.dataset.currentRef; preview.hidden=!changed; if (changed) preview.src=media(selected) } }
  }
  updateDraftIndicator()
}
const inboxSignature = list => JSON.stringify((list ?? []).map(item => [item.id,item.read_at,item.closed_at]))
const projectListSignature = list => JSON.stringify((list ?? []).map(item => [item.id,item.updated,item.task_state?.stage,item.task_state?.action,item.task_state?.my_turn]))
function editorActive() {
  return formDrafts.size > 0 || Boolean(document.activeElement?.closest?.('form input, form textarea, form select'))
}
async function pollLiveState() {
  if (!session || busy || liveRefreshBusy || document.visibilityState === 'hidden') return
  liveRefreshBusy = true
  try {
    if (view === 'project' && project) {
      const [nextProject, nextInbox, nextUsage] = await Promise.all([
        api(base()), api('/api/notifications'), tab === 'jobs' ? api('/api/usage') : Promise.resolve(null),
      ])
      const changed = nextProject.version !== project.version || inboxSignature(nextInbox) !== inboxSignature(inbox) ||
        (nextUsage && JSON.stringify({ ...nextUsage, generated_at:null }) !== JSON.stringify({ ...usageOverview, generated_at:null }))
      project = nextProject
      inbox = nextInbox
      if (nextUsage) usageOverview = nextUsage
      if (changed) {
        liveUpdatePending = true
        if (!editorActive()) { liveUpdatePending = false; render() }
      }
    } else if (view === 'projects' || view === 'inbox') {
      const [nextProjects, nextInbox] = await Promise.all([api('/api/projects'), api('/api/notifications')])
      const changed = projectListSignature(nextProjects) !== projectListSignature(projects) || inboxSignature(nextInbox) !== inboxSignature(inbox)
      projects = nextProjects
      inbox = nextInbox
      if (changed) {
        liveUpdatePending = true
        if (!editorActive()) { liveUpdatePending = false; render() }
      }
    }
  } catch {}
  finally { liveRefreshBusy = false }
}
function startLiveRefresh() {
  clearInterval(liveRefreshTimer)
  liveRefreshTimer = setInterval(pollLiveState, 5000)
}
function render() {
  const disclosureKey = node => node.parentElement.dataset.disclosure || node.textContent
  const expanded = new Set([...root.querySelectorAll('details[open] > summary')].map(disclosureKey))
  actions.clear()
  if (!session) { root.innerHTML = loginPage(); return }
  const pending = inbox.filter(n => !n.read_at).length
  root.innerHTML = '<header><span class="brand"><span class="brand-name">INREEL</span><span class="brand-divider"></span><span class="brand-product">短片制作台</span></span><div class="account"><span class="account-avatar" aria-hidden="true">' + x((session.name ?? labels[session.role])?.slice(-1) ?? '·') + '</span><span>' + x(session.name ?? labels[session.role]) + '</span>' +
    button('退出',async () => { await api('/api/logout','POST',{}); session=null; view='projects'; project=null; formDrafts.clear(); serverDrafts={}; liveUpdatePending=false; for (const timer of draftSyncTimers.values()) clearTimeout(timer); draftSyncTimers.clear() },'small ghost') +
    '</div></header><div class="shell"><aside aria-label="主导航"><div class="side-intro"><span class="eyebrow">WORKSPACE</span><b>创作工作台</b></div>' +
    button('项目列表',async () => { await refreshLists(); view='projects'; window.history.replaceState({},'','/') },'side-link side-projects '+(view === 'projects' ? 'active' : 'ghost')) +
    button('站内通知' + (pending ? ' · ' + pending : ''), async () => { await refreshLists(); view='inbox' },'side-link side-inbox '+(view === 'inbox' ? 'active' : 'ghost')) +
    (project && view === 'project' ? button('任务与用量',() => switchTab('jobs'),'side-link side-jobs '+(tab === 'jobs' ? 'active' : 'ghost')) : '') +
    (project && view === 'project' ? button('模型配置',() => switchTab('models'),'side-link side-config '+(tab === 'models' ? 'active' : 'ghost')) : '') +
    (project && view === 'project' ? button('团队与权限',() => switchTab('team'),'side-link side-team '+(tab === 'team' ? 'active' : 'ghost')) : '') +
    (project && view === 'project' ? '<div class="side-current"><span class="eyebrow">CURRENT PROJECT</span><span class="side-project-title">' + x(project.title) + '</span></div>' : '') +
    '</aside><main>' + (view === 'project' && project ? projectPage() : view === 'inbox' ? inboxPage() : projectsPage()) + '</main></div>'
  for (const summary of root.querySelectorAll('details > summary')) {
    if (expanded.has(disclosureKey(summary))) summary.parentElement.open = true
  }
  restoreForms()
  mountLayoutEditors()
  mountShotArrangement()
  mountWaveforms()
}
async function invoke(target) {
  if (busy || !target || target.disabled) return
  const fn = actions.get(target.dataset.action)
  if (!fn) return
  busy = true
  target.disabled = true
  target.setAttribute('aria-busy','true')
  const formKey = target.closest('form') ? draftKey(target.closest('form')) : null
  const countBefore = writeCount
  try { if (await fn(target) !== false) { if (formKey && writeCount !== countBefore && /保存|提交|绑定|选用|上传并/.test(target.textContent)) clearFormDraft(target.closest('form')); render() } }
  catch (error) { flash(error.message,true,error.field) }
  finally { busy = false; target.disabled = false; target.removeAttribute('aria-busy') }
}
root.addEventListener('input',event => {
  event.target.removeAttribute?.('aria-invalid')
  rememberForm(event.target.closest('form'))
})
root.addEventListener('change',event => {
  rememberForm(event.target.closest('form'))
  const picker=event.target.closest('.asset-picker'), preview=picker?.querySelector('.asset-picker-preview')
  if (preview && event.target.tagName === 'SELECT') { const changed=event.target.value && event.target.value!==preview.dataset.currentRef; preview.hidden=!changed; if (changed) preview.src=media(event.target.value) }
})
root.addEventListener('click',event => invoke(event.target.closest('button[data-action]')))
root.addEventListener('submit',event => { event.preventDefault(); invoke(event.target.querySelector('button[data-action]')) })
root.addEventListener('focusout',() => setTimeout(() => {
  if (liveUpdatePending && !busy && !editorActive()) { liveUpdatePending = false; render() }
},0))
root.addEventListener('keydown',event => {
  if (!['ArrowLeft','ArrowRight'].includes(event.key)) return
  const current = event.target.closest('[role="tab"]')
  if (!current) return
  const items = [...root.querySelectorAll('.tabs [role="tab"]')]
  const index = items.indexOf(current)
  if (index < 0) return
  event.preventDefault()
  const next = items[(index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]
  next.focus()
  next.click()
})
window.addEventListener('beforeunload', event => {
  if (!formDrafts.size) return
  event.preventDefault()
  event.returnValue = ''
})
window.addEventListener('hashchange', async () => {
  if (!session) return
  const route = location.hash.slice(1).split('/')
  if (route[0] === 'project' && projects.some(item => item.id === route[1])) {
    await enter(route[1], allTabs.includes(route[2]) ? route[2] : 'brief')
    render()
  } else if (!location.hash) {
    view = 'projects'
    project = null
    render()
  }
})
try {
  session = await api('/api/me')
  await refreshLists()
  const route = location.hash.slice(1).split('/')
  if (route[0] === 'project' && projects.some(p => p.id === route[1])) await enter(route[1],allTabs.includes(route[2]) ? route[2] : 'brief')
} catch { session = null }
render()
startLiveRefresh()
document.addEventListener('visibilitychange',() => { if (document.visibilityState === 'visible') void pollLiveState() })
