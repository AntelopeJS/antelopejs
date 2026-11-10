const assert = require("node:assert");

/**
 * @param {unknown} body
 * @returns {body is { message: unknown }}
 */
function hasMessage(body) {
  return body instanceof Object && Object.hasOwn(body, "message");
}

describe("verify-http-fixture", () => {
  it("answers with its message", async () => {
    const response = await fetch(`http://127.0.0.1:${process.env.VERIFY_FIXTURE_PORT}/`);
    /** @type {unknown} */
    const body = await response.json();
    assert.ok(hasMessage(body));
    assert.strictEqual(body.message, "hello from the fixture");
  });
});
