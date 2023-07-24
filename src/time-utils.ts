export async function sleepFor(ms: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
