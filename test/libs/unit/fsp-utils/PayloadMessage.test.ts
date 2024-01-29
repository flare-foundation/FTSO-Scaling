import { expect } from "chai";
import Web3 from "web3";
import { IPayloadMessage, PayloadMessage } from "../../../../libs/fsp-utils/src/PayloadMessage";

describe(`PayloadMessage`, async () => {

  it("Should encode and decode payload message", async () => {
    let payloads: IPayloadMessage<string>[] = [];
    const N = 10;
    let encoded = "0x";    
    for (let i = 0; i < N; i++) {
      let payload = {
        protocolId: i,
        votingRoundId: 10 * i,
        payload: Web3.utils.randomHex(2 * (N - i)),
      } as IPayloadMessage<string>;
      payloads.push(payload);
      encoded += PayloadMessage.encode(payload).slice(2);
    }
    const decoded = PayloadMessage.decode(encoded);
    expect(decoded).to.deep.equal(payloads);
  });

});
