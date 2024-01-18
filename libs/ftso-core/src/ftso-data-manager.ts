import { IPayloadMessage } from "./utils/PayloadMessage";


interface IFtsoDataManager {

  getCommitsForVotingRound(votingRoundId: number): Promise<IPayloadMessage<string>[]>;
  getRevealsForVotingRound(votingRoundId: number): Promise<IPayloadMessage<string>[]>;
}