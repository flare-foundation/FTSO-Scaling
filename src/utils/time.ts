export async function sleepFor(ms: number) {
  await new Promise((resolve: any) => {
    setTimeout(() => resolve(), ms);
  });
}
