const fs = require('fs');
const tag = '多女主';
const query = tag + ' 经典小说 必看 神作 豆瓣高分 site:qidian.com OR site:fanqienovel.com';

fetch('https://www.bing.com/search?q=' + encodeURIComponent(query), {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
}).then(res => res.text()).then(html => {
  fs.writeFileSync('bing_output.html', html);
  console.log('Bing HTML Length:', html.length);
  const titleRegex = /<h2><a href="([^"]+)"[^>]*>(.*?)<\/a><\/h2>/gi;
  let match;
  while ((match = titleRegex.exec(html)) !== null) {
    console.log('Bing Match:', match[1], match[2]);
  }
});
