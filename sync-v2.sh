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

# FCC (Flare Confidential Compute) event ABIs.
# Only the two events consumed by the reward calculation are extracted, to keep these files reviewable.
# Note: FlareTeeManager is an EIP-2535 diamond, so TeeInstructionsSent is NOT in the FlareTeeManager.sol
# artifact -- it is declared in IInstructions.sol and emitted from a library inlined into InstructionsFacet.
extract_event() {
  # $1 = artifact path, $2 = event name, $3 = output contract name, $4 = source name
  python3 -c "
import json, sys
artifact, event, contract_name, source_name = sys.argv[1:5]
abi = json.load(open(artifact))['abi']
fragment = next(x for x in abi if x.get('type') == 'event' and x.get('name') == event)
out = {
    '_comment': 'Extracted event ABI, regenerate via sync-v2.sh.',
    'contractName': contract_name,
    'sourceName': source_name,
    'abi': [fragment],
}
open('abi/%s.json' % contract_name, 'w').write(json.dumps(out, indent=2) + '\n')
" "$1" "$2" "$3" "$4"
}

extract_event ../flare-smart-contracts-v2/artifacts/contracts/tee/facets/InstructionsFacet.sol/InstructionsFacet.json \
  TeeInstructionsSent FlareTeeManager contracts/tee/facets/InstructionsFacet.sol
extract_event ../flare-smart-contracts-v2/artifacts/contracts/fdc2/implementation/Fdc2Hub.sol/Fdc2Hub.json \
  AttestationRequested Fdc2Hub contracts/fdc2/implementation/Fdc2Hub.sol

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

