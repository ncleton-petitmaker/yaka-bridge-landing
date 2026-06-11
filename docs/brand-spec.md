# Yaka-Bridge landing brand spec

Source: `/Users/nicolascleton/Documents/Yaka-Bridge/DESIGN.md`, `design-systems/claude/tokens.css`, `app/globals.css`, README and operator docs.

## Tokens

```css
:root {
  --bg:      oklch(98.2% 0.003 84.6);
  --surface: oklch(100.0% 0.000 89.9);
  --fg:      oklch(21.3% 0.006 91.6);
  --muted:   oklch(54.9% 0.010 84.6);
  --border:  oklch(93.1% 0.010 87.5);
  --accent:  oklch(61.7% 0.138 39.0);

  --font-display: 'Source Serif Pro', 'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif;
  --font-body:    -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono:    ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
}
```

## Observed posture

- Warm paper background with white operational surfaces and hairline borders.
- Serif headings carry authority; body copy stays compact, direct and tool-like.
- One rust accent only, mainly for primary action and one proof highlight.
- Radius stays restrained: 6px for controls, 10px for panels, 14px max for large surfaces.
- Status colors are semantic only: green ok, blue info, purple running, red error, amber waiting.
- Product proof should look like an ERP workspace: tabs, modules, Bridge status, audit trail, scopes, runs.

## Copy vocabulary from code

- ERP cloud modulaire.
- Bridge desktop local.
- Workflows agentiques compatibles MCP.
- Actions explicites, scopes, entitlements, audit logs.
- Modules client promouvables en catalogue.
- Design-system-first: tokens et assets partagés par app, modules et Bridge.
- Exploiter les abonnements ChatGPT existants pour éviter de transformer chaque tâche agentique en appels API facturés séparément.
