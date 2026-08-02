# Reward calculation for Coston2 network
# Bring up a local indexer, then run this script:
# docker compose -f scripts/rewards/docker-compose.coston2.yaml up -d
# ./scripts/rewards/coston2-db.sh
#
# The indexer must be collecting the FCC events; FSP mode does not do so by default. The compose file above is
# configured for it -- see docs/migrations/FCC-fee-accounting.md, "Indexer requirements", for what it encodes.

export NETWORK=coston2

export DB_REQUIRED_INDEXER_HISTORY_TIME_SEC=86400
export VOTING_ROUND_HISTORY_SIZE=10000
export INDEXER_TOP_TIMEOUT=1000
export DB_HOST=127.0.0.1
export DB_PORT=3307
export DB_USERNAME=root
export DB_PASSWORD=root
export DB_NAME=flare_ftso_indexer_coston2

# Disabling specific logs in reward calculation
export REMOVE_ANNOYING_MESSAGES=true
# Used in some special testing cases for some old reward epochs. Not relevant anymore.
export ALLOW_IDENTITY_ADDRESS_SIGNING=true

# With history_epochs = 2 in the compose file the indexer serves the current and the previous reward epoch, so
# REWARD_EPOCH_ID below should be the previous (just-completed) one. Read the current one from the chain with
# FlareSystemsManager.getCurrentRewardEpochId and subtract one.

# COMPILATION
pnpm nest build ftso-reward-calculation-process

# ---------------------------------------------------------------------------------------------------------------------------
# Single reward epoch calculation. -g data, -o offers, -c claims, -a aggregate, -y fast updates, -z FDC.
export REWARD_EPOCH_ID=5877
node dist/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -g -o -c -a -y -z -b 40 -w 10 -r $REWARD_EPOCH_ID -m 10000

# ---------------------------------------------------------------------------------------------------------------------------
# Calculating all reward data from a starting reward epoch id through the latest completed epoch.
# Only reaches back as far as the indexer's history_epochs window.
# export FROM_REWARD_EPOCH_ID=5877
# node dist/apps/ftso-reward-calculation-process/src/main.js ftso-reward-calculation-process -g -o -c -a -y -z -b 40 -w 10 -d $FROM_REWARD_EPOCH_ID -m 10000
