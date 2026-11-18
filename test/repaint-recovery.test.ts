import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

test('局部重绘断线后查询原任务，重启恢复回执并去重逻辑重试', { timeout:30000 }, async t => {
  const folder = mkdtempSync(join(tmpdir(), 'inreel-repaint-'))
  const env = {
    DATA_DIR:folder, MODEL_MODE:'dashscope', DASHSCOPE_API_KEY:'stub-token',
    DASHSCOPE_REGION:'ap-southeast-1', DASHSCOPE_WORKSPACE_ID:'repaint-fixture',
  }
  const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const { createApp } = await import('../src/server.ts')
  const { openStore, createProject } = await import('../src/store.ts')
  const { put } = await import('../src/workflow.ts')
  const { clone, fixture } = await import('../src/common.ts')
  const { contracts } = await import('../src/contracts.ts')
  const { persist } = await import('../src/media.ts')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  const base = 'keyframe@v1'
  const image = await persist(png, 'png', { kind:'image', width:1, height:1 })
  const project = createProject('隔离局部重绘', 'op_lin')
  const director = 'dir_zhou'
  const brief = put(project, director, 'brief', { ...fixture.brief, raw:'隔离样例' }, null)
  const script = put(project, director, 'script', clone(fixture.script), brief.ref)
  project.active['2'] = 'check2@v1'
  project.confirmations['check2@v1'] = { ref:'check2@v1', artifact_ref:script.ref }
  const shot = clone(fixture.shots[0])
  project.assets[base] = { ...image, ref:base }
  const board = put(project, director, 'storyboard', { shots:[shot], keyframes:{ [shot.shot_id]:base }, references:{} }, 'check2@v1')
  project.active['3'] = 'check3@v1'
  project.confirmations['check3@v1'] = { ref:'check3@v1', artifact_ref:board.ref }

  let submissions = 0
  const queries: string[] = []
  let breakDownload = true
  let reachedOriginalTask = false
  const retryStarted = Promise.withResolvers<void>()
  const releaseRetry = Promise.withResolvers<void>()
  const transport = (async (url: string | URL, init?: RequestInit) => {
    const { pathname } = new URL(url)
    if (pathname.endsWith('/image-generation/generation')) {
      assert.equal(init?.method, 'POST')
      assert.equal(JSON.parse(String(init.body)).input.messages[0].content.filter(item => item.image).length, 1)
      const number = ++submissions
      if (number === 3) {
        retryStarted.resolve()
        await releaseRetry.promise
      }
      if (number === 4) throw new TypeError('lost submit response', { cause:{ code:'ECONNRESET' } })
      return Response.json({ request_id:'submit-' + number, output:{ task_id:'repaint-' + number } })
    }
    if (pathname.startsWith('/api/v1/tasks/')) {
      assert.equal(init?.method, 'GET')
      const id = pathname.split('/').at(-1)!
      queries.push(id)
      if (id === 'repaint-1' && !reachedOriginalTask) {
        reachedOriginalTask = true
        return Response.json({ code:'TaskTemporarilyUnavailable' }, { status:404 })
      }
      if (id === 'repaint-2') return Response.json({ output:{ task_status:'FAILED', code:'ImageRejected' } })
      return Response.json({ request_id:'query-' + id, output:{ task_status:'SUCCEEDED',
        choices:[{ message:{ content:[{ image:'https://fixture.alicdn.com/repaint.png' }] } }] }, usage:{ output_image_count:1 } })
    }
    if (pathname === '/repaint.png') {
      if (breakDownload) return new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection reset while downloading')) } }))
      return new Response(png)
    }
    assert.fail('Unexpected provider path ' + pathname)
  }) as typeof fetch

  const db = join(folder, 'isolated.sqlite')
  let instance = createApp(openStore(db), undefined, undefined, transport)
  let origin: string
  let cookies: Record<string, string>
  const directorName = 'dir_zhou'
  const operatorName = 'op_lin'
  async function start() {
    cookies = {}
    instance.app.listen(0, '127.0.0.1')
    await once(instance.app, 'listening')
    origin = 'http://127.0.0.1:' + (instance.app.address() as {port:number}).port
    for (const [account, password] of [[directorName,'zhou-demo'],[operatorName,'lin-demo']]) {
      const login = await fetch(origin + '/api/login', { method:'POST', body:JSON.stringify({ account, password }) })
      assert.equal(login.status,200)
      cookies[account] = login.headers.get('set-cookie')!.split(';')[0]
    }
  }
  async function stop() {
    await instance.background.idle()
    if (instance.app.listening) await new Promise<void>(resolve => instance.app.close(() => resolve()))
    instance.store.close()
  }
  t.after(async () => {
    await stop()
    for (const [key,value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(folder, { recursive:true, force:true })
  })
  instance.store.save(project)
  await start()
  const state = () => instance.store.get(project.id)
  async function post(route: string, body: any, status = 202, account = directorName) {
    const response = await fetch(origin + '/api/projects/' + project.id + '/' + route, {
      method:'POST', headers:{ cookie:cookies[account], 'Idempotency-Key':randomUUID() },
      body:JSON.stringify({ expected_version:state().version, ...body }),
    })
    const data = await response.json()
    assert.equal(response.status, status, JSON.stringify(data))
    return data
  }
  const payload = (task_request: string) => ({
    task:'repaint', shot_id:shot.shot_id, task_request,
    prepared_plan:{ status:'ok', issues:[], result:{ ...contracts.art.examples[0].output.result,
      mode:'keyframe', reference_map:[], image_prompt:task_request } },
  })
  const submit = async (body: any) => (await post('jobs',body)).result
  async function finish(id: string, expected: string) {
    await instance.background.idle()
    const job = state().jobs[id]
    assert.equal(job.state, expected, JSON.stringify(job.error))
    return job
  }

  const originalTask = await submit(payload('修整第一版背景中的亮点'))
  const waiting = await finish(originalTask.id,'awaiting_query')
  assert.equal(waiting.provider_job_id,'repaint-1')
  assert.equal(waiting.provider_receipts.image.task_id,'repaint-1')
  const disconnected = await post('jobs/' + originalTask.id + '/query',{},200)
  assert.equal(disconnected.state,'awaiting_query')
  assert.match(disconnected.error.message,/媒体下载中断/)
  assert.equal(disconnected.query_available,true)
  assert.equal((await submit(payload('修整第一版背景中的亮点'))).id,originalTask.id)
  assert.equal(submissions,1)

  await stop()
  breakDownload = false
  instance = createApp(openStore(db), undefined, undefined, transport)
  await start()
  const recovered = await finish(originalTask.id,'succeeded')
  assert.equal(recovered.provider_job_id,'repaint-1')
  assert.ok(state().assets[recovered.result.asset_ref])
  assert.deepEqual(queries,['repaint-1','repaint-1','repaint-1'])
  assert.equal(submissions,1)

  const failed = await submit(payload('再次校正边缘色块'))
  await finish(failed.id,'failed')
  const retryArgs = { ...payload('再次校正边缘色块'), retry_of:failed.id }
  const retry = await submit(retryArgs)
  try {
    await retryStarted.promise
    assert.equal((await submit(retryArgs)).id,retry.id)
    assert.equal(submissions,3)
  } finally {
    releaseRetry.resolve()
  }
  await finish(retry.id,'succeeded')
  assert.equal((await submit(retryArgs)).id,retry.id)
  assert.equal(Object.values(state().jobs).filter(job => job.retry_of === failed.id).length,1)
  assert.equal(submissions,3)

  const unknownPayload = payload('修改第三块背景区域')
  const unknown = await submit(unknownPayload)
  const lost = await finish(unknown.id,'awaiting_query')
  assert.equal(lost.provider_job_id,null)
  assert.equal((await post('jobs/' + unknown.id + '/query',{},409)).code,'provider_receipt_missing')
  await post('jobs', { ...unknownPayload, retry_of:unknown.id },422)
  const cleanup = await post('jobs/cleanup',{},200,operatorName)
  assert.ok(cleanup.result.retained.includes(unknown.id))
  await stop()
  instance = createApp(openStore(db), undefined, undefined, transport)
  await start()
  await finish(unknown.id,'awaiting_query')
  assert.equal((await submit(unknownPayload)).id,unknown.id)
  assert.equal(submissions,4)
  assert.deepEqual(queries,['repaint-1','repaint-1','repaint-1','repaint-2','repaint-3'])
})
