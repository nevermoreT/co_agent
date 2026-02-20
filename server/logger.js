import util from 'util';

const timestamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const log = (...args) => {
  const msg = args.length > 1 && typeof args[0] === 'string' && args[0].includes('%')
    ? util.format(...args)
    : args.join(' ');
  console.log(`[${timestamp()}] ${msg}`);
};

const error = (...args) => {
  const msg = args.length > 1 && typeof args[0] === 'string' && args[0].includes('%')
    ? util.format(...args)
    : args.join(' ');
  console.error(`[${timestamp()}] ${msg}`);
};

const warn = (...args) => {
  const msg = args.length > 1 && typeof args[0] === 'string' && args[0].includes('%')
    ? util.format(...args)
    : args.join(' ');
  console.warn(`[${timestamp()}] ${msg}`);
};

export default { log, error, warn };
