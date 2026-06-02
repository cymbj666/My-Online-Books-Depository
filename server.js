// 简单的本地开发服务器，用于测试
// 需要先运行: npm install express dotenv
// 启动: node server.js
// 访问: http://localhost:3000

const express = require('express');
const path = require('path');
const fs = require('fs');

// 手动加载 .env.local
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...rest] = trimmed.split('=');
      const value = rest.join('=');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    }
  });
}

const app = express();
app.use(express.json());

// API 路由
const handler = require('./api/notion');

app.all('/api/notion', (req, res) => {
  handler(req, res);
});

// 静态文件
app.use(express.static(__dirname));


app.listen(3000, () => {
  console.log('✅ 本地服务器已启动: http://localhost:3000');
  console.log('按 Ctrl+C 停止');
});
