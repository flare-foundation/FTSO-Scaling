import { Entity, Column, PrimaryGeneratedColumn, Index } from "typeorm";
import { TxData } from "./voting-types";

export abstract class BaseEntity {
  @PrimaryGeneratedColumn({ type: "int" })
  id: any;
}

@Entity()
export class FtsoTransaction extends BaseEntity {
  @Column()
  @Index({ unique: true })
  hash: string = "";

  @Column()
  @Index({ unique: false })
  func_sig: string = "";

  @Column()
  data: string = "";

  @Column()
  @Index({ unique: false })
  timestamp: number = 0;

  @Column()
  @Index()
  from: string = "";

  @Column()
  @Index()
  to: string = "";

  @Column()
  status: boolean = true;

  @Column()
  block_id: number = 0;

  toTxData(): TxData {
    const txData: TxData = {
      hash: this.hash,
      input: "0x" + this.data,
      from: "0x" + this.from,
      to: "0x" + this.to,
      blockNumber: this.block_id,
      status: this.status,
    };
    return txData;
  }
}

@Entity()
export class FtsoLog extends BaseEntity {
  @Column()
  log: string = "";

  @Column()
  @Index()
  tx_hash: string = "";

  @Column()
  @Index()
  timestamp: number = 0;
}

@Entity()
export class State extends BaseEntity {
  @Column({ length: 50, nullable: true })
  @Index()
  name: string = "";

  @Column({ unsigned: true })
  index: number = 0;

  @Column({ type: "datetime", precision: 3, nullable: true })
  updated: Date = new Date();
}
