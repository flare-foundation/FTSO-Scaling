export NETWORK=from-env
export FTSO_CA_FTSO_SYSTEMS_MANAGER_ADDRESS=0xa4bcDF64Cdd5451b6ac3743B414124A6299B65FF
export FTSO_CA_FTSO_REWARD_OFFERS_MANAGER_ADDRESS=0x8456161947DFc1fC159A0B26c025cD2b4bba0c3e
export FTSO_CA_REWARD_MANAGER_ADDRESS=0x22474D350EC2dA53D717E30b96e9a2B7628Ede5b
export FTSO_CA_SUBMISSION_ADDRESS=0x18b9306737eaf6E8FC8e737F488a1AE077b18053
export FTSO_CA_RELAY_ADDRESS=0x5A0773Ff307Bf7C71a832dBB5312237fD3437f9F
export FTSO_CA_FLARE_SYSTEMS_CALCULATOR_ADDRESS=0x58F132FBB86E21545A4Bace3C19f1C05d86d7A22
export FTSO_CA_VOTER_REGISTRY_ADDRESS=0xB00cC45B4a7d3e1FEE684cFc4417998A1c183e6d
export ES_FIRST_VOTING_ROUND_START_TS=1704250616
export ES_VOTING_EPOCH_DURATION_SECONDS=90
export ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID=1000
export ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS=3360
export FTSO_REVEAL_DEADLINE_SECONDS=30
export RANDOM_GENERATION_BENCHING_WINDOW=1
export PENALTY_FACTOR=30
export GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC=10
export GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC=20
export MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS=3000
export FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS=100
export DB_SQLITE3_PATH=test-db/full-test-done.db
export DB_REQUIRED_INDEXER_HISTORY_TIME_SEC=604800
export VOTING_ROUND_HISTORY_SIZE=10000
export INDEXER_TOP_TIMEOUT=1000
export FORCE_NOW=1704945457

# yarn nest build ftso-reward-calculation-process
# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js

# yarn nest start ftso-reward-calculation-process
# yarn ts-node apps/ftso-reward-calculation-process/src/main.ts ftso-reward-calculation-process -r 1 -i

# yarn ts-node apps/ftso-reward-calculation-process/src/main.ts ftso-reward-calculation-process -r 1 -s 4360 -e 4370 -c
# yarn ts-node apps/ftso-reward-calculation-process/src/main.ts ftso-reward-calculation-process -r 1 -s 4360 -e 4370 -a

# yarn ts-node apps/ftso-reward-calculation-process/src/main.ts ftso-reward-calculation-process -r 1 -s 4360 -e 4500 -c -b 10 -w 10

# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -r 1 -s 4360 -e 4500 -c -b 10 -w 10
yarn ts-node apps/ftso-reward-calculation-process/src/main.ts ftso-reward-calculation-process -r 1 -s 4360 -e 4510 -a