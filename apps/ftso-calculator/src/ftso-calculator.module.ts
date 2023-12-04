import { Module } from '@nestjs/common';
import { FtsoCalculatorController } from './ftso-calculator.controller';
import { FtsoCalculatorService } from './ftso-calculator.service';

@Module({
  imports: [],
  controllers: [FtsoCalculatorController],
  providers: [FtsoCalculatorService],
})
export class FtsoCalculatorModule {}
