import { Logger, formatDate, CONFIG } from './utils';

const logger = new Logger();

function main() {
  logger.log('Application started');
  const now = formatDate(new Date());
  logger.log(`Current time: ${now}`);
  logger.log(`API URL: ${CONFIG.apiUrl}`);
}

main();
