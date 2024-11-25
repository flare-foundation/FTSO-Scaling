wget "https://raw.githubusercontent.com/flare-foundation/reward-scripts/refs/heads/main/generated-files/reward-epoch-$1/nodes-data.json"
mkdir -p staking-data
rm -f staking-data/$1-nodes-data.json
mv nodes-data.json staking-data/$1-nodes-data.json