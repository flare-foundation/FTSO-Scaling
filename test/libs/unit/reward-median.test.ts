import { generateMedianCalculationResult } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";

describe(`Reward/ftso median, ${getTestFile(__filename)}`, function () {
  const medianCalculationResult = generateMedianCalculationResult(7);

  it("should calculate median", function () {
    console.log(medianCalculationResult);
  });
});
