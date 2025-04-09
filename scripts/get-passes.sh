NETWORK=$1
REWARD_EPOCH_ID=$2
# check if parameters are passed
if [ -z "$NETWORK" ] || [ -z "$REWARD_EPOCH_ID" ]; then
  echo "Provide the network and reward epoch id as parameters"
  exit 1
fi

wget "https://raw.githubusercontent.com/flare-foundation/fsp-rewards/refs/heads/main/$NETWORK/$REWARD_EPOCH_ID/passes.json"
mkdir -p calculations
mkdir -p calculations/$NETWORK
mkdir -p calculations/$NETWORK/$REWARD_EPOCH_ID
rm -f calculations/$NETWORK/$REWARD_EPOCH_ID/passes.json
mv passes.json calculations/$NETWORK/$REWARD_EPOCH_ID/passes.json