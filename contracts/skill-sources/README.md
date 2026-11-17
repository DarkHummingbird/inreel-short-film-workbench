# GitHub Skill 参考资料

| 下载目录 | 来源 | 产品内状态 |
| --- | --- | --- |
| director-agent | https://github.com/SHIFT-R/director-agent | 参考，未作为独立 Agent 注入；当前仅将 blocking 参考文本登记到 layout Skill 记录 |
| video-storyboard | https://github.com/fanshuning/agentara-skills/tree/main/skills/aigc/video-storyboard | `prompt_injection`：连续性、镜头变化、动作节拍和脚本意识已改编进分镜 Agent；不执行 PNG/Markdown/九宫格文件输出 |
| visual-video | https://github.com/smixs/visual-skills/tree/main/video | `prompt_injection`：戏剧公式、三细节、单一主动运镜、结尾画面和参考图职责已进入镜头生成 Agent；保留 CC BY 4.0 署名，不加载未选中的模型专属文件 |
| realshot-director | https://github.com/jasonmarkppp/realshot-director | 已停用，仅保留为参考资料；质检改由编导、运营人工看片完成，不再创建质检 Agent |
| scene-view-planner | https://github.com/EdwinZDZ/scene-view-planner | `renderer_only`：使用已确认坐标运行 `floorplan.py`；未执行图片理解和多视角闭环；MIT |

应用加载 `src/production-skills.ts` 中登记的指令。俯视图任务读取场景 Skill 和项目已有导演调度规则并运行其绘图脚本；分镜、镜头生成和质检使用从上述来源改编的可执行规则。每个新任务保存所用指令、版本、来源、许可证、本项目改编、未执行部分、执行模式、是否注入模型和内容指纹。

`prompt_injection` 表示指令会拼入真实 Agent 请求；`renderer_only` 表示只执行本地工具，不能把任务里的 `skill` 字段当作完整 Skill 方法论已运行。
