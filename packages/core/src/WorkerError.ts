import { Entry, EntryProps } from "./Entry";

/**
 * Wrapper to pass entry source along with an error
 */
export class WorkerError<IdentifierType, ResultType> extends Error {
  /**
   * Entry source for the error
   */
  public readonly entry: Entry<IdentifierType, ResultType>;

  constructor(entry: EntryProps<IdentifierType, ResultType>) {
    super(entry.error?.message || "Unknown Worker Error");
    this.entry = new Entry<IdentifierType, ResultType>(entry);
  }
}
