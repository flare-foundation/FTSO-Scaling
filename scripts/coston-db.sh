export NETWORK=from-env

export FTSO_CA_FTSO_SYSTEMS_MANAGER_ADDRESS=0x6e5A85aB09c2056A9Af46c3Ca5a5A1E6752C8D79
export FTSO_CA_FTSO_REWARD_OFFERS_MANAGER_ADDRESS=0x3692A549F0436EADCD77dCC254D7D3843537e6e0
export FTSO_CA_REWARD_MANAGER_ADDRESS=0xB5927e4A55125a5eED6E24AC11F418c916689D4C
export FTSO_CA_SUBMISSION_ADDRESS=0x2cA6571Daa15ce734Bbd0Bf27D5C9D16787fc33f
export FTSO_CA_RELAY_ADDRESS=0xf84B299803fe4184a7c9167514E5D4f19B3cD95b
export FTSO_CA_FLARE_SYSTEMS_CALCULATOR_ADDRESS=0x99D17A3EF05fddF0C0d4E1c0D0Ba4f8aCc8e150a
export FTSO_CA_VOTER_REGISTRY_ADDRESS=0xb9657EDCf84BCA4DE60b0f849f397C093459D0f8
export ES_FIRST_VOTING_ROUND_START_TS=1658430000
export ES_VOTING_EPOCH_DURATION_SECONDS=90
export ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID=0
export ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS=240
export FTSO_REVEAL_DEADLINE_SECONDS=30
export INITIAL_REWARD_EPOCH_ID=2343

export RANDOM_GENERATION_BENCHING_WINDOW=1
export PENALTY_FACTOR=30
export GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC=10
export GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC=20
export MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS=3000
export FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS=100
# 4 reward epochs 4 x 240 x 90 (1 day)
export DB_REQUIRED_INDEXER_HISTORY_TIME_SEC=86400
export VOTING_ROUND_HISTORY_SIZE=10000
export INDEXER_TOP_TIMEOUT=1000
export DB_HOST=127.0.0.1
export DB_PORT=3336
export DB_USERNAME=root
export DB_PASSWORD=root
export DB_NAME=flare_ftso_indexer

export START_REWARD_EPOCH_ID=2344
# export START_REWARD_EPOCH_ID=2367

# check here: https://coston-explorer.flare.network/address/0x6e5A85aB09c2056A9Af46c3Ca5a5A1E6752C8D79/read-contract#address-tabs
# 9.  getCurrentRewardEpochId, and use one epoch less for test (required indexer history is 4 epochs/ 1 day)
# export REWARD_EPOCH_ID=2349

yarn nest build ftso-reward-calculation-process

# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -r $REWARD_EPOCH_ID -i
# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -r $REWARD_EPOCH_ID -c -b 10 -w 24
# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -r $REWARD_EPOCH_ID -a

# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -r $REWARD_EPOCH_ID -i -a -c -b 10 -w 24

# calculate all for the last finished reward epoch id
node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -i -a -c -b 10 -w 24 -d $START_REWARD_EPOCH_ID -m 10000


# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -i -a -c -b 10 -w 24