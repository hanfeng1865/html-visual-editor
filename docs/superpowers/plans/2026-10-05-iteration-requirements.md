# 迭代需求工作区 Implementation Plan

**Goal:** 在现有 HTML 编辑器内交付可保存、可继续讨论的迭代需求工作区。

**Architecture:** 前端独立工作区复用项目上下文；服务端按项目根目录保存迭代和版本；需求模型与源码修改模型复用现有连接，接受同步建议后才进入现有检查与保存链路。

**Tech Stack:** 原生 JavaScript、Node HTTP、文件系统原子写、现有 Chat Completions、Playwright。

## Global Constraints

- 一份文档代表一次迭代，Why/What/When/Who/Where 是迭代维度，How 和验收按功能展开。
- 场景和范围分开，支持整个 HTML、指定页面、边讨论边确定。
- 待创建为空状态；待开始、进行中、已完成为持久状态，已完成可重新打开。
- 结束记录保留当时原型、文档及问题；新迭代引用完成版本，不影响旧版。
- 图片、录音、文字可中途加入，演示代码不能自动成为业务规则。
- 明确回答可更新草稿；冲突、推测和原型同步需确认；失败不可标为已同步。
- 打开讨论或发送消息时才分析文件变化；飞书通过富文本复制交付。
- 保留现有编辑功能与外部文件修改冲突保护，不在用户示例项目中创建虚构迭代。

## Task 1 — 持久化迭代与版本

Files: requirements-store.mjs, tests/requirements-store.test.mjs

- [x] 创建按项目隔离的原子写存储，使用 version 比较防止并发覆盖。
- [x] 实现 create/metadata/start/finish/reopen/document/undoDocument/material/aiResult/suggestion。
- [x] 保存开始、分析、完成快照；重新打开不修改之前完成记录。
- [x] 验证跨重启读取、版本冲突、完成态保护、资料约束与文档撤销。

## Task 2 — 模型、资料与同步 API

Files: requirements-service.mjs, ai-service.mjs, dev-server.mjs, tests/requirements-service.test.mjs

- [x] 增加结构化需求请求与录音转写，复用密钥，不向客户端返回密钥。
- [x] 读取选定页面、CSS/JS 与标注，比较上次分析快照；保留所有原始资料。
- [x] 强制模型按产品经理思路输出迭代文档，保留不确定性、资料依据、问题与建议。
- [x] 原型同步绑定迭代、建议、源码版本，验证后复用 ai.apply 保存。
- [x] 用本地模型模拟服务测试成功、失败、冲突和语音转写。

## Task 3 — 编辑器内工作区

Files: requirements-ui.mjs, requirements.css, editor.html, editor.js

- [x] 在项目栏添加“迭代需求”，接入独立工作区，保留原画布与编辑功能。
- [x] 实现创建表单、项目迭代列表、状态入口、结束回顾、再次打开及派生迭代。
- [x] 实现讨论、可编辑文档、版本撤销、资料管理、同步建议与可见错误。
- [x] 支持图片、文本文件及录音上传，转写结果进入讨论；复制安全富文本到飞书。
- [x] 接入当前项目、页面、选区、未保存草稿提示与主画布刷新。

## Task 4 — 验证和用户入口

Files: tests/requirements-browser.mjs, README.md, EDITOR-QUICKSTART.md

- [x] 本地模拟模型验证完整浏览器流程，包含源文件真实写入与重载持久化。
- [x] 执行 npm test、AI 对话回归与新增浏览器检查。
- [x] 更新使用说明，启动或重启本地服务，将实际编辑器打开到用户指定项目。

采用分工执行：存储、前端独立实现，主线程负责模型服务、集成、验证。已获用户“开始”授权，持续执行，不追加实施确认。

## 验证结果

- 全量 Node 测试通过（119 项）。
- 新增需求工作区浏览器测试通过，含真实源码同步、手工文档保护及完成记录。
- 现有 AI 对话浏览器回归通过。
- 已在原型保存测试项目中验证实际入口与创建表单；没有创建虚构迭代或修改示例业务内容。
- 模型和录音接口以本地模拟服务验证；实际服务能力取决于用户配置，飞书粘贴样式未在登录的飞书环境中验证。
