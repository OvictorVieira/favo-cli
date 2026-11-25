import { describe, expect, test } from 'bun:test';
import { ProviderLimitDetector } from '@/provider-limit';

describe('provider rate-limit detection', () => {
  test.each([
    ['claude', 'You’ve hit your 5-hour limit · resets 12:20am'],
    ['codex', 'You’ve hit your usage limit. Upgrade to Pro or try again later.'],
    ['antigravity', 'You’ve hit your rate limit.'],
    ['cursor', 'You’ve hit your usage limit.'],
    ['copilot', 'You’ve reached your weekly rate limit.'],
  ] as const)('recognizes typographic apostrophes in the %s notice', (provider, notice) => {
    expect(new ProviderLimitDetector(provider).write(notice)).toBe(true);
  });

  test('recognizes the Codex notice when a UTF-8 apostrophe arrives across output chunks', () => {
    const bytes = new TextEncoder().encode('You’ve hit your usage limit.');
    for (let split = 1; split < bytes.length; split++) {
      const detector = new ProviderLimitDetector('codex');
      detector.write(bytes.slice(0, split));
      expect(detector.write(bytes.slice(split))).toBe(true);
    }
  });

  test('recognizes the Codex exhausted-usage error code', () => {
    expect(new ProviderLimitDetector('codex').write('usage_limit_exceeded')).toBe(true);
  });

  test('recognizes a Claude usage limit across terminal output chunks', () => {
    const detector = new ProviderLimitDetector('claude');

    expect(detector.write('You have hit your usage ')).toBe(false);
    expect(detector.write('\u001b[31mlimit\u001b[0m. It resets in 4 hours.')).toBe(true);
  });

  test.each([
    "You've hit your 5-hour limit · resets 12:20am (America/Sao_Paulo)",
    "You've hit your weekly limit · resets Nov 25",
    "You've hit your limit · resets 12:20am (America/Sao_Paulo)",
  ])('recognizes the Claude exhausted-session notice: %s', (message) => {
    expect(new ProviderLimitDetector('claude').write(message)).toBe(true);
  });

  test.each(['claude', 'codex', 'antigravity', 'opencode', 'cursor', 'copilot'] as const)(
    'recognizes structured limit errors from %s even while it retries',
    (provider) => {
      expect(new ProviderLimitDetector(provider).write('Error: 429 · retrying in 30s')).toBe(true);
      expect(new ProviderLimitDetector(provider).write('rate_limit_exceeded')).toBe(true);
      expect(new ProviderLimitDetector(provider).write('RESOURCE_EXHAUSTED: quota exceeded')).toBe(true);
      expect(new ProviderLimitDetector(provider).write('Retrying in 30s after a connection timeout')).toBe(false);
    }
  );

  test('recognizes an OpenCode rate limit split by terminal redraws and newlines', () => {
    const detector = new ProviderLimitDetector('opencode');
    expect(detector.write('Rate \u001b[')).toBe(false);
    expect(detector.write('31mlimit\nreached · retrying in 30s')).toBe(true);
  });

  test('recognizes a Codex rate limit message', () => {
    const detector = new ProviderLimitDetector('codex');

    expect(detector.write('Rate limit exceeded. Try again later.')).toBe(true);
  });

  test('does not treat ordinary discussion of a limit as an exhausted session', () => {
    const detector = new ProviderLimitDetector('claude');

    expect(detector.write('Please add rate limit handling to the API client.')).toBe(false);
  });

  test.each([
    ['antigravity', 'Quota exceeded for this model.'],
    ['antigravity', "You've hit your rate limit."],
    ['opencode', 'Rate limit reached, retrying in 30s'],
    ['opencode', 'Too many requests'],
    ['opencode', 'Go limit reached'],
    ['opencode', 'Free tier limit reached'],
    ['opencode', 'You exceeded your current quota, please check your plan and billing details.'],
    ['cursor', "You've hit your usage limit"],
    ['copilot', "You've hit the rate limit for this model."],
    ['copilot', "You've hit your session rate limit."],
    ['copilot', "You've reached your weekly rate limit."],
    ['copilot', "You've hit your rate limit."],
  ] as const)('recognizes the %s message "%s"', (provider, message) => {
    expect(new ProviderLimitDetector(provider).write(message)).toBe(true);
  });

  test.each([
    ['cursor', 'Add a usage limit to the billing page.'],
    ['copilot', 'Please add a rate limit to this endpoint.'],
    ['opencode', 'The provider returned a list of requests.'],
    ['antigravity', 'Increase the quota in the config file.'],
  ] as const)('does not mistake ordinary %s output for a limit: "%s"', (provider, text) => {
    expect(new ProviderLimitDetector(provider).write(text)).toBe(false);
  });

  test('reads output that arrives as bytes', () => {
    const detector = new ProviderLimitDetector('copilot');

    expect(detector.write(new TextEncoder().encode("You've hit your rate limit."))).toBe(true);
  });

  test('forgets a limit message once enough later output has scrolled it away', () => {
    const detector = new ProviderLimitDetector('claude');

    expect(detector.write('You have hit your usage limit.')).toBe(true);
    expect(detector.write('x'.repeat(5_000))).toBe(false);
  });
});
