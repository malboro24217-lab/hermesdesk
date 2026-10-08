// Hermes Desk prototype: classify incoming customer messages and draft replies.
// Send {message} for one message, or {messages:[{from,text}]} (up to 6) to sort a whole inbox in one Claude call.
// Runs as a Netlify Function at /api/classify. Needs ANTHROPIC_API_KEY in the site's environment.

import { getStore } from "@netlify/blobs";

const MODEL = process.env.HERMES_MODEL || "claude-haiku-5-5";
const MAX_INPUT = 600;
const PER_IP_PER_DAY = 15;
const ALL_PER_DAY = 400;
const MAX_BATCH = 6;

// Counts demo requests per visitor and in total per day, so the public demo cannot be drained.
// If the counter store is unavailable, requests are allowed rather than breaking the demo.
async function overLimit(ip) {
  try {
    const store = getStore("demo-limits");
    const day = new Date().toISOString().slice(0, 10);
    const keys = [`${day}/ip/${ip || "unknown"}`, `${day}/all`];
    const [mine, all] = await Promise.all(keys.map((k) => store.get(k)));
    const m = Number(mine || 0), a = Number(all || 0);
    if (m >= PER_IP_PER_DAY || a >= ALL_PER_DAY) return true;
    await Promise.all([store.set(keys[0], String(m + 1)), store.set(keys[1], String(a + 1))]);
    return false;
  } catch (err) {
    console.error("Rate limit store unavailable", err && err.message);
    return false;
  }
}

const SYSTEM = `You are Hermes Desk, the AI assistant of a coordinator for real estate sales teams in Vietnam.
The coordinator sits between buyers and residents, the real estate sales agents who refer them, service partners such as internet installers, and the billing team. Messages arrive in Vietnamese.

For the incoming message, decide:
- category: "lead" (a buyer or resident asking about a property or a service such as internet installation: price, viewing, availability, scheduling), "complaint" (dissatisfaction, delays, broken promises), "billing" (bills, deposits, payments, invoices, receipts), or "other".
- urgency: "high", "medium" or "low". Complaints about repeated failures, and customers ready to view, deposit or book an installation, are high.
- route_to: "sales_agent", "team_lead" (for complaints that need escalation), "billing", or "coordinator".
- summary_en: one short English sentence describing the message.
- draft_vi: a short, polite reply in natural Vietnamese, in the voice of the coordinator, ready for a human to review. Never promise prices, availability or dates you were not given; say the coordinator will confirm instead.

Record your decision with the route_message tool.`;

const INBOX_NOTE = `You will receive several numbered messages from one coordinator's inbox. Sort every one of them, keep each draft_vi to at most two sentences, and record all decisions in a single call to the route_inbox tool, one item per message, using the message number as index.`;

const ROUTE_TOOL = {
  name: "route_message",
  description: "Record how an incoming customer message is sorted, routed, and answered.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["lead", "complaint", "billing", "other"] },
      urgency: { type: "string", enum: ["high", "medium", "low"] },
      route_to: { type: "string", enum: ["sales_agent", "team_lead", "billing", "coordinator"] },
      summary_en: { type: "string", description: "One short English sentence describing the message." },
      draft_vi: { type: "string", description: "Short, polite reply in natural Vietnamese for a human to review." },
    },
    required: ["category", "urgency", "route_to", "summary_en", "draft_vi"],
  },
};

const ITEM_PROPS = ROUTE_TOOL.input_schema.properties;
const INBOX_TOOL = {
  name: "route_inbox",
  description: "Record how every message in the inbox is sorted, routed, and answered.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { index: { type: "integer", description: "The message number." }, ...ITEM_PROPS },
          required: ["index", "category", "urgency", "route_to", "summary_en", "draft_vi"],
        },
      },
    },
    required: ["items"],
  },
};

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

export default async (req, context = {}) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  // Prefer Hermes Desk's own Claude API key. Fall back to Netlify AI Gateway if it is not set.
  const ownKey = process.env.HERMES_ANTHROPIC_API_KEY;
  const key = ownKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return json(503, { error: "The demo is offline right now." });
  const route = ownKey ? "anthropic-api" : "netlify-gateway";

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Send JSON with a message field." });
  }

  // Inbox mode: several messages sorted in one Claude call.
  const batch = Array.isArray(body && body.messages) ? body.messages : null;
  let userContent, tool;
  if (batch) {
    const msgs = batch
      .slice(0, MAX_BATCH + 1)
      .map((m) => ({ from: String((m && m.from) || "").slice(0, 40).trim(), text: String((m && m.text) || "").trim() }));
    if (!msgs.length || msgs.length > MAX_BATCH) return json(400, { error: `Send 1 to ${MAX_BATCH} messages.` });
    if (msgs.some((m) => !m.text || m.text.length > MAX_INPUT))
      return json(400, { error: `Each message must be 1 to ${MAX_INPUT} characters.` });
    userContent = msgs.map((m, i) => `Message ${i + 1}${m.from ? ` (from ${m.from})` : ""}:\n${m.text}`).join("\n\n");
    tool = INBOX_TOOL;
  } else {
    const message = String((body && body.message) || "").trim();
    if (!message) return json(400, { error: "Type a message to sort." });
    if (message.length > MAX_INPUT)
      return json(400, { error: `Keep the message under ${MAX_INPUT} characters.` });
    userContent = message;
    tool = ROUTE_TOOL;
  }

  if (await overLimit(context.ip)) return json(429, { error: "The demo has reached today's limit." });

  // On Netlify, AI Gateway provides ANTHROPIC_BASE_URL alongside the key.
  const base = (ownKey ? "https://api.anthropic.com" : process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const started = Date.now();
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: batch ? 3000 : 1024,
      system: batch ? `${SYSTEM}\n\n${INBOX_NOTE}` : SYSTEM,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const ms = Date.now() - started;

  if (!res.ok) {
    console.error("Claude API error", res.status, (await res.text()).slice(0, 500));
    return json(502, { error: "Claude could not process this message. Try again in a moment." });
  }

  const data = await res.json();
  const call = (data.content || []).find((b) => b.type === "tool_use" && b.name === tool.name);
  const out = call && call.input;
  const usage = data.usage ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens } : undefined;
  const pick = (o) => ({ category: o.category, urgency: o.urgency, route_to: o.route_to, summary_en: o.summary_en, draft_vi: o.draft_vi });

  if (batch) {
    const items = out && Array.isArray(out.items) ? out.items.filter((o) => o && o.category && o.draft_vi) : [];
    if (!items.length) {
      console.error("Unexpected Claude response", JSON.stringify(data).slice(0, 800));
      return json(502, { error: "Claude's answer could not be read. Try again." });
    }
    return json(200, {
      items: items.map((o) => ({ index: Number(o.index), ...pick(o) })),
      model: MODEL, ms, usage,
    }, { "x-hermes-route": route });
  }

  if (!out || !out.category || !out.draft_vi) {
    console.error("Unexpected Claude response", JSON.stringify(data).slice(0, 800));
    return json(502, { error: "Claude's answer could not be read. Try again." });
  }
  return json(200, { ...pick(out), model: MODEL, ms, usage }, { "x-hermes-route": route });
};

export const config = { path: "/api/classify" };
