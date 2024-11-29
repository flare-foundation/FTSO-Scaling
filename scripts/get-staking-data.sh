wget "https://raw.githubusercontent.com/flare-foundation/reward-scripts/refs/heads/main/generated-files/reward-epoch-$1/nodes-data.json"
mkdir -p staking-data
mkdir -p staking-data/flare
rm -f staking-data/flare/$1-nodes-data.json
mv nodes-data.json staking-data/flare/$1-nodes-data.json