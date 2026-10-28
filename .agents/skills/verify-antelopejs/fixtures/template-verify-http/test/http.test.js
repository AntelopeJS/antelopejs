const assert = require("node:assert");

describe("verify-http-fixture", () => {
  it("answers with its message", async () => {
    const response = await fetch(`http://127.0.0.1:${process.env.VERIFY_FIXTURE_PORT}/`);
    const body = await response.json();
    assert.strictEqual(body.message, "hello from the fixture");
  });
});
