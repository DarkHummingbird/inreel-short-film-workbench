import { hash } from './common.ts'
import { readFileSync } from 'node:fs'

const sceneSkill = readFileSync(new URL('../contracts/skill-sources/scene-view-planner/SKILL.md', import.meta.url), 'utf8')
const blockingSkill = readFileSync(new URL('../contracts/skill-sources/director-agent/references/blocking-and-performance.md', import.meta.url), 'utf8')

export type SkillRecord = {
  id: string, instruction: string, version?: string, source: string,
  mode: 'prompt_injection' | 'renderer_only', injected_to_model: boolean,
  executed_steps: string[], license: string, adaptation: string, not_executed: string[],
}
const skills: Record<string, SkillRecord> = {
  layout_render: {
    id:'scene-view-planner-and-director-blocking', version:'1.0.0', instruction:sceneSkill + '\n\n' + blockingSkill,
    source:'contracts/skill-sources/scene-view-planner/SKILL.md + contracts/skill-sources/director-agent/references/blocking-and-performance.md',
    mode:'renderer_only', injected_to_model:false, executed_steps:['floorplan.py'], license:'MIT + project rules',
    adaptation:'只把编导确认的坐标和现有导演调度规则交给本地 floorplan.py 绘制俯视图。',
    not_executed:['场景图自动识别','多视角反打闭环','四宫格总检'],
  },
  storyboard: {
    id: 'video-storyboard-adapted',
    version: '1.2.0',
    source:'contracts/skill-sources/video-storyboard/SKILL.md',
    mode:'prompt_injection', injected_to_model:true,
    executed_steps:['agent_prompt'], license:'来源仓库未随附独立许可证；仅在本项目内按其方法改编并保留来源',
    adaptation:'保留人物、服装、道具和空间连续，镜头变化与动作节拍要求；改为输出本项目分镜 JSON，不生成 PNG/Markdown 文件。',
    not_executed:['scene-XX.png 图片表格','scene-XX.md 文件导出','九宫格图片生成'],
    instruction: `按 video-storyboard 的连续性和镜头变化方法完成本次分镜：
1. 每个非空镜头必须推进动作、改变情绪或增加压力，不能只是重复构图。相邻镜头应变化景别、机位、人物姿态、手势、道具关系、前后景或运动方向，同时保持故事节奏。
2. 人物身份、脸、年龄、发型、体型、肤色、服装、鞋和配饰必须连续。关键道具的外形、颜色、数量和持物手保持一致。空间中的门窗、固定物、行动方向、光源方向、时间和天气不得无理由跳变。
3. 每个镜头写清一个主要动作节拍、起始状态、可见动作和结束状态。复杂动作拆成可分别生成的镜头，动作相位要能接上。
4. 在后镜 continuity 中记录前后镜号、为何此刻切镜、前镜最后可见画面、后镜第一帧与声音如何承接。若用反应或道具特写转移视线，写明切点动机和两侧承接锚点。
5. 保留已确认对白及 line_id、说话人和文本。只返回当前产品要求的分镜 JSON；不要创建或声称已生成 storyboard/scene-XX.png、scene-XX.md 或九宫格图片。`,
  },
  art: {
    id: 'image-prompt',
    source:'src/production-skills.ts#art', mode:'prompt_injection', injected_to_model:true,
    executed_steps:['agent_prompt'], license:'project',
    adaptation:'项目内图像提示词规则。',
    not_executed:[],
    instruction: '角色图突出辨识点和固定服装。关键帧仅描述一张静止画面，明确入画人物、站位、机位、光源和关键道具。逐一说明参考图对应的角色，画外说话人不入画。场景参考锁定空间布局与固定物，新视角遵循已选场景并标明视角；道具参考聚焦单个道具的外形材质。用避错字段列出不能换掉的外观和道具。',
  },
  vfx: {
    id: 'visual-video-adapted',
    version: '1.2.0',
    source:'contracts/skill-sources/visual-video/SKILL.md + references/dramaturgy.md + references/universal-rules.md',
    mode:'prompt_injection', injected_to_model:true,
    executed_steps:['agent_prompt'], license:'CC BY 4.0 · Serge Shima · github.com/smixs/visual-skills',
    adaptation:'只采纳戏剧公式、三细节检查、单一主动运镜、结尾画面、参考图职责和去空词规则，并适配现有 Wan/百炼单镜 JSON 契约。',
    not_executed:['Seedance/Kling/Veo 专属语法文件','多模型语法自动选择','模型能力之外的镜头拆分'],
    instruction: `按 visual-video 的可执行方法组织当前单镜：
1. 写清人物此刻想要什么、受到什么阻碍、人物与空间的关系，以及观众第一眼应看哪里。每个镜头只保留一个主要剧情变化。
2. 每个镜头至少落实三项具体细节：一个环境压力，一个身体微动作，一个声音锚点或反复出现的视觉母题。不要把“难过、紧张、压抑”直接当画面，要写成下颌收紧、呼吸停半拍、手指反复捏住提绳等可观察动作。
3. 只安排一个主要机位运动，并写出运动原因。说明主体动作如何从前段、中段走到末段，最后停在哪个可见的结尾画面。不要堆叠推、拉、摇、移。
4. 优先具体自然语言，禁止用“电影感、大片感、高级感、8K、masterpiece、stunning”等空词替代物理事实。负面约束聚焦当前镜头真实风险。
5. 每张参考图写明用途和应继承、应忽略的属性。只要求当前 capabilities 支持的输入和参数，不虚构服务商能力。
6. 相邻镜头只作为切点约束，把需要匹配的位姿、动作阶段、视线、道具和声音写进 video_prompt，不把相邻镜动作塞进当前镜头。
7. 改编自 Serge Shima 的 visual-skills，许可证 CC BY 4.0；来源 github.com/smixs/visual-skills。`,
  },
}

export function productionSkill(agent: string) {
  const skill = skills[agent]
  return skill && { ...skill, version: skill.version ?? '1.0.0', fingerprint: hash(skill.instruction) }
}

export function composeSkillPrompt(skill?: ReturnType<typeof productionSkill>) {
  if (!skill?.injected_to_model) return ''
  return `\n本次任务工作方法（${skill.id}@${skill.version}）：\n${skill.instruction}`
}
