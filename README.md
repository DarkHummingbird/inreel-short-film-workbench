# 短片制作台

按《AI 短片创作平台》PRD V0.7、开发规格 V1.1 和角色契约 1.1.0 实现的中文网页工作台。正式使用只有运营、编导、负责人三个岗位；审核是流程中的检查动作，由对应岗位完成，不是第四个岗位。确认节点 1–4 共用，确认节点 5–6 按语种和版本单独处理。项目、通知、确认、任务和媒体留存在本机。

## 本地启动

本版使用 Node.js 24、SQLite 和本地文件。媒体渲染需要 macOS 的 Swift 命令行工具和 FFmpeg／ffprobe。模拟配音使用系统音色 Tingting、Samantha、Alex、Kanya。Word 解析使用 macOS textutil。

```sh
npm ci
npm start
```

使用俯视布局与人物调度功能前，需在项目根目录创建独立 Python 环境（Python 3.9+），并安装场景规划 Skill 的依赖：

```sh
python3 -m venv .venv-scene
.venv-scene/bin/python -m pip install -r contracts/skill-sources/scene-view-planner/requirements.txt
```

素材页可绘制并绑定经编导确认的俯视布局，记录场景参考、坐标、人物路线和机位；未知区域须在说明中标明。Wan 3.0 可在镜头页选择多素材参考，严格首帧和多素材模式互斥。多素材模式只提供参考，并不锁定第一帧。

打开 [短片制作台](http://127.0.0.1:3180/)。服务默认监听本机回环地址，可通过 `PORT` 修改端口。

| 角色 | 账号 | 本地演示密码 |
| --- | --- | --- |
| 运营 | `op_lin` | `lin-demo` |
| 编导 | `dir_zhou` | `zhou-demo` |
| 负责人 | `owner_chen` | `chen-demo` |

演示账号只用于本地案例。正式团队可由运营在登录页创建新的团队运营账号，再由运营在创建项目时创建编导和负责人账号。项目内“团队与权限”可以新增或替换编导、负责人；自定义账号密码只保存随机盐和 `scrypt` 哈希。

三个岗位的职责：

- 运营：提交需求，确认创意和完整剧情剧本，逐语种完成“确认节点 6：成片交付”验收，并下载通过的版本。
- 编导：制作分镜、场景、道具、关键帧、镜头、接镜和语言素材；在制作过程中人工看片质检、返工并完成“确认节点 3：分镜脚本与镜头清单”、“确认节点 4：画面与接镜”、“确认节点 5：语言素材”。
- 负责人：只读查看项目进度、各版本成果和用量，向编导提交业务反馈；不代替运营或编导通过/退回确认，也不能下载交付版。

`reviewer_wu` / `wu-demo` 只作为历史项目的后端兼容账号保留。正常登录和页面都不再显示该账号，也没有兼容入口；新建项目不会绑定它。保留后端兼容仅用于维持旧项目数据和既有确认记录。

运营可在项目列表创建《末班车之后》案例，核对并提交预填 Brief。编导从站内通知进入项目。可以在独立浏览器配置文件里分别登录运营、编导和负责人账号。项目库默认在 `data/workbench.sqlite`，素材在 `data/media/`。

项目内新增“模型配置”工具页。开发阶段继续使用现有百炼适配器；运营或负责人可以配置地域、业务空间、文字/图片/视频/语音模型和音色，编导只读查看。每个项目使用独立的 `DATA_DIR/provider-config/<project-id>.json`（权限 600），未配置项目回退到服务端环境变量。API Key 不会写入项目数据库、任务记录、成片或接口返回；留空表示保留该项目已有 Key。Mock 模式下可保存配置，但只有以 `MODEL_MODE=dashscope` 重启后下的新任务才会使用。

模型配置同时支持项目采购单价：输入 Token / 千、输出 Token / 千、图片 / 次、视频 / 秒、配音 / 字。真实生成前显示人民币预估价；没有填写单价时明确显示“未配置”。任务页把预估价、任务回执用量和运营录入的实际账单分开。CNY/USD 账单支持账期、供应商账单号和备注。

生产 Agent 已接入两个外部方法来源的可执行改编：分镜使用 `video-storyboard` 的连续性和镜头变化规则，镜头生成使用 `visual-video` 的三细节、单一主动运镜和结尾画面规则。任务详情会记录来源、许可证、改编内容、实际注入状态和未执行部分。`visual-video` 使用 CC BY 4.0，署名 Serge Shima / [smixs/visual-skills](https://github.com/smixs/visual-skills)。质检 Agent 和内容审核 Agent 已停用；画面和成片质检由编导、运营人工看片完成。

分镜和镜头生成前可点击“查看提示词与素材”，检查实际发送给 Agent 的完整提示词、结构化输入和参考图；预检不会创建任务或产生费用。人物、关键帧、场景、道具、新视角、调度图和视频都支持先生成可编辑的最终提示词，再用修改后的提示词生成媒体。逐镜视频区会始终显示关键帧、场景和分镜确认状态，满足条件后开放生成模式和素材勾选。运营可在任务页清理失败与待查询任务，成功任务和产物不会被删除。

普通页面不再展示 Agent System Prompt、JSON Schema 或内部结构化输入。生成前只显示实际素材，点击“准备提示词”后展示真正发送给媒体模型的可编辑自然语言；生成后可查看编译后的实际请求。任务异常仍保留原始回执供审计。

分镜 Agent 的返回结果会先保存原始回执，再由服务端按已确认剧情剧本恢复对白标识、说话人和文本。Agent 改台词不会进入分镜。失败时页面提供原始原因和“从剧本手动创建分镜”入口。

选定关键帧后支持文字约束的局部重绘。底图是已选关键帧，任务必须说明只修改什么以及人物、手部、服装、构图、背景、道具和光线中哪些必须保持不变；结果作为新候选，需人工看片和再次确认。

创作流程中，“确认节点 2：完整剧情剧本”只包含场景、动作、情绪和对白；确认后才转换为分镜脚本，由“确认节点 3：分镜脚本与镜头清单”检查景别、机位、镜头时长和前后承接。剧情剧本中出现镜头语言会被服务端拒绝提交。

Wan 3.0 支持原生音频。每种交付语言都先生成包含该语言实际对白、气息和心声的专属视频，后期只增加字幕和背景音乐；只有原生音轨不可用时才生成逐句补录配音。旧项目中的 TTS 文件和历史成片继续保留，不会被新规则覆盖。

语言页会按镜头生成并选用各语种专属视频，再以该语种视频生成同步预览和成片。页面显示实际波形、字幕时间滑块和所属镜头时间范围。任务看板默认按制作阶段折叠；负责人反馈会同时通知运营和编导并显示在项目时间线。

项目按成员账号隔离。项目列表、通知、任务、草稿、模型配置、媒体和成片都先校验项目成员关系；跨团队请求返回 403。三个项目各 20 次并发写入的本地测试通过。正式公网部署仍需邀请审批、登录限流、多实例共享任务队列和独立渲染节点。

## 模拟验收

```sh
npm test
```

HTTP 验收按 AT-01 至 AT-22 执行真实登录、上传、确认、生成任务、站内通知、重新打开和文件下载。测试同时验证角色注册表的所有输入／输出示例，以及使用替身传输层的百炼请求协议、用量与超时处理。全部通过后，验收记录和三语 MP4 写入 `test-results/`。下载与预览使用同一文件，脚本核对 SHA-256、9:16、36 秒、音轨与完整解码。模拟素材是插画分镜、macOS 配音与测试背景音乐。

要浏览验收后的项目，可以在同一目录另开终端，用生成的验收数据库启动第二个实例。它与默认工作台共用本地模拟媒体。

```sh
PORT=3181 WORKBENCH_DB=test-results/acceptance.sqlite npm start
```

## 百炼真实小样

本工作区的后续真实验收使用新加坡业务空间，启动命令见 [当前验收项目和默认百炼配置](HANDOFF.md#当前验收项目和默认百炼配置)。

在百炼控制台选定华北 2（北京）或新加坡，在同一地域与业务空间创建 API Key，并从「业务空间管理」复制 Workspace ID。授权项目使用的文字、图像、视频和语音模型即可。 [创建 API Key](https://help.aliyun.com/zh/model-studio/get-api-key/) · [获取 Workspace ID](https://help.aliyun.com/zh/model-studio/obtain-the-app-id-and-workspace-id)

在 macOS「终端」进入项目目录，运行交互配置。Key 隐藏输入并写入项目之外的 `~/.config/short-film-workbench/bailian.env`，该文件权限为 `600`。不要把 Key 粘贴到聊天或命令行参数里。

```sh
bash scripts/configure-bailian.sh
```

默认语音模型是 `qwen-audio-3.1-tts-flash`。北京中文示例 `anmingyuan_v3.1`、新加坡中文小样候选 `longanhuan_v3.1`、英文示例 `Eric_v3.1`。北京地域留空泰语音色时，使用百炼 Sambert 的泰语系统音色 Waan。也可填写当前 Qwen-Audio-TTS 模型下能读泰语的音色 ID，或按对白上传备用片段。 [Qwen-Audio-TTS 音色列表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list) · [Sambert 音色列表](https://help.aliyun.com/zh/model-studio/sambert-python-sdk)

| 环境变量 | 取值 |
| --- | --- |
| `DASHSCOPE_API_KEY` | 百炼 API Key |
| `DASHSCOPE_WORKSPACE_ID` | 同地域的业务空间 ID |
| `DASHSCOPE_REGION` | `cn-beijing`（默认）或 `ap-southeast-1` |
| `DASHSCOPE_TEXT_MODEL` | 默认 `qwen-plus`，用于结构化 Agent 和翻译 |
| `DASHSCOPE_TEXT_STREAM` | 设为 `1` 时接收流式文字响应，在首段记录原请求号 |
| `DASHSCOPE_IMAGE_MODEL` | 默认 `qwen-image-3.0-pro`，用于角色参考和关键帧 |
| `DASHSCOPE_VIDEO_MODEL` | 默认 `wan2.7-i2v`，使用已确认首帧和目标时长 |
| `DASHSCOPE_SPEECH_MODEL` | 默认 `qwen-audio-3.1-tts-flash` |
| `DASHSCOPE_VOICE_ZH`、`DASHSCOPE_VOICE_EN`、`DASHSCOPE_VOICE_TH` | 该语种在所选模型和账号中可用的音色 ID，北京地域泰语留空时使用 Waan |
| `WORKBENCH_PASSWORD_OP`、`WORKBENCH_PASSWORD_DIRECTOR`、`WORKBENCH_PASSWORD_REVIEWER`、`WORKBENCH_PASSWORD_OWNER` | 自定义账号的登录密码 |

先使用各自独立的小样命令核对权限、文件、任务号和计量。命令只使用随附案例，实际调用按服务商计量。小样输出保存在 `test-results/real-*/`，报告包含角色输入输出、媒体文件和可得用量。

```sh
node --env-file="$HOME/.config/short-film-workbench/bailian.env" --experimental-transform-types scripts/real-sample.ts text
node --env-file="$HOME/.config/short-film-workbench/bailian.env" --experimental-transform-types scripts/real-sample.ts image-video
node --env-file="$HOME/.config/short-film-workbench/bailian.env" --experimental-transform-types scripts/real-sample.ts speech
```

小样通过后启动真实模式。使用独立数据目录可把模拟项目与真实项目隔开。真实模式的背景音乐由编导上传，FFmpeg 使用固定交付清单渲染。镜头与成片的画面、字幕、口型、音轨和质量由编导、运营按节点人工检查；系统不再创建质检或内容审核 Agent 任务。

```sh
MODEL_MODE=dashscope DATA_DIR=data/real PORT=3182 node --env-file="$HOME/.config/short-film-workbench/bailian.env" --experimental-transform-types src/server.ts
```

真实请求经过服务端。生成请求结果未知时保留待查询状态，服务商任务号已返回时可从任务页查询原任务。没有返回用量的任务显示“未提供”。API Key 从服务端环境读取，项目和报告只保存模型标识、请求号、任务号和可得计量。

- 结构化文本调用参考 [百炼 Chat Completions](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。
- 角色图和关键帧参考 [Qwen-Image 生成与编辑](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)。
- 首帧生成及原任务轮询参考 [Wan 2.7 图生视频](https://help.aliyun.com/en/model-studio/image-to-video-general-api-reference)。
- 中英泰配音与语种参数参考 [Qwen-Audio-TTS HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)。

## 当前环境的验收口径

模拟 AT-01 至 AT-22 已通过。北京百炼真实小样的验收与用量记录在 `test-results/real-sample-acceptance.json`，覆盖文本鉴权、首帧图生视频和中英泰配音。分镜文本请求的两次提交结果未知，完整成片验收采用已校对的案例分镜。用量记录来自模型响应，实际账单以百炼控制台为准。当前交付运行在单机 macOS，采用 SQLite 和同进程后台任务。
