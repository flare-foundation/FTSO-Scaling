// Usage:
// JSON.stringify(object, bigIntReplacer);
// JSON.parse(string, bigIntReviver);

export function bigIntReplacer(key: string, value: any): any {
  if (typeof value === "bigint") {
    return value.toString() + "n";
  }
  return value;
}

export function bigIntReviver(key: string, value: any): any {
  if (typeof value === "string" && /^\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  return value;
}
