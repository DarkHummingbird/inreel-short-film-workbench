import { check, clean, clone } from './common.ts'
import { active, createProject, episodePosition, ref, type Project } from './store.ts'

export function createSequel(source: Project, actor: string, title: string, number: number) {
  const board = source.artifacts[active(source, 3)?.artifact_ref]
  const production = board?.data.production ?? {}
  const script = source.artifacts[active(source, 2)?.artifact_ref]
  check(board && script && board.upstream === active(source, 2)?.ref, '请先确认来源剧集的分镜和资产', 'storyboard')
  const episode = createProject(title, actor, source.members)
  const previous = { episode_id: source.id, episode_title: source.title }
  const imported = new Map<string, string>()
  function image(kind: 'character' | 'location' | 'prop', version: string, characterId?: string) {
    const asset = source.assets[version]
    check(asset?.kind === 'image' && asset.file, '来源参考图不可用', kind)
    const key = [kind, version, characterId].join(':')
    const existing = imported.get(key)
    if (existing) return existing
    const local = ref(episode, kind + '_reference')
    episode.assets[local] = {
      ref: local, kind: 'image', purpose: 'reference', file: asset.file, sha256: asset.sha256,
      bytes: asset.bytes, width: asset.width, height: asset.height, filename: asset.filename,
      reuse: { kind, character_id: characterId, ...previous, version, original: asset.reuse?.original ?? { episode_id: source.id, version } },
    }
    imported.set(key, local)
    return local
  }
  const characters = clone(script.data.characters) as NonNullable<Project['episode']>['characters']
  const references = Object.fromEntries(characters.map(person => [
    person.character_id, image('character', board.data.references[person.character_id], person.character_id),
  ]))
  episode.wardrobes = {}
  const wardrobe: Record<string, string> = {}
  for (const person of characters) {
    const variants = new Map<string, { description: string, version: string }>()
    const shots = board.data.shots.filter((shot: any) => shot.character_ids.includes(person.character_id))
    for (const shot of shots.length ? shots : [{ shot_id: '' }]) {
      const selected = source.wardrobes?.[production[shot.shot_id]?.wardrobe?.[person.character_id]]
      const version = selected?.ref ?? board.data.references[person.character_id]
      variants.set(version, { version, description: selected?.description ?? person.description })
    }
    for (const { description, version } of variants.values()) {
      const local = ref(episode, person.character_id + '_wardrobe')
      episode.wardrobes[local] = { ref: local, character_id: person.character_id, description, source: { ...previous, version } }
      if (variants.size === 1) wardrobe[person.character_id] = local
    }
  }
  for (const choices of Object.values(production) as any[]) {
    for (const kind of ['location', 'prop'] as const) if (choices[kind]) image(kind, choices[kind])
  }
  const ending = clean(script.data.ending)
  episode.episode = { ...episodePosition(source), number, previous_id: source.id, previous_title: source.title,
    board_ref: board.ref, characters, references, wardrobe, ending }
  episode.brief = {
    title, theme: source.brief.theme, goal: source.brief.goal, audience: source.brief.audience,
    target_languages: ['zh-CN'], must_keep: ending ? ['续集承接上集结尾：' + ending] : [],
  }
  return episode
}

export function sequelBindings(project: Project, shots: any[], characters: any[]) {
  const episode = project.episode
  if (!episode) return null
  const references = Object.fromEntries(characters.filter(person => Object.hasOwn(episode.references, person.character_id))
    .map(person => [person.character_id, episode.references[person.character_id]]))
  const production = Object.fromEntries(shots.map(shot => [shot.shot_id, {
    wardrobe: Object.fromEntries(shot.character_ids.filter((key: string) => Object.hasOwn(episode.wardrobe, key))
      .map((key: string) => [key, episode.wardrobe[key]])),
  }]))
  return { references, production }
}

export function wardrobeDescriptions(project: Project, production: any) {
  return Object.entries(production?.wardrobe ?? {}).flatMap(([character_id, ref]) => {
    const entry = project.wardrobes?.[String(ref)]
    return entry ? [{ character_id, ref: entry.ref, description: entry.description }] : []
  })
}
