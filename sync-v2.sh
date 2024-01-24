rm -rf abi
mkdir -p abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/ftso/merkle/FtsoMerkleStructs.sol/FtsoMerkleStructs.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/merkle/ProtocolMerkleStructs.sol/ProtocolMerkleStructs.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/FlareSystemManager.sol/FlareSystemManager.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/Relay.sol/Relay.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/Submission.sol/Submission.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/VoterRegistry.sol/VoterRegistry.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/RewardManager.sol/RewardManager.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/ftso/implementation/FtsoRewardOffersManager.sol/FtsoRewardOffersManager.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/FlareSystemCalculator.sol/FlareSystemCalculator.json abi

cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/PayloadMessage.ts libs/fsp-utils/PayloadMessage.ts
cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/SigningPolicy.ts libs/fsp-utils/SigningPolicy.ts
cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/ProtocolMessageMerkleRoot.ts libs/fsp-utils/ProtocolMessageMerkleRoot.ts
cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/ECDSASignature.ts libs/fsp-utils/ECDSASignature.ts
cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/ECDSASignatureWithIndex.ts libs/fsp-utils/ECDSASignatureWithIndex.ts
cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/RelayMessage.ts libs/fsp-utils/RelayMessage.ts
cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/SignaturePayload.ts libs/fsp-utils/SignaturePayload.ts
