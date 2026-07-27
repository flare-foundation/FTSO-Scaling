import { CallHandler } from "@nestjs/common";
import { expect } from "chai";
import { firstValueFrom, of } from "rxjs";
import { BigIntInterceptor } from "../../../apps/ftso-data-provider/src/utils/BigIntInterceptor";
import { getTestFile } from "../../utils/getTestFile";

function runInterceptor(payload: unknown): Promise<any> {
  const interceptor = new BigIntInterceptor();
  const next: CallHandler = { handle: () => of(payload) };
  return firstValueFrom(interceptor.intercept(undefined as never, next));
}

describe(`BigIntInterceptor (${getTestFile(__filename)})`, () => {
  it("converts nested bigints to strings", async () => {
    const result = await runInterceptor({ a: 1n, b: { c: [2n, 3] }, d: "x" });
    expect(result).to.deep.equal({ a: "1", b: { c: ["2", 3] }, d: "x" });
  });

  it("passes through null values without crashing (fdc-round-report response shape)", async () => {
    // Regression: typeof null === "object" sent null into Object.keys and threw,
    // 500-ing every response containing nulls (e.g. entity display_name/logo_url).
    const payload = {
      status: "OK",
      attestation_requests: [
        {
          attestation_request: {
            id: { tx_hash: null, block_number: 1, log_index: 1, timestamp: 1 },
            attestation_type_source: { attestation_type: "Payment", source_id: "XRP" },
            is_proved: "EXECUTED",
          },
          count: 1,
          weight: 0.5,
        },
      ],
      entity_bit_vectors: [
        {
          entity: { identity_address: "0xabc", display_name: null, logo_url: null, listed: false },
          bit_vector: [true],
        },
      ],
      count: 1,
    };
    const result = await runInterceptor(payload);
    expect(result).to.deep.equal(payload);
  });

  it("handles null and primitives at the top level", async () => {
    expect(await runInterceptor(null)).to.equal(null);
    expect(await runInterceptor(42n)).to.equal("42");
    expect(await runInterceptor([null, 1n])).to.deep.equal([null, "1"]);
  });
});
