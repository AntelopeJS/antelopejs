import { expect } from "chai";

import { LogFilter } from "../../src/logging/log-filter";
import { type LogEntry, LogLevel } from "../../src/logging/log-formatter";

describe("LogFilter", () => {
  let filter: LogFilter;

  beforeEach(() => {
    filter = new LogFilter();
  });

  describe("shouldLog", () => {
    it("should allow logs at or above minimum level", () => {
      filter.setMinLevel(LogLevel.WARN);

      expect(filter.shouldLog(createEntry(LogLevel.ERROR))).to.equal(true);
      expect(filter.shouldLog(createEntry(LogLevel.WARN))).to.equal(true);
      expect(filter.shouldLog(createEntry(LogLevel.INFO))).to.equal(false);
    });

    it("should filter by channel", () => {
      filter.setChannelLevel("loader", LogLevel.DEBUG);
      filter.setChannelLevel("loader.*", LogLevel.TRACE);

      expect(filter.shouldLog(createEntry(LogLevel.DEBUG, "loader"))).to.equal(true);
      expect(filter.shouldLog(createEntry(LogLevel.TRACE, "loader"))).to.equal(false);
      expect(filter.shouldLog(createEntry(LogLevel.TRACE, "loader.sub"))).to.equal(true);
    });

    it("should support wildcard channel filters", () => {
      filter.setMinLevel(LogLevel.WARN);
      filter.setChannelLevel("*", LogLevel.TRACE);

      expect(filter.shouldLog(createEntry(LogLevel.TRACE, "any"))).to.equal(true);
    });

    it("should filter by module includes", () => {
      filter.setModuleTracking(true);
      filter.setModuleIncludes(["database"]);

      expect(filter.shouldLog(createEntry(LogLevel.INFO, "test", "database")))
        .to.equal(true);
      expect(filter.shouldLog(createEntry(LogLevel.INFO, "test", "api"))).to.equal(false);
    });

    it("should filter by module excludes", () => {
      filter.setModuleTracking(true);
      filter.setModuleExcludes(["debug"]);

      expect(filter.shouldLog(createEntry(LogLevel.INFO, "test", "api"))).to.equal(true);
      expect(filter.shouldLog(createEntry(LogLevel.INFO, "test", "debug"))).to.equal(false);
    });
  });
});

function createEntry(
  level: LogLevel,
  channel = "test",
  module?: string,
): LogEntry {
  return { level, channel, args: [], time: new Date(), module };
}
