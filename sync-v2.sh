#!/usr/bin/env bash
rm -rf abi
mkdir -p abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/ftso/merkle/FtsoMerkleStructs.sol/FtsoMerkleStructs.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/merkle/ProtocolMerkleStructs.sol/ProtocolMerkleStructs.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/FlareSystemsManager.sol/FlareSystemsManager.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/Relay.sol/Relay.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/Submission.sol/Submission.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/VoterRegistry.sol/VoterRegistry.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/RewardManager.sol/RewardManager.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/ftso/implementation/FtsoRewardOffersManager.sol/FtsoRewardOffersManager.json abi
cp -r ../flare-smart-contracts-v2/artifacts/contracts/protocol/implementation/FlareSystemsCalculator.sol/FlareSystemsCalculator.json abi

# FCC (Flare Confidential Compute) contracts.
# NOTE: FlareTeeManager is an EIP-2535 diamond. TeeInstructionsSent is declared in IInstructions.sol and emitted
# from a library inlined into InstructionsFacet, so it is NOT in the FlareTeeManager.sol artifact (which carries
# only DiamondCut). The facet artifact is therefore copied to the diamond's name, which is the name the indexer
# queries by. Do not "correct" this to contracts/tee/diamond/FlareTeeManager.sol: the resulting ABI would have no
# matching event. The topic0 assertions in test/libs/fsp-rewards/fcc-fee-claims.test.ts guard against that.
cp -r ../flare-smart-contracts-v2/artifacts/contracts/tee/facets/InstructionsFacet.sol/InstructionsFacet.json abi/FlareTeeManager.json
cp -r ../flare-smart-contracts-v2/artifacts/contracts/fdc2/implementation/Fdc2Hub.sol/Fdc2Hub.json abi

# COPY_HEADER="
# ////////////////////////////////////////////////////////////////////////////////////////////////////////
# // This file is copied from the Flare Smart Contract V2 repository.
# // DO NOT CHANGE!
# // See: https://gitlab.com/flarenetwork/flare-smart-contracts-v2/-/tree/main/scripts/libs/protocol
# ////////////////////////////////////////////////////////////////////////////////////////////////////////

# "

# copy_libs_add_header() {
#    cp -r ../flare-smart-contracts-v2/scripts/libs/protocol/$1.ts libs/ftso-core/fsp-utils/$1.ts.tmp
#    echo "$COPY_HEADER" > libs/ftso-core/fsp-utils/$1.ts
#    cat libs/ftso-core/fsp-utils/$1.ts.tmp >> libs/ftso-core/fsp-utils/$1.ts
#    rm libs/ftso-core/fsp-utils/$1.ts.tmp
# }

# copy_libs_add_header "PayloadMessage"
# copy_libs_add_header "SigningPolicy"
# copy_libs_add_header "ProtocolMessageMerkleRoot"
# copy_libs_add_header "ECDSASignature"
# copy_libs_add_header "ECDSASignatureWithIndex"
# copy_libs_add_header "RelayMessage"
# copy_libs_add_header "SignaturePayload"

