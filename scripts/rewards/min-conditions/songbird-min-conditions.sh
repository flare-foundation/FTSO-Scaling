# Reward calculation for Coston network
# Setup the correct DB connection and run the script, e.g.
# ./scripts/rewards/coston-db.sh

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
export ALLOW_IDENTITY_ADDRESS_SIGNING=true
# Start reward epoch id on Coston
export START_REWARD_EPOCH_ID=2344

# COMPILATION
yarn nest build ftso-reward-calculation-process

node dist/apps/ftso-reward-calculation-process/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -f -r $1
