# RealShot Director 🎥

> **说人话，让它替你当导演。**  
> 一个纯前端、零配置、无需 API Key 的 AI 视频 Prompt 导演工具。

RealShot Director 不生成视频，它只做一件事：把用户的一句话自然语言描述，扩写成更适合 AI 视频模型执行、同时更有「真人实拍感」的完整 Prompt。

它重点解决的不是“画质不够高清”，而是很多 AI 视频最明显的问题：**人物像在表演、镜头像稳定器、构图太完美、曝光永远正确、人物一直看镜头、每一秒都在做动作。**

RealShot 的方法是主动加入现实摄影中本来就存在的轻微不确定性，例如摄影师反应慢半拍、自动对焦短暂迟疑、明暗切换时曝光呼吸、人物走神、整理衣服、没有意义的停顿等，让生成结果更像“有人真的拍到了一段生活”，而不是“AI 做了一条复古风广告”。

---

## 🌐 在线体验

部署到 Netlify 后，把这里替换成你的正式地址：

```text
https://realshot-director.netlify.app/
```

项目是纯静态网页，也可以直接双击 `index.html` 在本地使用。

---

## ✨ 核心特点

### 1. Natural Language First

普通用户不需要先填写：

```text
模型：
时长：
画幅：
人物：
场景：
摄影设备：
真实感等级：
```

只需要描述脑子里的画面：

```text
一个广东女生早上出门买早餐，
像小时候家里 DV 拍的那种，
老城区，阳光很好，很生活化，不要 AI 感。
```

RealShot 会自动推断人物、地点、时间、天气、摄影设备、剧情节奏和真人感要求。

### 2. Realism Engine

RealShot 不靠堆砌：

```text
4K / 8K / cinematic / masterpiece / ultra realistic
```

来制造“真实感”。

它关注的是更接近真实摄影的行为：

- 轻微手持抖动
- 人物不永远处于画面中心
- 摄影师偶尔反应慢半拍
- 自动对焦短暂寻找主体
- 人物和物体之间发生一次焦点切换
- 从阴影进入阳光时曝光稍慢调整
- 人物会走神、停顿、整理头发或衣服
- 人物不会一直看镜头、一直微笑
- 动作不会像编舞一样精准卡点
- 结尾可以像家庭录像一样突然停止

### 3. Timeline Director

RealShot 会自动把一个模糊想法拆成时间轴。

例如 15 秒视频会自动生成类似：

```text
00:00 - 00:03
人物自然进入场景，先出现一个普通生活动作。

00:03 - 00:06
开始主要行动，摄影师边走边跟拍。

00:06 - 00:09
加入停顿、找零钱、看菜单、等人等真实生活行为。

00:09 - 00:12
主要事件完成，同时出现轻微对焦或曝光变化。

00:12 - 00:15
人物继续离开，不刻意设计漂亮结尾，录像自然停止。
```

### 4. Character Lock

生成 Prompt 时自动加入人物一致性约束：

- 同一张脸
- 同一发型
- 同一服装
- 同一年龄感
- 同一身材比例
- 避免镜头变化导致人物“换脸”或换装

### 5. Anti-AI Rules

RealShot 会主动抑制常见的 AI 视频特征：

- 永久微笑
- 持续看镜头
- 完美居中构图
- 商业磨皮
- 稳定器级丝滑运镜
- 过度电影级逆光
- 黄金时刻滤镜泛滥
- 模特走秀感
- 每一秒都安排动作
- 过于整洁、过于服务剧情的背景

---

## 🚀 快速开始

### 方法一：直接打开

下载项目后直接打开：

```text
index.html
```

不需要安装任何依赖。

### 方法二：本地静态服务器

如果你习惯使用本地服务器：

```bash
python -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

### 方法三：部署到 Netlify

本项目针对 Netlify 静态部署进行了配置。

1. Fork 或上传仓库到 GitHub。
2. 登录 Netlify。
3. 选择 **Add new site → Import an existing project**。
4. 连接 GitHub 仓库。
5. Build command 留空。
6. Publish directory 填：

```text
.
```

7. 点击 Deploy。

仓库内已经包含 `netlify.toml`，通常不需要额外配置。

---

## 🧠 当前工作原理

当前版本是 **Local Rules Engine / 纯规则版**。

整个生成过程发生在浏览器本地：

```text
用户自然语言
      ↓
关键词 / 语义线索识别
      ↓
人物推断
      ↓
地点推断
      ↓
时间 / 天气推断
      ↓
摄影设备推断
      ↓
剧情动作推断
      ↓
RealShot 真人感规则
      ↓
时间轴生成
      ↓
最终 Prompt
```

当前规则主要直接写在 `index.html` 的 JavaScript 中，因此：

- 不需要后端
- 不需要数据库
- 不需要 API Key
- 不产生模型调用成本
- 不会把用户输入发送到 RealShot 服务器

---

## 🔒 为什么现在不接大模型？

项目早期考虑过接入 DeepSeek，并允许用户自己填写 API Key。

但这样会带来几个问题：

1. 很多普通用户并不知道 API Key 是什么。
2. 需要注册模型平台、充值、复制 Key，会显著提高使用门槛。
3. 纯前端 BYOK 还会遇到 CORS、兼容性、Key 保存方式等问题。
4. 项目当前真正需要验证的是 **“RealShot 这套 Prompt 方法到底有没有价值”**，而不是 API 配置能力。

因此 v0.x 阶段坚持：

> **打开即用，零配置。**

未来如果纯规则引擎已经无法满足抽象语义需求，再考虑增加可选的 AI Director，而不是让 AI 接口成为使用前置条件。

---

## 🎬 示例

### 示例 1：广东老城区买早餐

输入：

```text
一个广东女生早上出门买早餐，像小时候家里DV拍的那种，老城区，阳光很好，很生活化，不要AI感。
```

RealShot 会自动理解为：

```text
人物：20 岁左右年轻中国女性
地点：广东老城区生活街巷
时间：清晨到上午
设备：2000 年代初期家用 DV
事件：出门 → 穿过老街 → 早餐档 → 买早餐 → 离开
风格：家庭录像 / 非广告 / 非表演
```

随后加入人物一致性、摄影机系统、时间轴、真人行为和 Anti-AI 约束。

完整案例见：

```text
examples/example-01-dv-cn.md
```

### 示例 2：手机随拍

完整案例见：

```text
examples/example-02-smartphone.md
```

---

## 🧩 SKILL.md 是什么？

仓库中的 `SKILL.md` 是 RealShot Director 的核心方法论说明。

网页只是把其中一部分规则做成了一个零门槛工具，而 `SKILL.md` 描述的是更完整的导演逻辑，包括：

- Natural Language Input
- Character Lock
- Environment Lock
- Camera System
- Realism Engine
- Anti-AI Rules
- Timeline Storyboard
- Prompt Repair
- Model Adapter
- Reference Analysis
- Generated Video Diagnosis

你可以把 `SKILL.md` 交给支持 Agent / Skill 工作流的 AI 编程或智能体工具使用。

例如：

```text
读取 SKILL.md。
以后本项目所有 AI 真人视频 Prompt 任务，都按照 RealShot Director 的方法执行。

我想拍一个女孩下雨天去便利店买东西，像 2008 年 CCD 随手录像。
```

Agent 应该直接理解用户自然语言，而不是要求用户先填写大量专业参数。

---

## 📁 项目结构

```text
realshot-director/
├── index.html
├── SKILL.md
├── README.md
├── LICENSE
├── CHANGELOG.md
├── CONTRIBUTING.md
├── netlify.toml
├── .gitignore
│
├── examples/
│   ├── example-01-dv-cn.md
│   ├── example-02-smartphone.md
│   └── natural-language-examples.md
│
└── docs/
    ├── full-director-template.md
    ├── RULES.md
    └── ROADMAP.md
```

---

## 🧱 技术栈

非常简单：

```text
HTML5
CSS3
Vanilla JavaScript
```

没有：

```text
React
Vue
Next.js
Node.js
npm
数据库
后端
API
```

原因不是做不到，而是当前产品不需要。

对于一个“输入一句话 → 生成 Prompt → 复制”的工具，单 HTML 的部署、Fork、修改和传播成本最低。

---

## ⚙️ 高级设置

默认情况下用户可以完全忽略高级设置。

当前页面提供：

### 目标模型

```text
自动判断
豆包
Seedance
可灵
Veo
Sora
```

当前主要影响 Prompt 中的目标描述，尚未针对所有模型实现深度语法适配。

### 视频时长

```text
5 秒
10 秒
15 秒
30 秒
```

时间轴会按照视频时长重新分配。

### 画幅

```text
9:16
16:9
1:1
4:3
```

### 真人感

```text
轻度真实
自然纪实
原始随拍
```

高级参数是 **可选控制项**，不是使用前提。

---

## 🧪 当前识别能力

当前 Local Rules Engine 已经会尝试识别：

### 人物

```text
女生 / 女孩 / 女性
男生 / 男孩 / 男性
大学生
明确年龄
```

### 地点

```text
广东 / 广州 / 佛山 / 深圳 / 潮汕等
农村 / 老家 / 村里
便利店
学校 / 大学校园
普通居民区
```

### 时间

```text
清晨
早上
早餐时间
中午
傍晚
夜晚
半夜
```

### 天气

```text
阳光 / 晴天
下雨 / 雨天
阴天
```

### 摄影设备 / 风格

```text
DV
CCD
VHS
手机
家庭录像
朋友随手拍
```

### 基础剧情

目前针对部分高频生活场景有专门逻辑，例如：

```text
买早餐
去便利店
贴春联
吃宵夜
```

后续会持续扩充。

---

## ⚠️ 当前局限

纯规则并不等于真正的大语言模型。

例如：

```text
一个女生下雨天去便利店买东西，十几年前 CCD 的感觉。
```

这种输入非常适合当前版本。

但：

```text
我想拍一种暑假快结束了，两个人都知道以后可能很少见面，但谁也没有说出来的感觉。
```

涉及抽象情绪、潜台词和复杂叙事时，纯规则引擎无法像大模型一样真正“理解”。

这属于当前设计的已知边界，而不是隐藏的问题。

---

## 🛠️ 自定义规则

如果你会一点 JavaScript，可以直接修改 `index.html`。

核心逻辑主要包括：

```text
infer(text)
```

负责从用户自然语言中推断人物、地点、摄影设备、时间、天气、动作和风格。

```text
splitTimeline(action, duration)
```

负责生成时间轴。

```text
buildPrompt(text)
```

负责将所有内容组合为最终 RealShot Prompt。

因此你可以非常容易地加入自己的：

- 城市
- 场景
- 摄影设备
- 视频年代
- 动作模板
- 平台 Prompt 偏好
- Anti-AI 规则

---

## 🗺️ Roadmap

### v0.1 — Local Edition

- [x] 单 HTML 纯前端
- [x] 自然语言输入
- [x] 本地规则引擎
- [x] 人物识别
- [x] 地点识别
- [x] 时间 / 天气识别
- [x] DV / CCD / VHS / 手机风格
- [x] Realism Engine
- [x] Character Lock
- [x] Timeline Generator
- [x] Anti-AI Rules
- [x] 一键复制 Prompt
- [x] Netlify 静态部署
- [x] `SKILL.md`

### v0.2 — Better Local Intelligence

- [ ] 更丰富的中文自然语言关键词
- [ ] 更多地区环境模板
- [ ] 更多生活剧情模板
- [ ] 2000s / 2010s / 当代设备预设
- [ ] 更多摄影设备特征
- [ ] Prompt 长度档位
- [ ] Prompt 历史记录（LocalStorage）
- [ ] 自定义规则导入 / 导出

### v0.3 — Prompt Lab

- [ ] 普通 Prompt vs RealShot Prompt 对比
- [ ] Realism 强度调节
- [ ] 独立的 Character / Camera / Timeline 编辑器
- [ ] Prompt V1 / V2 对比
- [ ] 用户反馈“这一条是否更真实”
- [ ] Benchmark 示例库

### Future

以下功能只在确认用户确实需要之后再考虑：

- [ ] 可选 AI Director
- [ ] Reference Image Analysis
- [ ] Reference Video Analysis
- [ ] Generated Video Diagnosis
- [ ] 自动生成 Prompt V2
- [ ] 模型深度适配

---

## 🤝 Contributing

欢迎提交：

- 新生活场景规则
- 新地区环境模板
- 新摄影设备 preset
- 新 Anti-AI 规律
- 不同视频模型的实测结果
- Prompt Before / After 案例
- bug 修复
- UI 改进

详见：

```text
CONTRIBUTING.md
```

尤其欢迎真正基于生成结果的测试，而不是单纯增加更多看起来“专业”的摄影术语。

RealShot 更看重：

> 这条规则到底能不能让生成结果更自然？

---

## 📊 Benchmark 思路

RealShot 后续希望通过可重复测试不断删掉无效规则。

例如同一场景分别生成：

```text
A. 普通 Prompt
B. RealShot Prompt
```

或者：

```text
A. 无摄影缺陷
B. 轻度摄影缺陷
C. 重度摄影缺陷
```

观察：

- 人物是否一直看镜头
- 表情是否过度
- 动作是否顺滑得不真实
- 摄影机是否像专业稳定器
- 自动对焦指令是否真的生效
- 曝光变化是否真的生效
- 人物一致性是否下降
- Prompt 过长是否反而降低模型执行率

最终把规则分成：

```text
KEEP      已验证有效
DROP      基本无效或产生副作用
TEST NEXT 需要继续测试
```

这也是 `SKILL.md` 后续最重要的演化方向。

---

## 🔐 隐私

当前 Local Edition：

- 没有账号系统
- 没有埋点代码
- 没有后端接口
- 没有数据库
- 没有 API Key
- 不主动上传用户输入

如果你自己 Fork 后增加统计、API 或第三方脚本，请自行更新隐私说明。

---

## 📦 部署说明

### Netlify

仓库自带：

```text
netlify.toml
```

配置为直接发布仓库根目录。

### GitHub Pages

因为项目是纯静态文件，也可以直接打开 GitHub Pages。

### Cloudflare Pages

同样无需 Build Command，输出目录使用仓库根目录即可。

---

## 📄 License

MIT License。

你可以自由：

- 使用
- 修改
- Fork
- 二次开发
- 部署
- 商业使用

但请保留 MIT License 中要求的版权和许可声明。

---

## 💬 项目理念

RealShot 不想成为另一个“提示词大全”。

它更想做的是：

> 把真实摄影为什么看起来真实，拆成 AI 视频模型能够理解的导演语言。

用户不需要成为摄影师，也不需要先学 Prompt Engineering。

用户只需要说：

```text
我脑子里想拍这样一段东西……
```

剩下的交给 RealShot Director。

---

## ⭐ 如果这个项目对你有帮助

欢迎 Star、Fork、提交 Issue，或者把你实测有效 / 无效的 RealShot 规则告诉项目作者。

真正有价值的不是 Prompt 写得多长，而是：

**哪些规则，真的让 AI 视频少了一点 AI 味。**
