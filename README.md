# Hermes Desk

An AI coordination desk for real estate sales teams in Vietnam.

A coordinator sits between buyers, sales agents and billing, all in one chat inbox. Hermes Desk reads each incoming Vietnamese message, sorts it as a new lead, a complaint or a billing request, marks urgency, routes it to the right person, and drafts a reply. A person approves every reply before anything is sent.

Live site: https://hermesdesk.dev

## What is in this repo

| Path | What it is |
| --- | --- |
| `site/` | The public website, including the live demo |
| `netlify/functions/classify.mjs` | The prototype: sends one message to Claude and returns category, urgency, routing and a draft reply |
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

In daily use for 2 months by a pilot group of 10 coordinators from the founder's network (15–20 leads per person per day), connected to Zalo, Messenger and email. Pilot users report about 70% less time to respond to and handle a lead, about 90% fewer missed leads, and 90% of drafts sent as written or with light edits. The internal version runs on the founder's Claude account; the public prototype calls the Claude API.

## Contact

Trần Việt Tùng · tung@hermesdesk.dev

Operated by Hộ kinh doanh Trần Việt Tùng (Tran Viet Tung Household Business), Vietnam.
