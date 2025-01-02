import { expect } from "chai";
import { SigningPolicyInitialized } from "../../../libs/contracts/src/events";
import { getTestFile } from "../../utils/getTestFile";
import {decodeEvent, AbiCache} from "../../../libs/contracts/src/abi/AbiCache";
import {CONTRACTS} from "../../../libs/contracts/src/constants";

describe(`SigningPolicyInitialized (${getTestFile(__filename)})`, () => {
  const rawEvent = {
    id: 14,
    transaction_id: undefined,
    address: "5a0773ff307bf7c71a832dbb5312237fd3437f9f",
    data: "00000000000000000000000000000000000000000000000000000000000003ed0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000012300000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000065951b4a0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f252dca332f04d84542c0db27e784a7645b140d3000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000000021230000000000000000000000000000000000000000000000000000000000000",
    topic0: "91d0280e969157fc6c5b8f952f237b03d934b18534dafcac839075bbc33522f8",
    topic1: "0000000000000000000000000000000000000000000000000000000000000001",
    topic2: "",
    topic3: "",
    log_index: 1,
    timestamp: 1704270666,
  };

  it("Should get relay abi definition", function () {
    const abiData = AbiCache.instance.getEventAbiData(CONTRACTS.Relay.name, SigningPolicyInitialized.eventName);
    expect(abiData).to.not.undefined;
  });

  it("should correctly create 'SigningPolicyInitialized' event class", () => {
    const event = SigningPolicyInitialized.fromRawEvent(rawEvent);

    expect(event.rewardEpochId).to.be.equal(1);
  });
});
