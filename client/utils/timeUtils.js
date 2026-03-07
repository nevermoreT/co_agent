/**
 * 时间格式化工具
 */

/**
 * 格式化相对时间（如 "3分钟前", "2小时前"）
 * @param {string} dateString - ISO 时间字符串或 SQLite 格式 "YYYY-MM-DD HH:MM:SS"
 * @returns {string} 格式化后的相对时间
 */
export function formatRelativeTime(dateString) {
  if (!dateString) return '';

  // 兼容 "YYYY-MM-DD HH:MM:SS" 和 ISO 8601 格式
  const normalized = dateString.includes('T') 
    ? dateString 
    : dateString.replace(' ', 'T');
  
  const date = new Date(normalized);
  
  // 检查日期是否有效
  if (isNaN(date.getTime())) return '';
  
  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffWeeks > 0) {
    return date.toLocaleDateString('zh-CN');
  } else if (diffDays > 0) {
    return `${diffDays}天前`;
  } else if (diffHours > 0) {
    return `${diffHours}小时前`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes}分钟前`;
  } else {
    return '刚刚';
  }
}

/**
 * 格式化绝对时间
 * @param {string} dateString - ISO 时间字符串或 SQLite 格式
 * @param {Object} options - Intl.DateTimeFormat 选项
 * @returns {string} 格式化后的时间
 */
export function formatAbsoluteTime(dateString, options = {}) {
  if (!dateString) return '';

  const normalized = dateString.includes('T') 
    ? dateString 
    : dateString.replace(' ', 'T');
  
  const date = new Date(normalized);
  
  if (isNaN(date.getTime())) return '';
  
  const defaultOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };
  
  return date.toLocaleString('zh-CN', { ...defaultOptions, ...options });
}