export interface OptionalCommandOptions {
  rewardEpochId?: number;
  startRewardEpochId?: number;
  endRewardEpochId?: number;
  useExpectedEndIfNoSigningPolicyAfter?: boolean;
  startVotingRoundId?: number;
  endVotingRoundId?: number;
  initialize?: boolean;
  calculateRewardCalculationData?: boolean;
  calculateOffers?: boolean;
  calculateClaims?: boolean;
  aggregateClaims?: boolean;
  retryDelayMs?: number;
  // if set, then parallel processing is enabled
  batchSize?: number;
  numberOfWorkers?: number;
  // if set, the logs will be written to the file
  loggerFile?: string;
  calculationFolder?: string;
  isWorker?: boolean;
  recoveryMode?: boolean;
  useFastUpdatesData?: boolean;
  useFDCData?: boolean;
  tempRewardEpochFolder?: boolean;
  incrementalCalculation?: boolean;
}
