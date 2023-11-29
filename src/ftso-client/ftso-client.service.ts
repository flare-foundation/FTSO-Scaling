import { Module, Injectable } from "@nestjs/common";

@Injectable()
export class FtsoClientService {
  async run() {
    console.log("Running ftso-client");
  }

  async getCommit(epochId: number): Promise<string> {
    return "";
  }
  async getReveal(epochId: number): Promise<EpochData | undefined> {
    return undefined;
  }
  async getResultAfterDeadline(
    epochId: number,
    deadlineSec: number
  ): Promise<string> {
    return "";
  }
}
