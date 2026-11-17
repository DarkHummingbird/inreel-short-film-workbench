# Contributing to RealShot Director

感谢你愿意参与 RealShot Director。

这个项目最重要的原则不是“Prompt 越长越好”，而是：**加入的规则是否真的能提高生成结果的真人感。**

## 可以贡献什么

欢迎贡献：

- 新的自然语言识别关键词
- 城市 / 地区环境模板
- 日常剧情模板
- DV / CCD / VHS / 手机等设备 preset
- 不同 AI 视频模型的 Prompt 实测结果
- Anti-AI 规则
- Prompt Before / After 案例
- UI / UX 优化
- Bug 修复

## 提交规则建议时

如果可能，请附带：

```text
目标模型：
输入 Prompt：
加入的规则：
实际结果：
是否改善：
副作用：
```

建议把结论标记为：

- `KEEP`：多次测试后明显有效
- `DROP`：没有明显作用或副作用大
- `TEST NEXT`：样本不足，需要继续验证

## 开发

当前项目无需构建工具。

修改：

```text
index.html
```

然后直接在浏览器打开即可测试。

也可以运行：

```bash
python -m http.server 8080
```

## Pull Request

1. Fork 本仓库。
2. 创建独立分支。
3. 保持修改范围清晰。
4. 如果修改规则，请说明为什么。
5. 如果修改 UI，请同时测试桌面和移动端。
6. 提交 Pull Request。

谢谢你的贡献。
