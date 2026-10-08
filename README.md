# Hermes Desk

An AI coordination desk for real estate sales teams in Vietnam.

A coordinator sits between residents referred by real estate sales agents, service partners and billing, all in one chat inbox. Hermes Desk reads each incoming Vietnamese message, sorts it as a new lead, a complaint or a billing request, marks urgency, routes it to the right person, and drafts a reply. A person approves every reply before anything is sent.

Live site: https://hermesdesk.dev

## What is in this repo

| Path | What it is |
| --- | --- |
| `site/` | The public website, including the live demo |
| `netlify/functions/classify.mjs` | The prototype: sends one message, or a whole inbox of up to 6 messages in a single call, to Claude and returns category, urgency, routing and a draft reply for each |
| `netlify.toml` | Netlify build settings |

## Run the prototype

The site deploys on Netlify. The function reads:

- `HERMES_ANTHROPIC_API_KEY`: Hermes Desk's own Claude API key (used first, calls api.anthropic.com directly)
- `ANTHROPIC_API_KEY`: fallback, for example the key Netlify AI Gateway provides
- `HERMES_MODEL` (optional): the Claude model to use, default `claude-haiku-5-5`

Locally, with the Netlify CLI:

```sh
ANTHROPIC_API_KEY=... netlify dev
curl -X POST localhost:8888/api/classify \
  -H 'content-type: application/json' \
  -d '{"message":"Căn 2PN còn không em?"}'
```

## Status

In daily use on the founder's own coordination desk, synced from Zalo every 5 minutes. The internal lead ledger holds 629 records since March 2026, and 1,594 Zalo contacts are sorted into roles by fixed rules. Time saved has not been measured yet. Now opening to pilot teams. The internal tool sorts contacts with fixed rules first and uses Gemini Flash for the few contacts no rule covers; moving that step onto the Claude API is next. The public prototype in this repo runs on the Claude API, and the system is designed and built with Claude.

## Contact

Trần Việt Tùng · tung@hermesdesk.dev · 0799 161 803

Operated by Hộ kinh doanh Trần Việt Tùng (Tran Viet Tung Household Business), Vietnam.
