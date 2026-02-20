# Reward calculation for Coston network
# Setup the correct DB connection and run the script, e.g.
# ./scripts/rewards/coston-db.sh

export NETWORK=coston

export DB_REQUIRED_INDEXER_HISTORY_TIME_SEC=86400
export VOTING_ROUND_HISTORY_SIZE=10000
export INDEXER_TOP_TIMEOUT=1000
export DB_HOST=127.0.0.1
export DB_PORT=3336
export DB_USERNAME=root
export DB_PASSWORD=root
export DB_NAME=flare_ftso_indexer

# Disabling specific logs in reward calculation
export REMOVE_ANNOYING_MESSAGES=true
# Used in some special testing cases for some old reward epochs. Not relevant anymore.
export ALLOW_IDENTITY_ADDRESS_SIGNING=true

# check here: https://coston-explorer.flare.network/address/0x6e5A85aB09c2056A9Af46c3Ca5a5A1E6752C8D79/read-contract#address-tabs
# 9.  getCurrentRewardEpochId to get current reward epoch (required indexer history is 4 epochs/ 1 day)

# COMPILATION
pnpm nest build ftso-reward-calculation-process

# ---------------------------------------------------------------------------------------------------------------------------
# Calculating all reward data from the starting reward epoch id. The calculation of claims is parallelized. 
# In the current (ongoing) reward epoch the calculation is switched to incremental, as data becomes available. 
# If the data for a specific reward epoch id is already available, the calculation is skipped.
export FROM_REWARD_EPOCH_ID=3250
node dist/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -g -o -c -a -y -z -b 40 -w 10 -d $FROM_REWARD_EPOCH_ID -m 10000

# ---------------------------------------------------------------------------------------------------------------------------
# single reward epoch calculation
# export REWARD_EPOCH_ID=2773
# node dist/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -g -o -c -a -y -z -b 40 -w 10 -r $REWARD_EPOCH_ID -m 10000

