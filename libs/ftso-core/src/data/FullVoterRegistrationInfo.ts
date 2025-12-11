import { VoterRegistered, VoterRegistrationInfo } from "../../../contracts/src/events";

export interface FullVoterRegistrationInfo {
  voterRegistrationInfo: VoterRegistrationInfo;
  voterRegistered: VoterRegistered;
}
