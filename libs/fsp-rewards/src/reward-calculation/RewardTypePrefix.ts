/**
 * Used to prefix the info message in IPartialRewardClaim when generating reward claims.
 */
export enum RewardTypePrefix {
  MEDIAN = "Median",
  SIGNING = "Signing",
  FINALIZATION = "Finalization",
  DOUBLE_SIGNERS = "Double signers",
  REVEAL_OFFENDERS = "Reveal offenders",
  FAST_UPDATES_ACCURACY = "Fast updates accuracy",
  FULL_OFFER_CLAIM_BACK = "Full offer claim back",
  PARTIAL_FDC_OFFER_CLAIM_BACK = "Partial FDC offer claim back",
  FDC_SIGNING = "FDC signing",
  FDC_FINALIZATION = "FDC finalization",
  FDC_OFFENDERS = "FDC offenders",
}
