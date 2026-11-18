import { describe, expect, test } from 'bun:test';
import { ProviderLimitDetector } from '@/provider-limit';

describe('provider rate-limit detection', () => {
  test('recognizes a Claude usage limit across terminal output chunks', () => {
    const detector = new ProviderLimitDetector('claude');

    expect(detector.write('You have hit your usage ')).toBe(false);
    expect(detector.write('\u001b[31mlimit\u001b[0m. It resets in 4 hours.')).toBe(true);
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
