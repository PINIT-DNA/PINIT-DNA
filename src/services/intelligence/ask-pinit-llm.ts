/**
 * Optional evidence-grounded polish. Never a source of facts.
 * If no API key is configured, the deterministic draft is used as-is.
 */
export interface LlmProvider {
  polish(input: { question: string; evidence: string; draft: string }): Promise<string | null>;
}

class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly url: string,
  ) {}

  async polish(input: { question: string; evidence: string; draft: string }): Promise<string | null> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You are PINIT Intelligence. Answer only from retrieved evidence and the draft. Never invent locations, people, times, recipients, or counts. Copy numbers from evidence (totalShareLinks, activeLinks, totalViews, totalDownloads) exactly. If a value is not recorded, say so. Reply in concise plain text, no markdown.',
          },
          {
            role: 'user',
            content: `Question:\n${input.question}\n\nEvidence:\n${input.evidence}\n\nDraft answer:\n${input.draft}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim();
    return text || null;
  }
}

export function createLlmProvider(): LlmProvider | null {
  const key = (process.env.OPENAI_API_KEY || process.env.PINIT_LLM_API_KEY || '').trim();
  if (!key) return null;
  const model = (process.env.OPENAI_MODEL || process.env.PINIT_LLM_MODEL || 'gpt-4o-mini').trim();
  const url = (process.env.PINIT_LLM_URL || 'https://api.openai.com/v1/chat/completions').trim();
  return new OpenAiCompatibleProvider(key, model, url);
}

function llmConfig() {
  const apiKey = (process.env.OPENAI_API_KEY || process.env.PINIT_LLM_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    apiKey,
    model: (process.env.OPENAI_MODEL || process.env.PINIT_LLM_MODEL || 'gpt-4o-mini').trim(),
    url: (process.env.PINIT_LLM_URL || 'https://api.openai.com/v1/chat/completions').trim(),
  };
}

async function chatText(messages: Array<{ role: string; content: unknown }>): Promise<string | null> {
  const cfg = llmConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: cfg.model, temperature: 0.2, max_tokens: 180, messages }),
    });
    if (!res.ok) return null;
    const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function describeFromImage(jpegBase64: string): Promise<string | null> {
  return chatText([
    {
      role: 'system',
      content:
        'Describe a protected asset the way Google or ChatGPT would: what it is (fashion photo, sketch, painting, landscape, passport, invoice, etc.) and the main visible details. Exactly two short first-person sentences starting with “I…”. Do not invent names, cities, or dates. Never read ID numbers, MRZ codes, or passport personal data. No markdown or bullet lists.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What is this asset? Describe it in exactly two short sentences.' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
      ],
    },
  ]);
}

export async function describeFromDocumentText(excerpt: string): Promise<string | null> {
  return chatText([
    {
      role: 'system',
      content:
        'Say what kind of document this is (invoice, letter, certificate, sketch notes, passport, etc.) in exactly two short first-person sentences. Use only the excerpt. Never copy ID numbers, account numbers, or personal names from identity documents. No markdown.',
    },
    {
      role: 'user',
      content: `Document text excerpt:\n${excerpt.slice(0, 4000)}\n\nWrite exactly two short sentences about what this document is.`,
    },
  ]);
}
