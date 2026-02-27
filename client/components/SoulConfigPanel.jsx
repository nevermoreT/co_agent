import { useState, useEffect } from 'react';
import './SoulConfigPanel.css';

function SoulConfigPanel({ agent, onSave, onClose }) {
  const [soul, setSoul] = useState({});
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 加载模板列表
    fetch('/api/agents/soul-templates')
      .then(res => res.json())
      .then(data => setTemplates(data))
      .catch(err => console.error('Failed to load templates:', err));

    // 加载当前 Agent 的 Soul 配置
    if (agent?.id) {
      fetch(`/api/agents/${agent.id}/soul`)
        .then(res => res.json())
        .then(data => setSoul(data || {}))
        .catch(err => console.error('Failed to load soul:', err));
    }
  }, [agent]);

  const applyTemplate = async (templateKey) => {
    if (!templateKey) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/soul/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateName: templateKey })
      });

      if (!res.ok) throw new Error('Failed to apply template');

      const newSoul = await res.json();
      setSoul(newSoul);
      setSelectedTemplate(templateKey);
    } catch (err) {
      alert('应用模板失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateSoul = (path, value) => {
    setSoul(prev => {
      const newSoul = { ...prev };
      const keys = path.split('.');
      let current = newSoul;

      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = current[keys[i]] || {};
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = value;
      return newSoul;
    });
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(soul)
      });

      if (!res.ok) throw new Error('Failed to save soul');

      const savedSoul = await res.json();
      onSave?.(savedSoul);
      alert('Soul 配置已保存');
    } catch (err) {
      alert('保存失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="soul-config-panel">
      <div className="soul-config-header">
        <h3>Agent Soul 配置 - {agent?.name}</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="soul-config-body">
        {/* 模板选择 */}
        <section className="config-section">
          <h4>从模板开始</h4>
          <select
            value={selectedTemplate}
            onChange={e => applyTemplate(e.target.value)}
            disabled={loading}
          >
            <option value="">选择模板...</option>
            {templates.map(t => (
              <option key={t.key} value={t.key}>{t.name}</option>
            ))}
          </select>
        </section>

        {/* 性格特征 */}
        <section className="config-section">
          <h4>性格特征</h4>
          <div className="form-group">
            <label>性格特点（逗号分隔）</label>
            <input
              type="text"
              value={soul.personality?.traits?.join('、') || ''}
              onChange={e => updateSoul('personality.traits', e.target.value.split('、').filter(Boolean))}
              placeholder="专业、严谨、注重细节"
            />
          </div>
          <div className="form-group">
            <label>交流语调</label>
            <select
              value={soul.personality?.tone || 'formal'}
              onChange={e => updateSoul('personality.tone', e.target.value)}
            >
              <option value="formal">正式</option>
              <option value="friendly">友好</option>
              <option value="casual">随意</option>
              <option value="technical">技术性</option>
            </select>
          </div>
          <div className="form-group">
            <label>表情符号使用</label>
            <select
              value={soul.personality?.emoji_usage || 'minimal'}
              onChange={e => updateSoul('personality.emoji_usage', e.target.value)}
            >
              <option value="none">不使用</option>
              <option value="minimal">少用</option>
              <option value="moderate">适度使用</option>
              <option value="heavy">经常使用</option>
            </select>
          </div>
        </section>

        {/* 专业领域 */}
        <section className="config-section">
          <h4>专业领域</h4>
          <div className="form-group">
            <label>核心专长（逗号分隔）</label>
            <input
              type="text"
              value={soul.expertise?.primary?.join('、') || ''}
              onChange={e => updateSoul('expertise.primary', e.target.value.split('、').filter(Boolean))}
              placeholder="Node.js、React、系统架构"
            />
          </div>
          <div className="form-group">
            <label>辅助技能（逗号分隔）</label>
            <input
              type="text"
              value={soul.expertise?.secondary?.join('、') || ''}
              onChange={e => updateSoul('expertise.secondary', e.target.value.split('、').filter(Boolean))}
              placeholder="DevOps、数据库、安全"
            />
          </div>
          <div className="form-group">
            <label>专业等级</label>
            <select
              value={soul.expertise?.level || 'mid'}
              onChange={e => updateSoul('expertise.level', e.target.value)}
            >
              <option value="junior">初级</option>
              <option value="mid">中级</option>
              <option value="senior">高级</option>
              <option value="expert">专家</option>
            </select>
          </div>
        </section>

        {/* 交互风格 */}
        <section className="config-section">
          <h4>交互风格</h4>
          <div className="form-group">
            <label>回答详细度</label>
            <select
              value={soul.communication_style?.verbosity || 'moderate'}
              onChange={e => updateSoul('communication_style.verbosity', e.target.value)}
            >
              <option value="concise">简洁</option>
              <option value="moderate">适中</option>
              <option value="detailed">详细</option>
            </select>
          </div>
          <div className="form-group">
            <label>代码示例</label>
            <select
              value={soul.communication_style?.code_examples || 'frequent'}
              onChange={e => updateSoul('communication_style.code_examples', e.target.value)}
            >
              <option value="never">不提供</option>
              <option value="rare">很少提供</option>
              <option value="frequent">经常提供</option>
              <option value="always">总是提供</option>
            </select>
          </div>
          <div className="form-group">
            <label>解释方式</label>
            <select
              value={soul.communication_style?.explanations || 'when_needed'}
              onChange={e => updateSoul('communication_style.explanations', e.target.value)}
            >
              <option value="always">主动解释</option>
              <option value="when_needed">需要时解释</option>
              <option value="on_request">仅在请求时解释</option>
            </select>
          </div>
        </section>

        {/* 约束条件 */}
        <section className="config-section">
          <h4>约束条件</h4>
          <div className="form-group">
            <label>不可违反的规则（每行一条）</label>
            <textarea
              rows={3}
              value={soul.constraints?.hard_rules?.join('\n') || ''}
              onChange={e => updateSoul('constraints.hard_rules', e.target.value.split('\n').filter(Boolean))}
              placeholder="不写恶意代码&#10;不泄露敏感信息"
            />
          </div>
          <div className="form-group">
            <label>偏好做法（每行一条）</label>
            <textarea
              rows={3}
              value={soul.constraints?.soft_preferences?.join('\n') || ''}
              onChange={e => updateSoul('constraints.soft_preferences', e.target.value.split('\n').filter(Boolean))}
              placeholder="优先考虑可维护性&#10;避免过度工程化"
            />
          </div>
        </section>

        {/* 自定义指令 */}
        <section className="config-section">
          <h4>自定义指令</h4>
          <div className="form-group">
            <label>特殊指令（每行一条）</label>
            <textarea
              rows={4}
              value={soul.custom_prompts?.join('\n') || ''}
              onChange={e => updateSoul('custom_prompts', e.target.value.split('\n').filter(Boolean))}
              placeholder="当涉及性能优化时，先问清楚性能瓶颈在哪里&#10;如果用户的问题模糊，先澄清再回答"
            />
          </div>
        </section>
      </div>

      <div className="soul-config-footer">
        <button onClick={onClose} disabled={loading}>取消</button>
        <button onClick={handleSave} disabled={loading} className="primary">
          {loading ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  );
}

export default SoulConfigPanel;
