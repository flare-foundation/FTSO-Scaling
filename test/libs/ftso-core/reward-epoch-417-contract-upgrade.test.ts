import { expect } from "chai";
import { EntityManager } from "typeorm";
import {
  COSTON2_CONTRACTS,
  COSTON_CONTRACTS,
  FLARE_CONTRACTS,
  SONGBIRD_CONTRACTS,
  CONTRACTS,
  networks,
} from "../../../libs/contracts/src/constants";
import { ContractDefinitions } from "../../../libs/contracts/src/definitions";
import { BlockAssuranceResult, IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { TLPEvents } from "../../../libs/ftso-core/src/orm/entities";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { getTestFile } from "../../utils/getTestFile";

class RecordingIndexerClient extends IndexerClient {
  readonly queriedContracts: ContractDefinitions[] = [];

  constructor() {
    super(undefined as unknown as EntityManager, 0, emptyLogger);
  }

  protected ensureFspEventRange(): Promise<BlockAssuranceResult> {
    return Promise.resolve(BlockAssuranceResult.OK);
  }

  public queryEvents(contract: ContractDefinitions): Promise<TLPEvents[]> {
    this.queriedContracts.push(contract);
    return Promise.resolve<TLPEvents[]>([]);
  }
}

describe(`reward epoch 417 contract upgrade (${getTestFile(__filename)})`, () => {
  const originalNetwork = process.env.NETWORK;
  const originalVoterRegistry = { ...CONTRACTS.VoterRegistry };
  const originalFlareSystemsCalculator = { ...CONTRACTS.FlareSystemsCalculator };

  afterEach(() => {
    process.env.NETWORK = originalNetwork;
    Object.assign(CONTRACTS.VoterRegistry, originalVoterRegistry);
    Object.assign(CONTRACTS.FlareSystemsCalculator, originalFlareSystemsCalculator);
  });

  for (const [network, currentContracts, previousAddresses] of [
    [
      "songbird",
      SONGBIRD_CONTRACTS,
      {
        voterRegistry: "0x31B9EC65C731c7D973a33Ef3FC83B653f540dC8D",
        flareSystemsCalculator: "0x126FAeEc75601dA3354c0b5Cc0b60C85fCbC3A5e",
      },
    ],
    [
      "flare",
      FLARE_CONTRACTS,
      {
        voterRegistry: "0x2580101692366e2f331e891180d9ffdF861Fce83",
        flareSystemsCalculator: "0x67c4B11c710D35a279A41cff5eb089Fe72748CF8",
      },
    ],
  ] as const) {
    it(`switches ${network} addresses and ABIs at reward epoch 417`, async () => {
      process.env.NETWORK = network satisfies networks;
      Object.assign(CONTRACTS.VoterRegistry, currentContracts.VoterRegistry);
      Object.assign(CONTRACTS.FlareSystemsCalculator, currentContracts.FlareSystemsCalculator);

      const before = new RecordingIndexerClient();
      await before.getFullVoterRegistrationInfoEvents(416, 1, 2);
      expect(before.queriedContracts).to.deep.equal([
        { name: "VoterRegistry", address: previousAddresses.voterRegistry },
        { name: "FlareSystemsCalculator", address: previousAddresses.flareSystemsCalculator },
      ]);

      const after = new RecordingIndexerClient();
      await after.getFullVoterRegistrationInfoEvents(417, 1, 2);
      expect(after.queriedContracts).to.deep.equal([
        { name: "VoterRegistryNext", address: currentContracts.VoterRegistry.address },
        { name: "FlareSystemsCalculatorNext", address: currentContracts.FlareSystemsCalculator.address },
      ]);
    });
  }

  for (const [network, currentContracts, previousCalculatorAddress] of [
    ["coston", COSTON_CONTRACTS, "0x3787dcbd770202f856ed9204c19d6f9022ff3bf2"],
    ["coston2", COSTON2_CONTRACTS, "0x93F4C0b43A221Cf0a57faa882Df5E3F6CAa5Aca8"],
  ] as const) {
    it(`switches ${network} FlareSystemsCalculator at reward epoch 5824`, async () => {
      process.env.NETWORK = network satisfies networks;
      Object.assign(CONTRACTS.VoterRegistry, currentContracts.VoterRegistry);
      Object.assign(CONTRACTS.FlareSystemsCalculator, currentContracts.FlareSystemsCalculator);

      const before = new RecordingIndexerClient();
      await before.getFullVoterRegistrationInfoEvents(5823, 1, 2);
      expect(before.queriedContracts[1]).to.deep.equal({
        name: "FlareSystemsCalculatorNext",
        address: previousCalculatorAddress,
      });

      const after = new RecordingIndexerClient();
      await after.getFullVoterRegistrationInfoEvents(5824, 1, 2);
      expect(after.queriedContracts[1]).to.deep.equal({
        name: "FlareSystemsCalculatorNext",
        address: currentContracts.FlareSystemsCalculator.address,
      });
    });
  }
});
