import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getAddress } from "ethers";
import { LRUCache } from "lru-cache";
import { EntityManager } from "typeorm";
import { ContractMethodNames } from "../../../../libs/contracts/src/definitions";
import { EPOCH_SETTINGS } from "../../../../libs/ftso-core/src/constants";
import { BlockAssuranceResult } from "../../../../libs/ftso-core/src/IndexerClient";
import { RewardEpoch } from "../../../../libs/ftso-core/src/RewardEpoch";
import { RewardEpochManager } from "../../../../libs/ftso-core/src/RewardEpochManager";
import { errorString } from "../../../../libs/ftso-core/src/utils/error";
import {
  FdcAttestationRequestEntry,
  FdcEntityBitVector,
  FdcRoundReportPayload,
} from "../dto/fdc-round-report-response.dto";
import { FdcIndexerClient } from "./FdcIndexerClient";
import {
  FDC_PROTOCOL_ID,
  bitVoteIndicesNum,
  decodeAttestationTypeAndSource,
  parseBitVotePayload,
  toBitVector,
  uniqueRequestsIndices,
} from "./fdc-round-utils";

/**
 * Assembles per-round FDC (protocol 200) reports in the shape of the Flare explorer's
 * FDC round JSON: deduplicated attestation requests with bitvote support weights, and
 * each provider's bitvote as a boolean vector. Everything is computed from the local
 * C-chain indexer database; provider display metadata (names/logos) is off-chain and
 * deliberately not served.
 */
@Injectable()
export class FdcRoundReportService {
  private readonly logger = new Logger(FdcRoundReportService.name);

  private readonly indexerClient: FdcIndexerClient;
  private readonly rewardEpochManager: RewardEpochManager;
  private readonly indexer_top_timeout: number;

  /**
   * LRU cache of assembled reports. Reports are immutable once the bitvote deadline of
   * round N+1 has passed (the controller's TOO_EARLY gate ensures computation only
   * happens after that). Opt-in: undefined = caching disabled (FDC_RESULT_CACHE_SIZE
   * unset or 0, the backwards-compatible default).
   */
  private readonly reportCache: LRUCache<number, FdcRoundReportPayload> | undefined;

  /** In-flight coalescing: N concurrent requests for the same round share one computation. */
  private readonly reportInFlight = new Map<number, Promise<FdcRoundReportPayload | undefined>>();

  constructor(manager: EntityManager, configService: ConfigService) {
    const requiredHistorySec = configService.get<number>("required_indexer_history_time_sec");
    this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    this.indexerClient = new FdcIndexerClient(manager, requiredHistorySec, new Logger(FdcIndexerClient.name));
    this.rewardEpochManager = new RewardEpochManager(this.indexerClient);
    const cacheSize = configService.get<number>("fdc_result_cache_size") ?? 0;
    this.reportCache = cacheSize > 0 ? new LRUCache({ max: cacheSize }) : undefined;
  }

  async getFdcRoundReport(votingRoundId: number): Promise<FdcRoundReportPayload | undefined> {
    const cached = this.reportCache?.get(votingRoundId);
    if (cached !== undefined) {
      return cached;
    }

    const inFlight = this.reportInFlight.get(votingRoundId);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const computation = this.computeFdcRoundReport(votingRoundId);
    this.reportInFlight.set(votingRoundId, computation);
    try {
      return await computation;
    } finally {
      this.reportInFlight.delete(votingRoundId);
    }
  }

  private async computeFdcRoundReport(votingRoundId: number): Promise<FdcRoundReportPayload | undefined> {
    let rewardEpoch: RewardEpoch | undefined;
    try {
      rewardEpoch = await this.rewardEpochManager.getRewardEpochForVotingEpochId(votingRoundId);
    } catch (e) {
      this.logger.warn(`No reward epoch data for voting round ${votingRoundId}: ${errorString(e)}`);
    }
    if (rewardEpoch === undefined) {
      return undefined;
    }

    const requestsResponse = await this.indexerClient.getFdcAttestationRequestEvents(
      votingRoundId,
      this.indexer_top_timeout
    );
    if (requestsResponse.status === BlockAssuranceResult.NOT_OK || requestsResponse.data === undefined) {
      this.logger.error(`Attestation request data not available for voting round ${votingRoundId}`);
      return undefined;
    }
    const records = requestsResponse.data;
    const requestGroups = uniqueRequestsIndices(records.map((record) => record.request));
    const dedupCount = requestGroups.length;

    // Bitvotes for round N ride in submit2 transactions of round N+1, before the reveal deadline.
    const submissionsResponse = await this.indexerClient.getSubmissionDataInRange(
      ContractMethodNames.submit2,
      EPOCH_SETTINGS().votingEpochStartSec(votingRoundId + 1),
      EPOCH_SETTINGS().revealDeadlineSec(votingRoundId + 1),
      this.indexer_top_timeout
    );
    if (submissionsResponse.status === BlockAssuranceResult.NOT_OK || submissionsResponse.data === undefined) {
      this.logger.error(`Bitvote submission data not available for voting round ${votingRoundId}`);
      return undefined;
    }

    // Last valid bitvote per eligible submit address wins (same rule as the reward calculation).
    const voterToBitVotePayload = new Map<string, string>();
    for (const submission of submissionsResponse.data) {
      if (submission.relativeTimestamp >= EPOCH_SETTINGS().revealDeadlineSeconds) {
        continue;
      }
      for (const message of submission.messages) {
        if (message.protocolId !== FDC_PROTOCOL_ID || message.votingRoundId !== votingRoundId) {
          continue;
        }
        const submitAddress = submission.submitAddress.toLowerCase();
        if (!rewardEpoch.isEligibleSubmitAddress(submitAddress)) {
          this.logger.warn(`Ignoring FDC bitvote from non-eligible address ${submitAddress}`);
          continue;
        }
        voterToBitVotePayload.set(submitAddress, message.payload);
      }
    }

    // A bitvote whose declared request count differs from the round's (buggy/outdated
    // provider) is still shown at its declared length — matching the explorer — but is
    // excluded from support weights (also matching the explorer, verified numerically).
    const voterToBitVote = new Map<string, { indices: number[]; declaredCount: number }>();
    for (const [submitAddress, payload] of voterToBitVotePayload) {
      try {
        const { declaredCount, bits } = parseBitVotePayload(payload);
        voterToBitVote.set(submitAddress, { indices: bitVoteIndicesNum(bits, declaredCount), declaredCount });
        if (declaredCount !== dedupCount) {
          this.logger.warn(
            `FDC bitvote from ${submitAddress} for round ${votingRoundId} declares ${declaredCount} requests, ` +
              `round has ${dedupCount} — shown but not counted toward weights`
          );
        }
      } catch (e) {
        this.logger.warn(
          `Dropping invalid FDC bitvote from ${submitAddress} for round ${votingRoundId}: ${errorString(e)}`
        );
      }
    }

    const supportWeight = new Array<number>(dedupCount).fill(0);
    for (const [submitAddress, bitVote] of voterToBitVote) {
      if (bitVote.declaredCount !== dedupCount) {
        continue;
      }
      const signingWeight = rewardEpoch.submitAddressToSigningWeight.get(submitAddress) ?? 0;
      for (const index of bitVote.indices) {
        supportWeight[index] += signingWeight;
      }
    }

    const attestation_requests: FdcAttestationRequestEntry[] = requestGroups.map((group, dedupIndex) => {
      const representative = records[group[0]];
      return {
        attestation_request: {
          id: {
            tx_hash: representative.txHash,
            block_number: representative.blockNumber,
            log_index: representative.logIndex,
            timestamp: representative.timestamp,
          },
          attestation_type_source: decodeAttestationTypeAndSource(representative.request.data),
          is_proved: supportWeight[dedupIndex] > rewardEpoch.signingPolicy.threshold ? "EXECUTED" : "UNCONFIRMED",
        },
        count: group.length,
        weight: rewardEpoch.totalSigningWeight > 0 ? supportWeight[dedupIndex] / rewardEpoch.totalSigningWeight : 0,
      };
    });

    // Entities in signing policy order; only voters with a valid bitvote appear.
    const entity_bit_vectors: FdcEntityBitVector[] = [];
    for (const submitAddress of rewardEpoch.orderedVotersSubmitAddresses) {
      const bitVote = voterToBitVote.get(submitAddress.toLowerCase());
      if (bitVote === undefined) {
        continue;
      }
      entity_bit_vectors.push({
        entity: {
          identity_address: getAddress(rewardEpoch.submitAddressToVoter.get(submitAddress.toLowerCase())),
          display_name: null,
          logo_url: null,
          listed: false,
        },
        bit_vector: toBitVector(bitVote.indices, bitVote.declaredCount),
      });
    }

    const report: FdcRoundReportPayload = { attestation_requests, entity_bit_vectors, count: dedupCount };
    // Cache only reports built from fully indexed data; TIMEOUT_OK data may be partial
    // and must stay recomputable.
    if (requestsResponse.status === BlockAssuranceResult.OK && submissionsResponse.status === BlockAssuranceResult.OK) {
      this.reportCache?.set(votingRoundId, report);
    }
    return report;
  }
}
