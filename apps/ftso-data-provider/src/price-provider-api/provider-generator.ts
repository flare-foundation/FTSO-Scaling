const { generateApi } = require('swagger-typescript-api');
const path = require("path");
const fs = require("fs");

// NOTE: its assumed that this scrypt is run from the root of the project

const input = path.resolve(process.cwd(), './apps/ftso-data-provider/src/price-provider-api/api-spec.json');
const output = path.resolve(process.cwd(), './apps/ftso-data-provider/src/price-provider-api/generated');

console.log(`Generating API from ${input} to ${output}`);

/* NOTE: all fields are optional expect one of `input`, `url`, `spec` */
generateApi({
  name: "provider-api.ts",
  // set to `false` to prevent the tool from writing to disk
  output: output,
  input: input,
  // templates: path.resolve(process.cwd(), './api-templates'),
  httpClientType: "axios", // or "fetch"
  defaultResponseAsSuccess: false,
  generateClient: true,
  generateRouteTypes: false,
  generateResponses: true,
  toJS: false,
  extractRequestParams: false,
  extractRequestBody: false,
  extractEnums: true,
  unwrapResponseData: false,
  defaultResponseType: "void",
  singleHttpClient: false,
  cleanOutput: true,
  enumNamesAsValues: false,
  moduleNameFirstTag: true,
  generateUnionEnums: false,
  typePrefix: '',
  typeSuffix: '',
  enumKeyPrefix: '',
  enumKeySuffix: '',
  addReadonly: false,
  sortTypes: false,
  sortRouters: false,
  extractingOptions: {
    requestBodySuffix: ["Payload", "Body", "Input"],
    requestParamsSuffix: ["Params"],
    responseBodySuffix: ["Data", "Result", "Output"],
    responseErrorSuffix: ["Error", "Fail", "Fails", "ErrorData", "HttpError", "BadResponse"],
  },
})
  .then(({ files, configuration }) => {
    console.log(`Generated ${files.length} files`);
  })
  .catch(e => console.error(e))

