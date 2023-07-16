import { Entry, EntryProps } from "./Entry";
/**
 * Options for creating an CachedEntry instance
 */
export type CachedEntryProps<IdentifierType, ResultType> = Omit<
  EntryProps<IdentifierType, ResultType>,
  "value"
> & {
  /**
   * Value of the cached entry
   */
  value: ResultType;
};

/**
 * Cached entry object with required value
 */
export class CachedEntry<IdentifierType, ResultType> extends Entry<
  IdentifierType,
  ResultType
> {
  /**
   * Value of the cached entry
   */
  public value: ResultType;

  constructor(props: CachedEntryProps<IdentifierType, ResultType>) {
    super(props);
    this.value = props.value;
  }
}
