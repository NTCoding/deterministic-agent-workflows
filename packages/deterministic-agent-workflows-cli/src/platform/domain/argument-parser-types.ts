/** @riviere-role value-object */
export type ArgResult<T> =
  | {
    readonly ok: true;
    readonly value: T
  }
  | {
    readonly ok: false;
    readonly message: string
  }

/** @riviere-role value-object */
export type ArgParser<T> = {
  readonly parse: (args: readonly string[], position: number, commandName: string) => ArgResult<T>
  readonly optional: () => ArgParser<T | undefined>
}
