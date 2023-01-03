export const wait = async (time?: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, time || 50));
