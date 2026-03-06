# AEO Audit MCP Server

**AEO (Answer Engine Optimization) audit tool** — check any website's AI visibility score and get actionable recommendations.

**Live endpoint:** `https://aeo-mcp-server.amdal-dev.workers.dev/mcp`
**Protocol:** MCP Streamable HTTP (2025-03-26)
**Free to use** — no auth required

## What it does

Analyzes why businesses don't appear in ChatGPT, Claude, Perplexity, and other AI assistant answers. Returns:

- **Score 0-100** with letter grade (A–F)
- **Breakdown**: schema markup, meta tags, content quality, technical config, AI signals
- **Issues**: specific problems blocking AI visibility
- **Recommendations**: prioritized action list

## Tools

### `analyze_aeo(url)`
Full audit. Returns score, grade, category breakdown, all issues, and ranked recommendations.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "analyze_aeo",
    "arguments": { "url": "https://example.com" }
  }
}
```

### `get_aeo_score(url)`
Quick check — score and grade only.

### `check_ai_readiness(url)`
Checks if AI crawlers (GPTBot, ClaudeBot) are blocked, if `/llms.txt` exists, and other crawler access signals.

## Usage with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aeo-audit": {
      "url": "https://aeo-mcp-server.amdal-dev.workers.dev/mcp",
      "type": "streamable-http"
    }
  }
}
```

## Usage with Cursor / other MCP clients

Endpoint: `https://aeo-mcp-server.amdal-dev.workers.dev/mcp`
Transport: Streamable HTTP (POST)

## What AEO checks

- **Structured data** (JSON-LD schema): LocalBusiness, FAQPage, AggregateRating, OpeningHours
- **Meta tags**: Title, description, OpenGraph
- **Content quality**: Word count, H1/H2 headings, location signals, FAQ section, prices
- **Technical**: robots.txt AI bot access, llms.txt, sitemap, load speed
- **AI signals**: Speakable schema, statistics/numbers, structured content

## About

Built by [Synlig Digital](https://synligdigital.no) — AEO services for Norwegian businesses.
Contact: hei@synligdigital.no
