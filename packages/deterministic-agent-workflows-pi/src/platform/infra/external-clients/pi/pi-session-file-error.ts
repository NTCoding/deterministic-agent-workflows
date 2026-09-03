/** @riviere-role external-client-error */
export class PiSessionFileError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PiSessionFileError'
  }
}
