# Reward calculation for Songbird network
# Setup the correct DB connection and run the script, e.g.
# ./scripts/rewards/songbird-db.sh

export NETWORK=songbird

export DB_REQUIRED_INDEXER_HISTORY_TIME_SEC=86400
export VOTING_ROUND_HISTORY_SIZE=10000
export INDEXER_TOP_TIMEOUT=1000
export DB_HOST=127.0.0.1
export DB_PORT=3336
export DB_USERNAME=root
export DB_PASSWORD=root
export DB_NAME=flare_ftso_indexer

export REMOVE_ANNOYING_MESSAGES=true


# check here: https://songbird-explorer.flare.network/address/0x421c69E22f48e14Fc2d2Ee3812c59bfb81c38516/read-contract#address-tabs
# 9.  getCurrentRewardEpochId, and use one epoch less for test (required indexer history is 4 epochs/ 14 days)
# export REWARD_EPOCH_ID=2349

# COMPILATION
yarn nest build ftso-reward-calculation-process

# ---------------------------------------------------------------------------------------------------------------------------
# Calculating all reward data from the starting reward epoch id. The calculation of claims is parallelized. 
# In the current (ongoing) reward epoch the calculation is switched to incremental, as data becomes available. 
# If the data for a specific reward epoch id is already available, the calculation is skipped.
export FROM_REWARD_EPOCH_ID=196
node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -g -o -c -a -b 100 -w 10 -d $FROM_REWARD_EPOCH_ID -m 10000

# Incremental calculation
# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -l -b 80 -w 5 -m 10000

# ---------------------------------------------------------------------------------------------------------------------------
# Recoverable sequential calculation
# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -i -a -c -o -d $FROM_REWARD_EPOCH_ID -m 10000
# ---------------------------------------------------------------------------------------------------------------------------
# Calculating for specific reward epoch id
# export SPECIFIC_REWARD_EPOCH_ID=2380
# node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -i -a -c -b 10 -w 24 -r $SPECIFIC_REWARD_EPOCH_ID -m 10000