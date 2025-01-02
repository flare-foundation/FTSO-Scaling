import {
  FullVoterRegistrationInfo,
  RandomAcquisitionStarted,
  RewardEpochStarted,
  RewardOffers,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
} from "../../contracts/src/events";
import { rewardEpochFeedSequence } from "./ftso-calculation/feed-ordering";
import { Address, Feed, RewardEpochId, VotingEpochId } from "./voting-types";

export interface VoterWeights {
  readonly identityAddress: Address; //voter
  readonly submitAddress: Address;
  readonly signingAddress: Address;
  readonly delegationAddress: Address;
  readonly delegationWeight: bigint;
  readonly cappedDelegationWeight: bigint;
  readonly signingWeight: number;
  readonly feeBIPS: number;
  readonly nodeIds: string[];
  readonly nodeWeights: bigint[];
}

export class RewardEpoch {
  readonly orderedVotersSubmitAddresses: Address[] = [];
  readonly orderedVotersSubmitSignatureAddresses: Address[] = [];

  public readonly rewardOffers: RewardOffers;
  public readonly signingPolicy: SigningPolicyInitialized;
  // delegationAddress => weight (capped WFLR)
  readonly delegationAddressToCappedWeight = new Map<Address, bigint>();
  // identityAddress => info
  // Only for voters in signing policy
  readonly voterToRegistrationInfo = new Map<Address, FullVoterRegistrationInfo>();
  // signingAddress => identityAddress
  readonly signingAddressToVoter = new Map<Address, Address>();
  // submitAddress => identityAddress
  readonly submitAddressToVoter = new Map<Address, Address>();
  // delegateAddress => identityAddress
  readonly delegationAddressToVoter = new Map<Address, Address>();
  // submitSignaturesAddress => signingAddress
  readonly submitSignatureAddressToSigningAddress = new Map<Address, Address>();
  // submitSignaturesAddress => identityAddress
  readonly submitSignatureAddressToVoter = new Map<Address, Address>();

  readonly submitAddressToCappedWeight = new Map<Address, bigint>();
  readonly submitAddressToVoterRegistrationInfo = new Map<Address, FullVoterRegistrationInfo>();
  readonly signingAddressToDelegationAddress = new Map<Address, Address>();
  readonly signingAddressToSubmitAddress = new Map<Address, Address>();

  readonly signingAddressToSigningWeight = new Map<Address, number>();
  readonly signingAddressToVotingPolicyIndex = new Map<Address, number>();

  private readonly _canonicalFeedOrder: Feed[];

  public readonly totalSigningWeight: number = 0;

  public readonly votePowerBlock: number;
  public readonly votePowerBlockTimestamp: number;
  public readonly previousRewardEpochStartedEvent: RewardEpochStarted;

  constructor(
    previousRewardEpochStartedEvent: RewardEpochStarted,
    randomAcquisitionStartedEvent: RandomAcquisitionStarted,
    rewardOffers: RewardOffers,
    votePowerBlockSelectedEvent: VotePowerBlockSelected, //This is only used for consistency check
    signingPolicyInitializedEvent: SigningPolicyInitialized,
    fullVotersRegistrationInfo: FullVoterRegistrationInfo[]
  ) {
    this.signingPolicy = signingPolicyInitializedEvent;
    this.previousRewardEpochStartedEvent = previousRewardEpochStartedEvent;

    ///////// Consistency checks /////////
    if (this.signingPolicy.rewardEpochId !== previousRewardEpochStartedEvent.rewardEpochId + 1) {
      throw new Error("Previous Reward Epoch Id is not correct");
    }
    if (this.signingPolicy.rewardEpochId !== randomAcquisitionStartedEvent.rewardEpochId) {
      throw new Error("Random Acquisition Reward Epoch Id is not correct");
    }
    for (const rewardOffer of rewardOffers.rewardOffers) {
      if (this.signingPolicy.rewardEpochId !== rewardOffer.rewardEpochId) {
        throw new Error("Reward Offer Reward Epoch Id is not correct");
      }
    }
    for (const inflationOffer of rewardOffers.inflationOffers) {
      if (this.signingPolicy.rewardEpochId !== inflationOffer.rewardEpochId) {
        throw new Error("Inflation Offer Reward Epoch Id is not correct");
      }
    }
    if (this.signingPolicy.rewardEpochId !== votePowerBlockSelectedEvent.rewardEpochId) {
      throw new Error("Vote Power Block Selected Reward Epoch Id is not correct");
    }
    for (const voterRegistration of fullVotersRegistrationInfo) {
      if (this.signingPolicy.rewardEpochId !== voterRegistration.voterRegistered.rewardEpochId) {
        throw new Error("Voter Registration Reward Epoch Id is not correct");
      }
      if (this.signingPolicy.rewardEpochId !== voterRegistration.voterRegistrationInfo.rewardEpochId) {
        throw new Error("Voter Registration Info Reward Epoch Id is not correct");
      }
    }

    ///////// Data initialization /////////
    this.votePowerBlock = votePowerBlockSelectedEvent.votePowerBlock;
    this.votePowerBlockTimestamp = votePowerBlockSelectedEvent.timestamp;
    this.rewardOffers = rewardOffers;
    this._canonicalFeedOrder = rewardEpochFeedSequence(rewardOffers);
    const tmpSigningAddressToVoter = new Map<Address, Address>();
    for (const voterRegistration of fullVotersRegistrationInfo) {
      this.voterToRegistrationInfo.set(voterRegistration.voterRegistered.voter.toLowerCase(), voterRegistration);
      tmpSigningAddressToVoter.set(
        voterRegistration.voterRegistered.signingPolicyAddress.toLowerCase(),
        voterRegistration.voterRegistered.voter
      );
    }
    for (let i = 0; i < signingPolicyInitializedEvent.voters.length; i++) {
      const voterSigningAddress = signingPolicyInitializedEvent.voters[i].toLowerCase();
      const signingWeight = signingPolicyInitializedEvent.weights[i];
      this.totalSigningWeight += signingWeight;
      this.signingAddressToVotingPolicyIndex.set(voterSigningAddress, i);
      if (!tmpSigningAddressToVoter.has(voterSigningAddress.toLowerCase())) {
        throw new Error(
          "Critical error: Voter in signing policy not found in voter registration info. This should never happen."
        );
      }
      const voter = tmpSigningAddressToVoter.get(voterSigningAddress)!.toLowerCase();
      this.signingAddressToVoter.set(voterSigningAddress, voter);
      const fullVoterRegistrationInfo = this.voterToRegistrationInfo.get(voter);
      if (!fullVoterRegistrationInfo) {
        throw new Error(
          "Critical error: Voter in signing policy not found in voter registration info. This should never happen."
        );
      }
      this.delegationAddressToCappedWeight.set(
        fullVoterRegistrationInfo.voterRegistrationInfo.delegationAddress.toLowerCase(),
        fullVoterRegistrationInfo.voterRegistrationInfo.wNatCappedWeight
      );
      this.submitAddressToVoter.set(fullVoterRegistrationInfo.voterRegistered.submitAddress.toLowerCase(), voter);
      this.submitAddressToCappedWeight.set(
        fullVoterRegistrationInfo.voterRegistered.submitAddress.toLowerCase(),
        fullVoterRegistrationInfo.voterRegistrationInfo.wNatCappedWeight
      );

      this.submitSignatureAddressToSigningAddress.set(
        fullVoterRegistrationInfo.voterRegistered.submitSignaturesAddress.toLowerCase(),
        fullVoterRegistrationInfo.voterRegistered.signingPolicyAddress.toLowerCase()
      )

      this.submitSignatureAddressToVoter.set(
        fullVoterRegistrationInfo.voterRegistered.submitSignaturesAddress.toLowerCase(),
        voter
      );

      this.submitAddressToVoterRegistrationInfo.set(
        fullVoterRegistrationInfo.voterRegistered.submitAddress.toLowerCase(),
        fullVoterRegistrationInfo
      );
      this.orderedVotersSubmitAddresses.push(fullVoterRegistrationInfo.voterRegistered.submitAddress);
      this.orderedVotersSubmitSignatureAddresses.push(fullVoterRegistrationInfo.voterRegistered.submitSignaturesAddress);

      this.signingAddressToDelegationAddress.set(
        voterSigningAddress,
        fullVoterRegistrationInfo.voterRegistrationInfo.delegationAddress
      );

      this.signingAddressToSubmitAddress.set(
        voterSigningAddress,
        fullVoterRegistrationInfo.voterRegistered.submitAddress
      );

      this.signingAddressToSigningWeight.set(voterSigningAddress, signingWeight);
    }
  }

  public get rewardEpochId(): RewardEpochId {
    return this.signingPolicy.rewardEpochId;
  }

  public get startVotingRoundId(): VotingEpochId {
    return this.signingPolicy.startVotingRoundId;
  }

  /**
   * The canonical order of feeds for this reward epoch.
   * Note: consumer should not change the array in any way.
   */
  public get canonicalFeedOrder(): Feed[] {
    return this._canonicalFeedOrder;
  }

  /**
   * Checks if the given address is a valid voter in this reward epoch.
   * @param submitAddress
   * @returns
   */
  public isEligibleSubmitAddress(submitAddress: Address): boolean {
    return this.submitAddressToVoter.has(submitAddress.toLowerCase());
  }

  public isEligibleSignerAddress(signerAddress: Address): boolean {
    return !!this.signingAddressToVoter.get(signerAddress.toLowerCase());
  }

  public isEligibleSubmitSignatureAddress(submitSignatureAddress: Address): boolean {
    return !!this.submitSignatureAddressToVoter.get(submitSignatureAddress.toLowerCase());
  }

  public getSigningAddressFromSubmitSignatureAddress(submitSignatureAddress: Address): Address | undefined {
    return this.submitSignatureAddressToSigningAddress.get(submitSignatureAddress.toLowerCase());
  }

  public getSubmitSignatureAddressFromSubmitAddress(submitAddress: Address): Address | undefined {
    return this.submitAddressToVoterRegistrationInfo.get(submitAddress.toLowerCase())?.voterRegistered.submitSignaturesAddress.toLowerCase();
  }

  public getSubmitAddressFromSubmitSignatureAddress(submitSignatureAddress: Address): Address | undefined {
    const voterAddress = this.submitSignatureAddressToVoter.get(submitSignatureAddress.toLowerCase());
    if (!voterAddress) {
      return undefined;
    }
    return this.voterToRegistrationInfo.get(voterAddress.toLowerCase())?.voterRegistered.submitAddress.toLowerCase();
  }

  public getSigningWeightForSubmitSignatureAddress(submitSignatureAddress: Address): number | undefined {
    const voterAddress = this.submitSignatureAddressToVoter.get(submitSignatureAddress.toLowerCase());
    if (!voterAddress) {
      return undefined;
    }
    const signingAddress = this.voterToRegistrationInfo.get(voterAddress.toLowerCase())?.voterRegistered.signingPolicyAddress.toLowerCase();
    if (!signingAddress) {
      return undefined;
    }
    return this.signingAddressToSigningWeight.get(signingAddress);
  }

  /**
   * Returns weight for participation in median voting.
   * @param submissionAddress
   * @returns
   */
  public ftsoMedianVotingWeight(submissionAddress: Address): bigint {
    if (!this.isEligibleSubmitAddress(submissionAddress)) {
      throw new Error("Invalid submission address");
    }
    return this.submitAddressToCappedWeight.get(submissionAddress.toLowerCase())!;
  }

  //Currently unused
  public ftsoRewardingWeight(submissionAddress: Address): bigint {
    return this.ftsoMedianVotingWeight(submissionAddress);
  }

  /**
   * Maps signer address to delegation address.
   * @param signerAddress
   * @returns
   */
  public signerToDelegationAddress(signerAddress: Address): Address | undefined {
    return this.signingAddressToDelegationAddress.get(signerAddress.toLowerCase());
  }

  /**
   * Given signer address it returns weight in signing policy.
   * @param signerAddress
   * @returns
   */
  public signerToSigningWeight(signerAddress: Address): number | undefined {
    return this.signingAddressToSigningWeight.get(signerAddress.toLowerCase());
  }

  /**
   * Given signer address it returns index in voting policy.
   * @param signerAddress
   * @returns
   */
  public signerToVotingPolicyIndex(signerAddress: Address): number | undefined {
    return this.signingAddressToVotingPolicyIndex.get(signerAddress.toLowerCase());
  }

  /**
   * Given a signer address it returns the full voter registration info.
   * @param signerAddress
   * @returns
   */
  public fullVoterRegistrationInfoForSigner(signerAddress: Address): FullVoterRegistrationInfo | undefined {
    const voterAddress = this.signingAddressToVoter.get(signerAddress.toLowerCase());
    if (!voterAddress) {
      return undefined;
    }
    return this.voterToRegistrationInfo.get(voterAddress.toLowerCase());
  }

  private cachedVoterWeights: Map<Address, VoterWeights> | undefined = undefined;

  /**
   * Returns a map from submitAddress to voterWeights information.
   * @returns
   */
  public getVotersWeights(): Map<Address, VoterWeights> {
    if (this.cachedVoterWeights) {
      return this.cachedVoterWeights;
    }
    const result = new Map<Address, VoterWeights>();
    this.orderedVotersSubmitAddresses.forEach((submissionAddress, index) => {
      const voterRegistrationInfo = this.submitAddressToVoterRegistrationInfo.get(submissionAddress.toLowerCase())!;
      const voterWeights: VoterWeights = {
        identityAddress: voterRegistrationInfo.voterRegistered.voter.toLowerCase(),
        submitAddress: voterRegistrationInfo.voterRegistered.submitAddress.toLowerCase(),
        signingAddress: voterRegistrationInfo.voterRegistered.signingPolicyAddress.toLowerCase(),
        delegationAddress: voterRegistrationInfo.voterRegistrationInfo.delegationAddress.toLowerCase(),
        delegationWeight: voterRegistrationInfo.voterRegistrationInfo.wNatWeight,
        cappedDelegationWeight: voterRegistrationInfo.voterRegistrationInfo.wNatCappedWeight,
        signingWeight: this.signingPolicy.weights[index],
        feeBIPS: voterRegistrationInfo.voterRegistrationInfo.delegationFeeBIPS,
        nodeIds: voterRegistrationInfo.voterRegistrationInfo.nodeIds,
        nodeWeights: voterRegistrationInfo.voterRegistrationInfo.nodeWeights,
      };
      result.set(submissionAddress, voterWeights);
    });
    this.cachedVoterWeights = result;
    return result;
  }
}
