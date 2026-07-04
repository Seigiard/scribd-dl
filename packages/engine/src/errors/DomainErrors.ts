import { Data } from "effect";

export class BrowserLaunchFailed extends Data.TaggedError("BrowserLaunchFailed")<{
  readonly cause: unknown;
}> {}

export class PageLoadFailed extends Data.TaggedError("PageLoadFailed")<{
  readonly url: string;
  readonly cause: unknown;
}> {}

export class PageProcessFailed extends Data.TaggedError("PageProcessFailed")<{
  readonly url: string;
  readonly cause: unknown;
}> {}

export class PdfGenerationFailed extends Data.TaggedError("PdfGenerationFailed")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export class PdfMergeFailed extends Data.TaggedError("PdfMergeFailed")<{
  readonly cause: unknown;
}> {}

export class DirectoryIoFailed extends Data.TaggedError("DirectoryIoFailed")<{
  readonly path: string;
  readonly op: "create" | "remove";
  readonly cause: unknown;
}> {}

export class UrlListUnreadable extends Data.TaggedError("UrlListUnreadable")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export class UnsupportedUrl extends Data.TaggedError("UnsupportedUrl")<{
  readonly url: string;
}> {}

export class JobNotFound extends Data.TaggedError("JobNotFound")<{
  readonly id: string;
}> {}

export class NotRemovable extends Data.TaggedError("NotRemovable")<{
  readonly id: string;
  readonly status: string;
}> {}

export class NotRetryable extends Data.TaggedError("NotRetryable")<{
  readonly id: string;
  readonly status: string;
}> {}

export class PersistenceFailed extends Data.TaggedError("PersistenceFailed")<{
  readonly path: string;
  readonly op: "read" | "write";
  readonly cause: unknown;
}> {}

export class CompressionFailed extends Data.TaggedError("CompressionFailed")<{
  readonly path: string;
  readonly reason: string;
  // Scrubbed cause only ({ message, status }) — never the raw AxiosError, whose
  // config.headers.Authorization carries the JWT signed from the secret key.
  readonly cause: unknown;
}> {}
