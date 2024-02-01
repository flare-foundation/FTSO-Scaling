import sinon from "sinon";
import { FtsoDataProviderController } from "../../../apps/ftso-data-provider/src/ftso-data-provider.controller";
import { FtsoDataProviderService } from "../../../apps/ftso-data-provider/src/ftso-data-provider.service";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { generateRandomAddress, testRandom } from "../../utils/testRandom";
chai.use(chaiAsPromised);

describe("FtsoDataProviderController", () => {
  let controller: FtsoDataProviderController;

  beforeEach(async () => {
    const serviceMock = sinon.createStubInstance(FtsoDataProviderService);
    controller = new FtsoDataProviderController(serviceMock);
  });

  describe("Submit 1 and 2", () => {
    it("should fail if multiple submit addresses are used for the same voting round", async () => {
      for (let i = 0; i < 10; i++) {
        const addr = generateRandomAddress();
        const round = testRandom.nextInt(1000, 10000);
        await controller.submit1(round, addr);
        await controller.submit2(round, addr);

        await chai.expect(controller.submit1(round, generateRandomAddress())).to.eventually.be.rejected;
        await chai.expect(controller.submit2(round, generateRandomAddress())).to.eventually.be.rejected;
      }
    });
  });
});
