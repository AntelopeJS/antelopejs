import { EventProxy } from '../../core/beta';

/**
 * Represents a structured log entry in the Antelopejs logging system.
 *
 * Log entries contain all necessary metadata about a logging event, including
 * timestamp, severity level, channel, and the actual content being logged.
 */
export interface Log {
  /** Timestamp when the log was created (milliseconds since epoch) */
  time: number;

  /** The channel/category this log belongs to (e.g., 'main', 'database', 'network') */
  channel: string;

  /** Numeric severity level (higher values indicate higher severity, see Logging.Level enum) */
  levelId: number;

  /** The actual content of the log entry, can be any serializable values */
  args: any[];
}

/**
 * Event proxy for log entry listeners.
 *
 * This EventProxy allows parts of the application to subscribe to log events
 * and process them as needed (e.g., write to console, file, or send to a logging service).
 * Provides module-aware event handler management with automatic cleanup.
 */
export default new EventProxy<(log: Log) => void>();
