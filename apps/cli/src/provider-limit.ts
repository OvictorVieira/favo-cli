import type { ProviderId } from '@favo/domain/providers/provider';

const MaxLimitTextLength = 4_096;
const AnsiControl = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const SharedLimitSignals = [
  /\b(?:rate_limit_exceeded|rate_limit_error|usage_limit_exceeded|insufficient_quota|RESOURCE_EXHAUSTED)\b/i,
  /\b(?:HTTP|status(?: code)?|error)[:\s]+429\b/i,
  /\btoo many requests\b/i,
  /you (?:have )?exceeded your (?:current )?quota/i,
  /\b(?:RateLimitError|QuotaExceededError)\b/i,
];
const LimitSignals: Record<ProviderId, RegExp[]> = {
  claude: [
    /you(?:'ve| have) hit your (?:usage|message|\d+-hour|weekly|monthly) limit/i,
    /you(?:'ve| have) hit your limit\s*[·.]?\s*resets\b/i,
    /you(?:'ve| have) reached your usage limit/i,
    /(?:usage|message) limit (?:reached|exceeded)/i,
  ],
  codex: [
    /rate limit exceeded/i,
    /you(?:'ve| have) (?:hit|reached) your (?:usage|weekly|monthly) limit/i,
    /(?:usage|weekly|monthly) limit (?:reached|exceeded)/i,
  ],
  antigravity: [
    /quota (?:has been )?(?:exceeded|reached)/i,
    /you(?:'ve| have) (?:hit|reached) (?:your )?(?:quota|rate limit)/i,
    /rate limit exceeded/i,
    /you (?:have )?exhausted your capacity (?:on|for) this model/i,
  ],
  opencode: [
    /(?:rate|usage|provider|go|account|free tier) limit (?:reached|exceeded)/i,
    /quota (?:has been )?(?:exceeded|reached)/i,
    /too many requests/i,
  ],
  cursor: [
    /you(?:'ve| have) (?:hit|reached) your usage limit/i,
    /you(?:'ve| have) used all (?:of )?your (?:included )?requests/i,
    /(?:usage|rate) limit (?:reached|exceeded)/i,
    /rate limit exceeded/i,
  ],
  copilot: [
    /you(?:'ve| have) (?:hit|reached) (?:the|your) (?:\w+ )?(?:rate|premium request|usage) limit/i,
    /rate limit exceeded/i,
    /(?:premium requests?|quota) (?:exhausted|exceeded)/i,
    /you (?:have )?exhausted your premium request allowance/i,
  ],
};

export class ProviderLimitDetector {
  private output = '';
  private readonly decoder = new TextDecoder();

  constructor(private readonly provider: ProviderId) {}

  write(chunk: string | Uint8Array) {
    const text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    this.output = `${this.output}${text}`.slice(-MaxLimitTextLength);
    const normalized = this.output
      .replace(AnsiControl, '')
      .replace(/[’‘ʼ＇]/g, "'")
      .replace(/\s+/g, ' ');
    return [...SharedLimitSignals, ...LimitSignals[this.provider]].some((signal) => signal.test(normalized));
  }
}
