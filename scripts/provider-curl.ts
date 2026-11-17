import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const option = (name: string, value: string) => name + ' = ' + JSON.stringify(value)
export const curlTransport: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  if (url.protocol !== 'https:') throw new Error('HTTPS is required')
  const folder = typeof init?.body === 'string' ? await mkdtemp(join(tmpdir(), 'last-train-http-')) : null
  try {
    const settings = [option('url', url.href), option('request', init?.method ?? 'GET')]
    for (const [name, value] of new Headers(init?.headers)) {
      if (name !== 'connection') settings.push(option('header', name + ': ' + value))
    }
    if (folder) {
      const body = join(folder, 'body.json')
      await writeFile(body, init!.body as string, { mode: 0o600 })
      settings.push(option('data-binary', '@' + body))
    }
    const { output, exitCode } = await new Promise<{output:Buffer,exitCode:number|null}>((resolve, reject) => {
      const method = init?.method ?? 'GET'
      const child = spawn('/usr/bin/curl', [
        '-q', '--config', '-', '--silent', process.env.REAL_PROVIDER_HTTP1 === '1' ? '--http1.1' : '--http2', '--proto', '=https', '--connect-timeout', '12',
        '--max-time', method === 'POST' ? '110' : '45', '--max-filesize', '83886080',
        '--write-out', '\n%{http_code} %{time_appconnect}',
      ], { stdio: ['pipe', 'pipe', 'ignore'] })
      const chunks: Buffer[] = []
      child.stdout.on('data', chunk => chunks.push(chunk))
      child.once('error', reject)
      child.once('close', exitCode => resolve({ output:Buffer.concat(chunks), exitCode }))
      child.stdin.on('error', () => {})
      child.stdin.end(settings.join('\n') + '\n')
    })
    const boundary = output.lastIndexOf(10)
    const [httpCode, tlsTime] = output.subarray(boundary + 1).toString().split(' ').map(Number)
    if (exitCode !== 0) {
      const code = exitCode === 28 && tlsTime === 0 ? 'UND_ERR_CONNECT_TIMEOUT' : 'CURL_' + exitCode
      throw new TypeError('Provider connection failed', { cause:{ code } })
    }
    if (!(httpCode >= 200 && httpCode < 600)) throw new Error('Provider returned an invalid HTTP status')
    return new Response([204,205,304].includes(httpCode) ? null : output.subarray(0, boundary), { status:httpCode })
  } finally {
    if (folder) await rm(folder, { recursive:true, force:true })
  }
}
