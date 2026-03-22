# CPS® Lite — AI Citation Readiness Checker

**Free AI visibility score for any website. Powered by Cited By AI's CPS® framework.**

[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-blue)](https://spec.modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)

[![citedbyai-mcp-server MCP server](https://glama.ai/mcp/servers/citedbyai/citedbyai-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/citedbyai/citedbyai-mcp-server)

## What it does

Checks any website's AI citation readiness across 5 dimensions:

- **Structured Data** — JSON-LD schema markup (25 pts)
- **Meta Tags** — title, description, OpenGraph (20 pts)
- **Content Quality** — headings, word count, FAQ, citable sentences (22 pts)
- **Technical Config** — robots.txt, llms.txt, sitemap, speed (18 pts)
- **AI Signals** — speakable schema, statistics, direct-answer format (15 pts)

Returns a grade (A–F) and score (0–100) in under a second. No auth required.

## Live endpoint

```
https://citedbyai-mcp-server.citedbyai-gmail.workers.dev/mcp
```

## Tools

### `get_aeo_score(url)`
Quick CPS® Lite grade + top 3 issues blocking AI citation.

### `analyze_aeo(url)`
Full breakdown across all 5 dimensions with complete issues list and prioritised recommendations.

### `check_ai_readiness(url)`
Checks whether AI crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot) are blocked, whether `/llms.txt` exists, and other crawler access signals.

## Use with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "citedbyai": {
      "url": "https://citedbyai-mcp-server.citedbyai-gmail.workers.dev/mcp",
      "type": "streamable-http"
    }
  }
}
```

## REST endpoint

```
GET /audit?url=example.com
```

Returns full JSON result — useful for embedding in your own tools or homepage widgets.

## Full CPS® Audit

This tool runs a CPS® Lite scan — instant, free, 5 dimensions.

The full CPS® audit covers all 5 AI platforms (ChatGPT, Claude, Perplexity, Gemini, Copilot) with:
- Per-prompt Share of Voice measurement
- E-E-A-T structured scoring
- Citation source tracking
- Brand mention scanning across 7 platforms
- 30-section audit report

**[Book a full CPS® audit →](https://citedbyai.info/#contact)**

## Powered by

**[Cited By AI](https://citedbyai.info)** — ASEO (AI Search Engine Optimisation) specialists.  
CPS® (Citation Probability Score) is a registered trademark of Cited By AI.

## License

MIT — free to use, fork, and build on.