import { expect } from "chai";
import { ContractMethodNames } from "../../../libs/contracts/src/definitions";
import { BlockAssuranceResult, IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import {
  FIRST_DATABASE_LOG_INDEX_STATE,
  FIRST_DATABASE_INDEX_STATE,
  LAST_DATABASE_INDEX_STATE,
} from "../../../libs/ftso-core/src/constants";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { SigningPolicyInitialized } from "../../../libs/contracts/src/events";
import { CONTRACTS } from "../../../libs/contracts/src/constants";
import { generateEvent, generateState } from "../../utils/basic-generators";
import { getDataSource } from "../../utils/db";
import { getTestFile } from "../../utils/getTestFile";

describe(`IndexerClient (${getTestFile(__filename)})`, () => {
  const event = (contract: { name: string; address: string }, rewardEpochId: number) =>
    generateEvent(
      contract,
      SigningPolicyInitialized.eventName,
      new SigningPolicyInitialized({
        rewardEpochId,
        startVotingRoundId: rewardEpochId * 10,
        threshold: 1,
        seed: BigInt("0x123"),
        voters: [],
        weights: [],
        signingPolicyBytes: "0x1234",
        timestamp: 600 + rewardEpochId,
      }),
      4,
      600 + rewardEpochId
    );

  // Relay v2 is deployed holding the cutover epoch's policy but never emits an event for it, and its first
  // setSigningPolicy is the epoch after - so the policies of a range spanning the cutover come from two
  // contracts. The data provider builds every voting round's voter set from these, so reading only the
  // configured Relay means nothing can be served an epoch after the switch.
  it("merges signing policies from both relays, in reward epoch order", async () => {
    const dataSource = await getDataSource();
    try {
      const entityManager = dataSource.createEntityManager();
      await entityManager.save([
        generateState(FIRST_DATABASE_LOG_INDEX_STATE, 0, 0, 500),
        generateState(FIRST_DATABASE_INDEX_STATE, 1, 0, 500),
        generateState(LAST_DATABASE_INDEX_STATE, 2, 0, 1001),
      ]);
      // the cutover epoch and everything before it on the current Relay, later ones on Relay v2
      await entityManager.save([
        event(CONTRACTS.Relay, 100),
        event(CONTRACTS.Relay, 101),
        event(CONTRACTS.RelayV2, 102),
        event(CONTRACTS.RelayV2, 103),
      ]);

      const response = await new IndexerClient(entityManager, 0, emptyLogger).getLatestSigningPolicyInitializedEvents(
        550
      );
      expect(response.status).to.equal(BlockAssuranceResult.OK);
      expect(response.data.map((e) => e.rewardEpochId)).to.deep.equal([100, 101, 102, 103]);
      // 101 is the cutover epoch: its policy is emitted by the Relay before it and only seeded into Relay
      // v2, so the first epoch v2 emits for is one past the switch and the epoch before it signs source
      // bound too. Reading the emitting contract alone would get exactly that epoch wrong.
      expect(response.data.map((e) => e.epochRelayAddress)).to.deep.equal([
        CONTRACTS.Relay.address,
        CONTRACTS.RelayV2.address,
        CONTRACTS.RelayV2.address,
        CONTRACTS.RelayV2.address,
      ]);
    } finally {
      await dataSource.destroy();
    }
  });

  it("leaves every epoch on its emitting Relay before the cutover", async () => {
    const dataSource = await getDataSource();
    try {
      const entityManager = dataSource.createEntityManager();
      await entityManager.save([
        generateState(FIRST_DATABASE_LOG_INDEX_STATE, 0, 0, 500),
        generateState(FIRST_DATABASE_INDEX_STATE, 1, 0, 500),
        generateState(LAST_DATABASE_INDEX_STATE, 2, 0, 1001),
      ]);
      await entityManager.save([event(CONTRACTS.Relay, 100), event(CONTRACTS.Relay, 101)]);

      const response = await new IndexerClient(entityManager, 0, emptyLogger).getLatestSigningPolicyInitializedEvents(
        550
      );
      // Relay v2 has emitted nothing, so either it is not switched to yet or the epoch it would emit for is
      // still running. Either way every epoch stays on the Relay that emitted it.
      expect(response.data.map((e) => e.epochRelayAddress)).to.deep.equal([
        CONTRACTS.Relay.address,
        CONTRACTS.Relay.address,
      ]);
    } finally {
      await dataSource.destroy();
    }
  });

  it("requires the full block floor for submission transaction ranges", async () => {
    const dataSource = await getDataSource();
    try {
      const entityManager = dataSource.createEntityManager();
      await entityManager.save([
        generateState(FIRST_DATABASE_LOG_INDEX_STATE, 0, 0, 500),
        generateState(FIRST_DATABASE_INDEX_STATE, 1, 0, 1000),
        generateState(LAST_DATABASE_INDEX_STATE, 2, 0, 1001),
      ]);

      const client = new IndexerClient(entityManager, 0, emptyLogger);

      const submissionResponse = await client.getSubmissionDataInRange(ContractMethodNames.submit1, 900, 950);
      expect(submissionResponse.status).to.equal(BlockAssuranceResult.NOT_OK);
      expect(submissionResponse.data).to.deep.equal([]);

      const rewardOffersResponse = await client.getRewardOffers(900, 950);
      expect(rewardOffersResponse.status).to.equal(BlockAssuranceResult.OK);
    } finally {
      await dataSource.destroy();
    }
  });
});
