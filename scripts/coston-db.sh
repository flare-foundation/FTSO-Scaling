export NETWORK=coston

export DB_REQUIRED_INDEXER_HISTORY_TIME_SEC=86400
export VOTING_ROUND_HISTORY_SIZE=10000
export INDEXER_TOP_TIMEOUT=1000
export DB_HOST=127.0.0.1
export DB_PORT=3336
export DB_USERNAME=root
export DB_PASSWORD=root
export DB_NAME=flare_ftso_indexer

export REMOVE_ANNOYING_MESSAGES=true
export ALLOW_IDENTITY_ADDRESS_SIGNING=true
# Start reward epoch id on Coston
export START_REWARD_EPOCH_ID=2344
# export START_REWARD_EPOCH_ID=2367

# check here: https://coston-explorer.flare.network/address/0x6e5A85aB09c2056A9Af46c3Ca5a5A1E6752C8D79/read-contract#address-tabs
# 9.  getCurrentRewardEpochId, and use one epoch less for test (required indexer history is 4 epochs/ 1 day)
# export REWARD_EPOCH_ID=2349

# COMPILATION
yarn nest build ftso-reward-calculation-process

# ---------------------------------------------------------------------------------------------------------------------------
# Calculating all reward data from the starting reward epoch id. The calculation of claims is parallelized. 
# In the current (ongoing) reward epoch the calculation is switched to incremental, as data becomes available. 
# If the data for a specific reward epoch id is already available, the calculation is skipped.
export FROM_REWARD_EPOCH_ID=2733
# export TEST_FU_INFLATION_REWARD_AMOUNT=10000000000000000000000  # 10,000 CFLR
node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -g -o -c -a -y -b 40 -w 10 -d $FROM_REWARD_EPOCH_ID -m 10000

# ---------------------------------------------------------------------------------------------------------------------------
# Recoverable sequential calculation
# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -i -a -c -o -d $FROM_REWARD_EPOCH_ID -m 10000
# ---------------------------------------------------------------------------------------------------------------------------
# Calculating for specific reward epoch id
# export SPECIFIC_REWARD_EPOCH_ID=2380
# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -i -a -c -b 10 -w 24 -r $SPECIFIC_REWARD_EPOCH_ID -m 10000