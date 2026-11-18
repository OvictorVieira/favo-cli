# 002: chat

favo owns the conversation and the provider runs behind it, so switching provider keeps the chat. This is the design [Cezar](https://github.com/open-mercato/cezar) uses (checked 2026-11-18): every provider CLI runs headless as a persistent process behind one runner seam, its output becomes one event vocabulary, the conversation is stored by the tool and not by the provider, and a switch starts a fresh provider session whose first message carries the conversation as text.

## Goals

1. Open a chat for an account and a provider from the comb. Messages stream into a favo screen.
2. Switch the provider in the middle of the chat. The next provider receives the conversation and carries on.
3. The conversation survives a restart of favo.

## Decisions

- **favo owns the transcript.** One file per conversation under `~/.favo/chats`. A provider's own session id is kept beside it only to resume that same provider.
- **Switching does not resume across providers.** Session ids are not portable. The new provider starts fresh and its first message is the conversation as text, newest messages kept when it is too long (60,000 characters, as Cezar does). Tool inputs, tool results and reasoning are never copied, only what the user and the assistant said.
- **Persistent sessions where the provider has them.** Claude Code, Codex and Copilot keep one live process, like Cezar, and a follow-up is written to it. Cursor and OpenCode only answer one message per process, so each message starts one and continues the chat by its id (`--resume`, `--session`), as Cezar does for Cursor.
- **A provider is told what it has not seen.** favo records how many messages each provider has answered up to. On the next message it receives the ones after that point, so a provider that comes back after another one spoke learns what was said, and one that failed to answer a message gets it again.
- **One runner seam.** `ChatRunner` is a gateway with a real and a test implementation, one real class per provider. Nothing outside `modules/chat/gateways` knows a provider's protocol.
- **One event vocabulary.** Every runner emits `ChatEvent`: text, a finished message, a tool use, the provider's session id, a finished turn, an error. The chat service stores the finished messages.
- **The chat runs on this machine.** The live process belongs to the favo that started it, so a remote machine's chat is not part of this plan. The RPC is routed to `machine` like the others, so a later change can lift this.
- **Reading is polling.** The comb has no stream, only request and answer. The client asks for the events after the last one it saw.
- **Runs as the account.** The runner gets the same binary, environment and isolation arguments as a launch, so the chat uses that account's login. favo still never reads a token.

## Providers and their protocols

Cezar's runners are the reference; each protocol is checked on the real CLI before its runner lands.

| Provider    | Persistent transport                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `claude --print --input-format stream-json --output-format stream-json --verbose --include-partial-messages`, one JSON user message per line on stdin |
| Codex       | `codex app-server`, JSON-RPC over JSONL                                                                                                               |
| Copilot     | `copilot --acp`, Agent Client Protocol (already used for its status)                                                                                  |
| Cursor      | `cursor-agent -p --output-format stream-json`, one process per message, then `--resume`                                                               |
| OpenCode    | `opencode run --format json`, one process per message, then `--session`                                                                               |

Antigravity is left out of this plan.

## Slices

1. Domain: the conversation, the event reducer and the text handed to the next provider.
2. The chat module on the server with the Claude runner, and its RPC methods.
3. The chat screen in the comb: open, send, read, switch provider.
4. Copilot and Codex runners.
5. Cursor and OpenCode runners.

Status: all five slices are done. Claude Code, Codex, Copilot and OpenCode were checked on the real CLI; Cursor was checked up to its usage-limit error, because the account used was at its limit, so its answer events come from Cezar's recorded fixtures.

## Tests

- Domain: the conversation and the handoff text, as a table of inputs and outputs.
- Server: each runner against a scripted process, plus one run against the real CLI, reported apart from `verify`.
- Client: the chat screen in the TUI integration test.

## Not in this plan

- A chat on another machine.
- Permission prompts from a provider. A chat runs with the provider's own default permissions, and a prompt it cannot answer is refused and shown.
- Images and attachments.
