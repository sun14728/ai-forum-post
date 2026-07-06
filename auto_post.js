const https = require('https');
const http = require('http');
const fs = require('fs');
const TARGET_FIDS = (process.env.TARGET_FIDS || '3,4,5,6,7,8,9').split(',').map(x => Number(x.trim())).filter(Boolean);


const CONFIG = {
  forum: { url: 'http://vps6.ccwu.cc', apiKey: 'aiforum_auto_post_2026' },
  llm: {
    provider: 'sensenova', apiKey: 'sk-nBdpxGHlfjRAsVXtp1qADkPAdmNS6wT2',
    apiUrl: 'https://token.sensenova.cn/v1/chat/completions',
    model: 'sensenova-6.7-flash-lite', maxTokens: 2000,
  },
  postDelayMs: 15000, maxRetries: 3, retryDelayMs: 30000,
  logFile: __dirname + '/auto_post.log',
};

const BOARD_CONFIG = {
  3: {
    name: 'AI 热点资讯',
    prompt: '改写为每日AI行业新闻。聚焦: 最新AI产品发布、重大投融资、行业政策变化、大厂动态(OpenAI/Google/百度/字节/阿里/腾讯等)。包含事件概述、行业影响、关键数据。风格: 新闻资讯感，标题有吸引力，正文300-600字。',
    keywords: ['发布', '融资', '谷歌', 'openai', '百度', '字节', '阿里', '腾讯', 'gpt', '大模型', '芯片', '算力', '政策', '收购', '亿美元', 'anthropic', 'gemini', 'claude', 'deepseek', 'sora', '投资', '合作', '上线', '内测'],
    maxPosts: 2,
  },
  4: {
    name: 'AI 工具推荐',
    prompt: '改写为实用AI工具推荐帖。重点介绍: 工具名称和官网、核心功能、使用场景(写作/绘图/编程/视频/办公等)、是否免费、与同类工具对比。实用接地气，像给朋友安利好东西。列出具体使用步骤，正文300-600字。',
    keywords: ['工具', '插件', '推荐', '免费', '在线', '网站', 'app', 'chrome', '效率', '助手', 'notion', 'cursor', 'midjourney', 'canva', 'copilot', 'obsidian', 'vercel', 'producthunt'],
    maxPosts: 2,
  },
  5: {
    name: 'AI 编程实战',
    prompt: '改写为AI编程实战分享。聚焦: Prompt工程技巧(角色扮演/思维链/少样本等)、API调用实战(OpenAI/Claude/国产大模型接口)、开源项目介绍和使用教程、代码片段和踩坑记录。技术向干货有代码，给出具体代码示例，正文400-800字。',
    keywords: ['编程', '代码', 'prompt', 'api', '开发', 'python', '开源', 'github', '模型', '部署', '微调', 'rag', 'agent', 'llm', 'langchain', '调用', '接口', '报错', 'docker', 'pytorch', 'hugging'],
    maxPosts: 1,
  },
  6: {
    name: 'AI 漫剧制作教程',
    prompt: '改写为AI漫剧/短剧制作教程或AI生图/生视频工具介绍。聚焦: AI短剧制作方法(剧本生成/角色一致性/分镜制作)、AI生图工具(SD/ComfyUI/MJ/LoRA等)、AI生视频工具(可灵AI/即梦AI/Sora/Runway/Pika等)、工作流和实操步骤。必须给出具体工具名称、使用步骤或命令，教程式写法让新手能跟着做，正文400-800字。',
    keywords: ['漫剧', '短剧', 'ai生图', 'ai生视频', 'ai画', 'ai绘', 'stable diffusion', 'sd', 'comfyui', 'midjourney', 'mj', 'lora', '可灵', '即梦', 'sora', 'runway', 'pika', '文生图', '文生视频', '图生视频', '视频生成', '数字人', '换脸', 'cosyvoice', '海螺', '分镜', '剧本', '角色', 'flux', 'animate', 'kontext'],
    maxPosts: 2,
  },
  7: {
    name: '开发者讨论',
    prompt: '改写为开发者自由讨论帖。围绕AI开发实际问题: 开发中遇到的坑和解决方案、不同技术方案优劣对比、AI对开发者工作流的影响、对行业趋势的看法。提问讨论式，抛出观点引发互动，正文300-600字。',
    keywords: ['开发', '问题', '怎么', '如何', '请教', '讨论', '经验', '学习', '转行', '就业', '未来', '趋势', '思考', '对比', '选择', '求助', '有没有'],
    maxPosts: 1,
  },
  8: {
    name: '免费资源分享',
    prompt: '改写为免费AI资源分享帖。重点: 免费API额度和申请方式(DeepSeek/Gemini/Kimi等)、白嫖教程、开源模型推荐(下载地址和部署难度)、免费算力平台。干货满满，附链接和步骤，正文300-600字。',
    keywords: ['免费', '开源', '白嫖', 'api', '模型下载', '部署', 'huggingface', 'ollama', 'llamacpp', 'deepseek', 'qwen', 'kimi', '算力', '教程', '指南', '书籍', '论文', '数据集'],
    maxPosts: 1,
  },
  9: {
    name: 'GitHub AI 热门项目',
    prompt: '改写为GitHub上热门AI开源项目的中文介绍帖。必须包含: 项目名称和GitHub链接、一句话介绍(做什么的)、核心亮点(为什么火)、安装部署方法(git clone/pip install/docker等具体命令)、适用场景。面向开发者，部署步骤详细可执行，正文500-1000字。',
    keywords: ['github', '开源项目', 'star', 'trending', 'ai项目', '开源模型', 'llm', 'transformer', 'diffusion', 'agent', 'multimodal'],
    maxPosts: 2,
  },
};

const SOURCES = [
  { name: '36kr AI', url: 'https://36kr.com/information/AI/', baseUrl: 'https://36kr.com', parser: 'list36kr', boards: [3, 4, 5] },
  { name: '爱范儿AI', url: 'https://www.ifanr.com/feed', baseUrl: 'https://www.ifanr.com', parser: 'rss', boards: [3, 4, 5, 6] },
  { name: '量子位', url: 'https://www.qbitai.com/', baseUrl: 'https://www.qbitai.com', parser: 'list', boards: [3, 4, 5, 6] },
  { name: '雷克 AI', url: 'https://www.leiphone.com/category/ai', baseUrl: 'https://www.leiphone.com', parser: 'list', boards: [3, 4, 5] },
  { name: 'APPSO', url: 'https://www.ifanr.com/category_ai', baseUrl: 'https://www.ifanr.com', parser: 'list', boards: [3, 4] },
  { name: '宝玉AI', url: 'https://baoyu.io/', baseUrl: 'https://baoyu.io', parser: 'list', boards: [3, 5, 7] },
  { name: 'The Verge AI', url: 'https://www.theverge.com/ai-artificial-intelligence', baseUrl: 'https://www.theverge.com', parser: 'list', boards: [3] },
  { name: 'GitHub Blog', url: 'https://github.blog/feed/', baseUrl: 'https://github.blog', parser: 'rss', boards: [5, 7, 9] },
  { name: 'IT之家AI', url: 'https://www.ithome.com/tag/ai', baseUrl: 'https://www.ithome.com', parser: 'list', boards: [3, 4, 8] },
    { name: '掘金 AI', url: 'https://juejin.cn/tag/AI', baseUrl: 'https://juejin.cn', parser: 'list', boards: [4, 5, 7] },
  { name: 'InfoQ AI', url: 'https://www.infoq.cn/topic/AI', baseUrl: 'https://www.infoq.cn', parser: 'list', boards: [3, 5] },
  { name: '少数派', url: 'https://sspai.com/feed', baseUrl: 'https://sspai.com', parser: 'rss', boards: [4, 6] },
  { name: 'LiblibAI', url: 'https://liblib.art/', baseUrl: 'https://liblib.art', parser: 'list', boards: [6, 4] },
  { name: 'GitHub Trending AI', url: 'https://github.com/trending?since=daily', baseUrl: 'https://github.com', parser: 'github_trending', boards: [9, 5, 8] },
  { name: 'GitHub Topic LLM', url: 'https://github.com/topics/llm?o=desc&s=stars', baseUrl: 'https://github.com', parser: 'github_topic', boards: [9, 5, 8] },
  { name: 'GitHub Topic Diffusion', url: 'https://github.com/topics/diffusion?o=desc&s=stars', baseUrl: 'https://github.com', parser: 'github_topic', boards: [9, 6] },
  { name: 'GitHub Topic Agent', url: 'https://github.com/topics/ai-agent?o=desc&s=stars', baseUrl: 'https://github.com', parser: 'github_topic', boards: [9, 5] },
  { name: 'GitHub Topic Video', url: 'https://github.com/topics/text-to-video?o=desc&s=stars', baseUrl: 'https://github.com', parser: 'github_topic', boards: [9, 6] },
  { name: 'HuggingFace Daily', url: 'https://huggingface.co/papers', baseUrl: 'https://huggingface.co', parser: 'hf_papers', boards: [8, 5, 9] },
  { name: 'ProductHunt AI', url: 'https://www.producthunt.com/topics/artificial-intelligence', baseUrl: 'https://www.producthunt.com', parser: 'list', boards: [4, 8] },
];

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' }, headers || {}) }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('/') ? new URL(url).origin + res.headers.location : res.headers.location;
        return httpsGet(loc, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const httpMod = isHttps ? https : http;
    const opts = { hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: u.pathname + u.search, method: 'POST', headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers || {}) };
    const req = httpMod.request(opts, (res) => { let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(data)); });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}

function log(msg) {
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(ts + ' ' + msg);
  try { fs.appendFileSync(CONFIG.logFile, ts + ' ' + msg + String.fromCharCode(10)); } catch(e) {}
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sanitizeContent(text) {
  // Remove markdown links that can trigger WAF: [text](url)
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Remove raw URLs
  text = text.replace(/https?:\/\/[^\s]+/g, '');
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Limit length to 5000 chars
  if (text.length > 5000) text = text.substring(0, 5000) + '...';
  return text.trim();
}


function parseList(html, baseUrl) {
  const results = [];
  const seen = new Set();
  const re1 = new RegExp('<a[^>]*href="([^"]+)"[^>]*title="([^"]{8,80})"[^>]*>[^<]*</a>', 'gi');
  const re2 = new RegExp('<h[23][^>]*>[\\s\\S]*?<a[^>]*href="(/[^"]+)"[^>]*>([^<]{10,120})</a>', 'gi');
  const re3 = new RegExp('<a[^>]*href="(https?://[^"]+)"[^>]*>([\u4e00-\u9fffA-Za-z0-9 \u3001\uff08\uff09]{8,80})</a>', 'gi');
  let m;
  while ((m = re1.exec(html)) !== null) {
    const title = m[2].replace(/\\s+/g, " ").trim();
    let link = m[1];
    if (link.startsWith("/")) link = baseUrl + link;
    if (!link.startsWith("http") || title.length < 8 || seen.has(title)) continue;
    seen.add(title); results.push({ title, link });
  }
  while ((m = re2.exec(html)) !== null) {
    const title = m[2].replace(/\\s+/g, " ").trim();
    let link = baseUrl + m[1];
    if (!link.startsWith("http") || title.length < 8 || seen.has(title)) continue;
    seen.add(title); results.push({ title, link });
  }
  while ((m = re3.exec(html)) !== null) {
    const title = m[2].replace(/\\s+/g, " ").trim();
    const link = m[1];
    if (title.length < 8 || seen.has(title)) continue;
    seen.add(title); results.push({ title, link });
  }
  return results;
}

function parseV2EX(html, baseUrl) {
  const results = [];
  const seen = new Set();
  const re = new RegExp('<span[^>]*class="[^"]*item_title[^"]*"[^>]*><a[^>]*href="(/t/\\d+)"[^>]*>([^<]+)</a>', 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = m[2].trim();
    if (title.length < 5 || seen.has(title)) continue;
    seen.add(title);
    results.push({ title, link: baseUrl + m[1] });
  }
  return results;
}

function parseGitHubTrending(html) {
  const results = [];
  const seen = new Set();
  const re = new RegExp('<h2[^>]*class="[^"]*lh-condensed[^"]*"[^>]*>\\s*<a[^>]*href="(/[^"]+)"[^>]*>\\s*([^\\s<]+)\\s*/\\s*([^\\s<]+)', 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    const repo = (m[2] + "/" + m[3]).replace(/\s+/g, " ");
    if (seen.has(repo)) continue;
    seen.add(repo);
    results.push({ title: repo, link: "https://github.com" + m[1] });
  }
  return results;
}

function parseGitHubTopic(html) {
  const results = [];
  const seen = new Set();
  const re = new RegExp('<h3[^>]*>\\s*<a[^>]*href="(/[^"]+)"[^>]*class="[^"]*Link[^"]*"[^>]*>([^<]+?)</a>', 'gis');
  let m;
  while ((m = re.exec(html)) !== null) {
    const repo = m[2].trim().replace(/\s+/g, " ");
    if (seen.has(repo) || repo.length < 3) continue;
    seen.add(repo);
    results.push({ title: repo, link: "https://github.com" + m[1] });
  }
  return results;
}

function parseHFPapers(html) {
  const results = [];
  const seen = new Set();
  const re = new RegExp('<a[^>]*href="(/papers/\\d+\\.\\d+)"[^>]*>\\s*<[^>]+>([^<]{20,150})</[^>]+>', 'gi');
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = m[2].trim();
    if (seen.has(title)) continue;
    seen.add(title);
    results.push({ title, link: "https://huggingface.co" + m[1] });
  }
  return results;
}
function parse36krState(html) {
  const results = [];
  const seen = new Set();
  const startMarker = 'window.initialState=';
  const startIdx = html.indexOf(startMarker);
  if (startIdx < 0) return results;
  const jsonStart = startIdx + startMarker.length;
  let depth = 0, endIdx = jsonStart;
  for (let i = jsonStart; i < html.length && i < jsonStart + 100000; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') depth--;
    if (depth === 0) { endIdx = i + 1; break; }
  }
  try {
    const state = JSON.parse(html.substring(jsonStart, endIdx));
    const itemList = state && state.information && state.information.informationList && state.information.informationList.itemList;
    if (!itemList || !Array.isArray(itemList)) return results;
    for (const item of itemList) {
      const title = (item.templateMaterial && item.templateMaterial.widgetTitle) || item.widgetTitle || '';
      const itemId = item.itemId || '';
      if (title.length < 5 || seen.has(title)) continue;
      seen.add(title);
      results.push({ title, link: 'https://36kr.com/p/' + itemId });
    }
  } catch(e) {}
  return results;
}

function parseRSS(xml) {
  const results = [];
  const seen = new Set();
  const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const title = m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+/g, ' ').trim();
    const link = m[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if (title.length < 5 || seen.has(title)) continue;
    seen.add(title);
    results.push({ title, link });
  }
  return results;
}

function normalizeTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function scoreForBoard(article, fid) {
  const bc = BOARD_CONFIG[fid];
  const t = (article.title + ' ' + (article.link || '')).toLowerCase();
  let score = 0;
  for (const k of bc.keywords) {
    if (t.includes(k.toLowerCase())) score += 2;
  }
  if (fid === 6 && /(diffusion|comfyui|lora|video|image|pika|runway|sora|flux|mj|midjourney|可灵|即梦|生图|生视频|视频|绘图|角色|分镜)/i.test(t)) score += 6;
  if (fid === 7 && /(developer|workflow|coding|vibe|开发|问题|讨论|经验|趋势|选择|对比)/i.test(t)) score += 5;
  if (fid === 8 && /(free|open source|huggingface|ollama|resource|dataset|paper|免费|开源|资源|算力|额度|白嫖)/i.test(t)) score += 5;
  if (fid === 9 && article.isGitHub) score += 8;
  return score;
}

function buildBoardQueues(articles) {
  const boardQueues = {};
  for (let i = 3; i <= 9; i++) boardQueues[i] = [];
  for (const art of articles) {
    for (const src of SOURCES) {
      if (art.link.startsWith(src.baseUrl)) {
        for (const fid of src.boards) {
          if (boardQueues[fid]) boardQueues[fid].push(Object.assign({}, art, { boardScore: scoreForBoard(art, fid) }));
        }
        break;
      }
    }
  }
  for (const fid of Object.keys(boardQueues)) boardQueues[fid].sort((a, b) => b.boardScore - a.boardScore);
  return boardQueues;
}

async function fetchArticles() {
  const allArticles = [];
  const seen = new Set();
  for (const src of SOURCES) {
    if (!src.boards.some(fid => TARGET_FIDS.includes(fid))) continue;

    try {
      const html = await httpsGet(src.url);
      let articles = [];
      switch (src.parser) {
        case 'v2ex': articles = parseV2EX(html, src.baseUrl); break;
        case 'github_trending': articles = parseGitHubTrending(html); break;
        case 'github_topic': articles = parseGitHubTopic(html); break;
        case 'hf_papers': articles = parseHFPapers(html); break;
        case 'list36kr': articles = parse36krState(html); break;
        case 'rss': articles = parseRSS(html); break;
        default: articles = parseList(html, src.baseUrl);
      }
      for (const art of articles) {
        if (seen.has(art.title)) continue;
        seen.add(art.title);
        allArticles.push(Object.assign({}, art, { isGitHub: art.link.includes('github.com/') }));
      }


      log('Fetch: ' + src.name + ' (' + articles.length + ')');
    } catch(e) {
      log('Fetch failed: ' + src.name + ' - ' + e.message);
    }
  }
  return allArticles;
}

async function rewriteWithAI(article, boardPrompt, isGitHub) {
  let readmeContent = '';
  const isGH = isGitHub || article.link.includes('/trending') || article.link.includes('/topics/');
  if (isGH) {
    try {
      const parts = article.link.replace('https://github.com/', '').split('/');
      if (parts.length >= 2) {
        const readmeUrl = 'https://raw.githubusercontent.com/' + parts[0] + '/' + parts[1] + '/main/README.md';
        const readmeHtml = await httpsGet(readmeUrl);
        readmeContent = readmeHtml.replace(/[|^$`]/g, " ").replace(/\s+/g, " ").trim().substring(0, 1500);
      }
    } catch(e) {}
  }
  let prompt;
  if (isGH) {
    prompt = '你是一个GitHub开源项目的中文介绍作者。写一篇介绍帖。' + 
      '项目: ' + article.link + ' 名称: ' + article.title + ' readme: ' + (readmeContent || '无') + ' ' + boardPrompt + 
      ' 标题格式: 【开源推荐】xxx。给出git clone等命令。输出JSON:{title,content}';
  } else {
    prompt = '改写为论坛帖子。' + boardPrompt + ' 标题:' + article.title + ' 链接:' + article.link + ' 输出JSON:{title,content}';
  }
  try {
    const payload = JSON.stringify({ model: CONFIG.llm.model, messages: [{ role: 'system', content: '你是AI内容创作者，输出JSON。' }, { role: 'user', content: prompt }], max_tokens: CONFIG.llm.maxTokens, temperature: 0.7 });
    const resText = await httpsPost(CONFIG.llm.apiUrl, payload, { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.llm.apiKey });
    const result = JSON.parse(resText);
    let text;
    if (result.choices && result.choices[0]) { text = result.choices[0].message.content || result.choices[0].reasoning || ''; }
    else if (result.output) { text = result.output.text; }
    else { throw new Error('No content'); }
    const jsonMatch = text.match(/{[\s\S]*"title"[\s\S]*"content"[\s\S]*}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { title: article.title, content: text };
  } catch(e) {
    log('AI failed: ' + e.message);
    return null;
  }
}

async function postToForum(title, content, fid) {
  const postData = 'api_key=' + encodeURIComponent(CONFIG.forum.apiKey) + '&title=' + encodeURIComponent(title) + '&content=' + encodeURIComponent(content) + '&fid=' + fid;
  for (let i = 0; i < CONFIG.maxRetries; i++) {
    try {
      const resText = await httpsPost(CONFIG.forum.url + '/api_post.php', postData, { 'Content-Type': 'application/x-www-form-urlencoded' });
      return JSON.parse(resText);
    } catch(e) {
      if (i < CONFIG.maxRetries - 1) { await sleep(CONFIG.retryDelayMs); }
      else { log('Post failed: ' + e.message); return null; }
    }
  }
}

async function main() {
  log('========== AI Auto Post ==========');
  const articles = await fetchArticles();
  log('Total: ' + articles.length);
  if (articles.length === 0) { log('No articles'); return; }

  const postedTitles = new Set();
  try {
    for (let f = 3; f <= 9; f++) {
      const resp = await httpsGet(CONFIG.forum.url + '/api_threads.php?fid=' + f + '&limit=100');
      const data = JSON.parse(resp);
      if (data.code === 0 && data.threads) {
        for (const t of data.threads) postedTitles.add(normalizeTitle(t.subject));
      }
    }
    log('Posted titles loaded: ' + postedTitles.size);
  } catch(e) { log('Dedup load failed: ' + e.message); }
  const newArticles = articles.filter(a => !postedTitles.has(normalizeTitle(a.title)));
  log('New: ' + newArticles.length);

  const boardQueues = buildBoardQueues(newArticles);
  const usedArticleKeys = new Set();

  let totalOk = 0;
  for (const fid of TARGET_FIDS) {
    const bc = BOARD_CONFIG[fid];
    if (!bc || bc.maxPosts <= 0) continue;
    const queue = boardQueues[fid] || [];
    log('F' + fid + ' ' + bc.name + ': ' + queue.length + ' queued');


    let posted = 0;
    for (const art of queue) {
      if (posted >= bc.maxPosts) break;
      const key = normalizeTitle(art.title);
      if (usedArticleKeys.has(key)) continue;
      log('  ' + art.title + ' [score=' + art.boardScore + ']');
      const rewritten = await rewriteWithAI(art, bc.prompt, fid === 9);

      if (!rewritten) { log('    AI failed'); continue; }
      if (rewritten.content.length < 200) { log('    too short'); continue; }
      await sleep(CONFIG.postDelayMs);
      const result = await postToForum(rewritten.title, sanitizeContent(rewritten.content), fid);
      if (result && result.code === 0) {
        log('    OK! tid=' + result.tid + ' "' + rewritten.title + '"');
        usedArticleKeys.add(key);
        posted++; totalOk++;

        log('    failed: ' + JSON.stringify(result));
      }
    }
  }
  log('DONE: ' + totalOk + ' posts');
}

main().catch(e => log('Fatal: ' + e.message));
