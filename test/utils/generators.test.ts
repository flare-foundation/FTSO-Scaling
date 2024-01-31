import { expect } from "chai";
import { CONTRACTS } from "../../libs/ftso-core/src/configs/networks";
import { decodeEvent } from "../../libs/ftso-core/src/utils/EncodingUtils";
import { generateEvent } from "./generators";


describe("generators", () => {
   // Event ABI example
   // const eventABI = {
   //    "anonymous": false,
   //    "inputs": [
   //       {
   //          "indexed": true,
   //          "internalType": "uint8",
   //          "name": "protocolId",
   //          "type": "uint8"
   //       },
   //       {
   //          "indexed": true,
   //          "internalType": "uint32",
   //          "name": "votingRoundId",
   //          "type": "uint32"
   //       },
   //       {
   //          "indexed": false,
   //          "internalType": "bool",
   //          "name": "randomQualityScore",
   //          "type": "bool"
   //       },
   //       {
   //          "indexed": false,
   //          "internalType": "bytes32",
   //          "name": "merkleRoot",
   //          "type": "bytes32"
   //       }
   //    ],
   //    "name": "ProtocolMessageRelayed",
   //    "type": "event"
   // };

   it("should encode and decode event correctly", () => {
      const eventData = {
         protocolId: 1n,
         votingRoundId: 2n,
         randomQualityScore: false,
         merkleRoot: "0x" + "a".repeat(64)
      };
      let eventEntity = generateEvent(
         CONTRACTS.Relay,
         "ProtocolMessageRelayed",
         eventData,
         Math.floor(Date.now() / 1000)
      )
      const decoded = decodeEvent<any>(
         CONTRACTS.Relay.name,
         "ProtocolMessageRelayed",
         eventEntity,
         (data: any) => data
      );
      expect(decoded.protocolId).to.be.equal(eventData.protocolId);
      expect(decoded.votingRoundId).to.be.equal(eventData.votingRoundId);
      expect(decoded.randomQualityScore).to.be.equal(eventData.randomQualityScore);
      expect(decoded.merkleRoot).to.be.equal(eventData.merkleRoot);
   });

});