// Hermes Desk prototype: classify one incoming customer message and draft a reply.
// Runs as a Netlify Function at /api/classify. Needs ANTHROPIC_API_KEY in the site's environment.

const MODEL = process.env.HERMES_MODEL || "claude-haiku-5-5";
const MAX_INPUT = 600;

const SYSTEM = `You are Hermes Desk, the AI assistant of a coordinator for real estate sales teams in Vietnam.
The coordinator sits between buyers, sales agents and the billing team, and receives messages in Vietnamese.

For the incoming message, decide:
- category: "lead" (a buyer asking about a property, price, viewing, availability), "complaint" (dissatisfaction, delays, broken promises), "billing" (bills, deposits, payments, invoices, receipts), or "other".
- urgency: "high", "medium" or "low". Complaints about repeated failures, and buyers ready to view or deposit, are high.
- route_to: "sales_agent", "team_lead" (for complaints that need escalation), "billing", or "coordinator".
- summary_en: one short English sentence describing the message.
- draft_vi: a short, polite reply in natural Vietnamese, in the voice of the coordinator, ready for a human to review. Never promise prices, availability or dates you were not given; say the coordinator will confirm instead.

Respond with only a JSON object with exactly these keys: category, urgency, route_to, summary_en, draft_vi.`;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(503, { error: "The demo is offline right now." });

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

  // On Netlify, AI Gateway provides ANTHROPIC_BASE_URL alongside the key.
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!res.ok) {
    console.error("Claude API error", res.status, (await res.text()).slice(0, 500));
    return json(502, { error: "Claude could not process this message. Try again in a moment." });
  }

  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("").trim();
  const match = text.match(/\{[\s\S]*\}/);
  try {
    const out = JSON.parse(match ? match[0] : text);
    return json(200, {
      category: out.category,
      urgency: out.urgency,
      route_to: out.route_to,
      summary_en: out.summary_en,
      draft_vi: out.draft_vi,
      model: MODEL,
    });
  } catch {
    return json(502, { error: "Claude's answer could not be read. Try again." });
  }
};

export const config = { path: "/api/classify" };
