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
    if (req.method === 'GET' && action === 'recommend') {
      return await handleRecommend(req, res);
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

/**
 * 处理网页搜索推荐
 * GET /api/notion?action=recommend&tag=xxx
 */
async function handleRecommend(req, res) {
  const tag = req.query.tag || '';
  if (!tag) return res.status(400).json({ error: '缺少 tag 参数' });

  try {
    // 构造查询：使用 tag 并加上高分、神作等关键词，同时优先搜索起点和番茄
    const query = `${tag} 经典小说 必看 神作 豆瓣高分 site:qidian.com OR site:fanqienovel.com`;
    
    // 使用 DuckDuckGo Lite 进行无头搜索
    const ddgRes = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: `q=${encodeURIComponent(query)}`
    });

    if (!ddgRes.ok) {
      throw new Error('网页搜索失败');
    }

    const html = await ddgRes.text();
    const results = [];
    
    // 从 DuckDuckGo Lite 结果中提取标题和链接
    // DDG Lite 的结果通常形如：<a class="result-snippet" href="...">...</a>
    // 或者 <a rel="nofollow" href="...">Title</a>
    const regex = /<a[^>]*class="result-snippet"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>|<a rel="nofollow" href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    let match;
    let count = 0;
    const maxResults = 2; // 只取前两个结果
    
    // 由于正则是全局匹配并且有两组可能的捕获组，我们需要处理它
    const simplifiedRegex = /<a[^>]*href="([^"]+)"[^>]*rel="nofollow"[^>]*>(.*?)<\/a>|<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    
    // 更简单的通用提取方式：寻找 table class="result-results" 中的链接
    const linkRegex = /<td class='result-snippet[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
    
    while ((match = simplifiedRegex.exec(html)) !== null && count < maxResults) {
      let url = match[1] || match[3];
      let title = match[2] || match[4];
      
      if (!url || !title) continue;

      // 如果有 uddg 参数（DDG 的跳转链接），解析出原始链接
      if (url.includes('uddg=')) {
        try {
          const uddgMatch = url.match(/uddg=([^&]+)/);
          if (uddgMatch) {
            url = decodeURIComponent(uddgMatch[1]);
          }
        } catch(e) {}
      } else if (url.startsWith('//')) {
        url = 'https:' + url;
      }

      // 去除标题中可能包含的 HTML 标签（如 <b>）
      title = title.replace(/<\/?[^>]+(>|$)/g, "");
      title = decodeHTMLEntities(title);

      if (title.trim() && url.trim() && (url.includes('qidian.com') || url.includes('fanqienovel.com'))) {
        results.push({ title: title.trim(), url: url.trim() });
        count++;
      }
    }

    // 如果上面针对 site 的没匹配到，可以放宽条件再匹配一次
    if (results.length === 0) {
      const fallbackRegex = /<a rel="nofollow" href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
      count = 0;
      while ((match = fallbackRegex.exec(html)) !== null && count < maxResults) {
        let url = match[1];
        let title = match[2];
        if (url.includes('uddg=')) {
          try {
            const uddgMatch = url.match(/uddg=([^&]+)/);
            if (uddgMatch) {
              url = decodeURIComponent(uddgMatch[1]);
            }
          } catch(e) {}
        }
        title = title.replace(/<\/?[^>]+(>|$)/g, "");
        title = decodeHTMLEntities(title);
        results.push({ title: title.trim(), url: url.trim() });
        count++;
      }
    }

    // 如果仍然没有结果（可能是触发了防爬虫验证码），直接抛出错误触发前端降级显示搜索链接
    if (results.length === 0) {
      throw new Error('未找到推荐结果或被防爬虫拦截');
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error('Recommend Error:', err);
    return res.status(500).json({ error: '网页推荐失败' });
  }
}

function decodeHTMLEntities(text) {
  return text.replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'")
             .replace(/&#x27;/g, "'");
}
