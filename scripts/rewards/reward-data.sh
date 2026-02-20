pnpm ts-node scripts/analytics/run/extract-reward-data.ts flare $1
env NETWORK=flare pnpm ts-node scripts/analytics/run/reward-claims-csv.ts $1

pnpm ts-node scripts/analytics/run/extract-reward-data.ts songbird $1
env NETWORK=songbird pnpm ts-node scripts/analytics/run/reward-claims-csv.ts $1

cp -r rewards-data/flare/$1 ../fsp-rewards/flare
cp -r rewards-data/songbird/$1 ../fsp-rewards/songbird/