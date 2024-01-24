import { IPayloadMessage } from "../../fsp-utils/src/PayloadMessage";


interface IFtsoDataManager {

  getCommitsForVotingRound(votingRoundId: number): Promise<IPayloadMessage<string>[]>;
  getRevealsForVotingRound(votingRoundId: number): Promise<IPayloadMessage<string>[]>;
}