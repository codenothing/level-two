import { DistributedAction } from "../../src";

export const wait = (ms?: number) =>
  new Promise((resolve) => setTimeout(resolve, ms || 5));

export interface MockResultObject {
  id: string;
  name: string;
}

export type ActionListener = (action: DistributedAction<string>) => void;
