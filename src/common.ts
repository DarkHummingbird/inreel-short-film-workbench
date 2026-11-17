import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const fixture = JSON.parse(readFileSync(new URL('../contracts/fixtures/last-train.json', import.meta.url), 'utf8'))
export const languages = ['zh-CN', 'en', 'th']
export const accounts = { op_lin: 'operations', dir_zhou: 'director', reviewer_wu: 'reviewer', owner_chen: 'owner', guest: 'guest' }
export const dataDir = resolve(process.env.DATA_DIR || 'data')
export const now = () => new Date().toISOString()
export const id = () => randomUUID()
export const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

export class Problem extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) { super(message) }
}
export function check(value: unknown, message: string, field?: string, status = 422, code = 'invalid_input'): asserts value {
  if (!value) throw new Problem(status, code, message, field)
}
export const conflict = (condition: unknown, message: string) => check(condition, message, undefined, 409, 'version_conflict')
export function object(value: any, field = 'data') {
  check(value && typeof value === 'object' && !Array.isArray(value), '需要 JSON 对象', field)
  return value
}
export function array(value: any, field: string): any[] {
  check(Array.isArray(value), '需要数组', field)
  return value
}
export const integer = (value: any, min = 0) => Number.isSafeInteger(value) && value >= min
export const clean = (value: any) => typeof value === 'string' ? value.trim() : ''
export const clone = structuredClone
export const langKey = (lang: string) => lang.replace('-', '_')
export function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  return JSON.stringify(value)
}
