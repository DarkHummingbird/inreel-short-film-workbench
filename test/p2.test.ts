import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { createProject, openStore, role } from '../src/store.ts'
import { createApp } from '../src/server.ts'

test('团队账号使用加盐密码并按项目成员关系隔离', async () => {
  const store = openStore(':memory:')
  try {
    const teams = Array.from({ length: 3 }, (_, index) => {
      const suffix = index + 1
      const operations = store.createUser({ account:'op_team' + suffix, name:'运营 ' + suffix, role:'operations', password:'team-' + suffix + '-pass' }, 'test')
      const director = store.createUser({ account:'dir_team' + suffix, name:'编导 ' + suffix, role:'director', password:'team-' + suffix + '-pass' }, operations.account)
      const owner = store.createUser({ account:'owner_team' + suffix, name:'负责人 ' + suffix, role:'owner', password:'team-' + suffix + '-pass' }, operations.account)
      assert.ok(store.authenticate(operations.account, 'team-' + suffix + '-pass'))
      assert.equal(store.authenticate(operations.account, 'wrong-password'), null)
      assert.equal(store.user(operations.account)?.password_hash, undefined)
      const project = createProject('项目 ' + suffix, operations.account, { director:director.account, owner:owner.account })
      project.member_profiles = Object.fromEntries([operations, director, owner].map(user => [user.account, { name:user.name, role:user.role }]))
      store.save(project)
      return { project, operations, director, owner }
    })
    assert.equal(role(teams[0].project, teams[0].director.account), 'director')
    assert.throws(() => role(teams[0].project, teams[1].operations.account), /只有项目成员可访问/)
    await Promise.all(teams.map(async team => {
      for (let index = 0; index < 20; index++) {
        const current = store.get(team.project.id)
        store.mutate(team.project.id, team.operations.account, 'p2.write', { index, expected_version: current.version }, team.project.id + ':' + index, project => {
          project.counters.test = (project.counters.test || 0) + 1
        })
        assert.equal(store.get(team.project.id).version, current.version + 1)
      }
    }))
    assert.deepEqual(teams.map(team => store.get(team.project.id).version), [20, 20, 20])
  } finally {
    store.close()
  }
})

test('独立团队账号只能访问自己的项目', async () => {
  const store = openStore(':memory:')
  const { app, background } = createApp(store)
  app.listen(0, '127.0.0.1')
  await once(app, 'listening')
  const origin = 'http://127.0.0.1:' + (app.address() as any).port
  const cookies: Record<string, string> = {}
  const call = async (actor: string, path: string, body?: any, code = 200) => {
    const response = await fetch(origin + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type':'application/json', 'Idempotency-Key':crypto.randomUUID() }), ...(cookies[actor] ? { Cookie:cookies[actor] } : {}) },
      ...(body === undefined ? {} : { body:JSON.stringify(body) }),
    })
    const text = await response.text()
    assert.equal(response.status, code, text)
    const cookie = response.headers.get('set-cookie')?.split(';')[0]
    if (cookie) cookies[actor] = cookie
    return text ? JSON.parse(text) : null
  }
  try {
    for (const suffix of [1,2,3]) {
      await call('op'+suffix, 'register', { account:'op_team'+suffix, name:'团队运营 '+suffix, password:'secure-pass-'+suffix }, 201)
    }
    const projects: any[] = []
    for (const suffix of [1,2,3]) {
      const project = await call('op'+suffix, 'projects', {
        title:'隔离项目 '+suffix,
        members:{
          director:{ account:'dir_team'+suffix, name:'编导 '+suffix, password:'secure-pass-'+suffix },
          owner:{ account:'owner_team'+suffix, name:'负责人 '+suffix, password:'secure-pass-'+suffix },
        },
      }, 201)
      projects.push(project)
      assert.equal(project.member_profiles['dir_team'+suffix].role, 'director')
    }
    await call('dir1', 'login', { account:'dir_team1', password:'secure-pass-1' })
    const visible = await call('dir1', 'projects')
    assert.deepEqual(visible.map((project: any) => project.id), [projects[0].id])
    await call('op2', 'projects/' + projects[0].id, undefined, 403)
    await call('dir2', 'login', { account:'dir_team2', password:'secure-pass-2' })
    await call('dir2', 'projects/' + projects[0].id, undefined, 403)
    const team = await call('op1', 'projects/' + projects[0].id + '/team')
    assert.deepEqual(team.members.map((member: any) => member.role).sort(), ['director','operations','owner'])
    const state = await call('op1', 'projects/' + projects[0].id)
    await call('op1', 'projects/' + projects[0].id + '/billing', {
      expected_version:state.version, amount:12.34, currency:'CNY', period_start:'2026-11-01', period_end:'2026-11-30', provider_reference:'invoice-1',
    }, 201)
    const billing = await call('op1', 'projects/' + projects[0].id + '/billing')
    assert.equal(billing[0].amount, 12.34)
    await call('op2', 'projects/' + projects[0].id + '/billing', { expected_version:state.version, amount:1 }, 403)
    const latest = await call('op1', 'projects/' + projects[0].id)
    await call('op1', 'projects/' + projects[0].id + '/team', {
      expected_version:latest.version,
      members:{ director:{ account:'dir_team1_new', name:'团队一新编导', password:'new-team-pass' } },
    })
    await call('dir1new', 'login', { account:'dir_team1_new', password:'new-team-pass' })
    await call('dir1new', 'projects/' + projects[0].id)
    await call('dir1', 'projects/' + projects[0].id, undefined, 403)
  } finally {
    if (app.listening) await new Promise<void>(resolve => app.close(() => resolve()))
    await background.idle()
    store.close()
  }
})
