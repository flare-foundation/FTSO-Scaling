import { Module } from "@nestjs/common";

@Module({})
export class FtsoFinalizerModule {
  run(): void {
    console.log("Running ftso-client");
  }
}
