export class RagConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RagConfigurationError";
  }
}
