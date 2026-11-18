import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, dataDir, hash, id } from './common.ts'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const storage = join(dataDir, 'media')
const pngHelper = join(dataDir, 'bin', 'frame')
const ff = (args: string[]) => exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-threads', '2', '-filter_complex_threads', '2', ...args], { timeout: 180000 })
export const mediaPath = (filename: string) => join(storage, filename)
export async function probe(file: string) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { timeout: 15000 })
  const result = JSON.parse(stdout)
  const video = result.streams.find((s: any) => s.codec_type === 'video')
  const audio = result.streams.find((s: any) => s.codec_type === 'audio')
  return {
    duration_ms: Number.isFinite(+result.format?.duration) ? Math.round(+result.format.duration * 1000) : null,
    width: video?.width ?? null, height: video?.height ?? null, audio: !!audio, video: !!video,
    video_codec: video?.codec_name, audio_codec: audio?.codec_name,
  }
}
async function temp<T>(run: (dir: string) => Promise<T>) {
  await mkdir(storage, { recursive: true })
  const dir = await mkdtemp(join(storage, 'work-'))
  try { return await run(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}
export async function referenceJpeg(file: string, compact = false, ensureMinimum = false) {
  return temp(async dir => {
    const output = join(dir, 'reference.jpg')
    const filter = ensureMinimum ? 'scale=240:240:force_original_aspect_ratio=increase:force_divisible_by=2' : compact ? 'scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2' : null
    await ff(['-i', mediaPath(file), '-frames:v', '1', ...(filter ? ['-vf',filter] : []), '-q:v', compact ? '5' : '3', output])
    return readFile(output)
  })
}
export async function locationPropReference(location: string, prop: string) {
  return temp(async dir => {
    const output = join(dir, 'location-prop.jpg')
    const tile = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2'
    await ff(['-i', mediaPath(location), '-i', mediaPath(prop), '-filter_complex',
      '[0:v]'+tile+'[a];[1:v]'+tile+'[b];[a][b]hstack', '-frames:v', '1', '-q:v', '5', output])
    return readFile(output)
  })
}
export async function persist(bytes: Buffer, ext: string, info: any = {}) {
  const sha256 = hash(bytes)
  const file = sha256 + '.' + ext
  await mkdir(storage, { recursive: true })
  const target = mediaPath(file)
  const existing = await stat(target).catch((error: any) => { if (error.code !== 'ENOENT') throw error })
  if (existing?.size !== bytes.length) {
    const temporary = mediaPath('.' + id() + '.tmp')
    try {
      await writeFile(temporary, bytes, { flag: 'wx' })
      await rename(temporary, target)
    } finally { await rm(temporary, { force: true }) }
  }
  return { file, sha256, bytes: bytes.length, ...info }
}
let compile: Promise<unknown> | undefined
async function frame(output: string, shot: number, subtitle = '') {
  compile ??= (async () => {
    const source = join(root, 'scripts/frame.swift')
    const compiled = await stat(pngHelper).catch(() => null)
    if (compiled && compiled.mtimeMs >= (await stat(source)).mtimeMs) return
    await mkdir(join(dataDir, 'bin'), { recursive: true })
    await exec('swiftc', ['-module-cache-path', join(dataDir, 'bin/swift-cache'), source, '-o', pngHelper], { timeout: 120000 })
  })().catch(error => { compile = undefined; throw error })
  await compile
  await exec(pngHelper, [output, String(shot), subtitle], { timeout: 15000 })
}
export async function mockImage(shot: number) {
  return temp(async dir => {
    const output = join(dir, 'frame.png')
    await frame(output, shot)
    return persist(await readFile(output), 'png', { kind: 'image', width: 360, height: 640, source: 'mock' })
  })
}
export async function renderSceneLayout(layout: any) {
  return temp(async dir => {
    const elements:any[] = []
    for (const item of layout.objects) {
      elements.push({type:'rect',x:item.x,y:item.y,w:item.w,d:item.h,orient:'N'})
      elements.push({type:'label',x:item.x,y:item.y,text:item.name,size:9})
    }
    for (const person of layout.people) {
      elements.push({type:'circle',x:person.start_x,y:person.start_y,r:0.18})
      elements.push({type:'label',x:person.start_x,y:person.start_y+0.35,text:person.name+' 面向'+({N:'北',E:'东',S:'南',W:'西'} as any)[person.facing],size:9})
      const points=[[person.start_x,person.start_y],...(person.via_x != null ? [[person.via_x,person.via_y]] : []),[person.end_x,person.end_y]]
      for(let i=1;i<points.length;i++) { const [x,y]=points[i-1],dx=points[i][0]-x,dy=points[i][1]-y,distance=Math.hypot(dx,dy)
        if (distance>0.01) elements.push({type:'arrow',at:[x+dx/1.5,y+dy/1.5],dir:[dx,dy],size:distance/1.65}) }
    }
    const plan={room:{bounds:{xmin:0,ymin:0,xmax:10,ymax:8}},elements,camera:{x:layout.camera.x,y:layout.camera.y,facing:layout.camera.facing,label:'机位'},style:{compass:true}}
    const input=join(dir,'layout.json'), output=join(dir,'layout.png')
    await writeFile(input,JSON.stringify(plan))
    const python=join(root,'.venv-scene/bin/python')
    check(await stat(python).catch(()=>null),'请先按 README 安装俯视图所需 Python 依赖','layout')
    await exec(python,[join(root,'contracts/skill-sources/scene-view-planner/scripts/floorplan.py'),input,'-o',output],{timeout:60000,env:{...process.env,MPLCONFIGDIR:dir}})
    const bytes=await readFile(output)
    return persist(bytes,'png',{...await probe(output),kind:'image',source:'scene-view-planner',purpose:'reference',reference_kind:'layout',layout_spec:layout})
  })
}
export async function mockVideo(shot: number, duration: number, keyframe?: string) {
  return temp(async dir => {
    const input = keyframe ? mediaPath(keyframe) : join(dir, 'frame.png')
    const output = join(dir, 'shot.mp4')
    if (!keyframe) await frame(input, shot)
    await ff(['-loop', '1', '-framerate', '24', '-i', input, '-t', String(duration / 1000),
      '-vf', 'scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2,setsar=1',
      '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output])
    return persist(await readFile(output), 'mp4', { ...(await probe(output)), kind: 'video', source: 'mock' })
  })
}
export async function mockSpeech(text: string, lang: string, window: number, speaker?: string) {
  return temp(async dir => {
    const voice = lang === 'th' ? 'Kanya' : lang === 'zh-CN' ? 'Tingting' : speaker === 'xiaolin' ? 'Samantha' : 'Alex'
    const input = join(dir, 'speech.aiff')
    const output = join(dir, 'speech.wav')
    await exec('say', ['-v', voice, '-o', input, '--', text], { timeout: 25000 })
    const duration = (await probe(input)).duration_ms!
    const speed = Math.max(1, duration / (window - 80))
    const filters = 'atempo=2,'.repeat(Math.max(0, Math.floor(Math.log2(speed)))) + 'atempo=' + (speed / (2 ** Math.floor(Math.log2(speed))))
    await ff(['-i', input, '-af', filters, '-ac', '1', '-ar', '24000', output])
    return persist(await readFile(output), 'wav', { ...(await probe(output)), kind: 'audio', source: 'mock', voice, text, language: lang })
  })
}
export async function mockMusic() {
  return temp(async dir => {
    const output = join(dir, 'music.wav')
    await ff(['-f', 'lavfi', '-i', 'aevalsrc=0.07*sin(2*PI*146.83*t)+0.04*sin(2*PI*220*t)+0.025*sin(2*PI*329.63*t):s=24000:d=12',
      '-af', 'afade=d=1,afade=t=out:st=11:d=1', '-ac', '1', output])
    return persist(await readFile(output), 'wav', { ...(await probe(output)), kind: 'audio', source: 'mock' })
  })
}
export async function cropVideoRight(asset: any, percent: number) {
  return temp(async dir => {
    const output = join(dir, 'crop.mp4')
    const width = 2 * Math.floor(asset.width * (100 - percent) / 200)
    const height = 2 * Math.floor(asset.height * width / asset.width / 2)
    await ff(['-i', mediaPath(asset.file), '-map', '0:v:0', '-map', '0:a?',
      '-vf', 'crop=' + width + ':' + height + ':0:0,scale=' + asset.width + ':' + asset.height + ',setsar=1',
      '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '18', '-c:a', 'copy', '-movflags', '+faststart', output])
    const info = await probe(output)
    check(info.video && info.audio === asset.audio && Math.abs(info.duration_ms! - asset.duration_ms) < 90,
      '裁切后的视频或音轨校验失败', 'asset_ref')
    return persist(await readFile(output), 'mp4', { ...info, kind: 'video', source: asset.source,
      derived_from: asset.ref, crop_right_percent: percent })
  })
}
export async function render(cut: any[], lines: any[], music: any, assets: Record<string, any>,
  audioModes?: Record<string, 'native' | 'dub' | 'silence'>) {
  return temp(async dir => {
    const large = cut.some(shot => assets[shot.video_ref].source === 'dashscope')
    const [width, height] = large ? [720, 1280] : [360, 640]
    const dimensions = width + ':' + height
    const output = join(dir, 'film.mp4')
    const segments = cut.map(shot => mediaPath(assets[shot.video_ref].file))
    const args = segments.flatMap(file => ['-i', file])
    const overlays: string[] = []
    for (const [index, line] of lines.entries()) {
      const overlay = join(dir, 'sub-' + index + '.png')
      await frame(overlay, -1, line.subtitle_text ?? line.target_text)
      overlays.push(overlay)
      args.push('-i', overlay)
    }
    const speechStart = segments.length + overlays.length
    const dubbed = lines.filter(line => line.audio_ref)
    for (const line of dubbed) args.push('-i', mediaPath(assets[line.audio_ref].file))
    const musicIndex = speechStart + dubbed.length
    if (music) args.push('-stream_loop', '-1', '-i', mediaPath(music.file))
    const duration = cut.reduce((sum, shot) => sum + shot.duration_ms, 0) / 1000
    const filters = cut.map((shot, i) => '[' + i + ':v]trim=start=' + (shot.in_ms ?? 0) / 1000 + ':duration=' + shot.duration_ms / 1000 +
      ',setpts=PTS-STARTPTS,scale=' + dimensions + ':force_original_aspect_ratio=decrease,pad=' + dimensions + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24[v' + i + ']')
    filters.push(cut.map((_, i) => '[v' + i + ']').join('') + 'concat=n=' + cut.length + ':v=1:a=0[p0]')
    for (const [index, line] of lines.entries()) {
      filters.push('[' + (segments.length + index) + ':v]format=rgba,scale=' + dimensions + '[sub' + index + ']')
      filters.push('[p' + index + '][sub' + index + ']overlay=0:0:enable=\'between(t,' + line.subtitle_start_ms / 1000 + ',' + line.subtitle_end_ms / 1000 + ')\'[p' + (index + 1) + ']')
    }
    const tracks: string[] = []
    for (const [index, shot] of cut.entries()) {
      const mode = audioModes?.[shot.shot_id] ??
        (assets[shot.video_ref]?.audio && !dubbed.some(line => line.shot_id === shot.shot_id) ? 'native' : 'silence')
      if (mode !== 'native') continue
      const label = '[native' + index + ']'
      filters.push('[' + index + ':a]atrim=start=' + (shot.in_ms ?? 0) / 1000 + ':duration=' + shot.duration_ms / 1000 +
        ',asetpts=PTS-STARTPTS,adelay=' + shot.start_ms + ':all=1' + label)
      tracks.push(label)
    }
    for (const [index, line] of dubbed.entries()) {
      const label = '[dub' + index + ']'
      filters.push('[' + (speechStart + index) + ':a]aformat=channel_layouts=mono,adelay=' + line.audio_start_ms + ':all=1' + label)
      tracks.push(label)
    }
    if (music) {
      filters.push('[' + musicIndex + ':a]aformat=channel_layouts=mono,volume=0.35[bed]')
      tracks.push('[bed]')
    }
    filters.push('anullsrc=r=24000:cl=mono:d=' + duration + '[silent]')
    filters.push(tracks.length
      ? '[silent]' + tracks.join('') + 'amix=inputs=' + (tracks.length + 1) + ':duration=first:normalize=0,alimiter=limit=0.9[mix]'
      : '[silent]anull[mix]')
    await ff([...args, '-filter_complex', filters.join(';'), '-map', '[p' + lines.length + ']', '-map', '[mix]', '-t', String(duration),
      '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output])
    const info = await probe(output)
    check(info.video && info.audio && Math.abs(info.duration_ms! - duration * 1000) < 90, '合成文件的音画或时长校验失败', 'delivery')
    return persist(await readFile(output), 'mp4', { ...info, kind: 'delivery' })
  })
}
export async function upload(filename: string, bytes: Buffer, purpose: string) {
  check(bytes.length, '文件为空，请重新上传或粘贴原文', 'file')
  const ext = extname(filename).toLowerCase().slice(1)
  if (purpose === 'script') {
    check(['txt', 'md', 'markdown', 'doc', 'docx'].includes(ext), '支持 TXT、Markdown、DOCX 或 DOC', 'file')
    let text: string
    try {
      if (['doc', 'docx'].includes(ext)) {
        const magic = ext === 'doc' ? 'd0cf11e0a1b11ae1' : '504b0304'
        check(bytes.toString('hex', 0, magic.length / 2) === magic, 'Word 文件头无效', 'file')
        text = await temp(async dir => {
          const input = join(dir, 'script.' + ext)
          await writeFile(input, bytes)
          return (await exec('textutil', ['-convert', 'txt', '-stdout', input], { timeout: 12000, maxBuffer: 3_000_000 })).stdout
        })
      } else {
        const utf16 = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8'
        text = new TextDecoder(utf16, { fatal: true }).decode(bytes)
      }
    } catch { check(false, '无法解析文档，请重新上传或粘贴原文', 'file') }
    check(text!.trim() && !text!.includes('\0'), '文档没有可读文本', 'file')
    return persist(bytes, ext, { kind: 'script', filename, text: text!.trim(), source: 'upload' })
  }
  const kind = purpose === 'reference' || purpose === 'keyframe' ? 'image' : 'audio'
  check((kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp'] : ['wav', 'm4a', 'mp3', 'aac']).includes(ext), '素材格式不支持', 'file')
  const info = await temp(async dir => {
    const input = join(dir, 'upload.' + ext)
    await writeFile(input, bytes)
    try { return await probe(input) } catch { check(false, '无法读取媒体文件', 'file') }
  })
  check(kind === 'image' ? info!.video && info!.width : info!.audio && info!.duration_ms, '文件内容与素材用途不符', 'file')
  return persist(bytes, ext, { ...info, kind, filename, source: 'upload', purpose })
}

export async function importProviderMedia(bytes: Buffer, kind: 'image' | 'video' | 'audio') {
  const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'wav' : 'png'
  return temp(async dir => {
    const input = join(dir, 'provider.' + ext)
    await writeFile(input, bytes)
    const info = await probe(input).catch(() => null)
    check(kind === 'audio' ? info?.audio && info.duration_ms : info?.video && (kind === 'image' || info.duration_ms), '服务商文件格式或时长不可读取', 'media')
    check(kind !== 'image' || info?.video_codec === 'png', '服务商未返回 PNG 图片', 'media')
    return persist(bytes, ext, { ...info, kind, source: 'dashscope' })
  })
}
