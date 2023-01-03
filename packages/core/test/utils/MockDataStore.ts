import { MockResultObject } from ".";
import { WorkerFetchProcess, Worker, LevelTwo } from "../../src";

const wait = (time?: number) =>
  new Promise((resolve) => setTimeout(resolve, time || 5));

export class MockDataStore {
  public levelTwo: LevelTwo;
  public customerFetch: jest.Mock;
  public customerProcess: WorkerFetchProcess<MockResultObject, string>;
  public customerWorker: Worker<MockResultObject, string>;
  public productFetch: jest.Mock;
  public productProcess: WorkerFetchProcess<MockResultObject, string>;
  public productWorker: Worker<MockResultObject, string>;
  public throwErrors = false;
  public data: Record<string, MockResultObject> = {
    "customer:github": { id: "github", name: "Github" },
    "customer:circleci": { id: "circleci", name: "CircleCI" },
    "customer:npm": { id: "npm", name: "NPM" },
    "customer:jetbrains": { id: "jetbrains", name: "JetBrains" },
    "product:laptop": { id: "laptop", name: "Laptop" },
    "product:keyboard": { id: "keyboard", name: "Keyboard" },
    "product:mouse": { id: "mouse", name: "Mouse" },
    "product:ide": { id: "ide", name: "IDE" },
  };

  constructor(levelTwo: LevelTwo) {
    this.levelTwo = levelTwo;

    // customer fetching
    this.customerProcess = async (ids) => {
      await wait();
      if (this.throwErrors) {
        throw new Error(`Invalid customer fetch`);
      }

      return ids.map((id) => this.data[`customer:${id}`]);
    };
    this.customerFetch = jest
      .fn()
      .mockImplementation(this.customerProcess.bind(this));
    this.customerWorker = this.levelTwo.createWorker(
      "customer",
      this.customerFetch
    );

    // product fetching
    this.productProcess = async (ids, earlyWrite) => {
      for (const id of ids) {
        await wait();
        const key = `product:${id}`;
        if (this.data[key]) {
          earlyWrite(id, this.data[key]);
        }

        if (this.throwErrors) {
          throw new Error(`Invalid product fetch`);
        }
      }
    };
    this.productFetch = jest
      .fn()
      .mockImplementation(this.productProcess.bind(this));
    this.productWorker = this.levelTwo.createWorker(
      "product",
      this.productFetch
    );
  }
}
