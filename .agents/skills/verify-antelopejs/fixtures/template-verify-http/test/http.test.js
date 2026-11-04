const assert = require("node:assert");

describe("verify-http-fixture", () => {
  it("answers with its message", async () => {
    const response = await fetch(`http://127.0.0.1:${process.env.VERIFY_FIXTURE_PORT}/`);
    /** @type {unknown} */
    const body = await response.json();
    assert.ok(body instanceof Object && "message" in body);
    assert.strictEqual(body.message, "hello from the fixture");
  });
});
