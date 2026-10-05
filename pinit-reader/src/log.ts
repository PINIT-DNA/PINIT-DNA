const PREFIX = '[PINIT Reader]';

type LogSink = (line: string) => void;

let sink: LogSink = (line) => {
  console.info(line);
};

/** Tests replace this so logs can be checked without printing secrets. */
export function setReaderLogSink(next: LogSink | null): void {
  sink = next ?? ((line) => console.info(line));
}

/** Fixed progress lines only. Callers must not pass tokens, files, or codes. */
export function readerLog(message: string): void {
  sink(`${PREFIX}\n${message}`);
}
