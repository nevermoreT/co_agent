const timestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const log = (...args) => console.log(`[${timestamp()}]`, ...args);
const error = (...args) => console.error(`[${timestamp()}]`, ...args);
const warn = (...args) => console.warn(`[${timestamp()}]`, ...args);

export default { log, error, warn };
