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

COPY_HEADER="
////////////////////////////////////////////////////////////////////////////////////////////////////////
// This file is copied from the Flare Smart Contract V2 repository.
// DO NOT CHANGE!
// See: https://gitlab.com/flarenetwork/flare-smart-contracts-v2/-/tree/main/scripts/libs/protocol
////////////////////////////////////////////////////////////////////////////////////////////////////////

"

copy_libs_add_header() {
   cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/$1.ts libs/fsp-utils/src/$1.ts.tmp
   echo "$COPY_HEADER" > libs/fsp-utils/src/$1.ts
   cat libs/fsp-utils/src/$1.ts.tmp >> libs/fsp-utils/src/$1.ts
   rm libs/fsp-utils/src/$1.ts.tmp
}

copy_libs_add_header "PayloadMessage"
copy_libs_add_header "SigningPolicy"
copy_libs_add_header "ProtocolMessageMerkleRoot"
copy_libs_add_header "ECDSASignature"
copy_libs_add_header "ECDSASignatureWithIndex"
copy_libs_add_header "RelayMessage"
copy_libs_add_header "SignaturePayload"

