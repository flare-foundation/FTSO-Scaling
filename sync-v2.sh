rm -rf abi
mkdir -p abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/ftso/merkle/FtsoMerkleStructs.sol/FtsoMerkleStructs.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/FlareSystemManager.sol/FlareSystemManager.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/Relay.sol/Relay.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/Submission.sol/Submission.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/VoterRegistry.sol/VoterRegistry.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/RewardManager.sol/RewardManager.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/ftso/implementation/FtsoRewardOffersManager.sol/FtsoRewardOffersManager.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/FlareSystemCalculator.sol/FlareSystemCalculator.json abi

cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/PayloadMessage.ts libs/ftso-core/src/utils/PayloadMessage.ts
cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/SigningPolicy.ts libs/ftso-core/src/utils/SigningPolicy.ts
cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/ProtocolMessageMerkleRoot.ts libs/ftso-core/src/utils/ProtocolMessageMerkleRoot.ts