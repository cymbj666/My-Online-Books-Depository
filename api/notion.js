const { Client } = require('@notionhq/client');

// CORS 响应头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Add-Password',
};

/**
 * Vercel Serverless Function 入口
 * 统一代理所有 Notion API 请求
 */
module.exports = async function handler(req, res) {
  // 处理 CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Add-Password');
    return res.status(204).end();
  }

  const { action } = req.query;

  try {
    if (req.method === 'GET' && action === 'query') {
      return await handleQuery(req, res);
    }
    if (req.method === 'GET' && action === 'options') {
      return await handleOptions(req, res);
    }
    if (req.method === 'POST' && action === 'verify') {
      return await handleVerify(req, res);
    }
    if (req.method === 'POST' && action === 'add') {
      return await handleAdd(req, res);
    }

    return res.status(404).json({ error: '接口不存在' });
  } catch (error) {
    console.error('API Error:', error);

    // Notion API 错误分类
    if (error.code === 'unauthorized') {
      return res.status(500).json({ error: 'Notion Token 无效，请检查环境变量' });
    }
    if (error.code === 'object_not_found') {
      return res.status(500).json({ error: '数据库未找到，请确认已与 Integration 共享' });
    }
    if (error.code === 'rate_limited') {
      return res.status(429).json({ error: '请求过于频繁，请稍后重试' });
    }

    return res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 查询数据库 — 支持多条件筛选
 * GET /api/notion?action=query&search=xxx&tag=xxx&author=xxx&platform=xxx
 */
async function handleQuery(req, res) {
  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  const filter = buildFilter(req.query);

  const response = await notion.databases.query({
    database_id: process.env.DATABASE_ID,
    filter: filter || undefined,
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: 100,
  });

  const books = response.results.map(formatBook);

  return res.status(200).json({ books });
}

/**
 * 获取筛选选项（去重的作者、平台、类型列表）
 * GET /api/notion?action=options
 */
async function handleOptions(req, res) {
  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  const response = await notion.databases.query({
    database_id: process.env.DATABASE_ID,
    page_size: 100,
  });

  const authors = new Set();
  const platforms = new Set();
  const tags = new Set();

  response.results.forEach((page) => {
    const author = page.properties['作者']?.select?.name;
    const platform = page.properties['平台']?.select?.name;
    const tagList = page.properties['类型']?.multi_select || [];

    if (author) authors.add(author);
    if (platform) platforms.add(platform);
    tagList.forEach((t) => tags.add(t.name));
  });

  return res.status(200).json({
    authors: [...authors].sort(),
    platforms: [...platforms].sort(),
    tags: [...tags].sort(),
  });
}

/**
 * 验证密码 — 不涉及 Notion API
 * POST /api/notion?action=verify
 * Header: X-Add-Password
 */
async function handleVerify(req, res) {
  const password = req.headers['x-add-password'];
  if (!password || password !== process.env.ADD_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }
  return res.status(200).json({ success: true });
}

/**
 * 添加新书推荐 — 需要 X-Add-Password 验证
 * POST /api/notion?action=add
 * Body: { title, author?, platform?, tags?: string[], review? }
 */
async function handleAdd(req, res) {
  // 密码验证
  const password = req.headers['x-add-password'];
  if (!password || password !== process.env.ADD_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }

  const { title, author, platform, tags, review } = req.body;

  // 必填验证
  if (!title || !title.trim()) {
    return res.status(400).json({ error: '书名不能为空' });
  }

  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  // 构建 Notion page properties
  const properties = {
    '书名': {
      title: [{ text: { content: title.trim() } }],
    },
  };

  if (author && author.trim()) {
    properties['作者'] = { select: { name: author.trim() } };
  }
  if (platform && platform.trim()) {
    properties['平台'] = { select: { name: platform.trim() } };
  }
  if (tags && tags.length > 0) {
    properties['类型'] = {
      multi_select: tags.filter(Boolean).map((t) => ({ name: t.trim() })),
    };
  }
  if (review && review.trim()) {
    properties['评价'] = {
      rich_text: [{ text: { content: review.trim() } }],
    };
  }

  await notion.pages.create({
    parent: { database_id: process.env.DATABASE_ID },
    properties,
  });

  return res.status(201).json({ success: true });
}

/**
 * 构建 Notion 复合筛选 filter
 * 多个条件使用 and 组合，单个条件直接返回，无条件返回 null
 */
function buildFilter(params) {
  const filters = [];

  if (params.search && params.search.trim()) {
    filters.push({
      property: '书名',
      title: { contains: params.search.trim() },
    });
  }
  if (params.author && params.author !== '全部') {
    filters.push({
      property: '作者',
      select: { equals: params.author },
    });
  }
  if (params.platform && params.platform !== '全部') {
    filters.push({
      property: '平台',
      select: { equals: params.platform },
    });
  }
  if (params.tag && params.tag !== '全部') {
    filters.push({
      property: '类型',
      multi_select: { contains: params.tag },
    });
  }

  if (filters.length === 0) return null;
  if (filters.length === 1) return filters[0];
  return { and: filters };
}

/**
 * 将 Notion page 转换为前端友好的格式
 */
function formatBook(page) {
  const props = page.properties;
  return {
    id: page.id,
    title: props['书名']?.title?.[0]?.plain_text || '未命名',
    author: props['作者']?.select?.name || '',
    platform: props['平台']?.select?.name || '',
    tags: props['类型']?.multi_select?.map((t) => t.name) || [],
    review: props['评价']?.rich_text?.[0]?.plain_text || '',
    url: page.url,
  };
}
