/**
 * Provides a structured logging system with multiple severity levels and channels.
 *
 * The Logging namespace offers standardized functions for logging at different severity levels
 * through a unified interface. It supports multiple channels for categorizing logs and
 * uses an event-based system for log collection and processing.
 */
export declare namespace Logging {
    /**
     * Log severity levels in descending order of importance.
     * Higher numerical values indicate higher severity.
     */
    enum Level {
        /** Critical errors that may cause application failure */
        ERROR = 40,
        /** Important issues that don't prevent application functioning */
        WARN = 30,
        /** General application information and status updates */
        INFO = 20,
        /** Detailed information useful for debugging */
        DEBUG = 10,
        /** Highly detailed tracing information */
        TRACE = 0
    }
    /**
     * Write arguments to the main log channel at the ERROR level.
     *
     * Use for critical errors that may cause application failure or require immediate attention.
     *
     * @param args - Values to log, which can be of any type and will be serialized appropriately
     */
    function Error(...args: any[]): void;
    /**
     * Write arguments to the main log channel at the WARN level.
     *
     * Use for important issues that don't prevent the application from functioning
     * but should be addressed.
     *
     * @param args - Values to log, which can be of any type and will be serialized appropriately
     */
    function Warn(...args: any[]): void;
    /**
     * Write arguments to the main log channel at the INFO level.
     *
     * Use for general application information and status updates that are useful
     * for understanding the normal operation of the system.
     *
     * @param args - Values to log, which can be of any type and will be serialized appropriately
     */
    function Info(...args: any[]): void;
    /**
     * Write arguments to the main log channel at the DEBUG level.
     *
     * Use for detailed information useful for debugging and troubleshooting issues.
     *
     * @param args - Values to log, which can be of any type and will be serialized appropriately
     */
    function Debug(...args: any[]): void;
    /**
     * This namespace is used to write logs on the same line as the previous log, overwriting the previous content.
     *
     * Usage:
     * Logging.inline.Info('Hello');
     * Logging.inline.Info('World');
     */
    namespace inline {
        /**
         * Write arguments to the inline log channel at the ERROR level.
         *
         * @param args - Values to log, which can be of any type and will be serialized appropriately
         */
        function Error(...args: any[]): void;
        /**
         * Write arguments to the inline log channel at the WARN level.
         *
         * @param args - Values to log, which can be of any type and will be serialized appropriately
         */
        function Warn(...args: any[]): void;
        /**
         * Write arguments to the inline log channel at the INFO level.
         *
         * @param args - Values to log, which can be of any type and will be serialized appropriately
         */
        function Info(...args: any[]): void;
        /**
         * Write arguments to the inline log channel at the DEBUG level.
         *
         * @param args - Values to log, which can be of any type and will be serialized appropriately
         */
        function Debug(...args: any[]): void;
        /**
         * Write arguments to the inline log channel at the TRACE level.
         *
         * @param args - Values to log, which can be of any type and will be serialized appropriately
         */
        function Trace(...args: any[]): void;
    }
    /**
     * Write arguments to the main log channel at the TRACE level.
     *
     * Use for highly detailed tracing information, typically only enabled during
     * intensive debugging sessions.
     *
     * @param args - Values to log, which can be of any type and will be serialized appropriately
     */
    function Trace(...args: any[]): void;
    /**
     * Write arguments to the specified log channel at the given severity level.
     *
     * This is the core logging function that all other logging functions ultimately call.
     * It emits an event with the log entry that can be captured by registered listeners.
     *
     * @param levelId - Severity level of the log entry (use values from the Level enum)
     * @param channel - Name of the channel to log to, useful for categorizing logs
     * @param args - Values to log, which can be of any type and will be serialized appropriately
     */
    function Write(levelId: number, channel: string, ...args: any[]): void;
}
export default Logging;
