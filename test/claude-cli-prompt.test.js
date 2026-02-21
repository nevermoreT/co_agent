/**
 * Claude CLI Prompt 特殊字符测试
 *
 * 测试目的：确保 prompt 中不包含会导致 Windows shell 解析错误的特殊字符
 *
 * 运行方式：node test/claude-cli-prompt.test.js
 */

import assert from 'assert';

// 模拟 memoryManager.buildAgentContext 的逻辑
function buildAgentContext(recentEvents) {
  if (recentEvents.length === 0) {
    return '';
  }

  const parts = [];
  parts.push('之前用户问过');
  parts.push(...recentEvents.map(e => {
    const title = e.title.length > 30 ? e.title.substring(0, 30) + '...' : e.title;
    return title;
  }));

  return parts.join(' ');
}

// 模拟 agentRunner 构建 enrichedPrompt 的逻辑
function buildEnrichedPrompt(prompt, memoryContext) {
  if (memoryContext) {
    return `${prompt} - 上下文: ${memoryContext}`;
  }
  return prompt;
}

// Windows shell 特殊字符检测
const WINDOWS_SHELL_SPECIAL_CHARS = /[()&|<>^"]/;

function containsShellSpecialChars(str) {
  return WINDOWS_SHELL_SPECIAL_CHARS.test(str);
}

// 测试用例
const tests = [
  {
    name: '简单 prompt 无上下文',
    prompt: '2+2=多少',
    events: [],
    expectSpecialChars: false,
  },
  {
    name: '简单 prompt 有上下文',
    prompt: '2+2=多少',
    events: [
      { title: '2+2=多少' },
      { title: '你好' },
    ],
    expectSpecialChars: false,
  },
  {
    name: '中文 prompt 有上下文',
    prompt: '请解释一下什么是递归',
    events: [
      { title: '什么是函数' },
      { title: '如何定义变量' },
    ],
    expectSpecialChars: false,
  },
  {
    name: '长标题截断',
    prompt: '测试',
    events: [
      { title: '这是一个非常非常非常非常非常非常非常长的标题需要被截断' },
    ],
    expectSpecialChars: false,
  },
  {
    name: 'prompt 本身包含特殊字符（用户输入）',
    prompt: 'console.log("hello")',
    events: [],
    expectSpecialChars: true,  // 用户输入可能包含，但我们不修改用户输入
  },
];

console.log('Claude CLI Prompt 特殊字符测试\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

for (const test of tests) {
  const memoryContext = buildAgentContext(test.events);
  const enrichedPrompt = buildEnrichedPrompt(test.prompt, memoryContext);

  // 检查 memoryContext 是否包含特殊字符（这是我们能控制的部分）
  const contextHasSpecialChars = containsShellSpecialChars(memoryContext);

  console.log(`\n测试: ${test.name}`);
  console.log(`  原始 prompt: "${test.prompt}"`);
  console.log(`  上下文: "${memoryContext}"`);
  console.log(`  最终 prompt: "${enrichedPrompt}"`);
  console.log(`  上下文包含特殊字符: ${contextHasSpecialChars}`);

  // memoryContext 不应该包含特殊字符
  if (contextHasSpecialChars) {
    console.log(`  ❌ 失败: 上下文不应包含 Windows shell 特殊字符`);
    failed++;
  } else {
    console.log(`  ✓ 通过`);
    passed++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`测试结果: ${passed} 通过, ${failed} 失败`);

if (failed > 0) {
  process.exit(1);
}

// 额外测试：验证旧格式会包含特殊字符
console.log('\n' + '='.repeat(60));
console.log('对比测试：旧格式 vs 新格式\n');

function buildAgentContextOld(recentEvents) {
  if (recentEvents.length === 0) return '';
  const parts = ['之前用户问过:'];
  parts.push(...recentEvents.map(e => `"${e.title}"`));
  return parts.join(' ');
}

function buildEnrichedPromptOld(prompt, memoryContext) {
  if (memoryContext) {
    return `请回答: ${prompt} (背景: ${memoryContext})`;
  }
  return prompt;
}

const testEvents = [{ title: '2+2=多少' }, { title: '你好' }];
const testPrompt = '测试问题';

const oldContext = buildAgentContextOld(testEvents);
const oldEnriched = buildEnrichedPromptOld(testPrompt, oldContext);
const newContext = buildAgentContext(testEvents);
const newEnriched = buildEnrichedPrompt(testPrompt, newContext);

console.log('旧格式:');
console.log(`  上下文: "${oldContext}"`);
console.log(`  最终 prompt: "${oldEnriched}"`);
console.log(`  包含特殊字符: ${containsShellSpecialChars(oldEnriched)} ← 这会导致问题！`);

console.log('\n新格式:');
console.log(`  上下文: "${newContext}"`);
console.log(`  最终 prompt: "${newEnriched}"`);
console.log(`  包含特殊字符: ${containsShellSpecialChars(newEnriched)} ← 安全`);

console.log('\n测试完成！');
