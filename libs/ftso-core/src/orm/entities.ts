import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";

// Name of the transaction table in FTL project
@Entity("transactions")
export class TLPTransaction {
  @PrimaryColumn()
  id: number;

  @Column()
  hash: string;

  @Column()
  function_sig: string;

  @Column()
  input: string;

  @Column()
  block_number: number;

  @Column()
  block_hash: string;

  @Column()
  transaction_index: number;

  @Column()
  from_address: string;

  @Column()
  to_address: string;

  @Column()
  status: number;

  @Column()
  value: string;

  @Column()
  gas_price: string;

  @Column()
  gas: number;

  @Column()
  timestamp: number;

  @OneToMany(() => TLPEvents, (event) => event.transaction_id)
  TPLEvents_set: TLPEvents[];
}

// Name of the event table in FTL project
@Entity("logs")
export class TLPEvents {
  @PrimaryColumn()
  id: number;

  @ManyToOne((type) => TLPTransaction, (transaction_id) => transaction_id.TPLEvents_set)
  @JoinColumn({ name: "transaction_id" })
  transaction_id: TLPTransaction;

  @Column()
  address: string;

  @Column()
  data: string;

  @Column()
  topic0: string;

  @Column()
  topic1: string;

  @Column()
  topic2: string;

  @Column()
  topic3: string;

  @Column()
  log_index: number;

  @Column()
  timestamp: number;

  @Column()
  block_number: number;
}

@Entity("states")
export class TLPState {
  @PrimaryColumn()
  id: number;

  @Column({ length: 50, nullable: true })
  @Index()
  name: string = "";

  @Column({ unsigned: true })
  index: number = 0;

  @Column({ unsigned: true })
  block_timestamp: number = 0;

  @Column({ type: "datetime", precision: 3, nullable: true })
  updated: Date = new Date();
}
