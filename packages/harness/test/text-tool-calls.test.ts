/**
 * Text-embedded tool call recovery.
 *
 * The parser sits on the path between model text and real tool execution, so
 * its failure modes are asymmetric:
 *
 * - A **false negative** costs one failed step. Annoying, recoverable.
 * - A **false positive** runs a tool the user never approved. Unacceptable.
 *
 * The tests therefore weight the "must not fire" cases at least as heavily as
 * the "must fire" ones. Every rejection test uses text a model might plausibly
 * produce, not strawmen.
 * @module
 */

import { describe, expect, it } from 'vitest';

import { recoverTextToolCalls, stripTextToolCalls } from '../src/model/text-tool-calls.js';

const OFFERED = [
  { name: 'fs.write', description: 'Write a file', parameters: {} },
  { name: 'fs.mkdir', description: 'Create a directory', parameters: {} },
  { name: 'shell.exec', description: 'Run a command', parameters: {} },
];

describe('recoverTextToolCalls — fires on observed shapes', () => {
  it('recovers the bare one-line object qwen actually emits', () => {
    // Measured verbatim from qwen2.5-coder:7b on Ollama 0.40.2.
    const calls = recoverTextToolCalls(
      '{"tool":"fs.write","arguments":{"path":"hello.txt","content":"hi"}}',
      OFFERED,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('fs.write');
    expect(calls[0]?.arguments).toEqual({ path: 'hello.txt', content: 'hi' });
  });

  it('recovers a fenced json block', () => {
    const calls = recoverTextToolCalls(
      'I will write the file now.\n```json\n{"tool":"fs.write","arguments":{"path":"a.txt","content":"x"}}\n```',
      OFFERED,
    );
    expect(calls[0]?.name).toBe('fs.write');
  });

  it('recovers a qwen <tool_call> block', () => {
    const calls = recoverTextToolCalls(
      '<tool_call>\n{"tool":"fs.write","arguments":{"path":"a.txt"}}\n</tool_call>',
      OFFERED,
    );
    expect(calls[0]?.name).toBe('fs.write');
  });

  it('accepts the OpenAI-style nested function name', () => {
    const calls = recoverTextToolCalls(
      '{"function":{"name":"shell.exec"},"arguments":{"command":"ls"}}',
      OFFERED,
    );
    expect(calls[0]?.name).toBe('shell.exec');
  });

  it('parses arguments delivered as a JSON string', () => {
    const calls = recoverTextToolCalls(
      '{"tool":"fs.write","arguments":"{\\"path\\":\\"a.txt\\",\\"content\\":\\"y\\"}"}',
      OFFERED,
    );
    expect(calls[0]?.arguments).toEqual({ path: 'a.txt', content: 'y' });
  });

  it('accepts a plain string list of offered names', () => {
    expect(recoverTextToolCalls('{"tool":"fs.write","arguments":{}}', ['fs.write'])).toHaveLength(1);
  });

  it('defaults missing arguments to an empty object rather than dropping the call', () => {
    const calls = recoverTextToolCalls('{"tool":"fs.write"}', OFFERED);
    expect(calls[0]?.arguments).toEqual({});
  });

  it('keeps the first occurrence when a model repeats a call', () => {
    const calls = recoverTextToolCalls(
      '{"tool":"fs.write","arguments":{"path":"first"}}\n{"tool":"fs.write","arguments":{"path":"second"}}',
      OFFERED,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.arguments).toEqual({ path: 'first' });
  });

  it('recovers several distinct calls', () => {
    const calls = recoverTextToolCalls(
      '{"tool":"fs.write","arguments":{"path":"a"}}\n{"tool":"shell.exec","arguments":{"command":"ls"}}',
      OFFERED,
    );
    expect(calls.map((c) => c.name)).toEqual(['fs.write', 'shell.exec']);
  });
});

describe('recoverTextToolCalls — must NOT fire', () => {
  it('ignores a hallucinated tool name', () => {
    // The single most important rejection: forwarding this would attempt a tool
    // that was never offered.
    expect(recoverTextToolCalls('{"tool":"rm_rf_everything","arguments":{}}', OFFERED)).toEqual([]);
  });

  it('ignores prose that merely mentions a tool', () => {
    expect(
      recoverTextToolCalls('I will use the fs.write tool to create the file, then verify it.', OFFERED),
    ).toEqual([]);
  });

  it('ignores ordinary prose with braces that is not a call', () => {
    expect(recoverTextToolCalls('The config object looks like { "key": "value" } in this file.', OFFERED)).toEqual([]);
  });

  it('ignores a code block that is source code, not a call', () => {
    const code = '```js\nconst fs = require("fs");\nfs.writeFileSync("a", "b");\n```';
    expect(recoverTextToolCalls(code, OFFERED)).toEqual([]);
  });

  it('ignores a JSON object with no tool key at all', () => {
    expect(recoverTextToolCalls('{"path":"a.txt","content":"b"}', OFFERED)).toEqual([]);
  });

  it('ignores structurally broken JSON', () => {
    // The truncated form is handled separately (see the streaming suite) because
    // a tool name is present and the call is worth recovering. What must never
    // fire is text where the structure itself is broken.
    expect(recoverTextToolCalls('{"tool":}', OFFERED)).toEqual([]);
    expect(recoverTextToolCalls('{"tool" "fs.write"}', OFFERED)).toEqual([]);
    expect(recoverTextToolCalls('{tool: fs.write}', OFFERED)).toEqual([]);
  });

  it('ignores anything at all when no tools were offered', () => {
    // Defence in depth: even a perfect match is not a call if there is nothing
    // to call.
    expect(recoverTextToolCalls('{"tool":"fs.write","arguments":{}}', [])).toEqual([]);
  });

  it('ignores empty and whitespace input', () => {
    expect(recoverTextToolCalls('', OFFERED)).toEqual([]);
    expect(recoverTextToolCalls('   \n  ', OFFERED)).toEqual([]);
  });

  it('ignores text with no object at all', () => {
    expect(recoverTextToolCalls('Done. The file has been created.', OFFERED)).toEqual([]);
  });

  it('ignores a tool name that is an empty string', () => {
    expect(recoverTextToolCalls('{"tool":"","arguments":{}}', OFFERED)).toEqual([]);
  });

  it('does not resurrect a name merely because a substring matches', () => {
    expect(recoverTextToolCalls('{"tool":"fs.writeX","arguments":{}}', OFFERED)).toEqual([]);
  });
});

describe('stripTextToolCalls', () => {
  it('removes the call so the user reads narration only', () => {
    const text = 'Creating the file.\n```json\n{"tool":"fs.write","arguments":{"path":"a"}}\n```';
    const stripped = stripTextToolCalls(text);
    expect(stripped).toContain('Creating the file.');
    expect(stripped).not.toContain('fs.write');
  });

  it('removes a bare object line', () => {
    const stripped = stripTextToolCalls('Working now.\n{"tool":"fs.write","arguments":{}}\nDone.');
    expect(stripped).not.toContain('fs.write');
    expect(stripped).toContain('Done.');
  });

  it('leaves unrelated prose untouched', () => {
    const text = 'The file was created successfully.';
    expect(stripTextToolCalls(text)).toBe(text);
  });

  it('cleans up an unterminated fence', () => {
    const stripped = stripTextToolCalls('text\n```json\n{"tool":"fs.write","arguments":{}}');
    expect(stripped).not.toContain('```');
  });
});

describe('round trip', () => {
  it('strip then re-parse finds nothing, so a call cannot fire twice', () => {
    // Matters because the conversation is replayed into later turns; a call left
    // in the transcript could be re-executed.
    const original = '{"tool":"fs.write","arguments":{"path":"a.txt"}}';
    expect(recoverTextToolCalls(original, OFFERED)).toHaveLength(1);
    const stripped = stripTextToolCalls(original);
    expect(recoverTextToolCalls(stripped, OFFERED)).toEqual([]);
  });

  it('is stable across repeated strip calls', () => {
    const text = '```json\n{"tool":"fs.write","arguments":{}}\n```';
    expect(stripTextToolCalls(stripTextToolCalls(text))).toBe(stripTextToolCalls(text));
  });
});
describe('recoverTextToolCalls — observed qwen shapes', () => {
  it('recovers the brace-escaped fenced form', () => {
    // Measured verbatim: the model doubles braces when taught to emit JSON in a
    // template. `{{...}}` is not valid JSON, so this needs the unwrap path.
    const calls = recoverTextToolCalls(
      '```json\n{{"name": "fs.mkdir", "arguments": {"path": "src"}}}\n```',
      OFFERED,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('fs.mkdir');
    expect(calls[0]?.arguments).toEqual({ path: 'src' });
  });

  it('recovers the self-invented <tools> wrapper with doubled braces', () => {
    // Measured verbatim: the model wraps its call in a tag it made up, while
    // emitting `tools` in the request.
    const calls = recoverTextToolCalls(
      '<tools>{{"name": "fs.mkdir", "arguments": {"path": "src"}}}</tools>',
      OFFERED,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('fs.mkdir');
    expect(calls[0]?.arguments).toEqual({ path: 'src' });
  });

  it('does not mangle a normal object that merely contains a nested object', () => {
    // The unwrap must only fire on `{{...}}`, never on a single-brace object
    // whose *value* is an object.
    const calls = recoverTextToolCalls(
      '{"tool":"fs.write","arguments":{"meta":{"a":1},"path":"a.txt"}}',
      OFFERED,
    );
    expect(calls[0]?.arguments).toEqual({ meta: { a: 1 }, path: 'a.txt' });
  });

  it('still rejects garbage that unwrapping cannot rescue', () => {
    expect(recoverTextToolCalls('{{not json at all}}', OFFERED)).toEqual([]);
  });
});

describe('recoverTextToolCalls — streaming shapes', () => {
  it('recovers a call wrapped in the <response> tag seen in streaming mode', () => {
    // Measured verbatim from Camelia's own SSE request. Non-streaming and
    // streaming requests produce *different* shapes from the same model, which
    // is why both are pinned by tests.
    const calls = recoverTextToolCalls(
      '<response>\n  {"name": "fs.mkdir", "arguments": {"path": "src"}}\n</response>',
      OFFERED,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('fs.mkdir');
  });

  it('recovers a call the stream cut off mid-object', () => {
    // The same response, truncated by the token limit: no closing tag, no
    // closing braces. Discarding it would throw away the call the model was
    // making.
    const calls = recoverTextToolCalls(
      '<response>\n  {"name": "fs.mkdir", "arguments": {"path": "src"',
      OFFERED,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('fs.mkdir');
    expect(calls[0]?.arguments).toEqual({ path: 'src' });
  });

  it('recovers a call truncated after a complete argument value', () => {
    const calls = recoverTextToolCalls('{"tool":"fs.write","arguments":{"path":"a.txt"', OFFERED);
    expect(calls[0]?.name).toBe('fs.write');
    expect(calls[0]?.arguments).toEqual({ path: 'a.txt' });
  });

  it('drops a dangling key rather than inventing a value for it', () => {
    // Repairing `"path":` into `"path": ""` would fabricate an argument the
    // model never chose — and writing to the wrong path is worse than not
    // calling at all.
    const calls = recoverTextToolCalls('{"tool":"fs.write","arguments":{"path":', OFFERED);
    expect(calls[0]?.arguments).toEqual({});
  });

  it('still refuses a truncated object with no usable identity', () => {
    expect(recoverTextToolCalls('{"tool":"fs.wri', OFFERED)).toEqual([]);
  });
});

describe('stripTextToolCalls — streaming shapes', () => {
  it('removes a complete <response> wrapper', () => {
    const stripped = stripTextToolCalls('Working.\n<response>\n{"name":"fs.mkdir","arguments":{}}\n</response>');
    expect(stripped).toContain('Working.');
    expect(stripped).not.toContain('fs.mkdir');
    expect(stripped).not.toContain('<response>');
  });

  it('removes a truncated <response> wrapper', () => {
    const stripped = stripTextToolCalls('Working.\n<response>\n{"name":"fs.mkdir"');
    expect(stripped).not.toContain('<response>');
    expect(stripped).not.toContain('fs.mkdir');
  });
});
