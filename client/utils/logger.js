const timestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const log = (...args) => {
  const prefix = `[${timestamp()}]`;
  if (args.length > 1 && typeof args[0] === 'string' && args[0].includes('%')) {
    console.log(prefix, ...args);
  } else {
    console.log(prefix, ...args);
  }
};
const error = (...args) => console.error(`[${timestamp()}]`, ...args);
const warn = (...args) => console.warn(`[${timestamp()}]`, ...args);

export default { log, error, warn };
