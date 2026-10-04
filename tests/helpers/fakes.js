// Stand-ins for Vercel's request and response objects, shared by the handler tests.
// This file is not a test itself (its name does not match the test runner's patterns).

/** A request. `bodyThrows` imitates Vercel, whose req.body getter throws on malformed JSON. */
export function fakeReq({ method = "GET", headers = {}, body, bodyThrows = false, query = {} } = {}) {
  const req = {
    method,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    query,
  };
  Object.defineProperty(req, "body", {
    enumerable: true,
    get() {
      if (bodyThrows) throw new Error("Invalid JSON");
      return body;
    },
  });
  return req;
}

/** A response that records the status, headers and JSON body it was given. */
export function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
}
