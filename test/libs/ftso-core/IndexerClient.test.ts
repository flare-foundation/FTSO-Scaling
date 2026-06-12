import { expect } from "chai";
import { ContractMethodNames } from "../../../libs/contracts/src/definitions";
import { BlockAssuranceResult, IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import {
  FIRST_DATABASE_LOG_INDEX_STATE,
  FIRST_DATABASE_INDEX_STATE,
  LAST_DATABASE_INDEX_STATE,
} from "../../../libs/ftso-core/src/constants";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { generateState } from "../../utils/basic-generators";
import { getDataSource } from "../../utils/db";
import { getTestFile } from "../../utils/getTestFile";

describe(`IndexerClient (${getTestFile(__filename)})`, () => {
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
