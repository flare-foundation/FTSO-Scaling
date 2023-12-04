import { Injectable } from "@nestjs/common";

import { EntityManager } from "typeorm";
import { RewardClaimUnit } from "../../dto/reward-claim.dto";
import {
  ITLPEvents,
  ITLPTransaction,
  ITPLState,
  TLPEvents,
  TLPState,
  TLPTransaction,
} from "../../../../../libs/ftso-core/src/orm/entities";

@Injectable()
export abstract class BaseRewardingService {
  protected entityManager: EntityManager;
  protected transactionTable: ITLPTransaction;
  protected eventTable: ITLPEvents;
  protected stateTable: ITPLState;

  constructor() {
    this.transactionTable = TLPTransaction;
    this.eventTable = TLPEvents;
    this.stateTable = TLPState;
  }

  abstract calculateRewardsForEpoch(rewardEpochId: number): Promise<RewardClaimUnit[]>;
}
