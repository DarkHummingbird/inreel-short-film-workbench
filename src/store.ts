import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { check, clean, conflict, dataDir, id, now, canonical, hash } from './common.ts'

export type Role = 'operations' | 'director' | 'reviewer' | 'owner'
type Members = Record<Exclude<Role, 'reviewer'>, string> & { reviewer?: string }
export type DeliveryReview = {
  decision: 'approve' | 'return', file_ref: string, sha256: string | null,
  actor: string, at: string, note: string, range: { start_ms: number, end_ms: number } | null
}
export type Artifact = {
  ref: string, type: string, language: string | null, status: string, data: any, upstream: string | null,
  author: string, at: string, note?: string,
  delivery_review?: DeliveryReview,
  has_shot_rework?: true,
  shot_revision?: { shot_id: string, previous_board_ref: string, changes: Record<string, { before: any, after: any }>, observation_id: string | null },
  shot_structure_revision?: {
    previous_board_ref: string, added: string[], deleted: string[], reordered: string[], modified: string[],
    keyframes_invalidated: string[], videos_need_regeneration: string[], joins_changed: string[]
  }
}
export type Episode = {
  series_id: string, number: number, previous_id: string, previous_title: string, board_ref: string,
  characters: { character_id: string, name: string, description: string, goal: string }[],
  references: Record<string, string>, wardrobe: Record<string, string>, ending: string
}
export type Wardrobe = {
  ref: string, character_id: string, description: string,
  source?: { episode_id: string, episode_title: string, version: string }
}
export type Project = {
  id: string, title: string, members: Members, version: number, updated: string, languages: string[],
  member_profiles?: Record<string, { name: string, role: string }>,
  brief: any, artifacts: Record<string, Artifact>, current: Record<string, string>, confirmations: Record<string, any>,
  active: Record<string, string>, assets: Record<string, any>, selected: Record<string, string>, notifications: any[],
  localized_selected?: Record<string, Record<string, string>>,
  jobs: Record<string, any>, requests: Record<string, any>, counters: Record<string, number>, feedback: any[],
  billing?: any[],
  episode?: Episode, wardrobes?: Record<string, Wardrobe>
  join_reviews?: Record<string, any>
}
export type UserAccount = {
  account: string, name: string, role: Exclude<Role, 'reviewer'>, created_at: string, created_by: string
}

export function episodePosition(p: Project) {
  return { series_id: p.episode?.series_id ?? p.id, number: p.episode?.number ?? 1 }
}

export const slot = (type: string, language?: string | null) => language ? type + ':' + language : type
export const current = (p: Project, type: string, language?: string | null) => p.artifacts[p.current[slot(type, language)]]
export const active = (p: Project, step: number, language?: string | null) => p.confirmations[p.active[slot(String(step), language)]]
export function ref(p: Project, prefix: string) {
  const version = p.counters[prefix] = (p.counters[prefix] || 0) + 1
  return prefix + '@v' + version
}
export function createProject(title: string, operator: string, members: Partial<Record<Role, string>> = {}): Project {
  const accountId = (value: string) => /^[a-z][a-z0-9_-]{2,47}$/.test(value)
  check(accountId(operator), '运营账号格式无效', 'operations')
  for (const key of ['director','owner','reviewer'] as const) check(members[key] == null || accountId(members[key]!), '项目成员账号格式无效', key)
  return {
    id: 'p-' + id(), title, members: { operations: operator, director: members.director || 'dir_zhou', owner: members.owner || 'owner_chen',
      ...(members.reviewer ? { reviewer: members.reviewer } : {}) },
    version: 0, updated: now(), languages: [], brief: { target_languages: ['zh-CN'] }, artifacts: {}, current: {}, confirmations: {},
    active: {}, assets: {}, selected: {}, localized_selected: {}, notifications: [], jobs: {}, requests: {}, counters: {}, feedback: [], billing: [],
  }
}
export function role(p: Project, account: string, expected?: Role): Role {
  const member = (Object.keys(p.members) as Role[]).find(key => p.members[key] === account)
  check(member && (!expected || expected === member), expected ? '当前账号没有此操作权限' : '只有项目成员可访问', undefined, 403, 'forbidden')
  return member
}
export function usage(p: Project) {
  const jobs = Object.values(p.jobs)
  const totals: Record<string, number> = {}
  for (const job of jobs) for (const item of job.usage || []) totals[item.unit] = (totals[item.unit] || 0) + item.quantity
  return { jobs, totals, unavailable: jobs.filter(job => !job.usage?.length).length }
}
export function openStore(filename = join(dataDir, 'workbench.sqlite')) {
  mkdirSync(dirname(filename), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS session (token TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS draft (project_id TEXT NOT NULL, account TEXT NOT NULL, key TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (project_id, account, key)); CREATE TABLE IF NOT EXISTS user_account (account TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL);')
  const save = (p: Project) => db.prepare('INSERT INTO project VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET state=excluded.state').run(p.id, JSON.stringify(p))
  const get = (projectId: string): Project => {
    const row = db.prepare('SELECT state FROM project WHERE id=?').get(projectId)
    check(row, '项目不存在', undefined, 404, 'not_found')
    return JSON.parse(String(row.state))
  }
  const all = (): Project[] => db.prepare('SELECT state FROM project').all().map(row => JSON.parse(String(row.state)))
  function transact<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  function update(projectId: string, fn: (p: Project) => any) {
    return transact(() => {
      const p = get(projectId)
      const result = fn(p)
      p.version++
      p.updated = now()
      save(p)
      return { result, version: p.version }
    })
  }
  function mutate(projectId: string, account: string, action: string, payload: any, key: string, fn: (p: Project) => any) {
    return transact(() => {
      const p = get(projectId)
      role(p, account)
      check(key && key.length <= 160, '需要 Idempotency-Key', 'Idempotency-Key')
      const requestId = hash(account + '\n' + key)
      const { expected_version, ...data } = payload
      const fingerprint = hash(canonical({ action, data }))
      if (p.requests[requestId]) {
        conflict(p.requests[requestId].fingerprint === fingerprint, '幂等键已用于其他请求')
        return { result: p.requests[requestId].result, version: p.version, replay: true }
      }
      conflict(Number.isSafeInteger(expected_version) && expected_version === p.version, '项目版本已更新，请刷新后操作')
      const result = fn(p)
      p.requests[requestId] = { fingerprint, result }
      p.version++
      p.updated = now()
      save(p)
      return { result, version: p.version, replay: false }
    })
  }
  function drafts(projectId: string, account: string) {
    role(get(projectId), account)
    const rows = db.prepare('SELECT key, state, updated_at FROM draft WHERE project_id=? AND account=? ORDER BY updated_at DESC').all(projectId, account)
    return Object.fromEntries(rows.map(row => [String(row.key), { ...JSON.parse(String(row.state)), at:Number(row.updated_at) }]))
  }
  function saveDraft(projectId: string, account: string, key: string, data: any) {
    role(get(projectId), account)
    check(clean(key) && key.length <= 200 && /^[\w:.@-]+$/.test(key), '草稿标识无效', 'draft_key')
    check(Array.isArray(data?.values) && data.values.length <= 500, '草稿内容无效', 'draft')
    const state = JSON.stringify({ values:data.values })
    check(Buffer.byteLength(state) <= 512 * 1024, '草稿超过大小限制', 'draft', 413)
    const updated = Date.now()
    db.prepare('INSERT INTO draft VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, account, key) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at')
      .run(projectId, account, key, state, updated)
    return { values:data.values, at:updated }
  }
  function clearDraft(projectId: string, account: string, key: string) {
    role(get(projectId), account)
    db.prepare('DELETE FROM draft WHERE project_id=? AND account=? AND key=?').run(projectId, account, key)
    return { cleared:true }
  }
  function createUser(input: any, createdBy: string) {
    const account = clean(input.account), name = clean(input.name), role = clean(input.role), password = String(input.password ?? '')
    check(/^[a-z][a-z0-9_-]{2,47}$/.test(account), '账号需为小写字母开头的 3–48 位字母、数字、下划线或连字符', 'account')
    check(name && name.length <= 40, '请填写成员姓名', 'name')
    check(['operations','director','owner'].includes(role), '成员岗位无效', 'role')
    check(password.length >= 8 && password.length <= 128, '密码至少 8 位', 'password')
    check(!db.prepare('SELECT account FROM user_account WHERE account=?').get(account), '账号已存在，请更换账号或直接选用', 'account', 409, 'account_exists')
    const salt = randomBytes(16).toString('hex')
    const passwordHash = scryptSync(password, salt, 64).toString('hex')
    const createdAt = now()
    db.prepare('INSERT INTO user_account VALUES (?, ?, ?, ?, ?, ?, ?)').run(account, name, role, salt, passwordHash, createdAt, createdBy)
    return { account, name, role, created_at: createdAt, created_by: createdBy }
  }
  function user(account: string): UserAccount | null {
    const row: any = db.prepare('SELECT account,name,role,created_at,created_by FROM user_account WHERE account=?').get(account)
    return row ? { account: String(row.account), name: String(row.name), role: row.role, created_at: String(row.created_at), created_by: String(row.created_by) } : null
  }
  function authenticate(account: string, password: string) {
    const row: any = db.prepare('SELECT account,name,role,salt,password_hash,created_at,created_by FROM user_account WHERE account=?').get(account)
    if (!row) return null
    const actual = scryptSync(String(password), String(row.salt), 64)
    const expected = Buffer.from(String(row.password_hash), 'hex')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
      ? { account: String(row.account), name: String(row.name), role: row.role, created_at: String(row.created_at), created_by: String(row.created_by) }
      : null
  }
  return { get, all, save, update, mutate, drafts, saveDraft, clearDraft, createUser, user, authenticate, close: () => db.close(),
    sequel(projectId: string, account: string, payload: any, key: string, prepare: (source: Project, number: number) => Project) {
      return mutate(projectId, account, 'episode.create', payload, key, source => {
        role(source, account, 'operations')
        const { series_id } = episodePosition(source)
        const numbers = all().map(episodePosition).filter(item => item.series_id === series_id).map(item => item.number)
        const episode = prepare(source, Math.max(...numbers) + 1)
        save(episode)
        return { id: episode.id }
      })
    },
    login(account: string) {
      const token = id() + id()
      db.prepare('INSERT INTO session VALUES (?, ?, ?)').run(hash(token), account, Date.now() + 86400000)
      return token
    },
    account(token: string) {
      return db.prepare('SELECT account FROM session WHERE token=? AND expires>?').get(hash(token), Date.now())?.account as string | undefined
    },
    clearSessions() { db.prepare('DELETE FROM session').run() },
    logout(token: string) { db.prepare('DELETE FROM session WHERE token=?').run(hash(token)) },
  }
}
export type Store = ReturnType<typeof openStore>
