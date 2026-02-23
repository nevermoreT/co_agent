/**
 * Claude CLI Prompt 特殊字符测试
 *
 * 测试目的：确保 prompt 中不包含会导致 Windows shell 解析错误的特殊字符
 *
 * 运行方式：node test/claude-cli-prompt.test.js
 */

import assert from 'assert';

// 模拟 memoryManager.buildAgentContext 的新逻辑
function buildAgentContext(recentMessages) {
  if (recentMessages.length === 0) {
    return '';
  }

  // 构建对话摘要，将问答配对
  const dialogues = [];
  for (let i = 0; i < recentMessages.length; i++) {
    const msg = recentMessages[i];
    if (msg.role === 'user') {
      let question = msg.content.replace(/^@[\w\s]+\s+/, '').trim();
      if (question.length > 50) {
        question = question.substring(0, 50) + '...';
      }

      const targetAgent = msg.agent_name || '未知';

      const nextMsg = recentMessages[i + 1];
      if (nextMsg && nextMsg.role === 'assistant') {
        let answer = nextMsg.content.trim();
        if (answer.length > 100) {
          answer = answer.substring(0, 100) + '...';
        }
        const responder = nextMsg.agent_name || '未知';
        dialogues.push(`用户问${targetAgent}: ${question}, ${responder}回答: ${answer}`);
        i++;
      } else {
        dialogues.push(`用户问${targetAgent}: ${question}`);
      }
    }
  }

  if (dialogues.length === 0) {
    return '';
  }

  const recentDialogues = dialogues.slice(-3);
  return '最近对话 - ' + recentDialogues.join('; ');
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
    name: '简单问答对',
    messages: [
      { role: 'user', content: '@Claude CLI 2+2=多少', agent_name: 'Claude CLI' },
      { role: 'assistant', content: '4', agent_name: 'Claude CLI' },
    ],
    expectedContext: '最近对话 - 用户问Claude CLI: 2+2=多少, Claude CLI回答: 4',
  },
  {
    name: '多轮对话',
    messages: [
      { role: 'user', content: '@Claude CLI 你好', agent_name: 'Claude CLI' },
      { role: 'assistant', content: '你好！有什么可以帮你的？', agent_name: 'Claude CLI' },
      { role: 'user', content: '@Opencode CLI 2+2=多少', agent_name: 'Opencode CLI' },
      { role: 'assistant', content: '4', agent_name: 'Opencode CLI' },
    ],
    expectedContext: '最近对话 - 用户问Claude CLI: 你好, Claude CLI回答: 你好！有什么可以帮你的？; 用户问Opencode CLI: 2+2=多少, Opencode CLI回答: 4',
  },
  {
    name: '只有问题没有回答',
    messages: [
      { role: 'user', content: '@Claude CLI 测试问题', agent_name: 'Claude CLI' },
    ],
    expectedContext: '最近对话 - 用户问Claude CLI: 测试问题',
  },
  {
    name: '空消息列表',
    messages: [],
    expectedContext: '',
  },
  {
    name: '长回答截断',
    messages: [
      { role: 'user', content: '@Claude CLI 解释递归', agent_name: 'Claude CLI' },
      { role: 'assistant', content: '递归是一种编程技术，函数在其定义中调用自身。递归需要有基本情况来终止递归，否则会导致无限循环。递归常用于处理树形结构、分治算法等场景。', agent_name: 'Claude CLI' },
    ],
    // 回答会被截断到 100 字符
  },
];

console.log('Claude CLI Prompt 特殊字符测试（新版：包含完整对话上下文）\n');
console.log('='.repeat(70));

let passed = 0;
let failed = 0;

for (const test of tests) {
  const memoryContext = buildAgentContext(test.messages);
  const enrichedPrompt = buildEnrichedPrompt('新问题', memoryContext);

  const contextHasSpecialChars = containsShellSpecialChars(memoryContext);

  console.log(`\n测试: ${test.name}`);
  console.log(`  消息数: ${test.messages.length}`);
  console.log(`  上下文: "${memoryContext}"`);
  console.log(`  最终 prompt: "${enrichedPrompt}"`);
  console.log(`  上下文包含特殊字符: ${contextHasSpecialChars}`);

  if (test.expectedContext !== undefined) {
    if (memoryContext !== test.expectedContext) {
      console.log(`  ❌ 失败: 上下文不匹配`);
      console.log(`    期望: "${test.expectedContext}"`);
      console.log(`    实际: "${memoryContext}"`);
      failed++;
      continue;
    }
  }

  if (contextHasSpecialChars) {
    console.log(`  ❌ 失败: 上下文不应包含 Windows shell 特殊字符`);
    failed++;
  } else {
    console.log(`  ✓ 通过`);
    passed++;
  }
}

console.log('\n' + '='.repeat(70));
console.log(`测试结果: ${passed} 通过, ${failed} 失败`);

if (failed > 0) {
  process.exit(1);
}

// 对比测试
console.log('\n' + '='.repeat(70));
console.log('对比测试：新格式上下文示例\n');

const sampleMessages = [
  { role: 'user', content: '@Claude CLI 2+2=多少', agent_name: 'Claude CLI' },
  { role: 'assistant', content: '4', agent_name: 'Claude CLI' },
  { role: 'user', content: '@Opencode CLI 刚才我问Claude CLI什么', agent_name: 'Opencode CLI' },
];

const context = buildAgentContext(sampleMessages);
const finalPrompt = buildEnrichedPrompt('他答对了吗', context);

console.log('场景: 用户先问 Claude CLI 2+2=多少，然后问 Opencode CLI 刚才问了什么');
console.log(`上下文: "${context}"`);
console.log(`最终 prompt: "${finalPrompt}"`);
console.log(`包含特殊字符: ${containsShellSpecialChars(finalPrompt)}`);

console.log('\n测试完成！');
