import { Module, Injectable } from "@nestjs/common";

@Injectable()
export class TopLevelClientService {
  run(): void {
    console.log("Running top-level-client");
  }
}
