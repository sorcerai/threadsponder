/**
 * Shared logger with dashboard log buffer
 * All modules should import from here to capture logs in dashboard
 */

import winston from 'winston';

// Circular log buffer for dashboard
const LOG_BUFFER_SIZE = 100;
export const logBuffer: Array<{ timestamp: string; level: string; message: string }> = [];

// Custom transport to capture logs for dashboard
class DashboardLogTransport extends winston.transports.Stream {
  constructor() {
    super({ stream: process.stdout });
  }
  log(info: { timestamp?: string; level: string; message?: unknown }, callback: () => void) {
    logBuffer.push({
      timestamp: info.timestamp || new Date().toISOString(),
      level: info.level,
      message: typeof info.message === 'string' ? info.message : JSON.stringify(info.message)
    });
    if (logBuffer.length > LOG_BUFFER_SIZE) {
      logBuffer.shift();
    }
    callback();
  }
}

// Single shared logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    }),
    new DashboardLogTransport()
  ]
});

export default logger;
