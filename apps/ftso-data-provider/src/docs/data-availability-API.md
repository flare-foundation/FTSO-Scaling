# Data availability API

Each sub protocol produces a certain Merkle tree and votes by signing the Merkle root, which is usually passed by submitSignature transaction as described above. The data used to assemble the Merkle tree for a given voting round should be accessible through an API GET route:
- `GET data/:votingRoundID`
The response should be of the form:
```json
{	
	status: “OK”,
	data: ObjectDefinition[]
}
```
Where ObjectDefinition is as follows:
```json
{
	abiName: string,
  data: any
}
```
The order of objects in the objects list is matching the order of how they are put into the Merkle tree. The `abiName` field refers to an ABI definition that must be included in the list abis provided on `data-abis` route.

A leaf in a Merkle tree contains a data record presented in the form of a JSON object. For each such type of a record there should exist a definition of a matching Solidity struct. The hash should be calculated by packing the data record object to the solidity struct and ABI encoding it. Then hash should be calculated on the ABI encoded data. To obtain JSON ABI definitions we provide another GET API route, which contains mappings from values of the field abiName to JSON ABI definitions:
- `GET data-abis`

with response

```json
{	
	status: “OK”,
	data: JSONAbiDefinition[]
}
```

The response contains ABI definitions for structs obtained from Solc compiler results. Each ABI definition in the list contains a unique name.  Note that such an API response assumes that the Merkle trees are not too big. In future we may add paging to those responses. 
In both responses status can be `"OK"` (and data is provided), while in the data route the status can also  be `"NOT_AVAILABLE"` (data fields are empty). HTTP status should be in both cases 200. In case of any other error the HTTP code should be relevant non 2xx code.