import { ActionListener, wait } from ".";
import { DistributedAction, MessageBroker } from "../../src";

export const getMockedMessageBroker = () => {
  const messageBroker = new MockMessageBroker();
  jest.spyOn(messageBroker, "setup");
  jest.spyOn(messageBroker, "teardown");
  jest.spyOn(messageBroker, "publish");
  jest.spyOn(messageBroker, "subscribe");
  return messageBroker;
};

export class MockMessageBroker implements MessageBroker {
  public isSetup = false;
  public isTorndown = false;
  public listeners: ActionListener[] = [];

  public async setup(): Promise<void> {
    await wait();
    this.isTorndown = false;
    await wait();
    this.isSetup = true;
  }

  public async teardown(): Promise<void> {
    await wait();
    this.isSetup = false;
    await wait();
    this.isTorndown = true;
  }

  public async publish(action: DistributedAction<string>): Promise<void> {
    for (const listener of this.listeners) {
      await wait();
      listener(action);
    }
  }

  public async subscribe(
    listener: (action: DistributedAction<string>) => void
  ): Promise<void> {
    this.listeners.push(listener);
  }
}
