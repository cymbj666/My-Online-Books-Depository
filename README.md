# 📚 书单推荐

一个连接 Notion 数据库的网文推荐网页，支持搜索、筛选和添加推荐。

## 功能

- 🔍 按书名搜索、按类型/作者/平台筛选
- 📋 卡片式书单展示，点击卡片展开完整评价
- ➕ 密码保护添加新推荐
- 🏷️ 交互式类型标签选择器（下拉选择已有标签，支持新建）
- 🌙 深色主题，响应式布局（手机/平板/桌面）

## 技术栈

- **前端**: 纯 HTML/CSS/JS，单文件
- **后端**: Vercel Serverless Function（`api/notion.js`）
- **数据源**: Notion API

## 本地开发

```bash
npm install
node server.js
# 访问 http://localhost:3000
```

### 配置环境变量

复制 `.env.local` 并填入真实值：

```
NOTION_TOKEN=ntn_xxx        # Notion Integration Token
DATABASE_ID=xxx             # Notion 数据库 ID
ADD_PASSWORD=xxx            # 添加推荐的密码
```

### 获取 Notion 凭证

1. 打开 https://www.notion.so/my-integrations → 创建 Connection（Integration）
2. 复制 Internal Integration Token
3. 在数据库页面右上角 Share → Connections → 添加该 Connection
4. 从 URL 提取 Database ID：`https://www.notion.so/p/<DATABASE_ID>?v=...`

## 部署到 Vercel

```bash
npx vercel login
npx vercel --prod --yes

# 设置环境变量
npx vercel env add NOTION_TOKEN production --value "你的token" --yes
npx vercel env add DATABASE_ID production --value "数据库ID" --yes
npx vercel env add ADD_PASSWORD production --value "你的密码" --yes

# 重新部署使环境变量生效
npx vercel --prod --yes
```

> **注意**: 在 Vercel 项目 Settings → Build & Development Settings 中，Framework Preset 需设为 **Other**。

## Notion 数据库字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| 书名 | Title | 必填，书名 |
| 作者 | Select | 单选，作者 |
| 平台 | Select | 单选，如"起点""番茄" |
| 类型 | Multi-select | 多选，标签 |
| 评价 | Text | 富文本，推荐语 |
