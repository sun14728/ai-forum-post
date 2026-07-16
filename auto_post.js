const https = require('https');
const http = require('http');
const fs = require('fs');

const TARGET_FIDS = (process.env.TARGET_FIDS || '3,4,5,6,7,8,9')
  .split(',')
  .map(x => Number(x.trim()))
  .filter(Boolean);

// 垂直板块最低匹配分：宁可少发，不发无关内容
const MIN_BOARD_SCORE = { 6: 4, 7: 4, 8: 4, 9: 0 };

const CONFIG = {
  forum: { url: 'http://vps6.ccwu.cc', apiKey: 'aiforum_auto_post_2026' },
  llm: {
    provider: 'sensenova',
    apiKey: 'sk-nBdpxGHlfjRAsVXtp1qADkPAdmNS6wT2',
    apiUrl: 'https://token.sensenova.cn/v1/chat/completions',
    model: 'sensenova-6.7-flash-lite',
    maxTokens: 1600,
  },
  postDelayMs: 3000,
  maxRetries: 1,
  retryDelayMs: 5000,
  requestTimeoutMs: 20000,
  maxArticlesPerSource: 8,
  maxAttemptsPerBoard: 4,
  maxConsecutiveAiFails: 3,
  maxTotalAiAttempts: 24,
  logFile: __dirname + '/auto_post.log',
};

const BOARD_CONFIG = {
  3: {
    name: 'AI 热点资讯',
    prompt: '改写为每日AI行业新闻。聚焦最新AI产品发布、重大投融资、行业政策变化、大厂动态。包含事件概述、行业影响、关键数据。风格新闻资讯感，正文300-600字。',
    keywords: ['发布', '融资', '谷歌', 'openai', '百度', '字节', '阿里', '腾讯', 'gpt', '大模型', '芯片', '算力', '政策', '收购', '亿美元', 'anthropic', 'gemini', 'claude', 'deepseek', 'sora', '投资', '合作', '上线', '内测'],
    maxPosts: 2,
  },
  4: {
    name: 'AI 工具推荐',
    prompt: '改写为实用AI工具推荐帖。介绍工具名称、核心功能、使用场景、是否免费、同类对比和具体使用步骤。风格像给朋友安利好东西，正文300-600字。',
    keywords: ['工具', '插件', '推荐', '免费', '在线', '网站', 'app', 'chrome', '效率', '助手', 'notion', 'cursor', 'midjourney', 'canva', 'copilot', 'obsidian', 'producthunt'],
    maxPosts: 2,
  },
  5: {
    name: 'AI 编程实战',
    prompt: '改写为AI编程实战分享。聚焦Prompt工程、API调用、开源项目、代码片段、部署和踩坑记录。技术向干货，正文400-800字。',
    keywords: ['编程', '代码', 'prompt', 'api', '开发', 'python', '开源', 'github', '模型', '部署', '微调', 'rag', 'agent', 'llm', 'langchain', '调用', '接口', '报错', 'docker', 'pytorch', 'hugging'],
    maxPosts: 1,
  },
  6: {
    name: 'AI 漫剧教程',
    prompt: '改写为AI漫剧/短剧制作教程或AI生图生视频工具介绍。聚焦剧本生成、角色一致性、分镜制作、Stable Diffusion、ComfyUI、Midjourney、LoRA、可灵、即梦、Runway、Pika等。必须给出工具名称和实操步骤，正文400-800字。',
    keywords: ['漫剧', '短剧', 'ai生图', 'ai生视频', 'ai画', 'ai绘', 'stable diffusion', 'sd', 'comfyui', 'midjourney', 'mj', 'lora', '可灵', '即梦', 'sora', 'runway', 'pika', '文生图', '文生视频', '图生视频', '视频生成', '数字人', '换脸', '海螺', '分镜', '剧本', '角色', 'flux', 'diffusion'],
    maxPosts: 2,
  },
  7: {
    name: '开发者讨论',
    prompt: '改写为开发者自由讨论帖。围绕AI开发实际问题、踩坑、方案对比、AI对开发者工作流影响和行业趋势。提问讨论式，抛出观点引发互动，正文300-600字。',
    keywords: ['开发', '问题', '怎么', '如何', '请教', '讨论', '经验', '学习', '转行', '就业', '未来', '趋势', '思考', '对比', '选择', '求助', '有没有', 'workflow', 'vibe'],
    maxPosts: 1,
  },
  8: {
    name: '免费资源分享',
    prompt: '改写为免费AI资源分享帖。重点免费API额度、申请方式、白嫖教程、开源模型、下载部署、免费算力平台。干货满满，附步骤，正文300-600字。',
    keywords: ['免费', '开源', '白嫖', 'api', '模型下载', '部署', 'huggingface', 'ollama', 'llamacpp', 'deepseek', 'qwen', 'kimi', '算力', '教程', '指南', '书籍', '论文', '数据集', '资源'],
    maxPosts: 1,
  },
  9: {
    name: 'GitHub AI 项目',
    prompt: '改写为GitHub热门AI开源项目中文介绍帖。必须包含项目名称和GitHub链接、一句话介绍、核心亮点、安装部署命令、适用场景。面向开发者，正文500-1000字。',
    keywords: ['github', '开源项目', 'star', 'trending', 'ai项目', '开源模型', 'llm', 'transformer', 'diffusion', 'agent', 'multimodal'],
    maxPosts: 2,
  },
};

const SOURCES = [
  { name: '36kr AI', url: 'https://36kr.com/information/AI/', baseUrl: 'https://36kr.com', parser: 'list36kr', boards: [3, 4, 5] },
  { name: '爱范儿AI', url: 'https://www.ifanr.com/feed', baseUrl: 'https://www.ifanr.com', parser: 'rss', boards: [3, 4, 5, 6] },
  { name: '量子位', url: 'https://www.qbitai.com/', baseUrl: 'https://www.qbitai.com', parser: 'list', boards: [3, 4, 5, 6, 7] },
  { name: '雷克 AI', url: 'https://www.leiphone.com/category/ai', baseUrl: 'https://www.leiphone.com', parser: 'list', boards: [3, 4, 5, 7] },
  { name: 'APPSO', url: 'https://www.ifanr.com/category_ai', baseUrl: 'https://www.ifanr.com', parser: 'list', boards: [3, 4, 8] },
  { name: '宝玉AI', url: 'https://baoyu.io/', baseUrl: 'https://baoyu.io', parser: 'list', boards: [3, 5, 7] },
  { name: 'The Verge AI', url: 'https://www.theverge.com/ai-artificial-intelligence', baseUrl: 'https://www.theverge.com', parser: 'list', boards: [3, 7] },
  { name: 'GitHub Blog', url: 'https://github.blog/feed/', baseUrl: 'https://github.blog', parser: 'rss', boards: [5, 7, 9] },
  { name: 'IT之家AI', url: 'https://www.ithome.com/tag/ai', baseUrl: 'https://www.ithome.com', parser: 'list', boards: [3, 4, 8] },
  { name: 'InfoQ AI', url: 'https://www.infoq.cn/topic/AI', baseUrl: 'https://www.infoq.cn', parser: 'list', boards: [3, 5, 7] },
  { name: '少数派', url: 'https://sspai.com/feed', baseUrl: 'https://sspai.com', parser: 'rss', boards: [4, 6, 8] },
  { name: 'LiblibAI', url: 'https://liblib.art/', baseUrl: 'https://liblib.art', parser: 'list', boards: [6, 4] },
  { name: 'GitHub Trending AI', url: 'https://github.com/trending?since=daily', baseUrl: 'https://github.com', parser: 'github_trending', boards: [9, 5, 8] },
  { name: 'GitHub Topic LLM', url: 'https://github.com/topics/llm?o=desc&s=stars', baseUrl: 'https://github.com', parser: 'github_topic', boards: [9, 5, 8, 7] },
  { name: 'GitHub Topic Diffusion', url: 'https://github.com/topics/diffusion?o=desc&s=stars', baseUrl: 'https://github.com', parser: 'github_topic', boards: [9, 6] },
  { name: 'GitHub Topic Video', url: 'https://github.com/topics/text-to-video?o=desc&s=stars', baseUrl: 'https://github.com', parser: 'github_topic', boards: [9, 6] },
  { name: 'HuggingFace Daily', url: 'https://huggingface.co/papers', baseUrl: 'https://huggingface.co', parser: 'hf_papers', boards: [8, 5, 9] },
  { name: 'ProductHunt AI', url: 'https://www.producthunt.com/topics/artificial-intelligence', baseUrl: 'https://www.producthunt.com', parser: 'list', boards: [4, 8] },
];

function log(msg) {
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(ts + ' ' + msg);
  try { fs.appendFileSync(CONFIG.logFile, ts + ' ' + msg + '\n'); } catch (e) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      }, headers || {})
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('/') ? new URL(url).origin + res.headers.location : res.headers.location;
        return httpsGet(loc, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(CONFIG.requestTimeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const httpMod = isHttps ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers || {})
    };
    const req = httpMod.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(CONFIG.requestTimeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function sanitizeContent(text) {
  text = String(text || '');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/https?:\/\/[^\s]+/g, '');
  text = text.replace(/<[^>]+>/g, '');
  if (text.length > 5000) text = text.substring(0, 5000) + '...';
  return text.trim();
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function normalizeTitle(title) {
  return decodeEntities(title).replace(/[\s\-—_|]+/g, ' ').trim().toLowerCase();
}

function parseList(html, baseUrl) {
  const results = [];
  const seen = new Set();
  const regexes = [
    /<a[^>]*href=["']([^"']+)["'][^>]*title=["']([^"']{8,120})["'][^>]*>/gi,
    /<h[123][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{8,180}?)<\/a>/gi,
    /<a[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([^<]{8,120})<\/a>/gi,
  ];
  for (const re of regexes) {
    let m;
    while ((m = re.exec(html)) !== null) {
      let link = m[1];
      const title = decodeEntities(m[2].replace(/<[^>]+>/g, ' '));
      if (link.startsWith('/')) link = baseUrl + link;
      if (!link.startsWith('http') || title.length < 8 || title.length > 120 || seen.has(title)) continue;
      seen.add(title);
      results.push({ title, link });
    }
  }
  return results;
}

function parseGitHubTrending(html) {
  const results = [];
  const seen = new Set();
  const re = /<h2[^>]*class="[^"]*lh-condensed[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>\s*([^\s<]+)\s*\/\s*([^\s<]+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const repo = (m[2] + '/' + m[3]).replace(/\s+/g, '');
    if (seen.has(repo)) continue;
    seen.add(repo);
    results.push({ title: repo, link: 'https://github.com' + m[1], isGitHub: true });
  }
  return results;
}

function parseGitHubTopic(html) {
  const results = [];
  const seen = new Set();
  const re = /<h3[^>]*>[\s\S]*?<a[^>]*href="(\/[^"]+)"[^>]*class="[^"]*Link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const repo = decodeEntities(m[2].replace(/<[^>]+>/g, ' '));
    if (seen.has(repo) || repo.length < 3) continue;
    seen.add(repo);
    results.push({ title: repo, link: 'https://github.com' + m[1], isGitHub: true });
  }
  return results;
}

function parseHFPapers(html) {
  const results = [];
  const seen = new Set();
  const re = /<a[^>]*href="(\/papers\/\d+\.\d+)"[^>]*>[\s\S]*?<[^>]+>([^<]{20,150})<\/[^>]+>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = decodeEntities(m[2]);
    if (seen.has(title)) continue;
    seen.add(title);
    results.push({ title, link: 'https://huggingface.co' + m[1] });
  }
  return results;
}

function parse36krState(html) {
  const results = [];
  const seen = new Set();
  const marker = 'window.initialState=';
  const startIdx = html.indexOf(marker);
  if (startIdx < 0) return parseList(html, 'https://36kr.com');
  const jsonStart = startIdx + marker.length;
  let depth = 0, endIdx = jsonStart;
  for (let i = jsonStart; i < html.length && i < jsonStart + 200000; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') depth--;
    if (depth === 0) { endIdx = i + 1; break; }
  }
  try {
    const state = JSON.parse(html.substring(jsonStart, endIdx));
    const list = state && state.information && state.information.informationList && state.information.informationList.itemList;
    if (Array.isArray(list)) {
      for (const item of list) {
        const title = decodeEntities((item.templateMaterial && item.templateMaterial.widgetTitle) || item.widgetTitle || '');
        const itemId = item.itemId || item.id || '';
        if (title.length < 5 || seen.has(title)) continue;
        seen.add(title);
        results.push({ title, link: 'https://36kr.com/p/' + itemId });
      }
    }
  } catch (e) {}
  return results;
}

function parseRSS(xml) {
  const results = [];
  const seen = new Set();
  const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const title = decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, ''));
    const link = decodeEntities(m[2].replace(/<!\[CDATA\[|\]\]>/g, ''));
    if (title.length < 5 || seen.has(title)) continue;
    seen.add(title);
    results.push({ title, link });
  }
  return results;
}

function scoreForBoard(article, fid) {
  const bc = BOARD_CONFIG[fid];
  const t = (article.title + ' ' + (article.link || '')).toLowerCase();
  let score = 0;
  for (const k of bc.keywords) {
    if (t.includes(k.toLowerCase())) score += 2;
  }
  if (fid === 6 && /(diffusion|stable.?diffusion|comfyui|lora|video|image|pika|runway|sora|flux|mj|midjourney|可灵|即梦|生图|生视频|文生图|文生视频|图生视频|视频生成|绘图|角色|分镜|漫剧|短剧|ai画|ai绘)/i.test(t)) score += 6;
  if (fid === 7 && /(developer|workflow|coding|vibe|prompt|api|agent|开发者|开发|编程|代码|问题|讨论|经验|趋势|选择|对比|踩坑|架构|部署)/i.test(t)) score += 5;
  if (fid === 8 && /(free|open source|huggingface|ollama|resource|dataset|paper|model|api|免费|开源|资源|算力|额度|白嫖|模型|教程|指南|论文|数据集)/i.test(t)) score += 5;
  if (fid === 7 && /^[a-z0-9\s:,'\-]+$/i.test(article.title) && !/(ai|llm|gpt|api|agent|code|developer|github|model|prompt|workflow)/i.test(article.title)) score -= 6;
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
          const score = scoreForBoard(art, fid);
          if (boardQueues[fid] && score >= (MIN_BOARD_SCORE[fid] || 0)) {
            boardQueues[fid].push(Object.assign({}, art, { boardScore: score }));
          }
        }
        break;
      }
    }
  }
  for (const fid of Object.keys(boardQueues)) {
    boardQueues[fid].sort((a, b) => b.boardScore - a.boardScore);
  }
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
        case 'github_trending': articles = parseGitHubTrending(html); break;
        case 'github_topic': articles = parseGitHubTopic(html); break;
        case 'hf_papers': articles = parseHFPapers(html); break;
        case 'list36kr': articles = parse36krState(html); break;
        case 'rss': articles = parseRSS(html); break;
        default: articles = parseList(html, src.baseUrl);
      }
      articles = articles.slice(0, CONFIG.maxArticlesPerSource).map(a => Object.assign({}, a, {
        source: src.name,
        sourceBoards: src.boards,
        isGitHub: a.isGitHub || a.link.includes('github.com/')
      }));
      for (const art of articles) {
        const key = normalizeTitle(art.title);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        allArticles.push(art);
      }
      log('Fetch: ' + src.name + ' (' + articles.length + ')');
    } catch (e) {
      log('Fetch failed: ' + src.name + ' - ' + e.message);
    }
  }
  return allArticles;
}

async function loadPostedTitles() {
  const posted = new Set();
  try {
    for (let f = 3; f <= 9; f++) {
      const resp = await httpsGet(CONFIG.forum.url + '/api_threads.php?fid=' + f + '&limit=80');
      const data = JSON.parse(resp);
      if (data.code === 0 && data.threads) {
        for (const t of data.threads) posted.add(normalizeTitle(t.subject));
      }
    }
    log('Posted titles loaded: ' + posted.size);
  } catch (e) {
    log('Dedup load failed: ' + e.message);
  }
  return posted;
}

async function rewriteWithAI(article, boardPrompt, fid) {
  let readmeContent = '';
  const isGH = article.isGitHub || article.link.includes('github.com/');
  if (isGH) {
    try {
      const parts = article.link.replace('https://github.com/', '').split('/');
      if (parts.length >= 2) {
        const raw = 'https://raw.githubusercontent.com/' + parts[0] + '/' + parts[1] + '/main/README.md';
        readmeContent = (await httpsGet(raw)).replace(/[|^$`]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1200);
      }
    } catch (e) {}
  }

  const prompt = (isGH
    ? '你是GitHub开源项目中文介绍作者。项目地址: ' + article.link + '\n项目名称: ' + article.title + '\nREADME摘要: ' + (readmeContent || '暂无') + '\n'
    : '请根据以下信息改写为论坛帖子。原文标题: ' + article.title + '\n原文链接: ' + article.link + '\n') +
    '\n目标板块: ' + BOARD_CONFIG[fid].name + '\n' + boardPrompt +
    '\n要求: 标题不超过50字；正文有小标题/列表；内容必须贴合目标板块；不要编造无法确认的数据；输出严格JSON: {"title":"新标题","content":"正文"}';

  try {
    const payload = JSON.stringify({
      model: CONFIG.llm.model,
      messages: [
        { role: 'system', content: '你是AI技术社区内容作者，只输出有效JSON。' },
        { role: 'user', content: prompt }
      ],
      max_tokens: CONFIG.llm.maxTokens,
      temperature: 0.7
    });
    const resText = await httpsPost(CONFIG.llm.apiUrl, payload, {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CONFIG.llm.apiKey
    });
    const result = JSON.parse(resText);
    let text = '';
    if (result.choices && result.choices[0]) text = result.choices[0].message.content || result.choices[0].reasoning || '';
    else if (result.output) text = result.output.text || '';
    else throw new Error('No content');
    const jsonMatch = text.match(/\{[\s\S]*"title"[\s\S]*"content"[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { title: article.title, content: text };
  } catch (e) {
    log('AI failed: ' + e.message);
    return null;
  }
}

async function postToForum(title, content, fid) {
  const postData = 'api_key=' + encodeURIComponent(CONFIG.forum.apiKey) +
    '&title=' + encodeURIComponent(title) +
    '&content=' + encodeURIComponent(content) +
    '&fid=' + fid;
  for (let i = 0; i < CONFIG.maxRetries; i++) {
    try {
      const resText = await httpsPost(CONFIG.forum.url + '/api_post.php', postData, {
        'Content-Type': 'application/x-www-form-urlencoded'
      });
      return JSON.parse(resText);
    } catch (e) {
      if (i < CONFIG.maxRetries - 1) await sleep(CONFIG.retryDelayMs);
      else {
        log('Post failed: ' + e.message);
        return null;
      }
    }
  }
}

async function main() {
  log('========== AI Forum Auto Post ==========');
  const articles = await fetchArticles();
  log('Total: ' + articles.length);
  if (articles.length === 0) return;

  const postedTitles = await loadPostedTitles();
  const newArticles = articles.filter(a => !postedTitles.has(normalizeTitle(a.title)));
  log('New: ' + newArticles.length);

  const boardQueues = buildBoardQueues(newArticles);
  const usedArticleKeys = new Set();
  let totalOk = 0;
  let totalAiAttempts = 0;
  let consecutiveAiFails = 0;

  for (const fid of TARGET_FIDS) {
    const bc = BOARD_CONFIG[fid];
    if (!bc || bc.maxPosts <= 0) continue;
    const queue = boardQueues[fid] || [];
    log('F' + fid + ' ' + bc.name + ': ' + queue.length + ' queued');

    let posted = 0;
    let attempts = 0;
    for (const art of queue) {
      if (posted >= bc.maxPosts) break;
      if (attempts >= CONFIG.maxAttemptsPerBoard) {
        log('  stop board: max attempts reached');
        break;
      }
      if (totalAiAttempts >= CONFIG.maxTotalAiAttempts) {
        log('  stop all: max total AI attempts reached');
        break;
      }
      if (consecutiveAiFails >= CONFIG.maxConsecutiveAiFails) {
        log('  stop all: consecutive AI failures');
        break;
      }

      const key = normalizeTitle(art.title);
      if (usedArticleKeys.has(key)) continue;

      attempts++;
      totalAiAttempts++;
      log('  ' + art.title + ' [score=' + art.boardScore + ', source=' + (art.source || '?') + ']');
      const rewritten = await rewriteWithAI(art, bc.prompt, fid);
      if (!rewritten || !rewritten.content || rewritten.content.length < 180) {
        consecutiveAiFails++;
        log('    skip: rewrite failed/too short (fail streak=' + consecutiveAiFails + ')');
        continue;
      }

      consecutiveAiFails = 0;
      await sleep(CONFIG.postDelayMs);
      const result = await postToForum(rewritten.title, sanitizeContent(rewritten.content), fid);
      if (result && result.code === 0) {
        log('    OK! tid=' + result.tid + ' "' + rewritten.title + '"');
        usedArticleKeys.add(key);
        posted++;
        totalOk++;
      } else {
        log('    failed: ' + JSON.stringify(result));
      }
    }

    if (totalAiAttempts >= CONFIG.maxTotalAiAttempts || consecutiveAiFails >= CONFIG.maxConsecutiveAiFails) break;
  }

  log('DONE: ' + totalOk + ' posts (aiAttempts=' + totalAiAttempts + ')');
}

main().catch(e => log('Fatal: ' + e.message));
