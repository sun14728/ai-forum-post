const http = require("http");
const https = require("https");
const fs = require("fs");

var CONFIG = {
  forum: { url: "http://vps6.ccwu.cc", apiKey: "aiforum_auto_post_2026" },
  llm: {
    apiKey: "sk-nBdpxGHlfjRAsVXtp1qADkPAdmNS6wT2",
    apiUrl: "https://token.sensenova.cn/v1/chat/completions",
    model: "sensenova-6.7-flash-lite",
    maxTokens: 500,
  },
  bots: [
    { uid: 2, name: "AI观察者", style: "理性客观，善于数据分析，经常引用行业报告" },
    { uid: 3, name: "代码诗人", style: "技术范儿，喜欢用代码说话，经常分享实战技巧" },
    { uid: 4, name: "模型训练师", style: "专注模型细节，爱讨论参数调优和训练技巧" },
    { uid: 5, name: "数据猎人", style: "数据驱动，喜欢找数据支撑观点，怀疑一切" },
    { uid: 6, name: "Prompt大师", style: "Prompt工程专家，喜欢分享各种prompt技巧" },
    { uid: 7, name: "开源侠", style: "开源信仰者，推崇国产模型，喜欢对比测评" },
    { uid: 8, name: "算力狂人", style: "硬件极客，讨论显卡、算力、部署优化" },
    { uid: 9, name: "AI段子手", style: "幽默风趣，喜欢用比喻和段子解释复杂概念" },
  ],
  logFile: __dirname + "/bot_reply.log",
  replyFile: __dirname + "/bot_replied.json",
  minReplies: 2,
  maxReplies: 4,
  maxThreads: 3,
  maxTotalReplies: 10,
  maxConsecutiveLlmFails: 3,
  replyDelayMinMs: 2000,
  replyDelayMaxMs: 5000,
  requestTimeoutMs: 20000,
};

function log(msg) {
  var time = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  var line = "[" + time + "] " + msg;
  console.log(line);
  try { fs.appendFileSync(CONFIG.logFile, line + "\n"); } catch (e) {}
}

function stripBom(str) { return String(str || "").replace(/^\uFEFF/, ""); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

function httpGet(url) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith("https") ? https : http;
    var req = mod.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: CONFIG.requestTimeoutMs }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      var data = "";
      res.on("data", function (chunk) { data += chunk; });
      res.on("end", function () { resolve(data); });
    });
    req.on("error", reject);
    req.setTimeout(CONFIG.requestTimeoutMs, function () { req.destroy(); reject(new Error("timeout")); });
  });
}

function httpsPost(url, body, headers) {
  return new Promise(function (resolve, reject) {
    var data = typeof body === "string" ? body : JSON.stringify(body);
    var u = new URL(url);
    var mod = url.startsWith("https") ? https : http;
    var req = mod.request({
      hostname: u.hostname,
      port: u.port || (url.startsWith("https") ? 443 : 80),
      path: u.pathname + u.search,
      method: "POST",
      headers: Object.assign({
        "Content-Type": headers && headers["Content-Type"] ? headers["Content-Type"] : "application/json",
        "Content-Length": Buffer.byteLength(data),
      }, headers || {}),
      timeout: CONFIG.requestTimeoutMs,
    }, function (res) {
      var d = "";
      res.on("data", function (c) { d += c; });
      res.on("end", function () { resolve(d); });
    });
    req.on("error", reject);
    req.setTimeout(CONFIG.requestTimeoutMs, function () { req.destroy(); reject(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

function extractFromReasoning(reasoning) {
  if (!reasoning) return "";
  var candidates = [];
  var quoteRegex = /[\u201c\u201d\u300c\u300d"]([^」\u201d"]+)[」\u300d\u201d"]/g;
  var m;
  while ((m = quoteRegex.exec(reasoning)) !== null) {
    var text = m[1].trim();
    var zhCount = 0;
    for (var i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) >= 0x4e00 && text.charCodeAt(i) <= 0x9fff) zhCount++;
    }
    if (text.length >= 20 && zhCount / text.length > 0.3) candidates.push({ text: text, pos: m.index });
  }
  var lines = reasoning.split("\n");
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim();
    if (line.length < 15) continue;
    line = line.replace(/^\*\s*\*?[^:]*:\*\s*\*?\s*/g, "");
    line = line.replace(/^\*{1,2}/g, "").replace(/\*{1,2}$/g, "");
    var zh = 0;
    for (var j = 0; j < line.length; j++) {
      if (line.charCodeAt(j) >= 0x4e00 && line.charCodeAt(j) <= 0x9fff) zh++;
    }
    if (zh / Math.max(line.length, 1) > 0.3 && line.length >= 20) candidates.push({ text: line, pos: i * 10000 + 5000 });
  }
  if (candidates.length > 0) {
    candidates.sort(function (a, b) { return b.pos - a.pos; });
    return candidates[0].text.replace(/^\*{1,2}[^:]*:\*{1,2}\s*/g, "").replace(/\*{1,2}$/g, "").trim();
  }
  return "";
}

function cleanContent(text) {
  if (!text) return "";
  text = text.replace(/^\uFEFF/, "");
  if (text.indexOf("Thinking Process") >= 0 || text.indexOf("thinking process") >= 0) {
    text = extractFromReasoning(text);
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 10) return "";
  return text;
}

async function getThreads() {
  try {
    var resp = await httpGet(CONFIG.forum.url + "/api_threads.php?limit=20");
    var data = JSON.parse(stripBom(resp));
    if (data.code === 0 && data.threads) return data.threads;
    return [];
  } catch (e) {
    log("getThreads failed: " + e.message);
    return [];
  }
}

function getRepliedMap() {
  try { return JSON.parse(stripBom(fs.readFileSync(CONFIG.replyFile, "utf8"))); }
  catch (e) { return {}; }
}

function saveRepliedMap(map) {
  try { fs.writeFileSync(CONFIG.replyFile, JSON.stringify(map, null, 2)); } catch (e) {}
}

async function generateReply(thread, bot) {
  var prompt = "你是一个论坛用户，昵称叫\"" + bot.name + "\"，风格特点：" + bot.style + "\n" +
    "请针对这个帖子写一条中文回复（60-150字）。要求：全部使用中文，禁止输出英文句子（技术专有名词除外）。\n" +
    "帖子标题：" + thread.subject + "\n" +
    "回复要有观点、有互动感，像真人发的，不要像AI。不要用markdown格式。输出纯文本回复内容。";
  try {
    var response = await httpsPost(CONFIG.llm.apiUrl,
      JSON.stringify({
        model: CONFIG.llm.model,
        messages: [
          { role: "system", content: "你是论坛用户，全部用中文回复，禁止英文。" },
          { role: "user", content: prompt }
        ],
        max_tokens: CONFIG.llm.maxTokens,
        temperature: 0.8,
      }),
      { "Content-Type": "application/json", "Authorization": "Bearer " + CONFIG.llm.apiKey });

    var result = JSON.parse(response);
    if (result.choices && result.choices[0]) {
      var msg = result.choices[0].message;
      var text = msg.content || msg.reasoning || "";
      return cleanContent(text);
    }
    log("  LLM no choices");
    return null;
  } catch (e) {
    log("  LLM failed: " + e.message);
    return null;
  }
}

async function postReply(tid, message, bot) {
  var postData = "api_key=" + encodeURIComponent(CONFIG.forum.apiKey)
    + "&tid=" + tid + "&message=" + encodeURIComponent(message)
    + "&author=" + encodeURIComponent(bot.name) + "&authorid=" + bot.uid;
  try {
    var resp = await httpsPost(CONFIG.forum.url + "/api_reply.php", postData, { "Content-Type": "application/x-www-form-urlencoded" });
    return JSON.parse(stripBom(resp));
  } catch (e) {
    log("  Reply API error: " + e.message);
    return null;
  }
}

async function main() {
  log("========== Bot Reply Start ==========");
  var threads = await getThreads();
  log("Found " + threads.length + " threads");
  if (threads.length === 0) { log("No threads, exiting"); return; }

  var replied = getRepliedMap();
  var eligible = threads.filter(function (t) {
    return !replied[t.tid.toString()] || replied[t.tid.toString()].count < CONFIG.maxReplies;
  });
  log("Eligible: " + eligible.length);
  var targets = eligible.slice(0, CONFIG.maxThreads);
  var totalReplies = 0;
  var consecutiveFails = 0;

  for (var ti = 0; ti < targets.length; ti++) {
    if (totalReplies >= CONFIG.maxTotalReplies) break;
    if (consecutiveFails >= CONFIG.maxConsecutiveLlmFails) {
      log("Stop: consecutive LLM failures");
      break;
    }

    var thread = targets[ti];
    var tid = thread.tid.toString();
    var existing = replied[tid] ? replied[tid].count : 0;
    var targetReplies = randInt(CONFIG.minReplies, CONFIG.maxReplies);
    var needed = Math.max(0, Math.min(targetReplies - existing, CONFIG.maxTotalReplies - totalReplies));
    if (needed === 0) continue;

    log("\nThread: " + thread.subject + " (tid=" + tid + ", existing=" + existing + ", need=" + needed + ")");
    var usedBots = new Set(replied[tid] ? (replied[tid].bots || []) : []);

    for (var i = 0; i < needed; i++) {
      if (totalReplies >= CONFIG.maxTotalReplies) break;
      if (consecutiveFails >= CONFIG.maxConsecutiveLlmFails) break;

      var available = CONFIG.bots.filter(function (b) { return !usedBots.has(b.uid); });
      var bot = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : CONFIG.bots[Math.floor(Math.random() * CONFIG.bots.length)];
      usedBots.add(bot.uid);
      log("  [" + (i + 1) + "/" + needed + "] " + bot.name);

      var reply = await generateReply(thread, bot);
      if (!reply || reply.length < 10) {
        consecutiveFails++;
        log("    skip (empty), fail streak=" + consecutiveFails);
        continue;
      }
      consecutiveFails = 0;
      log("    -> " + reply.substring(0, 50) + "...");

      var result = await postReply(thread.tid, reply, bot);
      if (result && result.code === 0) {
        log("    OK! pid=" + (result.pid || "?"));
        totalReplies++;
        if (!replied[tid]) replied[tid] = { count: 0, bots: [] };
        replied[tid].count++;
        if (!replied[tid].bots) replied[tid].bots = [];
        replied[tid].bots.push(bot.uid);
        saveRepliedMap(replied);
      } else {
        log("    FAIL: " + JSON.stringify(result));
      }
      await sleep(randInt(CONFIG.replyDelayMinMs, CONFIG.replyDelayMaxMs));
    }
  }
  log("\n========== Done: " + totalReplies + " replies ==========");
}

main().catch(function (e) { log("Fatal: " + e.message); });
