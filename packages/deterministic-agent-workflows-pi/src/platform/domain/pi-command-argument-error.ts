/** @riviere-role domain-error */
export class PiCommandArgumentError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'PiCommandArgumentError'
  }
}
