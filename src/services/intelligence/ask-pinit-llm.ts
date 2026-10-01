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
