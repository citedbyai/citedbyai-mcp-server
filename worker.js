/**
 * CPS® Lite — AI Citation Readiness Checker
 * citedbyai-mcp-server — Cloudflare Worker
 *
 * Implements MCP (Model Context Protocol) Streamable HTTP transport.
 * Exposes AEO/ASEO audit tools powered by Cited By AI's CPS® framework.
 *
 * Protocol: JSON-RPC 2.0 over HTTP POST /mcp
 * Free to use — no auth required
 * Full CPS® audit: https://citedbyai.info/#contact
 *
 * Tools:
 *   get_aeo_score(url)       — Quick CPS® Lite grade (A–F) + 3 findings + CTA
 *   analyze_aeo(url)         — Full breakdown across 5 dimensions
 *   check_ai_readiness(url)  — AI crawler access audit
 */

const UA = "Mozilla/5.0 (compatible; CitedByAI-MCP/1.0; +https://citedbyai.info)";
const TIMEOUT_MS = 20000;
const SERVER_NAME = "citedbyai-mcp-server";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2025-03-26";
const CTA_URL = "https://citedbyai.info/#contact";
const HOME_URL = "https://citedbyai.info";

// ─── CORS Headers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Accept",
  "Access-Control-Max-Age": "86400",
};

// ─── HTML Parsing Utilities ───────────────────────────────────────────────────

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      if (Array.isArray(data)) blocks.push(...data);
      else if (data["@graph"]) blocks.push(...data["@graph"]);
      else blocks.push(data);
    } catch { /* ignore invalid JSON-LD */ }
  }
  return blocks;
}

function extractMeta(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name.replace(":", "\\:")}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name.replace(":", "\\:")}["']`,
    "i"
  );
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : null;
}

function countTag(html, tag) {
  const re = new RegExp(`<${tag}[\\s>]`, "gi");
  return (html.match(re) || []).length;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// ─── Analyzers ────────────────────────────────────────────────────────────────

const SPECIFIC_TYPES = [
  "dentist", "medicalclinic", "medicalbusiness", "physician",
  "autorepair", "autodealer", "legalservice", "attorney",
  "accountingservice", "financialservice", "realestateagent",
  "restaurant", "barorpub", "cafeoecoffeeshop",
  "beautysalon", "hairsalon", "dayspa", "healthclub",
  "plumber", "electrician", "hvacbusiness", "roofingcontractor",
  "generalcontractor", "locksmith", "professionalservice",
  "consultingservice", "marketingagency", "itservice",
];

function analyzeSchema(html) {
  const issues = [];
  const recommendations = [];
  const blocks = extractJsonLd(html);

  const types = [];
  function extractTypes(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj["@type"]) {
      const t = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
      types.push(...t.map(s => s.toLowerCase()));
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(extractTypes);
      else if (typeof v === "object") extractTypes(v);
    }
  }
  blocks.forEach(extractTypes);

  const allJson = JSON.stringify(blocks).toLowerCase();
  const hasLocalBusiness = types.some(t => t === "localbusiness" || SPECIFIC_TYPES.includes(t));
  const hasSpecificType = types.some(t => SPECIFIC_TYPES.includes(t));
  const hasAggregateRating = allJson.includes("aggregaterating") || allJson.includes("ratingvalue");
  const hasOpeningHours = allJson.includes("openinghours");
  const hasGeo = allJson.includes('"geo"') || allJson.includes('"latitude"');
  const hasContactPoint = allJson.includes("contactpoint");
  const hasFaqPage = types.includes("faqpage");
  const hasService = types.includes("service") || allJson.includes("hasoffercatalog");
  const hasPerson = types.includes("person") || allJson.includes('"employee"');

  let score = 0;
  if (blocks.length === 0) {
    issues.push("No structured data (JSON-LD schema) found — this is the #1 reason AI platforms skip a site");
    recommendations.push("Add JSON-LD schema.org markup — the most important signal for AI citation probability");
  } else {
    score += 4;
    if (hasLocalBusiness) {
      score += 3;
      if (hasSpecificType) score += 3;
      else recommendations.push("Use a specific @type (e.g. ProfessionalService, MarketingAgency) instead of generic LocalBusiness");
    } else {
      issues.push("Missing LocalBusiness or ProfessionalService schema");
      recommendations.push("Add @type matching your business category — AI platforms use this to classify and cite you");
    }
    if (hasAggregateRating) score += 4;
    else recommendations.push("Add AggregateRating schema — AI platforms include star ratings in cited responses");
    if (hasOpeningHours) score += 2;
    else recommendations.push("Add openingHours to schema");
    if (hasGeo) score += 2;
    else recommendations.push("Add geo coordinates (latitude/longitude) for local AI search visibility");
    if (hasContactPoint) score += 1;
    if (hasFaqPage) score += 3;
    else recommendations.push("Add FAQPage schema — AI assistants cite FAQ content directly in answers");
    if (hasService) score += 2;
    else recommendations.push("Add hasOfferCatalog or Service schema to describe what you offer");
    if (hasPerson) score += 1;
  }

  return {
    score: Math.min(25, score), max: 25,
    issues, recommendations,
    details: { hasLocalBusiness, hasSpecificType, hasAggregateRating, hasOpeningHours, hasGeo, hasFaqPage, hasService, schemaBlockCount: blocks.length },
  };
}

function analyzeMeta(html) {
  const issues = [];
  const recommendations = [];
  const title = extractTitle(html);
  const description = extractMeta(html, "description");
  const ogTitle = extractMeta(html, "og:title");
  const ogDesc = extractMeta(html, "og:description");
  const ogImage = extractMeta(html, "og:image");
  const canonical = /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
  const viewport = extractMeta(html, "viewport");

  let score = 0;
  if (!title) {
    issues.push("Missing <title> tag");
    recommendations.push("Add a descriptive title tag (50–60 chars) — AI platforms read this to classify your page");
  } else if (title.length < 20 || title.length > 70) {
    score += 2;
    recommendations.push(`Title is ${title.length} chars — ideal is 50–60 for maximum AI readability`);
  } else {
    score += 5;
  }
  if (!description) {
    issues.push("Missing meta description");
    recommendations.push("Add a meta description (130–160 chars) — this is often what AI platforms quote verbatim");
  } else if (description.length < 50 || description.length > 170) {
    score += 2;
    recommendations.push(`Meta description is ${description.length} chars — ideal is 130–160`);
  } else {
    score += 5;
  }
  if (ogTitle && ogDesc && ogImage) score += 5;
  else if (ogTitle || ogDesc) { score += 2; if (!ogImage) recommendations.push("Add og:image — required for full social and AI platform card display"); }
  else recommendations.push("Add OpenGraph tags (og:title, og:description, og:image)");
  if (canonical) score += 3;
  else recommendations.push("Add a canonical URL tag to prevent duplicate content confusion");
  if (viewport) score += 2;
  else issues.push("Missing viewport meta — page not mobile-optimised");

  return {
    score: Math.min(20, score), max: 20,
    issues, recommendations,
    details: { title, titleLength: title ? title.length : 0, description, descriptionLength: description ? description.length : 0, hasOg: !!(ogTitle && ogDesc), hasCanonical: canonical },
  };
}

function analyzeContent(html) {
  const issues = [];
  const recommendations = [];
  const text = stripTags(html);
  const words = wordCount(text);
  const h1Count = countTag(html, "h1");
  const h2Count = countTag(html, "h2");

  // Location signals — generic international patterns
  const hasLocation = /\b(?:street|road|avenue|lane|drive|place|square|city|town|county|state|province|postcode|zip code|address)\b/i.test(html)
    || /\d{1,5}\s+[A-Z][a-z]+\s+(?:Street|Road|Avenue|Lane|Drive|Place|St|Rd|Ave)/i.test(html);

  const hasPrices = /\d+[\s.,]\d*\s*(?:USD|GBP|EUR|CAD|AUD|\$|£|€|per\s+(?:month|year|hour|day))/i.test(html);
  const hasFaq = /(?:faq|frequently asked|questions|q&a)/i.test(html) || countTag(html, "details") > 0;
  const hasPhone = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,6}/i.test(html);
  const hasTeam = /(?:team|about us|our staff|staff|founder|ceo|our experts|our story)/i.test(html.toLowerCase());

  // CPS® Signal: does the page have a single citable sentence describing what the business does?
  const hasCitableSentence = /(?:we (?:help|provide|offer|specialise|specialize)|our (?:mission|goal|service|platform|tool)|(?:the |a )?(?:leading|trusted|only|first)\s+\w+\s+(?:for|that|which))/i.test(html);

  let score = 0;
  if (h1Count === 0) { issues.push("Missing H1 heading — AI platforms use H1 as the primary topic signal"); recommendations.push("Add one clear H1 that states what you do and for whom"); }
  else if (h1Count === 1) score += 5;
  else { score += 3; recommendations.push(`${h1Count} H1 headings found — keep exactly one for clear AI topic classification`); }
  if (h2Count >= 3) score += 3;
  else if (h2Count > 0) score += 1;
  else recommendations.push("Add H2 headings to structure content — AI platforms parse heading hierarchy to build citations");
  if (words >= 500) score += 4;
  else if (words >= 200) score += 2;
  else { issues.push(`Low word count (${words} words) — insufficient for AI platforms to extract citable content`); recommendations.push("Add at least 300–500 words describing your services, methodology, and expertise"); }
  if (hasLocation) score += 3;
  else { issues.push("No location or address signals detected"); recommendations.push("Include your city, address, or service area explicitly in page text"); }
  if (hasPrices) score += 2;
  else recommendations.push("Add pricing information — AI platforms include cost signals in cited responses");
  if (hasFaq) score += 3;
  else recommendations.push("Add an FAQ section — the single fastest way to get cited in AI answer boxes");
  if (hasPhone) score += 2;
  else recommendations.push("Add a phone number in text format (not just in an image)");
  if (hasCitableSentence) score += 2;
  else recommendations.push("Add one clear sentence stating exactly what you do — this is what AI platforms quote when citing you");

  return {
    score: Math.min(22, score), max: 22,
    issues, recommendations,
    details: { words, h1Count, h2Count, hasLocation, hasPrices, hasFaq, hasTeam, hasCitableSentence },
  };
}

function analyzeTechnical(html, robotsTxt, llmsTxt, statusCode, loadMs) {
  const issues = [];
  const recommendations = [];
  const hasSitemap = /sitemap/i.test(robotsTxt || "");
  const hasLlmsTxt = !!llmsTxt;
  const blocksGpt = /disallow.*GPTBot|user-agent.*GPTBot.*\nDisallow:\s*\//i.test(robotsTxt || "");
  const blocksClaude = /disallow.*ClaudeBot|user-agent.*ClaudeBot.*\nDisallow:\s*\//i.test(robotsTxt || "");
  const blocksPerplexity = /disallow.*PerplexityBot|user-agent.*PerplexityBot.*\nDisallow:\s*\//i.test(robotsTxt || "");
  const fast = loadMs < 2000;

  let score = 0;
  score += 3; // HTTPS assumed (we always prepend https://)
  if (robotsTxt) {
    if (!blocksGpt && !blocksClaude && !blocksPerplexity) score += 5;
    else {
      if (blocksGpt) { issues.push("robots.txt blocks GPTBot — ChatGPT cannot index this site"); recommendations.push("Remove GPTBot block from robots.txt to restore ChatGPT visibility"); }
      if (blocksClaude) { issues.push("robots.txt blocks ClaudeBot — Claude cannot index this site"); recommendations.push("Remove ClaudeBot block from robots.txt"); }
      if (blocksPerplexity) { issues.push("robots.txt blocks PerplexityBot — Perplexity cannot index this site"); recommendations.push("Remove PerplexityBot block from robots.txt"); }
      score += 1;
    }
  } else { score += 2; recommendations.push("Add robots.txt that explicitly allows GPTBot, ClaudeBot, PerplexityBot, and OAI-SearchBot"); }
  if (hasLlmsTxt) score += 5;
  else recommendations.push("Add /llms.txt — a structured file specifically designed for AI platform readability");
  if (hasSitemap) score += 2;
  else recommendations.push("Add sitemap.xml and reference it in robots.txt");
  if (fast) score += 3;
  else recommendations.push(`Page load is ${loadMs}ms — slow pages are deprioritised by AI crawlers`);
  if (statusCode === 200) score += 3;
  else if (statusCode === 0) { issues.push("Site unreachable — could not connect"); score = 0; }

  return {
    score: Math.min(18, score), max: 18,
    issues, recommendations,
    details: { hasLlmsTxt, blocksGpt, blocksClaude, blocksPerplexity, hasSitemap, loadMs, statusCode },
  };
}

function analyzeAISignals(html, llmsTxt) {
  const issues = [];
  const recommendations = [];
  const hasSpeakable = /speakable/i.test(html);
  const hasStatistics = /\d+%|\d+\s*(?:years|clients|customers|businesses|companies|brands|cases)/i.test(html);
  const hasCitations = /(?:according to|source:|research shows|studies show|data from|cited by)/i.test(html);
  const hasH2H3Coverage = countTag(html, "h2") + countTag(html, "h3") >= 4;
  const hasVideo = /<video|youtube\.com\/embed|vimeo\.com\/video/i.test(html);
  const hasLlmsContent = !!(llmsTxt && llmsTxt.length > 100);

  // CPS® specific: does the page have answer-format content?
  const hasDirectAnswers = /(?:what is|how to|how does|why does|when should|what are the|the answer is|in short|in summary)/i.test(html);

  let score = 0;
  if (hasSpeakable) score += 3;
  else recommendations.push("Add Speakable schema — signals to AI platforms which content is most citable");
  if (hasStatistics) score += 2;
  else recommendations.push("Add specific numbers (years in business, client count, results) — AI platforms cite quantified claims");
  if (hasCitations) score += 2;
  else recommendations.push("Reference authoritative sources — AI platforms trust content that cites evidence");
  if (hasH2H3Coverage) score += 2;
  else recommendations.push("Add more H2/H3 subheadings to structure content for AI parsing");
  if (hasVideo) score += 1;
  if (hasLlmsContent) score += 3;
  else recommendations.push("Add /llms.txt with a structured description of your business — directly feeds AI assistant knowledge");
  if (hasDirectAnswers) score += 2;
  else recommendations.push("Write content in direct-answer format — start sections with the answer, then explain. AI platforms extract and cite direct answers.");

  return {
    score: Math.min(15, score), max: 15,
    issues, recommendations,
    details: { hasSpeakable, hasStatistics, hasCitations, hasH2H3Coverage, hasLlmsTxt: !!llmsTxt, hasDirectAnswers },
  };
}

// ─── Core Audit Function ──────────────────────────────────────────────────────

async function runAudit(url) {
  if (!url.startsWith("http")) url = "https://" + url;
  const urlObj = new URL(url);
  const origin = urlObj.origin;
  const start = Date.now();

  const fetchOpts = { headers: { "User-Agent": UA }, redirect: "follow" };
  const withTimeout = (p) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS))]);

  let html = "";
  let statusCode = 0;
  let finalUrl = url;
  let robotsTxt = null;
  let llmsTxt = null;

  try {
    const [mainRes, robotsRes, llmsRes] = await Promise.all([
      withTimeout(fetch(url, fetchOpts)),
      withTimeout(fetch(`${origin}/robots.txt`, fetchOpts)).catch(() => null),
      withTimeout(fetch(`${origin}/llms.txt`, fetchOpts)).catch(() => null),
    ]);
    statusCode = mainRes.status;
    finalUrl = mainRes.url;
    html = await mainRes.text();
    if (robotsRes && robotsRes.ok) robotsTxt = await robotsRes.text();
    if (llmsRes && llmsRes.ok) llmsTxt = await llmsRes.text();
  } catch (e) {
    statusCode = 0;
  }

  const loadMs = Date.now() - start;
  const schema = analyzeSchema(html);
  const meta = analyzeMeta(html);
  const content = analyzeContent(html);
  const technical = analyzeTechnical(html, robotsTxt, llmsTxt, statusCode, loadMs);
  const aiSignals = analyzeAISignals(html, llmsTxt);

  const totalScore = schema.score + meta.score + content.score + technical.score + aiSignals.score;

  function getGrade(s) {
    if (s >= 85) return "A";
    if (s >= 70) return "B";
    if (s >= 55) return "C";
    if (s >= 40) return "D";
    if (s >= 25) return "E";
    return "F";
  }

  return {
    url, finalUrl, statusCode, loadMs,
    totalScore, grade: getGrade(totalScore),
    breakdown: {
      schema:    { score: schema.score,    max: schema.max,    details: schema.details },
      meta:      { score: meta.score,      max: meta.max,      details: meta.details },
      content:   { score: content.score,   max: content.max,   details: content.details },
      technical: { score: technical.score, max: technical.max, details: technical.details },
      aiSignals: { score: aiSignals.score, max: aiSignals.max, details: aiSignals.details },
    },
    issues: [...schema.issues, ...meta.issues, ...content.issues, ...technical.issues, ...aiSignals.issues],
    recommendations: [...schema.recommendations, ...meta.recommendations, ...content.recommendations, ...technical.recommendations, ...aiSignals.recommendations],
    auditedAt: new Date().toISOString(),
    poweredBy: "CPS® Lite by Cited By AI",
    fullAudit: CTA_URL,
    learnMore: HOME_URL,
  };
}

// ─── MCP Tool Definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_aeo_score",
    description: "Get a quick AI citation readiness score for any website. Powered by Cited By AI's CPS® (Citation Probability Score) framework. Returns a grade (A–F), numeric score (0–100), and the 3 most important issues blocking AI citation. Use this for a fast check before deciding whether a full CPS® audit is needed.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL of the website to check (e.g. 'https://example.com' or 'example.com')"
        }
      },
      required: ["url"]
    }
  },
  {
    name: "analyze_aeo",
    description: "Run a full AI visibility audit on a website using Cited By AI's CPS® Lite framework. Returns a score 0–100, grade (A–F), breakdown across 5 dimensions (structured data, meta tags, content quality, technical config, AI signals), complete issues list, and prioritised recommendations. Use this when you need a comprehensive analysis of why a business isn't appearing in AI assistant answers.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL of the website to audit (e.g. 'https://example.com' or 'example.com')"
        }
      },
      required: ["url"]
    }
  },
  {
    name: "check_ai_readiness",
    description: "Check whether a website is properly configured for AI crawler access. Checks robots.txt for AI bot blocks (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot), presence of /llms.txt, schema markup, and other technical signals that determine whether ChatGPT, Claude, Perplexity and other AI assistants can read and cite the site.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL of the website to check"
        }
      },
      required: ["url"]
    }
  }
];

// ─── MCP Handler ──────────────────────────────────────────────────────────────

async function handleMcp(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { jsonrpc, id, method, params } = body;

  if (jsonrpc !== "2.0") {
    return jsonRpcError(id, -32600, "Invalid Request: jsonrpc must be '2.0'");
  }

  if (method?.startsWith?.("notifications/")) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  switch (method) {
    case "initialize": {
      return jsonRpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools:     { listChanged: false },
          resources: { listChanged: false },
          prompts:   { listChanged: false },
        },
        serverInfo: {
          name:        SERVER_NAME,
          version:     SERVER_VERSION,
          description: "CPS® Lite — AI citation readiness checker by Cited By AI. Audits any website for AI visibility across ChatGPT, Claude, Perplexity, Gemini, and Copilot. Free tool — full CPS® audit at citedbyai.info",
        },
        instructions: `CPS® Lite by Cited By AI. Use get_aeo_score(url) to instantly check any website's AI citation readiness. Grade A–F, score 0–100, top issues. Free to use. Full audit: ${CTA_URL}`
      });
    }

    case "ping": {
      return jsonRpcOk(id, {});
    }

    case "tools/list": {
      return jsonRpcOk(id, { tools: TOOLS });
    }

    case "resources/list": {
      return jsonRpcOk(id, { resources: [] });
    }

    case "prompts/list": {
      return jsonRpcOk(id, { prompts: [] });
    }

    case "tools/call": {
      const toolName = params?.name;
      const args     = params?.arguments || {};

      if (!toolName) return jsonRpcError(id, -32602, "Invalid params: missing 'name'");

      const url = args.url;
      if (!url) {
        return jsonRpcOk(id, {
          content: [{ type: "text", text: "Error: 'url' parameter is required" }],
          isError: true
        });
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(url.startsWith("http") ? url : "https://" + url);
      } catch {
        return jsonRpcOk(id, {
          content: [{ type: "text", text: `Error: Invalid URL '${url}'` }],
          isError: true
        });
      }

      try {
        if (toolName === "analyze_aeo") {
          const result = await runAudit(parsedUrl.href);
          const summary = formatAuditSummary(result);
          return jsonRpcOk(id, {
            content: [
              { type: "text", text: summary },
              { type: "text", text: JSON.stringify(result, null, 2) }
            ]
          });
        }

        if (toolName === "get_aeo_score") {
          const result = await runAudit(parsedUrl.href);
          const grade_label = { A: "Excellent", B: "Good", C: "Needs Work", D: "Poor", E: "Critical", F: "Not Visible" };
          const top3 = result.issues.slice(0, 3);
          const text = [
            `CPS® Lite Score for ${result.url}`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `Score: ${result.totalScore}/100   Grade: ${result.grade} — ${grade_label[result.grade] || ""}`,
            ``,
            top3.length > 0 ? `Top ${top3.length} issue${top3.length > 1 ? "s" : ""} blocking AI citation:` : "No critical issues found.",
            ...top3.map((issue, i) => `${i + 1}. ${issue}`),
            ``,
            `Want the full CPS® audit across all 5 AI platforms?`,
            `→ ${CTA_URL}`,
            ``,
            `Powered by Cited By AI — ${HOME_URL}`,
          ].join("\n");
          return jsonRpcOk(id, {
            content: [{ type: "text", text }]
          });
        }

        if (toolName === "check_ai_readiness") {
          const result = await runAudit(parsedUrl.href);
          const tech = result.breakdown.technical;
          const ai   = result.breakdown.aiSignals;
          const issues = [];
          if (tech.details.blocksGpt)       issues.push("❌ Blocks GPTBot — ChatGPT cannot index this site");
          if (tech.details.blocksClaude)    issues.push("❌ Blocks ClaudeBot — Claude cannot index this site");
          if (tech.details.blocksPerplexity) issues.push("❌ Blocks PerplexityBot — Perplexity cannot index this site");
          if (!tech.details.hasLlmsTxt)     issues.push("⚠️  No /llms.txt file — AI platforms cannot read structured business data");
          if (!tech.details.hasSitemap)     issues.push("⚠️  No sitemap.xml referenced in robots.txt");
          if (!ai.details.hasSpeakable)     issues.push("⚠️  No Speakable schema — voice assistants cannot identify citable sections");
          if (result.breakdown.schema.details.schemaBlockCount === 0) issues.push("❌ No JSON-LD structured data — highest-impact missing signal");

          const readinessScore = tech.score + ai.score;
          const maxReadiness   = tech.max + ai.max;

          const text = [
            `AI Readiness Check — ${result.url}`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `Readiness Score: ${readinessScore}/${maxReadiness}`,
            ``,
            issues.length === 0
              ? "✅ Site is well-configured for AI crawlers"
              : `Issues found (${issues.length}):`,
            ...issues,
            ``,
            `Technical: ${tech.score}/${tech.max}   AI Signals: ${ai.score}/${ai.max}`,
            ``,
            `Get a full CPS® audit across ChatGPT, Claude, Perplexity, Gemini & Copilot:`,
            `→ ${CTA_URL}`,
            ``,
            `Powered by Cited By AI — ${HOME_URL}`,
          ].join("\n");
          return jsonRpcOk(id, {
            content: [{ type: "text", text }]
          });
        }

        return jsonRpcOk(id, {
          content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
          isError: true
        });

      } catch (e) {
        return jsonRpcOk(id, {
          content: [{ type: "text", text: `Audit failed: ${e.message}` }],
          isError: true
        });
      }
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── Format Helpers ───────────────────────────────────────────────────────────

function formatAuditSummary(r) {
  const grade_emoji  = { A: "🟢", B: "🟡", C: "🟠", D: "🔴", E: "🔴", F: "⛔" };
  const grade_label  = { A: "Excellent", B: "Good", C: "Needs Work", D: "Poor", E: "Critical", F: "Not Visible" };
  const emoji = grade_emoji[r.grade] || "⚪";
  let out = `${emoji} CPS® Lite Score: ${r.totalScore}/100 — Grade ${r.grade} (${grade_label[r.grade] || ""})\n`;
  out += `URL: ${r.url}\n`;
  out += `Audited: ${r.auditedAt}\n\n`;
  out += `SCORE BREAKDOWN:\n`;
  out += `  Structured Data (Schema):  ${r.breakdown.schema.score}/${r.breakdown.schema.max}\n`;
  out += `  Meta Tags:                 ${r.breakdown.meta.score}/${r.breakdown.meta.max}\n`;
  out += `  Content Quality:           ${r.breakdown.content.score}/${r.breakdown.content.max}\n`;
  out += `  Technical Config:          ${r.breakdown.technical.score}/${r.breakdown.technical.max}\n`;
  out += `  AI Signals:                ${r.breakdown.aiSignals.score}/${r.breakdown.aiSignals.max}\n\n`;
  if (r.issues.length > 0) {
    out += `ISSUES FOUND (${r.issues.length}):\n`;
    r.issues.slice(0, 5).forEach((i, n) => { out += `  ${n + 1}. ${i}\n`; });
    if (r.issues.length > 5) out += `  … and ${r.issues.length - 5} more\n`;
    out += "\n";
  }
  if (r.recommendations.length > 0) {
    out += `TOP RECOMMENDATIONS:\n`;
    r.recommendations.slice(0, 5).forEach((rec, n) => { out += `  ${n + 1}. ${rec}\n`; });
    if (r.recommendations.length > 5) out += `  … and ${r.recommendations.length - 5} more\n`;
    out += "\n";
  }
  out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  out += `This is a CPS® Lite scan — 5 dimensions, instant, free.\n`;
  out += `The full CPS® audit covers all 5 AI platforms with per-prompt SOV,\n`;
  out += `E-E-A-T scoring, citation source tracking, and a 30-section report.\n`;
  out += `Book a full audit: ${CTA_URL}\n`;
  out += `Cited By AI — ${HOME_URL}`;
  return out;
}

function jsonRpcOk(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

function jsonRpcError(id, code, message) {
  return new Response(JSON.stringify({
    jsonrpc: "2.0", id,
    error: { code, message }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

// ─── Main Worker ──────────────────────────────────────────────────────────────

export default {
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(JSON.stringify({
        ok:              true,
        name:            SERVER_NAME,
        version:         SERVER_VERSION,
        poweredBy:       "CPS® Lite by Cited By AI",
        protocol:        "MCP Streamable HTTP",
        protocolVersion: PROTOCOL_VERSION,
        endpoint:        "/mcp",
        tools:           TOOLS.map(t => t.name),
        fullAudit:       CTA_URL,
        learnMore:       HOME_URL,
      }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    if (url.pathname === "/.well-known/mcp/server-card.json") {
      return new Response(JSON.stringify({
        serverInfo: {
          name:        "CPS® Lite by Cited By AI",
          version:     SERVER_VERSION,
          description: "Free AI citation readiness checker. Powered by Cited By AI's CPS® framework. Audits any website for AI visibility across ChatGPT, Claude, Perplexity, Gemini, and Copilot. Three tools: get_aeo_score, analyze_aeo, check_ai_readiness. Full CPS® audit at citedbyai.info"
        },
        tools:     TOOLS,
        resources: [],
        prompts:   []
      }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    if (url.pathname === "/audit") {
      if (req.method !== "GET") {
        return new Response(JSON.stringify({ error: "Use GET /audit?url=example.com" }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        return new Response(JSON.stringify({
          error:   "Missing ?url= parameter",
          example: "/audit?url=example.com"
        }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }
      let parsedUrl;
      try {
        parsedUrl = new URL(targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`);
      } catch {
        return new Response(JSON.stringify({ error: "Invalid URL", url: targetUrl }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }
      try {
        const result = await runAudit(parsedUrl.href);
        return new Response(JSON.stringify({
          url:        result.url,
          score:      result.totalScore,
          grade:      result.grade,
          poweredBy:  "CPS® Lite by Cited By AI",
          components: {
            schema:    { score: result.breakdown.schema.score,    max: result.breakdown.schema.max },
            meta:      { score: result.breakdown.meta.score,      max: result.breakdown.meta.max },
            content:   { score: result.breakdown.content.score,   max: result.breakdown.content.max },
            technical: { score: result.breakdown.technical.score, max: result.breakdown.technical.max },
            aiSignals: { score: result.breakdown.aiSignals.score, max: result.breakdown.aiSignals.max },
          },
          issues:          result.issues || [],
          recommendations: result.recommendations || [],
          summary:         formatAuditSummary(result),
          timestamp:       result.auditedAt,
          fullAudit:       CTA_URL,
          learnMore:       HOME_URL,
        }), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: `Audit failed: ${e.message}`, url: parsedUrl.href }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }
    }

    if (url.pathname === "/mcp") {
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "MCP endpoint requires POST" }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS }
        });
      }
      return handleMcp(req);
    }

    return new Response(JSON.stringify({
      error:  "Not found",
      routes: {
        "/":       "Server info",
        "/health": "Health check",
        "/audit":  "REST audit endpoint (GET ?url=example.com)",
        "/mcp":    "MCP endpoint (POST)",
        "/.well-known/mcp/server-card.json": "MCP server card"
      }
    }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
};
