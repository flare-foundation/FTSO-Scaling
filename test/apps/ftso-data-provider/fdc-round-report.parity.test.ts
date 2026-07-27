import axios from "axios";
import { expect } from "chai";
import { getTestFile } from "../../utils/getTestFile";

/**
 * Live parity check: compares this repo's fdc-round-report endpoint against the Flare
 * systems explorer's voting_round_grid API for a random sample of recent rounds.
 *
 * Needs network access, a running data provider with the fdc-round-report endpoint and
 * a synced Flare indexer behind it — so it SELF-SKIPS unless FDC_PARITY_BASE_URL is set
 * and never runs as part of the regular suite.
 *
 * Run with:
 *   FDC_PARITY_BASE_URL=http://<host>:<port> FDC_PARITY_API_KEY=<key> \
 *     pnpm test test/apps/ftso-data-provider/fdc-round-report.parity.test.ts
 *
 * Tuning (all optional):
 *   FDC_PARITY_ROUNDS=50          sample size
 *   FDC_PARITY_WINDOW_HOURS=4     how far back rounds are sampled from
 *   FDC_PARITY_DELAY_MS=3000      pause between rounds — the explorer is heavily rate limited
 *   FDC_PARITY_EXPLORER_URL=...   alternative explorer grid URL
 *   FDC_PARITY_FIRST_ROUND_TS / FDC_PARITY_ROUND_SEC   round timing (defaults: Flare mainnet)
 *
 * Known, deliberate differences that are NOT compared:
 *   - explorer `pk` vs our `id` object (different identifiers by design)
 *   - entity display_name/logo_url/listed (we serve on-chain data only)
 *   - `is_proved` is compared informationally (warnings, not failures): the explorer
 *     derives it from finalized-consensus execution tracking while we approximate with
 *     bitvote support vs the signing policy threshold.
 */

const BASE_URL = process.env.FDC_PARITY_BASE_URL;
const API_KEY = process.env.FDC_PARITY_API_KEY ?? "";
const EXPLORER_URL =
  process.env.FDC_PARITY_EXPLORER_URL ??
  "https://flare-systems-explorer.flare.network/backend-url/api/v0/protocol/fdc/attestation_request/voting_round_grid";
const SAMPLE_SIZE = parseInt(process.env.FDC_PARITY_ROUNDS ?? "50");
const WINDOW_HOURS = parseFloat(process.env.FDC_PARITY_WINDOW_HOURS ?? "4");
const DELAY_MS = parseInt(process.env.FDC_PARITY_DELAY_MS ?? "3000");
// Flare mainnet FSP voting round timing.
const FIRST_ROUND_TS = parseInt(process.env.FDC_PARITY_FIRST_ROUND_TS ?? "1658430000");
const ROUND_SEC = parseInt(process.env.FDC_PARITY_ROUND_SEC ?? "90");
const EXPLORER_PAGE_LIMIT = 100;
const WEIGHT_TOLERANCE = 1e-9;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The subset of the round grid JSON that is compared; shared by our endpoint and the explorer. */
interface GridPayload {
  status?: string;
  count: number;
  attestation_requests: {
    attestation_request: {
      attestation_type_source: { attestation_type: string | null; source_id: string | null };
      is_proved: string;
    };
    count: number;
    weight: number;
  }[];
  entity_bit_vectors: {
    entity: { identity_address: string };
    bit_vector: boolean[];
  }[];
}

/** GET with retries on 429/5xx (the explorer is heavily rate limited); undefined = give up. */
async function fetchJson(url: string, headers: Record<string, string>, label: string): Promise<unknown> {
  let backoffMs = 10_000;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const response = await axios.get(url, { headers, timeout: 30_000, validateStatus: () => true });
      if (response.status === 200) {
        return response.data as unknown;
      }
      if (response.status !== 429 && response.status < 500) {
        console.log(`    ${label}: HTTP ${response.status}, skipping round`);
        return undefined;
      }
      console.log(`    ${label}: HTTP ${response.status}, backing off ${backoffMs / 1000}s`);
    } catch (e) {
      console.log(`    ${label}: ${(e as Error).message}, backing off ${backoffMs / 1000}s`);
    }
    await sleep(backoffMs);
    backoffMs *= 2;
  }
  console.log(`    ${label}: giving up after retries`);
  return undefined;
}

function sampleRecentRounds(): number[] {
  const currentRound = Math.floor((Date.now() / 1000 - FIRST_ROUND_TS) / ROUND_SEC);
  // Newest sampled round must be safely past its bitvote deadline and finalization.
  const newest = currentRound - 5;
  const oldest = newest - Math.floor((WINDOW_HOURS * 3600) / ROUND_SEC) + 1;
  const pool: number[] = [];
  for (let round = oldest; round <= newest; round++) {
    pool.push(round);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(SAMPLE_SIZE, pool.length)).sort((a, b) => a - b);
}

/** Returns hard differences; is_proved deviations are appended to `warnings` instead. */
function compareRound(ours: GridPayload, explorer: GridPayload, warnings: string[]): string[] {
  const diffs: string[] = [];
  if (ours.count !== explorer.count) {
    diffs.push(`count: ours ${ours.count} vs explorer ${explorer.count}`);
  }

  const requestCount = Math.min(ours.attestation_requests.length, explorer.attestation_requests.length);
  if (ours.attestation_requests.length !== explorer.attestation_requests.length) {
    diffs.push(
      `attestation_requests length: ours ${ours.attestation_requests.length} vs explorer ${explorer.attestation_requests.length}`
    );
  }
  for (let i = 0; i < requestCount; i++) {
    const ourEntry = ours.attestation_requests[i];
    const theirEntry = explorer.attestation_requests[i];
    const ourTypeSource = ourEntry.attestation_request.attestation_type_source;
    const theirTypeSource = theirEntry.attestation_request.attestation_type_source;
    if (
      ourTypeSource.attestation_type !== theirTypeSource.attestation_type ||
      ourTypeSource.source_id !== theirTypeSource.source_id
    ) {
      diffs.push(
        `request[${i}] type/source: ours ${ourTypeSource.attestation_type}/${ourTypeSource.source_id} ` +
          `vs explorer ${theirTypeSource.attestation_type}/${theirTypeSource.source_id}`
      );
    }
    if (ourEntry.count !== theirEntry.count) {
      diffs.push(`request[${i}] duplicate count: ours ${ourEntry.count} vs explorer ${theirEntry.count}`);
    }
    if (Math.abs(ourEntry.weight - theirEntry.weight) > WEIGHT_TOLERANCE) {
      diffs.push(`request[${i}] weight: ours ${ourEntry.weight} vs explorer ${theirEntry.weight}`);
    }
    if (ourEntry.attestation_request.is_proved !== theirEntry.attestation_request.is_proved) {
      warnings.push(
        `request[${i}] is_proved: ours ${ourEntry.attestation_request.is_proved} ` +
          `vs explorer ${theirEntry.attestation_request.is_proved}`
      );
    }
  }

  // Entities compared as address -> bit_vector maps: identity of the sets and each vector.
  const ourEntities = new Map<string, boolean[]>(
    ours.entity_bit_vectors.map((e): [string, boolean[]] => [e.entity.identity_address.toLowerCase(), e.bit_vector])
  );
  const theirEntities = new Map<string, boolean[]>(
    explorer.entity_bit_vectors.map((e): [string, boolean[]] => [e.entity.identity_address.toLowerCase(), e.bit_vector])
  );
  for (const [address, ourVector] of ourEntities) {
    const theirVector = theirEntities.get(address);
    if (theirVector === undefined) {
      diffs.push(`entity ${address}: present in ours, missing in explorer`);
      continue;
    }
    if (JSON.stringify(ourVector) !== JSON.stringify(theirVector)) {
      diffs.push(
        `entity ${address} bit_vector: ours ${JSON.stringify(ourVector)} vs explorer ${JSON.stringify(theirVector)}`
      );
    }
  }
  for (const address of theirEntities.keys()) {
    if (!ourEntities.has(address)) {
      diffs.push(`entity ${address}: present in explorer, missing in ours`);
    }
  }
  return diffs;
}

(BASE_URL ? describe : describe.skip)(`fdc-round-report explorer parity (${getTestFile(__filename)})`, () => {
  it(`matches the explorer voting_round_grid for ${SAMPLE_SIZE} random rounds of the last ${WINDOW_HOURS}h`, async function () {
    const rounds = sampleRecentRounds();
    console.log(`  Comparing ${rounds.length} rounds: ${rounds[0]}..${rounds[rounds.length - 1]}`);

    const failures: string[] = [];
    const warnings: string[] = [];
    let compared = 0;
    let skipped = 0;

    for (const round of rounds) {
      // The explorer is very rate limited — keep this strictly sequential and throttled.
      if (compared + skipped > 0) {
        await sleep(DELAY_MS);
      }

      const ours = (await fetchJson(
        `${BASE_URL}/fdcRoundResults/${round}`,
        { "X-API-KEY": API_KEY },
        `ours(${round})`
      )) as GridPayload | undefined;
      if (ours === undefined || ours.status !== "OK") {
        console.log(`    round ${round}: our endpoint returned ${ours?.status ?? "no response"}, skipping`);
        skipped++;
        continue;
      }

      const explorer = (await fetchJson(
        `${EXPLORER_URL}?voting_round_id=${round}&limit=${EXPLORER_PAGE_LIMIT}&offset=0`,
        {},
        `explorer(${round})`
      )) as GridPayload | undefined;
      if (explorer === undefined) {
        skipped++;
        continue;
      }
      if (explorer.count > EXPLORER_PAGE_LIMIT) {
        console.log(`    round ${round}: ${explorer.count} requests exceed one explorer page, skipping`);
        skipped++;
        continue;
      }

      const roundWarnings: string[] = [];
      const diffs = compareRound(ours, explorer, roundWarnings);
      compared++;
      warnings.push(...roundWarnings.map((w) => `round ${round}: ${w}`));
      if (diffs.length > 0) {
        failures.push(`round ${round}:\n    ${diffs.join("\n    ")}`);
        console.log(`    round ${round}: MISMATCH (${diffs.length} differences)`);
      } else {
        console.log(`    round ${round}: match (${ours.count} requests, ${ours.entity_bit_vectors.length} entities)`);
      }
    }

    if (warnings.length > 0) {
      console.log(`  is_proved deviations (informational, expected for the threshold approximation):`);
      for (const warning of warnings) {
        console.log(`    ${warning}`);
      }
    }
    console.log(`  Compared ${compared} rounds, skipped ${skipped}, mismatched ${failures.length}`);

    expect(compared, "no rounds could be compared — check base URL, API key and indexer history").to.be.greaterThan(0);
    expect(failures, `\n${failures.join("\n")}`).to.deep.equal([]);
  });
});
