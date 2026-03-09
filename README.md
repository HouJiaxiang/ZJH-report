# 🃏 炸金花云记分 (ZJH Scoreboard)

使用 Gemini 创建的一个支持线下玩炸金花游戏进行积分结算的应用。可以部署在网页端，朋友间访问链接可直接进行“创建房间、加入房间、联机游戏”等操作。

**👉 [点击访问链接即可在线体验](https://scintillating-starburst-ffeb0d.netlify.app/)**

---

## ✨ 功能特点

- **🏠 房间管理**：支持创建专属游戏房间，通过房间号快速邀请好友加入。
- **👥 实时联机**：基于 Supabase 实现的多人实时状态同步，所有玩家数据无缝更新。
- **💰 底池与下注跟踪**：自动计算当前底池金额，记录每位玩家的下注、跟注、加注状态。
- **📊 积分结算**：告别纸笔，实时计算并展示每位玩家的当前积分盈亏。
- **📱 响应式设计**：完美适配手机端和电脑端浏览器，随时随地打开即用。

## 🛠️ 技术栈

- **前端框架**: React 18 + TypeScript + Vite
- **UI 样式**: Tailwind CSS + Lucide React (图标)
- **后端服务**: Supabase (PostgreSQL + Realtime WebSocket)
- **AI 辅助**: Google Gemini

## 🚀 本地运行指南

如果你想在本地运行或二次开发此项目，请按照以下步骤操作：

### 1. 克隆项目

```bash
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 Supabase

1. 注册并登录 [Supabase](https://supabase.com/)。
2. 创建一个新的 Project。
3. 在项目中执行 SQL 脚本以创建所需的数据表。
4. 获取你的 `Project URL` 和 `anon public Key`。
5. 在项目根目录创建 `.env.local` 文件，或直接修改 `lib/supabase.ts`，填入你的配置信息。

### 4. 启动开发服务器

```bash
npm run dev
```
打开浏览器访问 `http://localhost:3000` 即可预览。

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助完善这个项目！

## 📄 开源协议

本项目采用 MIT 协议开源。
