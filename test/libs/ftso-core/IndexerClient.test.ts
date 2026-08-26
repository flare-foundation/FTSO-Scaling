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
  // Relay v2 is deployed holding the activation epoch's policy but never emits an event for it, and its
  // first setSigningPolicy is the epoch after - so a range spanning the activation comes from two
  // contracts. The data provider builds every voting round's voter set from these, so reading only the
  // configured Relay means the switch looks clean and then nothing can be served an epoch later.
  it("reads signing policies from both relays across the Relay v2 activation", async () => {
    const activation = 101;
    const previousActivation = process.env.RELAY_V2_ACTIVATION_REWARD_EPOCH;
    process.env.RELAY_V2_ACTIVATION_REWARD_EPOCH = `${activation}`;

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
    const relayV2 = CONTRACTS.RelayV2;

    const dataSource = await getDataSource();
    try {
      const entityManager = dataSource.createEntityManager();
      await entityManager.save([
        generateState(FIRST_DATABASE_LOG_INDEX_STATE, 0, 0, 500),
        generateState(FIRST_DATABASE_INDEX_STATE, 1, 0, 500),
        generateState(LAST_DATABASE_INDEX_STATE, 2, 0, 1001),
      ]);
      await entityManager.save([
        event(CONTRACTS.Relay, activation - 1),
        event(CONTRACTS.Relay, activation),
        event(relayV2, activation + 1),
        // neither contract is authoritative for these, so both must be dropped
        event(relayV2, activation),
        event(CONTRACTS.Relay, activation + 1),
      ]);

      const response = await new IndexerClient(entityManager, 0, emptyLogger).getLatestSigningPolicyInitializedEvents(
        550
      );
      expect(response.status).to.equal(BlockAssuranceResult.OK);
      expect(response.data.map((e) => e.rewardEpochId)).to.deep.equal([activation - 1, activation, activation + 1]);
    } finally {
      await dataSource.destroy();
      if (previousActivation === undefined) delete process.env.RELAY_V2_ACTIVATION_REWARD_EPOCH;
      else process.env.RELAY_V2_ACTIVATION_REWARD_EPOCH = previousActivation;
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
