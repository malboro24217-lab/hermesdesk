// Hermes Desk prototype: classify one incoming customer message and draft a reply.
// Runs as a Netlify Function at /api/classify. Needs ANTHROPIC_API_KEY in the site's environment.

import { getStore } from "@netlify/blobs";

const MODEL = process.env.HERMES_MODEL || "claude-haiku-5-5";
const MAX_INPUT = 600;
const PER_IP_PER_DAY = 15;
const ALL_PER_DAY = 400;

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
The coordinator sits between buyers, sales agents and the billing team, and receives messages in Vietnamese.

For the incoming message, decide:
- category: "lead" (a buyer asking about a property, price, viewing, availability), "complaint" (dissatisfaction, delays, broken promises), "billing" (bills, deposits, payments, invoices, receipts), or "other".
- urgency: "high", "medium" or "low". Complaints about repeated failures, and buyers ready to view or deposit, are high.
- route_to: "sales_agent", "team_lead" (for complaints that need escalation), "billing", or "coordinator".
- summary_en: one short English sentence describing the message.
- draft_vi: a short, polite reply in natural Vietnamese, in the voice of the coordinator, ready for a human to review. Never promise prices, availability or dates you were not given; say the coordinator will confirm instead.

Record your decision with the route_message tool.`;

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

  let message = "";
  try {
    ({ message = "" } = await req.json());
  } catch {
    return json(400, { error: "Send JSON with a message field." });
  }
  message = String(message).trim();
  if (!message) return json(400, { error: "Type a message to sort." });
  if (message.length > MAX_INPUT)
    return json(400, { error: `Keep the message under ${MAX_INPUT} characters.` });

  if (await overLimit(context.ip)) return json(429, { error: "The demo has reached today's limit." });

  // On Netlify, AI Gateway provides ANTHROPIC_BASE_URL alongside the key.
  const base = (ownKey ? "https://api.anthropic.com" : process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [ROUTE_TOOL],
      tool_choice: { type: "tool", name: ROUTE_TOOL.name },
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!res.ok) {
    console.error("Claude API error", res.status, (await res.text()).slice(0, 500));
    return json(502, { error: "Claude could not process this message. Try again in a moment." });
  }

  const data = await res.json();
  const call = (data.content || []).find((b) => b.type === "tool_use" && b.name === ROUTE_TOOL.name);
  const out = call && call.input;
  if (!out || !out.category || !out.draft_vi) {
    console.error("Unexpected Claude response", JSON.stringify(data).slice(0, 800));
    return json(502, { error: "Claude's answer could not be read. Try again." });
  }
  return json(200, {
    category: out.category,
    urgency: out.urgency,
    route_to: out.route_to,
    summary_en: out.summary_en,
    draft_vi: out.draft_vi,
    model: MODEL,
  }, { "x-hermes-route": route });
};

export const config = { path: "/api/classify" };
